/**
 * 地图：无限延伸的拼图。可以拖动（鼠标 / 单指）、缩放（滚轮 / 双指 / ＋－按钮）、「全图」一键看全部。
 *
 * - 格子大小只取 CELL_LEVELS 里的几档，像素图按整数倍显示；不用 CSS 缩放，换档时重新排。
 * - 地块每个旋转方向是单独一张图，直接换图，不用 CSS rotate。
 * - 小人图中心对准落点；落下动画每帧 (12,20) 对准落点。
 * - 新地块放下（focus 变了）时，镜头移过去（只在它不在视野中间区域时）。
 * - 点击：放地块时算出点的是哪一格交给 onCell；放小人时先看点没点中落点圆环。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { bounds, key, parseKey, tileShape, type GameState, type Meeple, type PlayerColor } from "@carcassonne/game";
import { art, CELL_LEVELS, tileArtFor } from "./art.js";

export interface Spot {
  readonly seg: number;
  readonly x: number;
  readonly y: number;
  readonly lying: boolean;
}

export interface Ghost {
  readonly r: number;
  readonly c: number;
  readonly rot: number;
  readonly tile: string;
  /** chosen：已选中（金框跳动）；ok：悬停、合法（绿框）；bad：不合法（红）；remote：别人在试（玩家色虚框）。 */
  readonly kind: "chosen" | "ok" | "bad" | "remote";
  readonly color?: string;
}

export type Effect =
  | { readonly id: number; readonly kind: "place"; readonly pos: string }
  | { readonly id: number; readonly kind: "glow"; readonly pos: string; readonly color: string }
  | { readonly id: number; readonly kind: "score"; readonly area: string[]; readonly label: string; readonly at: string; readonly color: string; readonly final: boolean };

export interface MapViewProps {
  readonly game: GameState;
  readonly colorOf: (playerId: string) => PlayerColor;
  /** 能放地块的空格（"r,c" → 合法的旋转）；空表示不在放地块。 */
  readonly slots: ReadonlyMap<string, number[]>;
  readonly ghost: Ghost | null;
  /** 放小人时可选的落点（在 spotsAt 那块地块上）。 */
  readonly spots: readonly Spot[];
  readonly spotsAt: string | null;
  readonly selectedSeg: number | null;
  /** 选中的落点上画一个半透明的小人（自己或别人预选的）。 */
  readonly ghostMeeple: { readonly pos: string; readonly x: number; readonly y: number; readonly lying: boolean; readonly color: PlayerColor } | null;
  readonly effects: readonly Effect[];
  /** 变了就把镜头移到这一格（新放下的地块）。 */
  readonly focus: { readonly pos: string; readonly key: string } | null;
  /** 放小人时把镜头拉近到这一格（手机上落点太小点不中）。 */
  readonly zoomTo: { readonly pos: string; readonly key: string } | null;
  /** 刚放下的那块用谁的颜色描边。 */
  readonly lastColor: string | null;
  /** 本版本里刚放下的小人（播落下动画）。 */
  readonly freshMeeples: ReadonlySet<string>;
  readonly onCell?: ((r: number, c: number) => void) | undefined;
  readonly onHover?: ((cell: { r: number; c: number } | null) => void) | undefined;
  readonly onSpot?: ((seg: number) => void) | undefined;
  /** 地图右下角额外的按钮。 */
  readonly children?: ReactNode;
  /** 手机：默认格子稍大一点、落点点击范围更大。 */
  readonly coarse: boolean;
  /** 结算时收回的小人：从地图上飞回名牌。 */
  readonly flyers: readonly { readonly id: number; readonly meeple: Meeple }[];
  /** 石桌背景图。 */
  readonly table: string;
}

interface Camera {
  /** 视口中心对应的地图坐标（以格为单位，可以是小数）。 */
  readonly cx: number;
  readonly cy: number;
  readonly cell: number;
}

const DRAG_THRESHOLD = 6;

/** 能放下 cols×rows 格的最大一档。 */
function fitLevel(width: number, height: number, cols: number, rows: number, cap: number): number {
  let best: number = CELL_LEVELS[0];
  for (const level of CELL_LEVELS) if (level <= cap && cols * level <= width && rows * level <= height) best = level;
  return best;
}

function fitCamera(game: GameState, width: number, height: number, cap: number): Camera {
  const b = bounds(game.board);
  // 外面留一圈空位（能放地块的地方）
  const cols = b.maxC - b.minC + 3;
  const rows = b.maxR - b.minR + 3;
  const cell = fitLevel(width - 16, height - 16, cols, rows, cap);
  return { cx: (b.minC + b.maxC + 1) / 2, cy: (b.minR + b.maxR + 1) / 2, cell };
}

export function MapView(props: MapViewProps) {
  const { game, slots, ghost, spots, spotsAt, selectedSeg, effects, focus, zoomTo, coarse } = props;
  const viewRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera | null>(null);
  const [glide, setGlide] = useState(false);
  const touched = useRef(false);
  const preferred = coarse ? 64 : 64;

  useLayoutEffect(() => {
    const element = viewRef.current;
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 开局 / 尺寸变了且没人动过镜头：自动对准整张图（最大 64 档）
  useEffect(() => {
    if (size.width === 0) return;
    if (!camera || !touched.current) setCamera(fitCamera(game, size.width, size.height, preferred));
  }, [size.width, size.height]);

  const moveTo = useCallback((next: Camera, smooth: boolean) => {
    setGlide(smooth);
    setCamera(next);
  }, []);

  const fitAll = useCallback(() => {
    touched.current = false;
    moveTo(fitCamera(game, size.width, size.height, 128), true);
  }, [game, size, moveTo]);

  const zoom = useCallback((dir: 1 | -1, anchor?: { x: number; y: number }) => {
    setCamera((current) => {
      if (!current) return current;
      const index = CELL_LEVELS.indexOf(current.cell as (typeof CELL_LEVELS)[number]);
      const nextCell = CELL_LEVELS[Math.max(0, Math.min(CELL_LEVELS.length - 1, index + dir))]!;
      if (nextCell === current.cell) return current;
      touched.current = true;
      const ax = anchor?.x ?? size.width / 2;
      const ay = anchor?.y ?? size.height / 2;
      // 保持锚点下的地图位置不动
      const mapX = current.cx + (ax - size.width / 2) / current.cell;
      const mapY = current.cy + (ay - size.height / 2) / current.cell;
      return { cell: nextCell, cx: mapX - (ax - size.width / 2) / nextCell, cy: mapY - (ay - size.height / 2) / nextCell };
    });
    setGlide(false);
  }, [size]);

  // 新地块放下：不在视野中间区域就移过去
  useEffect(() => {
    if (!focus || !camera || size.width === 0) return;
    const { r, c } = parseKey(focus.pos);
    const marginX = Math.min(size.width / 4, camera.cell * 1.5);
    const marginY = Math.min(size.height / 4, camera.cell * 1.5);
    const left = size.width / 2 + (c - camera.cx) * camera.cell;
    const top = size.height / 2 + (r - camera.cy) * camera.cell;
    const inside = left >= marginX && left + camera.cell <= size.width - marginX && top >= marginY && top + camera.cell <= size.height - marginY;
    if (!inside) moveTo({ ...camera, cx: c + 0.5, cy: r + 0.5 }, true);
  }, [focus?.key]);

  // 放小人：格子太小就拉近
  useEffect(() => {
    if (!zoomTo || !camera) return;
    const want = coarse ? 128 : 64;
    const { r, c } = parseKey(zoomTo.pos);
    if (camera.cell < want) moveTo({ cell: want, cx: c + 0.5, cy: r + 0.5 }, false);
  }, [zoomTo?.key]);

  // ---------- 拖动、点击、悬停、缩放 ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ id: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const pinch = useRef<{ dist: number } | null>(null);

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = viewRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const cellAt = (x: number, y: number) => {
    if (!camera) return null;
    const mx = camera.cx + (x - size.width / 2) / camera.cell;
    const my = camera.cy + (y - size.height / 2) / camera.cell;
    return { r: Math.floor(my), c: Math.floor(mx), fx: mx - Math.floor(mx), fy: my - Math.floor(my) };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const p = local(event);
    pointers.current.set(event.pointerId, p);
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // 合成的指针事件（预览、教程脚本）没法捕获，忽略
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
      drag.current = null;
      return;
    }
    if (camera) drag.current = { id: event.pointerId, x: p.x, y: p.y, cx: camera.cx, cy: camera.cy, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const p = local(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, p);
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const ratio = dist / pinch.current.dist;
      if (ratio > 1.35 || ratio < 1 / 1.35) {
        zoom(ratio > 1 ? 1 : -1, { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 });
        pinch.current = { dist };
      }
      return;
    }
    const d = drag.current;
    if (d && d.id === event.pointerId && event.buttons !== 0) {
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) d.moved = true;
      if (d.moved && camera) {
        touched.current = true;
        setGlide(false);
        setCamera({ ...camera, cx: d.cx - dx / camera.cell, cy: d.cy - dy / camera.cell });
      }
      return;
    }
    if (event.pointerType === "mouse" && props.onHover) {
      const cell = cellAt(p.x, p.y);
      props.onHover(cell ? { r: cell.r, c: cell.c } : null);
    }
  };
  const endPointer = (event: React.PointerEvent, cancelled: boolean) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (cancelled || !d || d.id !== event.pointerId || d.moved) return;
    const p = local(event);
    const cell = cellAt(p.x, p.y);
    if (!cell) return;
    // 放小人：点中（或靠近）落点圆环
    if (spotsAt && props.onSpot && spots.length > 0 && camera) {
      const at = parseKey(spotsAt);
      const reach = Math.max(coarse ? 24 : 16, camera.cell / 6);
      let bestSeg = -1;
      let bestDist = Infinity;
      for (const spot of spots) {
        const sx = size.width / 2 + (at.c + spot.x - camera.cx) * camera.cell;
        const sy = size.height / 2 + (at.r + spot.y - camera.cy) * camera.cell;
        const dist = Math.hypot(sx - p.x, sy - p.y);
        if (dist < bestDist) {
          bestDist = dist;
          bestSeg = spot.seg;
        }
      }
      if (bestDist <= reach) {
        props.onSpot(bestSeg);
        return;
      }
    }
    props.onCell?.(cell.r, cell.c);
  };
  const onWheel = (event: React.WheelEvent) => {
    if (Math.abs(event.deltaY) < 4) return;
    zoom(event.deltaY < 0 ? 1 : -1, local(event));
  };

  // ---------- 画 ----------
  const cell = camera?.cell ?? 64;
  const tx = Math.round(size.width / 2 - (camera?.cx ?? 0) * cell);
  const ty = Math.round(size.height / 2 - (camera?.cy ?? 0) * cell);
  const tilePx = tileArtFor(cell);
  const big = cell >= 64;
  const meepleSize = big ? 24 * (cell / 64) : 12 * Math.max(1, Math.floor(cell / 32));
  const spotSize = 16 * Math.max(1, Math.floor(cell / 64));
  const at = (pos: string) => parseKey(pos);
  const box = (r: number, c: number): CSSProperties => ({ left: c * cell, top: r * cell, width: cell, height: cell });

  const meepleEl = (meeple: Meeple, index: number) => {
    const tile = game.board[meeple.pos];
    if (!tile) return null;
    const seg = tileShape(tile.t, tile.r).segments[meeple.seg];
    if (!seg) return null;
    const { r, c } = at(meeple.pos);
    const x = (c + seg.spot[0]) * cell;
    const y = (r + seg.spot[1]) * cell;
    const color = props.colorOf(meeple.player);
    const lying = meeple.role === "farmer";
    const id = `${meeple.pos}:${meeple.seg}`;
    if (big && !lying && props.freshMeeples.has(id)) {
      const scale = cell / 64;
      return (
        <span
          key={id}
          className="cc-meeple-drop"
          style={{ left: x - 12 * scale, top: y - 20 * scale, width: 24 * scale, height: 32 * scale, backgroundImage: `url(${art.meepleDrop(color)})` }}
        />
      );
    }
    return (
      <img
        key={id + index}
        className={["cc-meeple", lying ? "lying" : ""].join(" ")}
        src={art.meeple(color, lying, !big)}
        alt=""
        style={{ left: x - meepleSize / 2, top: y - meepleSize / 2, width: meepleSize, height: meepleSize }}
      />
    );
  };

  const last = game.lastPlaced ? key(game.lastPlaced.r, game.lastPlaced.c) : null;
  const tableScale = Math.max(1, Math.ceil(Math.max(size.width / 512, size.height / 288)));

  return (
    <div
      ref={viewRef}
      className={["cc-map", slots.size > 0 ? "placing" : "", spots.length > 0 ? "spotting" : ""].join(" ")}
      data-tutorial="map"
      style={{ "--table-size": `${512 * tableScale}px ${288 * tableScale}px`, "--table": `url(${props.table})` } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => endPointer(event, false)}
      onPointerCancel={(event) => endPointer(event, true)}
      onLostPointerCapture={(event) => { if (drag.current?.id === event.pointerId) drag.current = null; pointers.current.delete(event.pointerId); }}
      onPointerLeave={() => props.onHover?.(null)}
      onWheel={onWheel}
    >
      {camera && (
        <div className={glide ? "cc-layer glide" : "cc-layer"} style={{ transform: `translate(${tx}px, ${ty}px)` }}>
          {Object.entries(game.board).map(([pos, tile]) => {
            const { r, c } = at(pos);
            return <img key={pos} className="cc-tile" src={art.tile(tile.t, tile.r, tilePx)} alt="" style={box(r, c)} draggable={false} />;
          })}
          {big && game.board["0,0"] && (
            <span className="cc-flag" style={{ left: (46 / 64) * cell, top: (2 / 64) * cell, width: 16 * (cell / 64), height: 16 * (cell / 64), backgroundImage: `url(${art.startFlagWave})` }} />
          )}
          {[...slots.keys()].map((pos) => {
            const { r, c } = at(pos);
            return (
              <span
                key={`slot-${pos}`}
                className={big ? "cc-slot img" : "cc-slot"}
                data-tutorial={`cell-${r}_${c}`}
                style={{ ...box(r, c), ...(big ? { backgroundImage: `url(${art.slotOk})` } : {}) }}
              />
            );
          })}
          {last && game.board[last] && (
            <span className="cc-last" data-tutorial="last-tile" style={{ ...box(at(last).r, at(last).c), "--seat": props.lastColor ?? "transparent" } as CSSProperties} />
          )}
          {effects.map((effect) => {
            if (effect.kind === "place") {
              const { r, c } = at(effect.pos);
              return <span key={effect.id} className="cc-fx-place" style={{ ...box(r, c), backgroundImage: `url(${art.fxPlace})` }} />;
            }
            if (effect.kind === "glow") {
              const { r, c } = at(effect.pos);
              return <span key={effect.id} className="cc-glow" style={{ ...box(r, c), "--seat": effect.color } as CSSProperties} />;
            }
            return effect.area.map((pos) => {
              const { r, c } = at(pos);
              return <span key={`${effect.id}-${pos}`} className={effect.final ? "cc-area final" : "cc-area"} style={{ ...box(r, c), backgroundImage: `url(${art.fxScore})` }} />;
            });
          })}
          {game.meeples.map(meepleEl)}
          {ghost && (
            <span
              className={`cc-ghost ${ghost.kind}`}
              data-tutorial="ghost"
              style={{ ...box(ghost.r, ghost.c), "--seat": ghost.color ?? "transparent" } as CSSProperties}
            >
              <img src={art.tile(ghost.tile, ghost.rot, tilePx)} alt="" draggable={false} />
              {ghost.kind === "bad" && big && <img className="cc-ghost-bad" src={art.slotBad} alt="" draggable={false} />}
            </span>
          )}
          {spotsAt && spots.map((spot) => {
            const { r, c } = at(spotsAt);
            const x = (c + spot.x) * cell;
            const y = (r + spot.y) * cell;
            const hit = Math.max(spotSize + 8, coarse ? 40 : 28);
            return (
              <span
                key={`spot-${spot.seg}`}
                className={selectedSeg === spot.seg ? "cc-spot selected" : "cc-spot"}
                data-tutorial={`spot-${spot.seg}`}
                style={{ left: x - hit / 2, top: y - hit / 2, width: hit, height: hit }}
              >
                <i style={{ width: spotSize, height: spotSize, backgroundImage: `url(${art.spotPulse})` }} />
              </span>
            );
          })}
          {props.ghostMeeple && (() => {
            const g = props.ghostMeeple;
            const { r, c } = at(g.pos);
            const x = (c + g.x) * cell;
            const y = (r + g.y) * cell;
            return <img className="cc-meeple ghosted" src={art.meeple(g.color, g.lying, !big)} alt="" style={{ left: x - meepleSize / 2, top: y - meepleSize / 2, width: meepleSize, height: meepleSize }} />;
          })()}
          {effects.map((effect) => {
            if (effect.kind !== "score") return null;
            const { r, c } = at(effect.at);
            return (
              <b key={`label-${effect.id}`} className={effect.final ? "cc-plus final" : "cc-plus"} style={{ left: (c + 0.5) * cell, top: r * cell, "--seat": effect.color } as CSSProperties}>
                {effect.label}
              </b>
            );
          })}
        </div>
      )}
      {camera && props.flyers.map((flyer) => {
        const tile = game.board[flyer.meeple.pos];
        if (!tile) return null;
        const segment = tileShape(tile.t, tile.r).segments[flyer.meeple.seg];
        if (!segment) return null;
        const { r, c } = at(flyer.meeple.pos);
        return (
          <Flyer
            key={flyer.id}
            viewRef={viewRef}
            x={tx + (c + segment.spot[0]) * cell}
            y={ty + (r + segment.spot[1]) * cell}
            player={flyer.meeple.player}
            color={props.colorOf(flyer.meeple.player)}
            size={Math.max(24, meepleSize)}
          />
        );
      })}
      <div className="cc-map-tools">
        {props.children}
        <button className="quiet-button" type="button" onClick={() => zoom(-1)} aria-label="缩小" title="缩小">－</button>
        <button className="quiet-button" type="button" onClick={() => zoom(1)} aria-label="放大" title="放大">＋</button>
        <button className="quiet-button" type="button" onClick={fitAll} data-tutorial="fit" title="看全部地块">全图</button>
      </div>
    </div>
  );
}

/** 一个飞回名牌的小人（位置固定在屏幕上，只用位移动画）。 */
function Flyer({ viewRef, x, y, player, color, size }: { viewRef: React.RefObject<HTMLDivElement | null>; x: number; y: number; player: string; color: PlayerColor; size: number }) {
  const [path, setPath] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  useLayoutEffect(() => {
    const view = viewRef.current?.getBoundingClientRect();
    if (!view) return;
    const sx = view.left + x;
    const sy = view.top + y;
    const targets = [...document.querySelectorAll<HTMLElement>(`[data-meeples="${player}"]`)]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight);
    const target = targets[0];
    const ex = target ? target.left + target.width / 2 : sx;
    const ey = target ? target.top + target.height / 2 : sy - 80;
    setPath({ x: sx, y: sy, dx: ex - sx, dy: ey - sy });
  }, []);
  if (!path) return null;
  return (
    <img
      className="cc-flyer"
      src={art.meeple(color)}
      alt=""
      style={{ left: path.x - size / 2, top: path.y - size / 2, width: size, height: size, "--dx": `${path.dx}px`, "--dy": `${path.dy}px` } as CSSProperties}
    />
  );
}
