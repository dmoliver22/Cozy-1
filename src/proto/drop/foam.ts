// Cat Drop: drawing bath time's foam (simulated in suds.ts). Soap bubbles are
// mostly clear: a thin bright rim, thin-film colours swirling slowly around
// each one, a window-shaped highlight up on the left with a small glint below
// on the right, and a faint darker edge low on the right; each is squashed and
// stretched as the simulation says. Behind densely packed bubbles goes a soft
// white suds body, so the mass reads as foam rather than loose marbles. The
// still parts are cached per radius bucket; the film's swirl and the squash are
// applied live. Also: drops, splashes and the rings of popped bubbles, and the
// opaque white suds that cling to a soaked cat.

import { rgba, type Ctx } from '../../render/paint';
import type { Suds } from './suds';

const TAU = Math.PI * 2;
/** Radius the opaque suds are painted at (world units). */
const R0 = 34;
/** Bubble tints for the opaque suds: lavender, sky, pearl (mid, low, rim). */
const TINTS = [
  ['#F7F3FD', '#E6DEF5', '#D2C7EC'],
  ['#F3F7FD', '#DCE7F6', '#C4D5EE'],
  ['#FAF8FC', '#ECE8F3', '#D9D2E8'],
];

// --- Opaque suds (on the soaked cat) ----------------------------------------------------

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


// --- Soap bubbles -------------------------------------------------------------------------

/** Radii the bubble sprites are painted at; a bubble uses the smallest one at least its size. */
const BUCKETS = [4, 6, 9, 13, 18, 24, 30];
const PAD = 2;

interface Sprite {
  c: HTMLCanvasElement;
  /** World units from the centre to the sprite's edge, at the bucket radius. */
  half: number;
}

let foamKey = 0;
let shells: Sprite[] = [];
let films: Sprite[] = [];
let blob: Sprite | null = null;
/** Debug: which layers of the foam to draw. */
export const foamDebug = { all: true, body: true, films: true, shells: true, top: true, drops: true, straight: false };
/** Little bubbles (the smallest buckets) are drawn in one go: film baked in, no swirl to see. */
const BAKED = 2;


function makeSprite(R: number, ppu: number, paint: (g: Ctx, R: number) => void): Sprite {
  const half = R + PAD;
  const c = document.createElement('canvas');
  const S = Math.max(4, Math.ceil(half * 2 * ppu));
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const k = S / (half * 2);
  g.setTransform(k, 0, 0, k, S / 2, S / 2);
  paint(g, R);
  return { c, half };
}

/** The still parts of a soap bubble: a faint body, a darker edge low right, a bright rim, a window highlight and a glint. */
function paintShell(g: Ctx, R: number): void {
  const body = g.createRadialGradient(-R * 0.18, -R * 0.22, R * 0.1, 0, 0, R);
  body.addColorStop(0, 'rgba(255,255,255,0.05)');
  body.addColorStop(0.68, 'rgba(238,234,252,0.07)');
  body.addColorStop(0.9, 'rgba(208,200,240,0.2)');
  body.addColorStop(1, 'rgba(196,188,236,0.34)');
  g.fillStyle = body;
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.fill();
  g.lineCap = 'round';
  // a faint darker edge, low on the right (away from the light)
  g.strokeStyle = 'rgba(92,80,150,0.3)';
  g.lineWidth = Math.max(0.5, R * 0.07);
  g.beginPath();
  g.arc(0, 0, R * 0.95, -0.12 * Math.PI, 0.72 * Math.PI);
  g.stroke();
  // the thin bright rim
  const lw = Math.max(0.45, R * 0.045);
  g.strokeStyle = 'rgba(255,255,255,0.82)';
  g.lineWidth = lw;
  g.beginPath();
  g.arc(0, 0, R - lw / 2, 0, TAU);
  g.stroke();
  // a window, reflected: four little panes up on the left
  g.save();
  g.translate(-R * 0.4, -R * 0.42);
  g.rotate(-Math.PI / 4);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  const pw = R * 0.12;
  const ph = R * 0.1;
  const gap = Math.max(0.25, R * 0.03);
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      g.beginPath();
      g.ellipse((sx * (pw + gap)) / 2, (sy * (ph + gap)) / 2, pw / 2, ph / 2, 0, 0, TAU);
      g.fill();
    }
  g.restore();
  // a small glint low on the right, and a sliver of light bounced back in
  g.fillStyle = 'rgba(255,255,255,0.62)';
  g.beginPath();
  g.arc(R * 0.42, R * 0.46, Math.max(0.35, R * 0.06), 0, TAU);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.3)';
  g.lineWidth = Math.max(0.35, R * 0.035);
  g.beginPath();
  g.arc(0, 0, R * 0.8, 0.12 * Math.PI, 0.38 * Math.PI);
  g.stroke();
}

const FILM = ['#F7A8C8', '#F9C9A0', '#F6E39A', '#A6E6C6', '#9CCBF5', '#C3A8F0'];

function filmColor(u: number): string {
  const t = (((u % 1) + 1) % 1) * FILM.length;
  const k = Math.floor(t);
  const a = FILM[k];
  const b = FILM[(k + 1) % FILM.length];
  const f = t - k;
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number): number => Math.round(((pa >> s) & 255) * (1 - f) + ((pb >> s) & 255) * f);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** Thin-film colour: pastel rainbow bands round the bubble, brighter in two swirling lobes (drawn rotated, live). */
function paintFilm(g: Ctx, R: number): void {
  const segs = 64;
  g.lineCap = 'butt';
  for (let pass = 0; pass < 2; pass++) {
    const rad = pass === 0 ? R * 0.84 : R * 0.62;
    const cx = pass === 0 ? 0 : R * 0.07;
    const cy = pass === 0 ? 0 : -R * 0.05;
    g.lineWidth = pass === 0 ? R * 0.2 : R * 0.12;
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * TAU;
      const a1 = ((k + 1.15) / segs) * TAU;
      const lobe = Math.max(0, Math.sin(a0 * 2 + 0.6 + pass * 1.9)) ** 1.6;
      const alpha = pass === 0 ? 0.1 + 0.36 * lobe : 0.05 + 0.16 * lobe;
      g.strokeStyle = rgba(filmColor((k / segs) * 2 + pass * 0.37), alpha);
      g.beginPath();
      g.arc(cx, cy, rad, a0, a1);
      g.stroke();
    }
  }
}

/** The soft white body of packed suds. */
function paintBlob(g: Ctx, R: number): void {
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
  gr.addColorStop(0, 'rgba(255,255,255,0.92)');
  gr.addColorStop(0.5, 'rgba(250,248,255,0.72)');
  gr.addColorStop(0.8, 'rgba(244,240,253,0.3)');
  gr.addColorStop(1, 'rgba(244,240,253,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.fill();
}

/** Paint the bubble sprites for this resolution (ahead of time, so the foam never hitches in). */
export function prepareFoam(ppu: number): void {
  const key = Math.round(ppu * 100);
  if (key === foamKey) return;
  foamKey = key;
  shells = BUCKETS.map((R, b) =>
    makeSprite(R, ppu, (g, r) => {
      if (b < BAKED) paintFilm(g, r);
      paintShell(g, r);
    }),
  );
  films = BUCKETS.map((R) => makeSprite(R, ppu, paintFilm));
  blob = makeSprite(32, Math.min(ppu, 1.2), paintBlob);
}

function bucket(r: number): number {
  for (let b = 0; b < BUCKETS.length; b++) if (BUCKETS[b] >= r) return b;
  return BUCKETS.length - 1;
}

/**
 * Draw the foam: the suds body, then each bubble (film swirled, then shell,
 * both squashed). World x maps to device ppu*x + ex (y likewise with ey);
 * `t` (0..1) is how far between the last two physics steps we are.
 */
export function drawSuds(ctx: Ctx, s: Suds, t: number, ppu: number, ex: number, ey: number, camY: number, viewH: number): void {
  if (!blob || s.n === 0 || !foamDebug.all) return;
  const top = camY - 50;
  const bot = camY + viewH + 50;
  const n = s.n;
  // where the mass stops short of the top of the screen (if it does), more suds
  let massTop = Infinity;
  for (let i = 0; i < n; i++) if (!s.loose[i] && s.alpha[i] > 0.5) massTop = Math.min(massTop, s.y[i] - s.r[i]);
  if (foamDebug.top && massTop < Infinity && massTop > camY && s.front > camY + 20) {
    ctx.globalAlpha = 1;
    ctx.setTransform(ppu, 0, 0, ppu, ex, ey);
    const g = ctx.createLinearGradient(0, massTop - 30, 0, massTop + 50);
    g.addColorStop(0, 'rgba(250,248,255,0.95)');
    g.addColorStop(1, 'rgba(250,248,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-12, camY - 10, 404, massTop + 50 - camY + 10);
  }
  // the suds body: soft white behind packed bubbles (the bigger ones carry it)
  const B = blob;
  for (let i = 0; i < n; i++) {
    const nb = s.nb[i];
    const r = s.r[i];
    if (s.loose[i] || nb < 2 || r < 8 || !foamDebug.body) continue;
    const y = s.py[i] + (s.y[i] - s.py[i]) * t;
    if (y + r * 2.1 < top || y - r * 2.1 > bot) continue;
    const x = s.px[i] + (s.x[i] - s.px[i]) * t;
    const k = (ppu * r * 2) / 32;
    ctx.globalAlpha = s.alpha[i] * Math.min(1, (nb - 1) / 3) * 0.8;
    ctx.setTransform(k, 0, 0, k, ppu * x + ex, ppu * y + ey);
    ctx.drawImage(B.c, -B.half, -B.half, B.half * 2, B.half * 2);
  }
  for (let i = 0; i < n; i++) {
    const r = s.r[i];
    const y = s.py[i] + (s.y[i] - s.py[i]) * t;
    if (y + r * 1.5 < top || y - r * 1.5 > bot) continue;
    const x = s.px[i] + (s.x[i] - s.px[i]) * t;
    const b = bucket(r);
    const sc = (ppu * r) / BUCKETS[b];
    // squashed along its axis (area kept): M = R(a) diag(f, 1/f) R(-a)
    const f = 1 - s.q[i];
    const g = 1 / f;
    const ca = Math.cos(s.qa[i]);
    const sa = Math.sin(s.qa[i]);
    const A = sc * (ca * ca * f + sa * sa * g);
    const Bm = sc * ca * sa * (f - g);
    const D = sc * (sa * sa * f + ca * ca * g);
    const E = ppu * x + ex;
    const F = ppu * y + ey;
    ctx.globalAlpha = s.alpha[i];
    // the film, swirling
    if (b >= BAKED && foamDebug.films) {
      const fs = films[b];
      const cp = Math.cos(s.ph[i]);
      const sp = Math.sin(s.ph[i]);
      ctx.setTransform(A * cp + Bm * sp, Bm * cp + D * sp, -A * sp + Bm * cp, -Bm * sp + D * cp, E, F);
      ctx.drawImage(fs.c, -fs.half, -fs.half, fs.half * 2, fs.half * 2);
    }
    // rim and highlights
    const sh = shells[b];
    if (!foamDebug.shells) continue;
    if (foamDebug.straight) ctx.setTransform(A, 0, 0, D, E, F);
    else ctx.setTransform(A, Bm, Bm, D, E, F);
    ctx.drawImage(sh.c, -sh.half, -sh.half, sh.half * 2, sh.half * 2);
  }
  ctx.globalAlpha = 1;
}

/** Drops, splashes and the rings of popped bubbles (after the glass, over everything). */
export function drawDrops(ctx: Ctx, s: Suds, ppu: number, ex: number, ey: number): void {
  if (!foamDebug.drops) return;
  ctx.setTransform(ppu, 0, 0, ppu, ex, ey);
  ctx.globalAlpha = 1;
  if (s.dn > 0) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(118,168,224,0.85)';
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    for (let k = 0; k < s.dn; k++) {
      const x = s.dx[k];
      const y = s.dy[k];
      const len = Math.min(0.02, 9 / Math.max(1, Math.abs(s.dvy[k])));
      ctx.moveTo(x - s.dvx[k] * len, y - s.dvy[k] * len);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,244,255,0.95)';
    ctx.beginPath();
    for (let k = 0; k < s.dn; k++) {
      ctx.moveTo(s.dx[k] + s.ds[k] * 0.7, s.dy[k]);
      ctx.arc(s.dx[k], s.dy[k], s.ds[k] * 0.7, 0, TAU);
    }
    ctx.fill();
  }
  if (s.sn > 0) {
    ctx.fillStyle = 'rgba(160,200,240,0.9)';
    ctx.beginPath();
    for (let k = 0; k < s.sn; k++) {
      const rr = s.ss[k] * (1 - (s.sa[k] / s.sl[k]) * 0.6);
      ctx.moveTo(s.sx[k] + rr, s.sy[k]);
      ctx.arc(s.sx[k], s.sy[k], rr, 0, TAU);
    }
    ctx.fill();
  }
  for (let k = 0; k < s.rn; k++) {
    const u = s.ra[k] / 0.2;
    ctx.strokeStyle = `rgba(255,255,255,${0.75 * (1 - u)})`;
    ctx.lineWidth = Math.max(0.5, 1.4 * (1 - u));
    ctx.beginPath();
    ctx.arc(s.rx[k], s.ry[k], s.rr[k] * (0.9 + u * 0.7), 0, TAU);
    ctx.stroke();
  }
}
