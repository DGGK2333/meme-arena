/* =========================================================================
 * tools/verify-background.js —— 验证背景主题与图片替换
 * 检查：
 *   1. 5 个预设主题能切换，并且真的改变了画布像素
 *   2. 上传图片后能走图片分支（drawImage 被调用）
 *   3. 可见度 / 遮罩滑杆生效
 *   4. 恢复默认能回到主题
 *   5. 背景缓存命中：连续两帧只重建一次
 * 用法：node tools/verify-background.js
 * ========================================================================= */
"use strict";

const path = require("path");
const { Browser, sleep, reapStaleProcesses } = require("./cdp");

const ROOT = path.resolve(__dirname, "..");
const URL = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");

let failures = 0;
function check(label, cond, detail) {
  console.log((cond ? "  ✓ " : "  ✗ ") + label + (detail ? "  " + detail : ""));
  if (!cond) failures++;
}

/* 取擂台画布中心区域的像素指纹，用来判断背景是否真的变了 */
const FINGERPRINT = `(function(){
  var c = document.getElementById("cv");
  var g = c.getContext("2d");
  var n = 48;
  var d = g.getImageData(Math.round(c.width/2 - n/2), Math.round(c.height/2 - n/2), n, n).data;
  var h = 0;
  for (var i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i+1]*3 + d[i+2]*7) % 1000000007;
  return h;
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
    await sleep(900);

    console.log("=== 1. 背景模块已加载 ===");
    const mod = JSON.parse(await browser.eval(`JSON.stringify({
      hasBg: !!(window.MA && window.MA.Background),
      themes: window.MA.Background ? Object.keys(window.MA.Background.themes) : [],
      preset: window.MA.Background ? window.MA.Background.preset : null,
      hasSelect: !!document.getElementById("optBg"),
      // 「选择擂台图 / 恢复默认」已从"战场设置"删除（与三层背景面板重复）。
      // 换图统一走三层背景面板的 btnLayerUpload + layerFile。
      hasUpload: !!document.getElementById("btnLayerUpload"),
      hasLayerFile: !!document.getElementById("layerFile"),
      hasLayerReset: !!document.getElementById("btnLayerReset"),
      // 确认"战场设置"里那组重复控件真的没了
      hasDupUpload: !!document.getElementById("btnBgUpload"),
      hasDupReset: !!document.getElementById("btnBgReset"),
      hasDupFile: !!document.getElementById("bgFile"),
      // 控件已演进成"三层背景"面板：内层的透明度/遮罩现在是 iOpacity/iOverlay
      hasOpacity: !!document.getElementById("iOpacity"),
      hasOverlay: !!document.getElementById("iOverlay"),
      hasLayerTabs: document.querySelectorAll("#layerTabs button").length,
      hasLayerPanels: document.querySelectorAll(".layer-panel").length
    })`));
    check("Background 模块已加载", mod.hasBg);
    check("5 个预设主题", mod.themes.length === 5, mod.themes.join(" / "));
    check("默认主题有效", mod.themes.indexOf(mod.preset) >= 0, mod.preset);
    check("界面控件齐全", mod.hasSelect && mod.hasUpload && mod.hasLayerFile && mod.hasLayerReset &&
      mod.hasOpacity && mod.hasOverlay,
      "主题选择/换图/换图输入/层重置/内层透明度/内层遮罩");
    check("「战场设置」里重复的背景控件已移除",
      !mod.hasDupUpload && !mod.hasDupReset && !mod.hasDupFile,
      "btnBgUpload=" + mod.hasDupUpload + " btnBgReset=" + mod.hasDupReset +
      " bgFile=" + mod.hasDupFile);
    check("三层背景面板齐全", mod.hasLayerTabs === 3 && mod.hasLayerPanels === 3,
      mod.hasLayerTabs + " 个标签 / " + mod.hasLayerPanels + " 个面板");

    console.log("\n=== 2. 主题切换真的改变画面 ===");
    // 暂停世界，保证只有背景在变
    await browser.eval(`(function(){ world.paused = true; return true; })()`);
    const prints = {};
    for (const theme of mod.themes) {
      await browser.eval(`window.MA.Background.setPreset("${theme}"); drawWorld(world); true`);
      prints[theme] = await browser.eval(FINGERPRINT);
    }
    const uniq = new Set(Object.values(prints));
    check("每个主题画面各不相同", uniq.size === mod.themes.length,
      uniq.size + "/" + mod.themes.length + " 种");
    Object.entries(prints).forEach(([k, v]) => console.log("    " + k.padEnd(8) + " " + v));

    console.log("\n=== 3. 下拉框与页面主题色联动 ===");
    const sel = await browser.eval(`(function(){
      var s = document.getElementById("optBg");
      s.value = "sunset";
      s.dispatchEvent(new Event("change"));
      return JSON.stringify({
        preset: window.MA.Background.preset,
        glowA: getComputedStyle(document.documentElement).getPropertyValue("--page-glow-a").trim()
      });
    })()`);
    const S = JSON.parse(sel);
    check("下拉框切换主题生效", S.preset === "sunset", S.preset);
    check("页面光晕颜色联动", S.glowA.length > 0, S.glowA);

    console.log("\n=== 4. 上传图片走图片分支 ===");
    // 造一张纯色图，模拟用户选择背景
    // 这里 IIFE 返回 Promise，Promise 内部已经 res(JSON.stringify(...))，
    // 所以外层不能再包一层 JSON.stringify（会双重编码）
    const upload = JSON.parse(await browser.eval(`(function(){
      var c = document.createElement("canvas"); c.width = c.height = 128;
      var g = c.getContext("2d");
      g.fillStyle = "#00ff88"; g.fillRect(0, 0, 128, 128);
      g.fillStyle = "#ff0044"; g.fillRect(0, 0, 64, 64);
      return new Promise(function(res){
        c.toBlob(function(blob){
          var file = new File([blob], "test-bg.png", { type: "image/png" });
          window.MA.Background.setFile(file).then(function(){
            res(JSON.stringify({
              preset: window.MA.Background.preset,
              hasCustom: window.MA.Background.hasCustomImage
            }));
          }, function(e){
            res(JSON.stringify({ error: e.message }));
          });
        }, "image/png");
      });
    })()`));
    check("图片上传成功", !upload.error, upload.error || "");
    check("自动切到自选图片", upload.preset === "custom", upload.preset);
    check("自选图已就绪", upload.hasCustom === true);

    await browser.eval(`drawWorld(world); true`);
    const withImage = await browser.eval(FINGERPRINT);
    check("图片背景改变了画面", withImage !== prints.sunset,
      withImage + " vs 主题 " + prints.sunset);

    // 确认渲染时确实调用了 drawImage
    const drawn = await browser.eval(`(function(){
      var g = world.ctx, orig = g.drawImage, n = 0;
      g.drawImage = function(){ n++; return orig.apply(g, arguments); };
      drawWorld(world);
      g.drawImage = orig;
      return n;
    })()`);
    check("背景用 drawImage 贴图", drawn >= 1, drawn + " 次");

    console.log("\n=== 5. 内层可见度 / 遮罩滑杆生效 ===");
    // 控件已归入"三层背景 → 内层"面板，id 分别是 iOpacity / iOverlay
    const slider = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var op = document.getElementById("iOpacity");
      var ov = document.getElementById("iOverlay");
      op.value = "1"; op.dispatchEvent(new Event("input")); drawWorld(world);
      op.value = "0.15"; op.dispatchEvent(new Event("input")); drawWorld(world);
      ov.value = "0.8"; ov.dispatchEvent(new Event("input")); drawWorld(world);
      return {
        opacity: window.MA.CONFIG.render.background.inner.opacity,
        overlay: window.MA.CONFIG.render.background.overlay,
        labelOpacity: document.getElementById("iOpacityV").value,
        labelOverlay: document.getElementById("iOverlayV").value
      };
    })())`));
    check("内层可见度写入配置", Math.abs(slider.opacity - 0.15) < 0.001, "opacity=" + slider.opacity);
    check("内层遮罩写入配置", Math.abs(slider.overlay - 0.8) < 0.001, "overlay=" + slider.overlay);
    check("滑杆百分比显示正确", slider.labelOpacity === "15%" && slider.labelOverlay === "80%",
      slider.labelOpacity + " / " + slider.labelOverlay);

    // 不同可见度应产生不同画面
    const visDiff = JSON.parse(await browser.eval(`JSON.stringify((function(){
      function fp(){
        var c = document.getElementById("cv"), g = c.getContext("2d"), n = 48;
        var d = g.getImageData(Math.round(c.width/2 - n/2), Math.round(c.height/2 - n/2), n, n).data;
        var h = 0;
        for (var i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i+1]*3 + d[i+2]*7) % 1000000007;
        return h;
      }
      var ov = document.getElementById("iOverlay"), op = document.getElementById("iOpacity");
      op.value = "1"; ov.value = "0"; op.dispatchEvent(new Event("input")); ov.dispatchEvent(new Event("input"));
      drawWorld(world); var a = fp();
      ov.value = "0.8"; ov.dispatchEvent(new Event("input"));
      drawWorld(world); var b = fp();
      return { a: a, b: b, diff: a !== b };
    })())`));
    check("遮罩变化影响画面", visDiff.diff === true);

    // IIFE 内部已 return JSON.stringify，外层不再重复包裹
    const cache = JSON.parse(await browser.eval(`(function(){
      var proto = CanvasRenderingContext2D.prototype;
      var gradCalls = 0;
      var origGrad = proto.createLinearGradient;
      proto.createLinearGradient = function(){
        gradCalls++;
        return origGrad.apply(this, arguments);
      };

      // 先切到一个主题并绘制，确保缓存已建立
      window.MA.Background.setPreset("ocean");
      drawWorld(world);
      gradCalls = 0;

      // 连续绘制 6 帧：背景未变化，不应重建（渐变创建 0 次）
      for (var i = 0; i < 6; i++) drawWorld(world);
      var cachedFrames = gradCalls;

      // 切换主题后应重建一次
      window.MA.Background.setPreset("paper");
      drawWorld(world);
      var afterSwitch = gradCalls;

      proto.createLinearGradient = origGrad;
      return JSON.stringify({ cachedFrames: cachedFrames, afterSwitch: afterSwitch });
    })()`));
    check("背景缓存命中（6 帧不重建）", cache.cachedFrames === 0, "重建 " + cache.cachedFrames + " 次");
    check("切主题后重建一次", cache.afterSwitch >= 1, "重建 " + cache.afterSwitch + " 次");

    console.log("\n=== 7. 恢复默认 ===");
    // 同样：Promise 内部已 res/return JSON.stringify
    const reset = JSON.parse(await browser.eval(`(function(){
      return window.MA.Background.reset().then(function(){
        drawWorld(world);
        return JSON.stringify({
          preset: window.MA.Background.preset,
          hasCustom: window.MA.Background.hasCustomImage
        });
      });
    })()`));
    check("恢复默认清除自选图", reset.hasCustom === false);
    check("恢复默认回到预设主题", mod.themes.indexOf(reset.preset) >= 0, reset.preset);

    console.log("\n=== 8. 无报错 ===");
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
