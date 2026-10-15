/* 给 characters.js 里的每个角色补上 contact（接触伤害）字段。
 * 按角色特性区分：坦克/软萌系碰撞不痛，锋锐/爆炸系碰撞痛。
 * 只补缺失的字段，重复运行安全。 */
"use strict";
const fs = require("fs");
const path = require("path");

const FILE = path.resolve(__dirname, "..", "data", "characters.js");

/* id -> { damage, knock, type } */
const CONTACT = {
  // 高伤害：锋锐 / 爆炸 / 冲刺型
  chuanjian: { damage: 16, type: "blade", desc: "剑刃剐蹭" },
  jingyu:    { damage: 15, type: "blade", desc: "撕咬" },
  creeper:   { damage: 18, type: "blast", desc: "爆炸余波" },
  yyds:      { damage: 14, type: "blade", desc: "神光灼烧" },
  zhamao:    { damage: 14, type: "spark", desc: "静电炸毛" },
  kunkun:    { damage: 13, type: "impact", desc: "篮球撞击" },
  fanren:    { damage: 13, type: "blade", desc: "飞剑割裂" },
  aowu:      { damage: 12, type: "bite", desc: "啃咬" },
  tiangou:   { damage: 12, type: "impact", desc: "舔狗冲撞" },
  saibo2:    { damage: 11, type: "spark", desc: "颜料溅射" },

  // 中伤害：普通接触
  hajimi:    { damage: 9,  type: "impact", desc: "猫猫撞击" },
  fanqie:    { damage: 9,  type: "spark", desc: "时间涟漪" },
  fomo:      { damage: 9,  type: "impact", desc: "梭哈撞击" },
  moyu:      { damage: 8,  type: "impact", desc: "摸鱼蹭一下" },

  // 低伤害 / 无伤害：软萌、辅助、坦克
  zaowu:     { damage: 7,  type: "impact", desc: "咖啡洒了" },
  dabing:    { damage: 6,  type: "none",   desc: "精神状态稳定，不痛" },
  suannai:   { damage: 5,  type: "none",   desc: "酸奶很稠，缓冲" },
  saibo:     { damage: 4,  type: "none",   desc: "护盾吸收冲击" },
  busi:      { damage: 4,  type: "none",   desc: "小强很硬但不扎人" },
  kelong:    { damage: 6,  type: "impact", desc: "分身擦碰" }
};

let src = fs.readFileSync(FILE, "utf8");
let added = 0, already = 0;

for (const [id, cfg] of Object.entries(CONTACT)) {
  // 找到该角色的定义块起始位置
  const idRe = new RegExp(`(id:\\s*"${id}"[\\s\\S]*?)(\\n\\s*\\},)`, "m");
  const m = src.match(idRe);
  if (!m) { console.warn("  ! 找不到角色: " + id); continue; }
  if (/contact\s*:/.test(m[1])) { already++; continue; }

  const block = m[1];
  // 在 skillDesc 之后插入 contact，保持字段顺序易读
  const descRe = /(\n(\s*)skillDesc:\s*"[^"]*",)/;
  let inserted;
  if (descRe.test(block)) {
    inserted = block.replace(descRe, (full, line, indent) =>
      line + "\n" + indent + "contact: { damage: " + cfg.damage +
      ", type: \"" + cfg.type + "\", desc: \"" + cfg.desc + "\" },");
  } else {
    // 兜底：插在 skill 字段之前
    inserted = block.replace(/(\n(\s*)skill:)/, (full, line, indent) =>
      "\n" + indent + "contact: { damage: " + cfg.damage +
      ", type: \"" + cfg.type + "\", desc: \"" + cfg.desc + "\" }," + line);
  }
  src = src.replace(block, inserted);
  added++;
}

fs.writeFileSync(FILE, src, "utf8");
console.log("已补充 contact 字段: " + added + " 个角色（已有 " + already + " 个）");
