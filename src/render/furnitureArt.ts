// Painted furniture: shelves, counters, stools, tables, fridges, cabinets,
// bookcases, crates, sills and ramps. Furniture lives in the cached back layer
// (and is drawn live while dragged in the sandbox, so each piece stays cheap).
// Every top surface sits exactly on its collision shape in buildFurniture.

import type { FurnitureType, Prop } from '../game/props';
import { FLOOR_Y, WORLD_W } from '../game/props';
import { PALETTE, contactShadow, glint, hash01, lightOf, lineOf, mix, rgba, roundRect, shadowOf, specular, type Ctx } from './paint';
import { castShadow, cylinderShade, inkLine, jit, knob, paintTex, pick, sideShadow, type PathFn } from './roomKit';

const WOOD = PALETTE.oak;
const WALNUT = '#A9805F';
const BRASS = '#CFAA6A';

interface FurnitureTheme {
  accent: string;
  cabinet: string;
  trim?: string;
  floor?: string;
  pattern?: string;
}

export function drawFurniture(ctx: Ctx, p: Prop, theme: FurnitureTheme): void {
  const t = p.type as FurnitureType;
  const seed = p.uid * 7 + Math.round(p.x0) * 3;
  ctx.save();
  switch (t) {
    case 'shelf':
      shelf(ctx, p.x0, p.x1, p.y, seed);
      break;
    case 'sill':
      sill(ctx, p.x0, p.x1, p.y, theme.trim ?? '#FBF6EE', seed);
      break;
    case 'counter':
      counter(ctx, p.x0 + 6, p.x1 - 6, p.y, theme, seed);
      break;
    case 'table':
      table(ctx, p.x0, p.x1, p.y, seed);
      break;
    case 'stool':
      stool(ctx, p.x0, p.x1, p.y, theme.accent, seed);
      break;
    case 'fridge':
      fridge(ctx, p.x0, p.x1, p.y, theme, seed);
      break;
    case 'cabinet':
      cabinet(ctx, p.x0, p.x1, p.y, theme.cabinet, seed);
      break;
    case 'bookcase':
      bookcase(ctx, p.x0, p.x1, p.y, seed);
      break;
    case 'crate':
      crate(ctx, p.x0, p.x1, p.y, seed);
      break;
    case 'ramp':
      if (p.ramp) ramp(ctx, p.ramp.ax, p.ramp.ay, p.ramp.bx, p.ramp.by, seed);
      break;
  }
  ctx.restore();
}

// --- Shared bits -------------------------------------------------------------

/** Painted wood: grain, a sunlit top face, a crisp arris, deeper underside. */
function plank(ctx: Ctx, x: number, y: number, w: number, h: number, base: string, seed: number, r = Math.min(3.5, h / 3), top = Math.min(3.4, h * 0.3), grain = 0.55): void {
  const path = (): void => roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = base;
  path();
  ctx.fill();
  paintTex(ctx, path, 'wood', grain, 0.42, Math.min(0.3, 0.1 + h * 0.012), x - hash01(seed, 11) * 160, y - hash01(seed, 12) * 160);
  // underside deeper, then the lit top face and its arris
  const g = ctx.createLinearGradient(0, y + top, 0, y + h);
  g.addColorStop(0, rgba(lightOf(base, 0.4), 0.18));
  g.addColorStop(0.55, rgba(base, 0));
  g.addColorStop(1, rgba(shadowOf(base, 0.65), 0.55));
  ctx.fillStyle = g;
  path();
  ctx.fill();
  if (top > 0) {
    // the top face is its own little rounded strip: no clip needed
    ctx.fillStyle = rgba(lightOf(base, 0.55), 0.7);
    roundRect(ctx, x, y, w, top + r * 0.3, [r, r, 0, 0]);
    ctx.fill();
    ctx.fillStyle = rgba(lightOf(base, 0.9), 0.75);
    ctx.fillRect(x + r * 0.5, y + top - 0.45, w - r, 0.9);
  }
  // soft ends: lit on the left, turning away on the right
  ctx.fillStyle = rgba(lightOf(base, 0.6), 0.3);
  ctx.fillRect(x + 0.6, y + top + 0.5, 1.4, h - top - 1.5);
  ctx.fillStyle = rgba(shadowOf(base, 0.6), 0.35);
  ctx.fillRect(x + w - 2.2, y + top + 0.5, 1.6, h - top - 1.2);
  inkLine(ctx, path, base, 1.1, 0.72);
}

/** A bevelled panel (door, drawer front): lit top/left lip, shaded bottom/right. */
function panel(ctx: Ctx, x: number, y: number, w: number, h: number, base: string, bev = 2.4, inset = false, r = 2): void {
  const path = (): void => roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = base;
  path();
  ctx.fill();
  const hi = rgba(lightOf(base, 0.75), 0.8);
  const lo = rgba(shadowOf(base, 0.5), 0.45);
  ctx.fillStyle = inset ? lo : hi;
  ctx.beginPath();
  ctx.moveTo(x + 0.6, y + 0.6);
  ctx.lineTo(x + w - 0.6, y + 0.6);
  ctx.lineTo(x + w - bev, y + bev);
  ctx.lineTo(x + bev, y + bev);
  ctx.lineTo(x + bev, y + h - bev);
  ctx.lineTo(x + 0.6, y + h - 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = inset ? hi : lo;
  ctx.beginPath();
  ctx.moveTo(x + w - 0.6, y + 0.6);
  ctx.lineTo(x + w - 0.6, y + h - 0.6);
  ctx.lineTo(x + 0.6, y + h - 0.6);
  ctx.lineTo(x + bev, y + h - bev);
  ctx.lineTo(x + w - bev, y + h - bev);
  ctx.lineTo(x + w - bev, y + bev);
  ctx.closePath();
  ctx.fill();
  inkLine(ctx, path, base, 0.9, 0.55);
}

/** Painted carcass shading: light from the upper left, deeper toward the floor. */
function carcassLight(ctx: Ctx, path: PathFn, x0: number, x1: number, y0: number, y1: number, base: string): void {
  const g = ctx.createLinearGradient(x0, y0, x1 + (y1 - y0) * 0.25, y1);
  g.addColorStop(0, rgba(lightOf(base, 0.6), 0.32));
  g.addColorStop(0.45, rgba(base, 0));
  g.addColorStop(1, rgba(shadowOf(base, 0.6), 0.32));
  ctx.fillStyle = g;
  path();
  ctx.fill();
}

/** A brass cup pull. */
function cupPull(ctx: Ctx, x: number, y: number, w: number): void {
  ctx.fillStyle = rgba(shadowOf(BRASS, 0.8), 0.3);
  ctx.beginPath();
  ctx.ellipse(x + 0.6, y + 1.6, w / 2 + 0.4, 2.4, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = BRASS;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x, y + 4.4, x + w / 2, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(BRASS, 0.9), 0.85);
  ctx.fillRect(x - w / 2 + 0.6, y - 0.5, w - 1.2, 0.9);
  ctx.strokeStyle = rgba(lineOf(BRASS), 0.6);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x, y + 4.4, x + w / 2, y);
  ctx.stroke();
  glint(ctx, x - w * 0.22, y + 1.3, 0.55, 0.8);
}

/** Soft shadow on the wall to the right of a tall piece standing against it. */
function wallShadow(ctx: Ctx, x1: number, y: number, depth: number, alpha = 0.24): void {
  sideShadow(ctx, x1, y, FLOOR_Y, depth, alpha);
}

// --- Pieces --------------------------------------------------------------------

function shelf(ctx: Ctx, x0: number, x1: number, y: number, seed: number): void {
  const brackets = [x0 + 17, x1 - 17].filter((bx) => bx > 6 && bx < WORLD_W - 6);
  const corbel = (bx: number): void => {
    ctx.moveTo(bx - 3, y + 11);
    ctx.lineTo(bx + 9, y + 11);
    ctx.bezierCurveTo(bx + 8, y + 17, bx + 1, y + 19, bx + 0.5, y + 27);
    ctx.bezierCurveTo(bx + 0.5, y + 30, bx - 3, y + 30.5, bx - 3, y + 28);
    ctx.closePath();
  };
  // shadow on the wall from plank and brackets
  castShadow(ctx, () => {
    ctx.beginPath();
    ctx.rect(x0, y + 2, x1 - x0, 10);
    for (const bx of brackets) corbel(bx);
  }, 3, 7, 5, 0.3);
  const bc = shadowOf(WOOD, 0.22);
  for (const bx of brackets) {
    const path = (): void => {
      ctx.beginPath();
      corbel(bx);
    };
    ctx.fillStyle = bc;
    path();
    ctx.fill();
    paintTex(ctx, path, 'wood', 0.45, 0.3, 0.3, bx, y);
    ctx.fillStyle = rgba(lightOf(bc, 0.6), 0.55);
    ctx.fillRect(bx - 2.6, y + 12, 1.3, 15);
    inkLine(ctx, path, bc, 1, 0.7);
    knob(ctx, bx - 0.8, y + 22, 0.9, '#A99582');
  }
  plank(ctx, x0, y, x1 - x0, 12, WOOD, seed);
}

function sill(ctx: Ctx, x0: number, x1: number, y: number, trim: string, seed: number): void {
  const w = x1 - x0;
  // apron board under the sill, and the sill's shadow on the wall
  const apron = (): void => roundRect(ctx, x0 + 7, y + 9, w - 14, 6, 1.5);
  castShadow(ctx, () => {
    ctx.beginPath();
    ctx.rect(x0, y + 2, w, 8);
    ctx.rect(x0 + 7, y + 9, w - 14, 6);
  }, 2, 4.5, 4, 0.28);
  ctx.fillStyle = shadowOf(trim, 0.12);
  apron();
  ctx.fill();
  ctx.fillStyle = rgba(shadowOf(trim, 0.45), 0.45);
  ctx.fillRect(x0 + 7.5, y + 12.6, w - 15, 2);
  inkLine(ctx, apron, trim, 0.8, 0.5);
  // the sill board: painted wood with a rounded nose
  const path = (): void => roundRect(ctx, x0, y, w, 10, 3);
  ctx.fillStyle = trim;
  path();
  ctx.fill();
  paintTex(ctx, path, 'wood', 0.18, 0.45, 0.2, x0 + hash01(seed, 1) * 90, y);
  const g = ctx.createLinearGradient(0, y, 0, y + 10);
  g.addColorStop(0, rgba(lightOf(trim, 1), 0.9));
  g.addColorStop(0.3, rgba(lightOf(trim, 1), 0.6));
  g.addColorStop(0.36, rgba(shadowOf(trim, 0.3), 0.3));
  g.addColorStop(0.55, rgba(lightOf(trim, 0.8), 0.4));
  g.addColorStop(1, rgba(shadowOf(trim, 0.55), 0.55));
  ctx.fillStyle = g;
  path();
  ctx.fill();
  inkLine(ctx, path, trim, 1, 0.6);
}

function counter(ctx: Ctx, x0: number, x1: number, y: number, theme: FurnitureTheme, seed: number): void {
  const cab = theme.cabinet;
  const w = x1 - x0;
  const by = y + 12;
  const body = (): void => roundRect(ctx, x0, by, w, FLOOR_Y - by, [0, 0, 2, 2]);
  wallShadow(ctx, x1 + 6, y, 12, 0.22);
  contactShadow(ctx, (x0 + x1) / 2, FLOOR_Y, w / 2 + 2, 0.32, 0.8);
  ctx.fillStyle = cab;
  body();
  ctx.fill();
  paintTex(ctx, body, 'brush', 0.2, 0.4, 0.4, x0, by);
  carcassLight(ctx, body, x0, x1, by, FLOOR_Y, cab);
  // toe kick, recessed into shadow
  ctx.fillStyle = shadowOf(cab, 0.5);
  ctx.fillRect(x0 + 3, FLOOR_Y - 9, w - 6, 9);
  ctx.fillStyle = rgba(shadowOf(cab, 0.8), 0.45);
  ctx.fillRect(x0 + 3, FLOOR_Y - 9, w - 6, 2);
  // drawers over doors
  const doors = Math.max(1, Math.round(w / 56));
  const dw = (w - 6) / doors;
  const face = mix(cab, lightOf(cab, 0.4), 0.3);
  for (let k = 0; k < doors; k++) {
    const dx = x0 + 3 + k * dw;
    panel(ctx, dx + 1.5, by + 4, dw - 3, 13, face, 2);
    cupPull(ctx, dx + dw / 2, by + 9.5, Math.min(12, dw * 0.28));
    const dy = by + 20;
    const dh = FLOOR_Y - 12 - dy;
    panel(ctx, dx + 1.5, dy, dw - 3, dh, face, 2.4);
    panel(ctx, dx + 7, dy + 7, dw - 14, dh - 14, mix(face, shadowOf(cab, 0.3), 0.18), 2.2, true);
    const hx = doors === 1 ? dx + dw - 9 : k % 2 === 0 ? dx + dw - 9 : dx + 9;
    knob(ctx, hx, dy + 12, 2.3, BRASS);
  }
  // worktop: butcher block (stone in the bathroom)
  const tx = x0 - 6;
  const tw = w + 12;
  if (theme.pattern === 'tiles') stoneTop(ctx, tx, y, tw, 14, seed);
  else butcherBlock(ctx, tx, y, tw, 14, seed);
}

function butcherBlock(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  const base = mix(WOOD, '#E2C49C', 0.45);
  plank(ctx, x, y, w, h, base, seed, 3, 4, 0.5);
  // the glued strips showing on the front edge (kept inside it, so no clip)
  let sx = x + 2 + hash01(seed, 3) * 4;
  for (let k = 0; sx < x + w - 2; k++) {
    const sw = 7 + hash01(seed, k + 20) * 6;
    const t = hash01(seed, k + 40);
    if (t > 0.5) {
      ctx.fillStyle = rgba(t > 0.75 ? lightOf(base, 0.4) : shadowOf(base, 0.3), 0.3);
      ctx.fillRect(sx, y + 4.4, Math.min(sw, x + w - 2 - sx), h - 5.6);
    }
    ctx.fillStyle = rgba(lineOf(base), 0.28);
    ctx.fillRect(sx - 0.3, y + 4.4, 0.6, h - 5.6);
    sx += sw;
  }
}

function stoneTop(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  const base = '#EEEAE3';
  const path = (): void => roundRect(ctx, x, y, w, h, 3);
  ctx.fillStyle = base;
  path();
  ctx.fill();
  paintTex(ctx, path, 'plaster', 0.4, 0.3, 0.3, x, y);
  // soft grey veins
  ctx.save();
  path();
  ctx.clip();
  ctx.strokeStyle = 'rgba(150,146,170,0.35)';
  ctx.lineWidth = 0.7;
  for (let k = 0; k < 3; k++) {
    const vx = x + w * (0.15 + hash01(seed, k) * 0.7);
    ctx.beginPath();
    ctx.moveTo(vx, y);
    ctx.bezierCurveTo(vx + 6, y + 4, vx - 4, y + 9, vx + 9, y + h);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(x, y, w, 3.6);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(x + 2, y + 3.4, w - 4, 0.8);
  const g = ctx.createLinearGradient(0, y + 4, 0, y + h);
  g.addColorStop(0, 'rgba(120,110,140,0)');
  g.addColorStop(1, 'rgba(120,110,140,0.3)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y + 4, w, h - 4);
  ctx.restore();
  specular(ctx, x + w * 0.3, y + 1.6, w * 0.3, 0.8, 0, 0.5, '#FFFFFF', 0.02);
  inkLine(ctx, path, base, 1, 0.6);
}

/** A tapered, turned wooden leg between two points (top width wt, foot width wb). */
function leg(ctx: Ctx, ax: number, ay: number, bx: number, by: number, wt: number, wb: number, base: string): void {
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(ax - wt / 2, ay);
    ctx.lineTo(ax + wt / 2, ay);
    ctx.lineTo(bx + wb / 2, by - 1.5);
    ctx.quadraticCurveTo(bx, by + 0.6, bx - wb / 2, by - 1.5);
    ctx.closePath();
  };
  ctx.fillStyle = base;
  path();
  ctx.fill();
  cylinderShade(ctx, path, Math.min(ax, bx) - wt / 2, Math.max(ax, bx) + wt / 2, base, 0.55, 0.55);
  inkLine(ctx, path, base, 0.9, 0.7);
}

function table(ctx: Ctx, x0: number, x1: number, y: number, seed: number): void {
  const w = x1 - x0;
  const legs: Array<[number, number]> = [
    [x0 + 14, x0 + 12],
    [x1 - 14, x1 - 12],
  ];
  for (const [, fx] of legs) contactShadow(ctx, fx, FLOOR_Y, 6, 0.32, 0.4);
  castShadow(ctx, () => roundRect(ctx, x0, y + 2, w, 10, 4), 4, 9, 6, 0.18);
  const lc = shadowOf(WOOD, 0.12);
  for (const [tx, fx] of legs) {
    leg(ctx, tx, y + 10, fx, FLOOR_Y, 8.6, 6, lc);
    // a turned bead near the top
    ctx.fillStyle = lightOf(lc, 0.2);
    roundRect(ctx, tx - 5, y + 24, 10, 3.2, 1.6);
    ctx.fill();
    ctx.fillStyle = rgba(shadowOf(lc, 0.6), 0.5);
    ctx.fillRect(tx - 4.6, y + 26.2, 9.2, 1);
  }
  // apron rail under the top
  const ap = (): void => roundRect(ctx, x0 + 9, y + 11, w - 18, 9, 1.5);
  ctx.fillStyle = shadowOf(WOOD, 0.2);
  ap();
  ctx.fill();
  paintTex(ctx, ap, 'wood', 0.45, 0.4, 0.18, x0, y);
  ctx.fillStyle = rgba(shadowOf(WOOD, 0.8), 0.45);
  ctx.fillRect(x0 + 9, y + 11, w - 18, 2.4);
  inkLine(ctx, ap, WOOD, 0.9, 0.6);
  plank(ctx, x0, y, w, 12, WOOD, seed, 4.5, 3.6);
}

function stool(ctx: Ctx, x0: number, x1: number, y: number, accent: string, seed: number): void {
  const w = x1 - x0;
  const lc = shadowOf(WOOD, 0.1);
  contactShadow(ctx, x0 + 4, FLOOR_Y, 5, 0.3, 0.4);
  contactShadow(ctx, x1 - 4, FLOOR_Y, 5, 0.3, 0.4);
  // rung between the splayed legs
  const ry = y + (FLOOR_Y - y) * 0.62;
  const rung = (): void => roundRect(ctx, x0 + 6, ry - 2, w - 12, 4, 2);
  ctx.fillStyle = shadowOf(lc, 0.12);
  rung();
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(lc, 0.6), 0.6);
  ctx.fillRect(x0 + 7, ry - 1.4, w - 14, 0.9);
  inkLine(ctx, rung, lc, 0.8, 0.6);
  leg(ctx, x0 + 8, y + 9, x0 + 4, FLOOR_Y, 7, 5.6, lc);
  leg(ctx, x1 - 8, y + 9, x1 - 4, FLOOR_Y, 7, 5.6, lc);
  // seat: a wooden base under a plump cushion
  const base = (): void => roundRect(ctx, x0 + 1, y + 7, w - 2, 5, 2.5);
  ctx.fillStyle = WOOD;
  base();
  ctx.fill();
  ctx.fillStyle = rgba(shadowOf(WOOD, 0.6), 0.4);
  ctx.fillRect(x0 + 2, y + 10, w - 4, 2);
  inkLine(ctx, base, WOOD, 0.9, 0.65);
  const cloth = mix(accent, '#EFE4D4', 0.22);
  const cush = (): void => roundRect(ctx, x0, y, w, 9, 4.5);
  ctx.fillStyle = cloth;
  cush();
  ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + 9);
  g.addColorStop(0, rgba(lightOf(cloth, 0.8), 0.6));
  g.addColorStop(0.45, rgba(cloth, 0));
  g.addColorStop(1, rgba(shadowOf(cloth, 0.6), 0.5));
  ctx.fillStyle = g;
  cush();
  ctx.fill();
  paintTex(ctx, cush, 'weave', 0.35, 0.26, 0.26, x0, y);
  // piping and a button
  ctx.strokeStyle = rgba(lightOf(cloth, 0.9), 0.75);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x0 + 3, y + 5.6);
  ctx.lineTo(x1 - 3, y + 5.6);
  ctx.stroke();
  knob(ctx, (x0 + x1) / 2 + jit(seed, 1), y + 3.4, 1.3, shadowOf(cloth, 0.2));
  inkLine(ctx, cush, cloth, 1, 0.7);
}

function fridge(ctx: Ctx, x0: number, x1: number, y: number, theme: FurnitureTheme, seed: number): void {
  const w = x1 - x0;
  const h = FLOOR_Y - y;
  const enamel = mix(theme.accent, '#F3EEE4', 0.6);
  const body = (): void => roundRect(ctx, x0, y, w, h, [10, 10, 3, 3]);
  wallShadow(ctx, x1, y + 4, 14, 0.22);
  contactShadow(ctx, (x0 + x1) / 2, FLOOR_Y, w / 2 + 1, 0.34, 0.8);
  ctx.fillStyle = enamel;
  body();
  ctx.fill();
  cylinderShade(ctx, body, x0, x1, enamel, 0.5, 0.45);
  const vg = ctx.createLinearGradient(0, y, 0, FLOOR_Y);
  vg.addColorStop(0, rgba(lightOf(enamel, 0.8), 0.35));
  vg.addColorStop(0.3, rgba(enamel, 0));
  vg.addColorStop(1, rgba(shadowOf(enamel, 0.6), 0.25));
  ctx.fillStyle = vg;
  body();
  ctx.fill();
  // glossy enamel: a long streak on the lit side
  specular(ctx, x0 + w * 0.2, y + h * 0.45, h * 0.62, 2.4, Math.PI / 2, 0.42, '#FFFFFF', 0.01);
  glint(ctx, x0 + 9, y + 10, 1.4, 0.8);
  // freezer seam
  const split = y + h * 0.34;
  ctx.fillStyle = rgba(lineOf(enamel), 0.55);
  ctx.fillRect(x0 + 1, split - 0.6, w - 2, 1.4);
  ctx.fillStyle = rgba(lightOf(enamel, 0.9), 0.8);
  ctx.fillRect(x0 + 1.5, split + 0.9, w - 3, 0.9);
  // chrome handles
  for (const [hy, hh] of [
    [y + 16, (split - y) * 0.55],
    [split + 14, Math.min(64, h * 0.3)],
  ] as const) {
    chrome(ctx, x0 + 7, hy, 5.4, hh);
  }
  // badge
  const bx = x0 + w / 2 + 6;
  const badge = (): void => roundRect(ctx, bx - 8, split + 9, 16, 4.4, 2.2);
  ctx.fillStyle = '#D6DAE0';
  badge();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(bx - 6.5, split + 10, 13, 0.9);
  inkLine(ctx, badge, '#B8BEC8', 0.7, 0.6);
  // a doodle held up by a magnet, and a round magnet
  const nx = x0 + w * 0.52;
  const ny = split + 26;
  ctx.save();
  ctx.translate(nx, ny);
  ctx.rotate(-0.06 + jit(seed, 1) * 0.05);
  ctx.fillStyle = 'rgba(90,70,100,0.18)';
  ctx.fillRect(-8, 1.5, 18, 22);
  ctx.fillStyle = '#FBF5E8';
  ctx.fillRect(-9, 0, 18, 22);
  ctx.strokeStyle = 'rgba(232,150,74,0.9)';
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(0, 14, 5.5, 3.6, 0, 0, Math.PI * 2);
  ctx.moveTo(-4, 11.5);
  ctx.lineTo(-3, 8.4);
  ctx.lineTo(-1.2, 11);
  ctx.moveTo(4, 11.5);
  ctx.lineTo(3, 8.4);
  ctx.lineTo(1.2, 11);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(143,179,217,0.9)';
  ctx.beginPath();
  ctx.moveTo(-6, 5);
  ctx.lineTo(6, 5);
  ctx.stroke();
  ctx.restore();
  knob(ctx, nx, ny + 1, 2.4, PALETTE.ginger);
  knob(ctx, x0 + w * 0.28, split + 40, 2.6, PALETTE.teacup);
  // kick grille
  const gy = FLOOR_Y - 11;
  ctx.fillStyle = shadowOf(enamel, 0.45);
  roundRect(ctx, x0 + 5, gy, w - 10, 8, 1.5);
  ctx.fill();
  ctx.fillStyle = rgba(shadowOf(enamel, 0.85), 0.5);
  for (let k = 0; k < 3; k++) ctx.fillRect(x0 + 8, gy + 1.8 + k * 2.2, w - 16, 0.9);
  inkLine(ctx, body, enamel, 1.2, 0.75);
}

function chrome(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const c = '#C9CFD8';
  const path = (): void => roundRect(ctx, x, y, w, h, w / 2);
  castShadow(ctx, path, 1, 1.6, 1.6, 0.3);
  ctx.fillStyle = c;
  path();
  ctx.fill();
  cylinderShade(ctx, path, x, x + w, c, 0.9, 0.7);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(x + w * 0.24, y + 2, w * 0.18, h - 4);
  inkLine(ctx, path, c, 0.8, 0.7);
}

function cabinet(ctx: Ctx, x0: number, x1: number, y: number, col: string, seed: number): void {
  const w = x1 - x0;
  const top = 9;
  const by = y + top;
  const base = FLOOR_Y - 10;
  const body = (): void => {
    ctx.beginPath();
    ctx.rect(x0 + 1.5, by - 1, w - 3, base - by + 1);
  };
  wallShadow(ctx, x1, y, 13, 0.22);
  contactShadow(ctx, (x0 + x1) / 2, FLOOR_Y, w / 2, 0.32, 0.8);
  // plinth with bun feet
  ctx.fillStyle = shadowOf(col, 0.25);
  roundRect(ctx, x0 + 2, base, w - 4, 5, 1.5);
  ctx.fill();
  for (const fx of [x0 + 7, x1 - 7]) knob(ctx, fx, FLOOR_Y - 2.6, 3.2, shadowOf(WOOD, 0.2));
  ctx.fillStyle = col;
  body();
  ctx.fill();
  paintTex(ctx, body, 'brush', 0.2, 0.4, 0.4, x0, by);
  carcassLight(ctx, body, x0, x1, by, base, col);
  // drawers
  const rows = Math.max(2, Math.round((base - by - 4) / 34));
  const rh = (base - by - 4) / rows;
  const face = mix(col, lightOf(col, 0.4), 0.3);
  for (let k = 0; k < rows; k++) {
    const ry = by + 2 + k * rh;
    panel(ctx, x0 + 4.5, ry + 1, w - 9, rh - 3, face, 2.2);
    if (w > 84) {
      cupPull(ctx, x0 + w * 0.3, ry + rh / 2 - 1.5, 10);
      cupPull(ctx, x0 + w * 0.7, ry + rh / 2 - 1.5, 10);
    } else knob(ctx, (x0 + x1) / 2, ry + rh / 2, 2.4, BRASS);
  }
  inkLine(ctx, body, col, 1.1, 0.7);
  // wooden top
  plank(ctx, x0 - 1.5, y, w + 3, top, mix(WOOD, col, 0.2), seed, 2.5, 3);
}

function bookcase(ctx: Ctx, x0: number, x1: number, y: number, seed: number): void {
  const w = x1 - x0;
  const wood = WALNUT;
  const side = 6;
  wallShadow(ctx, x1, y, 14, 0.24);
  contactShadow(ctx, (x0 + x1) / 2, FLOOR_Y, w / 2, 0.34, 0.8);
  const ix0 = x0 + side;
  const ix1 = x1 - side;
  const top = y + 9;
  const bottom = FLOOR_Y - 9;
  const shelves = Math.max(2, Math.round((bottom - top) / 54));
  const sh = (bottom - top) / shelves;
  const back = shadowOf(wood, 0.55);
  const cols = ['#8FA9C8', '#D99A92', '#E8CB86', '#9DB894', '#B8A6CC', '#D6A27E', '#E9DFCB', '#A9C1C9'];
  for (let k = 0; k < shelves; k++) {
    const cy0 = top + k * sh;
    const cy1 = cy0 + sh - 5;
    // the back of the compartment, darker deep under the shelf above
    const bg = ctx.createLinearGradient(0, cy0, 0, cy1);
    bg.addColorStop(0, shadowOf(back, 0.45));
    bg.addColorStop(0.35, back);
    bg.addColorStop(1, mix(back, wood, 0.25));
    ctx.fillStyle = bg;
    ctx.fillRect(ix0, cy0, ix1 - ix0, cy1 - cy0);
    // books, batched by colour: spines, then lit and shaded strips, gilt and labels
    let bx = ix0 + 1.5;
    let i = 0;
    const spines = cols.map(() => new Path2D());
    const lit = new Path2D();
    const shd = new Path2D();
    const gilt = new Path2D();
    const labels = new Path2D();
    const edges = new Path2D();
    while (bx < ix1 - 6) {
      const r = hash01(seed + k * 13, i);
      if (r > 0.9 && bx < ix1 - 22) {
        // a little stack lying flat
        const sw = 15 + hash01(seed + k, i + 9) * 4;
        for (let st = 0; st < 3; st++) {
          const ci = Math.floor(hash01(seed + k * 7, i + st * 3) * cols.length);
          const sx = bx + st * 0.8;
          const sy = cy1 - (st + 1) * 4.4;
          const ww = sw - st * 1.6;
          spines[ci].rect(sx, sy, ww, 4.2);
          lit.rect(sx + 1, sy + 0.6, ww - 2, 0.8);
          shd.rect(sx, sy + 3.2, ww, 1);
          edges.rect(sx, sy, ww, 4.2);
        }
        bx += sw + 1.5;
        i += 3;
        continue;
      }
      const bw = 5.5 + hash01(seed + k, i + 30) * 5.5;
      if (bx + bw > ix1 - 1) break;
      const bh = (sh - 12) * (0.72 + hash01(seed + k, i + 50) * 0.26);
      const ci = Math.floor(hash01(seed + k * 7, i + 99) * cols.length);
      const lean = bx + bw < ix1 - 10 && hash01(seed + k, i + 70) > 0.93 ? 0.16 : 0;
      if (lean) {
        book(ctx, bx, cy1, bw, bh, cols[ci], lean, hash01(seed + k, i + 80));
        bx += bw + 3.5;
        i++;
        continue;
      }
      const top2 = cy1 - bh;
      spines[ci].rect(bx, top2, bw, bh);
      lit.rect(bx + bw * 0.18, top2 + 0.6, bw * 0.2, bh - 1.2);
      shd.rect(bx + bw * 0.68, top2 + 0.6, bw * 0.32, bh - 0.6);
      gilt.rect(bx + 0.7, top2 + 2.6, bw - 1.4, 0.8);
      const hh = hash01(seed + k, i + 80);
      if (hh > 0.5) gilt.rect(bx + 0.7, cy1 - 4.2, bw - 1.4, 0.8);
      if (hh > 0.35 && bw > 6.5) labels.rect(bx + 1.5, top2 + bh * 0.36, bw - 3, bh * 0.14);
      edges.rect(bx, top2, bw, bh);
      bx += bw + 0.5;
      i++;
    }
    cols.forEach((c, ci) => {
      ctx.fillStyle = c;
      ctx.fill(spines[ci]);
    });
    ctx.fillStyle = 'rgba(255,250,236,0.3)';
    ctx.fill(lit);
    ctx.fillStyle = 'rgba(60,40,80,0.2)';
    ctx.fill(shd);
    ctx.fillStyle = rgba(mix(PALETTE.butter, '#FFF6E0', 0.3), 0.8);
    ctx.fill(gilt);
    ctx.fillStyle = 'rgba(250,244,230,0.8)';
    ctx.fill(labels);
    ctx.strokeStyle = 'rgba(70,50,80,0.45)';
    ctx.lineWidth = 0.7;
    ctx.stroke(edges);
    // shade inside the box: under the shelf above and the side on the right
    ctx.fillStyle = 'rgba(52,40,60,0.22)';
    ctx.fillRect(ix0, cy0, ix1 - ix0, 3);
    ctx.fillStyle = 'rgba(52,40,60,0.16)';
    ctx.fillRect(ix1 - 3, cy0, 3, cy1 - cy0);
    // the shelf board below
    plank(ctx, ix0 - 0.5, cy1, ix1 - ix0 + 1, 5, mix(wood, WOOD, 0.3), seed + k, 1.2, 1.6, 0.4);
  }
  // sides, plinth and the top
  for (const sx of [x0, x1 - side]) {
    const sp = (): void => roundRect(ctx, sx, y + 4, side, FLOOR_Y - y - 4, 1.5);
    ctx.fillStyle = wood;
    sp();
    ctx.fill();
    paintTex(ctx, sp, 'wood', 0.5, 0.2, 0.45, sx, y);
    ctx.fillStyle = rgba(sx === x0 ? lightOf(wood, 0.6) : shadowOf(wood, 0.5), 0.4);
    ctx.fillRect(sx + (sx === x0 ? 0.8 : side - 2.4), y + 9, 1.6, FLOOR_Y - y - 10);
    inkLine(ctx, sp, wood, 0.9, 0.65);
  }
  ctx.fillStyle = shadowOf(wood, 0.3);
  ctx.fillRect(x0 + side, FLOOR_Y - 9, w - side * 2, 9);
  ctx.fillStyle = rgba(lightOf(wood, 0.6), 0.5);
  ctx.fillRect(x0 + side, FLOOR_Y - 8.4, w - side * 2, 1);
  plank(ctx, x0 - 2, y, w + 4, 9, mix(wood, WOOD, 0.35), seed + 99, 2.5, 3);
}

function book(ctx: Ctx, x: number, floorY: number, bw: number, bh: number, c: string, lean: number, h: number): void {
  ctx.save();
  ctx.translate(x + (lean ? bw : 0), floorY);
  ctx.rotate(lean);
  const bx = lean ? -bw : 0;
  const spine = (): void => roundRect(ctx, bx, -bh, bw, bh, 1);
  ctx.fillStyle = c;
  spine();
  ctx.fill();
  cylinderShade(ctx, spine, bx, bx + bw, c, 0.5, 0.5);
  ctx.fillStyle = rgba(mix(PALETTE.butter, '#FFF6E0', 0.3), 0.8);
  ctx.fillRect(bx + 0.7, -bh + 2.6, bw - 1.4, 0.8);
  if (h > 0.5) ctx.fillRect(bx + 0.7, -4.2, bw - 1.4, 0.8);
  if (h > 0.35 && bw > 6.5) {
    ctx.fillStyle = 'rgba(250,244,230,0.8)';
    ctx.fillRect(bx + 1.5, -bh * 0.64, bw - 3, bh * 0.14);
  }
  inkLine(ctx, spine, c, 0.7, 0.6);
  ctx.restore();
}

function crate(ctx: Ctx, x0: number, x1: number, y: number, seed: number): void {
  const w = x1 - x0;
  const h = FLOOR_Y - y;
  const wood = mix(WOOD, '#DDBB8E', 0.45);
  wallShadow(ctx, x1, y, 12, 0.22);
  contactShadow(ctx, (x0 + x1) / 2, FLOOR_Y, w / 2, 0.34, 0.8);
  // dark interior between the slats
  ctx.fillStyle = shadowOf(wood, 0.6);
  ctx.fillRect(x0 + 2, y + 2, w - 4, h - 2);
  const slats = Math.max(2, Math.round(h / 21));
  const sh = h / slats;
  for (let k = 0; k < slats; k++) {
    const sy = y + k * sh;
    const tone = mix(wood, k % 2 ? lightOf(wood, 0.3) : shadowOf(wood, 0.15), hash01(seed, k) * 0.6);
    plank(ctx, x0, sy, w, sh - 3, tone, seed + k * 5, 2, k === 0 ? 3 : 1.6, 0.6);
  }
  // corner posts, nailed on
  for (const px of [x0, x1 - 8]) {
    const post = (): void => roundRect(ctx, px, y, 8, h, 1.5);
    const pc = shadowOf(wood, 0.12);
    ctx.fillStyle = pc;
    post();
    ctx.fill();
    paintTex(ctx, post, 'wood', 0.55, 0.2, 0.45, px, y);
    ctx.fillStyle = rgba(px === x0 ? lightOf(pc, 0.6) : shadowOf(pc, 0.5), 0.45);
    ctx.fillRect(px + (px === x0 ? 1 : 5.6), y + 2, 1.4, h - 3);
    inkLine(ctx, post, pc, 1, 0.7);
    for (let k = 0; k < slats; k++) {
      const ny = y + k * sh + (sh - 3) / 2;
      knob(ctx, px + 4, ny - 2.4, 0.9, '#8E8A8E');
      knob(ctx, px + 4, ny + 2.4, 0.9, '#8E8A8E');
    }
  }
  // a faded stencil on the middle slat
  const my = y + Math.floor(slats / 2) * sh + (sh - 3) / 2;
  const mark = pick(['fruit', 'heart', 'star'] as const, seed, 2);
  const cx = (x0 + x1) / 2;
  ctx.save();
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = '#9A5E44';
  ctx.strokeStyle = '#9A5E44';
  if (mark === 'heart') {
    ctx.beginPath();
    ctx.moveTo(cx, my + 4);
    ctx.bezierCurveTo(cx - 7, my - 1, cx - 3, my - 6, cx, my - 2.5);
    ctx.bezierCurveTo(cx + 3, my - 6, cx + 7, my - 1, cx, my + 4);
    ctx.fill();
  } else if (mark === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 2.4 : 5.4;
      ctx.lineTo(cx + Math.cos(a) * r, my + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(cx, my + 0.6, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, my - 3.4);
    ctx.lineTo(cx + 1.5, my - 6);
    ctx.stroke();
  }
  ctx.restore();
}

function ramp(ctx: Ctx, ax: number, ay: number, bx: number, by: number, seed: number): void {
  const len = Math.hypot(bx - ax, by - ay);
  const a = Math.atan2(by - ay, bx - ax);
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  // a soft shadow below the plank, in world space
  castShadow(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(ax - nx * 6, ay - ny * 6);
    ctx.lineTo(bx - nx * 6, by - ny * 6);
    ctx.lineTo(bx + nx * 6, by + ny * 6);
    ctx.lineTo(ax + nx * 6, ay + ny * 6);
    ctx.closePath();
  }, 2.5, 6, 4, 0.24);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(a);
  plank(ctx, -6, -6, len + 12, 12, WOOD, seed, 6, 3.4);
  ctx.restore();
}
