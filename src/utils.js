/* =========================================================================
 * src/utils.js —— 通用小工具（全部挂在全局，方便角色数据里直接使用）
 * ========================================================================= */
"use strict";

var TAU = Math.PI * 2;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(a, b) { return a + Math.random() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function chance(p) { return Math.random() < p; }

function shuffled(arr) {
  arr = arr.slice();
  for (var i = arr.length - 1; i > 0; i--) {
    var j = randi(0, i);
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/** 十六进制颜色明度调整，用于生成同色系深/浅变体 */
function shade(hex, amt) {
  var n = parseInt(hex.slice(1), 16);
  var r = clamp(((n >> 16) & 255) + amt, 0, 255);
  var g = clamp(((n >> 8) & 255) + amt, 0, 255);
  var b = clamp((n & 255) + amt, 0, 255);
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

/** 圆角矩形路径 */
function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 格式化秒数 */
function fmtTime(s) { return s.toFixed(1) + "s"; }

/** 读数字配置：非法值（undefined / NaN / 非数字字符串）时回退到默认值 */
function num(v, def) {
  v = Number(v);
  return isNaN(v) ? def : v;
}

/* =========================================================================
 * 角色数据入口 + 校验（放在工具层，引擎和界面都能用）
 * ========================================================================= */
window.MA = window.MA || {};

/** 按 id 取角色定义 */
window.MA.getCharacter = function (id) {
  var list = window.MA.CHARACTERS || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
};

/** 校验角色数据，问题打到控制台，避免手改 data/characters.js 后出现难查的 bug */
window.MA.validateCharacters = function () {
  var list = window.MA.CHARACTERS || [];
  var seen = {}, problems = [];
  var need = ["id", "name", "icon", "color", "shape", "hp", "atk", "def", "spd",
    "radius", "skillName", "cooldown", "skill", "skillDesc"];
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    var where = "characters[" + i + "]" + (t && t.id ? " (" + t.id + ")" : "");
    for (var k = 0; k < need.length; k++) {
      if (t[need[k]] === undefined || t[need[k]] === null) {
        problems.push(where + " 缺少字段: " + need[k]);
      }
    }
    if (t.id && !/^[a-z0-9_]+$/i.test(t.id)) {
      problems.push(where + " id 只能包含字母数字下划线（它同时是素材文件夹名）");
    }
    if (t.id && seen[t.id]) problems.push(where + " id 重复: " + t.id);
    if (t.id) seen[t.id] = true;
    if (typeof t.skill !== "function") problems.push(where + " skill 必须是函数");
    if (t.skillRange === undefined) {
      problems.push(where + " 未设置 skillRange（建议补上，否则用默认 230）");
    }
  }
  var min = window.MA.CONFIG ? window.MA.CONFIG.match.minFighters : 2;
  if (list.length < min) problems.push("角色数量不足，至少需要 " + min + " 个");
  if (problems.length) {
    console.warn("[角色数据校验] 发现 " + problems.length + " 个问题：");
    for (var p = 0; p < problems.length; p++) console.warn("  · " + problems[p]);
  }
  return problems;
};
