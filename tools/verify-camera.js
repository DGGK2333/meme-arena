/* =========================================================================
 * tools/verify-camera.js —— 验证摄像机、伤害飘字与帧率
 * 检查：
 *   1. 帧率不再被锁在 40（rAF 与 setTimeout 混用导致的拍频问题）
 *   2. 全局/跟随模式可切换
 *   3. 跟随模式放大、镜头对准目标
 *   4. 目标贴墙时自动拉远（获得更多全局视野）—— 核心需求
 *   5. 镜头不会拍到擂台外
 *   6. 伤害飘字会生成，且伤害类型有区分
 * 用法：node tools/verify-camera.js
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

    console.log("=== 1. 帧率不再被锁死 ===");
    // 采样 3 秒内的实际帧率（注意 JSON.stringify 必须在 Promise 内部）
    const fps = JSON.parse(await browser.eval(`(function(){
      return new Promise(function(res){
        var frames = 0;
        var t0 = performance.now();
        function tick(){
          frames++;
          if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
          else {
            var elapsed = (performance.now() - t0) / 1000;
            res(JSON.stringify({ frames: frames, fps: frames / elapsed,
              shown: document.getElementById("hFps").textContent }));
          }
        }
        requestAnimationFrame(tick);
      });
    })()`));
    check("帧率高于 45（未锁在 40）", fps.fps > 45,
      fps.fps.toFixed(1) + " fps（" + fps.frames + " 帧 / 3 秒），界面显示 " + fps.shown);

    console.log("\n=== 2. 摄像机模式切换 ===");
    const modes = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var s = document.getElementById("optCam");
      var initial = world.cam.mode;
      s.value = "follow"; s.dispatchEvent(new Event("change"));
      var afterFollow = world.cam.mode;
      var hasTarget = !!world.getCamTarget();
      s.value = "global"; s.dispatchEvent(new Event("change"));
      var afterGlobal = world.cam.mode;
      return {
        initial: initial, afterFollow: afterFollow, afterGlobal: afterGlobal,
        hasTarget: hasTarget,
        zoomAfterGlobal: world.cam.zoom,
        btn: document.getElementById("btnCamera").textContent
      };
    })())`));
    check("默认是全局视野", modes.initial === "global", modes.initial);
    check("可切到跟随模式", modes.afterFollow === "follow");
    check("跟随模式自动选中目标", modes.hasTarget === true);
    check("可切回全局视野", modes.afterGlobal === "global");
    check("切回全局后 zoom 复位为 1", Math.abs(modes.zoomAfterGlobal - 1) < 0.01, "zoom=" + modes.zoomAfterGlobal);

    console.log("\n=== 3. 跟随模式缩放恒定（不忽远忽近）===");
    const follow = JSON.parse(await browser.eval(`JSON.stringify((function(){
      world.autoRestart = false;
      world.reset(["moyu","kunkun","hajimi","creeper","saibo","fanqie"]);
      var s = document.getElementById("optCam");
      s.value = "follow"; s.dispatchEvent(new Event("change"));
      var t = world.getCamTarget();
      var zooms = [];
      // 让目标在场地里绕一圈（中心 → 各边 → 角落），记录每一处的 zoom
      var spots = [
        [world.arena/2, world.arena/2],
        [world.arena*0.2, world.arena*0.5],
        [world.arena*0.8, world.arena*0.5],
        [world.arena*0.5, world.arena*0.2],
        [world.arena*0.5, world.arena*0.8],
        [t.r+1, t.r+1],
        [world.arena-t.r-1, world.arena-t.r-1]
      ];
      for (var i = 0; i < spots.length; i++) {
        t.x = spots[i][0]; t.y = spots[i][1]; t.vx = 0; t.vy = 0;
        for (var k = 0; k < 120; k++) world.updateCamera(1/60);
        zooms.push(+world.cam.zoom.toFixed(4));
      }
      var uniq = {};
      zooms.forEach(function(z){ uniq[z] = 1; });
      return {
        zooms: zooms, uniqueZooms: Object.keys(uniq).length,
        configured: window.MA.CONFIG.camera.followZoom
      };
    })())`));
    check("跟随缩放全程恒定", follow.uniqueZooms === 1,
      "7 个位置出现 " + follow.uniqueZooms + " 种缩放: " + follow.zooms.join(", "));
    check("缩放等于配置值", Math.abs(follow.zooms[0] - follow.configured) < 0.001,
      follow.zooms[0] + " vs " + follow.configured);

    console.log("\n=== 3b. 缩放可在网页内调整 ===");
    const zoomUI = JSON.parse(await browser.eval(`JSON.stringify((function(){
      world.setCameraMode("follow");
      var row = document.getElementById("camZoomRow");
      var s = document.getElementById("camZoom");
      var out = document.getElementById("camZoomVal");
      var visible = row.style.display !== "none";

      s.value = "2.4";
      s.dispatchEvent(new Event("input"));
      var cfgAfter = window.MA.CONFIG.camera.followZoom;
      var label = out.value;
      for (var i = 0; i < 60; i++) world.updateCamera(1/60);
      var settled = world.cam.zoom;

      s.value = "1.2";
      s.dispatchEvent(new Event("input"));
      for (var i = 0; i < 60; i++) world.updateCamera(1/60);
      var second = world.cam.zoom;

      out.onclick();   // 点击数值 → 恢复默认
      var restored = window.MA.CONFIG.camera.followZoom;

      return {
        visible: visible, cfgAfter: cfgAfter, label: label,
        settled: settled, second: second, restored: restored,
        defaultZoom: window.MA.CAMERA_DEFAULT_ZOOM,
        min: parseFloat(s.min), max: parseFloat(s.max), step: parseFloat(s.step),
        cfgMin: window.MA.CONFIG.camera.zoomMin,
        cfgMax: window.MA.CONFIG.camera.zoomMax,
        cfgStep: window.MA.CONFIG.camera.zoomStep
      };
    })())`));
    check("跟随模式下缩放滑块可见", zoomUI.visible === true);
    check("拖动滑块改变配置", Math.abs(zoomUI.cfgAfter - 2.4) < 0.001, "followZoom=" + zoomUI.cfgAfter);
    check("倍率标签同步更新", zoomUI.label === "2.40×", zoomUI.label);
    check("摄像机实际生效", Math.abs(zoomUI.settled - 2.4) < 0.01, "cam.zoom=" + zoomUI.settled);
    check("可再次调整为其他值", Math.abs(zoomUI.second - 1.2) < 0.01, "cam.zoom=" + zoomUI.second);
    check("点击数值恢复默认", Math.abs(zoomUI.restored - zoomUI.defaultZoom) < 0.001,
      zoomUI.restored + " (默认 " + zoomUI.defaultZoom + ")");
    check("滑块范围来自配置",
      zoomUI.min === zoomUI.cfgMin && zoomUI.max === zoomUI.cfgMax && zoomUI.step === zoomUI.cfgStep,
      zoomUI.min + "~" + zoomUI.max + " 步进 " + zoomUI.step +
      "（配置 " + zoomUI.cfgMin + "~" + zoomUI.cfgMax + "）");

    console.log("\n=== 3c. 键盘 +/- 调缩放 ===");
    const zoomKeys = JSON.parse(await browser.eval(`JSON.stringify((function(){
      world.setCameraMode("global");
      window.MA.CONFIG.camera.followZoom = 1.5;
      world.cam.zoom = 1;
      function press(key){
        window.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));
      }
      press("+");
      var afterPlus = window.MA.CONFIG.camera.followZoom;
      var modeAfterPlus = world.cam.mode;
      press("+"); press("+");
      var afterThreePlus = window.MA.CONFIG.camera.followZoom;
      press("-");
      var afterMinus = window.MA.CONFIG.camera.followZoom;
      for (var i = 0; i < 60; i++) press("-");
      var atMin = window.MA.CONFIG.camera.followZoom;
      for (var i = 0; i < 80; i++) press("+");
      var atMax = window.MA.CONFIG.camera.followZoom;
      return {
        afterPlus: afterPlus, modeAfterPlus: modeAfterPlus,
        afterThreePlus: afterThreePlus, afterMinus: afterMinus,
        atMin: atMin, atMax: atMax,
        cfgMin: window.MA.CONFIG.camera.zoomMin,
        cfgMax: window.MA.CONFIG.camera.zoomMax
      };
    })())`));
    check("按 + 增加缩放", Math.abs(zoomKeys.afterPlus - 1.55) < 0.001, String(zoomKeys.afterPlus));
    check("按 + 自动切到跟随视角", zoomKeys.modeAfterPlus === "follow", zoomKeys.modeAfterPlus);
    check("连续按 + 累加", Math.abs(zoomKeys.afterThreePlus - 1.65) < 0.001, String(zoomKeys.afterThreePlus));
    check("按 - 减小缩放", Math.abs(zoomKeys.afterMinus - 1.6) < 0.001, String(zoomKeys.afterMinus));
    check("缩放不低于下限", Math.abs(zoomKeys.atMin - zoomKeys.cfgMin) < 0.001,
      "下限 " + zoomKeys.atMin + "（配置 " + zoomKeys.cfgMin + "）");
    check("缩放不超过上限", Math.abs(zoomKeys.atMax - zoomKeys.cfgMax) < 0.001,
      "上限 " + zoomKeys.atMax + "（配置 " + zoomKeys.cfgMax + "）");
    // 复位，避免影响后续测试
    await browser.eval(`(function(){
      window.MA.CONFIG.camera.followZoom = window.MA.CAMERA_DEFAULT_ZOOM;
      world.setCameraMode("follow");
      return true;
    })()`);

    console.log("\n=== 3d. 缩放 < 1 时镜头仍能跟随移动 ===");
    const wideZoom = JSON.parse(await browser.eval(`JSON.stringify((function(){
      // 这是修复前的 bug：zoom<1 时 half > A/2，夹取区间反了，
      // 代码走 "lo > hi → 锁在正中" 分支，导致镜头完全不动。
      var out = {};
      window.MA.CONFIG.camera.followZoom = 0.6;
      world.setCameraMode("follow");
      world.cam.zoom = 0.6;
      var t = world.getCamTarget();

      // 目标放在场地左侧，等镜头收敛
      t.x = world.arena * 0.2; t.y = world.arena * 0.5; t.vx = 0; t.vy = 0;
      for (var i = 0; i < 200; i++) world.updateCamera(1/60);
      out.leftCamX = world.cam.x;
      out.arena = world.arena;

      // 目标挪到右侧，镜头应该跟着移过去
      t.x = world.arena * 0.8; t.y = world.arena * 0.5;
      for (var i = 0; i < 200; i++) world.updateCamera(1/60);
      out.rightCamX = world.cam.x;

      // 垂直方向同理
      t.x = world.arena * 0.5; t.y = world.arena * 0.2;
      for (var i = 0; i < 200; i++) world.updateCamera(1/60);
      out.topCamY = world.cam.y;
      t.y = world.arena * 0.8;
      for (var i = 0; i < 200; i++) world.updateCamera(1/60);
      out.bottomCamY = world.cam.y;

      out.moved = out.rightCamX - out.leftCamX;
      out.movedY = out.bottomCamY - out.topCamY;
      out.zoom = world.cam.zoom;

      // 复位
      window.MA.CONFIG.camera.followZoom = window.MA.CAMERA_DEFAULT_ZOOM;
      world.cam.zoom = window.MA.CAMERA_DEFAULT_ZOOM;
      return out;
    })())`));
    check("0.6× 时镜头横向会跟随", Math.abs(wideZoom.moved) > 30,
      "左边 x=" + wideZoom.leftCamX.toFixed(0) + " → 右边 x=" + wideZoom.rightCamX.toFixed(0) +
      "（位移 " + wideZoom.moved.toFixed(0) + "）");
    check("0.6× 时镜头纵向会跟随", Math.abs(wideZoom.movedY) > 30,
      "上 y=" + wideZoom.topCamY.toFixed(0) + " → 下 y=" + wideZoom.bottomCamY.toFixed(0) +
      "（位移 " + wideZoom.movedY.toFixed(0) + "）");
    check("0.6× 时缩放值仍是 0.6", Math.abs(wideZoom.zoom - 0.6) < 0.01, String(wideZoom.zoom));

    console.log("\n=== 4. 贴边时镜头不再硬跟（角色偏离中心，镜头偏向地图中心）===");
    const edge = JSON.parse(await browser.eval(`JSON.stringify((function(){
      // 用回默认缩放，验证 >1 时的贴边行为
      window.MA.CONFIG.camera.followZoom = window.MA.CAMERA_DEFAULT_ZOOM;
      world.cam.zoom = window.MA.CAMERA_DEFAULT_ZOOM;
      world.setCameraMode("follow");
      var t = world.getCamTarget();
      var A = world.arena, r = {};

      // 居中：镜头应该与角色重合
      t.x = A/2; t.y = A/2; t.vx = 0; t.vy = 0;
      for (var i = 0; i < 150; i++) world.updateCamera(1/60);
      r.centerCamX = world.cam.x;
      r.centerOffset = Math.abs(world.cam.x - t.x);

      // 贴左墙：镜头被夹在边界，角色应该明显偏离画面中心
      t.x = t.r + 1; t.y = A/2; t.vx = 0; t.vy = 0;
      for (var i = 0; i < 150; i++) world.updateCamera(1/60);
      r.leftCamX = world.cam.x;
      r.leftOffset = Math.abs(world.cam.x - t.x);
      // 镜头相对角色更靠地图中心（中心在 x=A/2，角色在左，镜头应在角色右边）
      r.leftCamCloserToCenter = (world.cam.x > t.x);

      // 贴左上角
      t.x = t.r + 1; t.y = t.r + 1; t.vx = 0; t.vy = 0;
      for (var i = 0; i < 150; i++) world.updateCamera(1/60);
      r.cornerOffset = Math.hypot(world.cam.x - t.x, world.cam.y - t.y);
      r.cornerCamX = world.cam.x; r.cornerCamY = world.cam.y;
      r.cornerCamCloserToCenter = (world.cam.x > t.x && world.cam.y > t.y);

      // 可见范围（恒定缩放，所以处处一致）
      r.visibleAtCenter = A / world.cam.zoom;
      r.zoom = world.cam.zoom;
      return r;
    })())`));
    check("居中时镜头与角色基本重合", edge.centerOffset < 12,
      "偏移 " + edge.centerOffset.toFixed(1) + "px");
    check("贴边时角色明显偏离画面中心", edge.leftOffset > 30,
      "偏移 " + edge.leftOffset.toFixed(1) + "px（居中时仅 " + edge.centerOffset.toFixed(1) + "px）");
    check("贴左墙时镜头在角色右侧（偏向地图中心）", edge.leftCamCloserToCenter === true,
      "角色 x=" + (edge.leftCamX - edge.leftOffset).toFixed(0) + " 镜头 x=" + edge.leftCamX.toFixed(0));
    check("角落时镜头偏向地图中心", edge.cornerCamCloserToCenter === true,
      "镜头(" + edge.cornerCamX.toFixed(0) + "," + edge.cornerCamY.toFixed(0) + ") 偏移 " +
      edge.cornerOffset.toFixed(1) + "px");

    console.log("\n=== 5. 镜头越界量在允许范围内 ===");
    // 注意：这条不变量只对 zoom ≥ 1 成立。
    //   zoom > 1：视野比擂台小 → 镜头夹在擂台内，不该拍到场外；
    //   zoom < 1：视野比擂台大 → 拍到场外是**故意的**（外层背景就是给它看的），
    //             此时该保证的反而是"整个擂台仍在画面内，没被推出屏幕"。
    // 默认缩放是 0.8（<1），所以这里显式分两种缩放各验一次。
    const bounds = JSON.parse(await browser.eval(`JSON.stringify((function(){
      var A = world.arena;
      var t = world.getCamTarget();
      var pad = window.MA.CONFIG.camera.edgePadding || 0;
      function scan(zoom){
        window.MA.CONFIG.camera.followZoom = zoom;
        world.setCameraMode("follow");
        world.cam.zoom = zoom;
        var spots = [
          [t.r+1, t.r+1], [A-t.r-1, t.r+1],
          [t.r+1, A-t.r-1], [A-t.r-1, A-t.r-1],
          [A/2, t.r+1], [A/2, A-t.r-1],
          [t.r+1, A/2], [A-t.r-1, A/2],
          [A/2, A/2]
        ];
        var worst = 0, worstAt = null, arenaCut = 0;
        for (var i = 0; i < spots.length; i++) {
          t.x = spots[i][0]; t.y = spots[i][1]; t.vx = 0; t.vy = 0;
          for (var k = 0; k < 150; k++) world.updateCamera(1/60);
          var half = A / (2 * world.cam.zoom);
          // 镜头边界相对擂台边界的越界量（正数 = 拍到了场外）
          var over = Math.max(
            half - world.cam.x,
            world.cam.x + half - A,
            half - world.cam.y,
            world.cam.y + half - A
          );
          if (over > worst) { worst = over; worstAt = spots[i]; }
          // 擂台被推出画面的程度（正数 = 有部分擂台看不到）。
          // 视野 = [cam.x-half, cam.x+half]，擂台 = [0, A]：
          //   擂台左边缘 0 落在视野左边之右 → 左边那段擂台看不到
          //   擂台右边缘 A 落在视野右边之左 → 右边那段擂台看不到
          var cut = Math.max(
            Math.max(0, world.cam.x - half),                  // 左侧擂台被推出
            Math.max(0, A - (world.cam.x + half)),            // 右侧擂台被推出
            Math.max(0, world.cam.y - half),
            Math.max(0, A - (world.cam.y + half))
          );
          if (cut > arenaCut) arenaCut = cut;
        }
        return { zoom: world.cam.zoom, worst: +worst.toFixed(2), worstAt: worstAt,
                 arenaCut: +arenaCut.toFixed(2), half: +(A/(2*world.cam.zoom)).toFixed(1) };
      }
      var inArena = scan(1.5);    // 视野比擂台小
      var wide = scan(0.8);       // 视野比擂台大（默认值）
      window.MA.CONFIG.camera.followZoom = window.MA.CAMERA_DEFAULT_ZOOM;
      return { inArena: inArena, wide: wide, pad: pad, A: A };
    })())`));
    // zoom > 1：不该拍到场外
    check("zoom>1 时越界量不超过 edgePadding 余量",
      bounds.inArena.worst <= bounds.pad + 2,
      "最大越界 " + bounds.inArena.worst + "px（允许 " + bounds.pad + "px）");
    check("zoom>1 时画面几乎不露场外", bounds.inArena.worst < 90,
      "最坏位置 " + JSON.stringify(bounds.inArena.worstAt));
    // zoom < 1：拍到场外是预期行为，但擂台被切掉的量不该超过 edgePadding
    // （edgePadding 的语义就是"允许镜头越过边界多少"，越过多少就切掉多少）
    check("zoom<1 时擂台被切掉的量不超过 edgePadding",
      bounds.wide.arenaCut <= bounds.pad + 2,
      "擂台被切 " + bounds.wide.arenaCut + "px（允许 " + bounds.pad + "px）");
    check("zoom<1 时确实能看到场外（外层背景有用武之地）",
      bounds.wide.worst > 0, "越界 " + bounds.wide.worst + "px");

    console.log("\n=== 5b. 跟随目标阵亡后自动接管 ===");
    const takeover = JSON.parse(await browser.eval(`JSON.stringify((function(){
      world.setCameraMode("follow");
      var t = world.getCamTarget();
      if (!t) return { error: "没有跟随目标" };
      var firstName = t.name, firstId = t.uid;
      // 直接杀掉当前目标
      t.hp = 0;
      world.kill(t, null);
      world.updateCamera(1/60);
      var next = world.getCamTarget();
      return {
        first: firstName, firstId: firstId,
        next: next ? next.name : null,
        nextId: next ? next.uid : null,
        switched: !!next && next.uid !== firstId
      };
    })())`));
    check("目标阵亡后自动换人", takeover.switched === true,
      takeover.first + " → " + (takeover.next || "无"));
    await browser.eval(`world.reset()`);

    console.log("\n=== 6. 伤害飘字 ===");
    const dmg = JSON.parse(await browser.eval(`JSON.stringify((function(){
      window.MA.CONFIG.damageNumbers.enabled = true;
      world.reset(["chuanjian","suannai","creeper"]);
      var find = function(id){
        for (var i = 0; i < world.units.length; i++) if (world.units[i].tpl.id === id) return world.units[i];
        return null;
      };
      var a = find("chuanjian"), b = find("suannai");
      a.x = world.arena*0.35; a.y = world.arena*0.5; a.vx = 500; a.vy = 0;
      b.x = world.arena*0.65; b.y = world.arena*0.5; b.vx = -500; b.vy = 0;
      var before = world.fx.getDmgTextCount();
      for (var i = 0; i < 60; i++) world.step(1/60);
      var after = world.fx.getDmgTextCount();
      var sample = world.fx.getDmgTexts().slice(0, 3).map(function(t){
        return { str: t.str, color: t.color, size: t.size };
      });
      return { before: before, after: after, sample: sample,
               enabled: window.MA.CONFIG.damageNumbers.enabled };
    })())`));
    check("碰撞产生了伤害飘字", dmg.after > 0,
      dmg.before + " → " + dmg.after + " 条");
    check("飘字带伤害数值", dmg.sample.length > 0 && /^\d+$/.test(String(dmg.sample[0] && dmg.sample[0].str)),
      dmg.sample.length ? "示例: " + JSON.stringify(dmg.sample[0]) : "无样本");

    // 飘字会随时间消失（不会无限累积）
    const decay = JSON.parse(await browser.eval(`JSON.stringify((function(){
      for (var i = 0; i < 90; i++) world.step(1/60);   // 1.5 秒后
      return { count: world.fx.getDmgTextCount() };
    })())`));
    check("飘字会自动消失（不累积）", decay.count < 20, "1.5 秒后剩 " + decay.count + " 条");

    console.log("\n=== 7. 截图 ===");
    await browser.eval(`(function(){
      world.autoRestart = false;
      world.reset(["moyu","kunkun","hajimi","creeper","saibo","fanqie","yyds","tiangou"]);
      world.setCameraMode("global");
      return true;
    })()`);
    await sleep(2200);
    let s1 = await browser.screenshot(path.join(OUT, "cam-01-global.png"));
    check("全局视野截图", s1 > 20000, (s1 / 1024).toFixed(0) + " KB");

    await browser.eval(`(function(){
      world.setCameraMode("follow");
      return true;
    })()`);
    await sleep(1800);
    let s2 = await browser.screenshot(path.join(OUT, "cam-02-follow.png"));
    check("跟随视角截图", s2 > 20000, (s2 / 1024).toFixed(0) + " KB");

    // 强制目标贴墙，截一张"边缘拉远"的图
    await browser.eval(`(function(){
      var t = world.getCamTarget();
      if (t) { t.x = t.r + 6; t.y = world.arena/2; t.vx = 0; t.vy = 0; }
      for (var i = 0; i < 200; i++) world.updateCamera(1/60);
      return true;
    })()`);
    await sleep(500);
    let s3 = await browser.screenshot(path.join(OUT, "cam-03-edge.png"));
    check("边缘拉远截图", s3 > 20000, (s3 / 1024).toFixed(0) + " KB");

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
