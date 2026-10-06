// Painting the perches. Each is drawn with its top (where a cat sits) at
// (x, y), in two parts like a container: the back goes under the cats and
// the front over them, so a cat curled in the hammock, the wicker pod or the
// cat bed has the cloth, the basket's rim or the bolster in front of it. The
// hammock and the bouncy cushion move, so they're painted live each frame
// (paintLiveBack, paintLiveFront) from where their sling and spring are.

import { WORLD_W } from '../game/props';
import { hash01, lightOf, mix, rgba, roundRect, shadowOf, softShadow, type Ctx } from '../render/paint';
import { paintCushion } from '../render/cushion';
import { castShadow, cylinderShade, inkLine, knob, paintTex } from '../render/roomKit';
import { BOUNCE, PERCHES, SLING, perchBox, type PerchKind, type PerchProp } from './perches';
import { BOUNCE_GIVE } from './springs';

const TAU = Math.PI * 2;
const WOOD = '#C99A6C';
const BRASS = '#CFAA6A';

/** Does this kind have a front part (something a cat sits in, not just on)? */
export function hasFront(kind: PerchKind): boolean {
  return kind === 'hammock' || kind === 'pod' || kind === 'bed';
}

/** Perches that move (the hammock's sling, the bouncy cushion): painted live, not into the cached layers. */
export function isLive(kind: PerchKind): boolean {
  return kind === 'hammock' || kind === 'bounce';
}

/** The part of a perch behind a cat on it. */
export function paintPerchBack(ctx: Ctx, kind: PerchKind, x: number, y: number, seed = 1): void {
  ctx.save();
  switch (kind) {
    case 'shelf':
      shelf(ctx, x, y, seed);
      break;
    case 'cushion':
      cushionLedge(ctx, x, y, seed);
      break;
    case 'hammock':
      hammockBack(ctx, x, y, restSling(x, y), seed);
      break;
    case 'bounce':
      bounceCushion(ctx, x, y, 0, seed);
      break;
    case 'bed':
      bedBack(ctx, x, y, seed);
      break;
    case 'pod':
      podBack(ctx, x, y, seed);
      break;
    case 'cloud':
      cloudShelf(ctx, x, y, seed);
      break;
    case 'beanbag':
      beanbag(ctx, x, y, seed);
      break;
    case 'tree':
      catTree(ctx, x, y, seed);
      break;
  }
  ctx.restore();
}

/** The part of a perch in front of a cat in it (hammock and pod only). */
export function paintPerchFront(ctx: Ctx, kind: PerchKind, x: number, y: number, seed = 1): void {
  ctx.save();
  if (kind === 'hammock') hammockFront(ctx, restSling(x, y), seed);
  else if (kind === 'pod') podFront(ctx, x, y, seed);
  else if (kind === 'bed') bedFront(ctx, x, y, seed);
  ctx.restore();
}

/** A moving perch's back, where it is this frame (under the cats). */
export function paintLiveBack(ctx: Ctx, p: PerchProp): void {
  const { x, y, id } = p.save;
  ctx.save();
  if (p.sling) hammockBack(ctx, x, y, { x: p.sling.x, y: p.sling.y }, id);
  else if (p.bouncer) bounceCushion(ctx, x, y, p.bouncer.squash, id);
  ctx.restore();
}

/** A moving perch's front (the hammock's near side, over a cat lying in it). */
export function paintLiveFront(ctx: Ctx, p: PerchProp): void {
  if (!p.sling) return;
  ctx.save();
  hammockFront(ctx, { x: p.sling.x, y: p.sling.y }, p.save.id);
  ctx.restore();
}

/** A small picture of a perch, for the shop. */
export function perchThumb(kind: PerchKind, w: number, h: number): HTMLCanvasElement {
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext('2d')!;
  const b = perchBox(kind, 0, 0);
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  const s = Math.min((w - 8) / bw, (h - 8) / bh);
  g.setTransform(dpr * s, 0, 0, dpr * s, dpr * (w / 2 - ((b.x0 + b.x1) / 2) * s), dpr * (h / 2 - ((b.y0 + b.y1) / 2) * s));
  paintPerchBack(g, kind, 0, 0, 3);
  paintPerchFront(g, kind, 0, 0, 3);
  return c;
}

// ---------------------------------------------------------------------------

function bracket(ctx: Ctx, x: number, y: number, h: number, dir: number): void {
  // an L of brass: up the wall, along under the shelf, and a brace between
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.moveTo(x, y + h * 0.75);
    ctx.quadraticCurveTo(x + dir * h * 0.15, y + h * 0.1, x + dir * h * 0.8, y + 1);
  };
  ctx.strokeStyle = shadowOf(BRASS, 0.55);
  ctx.lineWidth = 3.6;
  path();
  ctx.stroke();
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 2.4;
  path();
  ctx.stroke();
  ctx.strokeStyle = rgba(lightOf(BRASS, 0.8), 0.8);
  ctx.lineWidth = 0.8;
  ctx.translate(-0.5, -0.5);
  path();
  ctx.stroke();
  ctx.restore();
  knob(ctx, x, y + h - 1, 1.6, BRASS);
}

function plank(ctx: Ctx, x0: number, y: number, w: number, h: number, base: string, seed: number): void {
  const p = (): void => roundRect(ctx, x0, y, w, h, 3);
  const path = (): void => {
    ctx.beginPath();
    p();
  };
  castShadow(ctx, path, 5, 6, 4, 0.24);
  ctx.fillStyle = base;
  path();
  ctx.fill();
  paintTex(ctx, path, 'wood', 0.4, 0.25, 0.5, x0 + seed * 13, y);
  // the top catches the light, the front edge is in shade
  ctx.fillStyle = rgba(lightOf(base, 0.75), 0.85);
  ctx.fillRect(x0 + 2, y + 0.8, w - 4, 1.8);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(255,240,214,0)');
  g.addColorStop(1, rgba(shadowOf(base, 0.5), 0.35));
  ctx.fillStyle = g;
  path();
  ctx.fill();
  inkLine(ctx, path, base, 0.9, 0.7);
}

function shelf(ctx: Ctx, x: number, y: number, seed: number): void {
  bracket(ctx, x - 22, y + 9, 15, 1);
  bracket(ctx, x + 22, y + 9, 15, -1);
  plank(ctx, x - 33, y, 66, 10, WOOD, seed);
}

function cushionLedge(ctx: Ctx, x: number, y: number, seed: number): void {
  bracket(ctx, x - 28, y + 17, 12, 1);
  bracket(ctx, x + 28, y + 17, 12, -1);
  plank(ctx, x - 43, y + 10, 86, 8, mix(WOOD, '#8E6A50', 0.25), seed);
  // a plump striped cushion along the ledge
  const c = '#E0A49B';
  const p = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - 42, y + 11);
    ctx.bezierCurveTo(x - 46, y + 2, x - 40, y - 1, x - 30, y);
    ctx.lineTo(x + 30, y);
    ctx.bezierCurveTo(x + 40, y - 1, x + 46, y + 2, x + 42, y + 11);
    ctx.closePath();
  };
  ctx.fillStyle = c;
  p();
  ctx.fill();
  ctx.save();
  p();
  ctx.clip();
  ctx.fillStyle = rgba('#FFF4EC', 0.55);
  for (let k = -40; k < 44; k += 9) ctx.fillRect(x + k, y - 2, 3.5, 16);
  const g = ctx.createLinearGradient(0, y, 0, y + 11);
  g.addColorStop(0, 'rgba(255,248,238,0.4)');
  g.addColorStop(1, rgba(shadowOf(c, 0.5), 0.45));
  ctx.fillStyle = g;
  ctx.fillRect(x - 46, y - 2, 92, 15);
  paintTex(ctx, p, 'weave', 0.25, 0.35, 0.35, x, y);
  ctx.restore();
  inkLine(ctx, p, c, 0.9, 0.6);
  // buttons
  for (const bx of [-18, 0, 18]) knob(ctx, x + bx, y + 5, 1.5, shadowOf(c, 0.2));
  void seed;
}

const CANVAS = '#E9D9BF';

/** The sling's points: where it hangs (or, at rest, as it hangs empty). */
interface SlingPts {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
}

/** An empty hammock's sling, as it hangs (for the shop and while it's being put somewhere). */
function restSling(x: number, y: number): SlingPts {
  const n = 9;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    xs.push(x - SLING.half + 2 * SLING.half * u);
    ys.push(y - SLING.up + 4 * SLING.sag * u * (1 - u));
  }
  return { x: xs, y: ys };
}

/** A smooth curve through the sling's points, each lifted by `lift` x how far it is from the pegs (0 at them, 1 in the middle). */
function slingCurve(ctx: Ctx, p: SlingPts, lift: number, move: boolean): void {
  const n = p.x.length;
  const at = (i: number): [number, number] => {
    const u = i / (n - 1);
    return [p.x[i], p.y[i] - lift * 4 * u * (1 - u)];
  };
  const [x0, y0] = at(0);
  if (move) ctx.moveTo(x0, y0);
  else ctx.lineTo(x0, y0);
  for (let i = 1; i < n - 1; i++) {
    const [ax, ay] = at(i);
    const [bx, by] = at(i + 1);
    ctx.quadraticCurveTo(ax, ay, i === n - 2 ? bx : (ax + bx) / 2, i === n - 2 ? by : (ay + by) / 2);
  }
}

/** The same curve, the other way (for closing a band between two). */
function slingCurveBack(ctx: Ctx, p: SlingPts, lift: number): void {
  const n = p.x.length;
  const rev: SlingPts = { x: Array.from(p.x).reverse(), y: Array.from(p.y).reverse() };
  slingCurve(ctx, rev, lift, false);
  void n;
}

function hammockBack(ctx: Ctx, x: number, y: number, p: SlingPts, seed: number): void {
  const n = p.x.length;
  // the pegs and their cords
  for (const s of [-1, 1]) {
    const px = x + s * 54;
    const py = y - 34;
    const end = s < 0 ? 0 : n - 1;
    ctx.strokeStyle = '#7E6A5A';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(p.x[end] - s, p.y[end]);
    ctx.stroke();
    softShadow(ctx, px + 3, py + 4, 5, 3, 0.25);
    knob(ctx, px, py, 4, WOOD);
  }
  // its shadow on the wall
  castShadow(ctx, () => {
    ctx.beginPath();
    slingCurve(ctx, p, -10, true);
    slingCurveBack(ctx, p, 26);
    ctx.closePath();
  }, 6, 8, 6, 0.2);
  // the far half of the sling (its inside), shaded
  const band = (): void => {
    ctx.beginPath();
    slingCurve(ctx, p, 27, true);
    slingCurveBack(ctx, p, 8);
    ctx.closePath();
  };
  ctx.fillStyle = shadowOf(CANVAS, 0.35);
  band();
  ctx.fill();
  paintTex(ctx, band, 'weave', 0.3, 0.3, 0.3, x + seed, y);
  inkLine(ctx, band, CANVAS, 0.8, 0.45);
}

function hammockFront(ctx: Ctx, p: SlingPts, seed: number): void {
  const n = p.x.length;
  const x = (p.x[0] + p.x[n - 1]) / 2;
  let lo = -Infinity;
  for (let i = 0; i < n; i++) lo = Math.max(lo, p.y[i]);
  // the near side of the sling, from its edge down round the cat's bottom
  const band = (): void => {
    ctx.beginPath();
    slingCurve(ctx, p, 19, true);
    slingCurveBack(ctx, p, -5);
    ctx.closePath();
  };
  ctx.fillStyle = CANVAS;
  band();
  ctx.fill();
  ctx.save();
  band();
  ctx.clip();
  // stripes of the canvas, and shade toward the bottom of the curve
  ctx.strokeStyle = rgba('#7FA6C4', 0.55);
  ctx.lineWidth = 3;
  for (const k of [13, 7, 1]) {
    ctx.beginPath();
    slingCurve(ctx, p, k, true);
    ctx.stroke();
  }
  const g = ctx.createLinearGradient(0, lo - 24, 0, lo + 6);
  g.addColorStop(0, 'rgba(255,250,240,0.3)');
  g.addColorStop(1, rgba(shadowOf(CANVAS, 0.5), 0.45));
  ctx.fillStyle = g;
  ctx.fillRect(x - 70, lo - 50, 140, 60);
  paintTex(ctx, band, 'weave', 0.3, 0.3, 0.3, x + seed, lo);
  ctx.restore();
  inkLine(ctx, band, CANVAS, 1, 0.6);
  // the edge's hem catches the light
  ctx.strokeStyle = rgba('#FFFBF2', 0.8);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  slingCurve(ctx, p, 18, true);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// The bouncy cushion

const BOUNCE_COLORS = ['#D9726A', '#7FA0C8', '#E8964A', '#9DB894', '#B48CC8'];

/** A fat tufted cushion standing on the floor, squashed down (and bulging out) by `squash`. */
function bounceCushion(ctx: Ctx, x: number, y: number, squash: number, seed: number): void {
  const { w, h } = BOUNCE;
  const color = BOUNCE_COLORS[Math.floor(hash01(seed, 5) * BOUNCE_COLORS.length)];
  const floor = y + h;
  const s = Math.max(-0.3, Math.min(0.45, squash));
  const sy = 1 - (s * BOUNCE_GIVE * h) / (h + 4);
  const sx = 1 + s * 0.24;
  softShadow(ctx, x + 4, floor, (w / 2) * sx + 4, 4, 0.28);
  ctx.save();
  ctx.translate(x, floor);
  ctx.scale(sx, sy);
  ctx.translate(-w / 2, -(h + 4));
  paintCushion(ctx, w, h + 4, color, seed);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The cat bed

const PLUSH = '#D7A39A';
const PLUSH_IN = '#F4E7D8';

/** The bed's bolster, all round: the back half (behind a cat), and inside it the cushion. */
function bedBack(ctx: Ctx, x: number, y: number, seed: number): void {
  const fy = y + PERCHES.bed.height;
  softShadow(ctx, x + 5, fy, 50, 5, 0.3);
  // the bolster's far side, seen over the cushion
  const far = (): void => {
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 47, 19, 0, Math.PI, 0);
    ctx.lineTo(x + 47, y + 8);
    ctx.ellipse(x, y + 8, 33, 9, 0, 0, Math.PI, true);
    ctx.closePath();
  };
  ctx.fillStyle = PLUSH;
  far();
  ctx.fill();
  cylinderShade(ctx, far, x - 47, x + 47, PLUSH, 0.55, 0.45);
  paintTex(ctx, far, 'fur', 0.25, 0.3, 0.3, x + seed, y);
  inkLine(ctx, far, PLUSH, 0.9, 0.55);
  // the cushion in it, with a dip where a cat curls
  const pad = (): void => {
    ctx.beginPath();
    ctx.ellipse(x, y + 7, 35, 10, 0, 0, Math.PI * 2);
  };
  ctx.fillStyle = PLUSH_IN;
  pad();
  ctx.fill();
  const dg = ctx.createRadialGradient(x, y + 8, 2, x, y + 8, 34);
  dg.addColorStop(0, rgba(shadowOf(PLUSH_IN, 0.4), 0.45));
  dg.addColorStop(1, rgba(shadowOf(PLUSH_IN, 0.4), 0));
  ctx.fillStyle = dg;
  pad();
  ctx.fill();
  inkLine(ctx, pad, PLUSH_IN, 0.7, 0.4);
}

/** The bolster's near side, in front of a cat curled up in it. */
function bedFront(ctx: Ctx, x: number, y: number, seed: number): void {
  const fy = y + PERCHES.bed.height;
  const near = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - 48, y + 4);
    ctx.ellipse(x, y + 4, 48, 14, 0, Math.PI, 0, true);
    ctx.lineTo(x + 48, fy - 7);
    ctx.quadraticCurveTo(x + 48, fy, x + 38, fy);
    ctx.lineTo(x - 38, fy);
    ctx.quadraticCurveTo(x - 48, fy, x - 48, fy - 7);
    ctx.closePath();
  };
  ctx.fillStyle = PLUSH;
  near();
  ctx.fill();
  cylinderShade(ctx, near, x - 48, x + 48, PLUSH, 0.6, 0.5);
  paintTex(ctx, near, 'fur', 0.25, 0.3, 0.3, x + seed, y + 10);
  // its round top, catching the light
  ctx.strokeStyle = rgba(lightOf(PLUSH, 0.75), 0.8);
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(x, y + 4, 45, 12, 0, Math.PI * 0.82, Math.PI * 0.18, true);
  ctx.stroke();
  // a little stitched seam round the base
  ctx.strokeStyle = rgba(shadowOf(PLUSH, 0.4), 0.55);
  ctx.lineWidth = 0.9;
  ctx.setLineDash([2.5, 2.5]);
  ctx.beginPath();
  ctx.moveTo(x - 42, fy - 4);
  ctx.lineTo(x + 42, fy - 4);
  ctx.stroke();
  ctx.setLineDash([]);
  inkLine(ctx, near, PLUSH, 1, 0.65);
}

const WICKER = '#C89A62';

function weave(ctx: Ctx, path: () => void, x0: number, y0: number, x1: number, y1: number, base: string): void {
  ctx.save();
  path();
  ctx.clip();
  ctx.strokeStyle = rgba(shadowOf(base, 0.45), 0.45);
  ctx.lineWidth = 1;
  for (let yy = y0; yy < y1; yy += 4.5) {
    ctx.beginPath();
    for (let xx = x0; xx <= x1; xx += 6) ctx.lineTo(xx, yy + ((Math.round(xx / 6) % 2) * 2 - 1) * 0.8);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(lightOf(base, 0.5), 0.35);
  for (let xx = x0; xx < x1; xx += 6) {
    ctx.beginPath();
    ctx.moveTo(xx, y0);
    ctx.lineTo(xx, y1);
    ctx.stroke();
  }
  ctx.restore();
}

function podBack(ctx: Ctx, x: number, y: number, seed: number): void {
  // a hook on the wall, and the pod's shadow
  knob(ctx, x, y - 50, 3.5, BRASS);
  castShadow(ctx, () => {
    ctx.beginPath();
    ctx.ellipse(x, y - 8, 46, 22, 0, 0, TAU);
  }, 6, 8, 6, 0.24);
  // the inside of the bowl, darker toward the back
  const p = (): void => {
    ctx.beginPath();
    ctx.ellipse(x, y - 24, 44, 9, 0, Math.PI, TAU);
    ctx.bezierCurveTo(x + 44, y - 12, x + 30, y + 4, x, y + 4);
    ctx.bezierCurveTo(x - 30, y + 4, x - 44, y - 12, x - 44, y - 24);
    ctx.closePath();
  };
  ctx.fillStyle = shadowOf(WICKER, 0.45);
  p();
  ctx.fill();
  weave(ctx, p, x - 46, y - 34, x + 46, y + 6, shadowOf(WICKER, 0.45));
  // a little cushion in the bottom
  ctx.fillStyle = '#A9C3A0';
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 30, 5, 0, 0, TAU);
  ctx.fill();
  void seed;
}

function podFront(ctx: Ctx, x: number, y: number, seed: number): void {
  const p = (): void => {
    ctx.beginPath();
    ctx.ellipse(x, y - 24, 46, 9, 0, 0, Math.PI);
    ctx.bezierCurveTo(x - 47, y - 6, x - 30, y + 14, x, y + 14);
    ctx.bezierCurveTo(x + 30, y + 14, x + 47, y - 6, x + 46, y - 24);
    ctx.closePath();
  };
  ctx.fillStyle = WICKER;
  p();
  ctx.fill();
  weave(ctx, p, x - 48, y - 26, x + 48, y + 16, WICKER);
  ctx.save();
  p();
  ctx.clip();
  const g = ctx.createRadialGradient(x - 16, y - 18, 4, x, y - 6, 56);
  g.addColorStop(0, 'rgba(255,240,210,0.35)');
  g.addColorStop(1, rgba(shadowOf(WICKER, 0.6), 0.45));
  ctx.fillStyle = g;
  ctx.fillRect(x - 50, y - 30, 100, 48);
  ctx.restore();
  inkLine(ctx, p, WICKER, 1, 0.65);
  // the rolled rim
  ctx.strokeStyle = lightOf(WICKER, 0.25);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(x, y - 24, 45, 9, 0, 0, Math.PI);
  ctx.stroke();
  ctx.strokeStyle = rgba(lightOf(WICKER, 0.8), 0.7);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(x, y - 25, 45, 9, 0, 0.2, Math.PI - 0.2);
  ctx.stroke();
  void seed;
}

function cloudShelf(ctx: Ctx, x: number, y: number, seed: number): void {
  const puffs: [number, number, number][] = [
    [x - 40, y + 8, 10],
    [x - 26, y + 13, 11],
    [x - 8, y + 15, 12],
    [x + 12, y + 14, 12],
    [x + 30, y + 12, 11],
    [x + 42, y + 7, 9],
    [x - 34, y + 2, 9],
    [x + 36, y + 1, 9],
  ];
  const p = (): void => {
    ctx.beginPath();
    roundRect(ctx, x - 42, y, 84, 13, 6.5);
    for (const [px, py, pr] of puffs) {
      ctx.moveTo(px + pr, py);
      ctx.arc(px, py, pr, 0, TAU);
    }
  };
  softShadow(ctx, x + 8, y + 38, 40, 6, 0.12);
  // a soft lilac edge all round (the puffs' outline, not each puff's)
  ctx.save();
  ctx.translate(0.6, 1);
  ctx.fillStyle = 'rgba(150,138,192,0.55)';
  ctx.scale(1, 1);
  p();
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(-0.8, -0.6);
  ctx.fillStyle = 'rgba(150,138,192,0.35)';
  p();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#FBF8F3';
  p();
  ctx.fill();
  ctx.save();
  p();
  ctx.clip();
  const g = ctx.createLinearGradient(0, y, 0, y + 26);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.45, 'rgba(214,206,232,0.15)');
  g.addColorStop(1, 'rgba(178,166,212,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 54, y - 4, 108, 34);
  ctx.restore();
  // a soft flat top to sit on, and a sparkle
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(x - 36, y + 0.8, 72, 1.6);
  ctx.fillStyle = 'rgba(255,236,170,0.9)';
  for (const [sx, sy, sr] of [
    [x - 56, y - 6, 2.2],
    [x + 54, y + 16, 1.6],
  ]) {
    ctx.beginPath();
    ctx.moveTo(sx, sy - sr * 2);
    ctx.quadraticCurveTo(sx, sy, sx + sr * 2, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy + sr * 2);
    ctx.quadraticCurveTo(sx, sy, sx - sr * 2, sy);
    ctx.quadraticCurveTo(sx, sy, sx, sy - sr * 2);
    ctx.fill();
  }
  void seed;
}

function beanbag(ctx: Ctx, x: number, y: number, seed: number): void {
  const fy = y + PERCHES.beanbag.height;
  const c = hash01(seed, 4) < 0.5 ? '#E6B85C' : '#8FB9B0';
  const p = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - 50, fy);
    ctx.bezierCurveTo(x - 54, fy - 18, x - 36, y - 2, x - 8, y);
    ctx.bezierCurveTo(x + 18, y - 2, x + 50, y + 4, x + 52, fy - 6);
    ctx.quadraticCurveTo(x + 52, fy + 1, x + 40, fy + 1);
    ctx.lineTo(x - 42, fy + 1);
    ctx.closePath();
  };
  softShadow(ctx, x + 4, fy + 1, 52, 4, 0.3);
  ctx.fillStyle = c;
  p();
  ctx.fill();
  ctx.save();
  p();
  ctx.clip();
  const g = ctx.createRadialGradient(x - 18, y + 6, 4, x, y + 14, 66);
  g.addColorStop(0, 'rgba(255,246,226,0.5)');
  g.addColorStop(0.5, 'rgba(255,246,226,0)');
  g.addColorStop(1, rgba(shadowOf(c, 0.6), 0.55));
  ctx.fillStyle = g;
  ctx.fillRect(x - 56, y - 6, 112, PERCHES.beanbag.height + 10);
  paintTex(ctx, p, 'weave', 0.3, 0.35, 0.35, x, y);
  // a seam and a few soft creases
  ctx.strokeStyle = rgba(shadowOf(c, 0.5), 0.45);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 4, y + 1);
  ctx.quadraticCurveTo(x - 10, y + 18, x - 2, fy);
  ctx.moveTo(x + 22, y + 10);
  ctx.quadraticCurveTo(x + 30, y + 16, x + 34, y + 24);
  ctx.stroke();
  ctx.restore();
  inkLine(ctx, p, c, 1, 0.6);
}

function catTree(ctx: Ctx, x: number, y: number, seed: number): void {
  const fy = y + PERCHES.tree.height;
  const s = x < WORLD_W / 2 ? 1 : -1;
  const mid = y + 96;
  const carpet = '#D9CAB6';
  // base plate
  plank(ctx, x - 34, fy - 8, 68, 8, carpet, seed);
  softShadow(ctx, x + 4, fy + 1, 40, 3, 0.3);
  // the sisal post
  const post = (): void => {
    ctx.beginPath();
    ctx.rect(x - 7, y + 8, 14, fy - y - 16);
  };
  castShadow(ctx, post, 6, 3, 4, 0.22);
  const sisal = '#D8B98A';
  ctx.fillStyle = sisal;
  post();
  ctx.fill();
  ctx.save();
  post();
  ctx.clip();
  ctx.strokeStyle = rgba(shadowOf(sisal, 0.45), 0.55);
  ctx.lineWidth = 1;
  for (let yy = y + 6; yy < fy; yy += 3.2) {
    ctx.beginPath();
    ctx.moveTo(x - 8, yy + 2);
    ctx.lineTo(x + 8, yy);
    ctx.stroke();
  }
  ctx.restore();
  cylinderShade(ctx, post, x - 7, x + 7, sisal, 0.55, 0.5);
  inkLine(ctx, post, sisal, 0.8, 0.6);
  // the middle deck, and a pompom dangling from it
  const m0 = s > 0 ? x + 2 : x - 56;
  plank(ctx, m0, mid, 54, 10, carpet, seed + 1);
  const tx = s > 0 ? m0 + 46 : m0 + 8;
  ctx.strokeStyle = '#6E6478';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(tx, mid + 9);
  ctx.quadraticCurveTo(tx + 2 * s, mid + 24, tx, mid + 36);
  ctx.stroke();
  ctx.fillStyle = '#E58F95';
  ctx.beginPath();
  ctx.arc(tx, mid + 40, 5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,240,240,0.6)';
  ctx.beginPath();
  ctx.arc(tx - 1.5, mid + 38.5, 1.6, 0, TAU);
  ctx.fill();
  // the top deck: a round carpeted platform
  plank(ctx, x - 40, y, 80, 11, carpet, seed + 2);
  ctx.fillStyle = rgba('#FFFFFF', 0.25);
  ctx.fillRect(x - 36, y + 1, 72, 2);
}
