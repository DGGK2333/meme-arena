/* =========================================================================
 * src/engine.js —— 世界模拟：单位、物理、AI、伤害结算、特效
 * ========================================================================= */
"use strict";

/* ============================== 特效系统 ============================== */
function makeFx(w) {
  var parts = [], rings = [], beams = [], texts = [], pools = [];
  var dmgTexts = [];
  return {
    pools: pools,
    step: function (dt) {
      var i, p, u;
      for (i = parts.length - 1; i >= 0; i--) {
        p = parts[i];
        p.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.94; p.vy *= 0.94;
        if (p.life <= 0) parts.splice(i, 1);
      }
      for (i = rings.length - 1; i >= 0; i--) {
        rings[i].life -= dt;
        if (rings[i].life <= 0) rings.splice(i, 1);
      }
      for (i = beams.length - 1; i >= 0; i--) {
        beams[i].life -= dt;
        if (beams[i].life <= 0) beams.splice(i, 1);
      }
      for (i = texts.length - 1; i >= 0; i--) {
        texts[i].life -= dt; texts[i].y -= 34 * dt;
        if (texts[i].life <= 0) texts.splice(i, 1);
      }
      // 伤害飘字：抛物线式上浮 + 轻微横向漂移 + 后期变淡
      for (i = dmgTexts.length - 1; i >= 0; i--) {
        var d = dmgTexts[i];
        d.life -= dt;
        if (d.life <= 0) { dmgTexts.splice(i, 1); continue; }
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.vy += 62 * dt;        // 减速上浮，自然一些
        d.vx *= 0.94;
      }
      // 地面减速区域
      for (i = pools.length - 1; i >= 0; i--) {
        p = pools[i];
        p.life -= dt;
        if (p.life <= 0) { pools.splice(i, 1); continue; }
        for (var k = 0; k < w.units.length; k++) {
          u = w.units[k];
          if (!u.alive || u === p.owner) continue;
          if (Math.hypot(u.x - p.x, u.y - p.y) < p.r + u.r * 0.5) {
            u.hp -= p.dps * dt;
            u.slow = Math.max(u.slow, 0.2);
            if (u.hp <= 0) w.kill(u, p.owner);
          }
        }
      }
    },

    burst: function (x, y, n, color, scale) {
      scale = scale || 1;
      for (var i = 0; i < n; i++) {
        var a = rand(0, TAU), s = rand(50, 300) * scale;
        parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: rand(0.2, 0.55), max: 0.55, color: color, size: rand(1.6, 3.6) * scale });
      }
    },
    puff: function (x, y, n, color) {
      for (var i = 0; i < n; i++) {
        var a = rand(0, TAU), s = rand(20, 90);
        parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: rand(0.5, 1.1), max: 1.1, color: color, size: rand(2, 5) });
      }
    },
    trail: function (x, y, color, size) {
      parts.push({ x: x, y: y, vx: 0, vy: 0, life: 0.22, max: 0.22, color: color, size: size || 2 });
    },
    ring: function (x, y, r, color) {
      rings.push({ x: x, y: y, r: r, life: 0.42, max: 0.42, color: color });
    },
    beam: function (x1, y1, x2, y2, color, width) {
      beams.push({ x1: x1, y1: y1, x2: x2, y2: y2, color: color, width: width || 6, life: 0.22, max: 0.22 });
    },
    slash: function (x1, y1, x2, y2, color) {
      var a = Math.atan2(y2 - y1, x2 - x1);
      var d = Math.hypot(x2 - x1, y2 - y1);
      beams.push({ x1: x1 + Math.cos(a) * d * 0.35, y1: y1 + Math.sin(a) * d * 0.35,
        x2: x2, y2: y2, color: color, width: 3, life: 0.14, max: 0.14, slash: true });
    },
    explosion: function (x, y, r, color) {
      rings.push({ x: x, y: y, r: r, life: 0.5, max: 0.5, color: color, fill: true });
      this.burst(x, y, window.MA.CONFIG.render.particles.death, color, 1.5);
    },
    popText: function (x, y, str, color) {
      texts.push({ x: x, y: y, str: str, color: color, life: 1.15, max: 1.15 });
    },

    /**
     * 伤害飘字：比普通 popText 更醒目，带大小分级。
     * @param {number} x,y   起点
     * @param {number} amount 伤害值
     * @param {string} kind   contact（碰撞）/ skill（技能）/ poison（毒圈）
     * @param {number} scale  伤害倍率，用于判断是否"重击"
     */
    damageText: function (x, y, amount, kind, scale) {
      var cfg = window.MA.CONFIG.damageNumbers;
      if (!cfg.enabled) return;
      if (amount < cfg.minAmount) return;

      // 同屏上限：丢掉最旧的，避免大规模混战时刷屏
      if (dmgTexts.length >= cfg.maxOnScreen) dmgTexts.shift();

      var crit = (scale || 1) >= cfg.critThreshold;
      var color = kind === "contact" ? cfg.contactColor
        : kind === "skill" ? cfg.skillColor
          : cfg.normalColor;
      if (crit) color = cfg.critColor;

      dmgTexts.push({
        x: x + rand(-6, 6),
        y: y - 6,
        vx: rand(-14, 14),
        vy: -cfg.rise * rand(0.85, 1.2),
        str: (crit ? "" : "") + Math.round(amount),
        color: color,
        size: crit ? 17 : 13,
        life: cfg.life * (crit ? 1.25 : 1),
        max: cfg.life * (crit ? 1.25 : 1),
        crit: crit
      });
    },

    /* 列表访问（渲染层需要） */
    getParts: function () { return parts; },
    getRings: function () { return rings; },
    getBeams: function () { return beams; },
    getTexts: function () { return texts; },
    getDmgTexts: function () { return dmgTexts; },
    getDmgTextCount: function () { return dmgTexts.length; },

    draw: function (g) {
      var i, p, r, b, a;
      for (i = 0; i < pools.length; i++) {
        p = pools[i];
        a = clamp(p.life / p.maxLife, 0, 1) * 0.3;
        g.globalAlpha = a;
        g.fillStyle = p.color;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill();
        g.globalAlpha = Math.min(1, a * 2);
        g.strokeStyle = p.color; g.lineWidth = 2;
        g.beginPath(); g.arc(p.x, p.y, p.r * (1 - p.life / p.maxLife * 0.15), 0, TAU); g.stroke();
        g.globalAlpha = 1;
      }
      for (i = 0; i < rings.length; i++) {
        r = rings[i];
        var k = 1 - r.life / r.max;
        g.globalAlpha = (1 - k) * 0.9;
        g.strokeStyle = r.color;
        g.lineWidth = 3 * (1 - k) + 1;
        g.beginPath(); g.arc(r.x, r.y, r.r * (0.35 + k * 0.75), 0, TAU); g.stroke();
        if (r.fill) {
          g.globalAlpha = (1 - k) * 0.28;
          g.fillStyle = r.color;
          g.beginPath(); g.arc(r.x, r.y, r.r * (0.35 + k * 0.75), 0, TAU); g.fill();
        }
        g.globalAlpha = 1;
      }
      for (i = 0; i < beams.length; i++) {
        b = beams[i];
        var kk = b.life / b.max;
        g.globalAlpha = kk;
        g.strokeStyle = b.color;
        g.lineWidth = (b.width || 6) * (b.slash ? kk : 1);
        g.lineCap = "round";
        g.beginPath(); g.moveTo(b.x1, b.y1); g.lineTo(b.x2, b.y2); g.stroke();
        g.globalAlpha = kk * 0.35;
        g.lineWidth = (b.width || 6) * 3;
        g.stroke();
        g.globalAlpha = 1;
        g.lineCap = "butt";
      }
      for (i = 0; i < parts.length; i++) {
        p = parts[i];
        g.globalAlpha = clamp(p.life / p.max, 0, 1);
        g.fillStyle = p.color;
        g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    },

    drawTexts: function (g) {
      var i, t;
      g.textAlign = "center";

      // 伤害飘字（先画，压在普通飘字下面）
      for (i = 0; i < dmgTexts.length; i++) {
        t = dmgTexts[i];
        var k = clamp(t.life / t.max, 0, 1);
        // 前 15% 弹出放大，后 35% 淡出
        var pop = t.life > t.max * 0.85 ? 1.35 - (t.life / t.max - 0.85) * 2.3 : 1;
        var alpha = t.life < t.max * 0.35 ? k / 0.35 : 1;
        g.globalAlpha = clamp(alpha, 0, 1);
        var size = t.size * clamp(pop, 0.85, 1.35);
        g.font = "900 " + Math.round(size) + "px 'PingFang SC','Microsoft YaHei',sans-serif";
        g.lineWidth = t.crit ? 4 : 3;
        g.strokeStyle = "rgba(0,0,0,.85)";
        g.strokeText(t.str, t.x, t.y);
        g.fillStyle = t.color;
        g.fillText(t.str, t.x, t.y);
      }

      g.font = "700 13px 'PingFang SC','Microsoft YaHei',sans-serif";
      for (i = 0; i < texts.length; i++) {
        t = texts[i];
        g.globalAlpha = clamp(t.life / t.max, 0, 1);
        g.lineWidth = 3;
        g.strokeStyle = "rgba(0,0,0,.75)";
        g.strokeText(t.str, t.x, t.y);
        g.fillStyle = t.color;
        g.fillText(t.str, t.x, t.y);
      }
      g.globalAlpha = 1;
      g.textAlign = "start";
    }
  };
}

/* ============================== 世界 ============================== */
function World(canvas) {
  this.cv = canvas;
  this.ctx = canvas ? canvas.getContext("2d") : null;
  this.cfg = window.MA.CONFIG;
  this.dpr = 1;
  this.cssSize = 720;
  this.arena = 720;
  this.softW = 720;
  this.shrink = 1;
  this.dmgMul = this.cfg.combat.damageMul;
  this.aiMul = this.cfg.combat.aiMul;
  this.autoRestart = true;
  this.speed = 1;
  this.paused = false;
  this.mouse = null;
  this.units = [];
  this.projectiles = [];
  this.decor = [];
  this.uidSeq = 0;
  this.time = 0;
  this.ver = 0;
  this.over = false;
  this.overT = 0;
  this.overShown = false;
  this.shakeAmt = 0;
  this.winner = null;
  this.skillErrors = 0;
  this.picks = [];
  // 本局开局人数（reset 里赋值）：残局提速 / 加速缩圈用它区分大场与小场
  this.fieldSize = 0;
  // 安全区是否启用（关掉后无缩圈、无圈外伤害、无圈特效）
  this.zoneOn = this.cfg.arena.zoneEnabled !== false;
  // 移动模式：momentum（碰撞弹跳，默认）/ active（旧版主动追击）
  this.moveMode = (this.cfg.movement && this.cfg.movement.mode) || "momentum";
  // 摄像机：global 全局 / follow 跟随
  this.cam = {
    mode: (this.cfg.camera && this.cfg.camera.mode) || "global",
    x: this.arena / 2,
    y: this.arena / 2,
    zoom: 1,
    targetId: 0,
    edgeT: 1
  };
  this._contactCd = {};
  this.fx = makeFx(this);
  this.reset();
}

World.prototype = {

  /* ---------- 尺寸自适应 ---------- */
  resize: function (cssSize) {
    this.cssSize = cssSize;
    this.arena = cssSize;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.cfg.render.maxDpr);
    if (this.cv) {
      this.cv.width = Math.round(cssSize * this.dpr);
      this.cv.height = Math.round(cssSize * this.dpr);
      this.cv.style.width = cssSize + "px";
      this.cv.style.height = cssSize + "px";
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    this.makeDecor();
  },

  makeDecor: function () {
    var A = this.arena;
    this.decor = [];
    for (var i = 0; i < 26; i++) {
      this.decor.push({
        x: rand(30, A - 30), y: rand(30, A - 30),
        r: rand(14, 62), a: rand(0.012, 0.045),
        vx: rand(-6, 6), vy: rand(-6, 6)
      });
    }
  },

  /* ---------- 开局 ---------- */
  reset: function (picks) {
    if (picks) this.picks = picks;
    if (!this.picks || !this.picks.length) {
      var all = window.MA.CHARACTERS.map(function (t) { return t.id; });
      this.picks = shuffled(all).slice(0, Math.min(this.cfg.match.defaultPicks, all.length));
    }
    var A = this.arena;
    var cx = A / 2, cy = A / 2;
    var list = shuffled(this.picks.slice());
    var n = list.length;

    this.units = [];
    this.projectiles = [];
    // 每局都重新读取安全区开关：在界面上改过开关后，重开一局要立刻生效，
    // 否则会停留在上一局的状态（zoneOn 只在构造函数里读过一次）。
    this.zoneOn = this.cfg.arena.zoneEnabled !== false;
    this._contactCd = {};
    this.fx = makeFx(this);
    this.time = 0;
    this.over = false;
    this.overT = 0;
    this.overShown = false;
    this.winner = null;
    this.ver++;
    this.shakeAmt = 0;
    // 本局开局人数：残局提速 / 加速缩圈要拿它判断"这局是不是大场"。
    // 只看存活数的绝对量是不行的 —— 2 人局从第一帧起就"只剩 2 人"，
    // 会被误判成残局而整局加速。
    this.fieldSize = n;

    var ringR = A * (n <= 1 ? 0 : n <= 5 ? 0.34 : 0.30);
    for (var i = 0; i < n; i++) {
      var tpl = window.MA.getCharacter(list[i]);
      if (!tpl) continue;
      var x, y;
      if (n === 1) { x = cx; y = cy; }
      else {
        var a = (i / n) * TAU + rand(-0.12, 0.12);
        x = clamp(cx + Math.cos(a) * ringR, 40, A - 40);
        y = clamp(cy + Math.sin(a) * ringR, 40, A - 40);
      }
      this.units.push(this.makeUnit(tpl, { x: x, y: y }));
    }

    // 动量模式：给每个单位一个初速度（含速度上限保护，避免开局飞出擂台）
    if (this.moveMode === "momentum") {
      var mv = this.cfg.movement;
      for (var k = 0; k < this.units.length; k++) {
        this.seedVelocity(this.units[k], k, this.units.length);
        var s0 = Math.hypot(this.units[k].vx, this.units[k].vy);
        if (s0 > mv.maxSpeed) {
          this.units[k].vx *= mv.maxSpeed / s0;
          this.units[k].vy *= mv.maxSpeed / s0;
        }
      }
    }

    this.softR = A * this.cfg.arena.safeZoneStart;
    this.softX = cx; this.softY = cy;
    this.softW = this.softR;
    this.log("<b>第 " + this.ver + " 局</b> 开战！" + n + " 位选手进入擂台。");
    if (window.MA.Audio) window.MA.Audio.play(null, "spawn", "spawn");
    return this;
  },

  /** 读出当前的显示尺寸倍率 */
  unitScale: function () {
    var d = this.cfg.display || {};
    return clamp(num(d.unitScale, 1), 0.2, 6);
  },

  /**
   * 在不重开一局的前提下更新所有单位的尺寸。
   * 半径在创建单位时就写进 u.r 了，所以改「角色大小」时要主动刷一遍；
   * 否则只能靠 reset() 重建，那会打断正在看的对局。
   */
  refreshUnitSizes: function () {
    var scale = this.unitScale();
    var A = this.arena;
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      var base = (u.tpl.radius || 20) * (u.isClone ? 0.86 : 1);
      u.r = base * scale;
      // 顺手夹回场内，避免放大后贴墙的角色露出边界
      u.x = clamp(u.x, u.r, A - u.r);
      u.y = clamp(u.y, u.r, A - u.r);
    }
    return scale;
  },

  makeUnit: function (tpl, o) {
    o = o || {};
    var uid = ++this.uidSeq;
    var hpMul = o.hpMul || 1, atkMul = o.atkMul || 1;
    var stats = { hp: tpl.hp * hpMul, atk: tpl.atk * atkMul, def: tpl.def, spd: tpl.spd };
    // 显示/物理尺寸倍率：两者用同一个半径，保证"看到多大就撞多大"。
    // 若只放大画面而不放大碰撞，会出现视觉与实际判定错位。
    var dsp = this.cfg.display || {};
    var scale = clamp(num(dsp.unitScale, 1), 0.2, 6);
    var r = tpl.radius * (o.isClone ? 0.86 : 1) * scale;
    return {
      uid: uid, tpl: tpl, name: o.name || tpl.name, color: tpl.color,
      icon: tpl.icon, shape: tpl.shape,
      x: o.x, y: o.y,
      vx: o.vx !== undefined ? o.vx : rand(-40, 40),
      vy: o.vy !== undefined ? o.vy : rand(-40, 40),
      r: r,
      stats: stats, hp: stats.hp, maxHp: stats.hp,
      dir: rand(0, TAU), alive: true, isClone: !!o.isClone,
      shield: 0, shieldTime: 0, thorns: 0,
      invuln: 0.8, stun: 0, freeze: 0, rage: 0, rageBonus: 1,
      slow: 0, bleed: 0, poison: 0, hitFlash: 0,
      atkCd: 0, skillCd: rand(0.8, 2.2), dashHit: false,
      kills: 0, dmgDone: 0, life: o.life || 0, lifeMax: o.life || 0,
      target: null, retarget: 0, wander: rand(0, TAU),
      dead: false, deathT: 0, revived: false, spawnT: 0.45,
      ownerId: o.ownerId || 0,
      // 巡航速度模型：目标速度 + 状态倍率。
      // 分身（isClone）若没显式给 cruiseSpeed，会退回 0，
      // 之后 applyCruise 只能退到全局 minSpeed —— 分身会比本体慢一大截，
      // 残局里等于拖着不走。这里兜一个基准，由调用方按需覆盖。
      cruiseSpeed: o.cruiseSpeed || (o.isClone ? this.defaultCruise() : 0),
      cruiseScale: 1,
      wallBounce: 0
    };
  },

  /** 分身的巡航基准兜底值：取巡航下限，至少不是"退回到 minSpeed"那么低 */
  defaultCruise: function () {
    var cr = this.cfg.movement.cruise;
    return (cr && cr.minCruise != null) ? cr.minCruise : this.cfg.movement.minSpeed;
  },

  log: function (html) {
    if (!this._logQueue) this._logQueue = [];
    this._logQueue.push(html);
  },

  /* ---------- 特效转发（角色技能里可以直接 w.xxx 调用） ---------- */
  popText: function (x, y, s, c) { this.fx.popText(x, y, s, c); },
  puff: function (x, y, n, c) { this.fx.puff(x, y, n, c); },
  burst: function (x, y, n, c, s) { this.fx.burst(x, y, n, c, s); },
  explosion: function (x, y, r, c) { this.fx.explosion(x, y, r, c); },
  ring: function (x, y, r, c) { this.fx.ring(x, y, r, c); },
  beam: function (x1, y1, x2, y2, c, w) { this.fx.beam(x1, y1, x2, y2, c, w); },
  shake: function (v) { this.shakeAmt = Math.min(26, this.shakeAmt + v); },

  /* ---------- 查询 ---------- */
  unitsNear: function (x, y, r) {
    var out = [], r2 = r * r;
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (!u.alive) continue;
      var dx = u.x - x, dy = u.y - y;
      if (dx * dx + dy * dy <= r2) out.push(u);
    }
    return out;
  },

  heal: function (u, v) {
    var c = this.cfg.combat;
    var decay = this.time < c.healDecayStart
      ? 1
      : Math.max(c.healDecayMin, 1 - (this.time - c.healDecayStart) * c.healDecayRate);
    u.hp = Math.min(u.stats.hp, u.hp + v * decay);
  },

  /* ---------- 伤害结算 ---------- */
  damage: function (src, tgt, amount, o) {
    if (!tgt || !tgt.alive || this.over) return 0;
    o = o || {};
    var c = this.cfg.combat;
    var dmg = amount * (100 / (100 + tgt.stats.def * c.defScale));
    if (tgt.invuln > 0) dmg *= c.invulnDamageFactor;

    if (tgt.shield > 0) {
      var absorbed = Math.min(tgt.shield, dmg);
      tgt.shield -= absorbed;
      dmg -= absorbed;
      this.fx.burst(tgt.x, tgt.y, 8, "#aab8ff", 1);
    }
    tgt.hp -= dmg;
    tgt.hitFlash = 0.18;
    if (src) src.dmgDone += amount;

    // 伤害飘字：按来源着色，o.kind 由调用方指定（contact/skill/poison）
    if (dmg > 0) {
      this.fx.damageText(tgt.x, tgt.y - tgt.r * 0.4, dmg,
        o.kind || (src ? "skill" : "poison"), o.scale || 1);
    }

    // 反伤
    if (tgt.thorns > 0 && src && src.alive && src !== tgt) {
      var back = amount * tgt.thorns * 0.6;
      src.hp -= back;
      src.hitFlash = 0.14;
      if (src.hp <= 0) this.kill(src, tgt);
    }

    // 击退
    if (o.kx) {
      var ang = o.ang;
      if (ang === undefined) {
        ang = (src && src !== tgt)
          ? Math.atan2(tgt.y - src.y, tgt.x - src.x)
          : Math.atan2(tgt.y - this.arena / 2, tgt.x - this.arena / 2);
      }
      var mass = 1 + tgt.stats.def * c.knockbackMass;
      tgt.vx += Math.cos(ang) * o.kx / mass;
      tgt.vy += Math.sin(ang) * o.ky / mass;
    }

    var pn = o.crit ? this.cfg.render.particles.crit : this.cfg.render.particles.hit;
    this.fx.burst(tgt.x, tgt.y, pn, o.crit ? "#ffd25e" : "#ffffff", o.crit ? 1.6 : 1);
    if (window.MA.Audio) window.MA.Audio.play(src && src.tpl ? src.tpl.id : null, "attack", o.crit ? "crit" : "hit");

    if (tgt.hp <= 0) this.kill(tgt, src);
    return dmg;
  },

  kill: function (u, killer) {
    if (!u.alive) return;
    if (u.tpl.onDeath && u.tpl.onDeath(u, this) === true) return;   // 角色自己阻止了死亡
    u.alive = false;
    u.dead = true;
    u.deathT = 0;
    u.vx *= 0.5; u.vy *= 0.5;
    this.fx.explosion(u.x, u.y, u.r * 3.4, u.color);
    this.shake(7);
    if (killer && killer !== u && !killer.isClone && !u.isClone) killer.kills++;
    if (window.MA.Audio) window.MA.Audio.play(u.tpl.id, "death", "death");
    this.log("<b>" + u.name + "</b> 被 " +
      (killer && killer !== u ? "<b>" + killer.name + "</b> " : "") +
      "淘汰了 <span class=\"k\">" + Math.max(0, Math.round(u.hp)) + "HP</span>");
  },

  /* ---------- 主循环 ---------- */
  step: function (dt) {
    var i, u;
    if (this.over) {
      this.overT += dt;
      this.fx.step(dt);
      if (this.autoRestart && this.overT > this.cfg.match.autoRestartDelay) this.reset();
      return;
    }
    this.time += dt;

    // 安全区：zoneEnabled=false 时整个机制停摆（不缩圈、不伤害、无特效）
    var ac = this.cfg.arena;
    this.zoneOn = ac.zoneEnabled !== false;
    if (!this.zoneOn) {
      // 安全区直接放大到覆盖整个擂台，圈外不存在
      this.softR = this.arena * 1.5;
      this.softX = this.arena / 2;
      this.softY = this.arena / 2;
      this.shrinking = false;
    } else if (this.shrink > 0) {
      var t = Math.min(this.time, ac.shrinkCapSeconds);
      // 残局加速收缩：存活越少，圈收得越快，逼残局双方碰面。
      // 只乘在计算里，不写回 this.shrink —— 那是界面上的用户设置。
      this.softR = Math.max(this.arena * ac.safeZoneMin,
        this.arena * (ac.safeZoneStart - t * ac.shrinkRate * this.shrink * this.endgameShrinkMul()));
      this.softX = lerp(this.softX, this.arena / 2, dt * 0.9);
      this.softY = lerp(this.softY, this.arena / 2, dt * 0.9);
      this.shrinking = true;
    } else {
      this.softR = this.arena * ac.safeZoneStart;
      this.softX = lerp(this.softX, this.arena / 2, dt * 0.6);
      this.softY = lerp(this.softY, this.arena / 2, dt * 0.6);
      this.shrinking = false;
    }
    this.poisonActive = this.zoneOn && !!(ac.poisonFx && ac.poisonFx.enabled !== false);

    var alive = [];
    for (i = 0; i < this.units.length; i++) if (this.units[i].alive) alive.push(this.units[i]);

    /* 1. 思考 + 技能 */
    for (i = 0; i < alive.length; i++) {
      u = alive[i];
      if (!u.alive) continue;
      // 目标只用于技能指向与 onHit 判定，动量模式下不再用于走位
      u.retarget -= dt;
      if (u.retarget <= 0) {
        u.retarget = rand(0.35, 0.85) / this.aiMul;
        u.target = this.findTarget(u);
      }
      if (!u.target || !u.target.alive) u.target = this.findTarget(u);

      // 分身不放技能，否则会无限增殖
      u.skillCd -= dt;
      if (u.skillCd <= 0 && u.stun <= 0 && u.freeze <= 0 && !u.isClone) {
        var tg = u.target;
        var dist = tg ? Math.hypot(tg.x - u.x, tg.y - u.y) : 0;
        var reach = u.tpl.skillRange || 230;
        // 动量模式下角色不会主动靠近，所以放宽技能距离，
        // 否则依赖近身的技能永远放不出来
        if (this.moveMode === "momentum") reach = Math.max(reach, this.arena * 0.55);
        if (!tg || dist <= reach) {
          u.skillCd = u.tpl.cooldown * rand(0.92, 1.14);
          try {
            u.tpl.skill(u, this);
            if (window.MA.Audio) window.MA.Audio.play(u.tpl.id, "skill", "skill");
          } catch (e) {
            console.error("[技能异常] " + u.name + " · " + u.tpl.skillName, e);
            this.skillErrors++;
          }
        } else {
          u.skillCd = 0.22;
        }
      }
    }

    /* 2. 移动意图（动量模式只处理外力与状态，不做寻路） */
    for (i = 0; i < alive.length; i++) {
      if (alive[i].alive) this.stepUnit(alive[i], dt, alive);
    }

    /* 3. 物理积分 */
    for (i = 0; i < alive.length; i++) {
      if (alive[i].alive) this.integrate(alive[i], dt, alive);
    }

    /* 3.5 碰撞求解 + 接触伤害 */
    this.solveCollisions(dt);

    /* 4. 投射物 */
    this.stepProjectiles(dt);

    /* 5. 状态衰减 + 圈外伤害 */
    var c = this.cfg.combat;
    for (i = 0; i < this.units.length; i++) {
      u = this.units[i];
      if (!u.alive) { u.deathT += dt; continue; }
      u.invuln = Math.max(0, u.invuln - dt);
      u.stun = Math.max(0, u.stun - dt);
      u.freeze = Math.max(0, u.freeze - dt);
      u.rage = Math.max(0, u.rage - dt);
      if (u.rage <= 0) u.rageBonus = 1;
      u.slow = Math.max(0, u.slow - dt);
      u.hitFlash = Math.max(0, u.hitFlash - dt);
      u.spawnT = Math.max(0, u.spawnT - dt);
      if (u.shieldTime > 0) {
        u.shieldTime -= dt;
        if (u.shieldTime <= 0) { u.shield = 0; u.thorns = 0; }
      }
      if (u.bleed > 0) {
        u.bleed -= dt;
        u.hp -= 4 * dt * this.dmgMul;
        if (u.hp <= 0) { this.kill(u, null); continue; }
      }
      if (u.isClone) {
        u.life -= dt;
        if (u.life <= 0) {
          u.alive = false; u.dead = true;
          this.fx.burst(u.x, u.y, 14, "#67e8f9", 1.4);
          continue;
        }
      }
      var d = Math.hypot(u.x - this.softX, u.y - this.softY);
      if (this.zoneOn && d > this.softR + u.r) {
        u.poison += dt;
        var pdmg = (ac.poisonBase + this.time * ac.poisonRamp) * dt * this.dmgMul;
        u.hp -= pdmg;
        // 毒圈伤害每帧都在跳，累计到一定量才飘一次字，否则刷屏
        u.poisonAcc = (u.poisonAcc || 0) + pdmg;
        u.poisonTick = (u.poisonTick || 0) + dt;
        if (u.poisonAcc >= 4 && u.poisonTick >= 0.6) {
          this.fx.damageText(u.x, u.y - u.r * 0.4, u.poisonAcc, "poison", 1);
          u.poisonAcc = 0;
          u.poisonTick = 0;
        }
        if (u.hp <= 0) this.kill(u, null);
      } else {
        u.poison = 0;
        u.poisonAcc = 0;
        u.poisonTick = 0;
      }
    }

    this.fx.step(dt);
    // 兜底：本帧技能可能新建了分身或瞬移了角色，统一夹回场内
    for (i = 0; i < this.units.length; i++) {
      if (this.units[i].alive) this.clampToArena(this.units[i]);
    }
    this.checkEnd();
  },

  findTarget: function (u) {
    var best = null, bs = -Infinity;
    for (var i = 0; i < this.units.length; i++) {
      var o = this.units[i];
      if (!o.alive || o === u) continue;
      if (o.isClone && o.ownerId === u.uid) continue;                  // 不打自己分身
      if (u.isClone && o.uid === u.ownerId) continue;                   // 分身不打本体
      if (u.isClone && o.isClone && o.ownerId === u.ownerId) continue;
      var d = Math.hypot(o.x - u.x, o.y - u.y);
      var s = -d;
      s += (1 - o.hp / o.stats.hp) * 180;      // 优先残血
      if (o === u.target) s += 60;             // 保持目标稳定
      if (o.hp < o.stats.hp * 0.3) s += 120;
      if (s > bs) { bs = s; best = o; }
    }
    return best;
  },

  /* =======================================================================
   * 移动模式分派
   * ======================================================================= */
  stepUnit: function (u, dt, alive) {
    if (this.moveMode === "active") this.stepUnitActive(u, dt, alive);
    else this.stepUnitMomentum(u, dt);
  },

  integrate: function (u, dt, alive) {
    if (this.moveMode === "active") this.integrateActive(u, dt, alive);
    else this.integrateMomentum(u, dt);
  },

  /* =======================================================================
   * 动量模式 —— 角色不主动走位，只靠速度运动
   * 撞墙 / 撞人按恢复系数求解，接触是否掉血由角色 contact 字段决定
   * ======================================================================= */

  /** 质量：默认按半径（面积直觉），可切 hp 或均匀 */
  massOf: function (u) {
    var mode = this.cfg.movement.massFrom;
    if (mode === "uniform") return 1;
    if (mode === "hp") return Math.max(1, u.stats.hp * 0.01);
    return Math.max(1, u.r * u.r * 0.0025);   // radius² 缩放，量级接近 1
  },

  /** 开局给每个单位一个初速度 */
  seedVelocity: function (u, idx, total) {
    var mv = this.cfg.movement;
    var base = mv.initialSpeed;
    if (mv.speedFromStat) base *= (u.tpl.spd || 55) / 55;
    base *= 1 + rand(-mv.initialSpeedJitter, mv.initialSpeedJitter);

    // 均匀撒向四周，避免开局全部同向导致挤成一堆
    var ang = (idx / Math.max(1, total)) * TAU + rand(-0.35, 0.35);
    u.vx = Math.cos(ang) * base;
    u.vy = Math.sin(ang) * base;
    u.dir = ang;
    u.speed0 = base;
    // 巡航速度：这是「目标速度」，之后每帧朝它恢复
    u.cruiseSpeed = base;
    u.cruiseScale = 1;
  },

  /** 动量模式：只处理鼠标推挤与状态对速度的即时影响，不做寻路 */
  stepUnitMomentum: function (u, dt) {
    var mv = this.cfg.movement;
    var frozen = u.freeze > 0 || u.stun > 0;

    if (this.mouse && !frozen) {
      var dx = u.x - this.mouse.x, dy = u.y - this.mouse.y;
      var d = Math.hypot(dx, dy);
      if (d < this.cfg.physics.mouseRadius && d > 0.001) {
        var f = (1 - d / this.cfg.physics.mouseRadius) *
          this.cfg.physics.mouseForce * mv.mouseScale;
        u.vx += dx / d * f * dt;
        u.vy += dy / d * f * dt;
      }
    }

    /* ---- 状态对速度的作用 ----
     * 这里不再"每帧乘衰减系数"（那会把动能永久抽走，后期越来越慢），
     * 而是只算一个「速度倍率」，由巡航模型统一把速度拉回目标值。
     * 状态一结束，倍率回到 1，速度自然恢复。 */
    var scale = 1;
    if (u.freeze > 0) scale = 0;                    // 冻结：完全停住
    else {
      if (u.stun > 0) scale *= 0.35;                // 眩晕：慢下来
      if (u.slow > 0) scale *= (this.cfg.combat.slowFactor || 0.5);
      if (u.rage > 0) scale *= 1 + (this.cfg.combat.rageSpeedBonus || 0.5);
    }
    u.cruiseScale = scale;

    // 冻结时直接把速度压到 0（时间静止要真的停住）
    if (u.freeze > 0) { u.vx *= 0.02; u.vy *= 0.02; }

    // 朝向跟着速度走，方便画表情
    if (Math.abs(u.vx) + Math.abs(u.vy) > 4) u.dir = Math.atan2(u.vy, u.vx);

    // 攻击冷却仍在走（伤害由碰撞结算，普攻计时器给 onHit 类技能用）
    u.atkCd = Math.max(0, u.atkCd - dt);
  },

  /**
   * 巡航速度：把实际速度温和地拉回「巡航速度 × 状态倍率」。
   * 这是让角色保持匀速直线运动的关键 ——
   * 碰撞会让速度随机变化，减速技能会临时压低速度，
   * 但只要有这个恢复项，速度总会回到巡航值，不会一路衰减到停滞。
   *
   * 状态倍率（cruiseScale）之外，残局还会再乘一个「提速倍率」：
   * 存活越少基准越高，逼出更多碰撞，避免决胜段两个人互相绕圈。
   * 倍率只作用在 target 上，不写回 cruiseSpeed —— 否则会和
   * refreshCruise 的写回互相叠加，越滚越大。
   */
  applyCruise: function (u, dt) {
    var mv = this.cfg.movement;
    var cr = mv.cruise;
    if (!cr || cr.enabled === false) return;

    var lo = cr.minCruise != null ? cr.minCruise : 150;
    var hi = cr.maxCruise != null ? cr.maxCruise : 900;
    var target = clamp(u.cruiseSpeed || mv.minSpeed || 150, lo, hi);
    target *= (u.cruiseScale != null ? u.cruiseScale : 1);
    target *= this.endgameMul();
    // 提速后可能超过硬上限，兜一下
    target = clamp(target, 0, mv.maxSpeed != null ? mv.maxSpeed : 1100);
    // 目标为 0（冻结）时不干预
    if (target <= 1) return;

    var sp = Math.hypot(u.vx, u.vy);

    // 速度方向：没有速度时用原朝向，避免方向突变
    var ang = sp > 1 ? Math.atan2(u.vy, u.vx) : u.dir;

    // 速度在巡航的 ±corridor 内 → 不干预，保留碰撞带来的自然波动
    var corridor = cr.corridor != null ? cr.corridor : 0.16;
    if (sp >= target * (1 - corridor) && sp <= target * (1 + corridor)) return;

    // 指数逼近：帧率无关，且不会突然"弹"一下
    var k = 1 - Math.exp(-(cr.recovery || 1.6) * dt);
    var newSp = sp + (target - sp) * k;

    u.vx = Math.cos(ang) * newSp;
    u.vy = Math.sin(ang) * newSp;
  },

  /**
   * 残局提速倍率：按当前存活人数取档。
   * 实测（tools/diag-endgame.js）：整局约 60% 时间花在「≤3 人」，
   * 其中 1v1 独占一半，平均 6.4 秒才撞上一次 —— 决胜段就是这么墨迹起来的。
   * 存活越少 → 巡航基准越高 → 碰撞更频繁 → 更快收场。
   *
   * 小场保护：开局人数 < minField 时直接返回 1。
   * 否则 2 人局从第一帧就命中 maxAlive:2 的档位，整局被加速 ——
   * 既破坏动量守恒的观感，也让"撞墙完全弹性"这类物理断言失效。
   */
  endgameMul: function () {
    var cr = this.cfg.movement.cruise;
    var eb = cr && cr.endgameBoost;
    if (!eb || eb.enabled === false || !eb.tiers || !eb.tiers.length) return 1;
    if (this.fieldSize != null && eb.minField != null && this.fieldSize < eb.minField) return 1;
    var alive = this.aliveCount();
    for (var i = 0; i < eb.tiers.length; i++) {
      var t = eb.tiers[i];
      if (alive <= t.maxAlive) return t.mul != null ? t.mul : 1;
    }
    return 1;
  },

  /**
   * 残局加速缩圈倍率。
   * 光提速还不够：1v1 期间两人「贴在一起」的时间占比只有 0%，
   * 35% 的时间相距 400px 以上 —— 他们只是不碰面。
   * 把圈收快一点比单纯提速更能逼出碰撞（实测 P90 从 45s 降到 25s）。
   * 只影响缩圈速率，不改变圈的最小半径（safeZoneMin 仍然兜底）。
   * 同样受 minField 保护（小场不加速）。
   */
  endgameShrinkMul: function () {
    var ac = this.cfg.arena;
    var es = ac && ac.endgameShrink;
    if (!es || es.enabled === false || !es.tiers || !es.tiers.length) return 1;
    if (this.fieldSize != null && es.minField != null && this.fieldSize < es.minField) return 1;
    var alive = this.aliveCount();
    for (var i = 0; i < es.tiers.length; i++) {
      var t = es.tiers[i];
      if (alive <= t.maxAlive) return t.mul != null ? t.mul : 1;
    }
    return 1;
  },

  /** 动量模式积分：速度衰减 + 位移 + 碰撞求解 */
  integrateMomentum: function (u, dt) {
    var mv = this.cfg.movement;

    // 巡航恢复：把速度拉回巡航值（碰撞/减速的偏差会被温和纠正）
    this.applyCruise(u, dt);

    // 阻力（默认 1 = 无阻力，动量守恒）
    if (mv.drag < 1) {
      var drag = Math.pow(mv.drag, dt);
      u.vx *= drag; u.vy *= drag;
    }

    // 限速
    var sp = Math.hypot(u.vx, u.vy);
    if (sp > mv.maxSpeed) {
      var k = mv.maxSpeed / sp;
      u.vx *= k; u.vy *= k;
    }

    u.x += u.vx * dt;
    u.y += u.vy * dt;
  },

  /**
   * 碰撞求解：墙壁 + 角色间，并结算接触伤害。
   * 每帧跑若干次迭代，保证多体挤压时也能分开。
   */
  solveCollisions: function (dt) {
    var mv = this.cfg.movement;
    var arena = this.arena;
    var passes = Math.max(1, mv.solvePasses);
    var alive = [];
    for (var i = 0; i < this.units.length; i++) {
      if (this.units[i].alive) alive.push(this.units[i]);
    }
    if (!alive.length) return;

    /* --- 墙壁：完全弹性默认，撞墙不掉速 --- */
    for (i = 0; i < alive.length; i++) {
      var u = alive[i];
      u.wallBounce = Math.max(0, (u.wallBounce || 0) - dt);
      var hitWall = false;
      if (u.x - u.r < 0) {
        u.x = u.r;
        if (u.vx < 0) {
          u.vx = -u.vx * mv.wallRestitution;
          u.wallBounce = 0.12;             // 短暂豁免速度下限，避免被"补"回墙里
          hitWall = true;
          if (Math.abs(u.vx) > 40) this.fx.burst(u.x, u.y, 3, "#9fc4ff", 0.7);
        }
      } else if (u.x + u.r > arena) {
        u.x = arena - u.r;
        if (u.vx > 0) {
          u.vx = -u.vx * mv.wallRestitution;
          u.wallBounce = 0.12;
          hitWall = true;
          if (Math.abs(u.vx) > 40) this.fx.burst(u.x, u.y, 3, "#9fc4ff", 0.7);
        }
      }
      if (u.y - u.r < 0) {
        u.y = u.r;
        if (u.vy < 0) {
          u.vy = -u.vy * mv.wallRestitution;
          u.wallBounce = 0.12;
          hitWall = true;
          if (Math.abs(u.vy) > 40) this.fx.burst(u.x, u.y, 3, "#9fc4ff", 0.7);
        }
      } else if (u.y + u.r > arena) {
        u.y = arena - u.r;
        if (u.vy > 0) {
          u.vy = -u.vy * mv.wallRestitution;
          u.wallBounce = 0.12;
          hitWall = true;
          if (Math.abs(u.vy) > 40) this.fx.burst(u.x, u.y, 3, "#9fc4ff", 0.7);
        }
      }
      // 撞墙后刷新巡航速度：撞得越猛，之后的匀速运动也越快
      if (hitWall) this.refreshCruise(u);
    }

    /* --- 角色间：按恢复系数交换动量 + 接触伤害 --- */
    for (var pass = 0; pass < passes; pass++) {
      for (i = 0; i < alive.length; i++) {
        var a = alive[i];
        if (!a.alive) continue;
        for (var j = i + 1; j < alive.length; j++) {
          var b = alive[j];
          if (!b.alive) continue;

          var dx = b.x - a.x, dy = b.y - a.y;
          var dist = Math.hypot(dx, dy);
          var minDist = a.r + b.r;
          if (dist >= minDist || dist < 0.0001) continue;

          var nx = dx / dist, ny = dy / dist;

          // 位置修正：按质量反比推开，重的少动
          var ma = this.massOf(a), mb = this.massOf(b);
          var overlap = minDist - dist;
          var totalM = ma + mb;
          a.x -= nx * overlap * (mb / totalM);
          a.y -= ny * overlap * (mb / totalM);
          b.x += nx * overlap * (ma / totalM);
          b.y += ny * overlap * (ma / totalM);

          // 相对速度沿法线分量
          var rvx = b.vx - a.vx, rvy = b.vy - a.vy;
          var vn = rvx * nx + rvy * ny;
          if (vn >= 0) continue;              // 正在分离，不处理

          // 冲量（完全非弹性 e=0 时两者法向速度合并）
          var e = mv.unitRestitution;
          var jImp = -(1 + e) * vn / (1 / ma + 1 / mb);
          a.vx -= (jImp / ma) * nx;
          a.vy -= (jImp / ma) * ny;
          b.vx += (jImp / mb) * nx;
          b.vy += (jImp / mb) * ny;

          // 切向抖动：完全非弹性会把法向速度抹平，
          // 若不注入切向分量，全场会黏成一坨慢慢静止。
          if (mv.tangentialJitter > 0) {
            var impactSpeed = Math.abs(vn);
            var jitter = impactSpeed * mv.tangentialJitter;
            var tx = -ny, ty = nx;
            var ra = rand(-jitter, jitter), rb = rand(-jitter, jitter);
            a.vx += tx * ra; a.vy += ty * ra;
            b.vx += tx * rb; b.vy += ty * rb;
          }

          // 接触伤害（只在第 0 遍结算，避免多次迭代重复扣血）
          if (pass === 0) {
            this.resolveContact(a, b, Math.abs(vn), nx, ny);
          }

          // 推开后夹回场内
          a.x = clamp(a.x, a.r, arena - a.r);
          a.y = clamp(a.y, a.r, arena - a.r);
          b.x = clamp(b.x, b.r, arena - b.r);
          b.y = clamp(b.y, b.r, arena - b.r);
        }
      }
    }

    /* --- 速度下限兜底 ---
     * 巡航模型（applyCruise）已经负责"把速度拉回巡航值"，
     * 所以开启巡航时这里不再重复干预，避免两套逻辑互相打架。
     * 只有巡航关掉时才用这段老逻辑兜底。 */
    var cruiseOn = !!(mv.cruise && mv.cruise.enabled !== false);
    if (!cruiseOn && mv.minSpeed > 0) {
      for (i = 0; i < alive.length; i++) {
        var s = alive[i];
        if (!s.alive || s.freeze > 0) continue;
        if ((s.wallBounce || 0) > 0) continue;   // 刚撞墙：别破坏反弹
        var sp = Math.hypot(s.vx, s.vy);
        if (sp >= mv.minSpeed) continue;

        // 补足方向：优先沿用原方向；若原方向指向墙里，则改用切向，
        // 否则会把角色顶在墙上反复抖动。
        var ang;
        if (sp > 1) {
          ang = Math.atan2(s.vy, s.vx);
          var margin = 6;
          var willHitX = (Math.cos(ang) < 0 && s.x - s.r < margin) ||
                         (Math.cos(ang) > 0 && s.x + s.r > arena - margin);
          var willHitY = (Math.sin(ang) < 0 && s.y - s.r < margin) ||
                         (Math.sin(ang) > 0 && s.y + s.r > arena - margin);
          if (willHitX || willHitY) {
            // 转向擂台中心
            ang = Math.atan2(arena / 2 - s.y, arena / 2 - s.x);
          }
        } else {
          ang = rand(0, TAU);
        }

        var add = Math.min(mv.minSpeed - sp, 220 * dt * 6);
        s.vx += Math.cos(ang) * add;
        s.vy += Math.sin(ang) * add;
      }
    }
  },

  /**
   * 碰墙后刷新巡航速度。
   * 关键：**真的只升不降** ——
   *   撞得猛（速度高）→ 巡航值跟着提高，之后跑得更快；
   *   撞得慢**完全不动**巡航值。
   *
   * 这里以前留了一个"略低的候选值做 3% 向下修正"的分支，注释说是
   * "保持基准稳定"，实际却是个棘轮：反复低速撞墙会把基准一路拖下去。
   * 实测（tools/diag-cruise.js）反复以 200px/s 撞墙 40 次，
   * 巡航基准从 500 掉到 267 —— 这正是"玩着玩着角色就变慢"的成因之一。
   * 现在只有 candidate > cur 时才提升。
   */
  refreshCruise: function (u) {
    var mv = this.cfg.movement;
    var cr = mv.cruise;
    if (!cr || cr.enabled === false) return;
    var sp = Math.hypot(u.vx, u.vy);
    if (sp < 5) return;
    var f = cr.refreshOnBounce != null ? cr.refreshOnBounce : 0.85;
    if (f <= 0) return;
    var candidate = sp * f;
    var lo = cr.minCruise != null ? cr.minCruise : 150;
    var hi = cr.maxCruise != null ? cr.maxCruise : 900;
    candidate = clamp(candidate, lo, hi);

    var cur = u.cruiseSpeed || lo;
    // 只在候选值明显更高时才提升，且平滑过渡，避免一次异常速度把基准拉爆。
    // 低候选值直接忽略 —— 绝不下调（下调会形成棘轮式衰减）。
    if (candidate > cur) {
      u.cruiseSpeed = clamp(cur * 0.6 + candidate * 0.4, cur, hi);
    }
  },

  /** 把单位夹回擂台内。技能生成分身/位移后必须调用，否则会露到场外。 */
  clampToArena: function (u) {
    u.x = clamp(u.x, u.r, this.arena - u.r);
    u.y = clamp(u.y, u.r, this.arena - u.r);
    return u;
  },

  /* =======================================================================
   * 摄像机
   * -----------------------------------------------------------------------
   * global 模式：视野 = 整个擂台（zoom 1，不位移）
   * follow 模式：放大跟随某个角色，但目标靠近墙边时自动拉远，
   *              这样既能看清角色细节，又能保留全局态势 —— 也就是
   *              "不完全跟随"：镜头不会硬顶在墙上，而是往回缩。
   * ======================================================================= */

  /** 切换摄像机模式 */
  setCameraMode: function (mode, target) {
    var cm = this.cfg.camera;
    this.cam.mode = mode === "follow" ? "follow" : "global";
    if (target) this.cam.targetId = target.uid;
    if (this.cam.mode === "follow" && !this.getCamTarget()) {
      this.pickCamTarget();
    }
    if (this.cam.mode === "global") {
      // 回到全局视野：立刻复位，避免缓慢回弹的拖影
      this.cam.zoom = 1;
      this.cam.x = this.arena / 2;
      this.cam.y = this.arena / 2;
    }
    cm.mode = this.cam.mode;
    return this.cam.mode;
  },

  /** 取当前跟随目标；目标死了就换人 */
  getCamTarget: function () {
    var id = this.cam.targetId;
    if (!id) return null;
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (u.uid === id) {
        if (u.alive) return u;
        // 阵亡：如果开了自动接管，换个活人继续跟
        if (this.cfg.camera.followNextOnDeath) return null;
        return null;
      }
    }
    return null;
  },

  /** 挑一个存活角色作为跟随目标（优先血量高/离中心近的，画面更稳） */
  pickCamTarget: function () {
    var best = null, bs = -Infinity;
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (!u.alive || u.isClone) continue;
      var d = Math.hypot(u.x - this.arena / 2, u.y - this.arena / 2);
      var s = -d + (u.hp / u.stats.hp) * 200;
      if (s > bs) { bs = s; best = u; }
    }
    this.cam.targetId = best ? best.uid : null;
    return best;
  },

  /** 被跟随的角色是否已阵亡（阵亡后会自动接管下一个） */
  camTargetDead: function () {
    var id = this.cam.targetId;
    if (!id) return true;
    for (var i = 0; i < this.units.length; i++) {
      if (this.units[i].uid === id) return !this.units[i].alive;
    }
    return true;
  },

  /** 点选跟随目标（按屏幕坐标找最近的角色） */
  pickCamTargetAt: function (x, y) {
    var best = null, bd = Infinity;
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (!u.alive) continue;
      var d = Math.hypot(u.x - x, u.y - y);
      if (d < bd) { bd = d; best = u; }
    }
    if (best && bd < best.r + 40) {
      this.cam.targetId = best.uid;
      if (this.cam.mode !== "follow") this.setCameraMode("follow");
      return best;
    }
    return null;
  },

  /**
   * 每帧推进摄像机。
   *
   * 跟随模式的设计（按需求刻意「不做动态缩放」）：
   *   1. 缩放恒定 = followZoom，全程不变 —— 画面不会忽远忽近，这是防晕的关键
   *   2. 镜头在擂台范围内平移。角色贴近墙边时镜头被边界夹住、不再硬跟，
   *      于是角色自然偏离画面中心，而镜头相对角色更靠向地图中心，
   *      既跟住了角色，又保留了更多全局视野（能看到另一侧的战场）。
   */
  updateCamera: function (dt) {
    var cm = this.cfg.camera;
    var cam = this.cam;
    var A = this.arena;

    if (cam.mode !== "follow") {
      cam.zoom = 1;
      cam.x = A / 2;
      cam.y = A / 2;
      return;
    }

    var t = this.getCamTarget();
    if (!t) {
      t = this.pickCamTarget();
      if (!t) {            // 场上没人了，退回全局
        cam.zoom = 1;
        cam.x = A / 2;
        cam.y = A / 2;
        return;
      }
    }

    // --- 1. 固定缩放：立即生效，不做插值动画（缩放动画最容易致晕） ---
    // 允许小于 1：拉远后能看到擂台外的外层背景，视野更大气。
    var zMin = cm.zoomMin != null ? cm.zoomMin : 0.5;
    var zMax = cm.zoomMax != null ? cm.zoomMax : 3;
    var zoom = clamp(cm.followZoom || 1.5, zMin, zMax);

    // --- 2. 前瞻：按速度预判，避免快速移动的角色冲到画面边缘 ---
    var tx = t.x + t.vx * cm.leadFactor * 0.5;
    var ty = t.y + t.vy * cm.leadFactor * 0.5;

    // --- 3. 边界夹取 ---
    // 分两种情况，但可以写成同一个式子：
    //   zoom > 1（视野比擂台小）：镜头夹在擂台内 → 视野框不越界，
    //                              角色贴墙时镜头停住、角色偏离中心
    //   zoom < 1（视野比擂台大）：镜头夹在"能装下整个擂台"的范围内 →
    //                              镜头仍可跟随移动，但擂台不会被推出画面
    // 关键：half > A/2 时不能简单把镜头锁在正中，否则缩放 <1 就完全不动了。
    var half = A / (2 * zoom);
    var pad = Math.max(0, cm.edgePadding || 0);
    var lo = Math.min(half, A - half) - pad;
    var hi = Math.max(half, A - half) + pad;
    tx = clamp(tx, lo, hi);
    ty = clamp(ty, lo, hi);

    // --- 4. 指数平滑平移：帧率无关，避免镜头抖动 ---
    var k = 1 - Math.pow(0.0001, dt * (cm.smooth / 10));
    cam.zoom = zoom;
    cam.x = lerp(cam.x, tx, k);
    cam.y = lerp(cam.y, ty, k);
  },

  /**
   * 接触伤害结算。
   * 角色的 contact.damage 是「参考速度下的伤害」，实际按冲击速度缩放。
   * contact.damage = 0 或 type = "none" 表示碰到不掉血。
   */
  resolveContact: function (a, b, impactSpeed, nx, ny) {
    var cc = this.cfg.movement.contact;
    if (!cc.enabled) return;
    if (impactSpeed < cc.minImpactSpeed) return;

    var scale = impactSpeed / cc.referenceSpeed;
    var now = this.time;
    var pairKey = a.uid < b.uid ? a.uid + ":" + b.uid : b.uid + ":" + a.uid;

    // 同一对角色有冷却，避免贴在一起每帧狂扣
    if (!this._contactCd) this._contactCd = {};
    var last = this._contactCd[pairKey] || -99;
    if (now - last < cc.cooldown) return;
    this._contactCd[pairKey] = now;

    this.applyContactDamage(a, b, scale, nx, ny, cc);
    this.applyContactDamage(b, a, scale, -nx, -ny, cc);
  },

  applyContactDamage: function (src, tgt, scale, nx, ny, cc) {
    var c = src.tpl.contact;
    if (!c || c.type === "none" || !c.damage) return;

    var dmg = clamp(c.damage * scale * (cc.damageScale || 1), cc.minDamage, cc.maxDamage) * this.dmgMul;
    if (dmg <= 0) return;

    // 动量已由冲量处理，不再额外击退；飘字按碰撞速度分级
    var res = this.damage(src, tgt, dmg, { kx: 0, ky: 0, kind: "contact", scale: scale });
    if (res > 0) {
      this.fx.burst(tgt.x, tgt.y, 5, src.color, 1.1);
      this.fx.slash(tgt.x - nx * tgt.r, tgt.y - ny * tgt.r,
        tgt.x + nx * tgt.r, tgt.y + ny * tgt.r, src.color);
      if (scale > 1.4) {
        this.popText(tgt.x, tgt.y - 30, "撞击 ×" + scale.toFixed(1), "#ffd25e");
        this.shake(4);
      }
    }
  },

  /* =======================================================================
   * 主动模式（旧版 AI，保留用于对比）
   * ======================================================================= */
  stepUnitActive: function (u, dt, alive) {
    var ph = this.cfg.physics;
    var frozen = u.freeze > 0 || u.stun > 0;
    var ax = 0, ay = 0, i, o, dx, dy, d;

    // 鼠标推挤
    if (this.mouse) {
      dx = u.x - this.mouse.x; dy = u.y - this.mouse.y;
      d = Math.hypot(dx, dy);
      if (d < ph.mouseRadius && d > 0.001) {
        var f = (1 - d / ph.mouseRadius) * ph.mouseForce;
        ax += dx / d * f; ay += dy / d * f;
      }
    }

    if (!frozen) {
      var t = u.target;
      if (t) {
        dx = t.x - u.x; dy = t.y - u.y;
        d = Math.hypot(dx, dy) || 1;
        var range = u.r + t.r + 4;
        var ideal = u.tpl.shape === "tri" ? range + 6 : range - 2;
        var dirS = d > ideal ? 1 : -1;
        ax += dx / d * dirS * 900;
        ay += dy / d * dirS * 900;
        u.dir = Math.atan2(dy, dx);

        // 普攻
        if ((d <= range + 6 || (u.dashHit && d <= 74)) && u.atkCd <= 0 && u.stun <= 0) {
          u.atkCd = this.cfg.combat.attackInterval / (1 + (u.rage > 0 ? this.cfg.combat.rageRateBonus : 0));
          var dmg = u.stats.atk * (1 + (1 - u.hp / u.stats.hp) * this.cfg.combat.lowHpDamageBonus) * (u.rageBonus || 1);
          this.damage(u, t, dmg * this.dmgMul, { kx: 130, ky: 130 });
          if (u.tpl.onHit) u.tpl.onHit(u, t, this);
          this.fx.slash(u.x, u.y, t.x, t.y, u.color);
        }
      } else {
        // 无目标：往圈中心走
        u.wander += dt * 1.4;
        var wa = Math.atan2(this.softY - u.y, this.softX - u.x) + Math.sin(u.wander) * 0.6;
        ax += Math.cos(wa) * 500; ay += Math.sin(wa) * 500;
      }

      // 别跑出安全区
      d = Math.hypot(u.x - this.softX, u.y - this.softY);
      if (d > this.softR * ph.edgePushStart) {
        var ea = Math.atan2(this.softY - u.y, this.softX - u.x);
        var urgency = clamp((d - this.softR * ph.edgePushStart) / (this.softR * 0.3), 0, 1);
        ax += Math.cos(ea) * ph.edgePush * urgency;
        ay += Math.sin(ea) * ph.edgePush * urgency;
      }

      // 互相避让
      for (i = 0; i < alive.length; i++) {
        o = alive[i];
        if (o === u) continue;
        dx = u.x - o.x; dy = u.y - o.y;
        var d2 = dx * dx + dy * dy;
        var rr = (u.r + o.r) * 1.25;
        if (d2 < rr * rr && d2 > 0.01) {
          var dd = Math.sqrt(d2);
          var ff = (1 - dd / rr) * ph.crowdPush;
          ax += dx / dd * ff; ay += dy / dd * ff;
        }
      }
    }

    u.atkCd = Math.max(0, u.atkCd - dt);

    var speedMul = (u.rage > 0 ? 1 + this.cfg.combat.rageSpeedBonus : 1) *
      (u.slow > 0 ? this.cfg.combat.slowFactor : 1) *
      (u.freeze > 0 ? 0 : 1);
    var accel = ph.accel * this.aiMul * speedMul;
    u.vx += clamp(ax, -accel, accel) * dt;
    u.vy += clamp(ay, -accel, accel) * dt;
  },

  integrateActive: function (u, dt, alive) {
    var ph = this.cfg.physics, c = this.cfg.combat;
    var maxSpd = u.stats.spd * (u.rage > 0 ? 1.5 : 1) *
      (u.slow > 0 ? c.slowFactor : 1) *
      (u.stun > 0 ? c.stunSpeedFactor : 1);
    var sp = Math.hypot(u.vx, u.vy);
    if (sp > maxSpd) { var k = maxSpd / sp; u.vx *= k; u.vy *= k; }

    var drag = Math.pow(ph.dragBase, dt);
    u.vx *= drag; u.vy *= drag;
    u.x += u.vx * dt;
    u.y += u.vy * dt;

    for (var iter = 0; iter < ph.separationIter; iter++) {
      u.x = clamp(u.x, u.r, this.arena - u.r);
      u.y = clamp(u.y, u.r, this.arena - u.r);
      for (var i = 0; i < alive.length; i++) {
        var o = alive[i];
        if (o === u) continue;
        var dx = o.x - u.x, dy = o.y - u.y;
        var d = Math.hypot(dx, dy);
        var min = u.r + o.r;
        if (d < min && d > 0.0001) {
          var overlap = (min - d) * 0.5;
          dx /= d; dy /= d;
          u.x -= dx * overlap; u.y -= dy * overlap;
          o.x += dx * overlap; o.y += dy * overlap;
          var rvx = o.vx - u.vx, rvy = o.vy - u.vy;
          var vn = rvx * dx + rvy * dy;
          if (vn < 0) {
            var imp = vn * ph.restitution;
            u.vx += dx * imp; u.vy += dy * imp;
            o.vx -= dx * imp; o.vy -= dy * imp;
          }
          // 推开后双方都要夹回场内，否则会互相顶出边界
          u.x = clamp(u.x, u.r, this.arena - u.r);
          u.y = clamp(u.y, u.r, this.arena - u.r);
          o.x = clamp(o.x, o.r, this.arena - o.r);
          o.y = clamp(o.y, o.r, this.arena - o.r);
        }
      }
    }
  },

  stepProjectiles: function (dt) {
    var A = this.arena;
    for (var i = this.projectiles.length - 1; i >= 0; i--) {
      var p = this.projectiles[i];
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.spin) p.rot = (p.rot || 0) + p.spin * dt;
      this.fx.trail(p.x, p.y, p.color, p.r * 0.5);

      var hit = false;
      for (var k = 0; k < this.units.length; k++) {
        var u = this.units[k];
        if (!u.alive || u === p.owner) continue;
        // 分身不伤害自己的本体
        if (p.owner && p.owner.isClone && u.uid === p.owner.ownerId) continue;
        // 也不伤害自己召唤出来的单位：本体投出的球不该砸到自己的分身
        if (p.owner && u.ownerId && u.ownerId === p.owner.uid) continue;
        var dx = u.x - p.x, dy = u.y - p.y;
        if (dx * dx + dy * dy < (u.r + p.r) * (u.r + p.r)) {
          this.damage(p.owner, u, p.dmg, { kx: 150, ky: 150 });
          hit = true;
          break;
        }
      }

      if (!hit) {
        /* ---- 撞墙 ----
         * p.bounce 为剩余反弹次数（Infinity = 一直弹，直到撞到人）。
         * 没设 bounce 的投射物保持旧行为：出界即消失。 */
        if (p.bounce) {
          var bounced = false;
          if (p.x - p.r < 0) { p.x = p.r; if (p.vx < 0) { p.vx = -p.vx; bounced = true; } }
          else if (p.x + p.r > A) { p.x = A - p.r; if (p.vx > 0) { p.vx = -p.vx; bounced = true; } }
          if (p.y - p.r < 0) { p.y = p.r; if (p.vy < 0) { p.vy = -p.vy; bounced = true; } }
          else if (p.y + p.r > A) { p.y = A - p.r; if (p.vy > 0) { p.vy = -p.vy; bounced = true; } }
          if (bounced) {
            if (p.bounce !== Infinity) p.bounce--;
            // 可选能量损失（默认 1 = 完全弹性，速度不变）
            var damp = p.bounceDamp != null ? p.bounceDamp : 1;
            if (damp !== 1) { p.vx *= damp; p.vy *= damp; }
            if (p.onBounce) p.onBounce(p, this);
            else this.fx.burst(p.x, p.y, 3, p.color, 0.7);
          }
        } else if (p.x < 0 || p.y < 0 || p.x > A || p.y > A) {
          hit = true;
        }
      }

      if (p.life <= 0 || hit) {
        if (p.onHit) p.onHit(p, this);
        else this.fx.burst(p.x, p.y, 6, p.color, 1);
        this.projectiles.splice(i, 1);
      }
    }
  },

  checkEnd: function () {
    var real = [];
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (u.alive && !u.isClone) real.push(u);
    }
    if (real.length <= 1 && this.picks.length > 1) {
      this.finish(real[0] || null, "最后幸存");
    } else if (this.time > this.cfg.match.timeLimit) {
      var best = null, bs = -Infinity;
      for (var k = 0; k < real.length; k++) {
        var u2 = real[k];
        var s = (u2.hp / u2.stats.hp) * 1000 + u2.kills * 120 + u2.dmgDone * 0.05;
        if (s > bs) { bs = s; best = u2; }
      }
      this.finish(best, "超时判定");
    }
  },

  finish: function (winner, reason) {
    if (this.over) return;
    this.over = true;
    this.overT = 0;
    this.winner = winner;
    this.shake(14);
    if (winner) {
      this.log("🏆 <b>" + winner.name + "</b> 获得胜利！（" + reason + "）击杀 " +
        winner.kills + " · 输出 " + Math.round(winner.dmgDone));
    } else {
      this.log("本局平局，无人存活。");
    }
    /* 结算音效：优先用获胜角色的 victory 音效，没有就用内置号角；
     * 平局（无人胜出）放另一个下行音，听起来就能区分。 */
    if (window.MA.Audio) {
      if (winner) window.MA.Audio.play(winner.tpl.id, "victory", "victory");
      else window.MA.Audio.play(null, "draw", "draw");
    }
  },

  aliveCount: function () {
    var n = 0;
    for (var i = 0; i < this.units.length; i++) {
      if (this.units[i].alive && !this.units[i].isClone) n++;
    }
    return n;
  }
};

/* 暴露到 MA 命名空间，方便外部工具 / 无头测试使用 */
window.MA.World = World;
window.MA.makeFx = makeFx;
