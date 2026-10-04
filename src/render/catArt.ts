// Drawing the cats: round squishy bodies, two ears, dot eyes, a tiny mouth and
// a tail. The face always floats to the top of the blob ("cats land on their
// feet"), so a cat poured into a teacup still reads as a loaf with ears.

import type { BreedLook } from '../physics/breeds';
import { NODE_RADIUS, type SoftBody } from '../physics/softbody';
import { clamp } from '../util/math';
import { hash01, shade, smoothClosedPath, tint, type Ctx } from './paint';

export type Expression = 'open' | 'happy' | 'sleepy' | 'wide' | 'squint' | 'blink' | 'content';

export interface CatPose {
  expression: Expression;
  /** -1..1 horizontal look direction. */
  look: number;
  /** Seated in a container whose rim is at this y (tail drapes over it). */
  rimY: number | null;
  /** 0..1 purr intensity: drives ear wiggle and tail. */
  purr: number;
  /** Grabbed: ears go out sideways. */
  grabbed: boolean;
  /** Golden glow at the reveal. */
  glow: number;
  /** Silhouette (locked collection cards). */
  silhouette?: boolean;
}

export class CatView {
  hx = 0;
  hy = 0;
  inited = false;
  t = 0;
  blinkAt = 2 + Math.random() * 3;
  twitchAt = 1 + Math.random() * 4;
  twitch = 0;
  tailPhase = Math.random() * 10;
  side: 1 | -1;
  /** Outline buffers */
  ox: Float64Array;
  oy: Float64Array;
  nx: Float64Array;
  ny: Float64Array;
  seed: number;

  constructor(n: number, seed: number) {
    this.ox = new Float64Array(n);
    this.oy = new Float64Array(n);
    this.nx = new Float64Array(n);
    this.ny = new Float64Array(n);
    this.seed = seed;
    this.side = seed % 2 === 0 ? 1 : -1;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.twitch > 0) this.twitch = Math.max(0, this.twitch - dt * 6);
    if (this.t > this.twitchAt) {
      this.twitch = 1;
      this.twitchAt = this.t + 2 + Math.random() * 5;
    }
  }

  blinking(): boolean {
    if (this.t > this.blinkAt + 0.14) this.blinkAt = this.t + 2.2 + Math.random() * 3.5;
    return this.t > this.blinkAt;
  }
}

/** Compute the visible outline (nodes pushed out by the collision skin). */
function computeOutline(b: SoftBody, v: CatView): { minY: number; maxY: number; minX: number; maxX: number; cx: number } {
  const n = b.n;
  const skin = NODE_RADIUS * 0.95;
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let cx = 0;
  for (let i = 0; i < n; i++) {
    const ip = (i + 1) % n;
    const im = (i + n - 1) % n;
    const tx = b.x[ip] - b.x[im];
    const ty = b.y[ip] - b.y[im];
    const l = Math.hypot(tx, ty) || 1;
    const nx = ty / l;
    const ny = -tx / l;
    v.nx[i] = nx;
    v.ny[i] = ny;
    const x = b.x[i] + nx * skin;
    const y = b.y[i] + ny * skin;
    v.ox[i] = x;
    v.oy[i] = y;
    cx += x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  return { minY, maxY, minX, maxX, cx: cx / n };
}

function bodyPath(ctx: Ctx, v: CatView, n: number): void {
  smoothClosedPath(ctx, v.ox, v.oy, n);
}

/** Index of the outline point nearest to x among the upper part of the body. */
function nearestTopIndex(v: CatView, n: number, x: number, yLimit: number): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    if (v.oy[i] > yLimit) continue;
    const d = Math.abs(v.ox[i] - x) + (v.oy[i] - yLimit) * -0.01;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (best < 0) {
    // fall back to highest point
    let my = Infinity;
    for (let i = 0; i < n; i++)
      if (v.oy[i] < my) {
        my = v.oy[i];
        best = i;
      }
  }
  return best;
}

function drawEar(ctx: Ctx, bx: number, by: number, dx: number, dy: number, size: number, look: BreedLook, outline: string, lw: number, tufts: boolean): void {
  // Ear triangle with a rounded tip, base sunk into the head.
  const px = -dy;
  const py = dx;
  const half = size * 0.58;
  const tipX = bx + dx * size;
  const tipY = by + dy * size;
  const b1x = bx - dx * size * 0.35 + px * half;
  const b1y = by - dy * size * 0.35 + py * half;
  const b2x = bx - dx * size * 0.35 - px * half;
  const b2y = by - dy * size * 0.35 - py * half;
  ctx.beginPath();
  ctx.moveTo(b1x, b1y);
  ctx.quadraticCurveTo(bx + dx * size * 0.55 + px * half * 0.55, by + dy * size * 0.55 + py * half * 0.55, tipX + px * size * 0.06, tipY + py * size * 0.06);
  ctx.quadraticCurveTo(tipX + dx * size * 0.05, tipY + dy * size * 0.05, tipX - px * size * 0.06, tipY - py * size * 0.06);
  ctx.quadraticCurveTo(bx + dx * size * 0.55 - px * half * 0.55, by + dy * size * 0.55 - py * half * 0.55, b2x, b2y);
  ctx.closePath();
  ctx.fillStyle = look.body;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // inner ear
  const ih = half * 0.5;
  ctx.beginPath();
  ctx.moveTo(bx + dx * size * 0.05 + px * ih, by + dy * size * 0.05 + py * ih);
  ctx.quadraticCurveTo(bx + dx * size * 0.5 + px * ih * 0.4, by + dy * size * 0.5 + py * ih * 0.4, bx + dx * size * 0.78, by + dy * size * 0.78);
  ctx.quadraticCurveTo(bx + dx * size * 0.5 - px * ih * 0.4, by + dy * size * 0.5 - py * ih * 0.4, bx + dx * size * 0.05 - px * ih, by + dy * size * 0.05 - py * ih);
  ctx.closePath();
  ctx.fillStyle = look.innerEar;
  ctx.globalAlpha *= 0.85;
  ctx.fill();
  ctx.globalAlpha /= 0.85;
  if (tufts) {
    ctx.strokeStyle = look.accent;
    ctx.lineWidth = lw * 0.9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + dx * size * 0.32 + px * size * 0.06, tipY + dy * size * 0.32 + py * size * 0.06);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + dx * size * 0.26 - px * size * 0.1, tipY + dy * size * 0.26 - py * size * 0.1);
    ctx.stroke();
  }
}

function drawTail(
  ctx: Ctx,
  rx: number,
  ry: number,
  side: number,
  r: number,
  look: BreedLook,
  outline: string,
  lw: number,
  swish: number,
  draped: boolean,
): void {
  const L = r * (0.95 + look.tailFluff * 0.15);
  const thick = r * (0.17 + look.tailFluff * 0.1);
  let c1x: number;
  let c1y: number;
  let ex: number;
  let ey: number;
  if (draped) {
    c1x = rx + side * L * 0.55;
    c1y = ry - L * 0.12;
    ex = rx + side * L * (0.72 + swish * 0.06);
    ey = ry + L * (0.55 + swish * 0.08);
  } else {
    c1x = rx + side * L * 0.7;
    c1y = ry + L * 0.05;
    ex = rx + side * L * (0.78 + swish * 0.12);
    ey = ry - L * (0.62 - swish * 0.18);
  }
  const N = 12;
  const lx: number[] = [];
  const ly: number[] = [];
  const rxs: number[] = [];
  const rys: number[] = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    const x = a * rx + b * c1x + c * ex;
    const y = a * ry + b * c1y + c * ey;
    // derivative
    const dx = 2 * (1 - t) * (c1x - rx) + 2 * t * (ex - c1x);
    const dy = 2 * (1 - t) * (c1y - ry) + 2 * t * (ey - c1y);
    const l = Math.hypot(dx, dy) || 1;
    const w = thick * (1 - t * 0.45) * (k === N ? 0.9 : 1);
    lx.push(x - (dy / l) * w * 0.5);
    ly.push(y + (dx / l) * w * 0.5);
    rxs.push(x + (dy / l) * w * 0.5);
    rys.push(y - (dx / l) * w * 0.5);
  }
  ctx.beginPath();
  ctx.moveTo(lx[0], ly[0]);
  for (let k = 1; k <= N; k++) ctx.lineTo(lx[k], ly[k]);
  // round tip
  const tipR = Math.hypot(lx[N] - rxs[N], ly[N] - rys[N]) / 2;
  const tx = (lx[N] + rxs[N]) / 2;
  const ty = (ly[N] + rys[N]) / 2;
  const ang = Math.atan2(ly[N] - rys[N], lx[N] - rxs[N]);
  ctx.arc(tx, ty, tipR, ang, ang + Math.PI * (side > 0 ? -1 : 1), side > 0);
  for (let k = N; k >= 0; k--) ctx.lineTo(rxs[k], rys[k]);
  ctx.closePath();
  ctx.fillStyle = look.body;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.stroke();
  if (look.pattern === 'tabby' || look.pattern === 'mane') {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = look.accent;
    ctx.globalAlpha *= 0.55;
    ctx.lineWidth = thick * 0.35;
    for (let k = 3; k < N; k += 3) {
      ctx.beginPath();
      ctx.moveTo(lx[k], ly[k]);
      ctx.lineTo(rxs[k], rys[k]);
      ctx.stroke();
    }
    ctx.restore();
  } else if (look.pattern === 'patches') {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = look.light;
    ctx.beginPath();
    ctx.arc(tx, ty, tipR * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Main cat draw. Body nodes come straight from the physics. */
export function drawCat(ctx: Ctx, b: SoftBody, v: CatView, pose: CatPose, scaleHint = 1): void {
  const look = b.breed.look;
  const n = b.n;
  const r = b.p.radius;
  const ol = computeOutline(b, v);
  const h = ol.maxY - ol.minY;
  // Head anchor: weighted top of the blob, smoothed over time.
  let wx = 0;
  let wy = 0;
  let ws = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.exp(-(v.oy[i] - ol.minY) / (0.22 * r));
    wx += v.ox[i] * w;
    wy += v.oy[i] * w;
    ws += w;
  }
  const tx = wx / ws;
  const ty = wy / ws;
  if (!v.inited) {
    v.hx = tx;
    v.hy = ty;
    v.inited = true;
  } else {
    v.hx += (tx - v.hx) * 0.35;
    v.hy += (ty - v.hy) * 0.5;
  }
  // keep anchor horizontally inside the body span
  const hx = clamp(v.hx, ol.minX + r * 0.45, ol.maxX - r * 0.45);
  const hy = Math.max(v.hy, ol.minY);
  const lw = Math.max(1.6, 2.1 * scaleHint) * (r / 30) ** 0.25;
  const outline = pose.silhouette ? look.shade : shade(look.body, 0.28);

  // --- tail (behind) ---
  const side = v.side;
  if (!pose.silhouette) {
    const yTop = hy + h * 0.25;
    const yBot = pose.rimY !== null ? Math.min(pose.rimY - 5, ol.maxY - h * 0.15) : ol.maxY - h * 0.22;
    let best = -1;
    let bestX = side > 0 ? -Infinity : Infinity;
    for (let i = 0; i < n; i++) {
      const y = v.oy[i];
      if (y < yTop || y > yBot) continue;
      const x = v.ox[i];
      if (side > 0 ? x > bestX : x < bestX) {
        bestX = x;
        best = i;
      }
    }
    if (best >= 0) {
      const swish = Math.sin(v.t * (1.4 + pose.purr * 0.8) + v.tailPhase) * (0.6 + pose.purr * 0.4) + (pose.grabbed ? Math.sin(v.t * 9) * 0.5 : 0);
      drawTail(ctx, v.ox[best] - side * r * 0.12, v.oy[best], side, r, look, outline, lw, swish, pose.rimY !== null);
    }
  }

  // --- ears (behind body) ---
  const earSize = r * 0.46 * look.earSize;
  const spread = Math.min(r * 0.62, (ol.maxX - ol.minX) * 0.3);
  const earLimit = hy + Math.max(r * 0.55, h * 0.35);
  const li = nearestTopIndex(v, n, hx - spread, earLimit);
  const ri = nearestTopIndex(v, n, hx + spread, earLimit);
  const twitch = v.twitch * Math.sin(v.t * 40) * 0.25;
  for (const [idx, s] of [
    [li, -1],
    [ri, 1],
  ] as const) {
    if (idx < 0) continue;
    let dx = v.nx[idx] * 0.45;
    let dy = v.ny[idx] * 0.45 - 1;
    if (pose.grabbed) {
      dx += s * 0.9;
      dy += 0.35;
    }
    const tw = s > 0 ? twitch : -twitch * 0.3;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const cx = Math.cos(tw);
    const sx = Math.sin(tw);
    const ddx = dx * cx - dy * sx;
    const ddy = dx * sx + dy * cx;
    drawEar(ctx, v.ox[idx] - v.nx[idx] * 2, v.oy[idx] - v.ny[idx] * 2, ddx, ddy, earSize, look, outline, lw, look.earTufts);
  }

  // --- body ---
  bodyPath(ctx, v, n);
  ctx.fillStyle = pose.silhouette ? look.shade : look.body;
  ctx.fill();
  if (!pose.silhouette) {
    ctx.save();
    bodyPath(ctx, v, n);
    ctx.clip();
    const cxm = ol.cx;
    // belly shade
    const g = ctx.createRadialGradient(cxm, ol.maxY + r * 0.2, r * 0.2, cxm, ol.maxY + r * 0.2, Math.max(r * 1.3, (ol.maxX - ol.minX) * 0.7));
    g.addColorStop(0, shade(look.body, 0.18));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(ol.minX - 5, ol.minY - 5, ol.maxX - ol.minX + 10, ol.maxY - ol.minY + 10);
    drawPattern(ctx, look, hx, hy, ol, r, v);
    // sunny highlight
    const g2 = ctx.createRadialGradient(hx - r * 0.35, hy + r * 0.2, 0, hx - r * 0.35, hy + r * 0.2, r * 0.9);
    g2.addColorStop(0, 'rgba(255,248,230,0.35)');
    g2.addColorStop(1, 'rgba(255,248,230,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(ol.minX - 5, ol.minY - 5, ol.maxX - ol.minX + 10, ol.maxY - ol.minY + 10);
    if (pose.glow > 0) {
      ctx.fillStyle = `rgba(255,214,120,${0.22 * pose.glow})`;
      ctx.fillRect(ol.minX - 5, ol.minY - 5, ol.maxX - ol.minX + 10, ol.maxY - ol.minY + 10);
    }
    ctx.restore();
  }
  // outline with a brushy edge
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = lw;
  bodyPath(ctx, v, n);
  ctx.stroke();
  if (look.fluff > 0.2 && !pose.silhouette) drawFluff(ctx, v, n, look, outline, lw, r);
  ctx.restore();

  if (pose.silhouette) return;
  // --- face ---
  const faceDrop = Math.min(r * 0.5, Math.max(r * 0.2, (ol.maxY - hy) * 0.42));
  const fs = clamp(r / 30, 0.78, 1.3);
  const fx = hx + pose.look * r * 0.12;
  const fy = hy + faceDrop;
  drawFace(ctx, look, fx, fy, fs, r, pose, v);
}

function drawPattern(ctx: Ctx, look: BreedLook, hx: number, hy: number, ol: { minY: number; maxY: number; minX: number; maxX: number; cx: number }, r: number, v: CatView): void {
  const w = ol.maxX - ol.minX;
  const h = ol.maxY - ol.minY;
  switch (look.pattern) {
    case 'tabby': {
      ctx.strokeStyle = look.accent;
      ctx.globalAlpha = 0.5;
      ctx.lineCap = 'round';
      ctx.lineWidth = r * 0.13;
      // side stripes
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue;
        const sx = hx + k * w * 0.2;
        ctx.beginPath();
        ctx.moveTo(sx - k * 2, ol.minY + h * 0.1);
        ctx.quadraticCurveTo(sx + k * w * 0.06, ol.minY + h * 0.45, sx + k * w * 0.02, ol.minY + h * 0.75);
        ctx.stroke();
      }
      // forehead M
      ctx.lineWidth = r * 0.07;
      const fy = hy + r * 0.12;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(hx + k * r * 0.13, fy);
        ctx.lineTo(hx + k * r * 0.1, fy + r * 0.16);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // light muzzle
      ctx.fillStyle = look.light;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.ellipse(hx, hy + Math.min(r * 0.62, h * 0.55), r * 0.36, r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'patches': {
      ctx.fillStyle = look.accent;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.ellipse(hx - r * 0.42 * v.side, hy + r * 0.2, r * 0.42, r * 0.34, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = look.light;
      ctx.beginPath();
      ctx.ellipse(hx, ol.maxY, Math.max(r * 0.55, w * 0.32), Math.max(r * 0.55, h * 0.48), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(hx, hy + Math.min(r * 0.62, h * 0.55), r * 0.33, r * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'belly': {
      ctx.fillStyle = look.light;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(hx, ol.maxY + r * 0.05, Math.max(r * 0.55, w * 0.3), Math.max(r * 0.5, h * 0.45), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(hx, hy + Math.min(r * 0.6, h * 0.55), r * 0.3, r * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      // faint ginger stripes on the head
      ctx.strokeStyle = look.accent;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = r * 0.08;
      ctx.lineCap = 'round';
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(hx + k * r * 0.14, hy + r * 0.04);
        ctx.lineTo(hx + k * r * 0.12, hy + r * 0.2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'fluff': {
      ctx.fillStyle = look.light;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.ellipse(hx, hy + Math.min(r * 0.75, h * 0.62), r * 0.55, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'mane': {
      // darker saddle on the back, light ruff under the chin
      ctx.fillStyle = look.accent;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.ellipse(hx, ol.minY - r * 0.1, w * 0.55, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = look.light;
      const ry = hy + Math.min(r * 0.78, h * 0.62);
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI * (k / 8);
        const rr = r * (0.5 + (k % 2) * 0.07);
        const x = hx + Math.cos(a) * rr;
        const y = ry + Math.sin(a) * rr * 0.55;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(hx - r * 0.5, ry - r * 0.05);
      ctx.quadraticCurveTo(hx, ry - r * 0.25, hx + r * 0.5, ry - r * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'wrinkles': {
      ctx.strokeStyle = look.accent;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = Math.max(1.2, r * 0.05);
      ctx.lineCap = 'round';
      for (let k = 0; k < 3; k++) {
        const yy = hy + r * (0.1 + k * 0.08);
        ctx.beginPath();
        ctx.moveTo(hx - r * (0.22 - k * 0.03), yy);
        ctx.quadraticCurveTo(hx, yy - r * 0.06, hx + r * (0.22 - k * 0.03), yy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'none': {
      // velvety sheen
      const g = ctx.createRadialGradient(hx + r * 0.3, hy + r * 0.3, 0, hx + r * 0.3, hy + r * 0.3, r);
      g.addColorStop(0, 'rgba(150,140,200,0.25)');
      g.addColorStop(1, 'rgba(150,140,200,0)');
      ctx.fillStyle = g;
      ctx.fillRect(ol.minX, ol.minY, w, h);
      break;
    }
  }
}

function drawFluff(ctx: Ctx, v: CatView, n: number, look: BreedLook, outline: string, lw: number, r: number): void {
  // Soft scalloped tufts around the outline (gouache brush dabs).
  const count = Math.round(n * (0.45 + look.fluff * 0.45));
  ctx.lineWidth = lw * 0.85;
  ctx.strokeStyle = outline;
  ctx.fillStyle = look.body;
  for (let k = 0; k < count; k++) {
    const f = ((k + hash01(k, v.seed) * 0.3) / count) * n;
    const i = Math.floor(f) % n;
    const j = (i + 1) % n;
    const t = f - Math.floor(f);
    const x = v.ox[i] + (v.ox[j] - v.ox[i]) * t;
    const y = v.oy[i] + (v.oy[j] - v.oy[i]) * t;
    const nx = v.nx[i] + (v.nx[j] - v.nx[i]) * t;
    const ny = v.ny[i] + (v.ny[j] - v.ny[i]) * t;
    if (ny > 0.7) continue; // no tufts under the belly
    const rad = r * (0.08 + look.fluff * 0.05) * (0.75 + hash01(k, v.seed + 1) * 0.5);
    const cx = x + nx * rad * 0.25;
    const cy = y + ny * rad * 0.25;
    const a = Math.atan2(ny, nx);
    ctx.beginPath();
    ctx.arc(cx, cy, rad, a - 1.35, a + 1.35);
    ctx.fill();
    ctx.stroke();
  }
}

function drawFace(ctx: Ctx, look: BreedLook, fx: number, fy: number, fs: number, r: number, pose: CatPose, v: CatView): void {
  const persona = look.persona;
  const spacing = r * (persona === 'zippy' ? 0.36 : persona === 'dramatic' ? 0.32 : 0.34) * (r < 26 ? 1.05 : 1);
  let expr = pose.expression;
  if ((expr === 'open' || expr === 'content') && v.blinking()) expr = 'blink';
  const eyeR = (persona === 'zippy' ? 3.3 : persona === 'void' ? 3.4 : 2.8) * fs;
  const ex1 = fx - spacing;
  const ex2 = fx + spacing;
  const ey = fy - 1.5 * fs;
  // cheeks
  ctx.fillStyle = look.cheek;
  ctx.globalAlpha = persona === 'void' ? 0.35 : 0.45;
  ctx.beginPath();
  ctx.ellipse(ex1 - 2 * fs, ey + 6.5 * fs, 4.6 * fs, 2.9 * fs, 0, 0, Math.PI * 2);
  ctx.ellipse(ex2 + 2 * fs, ey + 6.5 * fs, 4.6 * fs, 2.9 * fs, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = look.eye;
  ctx.fillStyle = look.eye;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.9 * fs;
  const drawEye = (x: number, side: number): void => {
    switch (expr) {
      case 'happy':
      case 'content':
        ctx.beginPath();
        ctx.arc(x, ey + 1.2 * fs, eyeR * 1.05, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        break;
      case 'sleepy':
      case 'blink':
        ctx.beginPath();
        ctx.moveTo(x - eyeR, ey);
        ctx.quadraticCurveTo(x, ey + eyeR * 0.7, x + eyeR, ey);
        ctx.stroke();
        break;
      case 'squint':
        ctx.beginPath();
        ctx.moveTo(x - side * eyeR, ey - eyeR * 0.8);
        ctx.lineTo(x + side * eyeR * 0.7, ey);
        ctx.lineTo(x - side * eyeR, ey + eyeR * 0.8);
        ctx.stroke();
        break;
      case 'wide': {
        ctx.beginPath();
        ctx.arc(x, ey, eyeR * 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = persona === 'void' ? '#3E3A4F' : '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x + eyeR * 0.4, ey - eyeR * 0.45, eyeR * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = look.eye;
        break;
      }
      default: {
        ctx.beginPath();
        ctx.arc(x + pose.look * 0.8, ey, eyeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = persona === 'void' ? '#3E3A4F' : '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x + pose.look * 0.8 + eyeR * 0.35, ey - eyeR * 0.4, eyeR * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = look.eye;
      }
    }
    if (persona === 'dramatic' && expr !== 'wide') {
      // lashes
      ctx.lineWidth = 1.3 * fs;
      ctx.beginPath();
      ctx.moveTo(x + side * eyeR * 0.9, ey - eyeR * 0.2);
      ctx.lineTo(x + side * eyeR * 1.6, ey - eyeR * 0.9);
      ctx.stroke();
      ctx.lineWidth = 1.9 * fs;
    }
  };
  drawEye(ex1, -1);
  drawEye(ex2, 1);
  // nose
  const ny = fy + 3.5 * fs;
  ctx.fillStyle = look.nose;
  ctx.beginPath();
  ctx.moveTo(fx - 2.4 * fs, ny - 1.2 * fs);
  ctx.quadraticCurveTo(fx, ny - 2.2 * fs, fx + 2.4 * fs, ny - 1.2 * fs);
  ctx.quadraticCurveTo(fx + 0.4 * fs, ny + 1.6 * fs, fx, ny + 1.7 * fs);
  ctx.quadraticCurveTo(fx - 0.4 * fs, ny + 1.6 * fs, fx - 2.4 * fs, ny - 1.2 * fs);
  ctx.fill();
  // mouth
  ctx.strokeStyle = persona === 'void' ? '#8E82B0' : shade(look.body, 0.55);
  ctx.lineWidth = 1.4 * fs;
  if (expr === 'wide') {
    ctx.beginPath();
    ctx.ellipse(fx, ny + 4.6 * fs, 1.8 * fs, 2.3 * fs, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const mw = (expr === 'happy' ? 3.3 : 2.7) * fs;
    ctx.beginPath();
    ctx.moveTo(fx, ny + 1.5 * fs);
    ctx.quadraticCurveTo(fx - mw * 0.1, ny + 4 * fs, fx - mw, ny + 3 * fs);
    ctx.moveTo(fx, ny + 1.5 * fs);
    ctx.quadraticCurveTo(fx + mw * 0.1, ny + 4 * fs, fx + mw, ny + 3 * fs);
    ctx.stroke();
  }
  // a few whiskers for character, very light
  if (persona !== 'wobbly') {
    ctx.strokeStyle = tint(look.body, 0.65);
    ctx.globalAlpha = persona === 'void' ? 0.5 : 0.65;
    ctx.lineWidth = 1 * fs;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(fx + s * spacing * 1.25, ny + 1 * fs);
      ctx.lineTo(fx + s * (spacing * 1.25 + 7 * fs), ny - 0.5 * fs);
      ctx.moveTo(fx + s * spacing * 1.25, ny + 3 * fs);
      ctx.lineTo(fx + s * (spacing * 1.25 + 7 * fs), ny + 3.5 * fs);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

/** Cat outline extent used for shadows (call after drawCat updated the view). */
export function catFootprint(b: SoftBody): { minX: number; maxX: number; maxY: number; cx: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let cx = 0;
  for (let i = 0; i < b.n; i++) {
    minX = Math.min(minX, b.x[i]);
    maxX = Math.max(maxX, b.x[i]);
    maxY = Math.max(maxY, b.y[i]);
    cx += b.x[i];
  }
  return { minX, maxX, maxY: maxY + NODE_RADIUS, cx: cx / b.n };
}
