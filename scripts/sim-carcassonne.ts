// 卡卡颂人机强度（补充文件 1.4）：
//   基线 A = 随机合法位置 + 30% 概率随机放小人；
//   基线 B = 当场得分最多的放法，有空的城市/道路就放小人（城优先）；
//   人机 = botCommand（只吃 redact 之后的状态）。
// 用法：npx tsx scripts/sim-carcassonne.ts [局数=300]
import { analyze, apply, botDecision, createGame, key, legalActions, legalPlacements, majority, redactGameForViewer, tileShape, type GameCommand, type GameState, type BotParams } from "../packages/game/src/index.ts";

type Bot = (s: GameState, id: string) => GameCommand;
let seedState = 777;
const rand = () => (seedState = (seedState * 1103515245 + 12345) % 2147483648) / 2147483648;

const baselineA: Bot = (s, id) => {
  const actions = legalActions(s, id);
  if (s.step === "place") return actions[Math.floor(rand() * actions.length)]!;
  const meeples = actions.filter((a) => a.type === "PLACE_MEEPLE");
  return meeples.length > 0 && rand() < 0.3 ? meeples[Math.floor(rand() * meeples.length)]! : { type: "SKIP_MEEPLE" };
};

const baselineB: Bot = (s, id) => {
  if (s.step === "place") {
    let best: GameCommand | null = null;
    let bestPts = -1;
    for (const p of legalPlacements(s.board, s.drawn!)) {
      const board = { ...s.board, [key(p.r, p.c)]: { t: s.drawn!, r: p.rot } };
      let pts = 0;
      for (const f of analyze(board, s.meeples).features) {
        if (!f.complete || f.kind === "field" || f.meeples.length === 0) continue;
        if (!f.tiles.includes(key(p.r, p.c)) && f.kind !== "monastery") continue;
        if (majority(f.meeples).includes(id)) pts += f.kind === "road" ? f.tiles.length : f.kind === "city" ? 2 * f.tiles.length + 2 * f.shields : 9;
      }
      if (pts > bestPts) { bestPts = pts; best = { type: "PLACE_TILE", r: p.r, c: p.c, rot: p.rot }; }
    }
    return best!;
  }
  const actions = legalActions(s, id).filter((a) => a.type === "PLACE_MEEPLE");
  const tile = s.board[key(s.lastPlaced!.r, s.lastPlaced!.c)]!;
  const segs = tileShape(tile.t, tile.r).segments;
  const city = actions.find((a) => a.type === "PLACE_MEEPLE" && segs[a.seg]!.kind === "city");
  const road = actions.find((a) => a.type === "PLACE_MEEPLE" && segs[a.seg]!.kind === "road");
  return city ?? road ?? { type: "SKIP_MEEPLE" };
};

const times: number[] = [];
const mine = (params?: BotParams): Bot => (s, id) => {
  const t0 = performance.now();
  const d = botDecision(redactGameForViewer(s, id), id, params)!;
  times.push(performance.now() - t0);
  return d.command;
};

function play(bots: Bot[], seed: number, farmers = true) {
  let s = createGame(bots.map((_, i) => ({ id: `p${i}`, name: `b${i}` })), seed, { farmers });
  let n = 0;
  while (s.phase !== "finished") {
    if (n++ > 400) throw new Error("超过 400 步");
    const id = s.players[s.currentPlayer]!.id;
    s = apply(s, id, bots[s.currentPlayer]!(s, id)).state;
  }
  return { winners: s.finalResult!.winners.map((w) => Number(w.slice(1))), scores: s.finalResult!.scores.map((x) => x.total), steps: n };
}

export function match(name: string, a: Bot, b: Bot, n: number, players = 2, farmers = true) {
  let w = 0, sa = 0, sb = 0, rank = 0;
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const seat = i % players;
    const bots = Array.from({ length: players }, (_, k) => (k === seat ? a : b));
    const res = play(bots, 5000 + i, farmers);
    if (res.winners.includes(seat)) w += 1 / res.winners.length;
    sa += res.scores[seat]!;
    sb += res.scores.filter((_, k) => k !== seat).reduce((x, y) => x + y, 0) / (players - 1);
    rank += 1 + res.scores.filter((x) => x > res.scores[seat]!).length;
  }
  console.log(`${name}（${players} 人，${n} 局）：胜率 ${(100 * w / n).toFixed(1)}%（公平值 ${(100 / players).toFixed(0)}%） 平均名次 ${(rank / n).toFixed(2)}  平均分 ${(sa / n).toFixed(1)} 对 ${(sb / n).toFixed(1)}  ${((Date.now() - t0) / n).toFixed(0)}ms/局`);
  return w / n;
}

function selfPlay(players: number, n: number) {
  let total = 0, steps = 0;
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const res = play(Array.from({ length: players }, () => mine()), 9000 + i);
    total += res.scores.reduce((x, y) => x + y, 0) / players;
    steps += res.steps;
  }
  console.log(`自对弈 ${players} 人 ${n} 局：平均每人 ${(total / n).toFixed(1)} 分，平均 ${(steps / n).toFixed(0)} 步，${((Date.now() - t0) / n).toFixed(0)}ms/局`);
}

if (process.argv[1]?.endsWith("sim-carcassonne.ts")) {
  const N = Number(process.argv[2] ?? 300);
  match("人机 vs 基线 A（随机）", mine(), baselineA, N);
  match("人机 vs 基线 B（当场得分 + 有空就放）", mine(), baselineB, N);
  match("基线 B vs 基线 A", baselineB, baselineA, 100);
  match("人机 vs 基线 B", mine(), baselineB, Math.min(N, 200), 4);
  for (const p of [2, 3, 4, 5]) selfPlay(p, N);
  times.sort((x, y) => x - y);
  const pct = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))]!.toFixed(1);
  console.log(`单步耗时（${times.length} 步）：平均 ${(times.reduce((x, y) => x + y, 0) / times.length).toFixed(1)}ms  p50 ${pct(0.5)}ms  p99 ${pct(0.99)}ms  最长 ${times[times.length - 1]!.toFixed(1)}ms`);
}
