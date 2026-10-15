/* =========================================================================
 * tools/scan-assets.js —— 扫描 assets/characters/ 生成 assets/manifest.js
 * -------------------------------------------------------------------------
 * 用法（在 meme-arena 目录下）：
 *     node tools/scan-assets.js
 *
 * 它会把每个角色文件夹里符合命名约定的文件登记到 manifest，
 * 页面加载时优先用手写的 assets 覆盖，其次用这份 manifest。
 * 每次丢进新贴图/音效后跑一次即可（或者在页面里点“重新扫描”查看清单）。
 * ========================================================================= */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CHAR_DIR = path.join(ROOT, "assets", "characters");
const OUT_FILE = path.join(ROOT, "assets", "manifest.js");

const IMG_EXT = [".png", ".gif", ".webp", ".jpg", ".jpeg", ".svg", ".avif"];
const AUD_EXT = [".wav", ".mp3", ".ogg", ".m4a", ".aac"];
const SLOTS = ["idle", "attack", "hurt", "dead", "icon", "skill"];
const SFX_SLOTS = ["attack", "skill", "hurt", "death", "victory", "draw"];

/* 允许的别名：把常见命名都映射到标准槽位，减少手动改名 */
const ALIASES = {
  idle: ["idle", "stand", "default", "normal", "待机", "默认"],
  attack: ["attack", "atk", "hit", "strike", "攻击"],
  hurt: ["hurt", "damage", "pain", "受击", "受伤"],
  dead: ["dead", "death", "die", "grave", "阵亡", "死亡"],
  icon: ["icon", "avatar", "head", "头像"],
  skill: ["skill", "ult", "special", "cast", "技能", "特效"]
};

function listFiles(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return []; }
}

function extOf(name) { return path.extname(name).toLowerCase(); }

/* 在角色目录里找某个槽位的文件（支持别名，忽略大小写）
 * 返回文件名数组：
 *   - 找到 1 个  → ["idle.png"]
 *   - 找到多个  → ["idle_01.png", "idle_02.png", ...]  当作序列帧动画
 * 序列帧由游戏循环驱动，比 GIF 更可控（能配合攻击/受击动作同步播放）。 */
function findSlot(files, slot) {
  const names = ALIASES[slot] || [slot];

  // 1) 完全同名优先（idle.png）—— 单个文件，不算序列帧
  for (const n of names) {
    const exact = files.find(f => f.isFile() &&
      path.basename(f.name, path.extname(f.name)).toLowerCase() === n &&
      IMG_EXT.includes(extOf(f.name)));
    if (exact) return [exact.name];
  }

  // 2) 前缀匹配（idle_01.png / idle-2.gif）→ 按文件名排序组成序列帧
  for (const n of names) {
    const pref = files.filter(f => f.isFile() && IMG_EXT.includes(extOf(f.name)) &&
      path.basename(f.name, path.extname(f.name)).toLowerCase().startsWith(n));
    if (pref.length) {
      pref.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return pref.map(f => f.name);
    }
  }
  return [];
}

function findSfx(charDir, slot) {
  for (const sub of ["sfx", "audio", "sound", "sounds"]) {
    const dir = path.join(charDir, sub);
    const files = listFiles(dir);
    if (!files.length) continue;
    const cand = files.filter(f => f.isFile() && AUD_EXT.includes(extOf(f.name)) &&
      path.basename(f.name, path.extname(f.name)).toLowerCase().startsWith(slot));
    if (cand.length) {
      cand.sort((a, b) => a.name.localeCompare(b.name));
      return sub + "/" + cand[0].name;
    }
  }
  return null;
}

function main() {
  if (!fs.existsSync(CHAR_DIR)) {
    console.error("找不到目录: " + CHAR_DIR);
    process.exit(1);
  }

  const dirs = listFiles(CHAR_DIR).filter(d => d.isDirectory());
  const manifest = {};
  let totalArt = 0, totalSfx = 0;

  console.log("扫描目录: " + CHAR_DIR);
  console.log("发现 " + dirs.length + " 个角色文件夹\n");

  for (const d of dirs) {
    const id = d.name;
    const charDir = path.join(CHAR_DIR, id);
    const files = listFiles(charDir);
    const entry = {};
    const found = [];

    for (const slot of SLOTS) {
      const list = findSlot(files, slot);
      if (!list.length) continue;
      if (list.length === 1) {
        entry[slot] = list[0];                 // 单张图
        found.push(slot + "=" + list[0]);
      } else {
        entry[slot] = list;                    // 序列帧动画
        found.push(slot + "=" + list.length + "帧序列");
      }
      totalArt += list.length;
    }

    const sfx = {};
    for (const s of SFX_SLOTS) {
      const f = findSfx(charDir, s);
      if (f) { sfx[s] = f; found.push("sfx." + s + "=" + f); totalSfx++; }
    }
    if (Object.keys(sfx).length) entry.sfx = sfx;

    // 没识别到的文件提醒一下，避免“放进去了却没生效”
    const used = new Set();
    for (const k of SLOTS) {
      const v = entry[k];
      if (!v) continue;
      if (Array.isArray(v)) v.forEach(f => used.add(f));
      else used.add(v);
    }
    for (const k in sfx) used.add(path.basename(sfx[k]));
    const unused = files.filter(f => f.isFile() && !used.has(f.name) && IMG_EXT.includes(extOf(f.name)));
    if (unused.length) {
      console.warn("  ? " + id + " 有未识别的图片: " + unused.map(f => f.name).join(", ") +
        "（命名请参考 idle/attack/hurt/dead/icon/skill）");
    }

    if (found.length) {
      manifest[id] = entry;
      console.log("  ✓ " + id.padEnd(12) + " " + found.join("  "));
    } else {
      console.log("  · " + id.padEnd(12) + " （空文件夹，将使用几何图形）");
    }
  }

  const out =
    "/* 本文件由 tools/scan-assets.js 自动生成，请勿手动编辑。\n" +
    " * 重新生成：node tools/scan-assets.js\n" +
    " * 生成时间：" + new Date().toLocaleString("zh-CN") + "\n" +
    " */\n" +
    "window.MA = window.MA || {};\n" +
    "window.MA.ASSET_MANIFEST = " + JSON.stringify(manifest, null, 2) + ";\n";

  fs.writeFileSync(OUT_FILE, out, "utf8");

  console.log("\n共登记 " + Object.keys(manifest).length + " 个角色，" +
    totalArt + " 张图片，" + totalSfx + " 个音效");
  console.log("已写入: " + path.relative(ROOT, OUT_FILE));
  console.log("\n提示：文件命名约定见 assets/characters/README.md");
}

main();
