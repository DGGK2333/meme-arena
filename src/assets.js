/* =========================================================================
 * src/assets.js —— 素材加载：贴图 / 动图 / 音效
 * -------------------------------------------------------------------------
 * 工作方式：
 *   1. 每个角色的素材约定放在 assets/characters/<角色id>/
 *   2. tools/scan-assets.js 会扫描这些文件夹，生成 assets/manifest.js
 *   3. 页面加载时读 manifest + data/characters.js 里的 assets 覆盖项
 *   4. 找不到素材就自动回退到代码绘制的几何图形，永远不会报错
 *
 * 支持槽位（slot）：idle / attack / hurt / dead / icon / skill
 *   - 静态图：.png .jpg .jpeg .webp .svg
 *   - 动态图：.gif（浏览器原生播放，逐帧自动刷新）
 *   - 音效  ：.wav .mp3 .ogg .m4a  放在 sfx/ 子目录，命名 attack/skill/hurt/death
 * ========================================================================= */
"use strict";

window.MA = window.MA || {};

(function () {
  var ROOT = "assets/characters/";
  var IMG_EXT = ["png", "gif", "webp", "jpg", "jpeg", "svg", "avif"];
  var AUD_EXT = ["wav", "mp3", "ogg", "m4a", "aac"];
  var SLOTS = ["idle", "attack", "hurt", "dead", "icon", "skill"];

  var images = {};     // key: "id/slot/索引"  -> { el, ready, failed, url }
  var seqs = {};       // key: "id/slot"       -> { frames: [rec,...], count }
  var sounds = {};     // key: "id/slot"       -> { el, ready, failed, url }
  var pending = 0;

  /* ---------- 路径解析 ---------- */
  function joinPath(dir, file) {
    if (/^(https?:|data:|blob:)/.test(file)) return file;
    if (file.charAt(0) === "/") return file.slice(1);
    if (file.slice(0, 2) === "@/") return file.slice(2);            // @/xxx 相对项目根
    if (file.slice(0, 1) === "@") return file.slice(1);             // @xxx  相对项目根
    return dir + file;                                              // 相对角色文件夹
  }

  /* 找出这个角色某槽位该用哪个文件：
     1) data/characters.js 里手写的 assets 覆盖优先
     2) 否则用自动扫描出来的 manifest
     3) 都没有则返回 null（走几何图形回退）
     返回值可能是：字符串（单张图）或字符串数组（序列帧动画） */
  function resolveFile(tpl, slot) {
    var manual = tpl.assets && tpl.assets[slot];
    if (manual) return manual;
    var man = window.MA.ASSET_MANIFEST && window.MA.ASSET_MANIFEST[tpl.id];
    if (man && man[slot]) return man[slot];
    return null;
  }
  function resolveSfx(tpl, slot) {
    var manual = tpl.assets && tpl.assets.sfx && tpl.assets.sfx[slot];
    if (manual) return manual;
    var man = window.MA.ASSET_MANIFEST && window.MA.ASSET_MANIFEST[tpl.id];
    if (man && man.sfx && man.sfx[slot]) return man.sfx[slot];
    return null;
  }

  /* ---------- 图片 ---------- */
  function loadImage(key, url, onDone) {
    if (images[key]) { if (onDone) onDone(images[key]); return images[key]; }
    var rec = { el: new Image(), ready: false, failed: false, url: url };
    images[key] = rec;
    pending++;
    rec.el.onload = function () {
      rec.ready = true; pending--;
      if (onDone) onDone(rec);
    };
    rec.el.onerror = function () {
      rec.failed = true; pending--;
      console.warn("[素材] 图片加载失败，将使用几何图形回退：" + url);
      if (onDone) onDone(rec);
    };
    rec.el.src = url;
    return rec;
  }

  /* ---------- 序列帧：把一组图片注册成可被游戏循环驱动的动画 ---------- */
  function registerSequence(id, slot, files, baseDir) {
    var frames = [];
    var seq = { frames: frames, count: 0, ready: false };
    seqs[id + "/" + slot] = seq;

    function refresh() {
      seq.count = frames.filter(function (r) { return r.ready; }).length;
      // 前几帧就绪即可开始播，不必等全部加载完（避免慢网卡住）
      seq.ready = seq.count > 0 && seq.count >= Math.min(2, frames.length);
    }

    for (var i = 0; i < files.length; i++) {
      var url = joinPath(baseDir, files[i]);
      var rec = loadImage(id + "/" + slot + "/" + i, url, refresh);
      frames.push(rec);
      if (rec.ready) refresh();
    }
    return seq;
  }

  /* ---------- 音效 ---------- */
  function loadSound(key, url) {
    if (sounds[key]) return;
    var rec = { el: new Audio(), ready: false, failed: false, url: url, voices: 0 };
    sounds[key] = rec;
    pending++;
    rec.el.preload = "auto";
    rec.el.addEventListener("canplaythrough", function () { rec.ready = true; pending--; }, { once: true });
    rec.el.addEventListener("error", function () {
      rec.failed = true; pending--;
      console.warn("[素材] 音效加载失败：" + url);
    }, { once: true });
    rec.el.src = url;
  }

  /* ---------- 对外 API ---------- */
  var Assets = {
    SLOTS: SLOTS,

    /** 预加载全部角色素材（可重复调用，已加载的会跳过） */
    preload: function (characters) {
      var cfg = window.MA.CONFIG;
      for (var i = 0; i < characters.length; i++) {
        var tpl = characters[i];
        var baseDir = ROOT + tpl.id + "/";
        for (var s = 0; s < SLOTS.length; s++) {
          var slot = SLOTS[s];
          var file = resolveFile(tpl, slot);
          if (!file) continue;
          if (Array.isArray(file)) {
            // 序列帧动画：由游戏循环按帧驱动，比 GIF 更可控
            registerSequence(tpl.id, slot, file, baseDir);
          } else {
            loadImage(tpl.id + "/" + slot, joinPath(baseDir, file));
          }
        }
        if (cfg.audio.enabled) {
          var sfxSlots = ["attack", "skill", "hurt", "death", "victory", "draw"];
          for (var k = 0; k < sfxSlots.length; k++) {
            var sf = resolveSfx(tpl, sfxSlots[k]);
            if (!sf) continue;
            loadSound(tpl.id + "/" + sfxSlots[k], joinPath(baseDir, sf));
          }
        }
      }
      return this;
    },

    /** 取已就绪的图片；没有就返回 null（调用方走几何回退） */
    image: function (id, slot) {
      var rec = images[id + "/" + slot];
      return (rec && rec.ready && rec.el.naturalWidth > 0) ? rec.el : null;
    },

    /** 该槽位是不是序列帧动画 */
    isSequence: function (id, slot) {
      var seq = seqs[id + "/" + slot];
      return !!(seq && seq.ready && seq.count > 0);
    },

    /**
     * 取序列帧动画的当前帧（由游戏循环驱动，可控、可测）
     * @param {string} id    角色 id
     * @param {string} slot  槽位
     * @param {number} t     已经过的秒数（一般传世界时间或状态持续时间）
     * @param {number} fps   每秒帧数，默认 8
     */
    frame: function (id, slot, t, fps) {
      var seq = seqs[id + "/" + slot];
      if (!seq || !seq.ready) return null;
      var n = seq.count;
      if (n <= 0) return null;
      var idx = Math.floor((t || 0) * (fps || 8)) % n;
      if (idx < 0) idx = 0;
      // 帧可能有个别加载失败，向前找一个可用的
      for (var k = 0; k < n; k++) {
        var rec = seq.frames[(idx + k) % n];
        if (rec && rec.ready && rec.el.naturalWidth > 0) return rec.el;
      }
      return null;
    },

    /** 这个角色有没有自定义贴图（有的话渲染层就不画几何图形） */
    hasArt: function (id) {
      for (var i = 0; i < SLOTS.length; i++) {
        var slot = SLOTS[i];
        if (this.image(id, slot) || this.isSequence(id, slot)) return true;
      }
      return false;
    },

    /** 是否还有素材在加载中 */
    get loading() { return pending > 0; },

    /** 统计信息，界面上可以展示 */
    stats: function () {
      var img = 0, snd = 0, fail = 0, seqCount = 0;
      for (var k in images) { if (images[k].ready) img++; if (images[k].failed) fail++; }
      for (var s in sounds) { if (sounds[s].ready) snd++; if (sounds[s].failed) fail++; }
      for (var q in seqs) if (seqs[q].ready) seqCount++;
      return { images: img, sounds: snd, failed: fail, sequences: seqCount };
    },

    /** 清空（一般不用调） */
    clear: function () { images = {}; sounds = {}; seqs = {}; }
  };

  window.MA.Assets = Assets;

  /* =======================================================================
   * 音效播放：优先用角色自己的素材；没有素材时用内置合成音效兜底
   * ======================================================================= */
  var actx = null;
  function ensureCtx() {
    if (!window.MA.CONFIG.audio.enabled) return null;
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { actx = new AC(); } catch (e) { return null; }
    }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }

  /* 内置合成音：type = hit / crit / skill / death / spawn / victory / draw
   * 既支持单音扫频（f → f2），也支持一串音符（notes: [[频率, 起始秒, 时长], ...]），
   * 后者用来做胜利号角这种"小旋律"。 */
  var SYNTH = {
    hit:   { f: 300, f2: 160, dur: 0.09, type: "square",   vol: 0.16 },
    crit:  { f: 620, f2: 180, dur: 0.16, type: "sawtooth", vol: 0.22 },
    skill: { f: 520, f2: 900, dur: 0.22, type: "triangle", vol: 0.20 },
    death: { f: 240, f2: 70,  dur: 0.42, type: "sawtooth", vol: 0.22 },
    spawn: { f: 400, f2: 780, dur: 0.14, type: "sine",     vol: 0.14 },
    /* 胜利：上行三音小号角（有冠军时播） */
    victory: { type: "triangle", vol: 0.24,
               notes: [[523.25, 0.00, 0.13],
                       [659.25, 0.11, 0.13],
                       [783.99, 0.22, 0.34]] },
    /* 平局：下行两音（无人胜出时播） */
    draw:    { type: "sine", vol: 0.18,
               notes: [[392.00, 0.00, 0.17],
                       [311.13, 0.16, 0.28]] }
  };

  function synth(name) {
    var c = ensureCtx();
    if (!c) return;
    var p = SYNTH[name] || SYNTH.hit;
    var vol = (p.vol != null ? p.vol : 0.16) * window.MA.CONFIG.audio.volume;
    var t0 = c.currentTime;

    // 多音符：一个音一个振荡器，用极短淡入代替硬起音，避免"啪"的爆音
    if (p.notes) {
      for (var i = 0; i < p.notes.length; i++) {
        var n = p.notes[i];
        var ts = t0 + n[1], nd = n[2];
        var osc = c.createOscillator(), gain = c.createGain();
        osc.type = p.type;
        osc.frequency.setValueAtTime(n[0], ts);
        gain.gain.setValueAtTime(0.0001, ts);
        gain.gain.exponentialRampToValueAtTime(vol, ts + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, ts + nd);
        osc.connect(gain).connect(c.destination);
        osc.start(ts);
        osc.stop(ts + nd + 0.03);
      }
      return;
    }

    var dur = p.dur || 0.12;
    var osc2 = c.createOscillator(), g2 = c.createGain();
    osc2.type = p.type;
    osc2.frequency.setValueAtTime(p.f, t0);
    osc2.frequency.exponentialRampToValueAtTime(Math.max(40, p.f2), t0 + dur);
    g2.gain.setValueAtTime(vol, t0);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc2.connect(g2).connect(c.destination);
    osc2.start(t0);
    osc2.stop(t0 + dur + 0.02);
  }

  var Audio2 = {
    /** 解锁音频（浏览器要求先有用户操作） */
    unlock: function () { ensureCtx(); },

    /**
     * 播放音效
     * @param {string} charId 角色 id（可为 null，表示用内置音）
     * @param {string} slot   attack / skill / hurt / death
     * @param {string} synthName 无素材时用的内置音名
     */
    play: function (charId, slot, synthName) {
      var cfg = window.MA.CONFIG.audio;
      if (!cfg.enabled) return;
      var rec = charId ? sounds[charId + "/" + slot] : null;
      if (rec && rec.ready && !rec.failed) {
        if (rec.voices >= cfg.maxVoices) return;   // 防止同帧叠太多声音
        try {
          var a = rec.el.cloneNode();
          a.volume = cfg.volume;
          rec.voices++;
          a.addEventListener("ended", function () { rec.voices--; }, { once: true });
          var pr = a.play();
          if (pr && pr.catch) pr.catch(function () { rec.voices--; });
          return;
        } catch (e) { /* 掉落到合成音 */ }
      }
      synth(synthName || slot || "hit");
    },

    /** 切换开关 */
    setEnabled: function (on) { window.MA.CONFIG.audio.enabled = !!on; if (on) ensureCtx(); },
    isEnabled: function () { return !!window.MA.CONFIG.audio.enabled; }
  };

  window.MA.Audio = Audio2;
})();
