/* =========================================================================
 * tools/diag-speed.js —— 后期「速度消失 / 决胜很墨迹」的量化诊断
 *
 * 用户观察：很多情况下角色会变慢，后期决胜时很墨迹。
 * 猜测：大量单位挤在一起碰撞，加上角色死亡，把速度「吃掉」了。
 *
 * 本工具不改任何逻辑，只做逐帧埋点，把下列量按「存活人数」分桶统计：
 *   · 实际速度 avgSpeed       · 巡航速度 avgCruise（目标值）
 *   · 实际/巡航 比值          · 状态倍率 cruiseScale < 1 的比例（被减速/眩晕）
 *   · 拥挤度（互相重叠的对数）
 * 并单独统计「残局」（存活 ≤3）的时长与速度。
 *
 * 用法：node tools/diag-speed.js [局数]
 * ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const ROUNDS = parseInt(process.argv[2] || "20", 10);

const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop() {} });
    if (k in t) return t[k];
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; }
});
const sandbox = {
  console, Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite,
  Image: function () { this.src = ""; },
  Audio: function () { this.play = () => Promise.resolve(); this.addEventListener = () => {}; this.cloneNode = () => new sandbox.Audio(); },
  AudioContext: undefined,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0, setTimeout, clearTimeout, window: null
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.devicePixelRatio = 1; sandbox.innerWidth = 1280; sandbox.innerHeight = 900;
sandbox.addEventListener = () => {};
sandbox.document = { createElement: () => ({ getContext: () => ctxStub, style: {} }), getElementById: () => null };
vm.createContext(sandbox);

for (const f of ["data/config.js", "data/characters.js", "assets/manifest.js",
                 "src/utils.js", "src/assets.js", "src/engine.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
}

const MA = sandbox.MA;
const w = new MA.World({ getContext: () => ctxStub, style: {} });
w.resize(720);

/* ---- 分桶统计：按当前存活人数 ---- */
function blank() {
  return { frames: 0, dt: 0, speedSum: 0, cruiseSum: 0, n: 0,
           slowed: 0, endgameTime: 0, overlaps: 0 };
}
const byAlive = {};                 // aliveCount -> stats
function bucket(k) { return byAlive[k] || (byAlive[k] = blank()); }

const roundStats = [];

/* 时间轴采样（每 5 秒一档，跨局平均） */
const timeline = {};                // secondBucket -> {speedSum, cruiseSum, n, dt, rounds}
function tl(k) { return timeline[k] || (timeline[k] = { speedSum: 0, cruiseSum: 0, n: 0, dt: 0 }); }

const allIds = MA.CHARACTERS.map(t => t.id);
let totalTime = 0, timeouts = 0, endgameTotal = 0;

for (let r = 0; r < ROUNDS; r++) {
  w.picks = allIds;
  w.reset();

  let endgameStart = null;
  let lastTime = 0;
  let steps = 0;

  while (!w.over && steps < 60 * 180) {
    const alive = [];
    for (const u of w.units) if (u.alive) alive.push(u);

    /* 拥挤度：统计互相重叠（含轻微接触）的对数 */
    let overlaps = 0;
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const dx = alive[j].x - alive[i].x, dy = alive[j].y - alive[i].y;
        if (Math.hypot(dx, dy) < alive[i].r + alive[j].r + 6) overlaps++;
      }
    }

    const b = bucket(alive.length);
    const dt = 1 / 60;
    b.frames++; b.dt += dt; b.overlaps += overlaps;

    let sSum = 0, cSum = 0, slowed = 0;
    for (const u of alive) {
      const sp = Math.hypot(u.vx, u.vy);
      sSum += sp; cSum += (u.cruiseSpeed || 0);
      if ((u.cruiseScale || 1) < 0.999) slowed++;
    }
    b.speedSum += sSum; b.cruiseSum += cSum; b.n += alive.length; b.slowed += slowed;

    // 时间轴：按整秒归档
    const tb = tl(Math.floor(w.time / 5) * 5);
    tb.speedSum += sSum; tb.cruiseSum += cSum; tb.n += alive.length; tb.dt += dt;

    if (alive.length <= 3 && endgameStart === null) endgameStart = w.time;

    w.step(dt);
    lastTime = w.time;
    steps++;
  }

  if (!w.over) { timeouts++; w.finish(null, "测试超时"); }
  totalTime += lastTime;
  const eg = endgameStart === null ? 0 : (lastTime - endgameStart);
  endgameTotal += eg;
  roundStats.push({ dur: lastTime, endgame: eg, alive: w.aliveCount() });
}

/* ---------------- 输出 ---------------- */
console.log("=== 速度系统诊断（" + ROUNDS + " 局，20 人，动量模式）===");
console.log("平均时长: " + (totalTime / ROUNDS).toFixed(1) + "s   超时: " + timeouts +
  "   残局(≤3人)平均: " + (endgameTotal / ROUNDS).toFixed(1) + "s");
const durs = roundStats.map(r => r.dur).sort((a, b) => a - b);
console.log("时长分布: 最快 " + durs[0].toFixed(1) + "s  中位 " +
  durs[Math.floor(durs.length / 2)].toFixed(1) + "s  最慢 " + durs[durs.length - 1].toFixed(1) + "s");

console.log("\n=== 按存活人数：实际速度 vs 巡航速度（关键）===");
console.log("存活  占比时间   实际速度  巡航速度  实际/巡航  被减速比例  平均重叠对数");
const keys = Object.keys(byAlive).map(Number).sort((a, b) => b - a);
const totalDt = keys.reduce((s, k) => s + byAlive[k].dt, 0);
for (const k of keys) {
  const b = byAlive[k];
  const sp = b.n ? b.speedSum / b.n : 0;
  const cr = b.n ? b.cruiseSum / b.n : 0;
  const ratio = cr > 0 ? sp / cr : 0;
  const slowedPct = b.n ? (b.slowed / b.n * 100) : 0;
  const ov = b.frames ? (b.overlaps / b.frames) : 0;
  console.log(String(k).padStart(3) + "   " +
    (b.dt / totalDt * 100).toFixed(1).padStart(6) + "%   " +
    sp.toFixed(0).padStart(7) + "   " + cr.toFixed(0).padStart(7) + "   " +
    ratio.toFixed(2).padStart(8) + "   " + slowedPct.toFixed(0).padStart(8) + "%   " +
    ov.toFixed(2).padStart(10));
}

console.log("\n=== 时间轴（每 5 秒）===");
console.log("  时间    实际速度  巡航速度  比值   平均重叠");
const tkeys = Object.keys(timeline).map(Number).sort((a, b) => a - b);
for (const k of tkeys) {
  const t = timeline[k];
  const sp = t.n ? t.speedSum / t.n : 0;
  const cr = t.n ? t.cruiseSum / t.n : 0;
  const ratio = cr > 0 ? sp / cr : 0;
  console.log(String(k).padStart(5) + "s " + sp.toFixed(0).padStart(8) + "  " +
    cr.toFixed(0).padStart(8) + "  " + ratio.toFixed(2).padStart(6));
}

/* ---- 残局明细：最后一局存活单位的速度构成 ---- */
console.log("\n=== 最后一局残局明细（存活单位）===");
for (const u of w.units) {
  if (!u.alive) continue;
  const sp = Math.hypot(u.vx, u.vy);
  console.log("  " + u.name.padEnd(8) + " 实际 " + sp.toFixed(0).padStart(4) +
    "  巡航 " + (u.cruiseSpeed || 0).toFixed(0).padStart(4) +
    "  倍率 " + (u.cruiseScale || 1).toFixed(2) +
    "  slow=" + u.slow.toFixed(1) + " stun=" + u.stun.toFixed(1) +
    " rage=" + u.rage.toFixed(1));
}
