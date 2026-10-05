// Cat Drop: painting the bath at the end of a run (bath.ts simulates it): a
// cozy bathroom in the house's own room art (tiles, a window with a view, a
// towel rail, a mirror, a plant, a bath mat), a porcelain clawfoot tub on gold
// feet with a gold tap, the water and the thick suds piled on it, and steam.
// The room and the tub are painted once into cached layers, in coordinates
// relative to the top of the screen (so they can be painted ahead, long before
// the bath is needed); the water, the suds and the steam are drawn live.

import { FLOOR_Y } from '../../game/props';
import type { DecorPlacement } from '../../game/room';
import { contactShadow, glint, lightOf, lineOf, mix, rgba, shadowOf, softShadow, specular, type Ctx } from '../../render/paint';
import { THEMES, drawDecor, drawShell, type Theme } from '../../render/roomArt';
import { castShadow, inkLine } from '../../render/roomKit';
import { SIDE, paintFrame, paintGrain } from './art';
import type { BathScene, TubLayout } from './bath';
import { drawBubble } from './foam';
import { SHAFT_W } from './level';

const TAU = Math.PI * 2;
const PORCELAIN = '#FBF7F0';
const GOLD = '#D8AA4C';
const GOLD_LIGHT = '#F7DD92';

// --- the room -------------------------------------------------------------------------------

/** The bathroom's colours: the house's bathroom, warmed up (a blush wall over the mint tiles, a honey floor). */
const BATHROOM: Theme = { ...THEMES.bathroom, wall: '#F5E2D8', floor: '#D2B08C', accent: '#E39E9A' };

/** Zoom what is drawn next by `z` about the point (x, y). */
export function zoomAbout(ctx: Ctx, x: number, y: number, z: number): void {
  ctx.translate(x, y);
  ctx.scale(z, z);
  ctx.translate(-x, -y);
}

/**
 * The bathroom, framed close (zoomed by `zoom` about the bottom middle of the
 * screen, `viewH` down from its top): its floor line and decor, and how much of
 * it is in view (all in the room's own units, before the zoom).
 */
export interface Bathroom {
  zoom: number;
  viewH: number;
  floor: number;
  x0: number;
  x1: number;
  top: number;
  seed: number;
  /** In the room's own coordinates (its floor line at FLOOR_Y). */
  decor: DecorPlacement[];
}

/**
 * The bathroom around the tub (laid out round a middling one, `L`: whatever
 * the cat's size, the room stays put), framed close by `zoom`. A window behind
 * the tub, as tall as the wall between the card up top (its bottom edge
 * `cardBottom` down the screen) and the tub allows, bunting over it when there
 * is room, a mirror and a towel rail either side, a plant and a bath mat.
 */
export function bathroom(L: TubLayout, viewH: number, seed: number, cardBottom: number, zoom: number): Bathroom {
  const dy = L.floorY - FLOOR_Y;
  const rim = L.rimY - dy;
  // in view: up from the bottom of the screen, and either side of the middle
  const top = viewH - viewH / zoom;
  const half = (SHAFT_W / 2 + SIDE) / zoom;
  const x0 = L.cx - half;
  const x1 = L.cx + half;
  const card = viewH - (viewH - cardBottom) / zoom;
  const winBottom = L.rimY - 30;
  const winH = Math.max(100, Math.min(220, winBottom - card - 30));
  const winTop = winBottom - winH;
  const decor: DecorPlacement[] = [];
  if (winTop - 60 > card + 6) decor.push({ type: 'garland', x: L.cx, y: winTop - 54 - dy, w: Math.min(300, half * 1.7) });
  decor.push(
    { type: 'window', x: L.cx, y: winTop - dy, w: winH > 160 ? 108 : 96, h: winH, variant: 0 },
    { type: 'mirror', x: x0 + 30, y: rim - 140, w: 36, h: 54 },
    { type: 'towel', x: x1 - 36, y: rim - 94 },
    { type: 'plant', x: x0 + 20, y: FLOOR_Y + 4, w: 30 },
    { type: 'rug', x: L.cx, y: FLOOR_Y + 1, w: Math.min(210, half * 1.5) },
  );
  return { zoom, viewH, floor: L.floorY, x0, x1, top, seed, decor };
}

/**
 * Paint the bathroom's walls and floor (part 'shell'), or its decor and the
 * house's cut sides ('decor'), in screen space (y 0 at the top of the screen).
 */
export function paintBathroom(ctx: Ctx, s: Bathroom, part: 'shell' | 'decor', cssPerUnit: number): void {
  const dy = s.floor - FLOOR_Y;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-SIDE - 2, -10, SHAFT_W + SIDE * 2 + 4, s.viewH + 20);
  ctx.clip();
  zoomAbout(ctx, SHAFT_W / 2, s.viewH, s.zoom);
  ctx.translate(0, dy);
  if (part === 'shell') drawShell(ctx, BATHROOM, s.x0 - 4, s.top - dy - 4, s.x1 + 4, s.viewH - dy + 4, s.seed);
  else for (const d of s.decor) drawDecor(ctx, d, BATHROOM, s.seed + d.x);
  ctx.restore();
  if (part === 'shell') return;
  paintFrame(ctx, -10, s.viewH + 10);
  paintGrain(ctx, -SIDE - 2, -10, SHAFT_W + SIDE + 2, s.viewH + 10, cssPerUnit);
}

// --- the tub --------------------------------------------------------------------------------

/** The rim: an ellipse through the middle of its rolled lip (we look at the tub a little from above). */
function rimOf(L: TubLayout): { cx: number; cy: number; a: number; b: number } {
  return { cx: L.cx, cy: L.rimY - 4, a: L.halfW - 5, b: L.persp };
}

/** The tub's outline below the rim: the front of the rim, then down round the belly to its underside. */
function bodyPath(ctx: Ctx, L: TubLayout): void {
  const { cx, cy, a, b } = rimOf(L);
  const A = a + 3;
  const base = L.baseY;
  ctx.beginPath();
  ctx.moveTo(cx - A, cy);
  // the front half of the rim
  ctx.ellipse(cx, cy, A, b + 3, 0, Math.PI, 0, true);
  // down the right end, round the belly, along the bottom, and back up the left end
  ctx.bezierCurveTo(cx + A + 2, cy + 46, cx + A - 10, base - 10, cx + A - 52, base);
  ctx.lineTo(cx - A + 52, base);
  ctx.bezierCurveTo(cx - A + 10, base - 10, cx - A - 2, cy + 46, cx - A, cy);
  ctx.closePath();
}

/** A gold claw foot: a leg curving out from under the tub to a ball gripped by claws. `s` -1 or 1: which way it turns. */
function clawFoot(ctx: Ctx, x: number, top: number, bottom: number, s: number, k = 1, dim = 0): void {
  const R = 6.6 * k;
  const h = bottom - top;
  ctx.save();
  ctx.translate(x, top);
  ctx.scale(s, 1);
  const gold = dim > 0 ? mix(GOLD, '#6F5A3A', dim) : GOLD;
  const leg = (): void => {
    ctx.beginPath();
    ctx.moveTo(-8 * k, 0);
    ctx.bezierCurveTo(-9 * k, h * 0.35, -2 * k, h * 0.5, 1.5 * k, h - 2 * R + 1);
    ctx.lineTo(9 * k, h - 2 * R + 2);
    ctx.bezierCurveTo(11 * k, h * 0.45, 9 * k, h * 0.25, 9 * k, 0);
    ctx.closePath();
  };
  // the ball on the floor, then the leg, then the claws over the ball
  const bx = 5 * k;
  const by = h - R;
  const g = ctx.createRadialGradient(bx - R * 0.4, by - R * 0.45, R * 0.1, bx, by, R * 1.1);
  g.addColorStop(0, lightOf(gold, 0.8));
  g.addColorStop(0.55, gold);
  g.addColorStop(1, shadowOf(gold, 0.6));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(bx, by, R, 0, TAU);
  ctx.fill();
  const lg = ctx.createLinearGradient(-9 * k, 0, 11 * k, 0);
  lg.addColorStop(0, shadowOf(gold, 0.35));
  lg.addColorStop(0.3, lightOf(gold, 0.7));
  lg.addColorStop(0.55, gold);
  lg.addColorStop(1, shadowOf(gold, 0.55));
  ctx.fillStyle = lg;
  leg();
  ctx.fill();
  inkLine(ctx, leg, gold, 0.9, 0.55);
  // a little scroll where the leg meets the tub
  ctx.strokeStyle = rgba(shadowOf(gold, 0.5), 0.8);
  ctx.lineWidth = 1.1 * k;
  ctx.beginPath();
  ctx.arc(4 * k, 5 * k, 3 * k, Math.PI * 0.9, Math.PI * 2.3);
  ctx.stroke();
  // three claws gripping the ball
  for (const [ang, len] of [
    [-0.55, 0.95],
    [0.1, 1.05],
    [0.75, 0.9],
  ] as const) {
    const ex = bx + Math.sin(ang) * R * 1.02;
    const ey = by + Math.cos(ang) * R * 0.55 + R * 0.2;
    ctx.fillStyle = lightOf(gold, 0.25);
    ctx.beginPath();
    ctx.moveTo(bx + Math.sin(ang) * R * 0.3 - 1.6 * k, by - R * 0.95);
    ctx.quadraticCurveTo(ex + Math.sin(ang) * 3 * k * len, by - R * 0.2, ex, ey);
    ctx.quadraticCurveTo(ex - Math.sin(ang) * 1.5 * k - 1.2 * k, by - R * 0.2, bx + Math.sin(ang) * R * 0.3 + 1.6 * k, by - R * 0.95);
    ctx.fill();
    ctx.strokeStyle = rgba(lineOf(gold), 0.5);
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  specular(ctx, -3 * k, h * 0.3, h * 0.42, 1.6 * k, Math.PI / 2 + 0.12, 0.7);
  if (dim < 0.3) glint(ctx, bx - R * 0.4, by - R * 0.4, R * 0.2, 0.8);
  ctx.restore();
}

/** The gold tap at the left end: a pipe up from the back of the rim, a gooseneck over, a spout down; two little handles. */
function tap(ctx: Ctx, L: TubLayout): void {
  const { cx, cy, a, b } = rimOf(L);
  const sx = L.tapX;
  const sy = L.tapY;
  const bx = sx - 22;
  const by = cy - b * Math.sqrt(Math.max(0, 1 - ((bx - cx) / a) ** 2));
  const ay = sy - 16;
  const pipe = (): void => {
    ctx.beginPath();
    ctx.moveTo(bx, by + 2);
    ctx.lineTo(bx, ay);
    ctx.arc(bx + 11, ay, 11, Math.PI, 0);
    ctx.lineTo(sx, sy);
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  castShadow(ctx, () => {
    ctx.beginPath();
    ctx.rect(bx - 2.5, ay - 11, 25, by - ay + 11);
  }, 4, 3, 5, 0.18);
  ctx.strokeStyle = shadowOf(GOLD, 0.5);
  ctx.lineWidth = 6;
  pipe();
  ctx.stroke();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 4.4;
  pipe();
  ctx.stroke();
  ctx.strokeStyle = rgba(GOLD_LIGHT, 0.95);
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(bx - 1.1, by - 2);
  ctx.lineTo(bx - 1.1, ay);
  ctx.arc(bx + 11, ay, 12.1, Math.PI, Math.PI * 1.55);
  ctx.stroke();
  // the spout's mouth
  ctx.fillStyle = shadowOf(GOLD, 0.6);
  ctx.beginPath();
  ctx.ellipse(sx, sy + 0.5, 2.6, 1.2, 0, 0, TAU);
  ctx.fill();
  // handles either side of the pipe, low down
  for (const s of [-1, 1]) {
    const hx = bx + s * 9;
    const hy = by - 7;
    ctx.strokeStyle = shadowOf(GOLD, 0.45);
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(bx, hy + 1.5);
    ctx.lineTo(hx, hy + 1.5);
    ctx.stroke();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(hx - 4, hy);
    ctx.lineTo(hx + 4, hy);
    ctx.moveTo(hx, hy - 3.5);
    ctx.lineTo(hx, hy + 2.5);
    ctx.stroke();
    ctx.fillStyle = PORCELAIN;
    ctx.beginPath();
    ctx.arc(hx, hy - 0.5, 1.7, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Behind the cat: the tub's shadows (on the wall and the floor), its back feet,
 * the inside of the far wall, the back of the rim, and the tap.
 */
export function paintTubBack(ctx: Ctx, L: TubLayout): void {
  const { cx, cy, a, b } = rimOf(L);
  // its shadow on the tiles behind (light from the upper left), and on the floor
  castShadow(ctx, () => bodyPath(ctx, L), 12, 6, 16, 0.2);
  softShadow(ctx, cx + 8, L.footY + 1, a * 0.98, 9, 0.3);
  // the back feet, peeking out behind
  for (const s of [-1, 1]) {
    const x = cx + s * (a - 66);
    contactShadow(ctx, x + s * 5, L.footY - 4, 9, 0.28, 0.5);
    clawFoot(ctx, x, L.baseY - 12, L.footY - 4, s, 0.85, 0.35);
  }
  // inside the far wall, in shade, down to the water
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, a - 4, b - 2.5, 0, Math.PI, 0);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, cy - b, 0, cy + 2);
  g.addColorStop(0, mix(PORCELAIN, '#C9C0D6', 0.35));
  g.addColorStop(1, mix(PORCELAIN, '#A99FC0', 0.55));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  // the back of the rolled rim
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = shadowOf(PORCELAIN, 0.22);
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.ellipse(cx, cy, a, b, 0, Math.PI, 0);
  ctx.stroke();
  ctx.strokeStyle = PORCELAIN;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 0.8, a, b, 0, Math.PI, 0);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 3, a - 1, b, 0, Math.PI * 1.08, Math.PI * 1.75);
  ctx.stroke();
  ctx.restore();
  tap(ctx, L);
}

/** In front of the cat: the porcelain body and the front of its rolled rim, and the gold feet it stands on. */
export function paintTubFront(ctx: Ctx, L: TubLayout): void {
  const { cx, cy, a, b } = rimOf(L);
  // the front feet
  for (const s of [-1, 1]) {
    const x = cx + s * (a - 44);
    contactShadow(ctx, x + s * 5, L.footY, 11, 0.36, 0.7);
    clawFoot(ctx, x, L.baseY - 10, L.footY, s);
  }
  const body = (): void => bodyPath(ctx, L);
  ctx.fillStyle = PORCELAIN;
  body();
  ctx.fill();
  ctx.save();
  body();
  ctx.clip();
  // round form: light from the upper left, shade toward the lower right and underneath
  const x0 = cx - a - 4;
  const x1 = cx + a + 4;
  const sh = ctx.createLinearGradient(x0, 0, x1, 0);
  sh.addColorStop(0, rgba('#B9AFC9', 0.45));
  sh.addColorStop(0.1, rgba('#FFFFFF', 0));
  sh.addColorStop(0.24, rgba('#FFFFFF', 0.55));
  sh.addColorStop(0.42, rgba('#FFFFFF', 0));
  sh.addColorStop(0.68, rgba('#B4A9C6', 0));
  sh.addColorStop(1, rgba('#A196B8', 0.6));
  ctx.fillStyle = sh;
  ctx.fillRect(x0, cy - b, x1 - x0, L.baseY - cy + b + 2);
  const v = ctx.createLinearGradient(0, cy, 0, L.baseY);
  v.addColorStop(0, rgba('#A99FC0', 0.05));
  v.addColorStop(0.55, rgba('#A99FC0', 0.12));
  v.addColorStop(0.9, rgba('#8E84AA', 0.34));
  v.addColorStop(1, rgba('#E9C9A4', 0.4));
  ctx.fillStyle = v;
  ctx.fillRect(x0, cy, x1 - x0, L.baseY - cy + 2);
  // the shadow of the rim's overhang on the belly
  const lip = ctx.createLinearGradient(0, cy + b, 0, cy + b + 16);
  lip.addColorStop(0, rgba('#8E84AA', 0.3));
  lip.addColorStop(1, rgba('#8E84AA', 0));
  ctx.fillStyle = lip;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 9, a + 4, b + 6, 0, 0, Math.PI);
  ctx.lineTo(cx - a - 4, cy + 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // a long soft gleam on the lit side, and a smaller one on the far side
  specular(ctx, cx - a * 0.55, L.baseY - 52, 70, 4, -0.22, 0.6);
  specular(ctx, cx + a * 0.62, L.baseY - 44, 34, 2.4, 0.3, 0.32);
  inkLine(ctx, body, '#E6DDF0', 1.3, 0.7);
  // the front of the rolled rim
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = shadowOf(PORCELAIN, 0.3);
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 1.2, a, b, 0, 0, Math.PI);
  ctx.stroke();
  ctx.strokeStyle = PORCELAIN;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.ellipse(cx, cy, a, b, 0, 0, Math.PI);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 2.4, a, b, 0, Math.PI * 0.25, Math.PI * 0.92);
  ctx.stroke();
  ctx.strokeStyle = rgba('#9C92B6', 0.45);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 4.6, a, b, 0, Math.PI * 0.04, Math.PI * 0.96);
  ctx.stroke();
  ctx.restore();
  glint(ctx, cx - a * 0.62, cy + b * 0.62, 1.6, 0.9);
}

/** The tub's front layer covers this much (y range) around its layout. */
export function tubFrontSpan(L: TubLayout): { y0: number; y1: number } {
  return { y0: L.rimY - L.persp - 12, y1: L.footY + 14 };
}

// --- live: water, suds, steam ---------------------------------------------------------------

/** The water in the tub's opening (it shows behind the suds), with the window's light on it. */
export function drawWater(ctx: Ctx, bath: BathScene): void {
  const L = bath.tub;
  const { cx, cy, a, b } = rimOf(L);
  const wy = bath.water(cx) - 3;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, Math.min(cy + 1, wy), a - 5, b - 3, 0, 0, TAU);
  const g = ctx.createLinearGradient(0, cy - b, 0, cy + b);
  g.addColorStop(0, '#CBE9F0');
  g.addColorStop(0.5, '#A9D7E6');
  g.addColorStop(1, '#8CC3D8');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  // little bright ripples catching the light
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  const t = bath.t;
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const x = cx - a * 0.7 + ((k * 61 + t * 9) % (a * 1.4));
    const y = cy - b * 0.55 + (k % 3) * 2.2;
    ctx.moveTo(x - 6, y);
    ctx.quadraticCurveTo(x, y - 1.2, x + 6, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Where the suds must stay under the cat's chin (from its painted face), if anywhere. */
export interface Chin {
  x: number;
  halfW: number;
  y: number;
}

/**
 * The thick suds piled on the water: the row behind the cat, or the heap in
 * front of it (a soft white mass with suds bubbles over it, kept below the
 * chin), bobbing as the water does and springing back after the splash.
 */
export function drawSudsBand(ctx: Ctx, bath: BathScene, front: boolean, ppu: number, chin: Chin | null): void {
  const L = bath.tub;
  const t = bath.t;
  const under = (x: number, y: number): number => {
    if (!chin) return y;
    const d = Math.abs(x - chin.x) / chin.halfW;
    if (d >= 1) return y;
    return Math.max(y, chin.y + (1 - (1 - d) * (1 - d)) * 14);
  };
  if (front) {
    // the heap: a soft white mass from the top of the suds down below the rim
    const { cx, cy, a } = rimOf(L);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(L.x0 - 2, cy + 12);
    for (let x = L.x0 - 2; x <= L.x1 + 2; x += 10) ctx.lineTo(x, under(x, bath.surface(x) + 7));
    ctx.lineTo(L.x1 + 2, cy + 12);
    ctx.ellipse(cx, cy + 6, a - 2, L.persp, 0, 0, Math.PI);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, L.rimY - L.suds - 10, 0, L.rimY + 12);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.6, '#F4F0FA');
    g.addColorStop(1, '#E3DCF0');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }
  for (const s of bath.suds) {
    if (s.front !== front) continue;
    const wob = Math.sin(t * 2.1 + s.x * 0.37) * 0.04;
    const r = s.r * (1 + wob);
    let y = bath.surface(s.x) + s.dy + s.oy + r * 0.55;
    if (front) y = under(s.x, y - r) + r;
    drawBubble(ctx, s.x, y, r, s.tint, ppu);
  }
}

let wispSprite: HTMLCanvasElement | null = null;

/** Faint wisps of steam rising off the bath. */
export function drawSteam(ctx: Ctx, bath: BathScene): void {
  if (!bath.steam.length) return;
  if (!wispSprite) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    wispSprite = c;
  }
  const S = wispSprite;
  const a0 = ctx.globalAlpha;
  for (const w of bath.steam) {
    const u = w.age / w.life;
    const env = u < 0.3 ? u / 0.3 : 1 - (u - 0.3) / 0.7;
    const size = w.size * (1 + u * 1.8);
    for (let k = 0; k < 2; k++) {
      const s = size * (1 - k * 0.25);
      ctx.globalAlpha = a0 * 0.34 * env * (1 - k * 0.3);
      const x = w.x + Math.sin(w.age * 1.3 + w.seed + k) * 4;
      const y = w.y - k * size * 0.75;
      ctx.drawImage(S, x - s, y - s, s * 2, s * 2);
    }
  }
  ctx.globalAlpha = a0;
}
