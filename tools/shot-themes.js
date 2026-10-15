/* 一次性截取所有背景主题，用于视觉确认 */
"use strict";

const path = require("path");
const { Browser, sleep, reapStaleProcesses } = require("./cdp");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "_verify");
const URL = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");

(async () => {
  reapStaleProcesses();
  const b = new Browser();
  try {
    await b.launch({ url: "about:blank", width: 1000, height: 900 });
    await b.open(URL);
    await sleep(700);

    // 固定 4 个角色、暂停世界，保证各主题画面可比
    await b.eval(`(function(){
      world.autoRestart = false;
      world.reset(["moyu","kunkun","hajimi","creeper"]);
      world.paused = true;
      return true;
    })()`);
    await sleep(400);

    const themes = await b.eval(`Object.keys(window.MA.Background.themes)`);
    for (const t of themes) {
      await b.eval(`window.MA.Background.setPreset("${t}"); drawWorld(world); true`);
      await sleep(150);
      const size = await b.screenshot(path.join(OUT, "bg-" + t + ".png"));
      console.log("  ✓ bg-" + t + ".png  " + (size / 1024).toFixed(0) + " KB");
    }

    // 自选图片 + 低遮罩，确认图片能看清
    await b.eval(`(function(){
      var c = document.createElement("canvas"); c.width = c.height = 256;
      var g = c.getContext("2d");
      var grad = g.createLinearGradient(0,0,256,256);
      grad.addColorStop(0,"#ff6b9d"); grad.addColorStop(0.5,"#6ee7ff"); grad.addColorStop(1,"#ffd25e");
      g.fillStyle = grad; g.fillRect(0,0,256,256);
      g.fillStyle = "rgba(255,255,255,.5)";
      for (var i=0;i<12;i++){ g.beginPath(); g.arc((i*37)%256,(i*61)%256,14,0,6.283); g.fill(); }
      return new Promise(function(res){
        c.toBlob(function(blob){
          window.MA.Background.setFile(new File([blob],"demo.png",{type:"image/png"})).then(function(){
            document.getElementById("bgOverlay").value = "0.25";
            document.getElementById("bgOverlay").dispatchEvent(new Event("input"));
            drawWorld(world);
            res(true);
          });
        }, "image/png");
      });
    })()`);
    await sleep(250);
    const s2 = await b.screenshot(path.join(OUT, "bg-custom.png"));
    console.log("  ✓ bg-custom.png  " + (s2 / 1024).toFixed(0) + " KB");

  } finally {
    await b.close();
  }
  console.log("\n主题截图完成，目录: _verify");
})().catch(e => { console.error(e); process.exit(1); });
