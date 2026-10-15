/* =========================================================================
 * tools/diag-cruise.js —— 巡航速度基准本身会不会「悄悄衰减」？
 *
 * 可控实验（排除"后期剩下的恰好是慢角色"这个混淆）：
 *   1. 单个单位、关掉安全区与技能影响，只让它撞墙弹跳，看 cruiseSpeed 走向
 *   2. 检查 refreshCruise 的「向下修正」分支是否形成棘轮式衰减
 *   3. 检查克隆体（isClone）的巡航速度基准
 * 用法：node tools/diag-cruise.js
 * ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

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

console.log("=== 1. 单单位纯撞墙：巡航基准会不会衰减？ ===");
console.log("（关掉安全区，只留 1 人，禁用技能以避免干扰）");
w.cfg.arena.zoneEnabled = false;
w.autoRestart = false;
w.reset(["moyu"]);
w.picks = ["moyu"];
var u = w.units[0];
// 移除技能影响：把冷却设得极大
u.tpl = Object.assign({}, u.tpl, { cooldown: 1e9 });
u.cruiseSpeed = 380; u.cruiseScale = 1;
u.vx = 380; u.vy = 0;
u.x = 100; u.y = 360;

let log = [];
for (let s = 0; s < 120; s++) {
  for (let k = 0; k < 60; k++) w.step(1 / 60);
  if (s % 10 === 9) log.push({ t: s + 1, cruise: +(u.cruiseSpeed).toFixed(1),
    sp: +Math.hypot(u.vx, u.vy).toFixed(1), minSpeed: w.cfg.movement.minSpeed });
}
console.log("  时间   巡航基准   实际速度");
for (const l of log) console.log("  " + String(l.t).padStart(3) + "s " +
  String(l.cruise).padStart(9) + " " + String(l.sp).padStart(10));

console.log("\n=== 2. refreshCruise 的向下分支是否形成棘轮？ ===");
// 直接反复调用 refreshCruise，模拟"低速撞墙"多次
w.reset(["moyu"]);
u = w.units[0];
u.cruiseSpeed = 500;
const trace = [];
for (let i = 0; i < 40; i++) {
  // 模拟一次低速碰墙：速度 200，触发 refreshCruise
  u.vx = 200; u.vy = 0;
  w.refreshCruise(u);
  if (i % 8 === 0 || i === 39) trace.push({ i: i + 1, cruise: +u.cruiseSpeed.toFixed(1) });
}
console.log("  反复「低速(200)撞墙」40 次后的巡航基准：");
console.log("  " + trace.map(t => "#" + t.i + "=" + t.cruise).join("  "));
console.log("  → 若持续下降，说明存在棘轮式衰减（与注释「只升不降」不符）");

console.log("\n=== 3. 克隆体的巡航基准 ===");
w.reset(["moyu", "kunkun"]);
const tpl = MA.getCharacter("moyu");
const clone = w.makeUnit(tpl, { x: 200, y: 200, isClone: true, life: 8 });
console.log("  克隆体 cruiseSpeed = " + clone.cruiseSpeed +
  "   （正常单位 = " + w.units[0].cruiseSpeed.toFixed(0) + "）");
console.log("  applyCruise 会退回到 minSpeed = " + w.cfg.movement.minSpeed +
  "，即克隆体最多只有正常单位的 " +
  (w.cfg.movement.minSpeed / w.units[0].cruiseSpeed * 100).toFixed(0) + "% 速度基准");

console.log("\n=== 4. 目标速度的组成 ===");
const mv = w.cfg.movement;
console.log("  minSpeed=" + mv.minSpeed + "  maxSpeed=" + mv.maxSpeed +
  "  cruise.minCruise=" + mv.cruise.minCruise + "  cruise.maxCruise=" + mv.cruise.maxCruise);
console.log("  注意：applyCruise 的 target 会被 clamp 到 [minCruise, maxCruise]");
console.log("        refreshCruise 的 candidate = sp × " + mv.cruise.refreshOnBounce);
