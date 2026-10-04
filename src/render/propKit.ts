// Painting kit for the glass containers, on top of the light/colour kit in
// paint.ts. Glass is drawn straight from a container's physics parts (rounded
// boxes and capsules), so a squished cat presses against the inner face of the
// glass: translucent walls with seamless bright edges and darker refraction
// bands, a face-on veil over the cavity baked into small cached maps, rim lips,
// streaks, sparkles and glass ribbons for handles. Everything obeys the single
// key light of paint.ts, also on mirrored (flipped) props.

import { LIGHT, glint, lightGradient, lightOf, mix, rgb, rgba, shadowOf, softShadow, texture, type Box, type Ctx, type TexKind } from './paint';

export type PathFn = () => void;

/** Squash of horizontal circles seen from slightly above (rim ellipses). */
export const K = 0.16;

const TAU = Math.PI * 2;

// --- Light ------------------------------------------------------------------

/** -1 when the current transform mirrors x (a flipped prop), else 1. */
export function lsign(ctx: Ctx): number {
  const m = ctx.getTransform();
  return m.a * m.d - m.b * m.c < 0 ? -1 : 1;
}

/** The key light direction in the current local frame. */
export function lightDir(ctx: Ctx): { x: number; y: number } {
  return { x: LIGHT.x * lsign(ctx), y: LIGHT.y };
}

/**
 * Run `fn` in a frame where the key light comes from -x on screen, so the
 * symmetric parts of a flipped prop are lit like an unflipped one (and text
 * reads the right way round).
 */
export function litFrame(ctx: Ctx, fn: () => void): void {
  if (lsign(ctx) > 0) {
    fn();
    return;
  }
  ctx.save();
  ctx.scale(-1, 1);
  fn();
  ctx.restore();
}

// --- Physics parts ----------------------------------------------------------------

/** A collider of a container, as in props.ts: a rounded box or a capsule. */
export type Part = { k: 'box'; x0: number; y0: number; x1: number; y1: number; r: number } | { k: 'cap'; ax: number; ay: number; bx: number; by: number; r: number };

/** A part for drawing only: a closed clockwise polygon (finely sampled curves) and its bounds. */
export type ShapePart = { k: 'path'; pts: [number, number][]; box: Box };

/** A drawing-only part from a clockwise polygon. */
export function shapePart(pts: [number, number][]): ShapePart {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) {
    box.x0 = Math.min(box.x0, x);
    box.y0 = Math.min(box.y0, y);
    box.x1 = Math.max(box.x1, x);
    box.y1 = Math.max(box.y1, y);
  }
  return { k: 'path', pts, box };
}

/** Anything the glass body is drawn from. */
export type GlassPart = Part | ShapePart;

/** Corner radius the physics actually uses for a rounded box. */
const boxR = (p: { x0: number; y0: number; x1: number; y1: number; r: number }): number => Math.min(p.r, (p.x1 - p.x0) / 2 - 0.01, (p.y1 - p.y0) / 2 - 0.01);

/** Signed distance from (x, y) to a part's surface (negative inside). */
export function sdPart(p: Part, x: number, y: number): number {
  if (p.k === 'cap') {
    const dx = p.bx - p.ax;
    const dy = p.by - p.ay;
    const t = Math.max(0, Math.min(1, ((x - p.ax) * dx + (y - p.ay) * dy) / (dx * dx + dy * dy || 1)));
    const ex = x - p.ax - dx * t;
    const ey = y - p.ay - dy * t;
    return Math.sqrt(ex * ex + ey * ey) - p.r;
  }
  const rr = boxR(p);
  const qx = Math.abs(x - (p.x0 + p.x1) / 2) - ((p.x1 - p.x0) / 2 - rr);
  const qy = Math.abs(y - (p.y0 + p.y1) / 2) - ((p.y1 - p.y0) / 2 - rr);
  const mx = Math.max(qx, 0);
  const my = Math.max(qy, 0);
  return Math.sqrt(mx * mx + my * my) + Math.min(Math.max(qx, qy), 0) - rr;
}

export function sdParts(parts: readonly Part[], x: number, y: number): number {
  let d = Infinity;
  for (const p of parts) d = Math.min(d, sdPart(p, x, y));
  return d;
}

/** Signed distance to a closed polygon (negative inside). */
function sdPoly(pts: readonly [number, number][], x: number, y: number): number {
  let d2 = Infinity;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j][0];
    const ay = pts[j][1];
    const ex = pts[i][0] - ax;
    const ey = pts[i][1] - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1)));
    const dx = x - ax - ex * t;
    const dy = y - ay - ey * t;
    d2 = Math.min(d2, dx * dx + dy * dy);
    if (ay > y !== pts[i][1] > y && x < ax + ((y - ay) * ex) / ey) inside = !inside;
  }
  return inside ? -Math.sqrt(d2) : Math.sqrt(d2);
}

function sdGlass(p: GlassPart, x: number, y: number): number {
  return p.k === 'path' ? sdPoly(p.pts, x, y) : sdPart(p, x, y);
}

/** Add a part's exact outline to the current path (clockwise). */
export function partPath(ctx: Ctx, p: GlassPart): void {
  if (p.k === 'path') {
    ctx.moveTo(p.pts[0][0], p.pts[0][1]);
    for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
    ctx.closePath();
    return;
  }
  if (p.k === 'box') {
    const rr = boxR(p);
    ctx.moveTo(p.x0 + rr, p.y0);
    ctx.arc(p.x1 - rr, p.y0 + rr, rr, -Math.PI / 2, 0);
    ctx.arc(p.x1 - rr, p.y1 - rr, rr, 0, Math.PI / 2);
    ctx.arc(p.x0 + rr, p.y1 - rr, rr, Math.PI / 2, Math.PI);
    ctx.arc(p.x0 + rr, p.y0 + rr, rr, Math.PI, Math.PI * 1.5);
  } else {
    const a = Math.atan2(p.by - p.ay, p.bx - p.ax);
    ctx.moveTo(p.bx + p.r * Math.cos(a - Math.PI / 2), p.by + p.r * Math.sin(a - Math.PI / 2));
    ctx.arc(p.bx, p.by, p.r, a - Math.PI / 2, a + Math.PI / 2);
    ctx.arc(p.ax, p.ay, p.r, a + Math.PI / 2, a + Math.PI * 1.5);
  }
  ctx.closePath();
}

export function partsBox(parts: readonly GlassPart[]): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of parts) {
    const [x0, x1, y0, y1] =
      p.k === 'path' ? [p.box.x0, p.box.x1, p.box.y0, p.box.y1] : p.k === 'box' ? [p.x0, p.x1, p.y0, p.y1] : [Math.min(p.ax, p.bx) - p.r, Math.max(p.ax, p.bx) + p.r, Math.min(p.ay, p.by) - p.r, Math.max(p.ay, p.by) + p.r];
    b.x0 = Math.min(b.x0, x0);
    b.x1 = Math.max(b.x1, x1);
    b.y0 = Math.min(b.y0, y0);
    b.y1 = Math.max(b.y1, y1);
  }
  return b;
}

// --- The cavity ----------------------------------------------------------------------

/** The hollow of a container: the inner faces of its walls, row by row. */
export interface Cavity {
  /** y of the first row (the rim) and the row spacing. */
  y0: number;
  step: number;
  n: number;
  xl: Float32Array;
  xr: Float32Array;
  /** Where the hollow meets the floor (the top of the base). */
  floorY: number;
  minX: number;
  maxX: number;
  /** The hollow's outline (rim row, right face, floor, left face) as a simplified clockwise polygon, x/y pairs. */
  outline: Float32Array;
}

/** Indices of an open polyline worth keeping (Ramer-Douglas-Peucker), both ends included. */
function simplifyLine(xs: readonly number[], ys: readonly number[], tol: number): number[] {
  const n = xs.length;
  if (n <= 2) return xs.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [0, n - 1];
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const dx = xs[b] - xs[a];
    const dy = ys[b] - ys[a];
    const len = Math.hypot(dx, dy) || 1e-9;
    let md = tol;
    let mi = -1;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((xs[k] - xs[a]) * dy - (ys[k] - ys[a]) * dx) / len;
      if (d > md) {
        md = d;
        mi = k;
      }
    }
    if (mi >= 0) {
      keep[mi] = 1;
      stack.push(a, mi, mi, b);
    }
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(k);
  return out;
}

/** Scan the inner faces of the walls from the parts, starting at (cx, yTop) inside the hollow. */
export function scanCavity(parts: readonly Part[], cx: number, yTop: number): Cavity {
  const step = 0.5;
  const d = (x: number, y: number): number => sdParts(parts, x, y);
  const face = (y: number, dir: number): number => {
    let a = cx;
    let b = cx;
    for (let k = 0; k < 600; k++) {
      b = a + dir * 0.5;
      if (d(b, y) <= 0) break;
      a = b;
    }
    for (let k = 0; k < 16; k++) {
      const m = (a + b) / 2;
      if (d(m, y) > 0) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  const xl: number[] = [];
  const xr: number[] = [];
  let y = yTop;
  while (y < yTop + 400 && d(cx, y) > 0) {
    xl.push(face(y, -1));
    xr.push(face(y, 1));
    y += step;
  }
  let a = y - step;
  let b = y;
  for (let k = 0; k < 16; k++) {
    const m = (a + b) / 2;
    if (d(cx, m) > 0) a = m;
    else b = m;
  }
  const floorY = (a + b) / 2;
  const n = xl.length;
  const outline: number[] = [];
  if (n > 0) {
    // the right face down to the floor, then the left face back up, each simplified
    const rx = [...xr, xr[n - 1]];
    const ry = [...xr.map((_, i) => yTop + i * step), floorY];
    const lx = [xl[n - 1], ...xl.slice().reverse()];
    const ly = [floorY, ...xl.map((_, i) => yTop + (n - 1 - i) * step)];
    for (const k of simplifyLine(rx, ry, 0.03)) outline.push(rx[k], ry[k]);
    for (const k of simplifyLine(lx, ly, 0.03)) outline.push(lx[k], ly[k]);
  }
  return { y0: yTop, step, n, xl: Float32Array.from(xl), xr: Float32Array.from(xr), floorY, minX: Math.min(...xl), maxX: Math.max(...xr), outline: Float32Array.from(outline) };
}

/** Centre and half width of the hollow at height y. */
export function cavityAt(c: Cavity, y: number): { cx: number; hw: number } {
  const i = Math.max(0, Math.min(c.n - 1, Math.round((y - c.y0) / c.step)));
  return { cx: (c.xl[i] + c.xr[i]) / 2, hw: Math.max(0.5, (c.xr[i] - c.xl[i]) / 2) };
}

/** Add the hollow (rim row down to the floor) to the current path, clockwise. */
export function cavityPath(ctx: Ctx, c: Cavity): void {
  const o = c.outline;
  if (o.length < 6) return;
  ctx.moveTo(o[0], o[1]);
  for (let i = 2; i < o.length; i += 2) ctx.lineTo(o[i], o[i + 1]);
  ctx.closePath();
}

// --- Glass ---------------------------------------------------------------------------

interface GlassMap {
  img: HTMLCanvasElement;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

const glassCache = new Map<string, GlassMap>();
const GRES = 1.5;

/**
 * A glass wall seen face-on across the hollow, as translucent paint: clear in
 * the middle and denser toward the sides, where we look through the curved
 * glass at a grazing angle. The near wall also mirrors the window in two soft
 * bands on the lit side; the far wall deepens toward the floor and catches the
 * light on its inner face opposite the light. `top` is where the map starts
 * (above the rim for the far wall, seen through the opening).
 */
function glassMap(key: string, c: Cavity, tint: string, far: boolean, L: number, top: number): GlassMap {
  const id = `${key}|${tint}|${far ? 'far' : 'near'}|${L}`;
  const hit = glassCache.get(id);
  if (hit) return hit;
  const x0 = c.minX - 1;
  const y0 = top - 1;
  const W = Math.max(1, Math.ceil((c.maxX - c.minX + 2) * GRES));
  const H = Math.max(1, Math.ceil((c.floorY - y0 + 1) * GRES));
  const img = document.createElement('canvas');
  img.width = W;
  img.height = H;
  const g = img.getContext('2d')!;
  const id8 = g.createImageData(W, H);
  const d = id8.data;
  const G = rgb(tint);
  const D = rgb(shadowOf(tint, 0.5));
  const span = Math.max(1, c.floorY - c.y0);
  for (let r = 0; r < H; r++) {
    const y = y0 + (r + 0.5) / GRES;
    const { cx, hw } = cavityAt(c, y);
    const depth = Math.max(0, Math.min(1, (y - c.y0) / span));
    const T = far ? G.map((v, k) => v + (D[k] - v) * (0.2 + 0.5 * depth)) : G;
    for (let col = 0; col < W; col++) {
      const x = x0 + (col + 0.5) / GRES;
      const u = Math.max(-1, Math.min(1, (x - cx) / hw));
      const au = Math.abs(u);
      const s = -L * u;
      let at: number;
      let ar: number;
      if (far) {
        at = 0.19 + 0.18 * au ** 2.5 + 0.12 * depth * depth;
        ar = 0.14 * Math.exp(-(((-s - 0.55) / 0.2) ** 2));
      } else {
        at = 0.07 + 0.22 * au ** 3;
        ar = 0.15 * Math.exp(-(((s - 0.5) / 0.15) ** 2)) + 0.12 * Math.exp(-(((s - 0.84) / 0.07) ** 2));
      }
      const A = at + ar * (1 - at);
      const o = (r * W + col) * 4;
      for (let k = 0; k < 3; k++) d[o + k] = (T[k] * at * (1 - ar) + 255 * ar) / A;
      d[o + 3] = A * 255;
    }
  }
  g.putImageData(id8, 0, 0);
  const map = { img, x0, y0, w: W / GRES, h: H / GRES };
  glassCache.set(id, map);
  return map;
}

/** Paint the near or far glass wall over the hollow, clipped to `clip`. */
export function glassWall(ctx: Ctx, key: string, c: Cavity, tint: string, far: boolean, clip: PathFn, top = c.y0): void {
  if (c.n < 2) return;
  const m = glassMap(key, c, tint, far, lsign(ctx), top);
  ctx.save();
  clip();
  ctx.clip();
  ctx.drawImage(m.img, m.x0, m.y0, m.w, m.h);
  ctx.restore();
}

/**
 * Inks for glass seen edge-on, across `b` from the lit to the shaded side: a
 * bright edge line, a thin dark fringe round it (the background bent by the
 * glass) and a darker refraction band inside.
 */
function glassInks(ctx: Ctx, b: Box, tint: string): { edge: CanvasGradient; fringe: CanvasGradient; band: CanvasGradient } {
  const dir = lightDir(ctx);
  return {
    edge: lightGradient(ctx, b, [[0, 'rgba(255,255,255,0.98)'], [0.5, rgba(lightOf(tint, 0.88), 0.9)], [1, rgba(lightOf(tint, 0.65), 0.7)]], dir),
    fringe: lightGradient(ctx, b, [[0, rgba(shadowOf(tint, 0.55), 0.35)], [1, rgba(shadowOf(tint, 0.72), 0.62)]], dir),
    band: lightGradient(ctx, b, [[0, rgba(shadowOf(tint, 0.45), 0.3)], [1, rgba(shadowOf(tint, 0.66), 0.58)]], dir),
  };
}

// --- Union outlines ------------------------------------------------------------------

/** A run of outline: a segment, or an arc with increasing angle (clockwise on screen). */
type Piece = { arc: false; x0: number; y0: number; x1: number; y1: number } | { arc: true; cx: number; cy: number; r: number; a0: number; a1: number };

function pieceAt(q: Piece, t: number): [number, number] {
  if (q.arc) {
    const a = q.a0 + (q.a1 - q.a0) * t;
    return [q.cx + q.r * Math.cos(a), q.cy + q.r * Math.sin(a)];
  }
  return [q.x0 + (q.x1 - q.x0) * t, q.y0 + (q.y1 - q.y0) * t];
}

function pieceLen(q: Piece): number {
  return q.arc ? q.r * (q.a1 - q.a0) : Math.hypot(q.x1 - q.x0, q.y1 - q.y0);
}

function subPiece(q: Piece, t0: number, t1: number): Piece {
  if (q.arc) return { ...q, a0: q.a0 + (q.a1 - q.a0) * t0, a1: q.a0 + (q.a1 - q.a0) * t1 };
  const [x0, y0] = pieceAt(q, t0);
  const [x1, y1] = pieceAt(q, t1);
  return { arc: false, x0, y0, x1, y1 };
}

/** A part's outline as pieces, clockwise, exactly as partPath draws it. */
function partPieces(p: GlassPart): Piece[] {
  const line = (x0: number, y0: number, x1: number, y1: number): Piece => ({ arc: false, x0, y0, x1, y1 });
  let out: Piece[];
  if (p.k === 'path') {
    out = p.pts.map((a, i) => {
      const b = p.pts[(i + 1) % p.pts.length];
      return line(a[0], a[1], b[0], b[1]);
    });
  } else if (p.k === 'box') {
    const rr = boxR(p);
    const arc = (cx: number, cy: number, a0: number): Piece => ({ arc: true, cx, cy, r: rr, a0, a1: a0 + Math.PI / 2 });
    out = [
      line(p.x0 + rr, p.y0, p.x1 - rr, p.y0),
      arc(p.x1 - rr, p.y0 + rr, -Math.PI / 2),
      line(p.x1, p.y0 + rr, p.x1, p.y1 - rr),
      arc(p.x1 - rr, p.y1 - rr, 0),
      line(p.x1 - rr, p.y1, p.x0 + rr, p.y1),
      arc(p.x0 + rr, p.y1 - rr, Math.PI / 2),
      line(p.x0, p.y1 - rr, p.x0, p.y0 + rr),
      arc(p.x0 + rr, p.y0 + rr, Math.PI),
    ];
  } else {
    const a = Math.atan2(p.by - p.ay, p.bx - p.ax);
    const ux = p.r * Math.cos(a + Math.PI / 2);
    const uy = p.r * Math.sin(a + Math.PI / 2);
    out = [
      { arc: true, cx: p.bx, cy: p.by, r: p.r, a0: a - Math.PI / 2, a1: a + Math.PI / 2 },
      line(p.bx + ux, p.by + uy, p.ax + ux, p.ay + uy),
      { arc: true, cx: p.ax, cy: p.ay, r: p.r, a0: a + Math.PI / 2, a1: a + Math.PI * 1.5 },
      line(p.ax - ux, p.ay - uy, p.bx - ux, p.by - uy),
    ];
  }
  return out.filter((q) => pieceLen(q) > 1e-6);
}

const outlineCache = new WeakMap<readonly GlassPart[], Path2D>();

/**
 * The outline of the union of `parts` as one path of exact arcs and segments:
 * the runs of each part's outline outside all the others, chained end to start
 * (outer loops and holes run opposite ways, so it also fills and clips as the
 * union). Edges drawn along it are seamless where parts fuse and cost a single
 * stroke. Cached per part list.
 */
export function unionOutline(parts: readonly GlassPart[]): Path2D {
  const hit = outlineCache.get(parts);
  if (hit) return hit;
  const EPS = 1e-3;
  const boxes = parts.map((p) => partsBox([p]));
  const pieces: Piece[] = [];
  for (let i = 0; i < parts.length; i++) {
    // on the outline unless inside another part (a shared stretch goes to the first part)
    const free = (t: number, q: Piece): boolean => {
      const [x, y] = pieceAt(q, t);
      for (let j = 0; j < parts.length; j++) {
        const b = boxes[j];
        if (j === i || x < b.x0 - 0.01 || x > b.x1 + 0.01 || y < b.y0 - 0.01 || y > b.y1 + 0.01) continue;
        const d = sdGlass(parts[j], x, y);
        if (d < -EPS || (d <= EPS && j < i)) return false;
      }
      return true;
    };
    for (const q of partPieces(parts[i])) {
      const n = Math.max(2, Math.ceil(pieceLen(q) / 0.1));
      let pt = 0;
      let pf = free(0, q);
      let t0 = pf ? 0 : -1;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const f = free(t, q);
        if (f !== pf) {
          let lo = pt;
          let hi = t;
          for (let it = 0; it < 26; it++) {
            const m = (lo + hi) / 2;
            if (free(m, q) === pf) lo = m;
            else hi = m;
          }
          const tc = (lo + hi) / 2;
          if (f) t0 = tc;
          else if (t0 >= 0) {
            if (tc > t0) pieces.push(subPiece(q, t0, tc));
            t0 = -1;
          }
        }
        pt = t;
        pf = f;
      }
      if (pf && t0 >= 0 && t0 < 1) pieces.push(subPiece(q, t0, 1));
    }
  }
  // chain the runs end to start into closed loops
  const S = pieces.map((q) => pieceAt(q, 0));
  const E = pieces.map((q) => pieceAt(q, 1));
  const used = new Uint8Array(pieces.length);
  const path = new Path2D();
  for (let s0 = 0; s0 < pieces.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    path.moveTo(S[s0][0], S[s0][1]);
    let cur = s0;
    for (;;) {
      const q = pieces[cur];
      if (q.arc) path.arc(q.cx, q.cy, q.r, q.a0, q.a1);
      else path.lineTo(q.x1, q.y1);
      const [ex, ey] = E[cur];
      let best = -1;
      let bd = 0.6;
      for (let k = 0; k < pieces.length; k++) {
        if (used[k]) continue;
        const d = Math.hypot(S[k][0] - ex, S[k][1] - ey);
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      if (best < 0 || Math.hypot(S[s0][0] - ex, S[s0][1] - ey) <= bd) break;
      used[best] = 1;
      cur = best;
    }
    path.closePath();
  }
  outlineCache.set(parts, path);
  return path;
}

/**
 * Solid glass (walls, bases and feet seen edge-on), drawn exactly on the
 * physics parts: one translucent body for the union, denser and greener where
 * the glass is thick, then along the union's outline (no seams where parts
 * fuse) a darker refraction band just inside and a crisp bright edge.
 */
export function glassSolid(ctx: Ctx, parts: readonly GlassPart[], thick: readonly GlassPart[], tint: string, o: { body?: number; thick?: number; green?: string } = {}): void {
  if (!parts.length) return;
  const b = partsBox(parts);
  const outline = unionOutline(parts);
  ctx.save();
  ctx.fillStyle = rgba(mix(tint, shadowOf(tint, 0.35), 0.5), o.body ?? 0.36);
  ctx.fill(outline);
  if (thick.length) {
    const gb = partsBox(thick);
    const tg = ctx.createLinearGradient(0, gb.y0, 0, gb.y1);
    const tc = mix(tint, o.green ?? '#86C9AF', 0.45);
    tg.addColorStop(0, rgba(tc, (o.thick ?? 0.36) * 0.7));
    tg.addColorStop(1, rgba(shadowOf(tc, 0.25), o.thick ?? 0.36));
    ctx.beginPath();
    for (const p of thick) partPath(ctx, p);
    ctx.fillStyle = tg;
    ctx.fill();
  }
  const { edge, fringe, band } = glassInks(ctx, b, tint);
  ctx.lineJoin = 'round';
  ctx.save();
  ctx.clip(outline);
  ctx.strokeStyle = band;
  ctx.lineWidth = 3.6;
  ctx.stroke(outline);
  ctx.restore();
  ctx.strokeStyle = fringe;
  ctx.lineWidth = 2.3;
  ctx.stroke(outline);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.stroke(outline);
  ctx.restore();
}

/** A single closed glass shape (handle, saucer, lid): body, inner band and bright edge. */
export function glassShape(ctx: Ctx, path: PathFn, b: Box, tint: string, body = 0.34): void {
  ctx.save();
  path();
  ctx.fillStyle = rgba(mix(tint, shadowOf(tint, 0.35), 0.5), body);
  ctx.fill();
  const { edge, fringe, band } = glassInks(ctx, b, tint);
  ctx.save();
  path();
  ctx.clip();
  ctx.strokeStyle = band;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
  path();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = fringe;
  ctx.lineWidth = 2.1;
  ctx.stroke();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.restore();
}

/** A round rim: wall centre radius `rxm` at height y, glass `r` thick (as the top capsules). */
export interface Rim {
  cx: number;
  y: number;
  rxm: number;
  r: number;
}

/**
 * The near (front layer) or far (back layer) half of a round glass rim: a lip
 * as thick as the walls, bright along its outer edge, with an optional gilded
 * line; the near half also gets a specular arc and a glint on the lit side.
 */
export function rimLip(ctx: Ctx, rim: Rim, tint: string, half: 'near' | 'far', gold?: string): void {
  const { cx, y, rxm, r } = rim;
  const ro = rxm + r;
  const ri = Math.max(1, rxm - r);
  const yo = ro * K;
  const yi = ri * K;
  const near = half === 'near';
  const b: Box = { x0: cx - ro, y0: y - yo, x1: cx + ro, y1: y + yo };
  const path = (): void => {
    ctx.beginPath();
    if (near) {
      ctx.moveTo(cx - ro, y);
      ctx.ellipse(cx, y, ro, yo, 0, Math.PI, 0, true);
      ctx.lineTo(cx + ri, y);
      ctx.ellipse(cx, y, ri, yi, 0, 0, Math.PI, false);
    } else {
      ctx.moveTo(cx - ro, y);
      ctx.ellipse(cx, y, ro, yo, 0, Math.PI, TAU, false);
      ctx.lineTo(cx + ri, y);
      ctx.ellipse(cx, y, ri, yi, 0, TAU, Math.PI, true);
    }
    ctx.closePath();
  };
  const outer = (): void => {
    ctx.beginPath();
    if (near) ctx.ellipse(cx, y, ro, yo, 0, 0, Math.PI);
    else ctx.ellipse(cx, y, ro, yo, 0, Math.PI, TAU);
  };
  const inner = (): void => {
    ctx.beginPath();
    if (near) ctx.ellipse(cx, y, ri, yi, 0, 0, Math.PI);
    else ctx.ellipse(cx, y, ri, yi, 0, Math.PI, TAU);
  };
  const { edge, fringe } = glassInks(ctx, b, tint);
  const L = lsign(ctx);
  ctx.save();
  path();
  ctx.fillStyle = lightGradient(ctx, b, [[0, rgba(lightOf(tint, 0.7), near ? 0.58 : 0.5)], [1, rgba(mix(tint, shadowOf(tint, 0.35), 0.5), near ? 0.46 : 0.4)]], lightDir(ctx));
  ctx.fill();
  ctx.lineCap = 'round';
  outer();
  ctx.strokeStyle = fringe;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.stroke();
  inner();
  ctx.strokeStyle = rgba(lightOf(tint, 0.8), 0.6);
  ctx.lineWidth = 0.7;
  ctx.stroke();
  if (gold) {
    ctx.strokeStyle = rgba(gold, 0.95);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    const rg = rxm + r * 0.55;
    if (near) ctx.ellipse(cx, y, rg, rg * K, 0, 0, Math.PI);
    else ctx.ellipse(cx, y, rg, rg * K, 0, Math.PI, TAU);
    ctx.stroke();
  }
  if (near) {
    // a crisp highlight on the lit part of the lip, and a glint
    const a0 = L > 0 ? Math.PI * 0.6 : Math.PI * 0.14;
    const a1 = L > 0 ? Math.PI * 0.86 : Math.PI * 0.4;
    const rm = rxm;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.ellipse(cx, y, rm, rm * K, 0, a0, a1);
    ctx.stroke();
    const ag = L > 0 ? Math.PI * 0.7 : Math.PI * 0.3;
    glint(ctx, cx + rm * Math.cos(ag), y + rm * K * Math.sin(ag), 0.8, 0.9);
  }
  ctx.restore();
}

/**
 * A crisp glossy streak over the near wall, following the hollow's profile
 * at fraction u of its half width on the lit side and tapering at both ends.
 */
export function glassStreak(ctx: Ctx, c: Cavity, u: number, y0: number, y1: number, w: number, alpha: number): void {
  const L = lsign(ctx);
  const n = 14;
  const xs: number[] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = y0 + (y1 - y0) * t;
    const { cx, hw } = cavityAt(c, y);
    xs.push(cx - L * hw * u);
    ys.push(y);
    ws.push(w * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.7));
  }
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.8})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i <= n; i++) ctx.lineTo(xs[i] - ws[i] * 0.5, ys[i]);
  for (let i = n; i >= 0; i--) ctx.lineTo(xs[i] + ws[i] * 0.5, ys[i]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A four-pointed sparkle with a soft glint at its heart. */
export function sparkle(ctx: Ctx, x: number, y: number, r: number, alpha = 0.9): void {
  glint(ctx, x, y, r * 0.28, alpha);
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.beginPath();
  const t = r * 0.16;
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + t, y - t, x + r * 0.8, y);
  ctx.quadraticCurveTo(x + t, y + t, x, y + r);
  ctx.quadraticCurveTo(x - t, y + t, x - r * 0.8, y);
  ctx.quadraticCurveTo(x - t, y - t, x, y - r);
  ctx.fill();
  ctx.restore();
}

/** Points along a cubic Bezier. */
export function bezierPts(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, n = 16): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
  }
  return out;
}

/** A closed outline `w` wide around a polyline of centre points, with round ends (a new path unless `begin` is false). */
export function ribbonPath(ctx: Ctx, pts: [number, number][], w: number, begin = true): void {
  const n = pts.length;
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[Math.max(0, i - 1)];
    const [bx, by] = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    nx.push(-(by - ay) / l);
    ny.push((bx - ax) / l);
  }
  const h = w / 2;
  if (begin) ctx.beginPath();
  ctx.moveTo(pts[0][0] + nx[0] * h, pts[0][1] + ny[0] * h);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0] + nx[i] * h, pts[i][1] + ny[i] * h);
  const ae = Math.atan2(ny[n - 1], nx[n - 1]);
  ctx.arc(pts[n - 1][0], pts[n - 1][1], h, ae, ae + Math.PI, true);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(pts[i][0] - nx[i] * h, pts[i][1] - ny[i] * h);
  const as = Math.atan2(ny[0], nx[0]);
  ctx.arc(pts[0][0], pts[0][1], h, as + Math.PI, as, true);
  ctx.closePath();
}

// --- Handles, rods and small parts -------------------------------------------------

/**
 * A round handle or rod along a stroked path: outline, shaded core and a
 * highlight pushed toward the light.
 */
export function tube(ctx: Ctx, path: PathFn, width: number, base: string, o: { line?: string; spec?: number; shade?: number } = {}): void {
  const d = lightDir(ctx);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = o.line ?? shadowOf(base, 0.7);
  ctx.lineWidth = width + 2.2;
  path();
  ctx.stroke();
  ctx.strokeStyle = shadowOf(base, o.shade ?? 0.38);
  ctx.lineWidth = width;
  path();
  ctx.stroke();
  ctx.translate(d.x * width * 0.12, d.y * width * 0.12);
  ctx.strokeStyle = base;
  ctx.lineWidth = width * 0.68;
  path();
  ctx.stroke();
  ctx.translate(d.x * width * 0.12, d.y * width * 0.12);
  ctx.strokeStyle = rgba(lightOf(base, 0.55), 0.85);
  ctx.lineWidth = width * 0.3;
  path();
  ctx.stroke();
  if (o.spec) {
    ctx.translate(d.x * width * 0.05, d.y * width * 0.05);
    ctx.strokeStyle = `rgba(255,255,255,${o.spec})`;
    ctx.lineWidth = Math.max(0.6, width * 0.12);
    path();
    ctx.stroke();
  }
  ctx.restore();
}

/** A small domed rivet or nail head. */
export function rivet(ctx: Ctx, x: number, y: number, r: number, base: string): void {
  const d = lightDir(ctx);
  ctx.save();
  ctx.fillStyle = rgba(shadowOf(base, 0.8), 0.45);
  ctx.beginPath();
  ctx.arc(x - d.x * r * 0.35, y - d.y * r * 0.35, r * 1.05, 0, TAU);
  ctx.fill();
  const g = ctx.createRadialGradient(x + d.x * r * 0.4, y + d.y * r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, lightOf(base, 0.7));
  g.addColorStop(0.6, base);
  g.addColorStop(1, shadowOf(base, 0.45));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Contact shadow under a prop resting at (x, y): tight core plus a soft spread nudged away from the light. */
export function restShadow(ctx: Ctx, x: number, y: number, halfW: number, ry: number, alpha: number): void {
  softShadow(ctx, x + halfW * 0.1, y - ry * 0.2, halfW * 1.28, ry + 5, alpha * 0.42);
  softShadow(ctx, x + halfW * 0.03, y - ry * 0.35, halfW * 1.04, ry * 0.8 + 2.2, alpha);
}

/** Light focused by glass onto the surface below it: a soft warm patch away from the light (world space). */
export function caustic(ctx: Ctx, x: number, y: number, rx: number, ry: number, alpha: number, color = '#FFF2D2'): void {
  if (alpha <= 0 || rx <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.5, rgba(color, alpha * 0.45));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Pixels per world unit, bucketed in quarter octaves (so cached rasters are reused). */
export function resBucket(ppu: number): number {
  return 2 ** (Math.ceil(Math.log2(Math.max(0.25, ppu)) * 4) / 4);
}

// --- Textures --------------------------------------------------------------------

const texCache = new Map<string, HTMLCanvasElement>();
const patCache = new WeakMap<Ctx, Map<string, CanvasPattern>>();
const pixelCache = new Map<string, Uint8ClampedArray>();

/**
 * One of paint.ts's grey textures baked into translucent light and dark paint
 * (cached), so it can be laid on with a plain source-over fill.
 */
function baked(kind: TexKind, light: string, dark: string): HTMLCanvasElement {
  const key = `bk|${kind}|${light}|${dark}`;
  let c = texCache.get(key);
  if (c) return c;
  const src = texture(kind);
  let sd = pixelCache.get(kind);
  if (!sd) {
    sd = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
    pixelCache.set(kind, sd);
  }
  c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  const img = g.createImageData(src.width, src.height);
  const Lc = rgb(light);
  const Dc = rgb(dark);
  for (let i = 0; i < src.width * src.height; i++) {
    const v = (sd[i * 4] - 128) / 127;
    const col = v > 0 ? Lc : Dc;
    img.data[i * 4] = col[0];
    img.data[i * 4 + 1] = col[1];
    img.data[i * 4 + 2] = col[2];
    img.data[i * 4 + 3] = Math.min(255, Math.abs(v) * 255);
  }
  g.putImageData(img, 0, 0);
  texCache.set(key, c);
  return c;
}

/** Lay one of paint.ts's textures over a shape as light and dark paint (source-over). */
export function texPaint(ctx: Ctx, path: PathFn, kind: TexKind, o: { alpha: number; scale?: number; light?: string; dark?: string }): void {
  if (o.alpha <= 0) return;
  const light = o.light ?? '#FFF7EA';
  const dark = o.dark ?? '#33293F';
  const key = `${kind}|${light}|${dark}`;
  let m = patCache.get(ctx);
  if (!m) {
    m = new Map();
    patCache.set(ctx, m);
  }
  let pat = m.get(key) ?? null;
  if (!pat) {
    pat = ctx.createPattern(baked(kind, light, dark), 'repeat');
    if (!pat) return;
    m.set(key, pat);
  }
  const s = o.scale ?? 0.35;
  if (typeof pat.setTransform === 'function') pat.setTransform({ a: s, b: 0, c: 0, d: s, e: 0, f: 0 });
  ctx.save();
  ctx.globalAlpha *= o.alpha;
  ctx.fillStyle = pat;
  path();
  ctx.fill();
  ctx.restore();
}
