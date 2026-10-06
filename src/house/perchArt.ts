// Painting the perches. Each is drawn with its top (where a cat sits) at
// (x, y), in two parts like a container: the back goes under the cats and
// the front over them, so a cat curled in the hammock or the wicker pod has
// the cloth or the basket's rim in front of it.

import { WORLD_W } from '../game/props';
import { hash01, lightOf, mix, rgba, roundRect, shadowOf, softShadow, type Ctx } from '../render/paint';
import { castShadow, cylinderShade, inkLine, knob, paintTex } from '../render/roomKit';
import { PERCHES, perchBox, type PerchKind } from './perches';

const TAU = Math.PI * 2;
const WOOD = '#C99A6C';
const BRASS = '#CFAA6A';

/** Does this kind have a front part (something a cat sits in, not just on)? */
export function hasFront(kind: PerchKind): boolean {
  return kind === 'hammock' || kind === 'pod';
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
      hammockBack(ctx, x, y, seed);
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
  if (kind === 'hammock') hammockFront(ctx, x, y, seed);
  else if (kind === 'pod') podFront(ctx, x, y, seed);
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

function hammockCurve(x: number, y: number, dip: number): [number, number, number, number, number, number] {
  return [x - 48, y - 28, x, y + dip, x + 48, y - 28];
}

function hammockBack(ctx: Ctx, x: number, y: number, seed: number): void {
  // the pegs and their cords
  for (const s of [-1, 1]) {
    const px = x + s * 54;
    const py = y - 34;
    ctx.strokeStyle = '#7E6A5A';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(x + s * 47, y - 27);
    ctx.stroke();
    softShadow(ctx, px + 3, py + 4, 5, 3, 0.25);
    knob(ctx, px, py, 4, WOOD);
  }
  // its shadow on the wall
  castShadow(ctx, () => {
    ctx.beginPath();
    const [ax, ay, cx, cy, bx, by] = hammockCurve(x, y, 10);
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, cy + 16, bx, by);
    ctx.quadraticCurveTo(cx, cy - 10, ax, ay);
  }, 6, 8, 6, 0.2);
  // the far half of the sling (its inside), shaded
  const [ax, ay, cx, cy, bx, by] = hammockCurve(x, y, 12);
  const p = (): void => {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, y - 18, bx, by);
    ctx.quadraticCurveTo(cx, cy + 8, ax, ay);
    ctx.closePath();
  };
  ctx.fillStyle = shadowOf(CANVAS, 0.35);
  p();
  ctx.fill();
  paintTex(ctx, p, 'weave', 0.3, 0.3, 0.3, x + seed, y);
  inkLine(ctx, p, CANVAS, 0.8, 0.45);
}

function hammockFront(ctx: Ctx, x: number, y: number, seed: number): void {
  // the near side of the sling, from its edge down round the cat's bottom
  const [ax, ay, cx, , bx, by] = hammockCurve(x, y, 12);
  const p = (): void => {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(cx, y - 2, bx, by);
    ctx.quadraticCurveTo(cx, y + 26, ax, ay);
    ctx.closePath();
  };
  ctx.fillStyle = CANVAS;
  p();
  ctx.fill();
  ctx.save();
  p();
  ctx.clip();
  // stripes of the canvas, and shade toward the bottom of the curve
  ctx.strokeStyle = rgba('#7FA6C4', 0.55);
  ctx.lineWidth = 3;
  for (const k of [-0.45, 0, 0.45]) {
    ctx.beginPath();
    ctx.moveTo(ax, ay + 4 + k * 8);
    ctx.quadraticCurveTo(cx, y + 6 + k * 10, bx, by + 4 + k * 8);
    ctx.stroke();
  }
  const g = ctx.createLinearGradient(0, y - 20, 0, y + 14);
  g.addColorStop(0, 'rgba(255,250,240,0.3)');
  g.addColorStop(1, rgba(shadowOf(CANVAS, 0.5), 0.45));
  ctx.fillStyle = g;
  ctx.fillRect(x - 60, y - 34, 120, 52);
  paintTex(ctx, p, 'weave', 0.3, 0.3, 0.3, x + seed, y);
  ctx.restore();
  inkLine(ctx, p, CANVAS, 1, 0.6);
  // the edge's hem catches the light
  ctx.strokeStyle = rgba('#FFFBF2', 0.8);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(ax + 2, ay + 1);
  ctx.quadraticCurveTo(cx, y - 1, bx - 2, by + 1);
  ctx.stroke();
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
