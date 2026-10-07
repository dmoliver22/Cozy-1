// The tall house's own art (painted into the renderer's cached tiles): the
// roof garden up in the sky, the attic under it, the basement den under the
// living room (the attic and the basement dusty and dark until they're
// opened), the cut edges between the floors, and the three glass tubes that
// join them, with funnels in the living room's and the attic's floors and
// suction hoods at the other ends (capped and padlocked until the floor they
// go to is opened).

import { FLOOR_Y, WORLD_W } from '../game/props';
import type { DecorPlacement } from '../game/room';
import { glint, hash01, lightOf, mix, rgba, roundRect, shadowOf, softShadow, type Ctx } from '../render/paint';
import { glassSolid, rimLip, ribbonPath, sparkle, type GlassPart } from '../render/propKit';
import { THEMES, drawDecor, drawShell, drawSunbeams, paintFloor, type Theme } from '../render/roomArt';
import { castShadow, cylinderShade, inkLine, knob, paintTex } from '../render/roomKit';
import { paintSkyOverRoof } from './outsideArt';
import {
  ATTIC_DY,
  ATTIC_FLOOR_FRONT,
  ATTIC_FURNITURE,
  ATTIC_FUNNEL,
  ATTIC_TOP,
  BASEMENT_CUT,
  BELL,
  BASEMENT_DY,
  CHIMNEY,
  DECK_FRONT,
  FLOORS,
  FUNNEL,
  HOOD,
  LIVING_CEIL,
  LIVING_CUT,
  LOFT_HOOD,
  OUTLET,
  RAFTER,
  ROOF_DY,
  SKY_HOOD,
  SKY_TOP,
  SPOUT,
  type Funnel,
  type Tube,
} from './layout';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const TAU = Math.PI * 2;
/** Glass, as the jars' (a pale sea green). */
export const GLASS_TINT = '#CDE4E3';
const BRASS = '#CDA86C';
const CUT = '#E9DCCB';
const CUT_LINE = '#B9A58E';

/** The basement: a snug den with warm plaster, beadboard and brick showing through. */
export const BASEMENT_THEME: Theme = { wall: '#EADCC6', wallLow: '#CDB79C', trim: '#F5EDE1', floor: '#B08E6E', accent: '#A9C3A0', cabinet: '#D2BB9C', pattern: 'plain', dado: 'beadboard' };
/** The roof deck's boards, weathered silvery. */
const DECK_THEME: Theme = { ...THEMES.living, floor: '#C2A587' };

/** Clip to world rows y0..y1 (and the rect's columns). */
function clipRows(ctx: Ctx, r: Rect, y0: number, y1: number): boolean {
  const a = Math.max(r.y0, y0);
  const b = Math.min(r.y1, y1);
  if (b <= a) return false;
  ctx.beginPath();
  ctx.rect(r.x0, a, r.x1 - r.x0, b - a);
  ctx.clip();
  return true;
}

/** A dollhouse cut edge across the house (the cream face where a floor or ceiling is sawn through). */
export function paintCut(ctx: Ctx, r: Rect, y0: number, y1: number, seams: number[] = []): void {
  const x0 = Math.max(r.x0, -10);
  const x1 = Math.min(r.x1, WORLD_W + 10);
  ctx.save();
  ctx.fillStyle = CUT;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  paintTex(ctx, () => {
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
  }, 'wood', 0.18, 0.5, 0.18, 0, y0);
  ctx.fillStyle = CUT_LINE;
  ctx.fillRect(x0, y0, x1 - x0, 1.6);
  for (const y of seams) ctx.fillRect(x0, y - 0.5, x1 - x0, 1);
  ctx.fillStyle = rgba(shadowOf(CUT, 0.4), 0.55);
  ctx.fillRect(x0, y1 - 1.2, x1 - x0, 1.2);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The roof garden

/** The deck's railing, along its back edge. */
function railing(ctx: Ctx, x0: number, x1: number, y: number, seed: number): void {
  const wood = '#EFE5D6';
  const h = 52;
  const top = y - h;
  ctx.save();
  // its shadow on the deck
  softShadow(ctx, (x0 + x1) / 2, y + 2, (x1 - x0) / 2, 3, 0.12);
  const posts: number[] = [];
  for (let x = 6; x <= WORLD_W - 6; x += 47) posts.push(x);
  const post = (x: number): void => roundRect(ctx, x - 3.4, top - 3, 6.8, h + 3, 1.5);
  // balusters between the posts
  ctx.fillStyle = mix(wood, '#C9BBA8', 0.35);
  for (let x = 6; x < WORLD_W - 6; x += 11.75) ctx.fillRect(x - 1.1, top + 6, 2.2, h - 8);
  // rails
  for (const [ry, rh] of [
    [top, 6],
    [y - 12, 4],
  ]) {
    const p = (): void => roundRect(ctx, Math.max(x0, 0), ry, Math.min(x1, WORLD_W) - Math.max(x0, 0), rh, 1.6);
    ctx.fillStyle = wood;
    p();
    ctx.fill();
    ctx.fillStyle = rgba(lightOf(wood, 0.9), 0.8);
    ctx.fillRect(Math.max(x0, 0), ry + 0.6, Math.min(x1, WORLD_W) - Math.max(x0, 0), 1.2);
    inkLine(ctx, p, wood, 0.7, 0.45);
  }
  for (const x of posts) {
    const p = (): void => {
      ctx.beginPath();
      post(x);
    };
    ctx.fillStyle = wood;
    p();
    ctx.fill();
    cylinderShade(ctx, p, x - 3.4, x + 3.4, wood, 0.6, 0.35);
    inkLine(ctx, p, wood, 0.7, 0.5);
    knob(ctx, x, top - 4, 3.4, wood);
  }
  void seed;
  ctx.restore();
}

/** Bunting looped along the railing. */
function bunting(ctx: Ctx, y: number, seed: number): void {
  const d: DecorPlacement = { type: 'garland', x: WORLD_W / 2, y, w: WORLD_W - 30 };
  drawDecor(ctx, d, THEMES.living, seed);
}

/** The brick chimney stack, with a stone cap a cat can sit on. */
function chimney(ctx: Ctx, seed: number): void {
  const { x0, x1, y } = CHIMNEY;
  const base = FLOORS.roof.floorY;
  const brick = '#C77D62';
  const body = (): void => {
    ctx.beginPath();
    ctx.rect(x0, y + 8, x1 - x0, base - y - 8);
  };
  castShadow(ctx, body, 10, 4, 6, 0.22);
  ctx.fillStyle = brick;
  body();
  ctx.fill();
  // brick courses
  ctx.save();
  body();
  ctx.clip();
  const bh = 9;
  for (let row = 0, yy = y + 8; yy < base; row++, yy += bh) {
    const off = row % 2 ? 0 : 11;
    for (let xx = x0 - off; xx < x1; xx += 22) {
      const tone = hash01(seed + row, Math.round(xx));
      ctx.fillStyle = tone < 0.33 ? rgba(shadowOf(brick, 0.25), 0.5) : tone < 0.66 ? rgba(lightOf(brick, 0.3), 0.35) : rgba(brick, 0);
      ctx.fillRect(xx + 1, yy + 1, 20, bh - 2);
    }
    ctx.fillStyle = rgba('#E9DCCB', 0.55);
    ctx.fillRect(x0, yy, x1 - x0, 1.2);
    for (let xx = x0 - off; xx < x1; xx += 22) ctx.fillRect(xx, yy, 1.2, bh);
  }
  // light from the upper left, shade on the right
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, 'rgba(255,236,206,0.28)');
  g.addColorStop(0.5, 'rgba(255,236,206,0)');
  g.addColorStop(1, 'rgba(74,58,96,0.32)');
  ctx.fillStyle = g;
  ctx.fillRect(x0, y, x1 - x0, base - y);
  paintTex(ctx, body, 'brush', 0.25, 0.5, 0.5, x0, y);
  ctx.restore();
  inkLine(ctx, body, brick, 1, 0.6);
  // the stone cap
  const cap = (): void => roundRect(ctx, x0 - 4, y, x1 - x0 + 8, 9, 2);
  const stone = '#DCD4CA';
  ctx.fillStyle = stone;
  cap();
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(stone, 0.9), 0.9);
  ctx.fillRect(x0 - 3, y + 0.8, x1 - x0 + 6, 1.6);
  ctx.fillStyle = rgba(shadowOf(stone, 0.4), 0.5);
  ctx.fillRect(x0 - 3, y + 7, x1 - x0 + 6, 2);
  inkLine(ctx, () => {
    ctx.beginPath();
    cap();
  }, stone, 0.9, 0.55);
  // a curl of smoke drifting off to the right, very faint
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo((x0 + x1) / 2 + 10, y - 8);
  ctx.bezierCurveTo((x0 + x1) / 2 + 30, y - 40, (x0 + x1) / 2 - 4, y - 70, (x0 + x1) / 2 + 40, y - 110);
  ctx.stroke();
}

/** Sky, the deck, its railing, the chimney and some pots of green. */
export function paintRoof(ctx: Ctx, r: Rect, seed: number): void {
  const deck = FLOORS.roof.floorY;
  ctx.save();
  if (!clipRows(ctx, r, r.y0, ATTIC_TOP)) {
    ctx.restore();
    return;
  }
  // the sky over it, the whole width (the clouds and the sun in it), the deck the bottom of it all: the town is far below
  paintSkyOverRoof(ctx, r, seed);
  // the deck (laid like a floor, in the roof's own room frame)
  ctx.save();
  ctx.beginPath();
  ctx.rect(-6, deck - 60, WORLD_W + 12, DECK_FRONT - deck + 60);
  ctx.clip();
  ctx.translate(0, ROOF_DY);
  paintFloor(ctx, DECK_THEME, -6, WORLD_W + 6, DECK_FRONT - ROOF_DY, seed);
  ctx.restore();
  railing(ctx, -2, WORLD_W + 2, deck, seed);
  bunting(ctx, deck - 48, seed);
  chimney(ctx, seed);
  // pots of green on the deck
  ctx.save();
  ctx.translate(0, ROOF_DY);
  drawDecor(ctx, { type: 'plant', x: 138, y: FLOOR_Y, w: 30 }, THEMES.sunroom, seed + 5);
  drawDecor(ctx, { type: 'plant', x: 244, y: FLOOR_Y, w: 22 }, THEMES.sunroom, seed + 9);
  ctx.restore();
  ctx.restore();
  // the deck's cut edge
  if (r.y1 > DECK_FRONT && r.y0 < ATTIC_TOP) paintCut(ctx, r, DECK_FRONT, ATTIC_TOP);
}

// ---------------------------------------------------------------------------
// The attic

/** The attic: warm boards and old timber under the roof deck. */
export const ATTIC_THEME: Theme = { wall: '#EBD7BB', wallLow: '#D9BD99', trim: '#F5E9D7', floor: '#B78C64', accent: '#C98F5A', cabinet: '#BE916A', pattern: 'plain', dado: 'beadboard' };
const TIMBER = '#9A7354';

/** Cobwebs in a room's two top corners (room frame, the ceiling at y). */
function cobwebs(ctx: Ctx, y: number, size: number, alpha: number): void {
  ctx.strokeStyle = `rgba(240,236,246,${alpha})`;
  ctx.lineWidth = 0.8;
  for (const [cx, dir] of [
    [0, 1],
    [WORLD_W, -1],
  ] as const) {
    ctx.beginPath();
    for (let k = 0; k <= 5; k++) {
      const a = (k / 5) * (Math.PI / 2);
      ctx.moveTo(cx, y);
      ctx.lineTo(cx + dir * Math.cos(a) * size, y + Math.sin(a) * size);
    }
    for (const rr of [size * 0.26, size * 0.52, size * 0.78]) {
      for (let k = 0; k < 5; k++) {
        const a0 = (k / 5) * (Math.PI / 2);
        const a1 = ((k + 1) / 5) * (Math.PI / 2);
        ctx.moveTo(cx + dir * Math.cos(a0) * rr, y + Math.sin(a0) * rr);
        ctx.lineTo(cx + dir * Math.cos(a1) * rr, y + Math.sin(a1) * rr);
      }
    }
    ctx.stroke();
  }
}

/** Board seams up the walls, the deck's joists overhead, and the rafters sloping down into the corners. */
function atticTimber(ctx: Ctx, x0: number, x1: number, seed: number): void {
  ctx.fillStyle = rgba(shadowOf(ATTIC_THEME.wall, 0.35), 0.3);
  for (let x = 17; x < WORLD_W; x += 34) ctx.fillRect(x, 0, 1, FLOOR_Y - 76);
  // the joists overhead
  const band = 16;
  ctx.fillStyle = shadowOf(TIMBER, 0.25);
  ctx.fillRect(x0, -band, x1 - x0, band);
  for (let x = 10; x < WORLD_W; x += 42) {
    ctx.fillStyle = TIMBER;
    ctx.fillRect(x - 6, -band, 12, band + 8);
    ctx.fillStyle = rgba(lightOf(TIMBER, 0.4), 0.55);
    ctx.fillRect(x - 6, -band, 2, band + 8);
    ctx.fillStyle = rgba(shadowOf(TIMBER, 0.5), 0.5);
    ctx.fillRect(x - 6, 7, 12, 1);
  }
  // under the roof's slope, in the corners: dim, with the rafter across
  for (const side of [-1, 1]) {
    const cx = side < 0 ? 0 : WORLD_W;
    const tri = (): void => {
      ctx.beginPath();
      ctx.moveTo(cx, -band);
      ctx.lineTo(cx, RAFTER.drop);
      ctx.lineTo(cx - side * RAFTER.run, -band);
      ctx.closePath();
    };
    ctx.fillStyle = rgba(shadowOf(ATTIC_THEME.wall, 0.55), 0.85);
    tri();
    ctx.fill();
    paintTex(ctx, tri, 'wood', 0.2, 0.3, 0.3, cx, 0);
    // the rafter
    const ax = cx;
    const bx = cx - side * RAFTER.run;
    castShadow(ctx, () => {
      ctx.beginPath();
      ctx.moveTo(ax, RAFTER.drop + 10);
      ctx.lineTo(bx, -band + 10);
      ctx.lineTo(bx + side * 14, -band);
      ctx.lineTo(ax, RAFTER.drop - 8);
      ctx.closePath();
    }, 5, 6, 5, 0.22);
    ctx.strokeStyle = TIMBER;
    ctx.lineWidth = 15;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(ax, RAFTER.drop);
    ctx.lineTo(bx, -band);
    ctx.stroke();
    ctx.strokeStyle = rgba(lightOf(TIMBER, 0.45), 0.65);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(ax + side * 4, RAFTER.drop - 6);
    ctx.lineTo(bx + side * 4, -band - 2);
    ctx.stroke();
    // a peg where it meets the wall
    knob(ctx, ax - side * 1, RAFTER.drop - 8, 2.4, shadowOf(TIMBER, 0.2));
  }
  void seed;
}

/** A round window in the gable end, with the afternoon coming through it. */
function roundWindow(ctx: Ctx, x: number, y: number, r: number, lit: boolean): void {
  const frame = '#8E6A4E';
  softShadow(ctx, x + 5, y + 6, r + 4, r + 4, 0.18);
  ctx.fillStyle = frame;
  ctx.beginPath();
  ctx.arc(x, y, r + 6, 0, TAU);
  ctx.fill();
  const sky = ctx.createLinearGradient(0, y - r, 0, y + r);
  sky.addColorStop(0, lit ? '#A9CBE8' : '#7E8EA8');
  sky.addColorStop(1, lit ? '#F2E1C9' : '#9A97A8');
  ctx.fillStyle = sky;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  if (lit) {
    // a far-off rooftop and a cloud
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y - r * 0.25, r * 0.36, r * 0.13, 0, 0, TAU);
    ctx.ellipse(x - r * 0.05, y - r * 0.34, r * 0.24, r * 0.14, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(160,120,130,0.45)';
    ctx.fillRect(x - r, y + r * 0.45, r * 2, r);
    ctx.restore();
  }
  // the glazing bars
  ctx.strokeStyle = frame;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
  ctx.strokeStyle = rgba(lightOf(frame, 0.6), 0.6);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x, y, r + 4.5, Math.PI * 1.05, Math.PI * 1.6);
  ctx.stroke();
  glint(ctx, x - r * 0.45, y - r * 0.5, 1.4, lit ? 0.85 : 0.4);
}

/** String lights along the joists, glowing (or dark, before it's opened). */
function stringLights(ctx: Ctx, x0: number, x1: number, y: number, lit: boolean, seed: number): void {
  const n = 9;
  const pts: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const x = x0 + (x1 - x0) * u;
    // sagging between the joists it's hooked on
    pts.push([x, y + Math.sin(u * Math.PI * 3) ** 2 * 14 + 2]);
  }
  ctx.strokeStyle = '#5B4A5E';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.stroke();
  const colors = ['#FFD27A', '#FF9F8A', '#9FD7B0', '#A7C4F2', '#F5B8E0'];
  for (let k = 1; k < n * 2; k++) {
    const u = k / (n * 2);
    const x = x0 + (x1 - x0) * u;
    const yy = y + Math.sin(u * Math.PI * 3) ** 2 * 14 + 2;
    const c = colors[Math.floor(hash01(seed, k) * colors.length)];
    if (lit) {
      const g = ctx.createRadialGradient(x, yy + 5, 0, x, yy + 5, 16);
      g.addColorStop(0, rgba(c, 0.45));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - 16, yy - 11, 32, 32);
    }
    ctx.fillStyle = lit ? c : mix(c, '#7E7890', 0.6);
    ctx.beginPath();
    ctx.ellipse(x, yy + 5, 2.6, 3.6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#6E6274';
    ctx.fillRect(x - 1.4, yy, 2.8, 2.4);
  }
}

/** A dust sheet thrown over something (before the attic's opened). */
function dustSheet(ctx: Ctx, x0: number, x1: number, top: number, floor: number, seed: number): void {
  const w = x1 - x0;
  const p = (): void => {
    ctx.beginPath();
    ctx.moveTo(x0 - 6, floor);
    ctx.bezierCurveTo(x0 - 4, floor - (floor - top) * 0.5, x0 + 2, top + 8, x0 + 10, top + 2);
    ctx.quadraticCurveTo(x0 + w / 2, top - 6, x1 - 10, top + 2);
    ctx.bezierCurveTo(x1 - 2, top + 8, x1 + 4, floor - (floor - top) * 0.5, x1 + 6, floor);
    for (let k = 6; k >= 0; k--) ctx.lineTo(x0 - 6 + ((w + 12) * k) / 6, floor - (k % 2) * 3 - hash01(seed, k) * 2);
    ctx.closePath();
  };
  castShadow(ctx, p, 6, 3, 5, 0.2);
  ctx.fillStyle = '#E9E3EC';
  p();
  ctx.fill();
  ctx.save();
  p();
  ctx.clip();
  ctx.strokeStyle = 'rgba(150,140,170,0.35)';
  ctx.lineWidth = 2;
  for (let k = 1; k < 4; k++) {
    const fx = x0 + (w * k) / 4 + (hash01(seed, k + 3) - 0.5) * 10;
    ctx.beginPath();
    ctx.moveTo(fx, top + 10);
    ctx.quadraticCurveTo(fx + 6, (top + floor) / 2, fx - 2, floor);
    ctx.stroke();
  }
  ctx.restore();
  inkLine(ctx, p, '#E9E3EC', 0.8, 0.5);
}

/**
 * The attic, painted in its own room frame (moved up by ATTIC_DY): warm
 * boards under the roof, rafters sloping into the corners, a round window,
 * string lights and a rug. Until it's opened: dust sheets and cobwebs.
 */
export function paintAttic(ctx: Ctx, r: Rect, open: boolean, seed: number): void {
  // the cut down to the living room's ceiling
  if (r.y1 > ATTIC_FLOOR_FRONT && r.y0 < LIVING_CUT) paintCut(ctx, r, ATTIC_FLOOR_FRONT, LIVING_CUT);
  ctx.save();
  if (!clipRows(ctx, r, ATTIC_TOP, ATTIC_FLOOR_FRONT)) {
    ctx.restore();
    return;
  }
  const x0 = Math.max(r.x0, -10);
  const x1 = Math.min(r.x1, WORLD_W + 10);
  ctx.translate(0, ATTIC_DY);
  const ly0 = r.y0 - ATTIC_DY;
  const ly1 = r.y1 - ATTIC_DY;
  drawShell(ctx, ATTIC_THEME, x0, Math.max(ly0, ATTIC_TOP - ATTIC_DY), x1, ly1, seed);
  atticTimber(ctx, x0, x1, seed);
  roundWindow(ctx, 190, 150, 34, open);
  if (open) {
    // the afternoon through the round window, and the lights
    const sg = ctx.createRadialGradient(190, 150, 10, 190, 330, 260);
    sg.addColorStop(0, 'rgba(255,240,205,0.28)');
    sg.addColorStop(1, 'rgba(255,240,205,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(x0, 100, x1 - x0, FLOOR_Y - 100);
    drawDecor(ctx, { type: 'rug', x: 200, y: FLOOR_Y, w: 150 }, ATTIC_THEME, seed + 3);
    drawDecor(ctx, { type: 'picture', x: 66, y: 316, w: 40, h: 48, variant: 1 }, ATTIC_THEME, seed + 5);
    // a lamp hung from the rafter
    drawDecor(ctx, { type: 'pendant', x: 300, y: 216, h: 196 }, ATTIC_THEME, seed + 7);
    stringLights(ctx, RAFTER.run - 30, WORLD_W - RAFTER.run + 30, 4, true, seed);
    cobwebs(ctx, 0, 30, 0.25);
  } else {
    const f = ATTIC_FURNITURE;
    dustSheet(ctx, f.crate.x0, f.crate.x1, f.crate.y, FLOOR_Y, seed + 1);
    dustSheet(ctx, f.cabinet.x0, f.cabinet.x1, f.cabinet.y, FLOOR_Y, seed + 2);
    stringLights(ctx, RAFTER.run - 30, WORLD_W - RAFTER.run + 30, 4, false, seed);
    cobwebs(ctx, 0, 52, 0.45);
  }
  ctx.restore();
}

/** A shut attic is dark and dusty: painted over everything up there, in the front layer. */
export function paintAtticShade(ctx: Ctx, r: Rect): void {
  ctx.save();
  if (!clipRows(ctx, r, ATTIC_TOP, ATTIC_FLOOR_FRONT)) {
    ctx.restore();
    return;
  }
  const x0 = Math.max(r.x0, 0);
  const x1 = Math.min(r.x1, WORLD_W);
  ctx.fillStyle = 'rgba(40,34,62,0.6)';
  ctx.fillRect(x0, ATTIC_TOP, x1 - x0, ATTIC_FLOOR_FRONT - ATTIC_TOP);
  // a little day through the round window
  const wy = ATTIC_DY + 150;
  const lg = ctx.createRadialGradient(190, wy, 0, 190, wy, 170);
  lg.addColorStop(0, 'rgba(200,220,240,0.16)');
  lg.addColorStop(1, 'rgba(200,220,240,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(x0, wy - 170, x1 - x0, 340);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The basement

/** The basement's own decor, laid out in its room frame. */
export const BASEMENT_DECOR: DecorPlacement[] = [
  { type: 'window', x: 236, y: 20, w: 96, h: 70, variant: 0, outlook: 'ground' },
  { type: 'garland', x: 190, y: 8, w: 340 },
  { type: 'picture', x: 150, y: 250, w: 44, h: 36, variant: 2 },
  { type: 'radiator', x: 184, y: FLOOR_Y, w: 70 },
  { type: 'rug', x: 214, y: FLOOR_Y, w: 190 },
  { type: 'plant', x: 360, y: FLOOR_Y, w: 26 },
];

/** Brick showing through the plaster on the upper wall. */
function brickPatches(ctx: Ctx, x0: number, x1: number, seed: number): void {
  const brick = '#C98F72';
  const patches: [number, number, number, number][] = [
    [18, 120, 70, 60],
    [300, 150, 66, 80],
    [196, 340, 54, 40],
  ];
  for (const [px, py, pw, ph] of patches) {
    if (px + pw < x0 || px > x1) continue;
    ctx.save();
    // a ragged hole in the plaster
    ctx.beginPath();
    const n = 14;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const rr = 0.78 + hash01(seed + px, k) * 0.3;
      const xx = px + pw / 2 + Math.cos(a) * (pw / 2) * rr;
      const yy = py + ph / 2 + Math.sin(a) * (ph / 2) * rr;
      if (k === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.closePath();
    ctx.fillStyle = rgba(brick, 0.55);
    ctx.fill();
    ctx.clip();
    for (let row = 0, yy = py - 4; yy < py + ph; row++, yy += 8) {
      const off = row % 2 ? 0 : 9;
      ctx.fillStyle = rgba('#F1E4D2', 0.5);
      ctx.fillRect(px - 10, yy, pw + 20, 1.1);
      for (let xx = px - off; xx < px + pw; xx += 18) {
        ctx.fillRect(xx, yy, 1.1, 8);
        if (hash01(seed + row, Math.round(xx)) < 0.3) {
          ctx.fillStyle = rgba(shadowOf(brick, 0.3), 0.3);
          ctx.fillRect(xx + 1.5, yy + 1.5, 15, 5.5);
          ctx.fillStyle = rgba('#F1E4D2', 0.5);
        }
      }
    }
    ctx.restore();
    ctx.strokeStyle = rgba('#FFF8EE', 0.6);
    ctx.lineWidth = 1;
  }
}

/** The basement ceiling: plaster between dark joists, a copper pipe along it. */
function basementCeiling(ctx: Ctx, x0: number, x1: number, seed: number): void {
  // (in the basement's room frame: the ceiling band is -20..0)
  const band = 20;
  const plaster = '#E2D5C2';
  ctx.fillStyle = plaster;
  ctx.fillRect(x0, -band, x1 - x0, band);
  const lg = ctx.createLinearGradient(0, -band, 0, 0);
  lg.addColorStop(0, rgba(lightOf(plaster, 0.4), 0.5));
  lg.addColorStop(1, rgba(shadowOf(plaster, 0.4), 0.5));
  ctx.fillStyle = lg;
  ctx.fillRect(x0, -band, x1 - x0, band);
  // joists, coming toward us
  const joist = '#8C6E58';
  for (let x = 14; x < WORLD_W; x += 46) {
    const fx = x + (x - WORLD_W / 2) * 0.09;
    ctx.fillStyle = joist;
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(fx + 6, -band);
    ctx.lineTo(fx - 6, -band);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(lightOf(joist, 0.4), 0.5);
    ctx.fillRect(x - 5, -1.5, 10, 1.5);
  }
  // a copper pipe running along under the joists
  const copper = '#C98A5E';
  ctx.strokeStyle = shadowOf(copper, 0.5);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(x0, 6);
  ctx.lineTo(x1, 6);
  ctx.stroke();
  ctx.strokeStyle = copper;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = rgba(lightOf(copper, 0.8), 0.8);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x0, 4.8);
  ctx.lineTo(x1, 4.8);
  ctx.stroke();
  for (let x = 30; x < WORLD_W; x += 92) {
    ctx.fillStyle = '#8E8A96';
    ctx.fillRect(x - 2, 0, 4, 6);
    knob(ctx, x, 6, 3.4, '#A9A3B3');
  }
  void seed;
}

/** Cardboard boxes stacked up in the dark, before the basement's opened. */
function storageBoxes(ctx: Ctx, seed: number): void {
  const floor = FLOOR_Y;
  const stack: [number, number, number, number][] = [
    [40, floor, 74, 52],
    [52, floor - 52, 54, 40],
    [130, floor, 60, 44],
    [262, floor, 90, 58],
    [278, floor - 58, 62, 46],
    [292, floor - 104, 40, 30],
  ];
  for (const [bx, by, bw, bh] of stack) {
    const c = mix('#C9A47A', '#8E7A6E', hash01(seed, bx) * 0.4);
    const p = (): void => {
      ctx.beginPath();
      ctx.rect(bx, by - bh, bw, bh);
    };
    castShadow(ctx, p, 6, 3, 4, 0.2);
    ctx.fillStyle = c;
    p();
    ctx.fill();
    paintTex(ctx, p, 'card', 0.3, 0.4, 0.4, bx, by);
    ctx.fillStyle = rgba(shadowOf(c, 0.4), 0.35);
    ctx.fillRect(bx + bw / 2 - 5, by - bh, 10, bh);
    ctx.fillStyle = rgba(lightOf(c, 0.4), 0.4);
    ctx.fillRect(bx, by - bh, bw, 2);
    inkLine(ctx, p, c, 0.9, 0.6);
  }
  // cobwebs in the top corners
  cobwebs(ctx, 0, 46, 0.45);
  // a bare bulb on its flex, switched off
  ctx.strokeStyle = '#4A4458';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(190, 6);
  ctx.lineTo(190, 70);
  ctx.stroke();
  ctx.fillStyle = '#E8E2D6';
  ctx.beginPath();
  ctx.ellipse(190, 80, 7, 9, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#7E7890';
  ctx.fillRect(186, 68, 8, 5);
}

/**
 * The basement, painted in its own room frame (moved down by BASEMENT_DY):
 * a den with warm walls, brick showing, joists and a copper pipe overhead,
 * a high window letting in a little day, and string lights. Until it's
 * opened it's a dark store room full of boxes.
 */
export function paintBasement(ctx: Ctx, r: Rect, open: boolean, seed: number): void {
  if (r.y1 > ROOM_BOTTOM_LIVING && r.y0 < BASEMENT_CUT + 11) paintCut(ctx, r, ROOM_BOTTOM_LIVING, BASEMENT_CUT + 11, [BASEMENT_CUT]);
  ctx.save();
  if (!clipRows(ctx, r, BASEMENT_CUT + 11, r.y1)) {
    ctx.restore();
    return;
  }
  const x0 = Math.max(r.x0, -10);
  const x1 = Math.min(r.x1, WORLD_W + 10);
  ctx.translate(0, BASEMENT_DY);
  const ly0 = r.y0 - BASEMENT_DY;
  const ly1 = r.y1 - BASEMENT_DY;
  drawShell(ctx, BASEMENT_THEME, x0, Math.max(ly0, -20), x1, ly1, seed);
  brickPatches(ctx, x0, x1, seed);
  basementCeiling(ctx, x0, x1, seed);
  if (open) {
    for (const d of BASEMENT_DECOR) if (d.type === 'rug' || d.type === 'window' || d.type === 'picture' || d.type === 'radiator') drawDecor(ctx, d, BASEMENT_THEME, seed + d.x);
    for (const d of BASEMENT_DECOR) if (!(d.type === 'rug' || d.type === 'window' || d.type === 'picture' || d.type === 'radiator')) drawDecor(ctx, d, BASEMENT_THEME, seed + d.x);
    drawSunbeams(ctx, BASEMENT_DECOR);
  } else storageBoxes(ctx, seed);
  ctx.restore();
}

const ROOM_BOTTOM_LIVING = FLOOR_Y + 44;

/**
 * A shut basement is dark and dusty: painted over everything down there
 * (the chute's glass too), in the front layer, as nobody can be down there.
 */
export function paintBasementShade(ctx: Ctx, r: Rect): void {
  ctx.save();
  if (!clipRows(ctx, r, BASEMENT_CUT + 11, r.y1)) {
    ctx.restore();
    return;
  }
  // (inside the house's side walls, down past the floor's front edge)
  const x0 = Math.max(r.x0, 0);
  const x1 = Math.min(r.x1, WORLD_W);
  ctx.translate(0, BASEMENT_DY);
  ctx.fillStyle = 'rgba(40,34,62,0.62)';
  ctx.fillRect(x0, -20, x1 - x0, r.y1 - BASEMENT_DY + 20);
  // a little light down the chute from the living room
  const lg = ctx.createRadialGradient(FUNNEL.x, 0, 0, FUNNEL.x, 0, 200);
  lg.addColorStop(0, 'rgba(255,214,150,0.12)');
  lg.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(x0, -20, x1 - x0, 260);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The glass tubes

/** The wall of glass round a tube's bore: its centre line offset to either side. */
function offsetLine(pts: readonly [number, number][], d: number): [number, number][] {
  const n = pts.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[Math.max(0, i - 1)];
    const [bx, by] = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    out.push([pts[i][0] - ((by - ay) / l) * d, pts[i][1] + ((bx - ax) / l) * d]);
  }
  return out;
}

/** The runs of a tube between its mouths, as drawn (the hoods' bells and the funnel are drawn on their own). */
function runs(t: Tube): [number, number][][] {
  if (t.id === 'sky') return [[[SKY_HOOD.x, SKY_TOP], [SKY_HOOD.x, SKY_HOOD.y - 22]]];
  if (t.id === 'chute') return [[[FUNNEL.x, FUNNEL.neckY], [SPOUT.x, SPOUT.y - 22]]];
  if (t.id === 'loft') return [[[ATTIC_FUNNEL.x, ATTIC_FUNNEL.neckY], [LOFT_HOOD.x, LOFT_HOOD.y - 22]]];
  // the lift: from the roof's bell, up and over, down through the deck and attic to the living room's bell
  const pts = t.path.slice(1, -1);
  return [[[OUTLET.x, OUTLET.y - 22], ...pts, [HOOD.x, HOOD.y - 22]]];
}

const HALF = 19;

/** The far wall of a run of glass pipe and its soft shadow on the wall behind. */
function pipeBack(ctx: Ctx, pts: [number, number][]): void {
  ctx.save();
  ctx.translate(7, 6);
  ribbonPath(ctx, pts, HALF * 2 + 2);
  ctx.fillStyle = 'rgba(74,64,96,0.09)';
  ctx.fill();
  ctx.restore();
  ribbonPath(ctx, pts, HALF * 2);
  ctx.fillStyle = rgba(mix(GLASS_TINT, shadowOf(GLASS_TINT, 0.5), 0.3), 0.3);
  ctx.fill();
  // the far wall's inner face, darker on the side away from the light
  ctx.strokeStyle = rgba(shadowOf(GLASS_TINT, 0.4), 0.22);
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [i, [x, y]] of offsetLine(pts, HALF - 6).entries()) {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** The near wall of a run: its edges seen edge-on, streaks of light, brass collars where it goes through a floor. */
function pipeFront(ctx: Ctx, pts: [number, number][], collars: number[]): void {
  const wall: GlassPart[] = [];
  for (const side of [-1, 1]) {
    const line = offsetLine(pts, side * (HALF - 2));
    for (let i = 1; i < line.length; i++) wall.push({ k: 'cap', ax: line[i - 1][0], ay: line[i - 1][1], bx: line[i][0], by: line[i][1], r: 2.6 });
  }
  ribbonPath(ctx, pts, HALF * 2);
  ctx.fillStyle = rgba(GLASS_TINT, 0.12);
  ctx.fill();
  glassSolid(ctx, wall, [], GLASS_TINT, { body: 0.32 });
  // a long streak down the lit side
  const lit = offsetLine(pts, -HALF * 0.5);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (const [i, [x, y]] of lit.entries()) {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.setLineDash([60, 26, 14, 30]);
  ctx.stroke();
  ctx.restore();
  for (const cy of collars) {
    const at = pts.reduce((best, p) => (Math.abs(p[1] - cy) < Math.abs(best[1] - cy) ? p : best), pts[0]);
    collar(ctx, at[0], cy, HALF + 4);
  }
}

/** A brass band round a pipe. */
function collar(ctx: Ctx, cx: number, y: number, hw: number): void {
  const p = (): void => roundRect(ctx, cx - hw, y - 3.5, hw * 2, 7, 2.2);
  ctx.fillStyle = BRASS;
  p();
  ctx.fill();
  cylinderShade(ctx, p, cx - hw, cx + hw, BRASS, 0.75, 0.55);
  ctx.fillStyle = rgba(lightOf(BRASS, 0.9), 0.85);
  ctx.fillRect(cx - hw + 2, y - 2.6, hw * 2 - 4, 0.9);
  inkLine(ctx, p, BRASS, 0.8, 0.6);
  for (const s of [-1, 1]) knob(ctx, cx + s * (hw - 3), y, 0.9, lightOf(BRASS, 0.2));
}

/** A suction hood: the pipe flaring into a bell that faces down, its mouth at (x, y). */
function bellPath(ctx: Ctx, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x - HALF, y - 24);
  ctx.bezierCurveTo(x - HALF, y - 10, x - BELL + 1, y - 6, x - BELL - 1, y);
  ctx.lineTo(x + BELL + 1, y);
  ctx.bezierCurveTo(x + BELL - 1, y - 6, x + HALF, y - 10, x + HALF, y - 24);
  ctx.closePath();
}

function bellBack(ctx: Ctx, x: number, y: number): void {
  bellPath(ctx, x, y);
  ctx.fillStyle = rgba(mix(GLASS_TINT, shadowOf(GLASS_TINT, 0.5), 0.4), 0.38);
  ctx.fill();
  // inside the bell, looking up the pipe: a little darker toward the throat
  const g = ctx.createRadialGradient(x, y - 18, 0, x, y - 18, 26);
  g.addColorStop(0, 'rgba(62,58,79,0.22)');
  g.addColorStop(1, 'rgba(62,58,79,0)');
  ctx.fillStyle = g;
  bellPath(ctx, x, y);
  ctx.fill();
  rimLip(ctx, { cx: x, y, rxm: BELL - 1, r: 2.6 }, GLASS_TINT, 'far');
}

function bellFront(ctx: Ctx, x: number, y: number): void {
  const parts: GlassPart[] = [];
  const left: [number, number][] = [
    [x - HALF + 1.5, y - 24],
    [x - HALF - 0.5, y - 12],
    [x - BELL + 3, y - 4],
    [x - BELL, y],
  ];
  for (const side of [-1, 1]) {
    for (let i = 1; i < left.length; i++) {
      parts.push({ k: 'cap', ax: x + (left[i - 1][0] - x) * -side, ay: left[i - 1][1], bx: x + (left[i][0] - x) * -side, by: left[i][1], r: 2.6 });
    }
  }
  glassSolid(ctx, parts, [], GLASS_TINT, { body: 0.34 });
  rimLip(ctx, { cx: x, y, rxm: BELL - 1, r: 2.6 }, GLASS_TINT, 'near');
  // a brass band where the bell meets the pipe
  collar(ctx, x, y - 24, HALF + 3);
  sparkle(ctx, x - 18, y - 6, 3, 0.8);
}

/** A funnel standing in a floor: a wide glass cone narrowing into its pipe. */
function conePath(ctx: Ctx, f: Funnel): void {
  ctx.beginPath();
  ctx.moveTo(f.x - f.rimHw, f.rimY);
  ctx.lineTo(f.x + f.rimHw, f.rimY);
  ctx.lineTo(f.x + f.neckHw, f.neckY);
  ctx.lineTo(f.x + f.neckHw, f.floorY + 2);
  ctx.lineTo(f.x - f.neckHw, f.floorY + 2);
  ctx.lineTo(f.x - f.neckHw, f.neckY);
  ctx.closePath();
}

function funnelRim(ctx: Ctx, f: Funnel, half: 'near' | 'far'): void {
  ctx.save();
  ctx.translate(f.x, f.rimY);
  ctx.scale(1, 0.6);
  rimLip(ctx, { cx: 0, y: 0, rxm: f.rimHw, r: 4 }, GLASS_TINT, half);
  ctx.restore();
}

function funnelBack(ctx: Ctx, f: Funnel): void {
  softShadow(ctx, f.x + 6, f.floorY + 1, f.rimHw * 0.7, 3, 0.25);
  conePath(ctx, f);
  ctx.fillStyle = rgba(mix(GLASS_TINT, shadowOf(GLASS_TINT, 0.5), 0.3), 0.32);
  ctx.fill();
  const dg = ctx.createLinearGradient(0, f.rimY, 0, f.floorY);
  dg.addColorStop(0, rgba(shadowOf(GLASS_TINT, 0.4), 0));
  dg.addColorStop(1, rgba(shadowOf(GLASS_TINT, 0.45), 0.3));
  ctx.fillStyle = dg;
  conePath(ctx, f);
  ctx.fill();
  funnelRim(ctx, f, 'far');
  // looking down the chute: dark
  ctx.fillStyle = 'rgba(46,40,62,0.4)';
  ctx.beginPath();
  ctx.ellipse(f.x, f.floorY + 1, f.neckHw - 2, 3, 0, 0, TAU);
  ctx.fill();
}

function funnelFront(ctx: Ctx, f: Funnel): void {
  conePath(ctx, f);
  ctx.fillStyle = rgba(GLASS_TINT, 0.14);
  ctx.fill();
  const r = 3.5;
  glassSolid(
    ctx,
    [
      { k: 'cap', ax: f.x - f.rimHw, ay: f.rimY, bx: f.x - f.neckHw, by: f.neckY, r },
      { k: 'cap', ax: f.x + f.rimHw, ay: f.rimY, bx: f.x + f.neckHw, by: f.neckY, r },
      { k: 'cap', ax: f.x - f.neckHw, ay: f.neckY, bx: f.x - f.neckHw, by: f.floorY + 2, r },
      { k: 'cap', ax: f.x + f.neckHw, ay: f.neckY, bx: f.x + f.neckHw, by: f.floorY + 2, r },
    ],
    [],
    GLASS_TINT,
    { body: 0.34 },
  );
  funnelRim(ctx, f, 'near');
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(f.x - f.rimHw + 9, f.rimY + 7);
  ctx.lineTo(f.x - f.neckHw - 3, f.neckY - 6);
  ctx.stroke();
  ctx.restore();
  collar(ctx, f.x, f.floorY - 3, f.neckHw + 4);
  sparkle(ctx, f.x - f.rimHw + 12, f.rimY + 4, 4, 0.85);
  glint(ctx, f.x - f.neckHw + 3, f.neckY + 6, 1, 0.8);
}

/** The lid on a funnel while the floor its pipe goes to is shut: a round of wood sitting in the rim (cats can sit on it). */
function funnelLid(ctx: Ctx, f: Funnel): void {
  const x = f.x;
  const top = f.rimY - 7;
  const rx = f.rimHw + 4;
  const ry = 3.2;
  const th = 7;
  const wood = '#B88C62';
  softShadow(ctx, x + 3, f.rimY + 3, rx * 0.9, 3, 0.3);
  const side = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - rx, top);
    ctx.lineTo(x - rx, top + th);
    ctx.ellipse(x, top + th, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(x + rx, top);
    ctx.closePath();
  };
  ctx.fillStyle = shadowOf(wood, 0.18);
  side();
  ctx.fill();
  cylinderShade(ctx, side, x - rx, x + rx, wood, 0.6, 0.5);
  paintTex(ctx, side, 'wood', 0.3, 0.3, 0.5, x, top);
  inkLine(ctx, side, wood, 0.9, 0.6);
  const face = (): void => {
    ctx.beginPath();
    ctx.ellipse(x, top, rx, ry, 0, 0, TAU);
  };
  ctx.fillStyle = lightOf(wood, 0.25);
  face();
  ctx.fill();
  paintTex(ctx, face, 'wood', 0.35, 0.3, 0.5, x, top);
  inkLine(ctx, face, wood, 0.8, 0.55);
  // a little knob to lift it by
  knob(ctx, x - 14, top - 1.5, 2.6, shadowOf(wood, 0.1));
}

/** A steel cap bolted over a hood's mouth while the floor it goes to is shut. */
function hoodCap(ctx: Ctx, x: number, y: number): void {
  const steel = '#B4AFBF';
  const p = (): void => roundRect(ctx, x - BELL - 3, y - 1.5, (BELL + 3) * 2, 6.5, 3);
  castShadow(ctx, p, 1, 3, 3, 0.28);
  ctx.fillStyle = steel;
  p();
  ctx.fill();
  cylinderShade(ctx, p, x - BELL - 3, x + BELL + 3, steel, 0.8, 0.5);
  ctx.fillStyle = rgba(lightOf(steel, 0.9), 0.8);
  ctx.fillRect(x - BELL, y - 0.6, BELL * 2, 1);
  inkLine(ctx, p, steel, 0.8, 0.6);
  for (const s of [-1, 1]) knob(ctx, x + s * (BELL - 1), y + 1.8, 1.3, lightOf(steel, 0.15));
}

/** A brass padlock, hanging with the top of its shackle at (x, y). */
function padlock(ctx: Ctx, x: number, y: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#8A8496';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 3.6, y + 7);
  ctx.lineTo(x - 3.6, y + 4);
  ctx.arc(x, y + 4, 3.6, Math.PI, 0);
  ctx.lineTo(x + 3.6, y + 7);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(x, y + 4, 3.6, Math.PI * 1.1, Math.PI * 1.5);
  ctx.stroke();
  const body = (): void => roundRect(ctx, x - 5.5, y + 6.5, 11, 9.5, 2.4);
  castShadow(ctx, body, 1, 2, 2.5, 0.3);
  ctx.fillStyle = BRASS;
  body();
  ctx.fill();
  cylinderShade(ctx, body, x - 5.5, x + 5.5, BRASS, 0.75, 0.55);
  inkLine(ctx, body, BRASS, 0.8, 0.65);
  ctx.fillStyle = '#5A4630';
  ctx.beginPath();
  ctx.arc(x, y + 10.3, 1.4, 0, TAU);
  ctx.fill();
  ctx.fillRect(x - 0.55, y + 10.3, 1.1, 3);
  ctx.restore();
}

/** Where the roof tube's pipe goes through floors and is clipped to the wall. */
const LIFT_COLLARS = [FLOORS.roof.floorY - 4, FLOORS.attic.ceilY + 6, FLOORS.attic.ceilY + 280, FLOORS.attic.floorY - 4, LIVING_CEIL + 4, LIVING_CEIL + 200, LIVING_CEIL + 400];

/**
 * A tube anywhere (the playground's): a straight run of glass between two
 * hoods, each facing away from the other: its far half (`back`, under the
 * cats) or its near half.
 */
export function paintSkyTube(ctx: Ctx, ax: number, ay: number, bx: number, by: number, layer: 'back' | 'front'): void {
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  // (the pipe runs between the bells' throats, each its height in from its mouth)
  const run: [number, number][] = [
    [ax + ux * 24, ay + uy * 24],
    [bx - ux * 24, by - uy * 24],
  ];
  if (layer === 'back') pipeBack(ctx, run);
  for (const [x, y, fx, fy] of [
    [ax, ay, -ux, -uy],
    [bx, by, ux, uy],
  ]) {
    // (a bell faces down: turned to face this end's way)
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(-fx, fy));
    if (layer === 'back') bellBack(ctx, 0, 0);
    else bellFront(ctx, 0, 0);
    ctx.restore();
  }
  if (layer === 'front') pipeFront(ctx, run, []);
}

/** A sky tube's bell with its mouth at (0, 0) facing down, its throat up at y -24 (the Playground's tubes keep it as a painting, turned each way). */
export function paintSkyBell(ctx: Ctx, layer: 'back' | 'front'): void {
  if (layer === 'back') bellBack(ctx, 0, 0);
  else bellFront(ctx, 0, 0);
}

/**
 * A run of glass pipe along any line, however long and bendy (the
 * Playground's tubes): its far half and its shadow (back), or its near walls
 * seen edge on and a streak of light (front). Painted with strokes along the
 * line, quick enough for every frame. `s0`: how far along its tube the run
 * starts (the streak's dashes stay put on the glass as more of it comes into
 * view).
 */
export function paintPipeRun(ctx: Ctx, pts: [number, number][], layer: 'back' | 'front', s0 = 0): void {
  if (pts.length < 2) return;
  // (smooth through its points: a curve from each stretch's middle to the next, round the point between)
  const line = (p: readonly [number, number][]): void => {
    const n = p.length;
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    ctx.lineTo(p[n - 1][0], p[n - 1][1]);
  };
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  if (layer === 'back') {
    // its soft shadow, and the glass seen through
    ctx.translate(7, 6);
    line(pts);
    ctx.strokeStyle = 'rgba(74,64,96,0.09)';
    ctx.lineWidth = HALF * 2 + 2;
    ctx.stroke();
    ctx.translate(-7, -6);
    line(pts);
    ctx.strokeStyle = rgba(mix(GLASS_TINT, shadowOf(GLASS_TINT, 0.5), 0.3), 0.3);
    ctx.lineWidth = HALF * 2;
    ctx.stroke();
    // the far wall's inner face, darker on the side away from the light
    line(offsetLine(pts, HALF - 6));
    ctx.strokeStyle = rgba(shadowOf(GLASS_TINT, 0.4), 0.22);
    ctx.lineWidth = 6;
    ctx.stroke();
  } else {
    line(pts);
    ctx.strokeStyle = rgba(GLASS_TINT, 0.12);
    ctx.lineWidth = HALF * 2;
    ctx.stroke();
    // the near walls seen edge on: a band of glass each side, deeper inside, bright along its outer edge
    for (const side of [-1, 1]) {
      const wall = offsetLine(pts, side * (HALF - 2));
      line(wall);
      ctx.strokeStyle = rgba(mix(GLASS_TINT, shadowOf(GLASS_TINT, 0.35), 0.5), 0.34);
      ctx.lineWidth = 5.2;
      ctx.stroke();
      ctx.strokeStyle = rgba(shadowOf(GLASS_TINT, 0.55), side < 0 ? 0.3 : 0.45);
      ctx.lineWidth = 2.2;
      ctx.stroke();
      line(offsetLine(pts, side * (HALF + 0.6)));
      ctx.strokeStyle = rgba(shadowOf(GLASS_TINT, 0.65), side < 0 ? 0.4 : 0.55);
      ctx.lineWidth = 2.3;
      ctx.stroke();
      ctx.strokeStyle = side < 0 ? 'rgba(255,255,255,0.95)' : rgba(lightOf(GLASS_TINT, 0.7), 0.8);
      ctx.lineWidth = 1;
      ctx.stroke();
      line(offsetLine(pts, side * (HALF - 4.6)));
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    // a long streak down the lit side
    ctx.lineCap = 'round';
    line(offsetLine(pts, -HALF * 0.5));
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2.4;
    ctx.setLineDash([60, 26, 14, 30]);
    ctx.lineDashOffset = s0;
    ctx.stroke();
  }
  ctx.restore();
}

/** A tube's far half, the hoods' insides and the funnel's back (with its lid, while it's capped): under the cats. */
export function paintTubeBack(ctx: Ctx, t: Tube, capped = false): void {
  for (const run of runs(t)) pipeBack(ctx, run);
  if (t.id === 'sky') bellBack(ctx, SKY_HOOD.x, SKY_HOOD.y);
  else if (t.id === 'chute' || t.id === 'loft') {
    const f = t.id === 'chute' ? FUNNEL : ATTIC_FUNNEL;
    funnelBack(ctx, f);
    if (capped) funnelLid(ctx, f);
    const m = t.id === 'chute' ? SPOUT : LOFT_HOOD;
    bellBack(ctx, m.x, m.y);
  } else {
    bellBack(ctx, HOOD.x, HOOD.y);
    bellBack(ctx, OUTLET.x, OUTLET.y);
  }
}

/** A tube's near half: over a cat going through it (and while it's capped, the caps and padlocks). */
export function paintTubeFront(ctx: Ctx, t: Tube, capped = false): void {
  if (t.id === 'sky') {
    pipeFront(ctx, runs(t)[0], [SKY_HOOD.y - 120]);
    bellFront(ctx, SKY_HOOD.x, SKY_HOOD.y);
    if (capped) {
      hoodCap(ctx, SKY_HOOD.x, SKY_HOOD.y);
      padlock(ctx, SKY_HOOD.x + 17, SKY_HOOD.y - 21);
    }
  } else if (t.id === 'chute' || t.id === 'loft') {
    const f = t.id === 'chute' ? FUNNEL : ATTIC_FUNNEL;
    const m = t.id === 'chute' ? SPOUT : LOFT_HOOD;
    pipeFront(ctx, runs(t)[0], t.id === 'chute' ? [FLOOR_Y + 30, BASEMENT_DY + 8] : [ATTIC_FUNNEL.floorY + 30, LIVING_CEIL + 8]);
    funnelFront(ctx, f);
    bellFront(ctx, m.x, m.y);
    if (capped) {
      padlock(ctx, f.x + 17, f.rimY - 1);
      hoodCap(ctx, m.x, m.y);
      padlock(ctx, m.x + 17, m.y - 21);
    }
  } else {
    pipeFront(ctx, runs(t)[0], LIFT_COLLARS);
    bellFront(ctx, HOOD.x, HOOD.y);
    bellFront(ctx, OUTLET.x, OUTLET.y);
    if (capped) {
      for (const m of [HOOD, OUTLET]) {
        hoodCap(ctx, m.x, m.y);
        padlock(ctx, m.x + 17, m.y - 21);
      }
    }
  }
}
