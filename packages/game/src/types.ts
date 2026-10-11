/** 四个方向：北、东、南、西（下标 0–3，顺时针）。 */
export const DIRS = ["N", "E", "S", "W"] as const;
export type Dir = (typeof DIRS)[number];

/** 农田端口：每条边分两半，顺时针编号 0–7（规则书 2.1）。 */
export const PORTS = ["N0", "N1", "E0", "E1", "S0", "S1", "W0", "W1"] as const;
export type Port = (typeof PORTS)[number];

export type EdgeKind = "C" | "R" | "F";

/** 一种地块（未旋转朝向）。坐标都是 0–1 的比例（x 向右、y 向下）。 */
export interface TileDef {
  readonly count: number;
  /** 北东南西四条边的类型，例如 "CRFR"。 */
  readonly edges: string;
  readonly roads: readonly { readonly ends: readonly string[]; readonly spot: readonly number[] }[];
  readonly cities: readonly { readonly edges: string; readonly shield: boolean; readonly spot: readonly number[] }[];
  readonly fields: readonly { readonly ports: readonly string[]; readonly cities: readonly number[]; readonly spot: readonly number[] }[];
  /** 有修道院时是小人落点，没有是 null。 */
  readonly monastery: readonly number[] | null;
}

export type SegKind = "road" | "city" | "field" | "monastery";

/**
 * 地块上的一段（已按旋转换算好）。同一种地块的段下标不随旋转变化：
 * 先道路，再城市，再农田，最后修道院。
 */
export interface Segment {
  readonly index: number;
  readonly kind: SegKind;
  /** 道路、城市：这一段连到哪些边（不含 "*"）。 */
  readonly edges: Dir[];
  /** 农田：这一段的端口。 */
  readonly ports: Port[];
  /** 农田：挨着同一块地块上的哪些城市段（段下标）。 */
  readonly adjCities: number[];
  readonly shield: boolean;
  /** 小人落点（已旋转），0–1 比例坐标。 */
  readonly spot: readonly [number, number];
}

/** 地图上的一块地块：种类 + 顺时针转了几次。 */
export interface PlacedTile {
  readonly t: string;
  readonly r: 0 | 1 | 2 | 3;
}

/** 地图：键是 "行,列"，起始地块在 "0,0"，行号向南增大，列号向东增大。 */
export type Board = Record<string, PlacedTile>;

export interface Pos {
  readonly r: number;
  readonly c: number;
}

/** 一种放法：位置 + 旋转。 */
export interface Placement {
  readonly r: number;
  readonly c: number;
  readonly rot: 0 | 1 | 2 | 3;
}

export type Role = "road" | "city" | "monk" | "farmer";

/** 地图上的一个小人。 */
export interface Meeple {
  readonly player: string;
  /** 所在地块 "行,列"。 */
  readonly pos: string;
  /** 地块上的段下标。 */
  readonly seg: number;
  readonly role: Role;
}

/** 玩家颜色（按座位顺序分配，和美术的小人图同名）。 */
export const PLAYER_COLORS = ["red", "blue", "purple", "white", "black"] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];
export const PLAYER_COLOR_NAMES: Record<PlayerColor, string> = { red: "红", blue: "蓝", purple: "紫", white: "白", black: "黑" };
export const PLAYER_COLOR_HEX: Record<PlayerColor, string> = {
  red: "#e0473c",
  blue: "#3b74e0",
  purple: "#9b55d6",
  white: "#f3efe6",
  black: "#2c2c36",
};

/** 每人几个小人。 */
export const MEEPLES_PER_PLAYER = 7;

export interface Config {
  readonly playerCount: number;
  /** 农夫：默认开，房间里可以关。 */
  readonly farmers: boolean;
  /** 放地块、放小人的时限（秒）；超时自动行动。 */
  readonly placeTimeoutSec: number;
  readonly meepleTimeoutSec: number;
}

/** 开房时可以选的规则。 */
export interface GameOptions {
  readonly farmers: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = { farmers: true };

export interface Player {
  readonly id: string;
  readonly name: string;
  readonly color: PlayerColor;
  /** 手里剩几个小人。 */
  supply: number;
  score: number;
}

export type GameCommand =
  | { readonly type: "PLACE_TILE"; readonly r: number; readonly c: number; readonly rot: number }
  | { readonly type: "PLACE_MEEPLE"; readonly seg: number }
  | { readonly type: "SKIP_MEEPLE" };

/** 一个连通区域（整条路、整座城、整片农田、一座修道院）。 */
export interface Feature {
  readonly id: string;
  readonly kind: SegKind;
  /** 组成它的段："行,列:段下标"。 */
  readonly nodes: string[];
  /** 涉及的不同地块（"行,列"）。修道院：自己 + 周围已有的地块。 */
  readonly tiles: string[];
  readonly shields: number;
  /** 道路、城市：还开着的边数；修道院：周围还空着的格数；农田恒为 0（永远不算完成）。 */
  readonly open: number;
  readonly complete: boolean;
  /** 区域上的小人（不分谁的）。 */
  readonly meeples: Meeple[];
  /** 农田：挨着的城市区域 id（去重）。 */
  readonly adjCities: string[];
}

/** 一次得分记录（局中区域完成，或者终局结算）。 */
export interface ScoreRecord {
  readonly kind: SegKind;
  /** true：终局结算；false：局中完成。 */
  readonly final: boolean;
  readonly complete: boolean;
  readonly tiles: number;
  readonly shields: number;
  /** 农田：挨着几座已完成的城市。 */
  readonly cities: number;
  readonly points: number;
  /** 拿分的人（并列最多都拿全分）。没人有小人时为空。 */
  readonly winners: string[];
  /** 涉及的地块（界面高亮用）。 */
  readonly area: string[];
  /** 区域里的段（"行,列:段下标"，界面描边用）。 */
  readonly nodes: string[];
  /** 结算时收回的小人（农夫不收回，终局也不收回）。 */
  readonly returned: Meeple[];
  /** 发生在第几块地块放下时（含起始地块）。 */
  readonly turnNo: number;
}

export interface ScoreBreakdown {
  readonly player: string;
  /** 局中得的分。 */
  readonly inGame: number;
  /** 终局：没完成的道路、城市、修道院，和农田。 */
  readonly roads: number;
  readonly cities: number;
  readonly monasteries: number;
  readonly farms: number;
  readonly total: number;
}

export interface FinalResult {
  readonly scores: ScoreBreakdown[];
  readonly winners: string[];
  /** 终局结算的每一项（界面逐项演示用）。 */
  readonly records: ScoreRecord[];
}

export type GameEvent =
  | { readonly type: "TileDrawn"; readonly player: string; readonly tile: string }
  /** 抽到放哪都不合法的地块，移出本局。 */
  | { readonly type: "TileRemoved"; readonly player: string; readonly tile: string }
  | { readonly type: "TilePlaced"; readonly player: string; readonly tile: string; readonly r: number; readonly c: number; readonly rot: number }
  | { readonly type: "MeeplePlaced"; readonly meeple: Meeple }
  | { readonly type: "MeepleSkipped"; readonly player: string; readonly reason: "chose" | "none" }
  | { readonly type: "Scored"; readonly record: ScoreRecord }
  | { readonly type: "GameEnded"; readonly result: FinalResult }
  | { readonly type: "TurnTimedOut"; readonly player: string };

/** 公开的一条历史（日志用）：得分和移出的地块。 */
export type HistoryEntry =
  | { readonly type: "score"; readonly record: ScoreRecord }
  | { readonly type: "removed"; readonly player: string; readonly tile: string; readonly turnNo: number };

export interface GameState {
  readonly config: Config;
  phase: "playing" | "finished";
  players: Player[];
  /** 轮到谁（players 下标）；结束后是 −1。 */
  currentPlayer: number;
  /** place：放地块；meeple：在刚放的地块上放小人（或不放）。 */
  step: "place" | "meeple";
  /** 当前玩家手上的地块（所有人可见）；结束后为 null。 */
  drawn: string | null;
  board: Board;
  /** 刚放下的那块（放小人只能放在它上面；界面高亮用）。 */
  lastPlaced: Placement | null;
  meeples: Meeple[];
  /** 放不下被移出本局的地块（公开）。 */
  removed: string[];
  /** 得分和移出记录（公开，日志用）。 */
  history: HistoryEntry[];
  /** 已经放下的地块数（含起始地块）。 */
  turnNo: number;
  /** 每换一个人或一个步骤 +1，用作回合计时的键。 */
  turn: number;
  /** 这一步产生的事件（每次 apply 覆盖）。 */
  events: GameEvent[];
  finalResult?: FinalResult;
  version: number;
  /** 以下只在服务端：牌堆顺序、种子、动作序列。发给客户端前清空。 */
  deck: string[];
  seed?: number;
  rngState?: number;
  log?: { player: string; command: GameCommand | { type: "TIMEOUT" } }[];
  /** 仅客户端视角：牌堆剩几块。 */
  deckCount?: number;
}
