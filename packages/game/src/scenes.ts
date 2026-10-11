/**
 * 预览局面工厂（对外接口）：界面预览页、教程、测试都用它造局面。
 *
 * - `buildState(spec)`：按参数造任意精确局面（地图上的每块地块、小人、分数、剩余小人、轮到谁、哪一步、手上的地块、牌堆）。
 * - `playOut(state, tiles, seed)`：从一个局面开始，用固定种子的随机策略往下打若干块（造「打到一半」「快结束」的大地图）。
 * - `scene(name)`：按名字造常见局面，名字见 SCENE_NAMES。
 *
 * 玩家 id 固定是 p1…p5，名字是 甲 乙 丙 丁 戊；预览里「自己」是 p1。
 */
import { apply, finalScoring, legalActions, setupGame } from "./engine.js";
import { analyze, key, legalPlacements, meepleOptions, roleOf, tileShape } from "./map.js";
import { createRng } from "./rng.js";
import { TILE_DEFS } from "./tileData.js";
import { MEEPLES_PER_PLAYER, type GameCommand, type GameEvent, type GameState, type Meeple } from "./types.js";

export const SCENE_PLAYER_NAMES = ["甲", "乙", "丙", "丁", "戊"];

export function scenePlayers(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: SCENE_PLAYER_NAMES[i]! }));
}

export interface BoardSpec {
  /** 人数，默认 2。 */
  readonly players?: number;
  /** 地图上除起始地块以外的地块（起始地块 D 自动放在 (0,0)；也可以在这里覆盖 0,0）。 */
  readonly tiles?: readonly { readonly r: number; readonly c: number; readonly t: string; readonly rot?: number }[];
  /** 小人：player 用下标（0 起）或 id，seg 是段下标。role 不用给，按段自动算。 */
  readonly meeples?: readonly { readonly player: number | string; readonly r: number; readonly c: number; readonly seg: number }[];
  readonly scores?: readonly number[];
  /** 剩余小人；不给就按 7 − 场上的个数。 */
  readonly supply?: readonly number[];
  /** 轮到谁（下标），默认 0。 */
  readonly current?: number;
  readonly step?: "place" | "meeple";
  /** step = place 时手上的地块；不给就从牌堆抽。 */
  readonly drawn?: string;
  /** step = meeple 时刚放下的地块位置（必须已经在 tiles 里）。 */
  readonly last?: { readonly r: number; readonly c: number };
  /** 牌堆（顺序）；不给就是剩下的地块按种子洗混。 */
  readonly deck?: readonly string[];
  readonly farmers?: boolean;
  readonly seed?: number;
}

/** 按参数造一个精确局面。不校验地块之间合不合法（造得出不合法的地图，注意别这么做）。 */
export function buildState(spec: BoardSpec = {}): GameState {
  const n = spec.players ?? 2;
  const base = setupGame(scenePlayers(n), {
    seed: spec.seed ?? 1,
    options: { farmers: spec.farmers ?? true },
    deck: ["B"],
    first: spec.current ?? 0,
  });
  const state = structuredClone(base);
  state.events = [];
  for (const tile of spec.tiles ?? []) {
    state.board[key(tile.r, tile.c)] = { t: tile.t, r: ((tile.rot ?? 0) % 4) as 0 | 1 | 2 | 3 };
  }
  state.turnNo = Object.keys(state.board).length;
  state.meeples = (spec.meeples ?? []).map((m): Meeple => {
    const pos = key(m.r, m.c);
    const tile = state.board[pos];
    if (!tile) throw new Error(`buildState：(${pos}) 没有地块`);
    const seg = tileShape(tile.t, tile.r).segments[m.seg];
    if (!seg) throw new Error(`buildState：(${pos}) 没有第 ${m.seg} 段`);
    const player = typeof m.player === "number" ? `p${m.player + 1}` : m.player;
    return { player, pos, seg: m.seg, role: roleOf(seg.kind) };
  });
  state.players.forEach((player, i) => {
    player.score = spec.scores?.[i] ?? 0;
    player.supply = spec.supply?.[i] ?? MEEPLES_PER_PLAYER - state.meeples.filter((m) => m.player === player.id).length;
  });
  // 牌堆：72 块 − 地图上的 −（手上的）
  const left: Record<string, number> = {};
  for (const [type, def] of Object.entries(TILE_DEFS)) left[type] = def.count;
  for (const tile of Object.values(state.board)) left[tile.t]! -= 1;
  if (spec.drawn) left[spec.drawn]! -= 1;
  const rest = Object.entries(left).flatMap(([type, count]) => Array.from({ length: Math.max(0, count) }, () => type));
  state.deck = spec.deck ? [...spec.deck] : createRng(spec.seed ?? 1).shuffle(rest);
  state.removed = [];
  state.history = [];
  state.currentPlayer = spec.current ?? 0;
  state.step = spec.step ?? "place";
  if (state.step === "meeple") {
    const last = spec.last;
    if (!last || !state.board[key(last.r, last.c)]) throw new Error("buildState：step = meeple 要给 last（刚放下的地块）");
    const tile = state.board[key(last.r, last.c)]!;
    state.lastPlaced = { r: last.r, c: last.c, rot: tile.r };
    state.drawn = null;
  } else {
    state.lastPlaced = spec.last ? { r: spec.last.r, c: spec.last.c, rot: state.board[key(spec.last.r, spec.last.c)]!.r } : null;
    state.drawn = spec.drawn ?? state.deck.shift() ?? null;
  }
  return state;
}

/** 固定种子的「会放小人」随机策略：放地块随机挑；放小人时 40% 概率随机放一个（农田只在后半局）。 */
function sceneCommand(state: GameState, rng: ReturnType<typeof createRng>): GameCommand {
  const playerId = state.players[state.currentPlayer]!.id;
  const actions = legalActions(state, playerId);
  if (state.step === "place") return actions[rng.int(actions.length)]!;
  const meeples = actions.filter((action) => action.type === "PLACE_MEEPLE");
  const tile = state.board[key(state.lastPlaced!.r, state.lastPlaced!.c)]!;
  const segs = tileShape(tile.t, tile.r).segments;
  const usable = meeples.filter((action) => action.type === "PLACE_MEEPLE" && (segs[action.seg]!.kind !== "field" || state.deck.length < 30));
  if (usable.length > 0 && rng.next() < 0.4) return usable[rng.int(usable.length)]!;
  return { type: "SKIP_MEEPLE" };
}

/** 从 state 往下打 tiles 块地块（或者打到结束）。停下时正好是某人「放地块」这一步。 */
export function playOut(state: GameState, tiles: number, seed = 7): GameState {
  const rng = createRng(seed);
  let current = state;
  let placed = 0;
  for (let guard = 0; guard < 1000 && current.phase !== "finished"; guard += 1) {
    if (current.step === "place" && placed >= tiles) break;
    const command = sceneCommand(current, rng);
    if (command.type === "PLACE_TILE") placed += 1;
    current = apply(current, current.players[current.currentPlayer]!.id, command).state;
  }
  return current;
}

/** 打到当前玩家是 p1 的「放地块」这一步。 */
function untilMyTurn(state: GameState, seed: number): GameState {
  let current = state;
  for (let i = 0; i < 10 && current.phase !== "finished" && current.currentPlayer !== 0; i += 1) current = playOut(current, 1, seed + i);
  return current;
}

function withEvents(state: GameState, events: GameEvent[]): GameState {
  return { ...state, events, version: state.version + 1 };
}

export const SCENE_NAMES = [
  "start",
  "place",
  "meeple",
  "meepleFarm",
  "scored",
  "removed",
  "noMeeples",
  "merged",
  "others",
  "timeout",
  "full5",
  "late",
  "final",
  "finalTie",
  "final5",
  "nofarm",
] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

/** 按名字造常见局面。players 不给时按场景默认（多数 2–3 人）。 */
export function scene(name: SceneName | string, players?: number): GameState {
  switch (name) {
    case "start":
      return setupGame(scenePlayers(players ?? 2), { seed: 11, first: 0 });
    case "place":
      return untilMyTurn(playOut(setupGame(scenePlayers(players ?? 3), { seed: 21, first: 0 }), 18, 21), 21);
    case "meeple": {
      // 甲刚放下一块 J（城市 + 弯路），可以放骑士、路人或农夫
      return buildState({
        players: players ?? 3,
        tiles: [
          { r: 0, c: 1, t: "V", rot: 1 },
          { r: -1, c: 0, t: "J", rot: 2 },
          { r: 1, c: 1, t: "U", rot: 0 },
          { r: 0, c: -1, t: "B", rot: 0 },
        ],
        meeples: [{ player: 1, r: 0, c: 1, seg: 0 }],
        scores: [4, 6, 0],
        step: "meeple",
        last: { r: -1, c: 0 },
      });
    }
    case "meepleFarm":
      return scene("meeple", players);
    case "scored": {
      // 甲放 E 把起始地块北边的城市封口：2 块 = 4 分，骑士收回
      const s = buildState({ players: players ?? 2, step: "place", drawn: "E" });
      const placed = apply(s, "p1", { type: "PLACE_TILE", r: -1, c: 0, rot: 2 }).state;
      return apply(placed, "p1", { type: "PLACE_MEEPLE", seg: 0 }).state;
    }
    case "removed": {
      // 起始地块北边的城封口以后，C（四面城）哪里都放不下：乙抽到它被移出，再抽一块
      const s = buildState({ players: players ?? 2, tiles: [{ r: -1, c: 0, t: "E", rot: 2 }], step: "place", drawn: "U", deck: ["C", "V", "B", "E"] });
      const placed = apply(s, "p1", { type: "PLACE_TILE", r: 0, c: 1, rot: 1 }).state;
      return placed.step === "meeple" ? apply(placed, "p1", { type: "SKIP_MEEPLE" }).state : placed;
    }
    case "noMeeples": {
      const s = untilMyTurn(playOut(setupGame(scenePlayers(players ?? 2), { seed: 31, first: 0 }), 24, 31), 31);
      const next = structuredClone(s);
      next.players[0]!.supply = 0;
      return next;
    }
    case "merged": {
      // 两座各有骑士的城被丙的一块 F 连起来并封口：甲乙各 1 个骑士，并列，各得 3 块 + 1 盾 = 8 分
      const s = buildState({
        players: Math.max(3, players ?? 3),
        tiles: [{ r: -2, c: 0, t: "E", rot: 2 }],
        meeples: [
          { player: 0, r: 0, c: 0, seg: 1 },
          { player: 1, r: -2, c: 0, seg: 0 },
        ],
        current: 2,
        step: "place",
        drawn: "F",
      });
      const placed = apply(s, "p3", { type: "PLACE_TILE", r: -1, c: 0, rot: 1 }).state;
      return placed.step === "meeple" ? apply(placed, "p3", { type: "SKIP_MEEPLE" }).state : placed;
    }
    case "others": {
      const s = playOut(setupGame(scenePlayers(players ?? 4), { seed: 41, first: 0 }), 22, 41);
      let current = s;
      for (let i = 0; i < 6 && current.currentPlayer === 0; i += 1) current = playOut(current, 1, 41 + i);
      return current;
    }
    case "timeout": {
      const s = scene("place", players);
      return withEvents(s, [{ type: "TurnTimedOut", player: s.players[(s.currentPlayer + s.players.length - 1) % s.players.length]!.id }]);
    }
    case "full5":
      return untilMyTurn(playOut(setupGame(scenePlayers(5), { seed: 51, first: 0 }), 45, 51), 51);
    case "late":
      return untilMyTurn(playOut(setupGame(scenePlayers(players ?? 2), { seed: 61, first: 0 }), 64, 61), 61);
    case "final":
      return playOut(setupGame(scenePlayers(players ?? 3), { seed: 71, first: 0 }), 200, 71);
    case "final5":
      return playOut(setupGame(scenePlayers(5), { seed: 81, first: 0 }), 200, 81);
    case "finalTie": {
      const s = playOut(setupGame(scenePlayers(players ?? 2), { seed: 91, first: 0 }), 200, 91);
      // 把乙的总分改成和甲一样，演示并列获胜
      const next = structuredClone(s);
      const result = next.finalResult!;
      const top = Math.max(...result.scores.map((score) => score.total));
      const scores = result.scores.map((score, i) => (i < 2 ? { ...score, inGame: score.inGame + (top - score.total), total: top } : score));
      next.players.forEach((player, i) => (player.score = scores[i]!.total));
      next.finalResult = { ...result, scores, winners: scores.filter((score) => score.total === top).map((score) => score.player) };
      return next;
    }
    case "nofarm":
      return untilMyTurn(playOut(setupGame(scenePlayers(players ?? 2), { seed: 101, first: 0, options: { farmers: false } }), 20, 101), 101);
    default:
      throw new Error(`没有这个场景：${name}`);
  }
}

export { analyze, finalScoring, legalPlacements, meepleOptions };
