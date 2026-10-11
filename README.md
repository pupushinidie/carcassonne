# 卡卡颂

2–5 人轮流抽地块、一起拼地图、放小人占城市和道路的网页桌游（基础版 72 块，农夫默认开）。
线上：https://gulugagame.com/carcassonne/ · 本地服务端口 3025、网页开发端口 5296。

```bash
npm install
npm run dev            # 服务 3025 + 网页 5296（SERVER_PORT / WEB_PORT 可改）
npm test               # 引擎 + 服务器测试
npm run typecheck
BASE_PATH=/carcassonne/ npm run build
```

脚手架从多米诺王国（kingdomino@89bebe4）复制：同样是「在版图上摆地块」的游戏，带放置预览、旋转、整数倍格子、
加人机、托管、观战、挤登录、管理员解散这些全站房间功能。

## 怎么玩（自己的话）

- 开局：起始地块放在地图中间（北边一段城，东西一条路），其余 71 块洗混扣着当牌堆。每人 7 个小人，随机先手。
- 轮到你：
  1. **抽一块、放下**（必做）：大家都看得到你抽到什么。要挨着已有地块（上下左右，只碰到角不算），
     而且和每一块邻居相接的边都要同类：城接城、路接路、草地接草地。可以转 90 度的倍数。
     抽到放哪都不行的地块，会自动移出本局、再抽一块（界面上明显提示）。
  2. **放一个小人**（可选）：只能放在刚放的这块上，放进一条路（路人）、一座城（骑士）、修道院（修士）
     或一片草地（农夫，躺着）。这条路 / 这座城 / 这片草地连起来的整片区域里**已经有小人就不能放**，不管是谁的。
  3. **结算**（自动）：因为这块而完工的路、城、修道院马上计分，小人收回。
- 完工条件：路两头都到头（接进城、路口、修道院，或者绕成环）；城被城墙围死；修道院周围 8 格都有地块。
- 计分：
  - 完工时：路每块 1 分；城每块 2 分 + 每个盾徽 2 分；修道院 9 分。
  - 终局时没完工的：路每块 1 分；城每块 1 分 + 每个盾徽 1 分；修道院 1 + 周围已有的地块数。
  - 农田（终局才算）：每片草地挨着几座**已完工**的城，就得 3 × 几分；同一座城可以给好几片草地各加一次。
  - 一个区域里谁的小人最多谁得分，并列最多的都拿全分；没得分的小人也一样收回（农夫整局不收回）。
- 牌堆抽完、最后一块放完后终局结算，总分最高的赢，并列就一起赢。

## 默认规则表（规则书没写死、开工拍板定的、全站约定）

| 项 | 这里的做法 | 来源 |
|---|---|---|
| 范围 | 只做基础 72 块（24 种 A–X），不做河流、修道院长等扩展 | 他拍板 |
| 农夫 | 默认开；等候房间里房主可以关（关掉后不能放农夫，终局不算农田） | 他拍板 |
| 农田计分 | 现行规则：每片农田各自数挨着的已完工城市，每座 3 分，同一座城可以给多片农田加分 | 他拍板（规则书 ⚠️#3） |
| 并列 | 总分并列最高 = 并列获胜 | 他拍板（⚠️#4） |
| 一块地块上两段城连成同一座城 | 这块只算 1 块 | 他拍板（⚠️#5） |
| 放不下的地块 | 移出本局（公开，日志和侧栏都显示），再抽；牌堆抽空就结束 | 他拍板（⚠️#6） |
| 试放预览同步 | 当前玩家拿着地块试的位置、旋转（放小人时的预选段）实时给其他人看，服务端每连接 100ms 节流转发，不进对局状态、不重置倒计时 | 他拍板（⚠️#7） |
| 放小人这一步没有可放的地方 | 小人用完了、或者这块上每段都已经有人：自动跳过放小人（日志写「没有能放的地方」） | 全站硬规矩「没有合法行动就跳过」 |
| 起始地块 | D，(0,0)，不旋转；先手随机 | 规则书第 3 节 |
| 超时 | 放地块 90 秒：放在 legalPlacements 按 行→列→旋转 排序的第一个；放小人 30 秒：不放 | 规则书 9.4 |
| 托管 | 连续超时 2 次转托管，由人机代打；离线 3 秒后人机代打，原昵称加房间码回座 | 全站约定（覆盖规则书 9.4 的「默认动作」） |
| 人机 | 只有「普通」难度，叫咕噜一号～四号，带「人机」标签 | 全站约定 |
| 玩家颜色 | 按座位：红、蓝、紫、白、黑 | 美术规格 |
| 隐藏信息 | 只有牌堆顺序；种子、随机数状态、动作序列也只在服务端。观战看到的和玩家一样 | 规则书 9.3 |

## 目录

| 路径 | 内容 |
|---|---|
| `packages/game/src/tileData.ts` | 24 种地块（规则书 2.2）+ 小人落点（美术 anchors.json） |
| `packages/game/src/map.ts` | 旋转、合法放置、区域分析（并查集）、计分公式、能放小人的段 |
| `packages/game/src/engine.ts` | 开局、`apply`、超时、终局结算、`redactGameForViewer` |
| `packages/game/src/scenes.ts` | 预览局面工厂（见下） |
| `packages/game/src/bot.ts` | 人机 `botCommand` |
| `apps/server` | Socket.IO 房间服务器（`game:hover` 转发试放预览） |
| `apps/web` | 网页（`preview.html` + `src/preview.tsx` 是预览页，提交在仓库里） |
| `art/` | 美术脚本和规格（`art/spec.md`），定稿 `art/out/final/` 已复制到 `apps/web/public/art/` |
| `scripts/test-bot.mjs` | 陪玩机器人 |
| `scripts/spy.mjs` | 抓包：确认发给别人的数据里没有牌堆顺序和种子 |

## 一个人怎么测

```bash
npm run dev
node scripts/test-bot.mjs host 3 2     # 机器人建房、拉 1 个机器人，等你从浏览器加入凑满 3 人后开局
node scripts/test-bot.mjs join ABC234  # 机器人加入你的房间
# BOT_DELAY_MS=思考毫秒（默认 1500）；BOT_IDLE=1 只挂着等超时；BOT_SMART=1 用人机策略；
# NO_FARMERS=1 建房时关农夫；REMATCH=1 打完同意再来一局
node scripts/spy.mjs                   # 抓包检查
```

服务器测试用的环境变量：`TURN_MS`（每一步超时毫秒）、`BOT_DELAY_SCALE`（人机停顿倍数，0 = 立刻）。

## 对外接口：预览局面工厂（`@carcassonne/game`）

玩家 id 固定 `p1…p5`、名字 甲乙丙丁戊，「自己」是 p1。

- `scene(name, players?)`：按名字造局面。`SCENE_NAMES`：
  `start` 开局 · `place` 轮到甲放地块（打了 18 块）· `meeple` 甲刚放下 J、可以放骑士/路人/农夫 · `scored` 甲封城得 4 分、骑士收回 ·
  `removed` 乙抽到放不下的 C 被移出 · `noMeeples` 甲小人用完 · `merged` 丙把甲乙两座城连起来封口、并列各 8 分 ·
  `others` 4 人局轮到别人 · `timeout` 上一位超时 · `full5` 5 人局打了 45 块 · `late` 快结束 ·
  `final` / `final5` / `finalTie` 终局（3 人 / 5 人 / 并列）· `nofarm` 农夫关。
- `buildState(spec)`：按参数造任意精确局面：`{ players, tiles: [{r,c,t,rot}], meeples: [{player, r, c, seg}], scores, supply, current, step, drawn, last, deck, farmers, seed }`。
- `playOut(state, tiles, seed)`：从一个局面用固定种子的随机策略往下打 tiles 块。
- `setupGame(players, { seed, options, deck, first })`：指定牌堆顺序和先手开局（教程剧本用）。
- 其他：`legalPlacements(board, type)`、`analyze(board, meeples)`（所有区域）、`meepleOptions(...)`、`finalScoring(state)`、
  `segmentsOf(type, rot)`（段下标：先道路、再城市、再农田、最后修道院，旋转不变）、`tileShape(type, rot)`。

## 新手教程

- 剧本 `packages/game/src/tutorial.ts`（`tutorialSteps()`，结尾几步第一次用到时由人机快进算出，缓存），单测 `tutorial.test.ts`。
- 网页：`apps/web/src/tutorial/`（全站共用的咕噜嘎教练层，从多米诺王国复制，不改逻辑）、`TutorialMode.tsx`、`tutorialGame.ts`（提示、小贴士）。
- 入口：首页和等候房间的邀请卡，地址带 `?tutorial` 直接打开。学完一键开练习局（对咕噜一号，可以点「提示」/ 键盘 H）。
- 「提示」也出现在只有自己和人机的真实对局里；「第一次遇到」小贴士只在真实对局里出。
- 走查脚本：`~/projects/qa-reports/tools/tut-carcassonne.mjs <输出目录> flow|skip|waiting|room [尺寸] [主题]`。

## 测试

- `packages/game/src/engine.test.ts`：规则书第 10 节 TC1–TC14 逐条（测试名带「规则书#TCn」），第 2–9 节各有场景测试，
  预览场景全部能造，每种人数 300 局随机对局检查不变量（72 块守恒、每人 7 个小人守恒、分数 = 得分记录之和、turn 前进、
  手上的地块一定放得下、完工区域上不留小人、地图每条接缝对得上、终局判定和并列）。
- `apps/server/test/game.test.ts`：两人打完整局 + 再来一局 + 抓包、原昵称回座、超时、试放预览转发和节流。
- `spectate.test.ts`、`kickSession.test.ts`、`bots.test.ts`：从模板继承的观战、挤登录、人机托管。
