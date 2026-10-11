"""把挑中的部件整理进 out/pick/<set>/，给 tiles.py 用。python pick.py set1"""
import sys, pathlib
import numpy as np
from PIL import Image

ART = pathlib.Path(__file__).resolve().parent
R1 = ART / "out" / "r1"
R2 = ART / "out" / "r2"

SETS = {
    # set1 石板城：米色石板地 + 奶白城墙 + 修道院带回廊花园
    "set1": dict(grass="tex-grass-s102", houses=[0, 5, 7, 13, 14, 15, 9, 22], trees=[0, 1, 13, 14, 22, 49], bushes=None,
                 well=1, shield=0, monastery=49, tower=0, ground=(205, 191, 159)),
    # set2 灰石城：暖砂石板地 + 灰石城墙 + 红顶十字修道院带小花园
    "set2": dict(grass="tex-grass-s102", houses=[0, 5, 7, 13, 14, 15, 9, 22], trees=[13, 14, 36, 50, 1, 22], bushes=[3, 18, 44],
                 well=4, shield=12, monastery=3, tower=1, ground=(214, 188, 140)),
    # set3 深草城：更暗的草地 + 赭色石板 + 红顶塔楼
    "set3": dict(grass="tex-grass-s103", houses=[0, 5, 7, 13, 14, 15, 26, 54], trees=[0, 22, 36, 49, 13, 50], bushes=None,
                 well=16, shield=28, monastery=9, tower=3, ground=(196, 170, 132)),
}


def trim(im):
    bb = im.getchannel("A").getbbox()
    return im.crop(bb) if bb else im


def v2(folder, i):
    stem = folder if i == 0 else f"{folder}-{i}"
    for base in (R1, R2):
        p = base / folder / f"{stem}.png"
        if p.exists():
            im = Image.open(p).convert("RGBA")
            a = np.array(im); a[:, :, 3] = np.where(a[:, :, 3] > 127, 255, 0)
            return trim(Image.fromarray(a))
    raise FileNotFoundError(stem)


def seamless(im, period=64):
    """卷动半个周期后按到边距离混合：边上取卷动图（它的边是原图中心，天然连续），中心取原图。"""
    a = np.array(im.convert("RGB").resize((period, period), Image.NEAREST)).astype(float)
    r = np.roll(np.roll(a, period // 2, 0), period // 2, 1)
    y, x = np.mgrid[0:period, 0:period] + 0.5
    d = np.minimum(np.minimum(x, period - x), np.minimum(y, period - y)) / (period / 2)
    w = np.clip(d * 1.6, 0, 1)[:, :, None]
    # 像素风：用抖动阈值代替半透明混合，避免糊
    rng = np.random.default_rng(3)
    pick = rng.random((period, period, 1)) < w
    out = np.where(pick, a, r)
    return Image.fromarray(out.astype(np.uint8))


def regreen(im):
    """草地按亮度分成 4 档，换成调色板里的绿；花（不绿的亮点）保留。"""
    a = np.array(im.convert("RGB")).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    green = (g > r + 10) & (g > b + 10)
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    q = np.quantile(lum[green], [0.18, 0.55, 0.88])
    tones = np.array([[63, 127, 44], [86, 158, 54], [104, 178, 62], [134, 198, 78]])
    idx = np.digitize(lum, q)
    out = np.where(green[..., None], tones[idx], a)
    return Image.fromarray(out.astype(np.uint8))


def cobble(period=64, base=(205, 191, 159)):
    """城内石板地：周期 64，代码画（浅米灰石块 + 深缝）。"""
    rng = np.random.default_rng(11)
    base = np.array(base, float)
    a = np.tile(base, (period, period, 1))
    # 石块：4x3 错缝砖格，每块亮度略变
    for by in range(0, period, 4):
        off = 2 if (by // 4) % 2 else 0
        for bx in range(-4, period, 5):
            v = rng.uniform(-12, 10)
            x0, x1 = bx + off, bx + off + 4
            for yy in range(by, by + 3):
                for xx in range(x0, x1):
                    a[yy % period, xx % period] = base + v
        a[(by + 3) % period, :] = base - 34
    for by in range(0, period, 4):
        off = 2 if (by // 4) % 2 else 0
        for bx in range(-4, period, 5):
            for yy in range(by, by + 3):
                a[yy % period, (bx + off + 4) % period] = base - 30
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def main(name):
    cfg = SETS[name]
    out = ART / "out" / "pick" / name
    out.mkdir(parents=True, exist_ok=True)
    for p in out.glob("*.png"):
        p.unlink()
    regreen(seamless(Image.open(R1 / f"{cfg['grass']}.png"))).save(out / "grass.png")
    cobble(base=cfg.get("ground", (205, 191, 159))).save(out / "ground.png")
    for n, i in enumerate(cfg["houses"]):
        v2("obj-house", i).save(out / f"house{n}.png")
    for n, i in enumerate(cfg["trees"]):
        v2("obj-tree", i).save(out / f"tree{n}.png")
    if cfg.get("bushes"):
        for n, i in enumerate(cfg["bushes"]):
            v2("obj-bush", i).save(out / f"bush{n}.png")
    else:  # 没有灌木时用缩小的树
        for n, i in enumerate(cfg["trees"][:3]):
            t = v2("obj-tree", i)
            t.resize((max(1, t.width * 3 // 4), max(1, t.height * 3 // 4)), Image.NEAREST).save(out / f"bush{n}.png")
    v2("obj-well", cfg["well"]).save(out / "well.png")
    v2("ui-shield", cfg["shield"]).save(out / "shield.png")
    if cfg.get("tower") is not None:
        v2("obj-tower", cfg["tower"]).save(out / "tower.png")
    if cfg.get("monastery") is not None:
        v2("obj-monastery", cfg["monastery"]).save(out / "monastery.png")
    print("ok", out)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "set1")
