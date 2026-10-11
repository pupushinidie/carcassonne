"""按规则书 2.2 合成 24 种地块 × 4 个旋转（64px），以及 32px 缩小版。

做法：几何（城区、城墙、道路）在未旋转朝向里算成蒙版，旋转蒙版；纹理（草地、城内地面、道路）按全局周期 64 贴，
所以相邻地块的纹理天然接得上；PixelLab 部件（房子、塔、树、修道院、井、盾）始终正着贴，落点按未旋转坐标旋转过去，
所以光影朝向在所有旋转下一致。

用法：python tiles.py [set名]   部件从 out/pick/<set名>/ 读（默认 set1），输出 out/tiles/<set名>/
"""
from __future__ import annotations
import json, math, pathlib, sys
import numpy as np
from PIL import Image
from scipy import ndimage
from tiledata import TILES, DIRS

ART = pathlib.Path(__file__).resolve().parent
S = 64
C = S / 2
RW = 4.0          # 道路半宽（路面 8px：x 28..35）
SET = sys.argv[1] if len(sys.argv) > 1 else "set1"
PICK = ART / "out" / "pick" / SET
OUT = ART / "out" / "tiles" / SET

PAL = dict(
    wall_dark="#4b3826", wall="#efe2bf", wall_hi="#fbf4dc", wall_mid="#d6c39a", wall_shadow="#a8906a",
    grass_shadow="#3f7f2c", road="#e3c98a", road_hi="#efdaa2", road_dark="#c4a666", road_edge="#8a6a3e",
    cobble="#cdbf9f", cobble2="#b9aa88", cobble3="#ddd2b6",
)
# 三套候选地块只在城墙颜色上不同（其余部件见 pick.py 的 SETS）
if SET == "set2":   # 灰石城墙
    PAL.update(wall_dark="#3a3a40", wall="#c9c6bc", wall_hi="#e4e1d8", wall_mid="#aeaba0", wall_shadow="#85827a")


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


P = {k: np.array(hexrgb(v), dtype=np.uint8) for k, v in PAL.items()}
yy, xx = np.mgrid[0:S, 0:S] + 0.5   # 像素中心


# ---------- 未旋转朝向下的几何 ----------
def rot_edges(edges: str, k: int) -> str:
    return "".join(sorted((DIRS[(DIRS.index(e) + k) % 4] for e in edges), key=DIRS.index))


def rot_mask(m, k):  # 顺时针 k 次
    return np.rot90(m, -k)


def rot_pt(x, y, k):
    for _ in range(k % 4):
        x, y = S - y, x
    return x, y


def cap_n(depth, half=C):
    return yy < depth * (1 - ((xx - C) / half) ** 2)


def wedge_nw(bulge=5.0):
    u = (xx - yy) / S
    return (xx + yy) < S + bulge * (1 - u ** 2)


CANON = {
    "N": lambda: cap_n(21),
    "NW": lambda: wedge_nw(),
    "EW": lambda: ~cap_n(17) & ~rot_mask(cap_n(17), 2),
    "NEW": lambda: ~rot_mask(cap_n(23), 2),
    "NESW": lambda: np.ones((S, S), bool),
}


def city_mask(edges: str, narrow=False):
    if narrow and len(edges) == 1:   # 两段城挨着一个角（I）：角上留 2px 草地，看得出是两段
        k = DIRS.index(edges)
        return rot_mask(cap_n(18, C - 1.5), k)
    for canon, fn in CANON.items():
        for k in range(4):
            if rot_edges(canon, k) == edges:
                return rot_mask(fn(), k)
    raise ValueError(edges)


MID = {"N": (C, 0), "E": (S, C), "S": (C, S), "W": (0, C)}
CORNER = {frozenset("NE"): (S, 0), frozenset("ES"): (S, S), frozenset("SW"): (0, S), frozenset("NW"): (0, 0)}


def seg_dist(ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((xx - ax) * vx + (yy - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(xx - (ax + t * vx), yy - (ay + t * vy))


def road_dist(a, b):
    if b == "*":
        return seg_dist(*MID[a], C, C)
    if {a, b} in ({"N", "S"}, {"E", "W"}):
        return seg_dist(*MID[a], *MID[b])
    cx, cy = CORNER[frozenset(a + b)]
    return np.abs(np.hypot(xx - cx, yy - cy) - C)


# ---------- 纹理 ----------
def load(name):
    p = PICK / f"{name}.png"
    return Image.open(p).convert("RGBA") if p.exists() else None


def texture(name, fallback):
    im = load(name)
    if im is None:
        a = np.zeros((S, S, 3), np.uint8); a[:] = hexrgb(fallback); return a
    return np.array(im.convert("RGB").resize((S, S), Image.NEAREST))


rng = np.random.default_rng(5)
NOISE = rng.random((S, S))


def compose(tid: str, k: int, sprites: dict, grass, ground) -> tuple[Image.Image, dict]:
    t = TILES[tid]
    img = grass.copy()
    # 城区（各段分别）
    segs = [(rot_edges(e, k), sh) for e, sh in t["cities"]]
    adjacent = len(segs) == 2 and all(len(e) == 1 for e, _ in segs) and \
        (DIRS.index(segs[0][0]) - DIRS.index(segs[1][0])) % 2 == 1
    cmasks = [city_mask(e, narrow=adjacent) for e, _ in segs]
    city = np.zeros((S, S), bool)
    for m in cmasks:
        city |= m
    # 城外到城的距离（地块外当成城，免得在地块边上画墙）
    pad = np.pad(city, 1, constant_values=True)
    din = ndimage.distance_transform_edt(pad)[1:-1, 1:-1]          # 城内像素到最近非城像素
    dout = ndimage.distance_transform_edt(~np.pad(city, 1, constant_values=False))[1:-1, 1:-1]  # 城外像素到城
    if city.any():
        img[city] = ground[city]
        # 草地上靠墙一圈阴影（对称，不分方向）
        img[(~city) & (dout <= 1.5)] = P["grass_shadow"]
        ring = city & (din <= 5)
        img[city & (din <= 1.0)] = P["wall_dark"]
        battl = ((np.floor(xx / 3) + np.floor(yy / 3)) % 2 == 0)
        img[city & (din > 1) & (din <= 2.0)] = np.where(battl[city & (din > 1) & (din <= 2.0)][:, None], P["wall_hi"], P["wall_mid"])
        img[city & (din > 2) & (din <= 4.0)] = P["wall"]
        img[city & (din > 4) & (din <= 5.0)] = P["wall_shadow"]
    # 道路
    roads = [(DIRS[(DIRS.index(a) + k) % 4], b if b == "*" else DIRS[(DIRS.index(b) + k) % 4]) for a, b in t["roads"]]
    rd = np.full((S, S), 99.0)
    for a, b in roads:
        rd = np.minimum(rd, road_dist(a, b))
    road = rd <= RW
    edge = (rd > RW) & (rd <= RW + 1)
    if city.any():  # 路进城（S/T）：路面压在城墙上，城门处画暗色门洞
        gate = road & city
        road &= ~city
        edge &= ~city
    img[edge] = P["road_edge"]
    if road.any():
        tone = np.where(NOISE > 0.82, 1, np.where(NOISE < 0.14, 2, 0))
        img[road & (tone == 0)] = P["road"]
        img[road & (tone == 1)] = P["road_hi"]
        img[road & (tone == 2)] = P["road_dark"]
    if city.any() and gate.any():
        g = gate & (din <= 5.5)
        img[g] = P["wall_dark"]
    out = Image.fromarray(img).convert("RGBA")

    # ---------- 正着贴的部件 ----------
    field = ~city & ~(rd <= RW + 1.5)
    fdist = ndimage.distance_transform_edt(np.pad(field, 0))
    occupied = np.zeros((S, S), bool)

    def paste(sp, cx, cy, need=None, margin=0, soft=False):
        """soft=True：房子之间可以互相压（按 y 顺序画），只避开硬占位（盾、修道院、落点、塔）。"""
        if sp is None:
            return False
        w, h = sp.size
        x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
        if x0 < margin or y0 < margin or x0 + w > S - margin or y0 + h > S - margin:
            return False
        alpha = np.array(sp)[:, :, 3] > 0
        if need is not None:
            sub = need[y0:y0 + h, x0:x0 + w]
            if not sub[alpha].all():
                return False
        if occupied[y0:y0 + h, x0:x0 + w][alpha].any():
            return False
        out.alpha_composite(sp, (x0, y0))
        if not soft:
            occupied[y0:y0 + h, x0:x0 + w] |= alpha
        return True

    anchors = {"cities": [], "roads": [], "fields": [], "monastery": None, "shields": []}
    # 修道院 / 路口村庄
    center_feature = None
    if t["monastery"]:
        paste(sprites["monastery"], C, C - 1)
        anchors["monastery"] = [0.5, 0.5]
    elif sum(1 for a, b in t["roads"] if b == "*") >= 3:
        paste(sprites["well"], C, C)
        center_feature = "village"
    # 城内：房子（按未旋转坐标的网格放，再转过去）+ 盾徽
    houses = sprites.get("houses") or []
    small_houses = sprites.get("small_houses") or []
    for ci, (m, (edges, shield)) in enumerate(zip(cmasks, segs)):
        dm = ndimage.distance_transform_edt(np.pad(m, 1, constant_values=True))[1:-1, 1:-1]
        inner = m & (dm > 4.5)
        # 落点建议：离墙最远的点（多段时各自算）
        score = np.where(m & (dm > 3), np.minimum(dm, 13) - 0.35 * np.hypot(xx - C, yy - C), -999)
        best = np.unravel_index(np.argmax(score), dm.shape)
        my, mx = best
        meeple = (mx + 0.5, my + 0.5)
        if shield and sprites.get("shield") is not None:
            # 盾徽：离落点 ≥14px、离墙够远
            edge_ok = (xx > 9) & (xx < S - 9) & (yy > 9) & (yy < S - 9)
            cand = np.where(inner & edge_ok & (np.hypot(xx - meeple[0], yy - meeple[1]) >= 16) & (dm > 7),
                            np.minimum(dm, 12) - 0.25 * np.hypot(xx - C, yy - C) + 40, 0)
            sy, sx = np.unravel_index(np.argmax(cand), cand.shape)
            if cand.max() > 0:
                paste(sprites["shield"], sx + 0.5, sy + 0.5)
                anchors["shields"].append([round((sx + .5) / S, 3), round((sy + .5) / S, 3)])
        keep = np.zeros((S, S), bool)
        kx, ky = int(meeple[0]), int(meeple[1])
                # 塔：放在城墙中段（离地块边最远的墙上那一点），不越出地块
        if sprites.get("tower") is not None and 2 <= len(edges) < 4:
            wallring = m & (dm > 1.5) & (dm <= 3.5)
            sc = np.where(wallring, np.minimum(np.minimum(xx, S - xx), np.minimum(yy, S - yy)), -1)
            if sc.max() >= 9:
                ty, tx = np.unravel_index(np.argmax(sc), sc.shape)
                paste(sprites["tower"], tx + 0.5, ty + 0.5, margin=1)
        keep[max(0, ky - 8):ky + 8, max(0, kx - 6):kx + 6] = True   # 落点附近：房子可以有（小人站在屋顶上也看得清），树和盾不压
        n = 0
        slots = []
        for gy in range(5, 64, 8):
            for gx in range(5, 64, 9):
                slots.append((gx + (gy // 8 % 2) * 4, gy))
        for jx, jy in sorted(slots, key=lambda p: p[1]):
            if houses:
                sp = houses[(jx * 7 + jy * 3 + n) % len(houses)]
                if paste(sp, jx, jy, need=m & (dm > 2.5), margin=2, soft=True):
                    n += 1
                elif small_houses and paste(small_houses[(jx + jy) % len(small_houses)], jx, jy, need=m & (dm > 2.5), margin=2, soft=True):
                    n += 1   # 窄的城（单边城、角上的城）放不下大房子时放小房子
        occupied[keep] = False
        occupied[keep] = True   # 小人落点一直空着（后面的树也不压）
        anchors["cities"].append({"edges": edges, "spot": [round(meeple[0] / S, 3), round(meeple[1] / S, 3)]})
    # 路的落点：每条路上离中心约 2/3 处（到中心为止的）或者中点
    for a, b in roads:
        if b == "*":
            ax, ay = MID[a]
            px, py = ax + (C - ax) * 0.45, ay + (C - ay) * 0.45
        elif {a, b} in ({"N", "S"}, {"E", "W"}):
            px, py = C, C
            if t["cities"] or len(roads) > 1:
                pass
        else:
            cx, cy = CORNER[frozenset(a + b)]
            ang = math.atan2(C - cy, C - cx)
            px, py = cx + C * math.cos(ang), cy + C * math.sin(ang)
        anchors["roads"].append({"road": [a, b], "spot": [round(px / S, 3), round(py / S, 3)]})
    # 农田：按规则的端口找连通块，核对「同一片的端口在同一块里、不同片在不同块里」
    PORTS = [(16, 1), (48, 1), (62, 16), (62, 48), (48, 62), (16, 62), (1, 48), (1, 16)]
    NAMES = ["N0", "N1", "E0", "E1", "S0", "S1", "W0", "W1"]
    fmask = ~city & ~(rd <= RW + 1)
    lab, _ = ndimage.label(fmask)
    fd = ndimage.distance_transform_edt(np.pad(fmask, 1, constant_values=True))[1:-1, 1:-1]
    problems = []
    seen = {}
    for fi, ports in enumerate(t["fields"]):
        comps = set()
        for pn in ports:
            j = (NAMES.index(pn) + 2 * k) % 8
            px, py = PORTS[j]
            comps.add(int(lab[py, px]))
        if len(comps) != 1 or 0 in comps:
            problems.append(f"农田{fi} 端口分在 {comps}")
            continue
        comp = comps.pop()
        if comp in seen:
            problems.append(f"农田{fi} 和 农田{seen[comp]} 连在一起")
        seen[comp] = fi
        cm = lab == comp
        sc = np.where(cm & (fd > 3) & ~occupied, np.minimum(fd, 10) - 0.2 * np.hypot(xx - C, yy - C), -999)
        fy, fx = np.unravel_index(np.argmax(sc), sc.shape)
        anchors["fields"].append({"ports": ports, "spot": [round((fx + .5) / S, 3), round((fy + .5) / S, 3)]})
        occupied[max(0, fy - 7):fy + 8, max(0, fx - 7):fx + 8] = True
    sizes = ndimage.sum(fmask, lab, range(1, lab.max() + 1))
    port_comps = {int(lab[PORTS[j][1], PORTS[j][0]]) for j in range(8)} - {0}
    big = sum(1 for c in port_comps if sizes[c - 1] >= 12)   # 只数碰到端口的；城角之间的小草地不算
    if t["fields"] and big != len(t["fields"]):
        problems.append(f"草地连通块 {big} 个（≥12px），规则 {len(t['fields'])} 片")
    # 城市段之间不能连在一起（H、I）
    if len(cmasks) > 1:
        cl, cn = ndimage.label(city)
        if cn != len(cmasks):
            problems.append(f"城市段连成了 {cn} 块，规则 {len(cmasks)} 段")
    anchors["problems"] = problems
    cat = np.zeros((S, S), np.uint8)
    cat[city] = 1
    cat[rd <= RW] = 2
    anchors["_cat"] = cat
    # 树和灌木：未旋转坐标里的固定候选点，转过去后检查是否在草地里
    trees = sprites.get("trees") or []
    bushes = sprites.get("bushes") or []
    spots = [(10, 10), (54, 10), (10, 54), (54, 54), (32, 9), (9, 32), (55, 32), (32, 55), (20, 46), (46, 20), (44, 46), (20, 20),
             (24, 56), (40, 8), (56, 42), (8, 24)]
    keepout = np.zeros((S, S), bool)
    for c in anchors["cities"]:
        pass
    count = 0
    for i, (sx, sy) in enumerate(spots):
        x, y = rot_pt(sx, sy, k)
        group = trees if i % 3 != 2 else bushes
        if not group:
            continue
        sp = group[(i + ord(tid)) % len(group)]
        if paste(sp, x, y, need=fdist > 2.5, margin=1):
            count += 1
        if count >= (4 if not t["cities"] and not t["roads"] else 3 if not t["cities"] else 2):
            break
    return out, anchors


def load_sprites():
    def many(prefix):
        return [Image.open(p).convert("RGBA") for p in sorted(PICK.glob(f"{prefix}*.png"))]
    return {
        "monastery": load("monastery"), "well": load("well"), "shield": load("shield"), "tower": load("tower"),
        "houses": many("house"), "trees": many("tree"), "bushes": many("bush"),
        "small_houses": [h.resize((max(1, round(h.width * 0.72)), max(1, round(h.height * 0.72))), Image.NEAREST) for h in many("house")[:6]],
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "32").mkdir(exist_ok=True)
    sprites = load_sprites()
    grass = texture("grass", "#5fae3c")
    ground = texture("ground", "#cdbf9f")
    anchors = {}
    cats = {}
    allprob = []
    for tid in TILES:
        for k in range(4):
            im, an = compose(tid, k, sprites, grass, ground)
            cats[f"{tid}{k}"] = an.pop("_cat")
            allprob += [f"{tid}-{k}: {p}" for p in an["problems"]]
            im.convert("RGB").save(OUT / f"tile-{tid}-{k}.png")
            im.convert("RGB").resize((32, 32), Image.BOX).save(OUT / "32" / f"tile-{tid}-{k}.png")
            if k == 0:
                anchors[tid] = an
                im.convert("RGB").save(OUT / f"tile-{tid}.png")
    for a in anchors.values():
        a.pop("problems", None)
    (OUT / "anchors.json").write_text(json.dumps(anchors, ensure_ascii=False, indent=1))
    np.savez_compressed(ART / "out" / "tiles" / f"{SET}-cats.npz", **cats)
    print("ok", OUT, "规则核对问题：", allprob or "无")


if __name__ == "__main__":
    main()
