/* =========================================================================
 * src/settings.js —— 本地持久化（localStorage）
 * -------------------------------------------------------------------------
 * 背景三层的滑块/下拉以前只改内存里的 CONFIG，刷新就全丢；只有内层自选图
 * 因为写进了 IndexedDB 才留了下来。这个模块补上「参数」那一半：
 *
 *   · 读取：把存档合并回 CONFIG。必须在 background.js 之前执行 ——
 *     background.js 在自己的 IIFE 里就捕获了 config 引用。
 *   · 写入：只存白名单字段，绝不存 src —— 那是运行时生成的 blob: URL，
 *     刷新后必然失效。图片本身由 background.js 存成 Blob 进 IndexedDB。
 *
 * localStorage 在 file:// 下同样可用（同一 origin = file://），
 * 所以「双击 index.html」这种玩法也能跨刷新保留设置。
 * ========================================================================= */
"use strict";

window.MA = window.MA || {};

(function () {
  var KEY = "meme-arena:settings:v1";
  var VERSION = 1;

  /* 隐私模式 / 禁用 Cookie 时 localStorage 会直接抛异常，先探一次 */
  var available = (function () {
    try {
      var probe = "__ma_ls_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return true;
    } catch (e) {
      console.info("[设置] localStorage 不可用，设置仅在本次打开期间有效：", e && e.message);
      return false;
    }
  })();

  var memory = {};   // localStorage 不可用时的会话内兜底，保证接口行为一致

  function readAll() {
    if (!available) return memory;
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return {};
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
      return obj;
    } catch (e) {
      console.warn("[设置] 本地存档损坏，已按默认值处理：", e && e.message);
      return {};
    }
  }

  function writeAll(obj) {
    if (!available) { memory = obj; return false; }
    try {
      window.localStorage.setItem(KEY, JSON.stringify(obj));
      return true;
    } catch (e) {
      console.warn("[设置] 写入本地存档失败（可能是隐私模式或空间不足）：", e && e.message);
      return false;
    }
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /* ---- 需要持久化的背景字段白名单 ----
   * 刻意不含 src：见文件头说明。加字段时同时改这里和 data/config.js 即可。 */
  var TOP_FIELDS = ["fit", "overlay"];
  var LAYER_FIELDS = {
    outer: ["preset", "color", "fit", "pattern", "patternColor", "patternScale",
      "patternWidth", "opacity", "overlay", "scale", "offsetX", "offsetY",
      "blur", "glow", "margin"],
    border: ["enabled", "thickness", "style", "fit", "color", "color2",
      "opacity", "scale", "offsetX", "offsetY", "blur", "glow", "pulse"],
    inner: ["enabled", "opacity", "scale", "offsetX", "offsetY", "blur", "vignette"]
  };

  /* 出厂默认值快照：必须在 applyBackground() 之前拍下来。
   * 界面上的「该层恢复默认」要回到出厂值，而不是"上次存档的值"。 */
  var factoryBackground = clone(
    (window.MA.CONFIG && window.MA.CONFIG.render && window.MA.CONFIG.render.background) || {}
  );

  /* 按出厂值的类型做一次校验，避免存档里的脏数据（字符串塞进数字字段、
   * 或者旧版本残留的字段）污染配置。类型对不上就整条丢弃。 */
  function coerce(ref, v) {
    if (v === undefined || v === null) return undefined;
    if (typeof ref === "number") {
      var n = Number(v);
      return isFinite(n) ? n : undefined;
    }
    if (typeof ref === "boolean") {
      if (typeof v === "boolean") return v;
      if (v === 1 || v === "1" || v === "true") return true;
      if (v === 0 || v === "0" || v === "false") return false;
      return undefined;
    }
    if (typeof ref === "string") return typeof v === "string" ? v : undefined;
    // 出厂值里没有这个字段 → 不认，直接忽略（向前兼容：删掉字段就自动失效）
    return undefined;
  }

  /** 把存档里的背景参数合并进 CONFIG，返回存档记录（含 preset）供调用方判断 */
  function applyBackground() {
    var saved = readAll().background;
    if (!saved || typeof saved !== "object") return null;
    var bg = window.MA.CONFIG && window.MA.CONFIG.render && window.MA.CONFIG.render.background;
    if (!bg) return null;

    var top = saved.top || {};
    TOP_FIELDS.forEach(function (k) {
      var v = coerce(factoryBackground[k], top[k]);
      if (v !== undefined) bg[k] = v;
    });

    var layers = saved.layers || {};
    Object.keys(LAYER_FIELDS).forEach(function (name) {
      var dst = bg[name];
      var src = layers[name];
      if (!dst || !src || typeof src !== "object") return;
      var refs = factoryBackground[name] || {};
      LAYER_FIELDS[name].forEach(function (k) {
        var v = coerce(refs[k], src[k]);
        if (v !== undefined) dst[k] = v;
      });
    });
    return saved;
  }

  /** 从 CONFIG 拍一张背景快照（白名单字段） */
  function captureBackground(preset) {
    var bg = (window.MA.CONFIG && window.MA.CONFIG.render && window.MA.CONFIG.render.background) || {};
    var out = { preset: preset || "", top: {}, layers: {} };
    TOP_FIELDS.forEach(function (k) { if (bg[k] !== undefined) out.top[k] = bg[k]; });
    Object.keys(LAYER_FIELDS).forEach(function (name) {
      var src = bg[name] || {}, dst = {};
      LAYER_FIELDS[name].forEach(function (k) { if (src[k] !== undefined) dst[k] = src[k]; });
      out.layers[name] = dst;
    });
    return out;
  }

  /* =======================================================================
   * 角色参数覆盖（网页里「角色调参」面板改的那些）
   * -----------------------------------------------------------------------
   * 直接写进 MA.CHARACTERS 的模板对象；这里负责读回来 + 存下去。
   * 投掷型角色的投掷物参数放在 tpl.throw 上（见 makeThrower），
   * 所以要分成普通字段和 throw 两组，避免 "radius" 这种同名键互相踩。
   * ======================================================================= */
  var CHAR_FIELDS = ["hp", "atk", "def", "spd", "radius", "cooldown", "skillRange"];
  var THROW_FIELDS = ["dmg", "speed", "size", "radius", "bounce",
                      "bounceDamp", "life", "spin", "spread", "aim", "lead"];

  /** 把存档里的角色参数合并回模板（按当前值类型校验） */
  function applyChars() {
    var saved = readAll().chars;
    if (!saved || typeof saved !== "object") return null;
    var list = (window.MA && window.MA.CHARACTERS) || [];
    var applied = 0;
    for (var i = 0; i < list.length; i++) {
      var tpl = list[i];
      var s = saved[tpl.id];
      if (!tpl || !s || typeof s !== "object") continue;
      CHAR_FIELDS.forEach(function (k) {
        var v = coerce(typeof tpl[k] === "number" ? tpl[k] : 0, s[k]);
        if (v !== undefined) tpl[k] = v;
      });
      if (tpl["throw"] && s["throw"] && typeof s["throw"] === "object") {
        THROW_FIELDS.forEach(function (k) {
          var ref = typeof tpl["throw"][k] === "number" ? tpl["throw"][k] : 0;
          var v = coerce(ref, s["throw"][k]);
          if (v !== undefined) tpl["throw"][k] = v;
        });
      }
      applied++;
    }
    return applied ? saved : null;
  }

  /** 从模板拍一张快照（只存白名单里的数字字段） */
  function captureChars() {
    var out = {};
    var list = (window.MA && window.MA.CHARACTERS) || [];
    for (var i = 0; i < list.length; i++) {
      var tpl = list[i];
      if (!tpl || !tpl.id) continue;
      var o = {};
      CHAR_FIELDS.forEach(function (k) { if (typeof tpl[k] === "number") o[k] = tpl[k]; });
      if (tpl["throw"]) {
        var th = {};
        THROW_FIELDS.forEach(function (k) {
          if (typeof tpl["throw"][k] === "number") th[k] = tpl["throw"][k];
        });
        o["throw"] = th;
      }
      out[tpl.id] = o;
    }
    return out;
  }

  /** 保存角色参数（改动即刻落盘，不走防抖） */
  function saveChars() {
    var all = readAll();
    all.v = VERSION;
    all.chars = captureChars();
    return writeAll(all);
  }

  /** 把某个角色的参数恢复成出厂值（写回模板 + 落盘）。
   * snapshot 就是 factoryChars[id] 那份快照。 */
  function resetChar(id, snapshot) {
    var tpl = null;
    var list = (window.MA && window.MA.CHARACTERS) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) tpl = list[i];
    if (!tpl || !snapshot || typeof snapshot !== "object") return false;
    CHAR_FIELDS.forEach(function (k) {
      if (typeof snapshot[k] === "number") tpl[k] = snapshot[k];
    });
    if (tpl["throw"] && snapshot["throw"]) {
      THROW_FIELDS.forEach(function (k) {
        if (typeof snapshot["throw"][k] === "number") tpl["throw"][k] = snapshot["throw"][k];
      });
    }
    saveChars();
    return true;
  }

  /* =======================================================================
   * 摄像机 / 显示尺寸
   * -----------------------------------------------------------------------
   * 这几个值以前改完就丢：缩放调好了，一刷新又弹回默认，很别扭。
   * 同样按白名单 + 类型校验，避免脏存档污染配置。
   * ======================================================================= */
  var CAMERA_FIELDS = ["mode", "followZoom", "edgePadding"];
  var DISPLAY_FIELDS = ["unitScale", "hpBarScale", "hpBarShowValue"];

  var factoryCamera = clone((window.MA.CONFIG && window.MA.CONFIG.camera) || {});
  var factoryDisplay = clone((window.MA.CONFIG && window.MA.CONFIG.display) || {});
  /* 角色模板的出厂快照：必须在 applyChars() 之前拍，否则"恢复默认"会恢复成上次存档 */
  var factoryChars = null;

  /** 合并某个 CONFIG 子对象（按出厂值类型校验） */
  function mergeInto(target, factory, fields, saved) {
    if (!target || !saved || typeof saved !== "object") return;
    fields.forEach(function (k) {
      var v = coerce(factory[k], saved[k]);
      if (v !== undefined) target[k] = v;
    });
  }

  function applyCamera() {
    var saved = readAll().camera;
    if (!saved || typeof saved !== "object") return null;
    var cam = window.MA.CONFIG && window.MA.CONFIG.camera;
    mergeInto(cam, factoryCamera, CAMERA_FIELDS, saved);
    return saved;
  }

  function applyDisplay() {
    var saved = readAll().display;
    if (!saved || typeof saved !== "object") return null;
    var dsp = window.MA.CONFIG && window.MA.CONFIG.display;
    mergeInto(dsp, factoryDisplay, DISPLAY_FIELDS, saved);
    return saved;
  }

  function captureCamera() {
    var cam = (window.MA.CONFIG && window.MA.CONFIG.camera) || {};
    var out = {};
    CAMERA_FIELDS.forEach(function (k) { if (cam[k] !== undefined) out[k] = cam[k]; });
    return out;
  }
  function captureDisplay() {
    var dsp = (window.MA.CONFIG && window.MA.CONFIG.display) || {};
    var out = {};
    DISPLAY_FIELDS.forEach(function (k) { if (dsp[k] !== undefined) out[k] = dsp[k]; });
    return out;
  }

  /** 保存全部设置（立即落盘）。
   * preset 由 background.js 传入（主题状态在它内部）。
   * 刻意只留这一个写入口：背景、摄像机、显示尺寸若各写各的，
   * 后写的那次会用自己读到的旧快照覆盖前一次，导致设置互相丢失。 */
  function saveAll(preset) {
    var all = readAll();
    all.v = VERSION;
    all.background = captureBackground(preset);
    all.camera = captureCamera();
    all.display = captureDisplay();
    all.chars = captureChars();
    return writeAll(all);
  }

  /* ---- 防抖保存 ----
   * 滑块是高频事件，拖动过程中不写，停手 250ms 才落盘。
   * 这个定时器由本模块持有（而不是放在 ui.js）：因为 clear() 必须能
   * 取消掉"还没触发的那次写入" —— 否则「恢复默认」刚清空存档，
   * 250ms 后那个待触发的定时器又把旧值写回去，刷新一下"默认"就没了。 */
  var saveTimer = 0;
  function cancelPendingSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
  }
  function saveSoon(preset) {
    cancelPendingSave();
    saveTimer = setTimeout(function () {
      saveTimer = 0;
      saveAll(preset);
    }, 250);
  }
  /** 把待写入的保存立刻落盘（刷新/切后台时用，避免"刚调完就刷新"丢失） */
  function flushPendingSave(preset) {
    if (!saveTimer) return;
    cancelPendingSave();
    saveAll(preset);
  }

  /** 保存背景设置（preset 由 background.js 传入，因为主题状态在它内部） */
  function saveBackground(preset) { return saveAll(preset); }

  window.MA.Settings = {
    KEY: KEY,
    VERSION: VERSION,
    available: available,
    factoryBackground: factoryBackground,
    factoryCamera: factoryCamera,
    factoryDisplay: factoryDisplay,
    factoryChars: null,          // 下面 applyChars() 之前填
    readAll: readAll,
    writeAll: writeAll,
    applyBackground: applyBackground,
    captureBackground: captureBackground,
    saveBackground: saveBackground,
    applyCamera: applyCamera,
    applyDisplay: applyDisplay,
    captureCamera: captureCamera,
    captureDisplay: captureDisplay,
    applyChars: applyChars,
    captureChars: captureChars,
    saveChars: saveChars,
    resetChar: resetChar,
    saveAll: saveAll,
    saveSoon: saveSoon,
    flushPendingSave: flushPendingSave,
    cancelPendingSave: cancelPendingSave,
    /** 清空全部存档（调试与测试用）。
     * 必须先取消待写入的防抖保存，否则它会把刚清掉的内容又写回来。 */
    clear: function () {
      cancelPendingSave();
      memory = {};
      if (!available) return true;
      try { window.localStorage.removeItem(KEY); return true; }
      catch (e) { return false; }
    }
  };

  /* 立即恢复存档 —— 必须赶在 background.js / engine.js 建自己的引用之前。
   * engine.js 的 World 构造函数会读 cfg.camera.mode 与 cfg.display.unitScale，
   * 所以这里必须在 ui.js 里 new World() 之前跑完（脚本顺序已保证）。
   * 角色参数也一样：必须在 World 创建单位之前写回模板。
   * 具体用哪张图 / 哪个主题由 background.js 的 init() 决定。 */
  window.MA.Settings.savedBackground = applyBackground();
  window.MA.Settings.savedCamera = applyCamera();
  window.MA.Settings.savedDisplay = applyDisplay();
  // 先拍出厂快照，再套用存档 —— 顺序反了的话「恢复默认」会恢复成上次存档
  window.MA.Settings.factoryChars = captureChars();
  window.MA.Settings.savedChars = applyChars();
})();
