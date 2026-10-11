/**
 * 预览页（提交在仓库里，生产构建不打包）：用预览局面工厂造局面，渲染真正的牌桌 GameBoard。
 * 打开 /preview.html?s=<场景>：
 *   引擎场景（packages/game/src/scenes.ts 的 SCENE_NAMES）：start place meeple scored removed noMeeples merged others timeout full5 late final finalTie final5 nofarm
 *   seq     自动连播：甲放地块封城 → 放骑士得分（看落下、闪光、飘分、小人飞回）→ 乙抽到放不下的地块被移出
 *   select  放地块时已经选了一个位置（金框）；bad：选了一个放不下的方向（红框）
 *   pick    放小人时已经选了一个落点
 *   remote  别人在试位置（虚框）
 * 其他参数：n=人数（引擎场景支持的），spectate=1 观战，auto=1 我在托管，offline=p2 某人离线，bot=p2,p3 人机，theme=day
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { apply, buildState, scene, type GameCommand, type GameState, type LobbyMember, type LobbyRoomSnapshot } from "@carcassonne/game";
import GameBoard from "./GameBoard.js";
import { socket } from "./socket.js";
import { applyTheme, readTheme, ThemeToggle, useTheme } from "./theme.js";
import "./styles.css";
import "./app-pixel.css";
import "./cc.css";
import "./theme-day.css";

const params = new URLSearchParams(location.search);
if (params.get("theme") === "day" || params.get("theme") === "night") applyTheme(params.get("theme") as "day" | "night");
else applyTheme(readTheme());
Object.defineProperty(socket, "id", { get: () => "sock-p1" });
// 预览不连服务器：试放预览等发出去的消息直接丢掉
(socket as unknown as { emit: (...args: unknown[]) => void }).emit = () => undefined;

const name = params.get("s") ?? "place";
const n = params.get("n") ? Number(params.get("n")) : undefined;
const spectate = params.get("spectate") === "1";
const offline = new Set((params.get("offline") ?? "").split(",").filter(Boolean));
const bots = new Set((params.get("bot") ?? "").split(",").filter(Boolean));

function roomFor(game: GameState, extra: Partial<LobbyRoomSnapshot> = {}): LobbyRoomSnapshot {
  const members: LobbyMember[] = game.players
    .filter((player) => !(spectate && player.id === "p1"))
    .map((player, index) => ({
      id: `sock-${player.id}`,
      playerId: player.id,
      name: player.name,
      isHost: index === 0,
      connected: !offline.has(player.id),
      ...(bots.has(player.id) ? { bot: true } : {}),
      ...(player.id === "p1" && params.get("auto") === "1" ? { auto: true } : {}),
    }));
  return {
    code: "ABC234",
    spectators: spectate ? [{ id: "sock-p1", name: "看客" }] : [],
    access: { allowSpectators: true, spectatorsSeeAll: false, open: false },
    capacity: Math.max(2, Math.min(5, game.players.length)) as LobbyRoomSnapshot["capacity"],
    options: { farmers: game.config.farmers },
    status: "playing",
    members,
    chat: [{ id: "c1", senderId: "sock-p2", name: game.players[1]?.name ?? "乙", message: "这座城我也想要", createdAt: new Date().toISOString() }],
    game,
    turnRemainingMs: game.phase === "finished" ? undefined as never : 63_000,
    ...(game.phase === "finished" ? { rematch: { remainingMs: 52_000, acceptedIds: ["sock-p2"] } } : {}),
    voice: [],
    ...extra,
  } as LobbyRoomSnapshot;
}

/** 自动连播的一串局面。 */
function sequence(): GameState[] {
  const states: GameState[] = [];
  let s = buildState({ players: 2, step: "place", drawn: "E", deck: ["C", "V", "B", "U"], tiles: [{ r: 0, c: 1, t: "V", rot: 1 }] });
  states.push(s);
  const run = (command: GameCommand) => {
    s = apply(s, s.players[s.currentPlayer]!.id, command).state;
    states.push(s);
  };
  run({ type: "PLACE_TILE", r: -1, c: 0, rot: 2 });
  run({ type: "PLACE_MEEPLE", seg: 0 });
  // 乙：放一块把起始地块西边接上，下一位甲抽到 C 放不下被移出
  run({ type: "PLACE_TILE", r: 0, c: -1, rot: 1 });
  run({ type: "SKIP_MEEPLE" });
  return states;
}

function initial(): GameState[] {
  switch (name) {
    case "seq":
      return sequence();
    case "select":
    case "bad":
      return [scene("place", n)];
    case "remote":
      return [scene("others", n)];
    case "pick":
      return [scene("meeple", n)];
    default:
      return [scene(name, n)];
  }
}

function Preview() {
  const [theme, toggleTheme] = useTheme();
  const states = React.useMemo(initial, []);
  const [index, setIndex] = React.useState(0);
  React.useEffect(() => {
    if (states.length <= 1) return;
    const timer = window.setInterval(() => setIndex((i) => Math.min(states.length - 1, i + 1)), 1600);
    return () => window.clearInterval(timer);
  }, [states]);
  const game = states[index]!;
  const room = roomFor(game);
  return (
    <main className="app-shell kd-game">
      <GameBoard
        room={room}
        busy={false}
        error={params.get("error") ?? ""}
        notice=""
        brand={<a className="brand" href="#"><img className="cc-brand-icon" src={`${import.meta.env.BASE_URL}art/ui/icon.png`} alt="" /><span className="brand-name">卡卡颂<span> CARCASSONNE</span></span></a>}
        connection={<div className="connection-status online"><span className="connection-dot" />服务已连接</div>}
        themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        theme={theme}
        chat={<div className="room-chat"><div className="room-chat-list">（聊天）</div></div>}
        onCommand={(command) => console.log("command", command)}
        onRematch={() => undefined}
        onAuto={() => undefined}
        onDissolve={() => undefined}
        watchId="p2"
        onWatch={() => undefined}
        onLeave={() => undefined}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Preview />);

// 预览专用：模拟「已经选了位置 / 选了落点 / 别人在试」——点一下地图上的格子或落点
window.addEventListener("load", () => {
  window.setTimeout(() => {
    const game = initial()[0]!;
    // click=<data-tutorial 名字>（可以用 | 隔开连点几次）：在那个元素中心模拟一次点按（地图用指针事件）
    const clicks = (params.get("click") ?? "").split("|").filter(Boolean);
    clicks.forEach((target, i) => window.setTimeout(() => {
      const selector = target === "slot" ? '[data-tutorial^="cell-"]' : target === "spot" ? '[data-tutorial^="spot-"]' : `[data-tutorial="${target}"]`;
      const element = document.querySelector(selector);
      const map = document.querySelector(".cc-map");
      if (!element || !map) return;
      const rect = element.getBoundingClientRect();
      const init = { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, pointerId: 7, pointerType: "mouse", buttons: 1 };
      if (element.closest(".cc-map")) {
        map.dispatchEvent(new PointerEvent("pointerdown", init));
        map.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
      } else (element as HTMLElement).click();
    }, i * 250));
    if (name === "remote") {
      const handlers = (socket as unknown as { listeners: (event: string) => ((payload: unknown) => void)[] }).listeners("game:hover");
      const other = game.players[game.currentPlayer]!.id;
      for (const handler of handlers) handler({ playerId: other, version: game.version, hover: { r: params.has("hr") ? Number(params.get("hr")) : -1, c: params.has("hc") ? Number(params.get("hc")) : 1, rot: 1 } });
    }
  }, 300);
});
