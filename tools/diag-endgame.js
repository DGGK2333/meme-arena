/* =========================================================================
 * tools/diag-endgame.js —— 残局（1v1）为什么这么墨迹？
 *
 * diag-speed.js 已显示：残局(≤3人)占了整局约 61% 的时间，
 * 其中「只剩 2 人」独占约 50%。本工具专门解剖这段：
 *   · 1v1 阶段持续多久
 *   · 这段时间里发生了几次有效伤害碰撞、间隔多久
 *   · 两人的速度水平、以及「互相靠近」的时间占比
 *   · 伤害到底靠什么产生（碰撞 / 技能 / 毒圈）
 * 用法：node tools/diag-endgame.js [局数]
 * ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const ROUNDS = parseInt(process.argv[2] || "25", 10);

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

/* 统计 1v1 阶段 */
let e2 = { rounds: 0, time: 0, hits: 0, dmg: 0, speedSum: 0, n: 0,
           nearSum: 0, cruiseSum: 0, gapSum: 0, lastHitT: null };
let e3 = { rounds: 0, time: 0 };
let skillDmg2 = 0, contactDmg2 = 0, poisonDmg2 = 0;

/* 包装：区分伤害来源 */
let inContact = false;
const origApply = w.applyContactDamage.bind(w);
w.applyContactDamage = function (src, tgt, scale, nx, ny, cc) {
  inContact = true;
  const before = tgt.hp;
  origApply(src, tgt, scale, nx, ny, cc);
  if (w.aliveCount() === 2) contactDmg2 += Math.max(0, before - Math.max(0, tgt.hp));
  inContact = false;
};
const origDamage = w.damage.bind(w);
w.damage = function (src, tgt, amount, o) {
  const before = tgt.hp;
  const r = origDamage(src, tgt, amount, o);
  const real = Math.max(0, before - Math.max(0, tgt.hp));
  if (!inContact && w.aliveCount() === 2) {
    if (src) skillDmg2 += real; else poisonDmg2 += real;
  }
  return r;
};

const allIds = MA.CHARACTERS.map(t => t.id);
let totalTime = 0, timeouts = 0;

for (let r = 0; r < ROUNDS; r++) {
  w.picks = allIds;
  w.reset();
  let steps = 0;
  let prevAlive = w.aliveCount();
  let in1v1 = false, t1v1Start = 0, hpAtStart = 0;
  let lastHit = null, hitCount = 0;

  while (!w.over && steps < 60 * 180) {
    const alive = w.units.filter(u => u.alive);
    const n = alive.length;

    // 进入 1v1
    if (n === 2 && !in1v1) {
      in1v1 = true; t1v1Start = w.time;
      hpAtStart = alive.reduce((s, u) => s + u.hp, 0);
      lastHit = w.time;
      e2.rounds++;
    }
    if (in1v1 && n === 2) {
      const dt = 1 / 60;
      e2.time += dt;
      let sSum = 0, cSum = 0, near = 0;
      for (const u of alive) {
        sSum += Math.hypot(u.vx, u.vy);
        cSum += (u.cruiseSpeed || 0);
      }
      const dist = Math.hypot(alive[0].x - alive[1].x, alive[0].y - alive[1].y);
      // 「靠近」= 距离小于两人半径和 + 40
      if (dist < alive[0].r + alive[1].r + 40) near = 1;
      e2.speedSum += sSum; e2.cruiseSum += cSum; e2.n += 2; e2.nearSum += near;
      if (lastHit !== null) { e2.gapSum += (w.time - lastHit); lastHit = w.time; }
    }
    // 记录 1v1 期间的有效伤害碰撞
    const beforeHp = alive.reduce((s, u) => s + u.hp, 0);
    const beforeHits = w.__hits || 0;

    w.step(1 / 60);

    if (in1v1) {
      const afterAlive = w.units.filter(u => u.alive);
      if (afterAlive.length === 2) {
        const afterHp = afterAlive.reduce((s, u) => s + u.hp, 0);
        if (afterHp < beforeHp - 0.5) { hitCount++; e2.hits++; e2.dmg += (beforeHp - afterHp); }
      }
    }
    if (w.aliveCount() < 2) in1v1 = false;
    steps++;
  }

  if (!w.over) { timeouts++; w.finish(null, "测试超时"); }
  totalTime += w.time;
}

console.log("=== 残局解剖（" + ROUNDS + " 局）===");
console.log("平均整局时长: " + (totalTime / ROUNDS).toFixed(1) + "s   超时: " + timeouts);
console.log("进入 1v1 的局数: " + e2.rounds + "/" + ROUNDS);
if (e2.rounds) {
  const t = e2.time / e2.rounds;
  console.log("\n1v1 平均持续: " + t.toFixed(1) + "s   （占整局 " +
    (e2.time / totalTime * 100).toFixed(0) + "%）");
  console.log("1v1 平均有效伤害事件: " + (e2.hits / e2.rounds).toFixed(1) + " 次");
  console.log("  平均两次伤害间隔: " + (e2.hits ? (e2.time / e2.hits).toFixed(2) : "-") + "s");
  console.log("  每秒伤害事件: " + (e2.time ? (e2.hits / e2.time).toFixed(2) : "-") + " 次/s");
  console.log("1v1 平均速度: " + (e2.n ? e2.speedSum / e2.n : 0).toFixed(0) +
    "   巡航: " + (e2.n ? e2.cruiseSum / e2.n : 0).toFixed(0));
  console.log("两人「靠近」时间占比: " + (e2.nearSum / e2.n * 100).toFixed(1) + "%");
  console.log("1v1 总伤害来源: 接触 " + contactDmg2.toFixed(0) +
    "  技能 " + skillDmg2.toFixed(0) + "  毒圈 " + poisonDmg2.toFixed(0));
}
