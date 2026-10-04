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
