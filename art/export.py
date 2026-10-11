"""按 spec.md 把定稿导出到 out/final/（目录结构 = apps/web/public/art/），封面候选导出到 out/covers/，写 selection.json。
前置：pick.py <set> → tiles.py <set> → meeples.py <编号> out/final/meeple → fx.py。一键：python export.py all
"""
import json, pathlib, shutil, subprocess, sys
import numpy as np
from PIL import Image

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"
FINAL = OUT / "final"
PY = sys.executable

SEL = {
    "tiles": {"set": "set2", "candidates": ["set1", "set2", "set3"],
              "why": "灰石城墙和暖砂石板地对比最清楚，红十字修道院比带框的回廊更好认；三套接缝检查都是 0 处不一致"},
    "meeple": {"pick": 12, "candidates": "out/r1/meeple-stand/（64 个）", "why": "轮廓最干净、头和手脚比例最像小人；换 5 色后在草地/城内/道路/夜间/白天都分得清"},
    "bg-day": {"pick": "out/r1/bg-day-s201.png", "candidates": ["out/r1/bg-day-s201.png", "out/r1/bg-day-s202.png", "out/r1/bg-day-s203.png"],
               "why": "中间一大块平石板最安静，地图压在上面不花；四周青苔和小花跟地块同一套颜色"},
    "bg-night": {"pick": "out/r1/bg-night-s212.png", "candidates": ["out/r1/bg-night-s211.png", "out/r1/bg-night-s212.png", "out/r1/bg-night-s213.png"],
                 "why": "中间空出一大块深色平石板，灯笼只在四角，地块最亮"},
    "tile-back": {"pick": "out/r1/tile-back-s121.png", "candidates": ["out/r1/tile-back-s121.png", "out/r1/tile-back-s122.png", "out/r1/tile-back-s123.png"],
                  "why": "浅木色配绿宝石徽记，和草地同色系，缩到 32px 还是一块「背面」"},
    "start-flag": {"pick": "out/r1/ui-flag/ui-flag.png", "candidates": "out/r1/ui-flag/（64 个）", "why": "旗杆直、旗面是纯色三角，没有图案和字"},
    "result-wreath": {"pick": "out/r2/ui-wreath-s702.png", "candidates": ["out/r2/ui-wreath-s701.png", "out/r2/ui-wreath-s702.png", "out/r2/ui-wreath-s703.png"],
                      "why": "左右对称的拱形花环，中间留空给名次和分数"},
    "covers": {"candidates": ["out/r1/cover-s811.png", "out/r1/cover-s812.png", "out/r1/cover-s813.png"], "recommended": "cover-2.png",
               "why": "812：围城、城门、修道院和池塘都在，没有人物没有字；813 中间有一个很小的人形，811 偏挤"},
    "parts": {"note": "地块部件（v2 候选编号）见 pick.py 的 SETS"},
}


def opaque(src, dst):
    Image.open(src).convert("RGB").save(dst)


def main():
    s = SEL["tiles"]["set"]
    if "all" in sys.argv:
        subprocess.run([PY, "pick.py", s], cwd=ART, check=True)
        subprocess.run([PY, "tiles.py", s], cwd=ART, check=True)
        subprocess.run([PY, "meeples.py", str(SEL["meeple"]["pick"]), str(FINAL / "meeple")], cwd=ART, check=True)
        subprocess.run([PY, "fx.py"], cwd=ART, check=True)
    src = OUT / "tiles" / s
    for d in ("tiles", "tiles32", "bg", "ui"):
        (FINAL / d).mkdir(parents=True, exist_ok=True)
    for p in src.glob("tile-*.png"):
        shutil.copy(p, FINAL / "tiles" / p.name)
    for p in (src / "32").glob("tile-*.png"):
        shutil.copy(p, FINAL / "tiles32" / p.name)
    shutil.copy(src / "anchors.json", FINAL / "tiles" / "anchors.json")
    opaque(ART / SEL["tile-back"]["pick"], FINAL / "tiles" / "tile-back.png")
    opaque(ART / SEL["bg-day"]["pick"], FINAL / "bg" / "table-day.png")
    opaque(ART / SEL["bg-night"]["pick"], FINAL / "bg" / "table-night.png")
    w = Image.open(ART / SEL["result-wreath"]["pick"]).convert("RGBA")
    a = np.array(w); a[..., 3] = np.where(a[..., 3] > 127, 255, 0)
    Image.fromarray(a).save(FINAL / "ui" / "result-wreath.png")
    # 图标：32px 的 S 地块（城 + 盾 + 路），四周 1px 深描边
    ic = Image.open(FINAL / "tiles32" / "tile-S-0.png").convert("RGBA")
    edge = Image.new("RGBA", (32, 32), (58, 42, 30, 255))
    edge.paste(ic.crop((1, 1, 31, 31)), (1, 1))
    edge.save(FINAL / "ui" / "icon.png")
    (OUT / "covers").mkdir(exist_ok=True)
    for i, c in enumerate(SEL["covers"]["candidates"], 1):
        opaque(ART / c, OUT / "covers" / f"cover-{i}.png")
    (ART / "selection.json").write_text(json.dumps(SEL, ensure_ascii=False, indent=1))
    n = sum(1 for _ in FINAL.rglob("*.png"))
    print("ok", n, "张 PNG")


if __name__ == "__main__":
    main()
