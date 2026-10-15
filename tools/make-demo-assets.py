"""生成演示素材，用于验证「贴图 / 动图 / 音效」管线真的能用。
跑一次即可：python tools/make-demo-assets.py
想清空演示素材：python tools/make-demo-assets.py --clean
"""
import math
import os
import struct
import sys
import wave

from PIL import Image, ImageDraw

# Windows 控制台默认是 GBK，直接 print 中文/符号会抛 UnicodeEncodeError
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHARS = os.path.join(ROOT, "assets", "characters")

# 演示用的两个角色：一个用静态图 + 音效，一个用 GIF 动图
DEMOS = {
    "moyu": "#5aa9ff",     # 摸鱼打工人：静态 PNG 多状态 + 音效
    "kunkun": "#ffb03a",   # 打篮球的坤坤：GIF 动图
}
SIZE = 128


def rounded(draw, box, r, fill, outline=None, width=3):
    draw.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def face(draw, cx, cy, r, color, mood="happy"):
    """在给定位置画一张简单的脸，保持透明背景"""
    dark = "#0b1020"
    ex = r * 0.30
    ey = -r * 0.10
    for sx in (-1, 1):
        draw.ellipse([cx + sx * ex - r * 0.11, cy + ey - r * 0.13,
                      cx + sx * ex + r * 0.11, cy + ey + r * 0.13], fill=dark)
    if mood == "happy":
        draw.arc([cx - r * 0.32, cy + r * 0.10, cx + r * 0.32, cy + r * 0.52],
                 20, 160, fill=dark, width=max(3, int(r * 0.09)))
    elif mood == "hurt":
        draw.arc([cx - r * 0.30, cy + r * 0.30, cx + r * 0.30, cy + r * 0.62],
                 200, 340, fill=dark, width=max(3, int(r * 0.09)))
    else:  # 攻击：张嘴
        draw.ellipse([cx - r * 0.20, cy + r * 0.18, cx + r * 0.20, cy + r * 0.50], fill=dark)


def make_body(color, mood="happy", squash=1.0, lean=0.0, fish=False):
    """画一个带透明背景的角色图"""
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy = SIZE / 2 + lean, SIZE / 2 + 6
    r = SIZE * 0.34 * squash

    # 外发光
    for i in range(8, 0, -1):
        a = int(10 + i * 3)
        d.ellipse([cx - r - i * 1.8, cy - r - i * 1.8, cx + r + i * 1.8, cy + r + i * 1.8],
                  fill=(int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16), a))
    # 本体
    rounded(d, [cx - r, cy - r, cx + r, cy + r], int(r * 0.45), fill=color,
            outline="#ffffff", width=max(2, int(r * 0.09)))
    # 高光
    d.ellipse([cx - r * 0.55, cy - r * 0.72, cx - r * 0.10, cy - r * 0.34],
              fill=(255, 255, 255, 90))
    face(d, cx, cy, r, color, mood)

    if fish:   # 摸鱼打工人：手上拎条鱼
        fx, fy = cx + r * 0.95, cy + r * 0.15
        d.ellipse([fx - r * 0.34, fy - r * 0.16, fx + r * 0.34, fy + r * 0.16],
                  fill="#cfe8ff", outline="#ffffff", width=2)
        d.polygon([(fx + r * 0.30, fy), (fx + r * 0.58, fy - r * 0.18),
                   (fx + r * 0.58, fy + r * 0.18)], fill="#cfe8ff")
        d.ellipse([fx - r * 0.22, fy - r * 0.06, fx - r * 0.14, fy + r * 0.02], fill="#0b1020")
    return img


def save_png(img, *parts):
    path = os.path.join(CHARS, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG")
    return path


def save_gif(frames, path, duration=110):
    """备用：也可以导出 GIF。不过更推荐序列帧——由游戏循环驱动，
    能和攻击/受击动作精确同步，而且可以在无头环境里自动化测试。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    frames[0].save(path, "GIF", save_all=True, append_images=frames[1:],
                   duration=duration, loop=0, disposal=2, transparency=0)
    return path


def write_wav(path, freq_start, freq_end, seconds, kind="sine"):
    """生成一段简单音效，用来验证音频管线"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    rate = 22050
    n = int(rate * seconds)
    frames = bytearray()
    for i in range(n):
        t = i / rate
        k = i / max(1, n - 1)
        f = freq_start + (freq_end - freq_start) * k
        env = min(1.0, t / 0.008) * (1 - k) ** 1.6          # 快速起音 + 衰减
        ph = 2 * math.pi * f * t
        if kind == "square":
            v = 1.0 if math.sin(ph) >= 0 else -1.0
        elif kind == "saw":
            v = 2 * ((f * t) % 1.0) - 1.0
        else:
            v = math.sin(ph)
        s = int(max(-1.0, min(1.0, v * env * 0.5)) * 32767)
        frames += struct.pack("<h", s)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return path


def clean():
    import glob
    removed = 0
    for cid in DEMOS:
        for pattern in ("*.png", "*.gif", "sfx/*.wav"):
            for f in glob.glob(os.path.join(CHARS, cid, pattern)):
                os.remove(f)
                removed += 1
                print("  删除 " + os.path.relpath(f, ROOT))
    print("\n已清理 " + str(removed) + " 个演示素材")

def main():
    if "--clean" in sys.argv:
        clean()
        return

    print("生成演示素材 → assets/characters/\n")

    # ---------- 摸鱼打工人：静态 PNG 多状态 + 音效 ----------
    cid = "moyu"
    col = DEMOS[cid]
    files = []
    files.append(save_png(make_body(col, "happy", 1.0, 0, fish=True), cid, "idle.png"))
    files.append(save_png(make_body(col, "attack", 1.10, -4, fish=True), cid, "attack.png"))
    files.append(save_png(make_body(col, "hurt", 0.92, 5), cid, "hurt.png"))
    files.append(save_png(make_body(col, "hurt", 0.85, 0), cid, "dead.png"))
    files.append(save_png(make_body(col, "happy", 0.80, 0, fish=True), cid, "icon.png"))
    files.append(save_png(make_body(col, "attack", 1.25, 0), cid, "skill.png"))
    files.append(write_wav(os.path.join(CHARS, cid, "sfx", "attack.wav"), 380, 150, 0.10, "square"))
    files.append(write_wav(os.path.join(CHARS, cid, "sfx", "skill.wav"), 500, 1100, 0.26, "sine"))
    for f in files:
        print("  ✓ " + os.path.relpath(f, ROOT))

    # ---------- 打篮球的坤坤：序列帧动画（推荐做法，比 GIF 可控可测） ----------
    cid = "kunkun"
    col = DEMOS[cid]
    for i in range(8):
        k = i / 8 * 2 * math.pi
        frame = make_body(col, "happy", 1.0 + 0.07 * math.sin(k), 6 * math.sin(k))
        p = save_png(frame, cid, "idle_%02d.png" % (i + 1))
        print("  ✓ " + os.path.relpath(p, ROOT))
    # 攻击动作也来两帧，演示“不同状态播不同序列”
    for i in range(2):
        p = save_png(make_body(col, "attack", 1.12 + i * 0.05, -6 + i * 8),
                     cid, "attack_%02d.png" % (i + 1))
        print("  ✓ " + os.path.relpath(p, ROOT))

    # 静态头像，验证同一角色混用序列帧与静态图
    ico = save_png(make_body(col, "happy", 0.80, 0), cid, "icon.png")
    print("  ✓ " + os.path.relpath(ico, ROOT))

    print("\n接下来执行：node tools/scan-assets.js")
    print("然后刷新页面，这两个角色就会显示成贴图 / 序列帧动画了。")
    print("不想要演示素材：python tools/make-demo-assets.py --clean")


if __name__ == "__main__":
    main()
