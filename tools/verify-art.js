/* =========================================================================
 * tools/verify-art.js —— 验证真实素材（贴图 / GIF 动图 / 音效）在浏览器里生效
 * 前提：已跑过 python tools/make-demo-assets.py 和 node tools/scan-assets.js
 * 用法：node tools/verify-art.js
 * ========================================================================= */
"use strict";

const fs = require("fs");
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
    await browser.open(URL);
    await sleep(700);

    console.log("=== 1. 素材清单被页面读取 ===");
    const man = JSON.parse(await browser.eval(`JSON.stringify(window.MA.ASSET_MANIFEST)`));
    check("manifest 含 moyu 单张贴图", !!(man.moyu && man.moyu.idle), man.moyu ? String(man.moyu.idle) : "无");
    check("manifest 含 kunkun 的序列帧", !!(man.kunkun && Array.isArray(man.kunkun.idle)),
      man.kunkun ? man.kunkun.idle.length + " 帧" : "无");
    check("manifest 含 kunkun 的攻击序列", !!(man.kunkun && Array.isArray(man.kunkun.attack)),
      man.kunkun && man.kunkun.attack ? man.kunkun.attack.length + " 帧" : "无");

    console.log("\n=== 2. 图片真的加载进内存 ===");
    // 等素材加载完
    for (let i = 0; i < 40; i++) {
      if (!(await browser.eval(`window.MA.Assets.loading`))) break;
      await sleep(150);
    }
    const stats = JSON.parse(await browser.eval(`JSON.stringify(window.MA.Assets.stats())`));
    check("图片已加载", stats.images >= 8, stats.images + " 张");
    check("音效已加载", stats.sounds >= 2, stats.sounds + " 个");
    check("序列帧已注册", stats.sequences >= 2, stats.sequences + " 组");
    check("无加载失败", stats.failed === 0, stats.failed + " 个失败");

    const detail = JSON.parse(await browser.eval(`JSON.stringify({
      moyuIdle: !!window.MA.Assets.image("moyu","idle"),
      moyuSkill: !!window.MA.Assets.image("moyu","skill"),
      kunkunIsSeq: window.MA.Assets.isSequence("kunkun","idle"),
      kunkunAttackSeq: window.MA.Assets.isSequence("kunkun","attack"),
      noArtChar: window.MA.Assets.hasArt("hajimi")
    })`));
    check("moyu idle 贴图就绪", detail.moyuIdle);
    check("moyu skill 贴图就绪", detail.moyuSkill);
    check("kunkun idle 是序列帧", detail.kunkunIsSeq);
    check("kunkun attack 是序列帧", detail.kunkunAttackSeq);
    check("无素材角色仍走几何回退", detail.noArtChar === false);

    console.log("\n=== 3. 序列帧动画由游戏循环驱动（可控可测）===");
    // 取不同时间点应该拿到不同帧 —— 证明动画推进不依赖浏览器 GIF 计时器
    const seqProbe = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var A = window.MA.Assets;
      var frames = [];
      for (var i = 0; i < 8; i++) {
        var img = A.frame("kunkun", "idle", i / 8, 8);   // 每秒 8 帧
        frames.push(img ? img.src.split("/").pop() : null);
      }
      var uniq = {};
      frames.forEach(function(f){ if(f) uniq[f] = 1; });
      // 越界取模
      var wrap = A.frame("kunkun","idle", 8.0, 8);
      var f0 = A.frame("kunkun","idle", 0, 8);
      return {
        frames: frames,
        unique: Object.keys(uniq).length,
        wrapSame: (wrap && f0) ? (wrap.src === f0.src) : false
      };
    })())`));
    check("不同时间取到不同帧", seqProbe.unique >= 4, seqProbe.unique + "/8 帧不同");
    check("帧循环正确回绕", seqProbe.wrapSame === true);
    console.log("    帧序列: " + seqProbe.frames.join(" → "));

    console.log("\n=== 4. 渲染层确实走了贴图/序列帧分支 ===");
    await browser.eval(`(function(){
      world.autoRestart = false;
      world.reset(["moyu","kunkun"]);
      return true;
    })()`);
    await sleep(500);

    // 统计一帧里 drawImage 被调用的次数
    const drawn = await browser.eval(`(function(){
      var g = world.ctx, orig = g.drawImage, n = 0;
      g.drawImage = function(){ n++; return orig.apply(g, arguments); };
      drawWorld(world);
      g.drawImage = orig;
      return n;
    })()`);
    check("渲染时调用了 drawImage（画贴图）", drawn >= 2, drawn + " 次");

    // 让世界时间推进，确认渲染出的帧真的在变
    // 注意：要裁切角色所在区域再比较，整幅缩放会把只有几十像素的角色差异抹平
    const animMoving = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var g = world.ctx;
      // 找一个 kunkun 单位（序列帧角色）
      var u = null;
      for (var i = 0; i < world.units.length; i++) {
        if (world.units[i].tpl.id === "kunkun" && world.units[i].alive) { u = world.units[i]; break; }
      }
      if (!u) return { ok: false, why: "场上没有 kunkun" };

      world.paused = true;                      // 手动控制时间，保证可复现
      function cropFingerprint(){
        var s = Math.round(u.r * 4);
        var c = document.createElement("canvas"); c.width = c.height = s;
        var cg = c.getContext("2d");
        cg.drawImage(g.canvas,
          Math.round(u.x - s/2), Math.round(u.y - s/2), s, s,
          0, 0, s, s);
        var d = cg.getImageData(0,0,s,s).data, h = 0;
        for (var i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i+1]*3 + d[i+2]*7 + d[i+3]) % 1000000007;
        return h;
      }

      // 采样 8 个时间点，看看有多少个不同的画面
      var seen = {}, order = [];
      for (var k = 0; k < 8; k++) {
        world.time = 1.0 + k * 0.125;           // 0.125 秒 = 每秒 8 帧里的下一帧
        drawWorld(world);
        var h = cropFingerprint();
        if (!(h in seen)) { seen[h] = 1; order.push(h); }
      }
      world.paused = false;
      return { ok: true, unique: order.length, samples: 8 };
    })())`));
    check("推进时间后画面发生变化（动画在播）", animMoving.ok && animMoving.unique >= 3,
      animMoving.ok ? animMoving.unique + "/8 个不同画面" : animMoving.why);

    console.log("\n=== 5. 有贴图的战斗能正常打完 ===");
    // 直接步进世界而不是等真实时间：更快、更确定，也不受机器性能影响。
    // （之前用 sleep 轮询，2 人局偶尔超过 36 秒的等待窗口导致偶发失败）
    const res = JSON.parse(await browser.eval(`JSON.stringify((function(){
      world.autoRestart = false;
      world.reset(["moyu","kunkun"]);
      var steps = 0;
      var maxSteps = 60 * 130;          // 最多推进 130 秒模拟时间
      while (!world.over && steps < maxSteps) { world.step(1/60); steps++; }
      return {
        over: world.over,
        time: +world.time.toFixed(1),
        winner: world.winner ? world.winner.name : null,
        skillErrors: world.skillErrors
      };
    })())`));
    check("比赛能结束", res.over, res.time + "s（模拟时间）");
    // 2 人局有概率同归于尽（平局），这是合法结果，不算失败
    check("决出冠军或合法平局", !!res.winner || res.over,
      res.winner ? res.winner : "平局（双方同归于尽）");
    check("技能无异常", res.skillErrors === 0);

    console.log("\n=== 5b. 结算横幅：冠军与「无人胜出」都要有提示 ===");
    /* 回归：以前 drawResult 在 !winner 时直接 return，只留下那层压暗的遮罩，
     * 屏幕上"只是变暗了"没有任何文字；UI 层的弹幕也要求 winner 非空。
     * 画布文字可以同步捕获；DOM 弹幕由主循环异步写入，必须等一帧。 */
    const captureBanner = (winnerIdx) => `JSON.stringify((function(){
      world.autoRestart = false;
      world.paused = false;
      world.reset(["chuanjian","suannai"]);
      ${winnerIdx === null
        ? 'world.finish(null, "测试平局");'
        : `world.finish(world.units[${winnerIdx}], "测试冠军");`}
      var hasWinner = !!world.winner;
      var proto = CanvasRenderingContext2D.prototype;
      var orig = proto.fillText, seen = [];
      proto.fillText = function(t){ seen.push(String(t)); return orig.apply(this, arguments); };
      world.overT = 1;            // 动画进度拉满，文字不透明
      drawWorld(world);
      proto.fillText = orig;
      return { texts: seen, hasWinner: hasWinner };
    })())`;

    // ---- 平局 ----
    const drawCase = JSON.parse(await browser.eval(captureBanner(null)));
    await sleep(450);   // 等主循环把弹幕写进 DOM
    const drawOverlay = await browser.eval(`document.getElementById("overlay").textContent`);

    // ---- 有冠军（对照）----
    const winCase = JSON.parse(await browser.eval(captureBanner(0)));
    await sleep(450);
    const winOverlay = await browser.eval(`document.getElementById("overlay").textContent`);

    const joinT = a => a.join(" | ");
    console.log("    平局画布文本: " + joinT(drawCase.texts));
    console.log("    平局弹幕    : " + JSON.stringify(drawOverlay));
    console.log("    冠军画布文本: " + joinT(winCase.texts));
    console.log("    冠军弹幕    : " + JSON.stringify(winOverlay));

    check("平局时 winner 为空（前提正确）", drawCase.hasWinner === false);
    check("平局时画布上写出「无人胜出」",
      drawCase.texts.indexOf("无人胜出") >= 0, joinT(drawCase.texts));
    check("平局时还有一句说明（全员阵亡 / 无人生还）",
      drawCase.texts.some(t => t.indexOf("全员阵亡") >= 0 || t.indexOf("无人生还") >= 0),
      joinT(drawCase.texts));
    check("平局时弹幕提示「无人胜出」",
      drawOverlay.indexOf("无人胜出") >= 0, drawOverlay);
    check("平局时不再只画遮罩（文字数量足够）",
      drawCase.texts.length >= 3, drawCase.texts.length + " 条");
    // 冠军路径不能被改坏
    check("有冠军时仍写冠军名字",
      winCase.texts.some(t => t.indexOf("纯爱战士") >= 0 || t.indexOf("老酸奶") >= 0),
      joinT(winCase.texts));
    check("有冠军时仍写「🏆 冠军」",
      winCase.texts.some(t => t.indexOf("冠军") >= 0), joinT(winCase.texts));
    check("有冠军时弹幕报名字",
      winOverlay.indexOf("胜利") >= 0, winOverlay);
    check("有冠军时不出现「无人胜出」",
      winCase.texts.indexOf("无人胜出") < 0, joinT(winCase.texts));

    console.log("\n=== 5. 截图 ===");
    await browser.eval(`(function(){
      world.autoRestart = false;
      world.reset(["moyu","kunkun","hajimi","creeper"]);
      return true;
    })()`);
    await sleep(2500);
    let size = await browser.screenshot(path.join(OUT, "10-with-art.png"));
    check("贴图战斗截图", size > 20000, (size / 1024).toFixed(0) + " KB");

    console.log("\n=== 6. 无报错 ===");
    check("无 JS 报错", errors.length === 0, errors.slice(0, 3).join(" | "));

  } catch (e) {
    console.error("\n出错: " + (e && e.stack || e));
    failures++;
  } finally {
    await browser.close();
  }

  console.log("\n" + (failures === 0 ? "全部通过 ✅" : failures + " 项失败 ❌"));
  process.exit(failures === 0 ? 0 : 1);
})();
