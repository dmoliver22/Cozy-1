// Painting helpers shared by the room, its decor and the furniture, on top of
// the light/colour/texture kit in paint.ts. Most of them are about doing the
// same painterly things cheaply, because the room layer is repainted whole on
// room load and software canvases are slow at blend modes, filtered patterns,
// blurs and anti-aliased clips: baked textures laid 1:1, stamped sprites,
// clip-free shading, blur-free shadows.

import { glint, hash01, lightOf, lineOf, rgb, rgba, shadowOf, texture, type Box, type Ctx, type TexKind } from './paint';

export type PathFn = () => void;

/** Canvas pixels per world unit under the current transform. */
export function pxPerUnit(ctx: Ctx): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b) || 1;
}

const bakeCache = new Map<string, HTMLCanvasElement>();
const bakePats = new WeakMap<Ctx, Map<string, CanvasPattern>>();

/**
 * Textures baked into translucent light and dark paint (256px tile), so a big
 * area like a wall can be textured with one plain source-over fill instead of
 * a blend-mode pass. `kinds` are summed, each with its own gain.
 */
export function bakedTexture(kinds: Array<[TexKind, number] | [TexKind, number, 'T']>, light: string, dark: string): HTMLCanvasElement {
  const key = `${kinds.map((k) => k.join(':')).join(',')}|${light}|${dark}`;
  let c = bakeCache.get(key);
  if (c) return c;
  const size = 256;
  const dev = new Float32Array(size * size);
  for (const [kind, gain, flip] of kinds) {
    const src = texture(kind);
    const d = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
    const n = src.width;
    // 'T' lays the texture transposed (strokes running the other way)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = flip ? (x % n) * n + (y % n) : (y % n) * n + (x % n);
        dev[y * size + x] += ((d[i * 4] - 128) / 128) * gain;
      }
  }
  c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const out = img.data;
  const L = rgb(light);
  const D = rgb(dark);
  for (let i = 0; i < dev.length; i++) {
    const v = dev[i];
    const col = v > 0 ? L : D;
    out[i * 4] = col[0];
    out[i * 4 + 1] = col[1];
    out[i * 4 + 2] = col[2];
    out[i * 4 + 3] = Math.min(255, Math.round(Math.abs(v) * 255));
  }
  g.putImageData(img, 0, 0);
  bakeCache.set(key, c);
  return c;
}

const scaledTiles = new Map<string, HTMLCanvasElement>();

/** A tile resampled once to an exact pixel size (cached; sizes are quantised to keep the cache small). */
function scaledTile(tile: HTMLCanvasElement, tw: number, th: number): HTMLCanvasElement {
  const key = `${bakeKeyOf(tile)}|${tw}|${th}`;
  let c = scaledTiles.get(key);
  if (!c) {
    if (scaledTiles.size > 64) scaledTiles.clear();
    c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(tile, 0, 0, tw, th);
    scaledTiles.set(key, c);
  }
  return c;
}

function patternOf(ctx: Ctx, tile: HTMLCanvasElement): CanvasPattern | null {
  let m = bakePats.get(ctx);
  if (!m) {
    m = new Map();
    bakePats.set(ctx, m);
  }
  const key = bakeKeyOf(tile);
  let pat = m.get(key) ?? null;
  if (!pat) {
    if (m.size > 96) m.clear();
    pat = ctx.createPattern(tile, 'repeat');
    if (pat) m.set(key, pat);
  }
  return pat;
}

/**
 * Fill a shape with a baked texture (see bakedTexture), `sx`/`sy` world units
 * per texel. On an unrotated canvas the tile is pre-scaled to device pixels and
 * laid 1:1 without filtering, which is several times cheaper in software.
 */
export function bakedFill(ctx: Ctx, path: PathFn, tile: HTMLCanvasElement, sx: number, sy = sx, ox = 0, oy = 0, alpha = 1): void {
  if (alpha <= 0) return;
  const m = ctx.getTransform();
  let pat: CanvasPattern | null;
  let fast = false;
  if (m.b === 0 && m.c === 0 && m.a > 0 && Math.abs(m.a - m.d) < 1e-9 && typeof CanvasPattern !== 'undefined' && 'setTransform' in CanvasPattern.prototype) {
    const k = m.a;
    const q = (v: number): number => (v > 48 ? Math.round(v / 8) * 8 : Math.max(4, Math.round(v)));
    const tw = q(tile.width * sx * k);
    const th = q(tile.height * sy * k);
    pat = patternOf(ctx, scaledTile(tile, tw, th));
    if (!pat) return;
    // pattern origin snapped to a device pixel
    const e = (Math.round(ox * k + m.e) - m.e) / k;
    const f = (Math.round(oy * k + m.f) - m.f) / k;
    pat.setTransform({ a: 1 / k, b: 0, c: 0, d: 1 / k, e, f });
    fast = true;
  } else {
    pat = patternOf(ctx, tile);
    if (!pat) return;
    if (typeof pat.setTransform === 'function') pat.setTransform({ a: sx, b: 0, c: 0, d: sy, e: ox, f: oy });
  }
  ctx.save();
  if (fast) ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = pat;
  path();
  ctx.fill();
  ctx.restore();
}

/**
 * Cheap texture for props and decor: the texture baked into warm-white and
 * violet-brown translucent paint, laid with plain source-over (blend-mode
 * fills cost several times more in software canvases).
 */
export function paintTex(ctx: Ctx, path: PathFn, kind: TexKind, alpha: number, sx: number, sy = sx, ox = 0, oy = 0): void {
  bakedFill(ctx, path, bakedTexture([[kind, 1]], '#FFF8EA', '#3E2E48'), sx, sy, ox, oy, alpha);
}

const tileKeys = new WeakMap<HTMLCanvasElement, string>();
let tileCount = 0;
function bakeKeyOf(tile: HTMLCanvasElement): string {
  let k = tileKeys.get(tile);
  if (!k) {
    k = `t${tileCount++}`;
    tileKeys.set(tile, k);
  }
  return k;
}

const sprites = new Map<string, HTMLCanvasElement>();

/**
 * A small motif rendered once at device resolution (cached by key and scale).
 * `draw` paints in world units around (0, 0); `r` is the motif's radius.
 */
export function sprite(ctx: Ctx, key: string, r: number, draw: (g: Ctx) => void): HTMLCanvasElement {
  const k = pxPerUnit(ctx);
  const ck = `${key}|${k.toFixed(3)}`;
  let c = sprites.get(ck);
  if (!c) {
    if (sprites.size > 400) sprites.clear();
    const n = Math.ceil(r * 2 * k) + 4;
    c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d')!;
    g.setTransform(k, 0, 0, k, n / 2, n / 2);
    draw(g);
    sprites.set(ck, c);
  }
  return c;
}

/** Stamp a sprite centred on world (x, y), unscaled and pixel-aligned (a plain blit). */
export function stamp(ctx: Ctx, img: HTMLCanvasElement, x: number, y: number): void {
  const m = ctx.getTransform();
  if (m.b !== 0 || m.c !== 0 || Math.abs(m.a - m.d) > 1e-9) {
    const k = pxPerUnit(ctx);
    ctx.drawImage(img, x - img.width / k / 2, y - img.height / k / 2, img.width / k, img.height / k);
    return;
  }
  const dx = Math.round(x * m.a + m.e - img.width / 2);
  const dy = Math.round(y * m.d + m.f - img.height / 2);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(img, dx, dy);
  ctx.restore();
}

const FAR = 3000;

/**
 * Soft shadow of a shape, offset by (dx, dy) world units and blurred by
 * `blur` units, without drawing the shape itself (the shape is drawn far
 * off-canvas and only its shadow is brought back). Unrotated contexts only.
 */
export function castShadow(ctx: Ctx, path: PathFn, dx: number, dy: number, blur: number, alpha: number, color = '#4A4060'): void {
  if (alpha <= 0) return;
  const k = pxPerUnit(ctx);
  ctx.save();
  ctx.shadowColor = rgba(color, alpha);
  ctx.shadowBlur = blur * k;
  ctx.shadowOffsetX = (dx + FAR) * k;
  ctx.shadowOffsetY = dy * k;
  ctx.translate(-FAR, 0);
  ctx.fillStyle = '#000';
  path();
  ctx.fill();
  ctx.restore();
}

/**
 * Clip to a rectangle snapped to device pixels: an aligned rect clip is far
 * cheaper than an anti-aliased one in software canvases.
 */
export function clipRect(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const m = ctx.getTransform();
  ctx.beginPath();
  if (m.b === 0 && m.c === 0 && m.a > 0 && m.d > 0) {
    const x0 = (Math.round(x * m.a + m.e) - m.e) / m.a;
    const y0 = (Math.round(y * m.d + m.f) - m.f) / m.d;
    const x1 = (Math.round((x + w) * m.a + m.e) - m.e) / m.a;
    const y1 = (Math.round((y + h) * m.d + m.f) - m.f) / m.d;
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
  } else ctx.rect(x, y, w, h);
  ctx.clip();
}

/** Hand-painted outline: a deep version of the fill, never black. */
export function inkLine(ctx: Ctx, path: PathFn, base: string, width = 1.2, alpha = 0.75): void {
  ctx.save();
  ctx.strokeStyle = rgba(lineOf(base), alpha);
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  path();
  ctx.stroke();
  ctx.restore();
}

/**
 * Horizontal cylinder shading over a shape spanning x0..x1: a thin shadow at
 * the far left, a bright band at ~27%, the base through the middle and a
 * deepening shade from ~62% to the right edge.
 */
export function cylinderShade(ctx: Ctx, path: PathFn, x0: number, x1: number, base: string, lit = 0.55, dark = 0.55): void {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  const sh = shadowOf(base, 0.75);
  const li = lightOf(base, 0.85);
  g.addColorStop(0, rgba(sh, dark * 0.55));
  g.addColorStop(0.1, rgba(li, 0));
  g.addColorStop(0.27, rgba(li, lit));
  g.addColorStop(0.45, rgba(li, 0));
  g.addColorStop(0.62, rgba(sh, 0));
  g.addColorStop(1, rgba(sh, dark));
  // filling the shape itself with the gradient needs no (costly) clip
  ctx.fillStyle = g;
  path();
  ctx.fill();
}

/**
 * Form shading for a roundish shape (like formShade in paint.ts) but filling
 * the shape itself with the gradient, so no clip is needed.
 */
export function roundShade(ctx: Ctx, path: PathFn, b: Box, base: string, lit = 0.35, dark = 0.3): void {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const size = Math.max(w, h);
  const cx = (b.x0 + b.x1) / 2 - 0.5 * w * 0.28;
  const cy = (b.y0 + b.y1) / 2 - 0.866 * h * 0.28;
  const g = ctx.createRadialGradient(cx, cy, size * 0.02, cx, cy, size * 0.95);
  g.addColorStop(0, rgba(lightOf(base, 1), lit));
  g.addColorStop(0.45, rgba(lightOf(base, 1), 0));
  g.addColorStop(0.62, rgba(shadowOf(base, 1), 0));
  g.addColorStop(1, rgba(shadowOf(base, 1), dark));
  ctx.fillStyle = g;
  path();
  ctx.fill();
}

/**
 * Soft shadow thrown on the wall to the right of something standing in
 * front of it (light from the upper left): a band fading out sideways, its
 * top cut on the diagonal by the object's top corner. No blur needed.
 */
export function sideShadow(ctx: Ctx, x1: number, y0: number, y1: number, width: number, alpha: number): void {
  const g = ctx.createLinearGradient(x1, 0, x1 + width, 0);
  g.addColorStop(0, rgba('#4A4060', alpha));
  g.addColorStop(0.5, rgba('#4A4060', alpha * 0.4));
  g.addColorStop(1, rgba('#4A4060', 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x1, y0 + 2);
  ctx.lineTo(x1 + width, y0 + 2 + width * 1.2);
  ctx.lineTo(x1 + width, y1);
  ctx.lineTo(x1, y1);
  ctx.closePath();
  ctx.fill();
}

/** A small round knob or nail head with a glint. */
export function knob(ctx: Ctx, x: number, y: number, r: number, base: string): void {
  if (r < 1.6) {
    // tiny: three flat dabs are plenty
    ctx.fillStyle = rgba(shadowOf(base, 0.6), 0.9);
    ctx.beginPath();
    ctx.arc(x + r * 0.15, y + r * 0.2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(x - r * 0.1, y - r * 0.1, r * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(lightOf(base, 1), 0.85);
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.save();
  ctx.fillStyle = rgba(shadowOf(base, 0.8), 0.35);
  ctx.beginPath();
  ctx.ellipse(x + r * 0.35, y + r * 0.55, r * 1.05, r * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r * 1.05);
  g.addColorStop(0, lightOf(base, 0.75));
  g.addColorStop(0.5, base);
  g.addColorStop(1, shadowOf(base, 0.55));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(lineOf(base), 0.6);
  ctx.lineWidth = Math.min(1, r * 0.35);
  ctx.stroke();
  if (r > 1.4) glint(ctx, x - r * 0.38, y - r * 0.4, r * 0.22, 0.8);
  ctx.restore();
}

/** Deterministic pick from a list. */
export function pick<T>(list: readonly T[], seed: number, k: number): T {
  return list[Math.floor(hash01(seed, k) * list.length) % list.length];
}

/** Jitter in [-1, 1). */
export function jit(seed: number, k: number): number {
  return hash01(seed, k) * 2 - 1;
}
