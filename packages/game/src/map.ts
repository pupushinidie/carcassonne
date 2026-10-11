import { TILE_DEFS } from "./tileData.js";
import {
  DIRS,
  PORTS,
  type Board,
  type Dir,
  type EdgeKind,
  type Feature,
  type Meeple,
  type Placement,
  type Port,
  type Role,
  type Segment,
  type SegKind,
} from "./types.js";

export const TILE_TYPES = Object.keys(TILE_DEFS);

export function key(r: number, c: number): string {
  return `${r},${c}`;
}

export function parseKey(value: string): { r: number; c: number } {
  const [r, c] = value.split(",").map(Number);
  return { r: r!, c: c! };
}

/** 方向 d 的邻格偏移。 */
export const DELTA: Record<Dir, readonly [number, number]> = { N: [-1, 0], E: [0, 1], S: [1, 0], W: [0, -1] };
/** 相邻地块的端口对应：自己的 N0 接北边那块的 S1，N1 接 S0；E0 接 W1，E1 接 W0。 */
const PORT_MATE: Record<Port, Port> = { N0: "S1", N1: "S0", E0: "W1", E1: "W0", S0: "N1", S1: "N0", W0: "E1", W1: "E0" };

function rotDir(d: string, rot: number): Dir {
  return DIRS[(DIRS.indexOf(d as Dir) + rot) % 4]!;
}

function rotPort(p: string, rot: number): Port {
  return PORTS[(PORTS.indexOf(p as Port) + 2 * rot) % 8]!;
}

function rotSpot(spot: readonly number[], rot: number): [number, number] {
  let [x, y] = [spot[0]!, spot[1]!];
  for (let i = 0; i < rot; i += 1) [x, y] = [1 - y, x];
  return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
}

/** 一种地块在某个旋转下的全部信息（缓存）。 */
export interface TileShape {
  readonly type: string;
  readonly rot: number;
  /** 北东南西四条边的类型（已旋转）。 */
  readonly edges: readonly EdgeKind[];
  readonly segments: readonly Segment[];
  /** 每条边上的道路/城市段下标（草地边为 −1）。 */
  readonly edgeSeg: readonly number[];
  /** 每个端口所在的农田段下标（城市边上的端口为 −1）。 */
  readonly portSeg: readonly number[];
}

const shapeCache = new Map<string, TileShape>();

export function tileShape(type: string, rot: number): TileShape {
  const cacheKey = `${type}${rot}`;
  const cached = shapeCache.get(cacheKey);
  if (cached) return cached;
  const def = TILE_DEFS[type];
  if (!def) throw new Error(`没有这种地块：${type}`);
  const edges = DIRS.map((_, d) => def.edges[(d - rot + 4) % 4] as EdgeKind);
  const segments: Segment[] = [];
  const edgeSeg = [-1, -1, -1, -1];
  const portSeg = Array.from({ length: 8 }, () => -1);
  for (const road of def.roads) {
    const segEdges = road.ends.filter((end) => end !== "*").map((end) => rotDir(end, rot));
    for (const d of segEdges) edgeSeg[DIRS.indexOf(d)] = segments.length;
    segments.push({ index: segments.length, kind: "road", edges: segEdges, ports: [], adjCities: [], shield: false, spot: rotSpot(road.spot, rot) });
  }
  const cityBase = segments.length;
  for (const city of def.cities) {
    const segEdges = [...city.edges].map((end) => rotDir(end, rot));
    for (const d of segEdges) edgeSeg[DIRS.indexOf(d)] = segments.length;
    segments.push({ index: segments.length, kind: "city", edges: segEdges, ports: [], adjCities: [], shield: city.shield, spot: rotSpot(city.spot, rot) });
  }
  for (const field of def.fields) {
    const ports = field.ports.map((port) => rotPort(port, rot));
    for (const port of ports) portSeg[PORTS.indexOf(port)] = segments.length;
    segments.push({
      index: segments.length,
      kind: "field",
      edges: [],
      ports,
      adjCities: field.cities.map((ci) => cityBase + ci),
      shield: false,
      spot: rotSpot(field.spot, rot),
    });
  }
  if (def.monastery) {
    segments.push({ index: segments.length, kind: "monastery", edges: [], ports: [], adjCities: [], shield: false, spot: rotSpot(def.monastery, rot) });
  }
  const shape: TileShape = { type, rot, edges, segments, edgeSeg, portSeg };
  shapeCache.set(cacheKey, shape);
  return shape;
}

/** 地块某个旋转下的段（规则书 9.2 的 segmentsOf）。 */
export function segmentsOf(type: string, rot: number): readonly Segment[] {
  return tileShape(type, rot).segments;
}

/** 小人身份：道路 → 路人，城市 → 骑士，修道院 → 修士，农田 → 农夫。 */
export function roleOf(kind: SegKind): Role {
  return kind === "road" ? "road" : kind === "city" ? "city" : kind === "monastery" ? "monk" : "farmer";
}

/** 这块地块放在 (r, c)、转 rot 次合不合法：空位、至少一边相邻、所有相接的边类型相同。 */
export function placementError(board: Board, type: string, r: number, c: number, rot: number): string | null {
  if (![0, 1, 2, 3].includes(rot)) return "旋转方向不对。";
  if (!Number.isInteger(r) || !Number.isInteger(c)) return "位置不对。";
  if (board[key(r, c)]) return "这里已经有地块了。";
  const shape = tileShape(type, rot);
  let neighbors = 0;
  for (let d = 0; d < 4; d += 1) {
    const dir = DIRS[d]!;
    const [dr, dc] = DELTA[dir];
    const other = board[key(r + dr, c + dc)];
    if (!other) continue;
    neighbors += 1;
    const otherEdge = tileShape(other.t, other.r).edges[(d + 2) % 4];
    if (otherEdge !== shape.edges[d]) return "相接的边类型不一样（城市接城市、道路接道路、草地接草地）。";
  }
  if (neighbors === 0) return "要和已有地块上下或左右挨着。";
  return null;
}

/** 地图上所有挨着已有地块的空位，按 行 → 列 排好。 */
export function frontier(board: Board): { r: number; c: number }[] {
  const seen = new Set<string>();
  const result: { r: number; c: number }[] = [];
  for (const pos of Object.keys(board)) {
    const { r, c } = parseKey(pos);
    for (const dir of DIRS) {
      const [dr, dc] = DELTA[dir];
      const k = key(r + dr, c + dc);
      if (board[k] || seen.has(k)) continue;
      seen.add(k);
      result.push({ r: r + dr, c: c + dc });
    }
  }
  return result.sort((a, b) => a.r - b.r || a.c - b.c);
}

/** 这块地块所有合法的 (r, c, rot)，按 行 → 列 → 旋转 从小到大。 */
export function legalPlacements(board: Board, type: string): Placement[] {
  const result: Placement[] = [];
  for (const { r, c } of frontier(board)) {
    for (const rot of [0, 1, 2, 3] as const) {
      if (!placementError(board, type, r, c, rot)) result.push({ r, c, rot });
    }
  }
  return result;
}

export function canPlaceAnywhere(board: Board, type: string): boolean {
  for (const { r, c } of frontier(board)) {
    for (const rot of [0, 1, 2, 3]) if (!placementError(board, type, r, c, rot)) return true;
  }
  return false;
}

/** 地图分析：所有区域，以及每个段属于哪个区域。 */
export interface Analysis {
  readonly features: Feature[];
  /** "行,列:段下标" → 区域 id。 */
  readonly featureOf: Map<string, string>;
  readonly byId: Map<string, Feature>;
}

export function nodeKey(pos: string, seg: number): string {
  return `${pos}:${seg}`;
}

/**
 * 把地图上相邻地块的同类段连起来（并查集），算出每个区域的地块、盾徽、开口、小人。
 * 整张图重算：72 块的地图每次不到 1 毫秒。
 */
export function analyze(board: Board, meeples: readonly Meeple[]): Analysis {
  const positions = Object.keys(board);
  const nodeIndex = new Map<string, number>();
  const nodeInfo: { pos: string; seg: Segment }[] = [];
  const tileBase = new Map<string, number>();
  for (const pos of positions) {
    const tile = board[pos]!;
    const shape = tileShape(tile.t, tile.r);
    tileBase.set(pos, nodeInfo.length);
    for (const seg of shape.segments) {
      nodeIndex.set(nodeKey(pos, seg.index), nodeInfo.length);
      nodeInfo.push({ pos, seg });
    }
  }
  const parent = Int32Array.from({ length: nodeInfo.length }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const open = new Int32Array(nodeInfo.length);

  for (const pos of positions) {
    const tile = board[pos]!;
    const shape = tileShape(tile.t, tile.r);
    const base = tileBase.get(pos)!;
    const { r, c } = parseKey(pos);
    for (let d = 0; d < 4; d += 1) {
      const dir = DIRS[d]!;
      const [dr, dc] = DELTA[dir];
      const otherPos = key(r + dr, c + dc);
      const other = board[otherPos];
      const seg = shape.edgeSeg[d]!;
      if (!other) {
        if (seg >= 0) open[base + seg] = open[base + seg]! + 1;
        continue;
      }
      if (d !== 1 && d !== 2) continue; // 每对相邻只连一次（东、南）
      const otherShape = tileShape(other.t, other.r);
      const otherBase = tileBase.get(otherPos)!;
      if (seg >= 0) {
        const otherSeg = otherShape.edgeSeg[(d + 2) % 4]!;
        if (otherSeg >= 0) union(base + seg, otherBase + otherSeg);
      }
      for (const half of [0, 1]) {
        const port = PORTS[d * 2 + half]!;
        const mine = shape.portSeg[d * 2 + half]!;
        const theirs = otherShape.portSeg[PORTS.indexOf(PORT_MATE[port])]!;
        if (mine >= 0 && theirs >= 0) union(base + mine, otherBase + theirs);
      }
    }
  }

  interface Acc {
    id: string;
    kind: SegKind;
    nodes: string[];
    tiles: Set<string>;
    shields: number;
    open: number;
    meeples: Meeple[];
    adjCityNodes: number[];
  }
  const groups = new Map<number, Acc>();
  for (let i = 0; i < nodeInfo.length; i += 1) {
    const { pos, seg } = nodeInfo[i]!;
    const root = seg.kind === "monastery" ? i : find(i);
    let acc = groups.get(root);
    if (!acc) {
      acc = { id: nodeKey(nodeInfo[root]!.pos, nodeInfo[root]!.seg.index), kind: seg.kind, nodes: [], tiles: new Set(), shields: 0, open: 0, meeples: [], adjCityNodes: [] };
      groups.set(root, acc);
    }
    acc.nodes.push(nodeKey(pos, seg.index));
    acc.tiles.add(pos);
    if (seg.shield) acc.shields += 1;
    acc.open += open[i]!;
    if (seg.kind === "field") {
      const base = tileBase.get(pos)!;
      for (const ci of seg.adjCities) acc.adjCityNodes.push(base + ci);
    }
    if (seg.kind === "monastery") {
      const { r, c } = parseKey(pos);
      let around = 0;
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if ((dr || dc) && board[key(r + dr, c + dc)]) {
            around += 1;
            acc.tiles.add(key(r + dr, c + dc));
          }
        }
      }
      acc.open = 8 - around;
    }
  }
  const idOfRoot = new Map<number, string>();
  for (const [root, acc] of groups) idOfRoot.set(root, acc.id);
  const featureOf = new Map<string, string>();
  for (const acc of groups.values()) for (const node of acc.nodes) featureOf.set(node, acc.id);
  const accById = new Map<string, Acc>();
  for (const acc of groups.values()) accById.set(acc.id, acc);
  for (const meeple of meeples) {
    const id = featureOf.get(nodeKey(meeple.pos, meeple.seg));
    if (id) accById.get(id)!.meeples.push(meeple);
  }
  const features: Feature[] = [];
  const byId = new Map<string, Feature>();
  for (const [, acc] of groups) {
    const adjCities = [...new Set(acc.adjCityNodes.map((n) => idOfRoot.get(find(n))!))];
    const feature: Feature = {
      id: acc.id,
      kind: acc.kind,
      nodes: acc.nodes,
      tiles: [...acc.tiles],
      shields: acc.shields,
      open: acc.kind === "field" ? 0 : acc.open,
      complete: acc.kind !== "field" && acc.open === 0,
      meeples: acc.meeples,
      adjCities,
    };
    features.push(feature);
    byId.set(feature.id, feature);
  }
  return { features, featureOf, byId };
}

/** 区域完成时的分：道路每块 1；城市每块 2 + 盾徽 2；修道院 9。 */
export function completePoints(feature: Feature): number {
  if (feature.kind === "road") return feature.tiles.length;
  if (feature.kind === "city") return 2 * feature.tiles.length + 2 * feature.shields;
  if (feature.kind === "monastery") return 9;
  return 0;
}

/** 终局没完成的分：道路每块 1；城市每块 1 + 盾徽 1；修道院 1 + 周围已有地块数；农田每座挨着的已完成城市 3。 */
export function endPoints(feature: Feature, analysis: Analysis): number {
  if (feature.kind === "road") return feature.tiles.length;
  if (feature.kind === "city") return feature.tiles.length + feature.shields;
  if (feature.kind === "monastery") return feature.tiles.length; // 自己 + 周围已有
  return 3 * completedCities(feature, analysis);
}

export function completedCities(field: Feature, analysis: Analysis): number {
  return field.adjCities.filter((id) => analysis.byId.get(id)?.complete).length;
}

/** 区域里小人最多的玩家（并列都算）；没有小人返回空。 */
export function majority(meeples: readonly Meeple[]): string[] {
  const counts = new Map<string, number>();
  for (const meeple of meeples) counts.set(meeple.player, (counts.get(meeple.player) ?? 0) + 1);
  const top = Math.max(0, ...counts.values());
  return top === 0 ? [] : [...counts].filter(([, n]) => n === top).map(([player]) => player);
}

/** 刚放下的地块 pos 上能放小人的段（区域里还没有任何小人；农夫关时不能选农田）。 */
export function meepleOptions(board: Board, meeples: readonly Meeple[], pos: string, farmers: boolean, analysis?: Analysis): number[] {
  const tile = board[pos];
  if (!tile) return [];
  const map = analysis ?? analyze(board, meeples);
  const result: number[] = [];
  for (const seg of tileShape(tile.t, tile.r).segments) {
    if (seg.kind === "field" && !farmers) continue;
    const feature = map.byId.get(map.featureOf.get(nodeKey(pos, seg.index))!);
    if (feature && feature.meeples.length === 0) result.push(seg.index);
  }
  return result;
}

/** 地图边界（界面算视口用）。 */
export function bounds(board: Board): { minR: number; maxR: number; minC: number; maxC: number } {
  let minR = 0;
  let maxR = 0;
  let minC = 0;
  let maxC = 0;
  for (const pos of Object.keys(board)) {
    const { r, c } = parseKey(pos);
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
    minC = Math.min(minC, c);
    maxC = Math.max(maxC, c);
  }
  return { minR, maxR, minC, maxC };
}
