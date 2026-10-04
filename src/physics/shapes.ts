// Static (and sandbox-movable) colliders: convex polygons with rounded corners.

import type { Vec2 } from '../util/math';

export type Material = 'ceramic' | 'cardboard' | 'rubber' | 'metal' | 'wicker' | 'wood' | 'fabric' | 'glass' | 'terracotta' | 'wall';

export interface StaticShape {
  id: number;
  n: number;
  xs: Float64Array;
  ys: Float64Array;
  /** Outward edge normals and plane offsets (nx*x + ny*y = d on edge k). */
  nx: Float64Array;
  ny: Float64Array;
  d: Float64Array;
  /** Rounding radius: the collider is the polygon grown by this radius. */
  radius: number;
  friction: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  material: Material;
  /** Owning prop instance id, or -1 for room walls. */
  propId: number;
  /** Is this part of a container (rims, walls, bottom)? */
  container: boolean;
}

let nextShapeId = 1;

/**
 * Build a convex collider from points (any winding). `radius` rounds the corners;
 * the visible outline is the polygon grown by `radius`.
 */
export function makeConvex(
  pts: readonly Vec2[],
  opts: { radius?: number; friction?: number; material?: Material; propId?: number; container?: boolean } = {},
): StaticShape {
  const n = pts.length;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  const ordered = area >= 0 ? pts : [...pts].reverse();
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = ordered[i].x;
    ys[i] = ordered[i].y;
  }
  const shape: StaticShape = {
    id: nextShapeId++,
    n,
    xs,
    ys,
    nx: new Float64Array(n),
    ny: new Float64Array(n),
    d: new Float64Array(n),
    radius: opts.radius ?? 3,
    friction: opts.friction ?? 0.5,
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    material: opts.material ?? 'wood',
    propId: opts.propId ?? -1,
    container: opts.container ?? false,
  };
  updateShapeDerived(shape);
  return shape;
}

export function updateShapeDerived(s: StaticShape): void {
  const { n, xs, ys } = s;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = xs[j] - xs[i];
    const dy = ys[j] - ys[i];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dy / len;
    const ny = -dx / len;
    s.nx[i] = nx;
    s.ny[i] = ny;
    s.d[i] = nx * xs[i] + ny * ys[i];
    if (xs[i] < minX) minX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] > maxY) maxY = ys[i];
  }
  s.minX = minX - s.radius;
  s.minY = minY - s.radius;
  s.maxX = maxX + s.radius;
  s.maxY = maxY + s.radius;
}

export function translateShape(s: StaticShape, dx: number, dy: number): void {
  for (let i = 0; i < s.n; i++) {
    s.xs[i] += dx;
    s.ys[i] += dy;
  }
  updateShapeDerived(s);
}

/** Axis-aligned rounded box. x,y = top-left of the *visible* box. */
export function roundedBox(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  opts: { friction?: number; material?: Material; propId?: number; container?: boolean } = {},
): StaticShape {
  const rr = Math.min(r, w / 2 - 0.01, h / 2 - 0.01);
  return makeConvex(
    [
      { x: x + rr, y: y + rr },
      { x: x + w - rr, y: y + rr },
      { x: x + w - rr, y: y + h - rr },
      { x: x + rr, y: y + h - rr },
    ],
    { ...opts, radius: rr },
  );
}

/** A thick line segment (capsule) from a to b with half-thickness r. */
export function capsule(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: number,
  opts: { friction?: number; material?: Material; propId?: number; container?: boolean } = {},
): StaticShape {
  // A degenerate 2-gon would have no area; use a hair-thin quad so normals exist.
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = (-dy / len) * 0.05;
  const py = (dx / len) * 0.05;
  return makeConvex(
    [
      { x: ax + px, y: ay + py },
      { x: bx + px, y: by + py },
      { x: bx - px, y: by - py },
      { x: ax - px, y: ay - py },
    ],
    { ...opts, radius: r },
  );
}
