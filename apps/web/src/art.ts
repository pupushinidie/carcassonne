import type { PlayerColor } from "@carcassonne/game";

/**
 * 像素美术的地址。图片放在 public/art 下（美术 agent 用 PixelLab 做，见 art/spec.md），只按整数倍显示，
 * 加 image-rendering: pixelated。地块每个旋转方向单独一张图（部件和光影永远正着），**直接换图，不用 CSS 旋转**。
 */
const ROOT = `${import.meta.env.BASE_URL}art/`;

/** 地块原图边长：64（tiles）和 32（tiles32，格子 ≤ 48px 时用）。 */
export const TILE_ART = 64;

export const art = {
  /** 地块：r = 顺时针转了几次。px 选原图（64 或 32）。 */
  tile: (type: string, rot: number, px: 64 | 32 = 64) => `${ROOT}${px === 32 ? "tiles32" : "tiles"}/tile-${type}-${rot}.png`,
  tileBack: `${ROOT}tiles/tile-back.png`,
  /** 小人：站着（路人/骑士/修士）或躺着（农夫），24×24，图中心对准落点；small 是 12×12 版。 */
  meeple: (color: PlayerColor, lying = false, small = false) => `${ROOT}meeple/${lying ? "lie" : "stand"}-${color}${small ? "-12" : ""}.png`,
  /** 放小人动画：24×32 × 6 帧横排，每帧 (12,20) 对准落点，每帧 70ms，播一次。 */
  meepleDrop: (color: PlayerColor) => `${ROOT}meeple/drop-${color}.png`,
  startFlag: `${ROOT}ui/start-flag.png`,
  startFlagWave: `${ROOT}ui/start-flag-wave.png`,
  slotOk: `${ROOT}ui/slot-ok.png`,
  slotBad: `${ROOT}ui/slot-bad.png`,
  spot: `${ROOT}ui/spot.png`,
  spotPulse: `${ROOT}ui/spot-pulse.png`,
  fxPlace: `${ROOT}fx/place.png`,
  fxScore: `${ROOT}fx/score.png`,
  sparkle: `${ROOT}fx/sparkle.png`,
  tableDay: `${ROOT}bg/table-day.png`,
  tableNight: `${ROOT}bg/table-night.png`,
  wreath: `${ROOT}ui/result-wreath.png`,
  icon: `${ROOT}ui/icon.png`,
};

/** 玩家颜色（小人、名牌、高亮），和美术规格一致。 */
export const PLAYER_HEX: Record<PlayerColor, string> = {
  red: "#e0473c",
  blue: "#3b74e0",
  purple: "#9b55d6",
  white: "#f3efe6",
  black: "#2c2c36",
};

/** 石桌图（512×288）按整数倍放大铺满一块区域需要的尺寸（CSS background-size）。 */
export function coverSize(width: number, height: number): string {
  const scale = Math.max(1, Math.ceil(Math.max(width / 512, height / 288)));
  return `${512 * scale}px ${288 * scale}px`;
}
