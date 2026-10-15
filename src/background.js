/* =========================================================================
 * src/background.js —— 三层背景系统
 * -------------------------------------------------------------------------
 *   外层 outer   铺满擂台之外的所有区域（镜头拉远/贴边时看到的就是它）
 *   边框 border  夹在内层与外层之间的一条带，厚度可调
 *   内层 inner   擂台方块本身
 *
 * 三层都支持：缩放(scale) / 偏移(offsetX,Y) / 透明度(opacity) / 高斯模糊(blur)
 *   缩放与偏移是给「纹理对齐」用的：换了贴图发现接缝错位时微调即可。
 *   模糊用 ctx.filter（离屏缓存）实现，改参数才重建，正常帧不额外开销。
 * ========================================================================= */
"use strict";

window.MA = window.MA || {};

(function () {
  var THEMES = {
    neon: {
      label: "霓虹擂台", top: "#0a1024", mid: "#0d1430", bottom: "#120b26",
      glow: "#7fb0ff", grid: "rgba(120,170,255,.075)", pageA: "#1a2450", pageB: "#2a1140",
      edge: "#6ee7ff", edge2: "#a78bfa"
    },
    sunset: {
      label: "熔岩黄昏", top: "#24101d", mid: "#301526", bottom: "#140d21",
      glow: "#ff8b68", grid: "rgba(255,161,120,.09)", pageA: "#5a2031", pageB: "#32132f",
      edge: "#ffb03a", edge2: "#ff5d5d"
    },
    ocean: {
      label: "深海蓝调", top: "#061a2a", mid: "#09243b", bottom: "#101733",
      glow: "#56d8e8", grid: "rgba(96,220,240,.08)", pageA: "#103d5a", pageB: "#102340",
      edge: "#56d8e8", edge2: "#3b82f6"
    },
    forest: {
      label: "荧光森林", top: "#0b1a18", mid: "#10261e", bottom: "#111b2c",
      glow: "#8de07a", grid: "rgba(143,230,132,.075)", pageA: "#194b35", pageB: "#152c43",
      edge: "#8de07a", edge2: "#4be07a"
    },
    paper: {
      label: "复古纸感", top: "#30271f", mid: "#393026", bottom: "#211d20",
      glow: "#e8bf78", grid: "rgba(240,213,163,.075)", pageA: "#5a4834", pageB: "#3c2b3b",
      edge: "#e8bf78", edge2: "#c084fc"
    }
  };

  /* 支持的图案类型（外层 + 边框共用） */
  var PATTERNS = ["none", "grid", "dots", "rings", "checks", "diagonal", "cross"];
  var BORDER_STYLES = ["glow", "solid", "stripes", "dashes", "grid"];

  var dbPromise = null;
  var customImage = null;     // 用户上传的擂台图
  var projectImage = null;    // config.src 指定的擂台图
  var outerImage = null;      // 外层图
  var borderImage = null;     // 边框图
  var customUrl = "";
  var customName = "";
  var config = window.MA.CONFIG.render.background;
  var activePreset = THEMES[config.preset] ? config.preset : "neon";
  var persisted = false;
  var loadToken = 0;
  var initPromise = null;

  /* ---------- 每层一个离屏画布缓存（含模糊结果） ---------- */
  function makeLayer() {
    var cv = document.createElement("canvas");
    return { canvas: cv, ctx: cv.getContext("2d"), stamp: "", w: 0, h: 0 };
  }
  var innerLayer = makeLayer();
  var borderLayer = makeLayer();
  var outerLayer = makeLayer();

  function invalidate() {
    innerLayer.stamp = "";
    borderLayer.stamp = "";
    outerLayer.stamp = "";
  }

  /* ---------- 工具 ---------- */
  function shade(hex, amt) {
    if (typeof hex !== "string" || hex.charAt(0) !== "#") return hex;
    var n = parseInt(hex.slice(1), 16);
    if (isNaN(n)) return hex;
    var r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
    var g2 = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    var b = Math.max(0, Math.min(255, (n & 255) + amt));
    return "#" + ((r << 16) | (g2 << 8) | b).toString(16).padStart(6, "0");
  }
  function clamp01(v) {
    v = Number(v);
    if (isNaN(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  function num(v, def) {
    v = Number(v);
    return isNaN(v) ? def : v;
  }
  /* hex → "r,g,b"，方便拼 rgba() */
  function rgbOf(hex, fallback) {
    var h = (typeof hex === "string" && hex.charAt(0) === "#") ? hex : fallback;
    var n = parseInt(String(h).slice(1), 16);
    if (isNaN(n)) n = 0x7fb0ff;
    return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255);
  }
  function clearLayer(L) {
    L.ctx.setTransform(1, 0, 0, 1, 0, 0);
    L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
  }

  /* ---------- 图案绘制（外层与边框共用） ----------
   * 支持 scale / offsetX / offsetY：这三个参数作用于图案本身，
   * 这样"纹理对齐"对图案和贴图都有效（图案通常才是主要纹理）。
   * 注意：图案必须锚定「世界原点」，镜头移动时花纹才不会粘在屏幕上。 */
  function drawPattern(ctx, w, h, o, rgb, alpha, x0, y0) {
    var type = o.pattern || "grid";
    if (type === "none" || PATTERNS.indexOf(type) < 0) return;
    var step = Math.max(6, num(o.patternScale, 46));
    var lw = Math.max(0.4, num(o.patternWidth, 1.2));
    x0 = x0 || 0; y0 = y0 || 0;
    var sc = Math.max(0.05, num(o.scale, 1));
    var ox = num(o.offsetX, 0);
    var oy = num(o.offsetY, 0);

    ctx.save();
    // 用世界原点做锚，把缩放/偏移施加在图案坐标系上
    ctx.translate(x0 + ox, y0 + oy);
    ctx.scale(sc, sc);
    var W = w / sc + Math.abs(ox) / sc + step * 2;
    var H = h / sc + Math.abs(oy) / sc + step * 2;
    ctx.strokeStyle = "rgba(" + rgb + "," + alpha + ")";
    ctx.fillStyle = "rgba(" + rgb + "," + alpha + ")";
    ctx.lineWidth = lw / sc * sc;   // 线宽不随缩放变化，保持视觉一致
    ctx.lineWidth = lw;

    if (type === "grid" || type === "checks") {
      if (type === "grid") {
        ctx.beginPath();
        var nx = Math.ceil(W / step), ny = Math.ceil(H / step);
        for (var i = 0; i <= nx; i++) { ctx.moveTo(i * step, 0); ctx.lineTo(i * step, H); }
        for (var j = 0; j <= ny; j++) { ctx.moveTo(0, j * step); ctx.lineTo(W, j * step); }
        ctx.stroke();
      } else {
        var cx2 = Math.ceil(W / step), cy2 = Math.ceil(H / step);
        for (var ix = 0; ix < cx2; ix++) {
          for (var iy = 0; iy < cy2; iy++) {
            if ((ix + iy) % 2 === 0) ctx.fillRect(ix * step, iy * step, step, step);
          }
        }
      }
    } else if (type === "dots") {
      var r = Math.max(0.6, step * 0.055);
      var ndx = Math.ceil(W / step), ndy = Math.ceil(H / step);
      for (var px = 0; px <= ndx; px++) {
        for (var py = 0; py <= ndy; py++) {
          ctx.beginPath(); ctx.arc(px * step, py * step, r, 0, TAU); ctx.fill();
        }
      }
    } else if (type === "diagonal") {
      var maxD = Math.hypot(W, H) + step * 2;
      ctx.beginPath();
      for (var d = -maxD; d <= W + maxD; d += step) {
        ctx.moveTo(d, 0); ctx.lineTo(d - H, H);
      }
      ctx.stroke();
    } else if (type === "cross") {
      var arm = step * 0.16;
      var kx = Math.ceil(W / step), ky = Math.ceil(H / step);
      ctx.beginPath();
      for (var ax = 0; ax <= kx; ax++) {
        for (var ay = 0; ay <= ky; ay++) {
          var xx = ax * step, yy = ay * step;
          ctx.moveTo(xx - arm, yy); ctx.lineTo(xx + arm, yy);
          ctx.moveTo(xx, yy - arm); ctx.lineTo(xx, yy + arm);
        }
      }
      ctx.stroke();
    } else if (type === "rings") {
      var ccx = w / 2, ccy = h / 2;      // 同心圆锚在区域中心
      var maxR = Math.hypot(w, h) * 0.6;
      ctx.beginPath();
      for (var rr = step; rr < maxR; rr += step) {
        ctx.moveTo(ccx + rr, ccy);
        ctx.arc(ccx, ccy, rr, 0, TAU);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- 图片按 fit 绘制到指定区域 ---------- */
  function drawFitted(ctx, img, x, y, w, h, fit, scale, offX, offY) {
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    fit = fit || "cover";
    if (fit === "stretch") {
      ctx.drawImage(img, x + offX, y + offY, w * scale, h * scale);
      return;
    }
    var base = fit === "contain" ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
    var sc = base * scale;
    var dw = iw * sc, dh = ih * sc;
    ctx.drawImage(img, x + (w - dw) / 2 + offX, y + (h - dh) / 2 + offY, dw, dh);
  }

  /* ======================= 内层：擂台方块 ======================= */
  function buildInner(A) {
    var cfg = config.inner || {};
    var theme = THEMES[activePreset] || THEMES.neon;
    var img = customImage || projectImage;
    var showImage = activePreset === "custom" && !!img;
    var stamp = ["inner", A, activePreset, showImage ? (img.currentSrc || img.src || "i") : "gradient",
      cfg.opacity, cfg.scale, cfg.offsetX, cfg.offsetY, cfg.blur, cfg.vignette,
      config.fit, config.overlay].join("|");
    if (innerLayer.stamp === stamp) return;

    innerLayer.canvas.width = A;
    innerLayer.canvas.height = A;
    var ctx = innerLayer.ctx;
    clearLayer(innerLayer);

    /* 底：主题渐变 */
    var grad = ctx.createLinearGradient(0, 0, A, A);
    grad.addColorStop(0, theme.top);
    grad.addColorStop(0.5, theme.mid);
    grad.addColorStop(1, theme.bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, A, A);

    /* 图（可选） */
    var bl = Math.max(0, num(cfg.blur, 0));
    if (showImage) {
      ctx.save();
      ctx.globalAlpha = clamp01(num(cfg.opacity, 1));
      if (bl > 0) ctx.filter = "blur(" + bl + "px)";
      drawFitted(ctx, img, 0, 0, A, A, config.fit || "cover",
        num(cfg.scale, 1), num(cfg.offsetX, 0), num(cfg.offsetY, 0));
      ctx.restore();
      var ov = clamp01(num(config.overlay, 0.4));
      if (ov > 0) {
        ctx.fillStyle = "rgba(4,7,18," + ov + ")";
        ctx.fillRect(0, 0, A, A);
      }
    } else if (bl > 0) {
      // 没有贴图时，模糊作用于主题渐变本身（让用户可以柔化整层）
      // 做法：把已画好的内容取出来，模糊后再画回去
      try {
        var snap = document.createElement("canvas");
        snap.width = snap.height = A;
        var sg = snap.getContext("2d");
        sg.drawImage(innerLayer.canvas, 0, 0);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, A, A);
        ctx.filter = "blur(" + bl + "px)";
        ctx.drawImage(snap, 0, 0);
        ctx.restore();
      } catch (e) { /* 极端情况下忽略，不影响其他层 */ }
    }

    /* 暗角 */
    var vg = clamp01(num(cfg.vignette, 0.42));
    if (vg > 0) {
      var rad = ctx.createRadialGradient(A * 0.5, A * 0.48, A * 0.12, A * 0.5, A * 0.5, A * 0.78);
      rad.addColorStop(0, "rgba(2,5,15,0)");
      rad.addColorStop(1, "rgba(2,5,15," + vg + ")");
      ctx.fillStyle = rad;
      ctx.fillRect(0, 0, A, A);
    }

    innerLayer.stamp = stamp;
    innerLayer.w = innerLayer.h = A;
  }

  /* ======================= 边框层 ======================= */
  /**
   * 边框是一圈"带"：外沿 A + 2*thickness，内沿 A（中间挖空）。
   * 所以它夹在内层（擂台方块）与外层（擂台之外）之间，
   * thickness 就是这一层显示的范围。
   */
  function borderOuter(A) {
    var b = config.border || {};
    return A + 2 * Math.max(0, num(b.thickness, 0));
  }

  function buildBorder(A, time) {
    var b = config.border || {};
    if (b.enabled === false) return 0;
    var t = Math.max(0, num(b.thickness, 26));
    if (t <= 0) return 0;

    var theme = THEMES[activePreset] || THEMES.neon;
    var B = A + 2 * t;
    // pulse 用时间驱动，不能进 stamp（否则每帧重建）。这里分两步：
    // 图案本体按 stamp 缓存；脉动只在绘制时叠一层亮度，不重建缓存。
    // 用「图对象是否存在」判断，而不是 b.src：本地上传的图不写 src
    // （blob: 地址刷新即失效，不该进配置），只体现在 borderImage 上。
    var stamp = ["border", A, t, activePreset, b.style, b.color, b.color2,
      b.opacity, b.scale, b.offsetX, b.offsetY, b.blur,
      borderImage ? (borderImage.currentSrc || borderImage.src || "img") : "",
      b.fit].join("|");
    if (borderLayer.stamp === stamp) return B;

    borderLayer.canvas.width = B;
    borderLayer.canvas.height = B;
    var ctx = borderLayer.ctx;
    clearLayer(borderLayer);

    var c1 = b.color || theme.edge || "#6ee7ff";
    var c2 = b.color2 || theme.edge2 || c1;
    var rgb1 = rgbOf(c1);
    var rgb2 = rgbOf(c2);
    var alpha = clamp01(num(b.opacity, 1));
    var style = b.style || "glow";
    var bl = Math.max(0, num(b.blur, 0));

    /* 内部辅助：只在"环带"内绘制（偶奇填充挖掉中间） */
    function ringPath() {
      ctx.beginPath();
      ctx.rect(0, 0, B, B);
      ctx.rect(t, t, A, A);
      // 用 evenodd 挖空中间
    }
    function clipRing() {
      ctx.beginPath();
      ctx.rect(0, 0, B, B);
      ctx.rect(t, t, A, A);
      ctx.clip("evenodd");
    }

    ctx.save();
    clipRing();
    if (bl > 0) ctx.filter = "blur(" + bl + "px)";
    ctx.globalAlpha = alpha;

    /* --- 1. 底色：从主色到辅色的对角渐变 --- */
    var g = ctx.createLinearGradient(0, 0, B, B);
    g.addColorStop(0, c1);
    g.addColorStop(0.5, c2);
    g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, B, B);

    /* --- 2. 样式叠加（受 scale/offset 影响，便于纹理对齐） --- */
    // 把样式绘制放进一个可缩放/平移的坐标系里居中
    ctx.save();
    var bsc = Math.max(0.05, num(b.scale, 1));
    var box = num(b.offsetX, 0), boy = num(b.offsetY, 0);
    // 以边框中心为基准缩放，保证缩放时不会跑偏
    ctx.translate(B / 2 + box, B / 2 + boy);
    ctx.scale(bsc, bsc);
    ctx.translate(-B / 2, -B / 2);

    if (style === "stripes") {
      var sp = Math.max(6, num(b.patternScale, 22));
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.lineWidth = Math.max(2, sp * 0.28);
      ctx.beginPath();
      for (var d = -B; d <= B * 2; d += sp) { ctx.moveTo(d, 0); ctx.lineTo(d - B, B); }
      ctx.stroke();
    } else if (style === "dashes") {
      // 虚线：沿环带中线画一圈，线宽铺开到环带厚度的 55%。
      // 太细（原来只有 16%）在窄环带上几乎看不见，和 solid 分不出来。
      var dl = Math.max(4, num(b.patternScale, 14));
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = Math.max(2, t * 0.55);
      ctx.setLineDash([dl, dl * 0.8]);
      ctx.beginPath();
      ctx.rect(t / 2, t / 2, B - t, B - t);
      ctx.stroke();
      ctx.restore();
      // 再叠一圈细实线，让虚线有"卡在轨道上"的观感
      ctx.save();
      ctx.strokeStyle = "rgba(0,0,0,.30)";
      ctx.lineWidth = Math.max(1, t * 0.08);
      ctx.strokeRect(t * 0.72, t * 0.72, B - t * 1.44, B - t * 1.44);
      ctx.restore();
    } else if (style === "grid") {
      drawPattern(ctx, B, B, {
        pattern: "grid",
        patternScale: Math.max(8, num(b.patternScale, 20)),
        patternWidth: 1.1,
        scale: 1,                 // 已经在外层坐标系里缩放过了
        offsetX: 0, offsetY: 0
      }, "255,255,255", 0.22, 0, 0);
    } else if (style === "glow") {
      // 发光样式：中间亮、两边暗的垂直渐变，形成"灯带"观感
      var lg = ctx.createLinearGradient(0, 0, 0, B);
      lg.addColorStop(0, "rgba(255,255,255,0)");
      lg.addColorStop(0.14, "rgba(255,255,255,.55)");
      lg.addColorStop(0.5, "rgba(255,255,255,.9)");
      lg.addColorStop(0.86, "rgba(255,255,255,.55)");
      lg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, B, B);
      ctx.restore();
    }
    ctx.restore();

    /* --- 3. 边框图片（可选，盖在底色上） --- */
    if (borderImage) {
      ctx.globalAlpha = alpha * 0.92;
      drawFitted(ctx, borderImage, 0, 0, B, B, b.fit || "stretch",
        num(b.scale, 1), num(b.offsetX, 0), num(b.offsetY, 0));
      ctx.globalAlpha = alpha;
    }

    /* --- 4. 内外边缘描线，让"范围"看得清楚 --- */
    ctx.globalAlpha = alpha * 0.85;
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.lineWidth = Math.max(1, t * 0.06);
    ctx.strokeRect(t, t, A, A);          // 内沿（贴着擂台方块）
    ctx.strokeStyle = "rgba(0,0,0,.35)";
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, B - ctx.lineWidth, B - ctx.lineWidth); // 外沿

    ctx.restore();
    borderLayer.stamp = stamp;
    borderLayer.w = borderLayer.h = B;
    return B;
  }

  /* ======================= 外层 ======================= */
  function buildOuter(view, A) {
    var o = config.outer || {};
    var theme = api.outerTheme();
    var m = num(o.margin, 0.6) * A;
    var x0 = Math.min(-m, view.x);
    var y0 = Math.min(-m, view.y);
    var x1 = Math.max(A + m, view.x + view.w);
    var y1 = Math.max(A + m, view.y + view.h);
    var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);

    var stamp = ["outer", Math.round(x0), Math.round(y0), Math.round(w), Math.round(h), A,
      o.preset, o.color, o.pattern, o.patternColor, o.patternScale, o.patternWidth,
      o.opacity, o.overlay, o.scale, o.offsetX, o.offsetY, o.blur, o.glow, o.margin,
      // 同边框层：判断依据是图对象，不是 o.src（本地上传的图不写 src）
      outerImage ? (outerImage.currentSrc || outerImage.src || "img") : "",
      o.fit].join("|");
    if (outerLayer.stamp === stamp) {
      return { x: x0, y: y0, w: w, h: h };
    }

    outerLayer.canvas.width = Math.max(1, Math.ceil(w));
    outerLayer.canvas.height = Math.max(1, Math.ceil(h));
    var ctx = outerLayer.ctx;
    clearLayer(outerLayer);

    var alpha = clamp01(num(o.opacity, 1));
    var bl = Math.max(0, num(o.blur, 0));

    ctx.save();
    if (bl > 0) ctx.filter = "blur(" + bl + "px)";
    ctx.globalAlpha = alpha;

    /* --- 1. 底色 --- */
    var base = o.color || theme.pageA || "#101830";
    var baseLit = shade(base, 26);
    var baseLit2 = shade(theme.pageB || base, 22);
    var ov = clamp01(num(o.overlay, 0.42));
    var dim = Math.max(-30, Math.round(2 - ov * 40));
    var og = ctx.createLinearGradient(0, 0, w, h);
    og.addColorStop(0, shade(baseLit, dim - 24));
    og.addColorStop(0.5, shade(baseLit, dim - 8));
    og.addColorStop(1, shade(baseLit2, dim - 28));
    ctx.fillStyle = og;
    ctx.fillRect(0, 0, w, h);

    /* --- 2. 外层图（可选） --- */
    if (outerImage) {
      ctx.globalAlpha = alpha * clamp01(num(o.opacity, 1));
      drawFitted(ctx, outerImage, 0, 0, w, h, o.fit || "cover",
        num(o.scale, 1), num(o.offsetX, 0), num(o.offsetY, 0));
      ctx.globalAlpha = alpha;
      if (ov > 0) {
        ctx.fillStyle = "rgba(4,7,18," + ov + ")";
        ctx.fillRect(0, 0, w, h);
      }
    }

    /* --- 3. 图案 --- */
    var patRGB = rgbOf(o.patternColor || theme.glow || "#8fb8ff", "#8fb8ff");
    var patAlpha = (1 - ov * 0.6) * 1;
    // 图案坐标要跟随世界原点，镜头移动时花纹才不会"粘在屏幕上"
    drawPattern(ctx, w, h, o, patRGB, patAlpha * 0.12, x0, y0);

    /* --- 4. 外圈光晕（相对擂台中心，注意转换到本地坐标） --- */
    if (o.glow !== false) {
      var ccx = A / 2 - x0, ccy = A / 2 - y0;
      var glowR = A * 0.82;
      var vstrength = 0.16 + ov * 0.26;
      var vg = ctx.createRadialGradient(ccx, ccy, A * 0.52, ccx, ccy, glowR);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(0.7, "rgba(2,5,15," + (vstrength * 0.5).toFixed(3) + ")");
      vg.addColorStop(1, "rgba(2,5,15," + vstrength.toFixed(3) + ")");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.restore();
    outerLayer.stamp = stamp;
    outerLayer.w = Math.ceil(w);
    outerLayer.h = Math.ceil(h);
    return { x: x0, y: y0, w: w, h: h };
  }

  /* ======================= IndexedDB（各层自选图） =======================
   * 三层各自存一张：内层沿用历史键名 "custom"（老存档还能读出来），
   * 外层 / 边框各用一个新键，同一个 object store，不需要升级数据库版本。 */
  var STORE_KEY = { inner: "custom", outer: "outer", border: "border" };

  function openDb() {
    if (!window.indexedDB) return Promise.reject(new Error("浏览器不支持本地背景存储"));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open("meme-arena-local-assets", 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("backgrounds")) db.createObjectStore("backgrounds");
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("打开背景存储失败")); };
    }).catch(function (e) {
      dbPromise = null;
      throw e;
    });
    return dbPromise;
  }
  function storeBlob(key, blob) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("backgrounds", "readwrite");
        tx.objectStore("backgrounds").put(blob, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error || new Error("保存背景失败")); };
      });
    });
  }
  function readBlob(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction("backgrounds", "readonly").objectStore("backgrounds").get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error || new Error("读取背景失败")); };
      });
    });
  }
  function removeStored(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction("backgrounds", "readwrite");
        tx.objectStore("backgrounds").delete(key);
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error || new Error("删除背景失败")); };
      });
    });
  }

  /* ---------- 参数持久化（localStorage，见 src/settings.js） ---------- */
  function saveSettings() {
    if (!window.MA.Settings) return false;
    try { return window.MA.Settings.saveBackground(activePreset); }
    catch (e) {
      console.warn("[背景] 设置保存失败：", e && e.message);
      return false;
    }
  }
  /** 外层 / 边框的图片统一走这里：解码 → 换图 → 存 Blob → 记设置 */
  function setLayerBlob(layer, blob, persist) {
    var key = STORE_KEY[layer];
    if (!key) return Promise.reject(new Error("未知图层：" + layer));
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        if (layer === "outer") outerImage = img;
        else borderImage = img;
        invalidate();
        if (!persist) { resolve(true); return; }
        storeBlob(key, blob).then(function () {
          saveSettings();
          resolve(true);
        }, function (e) {
          // 图已经在本次打开期间生效，只是没能跨刷新保存 —— 不当作失败
          console.warn("[背景] " + layer + " 图未能持久保存：", e && e.message);
          saveSettings();
          resolve(true);
        });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("图片解码失败，请换一张 PNG/JPG/WEBP/GIF 图片"));
      };
      img.src = url;
    });
  }

  function setCustomBlob(blob, persist) {
    var token = ++loadToken;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        if (token !== loadToken) { URL.revokeObjectURL(url); resolve(false); return; }
        if (customUrl) URL.revokeObjectURL(customUrl);
        customUrl = url;
        customName = (blob && blob.name) || "自选图片";
        customImage = img;
        activePreset = "custom";
        invalidate();
        applyPageTint();
        if (persist) {
          persisted = false;
          storeBlob(STORE_KEY.inner, blob).then(function () {
            persisted = true; saveSettings(); resolve(true);
          }, function (e) {
            console.warn("[背景] 图片已在本次打开期间生效，但未能持久保存：", e);
            saveSettings();
            resolve(true);
          });
        } else { persisted = true; saveSettings(); resolve(true); }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("图片解码失败，请换一张 PNG/JPG/WEBP/GIF 图片"));
      };
      img.src = url;
    });
  }

  function applyPageTint() {
    var t = THEMES[activePreset] || THEMES.neon;
    document.documentElement.style.setProperty("--page-glow-a", t.pageA);
    document.documentElement.style.setProperty("--page-glow-b", t.pageB);
  }

  function loadOne(src, assign, label) {
    if (!src) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { assign(img); invalidate(); resolve(true); };
      img.onerror = function () {
        console.warn("[背景] " + label + "读取失败：" + src);
        resolve(false);
      };
      img.src = src;
    });
  }
  /* 把三层自选图从 IndexedDB 读回来。
   * 逐层独立：某层读失败不影响其它层，也不影响参数（参数走 localStorage）。 */
  function restoreStoredImages() {
    return openDb().then(function (db) {
      function get(key) {
        return new Promise(function (resolve) {
          var req = db.transaction("backgrounds", "readonly").objectStore("backgrounds").get(key);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { resolve(null); };
        });
      }
      var layers = ["inner", "outer", "border"];
      // 注意：查询用的 key 是 STORE_KEY[layer]，不是 layer 本身 ——
      // 内层沿用的是历史键名 "custom"。
      return Promise.all(layers.map(function (name) { return get(STORE_KEY[name]); }))
        .then(function (blobs) {
        var out = {};
        var chain = Promise.resolve();
        layers.forEach(function (name, i) {
          var blob = blobs[i];
          if (!blob) { out[name] = false; return; }
          chain = chain.then(function () {
            var fn = name === "inner"
              ? setCustomBlob(blob, false)
              : setLayerBlob(name, blob, false);
            return fn.then(function () { out[name] = true; }, function () { out[name] = false; });
          });
        });
        return chain.then(function () { return out; });
      });
    }).catch(function (e) {
      console.info("[背景] 本地图片存储不可用，自选图仍可在本次会话使用：", e && e.message);
      return { inner: false, outer: false, border: false };
    });
  }

  /* ======================= 对外 API ======================= */
  var api = {
    themes: THEMES,
    patterns: PATTERNS,
    borderStyles: BORDER_STYLES,

    get preset() { return activePreset; },
    get hasCustomImage() { return !!customImage; },
    get isPersisted() { return persisted; },
    get hasProjectImage() { return !!projectImage; },
    get hasOuterImage() { return !!outerImage; },
    get hasBorderImage() { return !!borderImage; },

    theme: function () { return THEMES[activePreset] || THEMES.neon; },
    outerTheme: function () {
      var o = config.outer || {};
      if (o.preset && o.preset !== "auto" && THEMES[o.preset]) return THEMES[o.preset];
      return THEMES[activePreset] || THEMES.neon;
    },
    /** 边框层的外延尺寸（渲染层用来判断是否需要限制镜头） */
    borderOuter: function (A) { return borderOuter(A); },

    setPreset: function (name) {
      if (name === "custom") {
        if (!customImage && !projectImage) return false;
        activePreset = "custom";
      } else if (THEMES[name]) {
        activePreset = name;
      } else return false;
      invalidate();
      applyPageTint();
      saveSettings();
      return true;
    },

    setFile: function (file) {
      if (!file) return Promise.resolve(false);
      var maxBytes = config.maxUploadBytes || (12 * 1024 * 1024);
      if (file.size > maxBytes) {
        return Promise.reject(new Error("图片超过 " + Math.round(maxBytes / 1024 / 1024) + " MB，请先压缩后再试"));
      }
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        return Promise.reject(new Error("仅支持 PNG、JPG、WEBP 或 GIF 图片"));
      }
      return setCustomBlob(file, true);
    },

    /** 给外层 / 边框换图并持久保存（界面上的"给该层换图"走这里） */
    setLayerFile: function (layer, file) {
      if (layer !== "outer" && layer !== "border") return Promise.reject(new Error("该层不支持换图"));
      if (!file) return Promise.resolve(false);
      var maxBytes = config.maxUploadBytes || (12 * 1024 * 1024);
      if (file.size > maxBytes) {
        return Promise.reject(new Error("图片超过 " + Math.round(maxBytes / 1024 / 1024) + " MB，请先压缩后再试"));
      }
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        return Promise.reject(new Error("仅支持 PNG、JPG、WEBP 或 GIF 图片"));
      }
      return setLayerBlob(layer, file, true);
    },

    reset: function () {
      ++loadToken;
      if (customUrl) URL.revokeObjectURL(customUrl);
      customUrl = "";
      customImage = null;
      persisted = false;
      // 三层的内存图都要清掉，否则界面看起来毫无变化
      outerImage = null;
      borderImage = null;
      if (projectImage) activePreset = "custom";
      else activePreset = THEMES[config.preset] ? config.preset : "neon";
      invalidate();
      applyPageTint();
      // 参数存档一并清掉：不然刷新之后又变回"上一次的设置"，
      // 用户会觉得"恢复默认没生效"。
      if (window.MA.Settings) window.MA.Settings.clear();
      return Promise.resolve(initPromise).catch(function () {}).then(function () {
        return Promise.all([
          removeStored(STORE_KEY.inner).catch(function () {}),
          removeStored(STORE_KEY.outer).catch(function () {}),
          removeStored(STORE_KEY.border).catch(function () {})
        ]);
      }).catch(function () {});
    },

    init: function () {
      if (initPromise) return initPromise;
      applyPageTint();
      initPromise = Promise.resolve()
        .then(function () { return loadOne(config.src, function (i) { projectImage = i; }, "擂台图"); })
        .then(function (hasProject) {
          var o = config.outer || {};
          var b = config.border || {};
          return loadOne(o.src, function (i) { outerImage = i; }, "外层图")
            .then(function () { return loadOne(b.src, function (i) { borderImage = i; }, "边框图"); })
            .then(function () { return hasProject; });
        })
        .then(function (hasProject) {
          return restoreStoredImages().then(function (hasStored) {
            /* 主题优先级：本地上传的内层图 > 存档里的主题 > 项目图 > 配置默认。
             * 存档里的 preset 是用户上次明确选的，必须尊重它，
             * 否则"背景图的切换"又会在刷新后弹回默认。 */
            var saved = window.MA.Settings && window.MA.Settings.savedBackground;
            var savedPreset = saved && saved.preset;
            if (hasStored.inner) {
              activePreset = "custom";
            } else if (savedPreset === "custom" && (customImage || projectImage)) {
              activePreset = "custom";
            } else if (savedPreset && THEMES[savedPreset]) {
              activePreset = savedPreset;
            } else if (hasProject) {
              activePreset = "custom";
            } else {
              activePreset = THEMES[config.preset] ? config.preset : "neon";
            }
            applyPageTint();
            return activePreset;
          });
        });
      return initPromise;
    },

    invalidate: invalidate,

    /**
     * 绘制三层背景。
     * 必须在渲染层已经套好摄像机变换之后调用（这里用世界坐标）。
     *
     * @param g     主画布上下文
     * @param A     擂台边长
     * @param view  当前可见的世界矩形 {x,y,w,h}
     * @param time  世界时间（边框脉动用）
     */
    drawAll: function (g, A, view, time) {
      var theme = THEMES[activePreset] || THEMES.neon;

      /* ---- 第 1 层：外层（铺满可见区域，最底） ---- */
      var oRect = buildOuter(view, A);
      g.drawImage(outerLayer.canvas, oRect.x, oRect.y, oRect.w, oRect.h);

      /* ---- 第 2 层：边框（夹在内外之间） ---- */
      var bo = buildBorder(A, time);
      if (bo > 0) {
        var b = config.border || {};
        var t = bo / 2 - A / 2;      // thickness
        g.save();
        // 脉动：只在绘制时叠加一层同色光，不重建缓存
        var pulse = clamp01(num(b.pulse, 0.35));
        g.drawImage(borderLayer.canvas, -t, -t, bo, bo);
        if (pulse > 0) {
          var ph = 0.5 + Math.sin((time || 0) * 2.2) * 0.5;   // 0..1
          if (ph > 0.02) {
            g.save();
            g.globalCompositeOperation = "lighter";
            g.globalAlpha = pulse * ph * 0.30;
            g.drawImage(borderLayer.canvas, -t, -t, bo, bo);
            g.restore();
          }
        }
        // 向外发光
        var gl = Math.max(0, num(b.glow, 10));
        if (gl > 0) {
          g.save();
          g.globalAlpha = 0.5;
          g.shadowColor = rgbOf(b.color || theme.edge, theme.edge);
          g.shadowBlur = gl;
          g.drawImage(borderLayer.canvas, -t, -t, bo, bo);
          g.restore();
        }
        g.restore();
      }

      /* ---- 第 3 层：内层（擂台方块，最上） ---- */
      buildInner(A);
      var innerCfg = config.inner || {};
      g.save();
      g.globalAlpha = clamp01(num(innerCfg.opacity, 1));
      g.drawImage(innerLayer.canvas, 0, 0, A, A);
      g.restore();

      return theme;
    },

    /** 兼容旧接口：只画内层 */
    draw: function (g, size) {
      buildInner(size);
      g.drawImage(innerLayer.canvas, 0, 0, size, size);
      return THEMES[activePreset] || THEMES.neon;
    },

    /** 兼容旧接口 */
    drawOuter: function (g, A, view) {
      var r = buildOuter(view, A);
      g.drawImage(outerLayer.canvas, r.x, r.y, r.w, r.h);
    },

    loadOuterImage: function () {
      return loadOne((config.outer || {}).src, function (i) { outerImage = i; }, "外层图");
    },
    loadBorderImage: function () {
      return loadOne((config.border || {}).src, function (i) { borderImage = i; }, "边框图");
    },

    /** 直接给某一层换图（不走文件选择器时用，比如测试注入） */
    setLayerImage: function (layer, img) {
      if (layer === "outer") outerImage = img;
      else if (layer === "border") borderImage = img;
      else if (layer === "inner") { customImage = img; activePreset = "custom"; applyPageTint(); }
      invalidate();
      return true;
    },

    /**
     * 清除某一层已载入的图片。
     * 恢复默认时必须调用：只重置 config 里的 src 是不够的，
     * 内存里的 Image 对象还在，界面看起来完全没变化。
     * 同时删掉 IndexedDB 里的存档，否则刷新之后图又回来了。
     */
    clearLayerImage: function (layer) {
      if (layer === "outer") outerImage = null;
      else if (layer === "border") borderImage = null;
      else if (layer === "inner") {
        if (customUrl) URL.revokeObjectURL(customUrl);
        customUrl = "";
        customImage = null;
        // 内层清掉自选图后回到项目图或主题
        if (projectImage) activePreset = "custom";
        else if (THEMES[config.preset]) activePreset = config.preset;
        applyPageTint();
      }
      if (config[layer] && typeof config[layer] === "object") config[layer].src = "";
      invalidate();
      if (STORE_KEY[layer]) removeStored(STORE_KEY[layer]).catch(function () {});
      saveSettings();
      return true;
    },

    /** 取某一层当前用的图（测试与调试用） */
    layerImage: function (layer) {
      if (layer === "outer") return outerImage;
      if (layer === "border") return borderImage;
      return customImage || projectImage;
    }
  };

  window.MA.Background = api;
})();
