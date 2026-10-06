// The home's antics, painted live each frame: the ball of yarn, a scrap's
// tumbling cloud of dust (paws and ears poking out of it), the fluff that
// flies out and drifts down, claw scratches and little stars; and a hurt
// cat's sticking plaster, the fish that make it better, and how many more
// it needs.

import type { BreedLook } from '../physics/breeds';
import { lightOf, rgba, roundRect, shadowOf, softShadow, type Ctx } from '../render/paint';
import type { Flash, Fluff } from './antics';

const TAU = Math.PI * 2;
const YARN = '#6F9DD3';
const DUST = '#EBDFCF';
const DUST_DEEP = '#C9B49C';
const DUST_INK = '#77624F';

/** A ball of yarn, wound round and round (turned `ang` as it rolls), its loose end trailing. */
export function paintYarn(ctx: Ctx, x: number, y: number, r: number, ang: number, grounded: boolean): void {
  ctx.save();
  if (grounded) softShadow(ctx, x + 1.5, y + r + 0.6, r * 0.95, 2.2, 0.32);
  const deep = shadowOf(YARN, 0.38);
  // the loose end, lying out behind it
  const side = Math.sin(ang * 0.5) >= 0 ? 1 : -1;
  const a0 = ang + 2.3;
  ctx.strokeStyle = YARN;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(a0) * r * 0.9, y + Math.sin(a0) * r * 0.9);
  ctx.bezierCurveTo(x + side * r * 1.5, y + r * 0.2, x + side * r * 1.4, y + r * 1.05, x + side * r * 2.6, y + r * 0.95);
  ctx.stroke();
  // the ball
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
  g.addColorStop(0, lightOf(YARN, 0.45));
  g.addColorStop(0.55, YARN);
  g.addColorStop(1, deep);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  // wound strands, turning as it rolls
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r - 0.3, 0, TAU);
  ctx.clip();
  ctx.lineWidth = 0.85;
  for (let k = 0; k < 6; k++) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang + k * 0.53);
    ctx.strokeStyle = k % 2 ? rgba(deep, 0.55) : rgba(lightOf(YARN, 0.6), 0.5);
    ctx.beginPath();
    ctx.ellipse(0, (k % 3) * 0.6, r * 1.02, r * (0.34 + (k % 3) * 0.1), 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
  ctx.strokeStyle = rgba(shadowOf(YARN, 0.6), 0.8);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.38, y - r * 0.42, r * 0.22, r * 0.13, -0.6, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Deterministic noise in 0..1. */
function noise(seed: number, k: number): number {
  const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** A paw sticking out of the cloud at angle `a` (toe beans and all). */
function paw(ctx: Ctx, x: number, y: number, a: number, look: BreedLook, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a - Math.PI / 2);
  ctx.scale(s, s);
  roundRect(ctx, -4.8, -4, 9.6, 21, 4.8);
  ctx.fillStyle = look.body;
  ctx.fill();
  ctx.strokeStyle = rgba(shadowOf(look.body, 0.6), 0.85);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = look.innerEar;
  for (const tx of [-2.6, 0, 2.6]) {
    ctx.beginPath();
    ctx.arc(tx, 13.4 + (tx === 0 ? 0.9 : 0), 1.3, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(0, 9.6, 2.6, 2, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** An ear poking out of the cloud. */
function ear(ctx: Ctx, x: number, y: number, a: number, look: BreedLook, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a - Math.PI / 2);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(-7, -3);
  ctx.quadraticCurveTo(-1.6, 8, 0, 16);
  ctx.quadraticCurveTo(1.6, 8, 7, -3);
  ctx.closePath();
  ctx.fillStyle = look.body;
  ctx.fill();
  ctx.strokeStyle = rgba(shadowOf(look.body, 0.6), 0.85);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-3.2, 1.5);
  ctx.quadraticCurveTo(-0.8, 7, 0, 10);
  ctx.quadraticCurveTo(0.8, 7, 3.2, 1.5);
  ctx.closePath();
  ctx.fillStyle = look.innerEar;
  ctx.fill();
  ctx.restore();
}

/**
 * A scrap: a tumbling, bulging cloud of dust round (x, y), r across, with
 * speed lines whipping round it and a paw or an ear of one cat or the other
 * poking out here and there. `alpha` fades it in and out.
 */
export function paintDustCloud(ctx: Ctx, x: number, y: number, r: number, t: number, seed: number, looks: [BreedLook, BreedLook], alpha: number): void {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  softShadow(ctx, x, y + r * 0.72 + 2, r * 0.95, 4, 0.3);
  // speed lines whipping round
  ctx.strokeStyle = rgba(DUST_INK, 0.55);
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.6;
  for (let k = 0; k < 5; k++) {
    const a = t * 5.5 + k * 1.26;
    const rr = r * (1.08 + 0.1 * Math.sin(t * 7 + k));
    ctx.beginPath();
    ctx.ellipse(x, y, rr * 1.1, rr * 0.86, 0, a, a + 0.55);
    ctx.stroke();
  }
  // paws and ears poking out past the edge (a few at a time, changing every so often)
  const slot = Math.floor(t / 0.15);
  const big = 1.3 + (r - 50) / 110;
  for (let j = 0; j < 3; j++) {
    const k = slot * 3 + j;
    // (anywhere but straight down, into what they're scrapping on)
    const a = -Math.PI / 2 + (noise(seed, k) - 0.5) * 2 * Math.PI * 0.76;
    const look = looks[(k + (noise(seed, k + 99) < 0.5 ? 0 : 1)) % 2];
    const ex = x + Math.cos(a) * r * 1.0;
    const ey = y + Math.sin(a) * r * 0.86;
    if (noise(seed, k + 7) < 0.6) paw(ctx, ex, ey, a, look, big);
    else ear(ctx, ex, ey, a, look, big);
  }
  // the puffs: a lumpy bulging ring and a few in the middle, rolling round
  const puffs: [number, number, number][] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + t * 0.9 + Math.sin(t * 2.3 + k) * 0.16;
    const pr = r * (0.36 + 0.12 * noise(seed, k + 31) + 0.07 * Math.sin(t * 9 + k * 1.9 + seed));
    puffs.push([x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.54, pr]);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU - t * 1.3;
    puffs.push([x + Math.cos(a) * r * 0.22, y + Math.sin(a) * r * 0.18, r * (0.42 + 0.05 * Math.sin(t * 11 + k))]);
  }
  ctx.strokeStyle = DUST_INK;
  ctx.lineWidth = 3.2;
  for (const [px, py, pr] of puffs) {
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, TAU);
    ctx.stroke();
  }
  const g = ctx.createLinearGradient(0, y - r, 0, y + r * 0.9);
  g.addColorStop(0, lightOf(DUST, 0.5));
  g.addColorStop(0.55, DUST);
  g.addColorStop(1, DUST_DEEP);
  ctx.fillStyle = g;
  for (const [px, py, pr] of puffs) {
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, TAU);
    ctx.fill();
  }
  // each puff's own round shading: a crease where it meets the next, light on top
  ctx.strokeStyle = rgba(DUST_DEEP, 0.85);
  ctx.lineWidth = 1.3;
  for (const [px, py, pr] of puffs.slice(0, 8)) {
    ctx.beginPath();
    ctx.arc(px, py, pr * 0.92, Math.atan2(y - py, x - px) - 0.7, Math.atan2(y - py, x - px) + 0.7);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.8;
  for (const [px, py, pr] of puffs) {
    if (py > y + r * 0.1) continue;
    ctx.beginPath();
    ctx.arc(px, py, pr * 0.7, Math.PI * 1.15, Math.PI * 1.6);
    ctx.stroke();
  }
  // tumbling swirls inside
  ctx.strokeStyle = rgba(DUST_INK, 0.5);
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 3; k++) {
    const a = -t * 7 + k * 2.1;
    const rr = r * (0.22 + k * 0.12);
    ctx.beginPath();
    ctx.ellipse(x, y, rr * 1.2, rr * 0.8, 0, a, a + 1.4);
    ctx.stroke();
  }
  // grit
  ctx.fillStyle = rgba(DUST_INK, 0.5);
  for (let k = 0; k < 7; k++) {
    const a = noise(seed, k + Math.floor(t * 12) * 7) * TAU;
    const d = r * (1 + noise(seed, k + 50) * 0.35);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, 1 + noise(seed, k + 3), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** A tuft of fluff drifting down (it fades where it lands). */
export function paintFluff(ctx: Ctx, p: Fluff): void {
  const fade = Math.max(0, Math.min(1, (p.life - p.age) / 1.6, p.age * 8));
  if (fade <= 0) return;
  const s = p.size;
  ctx.save();
  ctx.globalAlpha = fade * 0.95;
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.fillStyle = p.color;
  for (const [ox, oy, rr] of [
    [0, 0, 1],
    [0.95, 0.35, 0.72],
    [-0.8, 0.45, 0.66],
    [0.2, -0.75, 0.6],
  ]) {
    ctx.beginPath();
    ctx.arc(ox * s, oy * s, rr * s, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = rgba(p.light, 0.85);
  ctx.lineWidth = 0.7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-s * 0.9, -s * 0.2);
  ctx.quadraticCurveTo(0, -s * 1.3, s * 1.2, -s * 0.5);
  ctx.stroke();
  ctx.strokeStyle = rgba(shadowOf(p.color, 0.5), 0.6);
  ctx.beginPath();
  ctx.moveTo(s * 1.4, s * 0.6);
  ctx.quadraticCurveTo(s * 2.1, s * 0.9, s * 2.5, s * 0.4);
  ctx.stroke();
  ctx.restore();
}

/** A flash of claws (three white scratches) or a little star, popping and fading. */
export function paintFlash(ctx: Ctx, fl: Flash): void {
  const u = fl.age / fl.life;
  const pop = u < 0.25 ? 0.6 + 1.6 * u : 1;
  ctx.save();
  ctx.translate(fl.x, fl.y);
  ctx.rotate(fl.ang);
  ctx.scale(pop, pop);
  ctx.globalAlpha = 1 - Math.max(0, (u - 0.5) / 0.5);
  ctx.lineCap = 'round';
  if (fl.kind === 'scratch') {
    for (const [w, c] of [
      [3.6, 'rgba(92,58,70,0.65)'],
      [1.8, '#FFFFFF'],
    ] as const) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(-9, k * 3.6 - 1);
        ctx.quadraticCurveTo(0, k * 3.6 + 2.2, 9.5, k * 3.6 - 1.8);
      }
      ctx.stroke();
    }
  } else {
    const s = 7;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const rr = k % 2 ? s * 0.38 : s;
      if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = '#F6D46B';
    ctx.fill();
    ctx.strokeStyle = '#B98A2E';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/** A sticking plaster on a hurt cat's head (two crossed, for a bad scratch), `s` its face's scale. */
export function paintPlaster(ctx: Ctx, x: number, y: number, s: number, ang: number, two: boolean): void {
  const strip = (a: number): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    roundRect(ctx, -7.5 * s, -2.7 * s, 15 * s, 5.4 * s, 2.5 * s);
    ctx.fillStyle = '#F0D2AC';
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,112,80,0.75)';
    ctx.lineWidth = 0.7 * s;
    ctx.stroke();
    roundRect(ctx, -2.5 * s, -2.1 * s, 5 * s, 4.2 * s, 1 * s);
    ctx.fillStyle = '#FBEAD6';
    ctx.fill();
    ctx.fillStyle = 'rgba(176,138,104,0.8)';
    for (const ox of [-5.4, -4.2, 4.2, 5.4])
      for (const oy of [-0.9, 0.9]) {
        ctx.beginPath();
        ctx.arc(ox * s, oy * s, 0.35 * s, 0, TAU);
        ctx.fill();
      }
    ctx.restore();
  };
  strip(ang);
  if (two) strip(ang + 1.25);
}

/** A little golden fish (a treat), `s` its size. */
export function paintFish(ctx: Ctx, x: number, y: number, s: number, ang = 0): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(-6.5, 0);
  ctx.quadraticCurveTo(-1, -4.4, 4.5, -0.6);
  ctx.lineTo(7.8, -3.4);
  ctx.lineTo(7.2, 0);
  ctx.lineTo(7.8, 3.4);
  ctx.lineTo(4.5, 0.6);
  ctx.quadraticCurveTo(-1, 4.4, -6.5, 0);
  ctx.closePath();
  ctx.fillStyle = '#F2C14E';
  ctx.fill();
  ctx.strokeStyle = '#B98A2E';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.fillStyle = '#5A4630';
  ctx.beginPath();
  ctx.arc(-3.6, -0.6, 0.8, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Over a hurt cat: a fish in a bubble, ringed by how much of the way better it is. */
export function paintHealBadge(ctx: Ctx, x: number, y: number, fed: number, need: number, t: number): void {
  const yy = y + Math.sin(t * 3) * 1.5;
  const R = 11;
  ctx.save();
  softShadow(ctx, x + 1, yy + R + 2, R * 0.8, 2, 0.18);
  ctx.beginPath();
  ctx.arc(x, yy, R, 0, TAU);
  ctx.fillStyle = '#FFFCF6';
  ctx.fill();
  ctx.strokeStyle = '#E6DED2';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(x, yy, R - 1.4, 0, TAU);
  ctx.stroke();
  if (fed > 0) {
    ctx.strokeStyle = '#6FBF84';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, yy, R - 1.4, -Math.PI / 2, -Math.PI / 2 + (TAU * Math.min(fed, need)) / need);
    ctx.stroke();
  }
  paintFish(ctx, x + 0.4, yy, 0.95, -0.15);
  // the little point under the bubble
  ctx.fillStyle = '#FFFCF6';
  ctx.beginPath();
  ctx.moveTo(x - 3.5, yy + R - 1.5);
  ctx.lineTo(x, yy + R + 4);
  ctx.lineTo(x + 3.5, yy + R - 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
