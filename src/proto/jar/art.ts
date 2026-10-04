// Painting the scene: a sunny kitchen wall with a tiled backsplash, a butcher
// block counter over mint cabinets, and on it the big glass jar. Like the
// containers in If It Fits, the jar is painted in two layers straight from its
// physics parts: the back (far wall seen through the glass, the light on its
// floor, the far half of the rim) goes under the cats, the front (the near
// wall's veil, the glass seen edge-on, the near rim, streaks and glints, the
// twine and its tag) goes over them. Both layers are cached by the view and
// repainted only when the screen changes size.

import type { Prop } from '../../game/props';
import type { DecorPlacement } from '../../game/room';
import { drawFurniture } from '../../render/furnitureArt';
import { PALETTE, contactShadow, glint, hash01, lightOf, lineOf, mix, paperGrain, rgba, shadowOf, type Box, type Ctx } from '../../render/paint';
import {
  K,
  caustic,
  cavityAt,
  cavityPath,
  glassSolid,
  glassStreak,
  glassWall,
  restShadow,
  rimLip,
  scanCavity,
  sparkle,
  type Cavity,
  type Rim,
} from '../../render/propKit';
import { THEMES, drawDecor, drawShell, drawSunbeams } from '../../render/roomArt';
import { COUNTER_Y, CX, JAR, WORLD_W } from './config';
import { ALL_PARTS, FOOT_PART, WALL_L, WALL_R } from './jarShape';

export const THEME = THEMES.kitchen;
const SEED = 4217;
const TAU = Math.PI * 2;
/** The jar's glass: a faint aqua, like an old storage jar. */
export const TINT = '#CDE4E3';
/**
 * The room is painted with its floor at y = 560; shifted up by this much it
 * hides behind the counter (the beadboard's rail tucks under the worktop).
 */
const SHELL_DY = -18;

export const RIM: Rim = { cx: CX, y: JAR.rimY, rxm: (WALL_R - WALL_L) / 2, r: JAR.wall + 0.6 };
export const CAV: Cavity = scanCavity(ALL_PARTS, CX, JAR.rimY);

/** Wall decor, in the room's own (unshifted) coordinates. */
const WALL_DECOR: DecorPlacement[] = [
  { type: 'window', x: 22, y: -36, w: 74, h: 118, variant: 0 },
  { type: 'clock', x: 352, y: 22, w: 15 },
];

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// ---------------------------------------------------------------------------
// Back layer

/** Everything behind the cats, across the visible world rect `r`. */
export function paintBack(ctx: Ctx, r: Rect, cssPerUnit: number): void {
  // the room: wall, wallpaper, window light (the floor is behind the counter)
  ctx.save();
  ctx.translate(0, SHELL_DY);
  drawShell(ctx, THEME, r.x0, r.y0 - SHELL_DY, r.x1, r.y1 - SHELL_DY, SEED);
  for (const d of WALL_DECOR) drawDecor(ctx, d, THEME, SEED + d.x);
  drawSunbeams(ctx, WALL_DECOR);
  ctx.restore();
  // tiles behind the worktop
  drawDecor(ctx, { type: 'backsplash', x: -14, y: COUNTER_Y - 62, w: WORLD_W + 28, h: 62 }, THEME, SEED + 3);
  paintCounter(ctx, r);
  paintCounterThings(ctx);
  jarShadow(ctx);
  jarBack(ctx);
  paintFrame(ctx, r);
  paintPaper(ctx, r, cssPerUnit);
}

/** The worktop and cabinets, reaching past the bottom of the screen. */
function paintCounter(ctx: Ctx, r: Rect): void {
  // the counter art stands on the room floor (560): shift it so the floor is off screen
  const ty = Math.max(0, r.y1 + 14 - 560);
  const top = COUNTER_Y - ty;
  const prop = { uid: 3, kind: 'furniture', type: 'counter', x0: -22, x1: WORLD_W + 22, y: top } as unknown as Prop;
  ctx.save();
  ctx.translate(0, ty);
  drawFurniture(ctx, prop, THEME);
  ctx.restore();
}

/** Little things on the worktop either side of the jar. */
function paintCounterThings(ctx: Ctx): void {
  const y = COUNTER_Y + 1.5;
  drawDecor(ctx, { type: 'plant', x: 34, y, w: 34 }, THEME, SEED + 11);
  drawDecor(ctx, { type: 'jars', x: 333, y, w: 2 }, THEME, SEED + 17);
}

/** The jar's soft shadow on the worktop and the light its glass focuses there. */
function jarShadow(ctx: Ctx): void {
  const hw = (FOOT_PART.k === 'box' ? FOOT_PART.x1 - FOOT_PART.x0 : 200) / 2;
  restShadow(ctx, CX + 6, COUNTER_Y - 1, hw + 8, 4.5, 0.26);
  softBand(ctx, CX + 30, COUNTER_Y + 0.5, hw * 0.9, 3, 0.14);
  caustic(ctx, CX + hw * 0.45, COUNTER_Y + 1.2, hw * 0.55, 3.2, 0.38, mix('#FFF3D6', TINT, 0.3));
}

function softBand(ctx: Ctx, x: number, y: number, rx: number, ry: number, a: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(62,58,79,${a})`);
  g.addColorStop(1, 'rgba(62,58,79,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Far wall, the light on the floor and the far half of the rim (under the cats). */
function jarBack(ctx: Ctx): void {
  const ri = RIM.rxm - RIM.r;
  glassWall(
    ctx,
    'catjar',
    CAV,
    TINT,
    true,
    () => {
      ctx.beginPath();
      cavityPath(ctx, CAV);
      ctx.ellipse(RIM.cx, RIM.y, ri, ri * K, 0, 0, TAU);
    },
    RIM.y - ri * K,
  );
  floorLight(ctx, CAV, TINT);
  rimLip(ctx, RIM, TINT, 'far');
}

/** Where the hollow meets the floor: a soft ring of shade and a caustic. */
function floorLight(ctx: Ctx, c: Cavity, tint: string): void {
  const { cx, hw } = cavityAt(c, c.floorY - 0.6);
  const ry = Math.max(1.2, hw * K);
  const y = c.floorY;
  ctx.save();
  ctx.translate(cx, y);
  ctx.scale(1, ry / hw);
  const g = ctx.createRadialGradient(0, 0, hw * 0.35, 0, 0, hw);
  g.addColorStop(0, rgba(shadowOf(tint, 0.6), 0));
  g.addColorStop(1, rgba(shadowOf(tint, 0.6), 0.26));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, hw, 0, TAU);
  ctx.fill();
  ctx.restore();
  caustic(ctx, cx + hw * 0.32, y, hw * 0.42, ry * 0.5, 0.45, mix('#FFF4DA', tint, 0.25));
}

/** Dollhouse cut edges beyond the room (only seen on wide screens). */
function paintFrame(ctx: Ctx, r: Rect): void {
  const SIDE = 7;
  const x0 = -24;
  const x1 = WORLD_W + 24;
  if (r.x0 >= x0 - SIDE && r.x1 <= x1 + SIDE) return;
  ctx.save();
  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(r.x0, r.y0, x0 - SIDE - r.x0, r.y1 - r.y0);
  ctx.fillRect(x1 + SIDE, r.y0, r.x1 - x1 - SIDE, r.y1 - r.y0);
  ctx.fillStyle = '#E9DCCB';
  ctx.fillRect(x0 - SIDE, r.y0, SIDE, r.y1 - r.y0);
  ctx.fillRect(x1, r.y0, SIDE, r.y1 - r.y0);
  ctx.fillStyle = '#B9A58E';
  ctx.fillRect(x0 - SIDE, r.y0, 2, r.y1 - r.y0);
  ctx.fillRect(x1 + SIDE - 2, r.y0, 2, r.y1 - r.y0);
  ctx.restore();
}

/** Paper grain and a soft vignette over the whole back layer. */
function paintPaper(ctx: Ctx, r: Rect, cssPerUnit: number): void {
  const grain = ctx.createPattern(paperGrain(), 'repeat');
  ctx.save();
  if (grain) {
    const s = 1 / cssPerUnit;
    grain.setTransform?.({ a: s, b: 0, c: 0, d: s, e: 0, f: 0 });
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = grain;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  const wv = (r.x1 - r.x0) / 2;
  const hv = (r.y1 - r.y0) / 2;
  const vg = ctx.createRadialGradient(cx, cy, Math.min(wv, hv) * 0.9, cx, cy, Math.max(wv, hv) * 1.6);
  vg.addColorStop(0, 'rgba(62,58,79,0)');
  vg.addColorStop(1, 'rgba(62,58,79,0.12)');
  ctx.fillStyle = vg;
  ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Front layer

/** World rect the front layer covers (the jar and its tag). */
export const FRONT_RECT: Rect = { x0: WALL_L - 30, y0: JAR.rimY - 30, x1: WALL_R + 14, y1: JAR.footY + 8 };

/** The near wall, the glass, the near rim, highlights and the tag (over the cats). */
export function paintFront(ctx: Ctx): void {
  ctx.save();
  // the near wall's veil, below the near half of the rim
  const ro = RIM.rxm + RIM.r;
  ctx.beginPath();
  ctx.moveTo(RIM.cx - ro, RIM.y);
  ctx.ellipse(RIM.cx, RIM.y, ro, ro * K, 0, Math.PI, 0, true);
  ctx.lineTo(RIM.cx + ro, RIM.y + 600);
  ctx.lineTo(RIM.cx - ro, RIM.y + 600);
  ctx.closePath();
  ctx.clip();
  glassWall(ctx, 'catjar', CAV, TINT, false, () => {
    ctx.beginPath();
    cavityPath(ctx, CAV);
  });
  ctx.restore();
  glassSolid(ctx, ALL_PARTS, [FOOT_PART], TINT, { body: 0.32, thick: 0.4 });
  footBubbles(ctx);
  floorEdge(ctx, CAV, TINT);
  rimLip(ctx, RIM, TINT, 'near');
  // crisp streaks down the near wall on the lit side, a faint one on the far side
  const top = CAV.y0 + 10;
  const len = CAV.floorY - CAV.y0;
  glassStreak(ctx, CAV, 0.8, top + 6, top + len * 0.78, 3.2, 0.62);
  glassStreak(ctx, CAV, 0.64, top + len * 0.08, top + len * 0.42, 1.5, 0.42);
  glassStreak(ctx, CAV, -0.84, top + len * 0.3, top + len * 0.86, 1.8, 0.2);
  const { cx, hw } = cavityAt(CAV, top + 4);
  glint(ctx, cx - hw * 0.8, top + 4, 1.2, 0.9);
  sparkle(ctx, cx - hw * 0.78, CAV.floorY - 34, 3.2, 0.7);
  twineAndTag(ctx);
}

/** The near edge of the floor seen through the front: a thin bright arc. */
function floorEdge(ctx: Ctx, c: Cavity, tint: string): void {
  const { cx, hw } = cavityAt(c, c.floorY - 0.6);
  ctx.save();
  ctx.strokeStyle = rgba(lightOf(tint, 0.85), 0.5);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(cx, c.floorY, hw, Math.max(1, hw * K), 0, 0.15, Math.PI - 0.15);
  ctx.stroke();
  ctx.restore();
}

/** A few seeds of air caught in the thick foot. */
function footBubbles(ctx: Ctx): void {
  if (FOOT_PART.k !== 'box') return;
  const b = FOOT_PART;
  ctx.save();
  for (let k = 0; k < 16; k++) {
    const x = b.x0 + 8 + hash01(SEED, k * 2 + 1) * (b.x1 - b.x0 - 16);
    const y = b.y0 + 4 + hash01(SEED, k * 2 + 2) * (b.y1 - b.y0 - 7);
    const r = 0.5 + hash01(SEED, k + 70) * 0.9;
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

const TWINE = '#B98F58';
const TWINE_LIT = '#DDBB83';
const KRAFT = '#D9B98A';

/** Jute twine tied round the neck, and a kraft paper tag with a paw print. */
function twineAndTag(ctx: Ctx): void {
  const y = RIM.y + 13;
  const { cx, hw } = cavityAt(CAV, y);
  const R = hw + JAR.wall * 2 + 0.4;
  ctx.save();
  ctx.lineCap = 'round';
  for (const [dy, w] of [
    [0, 1.5],
    [2.6, 1.3],
  ] as const) {
    ctx.strokeStyle = shadowOf(TWINE, 0.15);
    ctx.lineWidth = w + 0.6;
    ctx.beginPath();
    ctx.ellipse(cx, y + dy, R, R * K, 0, 0, Math.PI);
    ctx.stroke();
    ctx.strokeStyle = TWINE_LIT;
    ctx.lineWidth = w * 0.55;
    ctx.beginPath();
    ctx.ellipse(cx, y + dy - 0.35, R, R * K, 0, 0.04, Math.PI - 0.04);
    ctx.stroke();
  }
  // the knot, on the lit side
  const th = Math.PI * 0.86;
  const kx = cx + R * Math.cos(th);
  const ky = y + 1.3 + R * K * Math.sin(th);
  ctx.fillStyle = mix(TWINE, TWINE_LIT, 0.4);
  ctx.beginPath();
  ctx.ellipse(kx, ky, 2.4, 1.9, 0.3, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = shadowOf(TWINE, 0.3);
  ctx.lineWidth = 0.6;
  ctx.stroke();
  // a loose end, and the string the tag hangs from
  ctx.strokeStyle = TWINE;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(kx + 0.5, ky + 1);
  ctx.quadraticCurveTo(kx + 4, ky + 7, kx + 2.5, ky + 13);
  ctx.stroke();
  const tx = kx - 15;
  const ty = ky + 20;
  ctx.beginPath();
  ctx.moveTo(kx - 1, ky + 1);
  ctx.quadraticCurveTo(kx - 6, ky + 13, tx + 1, ty - 1);
  ctx.stroke();
  tag(ctx, tx, ty, -0.22);
  ctx.restore();
}

/** A kraft paper tag hanging from (x, y), turned by `a`. */
function tag(ctx: Ctx, x: number, y: number, a: number): void {
  const w = 21;
  const h = 29;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(-w * 0.28, 0);
    ctx.lineTo(w * 0.28, 0);
    ctx.lineTo(w / 2, h * 0.2);
    ctx.lineTo(w / 2, h - 2.5);
    ctx.quadraticCurveTo(w / 2, h, w / 2 - 2.5, h);
    ctx.lineTo(-w / 2 + 2.5, h);
    ctx.quadraticCurveTo(-w / 2, h, -w / 2, h - 2.5);
    ctx.lineTo(-w / 2, h * 0.2);
    ctx.closePath();
  };
  // a soft shadow on the glass, away from the light
  ctx.save();
  ctx.translate(2.2, 2.6);
  path();
  ctx.fillStyle = 'rgba(62,58,79,0.16)';
  ctx.fill();
  ctx.restore();
  path();
  ctx.fillStyle = KRAFT;
  ctx.fill();
  const box: Box = { x0: -w / 2, y0: 0, x1: w / 2, y1: h };
  const g = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
  g.addColorStop(0, rgba(lightOf(KRAFT, 0.6), 0.55));
  g.addColorStop(0.5, rgba(KRAFT, 0));
  g.addColorStop(1, rgba(shadowOf(KRAFT, 0.5), 0.4));
  ctx.fillStyle = g;
  path();
  ctx.fill();
  ctx.strokeStyle = rgba(lineOf(KRAFT), 0.7);
  ctx.lineWidth = 0.7;
  path();
  ctx.stroke();
  // the eyelet
  ctx.fillStyle = mix(KRAFT, '#FFF8EE', 0.6);
  ctx.beginPath();
  ctx.arc(0, 3.6, 2.1, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba(shadowOf(KRAFT, 0.7), 0.8);
  ctx.beginPath();
  ctx.arc(0, 3.6, 1.1, 0, TAU);
  ctx.fill();
  // a stamped paw print
  ctx.fillStyle = rgba('#B0605A', 0.72);
  const py = h * 0.62;
  ctx.beginPath();
  ctx.ellipse(0, py + 1.6, 3.6, 2.9, 0, 0, TAU);
  for (const [dx, dy] of [
    [-3.9, -2.2],
    [-1.4, -4.3],
    [1.4, -4.3],
    [3.9, -2.2],
  ]) {
    ctx.moveTo(dx + 1.25, py + dy);
    ctx.ellipse(dx, py + dy, 1.25, 1.5, 0, 0, TAU);
  }
  ctx.fill();
  ctx.restore();
}

/** Contact shadow under a cat resting on the jar floor (dynamic, under the cats). */
export function floorShadow(ctx: Ctx, x: number, halfW: number, alpha: number): void {
  contactShadow(ctx, x, JAR.floorY, halfW, alpha, 0.5);
}
