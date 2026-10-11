/**
 * 人机（「普通」难度）：一步贪心 + 局面估值，只用 redactGameForViewer 之后看得到的信息
 * （地图、小人、分数、手上的地块、牌堆张数、移出的地块；「还没出现的地块」由公开信息推出，不看牌堆顺序）。
 *
 * 每一种 (位置, 旋转) × (不放 / 每个能放的段) 都打一个分，取最高的：
 *   分 = 自己的「分数 + 场上区域的期望分」 − 对手里最高的那个（多人时混一点平均）。
 * - 完工的区域按完工分算，小人回手加一点；
 * - 没完工的区域：期望 = p × 完工分 + (1 − p) × 终局分；p 由每个开口外面那一格「还剩几块地块能接上」估出来；
 * - 修道院：1 + 周围已有 + 空格 × 剩余比例；
 * - 农田：3 × 挨着的城（完工算 1，没完工按 p）；
 * - 放小人有成本（小人有限），手里剩得少更贵；农夫收不回来，前半局很贵。
 * 并列取枚举顺序里的第一个，结果可复现。
 */
import { deckCount, legalActions, unseenTiles } from "./engine.js";
import { analyze, completePoints, DELTA, endPoints, key, legalPlacements, majority, meepleOptions, nodeKey, parseKey, tileShape, type Analysis } from "./map.js";
import { DIRS, type Board, type Feature, type GameCommand, type GameState, type Meeple, type Placement, type SegKind } from "./types.js";

/** 人机的一个决定：命令 + 一句玩家听得懂的理由（教程「提示」用）。放地块这一步也给出打算放的小人。 */
export interface BotDecision {
  readonly command: GameCommand;
  readonly reason: string;
  readonly placement?: Placement;
  /** 打算放小人的段（−1 = 不放）。 */
  readonly seg?: number;
  readonly value: number;
}

/** 估值参数（模拟脚本调参用）。 */
export interface BotParams {
  /** 开口外的空格能补上的概率再乘这个折扣（别人不一定帮你补）。 */
  readonly edgeDiscount: number;
  /** 自己以外还会有多少比例的抽牌帮忙补。 */
  readonly helpShare: number;
  readonly meepleCost: number;
  readonly meepleCostLow: number;
  readonly farmerEarly: number;
  readonly farmerMid: number;
  readonly farmerLate: number;
  readonly returnBonus: number;
}

export const DEFAULT_BOT_PARAMS: BotParams = {
  edgeDiscount: 0.85,
  helpShare: 0.3,
  meepleCost: 1.8,
  meepleCostLow: 3.5,
  farmerEarly: 9,
  farmerMid: 6,
  farmerLate: 3,
  returnBonus: 0.8,
};

const ROLE_NAMES: Record<SegKind, string> = { road: "路人", city: "骑士", monastery: "修士", field: "农夫" };
const AREA_NAMES: Record<SegKind, string> = { road: "路", city: "城", monastery: "修道院", field: "草地" };

interface Ctx {
  readonly me: string;
  readonly players: string[];
  readonly scores: Record<string, number>;
  readonly supply: number;
  readonly farmers: boolean;
  /** 这一步之后牌堆还剩几块。 */
  readonly deck: number;
  readonly unseen: Record<string, number>;
  readonly unseenTotal: number;
  /** 每一格「接口」能接上的剩余地块数（按邻边签名缓存）。 */
  readonly fitCache: Map<string, number>;
  readonly params: BotParams;
}

function makeCtx(state: GameState, me: string, params: BotParams): Ctx {
  const unseen = unseenTiles(state);
  const scores: Record<string, number> = {};
  for (const player of state.players) scores[player.id] = player.score;
  return {
    me,
    players: state.players.map((player) => player.id),
    scores,
    supply: state.players.find((player) => player.id === me)?.supply ?? 0,
    farmers: state.config.farmers,
    deck: deckCount(state),
    unseen,
    unseenTotal: Math.max(1, Object.values(unseen).reduce((sum, n) => sum + Math.max(0, n), 0)),
    fitCache: new Map(),
    params,
  };
}

/** 空格 (r, c) 四边的要求，比如 "C-F-"（北边要城、南边要草地，东西随意）。 */
function cellSignature(board: Board, r: number, c: number): string {
  let signature = "";
  for (let d = 0; d < 4; d += 1) {
    const [dr, dc] = DELTA[DIRS[d]!];
    const other = board[key(r + dr, c + dc)];
    signature += other ? tileShape(other.t, other.r).edges[(d + 2) % 4] : "-";
  }
  return signature;
}

/** 剩下的地块里能放进这种空格的有几块。 */
function fits(ctx: Ctx, signature: string): number {
  const cached = ctx.fitCache.get(signature);
  if (cached !== undefined) return cached;
  let count = 0;
  for (const [type, left] of Object.entries(ctx.unseen)) {
    if (left <= 0) continue;
    for (let rot = 0; rot < 4; rot += 1) {
      const edges = tileShape(type, rot).edges;
      let ok = true;
      for (let d = 0; d < 4 && ok; d += 1) if (signature[d] !== "-" && signature[d] !== edges[d]) ok = false;
      if (ok) {
        count += left;
        break;
      }
    }
  }
  ctx.fitCache.set(signature, count);
  return count;
}

/** 区域开口外面的空格（去重）。 */
function openCells(board: Board, feature: Feature): { r: number; c: number }[] {
  const cells = new Map<string, { r: number; c: number }>();
  for (const node of feature.nodes) {
    const [pos, seg] = node.split(":") as [string, string];
    const tile = board[pos]!;
    const { r, c } = parseKey(pos);
    for (const dir of tileShape(tile.t, tile.r).segments[Number(seg)]!.edges) {
      const [dr, dc] = DELTA[dir];
      const k = key(r + dr, c + dc);
      if (!board[k]) cells.set(k, { r: r + dr, c: c + dc });
    }
  }
  return [...cells.values()];
}

/** 道路、城市完工的概率估计。 */
function completionChance(board: Board, feature: Feature, ctx: Ctx): number {
  if (feature.complete) return 1;
  if (ctx.deck <= 0) return 0;
  const draws = ctx.deck * (1 / ctx.players.length + ctx.params.helpShare);
  let p = 1;
  for (const { r, c } of openCells(board, feature)) {
    const n = fits(ctx, cellSignature(board, r, c));
    if (n === 0) return 0;
    const chance = 1 - Math.pow(1 - Math.min(1, n / ctx.unseenTotal), draws);
    p *= ctx.params.edgeDiscount * chance;
  }
  return p;
}

/** 一个区域（给多数方）的期望分。 */
function expectedPoints(board: Board, feature: Feature, analysis: Analysis, ctx: Ctx, memo: Map<string, number>): number {
  const cached = memo.get(feature.id);
  if (cached !== undefined) return cached;
  let value: number;
  if (feature.kind === "field") {
    let cities = 0;
    for (const id of feature.adjCities) {
      const city = analysis.byId.get(id)!;
      cities += city.complete ? 1 : completionChance(board, city, ctx);
    }
    value = 3 * cities;
  } else if (feature.kind === "monastery") {
    const filled = 8 - feature.open;
    value = feature.complete ? 9 : 1 + filled + feature.open * Math.min(1, ctx.deck / 60) * 0.9;
  } else if (feature.complete) {
    value = completePoints(feature);
  } else {
    const p = completionChance(board, feature, ctx);
    value = p * completePoints(feature) + (1 - p) * endPoints(feature, analysis);
  }
  memo.set(feature.id, value);
  return value;
}

/** 放一个小人的代价（小人有限；农夫收不回来）。 */
function meepleCost(kind: SegKind, ctx: Ctx, returnsNow: boolean): number {
  if (returnsNow) return 0;
  const { params } = ctx;
  if (kind === "field") return ctx.deck >= 40 ? params.farmerEarly : ctx.deck >= 30 ? params.farmerMid : params.farmerLate + (ctx.supply <= 2 ? 1 : 0);
  const late = Math.min(1, Math.max(0.25, ctx.deck / 25));
  return (ctx.supply <= 2 ? params.meepleCostLow : params.meepleCost) * late;
}

function relative(values: Record<string, number>, ctx: Ctx): number {
  const others = ctx.players.filter((id) => id !== ctx.me).map((id) => values[id]!);
  const max = Math.max(...others);
  const avg = others.reduce((sum, v) => sum + v, 0) / others.length;
  return values[ctx.me]! - (others.length > 1 ? 0.6 * max + 0.4 * avg : max);
}

interface Option {
  readonly seg: number;
  readonly value: number;
  readonly feature: Feature;
  readonly gain: number;
}

interface Eval {
  readonly base: number;
  readonly options: Option[];
  /** 这块地块马上让谁得多少分（不含新放的小人）。 */
  readonly immediate: Record<string, number>;
}

/** 地图（地块已经放下）的估值：不放小人的分，以及每个能放的段放下后的分。 */
function evaluate(board: Board, meeples: readonly Meeple[], pos: string, ctx: Ctx): Eval {
  const analysis = analyze(board, meeples);
  const memo = new Map<string, number>();
  const values: Record<string, number> = { ...ctx.scores };
  const immediate: Record<string, number> = {};
  for (const id of ctx.players) immediate[id] = 0;
  for (const feature of analysis.features) {
    if (feature.meeples.length === 0) continue;
    if (feature.kind === "field" && !ctx.farmers) continue;
    const points = expectedPoints(board, feature, analysis, ctx, memo);
    const done = feature.complete && feature.kind !== "field";
    for (const id of majority(feature.meeples)) {
      values[id] = (values[id] ?? 0) + points;
      if (done) immediate[id] = (immediate[id] ?? 0) + points;
    }
    if (done) {
      // 完工的区域：小人回手，回来的小人还能再用
      for (const meeple of feature.meeples) if (meeple.player === ctx.me) values[ctx.me] = values[ctx.me]! + ctx.params.returnBonus;
    }
  }
  const base = relative(values, ctx);
  const options: Option[] = [];
  if (ctx.supply > 0) {
    const tile = board[pos]!;
    const segments = tileShape(tile.t, tile.r).segments;
    for (const seg of meepleOptions(board, meeples, pos, ctx.farmers, analysis)) {
      const feature = analysis.byId.get(analysis.featureOf.get(nodeKey(pos, seg))!)!;
      const kind = segments[seg]!.kind;
      const points = expectedPoints(board, feature, analysis, ctx, memo);
      const returnsNow = feature.complete && kind !== "field";
      const gain = points - meepleCost(kind, ctx, returnsNow) + (returnsNow ? ctx.params.returnBonus : 0);
      options.push({ seg, value: base + gain, feature, gain });
    }
  }
  return { base, options, immediate };
}

function describe(option: Option | undefined, immediate: Record<string, number>, ctx: Ctx, kindOf: (seg: number) => SegKind): string {
  const mine = immediate[ctx.me] ?? 0;
  if (option && option.feature.complete && kindOf(option.seg) !== "field") {
    const kind = kindOf(option.seg);
    return `这块能把${AREA_NAMES[kind]}${kind === "monastery" ? "围满" : "封口"}，再放个${ROLE_NAMES[kind]}，当场得 ${completePoints(option.feature)} 分，小人马上回来`;
  }
  const parts: string[] = [];
  if (mine > 0) parts.push(`这块让你的区域完工，当场得 ${Math.round(mine)} 分，小人回到手里`);
  if (option) {
    const kind = kindOf(option.seg);
    if (kind === "field") parts.push("放个农夫占这片草地，它挨着的城完工越多，终局分越多");
    else if (kind === "monastery") parts.push("放个修士，修道院周围 8 格放满就是 9 分");
    else parts.push(`放个${ROLE_NAMES[kind]}占住这${kind === "road" ? "条路" : "座城"}，估计能拿 ${Math.max(1, Math.round(option.gain))} 分左右`);
  } else if (parts.length === 0) {
    parts.push("放这里最稳：不给别人送分，小人先留在手里");
  } else {
    parts.push("这次不放小人");
  }
  return parts.join("；");
}

/** 人机的决定（带理由）。不是自己的回合返回 null。输入应该是 redactGameForViewer(game, me) 的结果。 */
export function botDecision(state: GameState, me: string, params: BotParams = DEFAULT_BOT_PARAMS): BotDecision | null {
  if (state.phase !== "playing" || state.players[state.currentPlayer]?.id !== me) return null;
  const ctx = makeCtx(state, me, params);
  if (state.step === "meeple") {
    const last = state.lastPlaced!;
    const pos = key(last.r, last.c);
    const tile = state.board[pos]!;
    const segments = tileShape(tile.t, tile.r).segments;
    const result = evaluate(state.board, state.meeples, pos, ctx);
    let best: Option | undefined;
    for (const option of result.options) if (option.value > (best?.value ?? result.base)) best = option;
    const reason = describe(best, result.immediate, ctx, (seg) => segments[seg]!.kind);
    return best
      ? { command: { type: "PLACE_MEEPLE", seg: best.seg }, reason, seg: best.seg, value: best.value }
      : { command: { type: "SKIP_MEEPLE" }, reason, seg: -1, value: result.base };
  }
  const tile = state.drawn;
  if (!tile) return null;
  let best: { placement: Placement; option?: Option; value: number; immediate: Record<string, number> } | null = null;
  for (const placement of legalPlacements(state.board, tile)) {
    const pos = key(placement.r, placement.c);
    const board: Board = { ...state.board, [pos]: { t: tile, r: placement.rot } };
    const result = evaluate(board, state.meeples, pos, ctx);
    if (!best || result.base > best.value) best = { placement, value: result.base, immediate: result.immediate };
    for (const option of result.options) {
      if (option.value > best.value) best = { placement, option, value: option.value, immediate: result.immediate };
    }
  }
  if (!best) return null;
  const { placement } = best;
  const segments = tileShape(tile, placement.rot).segments;
  return {
    command: { type: "PLACE_TILE", r: placement.r, c: placement.c, rot: placement.rot },
    reason: describe(best.option, best.immediate, ctx, (seg) => segments[seg]!.kind),
    placement,
    seg: best.option?.seg ?? -1,
    value: best.value,
  };
}

/** 服务器和陪玩脚本用：人机的下一步命令。 */
export function botCommand(state: GameState, playerId: string): GameCommand | null {
  return botDecision(state, playerId)?.command ?? legalActions(state, playerId)[0] ?? null;
}
