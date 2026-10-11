/**
 * 卡卡颂和教程有关的部分（共用的 tutorial/ 文件夹之外，每款游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import { botDecision, deckCount, key, tileShape, type GameState } from "@carcassonne/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "carcassonne";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个元素（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
}

const ROLE_NAMES = { road: "路人", city: "骑士", monastery: "修士", field: "农夫" } as const;
const DIR_WORD = ["", "转 1 次", "转 2 次", "转 3 次"];

/** 「提示」：让人机从你的位置算一步（界面拿到的本来就是你能看到的那份），配一句原因。 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.phase === "finished") return { say: "这局已经结束了。", anchor: null };
  const current = game.players[game.currentPlayer];
  if (!current) return { say: "现在没有能走的。", anchor: null };
  if (current.id !== playerId) return { say: `等 ${current.name} 走完再问我。`, anchor: null };
  const decision = botDecision(game, playerId);
  if (!decision) return { say: "现在没有能走的。", anchor: null };
  const command = decision.command;
  if (command.type === "PLACE_TILE") {
    const segments = tileShape(game.drawn!, command.rot).segments;
    const then = decision.seg !== undefined && decision.seg >= 0 ? `，然后放个${ROLE_NAMES[segments[decision.seg]!.kind]}` : "";
    return {
      say: `我会放在亮着的这一格${then}。`,
      note: `${decision.reason}。${command.rot > 0 ? `（地块要顺时针${DIR_WORD[command.rot]}：点这格后用「旋转」调）` : ""}`,
      anchor: `cell-${command.r}_${command.c}`,
    };
  }
  if (command.type === "PLACE_MEEPLE") {
    const last = game.lastPlaced!;
    const tile = game.board[key(last.r, last.c)]!;
    const kind = tileShape(tile.t, tile.r).segments[command.seg]!.kind;
    return { say: `我会放一个${ROLE_NAMES[kind]}在圈出来的这里。`, note: `${decision.reason}。`, anchor: `spot-${command.seg}` };
  }
  return { say: "这次我不放小人。", note: `${decision.reason}。`, anchor: "skip-meeple" };
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  removed: { title: "地块被移出了", text: "抽到哪里都放不下的地块会自动移出本局、再抽一块，不是程序出错。" },
  helped: { title: "别人帮你封口也算你的", text: "谁放的地块不重要：完工的路、城、修道院上谁的小人多，分就归谁。" },
  farmer: { title: "农夫收不回来", text: "躺在草地上的农夫要到终局才算分，前期放了就少一个小人用。" },
  "no-meeples": { title: "小人用完了", text: "等你的路、城、修道院完工，小人就会回到手里。" },
  "last-tiles": { title: "快结束了", text: "牌堆不到 6 块：没完工的城终局只算一半，赶紧收尾。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。 */
export function detectTips(game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  const me = game.players.find((player) => player.id === selfId);
  const placer = game.events.find((event) => event.type === "TilePlaced");
  for (const event of game.events) {
    if (event.type === "TileRemoved") ids.push("removed");
    if (event.type === "Scored" && !event.record.final && event.record.winners.includes(selfId) && placer && placer.type === "TilePlaced" && placer.player !== selfId) ids.push("helped");
    if (event.type === "MeeplePlaced" && event.meeple.player === selfId && event.meeple.role === "farmer" && deckCount(game) >= 30) ids.push("farmer");
  }
  if (me && me.supply === 0 && game.phase === "playing") ids.push("no-meeples");
  if (game.phase === "playing" && deckCount(game) > 0 && deckCount(game) < 6) ids.push("last-tiles");
  return ids;
}
