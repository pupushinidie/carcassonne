import { useEffect, useRef } from "react";
import type { GameEvent, GameState } from "@carcassonne/game";
import { sfx, synth, type SfxName } from "./gm-sound.js";

/**
 * 卡卡颂的动作音效：对比前后两次对局快照（version 和这一步的 events），把刚发生的动作配上声音。
 * 自己的动作响亮，别人的减半（观战时都算别人的）。第一次拿到快照（进房间、重连、观战刚进来）不出声；
 * version 一下跳了好几步（重连补发、再来一局）也不出声，只提示轮到你。
 *
 * - 放地块 TilePlaced：招牌「地块落桌」——一声木板拍在石桌上的闷响 + 一点沙沙
 * - 放小人 MeeplePlaced：木头小人「嗒」一声；农夫躺下低一点
 * - 不放 MeepleSkipped（自己选的）：pass
 * - 抽到放不下被移出 TileRemoved：bust（提示一下出事了）
 * - 区域完工 Scored：score（自己拿分响亮，8 分以上算大），收回的小人一个个「叮」地回来
 * - 超时 TurnTimedOut：自己的响 timeout
 * - 轮到你 yourTurn、自己走完交出回合 turnPassed、终局 gameOver(赢/输)
 */

/** 记一笔响了什么（只在开发时，给自测脚本看）。 */
function log(name: string) {
  if (import.meta.env.DEV) {
    const w = window as unknown as { __sfxLog?: string[] };
    (w.__sfxLog ??= []).push(name);
  }
}

function play<K extends SfxName>(name: K, ...args: Parameters<(typeof sfx)[K]>) {
  log(name);
  (sfx[name] as (...a: Parameters<(typeof sfx)[K]>) => void)(...args);
}

const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);

/** 招牌：地块落在石桌上——一声低沉的木板拍击，带一点沙沙的尾音。 */
function tileDown(mine: boolean) {
  log("tileDown");
  const v = synth.level(mine);
  synth.noise({ duration: 0.06, volume: 0.36 * v, filter: "lowpass", freq: 600 * synth.jitter(0.1) });
  synth.tone(150 * synth.jitter(0.08), { duration: 0.12, volume: 0.22 * v, type: "triangle", glideTo: 95 });
  synth.noise({ at: 0.04, duration: 0.12, volume: 0.08 * v, freq: 2600 * synth.jitter(0.2), q: 0.8 });
}

/** 木头小人放下：清脆的一下；农夫躺下低一点。 */
function meepleDown(mine: boolean, lying: boolean) {
  log("meepleDown");
  const v = synth.level(mine);
  const pitch = lying ? 0.75 : 1;
  synth.noise({ duration: 0.025, volume: 0.3 * v, freq: 2400 * pitch, q: 2 });
  synth.tone(880 * pitch * synth.jitter(0.05), { duration: 0.07, volume: 0.14 * v, type: "triangle" });
  synth.tone(660 * pitch, { at: 0.05, duration: 0.06, volume: 0.08 * v, type: "triangle" });
}

/** 小人回到手里：一声上扬的「叮」。 */
function meepleBack(mine: boolean, step: number) {
  log("meepleBack");
  synth.tone(988 * Math.pow(1.12, step), { duration: 0.12, volume: 0.1 * synth.level(mine), type: "triangle", glideTo: 1319 * Math.pow(1.12, step) });
}

export function useGameSfx(game: GameState, selfId: string) {
  const previous = useRef<GameState | null>(null);
  useEffect(() => {
    const prev = previous.current;
    previous.current = game;
    if (!prev || prev === game || prev.version === game.version) return;
    const nextIsMe = game.phase === "playing" && game.step === "place" && game.players[game.currentPlayer]?.id === selfId && selfId !== "";
    if (game.version < prev.version || game.version - prev.version > 2) {
      if (nextIsMe) later(400, () => play("yourTurn"));
      return;
    }
    const mineOf = (id: string) => id !== "" && id === selfId;
    const events: readonly GameEvent[] = game.events;
    let t = 0;
    let actor: string | null = null;
    let timedOut = false;
    let ended: GameEvent | null = null;
    for (const event of events) {
      switch (event.type) {
        case "TurnTimedOut":
          timedOut = mineOf(event.player);
          break;
        case "TilePlaced":
          actor = event.player;
          tileDown(mineOf(event.player));
          t = 200;
          break;
        case "MeeplePlaced": {
          const mine = mineOf(event.meeple.player);
          actor = event.meeple.player;
          // 落下动画 420ms，压扁那一帧响
          later(t + 180, () => meepleDown(mine, event.meeple.role === "farmer"));
          t += 350;
          break;
        }
        case "MeepleSkipped":
          actor = event.player;
          if (event.reason === "chose") later(t, () => play("pass", mineOf(event.player)));
          break;
        case "Scored": {
          const record = event.record;
          if (record.final) break;
          const mine = record.winners.includes(selfId);
          later(t + 150, () => play("score", mine, mine && record.points >= 8));
          record.returned.forEach((meeple, i) => later(t + 600 + i * 110, () => meepleBack(mineOf(meeple.player), i)));
          t += 600 + record.returned.length * 110;
          break;
        }
        case "TileRemoved":
          later(t + 200, () => play("bust", mineOf(event.player)));
          t += 500;
          break;
        case "GameEnded":
          ended = event;
          break;
      }
    }
    if (timedOut) later(t, () => play("timeout"));
    if (ended && ended.type === "GameEnded") {
      const won = selfId !== "" && ended.result.winners.includes(selfId);
      // 终局要先逐项结算（几秒），结算动画大概播完再奏乐
      later(Math.min(7000, 900 + ended.result.records.length * 300), () => play("gameOver", won));
      return;
    }
    if (nextIsMe) later(Math.max(t, 450), () => play("yourTurn"));
    else if (actor !== null && mineOf(actor) && game.players[game.currentPlayer]?.id !== selfId) later(Math.max(t, 450), () => play("turnPassed"));
  }, [game, selfId]);
}

export { play as playSfx };
