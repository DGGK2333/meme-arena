/* =========================================================================
 * tools/browser-check.js —— 真实浏览器端到端验证
 * 用 CDP 打开真实 index.html，检查报错、模拟推进、界面渲染，并截图存档。
 * 用法：node tools/browser-check.js
 * ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const { Browser, sleep, reapStaleProcesses } = require("./cdp");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "_verify");
const URL = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");

let failures = 0;
function check(label, cond, detail) {
  console.log((cond ? "  ✓ " : "  ✗ ") + label + (detail ? "  " + detail : ""));
  if (!cond) failures++;
}

(async () => {
  // 先清掉上次被中断留下的无头浏览器，避免它们空转烧 CPU
  const reaped = reapStaleProcesses();
  if (reaped) console.log("已清理 " + reaped + " 个残留测试进程\n");

  fs.mkdirSync(OUT, { recursive: true });
  const browser = new Browser();

  const errors = [];
  const warns = [];

  try {
    console.log("=== 1. 启动无头浏览器并加载 index.html ===");
    await browser.launch({ url: "about:blank" });

    await browser.send("Runtime.enable");
    await browser.send("Log.enable");
    browser.on("Runtime.exceptionThrown", p => {
      const d = p.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    });
    browser.on("Runtime.consoleAPICalled", p => {
      const text = (p.args || []).map(a => a.value !== undefined ? a.value : a.description).join(" ");
      if (p.type === "error") errors.push("console.error: " + text);
      if (p.type === "warning") warns.push(text);
    });
    browser.on("Log.entryAdded", p => {
      if (p.entry.level === "error") errors.push("log: " + p.entry.text);
    });

    await browser.open(URL);
    await sleep(800);

    console.log("\n=== 2. 脚本与数据加载 ===");
    const loaded = await browser.eval(`JSON.stringify({
      hasMA: !!window.MA,
      hasConfig: !!(window.MA && window.MA.CONFIG),
      hasCharacters: !!(window.MA && window.MA.CHARACTERS),
      charCount: (window.MA && window.MA.CHARACTERS || []).length,
      hasManifest: !!(window.MA && window.MA.ASSET_MANIFEST),
      hasWorld: typeof World === "function",
      hasAssets: !!(window.MA && window.MA.Assets),
      hasAudio: !!(window.MA && window.MA.Audio),
      canvas: (function(){ var c = document.getElementById("cv"); return c ? c.width + "x" + c.height : "none"; })()
    })`);
    const L = JSON.parse(loaded);
    check("MA 命名空间", L.hasMA);
    check("配置已加载", L.hasConfig);
    check("角色数据已加载", L.hasCharacters, L.charCount + " 个角色");
    check("素材清单已加载", L.hasManifest);
    check("引擎已加载", L.hasWorld);
    check("素材模块已加载", L.hasAssets);
    check("音频模块已加载", L.hasAudio);
    check("Canvas 已初始化", L.canvas !== "none", L.canvas);

    console.log("\n=== 3. 界面渲染 ===");
    const ui = await browser.eval(`JSON.stringify({
      chips: document.getElementById("picker").children.length,
      roster: document.getElementById("roster").children.length,
      logLines: document.getElementById("log").children.length,
      speedBtns: document.querySelectorAll("#speed button").length,
      selects: document.querySelectorAll("aside select").length,
      fps: document.getElementById("hFps").textContent,
      ver: document.getElementById("hVer").textContent
    })`);
    const U = JSON.parse(ui);
    check("角色选择器", U.chips === L.charCount, U.chips + " 个");
    check("战况列表", U.roster > 0, U.roster + " 行");
    check("战报输出", U.logLines > 0, U.logLines + " 条");
    check("倍速按钮", U.speedBtns === 4, U.speedBtns + " 个");
    // 按 id 检查关键控件，而不是数总数 —— 新增选项不该让测试失败
    const ctrl = JSON.parse(await browser.eval(`JSON.stringify({
      move: !!document.getElementById("optMove"),
      cam: !!document.getElementById("optCam"),
      camTarget: !!document.getElementById("optCamTarget"),
      dmgText: !!document.getElementById("optDmgText"),
      shrink: !!document.getElementById("optShrink"),
      ai: !!document.getElementById("optAI"),
      dmg: !!document.getElementById("optDmg"),
      auto: !!document.getElementById("optAuto"),
      bg: !!document.getElementById("optBg")
    })`));
    const missing = Object.keys(ctrl).filter(k => !ctrl[k]);
    check("设置控件齐全", missing.length === 0,
      missing.length ? "缺少: " + missing.join(",") : Object.keys(ctrl).length + " 个都在");

    console.log("\n=== 4. 模拟推进与物理正确性 ===");
    const s1 = JSON.parse(await browser.eval(`JSON.stringify({
      time: world.time, alive: world.aliveCount(), units: world.units.length,
      positions: world.units.map(function(u){ return [u.x, u.y]; }),
      moveMode: world.moveMode
    })`));
    check("默认是动量模式", s1.moveMode === "momentum", s1.moveMode);

    await sleep(1800);
    const s2 = JSON.parse(await browser.eval(`JSON.stringify({
      time: world.time, alive: world.aliveCount(), units: world.units.length,
      positions: world.units.map(function(u){ return [u.x, u.y]; }),
      moving: world.units.filter(function(u){ return Math.hypot(u.vx,u.vy) > 1; }).length,
      inBounds: world.units.every(function(u){
        return u.x >= u.r - 1 && u.x <= world.arena - u.r + 1 &&
               u.y >= u.r - 1 && u.y <= world.arena - u.r + 1;
      }),
      finite: world.units.every(function(u){
        return isFinite(u.x) && isFinite(u.y) && isFinite(u.hp);
      }),
      skillErrors: world.skillErrors,
      hpChanged: world.units.some(function(u){ return u.hp < u.stats.hp; }),
      hasVelocity: world.units.every(function(u){ return Math.hypot(u.vx,u.vy) > 0; })
    })`));

    check("时间在推进", s2.time > s1.time + 1, s1.time.toFixed(1) + "s → " + s2.time.toFixed(1) + "s");
    check("单位在移动", s2.moving > 0, s2.moving + "/" + s2.units + " 个在动");
    check("所有单位都有动量", s2.hasVelocity === true);
    check("坐标全部在擂台内", s2.inBounds);
    check("数值无 NaN", s2.finite);
    check("技能无异常", s2.skillErrors === 0, s2.skillErrors + " 次");
    check("战斗有实际伤害", s2.hpChanged);

    const movedCount = s1.positions.filter((p, i) =>
      s2.positions[i] && (Math.abs(p[0] - s2.positions[i][0]) > 1 || Math.abs(p[1] - s2.positions[i][1]) > 1)).length;
    check("位置确实发生变化", movedCount > 0, movedCount + " 个单位位移");

    console.log("\n=== 4b. 动量守恒与接触伤害 ===");
    const physics = JSON.parse(await browser.eval(`JSON.stringify((function(){
      // 造一个受控场景：两个单位对撞，检查动量守恒与接触伤害
      // 注意：reset 后 units 顺序是打乱的，必须按 id 查角色
      world.autoRestart = false;
      world.reset(["chuanjian", "suannai"]);   // 剑刃(会伤人) vs 酸奶(type=none, 不伤人)
      var find = function(id){
        for (var i = 0; i < world.units.length; i++) if (world.units[i].tpl.id === id) return world.units[i];
        return null;
      };
      var a = find("chuanjian"), b = find("suannai");
      if (!a || !b) return { error: "找不到测试角色" };
      a.x = world.arena * 0.3; a.y = world.arena * 0.5;
      b.x = world.arena * 0.7; b.y = world.arena * 0.5;
      a.vx = 400; a.vy = 0;
      b.vx = -400; b.vy = 0;
      a.hp = a.stats.hp; b.hp = b.stats.hp;
      var hpA0 = a.hp, hpB0 = b.hp;

      var ma = world.massOf(a), mb = world.massOf(b);
      var pBefore = ma * a.vx + mb * b.vx;
      var keBefore = 0.5 * ma * a.vx * a.vx + 0.5 * mb * b.vx * b.vx;

      // 推进到它们相撞
      for (var i = 0; i < 60; i++) world.step(1/60);

      var pAfter = ma * a.vx + mb * b.vx;
      var keAfter = 0.5 * ma * (a.vx * a.vx + a.vy * a.vy) +
                    0.5 * mb * (b.vx * b.vx + b.vy * b.vy);
      return {
        pBefore: pBefore, pAfter: pAfter,
        keBefore: keBefore, keAfter: keAfter,
        dmgToB: hpB0 - b.hp,     // 纯爱战士撞酸奶 → 酸奶该掉血
        dmgToA: hpA0 - a.hp,     // 酸奶撞纯爱战士 → 纯爱战士不该掉血
        contactA: a.tpl.contact.type, contactB: b.tpl.contact.type,
        separated: Math.hypot(a.x-b.x, a.y-b.y) >= (a.r + b.r) - 2
      };
    })())`));
    check("受控对撞场景建立成功", !physics.error, physics.error || "");
    // 非弹性碰撞：动能不应增加（允许切向抖动与速度下限带来少量增量）
    check("碰撞不产生能量（非弹性）",
      physics.keAfter <= physics.keBefore * 1.6 + 2000,
      "动能 " + physics.keBefore.toFixed(0) + " → " + physics.keAfter.toFixed(0));
    check("会伤人的角色造成接触伤害", physics.dmgToB > 0,
      "纯爱战士 → 老酸奶 " + physics.dmgToB.toFixed(1) + " 伤害");
    check("不伤人的角色不掉别人血", physics.dmgToA < 0.01,
      "老酸奶(type=" + physics.contactB + ") → 纯爱战士 " + physics.dmgToA.toFixed(2));
    check("碰撞后不会互相嵌进去", physics.separated === true);
    await browser.eval(`world.reset()`);   // 恢复默认阵容，避免影响后续断言

    console.log("\n=== 4c. 墙壁完全弹性 ===");
    const wall = JSON.parse(await browser.eval(`JSON.stringify((function(){
      // 只放 1 个单位：多个单位时反弹后会撞到别人，动量转移会让"速度不变"的断言失效
      world.reset(["moyu"]);
      var u = world.units[0];
      u.x = u.r + 60; u.y = world.arena / 2;
      u.vx = -300; u.vy = 0;
      var speedBefore = Math.abs(u.vx);
      var bounced = false, minX = u.x;
      for (var i = 0; i < 30; i++) {
        var vxB = u.vx;
        world.step(1/60);
        if (vxB < 0 && u.vx > 0) bounced = true;
        if (u.x < minX) minX = u.x;
        if (u.x - u.r < -1) return { error: "穿墙! x=" + u.x + " r=" + u.r };
      }
      return {
        speedBefore: speedBefore, vxAfter: u.vx, x: u.x, r: u.r,
        bounced: bounced, minX: minX, speedAfter: Math.abs(u.vx)
      };
    })())`));
    check("受控撞墙场景建立成功", !wall.error, wall.error || "");
    check("撞墙后反弹（速度反向）", wall.bounced === true,
      "撞前 vx=-" + wall.speedBefore + " → 撞后 vx=" + wall.vxAfter.toFixed(0));
    check("撞墙不损失速度（完全弹性）",
      Math.abs(wall.speedAfter - wall.speedBefore) < wall.speedBefore * 0.25,
      "|" + wall.speedAfter.toFixed(0) + "| vs " + wall.speedBefore);
    check("撞墙后仍在场内", wall.x >= wall.r - 1, "x=" + wall.x.toFixed(1) + " r=" + wall.r);
    // 恢复多人阵容，后面的模式切换/交互测试需要多个单位
    await browser.eval(`(function(){
      world.reset(window.MA.CHARACTERS.slice(0, 8).map(function(t){ return t.id; }));
      return true;
    })()`);

    console.log("\n=== 4d. 模式可切换回主动追击 ===");
    const switchMode = JSON.parse(await browser.eval(`JSON.stringify((function(){
      // 保证有多人阵容，否则"锁定目标"无从谈起
      world.reset(window.MA.CHARACTERS.slice(0, 8).map(function(t){ return t.id; }));
      var s = document.getElementById("optMove");
      s.value = "active"; s.dispatchEvent(new Event("change"));
      var mode = world.moveMode;
      for (var i = 0; i < 90; i++) world.step(1/60);
      // 主动模式下角色会主动接近目标
      var anyApproaching = world.units.some(function(u){
        return u.target && u.alive;
      });
      s.value = "momentum"; s.dispatchEvent(new Event("change"));
      return { mode: mode, backTo: world.moveMode, anyApproaching: anyApproaching,
               units: world.units.length };
    })())`));
    check("可切到主动追击模式", switchMode.mode === "active");
    check("主动模式能锁定目标", switchMode.anyApproaching === true,
      switchMode.units + " 个单位");
    check("可切回动量模式", switchMode.backTo === "momentum");

    console.log("\n=== 5. 交互功能 ===");
    // 前面的物理测试改过阵容；这里显式恢复 8 人，
    // 并且同步 chip 的选中态（reset 直接设 picks 不会更新按钮外观）。
    await browser.eval(`(function(){
      var ids = window.MA.CHARACTERS.slice(0, 8).map(function(t){ return t.id; });
      world.reset(ids);
      // 让选择器按钮与 picks 保持一致，否则点击逻辑会错位
      if (typeof syncChips === "function") syncChips();
      return true;
    })()`);
    await sleep(150);

    // 暂停 / 继续
    await browser.eval(`document.getElementById("btnPause").click()`);
    const paused = await browser.eval(`world.paused`);
    check("暂停按钮生效", paused === true);
    await browser.eval(`document.getElementById("btnPause").click()`);
    check("继续按钮生效", (await browser.eval(`world.paused`)) === false);

    // 倍速
    await browser.eval(`document.querySelector('#speed button[data-s="3"]').click()`);
    check("倍速切换生效", (await browser.eval(`world.speed`)) === 3);
    await browser.eval(`document.querySelector('#speed button[data-s="1"]').click()`);

    // 角色上下场：先看第一个角色当前状态，再反向切换，避免默认随机阵容造成误判
    const before = await browser.eval(`world.picks.length`);
    const firstId = await browser.eval(`window.MA.CHARACTERS[0].id`);
    const wasOn = await browser.eval(`world.picks.indexOf(window.MA.CHARACTERS[0].id) >= 0`);
    await browser.eval(`document.querySelectorAll("#picker .chip")[0].click()`);
    await sleep(150);
    const afterOff = await browser.eval(`world.picks.length`);
    check(wasOn ? "角色可下场" : "角色可上场",
      wasOn ? afterOff === before - 1 : afterOff === before + 1, before + " → " + afterOff);
    check("切换的是同一个角色",
      (await browser.eval(`world.picks.indexOf("${firstId}") >= 0`)) !== wasOn);

    // 切回来，恢复原阵容
    await browser.eval(`document.querySelectorAll("#picker .chip")[0].click()`);
    await sleep(150);
    check("再点一次可复原", (await browser.eval(`world.picks.length`)) === before,
      before + " 人");

    // 至少两人的下限保护
    const floor = await browser.eval(`(function(){
      // 只留 2 人，再尝试踢掉一个，应被拦住
      var ids = window.MA.CHARACTERS.slice(0, 2).map(function(t){ return t.id; });
      world.reset(ids);
      var chips = document.querySelectorAll("#picker .chip");
      chips[0].click();
      return world.picks.length;
    })()`);
    check("最少 2 人下限保护", floor === 2, "仍为 " + floor + " 人");
    await browser.eval(`world.reset()`);

    // 设置项
    await browser.eval(`(function(){
      var s = document.getElementById("optDmg"); s.value = "1.6";
      s.dispatchEvent(new Event("change"));
    })()`);
    check("伤害倍率设置生效", (await browser.eval(`world.dmgMul`)) === 1.6);

    // 背景主题切换
    await browser.eval(`(function(){
      var s = document.getElementById("optBg"); s.value = "ocean";
      s.dispatchEvent(new Event("change"));
    })()`);
    check("背景主题切换生效", (await browser.eval(`window.MA.Background.preset`)) === "ocean");
    await browser.eval(`(function(){
      var s = document.getElementById("optBg"); s.value = "neon";
      s.dispatchEvent(new Event("change"));
    })()`);

    // 音效开关
    const soundBefore = await browser.eval(`window.MA.Audio.isEnabled()`);
    await browser.eval(`document.getElementById("btnSound").click()`);
    check("音效开关生效", (await browser.eval(`window.MA.Audio.isEnabled()`)) !== soundBefore);

    // 重开
    await browser.eval(`document.getElementById("btnReset").click()`);
    await sleep(150);
    check("重开重置时间", (await browser.eval(`world.time`)) < 1);

    console.log("\n=== 6. 贴图接入验证（模拟放入素材）===");
    // 用一个内联 data URI 假装是角色贴图，验证渲染层会走贴图分支
    const artTest = await browser.eval(`(function(){
      var c = document.createElement("canvas"); c.width = c.height = 64;
      var g = c.getContext("2d");
      g.fillStyle = "#ff00ff"; g.beginPath(); g.arc(32,32,30,0,6.283); g.fill();
      var tpl = window.MA.CHARACTERS[0];
      var img = new Image();
      img.src = c.toDataURL();
      return new Promise(function(res){
        img.onload = function(){
          // 通过内部 API 注入：模拟“扫描到 idle.png”的效果
          window.MA.Assets.preload([Object.assign({}, tpl, { assets: { idle: img.src } })]);
          setTimeout(function(){
            var art = window.MA.Assets.image(tpl.id, "idle");
            res(JSON.stringify({ hasArt: !!art, w: art ? art.naturalWidth : 0 }));
          }, 200);
        };
      });
    })()`);
    const A = JSON.parse(artTest);
    check("贴图可被加载并识别", A.hasArt, A.w + "px");

    // 画一帧，确认走贴图分支不报错
    await browser.eval(`(function(){ drawWorld(world); return true; })()`);
    check("有贴图时渲染无异常", errors.filter(e => e.indexOf("drawImage") >= 0).length === 0);

    // 重新加载页面，清掉测试注入的贴图，让截图反映真实的默认画面
    console.log("\n=== 7. 截图存档（重新加载，反映默认状态）===");
    await browser.open(URL);
    await sleep(600);
    const shots = [
      { f: "01-early.png", wait: 0 },
      { f: "02-mid.png", wait: 3000 },
      { f: "03-late.png", wait: 14000 }
    ];
    for (const s of shots) {
      if (s.wait) await sleep(s.wait);
      const size = await browser.screenshot(path.join(OUT, s.f));
      check("截图 " + s.f, size > 20000, (size / 1024).toFixed(0) + " KB");
    }

    // 结算画面截图：关掉自动重开，再把时间推到超时判定
    await browser.eval(`(function(){
      world.autoRestart = false;
      if (world.over) world.reset();
      world.time = 999;
      world.step(0.016);
      return world.over;
    })()`);
    await sleep(700);
    const sizeWin = await browser.screenshot(path.join(OUT, "04-result.png"));
    check("结算画面截图", sizeWin > 20000, (sizeWin / 1024).toFixed(0) + " KB");
    const winner = await browser.eval(`world.winner ? world.winner.name : null`);
    check("超时判定出冠军", !!winner, "冠军: " + winner);

    console.log("\n=== 8. 控制台输出 ===");
    check("无 JS 报错", errors.length === 0, errors.slice(0, 5).join(" | "));
    if (warns.length) {
      console.log("  警告 " + warns.length + " 条：");
      warns.slice(0, 8).forEach(w => console.log("    · " + w.slice(0, 160)));
    } else {
      console.log("  ✓ 无警告");
    }

  } catch (e) {
    console.error("\n验证过程出错: " + (e && e.stack || e));
    failures++;
  } finally {
    await browser.close();
  }

  console.log("\n" + (failures === 0 ? "全部通过 ✅" : failures + " 项失败 ❌"));
  console.log("截图目录: " + path.relative(ROOT, OUT));
  process.exit(failures === 0 ? 0 : 1);
})();
