import { legalActions } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

/** 占位人机：从合法行动里随机挑一个（人机阶段换成正式策略）。输入是 redactGameForViewer 处理过的状态。 */
export function botCommand(state: GameState, playerId: string): GameCommand | null {
  const actions = legalActions(state, playerId);
  if (actions.length === 0) return null;
  return actions[Math.floor(Math.random() * actions.length)]!;
}
