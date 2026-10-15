/* =========================================================================
 * data/config.js —— 全局可调参数（不是角色数据，角色在 data/characters.js）
 * 改完保存，刷新页面即可生效。
 * ========================================================================= */
window.MA = window.MA || {};

window.MA.CONFIG = {

  /* ---------- 比赛规则 ---------- */
  match: {
    timeLimit: 95,        // 超时判定秒数
    autoRestartDelay: 4.6,// 分出胜负后自动重开等待秒数
    minFighters: 2,       // 最少参战人数
    defaultPicks: 8       // 首次进入时随机抽取的人数
  },

  /* ---------- 擂台 / 缩圈 ---------- */
  arena: {
    safeZoneStart: 0.92,  // 开局安全区半径 = 擂台边长 × 该比例
    safeZoneMin: 0.34,    // 安全区最小半径比例（别缩太小，否则全场都在圈外）
    shrinkRate: 0.011,    // 每秒收缩比例（再乘以界面上的“缩圈速度”）
    shrinkCapSeconds: 70, // 收缩计算的时间上限
    poisonBase: 5,        // 圈外基础每秒伤害
    poisonRamp: 0.05,     // 圈外每秒伤害随时间的增长量（温和，避免毒圈成为主要死因）

    /* ---- 安全区总开关与圈外视觉效果（都可在侧栏实时调） ---- */
    /* zoneEnabled = false 时：没有缩圈、没有圈外伤害、没有任何圈特效，
     * 退化成纯擂台混战（圈外滤镜与边界线也会一起消失）。 */
    zoneEnabled: true,

    /* 圈外滤镜：整个"圈外区域"的视觉效果 */
    poisonFx: {
      enabled: true,      // 圈外滤镜总开关
      color: "#ff3c50",   // 主色（暗红）
      color2: "#7a0b28",  // 次色（更深的边缘色）
      opacity: 0.16,      // ★ 圈外填充透明度 0 ~ 1
      gradient: true,     // 由内向外渐变加深（观感更"毒"）
      scanlines: true,    // 扫描线纹理
      scanOpacity: 0.30,  // 扫描线强度 0 ~ 1
      noise: true,        // 噪点颗粒
      noiseOpacity: 0.22, // 噪点强度 0 ~ 1
      blurEdges: 6,       // 边界内侧柔化宽度（世界像素），0 = 硬边
      pulse: 0.35         // 呼吸脉动强度 0 ~ 1
    },

    /* 安全区边界线 */
    zoneRing: {
      enabled: true,
      color: "#ff5a6e",   // 边界主色
      width: 2.5,         // 线宽
      opacity: 0.78,      // 透明度
      glow: 8,            // 外发光
      pulse: 0.22,        // 脉动强度
      showNext: false     // 是否显示"下一个圈"的预告虚线
    },

    /* ---- 残局加速缩圈 ----
     * 决胜段墨迹的真正原因：1v1 时两人「贴在一起」的时间占比只有 0%，
     * 35% 的时间相距 400px 以上 —— 他们只是不碰面，不是速度慢。
     * 所以除了提速，还要把圈收快一点把人逼到中间。
     * 实测（tools/_exp-final.js，60 局）：P90 从 46s → 25s，平均 19.4s → 15.9s，
     * 同时毒圈致死占比仍只有 0.6%（不会变成"毒死"而不是"打死"）。
     * 同 endgameBoost：开局人数 < minField 的小场不启用。 */
    endgameShrink: {
      enabled: true,
      minField: 6,
      tiers: [
        { maxAlive: 2, mul: 2.0 },
        { maxAlive: 3, mul: 2.0 },
        { maxAlive: 5, mul: 1.3 }
      ]
    }
  },

  /* ---------- 角色显示尺寸 ---------- */
  /* 只影响「画多大」，不影响物理：碰撞半径、质量、伤害判定都走 radius，
   * 所以放大角色不会改变平衡性，纯粹是看得更清楚。 */
  display: {
    unitScale: 2.0,        // ★ 角色整体放大倍数（1 = 原始大小）
    hpBarScale: 2.0,       // ★ 血条放大倍数（跟随角色一起放大）
    hpBarShowValue: true,  // ★ 血条内显示当前血量（只显示当前值，不写成 当前/上限）
    hpBarMinWidth: 46,     // 血条最小宽度（屏幕像素，避免小角色看不清数字）
    hpBarFontSize: 12,     // 血量数字字号
    hpBarThickness: 11     // 血条厚度（放大后的基准）
  },

  /* ---------- 战斗手感 ---------- */
  combat: {
    damageMul: 1,         // 界面“伤害倍率”的默认值
    aiMul: 1,             // 界面“角色智商”的默认值
    defScale: 2.8,        // 防御减伤系数：减伤 = 100 / (100 + 防御 × defScale)
    attackInterval: 0.92, // 基础普攻间隔（秒）
    lowHpDamageBonus: 0.25,// 残血伤害加成上限
    rageSpeedBonus: 0.5,  // 狂暴（rage）时的移速加成
    rageRateBonus: 0.55,  // 狂暴时的攻速加成
    slowFactor: 0.5,      // 被减速时的速度倍率
    stunSpeedFactor: 0.35,// 眩晕时残余移速
    invulnDamageFactor: 0.25, // 无敌帧期间受到的伤害比例
    knockbackMass: 0.05,  // 防御对击退的抵抗系数
    healDecayStart: 12,   // 从第几秒开始治疗衰减
    healDecayRate: 0.022, // 治疗衰减速度
    healDecayMin: 0.3,    // 治疗衰减下限
    maxUnits: 42          // 场上单位硬上限（含分身）
  },

  /* ---------- 移动模式 ---------- */
  /* mode: "momentum" 碰撞弹跳（默认，无主动追击）
   *       "active"   旧版主动追击 AI（保留可切换对比）
   *
   * 动量模式下角色不再自己找目标走位，只靠初速度运动：
   *   · 撞墙 / 撞人 用「恢复系数」决定弹性：
   *       restitution = 0   完全非弹性（法向速度按动量守恒合并，能量损失最大）
   *       restitution = 1   完全弹性（速度完全反弹）
   *   · 接触是否造成伤害由角色自己的 contact 字段决定（见 characters.js） */
  movement: {
    mode: "momentum",

    initialSpeed: 380,       // 开局初速度基准（像素/秒）
    speedFromStat: true,     // 用角色的 spd 缩放初速，快的角色开局更快
    initialSpeedJitter: 0.22,// 初速随机浮动比例，避免开局太整齐
    drag: 1,                 // 每秒速度衰减系数：1 = 无阻力（动量守恒）

    wallRestitution: 1,      // 撞墙恢复系数：1 = 完全弹性（不掉速）
    unitRestitution: 0.15,   // 角色间恢复系数：接近完全非弹性，留一点反弹避免黏死
    massFrom: "radius",      // 质量来源：radius | hp | uniform
    tangentialJitter: 0.45,  // 碰撞切向随机量：模拟表面粗糙，避免完全非弹性后全场黏成一团不动
    minSpeed: 170,           // 速度下限，低于它会被温和补足，保证比赛不会静止
    maxSpeed: 1100,          // 速度上限，防止技能叠加后飞出宇宙
    solvePasses: 3,          // 每帧碰撞求解迭代次数
    mouseScale: 0.5,         // 鼠标推挤力度系数

    /* ---- 巡航速度模型 ----
     * 角色保持"大致匀速直线"运动：
     *   · 每个单位有一个巡航速度 cruiseSpeed（开局按 spd 定，碰墙后按当前速度刷新）
     *   · 每帧把实际速度「温和地拉回」巡航速度 × 状态倍率
     *   · 减速/眩晕只是把倍率压低，效果结束速度自然恢复，
     *     而不是像以前那样每帧乘衰减系数、把动能永久抽走 */
    cruise: {
      enabled: true,
      recovery: 2.4,        // 每秒朝巡航速度靠拢的比例（越大恢复越快）
      corridor: 0.16,       // 速度落在巡航的 ±16% 内就不再干预（留出碰撞的自然波动）
      refreshOnBounce: 0.85,// 碰墙后按当前速度刷新巡航值，**只升不降**：
                            // 撞得猛 → 巡航变快；撞得慢绝不把巡航值往下拉
      minCruise: 150,       // 巡航速度下限
      maxCruise: 900,       // 巡航速度上限

      /* ---- 残局提速 ----
       * 实测（tools/diag-endgame.js）：整局约 60% 的时间耗在「只剩 ≤3 人」上，
       * 其中 1v1 独占一半。根因不是速度丢了，而是两个人以 ~300px/s 在 720px
       * 的场子里乱弹 —— 1v1 期间「贴在一起」的时间只占 0%，35% 的时间两人
       * 相距 400px 以上，平均 6~11 秒才撞上一次，所以决胜段特别墨迹。
       * 存活越少 → 巡航基准越高，逼出更多碰撞，把残局收干净。
       *
       * tiers 按「存活人数 ≤ 阈值」取第一个命中的倍率。
       * 注意：必须同时满足 minField（开局人数 ≥ 该值）才生效 ——
       * 否则 2 人局从第一帧起就"全场都是残局"，整局被加速 2 倍，
       * 既破坏动量守恒的观感，也让"撞墙完全弹性"这类断言失效。 */
      endgameBoost: {
        enabled: true,
        minField: 6,          // 开局人数少于它就不启用（2~5 人局属于"小场"，本来就是快节奏）
        tiers: [
          { maxAlive: 2, mul: 2.0 },
          { maxAlive: 3, mul: 1.6 },
          { maxAlive: 5, mul: 1.25 }
        ]
      }
    },

    /* 接触伤害（角色 contact 字段的总开关与标定） */
    contact: {
      enabled: true,
      referenceSpeed: 230,   // 冲击速度达到这个值时，伤害 = 角色 contact.damage
      minImpactSpeed: 55,    // 低于此相对速度不结算伤害（轻轻碰一下不算）
      cooldown: 0.20,        // 同一对角色再次受伤的最小间隔（秒）
      minDamage: 2,          // 单次伤害下限
      maxDamage: 46,         // 单次伤害上限，防止高速叠加秒杀
      damageScale: 3.4       // 接触伤害整体倍率：让碰撞成为主要伤害来源
    }
  },

  /* ---------- 移动与物理（仅 active 模式使用） ---------- */
  physics: {
    accel: 1900,          // 基础加速度
    dragBase: 0.0016,     // 阻尼底数（越小越滑）
    separationIter: 2,    // 每帧碰撞分离迭代次数
    restitution: 0.55,    // 弹性碰撞恢复系数
    mouseRadius: 90,      // 鼠标推挤作用半径
    mouseForce: 900,      // 鼠标推挤力度
    crowdPush: 620,       // 单位之间互相避让的力度
    edgePush: 1500,       // 接近圈边时向内的推力
    edgePushStart: 0.82   // 距安全区半径的百分之多少开始往回赶
  },

  /* ---------- 渲染与特效 ---------- */
  render: {
    maxDpr: 2,
    maxArenaPx: 760,
    shakeDecay: 0.85,
    // 注：主循环只用 requestAnimationFrame 驱动，不用 maxFps 做节流。
    // 之前用 setTimeout 限频会与 vsync 产生拍频锁死（帧率卡在 40），已移除。
    rosterUpdateHz: 10,     // 侧栏战况 DOM 更新频率，模拟仍按 60Hz 运行
    /* ===================================================================
     * 背景系统 —— 三层结构，每层都可独立调 缩放 / 透明度 / 模糊
     * -------------------------------------------------------------------
     *   ┌─────────────────────────────────────────┐
     *   │  外层 outer（铺满擂台之外的所有区域）      │
     *   │   ┌───────────────────────────────┐     │
     *   │   │ 边框 border（夹在内外之间的一条带）│   │
     *   │   │  ┌───────────────────────┐    │     │
     *   │   │  │ 内层 inner（擂台方块）  │    │     │
     *   │   │  └───────────────────────┘    │     │
     *   │   └───────────────────────────────┘     │
     *   └─────────────────────────────────────────┘
     *
     * 三层的 scale / offsetX / offsetY 都是给「纹理对齐」用的：
     * 当你换了贴图、发现花纹接缝错位时，用它们微调即可。
     *
     * 注意：这里只是「出厂默认值」。三层参数与当前主题会自动存进
     * localStorage（见 src/settings.js），自选图片存进 IndexedDB
     * （见 src/background.js），刷新后会被存档覆盖。
     * 想恢复出厂设置，用界面上的「恢复默认」。
     * =================================================================== */
    background: {
      /* ---------- 内层：擂台方块 ---------- */
      preset: "neon",      // neon / sunset / ocean / forest / paper
      src: "",             // 可选：项目内背景图，如 assets/backgrounds/arena.webp
      fit: "cover",        // cover / contain / stretch
      overlay: 0.40,       // 暗色遮罩，保证角色与文字清晰
      maxUploadBytes: 12582912, // 自选图片大小上限：12 MiB

      inner: {
        enabled: true,
        opacity: 1,        // 0 ~ 1
        scale: 1,          // 纹理缩放（手动对齐用）
        offsetX: 0,        // 纹理水平偏移（世界像素）
        offsetY: 0,        // 纹理垂直偏移
        blur: 0,           // 高斯模糊半径（像素，0 = 不模糊）
        vignette: 0.42     // 内层暗角强度
      },

      /* ---------- 边框层：夹在内层与外层之间 ---------- */
      border: {
        enabled: true,
        thickness: 26,     // ★ 边框厚度（世界像素）= 这一层显示的范围
        style: "glow",     // glow 发光 / solid 纯色 / stripes 斜纹 / dashes 虚线 / grid 网格
        src: "",           // 可选：用图片当边框纹理
        fit: "stretch",
        color: "",         // 主色（留空 = 跟随主题）
        color2: "",        // 辅色（渐变/图案用）
        opacity: 1,
        scale: 1,          // 纹理缩放
        offsetX: 0,
        offsetY: 0,
        blur: 0,           // 高斯模糊
        glow: 10,          // 向外发光强度（像素，0 = 不发光）
        pulse: 0.35        // 呼吸感强度：0 = 静止，1 = 明显脉动
      },

      /* ---------- 外层：擂台之外的一整片 ---------- */
      outer: {
        preset: "auto",    // auto = 跟随擂台主题自动配深色；也可指定 neon/sunset/...
        color: "",         // 底色（留空则用 preset）
        src: "",           // 外层背景图，如 assets/backgrounds/outer.webp
        fit: "cover",
        pattern: "grid",   // ★ 图案：grid 网格 / dots 点阵 / rings 同心圆
                           //        / checks 棋盘 / diagonal 斜线 / cross 十字 / none 纯色
        patternColor: "",  // 图案颜色（留空 = 按主题自动）
        patternScale: 46,  // 图案间距（世界像素）
        patternWidth: 1.2, // 图案线宽
        opacity: 1,        // 这一层整体的透明度
        overlay: 0.42,     // 暗色遮罩（压暗外层，突出擂台）
        scale: 1,          // 纹理缩放
        offsetX: 0,
        offsetY: 0,
        blur: 0,           // 高斯模糊
        glow: true,        // 外圈光晕（让擂台边界更清楚）
        margin: 0.6        // 向外延伸倍数（相对擂台边长）
      }
    },
    particles: {
      hit: 6, crit: 12, death: 22, puff: 10
    }
  },

  /* ---------- 摄像机 ---------- */
  /* mode: "global" 全局俯视（默认，看到整个擂台）
   *       "follow" 跟随某个角色
   *
   * 跟随模式刻意「不做动态缩放」——缩放倍数是恒定的，画面不会忽远忽近。
   * 镜头只在擂台范围内平移：角色贴近墙边时镜头停在边界处不再硬跟，
   * 于是角色自然偏离画面中心，而镜头相对角色更靠近地图中心，
   * 既跟住了角色，又保留了更多全局视野。 */
  camera: {
    mode: "global",
    followZoom: 0.8,        // 跟随时的固定放大倍数（恒定不变，1 = 不放大）
                            // 默认 0.8：略小于 1，既跟住角色又留出周围视野，
                            // 比 1.5 更容易看清"谁要撞过来"。可在界面实时调，
                            // 并会自动存进 localStorage（见 src/settings.js）。
    zoomMin: 0.5,           // 界面滑块下限（<1 可以拉远，看到擂台外的环境）
    zoomMax: 3,             // 界面滑块上限
    zoomStep: 0.05,         // 界面滑块步进
    edgePadding: 40,        // 贴墙时允许镜头越过边界的余量（世界像素），
                            // 让角色不至于贴死在屏幕边缘；0 = 严格不越界
    smooth: 7.5,            // 镜头跟随平滑度，越大跟得越紧（指数逼近，帧率无关）
    leadFactor: 0.20,       // 按目标速度前瞻的比例，避免目标冲到画面边缘
    followNextOnDeath: true,// 跟随目标阵亡后自动接管下一个存活者
    clickToFollow: true,    // 双击擂台跟随该角色
    showMarker: true        // 给被跟随的角色画标记
  },

  /* ---------- 伤害飘字 ---------- */
  damageNumbers: {
    enabled: true,
    minAmount: 1,           // 小于这个值不显示（过滤无意义的 0.4 伤害）
    maxOnScreen: 40,        // 同屏上限，超出时丢弃最旧的，避免刷屏
    life: 0.85,             // 存活秒数
    rise: 46,               // 每秒上浮像素
    contactColor: "#ffd25e",// 碰撞伤害颜色
    normalColor: "#ffffff", // 普通伤害颜色
    critColor: "#ff8a5c",   // 暴击/大伤害颜色
    critThreshold: 1.35,    // 伤害倍率超过它算"重击"，用暴击色 + 放大
    skillColor: "#9fd8ff"   // 技能伤害颜色
  },

  /* ---------- 音频 ---------- */
  audio: {
    enabled: true,
    volume: 0.55,         // 0 ~ 1
    maxVoices: 4          // 同一个音效同时最多播放几个实例
  },

  /* ---------- 界面 ---------- */
  ui: {
    maxLogLines: 120,
    showTargetLines: true,
    showNames: true
  }
};
