// Cat Drop: bath time. A fluffy wall of soap foam creeps down the shaft from
// above: a billowy edge of big soft bubbles (white, with lavender and sky
// tints and a pastel rainbow sheen) wobbling gently in front of a mass of
// finer foam. The bubble sprites and the foam texture are painted once (per
// resolution); the edge is laid out once and only wobbles.

import type { Ctx } from '../../render/paint';
import { rng } from '../kit';
import { SIDE } from './art';
import { SHAFT_W } from './level';

const TAU = Math.PI * 2;
/** Radius the bubble sprites are painted at (world units). */
const R0 = 34;
/** Side of the seamless foam texture tile (world units). */
const TILE = 150;
/** Bubble tints: lavender, sky, pearl (mid, low, rim). */
const TINTS = [
  ['#F7F3FD', '#E6DEF5', '#D2C7EC'],
  ['#F3F7FD', '#DCE7F6', '#C4D5EE'],
  ['#FAF8FC', '#ECE8F3', '#D9D2E8'],
];

interface Bub {
  x: number;
  /** Centre relative to the foam's lowest edge. */
  dy: number;
  r: number;
  ph: number;
  v: number;
}

/** The edge: a row of bubbles behind, a row of big ones in front, little ones dangling. */
const EDGE = ((): { back: Bub[]; front: Bub[]; small: Bub[] } => {
  const rnd = rng(4242);
  const x0 = -SIDE - 14;
  const x1 = SHAFT_W + SIDE + 14;
  const tint = (): number => Math.floor(rnd() * 3);
  const back: Bub[] = [];
  for (let x = x0; x < x1; ) {
    const r = 17 + rnd() * 11;
    back.push({ x, dy: -34 - r * 0.45 - rnd() * 12, r, ph: rnd() * TAU, v: tint() });
    x += r * (1.15 + rnd() * 0.3);
  }
  const front: Bub[] = [];
  for (let x = x0 + 6; x < x1; ) {
    const r = 21 + rnd() * 13;
    front.push({ x, dy: -r - rnd() * 9, r, ph: rnd() * TAU, v: tint() });
    x += r * (1.3 + rnd() * 0.35);
  }
  const small: Bub[] = [];
  for (let i = 0; i < 14; i++) {
    const r = 4.5 + rnd() * 6.5;
    small.push({ x: x0 + 10 + rnd() * (x1 - x0 - 20), dy: -r * (0.25 + rnd() * 1.3) + 1, r, ph: rnd() * TAU, v: tint() });
  }
  return { back, front, small };
})();

// --- Sprites ----------------------------------------------------------------------

const sprites: HTMLCanvasElement[] = [];
let spritePpu = 0;

/** A soft foam bubble of radius R at the origin, lit from the upper left. */
function paintBubble(g: Ctx, R: number, v: number): void {
  const [mid, low, rim] = TINTS[v];
  const body = g.createRadialGradient(-R * 0.34, -R * 0.4, R * 0.04, -R * 0.08, -R * 0.06, R * 1.05);
  body.addColorStop(0, '#FFFFFF');
  body.addColorStop(0.45, mid);
  body.addColorStop(0.82, low);
  body.addColorStop(1, rim);
  g.fillStyle = body;
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.fill();
  g.lineCap = 'round';
  // light bounced back up into the low right
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.lineWidth = R * 0.07;
  g.beginPath();
  g.arc(0, 0, R * 0.8, 0.12 * Math.PI, 0.5 * Math.PI);
  g.stroke();
  // the pastel rainbow sheen of a soap film, along the lit upper left
  const sheen = g.createLinearGradient(-R * 0.9, R * 0.1, R * 0.1, -R * 0.9);
  sheen.addColorStop(0, 'rgba(246,168,196,0.62)');
  sheen.addColorStop(0.28, 'rgba(250,222,140,0.62)');
  sheen.addColorStop(0.52, 'rgba(150,226,190,0.62)');
  sheen.addColorStop(0.76, 'rgba(140,190,246,0.62)');
  sheen.addColorStop(1, 'rgba(196,160,240,0.56)');
  g.strokeStyle = sheen;
  g.lineWidth = R * 0.1;
  g.beginPath();
  g.arc(0, 0, R * 0.84, 0.95 * Math.PI, 1.6 * Math.PI);
  g.stroke();
  // a crisp highlight
  g.fillStyle = 'rgba(255,255,255,0.96)';
  g.beginPath();
  g.ellipse(-R * 0.36, -R * 0.44, R * 0.2, R * 0.11, -0.72, 0, TAU);
  g.fill();
  g.beginPath();
  g.arc(-R * 0.08, -R * 0.63, R * 0.05, 0, TAU);
  g.fill();
  // a soft edge
  g.strokeStyle = 'rgba(146,128,190,0.42)';
  g.lineWidth = Math.max(0.8, R * 0.035);
  g.beginPath();
  g.arc(0, 0, R - g.lineWidth * 0.5, 0, TAU);
  g.stroke();
}

function bubbleSprite(v: number, ppu: number): HTMLCanvasElement {
  if (spritePpu !== ppu) {
    sprites.length = 0;
    spritePpu = ppu;
  }
  let c = sprites[v];
  if (c) return c;
  c = document.createElement('canvas');
  const S = Math.ceil((R0 * 2 + 4) * ppu);
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.setTransform(ppu, 0, 0, ppu, S / 2, S / 2);
  paintBubble(g, R0, v);
  sprites[v] = c;
  return c;
}

/** One foam bubble of radius r centred on (x, y); `v` picks the tint (0..2). */
export function drawBubble(ctx: Ctx, x: number, y: number, r: number, v: number, ppu: number): void {
  const s = bubbleSprite(v % 3, ppu);
  const half = (s.width / ppu / 2) * (r / R0);
  ctx.drawImage(s, x - half, y - half, half * 2, half * 2);
}

let tile: HTMLCanvasElement | null = null;
let tilePx = 0;

/** A seamless tile of fine foam: packed little domes, lit from the upper left. */
function foamTile(ppu: number): HTMLCanvasElement {
  const S = Math.max(16, Math.round(TILE * Math.min(ppu, 2.4)));
  if (tile && tilePx === S) return tile;
  const c = tile ?? document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const k = S / TILE;
  g.setTransform(k, 0, 0, k, 0, 0);
  g.fillStyle = '#EFEAF8';
  g.fillRect(0, 0, TILE, TILE);
  const rnd = rng(77);
  const cells: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 110; i++) cells.push({ x: rnd() * TILE, y: rnd() * TILE, r: 3.5 + rnd() * rnd() * 14 });
  // the big ones first, so the little ones nestle on top
  cells.sort((a, b) => b.r - a.r);
  for (const cl of cells)
    for (const ox of [-TILE, 0, TILE])
      for (const oy of [-TILE, 0, TILE]) {
        const x = cl.x + ox;
        const y = cl.y + oy;
        if (x + cl.r < 0 || x - cl.r > TILE || y + cl.r < 0 || y - cl.r > TILE) continue;
        const gr = g.createRadialGradient(x - cl.r * 0.35, y - cl.r * 0.4, cl.r * 0.05, x, y, cl.r);
        gr.addColorStop(0, '#FFFFFF');
        gr.addColorStop(0.6, '#F7F4FC');
        gr.addColorStop(1, '#D9D0EE');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, cl.r, 0, TAU);
        g.fill();
        g.strokeStyle = 'rgba(160,146,204,0.3)';
        g.lineWidth = 0.6;
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath();
        g.arc(x - cl.r * 0.38, y - cl.r * 0.42, cl.r * 0.17, 0, TAU);
        g.fill();
      }
  tile = c;
  tilePx = S;
  return c;
}

// --- The foam wall --------------------------------------------------------------------

function edgeBubble(ctx: Ctx, b: Bub, y: number, t: number, ppu: number): void {
  const r = b.r * (1 + Math.sin(t * 1.7 + b.ph * 1.3) * 0.035);
  const by = y + b.dy + Math.sin(t * 1.25 + b.ph) * 2.2;
  const bx = b.x + Math.sin(t * 0.8 + b.ph * 0.7) * 1.4;
  drawBubble(ctx, bx, by, r, b.v, ppu);
}

/**
 * The foam wall with its lowest edge at world y `y`, filling everything above
 * up to `top` (the top of the screen). `t` is the clock (for the wobble).
 */
export function drawFoam(ctx: Ctx, y: number, t: number, top: number, ppu: number): void {
  const x0 = -SIDE - 6;
  const x1 = SHAFT_W + SIDE + 6;
  // a soft shadow on the wall just under it
  const sh = ctx.createLinearGradient(0, y - 12, 0, y + 34);
  sh.addColorStop(0, 'rgba(84,72,128,0.15)');
  sh.addColorStop(1, 'rgba(84,72,128,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(x0, y - 12, x1 - x0, 46);
  // the mass of finer foam behind the edge, moving down with it
  const bottom = y - 26;
  if (bottom > top) {
    const img = foamTile(ppu);
    const pat = ctx.createPattern(img, 'repeat');
    if (pat) {
      const k = TILE / img.width;
      pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, y % TILE]));
      ctx.fillStyle = pat;
      ctx.fillRect(x0, top, x1 - x0, bottom - top);
    }
    // cool shade low in the mass, where the big bubbles hang in front of it
    const s0 = Math.max(top, bottom - 120);
    const g = ctx.createLinearGradient(0, bottom - 120, 0, bottom);
    g.addColorStop(0, 'rgba(176,162,218,0)');
    g.addColorStop(1, 'rgba(176,162,218,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, s0, x1 - x0, bottom - s0);
  }
  for (const b of EDGE.back) edgeBubble(ctx, b, y, t, ppu);
  // the back row sits in the front row's shade
  const g = ctx.createLinearGradient(0, y - 80, 0, y - 18);
  g.addColorStop(0, 'rgba(176,162,218,0)');
  g.addColorStop(1, 'rgba(176,162,218,0.3)');
  ctx.fillStyle = g;
  ctx.fillRect(x0, y - 80, x1 - x0, 62);
  for (const b of EDGE.front) edgeBubble(ctx, b, y, t, ppu);
  for (const b of EDGE.small) edgeBubble(ctx, b, y, t * 1.3, ppu);
}
