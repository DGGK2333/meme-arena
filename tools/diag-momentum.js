/* 诊断动量模式的节奏瓶颈：统计碰撞次数、冲击速度分布、各伤害来源占比 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const ROUNDS = parseInt(process.argv[2] || "12", 10);

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

for (const f of ["data/config.js", "data/characters.js", "assets/manifest.js", "src/utils.js", "src/assets.js", "src/engine.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
}

const MA = sandbox.MA;
const w = new MA.World({ getContext: () => ctxStub, style: {} });
w.resize(720);

// 统计探针
let impacts = 0, impactSum = 0, impactMax = 0;
const impactBuckets = { "<80": 0, "80-160": 0, "160-300": 0, "300-500": 0, ">500": 0 };
let contactDmg = 0, skillDmg = 0, poisonDmg = 0, otherDmg = 0;

// 毒圈/流血等直接扣血不走 damage()，单独用逐帧血量差统计
const prevHp = new Map();
const origStep = w.step.bind(w);
w.step = function (dt) {
  // 记录本帧开始时各单位的血量与位置
  for (const u of w.units) prevHp.set(u.uid, u.hp);
  const beforePoison = new Map();
  for (const u of w.units) beforePoison.set(u.uid, u.poison);
  origStep(dt);
  // 统计本帧毒圈造成的掉血（圈外）
  for (const u of w.units) {
    const prev = prevHp.get(u.uid);
    if (prev === undefined) continue;
    if (u.poison > 0 && u.hp < prev) {
      // 这一帧里既有毒圈也有其他伤害，毒圈部分单独估算
      const ac = w.cfg.arena;
      const rate = (ac.poisonBase + w.time * ac.poisonRamp) * w.dmgMul * dt;
      poisonDmg += Math.min(rate, prev - Math.max(0, u.hp));
    }
  }
};

const origResolve = w.resolveContact.bind(w);
w.resolveContact = function (a, b, speed, nx, ny) {
  if (speed >= w.cfg.movement.contact.minImpactSpeed) {
    impacts++; impactSum += speed; impactMax = Math.max(impactMax, speed);
    if (speed < 80) impactBuckets["<80"]++;
    else if (speed < 160) impactBuckets["80-160"]++;
    else if (speed < 300) impactBuckets["160-300"]++;
    else if (speed < 500) impactBuckets["300-500"]++;
    else impactBuckets[">500"]++;
  }
  return origResolve(a, b, speed, nx, ny);
};
// 单独跟踪接触伤害（在 applyContactDamage 内部，绕过 damage 包装）
const origApply = w.applyContactDamage.bind(w);
w.applyContactDamage = function (src, tgt, scale, nx, ny, cc) {
  const before = tgt.hp;
  origApply(src, tgt, scale, nx, ny, cc);
  contactDmg += Math.max(0, before - Math.max(0, tgt.hp));
};
// 技能伤害：走 damage() 且 src 非空，但要排除接触伤害（接触时 kx=0 且在同一调用栈）
let inContact = false;
const origApplyInner = w.applyContactDamage;
w.applyContactDamage = function (src, tgt, scale, nx, ny, cc) {
  inContact = true;
  const before = tgt.hp;
  origApplyInner(src, tgt, scale, nx, ny, cc);
  contactDmg += Math.max(0, before - Math.max(0, tgt.hp));
  inContact = false;
};
const origDamage = w.damage.bind(w);
w.damage = function (src, tgt, amount, o) {
  const before = tgt.hp;
  const r = origDamage(src, tgt, amount, o);
  const real = Math.max(0, before - Math.max(0, tgt.hp));
  if (!inContact) {
    if (src) skillDmg += real;
    else otherDmg += real;
  }
  return r;
};

const allIds = MA.CHARACTERS.map(t => t.id);
let totalTime = 0, timeouts = 0;
const t0 = Date.now();

for (let i = 0; i < ROUNDS; i++) {
  w.picks = allIds;
  w.reset();
  let steps = 0;
  while (!w.over && steps < 60 * 120) { w.step(1 / 60); steps++; }
  if (!w.over) { timeouts++; w.finish(null, "测试超时"); }
  totalTime += w.time;
}
const ms = Date.now() - t0;

console.log("=== 动量模式节奏诊断（" + ROUNDS + " 局，20 人）===");
console.log("平均时长: " + (totalTime / ROUNDS).toFixed(1) + "s   超时: " + timeouts);
console.log("耗时: " + ms + "ms\n");

const perRound = ROUNDS;
console.log("碰撞事件: " + (impacts / perRound).toFixed(1) + " 次/局");
console.log("平均冲击速度: " + (impacts ? (impactSum / impacts).toFixed(0) : 0) + " px/s   峰值: " + impactMax.toFixed(0));
console.log("冲击速度分布:");
for (const [k, v] of Object.entries(impactBuckets)) {
  const pct = impacts ? (v / impacts * 100) : 0;
  console.log("  " + k.padEnd(10) + String(v).padStart(5) + "  " + pct.toFixed(1) + "%  " + "█".repeat(Math.round(pct / 3)));
}

console.log("\n伤害来源占比（每局平均）:");
const total = contactDmg + skillDmg + poisonDmg + otherDmg;
const rows = [
  ["接触伤害", contactDmg],
  ["技能伤害", skillDmg],
  ["毒圈伤害", poisonDmg],
  ["其他伤害", otherDmg]
];
for (const [name, v] of rows) {
  const avg = v / perRound;
  const pct = total ? (v / total * 100) : 0;
  console.log("  " + name + ": " + avg.toFixed(0).padStart(6) + "  " + pct.toFixed(1).padStart(5) + "%  " + "█".repeat(Math.round(pct / 3)));
}
console.log("  合计: " + (total / perRound).toFixed(0) + " /局");
