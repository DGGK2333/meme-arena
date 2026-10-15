/* =========================================================================
 * tools/verify-outer-bg.js —— 验证双层背景与 <1 缩放
 * 检查：
 *   1. 缩放 <1 时画布四角不是黑色（外层背景已铺满，没有黑边）
 *   2. 镜头贴边/越界时也没有黑边
 *   3. 外层背景与擂台方块是两层不同内容
 *   4. 缩放范围下限 <1 可用
 * 用法：node tools/verify-outer-bg.js
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

/* 采样画布四周一圈像素，返回"接近黑色"的像素比例 */
const EDGE_SAMPLER = `(function(){
  var c = document.getElementById("cv");
  var g = c.getContext("2d");
  var W = c.width, H = c.height;
  var d = g.getImageData(0, 0, W, H).data;
  var dark = 0, total = 0, samples = [];
  // 沿四条边和四角取样（避开中间，只看外围）
  var pts = [];
  var stepX = Math.max(1, Math.floor(W / 40));
  var stepY = Math.max(1, Math.floor(H / 40));
  for (var x = 0; x < W; x += stepX) { pts.push([x, 0], [x, H-1], [x, 1], [x, H-2]); }
  for (var y = 0; y < H; y += stepY) { pts.push([0, y], [W-1, y], [1, y], [W-2, y]); }
  // 四角各取一小块
  [[0,0],[W-1,0],[0,H-1],[W-1,H-1]].forEach(function(p){
    for (var dx = 0; dx < 4; dx++) for (var dy = 0; dy < 4; dy++) {
      pts.push([Math.min(W-1,p[0]+dx*(p[0]? -1:1)), Math.min(H-1,p[1]+dy*(p[1]? -1:1))]);
    }
  });
  for (var i = 0; i < pts.length; i++) {
    var px = pts[i][0], py = pts[i][1];
    var idx = (py * W + px) * 4;
    var r = d[idx], gg = d[idx+1], b = d[idx+2], a = d[idx+3];
    total++;
    // 判定"可见的黑边"：alpha 太低 或 颜色极暗
    if (a < 8 || (r < 14 && gg < 16 && b < 24)) dark++;
    if (samples.length < 6) samples.push([r, gg, b, a]);
  }
  return JSON.stringify({ dark: dark, total: total,
    ratio: +(dark / total).toFixed(3), samples: samples });
})()`;

(async () => {
  const reaped = reapStaleProcesses();
  if (reaped) console.log("已清理 " + reaped + " 个残留测试进程\n");

  const browser = new Browser();
  const errors = [];

  try {
    await browser.launch({ url: "about:blank" });
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

    console.log("=== 1. 双层背景已启用 ===");
    const mod = JSON.parse(await browser.eval(`JSON.stringify({
      hasOuterFn: !!(window.MA.Background && window.MA.Background.drawOuter),
      outerCfg: !!(window.MA.CONFIG.render.background.outer),
      pattern: window.MA.CONFIG.render.background.outer.pattern,
      zoomMin: window.MA.CONFIG.camera.zoomMin
    })`));
    check("外层绘制接口存在", mod.hasOuterFn);
    check("外层配置存在", mod.outerCfg, "图案=" + mod.pattern);
    check("缩放下限 <1", mod.zoomMin < 1, "zoomMin=" + mod.zoomMin);

    console.log("\n=== 2. 缩小到 0.6× 无黑边 ===");
    await browser.eval(`(function(){
      world.autoRestart = false;
      world.reset(["moyu","kunkun","hajimi","creeper","saibo","fanqie","yyds","tiangou"]);
      world.setCameraMode("follow");
      window.MA.CONFIG.camera.followZoom = 0.6;
      world.cam.zoom = 0.6;
      world.updateCamera(1/60);
      return true;
    })()`);
    await sleep(1400);
    const small = JSON.parse(await browser.eval(EDGE_SAMPLER));
    check("0.6× 时画布边缘无黑边", small.ratio < 0.05,
      "暗像素比例 " + (small.ratio * 100).toFixed(1) + "%（" + small.dark + "/" + small.total + "）");

    console.log("\n=== 3. 放大 1.5× 贴边无黑边 ===");
    await browser.eval(`(function(){
      window.MA.CONFIG.camera.followZoom = 1.5;
      var t = world.getCamTarget();
      if (t) { t.x = t.r + 2; t.y = t.r + 2; t.vx = 0; t.vy = 0; }   // 顶到左上角
      for (var i = 0; i < 200; i++) world.updateCamera(1/60);
      return true;
    })()`);
    await sleep(900);
    const edge = JSON.parse(await browser.eval(EDGE_SAMPLER));
    check("1.5× 贴角无黑边", edge.ratio < 0.05,
      "暗像素比例 " + (edge.ratio * 100).toFixed(1) + "%");

    console.log("\n=== 4. 极端贴边 + 大留白 也无黑边 ===");
    await browser.eval(`(function(){
      window.MA.CONFIG.camera.edgePadding = 150;      // 拉到最大留白
      var t = world.getCamTarget();
      if (t) { t.x = t.r + 1; t.y = t.r + 1; t.vx = 0; t.vy = 0; }
      for (var i = 0; i < 200; i++) world.updateCamera(1/60);
      return true;
    })()`);
    await sleep(900);
    const worst = JSON.parse(await browser.eval(EDGE_SAMPLER));
    check("最大留白贴角无黑边", worst.ratio < 0.05,
      "暗像素比例 " + (worst.ratio * 100).toFixed(1) + "%");
    await browser.eval(`window.MA.CONFIG.camera.edgePadding = 40`);

    console.log("\n=== 5. 外层与擂台是两层不同内容 ===");
    await browser.eval(`(function(){
      window.MA.CONFIG.camera.followZoom = 0.6;
      world.setCameraMode("follow");
      world.cam.zoom = 0.6;
      var t = world.getCamTarget();
      if (t) { t.x = world.arena/2; t.y = world.arena/2; }
      for (var i = 0; i < 120; i++) world.updateCamera(1/60);
      return true;
    })()`);
    await sleep(700);
    const layers = JSON.parse(await browser.eval(`(function(){
      var c = document.getElementById("cv");
      var g = c.getContext("2d");
      var W = c.width, H = c.height;
      // 擂台中心 vs 紧贴擂台边框外侧的一条带（那里就是外层背景）。
      // 不取最角上：角落叠了暗角，颜色会被压低，不适合判定"两层不同"。
      var mid = g.getImageData(Math.round(W/2), Math.round(H/2), 1, 1).data;
      var outerPt = g.getImageData(Math.round(W*0.08), Math.round(H*0.5), 1, 1).data;
      var dx = Math.abs(mid[0]-outerPt[0]) + Math.abs(mid[1]-outerPt[1]) + Math.abs(mid[2]-outerPt[2]);
      return JSON.stringify({
        mid: [mid[0],mid[1],mid[2]], outer: [outerPt[0],outerPt[1],outerPt[2]], diff: dx
      });
    })()`));
    check("擂台内与外层颜色不同（确实两层）", layers.diff > 8,
      "中心 rgb(" + layers.mid.join(",") + ") vs 外层 rgb(" + layers.outer.join(",") +
      ") 差值 " + layers.diff);

    console.log("\n=== 6. 缩放滑块下限已放宽 ===");
    const slider = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var s = document.getElementById("camZoom");
      return { min: parseFloat(s.min), max: parseFloat(s.max) };
    })())`));
    check("滑块最小值为 0.5", slider.min === 0.5, "min=" + slider.min);
    check("滑块最大值为 3", slider.max === 3, "max=" + slider.max);

    console.log("\n=== 7. 预设按钮 ===");
    const preset = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var btns = document.querySelectorAll(".cam-preset");
      var n = btns.length;
      btns[0].click();                     // 0.6× 远景
      var afterFirst = window.MA.CONFIG.camera.followZoom;
      btns[n-1].click();                   // 最后一个 = 2.2× 特写
      var afterLast = window.MA.CONFIG.camera.followZoom;
      return { count: n, afterFirst: afterFirst, afterLast: afterLast };
    })())`));
    // 预设按钮包含 0.6 / 0.8(默认) / 1 / 1.5 / 2.2 共 5 个；
    // 这里只断言"至少 4 个 + 首尾两个预设生效"，避免以后再加档位又要改测试。
    check("预设按钮至少 4 个", preset.count >= 4, preset.count + " 个");
    check("远景预设生效", Math.abs(preset.afterFirst - 0.6) < 0.001, preset.afterFirst);
    check("特写预设生效", Math.abs(preset.afterLast - 2.2) < 0.001, preset.afterLast);

    console.log("\n=== 7b. 外层图案与明暗可调 ===");
    const outerUI = JSON.parse(await browser.eval(`JSON.stringify((function(){
      // 关键：必须缩到 <1× 让外层区域进入视野。
      // 2.2× 特写且角色在场地中央时，画面完全落在擂台内部，
      // 这时改外层图案当然看不出变化 —— 那是测试场景选错了，不是功能坏了。
      window.MA.CONFIG.camera.followZoom = 0.6;
      world.setCameraMode("follow");
      world.cam.zoom = 0.6;
      var t = world.getCamTarget();
      if (t) { t.x = world.arena/2; t.y = world.arena/2; t.vx = 0; t.vy = 0; }
      for (var i = 0; i < 150; i++) world.updateCamera(1/60);
      world.cam.zoom = 0.6;

      // 控件已归入"三层背景 → 外层"面板，id 分别是 oPattern / oOverlay / oOverlayV
      var sel = document.getElementById("oPattern");
      var rng = document.getElementById("oOverlay");
      var val = document.getElementById("oOverlayV");
      var controlsExist = !!sel && !!rng && !!val;

      // 采样画布左上角一块较大区域（外层背景所在），
      // 采样窗口要够大才能覆盖到图案线条：46 世界像素间距 / 0.6 zoom ≈ 77 设备像素
      function fp(){
        var c = document.getElementById("cv");
        var g = c.getContext("2d");
        var n = 160;
        var d = g.getImageData(4, 4, n, n).data, h = 0;
        for (var i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i+1]*3 + d[i+2]*7) % 1000000007;
        return h;
      }

      // 外层是否真的可见：角落像素应与擂台内部不同
      var corner = (function(){
        var c = document.getElementById("cv"); var g = c.getContext("2d");
        return g.getImageData(8, 8, 1, 1).data[0];
      })();

      sel.value = "grid"; sel.dispatchEvent(new Event("change"));
      drawWorld(world); var grid = fp();
      sel.value = "rings"; sel.dispatchEvent(new Event("change"));
      drawWorld(world); var rings = fp();
      sel.value = "none"; sel.dispatchEvent(new Event("change"));
      drawWorld(world); var none = fp();

      sel.value = "grid"; sel.dispatchEvent(new Event("change"));
      rng.value = "0"; rng.dispatchEvent(new Event("input"));
      drawWorld(world); var light = fp();
      rng.value = "0.85"; rng.dispatchEvent(new Event("input"));
      drawWorld(world); var dark = fp();

      return {
        controlsExist: controlsExist,
        cornerRed: corner,
        pattern: window.MA.CONFIG.render.background.outer.pattern,
        gridVsRings: grid !== rings,
        gridVsNone: grid !== none,
        overlayCfg: window.MA.CONFIG.render.background.outer.overlay,
        label: val.value,
        brightnessDiff: light !== dark
      };
    })())`));
    check("外层控件齐全", outerUI.controlsExist === true);
    check("缩到 0.6× 后外层进入视野", outerUI.cornerRed > 0,
      "左上角 R=" + outerUI.cornerRed);
    check("切换图案改变画面", outerUI.gridVsRings === true && outerUI.gridVsNone === true,
      "网格≠同心圆: " + outerUI.gridVsRings + ", 网格≠纯色: " + outerUI.gridVsNone);
    check("外层明暗滑块生效", Math.abs(outerUI.overlayCfg - 0.85) < 0.001,
      "overlay=" + outerUI.overlayCfg + " 标签 " + outerUI.label);
    check("明暗改变画面", outerUI.brightnessDiff === true);
    // 复位
    await browser.eval(`(function(){
      window.MA.CONFIG.render.background.outer.pattern = "grid";
      window.MA.CONFIG.render.background.outer.overlay = 0.55;
      return true;
    })()`);

    console.log("\n=== 8. 截图 ===");
    const shots = [
      { z: 0.6, name: "outer-06.png" },
      { z: 1.0, name: "outer-10.png" },
      { z: 1.5, name: "outer-15.png" },
      { z: 2.2, name: "outer-22.png" }
    ];
    for (const s of shots) {
      await browser.eval(`(function(){
        window.MA.CONFIG.camera.followZoom = ${s.z};
        world.cam.zoom = ${s.z};
        return true;
      })()`);
      await sleep(500);
      const size = await browser.screenshot(path.join(OUT, s.name));
      check("截图 " + s.name, size > 20000, (size / 1024).toFixed(0) + " KB");
    }

    console.log("\n=== 9. 无报错 ===");
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
