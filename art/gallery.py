"""生成画廊图片（out/gallery/）和不阻塞的拍板 JSON（assets/gallery-decision.json）。python gallery.py"""
import json, pathlib, subprocess, sys
from PIL import Image

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"
G = OUT / "gallery"
G.mkdir(parents=True, exist_ok=True)
PY = sys.executable
COLS = ["red", "blue", "purple", "white", "black"]


def zoomed(src, dst, z):
    im = Image.open(src).convert("RGBA")
    im.resize((im.width * z, im.height * z), Image.NEAREST).save(dst)
    return str(dst)


def meeple_sheet(idx):
    d = OUT / f"meeple-c{idx}"
    subprocess.run([PY, "meeples.py", str(idx), str(d)], cwd=ART, check=True, capture_output=True)
    bgs = [Image.open(OUT / "pick" / "set2" / "grass.png").convert("RGBA"), Image.open(OUT / "pick" / "set2" / "ground.png").convert("RGBA"),
           Image.new("RGBA", (64, 64), (227, 201, 138, 255)), Image.new("RGBA", (64, 64), (30, 33, 44, 255)), Image.new("RGBA", (64, 64), (245, 242, 234, 255))]
    Z = 3
    o = Image.new("RGBA", (10 * 28 * Z, 5 * 28 * Z))
    for bi, bg in enumerate(bgs):
        for mi, c in enumerate(COLS):
            for li, kind in enumerate(("stand", "lie")):
                cell = bg.crop((0, 0, 28, 28)).copy()
                cell.alpha_composite(Image.open(d / f"{kind}-{c}.png"), (2, 2))
                o.paste(cell.resize((28 * Z, 28 * Z), Image.NEAREST), ((mi * 2 + li) * 28 * Z, bi * 28 * Z))
    p = G / f"meeple-c{idx}.png"
    o.save(p)
    return str(p)


def map_crop(s):
    im = Image.open(OUT / f"map-{s}-2x.png")
    p = G / f"map-{s}-2x.png"
    im.crop((0, 0, min(im.width, 768), min(im.height, 512))).save(p)
    return str(p)


for s in ("set1", "set2", "set3"):
    subprocess.run([PY, "mapdemo.py", s, str(OUT / f"map-{s}.png"), "3", "34"], cwd=ART, check=True, capture_output=True)
    subprocess.run([PY, "ov_tiles.py", s, str(G / f"tiles-{s}.png")], cwd=ART, check=True)

TILESET = {
    "set1": "石板城：奶白城墙、米色石板地，修道院带方形回廊花园（外面一圈矮墙）",
    "set2": "灰石城：灰石城墙、暖砂石板地，修道院是红顶十字教堂加小花园；城和草地、路的对比最清楚",
    "set3": "深草城：草地更深、石板偏赭色，城墙上是红顶圆塔，修道院是十字教堂带侧院",
}
q = []
q.append({"id": "tiles", "type": "choice", "question": "24 种地块（整套）",
          "options": [{"value": s, "label": {"set1": "石板城", "set2": "灰石城", "set3": "深草城"}[s],
                       "images": [str(G / f"tiles-{s}.png"), map_crop(s)],
                       "description": TILESET[s] + "。第一张：24 种 × 4 个旋转（64px）和一排 32px；第二张：随机拼的合法地图放大 2 倍。",
                       **({"recommended": True} if s == "set2" else {})} for s in ("set1", "set2", "set3")],
          "allowOther": True, "required": False})
q.append({"id": "meeple", "type": "choice", "question": "小人（5 色，站立 + 躺倒的农夫）",
          "options": [{"value": f"m{i}", "label": f"候选 {i}", "images": [meeple_sheet(i)],
                       "description": "从上到下：草地、城内石板、道路、夜间底色、白天底色" + ("。推荐：轮廓最干净" if i == 12 else ""),
                       **({"recommended": True} if i == 12 else {})} for i in (0, 12, 44)],
          "allowOther": True, "required": False})


def simple(qid, title, items, rec, z=1, desc=None):
    opts = []
    for n, (val, path) in enumerate(items):
        img = zoomed(ART / path, G / f"{qid}-{val}.png", z) if z > 1 else str(ART / path)
        o = {"value": val, "label": val, "images": [img], "description": (desc or {}).get(val, "备选")}
        if val == rec:
            o["recommended"] = True
        opts.append(o)
    q.append({"id": qid, "type": "choice", "question": title, "options": opts, "allowOther": True, "required": False})


simple("bg-night", "夜间牌桌（石桌）", [(f"s{s}", f"out/r1/bg-night-s{s}.png") for s in (211, 212, 213)], "s212",
       desc={"s212": "推荐：中间一大块空的深色平石板，灯笼只在四角，地图压在上面最清楚", "s211": "备选：石板格子多，中间偏花", "s213": "备选：顶上有一块月光，偏亮"})
simple("bg-day", "白天牌桌（石桌）", [(f"s{s}", f"out/r1/bg-day-s{s}.png") for s in (201, 202, 203)], "s201",
       desc={"s201": "推荐：中间平石板最安静，四周青苔小花", "s202": "备选：中间石板裂纹多", "s203": "备选：石板偏小块"})
simple("tile-back", "地块背面（牌堆图标）", [(f"s{s}", f"out/r1/tile-back-s{s}.png") for s in (121, 122, 123)], "s121", z=3,
       desc={"s121": "推荐：浅木色 + 绿宝石徽记，和草地同色系"})
simple("start-flag", "起始地块小旗", [("f0", "out/r1/ui-flag/ui-flag.png"), ("f4", "out/r1/ui-flag/ui-flag-4.png"), ("f12", "out/r1/ui-flag/ui-flag-12.png")], "f0", z=6,
       desc={"f0": "推荐：旗杆直、纯色三角旗，没有图案；界面上会飘（6 帧）"})
simple("result-wreath", "结算花环", [(f"s{s}", f"out/r2/ui-wreath-s{s}.png") for s in (701, 702, 703)], "s702", z=2,
       desc={"s702": "推荐：左右对称的拱形，中间留给名次和分数", "s701": "备选：右边吊着个铃铛，不对称", "s703": "备选：太细、中间有金色饰条"})
simple("cover", "大厅封面", [("cover-1", "out/covers/cover-1.png"), ("cover-2", "out/covers/cover-2.png"), ("cover-3", "out/covers/cover-3.png")], "cover-2",
       desc={"cover-2": "推荐：围城、城门、修道院和池塘都在，没有人物没有字", "cover-1": "备选：城堡偏挤在左边", "cover-3": "备选：中间路上有一个很小的人形"})

decision = {
    "id": "art-gallery",
    "title": "卡卡颂：正式美术画廊",
    "stage": "art",
    "blocking": False,
    "intro": ("卡卡颂正式美术（方向 1 春日沙盘）的候选，每样一题。标「推荐」的是美术自查后挑定、已经导出到 art/out/final 的那张，"
              "不选就按推荐上线；想换哪张随时来换，都不满意选「其他」写备注，美术重画。\n\n"
              "**地块是 PixelLab 部件（房子、塔、树、修道院、井、盾徽、草地纹理）+ 代码按规则书 2.2 合成的**：路从边中点出入、城市边整条是城，"
              "所有合法相邻组合（6244 对）的接缝都对得上；每个旋转方向单独一张图，所以房子和盾徽永远是正的。整套地块是一个选项，不能逐张混搭。\n\n"
              "牌桌效果（随机拼的合法地图 + 5 色小人）：夜间 " + str(OUT / "preview-night.png") + "，白天 " + str(OUT / "preview-day.png") + "。\n\n"
              "放置高亮、落点圆环、得分闪光、尘土、小人落下、起始旗飘动这些小动画是代码画的，只有一版。"),
    "questions": q,
}
# 牌桌预览当成第一题的说明图
decision["questions"].insert(0, {"id": "preview", "type": "choice", "question": "牌桌效果预览（不用选，看整体）",
                                 "options": [{"value": "ok", "label": "整体可以", "images": [str(OUT / "preview-night.png"), str(OUT / "preview-day.png")],
                                              "description": "夜间 / 白天石桌上一张随机拼的 40 块地图（64px/格，1 倍）", "recommended": True}],
                                 "allowOther": True, "required": False})
dst = ART.parent / "assets" / "gallery-decision.json"
dst.write_text(json.dumps(decision, ensure_ascii=False, indent=1))
print("ok", dst, len(q), "题")
