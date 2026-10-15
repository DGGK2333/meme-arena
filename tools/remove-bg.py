#!/usr/bin/env python3
"""=========================================================================
tools/remove-bg.py —— 把纯色背景抠成透明（支持动图）

为什么需要它：角色图必须是**带透明通道**的 PNG/WEBP。JPG 没有 alpha，
白底会变成一个大方块（见 assets/characters/README.md）。

做法：从**四周边框**做洪水填充（flood fill），只把「与边缘相连、
且颜色接近背景色」的像素变透明。
   —— 这一点很关键：不用「全图把所有白色干掉」，
   否则角色身上的白色部分（白衣服、白球鞋、白眼球）会被打出洞。

支持：PNG / JPG / WEBP，**动图会逐帧处理并保留动画与帧时长**。

用法：
  python tools/remove-bg.py <文件或目录> [选项]

选项：
  --out PATH       输出文件/目录（默认：同目录下加 _alpha 后缀）
  --inplace        直接覆盖原文件（会先备份为 .bak）
  --tolerance N    背景色容差 0-255（默认 26；背景越干净可以越小）
  --feather N      边缘收缩像素数，用来吃掉残留的白边（默认 1）
  --scale N        最长边缩放到 N 像素（默认不改；角色图建议 256~384）
  --bg R,G,B       指定背景色（默认自动取四角平均）
  --dry-run        只预览，不写文件

例：
  python tools/remove-bg.py assets/characters/ikun/idle.webp --scale 384
  python tools/remove-bg.py assets/characters/ikun --inplace
=========================================================================="""
import argparse
import os
import shutil
import sys
from collections import deque

from PIL import Image, ImageDraw

IMG_EXT = (".png", ".webp", ".jpg", ".jpeg", ".bmp", ".gif")


def detect_bg_colors(im, tol, override=None):
    """探测背景色。

    只取一个「平均色」是不够的：很多图导出来时带**棋盘格**的"透明"底纹
    （浅灰 + 白交替），单一颜色只能匹配到其中一半，另一半会残留。
    所以这里沿四条边采样，把颜色聚类，返回一组背景色。
    """
    if override:
        return [override]
    rgb = im.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    samples = []
    for x in range(w):
        samples.append(px[x, 0]); samples.append(px[x, h - 1])
    for y in range(h):
        samples.append(px[0, y]); samples.append(px[w - 1, y])

    B = 16
    buckets = {}
    for c in samples:
        buckets.setdefault((c[0] // B, c[1] // B, c[2] // B), []).append(c)

    total = len(samples)
    out = []
    covered = 0.0
    # 贪心取最大的几个簇，直到覆盖 ~90% 的边框像素。
    # 只取一个不够（棋盘格有白+灰两种）；取太多也不行 ——
    # 角色边缘的抗锯齿杂色也常出现在边框上，会被误当成背景。
    for _, items in sorted(buckets.items(), key=lambda kv: -len(kv[1])):
        share = len(items) / total
        if share < 0.05:
            break
        if covered >= 0.9:
            break
        n = len(items)
        out.append((sum(i[0] for i in items) // n,
                    sum(i[1] for i in items) // n,
                    sum(i[2] for i in items) // n))
        covered += share
        if len(out) >= 6:
            break
    return out or [samples[0]]


def despeckle(is_bg, w, h, min_area):
    """把细碎的前景噪点也归为背景。

    为什么需要：背景抗锯齿的边界像素往往「既不像背景色、也不像角色」，
    洪水填充碰不到它们，就会在角色周围留下一圈小噪点。
    这里按连通块大小过滤 —— 角色是一个大连通块，噪点是很小的碎块。
    """
    if min_area <= 0:
        return is_bg
    visited = bytearray(w * h)
    comps = []
    for start in range(w * h):
        if is_bg[start] or visited[start]:
            continue
        q = deque([start])
        visited[start] = 1
        cells = []
        while q:
            i = q.popleft()
            cells.append(i)
            x, y = i % w, i // w
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if not is_bg[j] and not visited[j]:
                        visited[j] = 1
                        q.append(j)
        comps.append(cells)
    if not comps:
        return is_bg
    biggest = max(len(c) for c in comps)
    for c in comps:
        if len(c) < min_area and len(c) < biggest:
            for i in c:
                is_bg[i] = 1
    return is_bg


def cut_one(frame, bg_colors, tol, feather, min_blob):
    """把单帧的背景变透明，返回 RGBA"""
    rgba = frame.convert("RGBA")
    w, h = rgba.size
    rgb = rgba.convert("RGB")

    # 1) 标记「接近任意一个背景色」的像素
    px = rgb.load()
    near = bytearray(w * h)
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b = px[x, y]
            for (br, bgc, bb) in bg_colors:
                if abs(r - br) <= tol and abs(g - bgc) <= tol and abs(b - bb) <= tol:
                    near[row + x] = 1
                    break

    # 2) 从四条边洪水填充：只有「和边缘连通的背景」才算真背景
    is_bg = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            if near[i] and not is_bg[i]:
                is_bg[i] = 1
                q.append(i)
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            if near[i] and not is_bg[i]:
                is_bg[i] = 1
                q.append(i)
    while q:
        i = q.popleft()
        x, y = i % w, i // w
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h:
                j = ny * w + nx
                if near[j] and not is_bg[j]:
                    is_bg[j] = 1
                    q.append(j)

    # 3) 去掉细碎噪点（角色本身是大的连通块）
    is_bg = despeckle(is_bg, w, h, min_blob)

    # 4) 写入 alpha
    alpha = Image.frombytes("L", (w, h), bytes(255 if not v else 0 for v in is_bg))

    # 5) 边缘收缩：把背景 mask 往外扩张 feather 像素，
    #    用来吃掉抗锯齿留下的那一圈浅色描边（否则会看到白边）
    if feather > 0:
        from PIL import ImageFilter
        alpha = alpha.filter(ImageFilter.MinFilter(feather * 2 + 1))

    rgba.putalpha(alpha)
    return rgba


def process(path, out, tol, feather, scale, bg_override, dry, min_blob):
    im = Image.open(path)
    frames = getattr(im, "n_frames", 1)
    animated = frames > 1
    bg = detect_bg_colors(im, tol, bg_override)

    outs = []
    durations = []
    for i in range(frames):
        im.seek(i)
        durations.append(im.info.get("duration", 100))
        fr = cut_one(im, bg, tol, feather, min_blob)
        if scale and max(fr.size) > scale:
            k = scale / max(fr.size)
            fr = fr.resize((max(1, round(fr.width * k)), max(1, round(fr.height * k))),
                           Image.LANCZOS)
        outs.append(fr)

    # 统计透明比例，便于判断抠得对不对
    a = outs[0].getchannel("A")
    hist = a.histogram()
    transparent_pct = hist[0] / max(1, sum(hist)) * 100

    print("  %-18s %d帧 %s  背景色=%s  透明占比=%.1f%%  -> %s" % (
        os.path.basename(path), frames,
        ("(动图)" if animated else "      "),
        " ".join(str(c) for c in bg), transparent_pct,
        (os.path.basename(out) if not dry else "(dry-run)")))

    if dry:
        return

    if animated:
        # 动图必须带 alpha 才能保住抠图结果
        outs[0].save(out, save_all=True, append_images=outs[1:],
                     duration=durations, loop=im.info.get("loop", 0),
                     lossless=False, quality=90, method=4)
    else:
        outs[0].save(out)


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("target")
    ap.add_argument("--out")
    ap.add_argument("--inplace", action="store_true")
    ap.add_argument("--tolerance", type=int, default=26)
    ap.add_argument("--feather", type=int, default=1)
    ap.add_argument("--min-blob", type=int, default=12,
                    help="小于该像素数的前景碎片当噪点清掉（默认 12）")
    ap.add_argument("--scale", type=int, default=0)
    ap.add_argument("--bg")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    bg = tuple(int(v) for v in a.bg.split(",")) if a.bg else None

    files = []
    if os.path.isdir(a.target):
        for root, _, names in os.walk(a.target):
            for n in sorted(names):
                if n.lower().endswith(IMG_EXT):
                    files.append(os.path.join(root, n))
    else:
        files = [a.target]
    if not files:
        print("没找到图片:", a.target)
        return 1

    print("抠背景：容差=%d 收缩=%d 去噪=%dpx 缩放=%s" % (
        a.tolerance, a.feather, a.min_blob, a.scale or "不改"))
    for f in files:
        if a.inplace:
            out = f
        elif a.out:
            out = (os.path.join(a.out, os.path.basename(f)) if os.path.isdir(a.out) or a.out.endswith(os.sep)
                   else a.out)
        else:
            base, ext = os.path.splitext(f)
            out = base + "_alpha" + (ext if ext.lower() in (".png", ".webp") else ".png")
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        if a.inplace and not a.dry_run:
            shutil.copy2(f, f + ".bak")
        process(f, out, a.tolerance, a.feather, a.scale, bg, a.dry_run, a.min_blob)
    print("完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
