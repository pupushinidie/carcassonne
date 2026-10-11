import { describe, expect, it } from "vitest";
import {
  apply,
  botCommand,
  botDecision,
  buildState,
  createGame,
  legalActions,
  redactGameForViewer,
  scene,
  tileShape,
  type GameState,
} from "./index.js";

const P = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}` }));

describe("人机只用自己看得到的信息", () => {
  it("同一局面换掉牌堆顺序，决定不变；吃 redact 之后的状态和完整状态结果一样", () => {
    let s = createGame(P(3), 4242);
    for (let i = 0; i < 30; i += 1) {
      const id = s.players[s.currentPlayer]!.id;
      s = apply(s, id, botCommand(redactGameForViewer(s, id), id)!).state;
    }
    const id = s.players[s.currentPlayer]!.id;
    const view = redactGameForViewer(s, id);
    expect(view.deck).toEqual([]);
    const shuffled: GameState = { ...s, deck: [...s.deck].reverse() };
    const a = botDecision(view, id)!;
    expect(botDecision(redactGameForViewer(shuffled, id), id)).toEqual(a);
    expect(botDecision(s, id)).toEqual(a);
  });
  it("不是自己的回合返回 null", () => {
    const s = createGame(P(2), 1);
    const other = s.players[(s.currentPlayer + 1) % 2]!.id;
    expect(botDecision(redactGameForViewer(s, other), other)).toBeNull();
  });
});

describe("关键决策", () => {
  it("能封自己的城就封，当场得分，理由里说得分", () => {
    const s = buildState({ players: 2, meeples: [{ player: 0, r: 0, c: 0, seg: 1 }], drawn: "E" });
    const d = botDecision(redactGameForViewer(s, "p1"), "p1")!;
    expect(d.command).toEqual({ type: "PLACE_TILE", r: -1, c: 0, rot: 2 });
    expect(d.reason).toContain("得 4 分");
  });
  it("不白白帮对手封城", () => {
    const s = buildState({ players: 2, meeples: [{ player: 1, r: 0, c: 0, seg: 1 }], drawn: "E" });
    const d = botDecision(redactGameForViewer(s, "p1"), "p1")!;
    expect(d.command).not.toEqual({ type: "PLACE_TILE", r: -1, c: 0, rot: 2 });
  });
  it("放下就完工的城：放骑士当场得分、小人马上回来", () => {
    const s = buildState({ players: 2, tiles: [{ r: -1, c: 0, t: "E", rot: 2 }], step: "meeple", last: { r: -1, c: 0 } });
    const d = botDecision(redactGameForViewer(s, "p1"), "p1")!;
    expect(d.command).toEqual({ type: "PLACE_MEEPLE", seg: 0 });
    expect(d.reason).toContain("当场得 4 分");
  });
  it("开局牌堆还多时不放农夫", () => {
    const s = scene("meeple");
    const d = botDecision(redactGameForViewer(s, "p1"), "p1")!;
    const tile = s.board["-1,0"]!;
    if (d.command.type === "PLACE_MEEPLE") expect(tileShape(tile.t, tile.r).segments[d.command.seg]!.kind).not.toBe("field");
  });
  it("每一步都给一句理由", () => {
    const s = scene("place");
    const d = botDecision(redactGameForViewer(s, "p1"), "p1")!;
    expect(d.reason.length).toBeGreaterThan(4);
  });
});

describe("自对弈（每种人数 30 局；300 局的数字见 scripts/sim-carcassonne.ts）", () => {
  it.each([2, 3, 4, 5])("%i 人：每一步合法、有理由、不超过最大步数、单步不超 300ms", (n) => {
    const problems: string[] = [];
    let worst = 0;
    let total = 0;
    let steps = 0;
    for (let g = 0; g < 30; g += 1) {
      let s = createGame(P(n), 100 + g * 7 + n, { farmers: g % 4 !== 3 });
      let guard = 0;
      while (s.phase !== "finished") {
        guard += 1;
        if (guard > 400) {
          problems.push(`第 ${g} 局超过 400 步`);
          break;
        }
        const id = s.players[s.currentPlayer]!.id;
        const t0 = performance.now();
        const d = botDecision(redactGameForViewer(s, id), id);
        const ms = performance.now() - t0;
        worst = Math.max(worst, ms);
        total += ms;
        steps += 1;
        if (!d) {
          problems.push("没有决定");
          break;
        }
        if (!d.reason) problems.push("没有理由");
        const legal = legalActions(s, id).some((a) => JSON.stringify(a) === JSON.stringify(d.command));
        if (!legal) problems.push(`第 ${g} 局不合法：${JSON.stringify(d.command)}`);
        s = apply(s, id, d.command).state;
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(total / steps).toBeLessThan(50);
    expect(worst).toBeLessThan(300);
  }, 120_000);
});
