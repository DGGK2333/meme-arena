/* =========================================================================
 * tools/verify-display.js —— 角色放大 / 血条放大 / 血条内血量数值
 *
 * 检查：
 *   · 角色半径确实放大了指定倍数，且屏幕上的实际尺寸同步变大
 *   · 血条尺寸随角色放大，也能独立再调
 *   · 血条内显示血量数值，且数值随受伤更新
 *   · 数值在绿/黄/红三种底色上都画得出来（对比度处理生效）
 *   · 侧栏控件写回配置
 * 用法：node tools/verify-display.js
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

/* 统计画布上"非背景"的像素数，用来估算角色/血条占屏面积 */
const AREA_PROBE = `
(function(){
  var c = document.getElementById("cv"), g = c.getContext("2d");
  var W = c.width, H = c.height;
  var d = g.getImageData(0, 0, W, H).data;
  var n = 0;
  for (var i = 0; i < d.length; i += 4) {
    // 统计明显亮于背景的像素（角色是彩色、背景偏暗）
    if (d[i] + d[i+1] + d[i+2] > 330 && d[i+3] > 40) n++;
  }
  return n;
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
      display: window.MA.CONFIG.display,
      hasNum: typeof num === "function",
      controls: ["dispUnit","dispUnitV","dispHpBar","dispHpBarV","dispHpVal"]
        .filter(function(id){ return !document.getElementById(id); })
    })`));
    check("display 配置存在", !!mod.display, JSON.stringify(mod.display));
    check("unitScale 默认 2.0", mod.display.unitScale === 2, String(mod.display.unitScale));
    check("血条数值开关默认开", mod.display.hpBarShowValue === true);
    check("num 工具函数已全局可用", mod.hasNum);
    check("5 个控件都在侧栏", mod.controls.length === 0,
      mod.controls.length ? "缺少 " + mod.controls.join(",") : "5/5");

    console.log("\n=== 2. 角色真的放大了一倍 ===");
    const scaleTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      window.MA.CONFIG.arena.zoneEnabled = false;
      world.autoRestart = false;
      var ids = ["moyu","kunkun","hajimi","creeper"];

      // 注意：reset 会打乱 units 顺序，必须按 id 取值，不能按下标对位
      function radiusById(scale){
        window.MA.CONFIG.display.unitScale = scale;
        world.reset(ids);
        var m = {};
        world.units.forEach(function(u){ m[u.tpl.id] = +u.r.toFixed(2); });
        return m;
      }
      var r1 = radiusById(1);
      var r2 = radiusById(2);
      var base = {};
      ids.forEach(function(id){ base[id] = window.MA.getCharacter(id).radius; });

      return { base: base, r1: r1, r2: r2, ids: ids };
    })())`));
    console.log("    id        radius  1倍    2倍");
    scaleTest.ids.forEach(id => {
      console.log("    " + id.padEnd(10) + String(scaleTest.base[id]).padStart(4) +
        String(scaleTest.r1[id]).padStart(8) + String(scaleTest.r2[id]).padStart(8));
    });
    const ok1 = scaleTest.ids.every(id => Math.abs(scaleTest.r1[id] - scaleTest.base[id]) < 0.01);
    const ok2 = scaleTest.ids.every(id => Math.abs(scaleTest.r2[id] - scaleTest.base[id] * 2) < 0.01);
    check("1 倍时半径 = 原始 radius", ok1);
    check("2 倍时半径 = 原始 radius × 2", ok2);

    console.log("\n=== 3. 放大后屏幕占屏面积明显增加 ===");
    // 用"画角色 vs 不画角色"的差异像素来量占屏面积。
    // 直接数亮像素不可靠：背景本身也很亮，会把角色淹没。
    const areaTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var c = document.getElementById("cv"), g = c.getContext("2d");
      var W = c.width, H = c.height;
      window.MA.CONFIG.arena.zoneEnabled = false;
      // 排除干扰项：血量数字和名字都有各自的字号上限，
      // 会把"身体随半径增长"的信号稀释掉。本节只量身体。
      window.MA.CONFIG.display.hpBarShowValue = false;
      window.MA.CONFIG.ui.showNames = false;
      world.paused = true;

      function snap(){
        g.setTransform(1,0,0,1,0,0);
        g.clearRect(0,0,W,H);
        drawWorld(world);
        return g.getImageData(0,0,W,H).data;
      }
      function bodyArea(scale){
        window.MA.CONFIG.display.unitScale = scale;
        world.reset(["moyu"]);
        world.picks = ["moyu"];
        var u = world.units[0];
        u.x = world.arena/2; u.y = world.arena/2; u.vx = 0; u.vy = 0;
        u.spawnT = 0;
        // 关键：要把单位从数组里整个拿掉才算"空帧"。
        // 只把 alive 设成 false 是不行的 —— 那会画墓碑，
        // 而墓碑尺寸同样随半径缩放，会把面积比值压缩掉。
        var saved = world.units;
        world.units = [];           var empty = snap();
        world.units = saved;        var shown = snap();
        var n = 0;
        for (var i = 0; i < empty.length; i += 4) {
          if (Math.abs(empty[i]-shown[i]) + Math.abs(empty[i+1]-shown[i+1]) +
              Math.abs(empty[i+2]-shown[i+2]) > 24) n++;
        }
        return n;
      }
      var a1 = bodyArea(1);
      var a2 = bodyArea(2);
      window.MA.CONFIG.display.hpBarShowValue = true;
      window.MA.CONFIG.ui.showNames = true;
      return { area1: a1, area2: a2, ratio: +(a2 / a1).toFixed(2) };
    })())`));
    console.log("    1 倍身体占屏 " + areaTest.area1 + " px  →  2 倍 " + areaTest.area2 +
      " px（面积比 " + areaTest.ratio + "，已排除血条与名字）");
    // 半径翻倍 → 身体面积理论 ×4；轮廓阴影与圆形采样会有偏差，给宽一点的区间
    check("2 倍放大的身体占屏面积约为 4 倍",
      areaTest.ratio > 3.2 && areaTest.ratio < 5.0,
      "面积比 " + areaTest.ratio + "（理论 ×4）");

    console.log("\n=== 4. 血条尺寸随角色放大，且可独立再调 ===");
    // 直接验证几何计算（比数像素可靠得多：厚血条会超出固定采样条带，
    // 而且数字是深色反而会减少"亮像素"计数）
    const barTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var d = window.MA.CONFIG.display;
      var u = world.units[0];
      u.spawnT = 0; u.x = world.arena/2; u.y = world.arena/2;

      function geo(){ return hpBarGeometry(u, d); }
      var out = {};

      // 血条独立倍率：只动 hpBarScale
      var unitBackup = d.unitScale;
      d.unitScale = 1;
      d.hpBarScale = 1; out.bar1 = geo().bh;
      d.hpBarScale = 2; out.bar2 = geo().bh;
      d.hpBarScale = 3; out.bar3 = geo().bh;

      // 角色倍率：只动 unitScale（开方后影响血条）
      d.hpBarScale = 1;
      d.unitScale = 1; out.u1 = geo().bh;
      d.unitScale = 4; out.u4 = geo().bh;

      // 宽度：角色半径决定（未触到最小宽度时）
      d.unitScale = 1; out.w1 = geo().bw;
      d.unitScale = 2; out.w2 = geo().bw;

      d.unitScale = unitBackup; d.hpBarScale = 2;
      return out;
    })())`));
    console.log("    血条厚度：1×=" + barTest.bar1.toFixed(1) + "  2×=" + barTest.bar2.toFixed(1) +
      "  3×=" + barTest.bar3.toFixed(1));
    console.log("    角色倍率对血条厚度：1×=" + barTest.u1.toFixed(1) + "  4×=" + barTest.u4.toFixed(1));
    console.log("    血条宽度：角色 1×=" + barTest.w1.toFixed(1) + "  2×=" + barTest.w2.toFixed(1));
    check("血条倍率 2× 时厚度约为 2 倍",
      Math.abs(barTest.bar2 / barTest.bar1 - 2) < 0.05,
      "比例 " + (barTest.bar2 / barTest.bar1).toFixed(2));
    check("角色放大也让血条变厚", barTest.u4 > barTest.u1 * 1.5,
      barTest.u1.toFixed(1) + " → " + barTest.u4.toFixed(1));
    check("血条宽度随角色半径变大", barTest.w2 > barTest.w1,
      barTest.w1.toFixed(1) + " → " + barTest.w2.toFixed(1));

    console.log("\n=== 5. 血条内显示血量数值 ===");
    // 用"开关前后两帧的差异像素"定位数字，而不是数亮像素
    const valueTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var d = window.MA.CONFIG.display;
      var u = world.units[0];
      u.spawnT = 0;
      u.x = world.arena/2; u.y = world.arena/2;
      u.hp = u.stats.hp;

      var c = document.getElementById("cv"), g = c.getContext("2d");
      var W = c.width, H = c.height;

      function snap(){
        g.setTransform(1,0,0,1,0,0);
        g.clearRect(0,0,W,H);
        drawWorld(world);
        return g.getImageData(0,0,W,H).data;
      }
      function diffCount(a, b){
        var n = 0;
        for (var i = 0; i < a.length; i += 4) {
          if (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]) > 24) n++;
        }
        return n;
      }

      d.hpBarShowValue = false;
      var off = snap();
      d.hpBarShowValue = true;
      var on = snap();
      var digitPixels = diffCount(off, on);

      // 各血量档位都应画出可辨识的数字（差异像素量级相近）
      var perHp = {};
      [100, 60, 30, 5].forEach(function(pct){
        d.hpBarShowValue = false;
        u.hp = u.stats.hp * pct / 100;
        var a = snap();
        d.hpBarShowValue = true;
        var b2 = snap();
        perHp[pct] = diffCount(a, b2);
      });

      d.hpBarShowValue = true;
      u.hp = u.stats.hp;
      return { digitPixels: digitPixels, perHp: perHp };
    })())`));
    console.log("    开关数值产生的差异像素：" + valueTest.digitPixels);
    console.log("    各血量档位差异像素：" + JSON.stringify(valueTest.perHp));
    check("开启数值后确实画出了数字", valueTest.digitPixels > 60,
      valueTest.digitPixels + " 个差异像素");
    check("满血/半血/残血/濒死 都画出了数字",
      Object.keys(valueTest.perHp).every(k => valueTest.perHp[k] > 60),
      JSON.stringify(valueTest.perHp));

    console.log("\n=== 6. 血量变化时数字真的在变 ===");
    const changeTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var d = window.MA.CONFIG.display;
      var u = world.units[0];
      u.spawnT = 0; u.x = world.arena/2; u.y = world.arena/2;
      d.hpBarShowValue = true;

      function barFingerprint(){
        drawWorld(world);
        var c = document.getElementById("cv"), g = c.getContext("2d");
        var dpr = world.dpr;
        var y0 = Math.round((u.y - u.r - 16) * dpr);
        var h = Math.round(28 * dpr);
        var d2 = g.getImageData(0, Math.max(0, y0), c.width, h).data;
        var hh = 0;
        for (var i = 0; i < d2.length; i += 4) hh = (hh * 31 + d2[i] + d2[i+1]*3 + d2[i+2]*7) % 1000000007;
        return hh;
      }

      u.hp = u.stats.hp;       var full = barFingerprint();
      u.hp = u.stats.hp * 0.5; var half = barFingerprint();
      u.hp = u.stats.hp * 0.1; var low  = barFingerprint();
      // 同一血量重复画应一致（确认不是随机噪声导致的差异）
      u.hp = u.stats.hp * 0.5; var half2 = barFingerprint();

      u.hp = u.stats.hp;
      return { full: full, half: half, low: low, half2: half2 };
    })())`));
    check("满血与半血的数字不同", changeTest.full !== changeTest.half);
    check("半血与残血的数字不同", changeTest.half !== changeTest.low);
    check("同一血量绘制结果稳定（可复现）", changeTest.half === changeTest.half2);

    console.log("\n=== 7. 名字与图标也同步放大 ===");
    const nameTest = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var d = window.MA.CONFIG.display;
      window.MA.CONFIG.ui.showNames = true;
      var c = document.getElementById("cv"), g = c.getContext("2d");
      var W = c.width, H = c.height;
      world.paused = true;

      function snap(){
        g.setTransform(1,0,0,1,0,0);
        g.clearRect(0,0,W,H);
        drawWorld(world);
        return g.getImageData(0,0,W,H).data;
      }
      // 用"显示名字 vs 隐藏名字"的差异量来量名字占屏
      function nameArea(scale){
        d.unitScale = scale;
        world.reset(["moyu"]);
        world.picks = ["moyu"];
        var u = world.units[0];
        u.x = world.arena/2; u.y = world.arena/2; u.vx = 0; u.vy = 0;
        u.spawnT = 0;
        window.MA.CONFIG.ui.showNames = false; var off = snap();
        window.MA.CONFIG.ui.showNames = true;  var on = snap();
        var n = 0;
        for (var i = 0; i < off.length; i += 4) {
          if (Math.abs(off[i]-on[i]) + Math.abs(off[i+1]-on[i+1]) +
              Math.abs(off[i+2]-on[i+2]) > 24) n++;
        }
        return n;
      }
      var n1 = nameArea(1);
      var n2 = nameArea(2);
      d.unitScale = 2;
      return { n1: n1, n2: n2 };
    })())`));
    console.log("    名字区域占屏：1×=" + nameTest.n1 + "  2×=" + nameTest.n2);
    // 名字字号用开方倍率（避免字大到盖住画面），所以增幅小于尺寸倍率。
    // 只要确实变大了即可，不要求线性。
    check("名字区域随角色放大而增大", nameTest.n2 > nameTest.n1 * 1.08,
      nameTest.n1 + " → " + nameTest.n2 + "（字号按开方倍率增长）");

    console.log("\n=== 8. 侧栏控件写回配置 ===");
    const uiWrite = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var d = window.MA.CONFIG.display;
      function set(id, v){
        var e = document.getElementById(id);
        e.value = v; e.dispatchEvent(new Event("input"));
      }
      set("dispUnit", "3.5");
      var unit = d.unitScale;
      var unitLabel = document.getElementById("dispUnitV").value;
      set("dispHpBar", "1.25");
      var bar = d.hpBarScale;
      var barLabel = document.getElementById("dispHpBarV").value;

      // 下拉用 change
      var sel = document.getElementById("dispHpVal");
      sel.value = "0"; sel.dispatchEvent(new Event("change"));
      var valOff = d.hpBarShowValue;
      sel.value = "1"; sel.dispatchEvent(new Event("change"));
      var valOn = d.hpBarShowValue;

      // 复位
      set("dispUnit", "2"); set("dispHpBar", "2");
      return {
        unit: unit, unitLabel: unitLabel,
        bar: bar, barLabel: barLabel,
        valOff: valOff, valOn: valOn,
        restoredUnit: d.unitScale, restoredBar: d.hpBarScale
      };
    })())`));
    check("角色大小写回配置", Math.abs(uiWrite.unit - 3.5) < 0.001, String(uiWrite.unit));
    check("角色大小标签同步", uiWrite.unitLabel === "3.50×", uiWrite.unitLabel);
    check("血条大小写回配置", Math.abs(uiWrite.bar - 1.25) < 0.001, String(uiWrite.bar));
    check("血条大小标签同步", uiWrite.barLabel === "1.25×", uiWrite.barLabel);
    check("血条数值开关写回", uiWrite.valOff === false && uiWrite.valOn === true);

    console.log("\n=== 9. 截图 ===");
    await browser.eval(`(function(){
      var d = window.MA.CONFIG.display;
      d.unitScale = 2; d.hpBarScale = 2; d.hpBarShowValue = true;
      window.MA.CONFIG.arena.zoneEnabled = true;
      window.MA.CONFIG.camera.followZoom = 1.0;
      world.paused = false;
      world.cam.zoom = 1;
      world.setCameraMode("global");
      world.reset(["moyu","kunkun","hajimi","creeper","saibo","fanqie","yyds","tiangou"]);
      return true;
    })()`);
    await sleep(2500);
    const s1 = await browser.screenshot(path.join(OUT, "display-01-2x.png"));
    check("2 倍尺寸截图", s1 > 20000, (s1 / 1024).toFixed(0) + " KB");

    // 跟随视角特写：能看清血条内的数字
    await browser.eval(`(function(){
      window.MA.CONFIG.camera.followZoom = 2.2;
      world.setCameraMode("follow");
      world.cam.zoom = 2.2;
      return true;
    })()`);
    await sleep(2000);
    const s2 = await browser.screenshot(path.join(OUT, "display-02-closeup.png"));
    check("特写截图（看血条数字）", s2 > 20000, (s2 / 1024).toFixed(0) + " KB");

    // 1 倍对照
    await browser.eval(`(function(){
      window.MA.CONFIG.display.unitScale = 1;
      window.MA.CONFIG.display.hpBarScale = 1;
      world.reset(["moyu","kunkun","hajimi","creeper","saibo","fanqie","yyds","tiangou"]);
      window.MA.CONFIG.camera.followZoom = 1.0;
      world.cam.zoom = 1;
      world.setCameraMode("global");
      return true;
    })()`);
    await sleep(2000);
    const s3 = await browser.screenshot(path.join(OUT, "display-03-1x.png"));
    check("1 倍对照截图", s3 > 20000, (s3 / 1024).toFixed(0) + " KB");

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
