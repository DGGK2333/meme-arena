/* =========================================================================
 * tools/verify-tune.js —— 角色调参面板 + 投掷型模板 + 胜负音效
 *
 * 覆盖三件事：
 *   1. 结算音效：有冠军播 victory、平局播 draw（蹭 Audio.play 验证调用）
 *   2. 投掷型模板 makeThrower：生成的角色能打、参数真的可改
 *   3. 网页「角色调参」面板：控件齐全、改动写回模板、跨刷新保留、能恢复默认
 *
 * 用法：node tools/verify-tune.js
 * ========================================================================= */
"use strict";

const path = require("path");
const { Browser, sleep, reapStaleProcesses } = require("./cdp");

const ROOT = path.resolve(__dirname, "..");
const URL = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");

let failures = 0;
function check(label, cond, detail) {
  console.log((cond ? "  ✓ " : "  ✗ ") + label + (detail ? "  " + detail : ""));
  if (!cond) failures++;
}
async function reload(browser) { await browser.reload(); }

(async () => {
  const reaped = reapStaleProcesses();
  if (reaped) console.log("已清理 " + reaped + " 个残留测试进程\n");

  const browser = new Browser();
  const errors = [];

  try {
    await browser.launch({ url: "about:blank", width: 1400, height: 950 });
    await browser.send("Runtime.enable");
    browser.on("Runtime.exceptionThrown", p => {
      const d = p.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    });
    browser.on("Runtime.consoleAPICalled", p => {
      if (p.type !== "error") return;
      errors.push("console.error: " + (p.args || []).map(a => a.value || a.description).join(" "));
    });

    await browser.open(URL);
    await sleep(1300);
    await browser.eval(`(function(){ window.MA.Settings.clear(); return true; })()`);
    await reload(browser);
    await sleep(1300);

    console.log("=== 1. 结算音效：冠军播 victory、平局播 draw ===");
    const snd = JSON.parse(await browser.eval(`JSON.stringify((function(){
      // 蹭 Audio.play，记录被请求播放的 (角色, 槽位, 内置音)
      var log = [];
      var orig = window.MA.Audio.play;
      window.MA.Audio.play = function (id, slot, synth) {
        log.push([id == null ? null : String(id), slot || null, synth || null]);
        return orig.apply(this, arguments);
      };
      world.autoRestart = false;

      // --- 有冠军 ---
      world.reset(["chuanjian", "suannai"]);
      log.length = 0;
      world.finish(world.units[0], "测试冠军");
      var winLog = log.slice();

      // --- 平局 ---
      world.reset(["chuanjian", "suannai"]);
      log.length = 0;
      world.finish(null, "测试平局");
      var drawLog = log.slice();

      window.MA.Audio.play = orig;
      return { winLog: winLog, drawLog: drawLog };
    })())`));
    const winVictory = snd.winLog.filter(a => a[1] === "victory");
    const drawVictory = snd.drawLog.filter(a => a[1] === "draw");
    console.log("    冠军时: " + JSON.stringify(snd.winLog));
    console.log("    平局时: " + JSON.stringify(snd.drawLog));
    check("有冠军时请求播放 victory 音效", winVictory.length === 1,
      JSON.stringify(snd.winLog));
    check("victory 用的是内置号角兜底（synth=victory）",
      winVictory.length === 1 && winVictory[0][2] === "victory");
    check("victory 绑定了获胜角色", winVictory.length === 1 && !!winVictory[0][0],
      winVictory.length ? String(winVictory[0][0]) : "无");
    check("平局时请求播放 draw 音效", drawVictory.length === 1,
      JSON.stringify(snd.drawLog));
    check("draw 与 victory 是两套音效", winVictory.length && drawVictory.length &&
      winVictory[0][2] !== drawVictory[0][2]);
    // 内置合成音确实定义了这两个
    const synthDefined = JSON.parse(await browser.eval(`JSON.stringify((function(){
      // 通过播放不抛异常来间接确认（真正的声音无法在无头环境断言）
      var ok = { victory: false, draw: false };
      try { window.MA.Audio.play(null, "victory", "victory"); ok.victory = true; } catch (e) {}
      try { window.MA.Audio.play(null, "draw", "draw"); ok.draw = true; } catch (e) {}
      return ok;
    })())`));
    check("victory / draw 合成音都能播且不抛异常",
      synthDefined.victory && synthDefined.draw, JSON.stringify(synthDefined));

    console.log("\n=== 2. 投掷型模板 makeThrower ===");
    const tpl = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var mk = window.MA.makeThrower;
      if (typeof mk !== "function") return { missing: true };
      var t = mk({
        id: "utest", name: "单元测试角色", icon: "🧪", color: "#8fd0ff",
        hp: 100, atk: 12, def: 4, spd: 50, radius: 18,
        skillName: "测试投掷", cooldown: 3, skillRange: 999, skillDesc: "x",
        throw: { dmg: 30, speed: 700, radius: 20, size: 50, bounce: 3, life: 5, spin: 0, spread: 1 }
      });
      var out = {
        hasThrow: !!t["throw"],
        throwKeys: Object.keys(t["throw"] || {}).sort(),
        hasSkill: typeof t.skill === "function",
        defaultsKept: { shape: t.shape, skillRange: t.skillRange }
      };
      // 用模板现造一个可玩的角色：塞进列表 → 上场 → 放技能
      window.MA.CHARACTERS.push(t);
      world.reset(["utest", "moyu"]);
      world.picks = ["utest", "moyu"];
      world.projectiles.length = 0;
      var u = world.units.filter(function(o){ return o.tpl.id === "utest"; })[0];
      u.vx = 400; u.vy = 0;
      t.skill(u, world);
      out.oneShot = world.projectiles.length;

      // spread=3 → 一次三个
      t["throw"].spread = 3;
      world.projectiles.length = 0;
      t.skill(u, world);
      out.spread3 = world.projectiles.length;

      // 速度参数真的生效
      out.speeds = world.projectiles.map(function(p){ return Math.round(Math.hypot(p.vx, p.vy)); });

      // bounce: 3 → 会被换算成"还会弹 3 次"（不是 Infinity）
      out.bounce = world.projectiles.length ? world.projectiles[0].bounce : null;

      // 大幅提速应该改变出膛速度
      t["throw"].speed = 1000; t["throw"].spread = 1;
      world.projectiles.length = 0;
      t.skill(u, world);
      out.fastSpeed = Math.round(Math.hypot(world.projectiles[0].vx, world.projectiles[0].vy));
      t["throw"].speed = 700;
      world.projectiles.length = 0;
      return out;
    })())`));
    check("makeThrower 已暴露", !tpl.missing);
    check("模板生成了 tpl.throw 数据对象", tpl.hasThrow === true,
      JSON.stringify(tpl.throwKeys));
    check("模板生成了 skill 函数", tpl.hasSkill === true);
    check("省略项走了默认值", tpl.defaultsKept.shape === "round" && tpl.defaultsKept.skillRange === 999,
      JSON.stringify(tpl.defaultsKept));
    check("默认一次扔 1 个", tpl.oneShot === 1, String(tpl.oneShot));
    check("spread=3 时一次扔 3 个", tpl.spread3 === 3, String(tpl.spread3));
    check("投掷速度取自 tpl.throw.speed", tpl.speeds.every(s => Math.abs(s - 700) < 1),
      JSON.stringify(tpl.speeds));
    check("bounce=3 换算成有限次数（不是一直弹）", tpl.bounce === 3, String(tpl.bounce));
    check("改 speed 真的改变出手速度", Math.abs(tpl.fastSpeed - 1000) < 1,
      "700 → " + tpl.fastSpeed);

    console.log("\n=== 2b. 投掷方向：按时间触发 + 朝敌人扔 + 预判 ===");
    /* 用户反馈"现在是碰撞时触发" —— 实测其实是按冷却触发的（下面钉住这一点），
     * 真正的问题在方向：以前沿"自己的运动方向"扔，所以老是打不中，
     * 只有偶尔撞上时才有反馈，看着像"要碰撞才生效"。 */
    const aim = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var ik = window.MA.CHARACTERS.filter(function(t){ return t.id === "ikun"; })[0];

      // ---- 触发节奏：无人可撞时也应稳定按 cooldown 触发 ----
      var fires = [];
      var orig = ik.skill;
      ik.skill = function (u, w2) { fires.push(+w2.time.toFixed(2)); return orig(u, w2); };
      world.autoRestart = false;
      window.MA.CONFIG.arena.zoneEnabled = false;
      world.reset(["ikun"]);
      world.picks = ["ikun"];
      world.units[0].cruiseSpeed = 300;
      for (var i = 0; i < 60 * 30; i++) world.step(1/60);
      var gaps = fires.slice(1).map(function(t, k){ return +(t - fires[k]).toFixed(2); });
      var avgGap = gaps.length ? gaps.reduce(function(a,b){ return a+b; }, 0) / gaps.length : 0;
      ik.skill = orig;

      // ---- 方向：自瞄 ----
      function throwAngle(foeVx, foeVy, opts) {
        world.reset(["ikun", "moyu"]);
        world.picks = ["ikun", "moyu"];
        var a = world.units.filter(function(o){ return o.tpl.id === "ikun"; })[0];
        var b = world.units.filter(function(o){ return o.tpl.id === "moyu"; })[0];
        a.x = 200; a.y = 360; a.vx = 0; a.vy = -400;   // 自己向上跑
        b.x = 600; b.y = 360; b.vx = foeVx; b.vy = foeVy;
        a.target = b;
        var bak = { aim: ik["throw"].aim, lead: ik["throw"].lead };
        if (opts.aim !== undefined) ik["throw"].aim = opts.aim;
        if (opts.lead !== undefined) ik["throw"].lead = opts.lead;
        world.projectiles.length = 0;
        ik.skill(a, world);
        var p = world.projectiles[0];
        ik["throw"].aim = bak.aim; ik["throw"].lead = bak.lead;
        return { rad: Math.atan2(p.vy, p.vx), deg: +(Math.atan2(p.vy, p.vx) * 180 / Math.PI).toFixed(1) };
      }
      var atStill  = throwAngle(0, 0, {});            // 敌人静止
      var moveOnly = throwAngle(0, 0, { aim: 0 });    // 关掉自瞄 → 沿运动方向
      var leadOff  = throwAngle(0, 400, { lead: 0 }); // 横向跑动 + 不预判
      var leadOn   = throwAngle(0, 400, { lead: 1 }); // 横向跑动 + 预判
      window.MA.CONFIG.arena.zoneEnabled = true;
      return {
        fires: fires.length, avgGap: +avgGap.toFixed(2), cooldown: ik.cooldown,
        atStill: atStill.deg, moveOnly: moveOnly.deg,
        leadOff: leadOff.deg, leadOn: leadOn.deg,
        aimDefault: ik["throw"].aim, leadDefault: ik["throw"].lead
      };
    })())`));
    console.log("    30 秒内触发 " + aim.fires + " 次，平均间隔 " + aim.avgGap +
      "s（cooldown " + aim.cooldown + "s）");
    console.log("    敌人静止时投掷方向 " + aim.atStill + "°，关掉自瞄后 " + aim.moveOnly + "°");
    console.log("    目标横向跑：不预判 " + aim.leadOff + "° → 预判 " + aim.leadOn + "°");

    check("投掷是按冷却触发的（不依赖碰撞）", aim.fires >= 6,
      "30 秒 " + aim.fires + " 次");
    check("触发间隔接近配置的 cooldown",
      Math.abs(aim.avgGap - aim.cooldown) < 0.6,
      aim.avgGap + "s vs " + aim.cooldown + "s");
    check("默认瞄准敌人（0°）而不是自己的运动方向（-90°）",
      Math.abs(aim.atStill) < 1, aim.atStill + "°");
    check("aim=0 时回到沿运动方向（-90°）",
      Math.abs(aim.moveOnly + 90) < 1, aim.moveOnly + "°");
    check("预判让瞄准往目标移动方向偏移",
      aim.leadOn > aim.leadOff + 1, aim.leadOff + "° → " + aim.leadOn + "°");
    check("aim / lead 默认都开启", aim.aimDefault === 1 && aim.leadDefault === 1,
      "aim=" + aim.aimDefault + " lead=" + aim.leadDefault);

    console.log("\n=== 3. 调参面板控件齐全 ===");
    const panel = JSON.parse(await browser.eval(`JSON.stringify({
      hasCard: !!document.getElementById("tunePick"),
      hasFields: !!document.getElementById("tuneFields"),
      hasReset: !!document.getElementById("btnTuneReset"),
      options: Array.from(document.querySelectorAll("#tunePick option")).map(function(o){ return o.value; }),
      sliders: document.querySelectorAll("#tuneFields input[type=range]").length,
      labels: Array.from(document.querySelectorAll("#tuneFields .bg-slider > span")).map(function(s){ return s.textContent; })
    })`));
    check("调参面板已就位", panel.hasCard && panel.hasFields && panel.hasReset);
    check("下拉列出了所有角色", panel.options.length === 21, panel.options.length + " 个");
    check("默认选中角色有滑杆", panel.sliders >= 5, panel.sliders + " 个");
    console.log("    默认角色滑杆: " + panel.labels.join(" / "));

    console.log("\n=== 4. 选中投掷型角色会多出投掷物参数 ===");
    const throwPanel = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var sel = document.getElementById("tunePick");
      sel.value = "ikun";
      sel.dispatchEvent(new Event("change"));
      return {
        labels: Array.from(document.querySelectorAll("#tuneFields .bg-slider > span")).map(function(s){ return s.textContent; }),
        sliders: document.querySelectorAll("#tuneFields input[type=range]").length
      };
    })())`));
    console.log("    爱坤滑杆: " + throwPanel.labels.join(" / "));
    const need = ["血量", "速度", "体型（半径）", "投掷伤害", "出手速度", "撞墙反弹次数", "投掷物显示大小", "投掷瞄准", "预判提前量"];
    const missing = need.filter(n => throwPanel.labels.indexOf(n) < 0);
    check("投掷型角色出现投掷物参数", missing.length === 0,
      missing.length ? "缺少 " + missing.join(",") : "全部齐全");
    check("面板能显示「瞄准/预判」两项", throwPanel.labels.indexOf("投掷瞄准") >= 0 &&
      throwPanel.labels.indexOf("预判提前量") >= 0, throwPanel.labels.join(" / "));

    console.log("\n=== 5. 面板改动写回模板并落盘 ===");
    const edited = JSON.parse(await browser.eval(`JSON.stringify((function(){
      function setSlider(labelText, value){
        var labels = document.querySelectorAll("#tuneFields .bg-slider");
        for (var i = 0; i < labels.length; i++) {
          var sp = labels[i].querySelector("span");
          if (!sp || sp.textContent !== labelText) continue;
          var inp = labels[i].querySelector("input");
          inp.value = String(value);
          inp.dispatchEvent(new Event("input"));
          inp.dispatchEvent(new Event("change"));
          return true;
        }
        return false;
      }
      var ik = window.MA.CHARACTERS.filter(function(t){ return t.id === "ikun"; })[0];
      var ok = {};
      ok.hp      = setSlider("血量", 150);
      ok.spd     = setSlider("速度", 90);
      ok.pradius = setSlider("体型（半径）", 26);
      ok.dmg     = setSlider("投掷伤害", 40);
      ok.speed   = setSlider("出手速度", 900);
      ok.bounce  = setSlider("撞墙反弹次数", 5);
      // 写回模板了吗
      var raw = window.localStorage.getItem(window.MA.Settings.KEY);
      var saved = raw ? JSON.parse(raw) : null;
      return {
        ok: ok,
        tpl: { hp: ik.hp, spd: ik.spd, radius: ik.radius,
               dmg: ik["throw"].dmg, speed: ik["throw"].speed, bounce: ik["throw"].bounce },
        saved: saved && saved.chars && saved.chars.ikun ? saved.chars.ikun : null
      };
    })())`));
    check("所有滑杆都找到并触发", Object.keys(edited.ok).every(k => edited.ok[k] === true),
      JSON.stringify(edited.ok));
    check("血量写回模板", edited.tpl.hp === 150, String(edited.tpl.hp));
    check("速度写回模板", edited.tpl.spd === 90, String(edited.tpl.spd));
    check("体型写回模板", edited.tpl.radius === 26, String(edited.tpl.radius));
    check("投掷伤害写回 tpl.throw", edited.tpl.dmg === 40, String(edited.tpl.dmg));
    check("出手速度写回 tpl.throw", edited.tpl.speed === 900, String(edited.tpl.speed));
    check("反弹次数写回 tpl.throw", edited.tpl.bounce === 5, String(edited.tpl.bounce));
    check("改动已存进 localStorage", !!edited.saved && edited.saved.hp === 150,
      JSON.stringify(edited.saved && { hp: edited.saved.hp, throw: edited.saved["throw"] }));

    console.log("\n=== 6. 新建的单位真的用了新数值 ===");
    const live = JSON.parse(await browser.eval(`JSON.stringify((function(){
      world.reset(["ikun", "moyu"]);
      world.picks = ["ikun", "moyu"];
      var u = world.units.filter(function(o){ return o.tpl.id === "ikun"; })[0];
      // 放一次技能，看投掷物是否用新速度
      world.projectiles.length = 0;
      u.vx = 400; u.vy = 0;
      u.tpl.skill(u, world);
      var p = world.projectiles[0];
      return {
        hp: u.stats.hp,
        spd: u.stats.spd,
        r: +u.r.toFixed(2),
        projSpeed: Math.round(Math.hypot(p.vx, p.vy)),
        projDmg: +p.dmg.toFixed(1),
        projBounce: p.bounce
      };
    })())`));
    console.log("    新建的爱坤: hp=" + live.hp + " spd=" + live.spd + " r=" + live.r +
      " 投掷速度=" + live.projSpeed + " 伤害=" + live.projDmg + " 反弹=" + live.projBounce);
    check("新单位的血量用了新数值", live.hp === 150, String(live.hp));
    check("新单位的速度用了新数值", live.spd === 90, String(live.spd));
    check("投掷物速度用了新数值", Math.abs(live.projSpeed - 900) < 1, String(live.projSpeed));
    check("投掷物伤害用了新数值", Math.abs(live.projDmg - 40) < 0.5, String(live.projDmg));
    check("投掷物反弹次数用了新数值", live.projBounce === 5, String(live.projBounce));

    console.log("\n=== 7. 刷新之后参数仍在 ===");
    await reload(browser);
    await sleep(1400);
    const afterReload = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var ik = window.MA.CHARACTERS.filter(function(t){ return t.id === "ikun"; })[0];
      var sel = document.getElementById("tunePick");
      sel.value = "ikun"; sel.dispatchEvent(new Event("change"));
      // 读一个滑杆的当前值，确认界面也同步了
      var labels = document.querySelectorAll("#tuneFields .bg-slider");
      var shown = {};
      for (var i = 0; i < labels.length; i++) {
        var sp = labels[i].querySelector("span");
        var inp = labels[i].querySelector("input");
        if (sp && inp) shown[sp.textContent] = inp.value;
      }
      return { hp: ik.hp, spd: ik.spd, dmg: ik["throw"].dmg,
               speed: ik["throw"].speed, shown: shown };
    })())`));
    console.log("    刷新后: hp=" + afterReload.hp + " spd=" + afterReload.spd +
      " 投掷伤害=" + afterReload.dmg + " 出手速度=" + afterReload.speed);
    check("刷新后模板数值仍在", afterReload.hp === 150 && afterReload.spd === 90 &&
      afterReload.dmg === 40 && afterReload.speed === 900,
      JSON.stringify({ hp: afterReload.hp, spd: afterReload.spd, dmg: afterReload.dmg, speed: afterReload.speed }));
    check("刷新后界面滑杆也同步到存档值",
      afterReload.shown["血量"] === "150" && afterReload.shown["出手速度"] === "900",
      JSON.stringify(afterReload.shown));

    console.log("\n=== 8. 「恢复该角色默认」回到出厂值 ===");
    const resetOne = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var sel = document.getElementById("tunePick");
      sel.value = "ikun"; sel.dispatchEvent(new Event("change"));
      document.getElementById("btnTuneReset").click();
      var ik = window.MA.CHARACTERS.filter(function(t){ return t.id === "ikun"; })[0];
      var raw = window.localStorage.getItem(window.MA.Settings.KEY);
      var saved = raw ? JSON.parse(raw) : null;
      return {
        hp: ik.hp, spd: ik.spd, dmg: ik["throw"].dmg, speed: ik["throw"].speed,
        factoryHp: window.MA.Settings.factoryChars.ikun.hp,
        savedHp: saved && saved.chars && saved.chars.ikun ? saved.chars.ikun.hp : null
      };
    })())`));
    console.log("    恢复后: hp=" + resetOne.hp + "（出厂 " + resetOne.factoryHp + "）" +
      " 投掷伤害=" + resetOne.dmg + " 出手速度=" + resetOne.speed);
    check("恢复到出厂血量", resetOne.hp === resetOne.factoryHp,
      resetOne.hp + " vs " + resetOne.factoryHp);
    check("恢复到出厂投掷伤害", resetOne.dmg === 24, String(resetOne.dmg));
    check("恢复到出厂出手速度", resetOne.speed === 560, String(resetOne.speed));
    check("恢复默认后存档也更新了", resetOne.savedHp === resetOne.factoryHp,
      String(resetOne.savedHp));

    console.log("\n=== 9. 别的角色不受影响 ===");
    const others = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var fac = window.MA.Settings.factoryChars;
      var bad = [];
      window.MA.CHARACTERS.forEach(function(t){
        if (t.id === "ikun") return;
        var f = fac[t.id];
        if (!f) return;
        ["hp","atk","def","spd","radius"].forEach(function(k){
          if (typeof f[k] === "number" && t[k] !== f[k]) bad.push(t.id + "." + k);
        });
      });
      return { bad: bad, total: window.MA.CHARACTERS.length };
    })())`));
    check("只改了爱坤，其它角色保持出厂值", others.bad.length === 0,
      others.bad.length ? others.bad.join(", ") : others.total + " 个角色全部正常");

    console.log("\n=== 10. 无报错 ===");
    check("无 JS 报错", errors.length === 0, errors.slice(0, 3).join(" | "));

  } catch (e) {
    console.error("\n验证过程出错: " + (e && e.stack || e));
    failures++;
  } finally {
    await browser.close();
  }

  console.log("\n" + (failures === 0 ? "全部通过 ✅" : failures + " 项失败 ❌"));
  process.exit(failures === 0 ? 0 : 1);
})();
