"""从美术定稿生成两套缩小地块：16×16（从 tiles32 缩，手机「全图」用）和 48×48（从 64 缩，格子 48px 时用）。
用法：python scripts/make-tiles16.py"""
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

src64 = src.parent / "tiles"
dst48 = src.parent / "tiles48"
dst48.mkdir(exist_ok=True)
m = 0
for path in sorted(src64.glob("tile-*-?.png")):
    Image.open(path).convert("RGB").resize((48, 48), Image.LANCZOS).save(dst48 / path.name)
    m += 1
print(m, "张 48px")
