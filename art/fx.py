"""代码画的界面小图和特效（几何要准、要循环的东西用代码画；配色取 spec 的调色板）。
输出到 out/final/{ui,fx,meeple}/。python fx.py
- ui/start-flag.png、ui/start-flag-wave.png（6 帧循环）：PixelLab 小旗（ui-flag 候选），旗面按列正弦摆动
- ui/slot-ok.png、ui/slot-bad.png、ui/spot.png、ui/spot-pulse.png（6 帧循环）
- meeple/drop-<色>.png（6 帧，播一次停在末帧 = 站立图）
- fx/place.png（6 帧尘土，末帧空）、fx/score.png（8 帧金色闪光，末帧空）、fx/sparkle.png（6 帧循环小闪光）
"""
import math, pathlib, random
import numpy as np
from PIL import Image, ImageDraw

ART = pathlib.Path(__file__).resolve().parent
FINAL = ART / "out" / "final"
FLAG_PICK = 0   # ui-flag 候选编号


def strip(frames):
    w, h = frames[0].size
    s = Image.new("RGBA", (w * len(frames), h))
    for i, f in enumerate(frames):
        s.alpha_composite(f, (i * w, 0))
    return s


def flag():
    p = ART / "out" / "r1" / "ui-flag" / ("ui-flag.png" if FLAG_PICK == 0 else f"ui-flag-{FLAG_PICK}.png")
    im = Image.open(p).convert("RGBA")
    a = np.array(im)
    a[..., 3] = np.where(a[..., 3] > 127, 255, 0)
    im = Image.fromarray(a)
    im.save(FINAL / "ui" / "start-flag.png")
    # 旗杆：最左边的不透明列附近（棕色）；旗面：偏红的像素
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    cloth = (a[..., 3] > 0) & (r > g + 40)
    cols = np.nonzero(cloth.any(0))[0]
    x0 = cols.min() if len(cols) else 4
    frames = []
    for f in range(6):
        out = np.zeros_like(a)
        out[~cloth] = a[~cloth]
        for x in range(16):
            amp = (x - x0) / max(1, (cols.max() - x0 if len(cols) else 8))
            dy = int(round(math.sin(2 * math.pi * (f / 6) - x * 0.9) * 1.2 * amp))
            for y in range(16):
                if cloth[y, x]:
                    ny = y + dy
                    if 0 <= ny < 16:
                        out[ny, x] = a[y, x]
        # 描边：旗面移动后补一圈深色（取原图里最暗的描边色）
        frames.append(Image.fromarray(out))
    frames[0] = im  # 首帧就是静态图
    strip(frames).save(FINAL / "ui" / "start-flag-wave.png")


def slots():
    for name, fill, line in (("slot-ok", (255, 255, 255, 46), (255, 255, 255, 230)), ("slot-bad", (224, 71, 60, 70), (224, 71, 60, 255))):
        im = Image.new("RGBA", (64, 64), fill)
        d = ImageDraw.Draw(im)
        if name == "slot-ok":   # 虚线框
            for i in range(0, 64, 6):
                for (x0, y0, x1, y1) in ((i, 1, i + 3, 2), (i, 61, i + 3, 62), (1, i, 2, i + 3), (61, i, 62, i + 3)):
                    d.rectangle([x0, y0, x1, y1], fill=line)
        else:
            d.rectangle([1, 1, 62, 62], outline=line, width=2)
            d.line([(20, 20), (43, 43)], fill=line, width=3)
            d.line([(43, 20), (20, 43)], fill=line, width=3)
        im.save(FINAL / "ui" / f"{name}.png")
    # 落点圆环
    def ring(rad, alpha=255):
        im = Image.new("RGBA", (16, 16))
        d = ImageDraw.Draw(im)
        d.ellipse([8 - rad - 1, 8 - rad - 1, 7 + rad + 1, 7 + rad + 1], outline=(40, 30, 20, alpha), width=1)
        d.ellipse([8 - rad, 8 - rad, 7 + rad, 7 + rad], outline=(255, 255, 255, alpha), width=2)
        d.ellipse([7, 7, 8, 8], fill=(255, 255, 255, alpha))
        return im
    ring(5).save(FINAL / "ui" / "spot.png")
    frames = []
    for glow in (None, (190, 200, 200), (230, 220, 150), (255, 206, 80), (230, 220, 150), (190, 200, 200)):   # 圆环不动，外圈一层光由淡到金再回去
        im = ring(5)
        if glow:
            d = ImageDraw.Draw(im)
            d.ellipse([1, 1, 14, 14], outline=glow + (230,), width=1)
            im.alpha_composite(ring(5))
        frames.append(im)
    strip(frames).save(FINAL / "ui" / "spot-pulse.png")


def drops():
    for c in ("red", "blue", "purple", "white", "black"):
        st = Image.open(FINAL / "meeple" / f"stand-{c}.png").convert("RGBA")
        bb = st.getbbox()
        fig = st.crop(bb)
        w, h = fig.size
        base_y = 8 + bb[3]   # 末帧脚底位置（站立图贴在 (0,8)）
        frames = []
        # (下落位移, 宽缩放, 高缩放)
        for dy, sx, sy in ((-11, 1.0, 1.0), (-6, 1.0, 1.06), (-1, 1.0, 1.08), (0, 1.2, 0.8), (0, 0.94, 1.06), (0, 1.0, 1.0)):
            f = Image.new("RGBA", (24, 32))
            fw, fh = max(1, round(w * sx)), max(1, round(h * sy))
            g = fig.resize((fw, fh), Image.NEAREST)
            x = (24 - fw) // 2
            y = base_y - fh + dy
            f.alpha_composite(g, (x, max(0, y)) if y >= 0 else (x, 0))
            frames.append(f)
        last = Image.new("RGBA", (24, 32))
        last.alpha_composite(st, (0, 8))
        frames[-1] = last
        strip(frames).save(FINAL / "meeple" / f"drop-{c}.png")


def dust():
    rng = random.Random(4)
    parts = []
    for side in range(4):
        for i in range(7):
            t = rng.uniform(0.05, 0.95)
            pos = {0: (t * 64, 0), 1: (64, t * 64), 2: (t * 64, 64), 3: (0, t * 64)}[side]
            out = {0: (0, -1), 1: (1, 0), 2: (0, 1), 3: (-1, 0)}[side]
            parts.append((pos, out, rng.uniform(0.6, 1.4), rng.choice([2, 2, 3])))
    cols = [(239, 226, 190), (214, 196, 150), (180, 160, 118)]
    frames = []
    for f in range(6):
        im = Image.new("RGBA", (64, 64))
        d = ImageDraw.Draw(im)
        if f < 5:
            for (px, py), (ox, oy), sp, sz in parts:
                k = f * sp
                x = px - ox * 3 + ox * (-k * 0.5) + (oy != 0) * 0
                # 往地块里外两侧扩散一点：在边上 ±(2+k) 内
                x = px + ox * (-2 + k * 1.2)
                y = py + oy * (-2 + k * 1.2)
                x = min(63, max(0, x)); y = min(63, max(0, y))
                s = max(1, sz - (f // 2))
                d.rectangle([x, y, x + s - 1, y + s - 1], fill=cols[min(2, f // 2)] + (255 - f * 40,))
        frames.append(im)
    strip(frames).save(FINAL / "fx" / "place.png")


def star(d, x, y, r, col):
    d.point([(x, y)], fill=col)
    for i in range(1, r + 1):
        a = 255 if i < r else 160
        c = col[:3] + (a,)
        d.point([(x + i, y), (x - i, y), (x, y + i), (x, y - i)], fill=c)


def score():
    rng = random.Random(9)
    gold = [(255, 244, 196, 255), (255, 214, 92, 255), (232, 168, 40, 255)]
    pts = [(rng.uniform(8, 56), rng.uniform(8, 56), rng.uniform(0, 2.5)) for _ in range(14)]
    frames = []
    for f in range(8):
        im = Image.new("RGBA", (64, 64))
        d = ImageDraw.Draw(im)
        if f < 7:
            # 由中心向外的一圈光点 + 随机闪烁的小星
            rad = 6 + f * 4
            for k in range(12):
                ang = k * math.pi / 6 + f * 0.15
                x, y = 32 + math.cos(ang) * rad, 32 + math.sin(ang) * rad
                if 1 <= x < 63 and 1 <= y < 63:
                    star(d, int(x), int(y), 1 if f > 4 else 2, gold[min(2, f // 3)])
            for (x, y, ph) in pts:
                life = f - ph
                if 0 <= life < 4:
                    star(d, int(x), int(y - life * 2), 2 if life < 2 else 1, gold[int(life) % 3])
        frames.append(im)
    strip(frames).save(FINAL / "fx" / "score.png")


def sparkle():
    frames = []
    for f in range(6):
        im = Image.new("RGBA", (16, 16))
        d = ImageDraw.Draw(im)
        r = [3, 4, 5, 5, 4, 3][f]
        d.rectangle([7, 7, 9, 9], fill=(255, 240, 170, 255))
        star(d, 8, 8, r, (255, 240, 170, 255))
        d.point([(8, 8)], fill=(255, 255, 255, 255))
        if f in (2, 3):
            for (x, y) in ((5, 5), (11, 5), (5, 11), (11, 11)):
                d.point([(x, y)], fill=(255, 214, 92, 220))
        frames.append(im)
    strip(frames).save(FINAL / "fx" / "sparkle.png")


if __name__ == "__main__":
    for sub in ("ui", "fx", "meeple"):
        (FINAL / sub).mkdir(parents=True, exist_ok=True)
    flag(); slots(); drops(); dust(); score(); sparkle()
    print("ok")
