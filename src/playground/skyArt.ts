// The Playground's sky: blue overhead and warmer the lower you go, a sun far
// off, clouds drifting past at two depths (they move slower than you do, so
// the sky has depth), a sea of cloud far below everything, and the respawn
// cloud in the middle with its little star. Clouds are painted once into
// sprites and stamped: the view can take in a lot of sky zoomed out.

import { hash01, mix, rgba, type Ctx } from '../render/paint';
import { SPAWN } from './layout';

type Rect = { x0: number; y0: number; x1: number; y1: number };

const TAU = Math.PI * 2;

/** The sky's colour at a height: deep overhead, soft blue around the respawn cloud, peach down toward the sea of cloud. */
const SKY: [number, string][] = [
  [-4200, '#6F95CF'],
  [-1800, '#93B8E2'],
  [-400, '#B5D2EE'],
  [500, '#D9E6F2'],
  [1400, '#F4E2D2'],
  [2600, '#F6CDB2'],
];

export function skyColor(y: number): string {
  if (y <= SKY[0][0]) return SKY[0][1];
  for (let k = 1; k < SKY.length; k++) {
    if (y <= SKY[k][0]) return mix(SKY[k - 1][1], SKY[k][1], (y - SKY[k - 1][0]) / (SKY[k][0] - SKY[k - 1][0]));
  }
  return SKY[SKY.length - 1][1];
}

// ---------------------------------------------------------------------------
// Cloud sprites

/** Pixels per world unit in a cloud sprite (it's soft: stretched a little zoomed right in, nobody can tell). */
const PPU = 3;
const SPRITES: HTMLCanvasElement[] = [];

/** A fluffy cloud, about 180 across and 70 high, its flat bottom's middle at (0, 0). */
function paintCloud(ctx: Ctx, seed: number): void {
  const puffs: [number, number, number][] = [];
  const n = 6;
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1) - 0.5;
    const hump = 1 - Math.abs(u) * 1.5;
    puffs.push([u * 130 + (hash01(seed, k) - 0.5) * 14, -14 - hump * 20 - hash01(seed, k + 3) * 8, 16 + hump * 18 + hash01(seed, k + 9) * 8]);
  }
  const path = (): void => {
    ctx.beginPath();
    for (const [px, py, pr] of puffs) {
      ctx.moveTo(px + pr, py);
      ctx.arc(px, py, pr, 0, TAU);
    }
    // (its flat bottom, wound the same way round as the puffs: wound the other way, where they overlap they'd cancel out)
    ctx.moveTo(-74, -20);
    ctx.lineTo(74, -20);
    ctx.lineTo(74, -12);
    ctx.arcTo(74, 0, 60, 0, 12);
    ctx.lineTo(-60, 0);
    ctx.arcTo(-74, 0, -74, -12, 12);
    ctx.closePath();
  };
  ctx.save();
  ctx.fillStyle = 'rgba(255,253,250,0.96)';
  path();
  ctx.fill();
  ctx.clip();
  // lavender shade under its belly, and a warm lit top
  const g = ctx.createLinearGradient(0, -70, 0, 2);
  g.addColorStop(0, 'rgba(255,248,236,0.5)');
  g.addColorStop(0.5, 'rgba(214,206,232,0.06)');
  g.addColorStop(1, 'rgba(170,160,206,0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(-110, -80, 220, 90);
  ctx.restore();
}

function sprite(k: number): HTMLCanvasElement {
  let c = SPRITES[k];
  if (!c) {
    c = document.createElement('canvas');
    c.width = 220 * PPU;
    c.height = 90 * PPU;
    const g = c.getContext('2d')!;
    g.setTransform(PPU, 0, 0, PPU, 110 * PPU, 84 * PPU);
    paintCloud(g, 17 + k * 31);
    SPRITES[k] = c;
  }
  return c;
}

/** A cloud stamped with its flat bottom's middle at (x, y), `s` times its size. */
function stamp(ctx: Ctx, k: number, x: number, y: number, s: number, alpha: number): void {
  const c = sprite(k % 4);
  ctx.globalAlpha = alpha;
  ctx.drawImage(c, x - 110 * s, y - 84 * s, 220 * s, 90 * s);
}

// ---------------------------------------------------------------------------
// The sky

/**
 * The sky behind everything, for the part of the world on screen (`r`),
 * with the camera at (cx, cy): far things (the sun, the clouds) move
 * slower than near ones as the view goes by.
 */
export function paintSky(ctx: Ctx, r: Rect, cx: number, cy: number, seaY: number): void {
  const g = ctx.createLinearGradient(0, r.y0, 0, r.y1);
  const n = 6;
  for (let k = 0; k <= n; k++) g.addColorStop(k / n, skyColor(r.y0 + ((r.y1 - r.y0) * k) / n));
  ctx.fillStyle = g;
  ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  // the sun, so far off it hardly moves
  const far = 0.94;
  const sx = -150 + cx * far;
  const sy = -330 + cy * far;
  const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 260);
  sg.addColorStop(0, 'rgba(255,248,222,0.95)');
  sg.addColorStop(0.09, 'rgba(255,242,206,0.85)');
  sg.addColorStop(0.11, 'rgba(255,236,196,0.45)');
  sg.addColorStop(0.45, 'rgba(255,228,184,0.14)');
  sg.addColorStop(1, 'rgba(255,228,184,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(sx - 260, sy - 260, 520, 520);
  // two depths of cloud
  ctx.save();
  cloudLayer(ctx, r, cx, cy, 0.78, 760, 520, 0.55, 0.5, 1);
  cloudLayer(ctx, r, cx, cy, 0.45, 980, 640, 1, 0.75, 2);
  ctx.restore();
  paintSea(ctx, r, seaY);
}

/**
 * Clouds on a grid of cells (some cells empty), in a layer `far` of the way
 * to staying put as the camera moves (so it looks that far off): fewer up
 * high, more down toward the sea.
 */
function cloudLayer(ctx: Ctx, r: Rect, cx: number, cy: number, far: number, cw: number, ch: number, size: number, alpha: number, seed: number): void {
  const ox = cx * far;
  const oy = cy * far;
  const i0 = Math.floor((r.x0 - ox) / cw) - 1;
  const i1 = Math.floor((r.x1 - ox) / cw) + 1;
  const j0 = Math.floor((r.y0 - oy) / ch) - 1;
  const j1 = Math.floor((r.y1 - oy) / ch) + 1;
  // (zoomed right out, a far layer would be thousands of stamps: thin it)
  if ((i1 - i0) * (j1 - j0) > 160) return;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const h = hash01(i * 7919 + seed, j * 104729 + seed);
      const y = j * ch + hash01(i + seed, j - 3) * ch * 0.8 + oy;
      // (a cloud in about a third of the cells up high, two thirds low down)
      const odds = 0.32 + 0.34 * Math.max(0, Math.min(1, (y + 1500) / 3000));
      if (h > odds) continue;
      const x = i * cw + hash01(i - 11, j + seed) * cw * 0.8 + ox;
      const s = size * (0.7 + hash01(i + 5, j + 7) * 0.7);
      if (x + 110 * s < r.x0 || x - 110 * s > r.x1 || y < r.y0 || y - 84 * s > r.y1) continue;
      stamp(ctx, i * 3 + j, x, y, s, alpha);
    }
  }
  ctx.globalAlpha = 1;
}

/** The sea of cloud far below: a cat that falls into it comes back up on the respawn cloud. */
function paintSea(ctx: Ctx, r: Rect, seaY: number): void {
  if (r.y1 < seaY - 200) return;
  ctx.save();
  const g = ctx.createLinearGradient(0, seaY - 60, 0, seaY + 400);
  g.addColorStop(0, 'rgba(255,246,240,0)');
  g.addColorStop(0.2, 'rgba(255,244,238,0.92)');
  g.addColorStop(1, 'rgba(246,222,214,1)');
  ctx.fillStyle = g;
  ctx.fillRect(r.x0, seaY - 60, r.x1 - r.x0, Math.max(0, r.y1 - seaY + 60));
  // its billowing top
  const w = 150;
  for (let i = Math.floor(r.x0 / w) - 1; i <= Math.ceil(r.x1 / w) + 1; i++) {
    const x = i * w + hash01(i, 5) * 40;
    stamp(ctx, i, x, seaY + 40 + hash01(i, 9) * 30, 1.5 + hash01(i, 2) * 0.6, 1);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The respawn cloud, and the little clouds things float on

/** The respawn cloud: soft and plump, its top where the cats stand, and its star (where they come back to). */
export function paintSpawn(ctx: Ctx, t: number): void {
  const { x, y, half, thick } = SPAWN;
  ctx.save();
  // a warm glow round it
  const glow = ctx.createRadialGradient(x, y + 10, 20, x, y + 10, half * 1.5);
  glow.addColorStop(0, 'rgba(255,236,190,0.35)');
  glow.addColorStop(1, 'rgba(255,236,190,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - half * 1.6, y - half * 1.2, half * 3.2, half * 2.4);
  // its puffs: along the top where the cats stand, fat ones underneath
  const puffs: [number, number, number][] = [];
  for (let k = 0; k <= 10; k++) {
    const u = k / 10;
    puffs.push([x - half + 6 + u * (half * 2 - 12), y + 10, 12 + hash01(k, 4) * 4]);
  }
  for (let k = 0; k <= 6; k++) {
    const u = k / 6 - 0.5;
    puffs.push([x + u * half * 1.6, y + thick - 2 + (1 - Math.abs(u) * 1.6) * 8, 16 + (1 - Math.abs(u) * 1.4) * 12 + hash01(k, 8) * 5]);
  }
  const path = (): void => {
    ctx.beginPath();
    for (const [px, py, pr] of puffs) {
      ctx.moveTo(px + pr, py);
      ctx.arc(px, py, pr, 0, TAU);
    }
    ctx.rect(x - half + 6, y + 4, half * 2 - 12, thick);
  };
  ctx.fillStyle = '#FFFDF9';
  path();
  ctx.fill();
  ctx.save();
  path();
  ctx.clip();
  const g = ctx.createLinearGradient(0, y - 6, 0, y + thick + 34);
  g.addColorStop(0, 'rgba(255,250,240,0)');
  g.addColorStop(0.45, 'rgba(220,212,236,0.1)');
  g.addColorStop(1, 'rgba(168,156,206,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(x - half - 20, y - 10, half * 2 + 40, thick + 60);
  ctx.restore();
  // the star on its wand, twinkling
  const wx = x + half - 22;
  ctx.strokeStyle = '#C9A15A';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(wx, y + 4);
  ctx.lineTo(wx, y - 44);
  ctx.stroke();
  const tw = 1 + Math.sin(t * 2.4) * 0.08;
  star(ctx, wx, y - 52, 11 * tw, '#F6C85F');
  ctx.fillStyle = rgba('#FFF6D8', 0.35 + Math.sin(t * 2.4) * 0.15);
  ctx.beginPath();
  ctx.arc(wx, y - 52, 20 * tw, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function star(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    if (k === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = mix(color, '#7A5A2A', 0.45);
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

/** A little cloud for something that stands (a cushion, a bed) to float on, its top at y. */
export function floatPuff(ctx: Ctx, x: number, y: number, w: number): void {
  stamp(ctx, Math.round(x), x, y + 26, w / 150, 0.95);
  ctx.globalAlpha = 1;
}
