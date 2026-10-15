/* =========================================================================
 * tools/sim-test.js —— 无头仿真回归测试
 * 不启动浏览器，直接在 Node 里跑战斗模拟，验证：
 *   1. 角色数据合法（字段齐全、id 唯一）
 *   2. 每局都能正常分出胜负，不会卡死 / 超时
 *   3. 坐标、血量不出现 NaN，单位不越界
 *   4. 技能函数不抛异常
 * 用法：node tools/sim-test.js [局数]      （在 meme-arena 目录下执行）
 * ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const ROUNDS = parseInt(process.argv[2] || "200", 10);

/* ---------- 浏览器环境桩 ---------- */
const ctxStub = new Proxy({}, {
  get(t, k) {
    if (k === "createLinearGradient" || k === "createRadialGradient") {
      return () => ({ addColorStop() {} });
    }
    if (k in t) return t[k];
    return () => {};
  },
  set(t, k, v) { t[k] = v; return true; }
});

const sandbox = {
  console,
  Math, Date, JSON, parseInt, parseFloat, isNaN, isFinite,
  Image: function () { this.src = ""; },
  Audio: function () {
    this.play = () => Promise.resolve();
    this.addEventListener = () => {};
    this.cloneNode = () => new sandbox.Audio();
  },
  AudioContext: undefined,
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => 0,
  setTimeout, clearTimeout,
  window: null
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.devicePixelRatio = 1;
sandbox.innerWidth = 1280;
sandbox.innerHeight = 900;
sandbox.addEventListener = () => {};
sandbox.document = {
  getElementById: () => ({
    getContext: () => ctxStub, style: {}, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, appendChild() {}, querySelector: () => ({ style: {} }),
    querySelectorAll: () => [], children: [], innerHTML: "", textContent: ""
  }),
  createElement: () => ({
    style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, querySelector: () => ({ style: {} }), innerHTML: "", title: ""
  }),
  querySelectorAll: () => []
};
vm.createContext(sandbox);

/* ---------- 按 index.html 的顺序加载脚本（跳过 ui.js，它要 DOM） ---------- */
const FILES = [
  "data/config.js",
  "data/characters.js",
  "assets/manifest.js",
  "src/utils.js",
  "src/assets.js",
  "src/engine.js"
];

for (const f of FILES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) throw new Error("缺少文件: " + f);
  vm.runInContext(fs.readFileSync(p, "utf8"), sandbox, { filename: f });
}

const MA = sandbox.MA;

/* ---------- 1. 角色数据校验 ---------- */
console.log("=== 1. 角色数据校验 ===");
const need = ["id", "name", "icon", "color", "shape", "hp", "atk", "def", "spd",
  "radius", "skillName", "cooldown", "skill", "skillDesc"];
let bad = 0;
const ids = new Set();
for (const t of MA.CHARACTERS) {
  for (const k of need) {
    if (t[k] === undefined || t[k] === null) { console.error(`  ✗ ${t.id || "?"} 缺少 ${k}`); bad++; }
  }
  if (typeof t.skill !== "function") { console.error(`  ✗ ${t.id} skill 不是函数`); bad++; }
  if (!/^[a-z0-9_]+$/i.test(t.id)) { console.error(`  ✗ ${t.id} id 含非法字符`); bad++; }
  if (ids.has(t.id)) { console.error(`  ✗ id 重复: ${t.id}`); bad++; }
  ids.add(t.id);
  if (t.skillRange === undefined) console.warn(`  ! ${t.id} 未设置 skillRange，将用默认 230`);
}
console.log(`  角色数 ${MA.CHARACTERS.length}，问题 ${bad} 个`);

/* ---------- 2. 战斗仿真 ---------- */
console.log(`\n=== 2. 战斗仿真 ${ROUNDS} 局（全员混战）===`);
const W = MA.World;
const w = new W({ getContext: () => ctxStub, style: {} });
w.resize(720);

const wins = {};
let totalTime = 0, timeouts = 0, skillErr = 0;
const t0 = Date.now();
const allIds = MA.CHARACTERS.map(t => t.id);

for (let i = 0; i < ROUNDS; i++) {
  w.picks = allIds;
  w.reset();
  let steps = 0;
  const dt = 1 / 60;
  while (!w.over && steps < 60 * 120) {
    w.step(dt);
    steps++;
    for (const u of w.units) {
      if (!Number.isFinite(u.x) || !Number.isFinite(u.y) || !Number.isFinite(u.hp)) {
        throw new Error(`第 ${i} 局 NaN: ${u.name} x=${u.x} y=${u.y} hp=${u.hp}`);
      }
      if (u.x < u.r - 0.6 || u.x > w.arena - u.r + 0.6) throw new Error(`第 ${i} 局越界 x: ${u.name} ${u.x}`);
      if (u.y < u.r - 0.6 || u.y > w.arena - u.r + 0.6) throw new Error(`第 ${i} 局越界 y: ${u.name} ${u.y}`);
    }
  }
  if (!w.over) { timeouts++; w.finish(null, "测试超时"); }
  const nm = w.winner ? w.winner.name : "(平局)";
  wins[nm] = (wins[nm] || 0) + 1;
  totalTime += w.time;
  skillErr = w.skillErrors;
}

const ms = Date.now() - t0;
console.log(`  耗时 ${ms}ms | 平均每局 ${(ms / ROUNDS).toFixed(1)}ms | 平均时长 ${(totalTime / ROUNDS).toFixed(1)}s`);
console.log(`  超时未决出胜负: ${timeouts} 局`);
console.log(`  技能抛异常: ${skillErr} 次`);

console.log(`\n  冠军分布（${Object.keys(wins).length} 个不同角色夺冠）:`);
Object.entries(wins).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  console.log(`    ${k.padEnd(14, "　")} ${String(v).padStart(3)} 胜 ${(v / ROUNDS * 100).toFixed(1).padStart(5)}%  ${"█".repeat(Math.round(v / ROUNDS * 40))}`);
});

/* ---------- 3. 单人局 / 双人局边界 ---------- */
console.log("\n=== 3. 边界情况 ===");
w.picks = [allIds[0]];
w.reset();
for (let i = 0; i < 60; i++) w.step(1 / 60);
console.log("  单人局: 正常跑完 60 帧 " + (w.aliveCount() === 1 ? "✓" : "✗"));

w.picks = [allIds[0], allIds[1]];
w.reset();
let s = 0;
while (!w.over && s < 60 * 120) { w.step(1 / 60); s++; }
console.log("  双人局: " + (w.over ? "✓ " + (w.winner ? w.winner.name + " 获胜" : "平局") : "✗ 未结束"));

console.log("\n结果: " + (bad === 0 && timeouts === 0 && skillErr === 0 ? "全部通过 ✅" : "存在问题 ❌"));
