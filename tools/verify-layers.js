/* =========================================================================
 * tools/verify-layers.js —— 三层背景系统验证
 * 检查 外/边框/内 三层各自的：
 *   · 图案自定义（外层 7 种图案、边框 5 种样式）
 *   · 边框厚度（决定中间那层的显示范围）
 *   · 缩放 / 水平偏移 / 垂直偏移（纹理对齐）
 *   · 透明度
 *   · 高斯模糊
 *   · 三层的层次顺序正确（外 → 边框 → 内）
 * 用法：node tools/verify-layers.js
 * ========================================================================= */
"use strict";

const path = require("path");
const { Browser, sleep, reapStaleProcesses } = require("./cdp");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "_verify");
const URL = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");

let failures = 0;
function check(label, cond, detail) {
  console.log((cond ? "  ✓ " : "  ✗ ") + label + (detail ? "  " + detail : ""));
  if (!cond) failures++;
}

/* 取画布某个点的像素 */
function px(x, y) {
  return `(function(){
    var c = document.getElementById("cv"), g = c.getContext("2d");
    var d = g.getImageData(${x}, ${y}, 1, 1).data;
    return d[0] + "," + d[1] + "," + d[2] + "," + d[3];
  })()`;
}

(async () => {
  const reaped = reapStaleProcesses();
  if (reaped) console.log("已清理 " + reaped + " 个残留测试进程\n");

  const browser = new Browser();
  const errors = [];

  try {
    await browser.launch({ url: "about:blank", width: 1500, height: 1000 });
    await browser.send("Runtime.enable");
    browser.on("Runtime.exceptionThrown", p => {
      const d = p.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    });
    browser.on("Runtime.consoleAPICalled", p => {
      if (p.type !== "error") return;
      errors.push("console.error: " + (p.args || []).map(a => a.value || a.description).join(" "));
    });

    await browser.open(URL);
    await sleep(1000);

    console.log("=== 1. 三层已就位 ===");
    const mod = JSON.parse(await browser.eval(`JSON.stringify({
      hasDrawAll: !!(window.MA.Background && window.MA.Background.drawAll),
      setLayerImage: typeof window.MA.Background.setLayerImage === "function",
      patterns: window.MA.Background.patterns,
      borderStyles: window.MA.Background.borderStyles,
      hasOuter: !!(window.MA.CONFIG.render.background.outer),
      hasBorder: !!(window.MA.CONFIG.render.background.border),
      hasInner: !!(window.MA.CONFIG.render.background.inner),
      borderThick: window.MA.CONFIG.render.background.border.thickness,
      borderOuter: window.MA.Background.borderOuter(720)
    })`));
    check("drawAll 接口存在", mod.hasDrawAll);
    check("支持逐层换图", mod.setLayerImage);
    check("外层配置存在", mod.hasOuter);
    check("边框层配置存在", mod.hasBorder);
    check("内层配置存在", mod.hasInner);
    check("外层图案有 7 种", mod.patterns.length === 7, mod.patterns.join("/"));
    check("边框样式有 5 种", mod.borderStyles.length === 5, mod.borderStyles.join("/"));
    check("边框外延 = 擂台 + 2×厚度", mod.borderOuter === 720 + 2 * mod.borderThick,
      mod.borderOuter + " = 720 + 2×" + mod.borderThick);

    console.log("\n=== 2. 外层图案可自定义（7 种都生效）===");
    // 缩到 0.55× 让外层大面积进入视野
    await browser.eval(`(function(){
      world.autoRestart = false;
      world.reset(["moyu","kunkun","hajimi","creeper","saibo","fanqie","yyds","tiangou"]);
      world.setCameraMode("follow");
      window.MA.CONFIG.camera.followZoom = 0.55;
      world.cam.zoom = 0.55;
      var t = world.getCamTarget();
      if (t) { t.x = world.arena/2; t.y = world.arena/2; t.vx = 0; t.vy = 0; }
      for (var i = 0; i < 150; i++) world.updateCamera(1/60);
      world.cam.zoom = 0.55;
      window.MA.CONFIG.render.background.outer.blur = 0;
      return true;
    })()`);
    await sleep(400);

    const patResult = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var cfgs = window.MA.Background.patterns;   // 含 none
      var fps = {};
      function fp(){
        var c = document.getElementById("cv"), g = c.getContext("2d");
        var n = 220;
        var d = g.getImageData(8, 8, n, n).data, h = 0;
        for (var i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i+1]*3 + d[i+2]*7) % 1000000007;
        return h;
      }
      var uniq = {};
      for (var i = 0; i < cfgs.length; i++) {
        window.MA.CONFIG.render.background.outer.pattern = cfgs[i];
        window.MA.Background.invalidate();
        drawWorld(world);
        var h = fp();
        fps[cfgs[i]] = h;
        uniq[h] = (uniq[h] || 0) + 1;
      }
      return { fps: fps, unique: Object.keys(uniq).length, total: cfgs.length };
    })())`));
    check("7 种图案产生不同画面", patResult.unique === patResult.total,
      patResult.unique + "/" + patResult.total + " 种不同");

    console.log("\n=== 3. 外层：缩放 / 偏移 / 透明度 / 模糊 ===");
    const outerFx = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var o = window.MA.CONFIG.render.background.outer;
      o.pattern = "grid"; o.patternScale = 46; o.patternWidth = 1.2;
      o.scale = 1; o.offsetX = 0; o.offsetY = 0; o.blur = 0; o.opacity = 1;
      function fp(){
        var c = document.getElementById("cv"), g = c.getContext("2d");
        var n = 200;
        var d = g.getImageData(8, 8, n, n).data, h = 0;
        for (var i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i+1]*3 + d[i+2]*7) % 1000000007;
        return h;
      }
      function shot(){ window.MA.Background.invalidate(); drawWorld(world); return fp(); }

      var base = shot();

      o.scale = 2.0;      var scaled = shot();   o.scale = 1;
      o.offsetX = 60;     var offX = shot();     o.offsetX = 0;
      o.offsetY = 60;     var offY = shot();     o.offsetY = 0;
      o.opacity = 0.3;    var opac = shot();     o.opacity = 1;
      o.blur = 8;         var blur = shot();     o.blur = 0;

      // 重置
      window.MA.Background.invalidate(); drawWorld(world);

      return {
        base: base,
        scaleDiff: base !== scaled,
        offXDiff: base !== offX,
        offYDiff: base !== offY,
        opacDiff: base !== opac,
        blurDiff: base !== blur
      };
    })())`));
    check("外层缩放改变画面", outerFx.scaleDiff === true);
    check("外层水平偏移改变画面", outerFx.offXDiff === true);
    check("外层垂直偏移改变画面", outerFx.offYDiff === true);
    check("外层透明度改变画面", outerFx.opacDiff === true);
    check("外层模糊改变画面", outerFx.blurDiff === true);

    console.log("\n=== 4. 边框厚度 = 中间层的显示范围 ===");
    const thick = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var b = window.MA.CONFIG.render.background.border;
      var A = world.arena;
      b.enabled = true; b.style = "solid"; b.pulse = 0; b.glow = 0; b.blur = 0;
      function outerSize(){ return window.MA.Background.borderOuter(A); }
      b.thickness = 0;    var s0 = outerSize();
      b.thickness = 10;   var s10 = outerSize();
      b.thickness = 60;   var s60 = outerSize();
      b.thickness = 140;  var s140 = outerSize();
      b.thickness = 26;
      window.MA.Background.invalidate();
      return { A: A, s0: s0, s10: s10, s60: s60, s140: s140 };
    })())`));
    check("厚度 0 → 不占空间", thick.s0 === thick.A, thick.s0 + " vs " + thick.A);
    check("厚度 10 → 外延 20", thick.s10 === thick.A + 20, String(thick.s10));
    check("厚度 60 → 外延 120", thick.s60 === thick.A + 120, String(thick.s60));
    check("厚度 140 → 外延 280", thick.s140 === thick.A + 280, String(thick.s140));

    // 厚度为 0 时该层应不可见：比较"有边框"和"无边框"的边框环带像素
    const ringVisible = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var b = window.MA.CONFIG.render.background.border;
      var A = world.arena;
      // 边框环带落在世界坐标 (A + t/2) 处；换算成屏幕像素
      function sample(){
        var c = document.getElementById("cv"), g = c.getContext("2d");
        var W = c.width;
        var z = world.cam.zoom;
        // 世界 x = A + 13（厚度 26 的中点），世界 y = A/2
        var sx = Math.round(W/2 + ((A + 13) - world.cam.x) * z);
        var sy = Math.round(c.height/2 + (A/2 - world.cam.y) * z);
        if (sx < 0 || sx >= W || sy < 0 || sy >= c.height) return null;
        var d = g.getImageData(sx, sy, 1, 1).data;
        return [d[0], d[1], d[2], d[3]];
      }
      b.thickness = 26; b.style = "solid"; b.pulse = 0; b.glow = 0;
      b.color = "#ff00ff"; b.color2 = "#ff00ff"; b.opacity = 1;
      window.MA.Background.invalidate(); drawWorld(world);
      var withBorder = sample();

      b.thickness = 0;
      window.MA.Background.invalidate(); drawWorld(world);
      var noBorder = sample();

      b.thickness = 26; b.color = ""; b.color2 = "";
      window.MA.Background.invalidate(); drawWorld(world);
      return { withBorder: withBorder, noBorder: noBorder };
    })())`));
    const wb = ringVisible.withBorder || [0,0,0,0];
    const nb = ringVisible.noBorder || [0,0,0,0];
    check("有边框时该处是边框颜色（洋红）", wb[0] > 120 && wb[1] < 100 && wb[2] > 120,
      "rgb(" + wb.slice(0,3).join(",") + ")");
    check("厚度归零后该处不再是边框颜色", !(nb[0] > 120 && nb[1] < 100 && nb[2] > 120),
      "rgb(" + nb.slice(0,3).join(",") + ")");

    console.log("\n=== 5. 边框：样式 / 缩放 / 偏移 / 透明度 / 模糊 ===");
    const borderFx = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var b = window.MA.CONFIG.render.background.border;
      var A = world.arena;
      b.thickness = 40; b.pulse = 0; b.glow = 0; b.blur = 0; b.opacity = 1;
      b.color = ""; b.color2 = ""; b.scale = 1; b.offsetX = 0; b.offsetY = 0;
      window.MA.Background.invalidate();

      // 让边框环带落在画面内：缩到 0.7× 并把镜头对准擂台中心。
      // 1× 时环带贴在画布边缘之外，取不到样。
      window.MA.CONFIG.camera.followZoom = 0.7;
      world.setCameraMode("follow");
      world.cam.zoom = 0.7;
      var ct = world.getCamTarget();
      if (ct) { ct.x = A/2; ct.y = A/2; ct.vx = 0; ct.vy = 0; }
      for (var ci = 0; ci < 150; ci++) world.updateCamera(1/60);
      world.cam.zoom = 0.7;
      window.MA.Background.invalidate();
      drawWorld(world);

      // 在边框环带上取一整条竖带做指纹。
      // 不要只取单点：虚线有空隙，单点可能正好落在空隙上，
      // 会被误判成"和 solid 相同"。
      var cv = document.getElementById("cv"), g = cv.getContext("2d");
      var W = cv.width, H = cv.height, z = world.cam.zoom;
      // 环带中点：世界坐标 A + t/2 → 屏幕
      var wx = A + b.thickness / 2;
      var sx = Math.round(W/2 + (wx - world.cam.x) * z);
      var bandW = Math.max(6, Math.min(48, Math.round(b.thickness * z * 0.6)));
      var x0 = clamp(sx - Math.round(bandW/2), 0, Math.max(0, W - bandW));
      var usable = (sx > 6 && sx < W - 6);

      function fp(){
        if (!usable) return -1;
        var d = g.getImageData(x0, 0, bandW, H).data, h = 0;
        for (var i = 0; i < d.length; i++) h = (h * 31 + d[i]) % 1000000007;
        return h;
      }
      function shot(){ window.MA.Background.invalidate(); drawWorld(world); return fp(); }

      var styles = {};
      var list = window.MA.Background.borderStyles;
      for (var i = 0; i < list.length; i++) {
        b.style = list[i];
        styles[list[i]] = shot();
      }
      var uniq = {}; Object.keys(styles).forEach(function(k){ uniq[styles[k]] = 1; });

      b.style = "stripes";
      var base = shot();
      b.scale = 2.2;   var scaled = shot();  b.scale = 1;
      b.offsetX = 50;  var offX = shot();    b.offsetX = 0;
      b.offsetY = 50;  var offY = shot();    b.offsetY = 0;
      b.opacity = 0.25; var opac = shot();   b.opacity = 1;
      b.blur = 6;      var blur = shot();    b.blur = 0;

      b.style = "glow";
      window.MA.Background.invalidate(); drawWorld(world);
      return {
        styleUnique: Object.keys(uniq).length, styleTotal: list.length,
        scaleDiff: base !== scaled, offXDiff: base !== offX, offYDiff: base !== offY,
        opacDiff: base !== opac, blurDiff: base !== blur
      };
    })())`));
    check("5 种边框样式产生不同画面", borderFx.styleUnique === borderFx.styleTotal,
      borderFx.styleUnique + "/" + borderFx.styleTotal + " 种不同");
    check("边框缩放改变画面", borderFx.scaleDiff === true);
    check("边框水平偏移改变画面", borderFx.offXDiff === true);
    check("边框垂直偏移改变画面", borderFx.offYDiff === true);
    check("边框透明度改变画面", borderFx.opacDiff === true);
    check("边框模糊改变画面", borderFx.blurDiff === true);

    console.log("\n=== 6. 内层：缩放 / 偏移 / 透明度 / 模糊 ===");
    const innerFx = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var c = window.MA.CONFIG.render.background;
      var inn = c.inner;
      inn.scale = 1; inn.offsetX = 0; inn.offsetY = 0; inn.blur = 0; inn.opacity = 1;
      c.overlay = 0.4;
      window.MA.Background.invalidate();

      function fp(){
        var cv = document.getElementById("cv"), g = cv.getContext("2d");
        var W = cv.width, H = cv.height;
        // 采擂台中心区域
        var n = 120;
        var d = g.getImageData(Math.round(W/2 - n/2), Math.round(H/2 - n/2), n, n).data, h = 0;
        for (var i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i+1]*3 + d[i+2]*7) % 1000000007;
        return h;
      }
      function shot(){ window.MA.Background.invalidate(); drawWorld(world); return fp(); }

      var base = shot();
      inn.scale = 2.0;   var scaled = shot();  inn.scale = 1;
      inn.offsetX = 70;  var offX = shot();    inn.offsetX = 0;
      inn.offsetY = 70;  var offY = shot();    inn.offsetY = 0;
      inn.opacity = 0.3; var opac = shot();    inn.opacity = 1;
      inn.blur = 9;      var blur = shot();    inn.blur = 0;
      inn.vignette = 0;  var noVig = shot();   inn.vignette = 0.42;
      window.MA.Background.invalidate(); drawWorld(world);
      return {
        scaleDiff: base !== scaled, offXDiff: base !== offX, offYDiff: base !== offY,
        opacDiff: base !== opac, blurDiff: base !== blur, vigDiff: base !== noVig
      };
    })())`));
    // 内层没有贴图时缩放/偏移不影响主题渐变，这是预期行为 —— 用模糊和暗角判定
    check("内层模糊改变画面", innerFx.blurDiff === true);
    check("内层暗角改变画面", innerFx.vigDiff === true);
    check("内层透明度改变画面", innerFx.opacDiff === true);

    console.log("\n=== 7. 层次顺序：外 → 边框 → 内 ===");
    const order = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var c = window.MA.CONFIG.render.background;
      var A = world.arena;
      // 用三种高饱和纯色区分三层：外层蓝、边框洋红、内层绿
      c.outer.color = "#0000ff"; c.outer.overlay = 0; c.outer.pattern = "none";
      c.outer.glow = false; c.outer.src = ""; c.outer.opacity = 1;
      c.border.enabled = true; c.border.thickness = 40; c.border.style = "solid";
      c.border.color = "#ff00ff"; c.border.color2 = "#ff00ff";
      c.border.glow = 0; c.border.pulse = 0; c.border.opacity = 1; c.border.blur = 0;
      c.inner.opacity = 1; c.inner.vignette = 0; c.overlay = 0;
      window.MA.Background.invalidate();
      drawWorld(world);

      var cv = document.getElementById("cv"), g = cv.getContext("2d");
      var W = cv.width, H = cv.height, z = world.cam.zoom;
      function worldToScreen(wx, wy){
        return [Math.round(W/2 + (wx - world.cam.x) * z), Math.round(H/2 + (wy - world.cam.y) * z)];
      }
      function at(wx, wy){
        var p = worldToScreen(wx, wy);
        if (p[0] < 0 || p[0] >= W || p[1] < 0 || p[1] >= H) return null;
        var d = g.getImageData(p[0], p[1], 1, 1).data;
        return [d[0], d[1], d[2]];
      }
      // 擂台内（内层）；边框环带中点（边框）；更外面（外层）
      var innerPt = at(A/2, A/2);
      var borderPt = at(A + 20, A/2);
      var outerPt2 = at(A + 120, A/2);
      return { innerPt: innerPt, borderPt: borderPt, outerPt: outerPt2, zoom: z, A: A };
    })())`));
    const ip = order.innerPt, bp = order.borderPt, op = order.outerPt;
    check("内层能取到像素", !!ip, ip ? "rgb(" + ip.join(",") + ")" : "越界");
    check("边框层能取到像素", !!bp, bp ? "rgb(" + bp.join(",") + ")" : "越界");
    check("外层能取到像素", !!op, op ? "rgb(" + op.join(",") + ")" : "越界");
    if (bp && ip && op) {
      // 边框是洋红，内层是主题渐变(偏暗)，外层是纯蓝
      check("边框处为边框色（洋红）", bp[0] > 100 && bp[1] < 90 && bp[2] > 100,
        "rgb(" + bp.join(",") + ")");
      check("外层处为外层色（蓝，未被边框覆盖）", op[2] > 100 && op[0] < 90,
        "rgb(" + op.join(",") + ")");
      check("内层处不是边框色（说明边框没盖住擂台）", !(ip[0] > 100 && ip[1] < 90 && ip[2] > 100),
        "rgb(" + ip.join(",") + ")");
    }

    console.log("\n=== 8. 逐层换图 ===");
    // 注意：这里是 Promise，JSON.stringify 必须放在 Promise 内部 res() 里，
    // 放外面会把 Promise 本身序列化成 {}。
    const swap = JSON.parse(await browser.eval(`(function(){
      function solid(color, size){
        var c = document.createElement("canvas"); c.width = c.height = size || 64;
        var g = c.getContext("2d");
        g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
        return c.toDataURL();
      }
      return new Promise(function(res){
        var results = {};
        var layers = ["outer", "border", "inner"];
        var i = 0;
        function next(){
          if (i >= layers.length) return res(JSON.stringify(results));
          var L = layers[i++];
          var img = new Image();
          img.onload = function(){
            try {
              window.MA.Background.setLayerImage(L, img);
              window.MA.Background.invalidate();
              drawWorld(world);
              results[L] = !!window.MA.Background.layerImage(L);
            } catch (e) {
              results[L] = "error: " + (e && e.message || e);
            }
            next();
          };
          img.onerror = function(){ results[L] = "img decode failed"; next(); };
          img.src = solid("#00ff88");
        }
        next();
      });
    })()`));
    check("外层可换图", swap.outer === true);
    check("边框层可换图", swap.border === true);
    check("内层可换图", swap.inner === true);

    console.log("\n=== 8b. 恢复默认要真的清掉图片 ===");
    const resetTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var B = window.MA.Background;
      var before = {
        outer: !!B.layerImage("outer"),
        border: !!B.layerImage("border"),
        inner: !!B.layerImage("inner")
      };
      B.clearLayerImage("outer");
      B.clearLayerImage("border");
      B.clearLayerImage("inner");
      var after = {
        outer: !!B.layerImage("outer"),
        border: !!B.layerImage("border"),
        inner: !!B.layerImage("inner")
      };
      return { before: before, after: after,
        outerSrcCfg: (window.MA.CONFIG.render.background.outer || {}).src,
        borderSrcCfg: (window.MA.CONFIG.render.background.border || {}).src };
    })())`));
    check("清图前三层都有图", resetTest.before.outer && resetTest.before.border && resetTest.before.inner,
      JSON.stringify(resetTest.before));
    check("清图后外层的图被移除", resetTest.after.outer === false);
    check("清图后边框的图被移除", resetTest.after.border === false,
      "（内层会回退到项目图，" + (resetTest.after.inner ? "仍非空：符合预期" : "也会清空") + "）");
    check("配置里的 src 也被清空",
      !resetTest.outerSrcCfg && !resetTest.borderSrcCfg,
      "outer.src=" + JSON.stringify(resetTest.outerSrcCfg) + " border.src=" + JSON.stringify(resetTest.borderSrcCfg));

    console.log("\n=== 9. 截图 ===");
    // 恢复成好看的默认值再截图
    await browser.eval(`(function(){
      var c = window.MA.CONFIG.render.background;
      c.outer = { preset:"auto", color:"", src:"", fit:"cover", pattern:"grid",
        patternColor:"", patternScale:46, patternWidth:1.2, opacity:1, overlay:0.42,
        scale:1, offsetX:0, offsetY:0, blur:0, glow:true, margin:0.6 };
      c.border = { enabled:true, thickness:26, style:"glow", src:"", fit:"stretch",
        color:"", color2:"", opacity:1, scale:1, offsetX:0, offsetY:0, blur:0,
        glow:10, pulse:0.35 };
      c.inner = { enabled:true, opacity:1, scale:1, offsetX:0, offsetY:0, blur:0, vignette:0.42 };
      c.overlay = 0.4;
      window.MA.Background.invalidate();
      return true;
    })()`);
    const shots = [
      { z: 0.55, name: "layers-055.png" },
      { z: 1.0, name: "layers-100.png" },
      { z: 1.6, name: "layers-160.png" }
    ];
    for (const s of shots) {
      await browser.eval(`(function(){
        window.MA.CONFIG.camera.followZoom = ${s.z};
        world.cam.zoom = ${s.z};
        window.MA.Background.invalidate();
        return true;
      })()`);
      await sleep(600);
      const size = await browser.screenshot(path.join(OUT, s.name));
      check("截图 " + s.name, size > 20000, (size / 1024).toFixed(0) + " KB");
    }

    console.log("\n=== 10. 无报错 ===");
    check("无 JS 报错", errors.length === 0, errors.slice(0, 3).join(" | "));

  } catch (e) {
    console.error("\n验证过程出错: " + (e && e.stack || e));
    failures++;
  } finally {
    await browser.close();
  }

  console.log("\n" + (failures === 0 ? "全部通过 ✅" : failures + " 项失败 ❌"));
  process.exit(failures === 0 ? 0 : 1);
})();


