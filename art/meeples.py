"""小人：从一只白色站立小人（PixelLab v2）按亮度换成 5 种颜色；躺倒 = 站立顺时针转 90°。
python meeples.py <候选编号> <输出目录>   输出 stand-<色>.png / lie-<色>.png（24×24）和 -12 小图
"""
import sys, pathlib
import numpy as np
from PIL import Image

ART = pathlib.Path(__file__).resolve().parent
COLORS = {  # 暗、中、亮、高光
    "red": ["#8e2219", "#c2352b", "#e0473c", "#f27a6c"],
    "blue": ["#1d3f8c", "#2c5cc4", "#3b74e0", "#78a4f2"],
    "purple": ["#4f2378", "#7a3db0", "#9b55d6", "#c08ef0"],
    "white": ["#9c9a94", "#cfcbc1", "#f3efe6", "#ffffff"],
    "black": ["#16161c", "#24242c", "#34343f", "#56566a"],
}
OUTLINE = {"black": (232, 228, 214)}   # 黑小人描边换成浅色，夜间背景和深色草地上都看得见


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def recolor(src, name):
    a = np.array(src).astype(int)
    alpha = a[..., 3] > 127
    lum = 0.3 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2]
    outline = alpha & (lum < 70)
    body = alpha & ~outline
    q = np.quantile(lum[body], [0.2, 0.55, 0.9])
    ramp = np.array([hexrgb(c) for c in COLORS[name]])
    idx = np.digitize(lum, q)
    out = np.zeros_like(a)
    out[..., :3] = np.where(body[..., None], ramp[idx], a[..., :3])
    out[..., 3] = np.where(alpha, 255, 0)
    if name in OUTLINE:
        out[outline, :3] = OUTLINE[name]
    return Image.fromarray(out.astype(np.uint8))


def small(im):
    """24→12：2×2 取最多的颜色（透明多就透明），保住描边。"""
    a = np.array(im)
    o = np.zeros((12, 12, 4), np.uint8)
    for y in range(12):
        for x in range(12):
            blk = a[2 * y:2 * y + 2, 2 * x:2 * x + 2].reshape(4, 4)
            vis = blk[blk[:, 3] > 0]
            if len(vis) >= 2:
                # 有描边像素就优先描边（最暗），保持轮廓
                lum = vis[:, :3].astype(int).sum(1)
                o[y, x] = vis[np.argmin(lum)] if (len(vis) < 4) else vis[np.argsort(lum)[len(vis) // 2]]
    return Image.fromarray(o)


def main(idx, outdir):
    src = ART / "out" / "r1" / "meeple-stand" / (f"meeple-stand-{idx}.png" if idx else "meeple-stand.png")
    im = Image.open(src).convert("RGBA")
    bb = im.getbbox()
    fig = im.crop(bb)
    canvas = Image.new("RGBA", (24, 24))
    canvas.alpha_composite(fig, ((24 - fig.width) // 2, (24 - fig.height) // 2))
    out = pathlib.Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    for name in COLORS:
        st = recolor(canvas, name)
        st.save(out / f"stand-{name}.png")
        lie = st.rotate(-90, expand=False)
        lie.save(out / f"lie-{name}.png")
        small(st).save(out / f"stand-{name}-12.png")
        small(lie).save(out / f"lie-{name}-12.png")
    print("ok", out)


if __name__ == "__main__":
    main(int(sys.argv[1]), sys.argv[2])
