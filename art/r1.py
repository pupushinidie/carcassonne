"""卡卡颂正式美术第 1 轮：部件（草地、城内纹理、修道院、房子、树、塔、井、小人、旗、盾）、牌桌背景、地块背面、封面。
地块本身由 tiles.py 用这些部件按规则书 2.2 合成。
用法：PIXELLAB_PRIORITY=0 python r1.py [前缀…]   （一个进程，线程池 10）
"""
import sys, pathlib
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import pixellab

OUT = pixellab.ART / "out" / "r1"
NO = "no text, no letters, no numbers, no writing, no flags, no people"
LOOK = "bright sunny spring countryside palette, cheerful saturated colors, cozy storybook board game look, crisp pixel art"
TEX = "flat even lighting from directly above, no shadows, no objects, no border, no frame, fills the whole image edge to edge"
OBJ = "seen from directly above top-down, soft light from directly above, bold dark outline, " + LOOK
COVER = ("cozy 16-bit pixel art game cover illustration, rich warm colors, soft lighting, crisp clean pixels, "
         "no text, no letters, no logo")

JOBS = {
    # 无缝纹理（导出时用卷动混合做成周期 64 的无缝图）
    "tex-grass": ("/create-image-pixflux", "pixel art seamless tileable texture of a lush bright spring green grass meadow seen from directly above, "
                  "short grass with small light green and darker green tufts, a few tiny white and yellow wildflower dots, " + TEX, 64, 64, False, (101, 102, 103)),
    "tex-town": ("/create-image-pixflux", "pixel art seamless tileable texture of a dense medieval town seen from directly above, many small "
                 "terracotta red tiled roofs with ridges packed together, cream plaster walls, narrow light grey cobblestone lanes between, "
                 + TEX, 64, 64, False, (111, 112, 113)),
    "tile-back": ("/create-image-pixflux", "pixel art back side of a square wooden board game tile, warm light brown wood with a simple "
                  "square inset border and a small round green emblem in the center, symmetric, " + NO, 64, 64, False, (121, 122, 123)),
    # 部件（透明底，v2 一次出一批）
    "obj-monastery": ("/generate-image-v2", "pixel art of a small medieval stone monastery abbey seen from directly above, cross-shaped "
                      "terracotta red tiled roof with a small square bell tower roof at the crossing, cream stone walls, a tiny green "
                      "cloister garden, " + OBJ, 40, 40, True, (301,)),
    "obj-house": ("/generate-image-v2", "pixel art of a tiny medieval cottage roof seen from directly above, terracotta red tiled gable "
                  "roof with a ridge line, small chimney, " + OBJ, 16, 16, True, (302,)),
    "obj-tree": ("/generate-image-v2", "pixel art of a single round leafy tree crown seen from directly above, fresh green leaves, "
                 "lighter center, " + OBJ, 16, 16, True, (303,)),
    "obj-bush": ("/generate-image-v2", "pixel art of a small round green bush with a few tiny flowers seen from directly above, "
                 + OBJ, 12, 12, True, (304,)),
    "obj-tower": ("/generate-image-v2", "pixel art of a round stone castle tower seen from directly above, cream stone crenellated ring "
                  "top with a conical terracotta red roof in the middle, " + OBJ, 16, 16, True, (305,)),
    "obj-well": ("/generate-image-v2", "pixel art of a tiny village square seen from directly above: a round stone well with dark water "
                 "in the middle of a small cobblestone circle, " + OBJ, 20, 20, True, (306,)),
    "meeple-stand": ("/generate-image-v2", "pixel art game piece: a single plain white painted wooden meeple pawn standing upright, "
                     "chunky person shape with round head, arms out to the sides and legs apart, seen from the front slightly above, "
                     "soft light from top left, bold dark outline, no face", 24, 24, True, (401,)),
    "meeple-lie": ("/generate-image-v2", "pixel art game piece: a single plain white painted wooden meeple pawn lying flat on its back, "
                   "chunky person shape with round head, arms out and legs apart, horizontal, seen from above, soft light from top left, "
                   "bold dark outline, no face", 24, 24, True, (402,)),
    "ui-flag": ("/generate-image-v2", "pixel art of a small triangular red pennant flag on a thin wooden pole, plain cloth, no symbols, "
                "soft light from top left, bold dark outline", 16, 16, True, (403,)),
    "ui-shield": ("/generate-image-v2", "pixel art of a small heraldic shield, royal blue field with one white diagonal stripe, thin gold "
                  "rim, soft light from top left, bold dark outline, no letters", 16, 16, True, (404,)),
    # 牌桌背景
    "bg-day": ("/create-image-pixen", "pixel art top-down view of an empty large grey stone slab tabletop in bright daylight, "
               "big flagstones with moss in the cracks, a few small green leaves, wildflowers and pebbles near the edges, "
               "the large center is empty plain stone, soft warm sunlight, " + LOOK + ", " + NO, 512, 288, False, (201, 202, 203)),
    "bg-night": ("/create-image-pixen", "pixel art top-down view of an empty large dark stone slab tabletop at night, big flagstones "
                 "with moss in the cracks, cool blue moonlight, a few small candles and lanterns with warm glow near the corners, "
                 "fireflies, the large center is empty plain dark stone, " + NO, 512, 288, False, (211, 212, 213)),
    # 封面
    "cover": ("/create-image-pixflux", "a sunny medieval countryside seen from above made of square terrain tiles fitted together: "
              "a walled town with cream stone walls, round towers and terracotta red roofs, dirt roads winding through bright green "
              "meadows to a small monastery with a bell tower, trees and a pond, a few colorful wooden pawn pieces on the map, "
              + COVER, 384, 192, False, (811, 812, 813)),
}


def run(name, seed):
    endpoint, prompt, w, h, transparent, _ = JOBS[name]
    try:
        if endpoint == "/generate-image-v2":
            folder = OUT / name
            if folder.exists() and any(folder.glob("*.png")):
                return
            pixellab.generate_async(name, {"description": prompt, "image_size": {"width": w, "height": h},
                                           "no_background": transparent, "seed": seed}, folder, endpoint=endpoint)
        else:
            target = f"{name}-s{seed}"
            if (OUT / f"{target}.png").exists():
                return
            body = {"description": prompt, "image_size": {"width": w, "height": h}, "seed": seed}
            if endpoint == "/create-image-pixen":
                body["detail"] = "highly detailed"
            else:
                body["no_background"] = transparent
            pixellab.generate_image(target, body, OUT, endpoint=endpoint)
        print(name, seed, "ok", flush=True)
    except Exception as e:
        print(name, seed, "失败", e, flush=True)


if __name__ == "__main__":
    prefixes = sys.argv[1:]
    names = [n for n in JOBS if not prefixes or any(n.startswith(p) for p in prefixes)]
    tasks = [(n, s) for n in names for s in JOBS[n][5]]
    print("任务", len(tasks), flush=True)
    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(lambda t: run(*t), tasks))
    print("done", flush=True)
