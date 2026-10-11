import type { ReactNode } from "react";
import { legalActions, type GameCommand, type LobbyRoomSnapshot } from "@carcassonne/game";
import { socket } from "./socket.js";
import type { Theme } from "./theme.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  readonly themeToggle: ReactNode;
  readonly theme: Theme;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  readonly onLeave: () => void;
}

/** 临时牌桌（引擎阶段占位，界面阶段换成正式牌桌）。 */
function GameBoard({ room, brand, error, onCommand }: GameBoardProps) {
  const game = room.game!;
  const me = room.members.find((member) => member.id === socket.id)?.playerId ?? "";
  const actions = legalActions(game, me);
  return (
    <div>
      {brand}
      <p>牌堆 {game.deckCount} 块 · 手上 {game.drawn ?? "-"} · {game.step}</p>
      <ul>{game.players.map((player) => <li key={player.id}>{player.name} {player.score} 分 · 小人 {player.supply}</li>)}</ul>
      {actions.length > 0 && <button type="button" onClick={() => onCommand(actions[0]!)}>走一步</button>}
      {error && <p>{error}</p>}
    </div>
  );
}

export default GameBoard;
