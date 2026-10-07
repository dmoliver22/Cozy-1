// A cat's leap at home: flown along a gravity arc out of the physics (a soft
// body pushing off loses much of its spring, so a kicked hop falls short),
// but never through anything. The moment the cat would touch the furniture,
// a perch or another cat on the way, it's back in the physics where it was,
// moving as it was, and comes down from there. Landing it blind where it was
// headed put cats inside the vase's glass (one too big to go in at its neck)
// and inside one another (a pounce on a cat that had moved, bouncing on the
// cushion), tangled up for good.

import { distToShape } from '../game/spawn';
import type { StaticShape } from '../physics/shapes';
import { NODE_RADIUS, type SoftBody } from '../physics/softbody';
import { FRAME_DT, GRAVITY } from '../physics/world';

/** A leap in flight: its arc (centroid from x0, y0 to x1 over T seconds, `vUp` its speed up off the ground) and the cat's shape as it took off. */
export interface Flight {
  t: number;
  T: number;
  x0: number;
  y0: number;
  x1: number;
  vUp: number;
  /** The cat's nodes as it took off, about its middle (x, y pairs). */
  shape: Float64Array;
}

/**
 * A leap from where the body is to land at x with its bottom at y, over a
 * gravity arc high enough to clear the edge it's landing on (`low`: a
 * pounce, quicker and flatter), its top no higher than `ceil`.
 */
export function planFlight(b: SoftBody, x: number, y: number, low: boolean, ceil: number): Flight {
  b.computeCentroid();
  const r = b.p.radius;
  const y1 = y - r * 0.92 - 2;
  const up = y1 < b.cy - 20;
  const lift = low ? 16 + Math.abs(x - b.cx) * 0.05 + (up ? 10 : 0) : 40 + Math.abs(x - b.cx) * 0.12 + (up ? 16 : 0);
  const apex = Math.max(ceil, Math.min(b.cy, y1) - lift);
  const vUp = Math.sqrt(2 * GRAVITY * Math.max(4, b.cy - apex));
  const T = vUp / GRAVITY + Math.sqrt((2 * Math.max(4, y1 - apex)) / GRAVITY);
  const shape = new Float64Array(b.n * 2);
  for (let i = 0; i < b.n; i++) {
    shape[i * 2] = b.x[i] - b.cx;
    shape[i * 2 + 1] = b.y[i] - b.cy;
  }
  return { t: 0, T, x0: b.cx, y0: b.cy, x1: x, vUp, shape };
}

let nx = new Float64Array(64);
let ny = new Float64Array(64);

/**
 * One frame of a leap. The body (out of the world while it flies) moves on
 * along its arc, unless that would bring it into something: then it stays
 * where it was. Returns where the flight has got to: 'flying', 'landed' (at
 * the end of its arc) or 'touched' (something on the way). Either of the
 * last two, the caller puts it back in the world (see `release`).
 */
export function stepFlight(f: Flight, b: SoftBody, statics: readonly StaticShape[], others: readonly SoftBody[]): 'flying' | 'landed' | 'touched' {
  f.t = Math.min(f.T, f.t + FRAME_DT);
  const { cx, cy, vx, vy } = arcAt(f);
  // stretched a touch along the way it's going (and as much thinner across)
  const sp = Math.hypot(vx, vy) || 1;
  const k = 1 + Math.min(0.14, sp / 5000);
  const ux = vx / sp;
  const uy = vy / sp;
  if (nx.length < b.n) {
    nx = new Float64Array(b.n);
    ny = new Float64Array(b.n);
  }
  for (let i = 0; i < b.n; i++) {
    const ox = f.shape[i * 2];
    const oy = f.shape[i * 2 + 1];
    const along = ox * ux + oy * uy;
    const across = -ox * uy + oy * ux;
    nx[i] = cx + along * k * ux - (across / k) * uy;
    ny[i] = cy + along * k * uy + (across / k) * ux;
  }
  b.airborneFrames++;
  if (comesInto(b, statics, others)) return 'touched';
  b.x.set(nx.subarray(0, b.n));
  b.y.set(ny.subarray(0, b.n));
  return f.t >= f.T ? 'landed' : 'flying';
}

/** Where on its arc a flight is (its middle), and how fast it's going. */
export function arcAt(f: Flight): { cx: number; cy: number; vx: number; vy: number } {
  const u = f.t / f.T;
  return {
    cx: f.x0 + (f.x1 - f.x0) * u,
    cy: f.y0 - f.vUp * f.t + 0.5 * GRAVITY * f.t * f.t,
    vx: (f.x1 - f.x0) / f.T,
    vy: -f.vUp + GRAVITY * f.t,
  };
}

/** Back into the physics, where it is, moving as the flight was (a little less across: it lands, not skids). */
export function release(f: Flight, b: SoftBody): void {
  const { vx, vy } = arcAt(f);
  for (let i = 0; i < b.n; i++) {
    b.px[i] = b.x[i];
    b.py[i] = b.y[i];
    b.vx[i] = vx * 0.5;
    b.vy[i] = vy;
  }
  b.wake();
  b.computeCentroid();
}

/**
 * Would moving the body's nodes from where they are to (nx, ny) bring it
 * into something: a node coming within touching distance of a collider
 * (and nearer than it was: what it's leaving doesn't count), or into
 * another cat (or one of its nodes into this one) further than it was?
 */
function comesInto(b: SoftBody, statics: readonly StaticShape[], others: readonly SoftBody[]): boolean {
  const n = b.n;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, nx[i]);
    maxX = Math.max(maxX, nx[i]);
    minY = Math.min(minY, ny[i]);
    maxY = Math.max(maxY, ny[i]);
  }
  const pad = NODE_RADIUS;
  for (const s of statics) {
    if (maxX < s.minX - pad || minX > s.maxX + pad || maxY < s.minY - pad || minY > s.maxY + pad) continue;
    for (let i = 0; i < n; i++) {
      const x = nx[i];
      const y = ny[i];
      if (x < s.minX - pad || x > s.maxX + pad || y < s.minY - pad || y > s.maxY + pad) continue;
      const d = distToShape(s, x, y);
      if (d < pad && d < distToShape(s, b.x[i], b.y[i]) - 1e-3) return true;
    }
  }
  for (const o of others) {
    if (o === b) continue;
    let ox0 = Infinity;
    let oy0 = Infinity;
    let ox1 = -Infinity;
    let oy1 = -Infinity;
    for (let i = 0; i < o.n; i++) {
      ox0 = Math.min(ox0, o.x[i]);
      ox1 = Math.max(ox1, o.x[i]);
      oy0 = Math.min(oy0, o.y[i]);
      oy1 = Math.max(oy1, o.y[i]);
    }
    if (maxX < ox0 - pad || minX > ox1 + pad || maxY < oy0 - pad || minY > oy1 + pad) continue;
    // (deeper into it than it was: one that set off against it may still leave)
    if (overlap(nx, ny, n, o) > overlap(b.x, b.y, n, o)) return true;
  }
  return false;
}

/** The bodies (but `self`) that a ring of n points (x, y pairs: a cat coming out of a tube) would be in, or have a node in it. */
export function inRingOf(ring: Float64Array, n: number, bodies: readonly SoftBody[], self: SoftBody): SoftBody[] {
  if (nx.length < n) {
    nx = new Float64Array(n);
    ny = new Float64Array(n);
  }
  for (let i = 0; i < n; i++) {
    nx[i] = ring[i * 2];
    ny[i] = ring[i * 2 + 1];
  }
  return bodies.filter((o) => o !== self && overlap(nx, ny, n, o) > 0);
}

/** How many of the nodes (xs, ys) are inside another cat, and of its nodes inside them. */
function overlap(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, o: SoftBody): number {
  let c = 0;
  for (let i = 0; i < n; i++) if (inRing(o.x, o.y, o.n, xs[i], ys[i])) c++;
  for (let i = 0; i < o.n; i++) if (inRing(xs, ys, n, o.x[i], o.y[i])) c++;
  return c;
}

/** Is (px, py) inside the ring of n points (xs, ys)? */
function inRing(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, px: number, py: number): boolean {
  let inside = false;
  for (let k = 0, j = n - 1; k < n; j = k++) {
    const yk = ys[k];
    const yj = ys[j];
    if (yk > py !== yj > py && px < xs[j] + ((py - yj) * (xs[k] - xs[j])) / (yk - yj)) inside = !inside;
  }
  return inside;
}
