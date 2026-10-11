// 抓包：两个连接坐进同一个房间（甲建房、乙加入），打完一整局，记录服务器发给乙的每一条消息，
// 检查里面没有牌堆顺序、种子、随机数状态和动作序列。用法（先起服务：npm run dev:server）：
//   node scripts/spy.mjs            → 默认连 localhost:3025
import { io } from "socket.io-client";
import { legalActions } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? `http://localhost:${process.env.SERVER_PORT ?? 3025}`;
const received = [];
const sockets = [];
function client(name) {
  const socket = io(URL, { transports: ["websocket"] });
  sockets.push(socket);
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  let latest = null;
  let acting = false;
  const tick = async () => {
    const game = latest?.game;
    if (!game || game.phase !== "playing" || acting) return;
    const seat = latest.members.find((m) => m.id === socket.id)?.playerId;
    if (game.players[game.currentPlayer]?.id !== seat) return;
    acting = true;
    const actions = legalActions(game, seat);
    const meeple = actions.filter((a) => a.type === "PLACE_MEEPLE");
    const command = game.step === "meeple" && meeple.length && Math.random() < 0.5 ? meeple[0] : actions[Math.floor(Math.random() * actions.length)];
    const result = await emit("game:command", command);
    if (result.ok) latest = result.data;
    acting = false;
    void tick();
  };
  socket.onAny((event, payload) => {
    if (name === "乙") received.push({ event, text: JSON.stringify(payload) });
  });
  socket.on("room:updated", (room) => { latest = room; void tick(); });
  return { socket, emit, get latest() { return latest; } };
}

const a = client("甲");
const b = client("乙");
await new Promise((resolve) => a.socket.on("connect", resolve));
const created = await a.emit("room:create", { name: "甲甲", capacity: 2 });
await new Promise((resolve) => (b.socket.connected ? resolve() : b.socket.on("connect", resolve)));
await b.emit("room:join", { name: "乙乙", code: created.data.code });
await a.emit("room:start");
const deadline = Date.now() + 120_000;
while (b.latest?.game?.phase !== "finished" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
const problems = [];
let gameMessages = 0;
for (const { event, text } of received) {
  if (!text.includes('"game"')) continue;
  gameMessages += 1;
  if (/"seed"|"rngState"|"log":/.test(text)) problems.push(`${event}: 含种子/动作序列`);
  const deck = text.match(/"deck":\[([^\]]*)\]/);
  if (deck && deck[1].length > 0) problems.push(`${event}: 牌堆不是空的 ${deck[1].slice(0, 30)}`);
}
console.log(`乙一共收到 ${received.length} 条消息，其中带对局状态 ${gameMessages} 条；终局：${b.latest?.game?.phase}`);
console.log(problems.length === 0 ? "没有泄露：牌堆顺序、种子、随机数状态、动作序列都不在发给乙的数据里" : `发现问题 ${problems.length} 处：\n${problems.slice(0, 5).join("\n")}`);
for (const s of sockets) s.disconnect();
process.exit(problems.length === 0 && b.latest?.game?.phase === "finished" ? 0 : 1);
