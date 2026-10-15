/* =========================================================================
 * tools/verify-persist.js —— 设置持久化验证
 *
 * 覆盖两件事：
 *   A. 血条里的血量数值只显示「当前血量」（不再是 当前/上限）
 *   B. 三层背景的设置（主题 / 各层缩放·偏移·透明度·模糊·图案·厚度…）
 *      以及三层的自选图，刷新之后仍然在
 *
 * 持久化的判定必须跨真实刷新：同一个浏览器 profile 下 navigate 两次，
 * 第二次读到的值才说明真的落盘了（只改内存是测不出来的）。
 *
 * 用法：node tools/verify-persist.js
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

/* 强制真实刷新。
 * 直接 Page.navigate 到同一个 URL 可能被当成"同地址"而不重载，所以走
 * Page.reload。同一个 origin 下 localStorage / IndexedDB 都会保留。 */
async function reload(browser) {
  await browser.reload();
}

/* 造一张纯色 PNG 的 File（模拟用户选图），返回 Promise<File> */
const MAKE_FILE = (color, name) => `(function(){
  return new Promise(function(res){
    var c = document.createElement("canvas"); c.width = c.height = 96;
    var g = c.getContext("2d");
    g.fillStyle = "${color}"; g.fillRect(0, 0, 96, 96);
    g.fillStyle = "#000"; g.fillRect(0, 0, 24, 24);
    c.toBlob(function(blob){
      res(new File([blob], "${name}", { type: "image/png" }));
    }, "image/png");
  });
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
    await sleep(1000);

    /* 干净起点：清掉可能残留的存档再重载 */
    await browser.eval(`(function(){
      window.MA.Settings.clear();
      try { indexedDB.deleteDatabase("meme-arena-local-assets"); } catch (e) {}
      return true;
    })()`);
    await reload(browser);
    await sleep(1200);

    console.log("=== A. 血条血量数值只显示当前血量 ===");
    const hpText = JSON.parse(await browser.eval(`JSON.stringify((function(){
      // 拦住 fillText，直接看画布上到底写了什么字符串
      var proto = CanvasRenderingContext2D.prototype;
      var orig = proto.fillText, seen = [];
      proto.fillText = function(txt){ seen.push(String(txt)); return orig.apply(this, arguments); };

      window.MA.CONFIG.arena.zoneEnabled = false;
      window.MA.CONFIG.display.hpBarShowValue = true;
      window.MA.CONFIG.display.unitScale = 2;
      window.MA.CONFIG.display.hpBarScale = 2;
      window.MA.CONFIG.ui.showNames = false;
      world.autoRestart = false;
      world.paused = true;
      world.reset(["moyu"]);
      world.picks = ["moyu"];
      var u = world.units[0];
      u.x = world.arena/2; u.y = world.arena/2; u.vx = 0; u.vy = 0;
      u.spawnT = 0;

      // 满血：104 上限，这里显式改成 62/104，最能暴露 "62/104" 这种写法
      u.stats.hp = 104; u.hp = 62;
      seen.length = 0;
      drawWorld(world);
      var at62 = seen.slice();

      u.hp = 7;
      seen.length = 0;
      drawWorld(world);
      var at7 = seen.slice();

      // 关掉数值开关，应该完全不写血量数字
      window.MA.CONFIG.display.hpBarShowValue = false;
      seen.length = 0;
      drawWorld(world);
      var off = seen.slice();
      window.MA.CONFIG.display.hpBarShowValue = true;

      proto.fillText = orig;
      window.MA.CONFIG.ui.showNames = true;
      window.MA.CONFIG.arena.zoneEnabled = true;
      return { at62: at62, at7: at7, off: off };
    })())`));

    const has62 = hpText.at62.indexOf("62") >= 0;
    const slash62 = hpText.at62.some(t => t.indexOf("/") >= 0);
    const has7 = hpText.at7.indexOf("7") >= 0;
    const slash7 = hpText.at7.some(t => t.indexOf("/") >= 0);
    const offHasNumber = hpText.off.some(t => /^[0-9]+$/.test(t));
    console.log("    62HP 时画出的文本: " + JSON.stringify(hpText.at62));
    console.log("    7HP  时画出的文本: " + JSON.stringify(hpText.at7));
    check("血条里画出当前血量 62", has62, JSON.stringify(hpText.at62));
    check("血条里不再出现 62/104 形式", !slash62, JSON.stringify(hpText.at62));
    check("残血时画出 7", has7, JSON.stringify(hpText.at7));
    check("残血时也没有斜杠形式", !slash7, JSON.stringify(hpText.at7));
    check("关闭数值开关后不画血量数字", !offHasNumber, JSON.stringify(hpText.off));

    // 侧栏战况同样不该再出现 "当前/上限"
    const rosterText = await browser.eval(`(function(){
      world.reset(["moyu","kunkun"]);
      world.units[0].hp = world.units[0].stats.hp * 0.5;
      updateRoster();
      var v = document.querySelector("#roster .vv");
      return v ? v.textContent : "";
    })()`);
    console.log("    侧栏战况文本: " + JSON.stringify(rosterText));
    check("侧栏战况也不再用 当前/上限", rosterText.indexOf("/") < 0, rosterText);

    console.log("\n=== B1. 三层背景参数写入并落盘 ===");
    // 通过真实控件改值（走 ui.js 的绑定 + 防抖保存）
    const changed = JSON.parse(await browser.eval(`JSON.stringify((function(){
      function setRange(id, v){
        var e = document.getElementById(id);
        e.value = String(v);
        e.dispatchEvent(new Event("input"));
        return e.value;
      }
      function setSelect(id, v){
        var e = document.getElementById(id);
        e.value = v;
        e.dispatchEvent(new Event("change"));
        return e.value;
      }
      // 外层
      setSelect("oPattern", "rings");
      setRange("oScale", 1.85);
      setRange("oOffX", 73);
      setRange("oOffY", -41);
      setRange("oBlur", 7.5);
      setRange("oOpacity", 0.66);
      setRange("oPatScale", 88);
      setRange("oOverlay", 0.21);
      // 边框
      setRange("bThick", 52);
      setSelect("bStyle", "dashes");
      setRange("bScale", 2.35);
      setRange("bOffX", -64);
      setRange("bOffY", 38);
      setRange("bBlur", 4.5);
      setRange("bOpacity", 0.74);
      setRange("bGlow", 33);
      setRange("bPulse", 0.71);
      // 内层
      setRange("iScale", 1.42);
      setRange("iOffX", 55);
      setRange("iOffY", -27);
      setRange("iBlur", 3.5);
      setRange("iOpacity", 0.81);
      setRange("iVignette", 0.63);
      setRange("iOverlay", 0.55);
      // 主题
      setSelect("optBg", "forest");
      // 摄像机（缩放以前不落盘，刷新就弹回默认）
      setRange("camZoom", 2.35);
      setSelect("optCamEdge", "90");
      // 显示尺寸
      setRange("dispUnit", 2.6);
      setRange("dispHpBar", 1.35);
      setSelect("dispHpVal", "0");

      var c = window.MA.CONFIG.render.background;
      return {
        camera: { followZoom: window.MA.CONFIG.camera.followZoom,
                  edgePadding: window.MA.CONFIG.camera.edgePadding },
        display: { unitScale: window.MA.CONFIG.display.unitScale,
                   hpBarScale: window.MA.CONFIG.display.hpBarScale,
                   hpBarShowValue: window.MA.CONFIG.display.hpBarShowValue },
        outer: { pattern: c.outer.pattern, scale: c.outer.scale, offsetX: c.outer.offsetX,
                 offsetY: c.outer.offsetY, blur: c.outer.blur, opacity: c.outer.opacity,
                 patternScale: c.outer.patternScale, overlay: c.outer.overlay },
        border: { thickness: c.border.thickness, style: c.border.style, scale: c.border.scale,
                  offsetX: c.border.offsetX, offsetY: c.border.offsetY, blur: c.border.blur,
                  opacity: c.border.opacity, glow: c.border.glow, pulse: c.border.pulse },
        inner: { scale: c.inner.scale, offsetX: c.inner.offsetX, offsetY: c.inner.offsetY,
                 blur: c.inner.blur, opacity: c.inner.opacity, vignette: c.inner.vignette },
        overlay: c.overlay,
        preset: window.MA.Background.preset,
        labels: {
          oScale: document.getElementById("oScaleV").value,
          bThick: document.getElementById("bThickV").value,
          iScale: document.getElementById("iScaleV").value
        }
      };
    })())`));

    check("外层图案写回配置", changed.outer.pattern === "rings", changed.outer.pattern);
    check("外层缩放写回配置", Math.abs(changed.outer.scale - 1.85) < 1e-6, String(changed.outer.scale));
    check("外层偏移写回配置",
      changed.outer.offsetX === 73 && changed.outer.offsetY === -41,
      changed.outer.offsetX + "," + changed.outer.offsetY);
    check("外层模糊写回配置", Math.abs(changed.outer.blur - 7.5) < 1e-6, String(changed.outer.blur));
    check("外层透明度写回配置", Math.abs(changed.outer.opacity - 0.66) < 1e-6, String(changed.outer.opacity));
    check("边框厚度写回配置", changed.border.thickness === 52, String(changed.border.thickness));
    check("边框样式写回配置", changed.border.style === "dashes", changed.border.style);
    check("边框缩放写回配置", Math.abs(changed.border.scale - 2.35) < 1e-6, String(changed.border.scale));
    check("边框偏移写回配置",
      changed.border.offsetX === -64 && changed.border.offsetY === 38,
      changed.border.offsetX + "," + changed.border.offsetY);
    check("内层缩放写回配置", Math.abs(changed.inner.scale - 1.42) < 1e-6, String(changed.inner.scale));
    check("内层偏移写回配置",
      changed.inner.offsetX === 55 && changed.inner.offsetY === -27,
      changed.inner.offsetX + "," + changed.inner.offsetY);
    check("内层暗角写回配置", Math.abs(changed.inner.vignette - 0.63) < 1e-6, String(changed.inner.vignette));
    check("主题切换生效", changed.preset === "forest", changed.preset);
    check("摄像机缩放写回配置", Math.abs(changed.camera.followZoom - 2.35) < 1e-6,
      String(changed.camera.followZoom));
    check("贴边留白写回配置", changed.camera.edgePadding === 90, String(changed.camera.edgePadding));
    check("角色大小写回配置", Math.abs(changed.display.unitScale - 2.6) < 1e-6,
      String(changed.display.unitScale));
    check("血条大小写回配置", Math.abs(changed.display.hpBarScale - 1.35) < 1e-6,
      String(changed.display.hpBarScale));
    check("血条数值开关写回配置", changed.display.hpBarShowValue === false);
    check("滑块标签同步", changed.labels.oScale === "1.85×" && changed.labels.iScale === "1.42×",
      JSON.stringify(changed.labels));

    console.log("\n=== B2. 三层各换一张图（走界面上传通道）===");
    // 外层：真实走 <input type=file> 的 change 事件
    const outerUpload = JSON.parse(await browser.eval(`(function(){
      var file = ${MAKE_FILE("#ff8800", "outer.png")};
      return file.then(function(f){
        var input = document.getElementById("layerFile");
        var dt = new DataTransfer();
        dt.items.add(f);
        input.files = dt.files;
        // 切到外层面板再触发
        document.querySelector('#layerTabs button[data-layer="outer"]').click();
        input.dispatchEvent(new Event("change"));
        return new Promise(function(res){
          setTimeout(function(){
            res(JSON.stringify({ hasImage: !!window.MA.Background.layerImage("outer") }));
          }, 700);
        });
      });
    })()`));
    check("外层图通过界面上传成功", outerUpload.hasImage === true, JSON.stringify(outerUpload));

    // 边框 / 内层：走各自的 API（与界面同一实现）
    const otherUploads = JSON.parse(await browser.eval(`(function(){
      return Promise.all([
        ${MAKE_FILE("#00ffcc", "border.png")},
        ${MAKE_FILE("#cc00ff", "inner.png")}
      ]).then(function(files){
        return window.MA.Background.setLayerFile("border", files[0]).then(function(){
          return window.MA.Background.setFile(files[1]);
        }).then(function(){
          return JSON.stringify({
            border: !!window.MA.Background.layerImage("border"),
            inner: !!window.MA.Background.layerImage("inner"),
            preset: window.MA.Background.preset
          });
        });
      });
    })()`));
    check("边框图上传成功", otherUploads.border === true);
    check("内层图上传成功", otherUploads.inner === true);
    check("内层上传后切到自选图片", otherUploads.preset === "custom", otherUploads.preset);

    // 等防抖写入落盘
    await sleep(600);

    console.log("\n=== B2b. 换上去的图确实画到了画布上 ===");
    /* 只检查 layerImage() 非空是不够的：渲染层如果仍用 config.src 判断是否贴图，
     * 图对象明明在也不会被画出来。这里直接比对像素。 */
    const drawnLayers = JSON.parse(await browser.eval(`JSON.stringify((function(){
      window.MA.CONFIG.arena.zoneEnabled = false;
      // 只为取景需要临时改缩放；测完必须还原，否则会被写进存档
      var savedZoom = window.MA.CONFIG.camera.followZoom;
      window.MA.CONFIG.camera.followZoom = 0.55;
      world.setCameraMode("follow");
      world.cam.zoom = 0.55;
      var ct = world.getCamTarget();
      if (ct) { ct.x = world.arena/2; ct.y = world.arena/2; ct.vx = 0; ct.vy = 0; }
      for (var i = 0; i < 120; i++) world.updateCamera(1/60);
      world.cam.zoom = 0.55;
      world.paused = true;

      var cv = document.getElementById("cv"), g = cv.getContext("2d");
      var W = cv.width, H = cv.height;
      function fp(){
        g.setTransform(1,0,0,1,0,0);
        g.clearRect(0,0,W,H);
        drawWorld(world);
        var d = g.getImageData(0,0,W,H).data, h = 0;
        for (var i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i+1]*3 + d[i+2]*7) % 1000000007;
        return h;
      }
      // 逐层"摘掉图再画"，画面变了就说明这层确实在贴图
      var out = {};
      ["outer","border","inner"].forEach(function(L){
        var withImg = fp();
        var saved = window.MA.Background.layerImage(L);
        window.MA.Background.setLayerImage(L, null);
        window.MA.Background.invalidate();
        var without = fp();
        window.MA.Background.setLayerImage(L, saved);
        window.MA.Background.invalidate();
        out[L] = (withImg !== without);
      });
      fp();
      // 还原取景时改过的状态，避免污染后面的存档断言
      window.MA.CONFIG.camera.followZoom = savedZoom;
      world.cam.zoom = savedZoom;
      window.MA.CONFIG.arena.zoneEnabled = true;
      return out;
    })())`));
    check("外层图真的画在画布上", drawnLayers.outer === true, JSON.stringify(drawnLayers));
    check("边框图真的画在画布上", drawnLayers.border === true, JSON.stringify(drawnLayers));
    check("内层图真的画在画布上", drawnLayers.inner === true, JSON.stringify(drawnLayers));

    // 之后还要刷新，确保最后一次落盘包含三层图
    await browser.eval(`(function(){
      window.MA.Settings.saveAll(window.MA.Background.preset);
      return true;
    })()`);
    await sleep(300);

    console.log("\n=== B3. 存档内容检查（不含失效的 blob: URL）===");
    const raw = await browser.eval(`(function(){
      return window.localStorage.getItem(window.MA.Settings.KEY) || "";
    })()`);
    check("存档已写入 localStorage", raw.length > 20, raw.length + " 字节");
    check("存档里不含 blob: 临时地址", raw.indexOf("blob:") < 0);
    check("存档里不含 src 字段", raw.indexOf('"src"') < 0);
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { /* 下面会报错 */ }
    check("存档是合法 JSON", !!parsed);
    if (parsed) {
      check("存档记下了主题", parsed.background && parsed.background.preset === "custom",
        parsed.background && parsed.background.preset);
      check("存档包含三层参数",
        !!(parsed.background && parsed.background.layers &&
           parsed.background.layers.outer && parsed.background.layers.border &&
           parsed.background.layers.inner));
      check("存档包含摄像机设置",
        !!(parsed.camera && Math.abs(parsed.camera.followZoom - 2.35) < 1e-6 &&
           parsed.camera.edgePadding === 90),
        JSON.stringify(parsed.camera));
      check("存档包含显示尺寸",
        !!(parsed.display && Math.abs(parsed.display.unitScale - 2.6) < 1e-6 &&
           parsed.display.hpBarShowValue === false),
        JSON.stringify(parsed.display));
    }

    console.log("\n=== B4. 刷新之后设置仍然生效（核心）===");
    await reload(browser);
    await sleep(1400);

    const after = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var c = window.MA.CONFIG.render.background;
      return {
        outer: { pattern: c.outer.pattern, scale: c.outer.scale, offsetX: c.outer.offsetX,
                 offsetY: c.outer.offsetY, blur: c.outer.blur, opacity: c.outer.opacity,
                 patternScale: c.outer.patternScale, overlay: c.outer.overlay },
        border: { thickness: c.border.thickness, style: c.border.style, scale: c.border.scale,
                  offsetX: c.border.offsetX, offsetY: c.border.offsetY, blur: c.border.blur,
                  opacity: c.border.opacity, glow: c.border.glow, pulse: c.border.pulse },
        inner: { scale: c.inner.scale, offsetX: c.inner.offsetX, offsetY: c.inner.offsetY,
                 blur: c.inner.blur, opacity: c.inner.opacity, vignette: c.inner.vignette },
        overlay: c.overlay,
        preset: window.MA.Background.preset,
        hasOuterImg: !!window.MA.Background.layerImage("outer"),
        hasBorderImg: !!window.MA.Background.layerImage("border"),
        hasInnerImg: !!window.MA.Background.layerImage("inner"),
        // 界面控件是否也回到了存档值
        ui: {
          oPattern: document.getElementById("oPattern").value,
          oScale: document.getElementById("oScale").value,
          oScaleV: document.getElementById("oScaleV").value,
          oOffX: document.getElementById("oOffX").value,
          bThick: document.getElementById("bThick").value,
          bStyle: document.getElementById("bStyle").value,
          iScale: document.getElementById("iScale").value,
          iVignette: document.getElementById("iVignette").value,
          optBg: document.getElementById("optBg").value,
          camZoom: document.getElementById("camZoom").value,
          camZoomV: document.getElementById("camZoomVal").value,
          camEdge: document.getElementById("optCamEdge").value,
          dispUnit: document.getElementById("dispUnit").value,
          dispUnitV: document.getElementById("dispUnitV").value,
          dispHpBar: document.getElementById("dispHpBar").value,
          dispHpVal: document.getElementById("dispHpVal").value
        },
        camera: { followZoom: window.MA.CONFIG.camera.followZoom,
                  edgePadding: window.MA.CONFIG.camera.edgePadding },
        display: { unitScale: window.MA.CONFIG.display.unitScale,
                   hpBarScale: window.MA.CONFIG.display.hpBarScale,
                   hpBarShowValue: window.MA.CONFIG.display.hpBarShowValue }
      };
    })())`));

    check("刷新后外层图案仍是 rings", after.outer.pattern === "rings", after.outer.pattern);
    check("刷新后外层缩放仍是 1.85", Math.abs(after.outer.scale - 1.85) < 1e-6, String(after.outer.scale));
    check("刷新后外层偏移仍是 73/-41",
      after.outer.offsetX === 73 && after.outer.offsetY === -41,
      after.outer.offsetX + "," + after.outer.offsetY);
    check("刷新后外层模糊仍是 7.5", Math.abs(after.outer.blur - 7.5) < 1e-6, String(after.outer.blur));
    check("刷新后外层透明度仍是 0.66", Math.abs(after.outer.opacity - 0.66) < 1e-6, String(after.outer.opacity));
    check("刷新后外层图案间距仍是 88", after.outer.patternScale === 88, String(after.outer.patternScale));

    check("刷新后边框厚度仍是 52", after.border.thickness === 52, String(after.border.thickness));
    check("刷新后边框样式仍是 dashes", after.border.style === "dashes", after.border.style);
    check("刷新后边框缩放仍是 2.35", Math.abs(after.border.scale - 2.35) < 1e-6, String(after.border.scale));
    check("刷新后边框偏移仍是 -64/38",
      after.border.offsetX === -64 && after.border.offsetY === 38,
      after.border.offsetX + "," + after.border.offsetY);
    check("刷新后边框模糊仍是 4.5", Math.abs(after.border.blur - 4.5) < 1e-6, String(after.border.blur));
    check("刷新后边框发光/脉动仍是 33/0.71",
      after.border.glow === 33 && Math.abs(after.border.pulse - 0.71) < 1e-6,
      after.border.glow + "/" + after.border.pulse);

    check("刷新后内层缩放仍是 1.42", Math.abs(after.inner.scale - 1.42) < 1e-6, String(after.inner.scale));
    check("刷新后内层偏移仍是 55/-27",
      after.inner.offsetX === 55 && after.inner.offsetY === -27,
      after.inner.offsetX + "," + after.inner.offsetY);
    check("刷新后内层模糊仍是 3.5", Math.abs(after.inner.blur - 3.5) < 1e-6, String(after.inner.blur));
    check("刷新后内层暗角仍是 0.63", Math.abs(after.inner.vignette - 0.63) < 1e-6, String(after.inner.vignette));

    check("刷新后主题仍是自选图片", after.preset === "custom", after.preset);
    check("刷新后外层图还在", after.hasOuterImg === true);
    check("刷新后边框图还在", after.hasBorderImg === true);
    check("刷新后内层图还在", after.hasInnerImg === true);

    check("刷新后界面控件回到存档值",
      after.ui.oPattern === "rings" && after.ui.oScale === "1.85" &&
      after.ui.oOffX === "73" && after.ui.bThick === "52" &&
      after.ui.bStyle === "dashes" && after.ui.iScale === "1.42" &&
      after.ui.iVignette === "0.63" && after.ui.optBg === "custom",
      JSON.stringify(after.ui));

    // 摄像机 / 显示尺寸：以前这些改完刷新就丢
    check("刷新后跟随缩放仍是 2.35", Math.abs(after.camera.followZoom - 2.35) < 1e-6,
      String(after.camera.followZoom));
    check("刷新后贴边留白仍是 90", after.camera.edgePadding === 90,
      String(after.camera.edgePadding));
    check("刷新后角色大小仍是 2.6", Math.abs(after.display.unitScale - 2.6) < 1e-6,
      String(after.display.unitScale));
    check("刷新后血条大小仍是 1.35", Math.abs(after.display.hpBarScale - 1.35) < 1e-6,
      String(after.display.hpBarScale));
    check("刷新后血条数值开关仍是关", after.display.hpBarShowValue === false);
    check("刷新后摄像机/显示控件也回到存档值",
      after.ui.camZoom === "2.35" && after.ui.camZoomV === "2.35×" &&
      after.ui.camEdge === "90" && after.ui.dispUnit === "2.6" &&
      after.ui.dispUnitV === "2.60×" && after.ui.dispHpBar === "1.35" &&
      after.ui.dispHpVal === "0",
      JSON.stringify({ camZoom: after.ui.camZoom, camEdge: after.ui.camEdge,
        dispUnit: after.ui.dispUnit, dispHpVal: after.ui.dispHpVal }));

    // 默认缩放改成 0.8 之后，「恢复默认」必须回到 0.8，
    // 而不是回到存档里的 2.35（那会把"恢复默认"变成"恢复到我上次调的"）。
    const defaultZoom = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var before = window.MA.CONFIG.camera.followZoom;
      document.getElementById("camZoomVal").onclick();   // 点击数值 → 恢复默认
      return { before: before, after: window.MA.CONFIG.camera.followZoom,
               factory: window.MA.Settings.factoryCamera.followZoom,
               uiVal: document.getElementById("camZoom").value };
    })())`));
    check("「恢复默认」回到出厂 0.8（不是回到存档值）",
      Math.abs(defaultZoom.after - 0.8) < 1e-9 && Math.abs(defaultZoom.factory - 0.8) < 1e-9,
      "存档 " + defaultZoom.before + " → 默认 " + defaultZoom.after +
      "（出厂 " + defaultZoom.factory + "）");
    check("恢复默认后滑块同步", defaultZoom.uiVal === "0.8", defaultZoom.uiVal);

    console.log("\n=== B5. 渲染仍然正常（无报错、画面有内容）===");
    const drawInfo = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var c = document.getElementById("cv"), g = c.getContext("2d");
      drawWorld(world);
      var d = g.getImageData(0, 0, c.width, c.height).data;
      var lit = 0;
      for (var i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 90) lit++;
      return { lit: lit, w: c.width, h: c.height };
    })())`));
    check("刷新后画面正常绘制", drawInfo.lit > 1000, drawInfo.lit + " 个亮像素");
    check("刷新后无 JS 报错", errors.length === 0, errors.slice(0, 3).join(" | "));

    console.log("\n=== B6. 恢复默认会清掉存档（刷新后不回弹）===");
    const resetRes = JSON.parse(await browser.eval(`(function(){
      return window.MA.Background.reset().then(function(){
        return JSON.stringify({
          preset: window.MA.Background.preset,
          hasOuter: !!window.MA.Background.layerImage("outer"),
          hasBorder: !!window.MA.Background.layerImage("border"),
          saved: window.localStorage.getItem(window.MA.Settings.KEY)
        });
      });
    })()`));
    check("恢复默认回到预设主题", ["neon","sunset","ocean","forest","paper"].indexOf(resetRes.preset) >= 0,
      resetRes.preset);
    check("恢复默认清掉外层图", resetRes.hasOuter === false);
    check("恢复默认清掉边框图", resetRes.hasBorder === false);
    check("恢复默认清空设置存档", !resetRes.saved, String(resetRes.saved));

    await reload(browser);
    await sleep(1400);
    const afterReset = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var c = window.MA.CONFIG.render.background;
      return {
        preset: window.MA.Background.preset,
        thickness: c.border.thickness,
        outerScale: c.outer.scale,
        hasOuter: !!window.MA.Background.layerImage("outer"),
        hasBorder: !!window.MA.Background.layerImage("border")
      };
    })())`));
    check("刷新后没有回弹成旧存档", afterReset.thickness === 26 && Math.abs(afterReset.outerScale - 1) < 1e-6,
      "thickness=" + afterReset.thickness + " outerScale=" + afterReset.outerScale);
    check("刷新后三层自选图都为空",
      !afterReset.hasOuter && !afterReset.hasBorder, JSON.stringify(afterReset));

    console.log("\n=== C. 截图 ===");
    await browser.eval(`(function(){
      window.MA.CONFIG.display.unitScale = 2;
      window.MA.CONFIG.display.hpBarScale = 2;
      window.MA.CONFIG.display.hpBarShowValue = true;
      window.MA.CONFIG.camera.followZoom = 2.2;
      world.paused = false;
      world.setCameraMode("follow");
      world.cam.zoom = 2.2;
      world.reset(["moyu","kunkun","hajimi","creeper","saibo","fanqie","yyds","tiangou"]);
      return true;
    })()`);
    await sleep(2200);
    const s1 = await browser.screenshot(path.join(OUT, "persist-hpbar.png"));
    check("血条特写截图", s1 > 20000, (s1 / 1024).toFixed(0) + " KB");

    console.log("\n=== D. 最终无报错 ===");
    check("全程无 JS 报错", errors.length === 0, errors.slice(0, 3).join(" | "));

  } catch (e) {
    console.error("\n验证过程出错: " + (e && e.stack || e));
    failures++;
  } finally {
    await browser.close();
  }

  console.log("\n" + (failures === 0 ? "全部通过 ✅" : failures + " 项失败 ❌"));
  process.exit(failures === 0 ? 0 : 1);
})();
