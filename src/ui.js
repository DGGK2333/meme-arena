/* =========================================================================
 * src/ui.js —— 界面绑定、角色选择器、主循环
 * ========================================================================= */
"use strict";

/* ---------- DOM ---------- */
var cv = document.getElementById("cv");
var wrap = document.getElementById("wrap");
var overlay = document.getElementById("overlay");
var elPicker = document.getElementById("picker");
var elRoster = document.getElementById("roster");
var elLog = document.getElementById("log");
var hFps = document.getElementById("hFps");
var hTime = document.getElementById("hTime");
var hAlive = document.getElementById("hAlive");
var hVer = document.getElementById("hVer");
var btnPause = document.getElementById("btnPause");
var btnSound = document.getElementById("btnSound");
var bgSelect = document.getElementById("optBg");
var bgStatus = document.getElementById("bgStatus");

window.MA.validateCharacters();
window.MA.Assets.preload(window.MA.CHARACTERS);

var world = new World(cv);

/* ---------- 角色选择器 ---------- */
var chipEls = {};
function buildPicker() {
  elPicker.innerHTML = "";
  window.MA.CHARACTERS.forEach(function (tpl) {
    var b = document.createElement("button");
    b.className = "chip";
    b.style.setProperty("--c", tpl.color);
    b.innerHTML = "<i></i>" + tpl.name + "<em>" + tpl.icon + "</em>";
    b.title = tpl.skillName + "：" + tpl.skillDesc + "\n" +
      "HP " + tpl.hp + " · ATK " + tpl.atk + " · DEF " + tpl.def + " · SPD " + tpl.spd +
      " · CD " + tpl.cooldown + "s" +
      (tpl.contact
        ? "\n接触伤害 " + tpl.contact.damage +
          (tpl.contact.type === "none" ? "（碰撞不痛）" : "（" + tpl.contact.desc + "）")
        : "");
    b.onclick = function () {
      // 以 world.picks 为准判断上场/下场，而不是读 CSS class：
      // 代码调用 world.reset(ids) 时按钮外观可能还没同步，读 class 会点错方向。
      var cur = world.picks.slice();
      var idx = cur.indexOf(tpl.id);
      var on = idx < 0;          // 不在场上 → 这次是"上场"
      if (on) cur.push(tpl.id);
      else cur.splice(idx, 1);

      if (cur.length < window.MA.CONFIG.match.minFighters) {
        flashTip("至少要有 " + window.MA.CONFIG.match.minFighters + " 个角色参战");
        syncChips();             // 把按钮状态拉回与 picks 一致
        return;
      }
      world.reset(cur);
      syncChips();
    };
    elPicker.appendChild(b);
    chipEls[tpl.id] = b;
  });
  syncChips();
}
function syncChips() {
  window.MA.CHARACTERS.forEach(function (t) {
    var el = chipEls[t.id];
    if (el) el.classList.toggle("on", world.picks.indexOf(t.id) >= 0);
  });
}
buildPicker();

/* =========================================================================
 * 角色调参面板
 * -------------------------------------------------------------------------
 * 选中一个角色 → 实时改它的数值。改动直接写进 MA.CHARACTERS 的模板对象，
 * 所以下一次 reset() 建出来的单位就用新数值；面板会顺手重开一局让你看到效果。
 * 数值同时通过 settings.js 存进 localStorage，刷新后仍在。
 *
 * 投掷型角色（用 makeThrower 生成的，模板上有 tpl.throw）会额外多出一组
 * 投掷物参数：伤害 / 出手速度 / 碰撞半径 / 显示大小 / 反弹次数 / 存活秒数…
 * ========================================================================= */
var TUNE_CHAR_FIELDS = [
  { key: "hp",         label: "血量",         min: 20,  max: 400, step: 1,    fmt: "int" },
  { key: "atk",        label: "攻击",         min: 1,   max: 60,  step: 0.5,  fmt: "num1" },
  { key: "def",        label: "防御",         min: 0,   max: 40,  step: 0.5,  fmt: "num1" },
  { key: "spd",        label: "速度",         min: 10,  max: 160, step: 1,    fmt: "int" },
  { key: "radius",     label: "体型（半径）", min: 8,   max: 60,  step: 1,    fmt: "int" },
  { key: "cooldown",   label: "技能冷却（秒）", min: 0.5, max: 30, step: 0.1,  fmt: "num1" },
  { key: "skillRange", label: "技能触发距离", min: 40,  max: 999, step: 1,    fmt: "int" }
];
var TUNE_THROW_FIELDS = [
  { key: "dmg",        label: "投掷伤害",     min: 1,   max: 90,  step: 1,    fmt: "int" },
  { key: "speed",      label: "出手速度",     min: 60,  max: 1400, step: 10,  fmt: "int" },
  { key: "radius",     label: "投掷物碰撞半径", min: 4, max: 60,  step: 1,    fmt: "int" },
  { key: "size",       label: "投掷物显示大小", min: 8, max: 140, step: 1,    fmt: "int" },
  { key: "bounce",     label: "撞墙反弹次数", min: -1,  max: 20,  step: 1,    fmt: "bounce" },
  { key: "bounceDamp", label: "反弹后速度倍率", min: 0.3, max: 1, step: 0.05, fmt: "num2" },
  { key: "life",       label: "存活秒数",     min: 0.5, max: 30,  step: 0.5,  fmt: "num1" },
  { key: "spin",       label: "自转速度",     min: 0,   max: 30,  step: 1,    fmt: "int" },
  { key: "spread",     label: "一次投掷数量", min: 1,   max: 8,   step: 1,    fmt: "int" },
  { key: "aim",        label: "投掷瞄准",     min: 0,   max: 1,   step: 1,    fmt: "aim" },
  { key: "lead",       label: "预判提前量",   min: 0,   max: 2,   step: 0.1,  fmt: "num1" }
];

var tunePick = document.getElementById("tunePick");
var tuneFields = document.getElementById("tuneFields");
var tuneStatus = document.getElementById("tuneStatus");
var tuneInputs = [];        // [{ el, out, group, def, tpl }]

function charById(id) {
  var list = window.MA.CHARACTERS;
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
function fmtTune(fmt, v) {
  if (fmt === "num1") return Number(v).toFixed(1);
  if (fmt === "num2") return Number(v).toFixed(2);
  if (fmt === "bounce") return (v === -1 || v === Infinity) ? "一直弹" : (v + " 次");
  if (fmt === "aim") return Number(v) >= 1 ? "瞄准敌人" : "沿运动方向";
  return String(Math.round(v));
}
function currentTuneTpl() { return charById(tunePick.value); }

/** 按当前选中角色重建整组控件 */
function buildTuneFields() {
  var tpl = currentTuneTpl();
  tuneFields.innerHTML = "";
  tuneInputs = [];
  if (!tpl) return;

  function addGroup(title, fields, group) {
    if (!fields.length) return;
    var h = document.createElement("div");
    h.className = "bg-note";
    h.style.margin = "8px 0 4px";
    h.innerHTML = "<b>" + title + "</b>";
    tuneFields.appendChild(h);

    fields.forEach(function (def) {
      var cur = group === "throw" ? (tpl["throw"] || {})[def.key] : tpl[def.key];
      if (typeof cur !== "number") return;
      var label = document.createElement("label");
      label.className = "bg-slider";
      var out = document.createElement("output");
      out.value = fmtTune(def.fmt, cur);
      var span = document.createElement("span");
      span.textContent = def.label;
      var input = document.createElement("input");
      input.type = "range";
      input.min = def.min; input.max = def.max; input.step = def.step;
      input.value = cur;
      label.appendChild(span); label.appendChild(out); label.appendChild(input);
      tuneFields.appendChild(label);

      // input：只更新数字显示，保证拖动时读数跟手
      input.addEventListener("input", function () {
        out.value = fmtTune(def.fmt, parseFloat(input.value));
      });
      // change：松手才真正写回模板 + 存档 + 重开一局（避免拖动过程中反复重开）
      input.addEventListener("change", function () {
        var v = parseFloat(input.value);
        if (group === "throw") {
          if (!tpl["throw"]) tpl["throw"] = {};
          tpl["throw"][def.key] = v;
        } else {
          tpl[def.key] = v;
        }
        out.value = fmtTune(def.fmt, v);
        if (window.MA.Settings) window.MA.Settings.saveChars();
        // 体型可以原地刷半径（不打断对局）；其余数值要重建单位才生效
        if (group === "char" && def.key === "radius") {
          world.refreshUnitSizes();
        } else {
          world.reset();
        }
        syncChips();
        syncTuneStatus();
        flashTip(tpl.name + " · " + def.label + " = " + fmtTune(def.fmt, v));
      });

      tuneInputs.push({ el: input, out: out, def: def, group: group, tpl: tpl });
    });
  }

  addGroup("基础数值", TUNE_CHAR_FIELDS, "char");
  if (tpl["throw"]) addGroup("投掷物（模板：" + (tpl.skillName || "技能") + "）", TUNE_THROW_FIELDS, "throw");
  syncTuneStatus();
}

function syncTuneStatus() {
  var tpl = currentTuneTpl();
  if (!tpl || !tuneStatus) return;
  var dirty = false;
  var fac = (window.MA.Settings && window.MA.Settings.factoryChars) || {};
  var f = fac[tpl.id];
  if (f) {
    TUNE_CHAR_FIELDS.forEach(function (d) { if (tpl[d.key] !== f[d.key]) dirty = true; });
    if (tpl["throw"] && f["throw"]) {
      TUNE_THROW_FIELDS.forEach(function (d) {
        if (tpl["throw"][d.key] !== f["throw"][d.key]) dirty = true;
      });
    }
  }
  tuneStatus.textContent = dirty
    ? "该角色已被改过（数值会一直保存到本机，直到点「恢复该角色默认」）"
    : "当前是默认数值";
}

function buildTunePicker() {
  tunePick.innerHTML = "";
  window.MA.CHARACTERS.forEach(function (t) {
    var o = document.createElement("option");
    o.value = t.id;
    o.textContent = t.name + (t["throw"] ? "（投掷型）" : "");
    tunePick.appendChild(o);
  });
}
tunePick.onchange = function () {
  buildTuneFields();
  syncChips();
};
document.getElementById("btnTuneReset").onclick = function () {
  var tpl = currentTuneTpl();
  if (!tpl) return;
  var S = window.MA.Settings;
  if (S && S.factoryChars && S.factoryChars[tpl.id]) {
    S.resetChar(tpl.id, S.factoryChars[tpl.id]);
  }
  buildTuneFields();
  world.reset();
  flashTip(tpl.name + " 已恢复默认数值");
};
buildTunePicker();
buildTuneFields();

/* ---------- 实时战况 ---------- */
var rowEls = {}, rosterVer = -1;

function buildRoster() {
  elRoster.innerHTML = "";
  rowEls = {};
  world.units.forEach(function (u) {
    if (u.isClone) return;
    var row = document.createElement("div");
    row.className = "row";
    row.innerHTML =
      '<span class="dot" style="color:' + u.color + ';background:' + u.color + '"></span>' +
      '<span class="nm">' + u.name + '<s></s></span>' +
      '<span class="vv">--</span>' +
      '<span class="bar"><i style="width:100%;background:linear-gradient(90deg,' +
        shade(u.color, -40) + ',' + u.color + ')"></i></span>';
    elRoster.appendChild(row);
    rowEls[u.uid] = row;
  });
}

function updateRoster() {
  if (rosterVer !== world.ver) { rosterVer = world.ver; buildRoster(); }
  world.units.forEach(function (u) {
    if (u.isClone) return;
    var row = rowEls[u.uid];
    if (!row) return;
    var frac = clamp(u.hp / u.stats.hp, 0, 1);
    row.classList.toggle("dead", !u.alive);
    var bar = row.querySelector(".bar i");
    bar.style.width = (frac * 100) + "%";
    bar.style.background = frac > 0.55
      ? "linear-gradient(90deg," + shade(u.color, -40) + "," + u.color + ")"
      : frac > 0.28
        ? "linear-gradient(90deg,#ffb03a,#ffd24a)"
        : "linear-gradient(90deg,#c03030,#ff5d5d)";
    row.querySelector(".vv").textContent =
      Math.max(0, Math.round(u.hp)) + " · " + u.kills + "杀";
    row.querySelector(".nm s").textContent = u.alive ? "" : "已淘汰";
  });

  if (world._logQueue && world._logQueue.length) {
    world._logQueue.forEach(function (line) {
      var d = document.createElement("div");
      d.innerHTML = line;
      elLog.appendChild(d);
    });
    world._logQueue.length = 0;
    while (elLog.children.length > window.MA.CONFIG.ui.maxLogLines) {
      elLog.removeChild(elLog.firstChild);
    }
    elLog.scrollTop = elLog.scrollHeight;
  }

  hTime.textContent = fmtTime(world.time);
  hAlive.textContent = world.aliveCount();
  hVer.textContent = world.ver;
}

/* ---------- 提示 ---------- */
var tipTimer = 0;
function flashTip(msg) {
  overlay.textContent = msg;
  overlay.style.fontSize = "min(6vw,34px)";
  overlay.classList.remove("show");
  void overlay.offsetWidth;
  overlay.classList.add("show");
  clearTimeout(tipTimer);
  tipTimer = setTimeout(function () { overlay.classList.remove("show"); }, 1100);
}
function bigOverlay(msg, color) {
  overlay.textContent = msg;
  overlay.style.fontSize = "min(9vw,64px)";
  overlay.style.color = color || "#fff";
  overlay.classList.remove("show");
  void overlay.offsetWidth;
  overlay.classList.add("show");
}

/* ---------- 控件 ---------- */
btnPause.onclick = function () {
  world.paused = !world.paused;
  btnPause.textContent = world.paused ? "继续" : "暂停";
  wakeRenderLoop();
};
document.getElementById("btnReset").onclick = function () { world.reset(); };
btnSound.onclick = function () {
  var on = !window.MA.Audio.isEnabled();
  window.MA.Audio.setEnabled(on);
  btnSound.textContent = on ? "🔊 音效" : "🔇 静音";
  btnSound.classList.toggle("ghost", !on);
};

document.querySelectorAll("#speed button").forEach(function (b) {
  b.onclick = function () {
    document.querySelectorAll("#speed button").forEach(function (x) { x.classList.remove("on"); });
    b.classList.add("on");
    world.speed = parseFloat(b.dataset.s);
  };
});
document.getElementById("optShrink").onchange = function (e) {
  world.shrink = parseFloat(e.target.value);
  world.log("缩圈速度调整为 <span class=\"k\">" + e.target.selectedOptions[0].textContent + "</span>");
};

/* ---------- 缩圈 / 圈外滤镜 ----------
 * 复用同一套「声明式绑定」思路：每个控件声明 目标对象 / 字段 / 格式，
 * 改一个值就写回配置并重绘，不用为每个滑块写一遍回调。 */
function arenaCfg() { return window.MA.CONFIG.arena; }
function poisonCfg() {
  var a = arenaCfg();
  if (!a.poisonFx) a.poisonFx = {};
  return a.poisonFx;
}
function ringCfg() {
  var a = arenaCfg();
  if (!a.zoneRing) a.zoneRing = {};
  return a.zoneRing;
}

var ZONE_BINDINGS = [
  // 安全区总开关
  { id: "zEnabled", get: function () { return arenaCfg(); }, key: "zoneEnabled", bool: true },
  // 圈外滤镜
  { id: "zFxEnabled", get: poisonCfg, key: "enabled", bool: true },
  { id: "zOpacity", get: poisonCfg, key: "opacity", out: "zOpacityV", fmt: "pct" },
  { id: "zColor", get: poisonCfg, key: "color", color: true },
  { id: "zColor2", get: poisonCfg, key: "color2", color: true },
  { id: "zGradient", get: poisonCfg, key: "gradient", bool: true },
  { id: "zScan", get: poisonCfg, key: "scanlines", bool: true },
  { id: "zScanOpacity", get: poisonCfg, key: "scanOpacity", out: "zScanV", fmt: "pct" },
  { id: "zNoise", get: poisonCfg, key: "noise", bool: true },
  { id: "zNoiseOpacity", get: poisonCfg, key: "noiseOpacity", out: "zNoiseV", fmt: "pct" },
  { id: "zBlurEdges", get: poisonCfg, key: "blurEdges", out: "zBlurV", fmt: "int" },
  { id: "zPulse", get: poisonCfg, key: "pulse", out: "zPulseV", fmt: "pct" },
  // 安全区边界线
  { id: "zRingEnabled", get: ringCfg, key: "enabled", bool: true },
  { id: "zRingWidth", get: ringCfg, key: "width", out: "zRingWidthV", fmt: "fixed1" },
  { id: "zRingOpacity", get: ringCfg, key: "opacity", out: "zRingOpacityV", fmt: "pct" },
  { id: "zRingGlow", get: ringCfg, key: "glow", out: "zRingGlowV", fmt: "int" }
];

/* 总开关关闭时，这一整组控件变灰并禁用，直观表明它们不起作用 */
function syncZoneEnabledUI() {
  var on = arenaCfg().zoneEnabled !== false;
  var group = document.getElementById("zFxGroup");
  var note = document.getElementById("zOffNote");
  if (group) {
    group.style.opacity = on ? "1" : "0.4";
    group.style.pointerEvents = on ? "" : "none";
  }
  if (note) note.style.display = on ? "none" : "";
  // 缩圈速度下拉也一并禁用
  var sp = document.getElementById("optShrink");
  if (sp) { sp.disabled = !on; sp.style.opacity = on ? "1" : "0.4"; }
}

function fmtZoneValue(fmt, v) {
  if (fmt === "pct") return Math.round(v * 100) + "%";
  if (fmt === "fixed1") return Number(v).toFixed(1);
  return String(Math.round(v));
}

function bindZoneControls() {
  ZONE_BINDINGS.forEach(function (b) {
    var el = document.getElementById(b.id);
    if (!el) return;
    var out = b.out ? document.getElementById(b.out) : null;
    el.addEventListener("input", function () {
      var target = b.get();
      var v;
      if (b.bool) v = el.value === "1";
      else if (b.color) v = el.value;
      else v = parseFloat(el.value);
      target[b.key] = v;
      if (out) out.value = fmtZoneValue(b.fmt, v);
      // 总开关变化时同步灰化状态，并把世界里的即时状态也刷一遍
      if (b.id === "zEnabled") {
        syncZoneEnabledUI();
        world.zoneOn = v;
        world.log("安全区机制 " + (v ? "<span class=\"k\">已开启</span>" : "<span class=\"k\">已关闭</span>（无缩圈/无圈外伤害/无特效）"));
      }
      wakeRenderLoop();
    });
  });
}
bindZoneControls();

function syncZoneControls() {
  ZONE_BINDINGS.forEach(function (b) {
    var el = document.getElementById(b.id);
    if (!el) return;
    var v = b.get()[b.key];
    if (v === undefined || v === null) return;
    if (b.bool) el.value = v ? "1" : "0";
    else el.value = v;
    if (b.out) {
      var out = document.getElementById(b.out);
      if (out) out.value = fmtZoneValue(b.fmt, parseFloat(v));
    }
  });
  syncZoneEnabledUI();
}
syncZoneControls();
document.getElementById("optAI").onchange = function (e) { world.aiMul = parseFloat(e.target.value); };
document.getElementById("optDmg").onchange = function (e) { world.dmgMul = parseFloat(e.target.value); };
document.getElementById("optAuto").onchange = function (e) { world.autoRestart = e.target.value === "1"; };
document.getElementById("optMove").onchange = function (e) {
  world.moveMode = e.target.value === "active" ? "active" : "momentum";
  world.log("移动模式切换为 <span class=\"k\">" +
    (world.moveMode === "momentum" ? "碰撞弹跳" : "主动追击") + "</span>");
  world.reset();
};

/* ---------- 摄像机 ---------- */
var btnCamera = document.getElementById("btnCamera");
var optCam = document.getElementById("optCam");
var camPickRow = document.getElementById("camPickRow");
var optCamTarget = document.getElementById("optCamTarget");
var camZoomRow = document.getElementById("camZoomRow");
var camZoom = document.getElementById("camZoom");
var camZoomVal = document.getElementById("camZoomVal");
var camPresetRow = document.getElementById("camPresetRow");
var camEdgeRow = document.getElementById("camEdgeRow");
var optCamEdge = document.getElementById("optCamEdge");

/* 记录出厂默认值，供"恢复默认"使用。
 * 必须取 settings.js 在合并存档之前拍下的出厂快照 —— CONFIG 里此刻已经
 * 混进了上次的存档，直接读会把"恢复默认"变成"恢复到我上次调的值"。 */
window.MA.CAMERA_DEFAULT_ZOOM =
  (window.MA.Settings && window.MA.Settings.factoryCamera &&
   window.MA.Settings.factoryCamera.followZoom != null)
    ? window.MA.Settings.factoryCamera.followZoom
    : window.MA.CONFIG.camera.followZoom;
/* 滑块范围从配置读取，改 config 就能改界面可选区间 */
(function initCamZoomRange() {
  var c = window.MA.CONFIG.camera;
  camZoom.min = c.zoomMin != null ? c.zoomMin : 0.5;
  camZoom.max = c.zoomMax != null ? c.zoomMax : 3;
  camZoom.step = c.zoomStep != null ? c.zoomStep : 0.05;
  camZoom.value = c.followZoom;
  camZoomVal.value = Number(c.followZoom).toFixed(2) + "×";
})();

function buildCamTargetOptions() {
  var cur = world.cam.targetId;
  optCamTarget.innerHTML = "";
  world.units.forEach(function (u) {
    if (u.isClone || !u.alive) return;
    var o = document.createElement("option");
    o.value = String(u.uid);
    o.textContent = u.name + "（" + Math.round(u.hp) + "HP）";
    if (u.uid === cur) o.selected = true;
    optCamTarget.appendChild(o);
  });
}
function syncCameraUI() {
  var follow = world.cam.mode === "follow";
  optCam.value = world.cam.mode;
  camPickRow.style.display = follow ? "" : "none";
  camZoomRow.style.display = follow ? "" : "none";
  camPresetRow.style.display = follow ? "" : "none";
  camEdgeRow.style.display = follow ? "" : "none";
  btnCamera.textContent = follow ? "🎥 跟随中" : "🎥 全局视野";
  btnCamera.classList.toggle("primary", follow);
  btnCamera.classList.toggle("ghost", !follow);
  if (follow) {
    buildCamTargetOptions();
    syncCamZoomUI();
  }
}
function syncCamZoomUI() {
  var z = window.MA.CONFIG.camera.followZoom;
  camZoom.value = z;
  camZoomVal.value = z.toFixed(2) + "×";
  optCamEdge.value = String(window.MA.CONFIG.camera.edgePadding);
}
optCam.onchange = function (e) {
  world.setCameraMode(e.target.value);
  syncCameraUI();
  saveSettingsSoon();
  flashTip(world.cam.mode === "follow" ? "已开启跟随视角" : "已切回全局视野");
};
optCamTarget.onchange = function (e) {
  var uid = parseInt(e.target.value, 10);
  for (var i = 0; i < world.units.length; i++) {
    if (world.units[i].uid === uid) { world.cam.targetId = uid; break; }
  }
  syncCameraUI();
};
/* 跟随缩放：即时生效，实时显示倍数 */
camZoom.oninput = function () {
  var z = parseFloat(camZoom.value);
  window.MA.CONFIG.camera.followZoom = z;
  camZoomVal.value = z.toFixed(2) + "×";
  // 下一帧 updateCamera 会读到新值；立即同步一次避免滑块拖动时的滞后感
  if (world.cam.mode === "follow") world.cam.zoom = z;
  saveSettingsSoon();
  wakeRenderLoop();
};
/* 双击倍数标签 / 点击数值 → 恢复默认 */
camZoomVal.onclick = function () {
  var def = window.MA.CAMERA_DEFAULT_ZOOM || 0.8;
  window.MA.CONFIG.camera.followZoom = def;
  camZoom.value = def;
  camZoomVal.value = def.toFixed(2) + "×";
  if (world.cam.mode === "follow") world.cam.zoom = def;
  saveSettingsSoon();
  flashTip("缩放已恢复默认 " + def.toFixed(2) + "×");
  wakeRenderLoop();
};
optCamEdge.onchange = function (e) {
  window.MA.CONFIG.camera.edgePadding = parseFloat(e.target.value);
  saveSettingsSoon();
  wakeRenderLoop();
};
/* 一键预设：远景 / 全景 / 标准 / 特写 */
document.querySelectorAll(".cam-preset").forEach(function (b) {
  b.onclick = function () {
    var z = parseFloat(b.dataset.zoom);
    window.MA.CONFIG.camera.followZoom = z;
    if (world.cam.mode !== "follow") world.setCameraMode("follow");
    world.cam.zoom = z;
    syncCameraUI();
    saveSettingsSoon();
    flashTip("缩放 " + z.toFixed(2) + "×");
    wakeRenderLoop();
  };
});
btnCamera.onclick = function () {
  var next = world.cam.mode === "follow" ? "global" : "follow";
  world.setCameraMode(next);
  syncCameraUI();
  saveSettingsSoon();
  flashTip(next === "follow" ? "跟随视角（可调缩放）" : "全局视野");
};
document.getElementById("optDmgText").onchange = function (e) {
  window.MA.CONFIG.damageNumbers.enabled = e.target.value === "1";
};

/* ---------- 角色 / 血条显示尺寸 ---------- */
(function initDisplayControls() {
  var dispUnit = document.getElementById("dispUnit");
  var dispUnitV = document.getElementById("dispUnitV");
  var dispHpBar = document.getElementById("dispHpBar");
  var dispHpBarV = document.getElementById("dispHpBarV");
  var dispHpVal = document.getElementById("dispHpVal");
  var d = window.MA.CONFIG.display;
  if (!dispUnit) return;

  function sync() {
    dispUnit.value = d.unitScale;
    dispUnitV.value = Number(d.unitScale).toFixed(2) + "×";
    dispHpBar.value = d.hpBarScale;
    dispHpBarV.value = Number(d.hpBarScale).toFixed(2) + "×";
    dispHpVal.value = d.hpBarShowValue === false ? "0" : "1";
  }
  sync();

  // 角色大小：原地刷一遍半径即可，不必重开一局（重开会打断正在看的对局）
  dispUnit.oninput = function () {
    d.unitScale = parseFloat(dispUnit.value);
    dispUnitV.value = d.unitScale.toFixed(2) + "×";
    world.refreshUnitSizes();
    saveSettingsSoon();
    wakeRenderLoop();
  };
  // 血条只是绘制参数，随时改随时生效，不用重开
  dispHpBar.oninput = function () {
    d.hpBarScale = parseFloat(dispHpBar.value);
    dispHpBarV.value = d.hpBarScale.toFixed(2) + "×";
    saveSettingsSoon();
    wakeRenderLoop();
  };
  dispHpVal.onchange = function () {
    d.hpBarShowValue = dispHpVal.value === "1";
    saveSettingsSoon();
    wakeRenderLoop();
  };

  // 供测试与外部调用
  window.MA.syncDisplayControls = sync;
})();

// 每局开始时刷新跟随名单（角色可能换人）
var camVer = -1;
function tickCamera() {
  if (camVer !== world.ver) {
    camVer = world.ver;
    if (world.cam.mode === "follow") buildCamTargetOptions();
  }
}

/* ---------- 背景主题 / 三层背景控制 ---------- */
var bgLayerDefaults = null;   // 记录出厂默认值，供"该层恢复默认"使用

function bgCfg() { return window.MA.CONFIG.render.background; }
function layerCfg(name) {
  var c = bgCfg();
  if (!c[name]) c[name] = {};
  return c[name];
}

function syncBackgroundControls() {
  var bg = window.MA.Background;
  if (!bg) return;
  bgSelect.value = bg.preset;
  var custom = bg.preset === "custom";
  if (!(window.MA.Settings && window.MA.Settings.available)) {
    bgStatus.textContent = "浏览器本地存储不可用（可能是隐私模式），设置仅在本次打开期间有效";
  } else if (custom) {
    bgStatus.textContent = "自选图片已启用；换图与各层微调在下方「三层背景」面板里";
  } else if (bg.hasCustomImage) {
    bgStatus.textContent = "自选图已载入；选择“自选图片”可恢复";
  } else if (bg.hasProjectImage) {
    bgStatus.textContent = "正在使用项目默认背景；主题可即时切换";
  } else {
    bgStatus.textContent = "主题可即时切换；换图与各层微调在下方「三层背景」面板里";
  }
}
bgSelect.onchange = function () {
  if (window.MA.Background.setPreset(bgSelect.value)) syncBackgroundControls();
  else {
    bgSelect.value = window.MA.Background.preset;
    flashTip("请先到「三层背景」里上传一张擂台图");
  }
  wakeRenderLoop();
};

/* ---- 三层背景：标签切换 ---- */
var activeLayer = "outer";
document.querySelectorAll("#layerTabs button").forEach(function (b) {
  b.onclick = function () {
    activeLayer = b.dataset.layer;
    document.querySelectorAll("#layerTabs button").forEach(function (x) {
      x.classList.toggle("on", x === b);
    });
    document.querySelectorAll(".layer-panel").forEach(function (p) {
      p.style.display = p.dataset.layer === activeLayer ? "" : "none";
    });
  };
});

/* ---- 三层背景：把所有滑块/下拉统一绑定到配置字段 ----
 * 每个控件声明 { 层, 字段, 显示名, 格式化 }，改字段即改配置并重绘。
 * 这样加新参数只要在 HTML 加一个带 data-* 的控件即可，不用改 JS。 */
var LAYER_BINDINGS = [
  // 外层
  { id: "oPattern", layer: "outer", key: "pattern", kind: "select" },
  { id: "oPatScale", layer: "outer", key: "patternScale", out: "oPatScaleV", fmt: "int" },
  { id: "oPatWidth", layer: "outer", key: "patternWidth", out: "oPatWidthV", fmt: "fixed1" },
  { id: "oOverlay", layer: "outer", key: "overlay", out: "oOverlayV", fmt: "pct" },
  { id: "oOpacity", layer: "outer", key: "opacity", out: "oOpacityV", fmt: "pct" },
  { id: "oScale", layer: "outer", key: "scale", out: "oScaleV", fmt: "zoom" },
  { id: "oOffX", layer: "outer", key: "offsetX", out: "oOffXV", fmt: "int" },
  { id: "oOffY", layer: "outer", key: "offsetY", out: "oOffYV", fmt: "int" },
  { id: "oBlur", layer: "outer", key: "blur", out: "oBlurV", fmt: "fixed1" },

  // 边框
  { id: "bThick", layer: "border", key: "thickness", out: "bThickV", fmt: "int" },
  { id: "bStyle", layer: "border", key: "style", kind: "select" },
  { id: "bGlow", layer: "border", key: "glow", out: "bGlowV", fmt: "int" },
  { id: "bPulse", layer: "border", key: "pulse", out: "bPulseV", fmt: "pct" },
  { id: "bOpacity", layer: "border", key: "opacity", out: "bOpacityV", fmt: "pct" },
  { id: "bScale", layer: "border", key: "scale", out: "bScaleV", fmt: "zoom" },
  { id: "bOffX", layer: "border", key: "offsetX", out: "bOffXV", fmt: "int" },
  { id: "bOffY", layer: "border", key: "offsetY", out: "bOffYV", fmt: "int" },
  { id: "bBlur", layer: "border", key: "blur", out: "bBlurV", fmt: "fixed1" },

  // 内层
  { id: "iOpacity", layer: "inner", key: "opacity", out: "iOpacityV", fmt: "pct" },
  { id: "iOverlay", layer: "inner", key: "overlay", top: true, out: "iOverlayV", fmt: "pct" },
  { id: "iVignette", layer: "inner", key: "vignette", out: "iVignetteV", fmt: "pct" },
  { id: "iScale", layer: "inner", key: "scale", out: "iScaleV", fmt: "zoom" },
  { id: "iOffX", layer: "inner", key: "offsetX", out: "iOffXV", fmt: "int" },
  { id: "iOffY", layer: "inner", key: "offsetY", out: "iOffYV", fmt: "int" },
  { id: "iBlur", layer: "inner", key: "blur", out: "iBlurV", fmt: "fixed1" }
];

function fmtValue(fmt, v) {
  if (fmt === "pct") return Math.round(v * 100) + "%";
  if (fmt === "zoom") return Number(v).toFixed(2) + "×";
  if (fmt === "fixed1") return Number(v).toFixed(1);
  return String(Math.round(v));
}

/* 保存设置到本地（背景三层 + 摄像机 + 显示尺寸，一次写完）。
 * 防抖逻辑放在 settings.js 里 —— 「恢复默认」要能取消掉待写入的那次保存，
 * 所以定时器必须由同一个模块持有。 */
function writeSettings() {
  var S = window.MA.Settings;
  if (S) S.saveAll(window.MA.Background.preset);
}
function saveSettingsSoon() {
  var S = window.MA.Settings;
  if (S) S.saveSoon(window.MA.Background.preset);
}
/* 防抖窗口内刷新/关标签页时，把待写入的设置补上，避免"刚调完就刷新"丢失。
 * 只有真的有待写内容时才落盘 —— 否则「恢复默认」刚清空存档，
 * 一刷新又被这里的无条件写入复原了。 */
function flushPendingSettings() {
  var S = window.MA.Settings;
  if (S) S.flushPendingSave(window.MA.Background.preset);
}
/* 丢掉待写入的那次保存。「恢复默认」要先调它：
 * 否则刚清空存档，250ms 后那个还没触发的定时器又把当前配置写回去，
 * 刷新一下"默认"就没了。 */
function cancelPendingSettings() {
  var S = window.MA.Settings;
  if (S) S.cancelPendingSave();
}
window.addEventListener("pagehide", flushPendingSettings);
document.addEventListener("visibilitychange", function () {
  if (document.hidden) flushPendingSettings();
});

function bindLayerControls() {
  LAYER_BINDINGS.forEach(function (b) {
    var el = document.getElementById(b.id);
    if (!el) return;
    var out = b.out ? document.getElementById(b.out) : null;
    el.addEventListener(b.kind === "select" ? "change" : "input", function () {
      var v = b.kind === "select" ? el.value : parseFloat(el.value);
      // 内层的 overlay 是共享字段（跟着主题走），其余都写各自层的字段
      if (b.top) bgCfg()[b.key] = v;
      else layerCfg(b.layer)[b.key] = v;
      if (out) out.value = fmtValue(b.fmt, v);
      window.MA.Background.invalidate();
      saveSettingsSoon();
      wakeRenderLoop();
    });
  });
}
bindLayerControls();

/* ---- 三层背景：同步界面显示当前配置 ---- */
function syncLayerControls() {
  var c = bgCfg();
  LAYER_BINDINGS.forEach(function (b) {
    var el = document.getElementById(b.id);
    if (!el) return;
    var v = b.top ? c[b.key] : (layerCfg(b.layer)[b.key]);
    if (v === undefined || v === null) return;
    if (b.kind === "select") el.value = v;
    else {
      el.value = v;
      if (b.out) {
        var out = document.getElementById(b.out);
        if (out) out.value = fmtValue(b.fmt, parseFloat(v));
      }
    }
  });
}

/* ---- 每层单独换图 / 恢复默认 ----
 * 「战场设置」里原来的「选择擂台图 / 恢复默认」已删除（与这里功能重复），
 * 三层换图统一走这个入口：内层 = 擂台图，外层 / 边框 = 各自的纹理图。 */
var layerFile = document.getElementById("layerFile");
/* 记下"点按钮那一刻"的层：文件对话框是异步的，用户可能在选图期间
 * 切到别的标签页，直接用 activeLayer 会把图换到错的层上。 */
var pendingLayer = null;
document.getElementById("btnLayerUpload").onclick = function () {
  pendingLayer = activeLayer;
  layerFile.click();
};
layerFile.onchange = function () {
  var file = layerFile.files && layerFile.files[0];
  if (!file) { pendingLayer = null; return; }
  var layer = pendingLayer || activeLayer;
  var label = layer === "inner" ? "擂台" : (layer === "outer" ? "外层" : "边框");
  // 走 Background 的持久化通道：图片存进 IndexedDB，刷新后仍在
  var task = layer === "inner"
    ? window.MA.Background.setFile(file)
    : window.MA.Background.setLayerFile(layer, file);
  task.then(function () {
    syncBackgroundControls();
    flashTip(label + "图已替换");
    wakeRenderLoop();
  }).catch(function (err) {
    flashTip(err.message);
  }).then(function () { layerFile.value = ""; pendingLayer = null; });
};
document.getElementById("btnLayerReset").onclick = function () {
  if (!bgLayerDefaults) return;
  var def = bgLayerDefaults[activeLayer];
  if (!def) return;
  // 先撤掉待写入的防抖保存，避免它带着重置前的旧值落盘
  cancelPendingSettings();
  var target = activeLayer === "inner" ? bgCfg() : layerCfg(activeLayer);
  Object.keys(def).forEach(function (k) { target[k] = def[k]; });
  // 关键：光重置 config 不够，内存里已载入的图片也要清掉，否则界面毫无变化
  // （clearLayerImage 内部还会删掉 IndexedDB 存档并重写设置）
  window.MA.Background.clearLayerImage(activeLayer);
  syncLayerControls();
  flashTip("该层已恢复默认");
  wakeRenderLoop();
};

window.MA.Background.init().then(function () {
  /* init 之后再记录默认值，但取的是 settings.js 在合并存档之前拍下的
   * 「出厂快照」—— 不能用当前 CONFIG，那里面已经混进了上次的存档，
   * 会把"恢复默认"变成"恢复到我上次调的值"。 */
  var factory = (window.MA.Settings && window.MA.Settings.factoryBackground) || null;
  if (factory) {
    bgLayerDefaults = JSON.parse(JSON.stringify({
      outer: factory.outer || {},
      border: factory.border || {},
      inner: {
        opacity: (factory.inner || {}).opacity,
        overlay: factory.overlay,
        vignette: (factory.inner || {}).vignette,
        scale: (factory.inner || {}).scale,
        offsetX: (factory.inner || {}).offsetX,
        offsetY: (factory.inner || {}).offsetY,
        blur: (factory.inner || {}).blur
      }
    }));
  } else {
    bgLayerDefaults = JSON.parse(JSON.stringify({
      outer: bgCfg().outer || {},
      border: bgCfg().border || {},
      inner: {
        opacity: (bgCfg().inner || {}).opacity,
        overlay: bgCfg().overlay,
        vignette: (bgCfg().inner || {}).vignette,
        scale: (bgCfg().inner || {}).scale,
        offsetX: (bgCfg().inner || {}).offsetX,
        offsetY: (bgCfg().inner || {}).offsetY,
        blur: (bgCfg().inner || {}).blur
      }
    }));
  }
  syncBackgroundControls();
  syncLayerControls();
  wakeRenderLoop();
}).catch(function (err) {
  console.warn("[背景] 初始化失败，已使用预设主题：", err);
  syncBackgroundControls();
  syncLayerControls();
});

window.addEventListener("keydown", function (e) {
  if (e.code === "Space") { e.preventDefault(); btnPause.click(); }
  if (e.key === "r" || e.key === "R") world.reset();
  if (e.key === "m" || e.key === "M") btnSound.click();
  if (e.key === "c" || e.key === "C") btnCamera.click();
  // +/- 调整跟随缩放（并自动切到跟随视角，否则看不到效果）
  if (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "_") {
    var c = window.MA.CONFIG.camera;
    var step = c.zoomStep || 0.05;
    var next = c.followZoom + (e.key === "+" || e.key === "=" ? step : -step);
    var zlo = c.zoomMin != null ? c.zoomMin : 0.5;
    var zhi = c.zoomMax != null ? c.zoomMax : 3;
    next = clamp(next, zlo, zhi);
    next = Math.round(next * 100) / 100;      // 避免浮点误差堆出 1.4999999
    c.followZoom = next;
    if (world.cam.mode !== "follow") world.setCameraMode("follow");
    world.cam.zoom = next;
    syncCameraUI();
    flashTip("缩放 " + next.toFixed(2) + "×");
    wakeRenderLoop();
    return;
  }
  // 数字键 1-9 快速跟随第 N 个存活角色
  if (e.key >= "1" && e.key <= "9") {
    var idx = parseInt(e.key, 10) - 1;
    var alive = world.units.filter(function (u) { return u.alive && !u.isClone; });
    if (alive[idx]) {
      world.cam.targetId = alive[idx].uid;
      world.setCameraMode("follow");
      syncCameraUI();
      flashTip("跟随：" + alive[idx].name);
    }
  }
});

/* ---------- 鼠标 / 触摸推挤 ---------- */
function pointerPos(e) {
  var rect = cv.getBoundingClientRect();
  var p = e.touches ? e.touches[0] : e;
  return {
    x: (p.clientX - rect.left) / rect.width * world.arena,
    y: (p.clientY - rect.top) / rect.height * world.arena
  };
}
cv.addEventListener("pointerdown", function (e) {
  window.MA.Audio.unlock();
  world.mouse = pointerPos(e);
  if (cv.setPointerCapture) cv.setPointerCapture(e.pointerId);
});
/* 双击擂台 → 跟随该角色（再双击空白处 → 回到全局） */
cv.addEventListener("dblclick", function (e) {
  if (!window.MA.CONFIG.camera.clickToFollow) return;
  var p = pointerPos(e);
  var picked = world.pickCamTargetAt(p.x, p.y);
  if (picked) {
    syncCameraUI();
    flashTip("跟随：" + picked.name);
  } else {
    world.setCameraMode("global");
    syncCameraUI();
    flashTip("已切回全局视野");
  }
});
cv.addEventListener("pointermove", function (e) { if (world.mouse) world.mouse = pointerPos(e); });
cv.addEventListener("pointerup", function () { world.mouse = null; });
cv.addEventListener("pointerleave", function () { world.mouse = null; });
cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
window.addEventListener("pointerdown", function () { window.MA.Audio.unlock(); }, { once: true });

/* ---------- 尺寸自适应 ---------- */
function fit() {
  var wide = window.innerWidth > 1080;
  var availW = window.innerWidth - (wide ? 396 : 40);
  var availH = window.innerHeight - (wide ? 130 : 190);
  var size = Math.max(280, Math.min(availW, availH, window.MA.CONFIG.render.maxArenaPx));
  world.resize(size);
}
window.addEventListener("resize", fit);
fit();
world.reset();
syncChips();
syncCameraUI();

/* ---------- 主循环 ---------- */
/* 只用 requestAnimationFrame 驱动，不要和 setTimeout 混用：
 * rAF 跟着 vsync（16.7ms）走，再叠一个定时器会跨过下一个 vsync 边界，
 * 产生拍频锁死（表现为帧率卡在 40/30 不动）。 */
var last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0;
var loopTimer = 0;
var framePending = false;
var rosterAccumulator = 0;
var lastDrawAt = 0;
function requestLoopFrame() {
  if (document.hidden || framePending) return;
  framePending = true;
  requestAnimationFrame(function (now) {
    framePending = false;
    loop(now);
  });
}
function scheduleLoop() {
  if (document.hidden) return;
  if (world.paused) {
    // 暂停时不需要流畅画面，用定时器慢轮询即可（此时不涉及 vsync 对齐）
    if (!loopTimer) {
      loopTimer = setTimeout(function () { loopTimer = 0; requestLoopFrame(); }, 250);
    }
    return;
  }
  requestLoopFrame();
}
function wakeRenderLoop() {
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = 0; }
  requestLoopFrame();
}
function loop(now) {
  if (document.hidden) return;
  var dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;

  fpsAcc += 1 / Math.max(dt, 1e-4); fpsN++; fpsT += dt;
  if (fpsT > 0.5) {
    hFps.textContent = Math.round(fpsAcc / fpsN);
    fpsAcc = 0; fpsN = 0; fpsT = 0;
  }

  if (!world.paused) {
    var sub = Math.max(1, Math.round(world.speed));
    var sdt = (dt * world.speed) / sub;
    for (var i = 0; i < sub; i++) world.step(sdt);
    /* 结算提示：有冠军就报名字，无人胜出（全员阵亡）也要有提示 ——
     * 以前这里要求 world.winner 非空，平局时什么都不弹，
     * 屏幕上只剩一层压暗的遮罩，看起来像"卡住了"。 */
    if (world.over && !world.overShown) {
      world.overShown = true;
      if (world.winner) {
        bigOverlay(world.winner.name + " 胜利！", world.winner.color);
      } else {
        bigOverlay("无人胜出", "#9aa7bd");
      }
    }
  }

  // 背景光斑漂移
  for (var k = 0; k < world.decor.length; k++) {
    var d = world.decor[k];
    d.x += d.vx * dt; d.y += d.vy * dt;
    if (d.x < 0 || d.x > world.arena) d.vx *= -1;
    if (d.y < 0 || d.y > world.arena) d.vy *= -1;
  }

  // 摄像机（跟随模式）平滑推进
  world.updateCamera(dt);
  tickCamera();

  // 震屏（在 dpr 变换之后叠加，drawWorld 内部会 save/restore）
  var g = world.ctx;
  if (g) {
    g.setTransform(world.dpr, 0, 0, world.dpr, 0, 0);
    if (world.shakeAmt > 0.3) {
      var s = world.shakeAmt;
      g.translate(rand(-s, s), rand(-s, s));
      world.shakeAmt *= window.MA.CONFIG.render.shakeDecay;
    } else {
      world.shakeAmt = 0;
    }
  }

  // UI 不必每个绘制帧都改 DOM；独立限频减少样式/布局开销。
  rosterAccumulator += dt;
  if (rosterAccumulator >= 1 / window.MA.CONFIG.render.rosterUpdateHz) {
    rosterAccumulator = 0;
    updateRoster();
  }
  drawWorld(world);
  scheduleLoop();
}
window.addEventListener("visibilitychange", function () {
  if (document.hidden) {
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = 0; }
  } else {
    last = performance.now();
    wakeRenderLoop();
  }
});
requestLoopFrame();
