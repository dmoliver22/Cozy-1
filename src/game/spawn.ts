// Room for a cat: is a cat-sized ring clear of the furniture and of the other
// cats, and if it isn't, the nearest place that is. A cat put down where
// something already is (a spot remembered from before a vase stood there,
// one squashed up against a neighbour and put back round) would be stuck in
// it for good: the solver can only push its skin out the nearest way, so it
// ends up wrapped round a wall or tangled up in the other cat.

import { crossingAt, type SoftBody } from '../physics/softbody';
import type { StaticShape } from '../physics/shapes';

/** A cat as a ring: its middle and radius. */
export interface Ring {
  x: number;
  y: number;
  r: number;
}

/** How far a point is from a collider's surface (negative: inside it). */
export function distToShape(s: StaticShape, x: number, y: number): number {
  let maxD = -Infinity;
  for (let k = 0; k < s.n; k++) {
    const d = s.nx[k] * x + s.ny[k] * y - s.d[k];
    if (d > maxD) maxD = d;
  }
  if (maxD <= 0) return maxD - s.radius;
  // (outside the core polygon: the exact distance to its edges)
  let best = Infinity;
  for (let k = 0; k < s.n; k++) {
    const k2 = k + 1 === s.n ? 0 : k + 1;
    const ax = s.xs[k];
    const ay = s.ys[k];
    const ex = s.xs[k2] - ax;
    const ey = s.ys[k2] - ay;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 1e-12 ? ((x - ax) * ex + (y - ay) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (ax + ex * t);
    const dy = y - (ay + ey * t);
    best = Math.min(best, dx * dx + dy * dy);
  }
  return Math.sqrt(best) - s.radius;
}

/**
 * Is a ring at (x, y) clear of the colliders (nine tenths of it, or `room`
 * of it: a cat squashes a little, and one put down sits just into what it's
 * on) and of the other cats' rings (all of it, or `room` of it if that's
 * more)?
 */
export function roomFor(statics: readonly StaticShape[], others: readonly Ring[], x: number, y: number, r: number, room = 0.9): boolean {
  for (const o of others) if (Math.hypot(o.x - x, o.y - y) < (o.r + r) * Math.max(1, room)) return false;
  const clear = r * room;
  for (const s of statics) {
    if (x + clear < s.minX || x - clear > s.maxX || y + clear < s.minY || y - clear > s.maxY) continue;
    if (distToShape(s, x, y) < clear) return false;
  }
  return true;
}

/**
 * The nearest place for a ring that started at (x, y) and isn't clear there:
 * up or to either side (a little less keen on sideways), up to `reach` away,
 * where `ok` allows (the same floor of the house, say). Null if there's none.
 * (`room`: see roomFor.)
 */
export function nearestRoom(
  statics: readonly StaticShape[],
  others: readonly Ring[],
  x: number,
  y: number,
  r: number,
  ok: (x: number, y: number) => boolean,
  reach = 240,
  room = 0.9,
): { x: number; y: number } | null {
  const step = 6;
  const cands: { x: number; y: number; cost: number }[] = [];
  for (let dy = 0; dy <= reach * 0.75; dy += step) {
    for (let dx = 0; dx <= reach; dx += step) {
      const cost = dx * 1.2 + dy;
      if (cost > reach * 1.2) break;
      cands.push({ x: x + dx, y: y - dy, cost });
      if (dx) cands.push({ x: x - dx, y: y - dy, cost });
    }
  }
  cands.sort((a, b) => a.cost - b.cost);
  for (const c of cands) if (ok(c.x, c.y) && roomFor(statics, others, c.x, c.y, r, room)) return { x: c.x, y: c.y };
  return null;
}

/** How far in from a cat's skin something must be to count as stuck (not a firm press). */
const STUCK_DEEP = 3.5;
const bb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/**
 * A cat stuck fast: its skin crossed over itself, or caught in the furniture
 * (not just pressed into it): a few of its nodes deep in something, or
 * something inside it (a thin rod, a vase's wall, slipped in between two of
 * its nodes, or a cushion it's wrapped right round).
 */
export function stuckFast(statics: readonly StaticShape[], b: SoftBody): boolean {
  if (crossingAt(b.x, b.y, b.n) >= 0) return true;
  if (nodesInFurniture(statics, b, STUCK_DEEP) >= 3) return true;
  b.bounds(bb);
  for (const s of statics) {
    if (bb.maxX < s.minX || bb.minX > s.maxX || bb.maxY < s.minY || bb.minY > s.maxY) continue;
    // (along its middle: a capsule's spine, a box's core, every few units)
    for (let k = 0; k < s.n; k++) {
      const k2 = k + 1 === s.n ? 0 : k + 1;
      const ex = s.xs[k2] - s.xs[k];
      const ey = s.ys[k2] - s.ys[k];
      const steps = Math.max(1, Math.ceil(Math.hypot(ex, ey) / 6));
      for (let q = 0; q < steps; q++) {
        const x = s.xs[k] + (ex * q) / steps;
        const y = s.ys[k] + (ey * q) / steps;
        if (x < bb.minX || x > bb.maxX || y < bb.minY || y > bb.maxY) continue;
        if (depthIn(b, x, y) > STUCK_DEEP) return true;
      }
    }
  }
  return false;
}

/** How far inside a cat's skin a point is (0 if it's outside). */
function depthIn(b: SoftBody, x: number, y: number): number {
  let inside = false;
  let near = Infinity;
  for (let k = 0, j = b.n - 1; k < b.n; j = k++) {
    const xk = b.x[k];
    const yk = b.y[k];
    const xj = b.x[j];
    const yj = b.y[j];
    if (yk > y !== yj > y && x < xj + ((y - yj) * (xk - xj)) / (yk - yj)) inside = !inside;
    const ex = xk - xj;
    const ey = yk - yj;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 1e-12 ? ((x - xj) * ex + (y - yj) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (xj + ex * t);
    const dy = y - (yj + ey * t);
    near = Math.min(near, dx * dx + dy * dy);
  }
  return inside ? Math.sqrt(near) : 0;
}

/** Is a cat in something: one of its nodes inside a collider, or in another cat (or one of its nodes in this one)? */
export function inSomething(statics: readonly StaticShape[], bodies: readonly SoftBody[], b: SoftBody): boolean {
  if (nodesInFurniture(statics, b, 0) > 0) return true;
  b.bounds(bb);
  for (const o of bodies) {
    if (o === b) continue;
    o.bounds(bb2);
    if (bb.maxX < bb2.minX || bb2.maxX < bb.minX || bb.maxY < bb2.minY || bb2.maxY < bb.minY) continue;
    for (let i = 0; i < b.n; i++) if (depthIn(o, b.x[i], b.y[i]) > 0) return true;
    for (let i = 0; i < o.n; i++) if (depthIn(b, o.x[i], o.y[i]) > 0) return true;
  }
  return false;
}
const bb2 = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/** How many of a cat's nodes are inside the colliders, more than `depth` in. */
export function nodesInFurniture(statics: readonly StaticShape[], b: SoftBody, depth: number): number {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < b.n; i++) {
    minX = Math.min(minX, b.x[i]);
    maxX = Math.max(maxX, b.x[i]);
    minY = Math.min(minY, b.y[i]);
    maxY = Math.max(maxY, b.y[i]);
  }
  let n = 0;
  for (const s of statics) {
    if (maxX < s.minX || minX > s.maxX || maxY < s.minY || minY > s.maxY) continue;
    for (let i = 0; i < b.n; i++) {
      const x = b.x[i];
      const y = b.y[i];
      if (x < s.minX || x > s.maxX || y < s.minY || y > s.maxY) continue;
      if (distToShape(s, x, y) < -depth) n++;
    }
  }
  return n;
}
