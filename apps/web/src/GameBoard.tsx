import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  currentMeepleOptions,
  key,
  legalPlacements,
  placementError,
  tileShape,
  type GameCommand,
  type GameState,
  type HoverPayload,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Meeple,
  type Player,
  type PlayerColor,
  type ScoreRecord,
  type SegKind,
} from "@carcassonne/game";
import { art, PLAYER_HEX } from "./art.js";
import GameRules from "./GameRules.js";
import { MapView, type Effect, type Ghost, type Spot } from "./MapView.js";
import { GameRoomMenu, SpectateBar } from "./RoomExtras.js";
import { socket } from "./socket.js";
import type { Theme } from "./theme.js";
import { Coach, TipToast } from "./tutorial/Coach.js";
import { useGameSfx } from "./game-sfx.js";
import { useSfxCountdown } from "./gm-sound.js";
import { useFirstTimeTips } from "./tutorial/tips.js";
import { detectTips, GAME_ID, hintFor, TIPS, type Hint } from "./tutorialGame.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
  readonly theme: Theme;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  /** 打开 / 取消自己的托管。 */
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  /** 观战时从这位玩家的座位看（卡卡颂没有暗信息，只影响「你」的高亮）。 */
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  /** 观战的人离开。 */
  readonly onLeave: () => void;
  /** 自己在 room.members 里的 id；默认是 socket.id（新手教程里传固定值）。 */
  readonly selfMemberId?: string;
  /**
   * online：真实对局（默认）；
   * tutorial：新手教程的剧本进行中（咕噜嘎在讲，不出提示和小贴士）；
   * practice：教程后的练习局（随时能看提示）。
   */
  readonly mode?: "online" | "tutorial" | "practice";
  /** 结算框里替代「再来一局」的按钮（练习局放「结束教程」「再练一局」）。 */
  readonly finalActions?: ReactNode;
  /** 先不弹结算框（剧本里先讲完最后一步）。 */
  readonly finalHidden?: boolean;
  /** 报告「先点再确认」的当前选择：none、place:<行>,<列>,<旋转>、meeple:<段>（剧本据此挪高亮）。 */
  readonly onSelection?: (selection: string) => void;
  /** 点空格时自动转到能放的方向（默认开；教程里关掉，让玩家亲手转一次）。 */
  readonly autoRotate?: boolean;
}

const ROLE_NAMES: Record<SegKind, string> = { road: "路人", city: "骑士", monastery: "修士", field: "农夫" };
const AREA_NAMES: Record<SegKind, string> = { road: "路", city: "城", monastery: "修道院", field: "草地" };

/** 一条得分记录的说明，比如「甲 城 3 块 + 1 盾 = 8 分」。 */
export function recordText(record: ScoreRecord, nameOf: (id: string) => string): string {
  const who = record.winners.map(nameOf).join("、");
  let what: string;
  if (record.kind === "road") what = `路 ${record.tiles} 块 = ${record.points} 分`;
  else if (record.kind === "city") what = `城 ${record.tiles} 块${record.shields > 0 ? ` + ${record.shields} 盾` : ""} = ${record.points} 分`;
  else if (record.kind === "monastery") what = record.complete ? "修道院围满 = 9 分" : `修道院 周围 ${record.tiles} 块 = ${record.points} 分`;
  else what = `农田 挨着 ${record.cities} 座完工的城 = ${record.points} 分`;
  const prefix = record.final ? (record.kind === "field" ? "终局 " : "终局 没完工的") : "";
  return `${who} ${prefix}${what}${record.winners.length > 1 ? "（并列，各得）" : ""}`;
}

/** 落点在地块上的大概方位（同一块上有两片草地时区分用）。 */
function spotWord([x, y]: readonly [number, number]): string {
  const v = y < 0.38 ? "上" : y > 0.62 ? "下" : "";
  const h = x < 0.38 ? "左" : x > 0.62 ? "右" : "";
  return v + h || "中";
}

/** 倒计时提示音只在有倒计时的时候响。 */
function showTimerFor(secondsLeft: number | null, finished: boolean): number | null {
  return finished ? null : secondsLeft;
}

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - Math.max(0, now - anchor.at)) / 1000));
}

/** 宽度和指针：手机（窄或者触屏）用上下排。 */
function useScreen() {
  const read = () => ({
    mobile: window.innerWidth < 760,
    coarse: window.matchMedia?.("(pointer: coarse)").matches ?? false,
  });
  const [screen, setScreen] = useState(read);
  useEffect(() => {
    const update = () => setScreen(read());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return screen;
}

/** 临时特效：计时器存在一张持久的表里，只在卸载时清空（不跟着 version 取消）。 */
function useTransient<T extends { id: number }>() {
  const [items, setItems] = useState<T[]>([]);
  const timers = useRef(new Set<number>());
  const seq = useRef(1);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  const add = useCallback((make: (id: number) => T, ms: number, delay = 0) => {
    const id = seq.current++;
    const start = () => {
      setItems((list) => [...list, make(id)]);
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        setItems((list) => list.filter((item) => item.id !== id));
      }, ms);
      timers.current.add(timer);
    };
    if (delay > 0) {
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        start();
      }, delay);
      timers.current.add(timer);
    } else start();
  }, []);
  return [items, add] as const;
}

function GameBoard(props: GameBoardProps) {
  const { room, busy, error, notice, brand, connection, themeToggle, theme, chat, onCommand, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave } = props;
  const mode = props.mode ?? "online";
  const game = room.game!;
  const selfMember = props.selfMemberId ?? socket.id;
  const member = room.members.find((candidate) => candidate.id === selfMember);
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const selfId = spectating ? "" : myId;
  const isHost = member?.isHost ?? false;
  const meIndex = Math.max(0, game.players.findIndex((player) => player.id === myId));
  const me = game.players[meIndex]!;
  const finished = game.phase === "finished";
  const actor = finished ? undefined : game.players[game.currentPlayer];
  const autoPlaying = member?.auto === true;
  const myTurn = !spectating && !finished && game.currentPlayer === meIndex && !autoPlaying;
  const secondsLeft = useCountdown(room);
  const screen = useScreen();
  const memberOf = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId);
  const colorOf = useCallback((playerId: string): PlayerColor => game.players.find((player) => player.id === playerId)?.color ?? "red", [game.players]);
  const nameOf = useCallback(
    (playerId: string) => (playerId === selfId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?"),
    [game.players, selfId],
  );
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";
  const send = (command: GameCommand) => onCommand(command);

  // 动作音效、最后几秒倒计时提示音
  useGameSfx(game, selfId);
  useSfxCountdown(myTurn, showTimerFor(secondsLeft, finished));

  // 进牌桌时回到页面顶上（手机上从首页表单进来时页面是往下滚过的）
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // 页面在后台时，轮到自己就在标题上提醒
  useEffect(() => {
    const base = "卡卡颂 · 在线对战";
    const update = () => { document.title = myTurn && document.hidden ? `【轮到你】${base}` : base; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [myTurn]);

  // ---------- 放地块 ----------
  const placing = myTurn && game.step === "place" && game.drawn !== null;
  const drawn = game.drawn;
  const legalByCell = useMemo(() => {
    const map = new Map<string, number[]>();
    if (!placing || !drawn) return map;
    for (const p of legalPlacements(game.board, drawn)) {
      const k = key(p.r, p.c);
      map.set(k, [...(map.get(k) ?? []), p.rot]);
    }
    return map;
  }, [placing, drawn, game.version]);
  const [rot, setRot] = useState(0);
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [seg, setSeg] = useState<number | null>(null);
  const [toast, setToast] = useState<{ text: string; tile?: string; kind: "warn" | "info"; id: number } | null>(null);
  useEffect(() => {
    setSel(null);
    setSeg(null);
    setRot(0);
  }, [game.turn]);
  const selLegal = sel ? (legalByCell.get(key(sel.r, sel.c)) ?? []).includes(rot) : false;

  const flash = useCallback((text: string, kind: "warn" | "info" = "warn", tile?: string) => {
    const id = Date.now();
    setToast({ text, kind, id, ...(tile ? { tile } : {}) });
    window.setTimeout(() => setToast((current) => (current?.id === id ? null : current)), kind === "warn" ? 2600 : 4200);
  }, []);

  const clickCell = (r: number, c: number) => {
    if (!placing || busy) return;
    const k = key(r, c);
    const rots = legalByCell.get(k);
    if (!rots) {
      if (!game.board[k]) {
        const reason = drawn ? placementError(game.board, drawn, r, c, rot) : null;
        flash(reason && reason.includes("挨着") ? "要和已有地块上下或左右挨着" : "这里放不下：相接的边要同类（城接城、路接路、草地接草地）");
      }
      return;
    }
    if (sel && sel.r === r && sel.c === c) {
      // 再点同一格：转到下一个能放的方向
      const next = [1, 2, 3, 4].map((i) => (rot + i) % 4).find((candidate) => rots.includes(candidate));
      if (next !== undefined) setRot(next);
      return;
    }
    setSel({ r, c });
    if (!rots.includes(rot) && props.autoRotate !== false) setRot([0, 1, 2, 3].map((i) => (rot + i) % 4).find((candidate) => rots.includes(candidate))!);
  };
  const rotate = (dir: 1 | -1 = 1) => setRot((current) => (current + dir + 4) % 4);
  const confirmPlace = () => {
    if (!sel || !selLegal || busy) return;
    send({ type: "PLACE_TILE", r: sel.r, c: sel.c, rot });
  };

  // ---------- 放小人 ----------
  const meepleStep = myTurn && game.step === "meeple";
  const options = useMemo(() => (meepleStep ? currentMeepleOptions(game) : []), [meepleStep, game.version]);
  const lastPos = game.lastPlaced ? key(game.lastPlaced.r, game.lastPlaced.c) : null;
  const lastTile = lastPos ? game.board[lastPos] : undefined;
  const lastSegments = lastTile ? tileShape(lastTile.t, lastTile.r).segments : [];
  const spots: Spot[] = options.map((index) => {
    const segment = lastSegments[index]!;
    return { seg: index, x: segment.spot[0], y: segment.spot[1], lying: segment.kind === "field" };
  });
  const clickSpot = (index: number) => {
    if (!meepleStep || busy || !options.includes(index)) return;
    if (seg === index) send({ type: "PLACE_MEEPLE", seg: index });
    else setSeg(index);
  };
  const confirmMeeple = () => {
    if (seg === null || busy) return;
    send({ type: "PLACE_MEEPLE", seg });
  };
  const skipMeeple = () => {
    if (!meepleStep || busy) return;
    send({ type: "SKIP_MEEPLE" });
  };

  // 键盘：R 旋转，回车确认，Esc 取消
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if ((event.key === "r" || event.key === "R") && placing) {
        event.preventDefault();
        rotate(1);
      } else if (event.key === "Enter") {
        if (placing) confirmPlace();
        else if (meepleStep && seg !== null) confirmMeeple();
      } else if (event.key === "Escape") {
        setSel(null);
        setSeg(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- 试放预览：自己发出去（节流），别人的收进来 ----------
  const [remote, setRemote] = useState<{ playerId: string; version: number; hover: HoverPayload | null } | null>(null);
  useEffect(() => {
    const handler = (payload: { playerId: string; version: number; hover: HoverPayload | null }) => setRemote(payload);
    socket.on("game:hover", handler);
    return () => { socket.off("game:hover", handler); };
  }, []);
  const outgoing: HoverPayload | null = placing
    ? (sel ? { r: sel.r, c: sel.c, rot } : hover && legalByCell.has(key(hover.r, hover.c)) ? { r: hover.r, c: hover.c, rot } : null)
    : meepleStep && game.lastPlaced
      ? (seg !== null ? { r: game.lastPlaced.r, c: game.lastPlaced.c, rot: game.lastPlaced.rot, seg } : null)
      : null;
  const outgoingKey = outgoing ? `${outgoing.r},${outgoing.c},${outgoing.rot},${outgoing.seg ?? ""}` : "";
  const sendTimer = useRef<{ last: number; timer: number | null; key: string }>({ last: 0, timer: null, key: "" });
  useEffect(() => {
    if (spectating || mode !== "online" || !(placing || meepleStep)) return;
    const state = sendTimer.current;
    if (state.key === outgoingKey) return;
    state.key = outgoingKey;
    const emit = () => {
      state.last = Date.now();
      state.timer = null;
      socket.emit("game:hover", outgoing);
    };
    if (state.timer !== null) window.clearTimeout(state.timer);
    const wait = Math.max(0, 120 - (Date.now() - state.last));
    if (wait === 0) emit();
    else state.timer = window.setTimeout(emit, wait);
  }, [outgoingKey]);

  // 「先点再确认」的当前选择报给新手教程（高亮跟着挪到「旋转」「确认放置」「放X」）
  const selection = placing && sel ? `place:${sel.r},${sel.c},${rot}` : meepleStep && seg !== null ? `meeple:${seg}` : "none";
  useEffect(() => props.onSelection?.(selection), [selection]);

  // ---------- 「提示」和小贴士 ----------
  // 提示只在练习局，或者真实对局里其他人全是人机时才有
  const botsOnly = room.members.every((candidate) => candidate.id === selfMember || candidate.bot);
  const canHint = !spectating && myTurn && (mode === "practice" || (mode === "online" && botsOnly));
  const [hint, setHint] = useState<{ version: number; hint: Hint } | null>(null);
  const shownHint = hint && hint.version === game.version && canHint ? hint.hint : null;
  const toggleHint = () => {
    if (hint && hint.version === game.version) {
      setHint(null);
      return;
    }
    const next = hintFor(game, myId);
    setHint({ version: game.version, hint: next });
    // 提示指的空格可能在视野外：镜头先移过去
    const cell = next.anchor?.match(/^cell-(-?\d+)_(-?\d+)$/);
    if (cell) setFocus({ pos: `${cell[1]},${cell[2]}`, key: `hint-${game.version}` });
  };
  useEffect(() => {
    if (!canHint) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "h" || event.key === "H") toggleHint();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canHint, game.version]);
  const tips = useFirstTimeTips(GAME_ID, game.version, () => detectTips(game, myId), TIPS, mode === "online" && !spectating);

  // ---------- 特效、日志、镜头 ----------
  const [effects, addEffect] = useTransient<Effect>();
  const [flyers, addFlyer] = useTransient<{ id: number; meeple: Meeple }>();
  const [focus, setFocus] = useState<{ pos: string; key: string } | null>(null);
  const [finalDone, setFinalDone] = useState(finished);
  const seenVersion = useRef(game.version);
  useEffect(() => {
    if (game.version === seenVersion.current) return;
    seenVersion.current = game.version;
    let finalRecords: ScoreRecord[] | null = null;
    for (const event of game.events) {
      if (event.type === "TilePlaced") {
        const pos = key(event.r, event.c);
        setFocus({ pos, key: `${game.version}` });
        addEffect((id) => ({ id, kind: "place", pos }), 450);
        addEffect((id) => ({ id, kind: "glow", pos, color: PLAYER_HEX[colorOf(event.player)] }), 1800);
      } else if (event.type === "Scored") {
        const record = event.record;
        const color = record.winners.length === 1 ? PLAYER_HEX[colorOf(record.winners[0]!)] : "#f0c050";
        addEffect((id) => ({ id, kind: "score", area: record.area, label: `+${record.points}`, at: record.returned[0]?.pos ?? record.area[0]!, color, final: false }), 1600);
        record.returned.forEach((meeple, index) => addFlyer((id) => ({ id, meeple }), 900, 350 + index * 90));
      } else if (event.type === "TileRemoved") {
        flash(`${nameOf(event.player)}抽到的这块哪里都放不下，已移出本局，重新抽一块`, "info", event.tile);
      } else if (event.type === "TurnTimedOut") {
        flash(event.player === selfId ? "你超时了，已经替你走了一步；连续超时 2 次会转托管" : `${nameOf(event.player)}超时，已经替他走了一步`, event.player === selfId ? "warn" : "info");
      } else if (event.type === "GameEnded") {
        finalRecords = event.result.records;
      }
    }
    if (finalRecords) {
      finalRecords = (finalRecords as ScoreRecord[]).filter((record) => record.points > 0);
      // 终局结算：逐项高亮、飘分，最后弹出结算
      const step = Math.min(700, Math.max(250, 7000 / Math.max(1, finalRecords.length)));
      finalRecords.forEach((record, index) => {
        const color = record.winners.length === 1 ? PLAYER_HEX[colorOf(record.winners[0]!)] : "#f0c050";
        addEffect((id) => ({ id, kind: "score", area: record.area, label: `+${record.points}`, at: record.nodes[0]!.split(":")[0]!, color, final: true }), step + 300, 600 + index * step);
      });
      const timer = window.setTimeout(() => setFinalDone(true), 900 + finalRecords.length * step);
      return () => window.clearTimeout(timer);
    }
  }, [game.version]);
  useEffect(() => {
    if (!finished) setFinalDone(false);
  }, [finished]);
  const freshMeeples = useMemo(
    () => new Set(game.events.flatMap((event) => (event.type === "MeeplePlaced" ? [`${event.meeple.pos}:${event.meeple.seg}`] : []))),
    [game.version],
  );

  // ---------- 地图上的预览 ----------
  let ghost: Ghost | null = null;
  if (placing && drawn) {
    if (sel) ghost = { r: sel.r, c: sel.c, rot, tile: drawn, kind: selLegal ? "chosen" : "bad" };
    else if (hover && !game.board[key(hover.r, hover.c)] && legalByCell.has(key(hover.r, hover.c))) {
      ghost = { r: hover.r, c: hover.c, rot, tile: drawn, kind: (legalByCell.get(key(hover.r, hover.c)) ?? []).includes(rot) ? "ok" : "bad" };
    }
  } else if (!myTurn && actor && game.step === "place" && game.drawn && remote?.playerId === actor.id && remote.version === game.version && remote.hover) {
    const h = remote.hover;
    if (!game.board[key(h.r, h.c)]) ghost = { r: h.r, c: h.c, rot: h.rot, tile: game.drawn, kind: "remote", color: PLAYER_HEX[actor.color] };
  }
  let ghostMeeple: { pos: string; x: number; y: number; lying: boolean; color: PlayerColor } | null = null;
  if (meepleStep && seg !== null && lastPos) {
    const segment = lastSegments[seg]!;
    ghostMeeple = { pos: lastPos, x: segment.spot[0], y: segment.spot[1], lying: segment.kind === "field", color: me.color };
  } else if (!myTurn && actor && game.step === "meeple" && lastPos && remote?.playerId === actor.id && remote.version === game.version && remote.hover?.seg !== undefined) {
    const segment = lastSegments[remote.hover.seg];
    if (segment) ghostMeeple = { pos: lastPos, x: segment.spot[0], y: segment.spot[1], lying: segment.kind === "field", color: actor.color };
  }
  const zoomTo = meepleStep && lastPos ? { pos: lastPos, key: `${game.turn}` } : null;

  // ---------- 提示文字 ----------
  let headline = "";
  let detail = "";
  if (finished) headline = "游戏结束";
  else if (autoPlaying) {
    headline = "托管中";
    detail = "人机正在替你走，点「取消托管」拿回来。";
  } else if (placing) {
    headline = "轮到你：放地块";
    detail = sel
      ? selLegal ? "看好了就点「确认放置」。再点同一格或「旋转」换方向，点别的亮格换位置。" : "这个方向放不下（红框），转一转或者换个位置。"
      : screen.coarse ? "点一个亮着的空位，再转方向、确认。可以拖动、双指缩放地图。" : "点一个亮着的空位（R 键旋转），确认后不能撤回。可以拖动、滚轮缩放地图。";
  } else if (meepleStep) {
    headline = "放小人？";
    detail = seg !== null
      ? `放一个${ROLE_NAMES[lastSegments[seg]!.kind]}在这${AREA_NAMES[lastSegments[seg]!.kind] === "城" ? "座城" : AREA_NAMES[lastSegments[seg]!.kind] === "路" ? "条路" : AREA_NAMES[lastSegments[seg]!.kind] === "草地" ? "片草地" : "座修道院"}？再点一下圆圈或「放小人」确认。`
      : "只能放在刚放的这块上，圈出来的是还没人占的地方；也可以不放。";
  } else if (actor) {
    headline = `${spectating ? actor.name : nameOf(actor.id) === "你" ? "你" : actor.name} ${game.step === "place" ? "放地块" : "放小人"}中`;
    if (!spectating && memberOf(actor.id)?.bot) detail = "人机在想……";
  }

  const deckLeft = game.deckCount ?? game.deck.length;
  const showTimer = secondsLeft !== null && !finished && actor !== undefined && !memberOf(actor.id)?.bot && !memberOf(actor.id)?.auto && memberOf(actor.id)?.connected !== false;
  // 新手教程里「聊天」那一栏放教程进度，剧本进行中默认打开它
  const sideTabs = useSideTabs(room, mode === "tutorial" ? "chat" : "log");
  const lastColor = lastPos && game.lastPlaced ? (() => {
    // 刚放下的那块：放它的人是谁（放地块时 currentPlayer 还是他；换人后是上一位）
    const placer = game.step === "meeple" ? game.players[game.currentPlayer] : game.players[(game.currentPlayer + game.players.length - 1) % game.players.length];
    return placer ? PLAYER_HEX[placer.color] : null;
  })() : null;

  // 手上的地块（放地块时显示当前方向；别人回合显示他试的方向）
  const handRot = placing ? rot : !myTurn && remote?.playerId === actor?.id && remote?.version === game.version && remote?.hover ? remote.hover.rot : 0;
  const handTile = game.step === "place" ? game.drawn : null;

  const hand = (
    <section className={["kd-panel cc-hand", placing || meepleStep ? "active" : ""].join(" ")} data-tutorial="hand">
      <div className="cc-hand-top">
        <div className="cc-hand-tile">
          {handTile ? (
            <img src={art.tile(handTile, handRot)} alt="手上的地块" draggable={false} />
          ) : lastTile ? (
            <img className="dim" src={art.tile(lastTile.t, lastTile.r)} alt="刚放下的地块" draggable={false} />
          ) : (
            <img className="dim" src={art.tileBack} alt="" draggable={false} />
          )}
        </div>
        <div className="cc-hand-info">
          <strong>{placing ? "你的地块" : meepleStep ? "刚放下" : handTile ? `${actor ? (actor.id === selfId ? "你" : actor.name) : ""}的地块` : finished ? "牌堆用完" : "刚放下"}</strong>
          <span className="cc-deck" data-tutorial="deck"><img src={art.tileBack} alt="" />牌堆 <b>{deckLeft}</b></span>
          {game.removed.length > 0 && <span className="cc-removed" title={`移出：${game.removed.join("、")}`}>已移出 {game.removed.length} 块</span>}
          {!spectating && !finished && <span className="cc-supply">你的小人 <b>{me.supply}</b></span>}
        </div>
      </div>
      {placing && (
        <div className="cc-rots" data-tutorial="rotations">
          {[0, 1, 2, 3].map((r) => {
            const ok = sel ? (legalByCell.get(key(sel.r, sel.c)) ?? []).includes(r) : [...legalByCell.values()].some((rots) => rots.includes(r));
            return (
              <button key={r} type="button" className={["cc-rot", r === rot ? "on" : "", ok ? "" : "bad"].join(" ")} onClick={() => setRot(r)} aria-label={`转到第 ${r + 1} 个方向`}>
                <img src={art.tile(drawn!, r, 32)} alt="" draggable={false} />
              </button>
            );
          })}
        </div>
      )}
      {!spectating && !finished && (
        <div className="cc-actions">
          {placing && (
            <>
              <button className="quiet-button" type="button" onClick={() => rotate(1)} data-tutorial="rotate" title="旋转（R）">⟳ 旋转</button>
              <button className="primary-button" type="button" disabled={!sel || !selLegal || busy} onClick={confirmPlace} data-tutorial="confirm">
                {sel && !selLegal ? "这个方向不行" : "确认放置"}
              </button>
            </>
          )}
          {meepleStep && (
            <>
              <div className="cc-seg-list" data-tutorial="meeple-options">
                {options.map((index) => {
                  const segment = lastSegments[index]!;
                  const kind = segment.kind;
                  const twin = options.some((other) => other !== index && lastSegments[other]!.kind === kind);
                  return (
                    <button key={index} type="button" className={seg === index ? "cc-seg on" : "cc-seg"} onClick={() => setSeg(index)} title={`${ROLE_NAMES[kind]}：占这${AREA_NAMES[kind]}`}>
                      <img src={art.meeple(me.color, kind === "field")} alt="" />{ROLE_NAMES[kind]}{twin ? `·${spotWord(segment.spot)}` : ""}
                    </button>
                  );
                })}
              </div>
              <button className="quiet-button" type="button" onClick={skipMeeple} disabled={busy} data-tutorial="skip-meeple">不放</button>
              <button className="primary-button" type="button" disabled={seg === null || busy} onClick={confirmMeeple} data-tutorial="confirm-meeple">
                {seg === null ? "选个位置" : `放${ROLE_NAMES[lastSegments[seg]!.kind]}`}
              </button>
            </>
          )}
          {canHint && <button className={shownHint ? "quiet-button cc-hint-button on" : "quiet-button cc-hint-button"} type="button" onClick={toggleHint} title="提示（H）" data-tutorial="hint">提示</button>}
          {autoPlaying && <button className="primary-button cc-auto-cancel" type="button" onClick={() => onAuto(false)}>取消托管</button>}
          {!placing && !meepleStep && !autoPlaying && <span className="cc-wait">{actor ? `等 ${actor.name}` : ""}</span>}
        </div>
      )}
    </section>
  );

  const players = (
    <section className="kd-panel cc-players" data-tutorial="players">
      {game.players.map((player) => (
        <PlayerRow
          key={player.id}
          player={player}
          you={player.id === selfId}
          member={memberOf(player.id)}
          active={actor?.id === player.id}
          winner={finished && (game.finalResult?.winners.includes(player.id) ?? false)}
        />
      ))}
    </section>
  );

  const tabs = (
    <section className="kd-panel kd-tabs" data-tutorial="log">
      <div className="kd-tab-bar" role="tablist">
        <button type="button" role="tab" aria-selected={sideTabs.tab === "log"} className={sideTabs.tab === "log" ? "active" : ""} onClick={() => sideTabs.setTab("log")}>得分记录</button>
        <button type="button" role="tab" aria-selected={sideTabs.tab === "chat"} className={sideTabs.tab === "chat" ? "active" : ""} onClick={() => sideTabs.setTab("chat")} data-tutorial="chat-tab">
          {mode === "online" ? "聊天" : "教程"}{sideTabs.unread > 0 && <em>{sideTabs.unread}</em>}
        </button>
      </div>
      {sideTabs.tab === "log" ? <HistoryLog game={game} nameOf={nameOf} /> : <div className="kd-chat">{chat}</div>}
    </section>
  );

  return (
    <div className={["kd-screen", "cc-screen", screen.mobile ? "mobile" : ""].join(" ")}>
      <header className="kd-topbar">
        {brand}
        <div className="kd-turn" data-tutorial="status">
          {!finished && actor && (
            <span className={myTurn ? "kd-turn-who mine" : "kd-turn-who"}>
              <img className="cc-turn-meeple" src={art.meeple(actor.color)} alt="" />
              {headline}
            </span>
          )}
          {showTimer && <b className={secondsLeft! <= 10 ? "kd-timer low" : "kd-timer"}>{secondsLeft}s</b>}
          {finished && <span className="kd-turn-who">游戏结束</span>}
        </div>
        <div className="kd-topbar-right">
          {themeToggle}
          <GameRules />
          <GameRoomMenu room={room} />
          {spectating && <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>}
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {!spectating && !finished && !autoPlaying && !screen.mobile && mode === "online" && <button className="quiet-button" type="button" onClick={() => onAuto(true)} title="让人机替你走，随时可以取消">托管</button>}
          {connection}
        </div>
      </header>

      <div className="kd-main cc-main">
        <div className="cc-board">
          {(error || shownNotice || toast) && (
            <div className={["cc-toast", error || toast?.kind === "warn" ? "warn" : ""].join(" ")} role={error ? "alert" : "status"} key={toast?.id ?? error}>
              {toast?.tile && <img src={art.tile(toast.tile, 0)} alt="" />}
              <span>{error || toast?.text || shownNotice}</span>
            </div>
          )}
          {screen.mobile && (
            <div className="cc-mobile-head">
              <p>{detail || headline}</p>
              <div className="cc-mini-players">
                {game.players.map((player) => (
                  <span key={player.id} className={actor?.id === player.id ? "active" : ""} style={{ "--seat": PLAYER_HEX[player.color] } as CSSProperties} data-meeples={player.id}>
                    <img src={art.meeple(player.color)} alt="" />
                    <b>{player.score}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
          <MapView
            game={game}
            colorOf={colorOf}
            slots={placing ? legalByCell : new Map()}
            ghost={ghost}
            spots={spots}
            spotsAt={meepleStep ? lastPos : null}
            selectedSeg={seg}
            ghostMeeple={ghostMeeple}
            effects={effects}
            focus={focus}
            zoomTo={zoomTo}
            lastColor={lastColor}
            freshMeeples={freshMeeples}
            onCell={clickCell}
            onHover={placing && !screen.coarse ? setHover : undefined}
            onSpot={clickSpot}
            coarse={screen.coarse || screen.mobile}
            flyers={flyers}
            table={theme === "day" ? art.tableDay : art.tableNight}
            {...(finished ? { fitKey: "end" } : {})}
          >
            {!screen.mobile && <span className="cc-map-hint">{detail}</span>}
          </MapView>
          {screen.mobile && hand}
        </div>
        <aside className="kd-side cc-side">
          {spectating && <SpectateBar room={room} watchId={myId} onWatch={onWatch} onLeave={onLeave} showSeats={false} />}
          {!screen.mobile && hand}
          {players}
          {tabs}
          {screen.mobile && !spectating && !finished && !autoPlaying && mode === "online" && (
            <button className="quiet-button cc-mobile-auto" type="button" onClick={() => onAuto(true)}>托管（让人机替我走）</button>
          )}
        </aside>
      </div>
      {finished && finalDone && !props.finalHidden && <FinalDialog game={game} room={room} myId={selfId} selfMember={selfMember} spectating={spectating} nameOf={nameOf} onRematch={onRematch} onLeave={onLeave} actions={props.finalActions} />}
      {shownHint && (
        <Coach
          bubble
          view={{
            key: `hint-${game.version}`,
            say: shownHint.say,
            ...(shownHint.note ? { note: shownHint.note } : {}),
            anchor: shownHint.anchor,
            focus: false,
            face: "think",
            actions: <button className="quiet-button" type="button" onClick={() => setHint(null)}>知道了</button>,
          }}
        />
      )}
      {tips.tip && <TipToast tip={tips.tip} onClose={tips.dismiss} onNever={tips.never} />}
      {finished && !finalDone && !props.finalHidden && (
        <button className="primary-button kd-show-final" type="button" onClick={() => setFinalDone(true)}>跳过，看结算</button>
      )}
    </div>
  );
}

/** 侧栏的「得分记录 / 聊天」切换和未读数。 */
function useSideTabs(room: LobbyRoomSnapshot, initial: "log" | "chat" = "log") {
  const [tab, setTab] = useState<"log" | "chat">(initial);
  const [seen, setSeen] = useState(room.chat.length);
  const unread = tab === "chat" ? 0 : Math.max(0, room.chat.length - seen);
  useEffect(() => {
    if (tab === "chat") setSeen(room.chat.length);
  }, [tab, room.chat.length]);
  return {
    tab,
    setTab: (next: "log" | "chat") => {
      setTab(next);
      if (next === "chat") setSeen(room.chat.length);
    },
    unread,
  };
}

/** 得分和移出记录（新的在上面；刷新后也在，来自 game.history）。 */
function HistoryLog({ game, nameOf }: { game: GameState; nameOf: (id: string) => string }) {
  // 终局时 0 分的农夫（挨着的城都没完工）不列出来
  const lines = [...game.history].filter((entry) => entry.type === "removed" || entry.record.points > 0).reverse();
  if (lines.length === 0) return <p className="kd-muted">还没有人得分。城、路、修道院完工时，占着它的人得分。</p>;
  return (
    <ul className="kd-log">
      {lines.map((entry, index) => (
        <li key={lines.length - index} className={entry.type === "removed" ? "removed" : entry.record.final ? "final" : ""}>
          {entry.type === "removed"
            ? `${nameOf(entry.player)}抽到的一块哪里都放不下，已移出本局`
            : recordText(entry.record, nameOf)}
        </li>
      ))}
    </ul>
  );
}

/** 玩家名牌：小人、名字、标签、剩余小人、分数。 */
function PlayerRow({ player, you, member, active, winner }: { player: Player; you: boolean; member: LobbyMember | undefined; active: boolean; winner: boolean }) {
  const offline = member !== undefined && !member.connected;
  return (
    <div className={["cc-player", active ? "active" : "", winner ? "winner" : ""].join(" ")} style={{ "--seat": PLAYER_HEX[player.color] } as CSSProperties}>
      <img className="cc-player-meeple" src={art.meeple(player.color)} alt="" />
      <span className="cc-player-name">
        <strong title={player.name}>{player.name}</strong>
        <span className="cc-tags">
          {you && <small className="kd-you">你</small>}
          {member?.bot && <small className="kd-bot">人机</small>}
          {!member?.bot && member?.auto && <small className="kd-auto">托管</small>}
          {offline && !member?.bot && <small className="kd-offline">离线·人机代打</small>}
          {active && <small className="cc-now">行动中</small>}
        </span>
      </span>
      <span className="cc-player-supply" data-meeples={player.id} title={`手里还有 ${player.supply} 个小人`}>
        <img src={art.meeple(player.color, false, true)} alt="" />×{player.supply}
      </span>
      <b className="kd-score" data-tutorial={you ? "my-score" : undefined}>{player.score}</b>
    </div>
  );
}

// ---------- 终局 ----------

function FinalDialog({ game, room, myId, selfMember, spectating, nameOf, onRematch, onLeave, actions }: {
  game: GameState;
  room: LobbyRoomSnapshot;
  myId: string;
  selfMember: string | undefined;
  /** 替代「再来一局」那一栏的按钮（练习局）。 */
  actions?: ReactNode;
  spectating: boolean;
  nameOf: (id: string) => string;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
}) {
  const result = game.finalResult!;
  const accepted = room.rematch?.acceptedIds.includes(selfMember ?? "") ?? false;
  const scores = [...result.scores].sort((a, b) => b.total - a.total);
  const [hidden, setHidden] = useState(false);
  if (hidden) {
    return <button className="primary-button kd-show-final" type="button" onClick={() => setHidden(false)}>看结算</button>;
  }
  const title = result.winners.includes(myId) ? (result.winners.length > 1 ? "并列第一！" : "你赢了！") : result.winners.length > 1 ? "并列获胜" : `${nameOf(result.winners[0]!)}赢了`;
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel kd-final" role="dialog" aria-modal="true" aria-labelledby="kd-final-title" data-tutorial="final">
        <div className="cc-wreath"><img src={art.wreath} alt="" /><h2 id="kd-final-title">{title}</h2></div>
        <ol className="kd-standings">
          {scores.map((score) => {
            const player = game.players.find((candidate) => candidate.id === score.player)!;
            const winner = result.winners.includes(score.player);
            const rank = 1 + scores.filter((other) => other.total > score.total).length;
            const parts = [
              `局中 ${score.inGame}`,
              score.roads ? `路 ${score.roads}` : "",
              score.cities ? `城 ${score.cities}` : "",
              score.monasteries ? `修道院 ${score.monasteries}` : "",
              game.config.farmers ? `农田 ${score.farms}` : "",
            ].filter(Boolean);
            return (
              <li key={score.player} className={winner ? "winner" : ""} style={{ "--seat": PLAYER_HEX[player.color] } as CSSProperties} data-tutorial={`final-row-${score.player}`}>
                <span className="kd-rank">{winner ? "★" : rank}</span>
                <img className="cc-player-meeple" src={art.meeple(player.color)} alt="" />
                <span className="kd-standing-name">
                  <strong>{nameOf(score.player)}</strong>
                  <small>{parts.join(" · ")}{parts.length > 1 ? "（终局：没完工的区域和农田）" : ""}</small>
                </span>
                <b className="kd-final-score">{score.total}</b>
              </li>
            );
          })}
        </ol>
        {actions ? (
          <div className="kd-rematch">
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => setHidden(true)}>看地图</button>
              {actions}
            </div>
          </div>
        ) : spectating ? (
          <div className="kd-rematch">
            <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length} 人同意）` : "对局结束"}</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => setHidden(true)}>看地图</button>
              <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>
            </div>
          </div>
        ) : room.rematch && (
          <div className="kd-rematch">
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => setHidden(true)}>看地图</button>
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
