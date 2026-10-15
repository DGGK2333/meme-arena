/* =========================================================================
 * tools/verify-projectile.js —— 投射物技能验证（爱坤的"扔球"）
 *
 * 需求（用户原话）：
 *   "角色释放技能也就是投出 skill.webp，碰到人造成伤害，
 *    若没有则反弹，直到撞到人，不会对自己造成伤害。"
 *
 * 对应断言：
 *   1. ikun 的 idle / skill / sfx 素材都识别到了（且 skill 是动图贴图）
 *   2. 投出的投射物带着贴图、会移动
 *   3. 撞墙会反弹（bounce），并且一直在场内
 *   4. 会伤害敌人
 *   5. 绝不会伤害自己
 *   6. 也不会伤害自己召唤的分身（互相都不打）
 *   7. 没设 bounce 的投射物保持旧行为：出界即消失
 *
 * 用法：node tools/verify-projectile.js
 * ========================================================================= */
"use strict";

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
  const reaped = reapStaleProcesses();
  if (reaped) console.log("已清理 " + reaped + " 个残留测试进程\n");

  const browser = new Browser();
  const errors = [];

  try {
    await browser.launch({ url: "about:blank", width: 1400, height: 900 });
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

    console.log("=== 1. 爱坤的素材已就位 ===");
    const art = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var A = window.MA.Assets, id = "ikun";
      var idle = A.image(id, "idle"), skill = A.image(id, "skill");
      return {
        hasChar: window.MA.CHARACTERS.some(function(t){ return t.id === id; }),
        hasArt: A.hasArt(id),
        idle: idle ? { w: idle.naturalWidth, h: idle.naturalHeight, gif: /\\.(gif|webp)$/i.test(idle.src) } : null,
        skill: skill ? { w: skill.naturalWidth, h: skill.naturalHeight, gif: /\\.(gif|webp)$/i.test(skill.src) } : null,
        // 动图当作单张图加载（浏览器原生播放），所以不是"序列帧"
        skillIsSeq: A.isSequence(id, "skill"),
        stats: A.stats()
      };
    })())`));
    check("characters.js 里有 ikun", art.hasChar);
    check("爱坤有自定义贴图", art.hasArt === true);
    check("idle 贴图已加载", !!art.idle, art.idle ? art.idle.w + "×" + art.idle.h : "缺失");
    check("skill 贴图已加载", !!art.skill, art.skill ? art.skill.w + "×" + art.skill.h : "缺失");
    check("skill 是动图（webp/gif，原生播放）", !!art.skill && art.skill.gif === true);
    check("动图不被当成序列帧", art.skillIsSeq === false);
    check("没有素材加载失败", art.stats.failed === 0, "failed=" + art.stats.failed);
    check("音效已加载", art.stats.sounds >= 1, art.stats.sounds + " 个");

    console.log("\n=== 2. 技能真的投出一个带贴图的投射物 ===");
    const thrown = JSON.parse(await browser.eval(`JSON.stringify((function(){
      world.reset(["ikun", "moyu"]);
      world.projectiles.length = 0;
      var u = world.units.filter(function(o){ return o.tpl.id === "ikun"; })[0];
      u.x = world.arena * 0.3; u.y = world.arena * 0.5;
      u.vx = 400; u.vy = 0;          // 朝右运动 → 球往右扔
      u.tpl.skill(u, world);
      var p = world.projectiles[0];
      if (!p) return { none: true };
      return {
        count: world.projectiles.length,
        hasImg: !!p.img,
        hasBounce: p.bounce === Infinity,
        vx: +p.vx.toFixed(0), vy: +p.vy.toFixed(0),
        dmg: +p.dmg.toFixed(1),
        r: p.r
      };
    })())`));
    check("技能产生了投射物", !thrown.none && thrown.count === 1, JSON.stringify(thrown));
    check("投射物带贴图", thrown.hasImg === true);
    check("投射物设了反弹（Infinity）", thrown.hasBounce === true);
    check("投射物朝角色运动方向飞出", thrown.vx > 0, "vx=" + thrown.vx + " vy=" + thrown.vy);

    console.log("\n=== 3. 撞墙反弹，且始终留在场内 ===");
    const bounce = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var saved = world.units;
      world.units = [];                 // 场上没人，只看墙的反弹
      world.projectiles.length = 0;
      var bounces = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, escaped = 0;
      world.projectiles.push({
        x: 100, y: 100, vx: 620, vy: 430, r: 10, dmg: 10, life: 20,
        owner: null, color: "#fff", bounce: Infinity,
        onBounce: function(){ bounces++; }
      });
      var A = world.arena;
      for (var i = 0; i < 600; i++) {
        world.stepProjectiles(1/60);
        var p = world.projectiles[0];
        if (!p) break;
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        if (p.x < -1 || p.y < -1 || p.x > A + 1 || p.y > A + 1) escaped++;
      }
      world.units = saved;
      world.projectiles.length = 0;
      return { bounces: bounces, minX: +minX.toFixed(1), maxX: +maxX.toFixed(1),
               minY: +minY.toFixed(1), maxY: +maxY.toFixed(1), escaped: escaped, A: A };
    })())`));
    console.log("    反弹 " + bounce.bounces + " 次，x∈[" + bounce.minX + "," + bounce.maxX +
      "] y∈[" + bounce.minY + "," + bounce.maxY + "]，擂台 0~" + bounce.A);
    check("屏障反弹发生了（>=2 次）", bounce.bounces >= 2, bounce.bounces + " 次");
    check("投射物没有飞出擂台", bounce.escaped === 0, bounce.escaped + " 次越界");
    check("投射物始终在擂台范围内",
      bounce.minX >= -0.5 && bounce.maxX <= bounce.A + 0.5 &&
      bounce.minY >= -0.5 && bounce.maxY <= bounce.A + 0.5);

    console.log("\n=== 4. 打到人造成伤害 ===");
    const dmgEnemy = JSON.parse(await browser.eval(`JSON.stringify((function(){
      world.reset(["ikun", "moyu"]);
      world.picks = ["ikun", "moyu"];
      world.projectiles.length = 0;
      var ikun = world.units.filter(function(o){ return o.tpl.id === "ikun"; })[0];
      var foe  = world.units.filter(function(o){ return o.tpl.id === "moyu"; })[0];
      foe.hp = foe.stats.hp;
      var hp0 = foe.hp;
      // 直接把球放在敌人旁边，确定性地验证命中结算
      world.projectiles.push({
        x: foe.x - (foe.r + 10), y: foe.y, vx: 420, vy: 0,
        r: 18, dmg: 30, life: 2, owner: ikun, color: "#ffd166"
      });
      world.stepProjectiles(1/60);
      return { hp0: +hp0.toFixed(1), hp1: +foe.hp.toFixed(1),
               aliveAfter: world.projectiles.length };
    })())`));
    check("投射物命中敌人并造成伤害", dmgEnemy.hp1 < dmgEnemy.hp0,
      dmgEnemy.hp0 + " → " + dmgEnemy.hp1);
    check("命中后投射物消失", dmgEnemy.aliveAfter === 0, "剩余 " + dmgEnemy.aliveAfter);

    console.log("\n=== 5. 绝不会伤害自己（核心需求）===");
    const selfDmg = JSON.parse(await browser.eval(`JSON.stringify((function(){
      // 场上只有爱坤一个，且 picks 只有 1 人 → 比赛不会结束
      world.reset(["ikun"]);
      world.picks = ["ikun"];
      var u = world.units[0];
      u.hp = u.stats.hp;
      u.x = world.arena * 0.5; u.y = world.arena * 0.5;
      var hp0 = u.hp;
      var minHp = hp0;
      // 连续放 10 次技能，让一堆球在场内乱弹 8 秒
      for (var cast = 0; cast < 10; cast++) u.tpl.skill(u, world);
      var maxProj = world.projectiles.length;
      for (var i = 0; i < 60 * 8; i++) {
        if (!u.alive) break;
        world.step(1/60);
        minHp = Math.min(minHp, u.hp);
      }
      return { hp0: +hp0.toFixed(1), minHp: +minHp.toFixed(1),
               over: world.over, alive: u.alive, maxProj: maxProj };
    })())`));
    console.log("    自己 hp: " + selfDmg.hp0 + " → 最低 " + selfDmg.minHp +
      "（同时在场 " + selfDmg.maxProj + " 个球）");
    check("自己的血量没有因为自己的球下降", selfDmg.minHp >= selfDmg.hp0 - 0.01,
      selfDmg.hp0 + " → " + selfDmg.minHp);
    check("测试期间角色还活着", selfDmg.alive === true);

    console.log("\n=== 6. 自己召唤的分身与本体互不伤害 ===");
    const cloneSafe = JSON.parse(await browser.eval(`JSON.stringify((function(){
      world.reset(["ikun"]);
      world.picks = ["ikun"];
      var owner = world.units[0];
      owner.x = world.arena*0.3; owner.y = world.arena*0.5;
      owner.hp = owner.stats.hp;
      // 造一个"自己的分身"
      var clone = world.makeUnit(owner.tpl, { x: world.arena*0.7, y: world.arena*0.5,
                                             isClone: true, life: 20 });
      clone.ownerId = owner.uid;
      clone.hp = clone.stats.hp;
      clone.cruiseSpeed = owner.cruiseSpeed;
      world.units.push(clone);
      var ownerHp0 = owner.hp, cloneHp0 = clone.hp;

      // 本体的球贴着分身 → 不该掉血
      world.projectiles.length = 0;
      world.projectiles.push({ x: clone.x - (clone.r + 10), y: clone.y, vx: 420, vy: 0,
        r: 18, dmg: 40, life: 1, owner: owner, color: "#fff" });
      world.stepProjectiles(1/60);
      var cloneHp1 = clone.hp;

      // 分身的球贴着本体 → 本体也不该掉血
      world.projectiles.length = 0;
      world.projectiles.push({ x: owner.x + (owner.r + 10), y: owner.y, vx: -420, vy: 0,
        r: 18, dmg: 40, life: 1, owner: clone, color: "#fff" });
      world.stepProjectiles(1/60);
      var ownerHp1 = owner.hp;

      return { ownerHp0: +ownerHp0.toFixed(1), ownerHp1: +ownerHp1.toFixed(1),
               cloneHp0: +cloneHp0.toFixed(1), cloneHp1: +cloneHp1.toFixed(1) };
    })())`));
    check("本体的球不伤害自己的分身",
      cloneSafe.cloneHp1 >= cloneSafe.cloneHp0 - 0.01,
      cloneSafe.cloneHp0 + " → " + cloneSafe.cloneHp1);
    check("分身的球不伤害自己的本体",
      cloneSafe.ownerHp1 >= cloneSafe.ownerHp0 - 0.01,
      cloneSafe.ownerHp0 + " → " + cloneSafe.ownerHp1);

    console.log("\n=== 7. 旧行为没被改坏：没设 bounce 时出界即消失 ===");
    const legacy = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var saved = world.units;
      world.units = [];
      world.projectiles.length = 0;
      // 不设 bounce，朝右飞（会出界）
      world.projectiles.push({ x: 100, y: 360, vx: 900, vy: 0, r: 10, dmg: 5,
                               life: 20, owner: null, color: "#fff" });
      var frames = 0;
      for (var i = 0; i < 120; i++) {
        world.stepProjectiles(1/60);
        frames++;
        if (!world.projectiles.length) break;
      }
      world.units = saved;
      world.projectiles.length = 0;
      return { framesAlive: frames, gone: world.projectiles.length === 0 };
    })())`));
    check("没设 bounce 的投射物出界后消失", legacy.gone === true,
      "存活 " + legacy.framesAlive + " 帧后消失");

    console.log("\n=== 8. 实战跑一局带爱坤的比赛 ===");
    const match = JSON.parse(await browser.eval(`JSON.stringify((function(){
      world.autoRestart = false;
      world.picks = window.MA.CHARACTERS.map(function(t){ return t.id; });
      world.reset();
      var steps = 0;
      while (!world.over && steps < 60 * 150) { world.step(1/60); steps++; }
      return { over: world.over, time: +world.time.toFixed(1),
               winner: world.winner ? world.winner.name : null,
               skillErrors: world.skillErrors };
    })())`));
    console.log("    时长 " + match.time + "s  冠军 " + (match.winner || "（平局）"));
    check("比赛能正常结束", match.over === true, match.time + "s");
    check("技能没有抛异常", match.skillErrors === 0, "skillErrors=" + match.skillErrors);

    console.log("\n=== 9. 截图（看球在场上飞）===");
    await browser.eval(`(function(){
      world.autoRestart = false;
      world.paused = true;
      window.MA.CONFIG.arena.zoneEnabled = false;
      window.MA.CONFIG.display.unitScale = 2.6;
      window.MA.CONFIG.ui.showNames = false;
      window.MA.CONFIG.camera.followZoom = 1.6;
      // 清掉上一节残留的大字结算提示，否则会叠在截图上
      var ov = document.getElementById("overlay");
      ov.classList.remove("show");
      ov.textContent = "";

      world.reset(["ikun"]);
      world.picks = ["ikun"];
      var u = world.units[0];
      u.x = world.arena*0.42; u.y = world.arena*0.5;
      u.vx = 300; u.vy = 0; u.spawnT = 0;
      world.projectiles.length = 0;
      // 摆几个球，展示投射物贴图
      for (var i = 0; i < 3; i++) {
        world.projectiles.push({
          x: world.arena*0.52 + i*58, y: world.arena*0.5, vx: 300, vy: 0,
          r: 18, dmg: 20, life: 999, owner: u, color: "#ffd166", spin: 0,
          img: window.MA.Assets.image("ikun","skill"), drawSize: 46, bounce: Infinity
        });
      }
      world.setCameraMode("global");
      world.cam.zoom = 1;
      drawWorld(world);
      return true;
    })()`);
    await sleep(600);
    const shot = await browser.screenshot(path.join(OUT, "projectile-ikun.png"));
    check("投射物截图", shot > 20000, (shot / 1024).toFixed(0) + " KB");

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
