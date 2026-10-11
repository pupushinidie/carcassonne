import { describe, expect, it } from "vitest";
import {
  analyze,
  anchorVisible,
  apply,
  botCommand,
  createPracticeGame,
  createTutorialGame,
  legalActions,
  meepleOptions,
  redactGameForViewer,
  sameCommand,
  TUTORIAL_FINAL_STEP,
  TUTORIAL_OPENING,
  TUTORIAL_SELF,
  tutorialApply,
  tutorialDeck,
  tutorialSteps,
  type GameState,
} from "./index.js";

const steps = tutorialSteps();

/** 按剧本从头走到某一步（不含这一步本身的动作）；返回每一步之前的局面。 */
function walk(until?: string): { states: Map<string, GameState>; end: GameState } {
  let state = createTutorialGame("你");
  const states = new Map<string, GameState>();
  for (const step of steps) {
    states.set(step.id, state);
    if (step.id === until) break;
    if (step.kind === "do") state = tutorialApply(state, TUTORIAL_SELF, step.expect);
    if (step.kind === "watch") for (const move of step.moves) state = tutorialApply(state, state.players[state.currentPlayer]!.id, move);
  }
  return { states, end: state };
}

describe("新手教程剧本", () => {
  it("从头走到尾：每个 do 都合法，watch 的每一步都合法，每个高亮在那时看得见", () => {
    let state = createTutorialGame("你");
    for (const step of steps) {
      if (step.anchor) expect(anchorVisible(state, step.anchor, TUTORIAL_SELF), `${step.id} 的高亮 ${step.anchor}`).toBe(true);
      if (step.kind === "do") {
        expect(state.players[state.currentPlayer]!.id, step.id).toBe(TUTORIAL_SELF);
        expect(legalActions(state, TUTORIAL_SELF).some((action) => sameCommand(action, step.expect)), step.id).toBe(true);
        state = tutorialApply(state, TUTORIAL_SELF, step.expect);
      }
      if (step.kind === "watch") {
        for (const move of step.moves) {
          const actor = state.players[state.currentPlayer]!.id;
          if (move.type !== "FAST_FORWARD") expect(actor, step.id).not.toBe(TUTORIAL_SELF);
          state = tutorialApply(state, actor, move);
        }
      }
    }
    expect(state.phase).toBe("finished");
  });

  it("关键几幕一定发生", () => {
    const { states, end } = walk();
    // 骑士放下当场完工：4 分，骑士回手
    const afterKnight = states.get("city-done")!;
    expect(afterKnight.players[0]!.score).toBe(4);
    expect(afterKnight.players[0]!.supply).toBe(7);
    // 咕噜一号抽到 C 放不下，被移出
    expect(afterKnight.removed).toEqual(["C"]);
    expect(afterKnight.drawn).toBe("V");
    // 别人封口也算你的：路 3 块
    const roadDone = states.get("road-done")!;
    expect(roadDone.players[0]!.score).toBe(7);
    expect(roadDone.players[0]!.supply).toBe(7);
    // 有人的路不能放：U 上只有两片草地能放
    const occupied = states.get("occupied")!;
    expect(occupied.step).toBe("meeple");
    expect(meepleOptions(occupied.board, occupied.meeples, "1,-1", true)).toEqual([1, 2]);
    // 修道院周围 4 块
    const monastery = states.get("monastery")!;
    const mon = analyze(monastery.board, monastery.meeples).features.find((f) => f.kind === "monastery" && f.meeples.length > 0)!;
    expect(8 - mon.open).toBe(4);
    // 快进后：牌堆剩 1 块、轮到你
    const late = states.get("late")!;
    expect(late.deck.length).toBe(1);
    expect(late.currentPlayer).toBe(0);
    expect(late.step).toBe("place");
    // 终局：你赢
    expect(end.phase).toBe("finished");
    expect(end.finalResult!.winners).toEqual([TUTORIAL_SELF]);
    expect(states.get(TUTORIAL_FINAL_STEP)!.phase).toBe("finished");
  });

  it("剧本本身：id 不重复，finale 只有一个且在最后，每步都有一句话", () => {
    const ids = steps.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = steps.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(steps[steps.length - 1]).toBe(finales[0]);
    for (const step of steps) {
      expect(step.say.length).toBeGreaterThan(0);
      expect(step.say.length).toBeLessThanOrEqual(30);
      expect((step.note ?? "").length).toBeLessThanOrEqual(70);
    }
    expect(steps.length).toBeLessThanOrEqual(32);
  });

  it("牌堆：开头按剧本，后面是剩下的 63 块", () => {
    const deck = tutorialDeck();
    expect(deck.slice(0, TUTORIAL_OPENING.length)).toEqual([...TUTORIAL_OPENING]);
    expect(deck).toHaveLength(71);
    const game = createTutorialGame("你");
    expect(game.drawn).toBe("E");
    expect(game.currentPlayer).toBe(0);
  });

  it("剧本走完接练习局：两边交给人机，120 局都能打完", () => {
    let stuck = 0;
    for (let g = 0; g < 120; g += 1) {
      let state = createPracticeGame("你", 1000 + g);
      for (let guard = 0; guard < 400 && state.phase !== "finished"; guard += 1) {
        const actor = state.players[state.currentPlayer]!.id;
        const command = botCommand(redactGameForViewer(state, actor), actor);
        if (!command) break;
        state = apply(state, actor, command).state;
      }
      if (state.phase !== "finished") stuck += 1;
    }
    expect(stuck).toBe(0);
  }, 120_000);
});
