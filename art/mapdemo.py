"""随机拼一张合法的小地图（引擎还没有，按边类型匹配），放几个小人，看整体感觉。python mapdemo.py <set> <输出> [种子] [格数]"""
import sys, pathlib, random
from PIL import Image
from tiledata import TILES, DIRS
ART = pathlib.Path(__file__).resolve().parent
SET, OUTP = sys.argv[1], sys.argv[2]
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1
N = int(sys.argv[4]) if len(sys.argv) > 4 else 30
rng = random.Random(seed)
bag = [t for t, v in TILES.items() for _ in range(v["count"])]
bag.remove("D"); rng.shuffle(bag)
def edges(t, k):
    e = TILES[t]["edges"]; return {DIRS[(i + k) % 4]: e[i] for i in range(4)}
grid = {(0, 0): ("D", 0)}
OFF = {"N": (0, -1), "E": (1, 0), "S": (0, 1), "W": (-1, 0)}
OPP = {"N": "S", "S": "N", "E": "W", "W": "E"}
W_, H_ = 8, 6
while len(grid) < N and bag:
    t = bag.pop()
    cands = []
    for (x, y) in list(grid):
        for d, (dx, dy) in OFF.items():
            p = (x + dx, y + dy)
            if p in grid or not (-3 <= p[0] <= 4 and -2 <= p[1] <= 3):
                continue
            for k in range(4):
                e = edges(t, k); ok = True; nb = 0
                for d2, (ex, ey) in OFF.items():
                    q = (p[0] + ex, p[1] + ey)
                    if q in grid:
                        nb += 1
                        if edges(*grid[q])[OPP[d2]] != e[d2]:
                            ok = False
                if ok:
                    cands.append((nb, rng.random(), p, k))
    if cands:
        cands.sort(reverse=True)
        _, _, p, k = cands[0]
        grid[p] = (t, k)
xs = [p[0] for p in grid]; ys = [p[1] for p in grid]
T = 64
im = Image.new("RGB", ((max(xs) - min(xs) + 1) * T, (max(ys) - min(ys) + 1) * T), "#3a3f4b")
D = ART / "out" / "tiles" / SET
for (x, y), (t, k) in grid.items():
    im.paste(Image.open(D / f"tile-{t}-{k}.png"), ((x - min(xs)) * T, (y - min(ys)) * T))
im = im.convert("RGBA")
# 小人（有的话）
import json
an = json.loads((D / "anchors.json").read_text())
mdir = ART / "out" / "final" / "meeple"
cols = ["red", "blue", "purple", "white", "black"]
if mdir.exists():
    def rot(p, k):
        x, y = p
        for _ in range(k): x, y = 1 - y, x
        return x, y
    n = 0
    for (x, y), (t, k) in sorted(grid.items(), key=lambda i: rng.random())[:10]:
        a = an[t]
        opts = [("stand", c["spot"]) for c in a["cities"]] + [("stand", r["spot"]) for r in a["roads"]] + \
               [("lie", f["spot"]) for f in a["fields"]] + ([("stand", a["monastery"])] if a["monastery"] else [])
        if not opts: continue
        kind, sp = rng.choice(opts)
        px, py = rot(sp, k)
        m = Image.open(mdir / f"{kind}-{cols[n % 5]}.png").convert("RGBA")
        cx, cy = (x - min(xs)) * T + px * T, (y - min(ys)) * T + py * T
        im.alpha_composite(m, (int(cx - m.width / 2), int(cy - m.height / 2)))
        n += 1
im.save(OUTP)
big = im.resize((im.width * 2, im.height * 2), Image.NEAREST); big.save(OUTP.replace(".png", "-2x.png"))
print(len(grid), "块", im.size)
