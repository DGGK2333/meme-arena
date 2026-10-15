/* =========================================================================
 * tools/verify-speed.js —— 速度系统回归测试
 *
 * 背景：用户反馈"很多情况下角色速度会变慢，后期决胜很墨迹"。
 * 诊断（tools/diag-cruise.js / diag-endgame.js）定位到两个真实缺陷 + 一个节奏问题：
 *
 *   1. refreshCruise 号称"只升不降"，实际留了个 3% 向下修正的分支，
 *      反复低速撞墙会把巡航基准一路拖下去（棘轮式衰减）。
 *   2. 分身（isClone）没继承巡航速度，退回到全局 minSpeed，
 *      只有本体一半左右的基准，残局里等于拖着不走。
 *   3. 残局双方只是"不碰面"（1v1 期间贴在一起的时间占 0%），
 *      所以加了残局提速 + 加速缩圈。
 *
 * 本测试把这三条都钉住。用法：node tools/verify-speed.js
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
    await sleep(1100);

    console.log("=== 1. 巡航模型与残局配置就位 ===");
    const mod = JSON.parse(await browser.eval(`JSON.stringify({
      cruise: window.MA.CONFIG.movement.cruise,
      endgameBoost: window.MA.CONFIG.movement.cruise.endgameBoost,
      endgameShrink: window.MA.CONFIG.arena.endgameShrink,
      hasApplyCruise: typeof world.applyCruise === "function",
      hasRefreshCruise: typeof world.refreshCruise === "function",
      hasEndgameMul: typeof world.endgameMul === "function",
      hasEndgameShrinkMul: typeof world.endgameShrinkMul === "function"
    })`));
    check("巡航配置存在", !!mod.cruise);
    check("applyCruise / refreshCruise 存在", mod.hasApplyCruise && mod.hasRefreshCruise);
    check("残局提速开关存在", !!mod.endgameBoost, JSON.stringify(mod.endgameBoost));
    check("残局缩圈开关存在", !!mod.endgameShrink, JSON.stringify(mod.endgameShrink));
    check("endgameMul / endgameShrinkMul 方法存在", mod.hasEndgameMul && mod.hasEndgameShrinkMul);

    console.log("\n=== 2. refreshCruise 真的「只升不降」（棘轮回归）===");
    const ratchet = JSON.parse(await browser.eval(`JSON.stringify((function(){
      world.reset(["moyu"]);
      var u = world.units[0];
      u.cruiseSpeed = 500;
      var trace = [];
      // 反复模拟"低速撞墙"：速度 200 < 基准 500
      for (var i = 0; i < 60; i++) {
        u.vx = 200; u.vy = 0;
        world.refreshCruise(u);
        if (i === 0 || i === 29 || i === 59) trace.push(+u.cruiseSpeed.toFixed(2));
      }
      var afterLow = u.cruiseSpeed;
      // 再来一次高速撞墙：应该能往上提
      u.vx = 900; u.vy = 0;
      world.refreshCruise(u);
      var afterHigh = u.cruiseSpeed;
      return { trace: trace, afterLow: +afterLow.toFixed(2), afterHigh: +afterHigh.toFixed(2) };
    })())`));
    console.log("    低速撞墙 60 次的巡航基准: " + ratchet.trace.join(" → "));
    check("低速撞墙不会把巡航基准拖低", ratchet.afterLow >= 500,
      "500 → " + ratchet.afterLow + "（修复前会掉到 ~270）");
    check("高速撞墙仍能提升巡航基准", ratchet.afterHigh > ratchet.afterLow,
      ratchet.afterLow + " → " + ratchet.afterHigh);

    console.log("\n=== 3. 单单位纯撞墙 60 秒：实际速度不衰减 ===");
    const longRun = JSON.parse(await browser.eval(`JSON.stringify((function(){
      window.MA.CONFIG.arena.zoneEnabled = false;
      world.autoRestart = false;
      world.reset(["moyu"]);
      world.picks = ["moyu"];
      world.shrink = 0;
      var u = world.units[0];
      u.cruiseSpeed = 380; u.cruiseScale = 1;
      u.vx = 380; u.vy = 0;
      u.x = 100; u.y = world.arena / 2;
      var samples = [];
      for (var s = 0; s < 60; s++) {
        for (var k = 0; k < 60; k++) world.step(1/60);
        if (s % 15 === 14) samples.push({ t: s + 1,
          sp: +Math.hypot(u.vx, u.vy).toFixed(0),
          cruise: +u.cruiseSpeed.toFixed(0) });
      }
      return { samples: samples };
    })())`));
    console.log("    时间/实际速度/巡航基准: " +
      longRun.samples.map(s => s.t + "s:" + s.sp + "/" + s.cruise).join("  "));
    const firstSp = longRun.samples[0].sp;
    const lastSp = longRun.samples[longRun.samples.length - 1].sp;
    check("60 秒后实际速度没有衰减", lastSp > firstSp * 0.9,
      firstSp + " → " + lastSp);

    console.log("\n=== 4. 分身继承本体的巡航速度 ===");
    const cloneTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      // kelong（摸鱼大师兄）才有"分身术"技能
      world.reset(["kelong", "moyu"]);
      var owner = world.units.filter(function(u){ return u.tpl.id === "kelong"; })[0];
      owner.cruiseSpeed = 400;
      var before = world.units.length;
      owner.tpl.skill(owner, world);
      var clones = world.units.filter(function(o){ return o.isClone; });
      var out = { owner: owner.cruiseSpeed, clones: clones.length,
                  cloneSpeeds: clones.map(function(c){ return c.cruiseSpeed; }),
                  added: world.units.length - before };
      // 兜底路径：不走技能，直接 makeUnit 造分身
      var direct = world.makeUnit(owner.tpl, { x: 100, y: 100, isClone: true, life: 8 });
      out.fallback = direct.cruiseSpeed;
      out.minCruise = world.cfg.movement.cruise.minCruise;
      out.minSpeed = world.cfg.movement.minSpeed;
      return out;
    })())`));
    console.log("    本体巡航 " + cloneTest.owner + "，分身 " + JSON.stringify(cloneTest.cloneSpeeds) +
      "，兜底路径 " + cloneTest.fallback);
    check("技能确实生成了分身", cloneTest.clones > 0, cloneTest.clones + " 个");
    check("技能生成的分身继承了本体巡航速度",
      cloneTest.clones > 0 && cloneTest.cloneSpeeds.every(s => s === cloneTest.owner),
      "本体 " + cloneTest.owner + " / 分身 " + JSON.stringify(cloneTest.cloneSpeeds));
    check("兜底路径的分身也不低于 minCruise（不是退回到 minSpeed）",
      cloneTest.fallback >= cloneTest.minCruise && cloneTest.fallback > 0,
      "兜底 " + cloneTest.fallback + "（minCruise=" + cloneTest.minCruise +
      " minSpeed=" + cloneTest.minSpeed + "）");

    console.log("\n=== 5. 残局提速倍率按存活人数生效 ===");
    const tiers = JSON.parse(await browser.eval(`JSON.stringify((function(){
      // 大场（20 人）才会启用残局提速
      world.reset(window.MA.CHARACTERS.map(function(t){ return t.id; }));
      function mulFor(n){
        world.units.forEach(function(u, i){ u.alive = i < n; });
        return world.endgameMul();
      }
      var out = { fieldSize: world.fieldSize, m8: mulFor(8), m5: mulFor(5),
                  m3: mulFor(3), m2: mulFor(2), m1: mulFor(1) };
      // 关掉后应恒为 1
      world.cfg.movement.cruise.endgameBoost.enabled = false;
      world.units.forEach(function(u, i){ u.alive = i < 2; });
      out.disabled = world.endgameMul();
      world.cfg.movement.cruise.endgameBoost.enabled = true;
      world.units.forEach(function(u){ u.alive = true; });
      return out;
    })())`));
    console.log("    倍率（开局 " + tiers.fieldSize + " 人）: 8人=" + tiers.m8 + " 5人=" + tiers.m5 +
      " 3人=" + tiers.m3 + " 2人=" + tiers.m2 + " 1人=" + tiers.m1 + " 关闭=" + tiers.disabled);
    check("人多时不提速", tiers.m8 === 1, String(tiers.m8));
    check("残局提速随存活减少而增大",
      tiers.m5 > 1 && tiers.m3 > tiers.m5 && tiers.m2 >= tiers.m3,
      "5人 " + tiers.m5 + " → 3人 " + tiers.m3 + " → 2人 " + tiers.m2);
    check("关闭开关后倍率恒为 1", tiers.disabled === 1, String(tiers.disabled));

    console.log("\n=== 5b. 小场保护：2~5 人局不该被当成残局 ===");
    // 否则 2 人局从第一帧起就命中 maxAlive:2 档位，整局被加速 2 倍，
    // 会破坏"撞墙完全弹性 / 碰撞不产生能量"这些物理不变量。
    const small = JSON.parse(await browser.eval(`JSON.stringify((function(){
      function probe(ids){
        world.reset(ids);
        var out = { fieldSize: world.fieldSize, alive: world.aliveCount(),
                    boost: world.endgameMul(), shrink: world.endgameShrinkMul() };
        return out;
      }
      var two = probe(["chuanjian", "suannai"]);
      var one = probe(["moyu"]);
      var five = probe(window.MA.CHARACTERS.slice(0, 5).map(function(t){ return t.id; }));
      var six = probe(window.MA.CHARACTERS.slice(0, 6).map(function(t){ return t.id; }));
      return { two: two, one: one, five: five, six: six,
               minField: window.MA.CONFIG.movement.cruise.endgameBoost.minField };
    })())`));
    console.log("    2人局: 提速=" + small.two.boost + " 缩圈=" + small.two.shrink +
      "   1人局: 提速=" + small.one.boost +
      "   5人局: 提速=" + small.five.boost +
      "   6人局(仅剩2人时): 提速=" + small.six.boost);
    check("2 人局不启用残局提速", small.two.boost === 1, String(small.two.boost));
    check("2 人局不启用加速缩圈", small.two.shrink === 1, String(small.two.shrink));
    check("单人局不启用残局提速", small.one.boost === 1, String(small.one.boost));
    check("5 人局不启用残局提速（低于 minField=" + small.minField + "）",
      small.five.boost === 1, String(small.five.boost));
    check("6 人局开局时不提速（还没到残局）", small.six.boost === 1, String(small.six.boost));

    console.log("\n=== 6. 残局加速缩圈生效，且不改变圈的最小半径 ===");
    const shrink = JSON.parse(await browser.eval(`JSON.stringify((function(){
      window.MA.CONFIG.arena.zoneEnabled = true;
      world.reset(["moyu","kunkun","hajimi","creeper","saibo","fanqie","yyds","tiangou"]);
      world.shrink = 1;
      world.time = 20;
      function run(keep){
        world.units.forEach(function(u, i){ u.alive = i < keep; });
        world.softR = world.arena * 0.92;      // 复位再跑
        world.time = 20;
        world.step(1/60);
        return +world.softR.toFixed(2);
      }
      var many = run(8);
      var few = run(2);
      // 关掉后 2 人时应与 8 人一致
      world.cfg.arena.endgameShrink.enabled = false;
      var fewOff = run(2);
      world.cfg.arena.endgameShrink.enabled = true;
      // 下限保护：把时间推到很远，softR 不应低于 safeZoneMin
      world.units.forEach(function(u, i){ u.alive = i < 2; });
      world.time = 999;
      world.softR = world.arena * 0.92;
      world.step(1/60);
      var floorR = +world.softR.toFixed(2);
      var minR = +(world.arena * window.MA.CONFIG.arena.safeZoneMin).toFixed(2);
      world.units.forEach(function(u){ u.alive = true; });
      return { many: many, few: few, fewOff: fewOff, floorR: floorR, minR: minR };
    })())`));
    console.log("    softR: 8人=" + shrink.many + "  2人=" + shrink.few +
      "  2人(关闭)=" + shrink.fewOff + "  下限=" + shrink.floorR + " (min=" + shrink.minR + ")");
    check("残局（2人）圈收得比人多时更快", shrink.few < shrink.many,
      "8人 " + shrink.many + " → 2人 " + shrink.few);
    check("关闭开关后 2 人与 8 人一致", Math.abs(shrink.fewOff - shrink.many) < 0.01,
      shrink.fewOff + " vs " + shrink.many);
    check("圈不会小于 safeZoneMin 下限", shrink.floorR >= shrink.minR - 0.01,
      shrink.floorR + " >= " + shrink.minR);

    console.log("\n=== 7. 整局跑完不报错，且速度不塌 ===");
    const sim = JSON.parse(await browser.eval(`JSON.stringify((function(){
      window.MA.CONFIG.arena.zoneEnabled = true;
      window.MA.CONFIG.movement.cruise.endgameBoost.enabled = true;
      window.MA.CONFIG.arena.endgameShrink.enabled = true;
      world.autoRestart = false;
      var rounds = 6, times = [], lateSpeedRatios = [];
      for (var r = 0; r < rounds; r++) {
        world.picks = window.MA.CHARACTERS.map(function(t){ return t.id; });
        world.reset();
        var steps = 0;
        var speedSamples = [];
        while (!world.over && steps < 60 * 200) {
          world.step(1/60);
          steps++;
          // 每 0.5 秒采一次：整局可能只有 6~15 秒，采太稀就凑不出前后两段
          if (steps % 30 === 0) {
            var s = 0, n = 0;
            for (var i = 0; i < world.units.length; i++) {
              var u = world.units[i];
              if (!u.alive) continue;
              s += Math.hypot(u.vx, u.vy); n++;
            }
            speedSamples.push({ sp: n ? s/n : 0 });
          }
        }
        times.push(+world.time.toFixed(1));
        // 后半段平均速度 / 前半段平均速度
        if (speedSamples.length >= 4) {
          var half = Math.floor(speedSamples.length / 2);
          var early = speedSamples.slice(0, half).reduce(function(a,b){ return a+b.sp; },0) / Math.max(1,half);
          var late = speedSamples.slice(half).reduce(function(a,b){ return a+b.sp; },0) / Math.max(1, speedSamples.length-half);
          lateSpeedRatios.push(+(late / Math.max(1, early)).toFixed(2));
        }
      }
      return { times: times, ratios: lateSpeedRatios };
    })())`));
    console.log("    各局时长: " + sim.times.join(", ") + "s");
    console.log("    后半段/前半段速度比: " + sim.ratios.join(", "));
    check("6 局都能跑完（无超时）", sim.times.every(t => t > 0 && t < 200), JSON.stringify(sim.times));
    check("后半段速度没有塌掉（比值 > 0.6）",
      sim.ratios.length > 0 && sim.ratios.every(r => r > 0.6),
      JSON.stringify(sim.ratios));

    console.log("\n=== 8. 无报错 ===");
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
