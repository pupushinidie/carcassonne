"""地块总览：24 种 × 4 旋转（64px）+ 一排 32px。python ov_tiles.py <set> <输出>"""
import sys, pathlib
from PIL import Image
ART = pathlib.Path(__file__).resolve().parent
d = ART / "out" / "tiles" / sys.argv[1]
ids = "ABCDEFGHIJKLMNOPQRSTUVWX"
o = Image.new("RGB", (24 * 68, 4 * 68 + 40), "#20222a")
for i, t in enumerate(ids):
    for k in range(4):
        o.paste(Image.open(d / f"tile-{t}-{k}.png"), (i * 68, k * 68))
    o.paste(Image.open(d / "32" / f"tile-{t}-0.png"), (i * 68 + 16, 4 * 68 + 4))
o.save(sys.argv[2])
