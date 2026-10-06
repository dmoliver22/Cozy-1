// Painting the cats: round squishy loaves with two ears, dot eyes and a tiny
// mouth. The face always floats to the top of the blob ("cats land on their
// feet"), so a cat poured into a teacup still reads as a loaf with ears.
//
// The look is painted, not drawn: a flat coat colour, breed markings, a fur
// texture, soft shading that hugs the outline (one warm light from the upper
// left, cool shade and occlusion below, a rim of light on the lit edge) and
// little tufts of fur breaking the silhouette.
//
// Cats sitting in a container are painted in two passes: the body goes under
// the container's (glass) front, and the front paws go over its rim.

import type { BreedLook } from '../physics/breeds';
import { NODE_RADIUS, type SoftBody } from '../physics/softbody';
import { clamp } from '../util/math';
import { LIGHT, hash01, lightGradient, lightOf, lineOf, mix, rgba, shadowOf, texPattern, type Box, type Ctx, type TexKind } from './paint';

export type Expression = 'open' | 'happy' | 'sleepy' | 'wide' | 'squint' | 'blink' | 'content';

/** Opening of the container a cat is in: rim line y between x0 and x1, plus the lip's thickness. */
export interface Rim {
  x0: number;
  x1: number;
  y: number;
  lip: number;
}

export interface CatPose {
  expression: Expression;
  /** -1..1 horizontal look direction. */
  look: number;
  /** The container the cat is in (or pouring into). */
  rim: Rim | null;
  /** Settled in a container: front paws rest on the rim. */
  seated: boolean;
  /** Loafing on a surface: paws tucked in front. */
  resting: boolean;
  /** 0..1 purr intensity: drives a little ear wiggle. */
  purr: number;
  /** Grabbed: ears go out sideways, paws dangle. */
  grabbed: boolean;
  /** Golden glow at the reveal. */
  glow: number;
  /** Where a finger holds the cat by the scruff (world), while it's held. */
  pinch?: { x: number; y: number } | null;
  /** Silhouette (locked collection cards). */
  silhouette?: boolean;
}

/**
 * Which part to paint: 'all' (a free cat, everything), 'body' (a cat in a
 * container, before the container front) or 'over' (that cat's paws on the
 * rim, after the container front).
 */
export type CatLayer = 'all' | 'body' | 'over';

interface Ear {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export class CatView {
  hx = 0;
  hy = 0;
  inited = false;
  t = 0;
  dt = 0;
  blinkAt = 2 + Math.random() * 3;
  twitchAt = 1 + Math.random() * 4;
  twitch = 0;
  phase = Math.random() * 10;
  /** Which flank gets the markings' larger patch. */
  side: 1 | -1;
  /** Outline buffers */
  ox: Float64Array;
  oy: Float64Array;
  nx: Float64Array;
  ny: Float64Array;
  seed: number;
  // --- per-frame geometry shared by the 'body' and 'over' passes
  box: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  cx = 0;
  fx = 0;
  fy = 0;
  fs = 1;
  lw = 2;
  ears: Ear[] = [];
  /** Dense silhouette with fur locks worked into it (what actually gets painted). */
  sx = new Float64Array(0);
  sy = new Float64Array(0);
  sm = 0;
  /** Ear bases relative to the head anchor, and ear angles, both eased. */
  earRX = [0, 0];
  earRY = [0, 0];
  earAng = [0, 0];
  earInit = false;
  /** 0..1 how much the cat breathes visibly (resting or seated). */
  breath = 0;
  /** Paw visibility: tucked under the chest / dangling, and over a rim. */
  pawRest = 0;
  pawRim = 0;
  dangle = 0;

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
    this.dt = dt;
    if (this.twitch > 0) this.twitch = Math.max(0, this.twitch - dt * 4);
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

// ---------------------------------------------------------------------------
// Colours, worked out once per breed.

interface Ink {
  base: string;
  lit: string;
  shade: string;
  deep: string;
  line: string;
  lineAlpha: number;
  rim: string;
  rimAlpha: number;
  light: string;
  accent: string;
  innerEar: string;
  innerEarDeep: string;
  earFur: string;
  nose: string;
  noseDeep: string;
  eye: string;
  cheek: string;
  whisker: string;
  whiskerAlpha: number;
  mouth: string;
  paw: string;
  muzzle: string | null;
  fur: 'fur' | 'furFine';
  furAlpha: number;
  furScale: number;
  dark: boolean;
}

const inkCache = new WeakMap<BreedLook, Ink>();

function inkFor(look: BreedLook): Ink {
  let ink = inkCache.get(look);
  if (ink) return ink;
  const base = look.body;
  const dark = look.persona === 'void';
  const pale = look.pattern === 'fluff';
  ink = {
    base,
    lit: dark ? lightOf(base, 0.32) : lightOf(base, 0.62),
    shade: shadowOf(base, dark ? 0.35 : 0.42),
    deep: shadowOf(base, dark ? 0.55 : 0.72),
    line: dark ? '#1E1B29' : lineOf(base),
    lineAlpha: pale ? 0.62 : dark ? 0.95 : 0.82,
    rim: dark ? '#A79CDB' : lightOf(base, 1),
    rimAlpha: dark ? 0.55 : 0.55,
    light: look.light,
    accent: look.accent,
    innerEar: look.innerEar,
    innerEarDeep: shadowOf(look.innerEar, 0.35),
    earFur: dark ? 'rgba(190,180,230,0.55)' : 'rgba(255,252,246,0.85)',
    nose: look.nose,
    noseDeep: shadowOf(look.nose, 0.45),
    eye: look.eye,
    cheek: look.cheek,
    whisker: dark ? '#D9D2EE' : look.pattern === 'fluff' ? shadowOf(base, 0.55) : '#FFFDF8',
    whiskerAlpha: dark ? 0.55 : look.pattern === 'fluff' ? 0.45 : 0.8,
    mouth: dark ? '#9D90C2' : shadowOf(look.nose, 0.75),
    paw: look.pattern === 'patches' || look.pattern === 'belly' || look.pattern === 'tabby' || look.pattern === 'mane' ? look.light : lightOf(base, 0.25),
    muzzle: look.pattern === 'patches' || look.pattern === 'belly' || look.pattern === 'tabby' || look.pattern === 'mane' ? look.light : null,
    fur: look.fluff > 0.6 ? 'fur' : 'furFine',
    furAlpha: dark ? 0.6 : look.fluff > 0.6 ? 0.62 : 0.48,
    furScale: look.fluff > 0.6 ? 0.36 : 0.26,
    dark,
  };
  inkCache.set(look, ink);
  return ink;
}

// ---------------------------------------------------------------------------
// Geometry

/** Compute the visible outline (nodes pushed out by the collision skin). */
function computeOutline(b: SoftBody, v: CatView, breathe: number): void {
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
  cx /= n;
  if (breathe !== 0) {
    // A resting cat breathes: the back rises a touch, the bottom stays put.
    for (let i = 0; i < n; i++) {
      v.oy[i] = maxY - (maxY - v.oy[i]) * (1 + breathe);
      v.ox[i] = cx + (v.ox[i] - cx) * (1 + breathe * 0.3);
    }
    minY = maxY - (maxY - minY) * (1 + breathe);
    minX = cx + (minX - cx) * (1 + breathe * 0.3);
    maxX = cx + (maxX - cx) * (1 + breathe * 0.3);
  }
  v.box = { x0: minX, y0: minY, x1: maxX, y1: maxY };
  v.cx = cx;
}

/**
 * Where the top of the outline crosses the vertical line x = X, with the
 * outward normal there (interpolated between nodes, so it slides smoothly as
 * the ring moves instead of jumping from node to node).
 */
function topCrossing(v: CatView, n: number, X: number): { x: number; y: number; nx: number; ny: number } {
  const x = clamp(X, v.box.x0 + 0.5, v.box.x1 - 0.5);
  let bestY = Infinity;
  let nx = 0;
  let ny = -1;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const x0 = v.ox[i];
    const x1 = v.ox[j];
    if ((x0 - x) * (x1 - x) > 0 || x0 === x1) continue;
    const t = (x - x0) / (x1 - x0);
    const y = v.oy[i] + (v.oy[j] - v.oy[i]) * t;
    if (y < bestY) {
      bestY = y;
      nx = v.nx[i] + (v.nx[j] - v.nx[i]) * t;
      ny = v.ny[i] + (v.ny[j] - v.ny[i]) * t;
    }
  }
  if (bestY === Infinity) bestY = v.box.y0;
  const l = Math.hypot(nx, ny) || 1;
  return { x, y: bestY, nx: nx / l, ny: ny / l };
}

/** Shortest signed difference between two angles. */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const ease = (dt: number, rate: number): number => (dt <= 0 ? 1 : 1 - Math.exp(-dt * rate));

/** Work out where everything goes this frame (head, face, ears, paws). */
function prepare(b: SoftBody, v: CatView, pose: CatPose): void {
  const look = b.breed.look;
  const n = b.n;
  const r = b.p.radius;
  const calmNow = (pose.resting || pose.seated) && !pose.grabbed ? 1 : 0;
  v.breath += (calmNow - v.breath) * (v.inited ? ease(v.dt, 2) : 1);
  computeOutline(b, v, v.breath * Math.sin(v.t * (1.9 + pose.purr * 0.8) + v.phase) * (0.011 + pose.purr * 0.004));
  const ol = v.box;
  // Head anchor: weighted top of the blob, eased over time.
  let wx = 0;
  let wy = 0;
  let ws = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.exp(-(v.oy[i] - ol.y0) / (0.22 * r));
    wx += v.ox[i] * w;
    wy += v.oy[i] * w;
    ws += w;
  }
  const tx = wx / ws;
  const ty = wy / ws;
  const snap = !v.inited;
  if (snap) {
    v.hx = tx;
    v.hy = ty;
    v.inited = true;
  } else {
    v.hx += (tx - v.hx) * ease(v.dt, 24);
    v.hy += (ty - v.hy) * ease(v.dt, 36);
  }
  const hx = clamp(v.hx, ol.x0 + r * 0.45, ol.x1 - r * 0.45);
  const hy = Math.max(v.hy, ol.y0);
  // Face sits a little below the top, looking where it's told.
  const faceDrop = Math.min(r * 0.5, Math.max(r * 0.2, (ol.y1 - hy) * 0.42));
  v.fs = clamp(r / 30, 0.78, 1.3);
  v.fx = hx + pose.look * r * 0.12;
  v.fy = hy + faceDrop;
  v.lw = Math.max(1.1, 1.5 * (r / 30) ** 0.25);

  // Ears: where the top of the outline crosses either side of the head, eased
  // in the head's frame so they ride along smoothly instead of hopping between
  // nodes. A grabbed cat's ears go out sideways; content cats wiggle them.
  // (held by the scruff, they sit out on the shoulders, clear of the skin
  // drawn up between them)
  const spread0 = Math.min(r * 0.6, (ol.x1 - ol.x0) * 0.3);
  const spread = spread0 + Math.max(0, Math.min(r * 0.68, (ol.x1 - ol.x0) * 0.42) - spread0) * v.dangle;
  const ke = snap || !v.earInit ? 1 : ease(v.dt, 16);
  const ka = snap || !v.earInit ? 1 : ease(v.dt, 12);
  const wiggle = pose.purr > 0 ? Math.sin(v.t * 2.2 + v.phase) * 0.05 * pose.purr : 0;
  const twitch = v.twitch * Math.sin(v.t * 16) * 0.12;
  v.ears = [];
  for (let e = 0; e < 2; e++) {
    const s = e === 0 ? -1 : 1;
    const top = topCrossing(v, n, hx + s * spread);
    let dx = top.nx * 0.45;
    let dy = top.ny * 0.45 - 1;
    if (pose.grabbed) {
      dx += s * 0.9;
      dy += 0.35;
    }
    const ang = Math.atan2(dy, dx);
    v.earRX[e] += (top.x - top.nx * 2 - v.hx - v.earRX[e]) * ke;
    v.earRY[e] += (top.y - top.ny * 2 - v.hy - v.earRY[e]) * ke;
    v.earAng[e] += angleDiff(ang, v.earAng[e]) * ka;
    const a = v.earAng[e] + s * wiggle + (s > 0 ? twitch : 0);
    v.ears.push({ x: v.hx + v.earRX[e], y: v.hy + v.earRY[e], dx: Math.cos(a), dy: Math.sin(a) });
  }
  v.earInit = true;

  // Paws: tucked under the chest when loafing, dangling when lifted, over the
  // rim when sitting in a container with the head poking out (with a little
  // hysteresis so they never flicker).
  const rim = pose.rim;
  const rest = !rim && (pose.resting || pose.grabbed) ? 1 : 0;
  v.pawRest += (rest - v.pawRest) * (snap ? 1 : ease(v.dt, 8));
  v.dangle += ((pose.grabbed ? 1 : 0) - v.dangle) * (snap ? 1 : ease(v.dt, 8));
  let onRim = 0;
  if (rim && pose.seated) {
    const was = v.pawRim > 0.5;
    const above = rim.y - v.fy;
    const lo = was ? r * -0.02 : r * 0.08;
    const hi = was ? r * 1.35 : r * 1.2;
    const fits = v.fx - r * 0.42 > rim.x0 + 2 && v.fx + r * 0.42 < rim.x1 - 2;
    if (above > lo && above < hi && ol.y1 > rim.y + r * 0.25 && fits) onRim = 1;
  }
  v.pawRim += (onRim - v.pawRim) * (snap ? 1 : ease(v.dt, 6));
  furOutline(b, v, r, look);
}

const LOCK_OUT = new Float64Array(256);
const LOCK_TAN = new Float64Array(256);
const LOCK_NX = new Float64Array(256);
const LOCK_NY = new Float64Array(256);

/**
 * The painted silhouette: the smooth outline resampled densely, with locks of
 * fur worked into it (soft points lying down and away from the head, fuller on
 * the cheeks, none underneath). Locks are anchored to the ring, so they move
 * with the cat.
 */
function furOutline(b: SoftBody, v: CatView, r: number, look: BreedLook): void {
  const n = b.n;
  const S = 4;
  const M = n * S;
  if (v.sx.length !== M) {
    v.sx = new Float64Array(M);
    v.sy = new Float64Array(M);
  }
  v.sm = M;
  const { ox, oy, sx, sy } = v;
  for (let i = 0; i < n; i++) {
    const ia = (i + n - 1) % n;
    const ib = (i + 1) % n;
    const ax = (ox[ia] + ox[i]) / 2;
    const ay = (oy[ia] + oy[i]) / 2;
    const bx = (ox[i] + ox[ib]) / 2;
    const by = (oy[i] + oy[ib]) / 2;
    for (let q = 0; q < S; q++) {
      const t = q / S;
      const u = 1 - t;
      sx[i * S + q] = u * u * ax + 2 * u * t * ox[i] + t * t * bx;
      sy[i * S + q] = u * u * ay + 2 * u * t * oy[i] + t * t * by;
    }
  }
  const fluff = look.fluff;
  if (fluff <= 0 || M > LOCK_OUT.length) return;
  LOCK_OUT.fill(0, 0, M);
  LOCK_TAN.fill(0, 0, M);
  const step = fluff > 0.6 ? 3 : 4;
  const lean = 0.55 + fluff * 0.25;
  const hx = v.hx;
  const hy = v.hy - r * 0.35;
  for (let c0 = 0; c0 < M; c0 += step) {
    const h1 = hash01(c0, v.seed + 11);
    const c = (c0 + Math.floor(hash01(c0, v.seed + 12) * step)) % M;
    const cp = (c + 1) % M;
    const cm = (c + M - 1) % M;
    let tx = sx[cp] - sx[cm];
    let ty = sy[cp] - sy[cm];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const nx = ty;
    const ny = -tx;
    if (ny > 0.3) continue;
    // fur pressed flat against a wall or the glass: no lock there
    const node = Math.floor(c / S);
    if (b.contactShape[node] !== -1 || b.contactShape[(node + 1) % n] !== -1) continue;
    const cheek = Math.exp(-(((sy[c] - v.fy) / (r * 0.5)) ** 2)) * Math.abs(nx);
    // short coats only get locks on the cheeks and the crown
    const where = fluff > 0.6 ? 1 : Math.max(cheek, ny < -0.8 ? 0.55 : 0);
    if (where < 0.25 || h1 < (fluff > 0.6 ? 0.08 : 0.3)) continue;
    const len = r * (0.025 + fluff * 0.085) * (0.6 + hash01(c0, v.seed + 13) * 0.7) * (1 + cheek * (0.5 + fluff * 0.9)) * where;
    if (len < 0.6) continue;
    const W = Math.round(step * (1.4 + hash01(c0, v.seed + 14) * 0.8));
    // lie down and away from the crown
    const dir = tx * (sx[c] - hx) + ty * (sy[c] - hy) >= 0 ? 1 : -1;
    for (let q = 0; q <= W; q++) {
      const u = q / W;
      const pk = 0.62;
      let B: number;
      if (u < pk) {
        const x = u / pk;
        B = x * x * (3 - 2 * x);
      } else {
        const x = (1 - u) / (1 - pk);
        B = x * x;
      }
      const idx = (c + dir * (q - Math.round(W * pk)) + M * 2) % M;
      const o = B * len;
      if (o > LOCK_OUT[idx]) {
        LOCK_OUT[idx] = o;
        LOCK_TAN[idx] = dir * o * lean;
      }
    }
  }
  // displace along the smooth outline's own normals (worked out before moving anything)
  for (let i = 0; i < M; i++) {
    const ip = (i + 1) % M;
    const im = (i + M - 1) % M;
    let tx = sx[ip] - sx[im];
    let ty = sy[ip] - sy[im];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    LOCK_NX[i] = ty;
    LOCK_NY[i] = -tx;
  }
  for (let i = 0; i < M; i++) {
    const o = LOCK_OUT[i];
    if (o === 0) continue;
    const nx = LOCK_NX[i];
    const ny = LOCK_NY[i];
    sx[i] += nx * o - ny * LOCK_TAN[i];
    sy[i] += ny * o + nx * LOCK_TAN[i];
  }
}

// ---------------------------------------------------------------------------
// Main entry

/** Main cat draw. Body nodes come straight from the physics. */
export function drawCat(ctx: Ctx, b: SoftBody, v: CatView, pose: CatPose, scaleHint = 1, layer: CatLayer = 'all'): void {
  void scaleHint;
  const look = b.breed.look;
  const ink = inkFor(look);
  if (layer !== 'over') prepare(b, v, pose);
  const r = b.p.radius;

  if (pose.silhouette) {
    ctx.fillStyle = look.shade;
    for (const e of v.ears) ctx.fill(earPath(e, r * 0.46 * look.earSize));
    ctx.fill(smoothPath2D(v.sx, v.sy, v.sm));
    return;
  }
  if (layer === 'over') {
    drawOver(ctx, v, pose, r, ink);
    return;
  }
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const e of v.ears) drawEar(ctx, v, e, r, look, ink);
  drawBody(ctx, v, pose, r, look, ink);
  drawFace(ctx, look, ink, v.fx, v.fy, v.fs, r, pose, v);
  if (!pose.rim && v.pawRest > 0.02) drawRestPaws(ctx, v, r, ink);
  ctx.restore();
  if (layer === 'all' && pose.rim) drawOver(ctx, v, pose, r, ink);
}

/** Front paws of a cat in a container, resting on the rim over the container front. */
function drawOver(ctx: Ctx, v: CatView, pose: CatPose, r: number, ink: Ink): void {
  const rim = pose.rim;
  if (rim && v.pawRim > 0.02) drawRimPaws(ctx, v, rim, r, ink);
}

// ---------------------------------------------------------------------------
// Body

function drawBody(ctx: Ctx, v: CatView, pose: CatPose, r: number, look: BreedLook, ink: Ink): void {
  const box = v.box;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const P = smoothPath2D(v.sx, v.sy, v.sm);
  ctx.fillStyle = ink.base;
  ctx.fill(P);
  ctx.save();
  ctx.clip(P);
  drawMarkings(ctx, look, ink, v, r);
  // coat texture
  fillTexture(ctx, ink.fur, box, ink.furAlpha, 'overlay', ink.furScale, v.hx, v.hy);
  // form: warm light from the upper left, cool shade toward the lower right
  const size = Math.max(w, h);
  const gx = (box.x0 + box.x1) / 2 - w * 0.16;
  const gy = box.y0 + h * 0.3;
  const g = ctx.createRadialGradient(gx, gy, size * 0.04, gx, gy, size * 0.92);
  g.addColorStop(0, rgba(ink.lit, ink.dark ? 0.35 : 0.42));
  g.addColorStop(0.42, rgba(ink.lit, 0));
  g.addColorStop(0.6, rgba(ink.shade, 0));
  g.addColorStop(1, rgba(ink.shade, ink.dark ? 0.6 : 0.5));
  ctx.fillStyle = g;
  ctx.fillRect(box.x0 - 2, box.y0 - 2, w + 4, h + 4);
  // occlusion toward the underside
  const ao = ctx.createLinearGradient(0, box.y1 - Math.min(r * 0.75, h * 0.6), 0, box.y1);
  ao.addColorStop(0, rgba(ink.deep, 0));
  ao.addColorStop(0.65, rgba(ink.deep, ink.dark ? 0.28 : 0.2));
  ao.addColorStop(1, rgba(ink.deep, ink.dark ? 0.6 : 0.5));
  ctx.fillStyle = ao;
  ctx.fillRect(box.x0 - 2, box.y1 - r * 0.8, w + 4, r * 0.8 + 2);
  // cool shade hugging the far edge, a rim of light on the near one
  innerBands(ctx, P, box, ink.shade, r * 0.2, 0.32, 'shadow', 1);
  innerBands(ctx, P, box, ink.rim, r * 0.09, ink.rimAlpha, 'light', 1);
  if (pose.pinch && v.dangle > 0.05) scruffFolds(ctx, pose.pinch.x, pose.pinch.y, r, ink, v.dangle);
  if (pose.glow > 0) {
    ctx.fillStyle = `rgba(255,214,120,${0.2 * pose.glow})`;
    ctx.fillRect(box.x0 - 2, box.y0 - 2, w + 4, h + 4);
    innerBands(ctx, P, box, '#FFE3A3', r * 0.14, 0.6 * pose.glow, 'all', 1);
  }
  ctx.restore();
  // outline: a soft line, a touch heavier on the shadow side
  ctx.lineWidth = v.lw * 0.8;
  ctx.strokeStyle = lightGradient(ctx, box, [
    [0, rgba(ink.line, ink.lineAlpha * 0.55)],
    [0.55, rgba(ink.line, ink.lineAlpha * 0.85)],
    [1, rgba(ink.line, ink.lineAlpha)],
  ]);
  ctx.stroke(P);
  ctx.lineWidth = v.lw * 1.45;
  ctx.strokeStyle = lightGradient(ctx, box, [
    [0, rgba(ink.line, 0)],
    [0.55, rgba(ink.line, 0)],
    [1, rgba(ink.line, ink.lineAlpha * 0.75)],
  ]);
  ctx.stroke(P);
}

/** The smooth closed curve through points (midpoint quadratics) as a reusable path. */
function smoothPath2D(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number): Path2D {
  const p = new Path2D();
  p.moveTo((xs[n - 1] + xs[0]) / 2, (ys[n - 1] + ys[0]) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    p.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[j]) / 2, (ys[i] + ys[j]) / 2);
  }
  p.closePath();
  return p;
}

/**
 * Soft bands hugging the inside of a shape's edge, for use inside a clip to
 * that shape (the same idea as edgeShade, without paying for another clip).
 */
function innerBands(ctx: Ctx, p: Path2D, box: Box, color: string, width: number, alpha: number, side: 'shadow' | 'light' | 'bottom' | 'all', steps: number): void {
  if (alpha <= 0 || width <= 0) return;
  let style: string | CanvasGradient = color;
  if (side !== 'all') {
    const on = rgba(color, 1);
    const off = rgba(color, 0);
    const stops: [number, string][] = side === 'light' ? [[0, on], [0.15, on], [0.58, off], [1, off]] : [[0, off], [0.42, off], [0.85, on], [1, on]];
    style = lightGradient(ctx, box, stops, side === 'bottom' ? { x: 0, y: -1 } : LIGHT);
  }
  ctx.strokeStyle = style;
  const a0 = ctx.globalAlpha;
  for (let k = steps; k >= 1; k--) {
    ctx.globalAlpha = a0 * (alpha / steps) * (k === 1 ? 1.15 : 1);
    ctx.lineWidth = (2 * width * k) / steps;
    ctx.stroke(p);
  }
  ctx.globalAlpha = a0;
}

/** Fill a box (inside a clip) with a coat texture anchored to the cat. */
function fillTexture(ctx: Ctx, kind: TexKind, box: Box, alpha: number, op: GlobalCompositeOperation, scale: number, ox: number, oy: number): void {
  const pat = texPattern(ctx, kind, scale, 0, ox, oy);
  if (!pat) return;
  const a0 = ctx.globalAlpha;
  const op0 = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = a0 * alpha;
  ctx.fillStyle = pat;
  ctx.fillRect(box.x0 - 2, box.y0 - 2, box.x1 - box.x0 + 4, box.y1 - box.y0 + 4);
  ctx.globalCompositeOperation = op0;
  ctx.globalAlpha = a0;
}

/** Breed markings, painted inside the body clip before the shading. */
/**
 * Held by the scruff: the skin is gathered up into the pinch, a few soft folds
 * fanning down from it (drawn inside the body, under the face).
 */
function scruffFolds(ctx: Ctx, x: number, y: number, r: number, ink: Ink, a: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  for (const k of [-1, 0, 1]) {
    const x0 = x + k * r * 0.07;
    const y0 = y + r * 0.04;
    const x1 = x + k * r * 0.3;
    const y1 = y + r * (k === 0 ? 0.3 : 0.24);
    const cx = x + k * r * 0.1;
    const cy = y + r * 0.2;
    ctx.strokeStyle = rgba(ink.deep, (ink.dark ? 0.5 : 0.32) * a);
    ctx.lineWidth = Math.max(0.8, r * 0.045);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.stroke();
    // the raised side of each fold catches the light
    ctx.strokeStyle = rgba(ink.lit, 0.35 * a);
    ctx.lineWidth = Math.max(0.6, r * 0.03);
    ctx.beginPath();
    ctx.moveTo(x0 - r * 0.035, y0 + r * 0.01);
    ctx.quadraticCurveTo(cx - r * 0.035, cy, x1 - r * 0.035, y1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMarkings(ctx: Ctx, look: BreedLook, ink: Ink, v: CatView, r: number): void {
  const box = v.box;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const hx = clamp(v.hx, box.x0 + r * 0.45, box.x1 - r * 0.45);
  const hy = Math.max(v.hy, box.y0);
  const fx = v.fx;
  const fy = v.fy;
  const s = v.side;
  switch (look.pattern) {
    case 'tabby': {
      // mackerel stripes down the flanks, an M on the brow, cheek lines
      for (let k = -3; k <= 3; k++) {
        if (k === 0) continue;
        const sx = hx + k * w * 0.13 + (k > 0 ? r * 0.12 : -r * 0.12);
        const top = box.y0 + h * (0.04 + Math.abs(k) * 0.02);
        stripe(ctx, sx, top, sx + k * w * 0.035, box.y0 + h * (0.5 + Math.abs(k) * 0.07), r * (0.17 - Math.abs(k) * 0.015), ink.accent, 0.5);
      }
      for (let k = -1; k <= 1; k++) stripe(ctx, hx + k * r * 0.13, hy + r * 0.03, hx + k * r * 0.1, hy + r * 0.2, r * 0.07, ink.accent, 0.55);
      for (const sd of [-1, 1]) {
        stripe(ctx, fx + sd * r * 0.42, fy - r * 0.02, fx + sd * r * 0.68, fy - r * 0.08, r * 0.05, ink.accent, 0.45);
        stripe(ctx, fx + sd * r * 0.42, fy + r * 0.09, fx + sd * r * 0.66, fy + r * 0.1, r * 0.045, ink.accent, 0.4);
      }
      softBlob(ctx, hx, box.y1 + r * 0.05, Math.max(r * 0.5, w * 0.28), Math.max(r * 0.42, h * 0.38), ink.light, 0.75);
      break;
    }
    case 'patches': {
      // grey and white: white socks, chest and a blaze down the nose
      softBlob(ctx, hx - s * r * 0.55, box.y0 + h * 0.3, r * 0.55, r * 0.42, ink.accent, 0.55);
      softBlob(ctx, hx + s * r * 0.75, box.y0 + h * 0.12, r * 0.38, r * 0.3, ink.accent, 0.4);
      softBlob(ctx, hx, box.y1 + r * 0.1, Math.max(r * 0.58, w * 0.33), Math.max(r * 0.55, h * 0.48), ink.light, 0.95);
      ctx.fillStyle = rgba(ink.light, 0.95);
      ctx.beginPath();
      ctx.moveTo(fx - r * 0.06, fy - r * 0.28);
      ctx.quadraticCurveTo(fx, fy - r * 0.34, fx + r * 0.06, fy - r * 0.28);
      ctx.quadraticCurveTo(fx + r * 0.3, fy + r * 0.12, fx + r * 0.36, fy + r * 0.3);
      ctx.lineTo(fx - r * 0.36, fy + r * 0.3);
      ctx.quadraticCurveTo(fx - r * 0.3, fy + r * 0.12, fx - r * 0.06, fy - r * 0.28);
      ctx.fill();
      break;
    }
    case 'belly': {
      // ginger with a cream tummy and faint tabby stripes over the head and back
      softBlob(ctx, hx, box.y1 + r * 0.06, Math.max(r * 0.58, w * 0.32), Math.max(r * 0.52, h * 0.46), ink.light, 0.92);
      for (let k = -2; k <= 2; k++) {
        const sx = hx + k * r * 0.2;
        stripe(ctx, sx, box.y0 - r * 0.02, sx + k * r * 0.03, box.y0 + r * (0.18 - Math.abs(k) * 0.02), r * 0.075, ink.accent, 0.45);
      }
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue;
        const sx = hx + k * w * 0.19;
        stripe(ctx, sx, box.y0 + h * 0.18, sx + k * w * 0.05, box.y0 + h * 0.5, r * 0.11, ink.accent, 0.3);
      }
      break;
    }
    case 'fluff': {
      // cream cloud: a white bib, a warmer back
      softBlob(ctx, hx, box.y0 - r * 0.05, w * 0.55, r * 0.42, ink.accent, 0.28);
      softBlob(ctx, fx, fy + r * 0.5, r * 0.62, r * 0.42, ink.light, 0.95);
      furFlicks(ctx, fx, fy + r * 0.78, r * 0.55, r * 0.18, 8, ink.light, 0.8, v.seed);
      break;
    }
    case 'mane': {
      // brown tabby long-hair: dark saddle, striped flanks, a pale ruff
      softBlob(ctx, hx, box.y0 - r * 0.08, w * 0.6, r * 0.5, ink.accent, 0.42);
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue;
        const sx = hx + k * w * 0.17;
        stripe(ctx, sx, box.y0 + h * 0.1, sx + k * w * 0.05, box.y0 + h * 0.55, r * 0.13, ink.accent, 0.35);
      }
      for (let k = -1; k <= 1; k++) stripe(ctx, hx + k * r * 0.12, hy + r * 0.04, hx + k * r * 0.09, hy + r * 0.19, r * 0.065, ink.accent, 0.5);
      // ruff: a soft pale bib under the chin, its edge combed into locks
      const ry = fy + r * 0.32;
      softBlob(ctx, fx, ry, r * 0.5, r * 0.36, ink.light, 0.9);
      softBlob(ctx, fx - r * 0.3, ry + r * 0.08, r * 0.3, r * 0.28, ink.light, 0.75);
      softBlob(ctx, fx + r * 0.3, ry + r * 0.08, r * 0.3, r * 0.28, ink.light, 0.75);
      furFlicks(ctx, fx, ry + r * 0.22, r * 0.5, r * 0.2, 7, ink.light, 0.85, v.seed);
      softBlob(ctx, fx, fy + r * 0.08, r * 0.34, r * 0.2, ink.light, 0.85);
      break;
    }
    case 'none': {
      // ink-black velvet: a cool sheen across the shoulders
      const sg = ctx.createRadialGradient(hx - r * 0.3, box.y0 + h * 0.28, 0, hx - r * 0.3, box.y0 + h * 0.28, r * 0.95);
      sg.addColorStop(0, 'rgba(150,140,205,0.35)');
      sg.addColorStop(0.6, 'rgba(150,140,205,0.08)');
      sg.addColorStop(1, 'rgba(150,140,205,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(box.x0, box.y0, w, h);
      break;
    }
  }
}

/** A soft-edged patch of colour (two passes: a feathered halo and a core). */
function softBlob(ctx: Ctx, x: number, y: number, rx: number, ry: number, color: string, alpha: number): void {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.78, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A row of small pale locks hanging down (the combed edge of a ruff or bib). */
function furFlicks(ctx: Ctx, x: number, y: number, halfW: number, len: number, count: number, color: string, alpha: number, seed: number): void {
  ctx.fillStyle = rgba(color, alpha);
  ctx.beginPath();
  for (let k = 0; k < count; k++) {
    const u = count === 1 ? 0.5 : k / (count - 1);
    const px = x + (u - 0.5) * 2 * halfW;
    const sag = Math.sin(u * Math.PI);
    const py = y - (1 - sag) * len * 1.4;
    const l = len * (0.7 + hash01(k, seed + 31) * 0.6) * (0.6 + sag * 0.4);
    const w = (halfW / count) * 1.3;
    const lean = (u - 0.5) * w * 1.2;
    ctx.moveTo(px - w, py - l * 0.6);
    ctx.quadraticCurveTo(px - w * 0.3 + lean * 0.5, py + l * 0.3, px + lean, py + l);
    ctx.quadraticCurveTo(px + w * 0.4 + lean * 0.5, py + l * 0.2, px + w, py - l * 0.6);
    ctx.closePath();
  }
  ctx.fill();
}

/** A tapered brush stroke from (x0,y0) to (x1,y1), widest in the middle. */
function stripe(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, color: string, alpha: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l = Math.hypot(dx, dy) || 1;
  const px = (-dy / l) * w * 0.5;
  const py = (dx / l) * w * 0.5;
  const mx = (x0 + x1) / 2 + px * 0.5;
  const my = (y0 + y1) / 2 + py * 0.5;
  ctx.fillStyle = rgba(color, alpha);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx + px * 1.6, my + py * 1.6, x1, y1);
  ctx.quadraticCurveTo(mx - px * 1.2, my - py * 1.2, x0, y0);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Ears

function earPath(e: Ear, size: number): Path2D {
  const { x: bx, y: by, dx, dy } = e;
  const px = -dy;
  const py = dx;
  const half = size * 0.6;
  const tipX = bx + dx * size;
  const tipY = by + dy * size;
  const p = new Path2D();
  p.moveTo(bx - dx * size * 0.35 + px * half, by - dy * size * 0.35 + py * half);
  p.quadraticCurveTo(bx + dx * size * 0.6 + px * half * 0.62, by + dy * size * 0.6 + py * half * 0.62, tipX + px * size * 0.07, tipY + py * size * 0.07);
  p.quadraticCurveTo(tipX + dx * size * 0.06, tipY + dy * size * 0.06, tipX - px * size * 0.07, tipY - py * size * 0.07);
  p.quadraticCurveTo(bx + dx * size * 0.6 - px * half * 0.62, by + dy * size * 0.6 - py * half * 0.62, bx - dx * size * 0.35 - px * half, by - dy * size * 0.35 - py * half);
  p.closePath();
  return p;
}

function drawEar(ctx: Ctx, v: CatView, e: Ear, r: number, look: BreedLook, ink: Ink): void {
  const size = r * 0.46 * look.earSize;
  const { x: bx, y: by, dx, dy } = e;
  const px = -dy;
  const py = dx;
  const P = earPath(e, size);
  const box: Box = { x0: bx - size, y0: by - size * 1.1, x1: bx + size, y1: by + size * 0.4 };
  // outer ear: lit toward the tip on the light side
  ctx.fillStyle = ink.base;
  ctx.fill(P);
  const g = ctx.createLinearGradient(bx, by, bx + dx * size, by + dy * size);
  g.addColorStop(0, rgba(ink.shade, 0.35));
  g.addColorStop(0.6, rgba(ink.base, 0));
  g.addColorStop(1, rgba(ink.lit, px < 0 ? 0.35 : 0.15));
  ctx.fillStyle = g;
  ctx.fill(P);
  ctx.save();
  ctx.clip(P);
  if (look.pattern === 'tabby' || look.pattern === 'mane' || look.pattern === 'patches') {
    ctx.fillStyle = rgba(ink.accent, 0.35);
    ctx.beginPath();
    ctx.arc(bx + dx * size, by + dy * size, size * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }
  innerBands(ctx, P, box, ink.rim, size * 0.12, ink.rimAlpha * (px < 0 ? 0.8 : 0.35), 'light', 1);
  ctx.restore();
  // inner ear: pink, deepest at the base
  const ih = size * 0.6 * 0.52;
  const ix = bx + dx * size * 0.05;
  const iy = by + dy * size * 0.05;
  ctx.beginPath();
  ctx.moveTo(ix + px * ih, iy + py * ih);
  ctx.quadraticCurveTo(bx + dx * size * 0.52 + px * ih * 0.45, by + dy * size * 0.52 + py * ih * 0.45, bx + dx * size * 0.8, by + dy * size * 0.8);
  ctx.quadraticCurveTo(bx + dx * size * 0.52 - px * ih * 0.45, by + dy * size * 0.52 - py * ih * 0.45, ix - px * ih, iy - py * ih);
  ctx.closePath();
  const ig = ctx.createLinearGradient(ix, iy, bx + dx * size * 0.8, by + dy * size * 0.8);
  ig.addColorStop(0, ink.innerEarDeep);
  ig.addColorStop(0.55, ink.innerEar);
  ig.addColorStop(1, mix(ink.innerEar, ink.base, 0.35));
  ctx.fillStyle = ig;
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * 0.92;
  ctx.fill();
  ctx.globalAlpha = a0;
  // a few pale hairs inside the ear
  if (look.fluff > 0) {
    ctx.strokeStyle = ink.earFur;
    ctx.lineWidth = Math.max(0.5, size * 0.045);
    ctx.beginPath();
    const hairs = look.fluff > 0.6 ? 4 : 3;
    for (let k = 0; k < hairs; k++) {
      const o = (k / (hairs - 1) - 0.5) * ih * 1.1;
      const sx = ix + px * o;
      const sy = iy + py * o;
      const len = size * (0.38 + (k % 2) * 0.12 + look.fluff * 0.12);
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + dx * len * 0.6 - px * o * 0.3, sy + dy * len * 0.6 - py * o * 0.3, sx + dx * len - px * o * 0.55, sy + dy * len - py * o * 0.55);
    }
    ctx.stroke();
  }
  // lynx tips
  if (look.earTufts) {
    const tipX = bx + dx * size;
    const tipY = by + dy * size;
    ctx.strokeStyle = ink.accent;
    ctx.lineWidth = v.lw * 0.9;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.quadraticCurveTo(tipX + dx * size * 0.2, tipY + dy * size * 0.2, tipX + dx * size * 0.36 + px * size * 0.08, tipY + dy * size * 0.36 + py * size * 0.08);
    ctx.moveTo(tipX - px * size * 0.04, tipY - py * size * 0.04);
    ctx.quadraticCurveTo(tipX + dx * size * 0.16, tipY + dy * size * 0.16, tipX + dx * size * 0.26 - px * size * 0.12, tipY + dy * size * 0.26 - py * size * 0.12);
    ctx.stroke();
  }
  ctx.lineWidth = v.lw * 0.8;
  ctx.strokeStyle = rgba(ink.line, ink.lineAlpha);
  ctx.stroke(P);
}

// ---------------------------------------------------------------------------
// Paws

function paw(ctx: Ctx, x: number, y: number, rx: number, ry: number, ink: Ink, lw: number, toesDown: boolean): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = ink.paw;
  ctx.fill();
  const g = ctx.createLinearGradient(x, y - ry, x, y + ry);
  g.addColorStop(0, rgba(lightOf(ink.paw, 0.6), 0.5));
  g.addColorStop(0.5, rgba(ink.paw, 0));
  g.addColorStop(1, rgba(shadowOf(ink.paw, 0.6), 0.45));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = rgba(ink.line, ink.lineAlpha * 0.85);
  ctx.lineWidth = lw * 0.7;
  ctx.stroke();
  // toe splits
  ctx.lineWidth = lw * 0.55;
  ctx.beginPath();
  const ty0 = toesDown ? y + ry * 0.2 : y - ry * 0.95;
  const ty1 = toesDown ? y + ry * 0.95 : y - ry * 0.2;
  for (const o of [-0.33, 0.33]) {
    ctx.moveTo(x + rx * o, ty0);
    ctx.lineTo(x + rx * o * 1.1, ty1);
  }
  ctx.stroke();
}

function drawRestPaws(ctx: Ctx, v: CatView, r: number, ink: Ink): void {
  const a = v.pawRest;
  const d = v.dangle;
  const box = v.box;
  ctx.save();
  ctx.globalAlpha *= a;
  const rx = r * 0.17;
  const ry = r * (0.11 + d * 0.05);
  const y = box.y1 - ry * 0.85 + d * r * 0.08;
  for (const s of [-1, 1]) paw(ctx, v.fx + s * r * (0.24 - d * 0.04), y, rx, ry, ink, v.lw, true);
  ctx.restore();
}

function drawRimPaws(ctx: Ctx, v: CatView, rim: Rim, r: number, ink: Ink): void {
  ctx.save();
  ctx.globalAlpha *= v.pawRim;
  const rx = r * 0.18;
  const ry = r * 0.13;
  const y = rim.y + ry * 0.35;
  for (const s of [-1, 1]) {
    const x = v.fx + s * r * 0.3;
    // a little contact shadow on the rim below each paw
    const sg = ctx.createRadialGradient(x, y + ry * 0.9, 0, x, y + ry * 0.9, rx * 1.3);
    sg.addColorStop(0, 'rgba(62,48,70,0.22)');
    sg.addColorStop(1, 'rgba(62,48,70,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(x - rx * 1.4, y, rx * 2.8, ry * 2.2);
    paw(ctx, x, y, rx, ry, ink, v.lw, true);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Face

function drawFace(ctx: Ctx, look: BreedLook, ink: Ink, fx: number, fy: number, fs: number, r: number, pose: CatPose, v: CatView): void {
  const persona = look.persona;
  const spacing = r * (persona === 'zippy' ? 0.36 : persona === 'dramatic' ? 0.32 : 0.34) * (r < 26 ? 1.05 : 1);
  let expr = pose.expression;
  if ((expr === 'open' || expr === 'content') && v.blinking()) expr = 'blink';
  const eyeR = (persona === 'zippy' ? 3.3 : persona === 'void' ? 3.4 : 2.9) * fs;
  const ex1 = fx - spacing;
  const ex2 = fx + spacing;
  const ey = fy - 1.5 * fs;
  const ny = fy + 3.5 * fs;

  // muzzle: two soft pale pads under the nose
  if (ink.muzzle) {
    for (const s of [-1, 1]) softBlob(ctx, fx + s * 2.6 * fs, ny + 2.6 * fs, 4.4 * fs, 3.3 * fs, ink.muzzle, 0.9);
  }
  // cheeks: a warm blush
  for (const s of [-1, 1]) softBlob(ctx, fx + s * (spacing + 2.2 * fs), ey + 6.6 * fs, 5.2 * fs, 3.4 * fs, ink.cheek, persona === 'void' ? 0.4 : 0.5);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const drawEye = (x: number, side: number): void => {
    ctx.fillStyle = ink.eye;
    switch (expr) {
      case 'happy':
      case 'content': {
        ctx.lineWidth = 1.9 * fs;
        ctx.strokeStyle = ink.dark ? ink.eye : '#3A2F3F';
        ctx.beginPath();
        ctx.arc(x, ey + 1.3 * fs, eyeR * 1.05, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        break;
      }
      case 'sleepy':
      case 'blink': {
        ctx.lineWidth = 1.8 * fs;
        ctx.strokeStyle = ink.dark ? ink.eye : '#3A2F3F';
        ctx.beginPath();
        ctx.moveTo(x - eyeR, ey);
        ctx.quadraticCurveTo(x, ey + eyeR * 0.75, x + eyeR, ey);
        ctx.stroke();
        if (expr === 'sleepy') {
          // lashes for a sleepy droop
          ctx.lineWidth = 1.1 * fs;
          ctx.beginPath();
          ctx.moveTo(x + side * eyeR * 0.95, ey + eyeR * 0.05);
          ctx.lineTo(x + side * eyeR * 1.35, ey - eyeR * 0.15);
          ctx.stroke();
        }
        break;
      }
      case 'squint': {
        ctx.lineWidth = 1.8 * fs;
        ctx.strokeStyle = ink.dark ? ink.eye : '#3A2F3F';
        ctx.beginPath();
        ctx.moveTo(x - side * eyeR, ey - eyeR * 0.8);
        ctx.quadraticCurveTo(x + side * eyeR * 0.2, ey - eyeR * 0.2, x + side * eyeR * 0.75, ey);
        ctx.quadraticCurveTo(x + side * eyeR * 0.2, ey + eyeR * 0.2, x - side * eyeR, ey + eyeR * 0.8);
        ctx.stroke();
        break;
      }
      default: {
        const big = expr === 'wide' ? 1.3 : 1;
        const er = eyeR * big;
        const exx = x + (expr === 'wide' ? 0 : pose.look * 0.8);
        // iris / dot with a gloss of reflected light at the bottom
        ctx.beginPath();
        ctx.arc(exx, ey, er, 0, Math.PI * 2);
        ctx.fillStyle = ink.eye;
        ctx.fill();
        if (ink.dark) {
          // golden eyes with a soft pupil
          ctx.fillStyle = '#2A2438';
          ctx.beginPath();
          ctx.ellipse(exx + pose.look * 0.4, ey + er * 0.05, er * 0.42, er * 0.78, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const g = ctx.createRadialGradient(exx, ey + er * 0.55, 0, exx, ey + er * 0.55, er * 0.9);
          g.addColorStop(0, 'rgba(160,140,190,0.55)');
          g.addColorStop(1, 'rgba(160,140,190,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(exx, ey, er, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(exx + er * 0.36, ey - er * 0.38, er * (expr === 'wide' ? 0.42 : 0.36), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha *= 0.85;
        ctx.beginPath();
        ctx.arc(exx - er * 0.38, ey + er * 0.35, er * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha /= 0.85;
      }
    }
    if (persona === 'dramatic' && (expr === 'open' || expr === 'wide')) {
      // lashes
      ctx.strokeStyle = '#3A2F3F';
      ctx.lineWidth = 1.1 * fs;
      ctx.beginPath();
      ctx.moveTo(x + side * eyeR * 0.85, ey - eyeR * 0.45);
      ctx.lineTo(x + side * eyeR * 1.55, ey - eyeR * 1.05);
      ctx.moveTo(x + side * eyeR * 0.45, ey - eyeR * 0.85);
      ctx.lineTo(x + side * eyeR * 0.85, ey - eyeR * 1.5);
      ctx.stroke();
    }
  };
  drawEye(ex1, -1);
  drawEye(ex2, 1);

  // whisker dots on the muzzle
  ctx.fillStyle = rgba(ink.dark ? '#8F86B3' : shadowOf(ink.muzzle ?? ink.base, 0.45), 0.7);
  for (const s of [-1, 1])
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(fx + s * (3.4 + (k % 2) * 1.6) * fs, ny + (1.6 + k * 1.1) * fs, 0.45 * fs, 0, Math.PI * 2);
      ctx.fill();
    }
  // nose: a soft rounded heart with a shine
  ctx.fillStyle = ink.nose;
  ctx.beginPath();
  ctx.moveTo(fx - 2.6 * fs, ny - 1.3 * fs);
  ctx.quadraticCurveTo(fx, ny - 2.4 * fs, fx + 2.6 * fs, ny - 1.3 * fs);
  ctx.quadraticCurveTo(fx + 2.3 * fs, ny + 0.2 * fs, fx, ny + 1.8 * fs);
  ctx.quadraticCurveTo(fx - 2.3 * fs, ny + 0.2 * fs, fx - 2.6 * fs, ny - 1.3 * fs);
  ctx.fill();
  ctx.strokeStyle = rgba(ink.noseDeep, 0.8);
  ctx.lineWidth = 0.6 * fs;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.ellipse(fx - 0.9 * fs, ny - 1.1 * fs, 0.9 * fs, 0.5 * fs, -0.3, 0, Math.PI * 2);
  ctx.fill();
  // mouth
  ctx.strokeStyle = ink.mouth;
  ctx.lineWidth = 1.2 * fs;
  if (expr === 'wide') {
    ctx.fillStyle = shadowOf(ink.nose, 0.55);
    ctx.beginPath();
    ctx.ellipse(fx, ny + 4.7 * fs, 1.9 * fs, 2.4 * fs, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lightOf(ink.nose, 0.3);
    ctx.beginPath();
    ctx.ellipse(fx, ny + 5.8 * fs, 1.2 * fs, 1 * fs, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const mw = (expr === 'happy' ? 3.4 : 2.8) * fs;
    ctx.beginPath();
    ctx.moveTo(fx, ny + 1.6 * fs);
    ctx.lineTo(fx, ny + 2.6 * fs);
    ctx.quadraticCurveTo(fx - mw * 0.15, ny + 4.2 * fs, fx - mw, ny + 3.1 * fs);
    ctx.moveTo(fx, ny + 2.6 * fs);
    ctx.quadraticCurveTo(fx + mw * 0.15, ny + 4.2 * fs, fx + mw, ny + 3.1 * fs);
    ctx.stroke();
  }
  // whiskers: fine, slightly curved, fanning out
  ctx.strokeStyle = rgba(ink.whisker, ink.whiskerAlpha);
  ctx.lineWidth = 0.55 * fs;
  ctx.beginPath();
  for (const s of [-1, 1]) {
    const x0 = fx + s * 4.6 * fs;
    for (let k = 0; k < 3; k++) {
      const y0 = ny + (1.4 + k * 1.2) * fs;
      const len = r * (0.42 - k * 0.05) + 3 * fs;
      const fan = (k - 1) * 2.2 * fs;
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + s * len * 0.5, y0 + fan * 0.3 - 0.6 * fs, x0 + s * len, y0 + fan + 0.8 * fs);
    }
  }
  ctx.stroke();
}

/** Cat outline extent used for shadows. */
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
