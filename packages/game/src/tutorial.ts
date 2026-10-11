/**
 * 新手教程的剧本（卡卡颂）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器。两人局，你（先手）对咕噜一号；引擎本身不用随机数
 * （牌堆在开局时就摆好了），所以把牌堆摆成剧本要的顺序，剧情一定这样发生：
 *   1. 你抽到 E：放到起始地块上面（要旋转到城朝下），放骑士 → 城当场完工 4 分，骑士回手。
 *   2. 咕噜一号先抽到 C（四面城）：地图上没有开着的城，放不下，自动移出、再抽到 V。
 *   3. 你抽到 W（三岔路口）：接在起始地块的路东头，在往西的路上放路人。
 *   4. 咕噜一号抽到 W：接在路西头把路封口 → 别人帮你封口也算你的，你 3 分；它在自己往南的路上放路人。
 *   5. 你抽到 U（直路）：接在它的路下面 → 这条路已经有人，路上没有圈；顺便讲农夫，这次不放。
 *   6. 咕噜一号抽到 E，在左上放骑士。
 *   7. 你抽到 B（修道院）：放在起始地块下面，放修士。
 *   8. 「快进」到最后一块：剩下的牌按固定顺序由人机替双方打完，停在你放最后一块的时候（局面固定，单测验证）。
 *      你放最后一块 → 终局结算 → 结算框。
 * 剧本走完开一局新的练习局（随机），对手交给人机。
 *
 * 每一步写三件事：咕噜嘎说什么（say / note）、高亮哪个元素（anchor = 网页里 data-tutorial 的值）、
 * 等玩家做什么（do 步骤的 expect）。放地块和放小人都是「先点再确认」，网页按 GameBoard 报上来的
 * 当前选择把高亮挪到「旋转」「确认放置」「放X」（见 apps/web/src/TutorialMode.tsx）。
 */
import { botDecision } from "./bot.js";
import { apply, createGame, deckTiles, legalActions, redactGameForViewer, setupGame } from "./engine.js";
import { createRng } from "./rng.js";
import { key, legalPlacements, meepleOptions, tileShape } from "./map.js";
import type { GameCommand, GameState } from "./types.js";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

/** 剧本里的一步棋：规则引擎的命令，或者「快进到最后一块」。 */
export type TutorialMove = GameCommand | { readonly type: "FAST_FORWARD" };

interface StepBase {
  readonly id: string;
  /** 侧栏「新手教程」进度里这一课叫什么；没有就不单独列。 */
  readonly lesson?: string;
  /** 主句（24px），一句话说清这一步。 */
  readonly say: string;
  /** 补充说明（12px），最多两句。 */
  readonly note?: string;
  /** 触屏设备上换成这句说明。 */
  readonly noteTouch?: string;
  /**
   * 高亮哪个元素：网页里 data-tutorial 的值。固定的有 map hand rotate confirm meeple-options skip-meeple
   * confirm-meeple players my-score deck fit log status final last-tile（刚放下的那块）；带参数的：cell-<行>_<列>（能放的空格，行列是负数时带负号）、
   * spot-<段下标>（放小人的落点）。
   */
  readonly anchor?: string;
  readonly face?: TutorialFace;
}

export type TutorialStep =
  /** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: GameCommand })
  /** 对手按剧本自动走这几步，牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly TutorialMove[] });

export const TUTORIAL_SELF = "p1";
export const TUTORIAL_RIVAL = "p2";
export const TUTORIAL_RIVAL_NAME = "咕噜一号";
export const TUTORIAL_RIVALS = [{ id: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME }] as const;

/** 剧本前 8 次抽牌（C 会被移出）。 */
export const TUTORIAL_OPENING = ["E", "C", "V", "W", "W", "U", "E", "B"] as const;
/** 剩下的牌洗混用的种子（单测保证：快进后停在你放最后一块，这块放得下）。 */
export const TUTORIAL_REST_SEED = 1;

function players(selfName: string) {
  return [
    { id: TUTORIAL_SELF, name: selfName },
    { id: TUTORIAL_RIVAL, name: TUTORIAL_RIVAL_NAME },
  ];
}

/** 剧本用的整副牌：开头 8 块按剧本，后面按固定种子洗。 */
export function tutorialDeck(seed = TUTORIAL_REST_SEED): string[] {
  const rest = deckTiles();
  for (const tile of TUTORIAL_OPENING) rest.splice(rest.indexOf(tile), 1);
  return [...TUTORIAL_OPENING, ...createRng(seed).shuffle(rest)];
}

/** 教程开局：两人局，你先手，牌堆按剧本摆好（不洗牌）。 */
export function createTutorialGame(selfName: string, seed = TUTORIAL_REST_SEED): GameState {
  return setupGame(players(selfName), { seed: 20261011, deck: tutorialDeck(seed), first: 0 });
}

/** 练习局：新开一局两人局（随机牌堆、随机先手）。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame(players(selfName), seed);
}

/** 人机替 playerId 走一步（只看它能看到的）。 */
function botMove(state: GameState, playerId: string): GameCommand {
  return botDecision(redactGameForViewer(state, playerId), playerId)?.command ?? legalActions(state, playerId)[0]!;
}

/**
 * 快进：剩下的牌由人机替双方打，停在「牌堆只剩 1 块、轮到你放」的时候（你放倒数第二块，咕噜一号放最后一块）。
 * 牌堆顺序固定、人机是确定的，所以每次快进出来都是同一个局面。
 */
export function createLateGame(previous: GameState): GameState {
  let state = previous;
  for (let guard = 0; guard < 400; guard += 1) {
    if (state.phase === "finished") break;
    const me = state.players[state.currentPlayer]!.id;
    if (state.deck.length === 1 && state.step === "place" && me === TUTORIAL_SELF) break;
    state = apply(state, me, botMove(state, me)).state;
  }
  return { ...state, events: [], version: previous.version + 1, turn: previous.turn + 1 };
}

/** 剧本里走一步：快进换成残局，其余交给规则引擎（不合法就抛错）。 */
export function tutorialApply(state: GameState, playerId: string, move: TutorialMove): GameState {
  if (move.type === "FAST_FORWARD") return createLateGame(state);
  return apply(state, playerId, move).state;
}

/** 两条命令是不是同一步。 */
export function sameCommand(a: TutorialMove, b: TutorialMove): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "PLACE_TILE" && b.type === "PLACE_TILE") return a.r === b.r && a.c === b.c && a.rot === b.rot;
  if (a.type === "PLACE_MEEPLE" && b.type === "PLACE_MEEPLE") return a.seg === b.seg;
  return true;
}

/** 某种地块（旋转后）第 n 个某类段的下标。 */
function seg(type: string, rot: number, kind: "road" | "city" | "field" | "monastery", edge?: string): number {
  const found = tileShape(type, rot).segments.find((s) => s.kind === kind && (edge === undefined || s.edges.includes(edge as "N")));
  return found!.index;
}

export const cellAnchor = (r: number, c: number) => `cell-${r}_${c}`;
const place = (r: number, c: number, rot: number): GameCommand => ({ type: "PLACE_TILE", r, c, rot });
const meeple = (s: number): GameCommand => ({ type: "PLACE_MEEPLE", seg: s });
const SKIP: GameCommand = { type: "SKIP_MEEPLE" };

/** 剧本固定部分（快进之前）。 */
const OPENING_STEPS: TutorialStep[] = [
  {
    kind: "info", id: "goal", lesson: "目标", anchor: "map", face: "happy",
    say: "大家轮流放地块，一起拼一张地图。",
    note: "在地图上放小人占住路、城和修道院，它们完工时你得分。最后总分高的人赢。",
  },
  {
    kind: "info", id: "hand", lesson: "抽一块、放下", anchor: "hand",
    say: "每回合先抽一块地块，这就是你这回合要放的。",
    note: "放下时要挨着已有的地块，相接的边要同类：城接城、路接路、草地接草地。",
  },
  {
    kind: "do", id: "place-1", anchor: cellAnchor(-1, 0), expect: place(-1, 0, 2),
    say: "把它放到起始地块上面，让城接上城。",
    note: "先点亮着的空格。方向不对是红框，点「旋转」转到绿框，再点「确认放置」。放下就不能撤回。",
  },
  {
    kind: "info", id: "meeple-intro", lesson: "放小人", anchor: "meeple-options",
    say: "放下以后，可以在这块上放一个小人。",
    note: "圈出来的都是还没人占的地方：放在城里是骑士，路上是路人。每人只有 7 个小人。",
  },
  {
    kind: "do", id: "knight", anchor: "spot-0", expect: meeple(0),
    say: "在城里放一个骑士。",
    note: "点城里的圆圈选中，再点一次（或点「放骑士」）确认。",
  },
  {
    kind: "info", id: "city-done", lesson: "完工得分", anchor: "my-score", face: "happy",
    say: "城被城墙围死就完工了：2 块 × 2 分 = 4 分！",
    note: "城每块 2 分、每个盾徽再加 2 分。完工后骑士回到你手里，下回还能用。",
  },
  {
    kind: "info", id: "removed", lesson: "放不下的地块", anchor: "deck", face: "surprised",
    say: "咕噜一号抽到的地块四面都是城，地图上没地方放。",
    note: "这种地块会自动移出本局、再抽一块，不是程序出错。侧栏会写「已移出 N 块」。",
  },
  {
    kind: "watch", id: "rival-1", anchor: "map",
    moves: [place(-1, 1, 2), SKIP],
    say: "看咕噜一号放它的地块。",
    note: "别人的回合你也能拖动、缩放地图看看。",
  },
  {
    kind: "do", id: "place-2", anchor: cellAnchor(0, 1), expect: place(0, 1, 0),
    say: "把这个路口接在路的东头。",
    note: "路接路。点亮着的空格，转到绿框再确认。",
  },
  {
    kind: "do", id: "road-meeple", anchor: `spot-${seg("W", 0, "road", "W")}`, expect: meeple(seg("W", 0, "road", "W")),
    say: "在往西的那条路上放一个路人。",
    note: "这条路连着起始地块，西头还开着。路两头都到头（接进城、路口或修道院）才算完工。",
  },
  {
    kind: "watch", id: "rival-2", anchor: "map",
    moves: [place(0, -1, 0), meeple(seg("W", 0, "road", "S"))],
    say: "咕噜一号把一个路口放在了西头……",
  },
  {
    kind: "info", id: "road-done", lesson: "别人封口也算你的", anchor: "my-score", face: "happy",
    say: "路两头都到头了：3 块 = 3 分，归你！",
    note: "谁放的地块不重要，看路上是谁的小人。路每块 1 分，你的路人也回来了。",
  },
  {
    kind: "do", id: "place-3", anchor: cellAnchor(1, -1), expect: place(1, -1, 0),
    say: "把这段直路接在咕噜一号的路下面。",
    note: "点亮着的空格，转到路接上路，再确认。",
  },
  {
    kind: "info", id: "occupied", lesson: "有人的地方不能放", anchor: "last-tile", face: "think",
    say: "这条路上已经有咕噜一号的路人，所以路上没有圈。",
    note: "连起来的整条路、整座城、整片草地里只要有小人（谁的都算），就不能再放。",
  },
  {
    kind: "info", id: "farmer", lesson: "农夫", anchor: "meeple-options", face: "think",
    say: "草地上的圈是农夫：小人躺下，整局都收不回来。",
    note: "终局时这片草地挨着几座完工的城，就得 3 × 几分。前期别急着放。",
  },
  {
    kind: "do", id: "skip", anchor: "skip-meeple", expect: SKIP,
    say: "这次不放小人，点「不放」。",
  },
  {
    kind: "watch", id: "rival-3", anchor: "map",
    moves: [place(-1, -1, 0), meeple(0)],
    say: "咕噜一号在左上放了一座城，还放了骑士。",
  },
  {
    kind: "do", id: "place-4", anchor: cellAnchor(1, 0), expect: place(1, 0, 0),
    say: "这块是修道院，放到起始地块下面。",
  },
  {
    kind: "do", id: "monk", anchor: `spot-${seg("B", 0, "monastery")}`, expect: meeple(seg("B", 0, "monastery")),
    say: "在修道院上放一个修士。",
    note: "修道院只属于这一块，随时都能放。",
  },
  {
    kind: "info", id: "monastery", lesson: "修道院", anchor: "last-tile",
    say: "修道院周围 8 格都放满，就完工得 9 分。",
    note: "现在周围有 4 块。放在地图中间的修道院最容易被围满。",
  },
  {
    kind: "info", id: "merge", lesson: "抢地盘", anchor: "map", face: "think",
    say: "两片各有人的路或城，可以被一块地块连成一片。",
    note: "连起来以后谁的小人多谁拿全部分，一样多就都拿全分。",
  },
  {
    kind: "watch", id: "fast-forward", anchor: "map",
    moves: [{ type: "FAST_FORWARD" }],
    say: "快进！我替你们把后面的地块都放了……",
  },
];

/** 快进之后的局面（剧本固定，单测验证）。 */
export function tutorialLateState(seed = TUTORIAL_REST_SEED): GameState {
  let state = createTutorialGame("你", seed);
  for (const step of OPENING_STEPS) {
    if (step.kind === "do") state = tutorialApply(state, TUTORIAL_SELF, step.expect);
    if (step.kind === "watch") for (const move of step.moves) state = tutorialApply(state, state.players[state.currentPlayer]!.id, move);
  }
  return state;
}

function endingSteps(): TutorialStep[] {
  const late = tutorialLateState();
  const decision = botDecision(redactGameForViewer(late, TUTORIAL_SELF), TUTORIAL_SELF)!;
  const last = decision.command as Extract<GameCommand, { type: "PLACE_TILE" }>;
  let state = apply(late, TUTORIAL_SELF, last).state;
  const options = state.step === "meeple" ? meepleOptions(state.board, state.meeples, key(last.r, last.c), true) : [];
  const steps: TutorialStep[] = [
    {
      kind: "info", id: "late", lesson: "游戏结束", anchor: "deck", face: "think",
      say: "牌堆只剩 1 块了：你放这块，咕噜一号放最后一块。",
      note: "最后一块放完游戏就结束，然后把没完工的地方也算一遍分。",
    },
    {
      kind: "do", id: "place-last", anchor: cellAnchor(last.r, last.c), expect: last,
      say: "把这块放到亮着的位置。",
      note: "方向不对就点「旋转」，绿框了再确认。",
    },
  ];
  if (state.step === "meeple" && state.currentPlayer === 0 && options.length > 0) {
    steps.push({ kind: "do", id: "skip-last", anchor: "skip-meeple", expect: SKIP, say: "快结束了，小人放下也来不及收回，点「不放」。" });
    state = apply(state, TUTORIAL_SELF, SKIP).state;
  }
  // 咕噜一号放最后一块（人机算出来的，剧本固定）
  const rivalMoves: GameCommand[] = [];
  for (let guard = 0; guard < 4 && state.phase !== "finished"; guard += 1) {
    const actor = state.players[state.currentPlayer]!.id;
    const move = botMove(state, actor);
    rivalMoves.push(move);
    state = apply(state, actor, move).state;
  }
  steps.push({ kind: "watch", id: "rival-last", anchor: "map", moves: rivalMoves, say: "咕噜一号放最后一块……" });
  steps.push(
    {
      kind: "info", id: "final", anchor: "final", face: "happy",
      say: "游戏结束！没完工的地方也算分。",
      note: "没完工的路每块 1 分、城每块 1 分加盾徽 1 分、修道院 1 分加周围块数；农夫按挨着的完工城每座 3 分。",
    },
    {
      kind: "info", id: "auto", lesson: "超时和托管", anchor: "status",
      say: "真打的时候每步有时限，超时会自动替你走。",
      note: "连续超时 2 次会转托管：人机替你打，点「取消托管」就拿回来。掉线时也由人机代打。",
    },
    {
      kind: "info", id: "done", finale: true, face: "happy",
      say: "学会了！和咕噜一号练一局吧。",
      note: "练习时拿不准就点「提示」（键盘 H），我告诉你我会怎么走。",
    },
  );
  return steps;
}

let cachedSteps: readonly TutorialStep[] | null = null;
/**
 * 整个剧本。结尾几步要先「快进」算出最后一块放哪（人机替双方打 60 多块，约几百毫秒），
 * 所以第一次用到时才算，之后缓存。
 */
export function tutorialSteps(): readonly TutorialStep[] {
  cachedSteps ??= [...OPENING_STEPS, ...endingSteps()];
  return cachedSteps;
}

/** 这一步之前不弹结算框。 */
export const TUTORIAL_FINAL_STEP = "final";

/**
 * 这个锚点在这个局面里，界面上应该看得见吗（给剧本单测用，对应 GameBoard 的显示条件）。
 * viewer 是看界面的人（教程里就是你）。
 */
export function anchorVisible(state: GameState, anchor: string, viewer: string): boolean {
  const me = state.players.findIndex((player) => player.id === viewer);
  const myTurn = state.phase !== "finished" && state.currentPlayer === me;
  if (anchor.startsWith("cell-")) {
    const [r, c] = anchor.slice(5).split("_").map(Number) as [number, number];
    return myTurn && state.step === "place" && state.drawn !== null && legalPlacements(state.board, state.drawn).some((p) => p.r === r && p.c === c);
  }
  if (anchor.startsWith("spot-")) {
    const index = Number(anchor.slice(5));
    if (!myTurn || state.step !== "meeple" || !state.lastPlaced) return false;
    return meepleOptions(state.board, state.meeples, key(state.lastPlaced.r, state.lastPlaced.c), state.config.farmers).includes(index)
      && state.players[me]!.supply > 0;
  }
  switch (anchor) {
    case "map":
    case "hand":
    case "players":
    case "my-score":
    case "deck":
    case "fit":
    case "log":
      return true;
    case "status":
      return true;
    case "last-tile":
      return state.lastPlaced !== null && state.phase !== "finished";
    case "rotate":
    case "confirm":
      return myTurn && state.step === "place";
    case "meeple-options":
    case "skip-meeple":
    case "confirm-meeple":
      return myTurn && state.step === "meeple";
    case "final":
      return state.phase === "finished";
    default:
      return false;
  }
}
