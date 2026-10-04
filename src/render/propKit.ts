// Painting kit for the containers, on top of the light/colour kit in paint.ts.
// A vessel is painted flat (base colour, motifs, texture) and then lit as a
// cylinder by a cached translucent shading map laid over it, so painted motifs
// turn with the form. Rim lips, interiors, tube-shaded handles, textures baked
// for cheap source-over fills and small raster caches complete it. Everything
// obeys the single key light of paint.ts, also on mirrored (flipped) props.

import { LIGHT, glint, hash01, lightGradient, lightOf, lineOf, rgb, rgba, shadowOf, softShadow, texture, type Box, type Ctx, type TexKind } from './paint';

export type PathFn = () => void;

/** Squash of horizontal circles seen from slightly above (rim ellipses). */
const K = 0.16;

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

type Side = 'shadow' | 'light' | 'bottom' | 'top' | 'all';

/** paint.ts's edgeShade, but lit correctly in a mirrored frame too. */
export function edgeShadeL(ctx: Ctx, path: PathFn, b: Box, color: string, width: number, alpha: number, side: Side = 'shadow', steps = 3): void {
  if (alpha <= 0 || width <= 0) return;
  ctx.save();
  path();
  ctx.clip();
  let style: string | CanvasGradient = color;
  if (side !== 'all') {
    const on = rgba(color, 1);
    const off = rgba(color, 0);
    const stops: [number, string][] = side === 'shadow' || side === 'bottom' ? [[0, off], [0.42, off], [0.85, on], [1, on]] : [[0, on], [0.15, on], [0.58, off], [1, off]];
    const dir = side === 'bottom' || side === 'top' ? { x: 0, y: -1 } : lightDir(ctx);
    style = lightGradient(ctx, b, stops, dir);
  }
  ctx.strokeStyle = style;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const a0 = ctx.globalAlpha;
  for (let k = steps; k >= 1; k--) {
    ctx.globalAlpha = a0 * (alpha / steps) * (k === 1 ? 1.15 : 1);
    ctx.lineWidth = (2 * width * k) / steps;
    path();
    ctx.stroke();
  }
  ctx.restore();
}

/** Outline that is thinner and fainter on the lit side ("lost and found" edge). */
export function outline(ctx: Ctx, path: PathFn, b: Box, color: string, width = 1.3, lit = 0.4): void {
  ctx.save();
  ctx.strokeStyle = lightGradient(ctx, b, [[0, rgba(color, lit)], [0.45, rgba(color, 0.85)], [1, rgba(color, 1)]], lightDir(ctx));
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  path();
  ctx.stroke();
  ctx.restore();
}

/** Multiply colour that turns `base` into shadowOf(base, t) (so motifs on it darken alike). */
function mulOf(base: string, t: number): string {
  const B = rgb(base);
  const S = rgb(shadowOf(base, t));
  return `#${B.map((b, i) => Math.round(Math.min(255, (S[i] / Math.max(1, b)) * 255)).toString(16).padStart(2, '0')).join('')}`;
}

/** Darken everything inside `path` from nothing at y0 to shadowOf(base, t) at y1 and below. */
export function shadeDown(ctx: Ctx, path: PathFn, y0: number, y1: number, base: string, t: number, x0 = -200, x1 = 200): void {
  const m = mulOf(base, t);
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, rgba(m, 0));
  g.addColorStop(1, rgba(m, 1));
  ctx.save();
  path();
  ctx.clip();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, x1 - x0, Math.max(1, y1 - y0) + 400);
  ctx.restore();
}

// --- Vessel silhouettes -------------------------------------------------------

/** Smooth half-width profile through [y, halfWidth] points (sorted by y). */
function profile(pts: [number, number][]): (y: number) => number {
  const n = pts.length;
  const m: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    m.push((b[1] - a[1]) / (b[0] - a[0] || 1));
  }
  return (y: number): number => {
    if (y <= pts[0][0]) return pts[0][1];
    if (y >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0;
    while (i < n - 2 && y > pts[i + 1][0]) i++;
    const [y0, h0] = pts[i];
    const [y1, h1] = pts[i + 1];
    const d = y1 - y0;
    const t = (y - y0) / d;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * h0 + (t3 - 2 * t2 + t) * d * m[i] + (-2 * t3 + 3 * t2) * h1 + (t3 - t2) * d * m[i + 1];
  };
}

/**
 * A round vessel seen from slightly above: rim ellipse at rimY, a side
 * profile hw(y) down to footY, where a half-ellipse arc closes the bottom.
 */
export interface Vessel {
  key: string;
  rimY: number;
  rx: number;
  ry: number;
  /** Rim lip: width at the sides and apparent thickness at the front. */
  lip: number;
  lipC: number;
  hw: (y: number) => number;
  footY: number;
  footRy: number;
  maxHw: number;
  /** ry / rx of the ellipses of this vessel. */
  k: number;
}

export function makeVessel(key: string, pts: [number, number][], o: { lip?: number; lipC?: number; k?: number } = {}): Vessel {
  const k = o.k ?? K;
  const hw = profile(pts);
  const rimY = pts[0][0];
  const rx = pts[0][1];
  const footY = pts[pts.length - 1][0];
  return {
    key,
    rimY,
    rx,
    ry: rx * k,
    lip: o.lip ?? 0,
    lipC: o.lipC ?? 0,
    hw,
    footY,
    footRy: pts[pts.length - 1][1] * k,
    maxHw: Math.max(...pts.map((p) => p[1])),
    k,
  };
}

export function vesselPath(ctx: Ctx, v: Vessel): void {
  const { rimY, rx, ry, footY } = v;
  const n = Math.max(6, Math.ceil((footY - rimY) / 1.6));
  ctx.beginPath();
  ctx.moveTo(-rx, rimY);
  ctx.ellipse(0, rimY, rx, ry, 0, Math.PI, 0, true);
  for (let i = 1; i <= n; i++) {
    const y = rimY + ((footY - rimY) * i) / n;
    ctx.lineTo(v.hw(y), y);
  }
  ctx.ellipse(0, footY, v.hw(footY), v.footRy, 0, 0, Math.PI, false);
  for (let i = n - 1; i >= 0; i--) {
    const y = rimY + ((footY - rimY) * i) / n;
    ctx.lineTo(-v.hw(y), y);
  }
  ctx.closePath();
}

function vesselBox(v: Vessel): Box {
  return { x0: -v.maxHw, y0: v.rimY - v.ry, x1: v.maxHw, y1: v.footY + v.footRy };
}

/** The horizontal ring of the vessel's surface at height y (front point is lowest). */
export function ring(v: Vessel, y: number): { rx: number; ry: number } {
  const r = v.hw(y);
  return { rx: r, ry: r * v.k };
}

/**
 * Points around the vessel at height y, for motifs that wrap around it. Calls
 * fn(x, y, squash, fade) for the ones on the visible front half; squash is
 * the horizontal foreshortening (1 facing us, ->0 at the silhouette).
 */
export function aroundRing(v: Vessel, y: number, n: number, phase: number, fn: (x: number, y: number, squash: number, fade: number, i: number) => void): void {
  const r = ring(v, y);
  for (let i = 0; i < n; i++) {
    const th = ((i + phase) / n) * TAU;
    const c = Math.cos(th);
    if (c < 0.12) continue;
    fn(r.rx * Math.sin(th), y + r.ry * c, c, Math.min(1, (c - 0.12) * 3.2), i);
  }
}

// --- Cylinder light and shade ---------------------------------------------------

export type Finish = 'gloss' | 'satin' | 'matte' | 'metal';

/** Tones across a cylinder from the lit edge (0) to the shadow edge (1): <0 lit, >0 shaded. */
const FINISH: Record<Finish, [number, number][]> = {
  gloss: [[0, 0.3], [0.05, 0.06], [0.15, -0.32], [0.25, -0.52], [0.35, -0.28], [0.5, 0], [0.64, 0.12], [0.82, 0.36], [0.94, 0.46], [1, 0.32]],
  satin: [[0, 0.26], [0.06, 0.03], [0.18, -0.26], [0.3, -0.36], [0.44, -0.12], [0.56, 0], [0.72, 0.16], [0.88, 0.36], [0.97, 0.42], [1, 0.32]],
  matte: [[0, 0.24], [0.08, 0.02], [0.24, -0.24], [0.4, -0.1], [0.56, 0], [0.74, 0.18], [0.9, 0.36], [1, 0.3]],
  metal: [[0, 0.5], [0.05, 0.1], [0.11, -0.4], [0.16, -0.8], [0.21, -0.4], [0.3, 0], [0.42, 0.32], [0.5, 0.4], [0.6, 0.12], [0.72, 0], [0.84, 0.3], [0.93, -0.22], [1, 0.45]],
};

const toneHex = (base: string, t: number): string => (t < 0 ? lightOf(base, -t) : t > 0 ? shadowOf(base, t) : base);

export interface ShadeOpts {
  /** Darken toward the base: from y0 (nothing) to y1 (shadowOf(base, t)). */
  under?: [number, number, number];
  /** Warm light bounced up onto the bottom edge from the surface below (0..1). */
  bounce?: number;
}

interface ShadeMap {
  img: HTMLCanvasElement;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

const shadeCache = new Map<string, ShadeMap>();
const RES = 1.5;
const BOUNCE = rgb('#F7C98F');

/**
 * Cylinder light and shade for a vessel (u = x / hw(y)), plus darkening toward
 * the base and a warm bounce along the bottom arc, baked into one translucent
 * map: painted source-over on the flat base colour it reproduces the target
 * tones exactly, and it darkens or lightens motifs painted on the base alike.
 */
function shadeMap(v: Vessel, base: string, finish: Finish, o: ShadeOpts): ShadeMap {
  const id = `${v.key}|${base}|${finish}|${o.under?.join() ?? ''}|${o.bounce ?? 0}`;
  const hit = shadeCache.get(id);
  if (hit) return hit;
  const stops = FINISH[finish];
  const B = rgb(base);
  const cols = stops.map(([, t]) => rgb(toneHex(base, t)));
  const lut = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const u = i / 255;
    let s = 0;
    while (s < stops.length - 2 && u > stops[s + 1][0]) s++;
    const f = Math.max(0, Math.min(1, (u - stops[s][0]) / (stops[s + 1][0] - stops[s][0] || 1)));
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = cols[s][c] + (cols[s + 1][c] - cols[s][c]) * f;
  }
  const R = o.under ? rgb(shadowOf(base, o.under[2])).map((x, c) => x / Math.max(1, B[c])) : null;
  const y0 = v.rimY - v.ry - 1;
  const y1 = v.footY + v.footRy + 1;
  const x0 = -v.maxHw - 1;
  const W = Math.ceil((2 * v.maxHw + 2) * RES);
  const H = Math.ceil((y1 - y0) * RES);
  const img = document.createElement('canvas');
  img.width = W;
  img.height = H;
  const g = img.getContext('2d')!;
  const id8 = g.createImageData(W, H);
  const d = id8.data;
  const fw = v.hw(v.footY);
  const T = [0, 0, 0];
  for (let r = 0; r < H; r++) {
    const y = y0 + (r + 0.5) / RES;
    const w = Math.max(0.5, v.hw(Math.min(v.footY, Math.max(v.rimY, y))));
    let dark = 0;
    if (o.under) {
      const t = Math.max(0, Math.min(1, (y - o.under[0]) / (o.under[1] - o.under[0])));
      dark = t * t * (3 - 2 * t);
    }
    for (let c = 0; c < W; c++) {
      const x = x0 + (c + 0.5) / RES;
      const i = Math.round(Math.max(0, Math.min(1, (x / w + 1) / 2)) * 255) * 3;
      for (let k = 0; k < 3; k++) T[k] = lut[i + k] * (R ? 1 - dark + dark * R[k] : 1);
      if (o.bounce) {
        const q = x / fw;
        const yb = v.footY + v.footRy * Math.sqrt(Math.max(0, 1 - q * q));
        const dd = yb - y;
        if (dd > -1 && dd < 3.4 && Math.abs(q) < 1.05) {
          const kb = o.bounce * Math.min(1, 1 - dd / 3.4);
          for (let k = 0; k < 3; k++) T[k] += (BOUNCE[k] - T[k]) * kb;
        }
      }
      // the source-over paint (C, a) that turns the base colour into T
      let a = 0;
      for (let k = 0; k < 3; k++) {
        const b = B[k];
        if (T[k] < b) a = Math.max(a, 1 - T[k] / Math.max(1, b));
        else if (T[k] > b) a = Math.max(a, (T[k] - b) / Math.max(1, 255 - b));
      }
      const p = (r * W + c) * 4;
      if (a > 0.004) {
        for (let k = 0; k < 3; k++) d[p + k] = (T[k] - B[k] * (1 - a)) / a;
        d[p + 3] = a * 255;
      }
    }
  }
  g.putImageData(id8, 0, 0);
  const map = { img, x0, y0, w: W / RES, h: H / RES };
  shadeCache.set(id, map);
  return map;
}

/** Light a flat-painted vessel (or any shape clipped by `path`) as the cylinder `v`. */
export function shadeCylinder(ctx: Ctx, v: Vessel, base: string, finish: Finish, path: PathFn = () => vesselPath(ctx, v), o: ShadeOpts = {}): void {
  const m = shadeMap(v, base, finish, o);
  ctx.save();
  path();
  ctx.clip();
  if (lsign(ctx) < 0) ctx.scale(-1, 1);
  ctx.drawImage(m.img, m.x0, m.y0, m.w, m.h);
  ctx.restore();
}

/**
 * Glossy streak that follows the vessel's silhouette at fraction u of the
 * half-width on the lit side, tapering at both ends.
 */
export function streak(ctx: Ctx, v: Vessel, u: number, y0: number, y1: number, w: number, alpha: number, color = '#FFFFFF'): void {
  const n = 14;
  const xs: number[] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = y0 + (y1 - y0) * t;
    xs.push(-v.hw(y) * u);
    ys.push(y);
    ws.push(w * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.7));
  }
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.55, rgba(color, alpha * 0.8));
  g.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i <= n; i++) ctx.lineTo(xs[i] - ws[i] * 0.55, ys[i]);
  for (let i = n; i >= 0; i--) ctx.lineTo(xs[i] + ws[i] * 0.45, ys[i]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// --- Rims and insides ------------------------------------------------------------

export interface InsideOpts {
  /** Colour of the inner wall. */
  inner: string;
  /** Colour of the rim's top surface. */
  rimTop: string;
  /** Outline colour of the vessel. */
  line: string;
  /** How dark the deep inside gets (0..1). */
  depth?: number;
  /** Glossy highlight along the far rim (alpha). */
  gloss?: number;
  /** Extra painting inside the opening (clipped to it), before the occlusion. */
  extra?: () => void;
}

function innerRadii(v: Vessel): { irx: number; iry: number } {
  return { irx: v.rx - v.lip, iry: Math.max(0.5, v.ry - v.lipC) };
}

/**
 * Back layer of a vessel: the inside seen over the rim (inner wall, the rim's
 * cast shade, occlusion under the far lip) and the far half of the rim lip.
 */
export function paintInside(ctx: Ctx, v: Vessel, o: InsideOpts): void {
  litFrame(ctx, () => {
    const { rimY, rx, ry } = v;
    const { irx, iry } = innerRadii(v);
    const ob: Box = { x0: -rx, y0: rimY - ry, x1: rx, y1: rimY + ry };
    // rim top surface (the far half stays visible)
    ctx.beginPath();
    ctx.ellipse(0, rimY, rx, ry, 0, 0, TAU);
    ctx.fillStyle = lightGradient(ctx, ob, [[0, lightOf(o.rimTop, 0.45)], [0.5, o.rimTop], [1, shadowOf(o.rimTop, 0.25)]]);
    ctx.fill();
    const inPath = (): void => {
      ctx.beginPath();
      ctx.ellipse(0, rimY, irx, iry, 0, 0, TAU);
    };
    const depth = o.depth ?? 0.55;
    const g = ctx.createLinearGradient(0, rimY - iry, 0, rimY + iry);
    g.addColorStop(0, lightOf(o.inner, 0.12));
    g.addColorStop(0.3, o.inner);
    g.addColorStop(1, shadowOf(o.inner, depth));
    inPath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    inPath();
    ctx.clip();
    if (o.extra) o.extra();
    // the wall on the light's side is shaded by the rim; the far side catches light
    const sh = shadowOf(o.inner, 0.8);
    const li = lightOf(o.inner, 0.5);
    const h = ctx.createLinearGradient(-irx, 0, irx, 0);
    h.addColorStop(0, rgba(sh, 0.6));
    h.addColorStop(0.32, rgba(sh, 0.22));
    h.addColorStop(0.55, rgba(sh, 0));
    h.addColorStop(0.72, rgba(li, 0));
    h.addColorStop(1, rgba(li, 0.32));
    ctx.fillStyle = h;
    ctx.fillRect(-irx, rimY - iry, 2 * irx, 2 * iry);
    ctx.restore();
    // occlusion right under the far lip: an elliptical shade, darkest at the far edge
    ctx.save();
    inPath();
    ctx.clip();
    ctx.translate(0, rimY);
    ctx.scale(1, iry / irx);
    const oc = ctx.createRadialGradient(0, irx * 0.55, irx * 0.62, 0, irx * 0.55, irx * 1.58);
    const occ = shadowOf(o.inner, 0.9);
    oc.addColorStop(0, rgba(occ, 0));
    oc.addColorStop(0.7, rgba(occ, 0.2));
    oc.addColorStop(1, rgba(occ, 0.6));
    ctx.fillStyle = oc;
    ctx.fillRect(-irx, -irx, 2 * irx, 2 * irx);
    ctx.restore();
    // the lip's inner edge and the outer silhouette of the far rim
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(lineOf(o.rimTop), 0.45);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, rimY, irx, iry, 0, Math.PI, TAU);
    ctx.stroke();
    if (o.gloss) {
      ctx.strokeStyle = `rgba(255,255,255,${o.gloss})`;
      ctx.lineWidth = Math.min(1.1, v.lip * 0.4);
      ctx.beginPath();
      ctx.ellipse(0, rimY, rx - v.lip * 0.45, ry - v.lipC * 0.45, 0, Math.PI * 1.1, Math.PI * 1.4);
      ctx.stroke();
      // the glaze inside reflects the light on the far, lit wall
      ctx.save();
      inPath();
      ctx.clip();
      ctx.strokeStyle = `rgba(255,255,255,${o.gloss * 0.4})`;
      ctx.lineWidth = Math.max(0.8, iry * 0.3);
      ctx.beginPath();
      ctx.ellipse(0, rimY + iry * 0.1, irx * 0.84, iry * 0.62, 0, Math.PI * 1.6, Math.PI * 1.84);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    outline(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(0, rimY, rx, ry, 0, Math.PI, TAU);
      },
      ob,
      o.line,
      1.25,
      0.5,
    );
  });
}

/** Path of the near half of the rim lip (between the outer and inner ellipses). */
function nearRimPath(ctx: Ctx, v: Vessel): void {
  const { rimY, rx, ry } = v;
  const { irx, iry } = innerRadii(v);
  ctx.beginPath();
  ctx.moveTo(-rx, rimY);
  ctx.ellipse(0, rimY, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(irx, rimY);
  ctx.ellipse(0, rimY, irx, iry, 0, 0, Math.PI, false);
  ctx.closePath();
}

/** Front layer: the near half of the rim lip, lit, with an optional glaze highlight. */
export function paintNearRim(ctx: Ctx, v: Vessel, o: { top: string; line: string; gloss?: number }): void {
  litFrame(ctx, () => {
    const { rimY, rx, ry } = v;
    const { irx, iry } = innerRadii(v);
    const ob: Box = { x0: -rx, y0: rimY - ry, x1: rx, y1: rimY + ry };
    nearRimPath(ctx, v);
    ctx.fillStyle = lightGradient(ctx, ob, [[0, lightOf(o.top, 0.5)], [0.45, o.top], [1, shadowOf(o.top, 0.25)]]);
    ctx.fill();
    ctx.save();
    ctx.lineCap = 'round';
    // where the inside drops away
    ctx.strokeStyle = rgba(lineOf(o.top), 0.5);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, rimY, irx, iry, 0, 0, Math.PI);
    ctx.stroke();
    if (o.gloss) {
      ctx.strokeStyle = `rgba(255,255,255,${o.gloss})`;
      ctx.lineWidth = Math.min(1.1, v.lipC * 0.5);
      ctx.beginPath();
      ctx.ellipse(0, rimY, rx - v.lip * 0.4, ry - v.lipC * 0.4, 0, Math.PI * 0.62, Math.PI * 0.86);
      ctx.stroke();
      glint(ctx, -(rx - v.lip * 0.4) * Math.cos(Math.PI * 0.3), rimY + (ry - v.lipC * 0.4) * Math.sin(Math.PI * 0.3), 0.75, o.gloss);
    }
    ctx.restore();
    outline(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(0, rimY, rx, ry, 0, 0, Math.PI);
      },
      ob,
      o.line,
      1.2,
      0.45,
    );
  });
}

export interface BodyOpts {
  base: string;
  finish: Finish;
  line?: string;
  /** Flat painting (motifs, glaze edges) before light and shade, clipped to the body. */
  decorate?: () => void;
  /** Surface texture before light and shade. */
  texture?: () => void;
  /** Soft gouache mottling of the flat colour (alpha). */
  mottle?: number;
  /** Darken toward the base: [from y, to y, strength]. */
  under?: [number, number, number];
  /** Warm light bounced up from the surface it stands on (0..1). */
  bounce?: number;
  /** Gloss streaks: [u, y0, y1, width, alpha]. */
  spec?: [number, number, number, number, number][];
  /** Glints: [x, y, r] in the lit frame. */
  glints?: [number, number, number][];
  /** After light and shade (crisp details such as gold lines), clipped to the body. */
  after?: () => void;
  outlineW?: number;
}

/** Front layer body of a vessel, lit as a cylinder. */
export function paintBody(ctx: Ctx, v: Vessel, o: BodyOpts): void {
  litFrame(ctx, () => {
    const path = (): void => vesselPath(ctx, v);
    const b = vesselBox(v);
    path();
    ctx.fillStyle = o.base;
    ctx.fill();
    if (o.decorate) {
      ctx.save();
      path();
      ctx.clip();
      o.decorate();
      ctx.restore();
    }
    if (o.texture) o.texture();
    if (o.mottle) texPaint(ctx, path, 'plaster', { alpha: o.mottle, scale: 0.32 });
    shadeCylinder(ctx, v, o.base, o.finish, path, { under: o.under, bounce: o.bounce });
    if (o.after) {
      ctx.save();
      path();
      ctx.clip();
      o.after();
      ctx.restore();
    }
    for (const [u, y0, y1, w, a] of o.spec ?? []) streak(ctx, v, u, y0, y1, w, a);
    for (const [x, y, r] of o.glints ?? []) glint(ctx, x, y, r, 0.9);
    outline(ctx, path, b, o.line ?? lineOf(o.base), o.outlineW ?? 1.35);
  });
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
  ctx.strokeStyle = o.line ?? lineOf(base);
  ctx.lineWidth = width + 2.5;
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

// --- Cached rasters ------------------------------------------------------------------

const memoCache = new Map<string, HTMLCanvasElement>();
const MEMO_MAX = 24;

/** Pixels per world unit, bucketed in quarter octaves (so cached rasters are reused). */
export function resBucket(ppu: number): number {
  return 2 ** (Math.ceil(Math.log2(Math.max(0.25, ppu)) * 4) / 4);
}

/**
 * Draw an expensive static part through a raster cached per resolution. The
 * part is painted unmirrored, so call it inside litFrame and only for
 * symmetric parts. `b` must contain everything `draw` paints.
 */
export function memo(ctx: Ctx, key: string, b: Box, draw: (g: Ctx) => void): void {
  const m = ctx.getTransform();
  if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6) {
    draw(ctx);
    return;
  }
  const q = resBucket(Math.abs(m.a));
  const id = `${key}|${q}`;
  let c = memoCache.get(id);
  if (c) {
    memoCache.delete(id);
  } else {
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil((b.x1 - b.x0) * q));
    c.height = Math.max(1, Math.ceil((b.y1 - b.y0) * q));
    const g = c.getContext('2d')!;
    g.setTransform(q, 0, 0, q, -b.x0 * q, -b.y0 * q);
    draw(g);
    if (memoCache.size >= MEMO_MAX) memoCache.delete(memoCache.keys().next().value!);
  }
  memoCache.set(id, c);
  ctx.drawImage(c, b.x0, b.y0, c.width / q, c.height / q);
}

// --- Small cached textures ----------------------------------------------------------

const texCache = new Map<string, HTMLCanvasElement>();
const patCache = new WeakMap<Ctx, Map<string, CanvasPattern>>();

function cachedCanvas(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  let c = texCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    texCache.set(key, c);
  }
  return c;
}

function pattern(ctx: Ctx, key: string, src: HTMLCanvasElement): CanvasPattern | null {
  let m = patCache.get(ctx);
  if (!m) {
    m = new Map();
    patCache.set(ctx, m);
  }
  let p = m.get(key) ?? null;
  if (!p) {
    p = ctx.createPattern(src, 'repeat');
    if (!p) return null;
    m.set(key, p);
  }
  return p;
}

/**
 * A grey (mid-grey based) texture tile baked into translucent light and dark
 * paint, so it can be laid on with a plain source-over fill: much cheaper than
 * an overlay pass, with warm lights and violet darks like the rest of the kit.
 */
const pixelCache = new Map<string, Uint8ClampedArray>();

/** The pixels of a cached texture canvas, read back once. */
function pixels(key: string, src: HTMLCanvasElement): Uint8ClampedArray {
  let d = pixelCache.get(key);
  if (!d) {
    d = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
    pixelCache.set(key, d);
  }
  return d;
}

function baked(key: string, src: HTMLCanvasElement, light: string, dark: string): HTMLCanvasElement {
  return cachedCanvas(`bk|${key}|${light}|${dark}`, src.width, src.height, (g) => {
    const n = src.width * src.height;
    const sd = pixels(key, src);
    const img = g.createImageData(src.width, src.height);
    const L = rgb(light);
    const D = rgb(dark);
    for (let i = 0; i < n; i++) {
      const v = (sd[i * 4] - 128) / 127;
      const c = v > 0 ? L : D;
      img.data[i * 4] = c[0];
      img.data[i * 4 + 1] = c[1];
      img.data[i * 4 + 2] = c[2];
      img.data[i * 4 + 3] = Math.min(255, Math.abs(v) * 255);
    }
    g.putImageData(img, 0, 0);
  });
}

export interface TexOpts {
  alpha: number;
  /** World units per texel. */
  scale?: number;
  angle?: number;
  ox?: number;
  oy?: number;
  light?: string;
  dark?: string;
}

function fillPattern(ctx: Ctx, path: PathFn, key: string, src: HTMLCanvasElement, o: TexOpts, sx: number, sy: number): void {
  const pat = pattern(ctx, key, src);
  if (!pat || o.alpha <= 0) return;
  const a = o.angle ?? 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (typeof pat.setTransform === 'function') pat.setTransform({ a: c * sx, b: s * sx, c: -s * sy, d: c * sy, e: o.ox ?? 0, f: o.oy ?? 0 });
  ctx.save();
  ctx.globalAlpha *= o.alpha;
  ctx.fillStyle = pat;
  path();
  ctx.fill();
  ctx.restore();
}

const PAINT_LIGHT = '#FFF7EA';
const PAINT_DARK = '#33293F';

/** Lay one of paint.ts's textures over a shape as light and dark paint (source-over). */
export function texPaint(ctx: Ctx, path: PathFn, kind: TexKind, o: TexOpts): void {
  const light = o.light ?? PAINT_LIGHT;
  const dark = o.dark ?? PAINT_DARK;
  const src = baked(kind, texture(kind), light, dark);
  const sc = o.scale ?? 0.35;
  fillPattern(ctx, path, `bk|${kind}|${light}|${dark}`, src, o, sc, sc);
}

/** Kraft board: paper fibres and (optionally) the flutes under the liner, in one pass. */
export function kraftPaint(ctx: Ctx, path: PathFn, alpha: number, flute: boolean): void {
  const key = flute ? 'kraftF' : 'kraft';
  const src = cachedCanvas(key, 256, 256, (g) => {
    const cd = pixels('card', texture('card'));
    const img = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4;
        const v = (cd[i] - 128) * 0.9 + (flute ? Math.cos((x / 8) * TAU) * 20 : 0);
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, 128 + v));
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
  });
  fillPattern(ctx, path, `bk|${key}`, baked(key, src, PAINT_LIGHT, PAINT_DARK), { alpha }, 0.4, 0.4);
}

/** Soft shading band along one side of an axis-aligned face (cheap stand-in for edgeShade). */
export function band(ctx: Ctx, b: Box, side: 'left' | 'right' | 'top' | 'bottom', w: number, color: string, alpha: number): void {
  if (alpha <= 0 || w <= 0) return;
  const horiz = side === 'left' || side === 'right';
  const x0 = side === 'right' ? b.x1 - w : b.x0;
  const y0 = side === 'bottom' ? b.y1 - w : b.y0;
  const bw = horiz ? w : b.x1 - b.x0;
  const bh = horiz ? b.y1 - b.y0 : w;
  const g = horiz ? ctx.createLinearGradient(x0, 0, x0 + w, 0) : ctx.createLinearGradient(0, y0, 0, y0 + w);
  const edgeFirst = side === 'left' || side === 'top';
  g.addColorStop(0, rgba(color, edgeFirst ? alpha : 0));
  g.addColorStop(1, rgba(color, edgeFirst ? 0 : alpha));
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, bw, bh);
}

/** Uneven rubber-stamp ink of `color` as a fill pattern (gaps where the stamp missed). */
export function inkPattern(ctx: Ctx, color: string, scale = 0.3): CanvasPattern | null {
  const key = `ink${color}`;
  const src = cachedCanvas(key, 64, 64, (g) => {
    const img = g.createImageData(64, 64);
    const [r, gg, b] = rgb(color);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        // blotchy coverage: soft cells plus fine speckle
        const cell = hash01((x >> 3) + ((y >> 3) << 4), 7) * 0.5 + hash01(((x + 4) >> 3) + (((y + 4) >> 3) << 4), 8) * 0.5;
        const fine = hash01(x * 64 + y, 9);
        const a = cell < 0.22 ? 0.35 : fine < 0.1 ? 0.15 : 0.82 + fine * 0.18;
        img.data[i] = r;
        img.data[i + 1] = gg;
        img.data[i + 2] = b;
        img.data[i + 3] = Math.round(a * 255);
      }
    g.putImageData(img, 0, 0);
  });
  const pat = pattern(ctx, key, src);
  if (pat && typeof pat.setTransform === 'function') pat.setTransform({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 });
  return pat;
}
