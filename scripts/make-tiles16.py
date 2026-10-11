"""从 tiles32 生成 16×16 的地块缩略图（「全图」在手机上格子 16px 时用）。用法：python scripts/make-tiles16.py"""
from pathlib import Path
from PIL import Image
src = Path(__file__).resolve().parent.parent / "apps/web/public/art/tiles32"
dst = src.parent / "tiles16"
dst.mkdir(exist_ok=True)
n = 0
for path in sorted(src.glob("tile-*-?.png")):
    Image.open(path).convert("RGB").resize((16, 16), Image.BOX).save(dst / path.name)
    n += 1
print(n, "张")
