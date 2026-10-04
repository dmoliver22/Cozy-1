// Gouache-ish painting helpers: flat colour, soft brushy edges, paper grain.

export type Ctx = CanvasRenderingContext2D;

export const PALETTE = {
  ginger: '#E8964A',
  cream: '#F7E6CC',
  teacup: '#8FB3D9',
  mint: '#BFDCCB',
  oak: '#C9A27A',
  ink: '#3E3A4F',
  wall: '#F6EBDC',
  sun: '#FFF1CF',
  gold: '#F2C14E',
  rose: '#E9A6A0',
  sage: '#A9C3A0',
  butter: '#F4D88A',
  sky: '#CFE3F2',
  terracotta: '#D9875F',
  lilac: '#C9B8DD',
};

/** Hex -> [r,g,b]. */
export function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Mix two hex colours. */
export function mix(a: string, b: string, t: number): string {
  const A = rgb(a);
  const B = rgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export const shade = (hex: string, t: number): string => mix(hex, '#3E3A4F', t);
export const tint = (hex: string, t: number): string => mix(hex, '#FFFDF7', t);

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | number[]): void {
  ctx.beginPath();
  const rr = Array.isArray(r) ? r : [r, r, r, r];
  const [tl, tr, br, bl] = rr.map((v) => Math.max(0, Math.min(v, w / 2, h / 2)));
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

/** Smooth closed curve through points (midpoint quadratic). */
export function smoothClosedPath(ctx: Ctx, xs: ArrayLike<number>, ys: ArrayLike<number>, n: number): void {
  ctx.beginPath();
  const mx0 = (xs[n - 1] + xs[0]) / 2;
  const my0 = (ys[n - 1] + ys[0]) / 2;
  ctx.moveTo(mx0, my0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const mx = (xs[i] + xs[j]) / 2;
    const my = (ys[i] + ys[j]) / 2;
    ctx.quadraticCurveTo(xs[i], ys[i], mx, my);
  }
  ctx.closePath();
}

/** Smooth path through polygon points given as objects. */
export function smoothPolyPath(ctx: Ctx, pts: { x: number; y: number }[], closed = true): void {
  const n = pts.length;
  if (!closed) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < n - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
    return;
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  smoothClosedPath(ctx, xs, ys, n);
}

/** Deterministic hash noise in [0,1) for decorative jitter. */
export function hash01(a: number, b = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Painterly fill: a flat base plus a couple of offset, low-alpha passes that
 * leave a soft, uneven brush edge. `path` must rebuild the shape each call.
 */
export function brushFill(ctx: Ctx, path: () => void, color: string, edge: string, seed = 1, width = 2): void {
  ctx.fillStyle = color;
  path();
  ctx.fill();
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = edge;
  ctx.globalAlpha *= 0.55;
  ctx.lineWidth = width;
  ctx.setLineDash([9 + hash01(seed) * 8, 3 + hash01(seed, 2) * 4]);
  ctx.lineDashOffset = hash01(seed, 3) * 20;
  path();
  ctx.stroke();
  ctx.globalAlpha *= 0.7;
  ctx.lineWidth = width * 0.6;
  ctx.setLineDash([4 + hash01(seed, 4) * 6, 5 + hash01(seed, 5) * 5]);
  ctx.lineDashOffset = hash01(seed, 6) * 30;
  path();
  ctx.stroke();
  ctx.restore();
}

/** Soft elliptical shadow. */
export function softShadow(ctx: Ctx, x: number, y: number, rx: number, ry: number, alpha: number): void {
  if (alpha <= 0.002 || rx <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(62,58,79,${alpha})`);
  g.addColorStop(0.6, `rgba(62,58,79,${alpha * 0.55})`);
  g.addColorStop(1, 'rgba(62,58,79,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Glaze highlight: a single soft white arc. */
export function glaze(ctx: Ctx, x: number, y: number, w: number, h: number, alpha = 0.55): void {
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, w * 0.12);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.quadraticCurveTo(x - w * 0.15, y + h * 0.4, x + w * 0.2, y);
  ctx.stroke();
  ctx.restore();
}

let grainCanvas: HTMLCanvasElement | null = null;

/** Tileable paper grain texture (generated once). */
export function paperGrain(): HTMLCanvasElement {
  if (grainCanvas) return grainCanvas;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const d = img.data;
  // value noise: blend of fine speckle and soft blotches
  const blot = new Float32Array((size / 16 + 1) * (size / 16 + 1));
  for (let i = 0; i < blot.length; i++) blot[i] = hash01(i, 77);
  const bw = size / 16 + 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = x / 16;
      const gy = y / 16;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const xa = x0 % (bw - 1);
      const ya = y0 % (bw - 1);
      const xb = (x0 + 1) % (bw - 1);
      const yb = (y0 + 1) % (bw - 1);
      const v00 = blot[ya * bw + xa];
      const v10 = blot[ya * bw + xb];
      const v01 = blot[yb * bw + xa];
      const v11 = blot[yb * bw + xb];
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const soft = v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
      const fine = hash01(x * 7 + 3, y * 13 + 5);
      const fiber = Math.abs(Math.sin((x * 0.21 + y * 0.05) + hash01(y, 9) * 6)) < 0.03 ? 0.6 : 0;
      const v = 0.55 * fine + 0.35 * soft + fiber * 0.4;
      const i = (y * size + x) * 4;
      const c8 = 255 - Math.round(v * 52);
      d[i] = c8;
      d[i + 1] = c8 - 4;
      d[i + 2] = c8 - 10;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  grainCanvas = c;
  return c;
}

/** Draw text with a soft rounded label behind it. */
export function pill(ctx: Ctx, text: string, x: number, y: number, opts: { font: string; fg: string; bg: string; pad?: number; alpha?: number }): void {
  ctx.save();
  ctx.globalAlpha *= opts.alpha ?? 1;
  ctx.font = opts.font;
  const m = ctx.measureText(text);
  const pad = opts.pad ?? 7;
  const h = parseFloat(opts.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? '14') * 1.35;
  const w = m.width + pad * 2;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = opts.bg;
  ctx.fill();
  ctx.fillStyle = opts.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Light, colour and texture kit. Everything painted in the game shares one
// light: a warm key light from the upper left (the window side), cool violet
// shadows and a warm bounce from below. Shapes get their volume from soft
// shading that hugs their own outline, and their surface from tileable
// procedural textures blended over the flat colour (gouache on paper).

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Unit vector pointing toward the key light (upper left). */
export const LIGHT = { x: -0.5, y: -0.866 };

type HSL = [number, number, number];

export function toHsl(hex: string): HSL {
  const [r8, g8, b8] = rgb(hex);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function fromHsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Rotate hue `h` toward `target` by at most `deg`. */
function hueToward(h: number, target: number, deg: number): number {
  let d = target - h;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return h + Math.max(-deg, Math.min(deg, d));
}

/**
 * Painterly shadow of a colour: darker and nudged toward violet-red (never the
 * muddy grey of mixing with black). t in 0..1.
 */
export function shadowOf(hex: string, t: number): string {
  const [h, s, l] = toHsl(hex);
  if (s < 0.04) return fromHsl(255, s + 0.1 * t, l * (1 - 0.4 * t));
  return fromHsl(hueToward(h, 262, 12 * t), s * (1 - 0.18 * t), l * (1 - 0.4 * t));
}

/** Sunlit version of a colour: lighter and nudged toward warm yellow. t in 0..1. */
export function lightOf(hex: string, t: number): string {
  const [h, s, l] = toHsl(hex);
  return fromHsl(s < 0.04 ? 45 : hueToward(h, 48, 12 * t), s < 0.04 ? 0.35 * t : s * (1 - 0.1 * t), l + (1 - l) * 0.55 * t);
}

/** Line colour for a fill: a deep, slightly muted version of it. */
export function lineOf(hex: string): string {
  const [h, s, l] = toHsl(hex);
  if (s < 0.04) return fromHsl(255, 0.12, l * 0.5);
  return fromHsl(hueToward(h, 262, 10), Math.min(0.62, s * 0.8), Math.min(0.42, l * 0.62));
}

/** Linear gradient across a box along the light: offset 0 = lit edge, 1 = shadow edge. */
export function lightGradient(ctx: Ctx, b: Box, stops: [number, string][], dir = LIGHT): CanvasGradient {
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const ext = Math.abs(dir.x) * ((b.x1 - b.x0) / 2) + Math.abs(dir.y) * ((b.y1 - b.y0) / 2);
  const g = ctx.createLinearGradient(cx + dir.x * ext, cy + dir.y * ext, cx - dir.x * ext, cy - dir.y * ext);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

/**
 * Soft shading that hugs the inside of a shape's outline, whatever its shape:
 * a few wide strokes of `color`, clipped to the shape. `side` picks which part
 * of the edge: 'shadow' (away from the light), 'light' (toward it), 'bottom',
 * 'top' or 'all'. `width` is how far it reaches in from the edge.
 */
export function edgeShade(
  ctx: Ctx,
  path: () => void,
  b: Box,
  color: string,
  width: number,
  alpha: number,
  side: 'shadow' | 'light' | 'bottom' | 'top' | 'all' = 'shadow',
  steps = 3,
): void {
  if (alpha <= 0 || width <= 0) return;
  ctx.save();
  path();
  ctx.clip();
  let style: string | CanvasGradient = color;
  if (side !== 'all') {
    const on = rgba(color, 1);
    const off = rgba(color, 0);
    const stops: [number, string][] = side === 'shadow' || side === 'bottom' ? [[0, off], [0.42, off], [0.85, on], [1, on]] : [[0, on], [0.15, on], [0.58, off], [1, off]];
    const dir = side === 'bottom' || side === 'top' ? { x: 0, y: -1 } : LIGHT;
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

/**
 * Form shading for a roundish shape: a warm glow on the lit side melting into
 * a cool shade on the far side. Drawn inside `path` over its base fill.
 */
export function formShade(ctx: Ctx, path: () => void, b: Box, base: string, lit = 0.35, dark = 0.3): void {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const size = Math.max(w, h);
  const cx = (b.x0 + b.x1) / 2 + LIGHT.x * w * 0.28;
  const cy = (b.y0 + b.y1) / 2 + LIGHT.y * h * 0.28;
  const g = ctx.createRadialGradient(cx, cy, size * 0.02, cx, cy, size * 0.95);
  g.addColorStop(0, rgba(lightOf(base, 1), lit));
  g.addColorStop(0.45, rgba(lightOf(base, 1), 0));
  g.addColorStop(0.62, rgba(shadowOf(base, 1), 0));
  g.addColorStop(1, rgba(shadowOf(base, 1), dark));
  ctx.save();
  path();
  ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(b.x0 - 2, b.y0 - 2, w + 4, h + 4);
  ctx.restore();
}

/** Glossy highlight streak: a tapered, slightly curved lens along `angle`. */
export function specular(ctx: Ctx, x: number, y: number, len: number, width: number, angle: number, alpha = 0.75, color = '#FFFFFF', bend = 0.18): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  ctx.quadraticCurveTo(0, -width - len * bend, len / 2, 0);
  ctx.quadraticCurveTo(0, width * 0.35 - len * bend, -len / 2, 0);
  ctx.fill();
  ctx.restore();
}

/** A soft round glint (small specular dot with a halo). */
export function glint(ctx: Ctx, x: number, y: number, r: number, alpha = 0.85): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(0.35, `rgba(255,255,255,${alpha * 0.8})`);
  g.addColorStop(0.42, `rgba(255,255,255,${alpha * 0.18})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Contact shadow where something rests on a surface: a tight dark core right
 * at the contact plus a broad soft spread (ambient occlusion feel).
 */
export function contactShadow(ctx: Ctx, x: number, y: number, halfW: number, alpha = 0.3, spread = 1): void {
  if (halfW <= 0 || alpha <= 0) return;
  softShadow(ctx, x, y + 1, halfW * (1.05 + 0.25 * spread), 4 + 5 * spread, alpha * 0.55);
  softShadow(ctx, x, y + 0.5, halfW * 0.92, 2.6, alpha);
}

/**
 * Bevelled panel (cabinet doors, frames, drawers): base fill, light top/left
 * lip, shadowed bottom/right lip and a faint inner edge.
 */
export function bevelPanel(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, base: string, depth = 2.2, inset = false): void {
  const hi = lightOf(base, 0.55);
  const lo = shadowOf(base, 0.32);
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = base;
  ctx.fill();
  const path = (): void => roundRect(ctx, x, y, w, h, r);
  const b = { x0: x, y0: y, x1: x + w, y1: y + h };
  edgeShade(ctx, path, b, inset ? lo : hi, depth, 0.95, 'light', 2);
  edgeShade(ctx, path, b, inset ? hi : lo, depth, 0.95, 'shadow', 2);
  ctx.strokeStyle = rgba(lineOf(base), 0.55);
  ctx.lineWidth = 1;
  path();
  ctx.stroke();
}

// --- Textures ---------------------------------------------------------------

export type TexKind = 'plaster' | 'brush' | 'wood' | 'fur' | 'furFine' | 'weave' | 'card' | 'speckle';

const texCache = new Map<TexKind, HTMLCanvasElement>();
const patCache = new WeakMap<Ctx, Map<TexKind, CanvasPattern>>();

/** Periodic value noise (cellsX x cellsY lattice) sampled on a size x size grid. */
function tileNoise(size: number, cellsX: number, cellsY: number, seed: number): Float32Array {
  const lat = new Float32Array(cellsX * cellsY);
  for (let i = 0; i < lat.length; i++) lat[i] = hash01(i, seed);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const gy = (y / size) * cellsY;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    const sy = fy * fy * (3 - 2 * fy);
    const ya = (y0 % cellsY) * cellsX;
    const yb = ((y0 + 1) % cellsY) * cellsX;
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cellsX;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const sx = fx * fx * (3 - 2 * fx);
      const xa = x0 % cellsX;
      const xb = (x0 + 1) % cellsX;
      const v00 = lat[ya + xa];
      const v10 = lat[ya + xb];
      const v01 = lat[yb + xa];
      const v11 = lat[yb + xb];
      out[y * size + x] = v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
    }
  }
  return out;
}

function fbm(size: number, cellsX: number, cellsY: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = tileNoise(size, cellsX << o, cellsY << o, seed + o * 31);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function greyCanvas(size: number, values: Float32Array, contrast: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < values.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(128 + (values[i] - 0.5) * contrast * 255)));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Draw `fn` at (x, y) and at its wrapped copies so strokes tile seamlessly. */
function wrapDraw(size: number, x: number, y: number, reach: number, fn: (x: number, y: number) => void): void {
  for (const dx of [-size, 0, size])
    for (const dy of [-size, 0, size]) {
      if (x + dx < -reach || x + dx > size + reach || y + dy < -reach || y + dy > size + reach) continue;
      fn(x + dx, y + dy);
    }
}

function strokeCanvas(size: number, draw: (g: Ctx, size: number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  draw(g, size);
  return c;
}

function makeTexture(kind: TexKind): HTMLCanvasElement {
  switch (kind) {
    case 'plaster': {
      const size = 256;
      const soft = fbm(size, 3, 3, 5, 11);
      const v = new Float32Array(size * size);
      for (let i = 0; i < v.length; i++) v[i] = soft[i] * 0.85 + hash01(i, 5) * 0.15;
      return greyCanvas(size, v, 0.9);
    }
    case 'speckle': {
      const size = 128;
      const v = new Float32Array(size * size);
      for (let i = 0; i < v.length; i++) {
        const h = hash01(i, 21);
        v[i] = h > 0.97 ? 0.15 : h < 0.03 ? 0.85 : 0.5 + (hash01(i, 22) - 0.5) * 0.25;
      }
      return greyCanvas(size, v, 1);
    }
    case 'wood': {
      // long streaky grain along x with a few darker growth lines
      const size = 256;
      const streak = fbm(size, 1, 12, 4, 41);
      const warp = fbm(size, 2, 4, 2, 43);
      const v = new Float32Array(size * size);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          const rings = Math.sin((y / size) * Math.PI * 2 * 9 + warp[i] * 7);
          const line = Math.max(0, rings) ** 10;
          v[i] = streak[i] * 0.8 + 0.1 - line * 0.28 + (hash01(i, 44) - 0.5) * 0.06;
        }
      return greyCanvas(size, v, 1);
    }
    case 'card': {
      const size = 256;
      const soft = fbm(size, 4, 4, 3, 51);
      const fib = fbm(size, 2, 48, 2, 53);
      const v = new Float32Array(size * size);
      for (let i = 0; i < v.length; i++) {
        const h = hash01(i, 55);
        v[i] = soft[i] * 0.45 + fib[i] * 0.4 + 0.075 + (h > 0.985 ? -0.25 : 0) + (hash01(i, 56) - 0.5) * 0.12;
      }
      return greyCanvas(size, v, 0.9);
    }
    case 'weave': {
      const size = 64;
      const v = new Float32Array(size * size);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const over = ((x >> 2) + (y >> 2)) % 2 === 0;
          const u = over ? (x % 4) / 3 : (y % 4) / 3;
          const thread = Math.sin(u * Math.PI);
          v[y * size + x] = 0.32 + thread * 0.36 + (hash01(x * 64 + y, 61) - 0.5) * 0.12;
        }
      return greyCanvas(size, v, 1);
    }
    case 'brush':
      // dry gouache strokes: broad, mostly horizontal bands of bristle lines
      return strokeCanvas(256, (g, size) => {
        g.lineCap = 'round';
        for (let k = 0; k < 90; k++) {
          const x = hash01(k, 71) * size;
          const y = hash01(k, 72) * size;
          const len = 50 + hash01(k, 73) * 120;
          const wid = 8 + hash01(k, 74) * 22;
          const ang = (hash01(k, 75) - 0.5) * 0.35;
          const light = hash01(k, 76) > 0.5;
          const bristles = 7;
          wrapDraw(size, x, y, len, (px, py) => {
            g.save();
            g.translate(px, py);
            g.rotate(ang);
            for (let b = 0; b < bristles; b++) {
              const off = (b / (bristles - 1) - 0.5) * wid;
              const a = 0.03 + hash01(k * 13 + b, 77) * 0.07;
              g.strokeStyle = light ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
              g.lineWidth = 1 + hash01(k * 13 + b, 78) * 2.5;
              const s0 = -len / 2 + hash01(k * 13 + b, 79) * len * 0.2;
              const s1 = len / 2 - hash01(k * 13 + b, 80) * len * 0.25;
              g.beginPath();
              g.moveTo(s0, off);
              g.quadraticCurveTo(0, off + (hash01(k, 81) - 0.5) * 6, s1, off + (hash01(k, 82) - 0.5) * 4);
              g.stroke();
            }
            g.restore();
          });
        }
      });
    case 'fur':
    case 'furFine':
      // short curved strands, flowing downward like fur on a loaf
      return strokeCanvas(256, (g, size) => {
        g.lineCap = 'round';
        const fine = kind === 'furFine';
        const count = fine ? 2600 : 1700;
        for (let k = 0; k < count; k++) {
          const x = hash01(k, 91) * size;
          const y = hash01(k, 92) * size;
          const len = (fine ? 4 : 6) + hash01(k, 93) * (fine ? 5 : 9);
          const ang = Math.PI / 2 + (hash01(k, 94) - 0.5) * 0.9;
          const bend = (hash01(k, 95) - 0.5) * len * 0.5;
          const light = hash01(k, 96) > 0.45;
          const a = (fine ? 0.1 : 0.14) + hash01(k, 97) * 0.22;
          wrapDraw(size, x, y, len, (px, py) => {
            const ex = px + Math.cos(ang) * len;
            const ey = py + Math.sin(ang) * len;
            g.strokeStyle = light ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 0.9})`;
            g.lineWidth = (fine ? 0.8 : 1) + hash01(k, 98) * (fine ? 0.6 : 1);
            g.beginPath();
            g.moveTo(px, py);
            g.quadraticCurveTo((px + ex) / 2 - Math.sin(ang) * bend, (py + ey) / 2 + Math.cos(ang) * bend, ex, ey);
            g.stroke();
          });
        }
      });
  }
}

/** A tileable, mid-grey based texture canvas (generated once, then cached). */
export function texture(kind: TexKind): HTMLCanvasElement {
  let c = texCache.get(kind);
  if (!c) {
    c = makeTexture(kind);
    texCache.set(kind, c);
  }
  return c;
}

/**
 * The texture as a repeating pattern for `ctx`, mapped so one texel is
 * `scale` world units, rotated by `angle` and anchored at (ox, oy).
 */
export function texPattern(ctx: Ctx, kind: TexKind, scale = 0.35, angle = 0, ox = 0, oy = 0): CanvasPattern | null {
  let m = patCache.get(ctx);
  if (!m) {
    m = new Map();
    patCache.set(ctx, m);
  }
  let p = m.get(kind) ?? null;
  if (!p) {
    p = ctx.createPattern(texture(kind), 'repeat');
    if (!p) return null;
    m.set(kind, p);
  }
  const c = Math.cos(angle) * scale;
  const s = Math.sin(angle) * scale;
  if (typeof p.setTransform === 'function') p.setTransform({ a: c, b: s, c: -s, d: c, e: ox, f: oy });
  return p;
}

/**
 * Lay a texture over a shape. Textures are mid-grey based, so 'overlay' and
 * 'soft-light' modulate the paint underneath without shifting its hue.
 */
export function texturize(
  ctx: Ctx,
  path: () => void,
  kind: TexKind,
  opts: { alpha?: number; op?: GlobalCompositeOperation; scale?: number; angle?: number; ox?: number; oy?: number } = {},
): void {
  const pat = texPattern(ctx, kind, opts.scale ?? 0.35, opts.angle ?? 0, opts.ox ?? 0, opts.oy ?? 0);
  if (!pat) return;
  ctx.save();
  ctx.globalCompositeOperation = opts.op ?? 'overlay';
  ctx.globalAlpha *= opts.alpha ?? 0.5;
  ctx.fillStyle = pat;
  path();
  ctx.fill();
  ctx.restore();
}
