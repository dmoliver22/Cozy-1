// Small math helpers. Anything that feeds the physics simulation must stay
// bit-for-bit deterministic across browsers, so the simulation only uses
// + - * / and Math.sqrt (which IEEE-754 requires to be correctly rounded).
// `dsin`/`dcos` below are deterministic replacements for Math.sin/Math.cos.

export const TAU = Math.PI * 2;

export interface Vec2 {
  x: number;
  y: number;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp(invLerp(a, b, v), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2);
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

/** Deterministic sine (range-reduced Taylor series, ~1e-15 accurate). */
export function dsin(x: number): number {
  // Reduce to [-PI, PI]
  const k = Math.floor((x + Math.PI) / TAU);
  let r = x - k * TAU;
  // Reduce to [-PI/2, PI/2] using sin(PI - r) = sin(r)
  if (r > Math.PI / 2) r = Math.PI - r;
  else if (r < -Math.PI / 2) r = -Math.PI - r;
  const r2 = r * r;
  // Horner form of the Taylor series up to r^17
  let s = 1 / 355687428096000; // 1/17!
  s = -1 / 1307674368000 + r2 * s; // -1/15!
  s = 1 / 6227020800 + r2 * s; // 1/13!
  s = -1 / 39916800 + r2 * s; // -1/11!
  s = 1 / 362880 + r2 * s; // 1/9!
  s = -1 / 5040 + r2 * s; // -1/7!
  s = 1 / 120 + r2 * s; // 1/5!
  s = -1 / 6 + r2 * s; // -1/3!
  s = 1 + r2 * s;
  return r * s;
}

/** Deterministic cosine. */
export function dcos(x: number): number {
  return dsin(x + Math.PI / 2);
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Signed area of a polygon given as parallel coordinate arrays (positive for this engine's winding). */
export function polygonArea(xs: ArrayLike<number>, ys: ArrayLike<number>, n = xs.length): number {
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += xs[j] * ys[i] - xs[i] * ys[j];
  }
  return a * 0.5;
}

export function polygonAreaPts(pts: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return a * 0.5;
}

/** Even-odd point in polygon test on parallel arrays. */
export function pointInPoly(px: number, py: number, xs: ArrayLike<number>, ys: ArrayLike<number>, n = xs.length): boolean {
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = ys[i];
    const yj = ys[j];
    if (yi > py !== yj > py) {
      const xi = xs[i];
      const xj = xs[j];
      const xCross = xj + ((py - yj) * (xi - xj)) / (yi - yj);
      if (px < xCross) inside = !inside;
    }
  }
  return inside;
}

export function pointInPolyPts(px: number, py: number, pts: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > py !== b.y > py) {
      const xCross = b.x + ((py - b.y) * (a.x - b.x)) / (a.y - b.y);
      if (px < xCross) inside = !inside;
    }
  }
  return inside;
}

/** Closest point parameter t in [0,1] on segment AB to point P. */
export function segmentT(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-12) return 0;
  const t = ((px - ax) * dx + (py - ay) * dy) / len2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

/** Superellipse ("loaf") point for angle t, returned via out vector. */
export function superellipsePoint(t: number, a: number, b: number, p: number, out: Vec2): Vec2 {
  const c = dcos(t);
  const s = dsin(t);
  const e = 2 / p;
  out.x = a * Math.sign(c) * powAbs(c, e);
  out.y = b * Math.sign(s) * powAbs(s, e);
  return out;
}

/**
 * Deterministic |x|^e for the superellipse exponents we use (e = 2/p with
 * p in {2, 3, 4}). Only used when building rest shapes.
 */
export function powAbs(x: number, e: number): number {
  const v = Math.abs(x);
  if (v === 0) return 0;
  if (e === 1) return v;
  if (e === 0.5) return Math.sqrt(v);
  if (Math.abs(e - 2 / 3) < 1e-9) return cbrtPos(v * v);
  throw new Error(`powAbs: unsupported exponent ${e}`);
}

function cbrtPos(v: number): number {
  // Newton iteration for y^3 = v starting above the root (monotone convergence).
  let y = v < 1 ? 1 : v;
  for (let i = 0; i < 80; i++) {
    const ny = (2 * y + v / (y * y)) / 3;
    if (ny >= y) break;
    y = ny;
  }
  return y;
}

/** Wrap an angle to [-PI, PI]. Rendering only. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/** Frame-rate independent exponential smoothing factor. Rendering only. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}
