import { describe, expect, it } from "vitest";
import {
  analyze,
  apply,
  autoCommand,
  buildState,
  completePoints,
  createGame,
  finalScoring,
  key,
  legalActions,
  legalPlacements,
  meepleOptions,
  placementError,
  redactGameForViewer,
  scene,
  SCENE_NAMES,
  setupGame,
  tileShape,
  timeoutTurn,
  TILE_DEFS,
  type GameCommand,
  type GameState,
} from "./index.js";

const P = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}` }));

/** 某种地块第 n 个某类段的下标。 */
function segOf(type: string, kind: "road" | "city" | "field" | "monastery", n = 0): number {
  const segs = tileShape(type, 0).segments.filter((s) => s.kind === kind);
  return segs[n]!.index;
}

function act(state: GameState, command: GameCommand): GameState {
  return apply(state, state.players[state.currentPlayer]!.id, command).state;
}

function placeTile(state: GameState, r: number, c: number, rot: number): GameState {
  return act(state, { type: "PLACE_TILE", r, c, rot });
}

function score(state: GameState, id: string): number {
  return state.players.find((p) => p.id === id)!.score;
}

function supply(state: GameState, id: string): number {
  return state.players.find((p) => p.id === id)!.supply;
}

/** 终局结算里某人拿到的分。 */
function finalFor(records: ReturnType<typeof finalScoring>, id: string): number {
  return records.filter((r) => r.winners.includes(id)).reduce((sum, r) => sum + r.points, 0);
}

const start = (drawn: string, extra: Parameters<typeof buildState>[0] = {}) => buildState({ players: 3, step: "place", drawn, ...extra });

describe("规则书第 10 节测试用例", () => {
  it("规则书#TC1 城市对城市才能放", () => {
    const board = start("E").board;
    expect(placementError(board, "E", -1, 0, 2)).toBeNull();
    expect(placementError(board, "E", -1, 0, 0)).not.toBeNull();
    expect(placementError(board, "B", -1, 1, 0)).not.toBeNull(); // 只挨着角
    expect(placementError(board, "B", -1, 0, 0)).not.toBeNull(); // 草地接城市
    expect(() => placeTile(start("E"), -1, 0, 0)).toThrow();
  });

  it("规则书#TC2 放下就完成的城市当场得分，骑士收回", () => {
    let s = placeTile(start("E"), -1, 0, 2);
    expect(s.step).toBe("meeple");
    s = act(s, { type: "PLACE_MEEPLE", seg: segOf("E", "city") });
    expect(score(s, "p1")).toBe(4);
    expect(supply(s, "p1")).toBe(7);
    expect(s.meeples).toHaveLength(0);
    expect(s.currentPlayer).toBe(1);
  });

  it("规则书#TC3 城市：未完成终局 3 分，被乙封口后甲 8 分", () => {
    let s = placeTile(start("F", { deck: ["E", "B", "B"] }), -1, 0, 1);
    s = act(s, { type: "PLACE_MEEPLE", seg: segOf("F", "city") });
    const a = analyze(s.board, s.meeples);
    const city = a.byId.get(a.featureOf.get(`-1,0:${segOf("F", "city")}`)!)!;
    expect(city.tiles).toHaveLength(2);
    expect(city.shields).toBe(1);
    expect(city.open).toBe(1);
    expect(city.complete).toBe(false);
    expect(finalFor(finalScoring(s), "p1")).toBe(3);
    // 乙在 (−2,0) 放 E 转 180 度封口
    s = placeTile(s, -2, 0, 2);
    s = act(s, { type: "SKIP_MEEPLE" });
    expect(score(s, "p1")).toBe(8);
    expect(score(s, "p2")).toBe(0);
    expect(supply(s, "p1")).toBe(7);
  });

  it("规则书#TC4 道路被别人完成，甲 3 分", () => {
    let s = placeTile(start("W", { deck: ["W", "B"] }), 0, 1, 0);
    const westRoad = tileShape("W", 0).segments.find((x) => x.kind === "road" && x.edges.includes("W"))!.index;
    s = act(s, { type: "PLACE_MEEPLE", seg: westRoad });
    const a = analyze(s.board, s.meeples);
    const road = a.byId.get(a.featureOf.get(`0,1:${westRoad}`)!)!;
    expect(road.tiles).toHaveLength(2);
    expect(road.complete).toBe(false);
    s = placeTile(s, 0, -1, 0);
    s = act(s, { type: "SKIP_MEEPLE" });
    expect(score(s, "p1")).toBe(3); // 3 块
    expect(supply(s, "p1")).toBe(7);
    // 乙那块 W 朝南、朝西的路还开着
    const after = analyze(s.board, s.meeples);
    for (const dir of ["S", "W"] as const) {
      const seg = tileShape("W", 0).segments.find((x) => x.kind === "road" && x.edges.includes(dir))!.index;
      expect(after.byId.get(after.featureOf.get(`0,-1:${seg}`)!)!.complete).toBe(false);
    }
  });

  it("规则书#TC5 已占的道路不能再放，同一块上另一条路可以", () => {
    let s = placeTile(start("W", { deck: ["W", "B"] }), 0, 1, 0);
    const road = (dir: string) => tileShape("W", 0).segments.find((x) => x.kind === "road" && x.edges.includes(dir as "N"))!.index;
    s = act(s, { type: "PLACE_MEEPLE", seg: road("W") });
    s = placeTile(s, 0, -1, 0);
    expect(() => act(s, { type: "PLACE_MEEPLE", seg: road("E") })).toThrow();
    const ok = act(s, { type: "PLACE_MEEPLE", seg: road("S") });
    expect(ok.meeples.some((m) => m.player === "p2" && m.pos === "0,-1" && m.role === "road")).toBe(true);
  });

  it("规则书#TC6 修道院：终局 2 分；周围放满 9 分", () => {
    let s = placeTile(start("B"), 1, 0, 0);
    s = act(s, { type: "PLACE_MEEPLE", seg: segOf("B", "monastery") });
    expect(finalFor(finalScoring(s), "p1")).toBe(2);
    // 周围 8 格：最后一块由乙放下，修道院完成
    let full = buildState({
      players: 2,
      tiles: [
        { r: 1, c: 0, t: "B" },
        { r: 1, c: -1, t: "B" },
        { r: 1, c: 1, t: "B" },
        { r: 2, c: -1, t: "B" },
        { r: 2, c: 0, t: "B" },
        { r: 2, c: 1, t: "B" },
        { r: 0, c: -1, t: "U", rot: 1 },
      ],
      meeples: [{ player: 0, r: 1, c: 0, seg: segOf("B", "monastery") }],
      current: 1,
      drawn: "U",
    });
    full = placeTile(full, 0, 1, 1);
    if (full.step === "meeple") full = act(full, { type: "SKIP_MEEPLE" });
    expect(score(full, "p1")).toBe(9);
    expect(supply(full, "p1")).toBe(7);
  });

  it("规则书#TC7 道路围成环算完成，4 分", () => {
    const s = buildState({
      tiles: [
        { r: 0, c: 0, t: "V", rot: 3 },
        { r: 0, c: 1, t: "V", rot: 0 },
        { r: 1, c: 1, t: "V", rot: 1 },
        { r: 1, c: 0, t: "V", rot: 2 },
      ],
    });
    const a = analyze(s.board, []);
    const roads = a.features.filter((f) => f.kind === "road");
    expect(roads).toHaveLength(1);
    expect(roads[0]!.complete).toBe(true);
    expect(completePoints(roads[0]!)).toBe(4);
  });

  describe("规则书#TC8 农田", () => {
    // 接 TC3：(−1,0) F 转 90 度、(−2,0) E 转 180 度，城市完成
    const cityDone = (farmers: boolean, withE = true) =>
      buildState({
        players: 3,
        farmers,
        tiles: [{ r: -1, c: 0, t: "F", rot: 1 }, ...(withE ? [{ r: -2, c: 0, t: "E", rot: 2 }] : [])],
        meeples: [
          { player: 0, r: -1, c: 0, seg: 1 }, // F 东侧农田（E0 E1）
          { player: 1, r: -1, c: 0, seg: 2 }, // F 西侧农田（W0 W1）
          ...(withE ? [{ player: 2, r: -2, c: 0, seg: segOf("E", "field") }] : []),
        ],
      });
    it("三片农田各算这座城一次，各 3 分", () => {
      const s = cityDone(true);
      expect(tileShape("F", 1).segments[1]!.ports).toEqual(["E0", "E1"]);
      expect(tileShape("F", 1).segments[2]!.ports).toEqual(["W0", "W1"]);
      const records = finalScoring(s);
      expect(finalFor(records, "p1")).toBe(3);
      expect(finalFor(records, "p2")).toBe(3);
      expect(finalFor(records, "p3")).toBe(3);
    });
    it("起始地块南侧农田挨着 0 座城，0 分", () => {
      const s = buildState({ players: 2, meeples: [{ player: 0, r: 0, c: 0, seg: 3 }] });
      expect(tileShape("D", 0).segments[3]!.ports).toEqual(["E1", "S0", "S1", "W0"]);
      expect(finalScoring(s).find((r) => r.kind === "field")!.points).toBe(0);
    });
    it("城市没完成时 F 东侧农田 0 分", () => {
      expect(finalFor(finalScoring(cityDone(true, false)), "p1")).toBe(0);
    });
    it("农夫关时不能放农夫，终局不算农田", () => {
      const s = cityDone(false);
      expect(finalScoring(s).filter((r) => r.kind === "field")).toHaveLength(0);
      let t = placeTile(start("E", { farmers: false }), -1, 0, 2);
      expect(() => act(t, { type: "PLACE_MEEPLE", seg: segOf("E", "field") })).toThrow();
      t = act(t, { type: "PLACE_MEEPLE", seg: segOf("E", "city") });
      expect(score(t, "p1")).toBe(4);
    });
  });

  describe("规则书#TC9 农田挨着多座城市", () => {
    // 一排三块 E（城在北），农田东西连成一片；(−1,0)、(−1,1) 放 E 转 180 度把前两座城封口
    const build = (farmers: { player: number; c: number }[]) =>
      buildState({
        players: 2,
        tiles: [
          { r: 0, c: 0, t: "E" },
          { r: 0, c: 1, t: "E" },
          { r: 0, c: 2, t: "E" },
          { r: -1, c: 0, t: "E", rot: 2 },
          { r: -1, c: 1, t: "E", rot: 2 },
        ],
        meeples: farmers.map((f) => ({ player: f.player, r: 0, c: f.c, seg: segOf("E", "field") })),
      });
    it("挨着 3 座、完成 2 座 → 6 分", () => {
      const records = finalScoring(build([{ player: 0, c: 0 }]));
      const field = records.find((r) => r.kind === "field")!;
      expect(field.cities).toBe(2);
      expect(field.points).toBe(6);
    });
    it("甲 2 个农夫、乙 1 个 → 只有甲 6 分", () => {
      const records = finalScoring(build([{ player: 0, c: 0 }, { player: 0, c: 1 }, { player: 1, c: 2 }]));
      expect(finalFor(records, "p1")).toBe(6);
      expect(finalFor(records, "p2")).toBe(0);
    });
    it("甲乙各 1 个 → 各 6 分", () => {
      const records = finalScoring(build([{ player: 0, c: 0 }, { player: 1, c: 2 }]));
      expect(finalFor(records, "p1")).toBe(6);
      expect(finalFor(records, "p2")).toBe(6);
    });
  });

  describe("规则书#TC10 合并区域后的多数", () => {
    // 一列城：D(0,0) F(−1,0) F(−2,0) G(−3,0)，乙在 (−4,0) 放 E 封口 → 5 块 2 盾 = 14 分
    const build = (knights: { player: number; r: number }[]) =>
      buildState({
        players: 3,
        tiles: [
          { r: -1, c: 0, t: "F", rot: 1 },
          { r: -2, c: 0, t: "F", rot: 1 },
          { r: -3, c: 0, t: "G", rot: 1 },
        ],
        meeples: knights.map((k) => ({ player: k.player, r: k.r, c: 0, seg: k.r === 0 ? 1 : 0 })),
        current: 2,
        drawn: "E",
      });
    it("甲 2 骑士、乙 1 个 → 甲 14、乙 0，三个都收回", () => {
      let s = build([{ player: 0, r: 0 }, { player: 0, r: -2 }, { player: 1, r: -3 }]);
      s = placeTile(s, -4, 0, 2);
      if (s.step === "meeple") s = act(s, { type: "SKIP_MEEPLE" });
      expect(score(s, "p1")).toBe(14);
      expect(score(s, "p2")).toBe(0);
      expect(s.meeples).toHaveLength(0);
      expect(supply(s, "p1")).toBe(7);
      expect(supply(s, "p2")).toBe(7);
    });
    it("甲 1、乙 1 → 各 14", () => {
      let s = build([{ player: 0, r: 0 }, { player: 1, r: -3 }]);
      s = placeTile(s, -4, 0, 2);
      if (s.step === "meeple") s = act(s, { type: "SKIP_MEEPLE" });
      expect(score(s, "p1")).toBe(14);
      expect(score(s, "p2")).toBe(14);
    });
  });

  describe("规则书#TC11 放不下的地块", () => {
    it("只有起始地块时，C 只能放在 (−1,0)，4 个方向都合法", () => {
      const list = legalPlacements(start("C").board, "C");
      expect(list).toHaveLength(4);
      expect(list.every((p) => p.r === -1 && p.c === 0)).toBe(true);
    });
    it("牌堆顶放不下：移出本局、自动再抽，牌堆少 2 块，日志有一条", () => {
      const s = buildState({ players: 2, tiles: [{ r: -1, c: 0, t: "E", rot: 2 }], drawn: "U", deck: ["C", "V", "B"] });
      let t = placeTile(s, 0, 1, 1);
      if (t.step === "meeple") t = act(t, { type: "SKIP_MEEPLE" });
      expect(t.removed).toEqual(["C"]);
      expect(t.drawn).toBe("V");
      expect(t.deck).toEqual(["B"]);
      expect(t.history.some((h) => h.type === "removed" && h.tile === "C")).toBe(true);
      expect(t.events.some((e) => e.type === "TileRemoved" && e.tile === "C")).toBe(true);
    });
    it("牌堆抽空还没抽到能放的：游戏结束", () => {
      const s = buildState({ players: 2, tiles: [{ r: -1, c: 0, t: "E", rot: 2 }], drawn: "U", deck: ["C"] });
      let t = placeTile(s, 0, 1, 1);
      if (t.step === "meeple") t = act(t, { type: "SKIP_MEEPLE" });
      expect(t.removed).toEqual(["C"]);
      expect(t.phase).toBe("finished");
    });
  });

  it("规则书#TC12 小人用完：不能放，只能不放；放地块时直接跳过放小人", () => {
    const s = buildState({ players: 2, tiles: [{ r: -1, c: 0, t: "E", rot: 2 }], supply: [0, 7], step: "meeple", last: { r: -1, c: 0 } });
    expect(() => act(s, { type: "PLACE_MEEPLE", seg: 0 })).toThrow();
    expect(act(s, { type: "SKIP_MEEPLE" }).currentPlayer).toBe(1);
    const t = placeTile(start("E", { supply: [0, 7, 7] }), -1, 0, 2);
    expect(t.currentPlayer).toBe(1);
    expect(t.events.some((e) => e.type === "MeepleSkipped" && e.reason === "none")).toBe(true);
  });

  it("规则书#TC13 终局：最后一块放完后结算，并列都获胜", () => {
    const s = buildState({
      players: 2,
      meeples: [
        { player: 0, r: 0, c: 0, seg: 0 }, // 甲路人：起始地块的路（1 块，两头开着）
        { player: 1, r: 0, c: 0, seg: 1 }, // 乙骑士：起始地块的城（1 块）
      ],
      scores: [0, 2],
      drawn: "B",
      deck: [],
    });
    let t = placeTile(s, 1, 0, 0);
    expect(t.step).toBe("meeple");
    t = act(t, { type: "PLACE_MEEPLE", seg: segOf("B", "monastery") });
    expect(t.phase).toBe("finished");
    const result = t.finalResult!;
    const p1 = result.scores.find((x) => x.player === "p1")!;
    const p2 = result.scores.find((x) => x.player === "p2")!;
    expect(p1.roads).toBe(1);
    expect(p1.monasteries).toBe(2); // 1 + 起始地块
    expect(p2.cities).toBe(1);
    expect(p1.total).toBe(3);
    expect(p2.total).toBe(3);
    expect(result.winners).toEqual(["p1", "p2"]);
    expect(t.currentPlayer).toBe(-1);
    expect(() => act({ ...t, currentPlayer: 0 }, { type: "SKIP_MEEPLE" })).toThrow();
  });

  it("规则书#TC14 地块数据", () => {
    const defs = Object.entries(TILE_DEFS);
    expect(defs).toHaveLength(24);
    expect(defs.reduce((n, [, d]) => n + d.count, 0)).toBe(72);
    expect(defs.reduce((n, [, d]) => n + (d.cities.some((c) => c.shield) ? d.count : 0), 0)).toBe(10);
    expect(defs.reduce((n, [, d]) => n + (d.monastery ? d.count : 0), 0)).toBe(6);
    for (const [type, def] of defs) {
      const ports = def.fields.flatMap((f) => f.ports);
      expect(new Set(ports).size).toBe(ports.length);
      [..."NESW"].forEach((dir, i) => {
        const n = ports.filter((p) => p[0] === dir).length;
        expect(n, `${type} ${dir}`).toBe(def.edges[i] === "C" ? 0 : 2);
        const kind = def.edges[i];
        if (kind === "C") expect(def.cities.some((c) => c.edges.includes(dir)), `${type} ${dir} 城`).toBe(true);
        if (kind === "R") expect(def.roads.some((r) => r.ends.includes(dir)), `${type} ${dir} 路`).toBe(true);
      });
      // 每转一次和「上一个方向的图转 90 度」一致；转 4 次回到原样
      for (let r = 0; r < 4; r += 1) {
        const a = tileShape(type, r);
        const b = tileShape(type, (r + 1) % 4);
        expect(b.edges).toEqual([a.edges[3], a.edges[0], a.edges[1], a.edges[2]]);
        a.segments.forEach((seg, i) => {
          const rotated = b.segments[i]!;
          expect(rotated.kind).toBe(seg.kind);
          expect(rotated.spot[0]).toBeCloseTo(1 - seg.spot[1], 2);
          expect(rotated.spot[1]).toBeCloseTo(seg.spot[0], 2);
        });
      }
    }
  });
});

describe("规则书第 2 节 配件和地块记法", () => {
  it("段下标按 道路 → 城市 → 农田 → 修道院，旋转后端口 (k + 2r) mod 8", () => {
    const d = tileShape("D", 0).segments;
    expect(d.map((s) => s.kind)).toEqual(["road", "city", "field", "field"]);
    const k1 = tileShape("K", 1);
    expect(k1.edges).toEqual(["R", "C", "F", "R"]); // CFRR 顺时针转一次
    expect(k1.segments.find((s) => s.kind === "field" && s.ports.length === 2)!.ports).toEqual(["W1", "N0"]);
  });
  it("H、I 两段城不相连；农田挨着两段", () => {
    const h = tileShape("H", 0).segments;
    expect(h.filter((s) => s.kind === "city")).toHaveLength(2);
    expect(h.find((s) => s.kind === "field")!.adjCities).toHaveLength(2);
  });
});

describe("规则书第 3 节 开局", () => {
  it.each([2, 3, 4, 5])("%i 人：起始地块 D 在 (0,0) 不转，牌堆 70 块（另 1 块在先手手上），每人 7 个小人", (n) => {
    const s = createGame(P(n), 12345);
    expect(s.board).toEqual({ "0,0": { t: "D", r: 0 } });
    expect(s.deck).toHaveLength(70);
    expect(s.drawn).not.toBeNull();
    expect(s.players.every((p) => p.supply === 7 && p.score === 0)).toBe(true);
    expect(s.players.map((p) => p.color)).toEqual(["red", "blue", "purple", "white", "black"].slice(0, n));
    expect(s.currentPlayer).toBeGreaterThanOrEqual(0);
    expect(s.currentPlayer).toBeLessThan(n);
    expect(s.step).toBe("place");
  });
  it("1 人、6 人开不了", () => {
    expect(() => createGame(P(1))).toThrow();
    expect(() => createGame(P(6))).toThrow();
  });
  it("同一种子开出同一局；先手是随机的", () => {
    expect(createGame(P(3), 9).deck).toEqual(createGame(P(3), 9).deck);
    const firsts = new Set(Array.from({ length: 40 }, (_, i) => createGame(P(4), i).currentPlayer));
    expect(firsts.size).toBe(4);
  });
});

describe("规则书第 4 节 回合流程", () => {
  it("4.1 放地块要挨着、每一条相接的边都要对上", () => {
    // (−1,1) 上方放 E 转 180 度：南边是城，但下面 (0,1) 是一块北边草地的 U
    const s = start("E", { tiles: [{ r: 0, c: 1, t: "U", rot: 1 }] });
    expect(placementError(s.board, "E", -1, 1, 2)).not.toBeNull();
    expect(placementError(s.board, "E", -1, 1, 0)).toBeNull(); // 南边草地接 U 北边草地
    expect(placementError(s.board, "E", 5, 5, 0)).not.toBeNull();
    expect(placementError(s.board, "E", 0, 0, 0)).not.toBeNull(); // 已有地块
    expect(placementError(s.board, "E", -1, 0, 5)).not.toBeNull();
  });
  it("4.1 不是自己的回合、或者步骤不对，都拒绝", () => {
    const s = start("E");
    expect(() => apply(s, "p2", { type: "PLACE_TILE", r: -1, c: 0, rot: 2 })).toThrow();
    expect(() => act(s, { type: "SKIP_MEEPLE" })).toThrow();
    expect(() => act(s, { type: "PLACE_MEEPLE", seg: 0 })).toThrow();
    const t = placeTile(s, -1, 0, 2);
    expect(() => act(t, { type: "PLACE_TILE", r: 0, c: 1, rot: 0 })).toThrow();
    expect(() => apply(s, "x", { type: "SKIP_MEEPLE" })).toThrow();
    expect(() => act(s, { type: "NOPE" } as unknown as GameCommand)).toThrow();
  });
  it("4.2 可放的段：路、城、田、修道院；农田已有人时不能放", () => {
    let s = placeTile(start("B"), 1, 0, 0);
    const opts = meepleOptions(s.board, s.meeples, "1,0", true);
    expect(opts.sort()).toEqual([segOf("B", "field"), segOf("B", "monastery")].sort());
    // 起始地块南侧农田已有乙的农夫：B 的农田和它连着 → 不能放农夫，修道院可以
    s = buildState({ players: 2, meeples: [{ player: 1, r: 0, c: 0, seg: 3 }], drawn: "B" });
    s = placeTile(s, 1, 0, 0);
    expect(() => act(s, { type: "PLACE_MEEPLE", seg: segOf("B", "field") })).toThrow();
    expect(act(s, { type: "PLACE_MEEPLE", seg: segOf("B", "monastery") }).meeples).toHaveLength(2);
  });
  it("4.3 一次放置同时完成路和城，两个都结算、都收回", () => {
    // 甲修士在 (−1,−1) 的 B（周围已有 7 块），骑士在起始地块的城；乙在 (−1,0) 放 E 转 180 度：城和修道院同时完成
    let u = buildState({
      players: 2,
      tiles: [
        { r: -1, c: -1, t: "B" },
        { r: -2, c: -2, t: "B" },
        { r: -2, c: -1, t: "B" },
        { r: -2, c: 0, t: "B" },
        { r: -1, c: -2, t: "B" },
        { r: 0, c: -2, t: "B" },
        { r: 0, c: -1, t: "U", rot: 1 },
      ],
      meeples: [
        { player: 0, r: -1, c: -1, seg: segOf("B", "monastery") },
        { player: 0, r: 0, c: 0, seg: 1 },
      ],
      current: 1,
      drawn: "E",
    });
    // (−1,0) 的 E 转 180：南城接起始地块；北边 (−2,0) 是 B 草地，E 转 180 后北边是草地 ✓；西边 (−1,−1) 是 B 草地 ✓
    u = placeTile(u, -1, 0, 2);
    if (u.step === "meeple") u = act(u, { type: "SKIP_MEEPLE" });
    expect(score(u, "p1")).toBe(9 + 4);
    expect(supply(u, "p1")).toBe(7);
    expect(u.events.filter((e) => e.type === "Scored")).toHaveLength(2);
  });
  it("4.3 没有小人的完成区域不得分；别人完成你的区域你得分（TC4 已覆盖）", () => {
    let s = placeTile(start("E"), -1, 0, 2);
    s = act(s, { type: "SKIP_MEEPLE" });
    expect(s.players.every((p) => p.score === 0)).toBe(true);
    expect(s.history).toHaveLength(0);
  });
  it("4.4 道路接进城市或到路口都算到头；修道院周围 8 格", () => {
    // 起始地块的路：西接 W 路口、东接 W 路口 → 完成（TC4）；这里测道路的开口数
    const s = buildState({ tiles: [{ r: 0, c: 1, t: "W" }] });
    const a = analyze(s.board, []);
    const road = a.byId.get(a.featureOf.get("0,0:0")!)!;
    expect(road.open).toBe(1);
    const mon = buildState({ tiles: [{ r: 1, c: 0, t: "B" }] });
    const m = analyze(mon.board, []).features.find((f) => f.kind === "monastery")!;
    expect(m.open).toBe(7);
  });
  it("4.5 隐藏信息：牌堆顺序、种子、动作序列不给任何人（含观战）", () => {
    let s = createGame(P(3), 777);
    s = act(s, autoCommand(s));
    s = { ...s, log: [{ player: "p1", command: { type: "SKIP_MEEPLE" } }] };
    for (const viewer of ["p1", "p2", "p3", ""]) {
      const v = redactGameForViewer(s, viewer);
      expect(v.deck).toEqual([]);
      expect(v.deckCount).toBe(s.deck.length);
      expect(v.seed).toBeUndefined();
      expect(v.rngState).toBeUndefined();
      expect(v.log).toBeUndefined();
      const text = JSON.stringify(v);
      expect(text).not.toContain(s.deck.slice(0, 12).join('","'));
      expect(v.board).toEqual(s.board);
      expect(v.drawn).toBe(s.drawn);
    }
  });
  it("apply 不修改输入", () => {
    const s = createGame(P(2), 5);
    const copy = JSON.stringify(s);
    apply(s, s.players[s.currentPlayer]!.id, autoCommand(s));
    expect(JSON.stringify(s)).toBe(copy);
  });
});

describe("规则书第 5 节 特殊情况", () => {
  it("5.1 农夫局中不收回：农田挨着的城完成了也不收", () => {
    let s = placeTile(start("E"), -1, 0, 2);
    s = act(s, { type: "PLACE_MEEPLE", seg: segOf("E", "field") });
    expect(s.meeples).toHaveLength(1);
    expect(s.meeples[0]!.role).toBe("farmer");
    expect(supply(s, "p1")).toBe(6);
  });
  it("5.1 已有人的区域哪怕是自己的也不能放", () => {
    let s = buildState({ players: 2, meeples: [{ player: 0, r: 0, c: 0, seg: 1 }], drawn: "F" });
    s = placeTile(s, -1, 0, 1);
    expect(() => act(s, { type: "PLACE_MEEPLE", seg: segOf("F", "city") })).toThrow();
  });
  it("5.1 同一块上两段城连成同一座城：这块只算 1 块", () => {
    // H 在 (0,0)，东西两段城绕一圈连起来：6 块地块 → 完成 12 分（按段数会是 7 块 14 分）
    const s = buildState({
      tiles: [
        { r: 0, c: 0, t: "H", rot: 0 },
        { r: 0, c: 1, t: "N", rot: 0 },
        { r: -1, c: 1, t: "N", rot: 3 },
        { r: -1, c: 0, t: "G", rot: 0 },
        { r: -1, c: -1, t: "N", rot: 2 },
        { r: 0, c: -1, t: "N", rot: 1 },
      ],
    });
    const cities = analyze(s.board, []).features.filter((f) => f.kind === "city");
    expect(cities).toHaveLength(1);
    expect(cities[0]!.complete).toBe(true);
    expect(cities[0]!.tiles).toHaveLength(6);
    expect(cities[0]!.nodes).toHaveLength(7);
    expect(completePoints(cities[0]!)).toBe(12);
  });
  it("5.2 合并后的城：甲 1 乙 1 并列都拿全分（场景 merged）", () => {
    const s = scene("merged");
    expect(score(s, "p1")).toBe(8);
    expect(score(s, "p2")).toBe(8);
    expect(score(s, "p3")).toBe(0);
  });
});

describe("规则书第 6 节 计分", () => {
  it("6.2 终局：没完成的城每块 1 + 盾 1；修道院 1 + 周围；路每块 1", () => {
    const s = buildState({
      players: 3,
      tiles: [
        { r: -1, c: 0, t: "F", rot: 1 },
        { r: 0, c: 1, t: "W" },
        { r: 1, c: 1, t: "B" },
      ],
      meeples: [
        { player: 0, r: -1, c: 0, seg: 0 }, // 城 2 块 1 盾 → 3
        { player: 1, r: 0, c: 1, seg: segOf("W", "road", 2) }, // 西路：D + W 两块 → 2
        { player: 2, r: 1, c: 1, seg: segOf("B", "monastery") }, // 周围 (0,0)(0,1) → 3
      ],
    });
    expect(tileShape("W", 0).segments[segOf("W", "road", 2)]!.edges).toEqual(["W"]);
    const records = finalScoring(s);
    expect(finalFor(records, "p1")).toBe(3);
    expect(finalFor(records, "p2")).toBe(2);
    expect(finalFor(records, "p3")).toBe(3);
  });
  it("6.4 多数：2 对 1 只有多的得分；并列都拿全分", () => {
    const s = buildState({
      players: 3,
      tiles: [{ r: 0, c: 1, t: "W" }, { r: 0, c: -1, t: "U", rot: 1 }],
      meeples: [
        { player: 0, r: 0, c: 0, seg: 0 },
        { player: 1, r: 0, c: 1, seg: segOf("W", "road", 2) },
        { player: 1, r: 0, c: -1, seg: 0 },
      ],
    });
    const road = finalScoring(s).find((r) => r.kind === "road")!;
    expect(road.winners).toEqual(["p2"]);
    expect(road.points).toBe(3);
  });
});

describe("规则书第 9.4 节 超时", () => {
  it("放地块超时：行 → 列 → 旋转 最小的合法放法；放小人超时：不放", () => {
    const s = start("E");
    const first = legalPlacements(s.board, "E")[0]!;
    expect(autoCommand(s)).toEqual({ type: "PLACE_TILE", r: first.r, c: first.c, rot: first.rot });
    const t = timeoutTurn(s);
    expect(t.events[0]).toEqual({ type: "TurnTimedOut", player: "p1" });
    expect(t.board[key(first.r, first.c)]).toBeDefined();
    if (t.step === "meeple") {
      const u = timeoutTurn(t);
      expect(u.meeples).toHaveLength(0);
      expect(u.currentPlayer).toBe(1);
    }
  });
});

describe("预览局面工厂", () => {
  it.each([...SCENE_NAMES])("场景 %s 能造出来，状态合法", (name) => {
    const s = scene(name);
    expect(s.players.length).toBeGreaterThanOrEqual(2);
    if (s.phase === "playing") {
      expect(legalActions(s, s.players[s.currentPlayer]!.id).length).toBeGreaterThan(0);
    } else {
      expect(s.finalResult).toBeDefined();
    }
  });
  it("finalTie 有两个赢家；full5 和 final5 是 5 人", () => {
    expect(scene("finalTie").finalResult!.winners.length).toBeGreaterThanOrEqual(2);
    expect(scene("full5").players).toHaveLength(5);
    expect(scene("final5").phase).toBe("finished");
  });
});

/** 地图上每一对相邻地块的边都对得上。 */
function boardValid(state: GameState): boolean {
  for (const [pos, tile] of Object.entries(state.board)) {
    const [r, c] = pos.split(",").map(Number) as [number, number];
    const shape = tileShape(tile.t, tile.r);
    const east = state.board[key(r, c + 1)];
    if (east && tileShape(east.t, east.r).edges[3] !== shape.edges[1]) return false;
    const south = state.board[key(r + 1, c)];
    if (south && tileShape(south.t, south.r).edges[0] !== shape.edges[2]) return false;
  }
  return true;
}

describe("随机对局（每种人数 300 局）", () => {
  it.each([2, 3, 4, 5])("%i 人：配件守恒、分数来源对得上、不卡死、能结束", (n) => {
    const problems: string[] = [];
    let games = 0;
    let removedTotal = 0;
    for (let g = 0; g < 300; g += 1) {
      let rng = (g * 2654435761 + n) >>> 0;
      const rand = () => {
        rng = (rng + 0x6d2b79f5) >>> 0;
        let t = rng;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      let s = createGame(P(n), g * 31 + n, { farmers: g % 5 !== 0 });
      let steps = 0;
      let lastTurn = s.turn;
      while (s.phase !== "finished") {
        steps += 1;
        if (steps > 400) {
          problems.push(`第 ${g} 局超过 400 步`);
          break;
        }
        const id = s.players[s.currentPlayer]!.id;
        const actions = legalActions(s, id);
        if (actions.length === 0) {
          problems.push(`第 ${g} 局卡住`);
          break;
        }
        // 偏向放小人，让场上小人多一些
        const meeple = actions.filter((a) => a.type === "PLACE_MEEPLE");
        const command = meeple.length > 0 && rand() < 0.6 ? meeple[Math.floor(rand() * meeple.length)]! : actions[Math.floor(rand() * actions.length)]!;
        const next = apply(s, id, command).state;
        if (next.turn <= lastTurn) problems.push(`第 ${g} 局 turn 没前进`);
        lastTurn = next.turn;
        // 不变量
        const tiles = Object.keys(next.board).length + next.removed.length + next.deck.length + (next.drawn ? 1 : 0);
        if (tiles !== 72) problems.push(`第 ${g} 局地块数 ${tiles}`);
        for (const p of next.players) {
          const onBoard = next.meeples.filter((m) => m.player === p.id).length;
          if (onBoard + p.supply !== 7) problems.push(`第 ${g} 局 ${p.id} 小人 ${onBoard}+${p.supply}`);
          if (p.score < s.players.find((x) => x.id === p.id)!.score) problems.push(`第 ${g} 局分数倒退`);
        }
        if (next.phase === "playing") {
          if (next.step === "meeple" && next.events.some((e) => e.type === "TileDrawn")) problems.push("放小人时抽了地块");
          if (next.step === "place" && (!next.drawn || legalPlacements(next.board, next.drawn).length === 0)) problems.push(`第 ${g} 局手上的地块放不下`);
          if (next.step === "meeple" && legalActions(next, next.players[next.currentPlayer]!.id).length < 2) problems.push("放小人这一步没有可放的段");
          const a = analyze(next.board, next.meeples);
          if (next.step === "place") for (const f of a.features) {
            if (f.complete && f.meeples.length > 0) problems.push(`第 ${g} 局完成的区域上还有小人`);
          }
        }
        if (!boardValid(next)) problems.push(`第 ${g} 局地图边对不上`);
        s = next;
      }
      if (s.phase === "finished") {
        games += 1;
        removedTotal += s.removed.length;
        if (s.deck.length !== 0 || s.drawn !== null) problems.push(`第 ${g} 局结束时牌堆没空`);
        // 每人总分 = 历史记录里拿到的分之和
        for (const p of s.players) {
          const fromHistory = s.history.reduce((sum, h) => sum + (h.type === "score" && h.record.winners.includes(p.id) ? h.record.points : 0), 0);
          if (fromHistory !== p.score) problems.push(`第 ${g} 局 ${p.id} 分数 ${p.score} ≠ 记录 ${fromHistory}`);
          const b = s.finalResult!.scores.find((x) => x.player === p.id)!;
          if (b.total !== p.score || b.inGame + b.roads + b.cities + b.monasteries + b.farms !== b.total) problems.push("分项对不上");
        }
        const top = Math.max(...s.players.map((p) => p.score));
        const winners = s.players.filter((p) => p.score === top).map((p) => p.id);
        if (JSON.stringify(winners) !== JSON.stringify(s.finalResult!.winners)) problems.push("赢家不对");
        if (!s.config.farmers && s.finalResult!.records.some((r) => r.kind === "field")) problems.push("农夫关了还算农田");
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(games).toBe(300);
    void removedTotal;
  }, 120_000);
});
