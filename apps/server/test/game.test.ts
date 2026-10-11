// 卡卡颂房间流程：建房 → 加入 → 开局 → 放地块/放小人/不放 → 终局 → 再来一局；原昵称回座；超时自动行动；
// 试放预览只转发给别人、节流、不重置倒计时；抓包：发给每个人的数据里没有牌堆顺序、种子和动作序列。
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  legalActions,
  type AckResponse,
  type ClientToServerEvents,
  type GameCommand,
  type LobbyRoomSnapshot,
  type ServerToClientEvents,
} from "@carcassonne/game";

process.env.BOT_DELAY_SCALE = "0";
process.env.TURN_MS = "600";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
/** 抓包：每个连接收到的所有房间更新原文。 */
const captured = new Map<TestSocket, string[]>();
let serverUrl = "";
let httpServer: typeof import("../src/index.js").httpServer;
let serverIo: typeof import("../src/index.js").io;
let seq = 0;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    captured.set(client, []);
    client.on("room:updated", (room) => {
      latest.set(client, room);
      captured.get(client)!.push(JSON.stringify(room));
    });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

const nick = (p: string) => `${p}${(seq += 1)}`;
const call = <T>(send: (ack: (r: AckResponse<T>) => void) => void) => new Promise<AckResponse<T>>((resolve) => send(resolve));

function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 20_000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = latest.get(client);
    if (current && test(current)) return resolve(current);
    const timer = setTimeout(() => {
      client.off("room:updated", handler);
      reject(new Error("等不到想要的房间状态"));
    }, timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

const seatOf = (client: TestSocket) => latest.get(client)?.members.find((m) => m.id === client.id)?.playerId ?? "";
const myTurn = (client: TestSocket) => (room: LobbyRoomSnapshot) =>
  room.game?.phase === "playing" && room.game.players[room.game.currentPlayer]?.id === seatOf(client);

/** 两个真人开一局。 */
async function twoPlayerGame() {
  const a = await connect();
  const b = await connect();
  const nameA = nick("甲");
  const nameB = nick("乙");
  const created = await call<LobbyRoomSnapshot>((ack) => a.emit("room:create", { name: nameA, capacity: 2 }, ack));
  if (!created.ok) throw new Error(created.error);
  const code = created.data.code;
  expect((await call<LobbyRoomSnapshot>((ack) => b.emit("room:join", { name: nameB, code }, ack))).ok).toBe(true);
  const started = await call<LobbyRoomSnapshot>((ack) => a.emit("room:start", ack));
  expect(started.ok).toBe(true);
  await updateWhere(a, (room) => room.status === "playing");
  await updateWhere(b, (room) => room.status === "playing");
  return { a, b, code, nameA, nameB };
}

/** 轮到 client 时走一步（放地块：第一个合法位置；放小人：有能放的就放第一个）。 */
async function move(client: TestSocket): Promise<LobbyRoomSnapshot> {
  const room = await updateWhere(client, myTurn(client));
  const game = room.game!;
  const actions = legalActions(game, seatOf(client));
  const meeple = actions.find((x) => x.type === "PLACE_MEEPLE");
  const command: GameCommand = game.step === "meeple" ? (meeple ?? actions[0]!) : actions[0]!;
  const result = await call<LobbyRoomSnapshot>((ack) => client.emit("game:command", command, ack));
  if (!result.ok) {
    // 和超时自动行动撞上了：等下一次更新再看
    await new Promise((resolve) => setTimeout(resolve, 30));
    return latest.get(client)!;
  }
  latest.set(client, result.data);
  return result.data;
}

describe("房间流程", () => {
  beforeAll(async () => {
    const serverModule = await import("../src/index.js");
    httpServer = serverModule.httpServer;
    serverIo = serverModule.io;
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, resolve);
    });
    serverUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    serverIo.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("两人打完一整局（每种行动都走到），再来一局；抓包里没有牌堆顺序、种子和动作序列", async () => {
    const { a, b } = await twoPlayerGame();
    const sawTypes = new Set<string>();
    const play = async (client: TestSocket) => {
      for (;;) {
        const room = latest.get(client)!;
        if (room.game?.phase === "finished") return;
        if (!myTurn(client)(room)) {
          await updateWhere(client, (r) => r.game?.phase === "finished" || myTurn(client)(r));
          continue;
        }
        const after = await move(client);
        for (const event of after.game?.events ?? []) sawTypes.add(event.type);
      }
    };
    await Promise.all([play(a), play(b)]);
    const final = await updateWhere(a, (room) => room.game?.phase === "finished");
    expect(final.game!.finalResult!.winners.length).toBeGreaterThan(0);
    expect(final.game!.deckCount).toBe(0);
    for (const type of ["TilePlaced", "MeeplePlaced", "TileDrawn", "Scored"]) expect(sawTypes.has(type), type).toBe(true);
    // 抓包
    for (const client of [a, b]) {
      for (const text of captured.get(client)!) {
        const room = JSON.parse(text) as LobbyRoomSnapshot;
        if (!room.game) continue;
        expect(room.game.deck).toEqual([]);
        expect(text).not.toMatch(/"seed"|"rngState"|"log":/);
        expect(typeof room.game.deckCount).toBe("number");
      }
    }
    // 再来一局
    expect((await call<void>((ack) => a.emit("room:rematch", true, ack))).ok).toBe(true);
    expect((await call<void>((ack) => b.emit("room:rematch", true, ack))).ok).toBe(true);
    const again = await updateWhere(a, (room) => room.game?.phase === "playing" && room.game.version === 0);
    expect(Object.keys(again.game!.board)).toEqual(["0,0"]);
  }, 60_000);

  it("掉线后用原昵称加房间码回到原座位", async () => {
    const { a, b, code, nameB } = await twoPlayerGame();
    const seat = seatOf(b);
    b.disconnect();
    await updateWhere(a, (room) => room.members.some((m) => m.playerId === seat && !m.connected));
    const b2 = await connect();
    const rejoined = await call<LobbyRoomSnapshot>((ack) => b2.emit("room:join", { name: nameB, code }, ack));
    expect(rejoined.ok).toBe(true);
    if (rejoined.ok) expect(rejoined.data.members.find((m) => m.id === b2.id)?.playerId).toBe(seat);
  });

  it("超时：放地块超时自动放下，放小人超时不放", async () => {
    const { a, b } = await twoPlayerGame();
    const room = latest.get(a)!;
    const first = room.game!.players[room.game!.currentPlayer]!.id;
    const client = seatOf(a) === first ? a : b;
    void client;
    const timed = await updateWhere(a, (r) => r.game!.events.some((e) => e.type === "TurnTimedOut" && e.player === first), 5_000);
    expect(Object.keys(timed.game!.board).length).toBe(2);
    expect(timed.game!.step).toBe("meeple");
    const skipped = await updateWhere(a, (r) => r.game!.events.some((e) => e.type === "MeepleSkipped") || r.game!.currentPlayer !== room.game!.currentPlayer, 5_000);
    expect(skipped.game!.meeples).toHaveLength(0);
  });

  it("试放预览：当前玩家发的转发给别人（节流），别人发的不转发，不重置倒计时", async () => {
    const { a, b } = await twoPlayerGame();
    const room = latest.get(a)!;
    const current = seatOf(a) === room.game!.players[room.game!.currentPlayer]!.id ? a : b;
    const other = current === a ? b : a;
    const got: unknown[] = [];
    const gotSelf: unknown[] = [];
    other.on("game:hover", (payload) => got.push(payload));
    current.on("game:hover", (payload) => gotSelf.push(payload));
    const before = latest.get(other)!.turnRemainingMs!;
    current.emit("game:hover", { r: -1, c: 0, rot: 2 });
    current.emit("game:hover", { r: -1, c: 0, rot: 3 }); // 100 毫秒内的第二条被丢掉
    other.emit("game:hover", { r: 5, c: 5, rot: 0 }); // 不是他的回合
    await new Promise((resolve) => setTimeout(resolve, 150));
    current.emit("game:hover", { r: 0, c: 1, rot: 1, seg: 2 });
    current.emit("game:hover", { r: "x", c: 0, rot: 0 } as never);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(got).toHaveLength(2);
    expect((got[0] as { hover: unknown; playerId: string }).hover).toEqual({ r: -1, c: 0, rot: 2 });
    expect((got[1] as { hover: unknown }).hover).toEqual({ r: 0, c: 1, rot: 1, seg: 2 });
    expect((got[0] as { playerId: string }).playerId).toBe(seatOf(current));
    expect(gotSelf).toHaveLength(0);
    expect(latest.get(other)!.turnRemainingMs).toBe(before); // 没有新的房间更新
  });
});
