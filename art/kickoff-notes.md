# 卡卡颂 开工样张记录（2026-10-11，guluga-game-art）

工作目录：`~/projects/pipeline/games/carcassonne/assets/work/`（脚本 kick.py、kick_grid.py、compose.py；原图 raw/；构图 init/）
账本：`~/projects/pipeline/games/carcassonne/assets/ledger.jsonl`（10 次调用，全部走会员次数，美元 $0）

## 三个方向（代表图都是 /create-image-pixen 512x288，seed 11，detail "highly detailed"）

公共内容（MAP）：
> a small top-down map made of square board game terrain tiles fitted edge to edge: a walled medieval town with stone city walls and many small roofs, a small heraldic shield on the town, a dirt road leaving the town gate east to a small stone monastery with a bell tower and south out of the map, green meadows with bushes and trees, a little pond, two tiny wooden pawn figures (one red in the town, one blue on the road)

公共禁止项（NO）：
> no text, no letters, no numbers, no writing, no signs, no flags, no banners, no people, crisp pixel art, top-down view

| 方向 | 文件 | 风格词（STYLE） |
|---|---|---|
| 1 春日沙盘 | assets/kickoff-1-spring.png（raw/scene-1-s11.png） | bright sunny spring countryside, cheerful saturated colors, lush green grass, cream stone walls, terracotta red roofs, sandy yellow road, soft drop shadows to the south-east, clean dark outlines, cozy storybook board game look |
| 2 羊皮纸古地图 | assets/kickoff-2-parchment.png（raw/scene-2-s11.png） | old hand-drawn parchment map style, sepia and ochre ink on aged yellowed paper, brown ink outlines and hatching, faded muted colors, roofs drawn as small brown ink icons, road as a dark brown ink line, antique cartography look, vignette stains on the paper |
| 3 月夜灯火 | assets/kickoff-3-moonlit.png（raw/scene-3-s11.png） | moonlit night, deep navy and dark teal palette, cool blue moonlight, warm glowing orange-yellow windows and lanterns in the town and monastery, lanterns along the road, dark green meadows, fireflies, cozy mysterious atmosphere |

pixen 的描述 = `{MAP}, {STYLE}, {NO}`。

补充图（方向 1 的严格俯视版）：assets/kickoff-1-spring-topdown.png（raw/grid-1-s11.png，pixen 512x288 seed 11），描述见 work/kick_grid.py：在 STYLE 1 前加了 "strictly top-down orthographic view, a board game map made of 12 square terrain tiles in a 4 by 3 grid, each tile a separate square with thin dark seams..."。出来的图是正俯视、能看出地块分缝，但模型把整张画成了一座大围城，没有按 4x3 的边界规整切开。

总览：assets/kickoff-overview.png（上排原尺寸，中排缩到 60% 约等于单块 64–96px 的牌桌尺寸，下排方向 1 俯视版）。

## 试过但没用上的

- pixflux 384x288 + 代码构图 init（4x3 块，每块 96px；compose.py 画的菱形围城 + 路 + 修道院 + 小人），init_image_strength 420 和 180（后者加了 color_image = 对应方向的 pixen 场景）各 3 张：两次都基本照搬平涂构图，没长出细节（raw/tile-*）。和自然和弦开工时的结论一样：pixflux 的 init 适合锁构图，不适合从平涂色块生细节。

## 留给正式美术阶段的想法

- 正式地块不能用 pixen 的 3/4 斜俯视（高塔会越过地块边界、旋转后光影朝向会错）。地块要正俯视（参考 kickoff-1-spring-topdown.png 的视角），光影只用轻微的自上而下阴影，旋转 90° 后也不违和。
- 地块拼接：每种地块按规则书 2.2 的边类型出。思路：先用代码画每种地块的「边缘骨架」（城墙在边上的位置、道路在边中点、宽度固定），再用 bitforge（style_image = 选定方向的风格参考，inpainting 只重画内部、边缘一圈锁死）或 pixflux 低强度 init 补细节，最后脚本按所有合法相邻组合拼起来量接缝。也可以只让 PixelLab 出「草地底纹 / 城内屋顶纹理 / 城墙段 / 道路段 / 修道院 / 盾徽 / 路口村庄」这些部件，地块由代码按规则数据合成，接缝天然对齐（推荐，24 种 × 旋转都不会错）。
- 小人：5 色，一只画好用色相蒙版换色（站立 + 躺倒农夫两种姿势），v2 64 候选挑。
- 牌桌背景：方向 1 的「石砌桌面 + 抬高的草地地块（有厚度）」本身就很适合做牌桌：地块放在深色石台上，夜间/白天只换石台和光线，地块同一套。
