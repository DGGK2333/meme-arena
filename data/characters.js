/* =========================================================================
 * data/characters.js —— 【角色数据 · 手动修改入口】
 * -------------------------------------------------------------------------
 * 想加角色 / 改数值 / 换名字，只改这个文件就够了，改完刷新页面即可。
 *
 * 每个角色的素材放在：assets/characters/<id>/
 *   ├─ idle.png                          待机单张图（可选，支持 png/webp/jpg/svg）
 *   ├─ idle_01.png idle_02.png …         待机序列帧动画（推荐，由游戏循环驱动）
 *   ├─ idle.gif                          待机动图（可选，浏览器原生播放）
 *   ├─ attack.png / attack_01.png …      攻击瞬间贴图（可选）
 *   ├─ hurt.png / hurt_01.png …          受击贴图（可选）
 *   ├─ dead.png                          阵亡贴图（可选）
 *   ├─ icon.png                          头像（可选，用于选择器）
 *   ├─ skill.png / skill.gif             技能特效贴图（可选）
 *   └─ sfx/  hurt.wav  attack.wav  skill.wav  death.wav   （可选音效）
 * 素材全部可选：没有就用代码画的几何图形，有就自动替换，无需改代码。
 * 放完素材记得跑一次：node tools/scan-assets.js
 * 也可以直接写全路径覆盖约定，见下面 assets 字段说明。
 *
 * -------------------------------------------------------------------------
 * 字段速查（★ = 必填）
 *   ★ id        唯一英文标识，同时是素材文件夹名，只能用字母数字下划线
 *   ★ name      显示名（角色头顶/战报/冠军横幅）
 *   ★ icon      没贴图时头顶显示的 emoji
 *   ★ color     主题色 #rrggbb，用于描边、血条、特效
 *   ★ shape     无贴图时的几何外形：round | square | tri | cat
 *   ★ hp/atk/def/spd/radius   生命 / 攻击 / 防御 / 速度 / 体积半径
 *   ★ skillName 技能名
 *   ★ cooldown  技能冷却秒数
 *   ★ skill(u, w)  技能实现，见下方“技能 API”
 *   ★ skillDesc 技能说明（鼠标悬停选择器时显示）
 *     skillRange 技能手感距离：离目标多近才愿意放技能（默认 230，999=随时放）
 *     contact    接触伤害（碰撞模式核心）：
 *                  { damage: 12, type: "impact", desc: "撞击" }
 *                  · damage  冲击速度达标时的伤害基准，实际按冲击速度缩放
 *                  · type    展示用类型：impact/blade/blast/spark/bite/none
 *                  · none 或 damage=0 表示「碰到别人不掉血」（软萌/坦克系）
 *     onHit(u, t, w)   普攻命中后的追加效果（可选，比如冲刺暴击）
 *     onDeath(u, w)    死亡时触发；返回 true 可以阻止这次死亡（可选，比如复活）
 *     assets     素材覆盖，见下方“素材配置”
 *
 * -------------------------------------------------------------------------
 * 技能 API（u = 自己，w = 世界）
 *   u.x / u.y            坐标；u.vx / u.vy 速度；u.dir 朝向弧度
 *   u.hp / u.stats.hp    当前血量 / 最大血量
 *   u.stats.atk/def/spd  攻/防/速
 *   u.shield             护盾值（优先吸收伤害）
 *   u.rage               狂暴剩余秒数（移速+攻速提升）
 *   u.invuln             无敌帧秒数
 *   u.stun / u.freeze    眩晕 / 冻结秒数（冻结更彻底）
 *   u.slow               减速剩余秒数
 *   u.target             当前目标（可能为 null，用前判空！）
 *
 *   w.units              全场单位数组（含分身，注意判 o.alive）
 *   w.unitsNear(x,y,r)   取半径 r 内的存活单位
 *   w.damage(u, t, 伤害, {kx:击退, ky:击退, ang:角度, crit:是否暴击})
 *   w.heal(u, 数值)      回血（后期有衰减）
 *   w.kill(u, 凶手)      直接击杀
 *   w.popText(x,y,文字,颜色)      飘字
 *   w.puff(x,y,数量,颜色)         粒子
 *   w.explosion(x,y,半径,颜色)    爆炸圈
 *   w.ring(x,y,半径,颜色)         扩散光环
 *   w.beam(x1,y1,x2,y2,颜色,粗细) 光束
 *   w.shake(强度)                 震屏
 *   w.projectiles.push({...})     发射投射物，字段：
 *       x,y,vx,vy,r,dmg,life,owner,color,spin(旋转速度),
 *       bounce     剩余反弹次数；Infinity = 撞墙一直弹直到命中（不写 = 出界消失）
 *       bounceDamp 每次反弹的速度倍率，默认 1（完全弹性，不损失速度）
 *       img        贴图（动图会自己播放）；drawSize 控制显示大小
 *       onBounce(proj, w) 反弹时回调（可选）
 *       onHit(proj, w)    命中或到期时回调（可选）
 *     自伤保护：投射物永远不命中 owner 自己，也不命中 owner 召唤的单位。
 *
 * -------------------------------------------------------------------------
 * 素材配置 assets（全部可省略）
 *   assets: {
 *     idle:   "idle_01.png",     // 单张；也可以写数组表示序列帧：
 *                                // idle: ["idle_01.png", "idle_02.png"]
 *     attack: "attack.png",
 *     hurt:   "hurt.gif",
 *     dead:   "dead.png",
 *     icon:   "icon.png",
 *     skill:  "skill.gif",       // 技能特效贴图
 *     sfx: { attack: "sfx/attack.wav", skill: "sfx/skill.wav" },
 *     // 需要指向别处时写绝对/相对路径：
 *     // idle: "@assets/characters/common/blob.png"   (@ 开头表示相对本项目根目录)
 *   }
 * ========================================================================= */

window.MA = window.MA || {};

/* -------------------------------------------------------------------------
 * 复制下面这段就能加一个新角色（记得同步建 assets/characters/<id>/ 文件夹）
 * -------------------------------------------------------------------------
  {
    id: "newone", name: "新角色", icon: "✨", color: "#ff88cc", shape: "round",
    hp: 110, atk: 14, def: 5, spd: 58, radius: 20,
    skillName: "新技能", cooldown: 5, skillRange: 240,
    skillDesc: "技能说明写这里。",
    skill: function (u, w) {
      var t = u.target;
      if (!t || !t.alive) return;
      w.damage(u, t, 20 * w.dmgMul, { kx: 200, ky: 200 });
      w.popText(u.x, u.y - 34, "新技能！", "#ff88cc");
    }
  },
 * ------------------------------------------------------------------------- */

/* =========================================================================
 * 模板一：投掷型角色（撞墙反弹，砸到人为止）
 * -------------------------------------------------------------------------
 * "撞击 + 扔东西"这一类角色用这个工厂函数生成，不用每次抄一遍 skill。
 * 关键是**把所有可调参数放在 tpl.throw 这个数据对象上**，而不是写死在
 * 闭包里 —— 这样网页里的「角色调参」面板才能实时改它们。
 *
 * 用法（三个参数之外都能省略，会走默认值）：
 *   makeThrower({
 *     id: "ikun", name: "爱坤", icon: "🏀", color: "#ffd166",
 *     hp: 112, atk: 14, def: 5, spd: 60, radius: 20,
 *     skillName: "鸡你太美", cooldown: 4.2,
 *     skillDesc: "……",
 *     contact: { damage: 9, type: "impact", desc: "唱跳 rap" },
 *     throw: {                        // ← 投掷物参数，面板里可调
 *       dmg: 24,        // 命中伤害
 *       speed: 560,     // 出手速度（像素/秒）
 *       size: 46,       // 显示大小（贴图边长）
 *       radius: 18,     // 碰撞半径
 *       bounce: -1,     // 撞墙反弹次数；-1 = 一直弹（内部转成 Infinity）
 *       bounceDamp: 1,  // 每次反弹速度倍率
 *       life: 9,        // 存活秒数（兜底）
 *       spin: 5,        // 自转速度
 *       spread: 1       // 一次扔几个（>1 会扇形散开）
 *     }
 *   })
 * ========================================================================= */
function makeThrower(cfg) {
  var t = Object.assign({
    shape: "round", skillRange: 999,
    contact: { damage: 8, type: "impact", desc: "撞一下" }
  }, cfg);
  t.throw = Object.assign({
    dmg: 24, speed: 560, size: 46, radius: 18,
    bounce: -1, bounceDamp: 1, life: 9, spin: 5, spread: 1,
    aim: 1,      // 1 = 朝敌人扔（默认）；0 = 沿自己运动方向扔
    lead: 1      // 预判提前量：按目标速度提前瞄准（0 = 瞄当前位置）
  }, cfg.throw || {});

  t.skill = function (u, w) {
    var c = u.tpl["throw"] || {};
    var A = window.MA.Assets;
    var img = A && A.image(u.tpl.id, "skill");
    var sp = c.speed != null ? c.speed : 560;

    /* 出膛方向：
     *   默认瞄准当前锁定的敌人，并按它的速度做提前量预判
     *   （不预判的话，球总是打在敌人"刚才"的位置，移动目标基本打不中）。
     *   没有目标、或 aim=0 时，退回"沿自己运动方向扔"。 */
    var base = null;
    var tg = u.target;
    if (c.aim !== 0 && tg && tg.alive) {
      var lead = c.lead != null ? c.lead : 1;
      var dx = tg.x - u.x, dy = tg.y - u.y;
      var dist = Math.hypot(dx, dy) || 1;
      var flight = (dist / Math.max(1, sp)) * lead;   // 预计飞行时间
      base = Math.atan2(dy + (tg.vy || 0) * flight,
                        dx + (tg.vx || 0) * flight);
    }
    if (base === null) {
      base = (Math.abs(u.vx) + Math.abs(u.vy) > 4)
        ? Math.atan2(u.vy, u.vx) : u.dir;             // 兜底：运动方向 / 朝向
    }

    var n = Math.max(1, Math.round(c.spread || 0) || 1);
    for (var i = 0; i < n; i++) {
      // spread 个投掷物在 ±0.25rad 内扇形散开
      var ang = base + (n > 1 ? (i / (n - 1) - 0.5) * 0.5 : 0);
      var rad = c.radius != null ? c.radius : 18;
      w.projectiles.push({
        x: u.x + Math.cos(ang) * (u.r + rad * 0.6),
        y: u.y + Math.sin(ang) * (u.r + rad * 0.6),
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        r: rad,
        dmg: (c.dmg != null ? c.dmg : 24) * w.dmgMul,
        life: c.life != null ? c.life : 9,
        owner: u, color: u.color, spin: c.spin != null ? c.spin : 5,
        // -1 / Infinity 都表示"一直弹"
        bounce: (c.bounce === -1 || c.bounce === Infinity) ? Infinity
              : (c.bounce || 0),
        bounceDamp: c.bounceDamp != null ? c.bounceDamp : 1,
        img: img,
        drawSize: c.size != null ? c.size : rad * 2.6,
        onHit: function (p, w2) {
          w2.explosion(p.x, p.y, p.r * 2.2, u.color);
          w2.shake(4);
        }
      });
    }
    w.ring(u.x, u.y, u.r + 16, u.color);
    w.popText(u.x, u.y - 34, u.tpl.skillName, u.color);
  };
  return t;
}

/* 暴露出去，方便在控制台里现造一个投掷型角色试试：
 *   MA.CHARACTERS.push(MA.makeThrower({ id:"test", name:"测试", ... }))
 * 也可以从别的数据文件复用这个模板。 */
window.MA.makeThrower = makeThrower;

window.MA.CHARACTERS = [

  /* ===================== 1. 摸鱼打工人 ===================== */
  {
    id: "moyu", name: "摸鱼打工人", icon: "🐟", color: "#5aa9ff", shape: "round",
    hp: 118, atk: 13, def: 6, spd: 46, radius: 21,
    skillName: "带薪摸鱼", cooldown: 5.4, skillRange: 999,
    skillDesc: "原地摸鱼回血，同时短暂免疫伤害，摸得越久越香。",
    contact: { damage: 8, type: "impact", desc: "摸鱼蹭一下" },
    skill: function (u, w) {
      w.heal(u, 15 + u.stats.hp * 0.03);
      u.invuln = Math.max(u.invuln, 0.65);
      w.ring(u.x, u.y, u.r, "#5aa9ff");
      w.popText(u.x, u.y - 34, "带薪摸鱼 +血", "#7fd0ff");
      w.puff(u.x, u.y, 10, "#8fd0ff");
    }
  },

  /* ===================== 2. 打篮球的坤坤 ===================== */
  {
    id: "kunkun", name: "打篮球的坤坤", icon: "🏀", color: "#ffb03a", shape: "round",
    hp: 118, atk: 14, def: 5, spd: 54, radius: 21,
    skillName: "篮球冲击", cooldown: 4.8, skillRange: 330,
    skillDesc: "带球过人高速突进，撞到谁就给谁一记上篮暴击。",
    contact: { damage: 13, type: "impact", desc: "篮球撞击" },
    skill: function (u, w) {
      var t = u.target;
      var ang = u.dir;
      if (t && t.alive) ang = Math.atan2(t.y - u.y, t.x - u.x);
      u.vx = Math.cos(ang) * 640;
      u.vy = Math.sin(ang) * 640;
      u.dashHit = true;
      u.invuln = Math.max(u.invuln, 0.18);
      w.ring(u.x, u.y, u.r + 6, "#ffd25e");
      w.popText(u.x, u.y - 34, "你干嘛~ 哎哟！", "#ffd25e");
    },
    onHit: function (u, t, w) {
      if (!u.dashHit) return;
      u.dashHit = false;
      w.damage(u, t, 22 * w.dmgMul, { crit: true, kx: 300, ky: 300 });
      w.popText(t.x, t.y - 30, "暴击！", "#ff7a7a");
      w.shake(5);
    }
  },

  /* ===================== 3. 哈基米 ===================== */
  {
    id: "hajimi", name: "哈基米", icon: "🐱", color: "#ff7ab6", shape: "cat",
    hp: 96, atk: 12, def: 4, spd: 76, radius: 18,
    skillName: "旋风哈气", cooldown: 4.4, skillRange: 155,
    skillDesc: "高速旋转的猫猫，把周围所有人推开并挠一下。",
    contact: { damage: 9, type: "impact", desc: "猫猫撞击" },
    skill: function (u, w) {
      var list = w.unitsNear(u.x, u.y, 128);
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o === u || !o.alive) continue;
        var a = Math.atan2(o.y - u.y, o.x - u.x);
        w.damage(u, o, 11 * w.dmgMul, { kx: 420, ky: 420, ang: a });
        o.stun = Math.max(o.stun, 0.35);
      }
      w.ring(u.x, u.y, 128, "#ff9ad0");
      w.ring(u.x, u.y, 92, "#ffd0ea");
      w.popText(u.x, u.y - 34, "哈气！！", "#ff9ad0");
      w.shake(4);
    }
  },

  /* ===================== 4. 炸毛小猫 ===================== */
  {
    id: "zhamao", name: "炸毛小猫", icon: "😾", color: "#a78bfa", shape: "cat",
    hp: 108, atk: 15, def: 4, spd: 66, radius: 19,
    skillName: "炸毛闪电", cooldown: 5.2, skillRange: 520,
    skillDesc: "炸毛后对最近的敌人释放一道闪电，造成高额伤害。",
    contact: { damage: 14, type: "spark", desc: "静电炸毛" },
    skill: function (u, w) {
      var best = null, bd = Infinity;
      for (var i = 0; i < w.units.length; i++) {
        var o = w.units[i];
        if (!o.alive || o === u) continue;
        var d = (o.x - u.x) * (o.x - u.x) + (o.y - u.y) * (o.y - u.y);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) return;
      w.damage(u, best, 26 * w.dmgMul, { kx: 120, ky: 120 });
      w.beam(u.x, u.y, best.x, best.y, "#c4b5fd", 6);
      w.ring(best.x, best.y, best.r + 16, "#c4b5fd");
      w.popText(u.x, u.y - 34, "炸毛！⚡", "#c4b5fd");
      w.shake(4);
    }
  },

  /* ===================== 5. 纯爱战士 ===================== */
  {
    id: "chuanjian", name: "纯爱战士", icon: "⚔️", color: "#ff6b6b", shape: "tri",
    hp: 122, atk: 17, def: 4, spd: 58, radius: 20,
    skillName: "纯爱冲锋", cooldown: 5, skillRange: 380,
    skillDesc: "为了纯爱！向目标发起冲锋，命中造成巨额伤害并击退。",
    contact: { damage: 16, type: "blade", desc: "剑刃剐蹭" },
    skill: function (u, w) {
      var t = u.target;
      var ang = u.dir;
      if (t && t.alive) ang = Math.atan2(t.y - u.y, t.x - u.x);
      u.vx = Math.cos(ang) * 560;
      u.vy = Math.sin(ang) * 560;
      u.dashHit = true;
      w.ring(u.x, u.y, u.r + 6, "#ff8a8a");
      w.popText(u.x, u.y - 34, "为纯爱冲锋！", "#ff8a8a");
    },
    onHit: function (u, t, w) {
      if (!u.dashHit) return;
      u.dashHit = false;
      w.damage(u, t, 30 * w.dmgMul, { kx: 360, ky: 360 });
      t.stun = Math.max(t.stun, 0.5);
      t.bleed = Math.max(t.bleed || 0, 2.2);
      w.popText(t.x, t.y - 30, "破防", "#ff6b6b");
      w.shake(6);
    }
  },

  /* ===================== 6. 精神状态良好 ===================== */
  {
    id: "dabing", name: "精神状态良好", icon: "🧠", color: "#9be15d", shape: "square",
    hp: 132, atk: 12, def: 7, spd: 50, radius: 21,
    skillName: "精神攻击", cooldown: 5.6, skillRange: 999,
    skillDesc: "释放精神污染，让全场敌人眩晕减速，并回复自身。",
    contact: { damage: 6, type: "none", desc: "精神状态稳定，不痛" },
    skill: function (u, w) {
      var n = 0;
      for (var i = 0; i < w.units.length; i++) {
        var o = w.units[i];
        if (!o.alive || o === u) continue;
        o.stun = Math.max(o.stun, 0.85);
        o.slow = Math.max(o.slow, 1.8);
        w.damage(u, o, 10 * w.dmgMul, { kx: 40, ky: 40 });
        n++;
      }
      w.heal(u, Math.min(3.4 * n, 22));
      w.ring(u.x, u.y, 460, "#b6f36a");
      w.popText(u.x, u.y - 34, "我精神状态良好", "#b6f36a");
      w.shake(3);
    }
  },

  /* ===================== 7. 苦力怕 ===================== */
  {
    id: "creeper", name: "苦力怕", icon: "💥", color: "#5ee07a", shape: "square",
    hp: 104, atk: 14, def: 3, spd: 60, radius: 20,
    skillName: "贴脸自爆", cooldown: 5.6, skillRange: 999,
    skillDesc: "闪现到最近敌人身边引爆自己，大范围伤害（自身毫发无伤）。",
    contact: { damage: 18, type: "blast", desc: "爆炸余波" },
    skill: function (u, w) {
      var best = null, bd = Infinity;
      for (var i = 0; i < w.units.length; i++) {
        var o = w.units[i];
        if (!o.alive || o === u) continue;
        var d = (o.x - u.x) * (o.x - u.x) + (o.y - u.y) * (o.y - u.y);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) return;
      var ang = Math.atan2(u.y - best.y, u.x - best.x);
      u.x = clamp(best.x + Math.cos(ang) * (best.r + u.r + 2), u.r, w.arena - u.r);
      u.y = clamp(best.y + Math.sin(ang) * (best.r + u.r + 2), u.r, w.arena - u.r);
      w.explosion(u.x, u.y, 130, "#7dff9a");
      var list = w.unitsNear(u.x, u.y, 130);
      for (var j = 0; j < list.length; j++) {
        if (list[j] === u) continue;
        w.damage(u, list[j], 26 * w.dmgMul, { kx: 380, ky: 380 });
      }
      w.popText(u.x, u.y - 40, "嘶—— boom！", "#7dff9a");
      w.shake(11);
    }
  },

  /* ===================== 8. 番茄钟 ===================== */
  {
    id: "fanqie", name: "番茄钟", icon: "🍅", color: "#ff4d4d", shape: "round",
    hp: 100, atk: 13, def: 5, spd: 52, radius: 20,
    skillName: "时间静止", cooldown: 6.5, skillRange: 999,
    skillDesc: "让全场时间静止 1.6 秒，只有你能动，然后一顿输出。",
    contact: { damage: 9, type: "spark", desc: "时间涟漪" },
    skill: function (u, w) {
      for (var i = 0; i < w.units.length; i++) {
        var o = w.units[i];
        if (o.alive && o !== u) o.freeze = Math.max(o.freeze, 1.6);
      }
      u.rage = 2.6;        // 攻速/移速提升
      u.rageBonus = 1.35;  // 静止期间攻击力加成
      w.ring(u.x, u.y, 470, "#ff9c6b");
      w.popText(u.x, u.y - 34, "时间静止！", "#ff9c6b");
      w.shake(4);
    }
  },

  /* ===================== 9. FOMO之王 ===================== */
  {
    id: "fomo", name: "FOMO之王", icon: "📉", color: "#ffd166", shape: "square",
    hp: 108, atk: 14, def: 5, spd: 56, radius: 20,
    skillName: "全仓梭哈", cooldown: 5.4, skillRange: 999,
    skillDesc: "血量越低攻击越猛，梭哈瞬间提速，风险越大收益越大。",
    contact: { damage: 9, type: "impact", desc: "梭哈撞击" },
    skill: function (u, w) {
      var lowHp = 1 - u.hp / u.stats.hp;   // 越残血加成越高
      u.rage = 2.8 + lowHp * 1.6;
      u.stats.atk *= 1 + 0.10 + lowHp * 0.16;
      w.heal(u, 6 + lowHp * 12);
      w.ring(u.x, u.y, u.r + 20, "#ffd166");
      w.popText(u.x, u.y - 34, "全仓梭哈！×" + (1 + lowHp).toFixed(1), "#ffd166");
    }
  },

  /* ===================== 10. YYDS战神 ===================== */
  {
    id: "yyds", name: "YYDS战神", icon: "🏆", color: "#6ee7ff", shape: "tri",
    hp: 116, atk: 16, def: 5, spd: 60, radius: 20,
    skillName: "封神一击", cooldown: 5.8, skillRange: 640,
    skillDesc: "蓄力打出一道贯穿光柱，命中路径上的所有敌人。",
    contact: { damage: 14, type: "blade", desc: "神光灼烧" },
    skill: function (u, w) {
      var t = u.target;
      var ang = (t && t.alive) ? Math.atan2(t.y - u.y, t.x - u.x) : u.dir;
      var dx = Math.cos(ang), dy = Math.sin(ang);
      for (var i = 0; i < w.units.length; i++) {
        var o = w.units[i];
        if (!o.alive || o === u) continue;
        var rx = o.x - u.x, ry = o.y - u.y;
        var along = rx * dx + ry * dy;
        if (along < 0 || along > 560) continue;
        var perp = Math.abs(rx * -dy + ry * dx);
        if (perp > o.r + 24) continue;
        w.damage(u, o, 23 * w.dmgMul, { kx: 220, ky: 220 });
      }
      w.beam(u.x, u.y, u.x + dx * 620, u.y + dy * 620, "#8ff0ff", 20);
      w.popText(u.x, u.y - 34, "永远的神！", "#8ff0ff");
      w.shake(6);
    }
  },

  /* ===================== 11. 啊呜怪 ===================== */
  {
    id: "aowu", name: "啊呜怪", icon: "🦖", color: "#c084fc", shape: "round",
    hp: 108, atk: 15, def: 4, spd: 64, radius: 20,
    skillName: "啊呜一口", cooldown: 4.2, skillRange: 155,
    skillDesc: "咬住最近的敌人啃一口，并把偷到的生命值还给自己。",
    contact: { damage: 12, type: "bite", desc: "啃咬" },
    skill: function (u, w) {
      var best = null, bd = Infinity;
      for (var i = 0; i < w.units.length; i++) {
        var o = w.units[i];
        if (!o.alive || o === u) continue;
        var d = (o.x - u.x) * (o.x - u.x) + (o.y - u.y) * (o.y - u.y);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) return;
      var dmg = 15 * w.dmgMul;
      w.damage(u, best, dmg, { kx: 140, ky: 140 });
      w.heal(u, dmg * 0.75);
      w.beam(u.x, u.y, best.x, best.y, "#e0b6ff", 9);
      w.popText(u.x, u.y - 34, "啊呜~ 吸到血了", "#e0b6ff");
    }
  },

  /* ===================== 12. 凡人修仙 ===================== */
  {
    id: "fanren", name: "凡人修仙", icon: "🌀", color: "#ff8a3d", shape: "tri",
    hp: 112, atk: 15, def: 5, spd: 62, radius: 20,
    skillName: "御剑术", cooldown: 4.6, skillRange: 330,
    skillDesc: "甩出 7 把飞剑绕身旋转，沿途切割一切敌人。",
    contact: { damage: 13, type: "blade", desc: "飞剑割裂" },
    skill: function (u, w) {
      for (var i = 0; i < 7; i++) {
        var ang = u.dir + i * TAU / 7;
        w.projectiles.push({
          x: u.x + Math.cos(ang) * 26, y: u.y + Math.sin(ang) * 26,
          vx: Math.cos(ang) * 360, vy: Math.sin(ang) * 360,
          r: 8, dmg: 10 * w.dmgMul, life: 0.85, owner: u, color: "#ffb066", spin: 14
        });
      }
      w.ring(u.x, u.y, u.r + 14, "#ffb066");
      w.popText(u.x, u.y - 34, "万剑归宗！", "#ffb066");
    }
  },

  /* ===================== 13. 早八人 ===================== */
  {
    id: "zaowu", name: "早八人", icon: "☕", color: "#4be07a", shape: "square",
    hp: 108, atk: 13, def: 6, spd: 58, radius: 20,
    skillName: "续命咖啡", cooldown: 5.6, skillRange: 999,
    skillDesc: "猛灌咖啡，回血并进入狂暴：移动与攻击速度大幅提升。",
    contact: { damage: 7, type: "impact", desc: "咖啡洒了" },
    skill: function (u, w) {
      w.heal(u, 14 + u.stats.hp * 0.03);
      u.rage = 2.8;
      w.ring(u.x, u.y, u.r + 16, "#7dffb0");
      w.popText(u.x, u.y - 34, "续命成功 ☕", "#7dffb0");
      w.puff(u.x, u.y, 8, "#a7ffcf");
    }
  },

  /* ===================== 14. 赛博佛系 ===================== */
  {
    id: "saibo", name: "赛博佛系", icon: "🧘", color: "#8b9dff", shape: "round",
    hp: 120, atk: 12, def: 7, spd: 50, radius: 21,
    skillName: "电子护盾", cooldown: 5.5, skillRange: 999,
    skillDesc: "展开电子护盾吸收伤害，并反弹一部分给攻击者。",
    contact: { damage: 4, type: "none", desc: "护盾吸收冲击" },
    skill: function (u, w) {
      u.shield = Math.max(u.shield, 24);
      u.shieldTime = 3.5;
      u.thorns = 0.32;
      w.ring(u.x, u.y, u.r + 18, "#aab8ff");
      w.popText(u.x, u.y - 34, "电子护盾", "#aab8ff");
    }
  },

  /* ===================== 15. 老酸奶 ===================== */
  {
    id: "suannai", name: "老酸奶", icon: "🥛", color: "#f5f0e1", shape: "round",
    hp: 130, atk: 11, def: 7, spd: 46, radius: 22,
    skillName: "浓稠粘液", cooldown: 4.6, skillRange: 230,
    skillDesc: "泼出一地酸奶，范围内敌人被严重减速并持续掉血。",
    contact: { damage: 5, type: "none", desc: "酸奶很稠，缓冲" },
    skill: function (u, w) {
      w.fx.pools.push({
        x: u.x, y: u.y, r: 96, life: 4.2, maxLife: 4.2,
        owner: u, dps: 7 * w.dmgMul, color: "#f5f0e1"
      });
      w.popText(u.x, u.y - 34, "泼你一身酸奶", "#f7f3e6");
    }
  },

  /* ===================== 16. 精神状态鲨 ===================== */
  {
    id: "jingyu", name: "精神状态鲨", icon: "🦈", color: "#3fb6ff", shape: "tri",
    hp: 106, atk: 16, def: 4, spd: 70, radius: 19,
    skillName: "鲨鱼突袭", cooldown: 4.4, skillRange: 360,
    skillDesc: "水下潜行瞬间突进，从背后咬住目标并造成撕裂伤害。",
    contact: { damage: 15, type: "blade", desc: "撕咬" },
    skill: function (u, w) {
      var t = u.target;
      var ang = u.dir;
      if (t && t.alive) ang = Math.atan2(t.y - u.y, t.x - u.x);
      u.vx = Math.cos(ang) * 700;
      u.vy = Math.sin(ang) * 700;
      u.dashHit = true;
      u.invuln = Math.max(u.invuln, 0.22);
      w.ring(u.x, u.y, u.r + 8, "#6ecbff");
      w.popText(u.x, u.y - 34, "鲨鱼出没！", "#6ecbff");
    },
    onHit: function (u, t, w) {
      if (!u.dashHit) return;
      u.dashHit = false;
      w.damage(u, t, 20 * w.dmgMul, { kx: 340, ky: 340 });
      t.bleed = Math.max(t.bleed || 0, 2.4);
      w.popText(t.x, t.y - 30, "撕裂", "#3fb6ff");
      w.shake(5);
    }
  },

  /* ===================== 17. 不死小强 ===================== */
  {
    id: "busi", name: "不死小强", icon: "🐜", color: "#a3e635", shape: "square",
    hp: 112, atk: 12, def: 6, spd: 54, radius: 19,
    skillName: "原地复活", cooldown: 9.5, skillRange: 999,
    skillDesc: "被打死时原地复活一次（三成血），并击退周围所有人。",
    contact: { damage: 4, type: "none", desc: "小强很硬但不扎人" },
    skill: function (u, w) {
      w.heal(u, 18);
      u.invuln = Math.max(u.invuln, 1.2);
      w.ring(u.x, u.y, 120, "#c9ff6b");
      var list = w.unitsNear(u.x, u.y, 120);
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o === u) continue;
        var a = Math.atan2(o.y - u.y, o.x - u.x);
        w.damage(u, o, 9 * w.dmgMul, { kx: 380, ky: 380, ang: a });
      }
      w.popText(u.x, u.y - 34, "我还能再战！", "#c9ff6b");
    },
    onDeath: function (u, w) {
      if (u.revived) return false;   // 只复活一次
      u.revived = true;
      u.alive = true;
      u.hp = u.stats.hp * 0.34;
      u.invuln = 1.6;
      u.shield = 0;
      w.ring(u.x, u.y, 150, "#d9ff8a");
      w.ring(u.x, u.y, 110, "#ffffff");
      w.popText(u.x, u.y - 38, "复活！！", "#d9ff8a");
      w.log("<b>" + u.name + "</b> 被打倒后原地复活了！");
      w.shake(10);
      return true;   // 返回 true = 取消这次死亡
    }
  },

  /* ===================== 18. 抽象艺术家 ===================== */
  {
    id: "saibo2", name: "抽象艺术家", icon: "🎨", color: "#f472b6", shape: "tri",
    hp: 104, atk: 14, def: 4, spd: 64, radius: 20,
    skillName: "抽象涂鸦", cooldown: 4.8, skillRange: 430,
    skillDesc: "朝目标扔出一桶抽象颜料，命中后留下大范围减速区域。",
    contact: { damage: 11, type: "spark", desc: "颜料溅射" },
    skill: function (u, w) {
      var t = u.target;
      var ang = (t && t.alive) ? Math.atan2(t.y - u.y, t.x - u.x) : u.dir;
      w.projectiles.push({
        x: u.x + Math.cos(ang) * 22, y: u.y + Math.sin(ang) * 22,
        vx: Math.cos(ang) * 420, vy: Math.sin(ang) * 420,
        r: 11, dmg: 14 * w.dmgMul, life: 1.6, owner: u, color: "#f472b6", spin: 8,
        onHit: function (pr, w2) {
          w2.fx.pools.push({
            x: pr.x, y: pr.y, r: 88, life: 3.6, maxLife: 3.6,
            owner: pr.owner, dps: 6 * w2.dmgMul, color: "#f472b6"
          });
          w2.explosion(pr.x, pr.y, 90, "#f9a8d4");
        }
      });
      w.popText(u.x, u.y - 34, "这就是艺术", "#f9a8d4");
    }
  },

  /* ===================== 19. 纯爱战神 ===================== */
  {
    id: "tiangou", name: "纯爱战神", icon: "💔", color: "#fb7185", shape: "round",
    hp: 114, atk: 15, def: 5, spd: 58, radius: 20,
    skillName: "舔狗之怒", cooldown: 5, skillRange: 230,
    skillDesc: "被拒绝的怒火：对最近的敌人连续三段打击，段段致命。",
    contact: { damage: 12, type: "impact", desc: "舔狗冲撞" },
    skill: function (u, w) {
      var t = u.target;
      if (!t || !t.alive) return;
      var a = Math.atan2(t.y - u.y, t.x - u.x);
      var dist = Math.hypot(t.x - u.x, t.y - u.y);
      if (dist > 200) { u.vx = Math.cos(a) * 460; u.vy = Math.sin(a) * 460; }
      for (var i = 0; i < 3; i++) {
        w.damage(u, t, 9 * w.dmgMul, { kx: 90, ky: 90 });
      }
      w.beam(u.x, u.y, t.x, t.y, "#fda4af", 10);
      w.ring(t.x, t.y, t.r + 20, "#fda4af");
      w.popText(u.x, u.y - 34, "三段舔狗连击！", "#fda4af");
      w.shake(5);
    }
  },

  /* ===================== 20. 摸鱼大师兄 ===================== */
  {
    id: "kelong", name: "摸鱼大师兄", icon: "🐙", color: "#22d3ee", shape: "round",
    hp: 116, atk: 13, def: 6, spd: 60, radius: 20,
    skillName: "分身术", cooldown: 6.2, skillRange: 999,
    skillDesc: "召唤两个分身协战 8 秒，分身会自动追击最近的敌人。",
    contact: { damage: 6, type: "impact", desc: "分身擦碰" },
    skill: function (u, w) {
      var alive = w.units.filter(function (o) { return o.alive; }).length;
      var mine = w.units.filter(function (o) {
        return o.alive && o.isClone && o.ownerId === u.uid;
      }).length;
      var room = Math.max(0, w.cfg.combat.maxUnits - alive);   // 全局单位上限保护
      var n = Math.min(Math.max(0, 2 - mine), room);
      for (var i = 0; i < n; i++) {
        var a = u.dir + (i === 0 ? 1 : -1) * 1.2;
        var clone = w.makeUnit(u.tpl, {
          x: clamp(u.x + Math.cos(a) * 44, u.r, w.arena - u.r),
          y: clamp(u.y + Math.sin(a) * 44, u.r, w.arena - u.r),
          // 继承本体动量，并朝两侧散开，避免和本体黏在一起
          vx: u.vx * 0.9 + Math.cos(a) * 120,
          vy: u.vy * 0.9 + Math.sin(a) * 120,
          // 巡航速度也要继承：分身默认 cruiseSpeed=0，会退回到全局 minSpeed，
          // 结果分身只有本体一半左右的速度基准，残局里拖着不走。
          cruiseSpeed: u.cruiseSpeed,
          isClone: true, hpMul: 0.3, atkMul: 0.5, life: 8,
          name: u.name + "·分身"
        });
        clone.ownerId = u.uid;
        w.units.push(clone);
      }
      w.ring(u.x, u.y, 80, "#67e8f9");
      w.popText(u.x, u.y - 34, n > 0 ? "分身术！" : "分身已达上限", "#67e8f9");
    }
  },

  /* ===================== 21. 爱坤（投掷型模板示例） ===================== */
  /* 用 makeThrower 生成：扔出的球会撞墙一直反弹，直到砸到人为止。
   * 自伤保护由引擎负责：投射物不会命中 owner 自己，也不会命中它的分身。
   * 想加同类角色，复制这段改 id / 数值 / throw 即可（记得建同名素材文件夹）。 */
  makeThrower({
    id: "ikun", name: "爱坤", icon: "🏀", color: "#ffd166",
    hp: 112, atk: 14, def: 5, spd: 60, radius: 20,
    skillName: "鸡你太美", cooldown: 4.2, skillRange: 999,
    skillDesc: "把球扔出去：撞墙会一直反弹，直到砸到人为止；不会伤到自己。",
    contact: { damage: 9, type: "impact", desc: "唱跳 rap" },
    throw: {
      dmg: 24,       // 命中伤害
      speed: 560,    // 出手速度
      size: 46,      // 贴图显示大小
      radius: 18,    // 碰撞半径
      bounce: -1,    // -1 = 一直弹
      life: 9,       // 兜底存活秒数
      spin: 5        // 自转
    }
  })

];
