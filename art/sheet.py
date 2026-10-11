"""把一个文件夹里的候选拼成总览（放大 N 倍，带编号）。python sheet.py <目录> <输出> [倍数] [底色]"""
import sys, pathlib
from PIL import Image, ImageDraw
d = pathlib.Path(sys.argv[1]); out = sys.argv[2]; z = int(sys.argv[3]) if len(sys.argv) > 3 else 3
bg = sys.argv[4] if len(sys.argv) > 4 else "#6aa84f"
files = sorted(d.glob("*.png"), key=lambda p: (len(p.stem), p.stem))
ims = [Image.open(p).convert("RGBA") for p in files]
w = max(i.width for i in ims) * z; h = max(i.height for i in ims) * z
cols = 16; rows = (len(ims) + cols - 1) // cols
o = Image.new("RGBA", (cols * (w + 4), rows * (h + 14)), bg)
dr = ImageDraw.Draw(o)
for n, (p, im) in enumerate(zip(files, ims)):
    x, y = (n % cols) * (w + 4), (n // cols) * (h + 14)
    big = im.resize((im.width * z, im.height * z), Image.NEAREST)
    o.alpha_composite(big, (x, y + 12))
    dr.text((x + 1, y), p.stem.split("-")[-1] if "-" in p.stem else "0", fill="black")
o.save(out)
