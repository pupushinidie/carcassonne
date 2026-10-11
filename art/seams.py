"""接缝检查：每种地块 × 4 个旋转 × 每个方向上所有合法的相邻（边类型相同）组合，比较接缝两侧的边缘像素。
- 类别（草地/城/路）必须逐像素一致（地块角上 2px 除外：I 的两段城在角上留了草地）；
- 颜色：接缝两侧像素差的平均值，报最大的几对（纹理是全局周期贴的，应该接近 0，部件不贴边）。
另外把引擎会用到的落点（anchors.json）叠到 24 种地块上，出一张核对图。
python seams.py set1
"""
import sys, pathlib, json
import numpy as np
from PIL import Image, ImageDraw
from tiledata import TILES, DIRS

ART = pathlib.Path(__file__).resolve().parent
SET = sys.argv[1] if len(sys.argv) > 1 else "set1"
D = ART / "out" / "tiles" / SET
cats = np.load(ART / "out" / "tiles" / f"{SET}-cats.npz")


def edges_of(tid, k):
    e = TILES[tid]["edges"]
    return {DIRS[(i + k) % 4]: e[i] for i in range(4)}


imgs = {f"{t}{k}": np.array(Image.open(D / f"tile-{t}-{k}.png").convert("RGB")).astype(int) for t in TILES for k in range(4)}
pairs = 0
cat_bad = []
color = []
for a in TILES:
    for ka in range(4):
        ea = edges_of(a, ka)
        for b in TILES:
            for kb in range(4):
                eb = edges_of(b, kb)
                # b 在 a 的东边 / 南边（另外两个方向是对称的同一批组合）
                for side, opp in (("E", "W"), ("S", "N")):
                    if ea[side] != eb[opp]:
                        continue
                    pairs += 1
                    A, B = cats[f"{a}{ka}"], cats[f"{b}{kb}"]
                    IA, IB = imgs[f"{a}{ka}"], imgs[f"{b}{kb}"]
                    if side == "E":
                        ca, cb, pa, pb = A[:, -1], B[:, 0], IA[:, -1], IB[:, 0]
                    else:
                        ca, cb, pa, pb = A[-1, :], B[0, :], IA[-1, :], IB[0, :]
                    mism = np.nonzero(ca[2:-2] != cb[2:-2])[0]
                    if len(mism):
                        cat_bad.append((a, ka, side, b, kb, len(mism)))
                    color.append((np.abs(pa - pb).mean(), a, ka, side, b, kb))
color.sort(reverse=True)
print(f"合法相邻组合 {pairs} 对（东、南两个方向；西、北是同一批）")
print(f"类别不一致：{len(cat_bad)} 对", cat_bad[:10])
print("接缝颜色差（0–255，平均）最大 5 对：", [(round(c[0], 1),) + c[1:] for c in color[:5]])
inner = [np.abs(im[:, i] - im[:, i + 1]).mean() for im in imgs.values() for i in (20, 40)]
print("参照：地块内部相邻两列的平均差（中位数）", round(float(np.median(inner)), 2))
print("接缝颜色差中位数：", round(float(np.median([c[0] for c in color])), 2))

# 落点核对图：24 种地块（未旋转）放大 3 倍，叠城（红点）、路（黄点）、农田（绿点）、修道院（白点）、盾（蓝框）
an = json.loads((D / "anchors.json").read_text())
Z = 3
o = Image.new("RGB", (12 * (64 * Z + 8), 2 * (64 * Z + 8)), "#20222a")
dr = ImageDraw.Draw(o)
for i, t in enumerate(TILES):
    x0, y0 = (i % 12) * (64 * Z + 8), (i // 12) * (64 * Z + 8)
    o.paste(Image.open(D / f"tile-{t}.png").resize((64 * Z, 64 * Z), Image.NEAREST), (x0, y0))
    def dot(p, c):
        x, y = x0 + p[0] * 64 * Z, y0 + p[1] * 64 * Z
        dr.ellipse([x - 5, y - 5, x + 5, y + 5], fill=c, outline="black")
    for c in an[t]["cities"]:
        dot(c["spot"], "#ff3030")
    for r in an[t]["roads"]:
        dot(r["spot"], "#ffd800")
    for f in an[t]["fields"]:
        dot(f["spot"], "#30ff60")
    if an[t]["monastery"]:
        dot(an[t]["monastery"], "white")
    for s in an[t]["shields"]:
        x, y = x0 + s[0] * 64 * Z, y0 + s[1] * 64 * Z
        dr.rectangle([x - 9, y - 9, x + 9, y + 9], outline="#40a0ff", width=2)
    dr.text((x0 + 3, y0 + 2), t, fill="white")
o.save(ART / "out" / f"anchors-{SET}.png")
print("落点核对图", ART / "out" / f"anchors-{SET}.png")
