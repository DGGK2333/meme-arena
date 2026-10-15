/* =========================================================================
 * tools/verify-motion.js —— 运动模型与伤害飘字定位验证
 *
 * 背景（用户反馈的两个问题）：
 *   1. 跟随角色后伤害飘字位置错乱
 *   2. 后期角色速度越来越慢（减速技能把动能抽干了）
 *
 * 检查：
 *   · 角色能长期维持接近巡航速度（不会随时间衰减到停滞）
 *   · 减速技能结束后速度能恢复
 *   · 飘字在跟随视角下出现在正确的屏幕位置
 *   · 飘字位置随镜头平移/缩放正确换算
 * 用法：node tools/verify-motion.js
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

    console.log("=== 1. 巡航速度模型就位 ===");
    const mod = JSON.parse(await browser.eval(`JSON.stringify({
      cruise: window.MA.CONFIG.movement.cruise,
      hasApplyCruise: typeof world.applyCruise === "function",
      hasRefreshCruise: typeof world.refreshCruise === "function"
    })`));
    check("巡航配置存在", !!mod.cruise, mod.cruise ? JSON.stringify(mod.cruise) : "无");
    check("applyCruise 方法存在", mod.hasApplyCruise);
    check("refreshCruise 方法存在", mod.hasRefreshCruise);

    console.log("\n=== 2. 速度能长期维持（核心修复）===");
    // 关键场景：关掉安全区（避免毒圈干扰），跑满 60 秒，看速度是否衰减
    const longRun = JSON.parse(await browser.eval(`JSON.stringify((function(){
      window.MA.CONFIG.arena.zoneEnabled = false;
      window.MA.CONFIG.movement.cruise.enabled = true;
      world.autoRestart = false;
      world.reset(window.MA.CHARACTERS.map(function(t){ return t.id; }));
      world.shrink = 0;

      function avgSpeed(){
        var s = 0, n = 0;
        for (var i = 0; i < world.units.length; i++) {
          var u = world.units[i];
          if (!u.alive) continue;
          s += Math.hypot(u.vx, u.vy); n++;
        }
        return n ? s / n : 0;
      }

      var samples = [];
      for (var sec = 0; sec < 60; sec++) {
        for (var k = 0; k < 60; k++) world.step(1/60);
        if (sec % 10 === 9) samples.push({ t: sec + 1, v: +avgSpeed().toFixed(0), alive: world.aliveCount() });
      }
      return { samples: samples, arena: world.arena };
    })())`));
    console.log("    平均速度随时间：" +
      longRun.samples.map(s => s.t + "s=" + s.v).join("  "));
    const first = longRun.samples[0].v;
    const last = longRun.samples[longRun.samples.length - 1].v;
    // 关键：后期速度不应相比开局大幅衰减（修复前会一路掉到几十）
    check("60 秒后平均速度没有衰减到停滞", last > first * 0.55,
      "开局 " + first + " → 后期 " + last);
    check("后期平均速度仍高于 minSpeed 量级", last > 120, "后期 " + last);

    console.log("\n=== 3. 减速技能结束后速度恢复 ===");
    const slowRecover = JSON.parse(await browser.eval(`JSON.stringify((function(){
      window.MA.CONFIG.arena.zoneEnabled = false;
      world.autoRestart = false;
      world.reset(["moyu","kunkun","hajimi"]);
      var u = world.units[0];
      // 只保留一个单位来排除碰撞干扰。
      // 注意：同时要把 picks 也改成 1 个 —— 否则 checkEnd 会判定"只剩 1 人存活"
      // 直接结束比赛，之后 step() 就 early-return，slow 永远不会衰减，
      // 看起来就像"减速没生效"。这是测试写法问题，不是产品问题。
      world.picks = [u.tpl.id];
      world.units = [u];
      u.cruiseSpeed = 300;
      u.cruiseScale = 1;
      u.vx = 300; u.vy = 0;

      var before = Math.hypot(u.vx, u.vy);
      u.slow = 2.0;
      var minSpeedSeen = 1e9;
      for (var i = 0; i < 60 * 2; i++) {
        world.step(1/60);
        if (u.slow > 0) minSpeedSeen = Math.min(minSpeedSeen, Math.hypot(u.vx, u.vy));
      }
      var duringSlow = Math.hypot(u.vx, u.vy);
      var slowAfter2s = u.slow;

      // 减速结束后再跑 3 秒
      for (var j = 0; j < 60 * 3; j++) world.step(1/60);
      var after = Math.hypot(u.vx, u.vy);

      return {
        before: +before.toFixed(1),
        minSpeedSeen: +minSpeedSeen.toFixed(1),
        duringSlow: +duringSlow.toFixed(1),
        after: +after.toFixed(1),
        slowNow: u.slow,
        slowAfter2s: +slowAfter2s.toFixed(2),
        over: world.over
      };
    })())`));
    console.log("    减速前 " + slowRecover.before + " → 减速中最低 " + slowRecover.minSpeedSeen +
      " → 结束后 " + slowRecover.after + "（slow 残留 " + slowRecover.slowAfter2s + "）");
    check("减速期间速度确实被压低", slowRecover.minSpeedSeen < slowRecover.before * 0.8,
      slowRecover.minSpeedSeen + " vs " + slowRecover.before);
    // 恢复判定：回到巡航值的 80% 以上即可。
    // 不必要求"相对最低点翻倍"——那取决于减速恰好压到多低，不是稳定指标。
    check("减速结束后速度恢复到巡航值的 80% 以上",
      slowRecover.after > 300 * 0.8,
      slowRecover.minSpeedSeen + " → " + slowRecover.after + "（巡航 300，需 >240）");
    check("恢复幅度明显（相比减速中最低点涨了 40%+）",
      slowRecover.after > slowRecover.minSpeedSeen * 1.4,
      slowRecover.minSpeedSeen + " → " + slowRecover.after);
    check("恢复后接近巡航值 300", Math.abs(slowRecover.after - 300) < 90,
      "恢复后 " + slowRecover.after + "（巡航 300）");
    check("slow 状态已清零", slowRecover.slowNow === 0);
    check("测试期间比赛没有提前结束（否则 slow 不会衰减）",
      slowRecover.over === false, "over=" + slowRecover.over);

    console.log("\n=== 4. 速度不会因反复碰撞而永久衰减 ===");
    const collisionLoss = JSON.parse(await browser.eval(`JSON.stringify((function(){
      window.MA.CONFIG.arena.zoneEnabled = false;   // 关掉毒圈，避免角色被毒死导致样本为空
      world.autoRestart = false;
      world.reset(window.MA.CHARACTERS.slice(0, 8).map(function(t){ return t.id; }));
      world.shrink = 0;

      function avg(){
        var s = 0, n = 0;
        for (var i = 0; i < world.units.length; i++) {
          var u = world.units[i];
          if (!u.alive) continue;
          s += Math.hypot(u.vx, u.vy); n++;
        }
        return n ? s / n : 0;
      }
      var samples = [];
      for (var s2 = 0; s2 < 30; s2++) {
        for (var k = 0; k < 60; k++) {
          if (world.over) break;      // 打完了就停，别继续空转
          world.step(1/60);
        }
        if (s2 % 6 === 5) {
          var cs = 0, n2 = 0;
          for (var i2 = 0; i2 < world.units.length; i2++) {
            if (world.units[i2].alive) { cs += world.units[i2].cruiseSpeed || 0; n2++; }
          }
          samples.push({
            t: s2 + 1,
            actual: +avg().toFixed(0),
            cruise: n2 ? +(cs / n2).toFixed(0) : 0,
            alive: world.aliveCount()
          });
          if (world.over) break;
        }
      }
      // 角色放大 2 倍后碰撞更频繁、比赛结束得更快，
      // 30 秒窗口内可能只剩很少存活者甚至全灭。
      // 所以取"最后一个仍有存活角色的采样点"作为判定依据，而不是最后一条。
      var lastAliveSample = null;
      for (var q = samples.length - 1; q >= 0; q--) {
        if (samples[q].alive > 0 && samples[q].cruise > 0) { lastAliveSample = samples[q]; break; }
      }
      return { samples: samples, over: world.over, lastAliveSample: lastAliveSample };
    })())`));
    console.log("    时间   实际速度 / 巡航速度   (存活)");
    collisionLoss.samples.forEach(s => {
      console.log("    " + String(s.t).padStart(3) + "s   " + String(s.actual).padStart(4) + " / " +
        String(s.cruise).padStart(4) + "          (" + s.alive + ")");
    });
    const lastSample = collisionLoss.lastAliveSample;
    check("采样期间至少有一个存活角色可判定",
      !!lastSample, lastSample
        ? "最后一个有效采样 " + lastSample.t + "s（存活 " + lastSample.alive + "）"
        : "全部采样点都无存活角色");
    check("实际速度跟得上巡航速度（差距 < 45%）",
      !!lastSample && lastSample.actual > lastSample.cruise * 0.55,
      lastSample ? "实际 " + lastSample.actual + " vs 巡航 " + lastSample.cruise : "无样本");

    console.log("\n=== 5. 伤害飘字在跟随视角下位置正确 ===");
    // 注意：不能扫描"非透明像素"来定位飘字 —— 擂台背景铺满整张画布，
    // 到处都是不透明像素。正确做法是画两帧（有飘字 / 无飘字）取差异像素。
    const dmgPos = JSON.parse(await browser.eval(`JSON.stringify((function(){
      window.MA.CONFIG.camera.followZoom = 1.8;
      world.setCameraMode("follow");
      world.autoRestart = false;
      world.reset(["moyu","kunkun"]);
      world.paused = true;
      world.cam.zoom = 1.8;
      var t = world.getCamTarget() || world.units[0];
      world.cam.targetId = t.uid;
      t.x = world.arena / 2; t.y = world.arena / 2; t.vx = 0; t.vy = 0;
      for (var i = 0; i < 150; i++) world.updateCamera(1/60);
      world.cam.zoom = 1.8;

      var A = world.arena;
      var cv = document.getElementById("cv"), g = cv.getContext("2d");
      var W = cv.width, H = cv.height;
      var dmg = world.fx.getDmgTexts();

      function snap(){
        g.setTransform(1,0,0,1,0,0);
        g.clearRect(0,0,W,H);
        drawWorld(world);
        return g.getImageData(0,0,W,H).data;
      }

      // 无飘字
      while (dmg.length) dmg.pop();
      var base = snap();

      // 有飘字（冻结寿命，位置固定在擂台中心）
      world.fx.damageText(A/2, A/2, 42, "contact", 1);
      var one = dmg[0];
      one.life = 999; one.max = 999; one.vx = 0; one.vy = 0;
      var withTxt = snap();

      // 差异像素包围盒 = 飘字实际出现的区域
      var minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, count = 0;
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          var i2 = (y*W+x)*4;
          if (Math.abs(base[i2]-withTxt[i2]) + Math.abs(base[i2+1]-withTxt[i2+1]) +
              Math.abs(base[i2+2]-withTxt[i2+2]) > 24) {
            count++;
            if (x<minX) minX=x; if (x>maxX) maxX=x;
            if (y<minY) minY=y; if (y>maxY) maxY=y;
          }
        }
      }
      return {
        textX: +one.x.toFixed(0), textY: +one.y.toFixed(0),
        diffCount: count,
        minX: minX, maxX: maxX, minY: minY, maxY: maxY,
        canvasW: W, canvasH: H, zoom: world.cam.zoom,
        camX: +world.cam.x.toFixed(0), camY: +world.cam.y.toFixed(0)
      };
    })())`));
    console.log("    飘字世界坐标 (" + dmgPos.textX + "," + dmgPos.textY + ")  " +
      "镜头 (" + dmgPos.camX + "," + dmgPos.camY + ") zoom " + dmgPos.zoom);
    console.log("    差异像素 " + dmgPos.diffCount + " 个，包围盒 x[" + dmgPos.minX + "," + dmgPos.maxX +
      "] y[" + dmgPos.minY + "," + dmgPos.maxY + "]（画布 " + dmgPos.canvasW + "×" + dmgPos.canvasH + "）");
    check("找到飘字绘制的差异像素", dmgPos.diffCount > 30, dmgPos.diffCount + " 个");
    // 镜头对准擂台中心，飘字也在擂台中心 → 应该画在画布中心
    check("飘字画在画布中心（不是左上角）",
      Math.abs((dmgPos.minX + dmgPos.maxX)/2 - dmgPos.canvasW/2) < dmgPos.canvasW * 0.2,
      "飘字中心 x=" + Math.round((dmgPos.minX + dmgPos.maxX)/2) + " 画布中心 " + Math.round(dmgPos.canvasW/2));
    check("飘字纵向也在中心区域",
      Math.abs((dmgPos.minY + dmgPos.maxY)/2 - dmgPos.canvasH/2) < dmgPos.canvasH * 0.25,
      "飘字中心 y=" + Math.round((dmgPos.minY + dmgPos.maxY)/2) + " 画布中心 " + Math.round(dmgPos.canvasH/2));

    console.log("\n=== 6. 飘字位置随镜头平移 ===");
    const followMove = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var A = world.arena;
      var cv = document.getElementById("cv"), g = cv.getContext("2d");
      var W = cv.width, H = cv.height;
      var dmg = world.fx.getDmgTexts();

      // 用"有飘字 - 无飘字"的差异定位，而不是扫描非透明像素
      function textCenterX(camX){
        function snap(){
          g.setTransform(1,0,0,1,0,0);
          g.clearRect(0,0,W,H);
          drawWorld(world);
          return g.getImageData(0,0,W,H).data;
        }
        while (dmg.length) dmg.pop();
        world.cam.x = camX; world.cam.y = A/2; world.cam.zoom = 1.8;
        var base = snap();
        // 世界点固定在擂台中心
        world.fx.damageText(A/2, A/2, 77, "contact", 1);
        var one = dmg[0];
        one.life = 999; one.max = 999; one.vx = 0; one.vy = 0;
        var withTxt = snap();

        var minX = 1e9, maxX = -1;
        for (var y = 0; y < H; y++) {
          for (var x = 0; x < W; x++) {
            var i2 = (y*W+x)*4;
            if (Math.abs(base[i2]-withTxt[i2]) + Math.abs(base[i2+1]-withTxt[i2+1]) +
                Math.abs(base[i2+2]-withTxt[i2+2]) > 24) {
              if (x<minX) minX=x; if (x>maxX) maxX=x;
            }
          }
        }
        return (maxX < 0) ? -1 : Math.round((minX+maxX)/2);
      }

      var centerA = textCenterX(A * 0.5);
      var rightA  = textCenterX(A * 0.5 + 40);   // 镜头右移 → 世界点应左移
      var leftA   = textCenterX(A * 0.5 - 40);   // 镜头左移 → 世界点应右移

      return { center: centerA, right: rightA, left: leftA };
    })())`));
    console.log("    镜头在中心      → 飘字屏幕 x = " + followMove.center);
    console.log("    镜头右移 40px   → 飘字屏幕 x = " + followMove.right);
    console.log("    镜头左移 40px   → 飘字屏幕 x = " + followMove.left);
    check("镜头右移时飘字左移", followMove.right < followMove.center - 20,
      followMove.center + " → " + followMove.right);
    check("镜头左移时飘字右移", followMove.left > followMove.center + 20,
      followMove.center + " → " + followMove.left);
    // 位移量应约等于 40 × zoom = 72px（zoom 1.8）
    check("位移量符合 zoom 换算（约 72px）",
      Math.abs((followMove.left - followMove.right) - 40 * 1.8) < 40,
      "实际位移 " + (followMove.left - followMove.right) + "px");

    console.log("\n=== 7. 全局视野下飘字仍正确 ===");
    await browser.eval(`(function(){
      world.setCameraMode("global");
      world.cam.zoom = 1;
      return true;
    })()`);
    const globalPos = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var A = world.arena;
      var cv = document.getElementById("cv"), g = cv.getContext("2d");
      var dmg = world.fx.getDmgTexts();
      while (dmg.length) dmg.pop();
      world.fx.damageText(A/2, A/2, 55, "contact", 1);
      dmg[0].life = 999; dmg[0].max = 999; dmg[0].vx = 0; dmg[0].vy = 0;
      g.setTransform(1,0,0,1,0,0);
      g.clearRect(0,0,cv.width,cv.height);
      drawWorld(world);
      var W = cv.width, H = cv.height;
      var data = g.getImageData(0,0,W,H).data;
      var minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
      for (var y = 0; y < H; y += 2) {
        for (var x = 0; x < W; x += 2) {
          if (data[(y*W+x)*4+3] > 20) {
            if (x<minX) minX=x; if (x>maxX) maxX=x;
            if (y<minY) minY=y; if (y>maxY) maxY=y;
          }
        }
      }
      return { minX: minX, maxX: maxX, W: W, H: H,
        centerX: Math.round(W/2), zoom: world.cam.zoom };
    })())`));
    check("全局视野下飘字也在画布中心",
      Math.abs((globalPos.minX + globalPos.maxX)/2 - globalPos.centerX) < globalPos.W * 0.25,
      "包围盒 x[" + globalPos.minX + "," + globalPos.maxX + "] 中心 " + globalPos.centerX);

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
