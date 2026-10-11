"""牌桌预览：背景按 3 倍铺满 1440x790，中间放 set 的随机合法地图（64px/格）和小人。python preview.py <set> <day|night> <输出>"""
import sys, pathlib, subprocess
from PIL import Image
ART = pathlib.Path(__file__).resolve().parent
s, theme, outp = sys.argv[1:4]
subprocess.run([sys.executable, "mapdemo.py", s, str(ART / "out" / f"_map-{s}.png"), "7", "40"], cwd=ART, check=True, capture_output=True)
bg = Image.open(ART / "out" / "final" / "bg" / f"table-{theme}.png").convert("RGBA")
bg = bg.resize((bg.width * 3, bg.height * 3), Image.NEAREST).crop((48, 37, 48 + 1440, 37 + 790))
m = Image.open(ART / "out" / f"_map-{s}.png").convert("RGBA")
# 地图四周加 2px 深色阴影，像放在桌上
sh = Image.new("RGBA", (m.width + 6, m.height + 6), (0, 0, 0, 0))
mask = m.getchannel("A")
bgc = (58, 63, 75, 255)
px = m.load()
for y in range(m.height):
    for x in range(m.width):
        if px[x, y][:3] == bgc[:3]:
            px[x, y] = (0, 0, 0, 0)
x0, y0 = (1440 - m.width) // 2 - 150, (790 - m.height) // 2
shadow = Image.new("RGBA", m.size, (0, 0, 0, 0))
shadow.paste((0, 0, 0, 110), mask=m.getchannel("A"))
bg.alpha_composite(shadow, (x0 + 4, y0 + 4))
bg.alpha_composite(m, (x0, y0))
bg.convert("RGB").save(outp)
