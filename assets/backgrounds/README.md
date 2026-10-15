# 战场背景

背景是**三层**结构，每层都能独立调 缩放 / 偏移 / 透明度 / 模糊：

```
┌───────────────────────────────────────────┐
│  外层 outer（铺满擂台之外的所有区域）        │
│   ┌─────────────────────────────────┐     │
│   │  边框 border（夹在内外之间的一条带）│    │
│   │   ┌───────────────────────┐      │     │
│   │   │  内层 inner（擂台方块）  │      │     │
│   │   └───────────────────────┘      │     │
│   └─────────────────────────────────┘     │
└───────────────────────────────────────────┘
```

| 层 | 覆盖范围 | 什么时候能看到 |
|---|---|---|
| **外层** | 擂台之外的一整片 | 镜头缩小（<1×）或贴边越界时 |
| **边框** | 夹在内外之间的环带，**厚度可调** | 一直可见（厚度为 0 时不可见） |
| **内层** | 正方形擂台本身 | 一直可见 |

外层的核心作用是**消除黑边**：镜头拉远或顶到墙边时露出的是外层，而不是画布黑底。
外层的图案锚定世界原点绘制，所以镜头移动时花纹不会粘在屏幕上。

边框层适合做发光灯带、警戒线、装饰描边。`thickness` 就是这一层显示的范围。

## 三层都能调的参数

| 参数 | 说明 |
|---|---|
| **缩放 `scale`** | 纹理对齐用：花纹接缝错位时调它 |
| **偏移 `offsetX/Y`** | 同样用于纹理对齐（世界像素） |
| **透明度 `opacity`** | 0 ~ 1 |
| **模糊 `blur`** | 高斯模糊半径（像素），可柔化贴图 |

在网页右侧「三层背景」面板里可以直接拖滑块调，也能改 `data/config.js`。

## 用界面换图

1. 右侧「三层背景」→ 切到想换的那层 → 点「给该层换图」。
2. 内层也可以直接点「选择擂台图」。
3. 图片会保存在当前浏览器的本地 IndexedDB（内层），刷新后仍然保留，不会上传。
4. 「该层恢复默认」会同时清掉内存里的图片并还原参数。

## 用项目文件作为默认背景

把图片放到此目录，例如：

```
assets/backgrounds/arena.webp     ← 内层：擂台方块
assets/backgrounds/border.webp    ← 边框：环带纹理
assets/backgrounds/outer.webp     ← 外层：擂台之外
```

然后在 `data/config.js` 设置：

```js
render: {
  background: {
    /* 内层：擂台方块 */
    preset: "neon",
    src: "assets/backgrounds/arena.webp",
    fit: "cover",                         // cover / contain / stretch
    overlay: 0.40,                         // 暗色遮罩强度 0 ~ 1

    inner: {                               // 内层
      enabled: true, opacity: 1, scale: 1, offsetX: 0, offsetY: 0,
      blur: 0, vignette: 0.42
    },

    border: {                              // 边框层
      enabled: true,
      thickness: 26,                       // ★ 显示范围（世界像素）
      style: "glow",                       // glow/solid/stripes/dashes/grid
      src: "assets/backgrounds/border.webp", fit: "stretch",
      color: "", color2: "",               // 留空 = 跟随主题
      opacity: 1, scale: 1, offsetX: 0, offsetY: 0, blur: 0,
      glow: 10, pulse: 0.35                // 向外发光 / 呼吸脉动
    },

    outer: {                               // 外层
      preset: "auto",                      // auto = 跟随主题
      color: "", src: "assets/backgrounds/outer.webp", fit: "cover",
      pattern: "grid",                     // ★ grid/dots/rings/checks/diagonal/cross/none
      patternColor: "", patternScale: 46, patternWidth: 1.2,
      opacity: 1, overlay: 0.42,
      scale: 1, offsetX: 0, offsetY: 0, blur: 0,
      glow: true, margin: 0.6
    }
  }
}
```

**素材建议**

- **内层**：至少 720×720、深色或低对比度、主体不要放在边缘。
- **边框**：会被拉伸成环带，建议用可平铺的纹理（`fit: "stretch"`）。
- **外层**：铺在场地外的一大片，建议低对比度纹理或纯色渐变。
  不想用图片就只留 `pattern` 图案，默认就是这种。

支持 PNG、JPG、WEBP 和 GIF。背景仅用于视觉，不影响擂台碰撞和安全区。
GIF 会由浏览器播放；如果要精确暂停/变速，使用静态图更合适。

## 性能建议

- 每层各有一份离屏缓存，缓存键包含该层全部参数，
  所以拖滑块只在变化时重建一次，正常帧每层只贴一次图。
- 内层控制在 12 MB 以内，推荐 WebP / JPEG。
- 模糊用 `ctx.filter` 在离屏画布上完成，不会拖慢正常帧。
- 页签切到后台时游戏会暂停渲染循环，回到页面后继续，减少空转占用。
