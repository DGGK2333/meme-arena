/* =========================================================================
 * tools/verify-zone.js —— 缩圈与圈外滤镜验证
 * 检查：
 *   1. 缩圈开关：开 → 半径随时间变小；关 → 半径固定不动
 *   2. 圈外滤镜透明度影响画面
 *   3. 圈外颜色可改
 *   4. 扫描线 / 噪点 / 渐变开关各自影响画面
 *   5. 边缘柔化影响画面
 *   6. 安全区边界线：线宽 / 透明度 / 发光 / 隐藏
 *   7. 所有控件在侧栏存在且写回配置
 * 用法：node tools/verify-zone.js
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

/* 取画布上一个"圈外"的位置（擂台角落附近）做指纹 */
const OUTSIDE_FP = `(function(){
  var c = document.getElementById("cv"), g = c.getContext("2d");
  var W = c.width, H = c.height;
  // 取左上角一块：全局视野下这里在安全区之外
  var n = 90;
  var d = g.getImageData(6, 6, n, n).data;
  var h = 0;
  for (var i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i+1]*3 + d[i+2]*7 + d[i+3]) % 1000000007;
  return h;
})()`;

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
    await sleep(900);

    console.log("=== 1. 配置与控件就位 ===");
    const mod = JSON.parse(await browser.eval(`JSON.stringify({
      zoneEnabled: window.MA.CONFIG.arena.zoneEnabled,
      hasPoisonFx: !!window.MA.CONFIG.arena.poisonFx,
      hasZoneRing: !!window.MA.CONFIG.arena.zoneRing,
      fxKeys: Object.keys(window.MA.CONFIG.arena.poisonFx || {}),
      ringKeys: Object.keys(window.MA.CONFIG.arena.zoneRing || {}),
      shrinkOptions: Array.prototype.map.call(
        document.getElementById("optShrink").options, function(o){ return o.value; }),
      controls: [
        "zEnabled","zFxEnabled","zOpacity","zColor","zColor2","zGradient",
        "zScan","zScanOpacity","zNoise","zNoiseOpacity","zBlurEdges","zPulse",
        "zRingEnabled","zRingWidth","zRingOpacity","zRingGlow"
      ].filter(function(id){ return !document.getElementById(id); })
    })`));
    check("安全区总开关存在", mod.zoneEnabled !== undefined, "zoneEnabled=" + mod.zoneEnabled);
    check("圈外滤镜配置存在", mod.hasPoisonFx, mod.fxKeys.join(","));
    check("边界线配置存在", mod.hasZoneRing, mod.ringKeys.join(","));
    check("缩圈速度里不再有重复的「不缩圈」选项",
      mod.shrinkOptions.indexOf("0") < 0 && mod.shrinkOptions.length === 3,
      mod.shrinkOptions.join("/"));
    check("全部 16 个控件都在侧栏", mod.controls.length === 0,
      mod.controls.length ? "缺少: " + mod.controls.join(",") : "16/16");

    console.log("\n=== 2. 安全区开关：开 = 缩圈，关 = 完全停摆 ===");
    const shrinkTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var A = window.MA.CONFIG.arena;
      world.autoRestart = false;
      var ids = ["moyu","kunkun","hajimi","creeper","saibo","fanqie"];

      // --- 开：推进 20 秒，半径应明显变小 ---
      A.zoneEnabled = true;
      world.reset(ids);
      world.shrink = 1;
      world.time = 0;
      world.softR = world.arena * A.safeZoneStart;
      var r0 = world.softR;
      for (var i = 0; i < 60 * 20; i++) world.step(1/60);
      var rOn = world.softR;
      var dmgOn = world.units.some(function(u){ return u.poison > 0; });

      // --- 关：推进 20 秒，半径保持"覆盖全擂台"，且没有任何圈外伤害 ---
      A.zoneEnabled = false;
      world.reset(ids);
      world.shrink = 1;
      world.time = 0;
      var rOff0 = world.softR;
      var anyPoison = false, anyPoisonAcc = false;
      for (var j = 0; j < 60 * 20; j++) {
        world.step(1/60);
        for (var k = 0; k < world.units.length; k++) {
          if (world.units[k].poison > 0) anyPoison = true;
          if ((world.units[k].poisonAcc || 0) > 0) anyPoisonAcc = true;
        }
      }
      var rOff = world.softR;
      var offZoneFlag = world.zoneOn;

      // 恢复并 reset：此时 zoneEnabled 已改回 true，reset 后应重新启用
      A.zoneEnabled = true;
      world.reset(ids);
      var afterResetFlag = world.zoneOn;

      return {
        arena: world.arena,
        r0: r0, rOn: rOn,
        rOff0: rOff0, rOff: rOff,
        offZoneFlag: offZoneFlag,
        afterResetFlag: afterResetFlag,
        dmgOn: dmgOn,
        offPoisonFlag: anyPoison, offPoisonAcc: anyPoisonAcc
      };
    })())`));
    check("开局半径 = 擂台 × 0.92", Math.abs(shrinkTest.r0 - shrinkTest.arena * 0.92) < 1,
      shrinkTest.r0.toFixed(0) + " / " + (shrinkTest.arena * 0.92).toFixed(0));
    check("开启：20 秒后半径明显变小", shrinkTest.rOn < shrinkTest.r0 - 50,
      shrinkTest.r0.toFixed(0) + " → " + shrinkTest.rOn.toFixed(0));
    check("关闭：安全区扩到覆盖整个擂台", shrinkTest.rOff > shrinkTest.arena * 1.2,
      "softR=" + shrinkTest.rOff.toFixed(0) + "（擂台 " + shrinkTest.arena + "）");
    check("关闭：完全没有任何圈外伤害标记", shrinkTest.offPoisonFlag === false);
    check("关闭：不累计毒圈伤害", shrinkTest.offPoisonAcc === false);
    check("关闭期间 zoneOn=false", shrinkTest.offZoneFlag === false);
    check("重新开启并 reset 后 zoneOn=true", shrinkTest.afterResetFlag === true);

    console.log("\n=== 3. 圈外透明度 ===");
    // 固定一个稳定的场景：缩小镜头让圈外大面积可见。
    // 这里用手动指定 softR 的方式固定安全区大小（不靠缩圈开关）。
    await browser.eval(`(function(){
      window.MA.CONFIG.arena.poisonFx.enabled = true;
      window.MA.CONFIG.camera.followZoom = 0.6;
      world.setCameraMode("follow");
      world.cam.zoom = 0.6;
      world.reset(["moyu","kunkun","hajimi","creeper","saibo","fanqie"]);
      world.zoneOn = true;
      world.softR = world.arena * 0.45;      // 固定半径，圈外区域才够大
      world.softX = world.arena / 2;
      world.softY = world.arena / 2;
      for (var i = 0; i < 150; i++) world.updateCamera(1/60);
      world.cam.zoom = 0.6;
      world.paused = true;
      return true;
    })()`);
    await sleep(400);

    const opacityTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var fx = window.MA.CONFIG.arena.poisonFx;
      function fp(){ drawWorld(world); return eval(${JSON.stringify("(" + OUTSIDE_FP + ")")}); }
      var out = {};
      fx.opacity = 0;    out.off = fp();
      fx.opacity = 0.16; out.low = fp();
      fx.opacity = 0.6;  out.high = fp();
      fx.opacity = 0.16;
      return { off: out.off, low: out.low, high: out.high };
    })())`));
    check("透明度 0 与 0.16 画面不同", opacityTest.off !== opacityTest.low);
    check("透明度 0.16 与 0.6 画面不同", opacityTest.low !== opacityTest.high);

    console.log("\n=== 4. 圈外颜色可改 ===");
    const colorTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var fx = window.MA.CONFIG.arena.poisonFx;
      fx.opacity = 0.5;
      function fp(){ drawWorld(world); return eval(${JSON.stringify("(" + OUTSIDE_FP + ")")}); }
      fx.color = "#ff3c50"; fx.color2 = "#7a0b28";
      var red = fp();
      fx.color = "#3cff50"; fx.color2 = "#0b7a28";
      var green = fp();
      fx.color = "#3c50ff"; fx.color2 = "#0b287a";
      var blue = fp();
      fx.color = "#ff3c50"; fx.color2 = "#7a0b28"; fx.opacity = 0.16;
      return { red: red, green: green, blue: blue };
    })())`));
    check("红/绿/蓝三种颜色画面各不相同",
      colorTest.red !== colorTest.green && colorTest.green !== colorTest.blue &&
      colorTest.red !== colorTest.blue,
      "红" + colorTest.red + " 绿" + colorTest.green + " 蓝" + colorTest.blue);

    console.log("\n=== 5. 扫描线 / 噪点 / 渐变 / 柔边 ===");
    const fxTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var fx = window.MA.CONFIG.arena.poisonFx;
      fx.opacity = 0.4; fx.color = "#ff3c50"; fx.color2 = "#7a0b28";
      function fp(){ drawWorld(world); return eval(${JSON.stringify("(" + OUTSIDE_FP + ")")}); }

      // 扫描线
      fx.scanlines = false; var noScan = fp();
      fx.scanlines = true; fx.scanOpacity = 1; var withScan = fp();
      fx.scanOpacity = 0.3;
      // 噪点
      fx.noise = false; var noNoise = fp();
      fx.noise = true; fx.noiseOpacity = 1; var withNoise = fp();
      fx.noiseOpacity = 0.22;
      // 渐变
      fx.gradient = false; var flat = fp();
      fx.gradient = true; var grad = fp();

      // 柔边：必须"贴着安全区边界外侧"取样才能看到效果。
      // 画布角落距离圆周可能有两三百像素，而柔化带最宽只有几十像素，
      // 在那里取样当然测不出变化 —— 那是取样点选错了。
      fx.blurEdges = 0;
      function ringSample(){
        drawWorld(world);
        var c = document.getElementById("cv"), g = c.getContext("2d");
        var W = c.width, H = c.height, z = world.cam.zoom;
        var d = [];
        for (var off = 2; off <= 24; off += 4) {
          var wx = world.softX + world.softR + off;
          var wy = world.softY;
          var sx = Math.round(W/2 + (wx - world.cam.x) * z);
          var sy = Math.round(H/2 + (wy - world.cam.y) * z);
          if (sx < 0 || sx >= W || sy < 0 || sy >= H) continue;
          d.push(g.getImageData(sx, sy, 1, 1).data[0]);
        }
        return d.join(",");
      }
      var hard = ringSample();
      fx.blurEdges = 100;
      var soft = ringSample();
      fx.blurEdges = 6;
      drawWorld(world);

      return {
        scanDiff: noScan !== withScan,
        noiseDiff: noNoise !== withNoise,
        gradDiff: flat !== grad,
        blurDiff: hard !== soft,
        hardRing: hard, softRing: soft
      };
    })())`));
    check("扫描线开关改变画面", fxTest.scanDiff === true);
    check("噪点开关改变画面", fxTest.noiseDiff === true);
    check("渐变开关改变画面", fxTest.gradDiff === true);
    check("边缘柔化改变画面（边界外侧取样）", fxTest.blurDiff === true,
      "柔化0: " + fxTest.hardRing + "  |  柔化100: " + fxTest.softRing);

    console.log("\n=== 6. 圈外滤镜总开关 ===");
    const fxEnabledTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var fx = window.MA.CONFIG.arena.poisonFx;
      fx.opacity = 0.5;
      fx.enabled = true;  drawWorld(world); var on = eval(${JSON.stringify("(" + OUTSIDE_FP + ")")});
      fx.enabled = false; drawWorld(world); var off = eval(${JSON.stringify("(" + OUTSIDE_FP + ")")});
      fx.enabled = true; fx.opacity = 0.16;
      return { on: on, off: off };
    })())`));
    check("关掉滤镜后圈外不再是毒色", fxEnabledTest.on !== fxEnabledTest.off,
      "开=" + fxEnabledTest.on + " 关=" + fxEnabledTest.off);

    console.log("\n=== 6b. 关闭安全区时特效必须完全消失 ===");
    const offTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var A = window.MA.CONFIG.arena;
      var fx = A.poisonFx;
      // 故意把滤镜开得很浓，如果关闭后还能看到，说明开关没生效
      fx.enabled = true; fx.opacity = 0.7; fx.scanlines = true;
      fx.scanOpacity = 1; fx.noise = true; fx.noiseOpacity = 1;
      A.zoneRing.enabled = true; A.zoneRing.opacity = 1; A.zoneRing.glow = 30;

      function fp(){
        drawWorld(world);
        var c = document.getElementById("cv"), g = c.getContext("2d");
        var n = 90;
        var d = g.getImageData(6, 6, n, n).data, h = 0;
        for (var i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i+1]*3 + d[i+2]*7) % 1000000007;
        return h;
      }

      // 开：圈外有浓滤镜
      A.zoneEnabled = true;
      world.zoneOn = true;
      var on = fp();

      // 关：什么都不该有
      A.zoneEnabled = false;
      world.zoneOn = false;
      var off = fp();

      // 再和"滤镜本身关掉"对比：两者应完全一致（说明关闭时确实什么都没画）
      A.zoneEnabled = true;
      world.zoneOn = true;
      fx.enabled = false;
      var fxDisabled = fp();

      // 复位
      A.zoneEnabled = true; world.zoneOn = true;
      fx.enabled = true; fx.opacity = 0.16; fx.scanOpacity = 0.30;
      fx.noiseOpacity = 0.22;
      A.zoneRing.opacity = 0.78; A.zoneRing.glow = 8;
      return { on: on, off: off, fxDisabled: fxDisabled };
    })())`));
    check("开启时圈外有滤镜", offTest.on !== offTest.off,
      "开=" + offTest.on + " 关=" + offTest.off);
    check("关闭安全区后画面 = 完全没有圈特效的画面",
      offTest.off === offTest.fxDisabled,
      "关闭=" + offTest.off + " 滤镜关=" + offTest.fxDisabled);

    // 用像素直接验证：关闭后画布角落不应出现明显的红色毒区
    const pixelCheck = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var A = window.MA.CONFIG.arena;
      function cornerPixel(){
        drawWorld(world);
        var c = document.getElementById("cv"), g = c.getContext("2d");
        var W = c.width, H = c.height;
        var d = g.getImageData(4, 4, 1, 1).data;
        return [d[0], d[1], d[2]];
      }
      A.poisonFx.color = "#ff0000";
      A.poisonFx.opacity = 0.8;
      A.zoneEnabled = true; world.zoneOn = true;
      var on = cornerPixel();
      A.zoneEnabled = false; world.zoneOn = false;
      var off = cornerPixel();
      // 复位
      A.zoneEnabled = true; world.zoneOn = true;
      A.poisonFx.color = "#ff3c50"; A.poisonFx.opacity = 0.16;
      return { on: on, off: off };
    })())`));
    // 开启时是红色主导（R 明显大于 B）；关闭后不该再有这种红色偏移
    check("开启时角落呈毒色（R 明显高于 B）",
      pixelCheck.on[0] > pixelCheck.on[2] + 30,
      "rgb(" + pixelCheck.on.join(",") + ")");
    check("关闭后角落不再偏红",
      pixelCheck.off[0] <= pixelCheck.off[2] + 30,
      "rgb(" + pixelCheck.off.join(",") + ")");

    console.log("\n=== 7. 安全区边界线 ===");
    // 先把镜头对准圆周上的一点，保证取样区域一定在画面内
    await browser.eval(`(function(){
      // 缩到 0.6× 让整个擂台和圆周都进入视野
      window.MA.CONFIG.camera.followZoom = 0.6;
      world.setCameraMode("follow");
      world.cam.zoom = 0.6;
      var t = world.getCamTarget();
      if (t) { t.x = world.arena/2; t.y = world.arena/2; t.vx = 0; t.vy = 0; }
      for (var i = 0; i < 150; i++) world.updateCamera(1/60);
      world.cam.zoom = 0.6;
      world.paused = true;
      return true;
    })()`);
    await sleep(300);
    const ringTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var zr = window.MA.CONFIG.arena.zoneRing;
      zr.enabled = true; zr.width = 3; zr.opacity = 1; zr.glow = 20; zr.pulse = 0;
      // 把安全区手动缩小到擂台中心附近，这样圆周一定在画面内
      // （默认 softR≈673 和擂台几乎一样大，缩到 0.6× 时圆周仍在画面外）
      world.softR = world.arena * 0.30;
      world.softX = world.arena / 2;
      world.softY = world.arena / 2;

      var c = document.getElementById("cv"), g = c.getContext("2d");
      var W = c.width, H = c.height, z = world.cam.zoom;
      var wx = world.softX + world.softR;
      var wy = world.softY;
      var sx = Math.round(W/2 + (wx - world.cam.x) * z);
      var sy = Math.round(H/2 + (wy - world.cam.y) * z);
      var visible = (sx > 30 && sx < W - 30 && sy > 30 && sy < H - 30);

      function fp(){
        drawWorld(world);
        if (!visible) return -1;
        var d = g.getImageData(sx - 20, sy - 24, 40, 48).data, h = 0;
        for (var i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i+1]*3 + d[i+2]*7) % 1000000007;
        return h;
      }
      zr.width = 1;  var thin = fp();
      zr.width = 12; var thick = fp();
      zr.width = 3;
      zr.opacity = 0.1; var faint = fp();
      zr.opacity = 1;   var solid = fp();
      zr.glow = 0;      var noGlow = fp();
      zr.glow = 40;     var glow = fp();
      zr.glow = 20;
      zr.enabled = false; var hidden = fp();
      zr.enabled = true;  var shown = fp();
      zr.width = 2.5; zr.opacity = 0.78; zr.glow = 8;
      return {
        visible: visible, sx: sx, sy: sy, W: W, H: H,
        softR: world.softR, zoom: z, camX: world.cam.x, camY: world.cam.y,
        thin: thin, thick: thick, faint: faint, solid: solid,
        noGlow: noGlow, glow: glow, hidden: hidden, shown: shown,
        widthDiff: thin !== thick, opacityDiff: faint !== solid,
        glowDiff: noGlow !== glow, enabledDiff: hidden !== shown
      };
    })())`));
    check("圆周取样点在画面内", ringTest.visible === true,
      "屏幕(" + ringTest.sx + "," + ringTest.sy + ") 画布 " + ringTest.W + "×" + ringTest.H +
      " softR=" + ringTest.softR.toFixed(0));
    check("线宽改变画面", ringTest.widthDiff === true);
    check("线透明度改变画面", ringTest.opacityDiff === true);
    check("发光强度改变画面", ringTest.glowDiff === true);
    check("隐藏/显示边界线改变画面", ringTest.enabledDiff === true);

    console.log("\n=== 8. 侧栏控件写回配置 ===");
    const uiWrite = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var fx = window.MA.CONFIG.arena.poisonFx;
      var zr = window.MA.CONFIG.arena.zoneRing;
      var A = window.MA.CONFIG.arena;
      function set(id, v){ var e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("input")); }

      set("zEnabled", "0");
      var zoneOff = A.zoneEnabled;
      var zoneOffWorld = world.zoneOn;
      var groupDimmed = document.getElementById("zFxGroup").style.opacity === "0.4";
      var noteShown = document.getElementById("zOffNote").style.display !== "none";
      var shrinkDisabled = document.getElementById("optShrink").disabled;
      set("zEnabled", "1");
      var zoneOn = A.zoneEnabled;
      var zoneOnWorld = world.zoneOn;
      var groupNormal = document.getElementById("zFxGroup").style.opacity === "1";
      var shrinkEnabled = !document.getElementById("optShrink").disabled;

      set("zFxEnabled", "0"); var fxOff = fx.enabled;
      set("zFxEnabled", "1"); var fxOn = fx.enabled;

      set("zOpacity", "0.44");      var op = fx.opacity;
      set("zColor", "#123456");     var col = fx.color;
      set("zScan", "0");            var scan = fx.scanlines;
      set("zScanOpacity", "0.77");  var scanOp = fx.scanOpacity;
      set("zNoise", "0");           var noise = fx.noise;
      set("zNoiseOpacity", "0.66"); var noiseOp = fx.noiseOpacity;
      set("zBlurEdges", "33");      var blurE = fx.blurEdges;
      set("zPulse", "0.5");         var pulse = fx.pulse;
      set("zGradient", "0");        var grad = fx.gradient;

      set("zRingEnabled", "0");     var ringOff = zr.enabled;
      set("zRingWidth", "7.5");     var ringW = zr.width;
      set("zRingOpacity", "0.33");  var ringOp = zr.opacity;
      set("zRingGlow", "25");       var ringGlow = zr.glow;

      var labels = {
        op: document.getElementById("zOpacityV").value,
        scan: document.getElementById("zScanV").value,
        noise: document.getElementById("zNoiseV").value,
        ringOp: document.getElementById("zRingOpacityV").value,
        ringW: document.getElementById("zRingWidthV").value
      };

      // 复位
      set("zEnabled","1"); set("zFxEnabled","1"); set("zOpacity","0.16");
      set("zColor","#ff3c50"); set("zScan","1"); set("zScanOpacity","0.30");
      set("zNoise","1"); set("zNoiseOpacity","0.22"); set("zBlurEdges","6");
      set("zPulse","0.35"); set("zGradient","1"); set("zRingEnabled","1");
      set("zRingWidth","2.5"); set("zRingOpacity","0.78"); set("zRingGlow","8");

      return {
        zoneOff: zoneOff, zoneOn: zoneOn,
        zoneOffWorld: zoneOffWorld, zoneOnWorld: zoneOnWorld,
        groupDimmed: groupDimmed, groupNormal: groupNormal,
        noteShown: noteShown, shrinkDisabled: shrinkDisabled, shrinkEnabled: shrinkEnabled,
        fxOff: fxOff, fxOn: fxOn,
        op: op, col: col, scan: scan, scanOp: scanOp,
        noise: noise, noiseOp: noiseOp, blurE: blurE, pulse: pulse, grad: grad,
        ringOff: ringOff, ringW: ringW, ringOp: ringOp, ringGlow: ringGlow,
        labels: labels
      };
    })())`));
    check("总开关写回配置", uiWrite.zoneOff === false && uiWrite.zoneOn === true);
    check("总开关同步到 world.zoneOn",
      uiWrite.zoneOffWorld === false && uiWrite.zoneOnWorld === true);
    check("关闭时整组控件变灰", uiWrite.groupDimmed === true);
    check("关闭时显示说明文字", uiWrite.noteShown === true);
    check("关闭时缩圈速度下拉被禁用", uiWrite.shrinkDisabled === true);
    check("重新开启后控件恢复", uiWrite.groupNormal === true && uiWrite.shrinkEnabled === true);
    check("滤镜开关写回配置", uiWrite.fxOff === false && uiWrite.fxOn === true);
    check("透明度写回", Math.abs(uiWrite.op - 0.44) < 0.001, String(uiWrite.op));
    check("颜色写回", uiWrite.col === "#123456", uiWrite.col);
    check("扫描线开关写回", uiWrite.scan === false);
    check("扫描线强度写回", Math.abs(uiWrite.scanOp - 0.77) < 0.001);
    check("噪点开关写回", uiWrite.noise === false);
    check("噪点强度写回", Math.abs(uiWrite.noiseOp - 0.66) < 0.001);
    check("边缘柔化写回", uiWrite.blurE === 33, String(uiWrite.blurE));
    check("脉动写回", Math.abs(uiWrite.pulse - 0.5) < 0.001);
    check("渐变开关写回", uiWrite.grad === false);
    check("边界线开关写回", uiWrite.ringOff === false);
    check("线宽写回", Math.abs(uiWrite.ringW - 7.5) < 0.001, String(uiWrite.ringW));
    check("线透明度写回", Math.abs(uiWrite.ringOp - 0.33) < 0.001);
    check("发光写回", uiWrite.ringGlow === 25, String(uiWrite.ringGlow));
    check("数值标签同步更新",
      uiWrite.labels.op === "44%" && uiWrite.labels.scan === "77%" &&
      uiWrite.labels.noise === "66%" && uiWrite.labels.ringOp === "33%" &&
      uiWrite.labels.ringW === "7.5",
      JSON.stringify(uiWrite.labels));

    console.log("\n=== 9. 截图 ===");
    await browser.eval(`(function(){
      world.paused = false;
      window.MA.CONFIG.arena.zoneEnabled = true;
      window.MA.CONFIG.arena.poisonFx.enabled = true;
      window.MA.CONFIG.arena.zoneRing.enabled = true;
      window.MA.CONFIG.camera.followZoom = 0.75;
      world.cam.zoom = 0.75;
      world.setCameraMode("follow");
      return true;
    })()`);
    await sleep(1500);
    const s1 = await browser.screenshot(path.join(OUT, "zone-01-default.png"));
    check("默认缩圈截图", s1 > 20000, (s1 / 1024).toFixed(0) + " KB");

    // 完全关闭安全区：不该有任何圈特效
    await browser.eval(`(function(){
      window.MA.CONFIG.arena.zoneEnabled = false;
      world.zoneOn = false;
      return true;
    })()`);
    await sleep(1200);
    const s2 = await browser.screenshot(path.join(OUT, "zone-02-off.png"));
    check("完全关闭安全区截图", s2 > 20000, (s2 / 1024).toFixed(0) + " KB");

    // 浓毒圈：手动把安全区设成半个擂台，滤镜效果才看得清
    // （用 safeZoneStart 会影响 softR 的计算，所以直接指定 softR 更可控）
    await browser.eval(`(function(){
      window.MA.CONFIG.arena.zoneEnabled = true;
      window.MA.CONFIG.arena.poisonFx.enabled = true;
      window.MA.CONFIG.arena.poisonFx.opacity = 0.45;
      window.MA.CONFIG.arena.poisonFx.color = "#6600ff";
      window.MA.CONFIG.arena.poisonFx.color2 = "#1a0033";
      window.MA.CONFIG.arena.zoneRing.color = "#c084fc";
      window.MA.CONFIG.arena.zoneRing.glow = 24;
      world.zoneOn = true;
      world.softR = world.arena * 0.42;
      world.softX = world.arena / 2;
      world.softY = world.arena / 2;
      window.MA.CONFIG.camera.followZoom = 0.85;
      world.cam.zoom = 0.85;
      return true;
    })()`);
    await sleep(1400);
    const s3 = await browser.screenshot(path.join(OUT, "zone-03-heavy.png"));
    check("浓毒圈截图", s3 > 20000, (s3 / 1024).toFixed(0) + " KB");

    // 扫描线 + 噪点全开，做一张"颗粒感"对比图
    await browser.eval(`(function(){
      var fx = window.MA.CONFIG.arena.poisonFx;
      fx.opacity = 0.30; fx.scanlines = true; fx.scanOpacity = 0.9;
      fx.noise = true; fx.noiseOpacity = 0.7; fx.blurEdges = 24;
      fx.color = "#ff3c50"; fx.color2 = "#7a0b28";
      window.MA.CONFIG.arena.zoneRing.color = "#ff5a6e";
      window.MA.CONFIG.arena.zoneRing.glow = 16;
      fx.gradient = true;
      return true;
    })()`);
    await sleep(1200);
    const s4 = await browser.screenshot(path.join(OUT, "zone-04-textured.png"));
    check("扫描线+噪点截图", s4 > 20000, (s4 / 1024).toFixed(0) + " KB");

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
