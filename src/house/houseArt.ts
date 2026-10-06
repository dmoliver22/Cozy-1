// The tall house's own art (painted into the renderer's cached tiles): the
// roof garden up in the sky, the attic between it and the living room, the
// basement den under the living room (dusty and dark until it's opened), the
// cut edges between the floors, and the two glass tubes that join them, with
// a funnel in the living room floor and suction hoods at the other ends.

import { FLOOR_Y, WORLD_W } from '../game/props';
import type { DecorPlacement } from '../game/room';
import { glint, hash01, lightOf, mix, rgba, roundRect, shadowOf, softShadow, type Ctx } from '../render/paint';
import { glassSolid, rimLip, ribbonPath, sparkle, type GlassPart } from '../render/propKit';
import { THEMES, drawDecor, drawShell, drawSunbeams, paintFloor, type Theme } from '../render/roomArt';
import { castShadow, cylinderShade, inkLine, knob, paintTex } from '../render/roomKit';
import { HATCH } from './homeArt';
import {
  ATTIC_TOP,
  BASEMENT_CUT,
  BELL,
  BASEMENT_DY,
  CHIMNEY,
  DECK_FRONT,
  FLOORS,
  FUNNEL,
  HOOD,
  LIVING_CUT,
  OUTLET,
  ROOF_DY,
  SPOUT,
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
const ATTIC = '#4A3F55';
const ATTIC_LIT = '#E9B477';

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

/** Puffy afternoon cloud: overlapping rounds, lit on top, a lilac shade underneath. */
function cloud(ctx: Ctx, x: number, y: number, s: number, seed: number): void {
  const puffs: [number, number, number][] = [];
  const n = 5;
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1) - 0.5;
    puffs.push([x + u * 70 * s, y - (1 - Math.abs(u) * 1.6) * 10 * s + hash01(seed, k) * 4 * s, (14 + (1 - Math.abs(u) * 1.5) * 12 + hash01(seed, k + 9) * 5) * s]);
  }
  const path = (): void => {
    ctx.beginPath();
    for (const [px, py, pr] of puffs) {
      ctx.moveTo(px + pr, py);
      ctx.arc(px, py, pr, 0, TAU);
    }
    ctx.rect(x - 38 * s, y - 2 * s, 76 * s, 12 * s);
  };
  ctx.save();
  ctx.fillStyle = 'rgba(255,253,248,0.92)';
  path();
  ctx.fill();
  ctx.clip();
  const g = ctx.createLinearGradient(0, y - 30 * s, 0, y + 12 * s);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(206,196,226,0.05)');
  g.addColorStop(1, 'rgba(176,164,206,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 80 * s, y - 40 * s, 160 * s, 60 * s);
  ctx.restore();
}

/** Neighbours' roofs and trees along the horizon, soft with distance. */
function skyline(ctx: Ctx, x0: number, x1: number, base: number, seed: number): void {
  // far row: pale lilac roofs and round trees
  const far = '#C9C3DD';
  const near = '#B4ADCF';
  for (const [color, scale, offset, rows] of [
    [far, 0.75, 0, 1],
    [near, 1, 37, 0],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    let x = x0 - 30 - offset;
    let k = 0;
    while (x < x1 + 30) {
      const w = (48 + hash01(seed + rows, k) * 46) * scale;
      const h = (34 + hash01(seed + rows, k + 50) * 48) * scale;
      const kind = hash01(seed + rows, k + 100);
      if (kind < 0.62) {
        // a gabled house with a chimney
        ctx.moveTo(x, base);
        ctx.lineTo(x, base - h);
        ctx.lineTo(x + w / 2, base - h - w * 0.36);
        ctx.lineTo(x + w, base - h);
        ctx.lineTo(x + w, base);
        ctx.rect(x + w * 0.68, base - h - w * 0.3, 7 * scale, w * 0.22);
      } else if (kind < 0.8) {
        // a round tree
        const r = w * 0.32;
        ctx.moveTo(x + w / 2 + r, base - h * 0.6);
        ctx.arc(x + w / 2, base - h * 0.6, r, 0, TAU);
        ctx.rect(x + w / 2 - 2, base - h * 0.6, 4, h * 0.6);
      } else {
        // a church spire, far off
        ctx.moveTo(x + w * 0.3, base);
        ctx.lineTo(x + w * 0.3, base - h * 1.2);
        ctx.lineTo(x + w * 0.5, base - h * 2.1);
        ctx.lineTo(x + w * 0.7, base - h * 1.2);
        ctx.lineTo(x + w * 0.7, base);
      }
      ctx.closePath();
      x += w + 6 * scale;
      k++;
    }
    ctx.fill();
    // a few lit windows
    ctx.fillStyle = rgba('#FFF4DA', rows ? 0.35 : 0.5);
    for (let j = 0; j < 9; j++) ctx.fillRect(x0 + hash01(seed, j + 200) * (x1 - x0), base - 10 - hash01(seed, j + 300) * 40 * scale, 3 * scale, 4 * scale);
  }
}

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

/** Sky, distant rooftops, the deck, its railing, the chimney and some pots of green. */
export function paintRoof(ctx: Ctx, r: Rect, seed: number): void {
  const deck = FLOORS.roof.floorY;
  ctx.save();
  if (!clipRows(ctx, r, r.y0, ATTIC_TOP)) {
    ctx.restore();
    return;
  }
  // the sky (over the whole width: on wide screens the garden is out in the open)
  const g = ctx.createLinearGradient(0, FLOORS.roof.view0, 0, deck);
  g.addColorStop(0, '#9EC3E3');
  g.addColorStop(0.5, '#C6DDEF');
  g.addColorStop(0.85, '#F3E4D3');
  g.addColorStop(1, '#F7D7B8');
  ctx.fillStyle = g;
  ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, deck - r.y0 + 1);
  // the sun, up to the left, and its warmth
  const sx = 64;
  const sy = deck - 418;
  const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 220);
  sg.addColorStop(0, 'rgba(255,246,214,0.95)');
  sg.addColorStop(0.08, 'rgba(255,240,200,0.85)');
  sg.addColorStop(0.1, 'rgba(255,236,196,0.5)');
  sg.addColorStop(0.45, 'rgba(255,226,180,0.16)');
  sg.addColorStop(1, 'rgba(255,226,180,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(sx - 220, sy - 220, 440, 440);
  cloud(ctx, 268, deck - 470, 1.05, seed);
  cloud(ctx, 150, deck - 330, 0.7, seed + 3);
  cloud(ctx, 330, deck - 250, 0.55, seed + 7);
  cloud(ctx, -20, deck - 230, 0.8, seed + 11);
  skyline(ctx, r.x0, r.x1, deck - 40, seed);
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

/** The attic, seen through the cut: dim boards, a beam and posts, boxes, the hatch's warm glow. */
export function paintAttic(ctx: Ctx, r: Rect, seed: number): void {
  ctx.save();
  if (!clipRows(ctx, r, ATTIC_TOP, LIVING_CUT)) {
    ctx.restore();
    return;
  }
  const x0 = Math.max(r.x0, -10);
  const x1 = Math.min(r.x1, WORLD_W + 10);
  ctx.fillStyle = ATTIC;
  ctx.fillRect(x0, ATTIC_TOP, x1 - x0, LIVING_CUT - ATTIC_TOP);
  ctx.fillStyle = rgba(shadowOf(ATTIC, 0.4), 0.5);
  for (let x = Math.floor(x0 / 26) * 26; x < x1; x += 26) ctx.fillRect(x, ATTIC_TOP, 1, LIVING_CUT - ATTIC_TOP);
  // a little round vent letting in the day
  const vx = 40;
  const vy = (ATTIC_TOP + LIVING_CUT) / 2 - 4;
  const vg = ctx.createRadialGradient(vx, vy, 0, vx, vy, 60);
  vg.addColorStop(0, 'rgba(200,222,240,0.35)');
  vg.addColorStop(1, 'rgba(200,222,240,0)');
  ctx.fillStyle = vg;
  ctx.fillRect(vx - 60, vy - 60, 120, 120);
  ctx.fillStyle = '#BFD7EA';
  ctx.beginPath();
  ctx.arc(vx, vy, 13, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#6E5E78';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let k = -1; k <= 1; k++) {
    ctx.moveTo(vx - 12, vy + k * 5);
    ctx.lineTo(vx + 12, vy + k * 5);
  }
  ctx.stroke();
  // the beam under the deck, and posts
  const beam = '#5F5068';
  ctx.fillStyle = beam;
  ctx.fillRect(x0, ATTIC_TOP, x1 - x0, 9);
  ctx.fillStyle = rgba(lightOf(beam, 0.3), 0.5);
  ctx.fillRect(x0, ATTIC_TOP + 9, x1 - x0, 1);
  for (const px of [128, 248]) {
    ctx.fillStyle = beam;
    ctx.fillRect(px - 5, ATTIC_TOP + 9, 10, LIVING_CUT - ATTIC_TOP - 9);
    ctx.fillStyle = rgba(lightOf(beam, 0.25), 0.45);
    ctx.fillRect(px - 5, ATTIC_TOP + 9, 2, LIVING_CUT - ATTIC_TOP - 9);
    // braces
    ctx.strokeStyle = beam;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(px - 30, ATTIC_TOP + 9);
    ctx.lineTo(px - 4, ATTIC_TOP + 34);
    ctx.moveTo(px + 30, ATTIC_TOP + 9);
    ctx.lineTo(px + 4, ATTIC_TOP + 34);
    ctx.stroke();
  }
  // boxes and a trunk, keeping out of the hatch's way
  const floor = LIVING_CUT;
  const boxes: [number, number, number, string][] = [
    [72, 40, 30, '#B9946E'],
    [100, 26, 20, '#C9A47A'],
    [176, 46, 26, '#A9876A'],
    [204, 30, 36, '#7E6A86'],
  ];
  for (const [bx, bw, bh, c] of boxes) {
    const p = (): void => roundRect(ctx, bx, floor - bh, bw, bh, 1.5);
    ctx.fillStyle = mix(c, ATTIC, 0.45);
    ctx.beginPath();
    p();
    ctx.fill();
    ctx.fillStyle = rgba(lightOf(c, 0.3), 0.25);
    ctx.fillRect(bx + 1, floor - bh + 1, bw - 2, 2);
    ctx.fillStyle = rgba(shadowOf(c, 0.5), 0.35);
    ctx.fillRect(bx + bw / 2 - 1, floor - bh, 2, bh);
  }
  // the hatch's lamplight, spilling up from the living room
  const hx = (HATCH.x0 + HATCH.x1) / 2;
  const hg = ctx.createRadialGradient(hx, floor, 0, hx, floor, 110);
  hg.addColorStop(0, rgba(ATTIC_LIT, 0.55));
  hg.addColorStop(1, rgba(ATTIC_LIT, 0));
  ctx.fillStyle = hg;
  ctx.fillRect(hx - 110, floor - 110, 220, 110);
  // a cobweb in the corner
  ctx.strokeStyle = 'rgba(230,226,240,0.35)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (let k = 0; k <= 4; k++) {
    const a = (k / 4) * (Math.PI / 2);
    ctx.moveTo(WORLD_W, ATTIC_TOP + 9);
    ctx.lineTo(WORLD_W - Math.cos(a) * 28, ATTIC_TOP + 9 + Math.sin(a) * 28);
  }
  for (const rr of [9, 17, 25]) ctx.arc(WORLD_W, ATTIC_TOP + 9, rr, Math.PI / 2, Math.PI);
  ctx.stroke();
  // light falls off toward the corners
  const sh = ctx.createLinearGradient(0, ATTIC_TOP, 0, LIVING_CUT);
  sh.addColorStop(0, 'rgba(30,24,44,0.35)');
  sh.addColorStop(1, 'rgba(30,24,44,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(x0, ATTIC_TOP, x1 - x0, LIVING_CUT - ATTIC_TOP);
  void seed;
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The basement

/** The basement's own decor, laid out in its room frame. */
export const BASEMENT_DECOR: DecorPlacement[] = [
  { type: 'window', x: 236, y: 20, w: 96, h: 70, variant: 0 },
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
  ctx.strokeStyle = 'rgba(240,236,246,0.45)';
  ctx.lineWidth = 0.8;
  for (const [cx, dir] of [
    [0, 1],
    [WORLD_W, -1],
  ] as const) {
    ctx.beginPath();
    for (let k = 0; k <= 5; k++) {
      const a = (k / 5) * (Math.PI / 2);
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx + dir * Math.cos(a) * 46, Math.sin(a) * 46);
    }
    for (const rr of [12, 24, 36]) {
      for (let k = 0; k < 5; k++) {
        const a0 = (k / 5) * (Math.PI / 2);
        const a1 = ((k + 1) / 5) * (Math.PI / 2);
        ctx.moveTo(cx + dir * Math.cos(a0) * rr, Math.sin(a0) * rr);
        ctx.lineTo(cx + dir * Math.cos(a1) * rr, Math.sin(a1) * rr);
      }
    }
    ctx.stroke();
  }
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
  } else {
    storageBoxes(ctx, seed);
    // dark and dusty
    ctx.fillStyle = 'rgba(40,34,62,0.62)';
    ctx.fillRect(x0, -20, x1 - x0, FLOOR_Y + 60);
    const lg = ctx.createRadialGradient(FUNNEL.x, 0, 0, FUNNEL.x, 0, 200);
    lg.addColorStop(0, 'rgba(255,214,150,0.12)');
    lg.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(x0, -20, x1 - x0, 260);
  }
  ctx.restore();
}

const ROOM_BOTTOM_LIVING = FLOOR_Y + 44;

/** The living room's floor where the basement isn't open yet: a trapdoor, bolted. */
export function paintTrapdoor(ctx: Ctx): void {
  const x = FUNNEL.x;
  const y0 = FLOOR_Y + 6;
  const y1 = FLOOR_Y + 32;
  const w0 = 66;
  const w1 = 76;
  const wood = '#9C7A5C';
  const p = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - w0 / 2, y0);
    ctx.lineTo(x + w0 / 2, y0);
    ctx.lineTo(x + w1 / 2, y1);
    ctx.lineTo(x - w1 / 2, y1);
    ctx.closePath();
  };
  ctx.save();
  ctx.fillStyle = wood;
  p();
  ctx.fill();
  paintTex(ctx, p, 'wood', 0.35, 0.3, 0.6, x, y0);
  ctx.strokeStyle = rgba(shadowOf(wood, 0.6), 0.6);
  ctx.lineWidth = 1;
  for (let k = 1; k < 4; k++) {
    const u = k / 4;
    ctx.beginPath();
    ctx.moveTo(x - w0 / 2 + w0 * u, y0);
    ctx.lineTo(x - w1 / 2 + w1 * u, y1);
    ctx.stroke();
  }
  inkLine(ctx, p, wood, 1, 0.7);
  // an iron ring and a little padlock
  ctx.strokeStyle = '#5E5468';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(x + 18, (y0 + y1) / 2, 5, 3, 0, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = '#D9B45E';
  roundRect(ctx, x - 6, (y0 + y1) / 2 - 3, 9, 8, 1.5);
  ctx.fill();
  ctx.strokeStyle = '#8C6E3C';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x - 1.5, (y0 + y1) / 2 - 3, 3, Math.PI, 0);
  ctx.stroke();
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
  if (t.id === 'chute') return [[[FUNNEL.x, FUNNEL.neckY], [SPOUT.x, SPOUT.y - 22]]];
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

/** The funnel in the living room floor: a wide glass cone narrowing into the chute. */
function conePath(ctx: Ctx): void {
  const f = FUNNEL;
  ctx.beginPath();
  ctx.moveTo(f.x - f.rimHw, f.rimY);
  ctx.lineTo(f.x + f.rimHw, f.rimY);
  ctx.lineTo(f.x + f.neckHw, f.neckY);
  ctx.lineTo(f.x + f.neckHw, FLOOR_Y + 2);
  ctx.lineTo(f.x - f.neckHw, FLOOR_Y + 2);
  ctx.lineTo(f.x - f.neckHw, f.neckY);
  ctx.closePath();
}

function funnelRim(ctx: Ctx, half: 'near' | 'far'): void {
  const f = FUNNEL;
  ctx.save();
  ctx.translate(f.x, f.rimY);
  ctx.scale(1, 0.6);
  rimLip(ctx, { cx: 0, y: 0, rxm: f.rimHw, r: 4 }, GLASS_TINT, half);
  ctx.restore();
}

function funnelBack(ctx: Ctx): void {
  const f = FUNNEL;
  softShadow(ctx, f.x + 6, FLOOR_Y + 1, f.rimHw * 0.7, 3, 0.25);
  conePath(ctx);
  ctx.fillStyle = rgba(mix(GLASS_TINT, shadowOf(GLASS_TINT, 0.5), 0.3), 0.32);
  ctx.fill();
  const dg = ctx.createLinearGradient(0, f.rimY, 0, FLOOR_Y);
  dg.addColorStop(0, rgba(shadowOf(GLASS_TINT, 0.4), 0));
  dg.addColorStop(1, rgba(shadowOf(GLASS_TINT, 0.45), 0.3));
  ctx.fillStyle = dg;
  conePath(ctx);
  ctx.fill();
  funnelRim(ctx, 'far');
  // looking down the chute: dark
  ctx.fillStyle = 'rgba(46,40,62,0.4)';
  ctx.beginPath();
  ctx.ellipse(f.x, FLOOR_Y + 1, f.neckHw - 2, 3, 0, 0, TAU);
  ctx.fill();
}

function funnelFront(ctx: Ctx): void {
  const f = FUNNEL;
  conePath(ctx);
  ctx.fillStyle = rgba(GLASS_TINT, 0.14);
  ctx.fill();
  const r = 3.5;
  glassSolid(
    ctx,
    [
      { k: 'cap', ax: f.x - f.rimHw, ay: f.rimY, bx: f.x - f.neckHw, by: f.neckY, r },
      { k: 'cap', ax: f.x + f.rimHw, ay: f.rimY, bx: f.x + f.neckHw, by: f.neckY, r },
      { k: 'cap', ax: f.x - f.neckHw, ay: f.neckY, bx: f.x - f.neckHw, by: FLOOR_Y + 2, r },
      { k: 'cap', ax: f.x + f.neckHw, ay: f.neckY, bx: f.x + f.neckHw, by: FLOOR_Y + 2, r },
    ],
    [],
    GLASS_TINT,
    { body: 0.34 },
  );
  funnelRim(ctx, 'near');
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(f.x - f.rimHw + 9, f.rimY + 7);
  ctx.lineTo(f.x - f.neckHw - 3, f.neckY - 6);
  ctx.stroke();
  ctx.restore();
  collar(ctx, f.x, FLOOR_Y - 3, f.neckHw + 4);
  sparkle(ctx, f.x - f.rimHw + 12, f.rimY + 4, 4, 0.85);
  glint(ctx, f.x - f.neckHw + 3, f.neckY + 6, 1, 0.8);
}

/** A tube's far half, the hoods' insides and the funnel's back: under the cats. */
export function paintTubeBack(ctx: Ctx, t: Tube): void {
  for (const run of runs(t)) pipeBack(ctx, run);
  if (t.id === 'chute') {
    funnelBack(ctx);
    bellBack(ctx, SPOUT.x, SPOUT.y);
  } else {
    bellBack(ctx, HOOD.x, HOOD.y);
    bellBack(ctx, OUTLET.x, OUTLET.y);
  }
}

/** A tube's near half: over a cat going through it. */
export function paintTubeFront(ctx: Ctx, t: Tube): void {
  if (t.id === 'chute') {
    pipeFront(ctx, runs(t)[0], [FLOOR_Y + 30, BASEMENT_DY + 8]);
    funnelFront(ctx);
    bellFront(ctx, SPOUT.x, SPOUT.y);
  } else {
    pipeFront(ctx, runs(t)[0], [FLOORS.roof.floorY - 4, 8]);
    bellFront(ctx, HOOD.x, HOOD.y);
    bellFront(ctx, OUTLET.x, OUTLET.y);
  }
}
