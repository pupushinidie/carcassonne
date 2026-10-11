import {
  analyze,
  canPlaceAnywhere,
  completedCities,
  completePoints,
  endPoints,
  key,
  legalPlacements,
  majority,
  meepleOptions,
  parseKey,
  placementError,
  roleOf,
  tileShape,
  type Analysis,
} from "./map.js";
import { createRng, type Rng } from "./rng.js";
import { TILE_DEFS } from "./tileData.js";
import {
  MEEPLES_PER_PLAYER,
  PLAYER_COLORS,
  type Config,
  type Feature,
  type FinalResult,
  type GameCommand,
  type GameEvent,
  type GameOptions,
  type GameState,
  type ScoreBreakdown,
  type ScoreRecord,
} from "./types.js";

/** 起始地块：D，放在 (0,0)，不旋转。 */
export const START_TILE = "D";

export function defaultConfig(playerCount: number, options: Partial<GameOptions> = {}): Config {
  return {
    playerCount,
    farmers: options.farmers ?? true,
    placeTimeoutSec: 90,
    meepleTimeoutSec: 30,
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

/** 72 块的完整清单（含起始地块）。 */
export function fullTileList(): string[] {
  return Object.entries(TILE_DEFS).flatMap(([type, def]) => Array.from({ length: def.count }, () => type));
}

/** 起始地块以外的 71 块。 */
export function deckTiles(): string[] {
  const list = fullTileList();
  list.splice(list.indexOf(START_TILE), 1);
  return list;
}

export interface SetupOptions {
  readonly seed?: number;
  readonly options?: Partial<GameOptions>;
  /** 指定牌堆顺序（教程、预览、测试用），第一个就是先手抽到的。不给就洗混 71 块。 */
  readonly deck?: readonly string[];
  /** 指定先手（players 下标）。不给就随机。 */
  readonly first?: number;
}

/**
 * 开局：起始地块放在 (0,0)，其余 71 块洗混作牌堆，每人 7 个小人，随机先手，先手抽第一块。
 */
export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  options: Partial<GameOptions> = {},
): GameState {
  return setupGame(players, { seed, options });
}

export function setupGame(players: readonly NewPlayer[], setup: SetupOptions = {}): GameState {
  if (players.length < 2 || players.length > 5) throw new Error("需要 2–5 位玩家才能开始。");
  const seed = setup.seed ?? Math.floor(Math.random() * 2 ** 32);
  const config = defaultConfig(players.length, setup.options);
  const rng = createRng(seed);
  const deck = setup.deck ? [...setup.deck] : rng.shuffle(deckTiles());
  const first = setup.first ?? rng.int(players.length);
  const state: GameState = {
    config,
    phase: "playing",
    players: players.map((player, index) => ({
      id: player.id,
      name: player.name,
      color: PLAYER_COLORS[index]!,
      supply: MEEPLES_PER_PLAYER,
      score: 0,
    })),
    currentPlayer: first,
    step: "place",
    drawn: null,
    board: { [key(0, 0)]: { t: START_TILE, r: 0 } },
    lastPlaced: null,
    meeples: [],
    removed: [],
    history: [],
    turnNo: 1,
    turn: 1,
    events: [],
    version: 0,
    deck,
    seed,
    rngState: rng.state,
  };
  const events: GameEvent[] = [];
  drawTile(state, events);
  state.events = events;
  return state;
}

function playerIndex(state: GameState, playerId: string): number {
  return state.players.findIndex((player) => player.id === playerId);
}

/** 当前玩家从牌堆抽一块；放哪都不合法的移出本局、再抽。牌堆抽空就结束游戏。 */
function drawTile(state: GameState, events: GameEvent[]): void {
  const player = state.players[state.currentPlayer]!.id;
  state.drawn = null;
  while (state.deck.length > 0) {
    const tile = state.deck.shift()!;
    if (canPlaceAnywhere(state.board, tile)) {
      state.drawn = tile;
      events.push({ type: "TileDrawn", player, tile });
      return;
    }
    state.removed.push(tile);
    state.history.push({ type: "removed", player, tile, turnNo: state.turnNo });
    events.push({ type: "TileRemoved", player, tile });
  }
  finishGame(state, events);
}

function scoreRecord(feature: Feature, analysis: Analysis, final: boolean, turnNo: number): ScoreRecord {
  const winners = majority(feature.meeples);
  const points = final ? endPoints(feature, analysis) : completePoints(feature);
  const returned = final ? [] : feature.meeples.filter((meeple) => meeple.role !== "farmer");
  return {
    kind: feature.kind,
    final,
    complete: feature.complete,
    tiles: feature.kind === "monastery" ? feature.tiles.length - 1 : feature.tiles.length,
    shields: feature.shields,
    cities: feature.kind === "field" ? completedCities(feature, analysis) : 0,
    points,
    winners,
    area: feature.tiles,
    nodes: feature.nodes,
    returned,
    turnNo,
  };
}

/** 第 3 步：结算因为刚放的地块而完成的道路、城市、修道院。 */
function scoreCompleted(state: GameState, events: GameEvent[]): void {
  const last = state.lastPlaced;
  if (!last) return;
  const analysis = analyze(state.board, state.meeples);
  const lastPos = key(last.r, last.c);
  for (const feature of analysis.features) {
    if (!feature.complete || feature.kind === "field") continue;
    if (feature.kind === "monastery") {
      const { r, c } = parseKey(feature.nodes[0]!.split(":")[0]!);
      if (Math.abs(r - last.r) > 1 || Math.abs(c - last.c) > 1) continue;
    } else if (!feature.tiles.includes(lastPos)) continue;
    if (feature.meeples.length === 0) continue;
    const record = scoreRecord(feature, analysis, false, state.turnNo);
    for (const winner of record.winners) state.players.find((player) => player.id === winner)!.score += record.points;
    for (const meeple of record.returned) {
      state.players.find((player) => player.id === meeple.player)!.supply += 1;
    }
    const returnedSet = new Set(record.returned);
    state.meeples = state.meeples.filter((meeple) => !returnedSet.has(meeple));
    state.history.push({ type: "score", record });
    events.push({ type: "Scored", record });
  }
}

/** 终局结算：没完成的道路、城市、修道院，和农田（农夫开时）。 */
export function finalScoring(state: Pick<GameState, "board" | "meeples" | "config" | "turnNo">): ScoreRecord[] {
  const analysis = analyze(state.board, state.meeples);
  const records: ScoreRecord[] = [];
  const order = { road: 0, city: 1, monastery: 2, field: 3 } as const;
  const features = analysis.features
    .filter((feature) => feature.meeples.length > 0 && !feature.complete)
    .filter((feature) => feature.kind !== "field" || state.config.farmers)
    .sort((a, b) => order[a.kind] - order[b.kind]);
  for (const feature of features) records.push(scoreRecord(feature, analysis, true, state.turnNo));
  return records;
}

function finishGame(state: GameState, events: GameEvent[]): void {
  const inGame = new Map(state.players.map((player) => [player.id, player.score]));
  const records = finalScoring(state);
  const parts = new Map(state.players.map((player) => [player.id, { roads: 0, cities: 0, monasteries: 0, farms: 0 }]));
  for (const record of records) {
    for (const winner of record.winners) {
      const part = parts.get(winner)!;
      if (record.kind === "road") part.roads += record.points;
      else if (record.kind === "city") part.cities += record.points;
      else if (record.kind === "monastery") part.monasteries += record.points;
      else part.farms += record.points;
    }
    state.history.push({ type: "score", record });
  }
  const scores: ScoreBreakdown[] = state.players.map((player) => {
    const part = parts.get(player.id)!;
    const total = inGame.get(player.id)! + part.roads + part.cities + part.monasteries + part.farms;
    player.score = total;
    return { player: player.id, inGame: inGame.get(player.id)!, ...part, total };
  });
  const top = Math.max(...scores.map((score) => score.total));
  const result: FinalResult = { scores, winners: scores.filter((score) => score.total === top).map((score) => score.player), records };
  state.phase = "finished";
  state.currentPlayer = -1;
  state.step = "place";
  state.drawn = null;
  state.finalResult = result;
  events.push({ type: "GameEnded", result });
}

/** 放完小人（或不放）以后：结算，换下一位，给他抽地块。 */
function endTurn(state: GameState, events: GameEvent[]): void {
  scoreCompleted(state, events);
  state.currentPlayer = (state.currentPlayer + 1) % state.players.length;
  state.step = "place";
  drawTile(state, events);
}

/** 当前玩家在刚放的地块上能放小人的段；不是放小人这一步或没小人了返回空。 */
export function currentMeepleOptions(state: GameState): number[] {
  if (state.phase !== "playing" || state.step !== "meeple" || !state.lastPlaced) return [];
  if (state.players[state.currentPlayer]!.supply <= 0) return [];
  return meepleOptions(state.board, state.meeples, key(state.lastPlaced.r, state.lastPlaced.c), state.config.farmers);
}

function stepSignature(state: GameState): string {
  return `${state.phase}:${state.currentPlayer}:${state.step}:${state.turnNo}`;
}

/** 规则引擎主入口：校验并执行一个命令，返回新状态和事件。不修改传入的 state。 */
export function apply(state: GameState, playerId: string, command: GameCommand, _rng?: Rng): { state: GameState; events: GameEvent[] } {
  if (state.phase === "finished") throw new Error("对局已经结束。");
  const me = playerIndex(state, playerId);
  if (me < 0) throw new Error("你不在这局里。");
  if (state.currentPlayer !== me) throw new Error("还没轮到你。");
  const next = structuredClone(state);
  const events: GameEvent[] = [];
  const before = stepSignature(next);
  const player = next.players[me]!;

  switch (command?.type) {
    case "PLACE_TILE": {
      if (next.step !== "place") throw new Error("地块已经放下了，现在是放小人。");
      const tile = next.drawn;
      if (!tile) throw new Error("手上没有地块。");
      const { r, c, rot } = command;
      const error = placementError(next.board, tile, r, c, rot);
      if (error) throw new Error(error);
      const turnRot = rot as 0 | 1 | 2 | 3;
      next.board[key(r, c)] = { t: tile, r: turnRot };
      next.lastPlaced = { r, c, rot: turnRot };
      next.drawn = null;
      next.turnNo += 1;
      events.push({ type: "TilePlaced", player: player.id, tile, r, c, rot });
      next.step = "meeple";
      if (currentMeepleOptions(next).length === 0) {
        events.push({ type: "MeepleSkipped", player: player.id, reason: "none" });
        endTurn(next, events);
      }
      break;
    }
    case "PLACE_MEEPLE": {
      if (next.step !== "meeple") throw new Error("先放地块。");
      if (player.supply <= 0) throw new Error("你的小人用完了。");
      const options = currentMeepleOptions(next);
      if (!options.includes(command.seg)) throw new Error("这里不能放小人（这片区域已经有人了）。");
      const last = next.lastPlaced!;
      const pos = key(last.r, last.c);
      const seg = tileShape(next.board[pos]!.t, next.board[pos]!.r).segments[command.seg]!;
      const meeple = { player: player.id, pos, seg: seg.index, role: roleOf(seg.kind) };
      next.meeples.push(meeple);
      player.supply -= 1;
      events.push({ type: "MeeplePlaced", meeple });
      endTurn(next, events);
      break;
    }
    case "SKIP_MEEPLE": {
      if (next.step !== "meeple") throw new Error("先放地块。");
      events.push({ type: "MeepleSkipped", player: player.id, reason: "chose" });
      endTurn(next, events);
      break;
    }
    default:
      throw new Error("未知的行动。");
  }

  if (stepSignature(next) !== before) next.turn += 1;
  next.version += 1;
  next.events = events;
  return { state: next, events };
}

/** 服务端用：执行命令并记进动作序列（同一种子重放这串动作就能复现整局）。 */
export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  const { state: next } = apply(state, playerId, command);
  next.log = [...(state.log ?? []), { player: playerId, command }];
  return next;
}

/**
 * 超时自动行动（规则书 9.4）：放地块取 legalPlacements 里 行 → 列 → 旋转 最小的；放小人就不放。
 */
export function autoCommand(state: GameState): GameCommand {
  if (state.step === "meeple") return { type: "SKIP_MEEPLE" };
  const first = legalPlacements(state.board, state.drawn!)[0]!;
  return { type: "PLACE_TILE", r: first.r, c: first.c, rot: first.rot };
}

/** 回合超时（含断线玩家）：替当前玩家做一步。 */
export function timeoutTurn(state: GameState): GameState {
  if (state.phase === "finished") return state;
  const playerId = state.players[state.currentPlayer]!.id;
  const { state: next } = apply(state, playerId, autoCommand(state));
  next.events = [{ type: "TurnTimedOut", player: playerId }, ...next.events];
  next.log = [...(state.log ?? []), { player: playerId, command: { type: "TIMEOUT" } }];
  return next;
}

/** 发给客户端的视角：牌堆只给张数；删掉种子、随机数状态、动作序列。其余全部公开，所有人看到的一样。 */
export function redactGameForViewer(state: GameState, _viewerId: string): GameState {
  const { deck, seed: _seed, rngState: _rngState, log: _log, ...rest } = state;
  return { ...rest, deck: [], deckCount: state.deckCount ?? deck.length };
}

/** 当前玩家现在能做的所有命令；不是他的回合返回空数组。测试、人机和陪玩脚本用。 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  if (state.phase === "finished" || state.players[state.currentPlayer]?.id !== playerId) return [];
  if (state.step === "place") {
    return legalPlacements(state.board, state.drawn!).map((p) => ({ type: "PLACE_TILE", r: p.r, c: p.c, rot: p.rot }));
  }
  return [{ type: "SKIP_MEEPLE" }, ...currentMeepleOptions(state).map((seg) => ({ type: "PLACE_MEEPLE" as const, seg }))];
}

/** 牌堆剩几块（服务端和客户端视角通用）。 */
export function deckCount(state: GameState): number {
  return state.deckCount ?? state.deck.length;
}

/**
 * 公开可推的「还没出现的地块」：72 块 − 地图上的 − 移出的 − 手上这块。人机估概率用，不看牌堆顺序。
 */
export function unseenTiles(state: GameState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [type, def] of Object.entries(TILE_DEFS)) counts[type] = def.count;
  for (const tile of Object.values(state.board)) counts[tile.t]! -= 1;
  for (const tile of state.removed) counts[tile]! -= 1;
  if (state.drawn) counts[state.drawn]! -= 1;
  return counts;
}

export { createRng };
