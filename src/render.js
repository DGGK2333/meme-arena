/* =========================================================================
 * src/render.js —— Canvas 渲染
 * 有贴图就画贴图（支持 gif 动图），没有就画几何图形，两者可混用。
 * ========================================================================= */
"use strict";

/** "#ff3c50" → "255,60,80"，方便拼 rgba() */
function hexToRgb(hex) {
  if (typeof hex !== "string" || hex.charAt(0) !== "#") return "255,60,80";
  var n = parseInt(hex.slice(1), 16);
  if (isNaN(n)) return "255,60,80";
  return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255);
}

/* 判断单位该用哪个贴图槽位 */
function pickSpriteSlot(u, w) {
  if (!u.alive) return "dead";
  if (u.hitFlash > 0.08) return "hurt";          // 刚被打中
  if (u.atkCd > (w.cfg.combat.attackInterval - 0.22)) return "attack";  // 刚出手
  return "idle";
}

/**
 * 取单位当前该画的贴图。
 * 优先级：序列帧（游戏循环驱动，最可控）> 单张静态图/GIF > 退到 idle > icon
 * 返回 { img, isSeq } 或 null
 */
function resolveSprite(u, w, slot) {
  var A = window.MA.Assets;
  if (!A) return null;
  var id = u.tpl.id;

  var trySlot = function (s) {
    if (A.isSequence(id, s)) {
      var img = A.frame(id, s, w.time, 8);
      if (img) return { img: img, isSeq: true };
    }
    var single = A.image(id, s);
    if (single) return { img: single, isSeq: false };
    return null;
  };

  return trySlot(slot) || (slot !== "idle" ? trySlot("idle") : null) || trySlot("icon");
}

function drawWorld(w) {
  var g = w.ctx, A = w.arena;
  if (!g) return;
  var cam = w.cam || { x: A / 2, y: A / 2, zoom: 1, mode: "global" };
  // 只要镜头不是"严格的全局视野"，就需要画外层背景填满可见区域
  var zoomed = Math.abs(cam.zoom - 1) > 0.001;
  var following = cam.mode === "follow";
  var needOuter = zoomed || following;

  g.save();
  // 清屏范围要够大：镜头缩小/贴边时画面会超出擂台方块很多
  var clearPad = Math.max(60, A * (1 / Math.max(cam.zoom, 0.2)) * 0.6 + 120);
  g.clearRect(-clearPad, -clearPad, A + clearPad * 2, A + clearPad * 2);

  // 摄像机变换：把「以 cam 为中心、边长 A/zoom 的世界区域」映射到整块画布
  if (zoomed) {
    g.translate(A / 2, A / 2);
    g.scale(cam.zoom, cam.zoom);
    g.translate(-cam.x, -cam.y);
  }

  /* ---------- 三层背景 ----------
   * 外层（铺满可见区域）→ 边框（夹在内外之间）→ 内层（擂台方块）。
   * 必须在摄像机变换之后调用：背景模块用世界坐标绘制，
   * 这样镜头拉远（zoom<1）或贴边越界时都不会露黑底。 */
  var view = {
    x: cam.x - A / (2 * cam.zoom),
    y: cam.y - A / (2 * cam.zoom),
    w: A / cam.zoom,
    h: A / cam.zoom
  };
  var bgTheme;
  if (window.MA.Background && window.MA.Background.drawAll) {
    bgTheme = window.MA.Background.drawAll(g, A, view, w.time);
  } else if (window.MA.Background) {
    bgTheme = window.MA.Background.draw(g, A);
  } else {
    bgTheme = { glow: "#7fb0ff", grid: "rgba(120,170,255,.075)" };
  }

  // 擂台方块边界：镜头拉远时给个明确的框，让人知道场地范围
  if (needOuter) {
    g.strokeStyle = "rgba(150,190,255,.28)";
    g.lineWidth = 2 / Math.max(cam.zoom, 0.2);
    g.strokeRect(0, 0, A, A);
  }

  // 漂移光斑
  for (var i = 0; i < w.decor.length; i++) {
    var d = w.decor[i];
    g.globalAlpha = d.a;
    g.fillStyle = bgTheme.glow;
    g.beginPath(); g.arc(d.x, d.y, d.r, 0, TAU); g.fill();
  }
  g.globalAlpha = 1;

  // 网格
  g.strokeStyle = bgTheme.grid;
  g.lineWidth = 1;
  var cell = A / 14;
  g.beginPath();
  for (var k = 1; k < 14; k++) {
    g.moveTo(k * cell, 0); g.lineTo(k * cell, A);
    g.moveTo(0, k * cell); g.lineTo(A, k * cell);
  }
  g.stroke();

  /* ---------- 圈外滤镜（毒圈） ----------
   * 整个"圈外区域"的视觉效果，参数全部来自 CONFIG.arena.poisonFx，
   * 侧栏可实时调。用 evenodd 填充"矩形减去圆"得到环形区域。
   *
   * 安全区总开关关闭时（w.zoneOn === false），这一层与边界线都不画，
   * 让特效完全消失，退化成纯擂台。 */
  var zoneOn = w.zoneOn !== false;
  var pf = (window.MA.CONFIG.arena || {}).poisonFx || {};
  if (zoneOn && pf.enabled !== false) {
    var pfOp = clamp(pf.opacity != null ? pf.opacity : 0.16, 0, 1);
    var baseColor = pf.color || "#ff3c50";
    var rgb = hexToRgb(baseColor);
    var t = w.time || 0;
    var pulseK = 1 + (pf.pulse || 0) * Math.sin(t * 2.6) * 0.45;

    g.save();
    // 把整个可见区域涂成圈外，再挖掉安全区
    g.beginPath();
    g.rect(view.x - 4, view.y - 4, view.w + 8, view.h + 8);
    g.arc(w.softX, w.softY, w.softR, 0, TAU, true);
    g.clip("evenodd");

    /* --- 1. 底色填充：可选"由内向外加深"的渐变 --- */
    if (pf.gradient) {
      var gr = g.createRadialGradient(w.softX, w.softY, w.softR,
        w.softX, w.softY, w.softR + Math.max(120, w.arena * 0.55));
      gr.addColorStop(0, "rgba(" + rgb + "," + (pfOp * 0.65 * pulseK).toFixed(3) + ")");
      gr.addColorStop(0.45, "rgba(" + rgb + "," + (pfOp * pulseK).toFixed(3) + ")");
      var rgb2 = hexToRgb(pf.color2 || baseColor);
      gr.addColorStop(1, "rgba(" + rgb2 + "," + Math.min(0.95, pfOp * 1.5 * pulseK).toFixed(3) + ")");
      g.fillStyle = gr;
    } else {
      g.fillStyle = "rgba(" + rgb + "," + (pfOp * pulseK).toFixed(3) + ")";
    }
    g.fillRect(view.x - 4, view.y - 4, view.w + 8, view.h + 8);

    /* --- 2. 扫描线纹理 --- */
    if (pf.scanlines) {
      var step = Math.max(3, w.arena / 170);
      var sa = clamp(pf.scanOpacity != null ? pf.scanOpacity : 0.3, 0, 1) * pfOp * 2.2;
      g.fillStyle = "rgba(0,0,0," + Math.min(0.6, sa).toFixed(3) + ")";
      var sy = Math.floor(view.y / step) * step;
      for (; sy <= view.y + view.h; sy += step) {
        g.fillRect(view.x - 4, sy, view.w + 8, step * 0.5);
      }
    }

    /* --- 3. 噪点颗粒（用确定性伪随机，避免每帧闪烁） --- */
    if (pf.noise) {
      var na = clamp(pf.noiseOpacity != null ? pf.noiseOpacity : 0.22, 0, 1) * pfOp;
      if (na > 0.004) {
        var cellN = Math.max(4, w.arena / 90);
        g.fillStyle = "rgba(255,255,255," + na.toFixed(3) + ")";
        var nx0 = Math.floor(view.x / cellN) * cellN;
        var ny0 = Math.floor(view.y / cellN) * cellN;
        // 用格子坐标做哈希：同一格子每帧颜色相同 → 静态颗粒，不闪
        for (var ny = ny0; ny <= view.y + view.h; ny += cellN) {
          for (var nx = nx0; nx <= view.x + view.w; nx += cellN) {
            var hsh = Math.abs(Math.sin(nx * 12.9898 + ny * 78.233) * 43758.5453) % 1;
            if (hsh > 0.72) {
              g.fillRect(nx, ny, cellN * 0.5, cellN * 0.5);
            }
          }
        }
      }
    }

    /* --- 4. 边界内侧柔化：从安全区往外逐渐透明，
     *        避免"毒圈"边缘生硬。 --- */
    var blurW = Math.max(0, pf.blurEdges != null ? pf.blurEdges : 6);
    if (blurW > 0) {
      var inner = w.softR;
      var outer = w.softR + blurW;
      var sg = g.createRadialGradient(w.softX, w.softY, inner, w.softX, w.softY, outer);
      sg.addColorStop(0, "rgba(0,0,0,1)");
      sg.addColorStop(1, "rgba(0,0,0,0)");
      // 用 destination-out 把紧贴边界的一小圈"擦淡"，形成柔边
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = sg;
      g.fillRect(view.x - 4, view.y - 4, view.w + 8, view.h + 8);
      g.globalCompositeOperation = "source-over";
    }

    g.restore();
  }

  /* ---------- 安全区边界线 ---------- */
  var zr = (window.MA.CONFIG.arena || {}).zoneRing || {};
  if (zoneOn && zr.enabled !== false) {
    var zOp = clamp(zr.opacity != null ? zr.opacity : 0.78, 0, 1);
    var zPulse = 1 - (zr.pulse || 0) * 0.5 + (zr.pulse || 0) * Math.sin(w.time * 3.4) * 0.5;
    var zRgb = hexToRgb(zr.color || "#ff5a6e");
    g.save();
    if (zr.glow > 0) {
      g.shadowColor = "rgba(" + zRgb + ",0.9)";
      g.shadowBlur = zr.glow;
    }
    g.strokeStyle = "rgba(" + zRgb + "," + (zOp * zPulse).toFixed(3) + ")";
    g.lineWidth = zr.width != null ? zr.width : 2.5;
    g.beginPath(); g.arc(w.softX, w.softY, w.softR, 0, TAU); g.stroke();
    g.shadowBlur = 0;

    // 外侧一圈淡白，增强边界辨识度
    g.strokeStyle = "rgba(255,255,255," + (0.10 * zOp).toFixed(3) + ")";
    g.lineWidth = 8;
    g.beginPath(); g.arc(w.softX, w.softY, w.softR + 8, 0, TAU); g.stroke();
    g.restore();
  }

  // 目标连线（主动模式）／速度轨迹（动量模式）
  if (window.MA.CONFIG.ui.showTargetLines) {
    if (w.moveMode === "active") {
      g.setLineDash([5, 7]);
      g.strokeStyle = "rgba(255,255,255,.10)";
      g.lineWidth = 1;
      for (var j = 0; j < w.units.length; j++) {
        var uu = w.units[j];
        if (!uu.alive || !uu.target || !uu.target.alive) continue;
        g.beginPath(); g.moveTo(uu.x, uu.y); g.lineTo(uu.target.x, uu.target.y); g.stroke();
      }
      g.setLineDash([]);
    } else {
      // 动量模式：画一小段速度指示，方便看清谁在往哪冲
      g.lineWidth = 1.5;
      for (var m2 = 0; m2 < w.units.length; m2++) {
        var mu = w.units[m2];
        if (!mu.alive) continue;
        var sp = Math.hypot(mu.vx, mu.vy);
        if (sp < 30) continue;
        var len = Math.min(46, sp * 0.10);
        var ux = mu.vx / sp, uy = mu.vy / sp;
        g.strokeStyle = "rgba(180,215,255,.22)";
        g.beginPath();
        g.moveTo(mu.x + ux * mu.r, mu.y + uy * mu.r);
        g.lineTo(mu.x + ux * (mu.r + len), mu.y + uy * (mu.r + len));
        g.stroke();
      }
    }
  }

  // 地面特效 + 粒子
  w.fx.draw(g);

  // 投射物
  for (var p = 0; p < w.projectiles.length; p++) {
    var pr = w.projectiles[p];
    g.save();
    g.translate(pr.x, pr.y);
    g.rotate(pr.rot || 0);
    if (pr.img) {
      /* 有贴图就画贴图（动图会自己播放，和 GIF 一样是浏览器原生驱动）。
       * 尺寸默认按碰撞半径放大一点，可用 drawSize 覆盖。 */
      var ps = pr.drawSize || pr.r * 2.6;
      g.shadowColor = pr.color; g.shadowBlur = 14;
      g.drawImage(pr.img, -ps / 2, -ps / 2, ps, ps);
    } else {
      g.fillStyle = pr.color;
      g.shadowColor = pr.color; g.shadowBlur = 12;
      g.beginPath();
      g.moveTo(pr.r, 0);
      g.lineTo(-pr.r * 0.7, pr.r * 0.7);
      g.lineTo(-pr.r * 0.7, -pr.r * 0.7);
      g.closePath(); g.fill();
    }
    g.restore();
  }

  // 单位（身体在摄像机空间，UI 元素用逆缩放保持屏幕尺寸）
  for (var m = 0; m < w.units.length; m++) drawUnit(g, w.units[m], w, zoomed ? cam.zoom : 1);

  // 跟随目标标记
  if (following && window.MA.CONFIG.camera.showMarker) {
    var ct = w.getCamTarget();
    if (ct) drawFollowMarker(g, ct, w);
  }

  // 飘字：伤害数字要保持恒定屏幕大小，所以临时撤掉摄像机的「缩放」分量。
  //
  // 数学推导（当前 CTM 为 T(A/2,A/2)·S(zoom)·T(-cam.x,-cam.y)）：
  //   想让世界坐标直接映射到屏幕且不缩放，需要追加
  //     T(cam.x,cam.y) · S(1/zoom) · T(-cam.x,-cam.y)
  //   相乘后 T(-cam.x,-cam.y)·T(cam.x,cam.y) 抵消，只剩
  //     T(A/2 - cam.x, A/2 - cam.y)     ← 正是我们要的
  // 如果最后一步误写成 T(-A/2,-A/2)，整体会化简成恒等变换，
  // 世界坐标被当成屏幕坐标，飘字就会跑到左上角附近。
  if (zoomed) {
    g.save();
    g.translate(cam.x, cam.y);
    g.scale(1 / cam.zoom, 1 / cam.zoom);
    g.translate(-cam.x, -cam.y);
    w.fx.drawTexts(g);
    g.restore();
  } else {
    w.fx.drawTexts(g);
  }

  // 鼠标推挤指示
  if (w.mouse) {
    g.strokeStyle = "rgba(160,200,255,.35)";
    g.lineWidth = 1.5 / Math.max(cam.zoom, 0.25);
    g.beginPath(); g.arc(w.mouse.x, w.mouse.y, w.cfg.physics.mouseRadius, 0, TAU); g.stroke();
    g.beginPath(); g.arc(w.mouse.x, w.mouse.y, 24, 0, TAU); g.stroke();
  }

  // 结算画面要占满整个屏幕，先退出摄像机变换
  if (w.over) {
    if (zoomed) g.restore();         // 退出摄像机变换
    drawResult(g, w);
    g.restore();                     // 退出 drawWorld 的 save
    return;
  }

  g.restore();
}

/* 跟随目标的脚下标记，避免放大后认不出跟的是谁 */
function drawFollowMarker(g, u, w) {
  var pulse = 0.6 + Math.sin(w.time * 5) * 0.25;
  g.save();
  g.globalAlpha = pulse;
  g.strokeStyle = "#ffffff";
  g.lineWidth = 2;
  g.beginPath(); g.arc(u.x, u.y, u.r + 12, 0, TAU); g.stroke();
  // 四角括号，像相机取景框
  g.globalAlpha = pulse * 0.9;
  g.lineWidth = 2.5;
  var R = u.r + 18, len = 7;
  var corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (var i = 0; i < corners.length; i++) {
    var sx = corners[i][0], sy = corners[i][1];
    g.beginPath();
    g.moveTo(u.x + sx * R - sx * len, u.y + sy * R);
    g.lineTo(u.x + sx * R, u.y + sy * R);
    g.lineTo(u.x + sx * R, u.y + sy * R - sy * len);
    g.stroke();
  }
  g.restore();
}

/* --------------------------- 结算横幅 ---------------------------
 * 两种情况：
 *   · 有冠军 → 金色横幅 + 冠军贴图 + 击杀/输出
 *   · 无人胜出（全员阵亡，比如同归于尽）→ 中性色"无人胜出"横幅
 *
 * 注意：以前无人胜出时这里直接 return，只留下那层压暗的遮罩，
 * 于是屏幕上"只是变暗了"，没有任何提示。现在两种结局都有横幅。 */
function drawResult(g, w) {
  var A = w.arena;
  g.fillStyle = "rgba(4,6,14,.55)";
  g.fillRect(0, 0, A, A);

  var k = clamp(w.overT * 2.2, 0, 1);
  g.save();
  g.translate(A / 2, A / 2);
  g.scale(0.85 + k * 0.15, 0.85 + k * 0.15);
  g.globalAlpha = k;
  g.textAlign = "center";

  /* ---------- 无人胜出 ---------- */
  if (!w.winner) {
    g.font = "900 " + Math.round(A * 0.075) + "px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.lineWidth = 8; g.strokeStyle = "rgba(0,0,0,.8)";
    g.strokeText("无人胜出", 0, -A * 0.03);
    // 中性冷色，和冠军的金色区分开，一眼能看出"这局没赢家"
    var dg = g.createLinearGradient(-A * 0.3, 0, A * 0.3, 0);
    dg.addColorStop(0, "#9aa7bd");
    dg.addColorStop(0.5, "#eef3fb");
    dg.addColorStop(1, "#8290a6");
    g.fillStyle = dg;
    g.fillText("无人胜出", 0, -A * 0.03);

    g.font = "700 " + Math.round(A * 0.032) + "px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillStyle = "rgba(214,226,242,.92)";
    g.fillText("⚔️ 全员阵亡", 0, -A * 0.105);

    g.font = "600 " + Math.round(A * 0.024) + "px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.fillStyle = "rgba(172,188,214,.85)";
    g.fillText("平局 · 无人生还", 0, A * 0.055);

    g.restore();
    g.textAlign = "start";
    return;
  }

  /* ---------- 冠军 ---------- */
  // 冠军贴图（如果有）
  var winSprite = resolveSprite(w.winner, w, "idle");
  var art = winSprite ? winSprite.img : null;
  var yOff = 0;
  if (art) {
    var s = A * 0.17;
    g.save();
    g.shadowColor = w.winner.color; g.shadowBlur = 30;
    g.drawImage(art, -s / 2, -A * 0.20, s, s);
    g.restore();
    yOff = A * 0.045;
  }

  g.font = "900 " + Math.round(A * 0.075) + "px 'PingFang SC','Microsoft YaHei',sans-serif";
  g.lineWidth = 8; g.strokeStyle = "rgba(0,0,0,.8)";
  g.strokeText(w.winner.name, 0, -A * 0.03 + yOff);
  var grad = g.createLinearGradient(-A * 0.3, 0, A * 0.3, 0);
  grad.addColorStop(0, "#ffd25e");
  grad.addColorStop(0.5, "#fff6d8");
  grad.addColorStop(1, "#ffb03a");
  g.fillStyle = grad;
  g.fillText(w.winner.name, 0, -A * 0.03 + yOff);

  g.font = "700 " + Math.round(A * 0.032) + "px 'PingFang SC','Microsoft YaHei',sans-serif";
  g.fillStyle = "rgba(230,240,255,.92)";
  g.fillText("🏆 冠军", 0, -A * 0.105 + yOff);

  g.font = "600 " + Math.round(A * 0.024) + "px 'PingFang SC','Microsoft YaHei',sans-serif";
  g.fillStyle = "rgba(190,210,250,.85)";
  g.fillText("击杀 " + w.winner.kills + " · 输出 " + Math.round(w.winner.dmgDone),
    0, A * 0.055 + yOff);
  g.restore();
  g.textAlign = "start";
}

/* --------------------------- 单位绘制 --------------------------- */
/* zoom 是当前摄像机缩放：身体跟着缩放（看得更清），
   血条/名字用 1/zoom 逆缩放，保持恒定屏幕大小（不被拉成巨大）。 */
function drawUnit(g, u, w, zoom) {
  zoom = zoom || 1;
  if (!u.alive) { drawTomb(g, u, zoom); return; }

  var tpl = u.tpl;
  var slot = pickSpriteSlot(u, w);
  var sprite = resolveSprite(u, w, slot);
  var art = sprite ? sprite.img : null;

  var spawn = 1 - clamp(u.spawnT / 0.45, 0, 1);
  var scale = 0.4 + spawn * 0.6;

  g.save();
  g.translate(u.x, u.y);
  g.scale(scale, scale);

  // 影子
  g.globalAlpha = 0.35;
  g.fillStyle = "#000";
  g.beginPath(); g.ellipse(0, u.r * 0.92, u.r * 0.9, u.r * 0.32, 0, 0, TAU); g.fill();
  g.globalAlpha = 1;

  // 状态光环
  if (u.shield > 0) {
    g.strokeStyle = "rgba(170,184,255,.85)";
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(0, 0, u.r + 7 + Math.sin(w.time * 6) * 1.6, 0, TAU); g.stroke();
  }
  if (u.rage > 0) {
    g.strokeStyle = "rgba(255,190,80,.7)";
    g.lineWidth = 2;
    g.setLineDash([4, 5]);
    g.beginPath(); g.arc(0, 0, u.r + 5, w.time * 3, w.time * 3 + TAU); g.stroke();
    g.setLineDash([]);
  }
  if (u.freeze > 0 || u.stun > 0) {
    g.fillStyle = "rgba(140,200,255,.18)";
    g.beginPath(); g.arc(0, 0, u.r + 9, 0, TAU); g.fill();
  }
  if (u.poison > 0.15) {
    g.strokeStyle = "rgba(255,70,90,.55)";
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, u.r + 11, 0, TAU); g.stroke();
  }

  if (art) {
    /* ---- 有贴图：画贴图 ---- */
    var size = u.r * 2.35;
    g.save();
    // 光晕按半径成比例，否则放大角色后光晕显得过小
    g.shadowColor = u.color;
    g.shadowBlur = u.isClone ? u.r * 0.3 : u.r * 0.72;
    if (u.hitFlash > 0.08) g.globalAlpha = 0.85;
    if (u.isClone) g.globalAlpha = (g.globalAlpha || 1) * 0.62;   // 分身半透明
    g.drawImage(art, -size / 2, -size / 2, size, size);
    g.restore();
    g.globalAlpha = 1;
  } else {
    /* ---- 无贴图：几何图形回退 ---- */
    drawBody(g, u);
  }

  g.restore();

  // ---- 以下 UI 元素（图标/血条/名字/冷却环）用逆缩放保持屏幕尺寸 ----
  g.save();
  if (zoom > 1.001) {
    g.translate(u.x, u.y);
    g.scale(1 / zoom, 1 / zoom);
    g.translate(-u.x, -u.y);
  }

  // 头顶图标（有贴图时就不重复显示了）
  if (!art && window.MA.CONFIG.ui.showNames) {
    g.font = Math.round(u.r * 0.85) + "px 'Segoe UI Emoji','Apple Color Emoji',sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.globalAlpha = 0.92;
    g.fillText(u.icon, u.x, u.y - u.r - 12);
    g.globalAlpha = 1;
    g.textBaseline = "alphabetic";
  }

  drawHpBar(g, u, w);
  g.restore();
}

/* 几何身体（无素材时的回退画法） */
function drawBody(g, u) {
  var r = u.r;
  var base = u.hitFlash > 0 ? "#ffffff" : u.color;

  // 光晕跟半径成比例：固定 16px 会让大角色显得没光、小角色光晕过大
  g.shadowColor = u.color;
  g.shadowBlur = u.isClone ? r * 0.3 : r * 0.72;
  g.fillStyle = base;
  g.beginPath();
  if (u.shape === "square") {
    roundRect(g, -r * 0.86, -r * 0.86, r * 1.72, r * 1.72, r * 0.32);
  } else if (u.shape === "tri") {
    g.moveTo(0, -r * 1.1);
    g.lineTo(r * 0.98, r * 0.78);
    g.lineTo(-r * 0.98, r * 0.78);
    g.closePath();
  } else if (u.shape === "cat") {
    g.arc(0, r * 0.08, r * 0.92, 0, TAU);
  } else {
    g.arc(0, 0, r, 0, TAU);
  }
  g.fill();

  if (u.shape === "cat") {
    g.beginPath();
    g.moveTo(-r * 0.72, -r * 0.5); g.lineTo(-r * 0.35, -r * 1.25); g.lineTo(-r * 0.02, -r * 0.62);
    g.closePath();
    g.moveTo(r * 0.72, -r * 0.5); g.lineTo(r * 0.35, -r * 1.25); g.lineTo(r * 0.02, -r * 0.62);
    g.closePath();
    g.fill();
  }
  g.shadowBlur = 0;

  // 高光
  g.globalAlpha = 0.32;
  g.fillStyle = "#ffffff";
  g.beginPath();
  if (u.shape === "round" || u.shape === "cat") g.arc(-r * 0.28, -r * 0.3, r * 0.4, 0, TAU);
  else g.arc(0, -r * 0.1, r * 0.36, 0, TAU);
  g.fill();
  g.globalAlpha = 1;

  // 表情
  g.fillStyle = "#0b1020";
  var ex = Math.cos(u.dir) * r * 0.2, ey = Math.sin(u.dir) * r * 0.2;
  g.beginPath();
  g.arc(-r * 0.3 + ex, -r * 0.08 + ey, r * 0.115, 0, TAU);
  g.arc(r * 0.3 + ex, -r * 0.08 + ey, r * 0.115, 0, TAU);
  g.fill();
  g.lineWidth = r * 0.09;
  g.strokeStyle = "#0b1020";
  g.beginPath();
  if (u.hp / u.stats.hp < 0.35) g.arc(0, r * 0.42, r * 0.26, Math.PI * 1.15, Math.PI * 1.85);
  else g.arc(0, r * 0.16, r * 0.3, Math.PI * 0.18, Math.PI * 0.82);
  g.stroke();
}

/* 墓碑（阵亡） */
function drawTomb(g, u, zoom) {
  var k = clamp(u.deathT / 0.7, 0, 1);
  g.globalAlpha = (1 - k) * 0.55;
  g.fillStyle = "#8892b0";
  var s = u.r * (1 + k * 0.6);
  roundRect(g, u.x - s * 0.5, u.y - s * 0.5, s, s, 4);
  g.fill();
  g.globalAlpha = 1;
}

/**
 * 血条几何：把尺寸计算抽出来，方便测试与复用。
 * 返回 { bx, by, bw, bh, sc }，全部是屏幕坐标/像素。
 *
 * 宽度优先用 u.r（已含显示倍率）；若传入的 u.r 与当前配置不一致
 * （比如刚改完 unitScale 还没刷新单位），则按模板半径现算，
 * 避免出现"角色已经放大、血条还是旧宽度"的错位。
 */
function hpBarGeometry(u, cfg) {
  cfg = cfg || (window.MA.CONFIG.display || {});
  var unitScale = num(cfg.unitScale, 1);
  var barScale = num(cfg.hpBarScale, 2);
  // 合成倍率：血条跟着角色放大（开方，避免角色翻倍时血条宽得离谱），
  // 再乘血条自己的倍率。上限放到 4，否则滑到 2 以上就没反应了。
  var sc = clamp(Math.sqrt(Math.max(0.05, unitScale)) * barScale, 0.3, 4);

  // 半径：优先用单位自身的 r；若它明显偏离"模板半径 × 倍率"，用后者修正
  var radius = u.r;
  if (u.tpl && u.tpl.radius) {
    var expect = u.tpl.radius * (u.isClone ? 0.86 : 1) * unitScale;
    if (Math.abs(expect - u.r) > 0.01) radius = expect;
  }

  var bw = Math.max(num(cfg.hpBarMinWidth, 46), radius * 2.1);
  var bh = num(cfg.hpBarThickness, 8) * sc;
  return {
    bx: u.x - bw / 2,
    by: u.y - radius - bh - 6,
    bw: bw,
    bh: bh,
    sc: sc,
    radius: radius
  };
}

/* 血条 + 血量数值 + 名字 + 技能冷却环
 *
 * 血条尺寸同时受两个倍率影响：
 *   · unitScale —— 角色放大后血条也要跟着放大（否则小条配大角色很难看）
 *   · hpBarScale —— 血条自己还能额外调
 * 数字画在血条内部居中，并做了对比度处理（亮底用深字、暗底用白字），
 * 保证在纯绿/纯黄/纯红三种底色上都看得清。 */
function drawHpBar(g, u, w) {
  var d = window.MA.CONFIG.display || {};
  var geo = hpBarGeometry(u, d);
  var sc = geo.sc, bw = geo.bw, bh = geo.bh, bx = geo.bx, by = geo.by;

  /* ---- 背板：外描边 + 内底 ---- */
  g.fillStyle = "rgba(0,0,0,.72)";
  roundRect(g, bx - 2, by - 2, bw + 4, bh + 4, (bh + 4) / 2); g.fill();
  g.fillStyle = "rgba(12,18,34,.92)";
  roundRect(g, bx, by, bw, bh, bh / 2); g.fill();

  /* ---- 血量 ---- */
  var frac = clamp(u.hp / u.stats.hp, 0, 1);
  var barColor = frac > 0.55 ? "#4be07a" : frac > 0.28 ? "#ffd24a" : "#ff5d5d";
  if (frac > 0.001) {
    g.save();
    // 裁剪成圆角，血条两端才是圆的
    roundRect(g, bx, by, bw, bh, bh / 2);
    g.clip();
    g.fillStyle = barColor;
    g.fillRect(bx, by, bw * frac, bh);
    // 顶部高光，让血条有立体感
    g.globalAlpha = 0.22;
    g.fillStyle = "#ffffff";
    g.fillRect(bx, by + 1, bw * frac, bh * 0.34);
    g.restore();
  }

  /* ---- 护盾条（叠在血条上沿） ---- */
  if (u.shield > 0) {
    g.fillStyle = "rgba(170,184,255,.9)";
    roundRect(g, bx, by - bh * 0.42, Math.min(bw, bw * (u.shield / 40)), bh * 0.3, bh * 0.15);
    g.fill();
  }

  /* ---- 血量数值（画在血条内部） ----
   * 只显示当前血量：血条本身已经表达了"还剩几成"，
   * 再写 "62/104" 反而挤，所以这里固定只画一个数字。 */
  if (d.hpBarShowValue !== false) {
    var hpNow = Math.max(0, Math.round(u.hp));
    var txt = String(hpNow);
    var fs = num(d.hpBarFontSize, 12) * clamp(sc, 0.7, 2.4);
    g.save();
    g.font = "800 " + Math.round(fs) + "px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    var cxT = bx + bw / 2, cyT = by + bh / 2 + 0.5;

    // 文字压着血条：亮底用深色字 + 白色描边，暗底用白字 + 深色描边，
    // 这样绿/黄/红三种底色上都清楚。
    var bright = frac > 0.28;   // 绿、黄都算亮底
    g.lineWidth = Math.max(2, fs * 0.24);
    g.lineJoin = "round";
    if (bright) {
      g.strokeStyle = "rgba(255,255,255,.55)";
      g.strokeText(txt, cxT, cyT);
      g.fillStyle = "rgba(8,14,26,.95)";
    } else {
      g.strokeStyle = "rgba(0,0,0,.65)";
      g.strokeText(txt, cxT, cyT);
      g.fillStyle = "#ffffff";
    }
    g.fillText(txt, cxT, cyT);
    g.restore();
    g.textBaseline = "alphabetic";
  }

  /* ---- 名字 ---- */
  if (window.MA.CONFIG.ui.showNames) {
    var nameFs = 11 * clamp(sc, 0.75, 2.2);
    g.font = "700 " + Math.round(nameFs) + "px 'PingFang SC','Microsoft YaHei',sans-serif";
    g.textAlign = "center";
    g.lineWidth = 3.5;
    g.strokeStyle = "rgba(0,0,0,.8)";
    g.strokeText(u.name, u.x, by - 6);
    g.fillStyle = u.isClone ? "rgba(200,230,255,.7)" : "#eaf1ff";
    g.fillText(u.name, u.x, by - 6);
  }

  /* ---- 技能冷却环 ---- */
  var cd = u.tpl.cooldown || 1;
  var cdFrac = clamp(1 - u.skillCd / cd, 0, 1);
  var ringW = 2.4 * clamp(Math.sqrt(sc), 1, 2.2);
  if (cdFrac < 0.999) {
    g.strokeStyle = "rgba(255,255,255,.25)";
    g.lineWidth = ringW;
    g.beginPath(); g.arc(u.x, u.y, u.r + 5, -Math.PI / 2, -Math.PI / 2 + TAU * cdFrac); g.stroke();
  } else if (!u.isClone) {
    g.strokeStyle = "rgba(255,220,120,.9)";
    g.lineWidth = ringW;
    g.beginPath(); g.arc(u.x, u.y, u.r + 5, 0, TAU); g.stroke();
  }
  g.textAlign = "start";
}
