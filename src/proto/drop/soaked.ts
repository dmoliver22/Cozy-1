// Cat Drop: a soaked cat. Bath time leaves the cat darker and sleek (wet fur
// lies flat, so no tufts), with a wet sheen, suds piled on its head and stuck
// to its sides, and drops gathering underneath before they fall.

import type { Breed, BreedLook } from '../../physics/breeds';
import type { SoftBody } from '../../physics/softbody';
import type { CatView } from '../../render/catArt';
import { mix, shadowOf, specular, type Ctx } from '../../render/paint';
import { drawBubble } from './foam';

/** (by look: your own cat's changes when you restyle it) */
const wet = new WeakMap<BreedLook, Breed>();

/** The breed as it looks soaked: darker and a touch cooler, its fur lying flat. */
export function wetBreed(b: Breed): Breed {
  let w = wet.get(b.look);
  if (w) return w;
  const l = b.look;
  // wet fur darkens, pale coats most of all, and goes a little cool
  const soak = (c: string, k: number): string => mix(shadowOf(c, k * (0.75 + 0.45 * lum(c))), '#5A6484', 0.12);
  const look: BreedLook = {
    ...l,
    body: soak(l.body, 0.4),
    shade: soak(l.shade, 0.32),
    light: soak(l.light, 0.26),
    accent: soak(l.accent, 0.3),
    pattern: l.pattern === 'fluff' ? 'none' : l.pattern,
    fluff: 0,
    tailFluff: 0,
    earTufts: false,
  };
  w = { ...b, look };
  wet.set(b.look, w);
  return w;
}

/** Rough lightness of a hex colour, 0..1. */
function lum(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  return (0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
}

/** Paint a body as another breed (the soaked look) for the length of `fn`. */
export function withBreed(b: SoftBody, breed: Breed, fn: () => void): void {
  const o = b as unknown as { breed: Breed };
  const was = o.breed;
  o.breed = breed;
  try {
    fn();
  } finally {
    o.breed = was;
  }
}

/** A point on the underside of the cat's outline, `u` 0..1 from left to right. */
export function soakedBottom(v: CatView, u: number): { x: number; y: number } {
  const x = v.box.x0 + (v.box.x1 - v.box.x0) * (0.18 + 0.64 * u);
  const n = v.ox.length;
  let y = -Infinity;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const x0 = v.ox[i];
    const x1 = v.ox[j];
    if ((x0 - x) * (x1 - x) > 0 || x0 === x1) continue;
    const yy = v.oy[i] + ((v.oy[j] - v.oy[i]) * (x - x0)) / (x1 - x0);
    if (yy > y) y = yy;
  }
  return { x, y: y === -Infinity ? v.box.y1 : y };
}

/** The outline node furthest out in direction `ang` from the middle of the cat. */
function rimPoint(v: CatView, ang: number): { x: number; y: number } {
  const cx = (v.box.x0 + v.box.x1) / 2;
  const cy = (v.box.y0 + v.box.y1) / 2;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  let best = -Infinity;
  let bx = cx;
  let by = cy;
  for (let i = 0; i < v.ox.length; i++) {
    const d = (v.ox[i] - cx) * ux + (v.oy[i] - cy) * uy;
    if (d > best) {
      best = d;
      bx = v.ox[i];
      by = v.oy[i];
    }
  }
  return { x: bx, y: by };
}

/** A drop gathering under the fur: a bead on a neck that stretches as it fills. */
function bead(ctx: Ctx, x: number, y: number, len: number, rr: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - 1);
  ctx.bezierCurveTo(x + rr * 0.3, y + len * 0.45, x + rr * 1.05, y + len - rr * 0.6, x + rr, y + len);
  ctx.arc(x, y + len, rr, 0, Math.PI);
  ctx.bezierCurveTo(x - rr * 1.05, y + len - rr * 0.6, x - rr * 0.3, y + len * 0.45, x, y - 1);
  ctx.fillStyle = 'rgba(166,204,240,0.92)';
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(x - rr * 0.35, y + len - rr * 0.25, rr * 0.28, rr * 0.4, -0.4, 0, Math.PI * 2);
  ctx.fill();
}

/** Suds piled on the head, a few stuck to the sides, a wet sheen and drops gathering underneath. */
export function drawSoaked(ctx: Ctx, b: SoftBody, v: CatView, t: number, ppu: number): void {
  const r = b.p.radius;
  const box = v.box;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  // the sheen of wet fur: a glossy band inside the lit edge, and a couple of streaks
  const P = new Path2D();
  P.moveTo(v.sx[0], v.sy[0]);
  for (let i = 1; i < v.sm; i++) P.lineTo(v.sx[i], v.sy[i]);
  P.closePath();
  ctx.save();
  ctx.clip(P);
  const g = ctx.createLinearGradient(box.x0, box.y0, box.x0 + w * 0.7, box.y0 + h * 0.8);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.5, 'rgba(232,240,255,0.12)');
  g.addColorStop(1, 'rgba(232,240,255,0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = r * 0.2;
  ctx.stroke(P);
  // water darkening the fur low down
  const lo = ctx.createLinearGradient(0, box.y1 - h * 0.45, 0, box.y1);
  lo.addColorStop(0, 'rgba(58,64,104,0)');
  lo.addColorStop(1, 'rgba(58,64,104,0.22)');
  ctx.fillStyle = lo;
  ctx.fillRect(box.x0 - 2, box.y1 - h * 0.45, w + 4, h * 0.45 + 2);
  ctx.restore();
  specular(ctx, box.x0 + w * 0.17, box.y0 + h * 0.56, r * 0.46, r * 0.05, -1.25, 0.55);
  specular(ctx, box.x1 - w * 0.15, box.y0 + h * 0.66, r * 0.3, r * 0.035, 1.3, 0.35);
  // drops gathering underneath (they fall as drips)
  for (let k = 0; k < 3; k++) {
    const p = soakedBottom(v, 0.12 + k * 0.38);
    const ph = (t * 0.85 + k * 0.37) % 1;
    bead(ctx, p.x, p.y - 1.5, 1.5 + ph * ph * 6, 1.7 + ph * 0.9);
  }
  // suds stuck to the sides
  const S = Math.max(5, r * 0.2);
  const sides: [number, number, number][] = [
    [-0.25, 0.85, 1],
    [3.55, 0.75, -1],
  ];
  for (const [ang, size, side] of sides) {
    const p = rimPoint(v, ang);
    const x = p.x - side * S * 0.25;
    const y = p.y;
    const wob = Math.sin(t * 2.4 + ang) * 0.05;
    drawBubble(ctx, x, y, S * size * (1 + wob), 0, ppu);
    drawBubble(ctx, x + side * S * 0.75, y - S * 0.55, S * size * 0.62, 1, ppu);
    drawBubble(ctx, x - side * S * 0.2, y + S * 0.75, S * size * 0.5, 2, ppu);
  }
  // a pile of suds on the head, between the ears
  const hx = v.ears.length === 2 ? (v.ears[0].x + v.ears[1].x) / 2 : v.hx;
  const hy = v.hy - S * 0.2;
  const pile: [number, number, number, number][] = [
    [-1.7, 0.45, 0.75, 2],
    [1.75, 0.5, 0.7, 1],
    [-1.05, 0.05, 1.0, 1],
    [1.1, 0.1, 0.95, 2],
    [0, -0.15, 1.2, 0],
    [-0.6, -1.1, 0.9, 1],
    [0.65, -1.05, 0.85, 2],
    [0.05, -1.95, 0.7, 0],
    [0.95, -1.9, 0.38, 1],
  ];
  for (const [dx, dy, s, tint] of pile) {
    const wob = Math.sin(t * 2.2 + dx * 1.7) * 0.04;
    drawBubble(ctx, hx + dx * S, hy + dy * S, S * s * (1 + wob), tint, ppu);
  }
}
