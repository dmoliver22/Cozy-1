// Cat Drop: drawing bath time's foam (simulated in suds.ts). Soap bubbles are
// mostly clear: a thin bright rim, thin-film colours swirling slowly around
// each one, a window-shaped highlight up on the left with a small glint below
// on the right, and a faint darker edge low on the right; each is squashed and
// stretched as the simulation says. Behind densely packed bubbles goes a soft
// white suds body, so the mass reads as foam rather than loose marbles, and
// behind the foam that fills the screen at the end, a solid flood of suds. All
// of it is cached per radius bucket (the film in a ring of turns its swirl
// steps through), so every draw is a plain scaled sprite and a few hundred are
// cheap. Also: drops, splashes and the rings of popped bubbles, and the opaque
// white suds that cling to a soaked cat (and pile up on the bath).

import { rgba, type Ctx } from '../../render/paint';
import { SHAFT_W } from './level';
import { FLOOD_BACK, FLOOD_EDGE, type Suds } from './suds';

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

/** The solid suds of the flood. */
const FLOOD = '#FCFAFF';

/** Radii the bubble sprites are painted at; a bubble uses the smallest one at least its size. */
const BUCKETS = [4, 6, 9, 13, 18, 24, 30];
const PAD = 2;
/** Little bubbles (the smallest buckets) keep one film: no swirl to see at that size. */
const BAKED = 2;
/** Turns of the thin film each bigger bubble can show (its swirl steps through them). */
const TURNS = 24;
/** The suds body is soft, so it is laid at low resolution (world units per pixel) and scaled up. */
const BODY_RES = 2;

interface Sprite {
  c: HTMLCanvasElement;
  /** World units from the centre to the sprite's edge, at the bucket radius. */
  half: number;
}

let foamKey = 0;
/** Per bucket, the bubble at each turn of its film (film and shell in one sprite). */
let bubbles: Sprite[][] = [];
let blob: Sprite | null = null;
let body: HTMLCanvasElement | null = null;
let bodyG: Ctx | null = null;

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

/** A film turned by `a` radians with the shell over it, in one sprite. */
function turned(film: Sprite, shell: Sprite, a: number): Sprite {
  const S = film.c.width;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.translate(S / 2, S / 2);
  g.rotate(a);
  g.drawImage(film.c, -S / 2, -S / 2);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(shell.c, 0, 0);
  return { c, half: film.half };
}

function roundedRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * The still parts of a soap bubble: an almost clear body (a touch of lilac
 * toward the edge), a faint darker edge low on the right, a thin bright rim, a
 * window reflected up on the left, and a small glint low on the right.
 */
function paintShell(g: Ctx, R: number): void {
  const body = g.createRadialGradient(-R * 0.18, -R * 0.22, R * 0.1, 0, 0, R);
  body.addColorStop(0, 'rgba(255,255,255,0.04)');
  body.addColorStop(0.7, 'rgba(238,234,252,0.06)');
  body.addColorStop(0.9, 'rgba(208,200,240,0.18)');
  body.addColorStop(1, 'rgba(196,188,236,0.32)');
  g.fillStyle = body;
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.fill();
  g.lineCap = 'round';
  // a faint darker edge, low on the right (away from the light)
  g.strokeStyle = 'rgba(88,76,146,0.3)';
  g.lineWidth = Math.max(0.5, R * 0.07);
  g.beginPath();
  g.arc(0, 0, R * 0.95, -0.1 * Math.PI, 0.7 * Math.PI);
  g.stroke();
  // the thin bright rim
  const lw = Math.max(0.45, R * 0.045);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = lw;
  g.beginPath();
  g.arc(0, 0, R - lw / 2, 0, TAU);
  g.stroke();
  // a window, reflected up on the left: a soft glow and four panes
  g.save();
  g.translate(-R * 0.4, -R * 0.4);
  g.rotate(-0.7);
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.32);
  glow.addColorStop(0, 'rgba(255,255,255,0.4)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(-R * 0.34, -R * 0.34, R * 0.68, R * 0.68);
  const pw = R * 0.12;
  const ph = R * 0.105;
  const gap = Math.max(0.3, R * 0.026);
  g.fillStyle = 'rgba(255,255,255,0.93)';
  g.beginPath();
  for (const sx of [-1, 0])
    for (const sy of [-1, 0]) roundedRect(g, sx * (pw + gap) + gap / 2, sy * (ph + gap) + gap / 2, pw, ph, Math.min(pw, ph) * 0.3);
  g.fill();
  g.restore();
  // a small glint low on the right, and a sliver of light bounced back in
  g.fillStyle = 'rgba(255,255,255,0.65)';
  g.beginPath();
  g.arc(R * 0.42, R * 0.46, Math.max(0.35, R * 0.055), 0, TAU);
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

/** Thin-film colour: pastel rainbow bands round the bubble, brighter in two lobes (which swirl). */
function paintFilm(g: Ctx, R: number): void {
  const segs = 48;
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
  bubbles = BUCKETS.map((R, b) => {
    if (b < BAKED) {
      return [
        makeSprite(R, ppu, (g, r) => {
          paintFilm(g, r);
          paintShell(g, r);
        }),
      ];
    }
    const film = makeSprite(R, ppu, paintFilm);
    const shell = makeSprite(R, ppu, paintShell);
    return Array.from({ length: TURNS }, (_, k) => turned(film, shell, (k / TURNS) * TAU));
  });
  blob = makeSprite(32, 1 / BODY_RES, paintBlob);
  // canvases paint lazily: have it all done now, not on the frame the foam first shows
  const one = document.createElement('canvas');
  one.width = one.height = 1;
  const g = one.getContext('2d')!;
  for (const turns of bubbles) for (const sp of turns) g.drawImage(sp.c, 0, 0, 1, 1);
  g.drawImage(blob.c, 0, 0, 1, 1);
}

function bucket(r: number): number {
  for (let b = 0; b < BUCKETS.length; b++) if (BUCKETS[b] >= r) return b;
  return BUCKETS.length - 1;
}

/**
 * Draw the foam: a soft white suds body behind packed bubbles, then each
 * bubble (its film at the turn its swirl has reached, then its shell), squashed
 * as the simulation says. Pass 0 draws the bubbles in the room (before the
 * glass, so foam in a tube is behind it); pass 1 the ones passing in front of
 * the geometry. At the end, `kind` 0 draws only the foam (and its flood), 1 only
 * the bath's bubbles (-1: all). World x maps to device ppu*x + ex (y likewise
 * with ey); `t` (0..1) is how far between the last two physics steps we are.
 */
export function drawSuds(ctx: Ctx, s: Suds, t: number, ppu: number, ex: number, ey: number, camY: number, viewH: number, pass: 0 | 1, kind: -1 | 0 | 1 = -1): void {
  const top = camY - 50;
  const bot = camY + viewH + 50;
  // the flood: solid suds behind the foam filling the screen (soft at its edges)
  let solid0 = Infinity;
  let solid1 = -Infinity;
  if (pass === 1 && s.floodA > 0 && kind !== 1) {
    ctx.setTransform(ppu, 0, 0, ppu, ex, ey);
    ctx.globalAlpha = s.floodA;
    ctx.fillStyle = FLOOD;
    const x0 = -14;
    const x1 = SHAFT_W + 14;
    if (s.mode === 'clear') {
      // clearing: solid from just under its billowing top edge on down, softer at the edge
      const deep = FLOOD_EDGE * 0.6;
      const edge = (dy: number, down: boolean): void => {
        if (down) for (let x = x0; x <= x1; x += 12) ctx.lineTo(x, Math.min(bot, Math.max(top, s.clearLine(x) + dy)));
        else for (let x = x1; x >= x0; x -= 12) ctx.lineTo(x, Math.min(bot, Math.max(top, s.clearLine(x) + dy)));
      };
      if (s.floodTop - 20 < bot) {
        ctx.beginPath();
        edge(deep, true);
        ctx.lineTo(x1, bot);
        ctx.lineTo(x0, bot);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = s.floodA * 0.5;
        ctx.beginPath();
        edge(0, true);
        edge(deep, false);
        ctx.closePath();
        ctx.fill();
        solid0 = Math.max(top, s.solidTop());
        solid1 = bot;
      }
    } else if (s.floodBot + FLOOD_BACK > top) {
      // filling: solid from the top of the screen to just behind the front, following its
      // billows (the bubbles at the front make its edge), and a softer band below that
      const edge = (dy: number): void => {
        for (let x = x1; x >= x0; x -= 12) ctx.lineTo(x, Math.min(bot, Math.max(top, s.line(x) - FLOOD_BACK + dy)));
      };
      ctx.beginPath();
      ctx.moveTo(x0, top);
      ctx.lineTo(x1, top);
      edge(0);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = s.floodA * 0.5;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 12) ctx.lineTo(x, Math.min(bot, Math.max(top, s.line(x) - FLOOD_BACK)));
      edge(24);
      ctx.closePath();
      ctx.fill();
      if (s.floodA >= 1) {
        solid0 = top;
        solid1 = Math.min(bot, s.floodBot);
      }
    }
    ctx.globalAlpha = 1;
  }
  if (!blob || s.n === 0) return;
  const n = s.n;
  const want = pass;
  // (which of them: the bath's, the foam's, or all)
  const tubs = kind === 1 ? 1 : 0;
  const any = kind === -1;
  // (no need for a body behind bubbles well inside the solid flood)
  const inside = (y: number, r: number): boolean => y - r * 2.3 > solid0 && y + r * 2.3 < solid1;
  // the suds body: soft white behind packed bubbles (the bigger ones carry it), laid
  // at low resolution over just the foam's extent, then scaled up in one draw
  let y0 = Infinity;
  let y1 = -Infinity;
  let massTop = Infinity;
  for (let i = 0; i < n; i++) {
    if (s.loose[i]) continue;
    const r = s.r[i];
    const y = s.y[i];
    if (s.alpha[i] > 0.5 && y - r < massTop) massTop = y - r;
    if (s.deep[i] !== want || (!any && s.tub[i] !== tubs) || s.nb[i] < 2 || r < 5 || inside(y, r)) continue;
    if (y - r * 2.3 < y0) y0 = y - r * 2.3;
    if (y + r * 2.3 > y1) y1 = y + r * 2.3;
  }
  // (where the mass stops short of the top of the screen, more suds above it)
  const topFill = pass === 0 && s.mode === 'chase' && massTop < Infinity && massTop > camY + 20 && s.front > camY + 40;
  if (topFill) y0 = camY - 10;
  y0 = Math.max(y0, top);
  y1 = Math.min(y1, bot);
  if (y1 > y0 && blob) {
    const bx0 = -14;
    const bw = Math.ceil((SHAFT_W + 28) / BODY_RES);
    const bh = Math.ceil((y1 - y0) / BODY_RES) + 1;
    if (!body) {
      body = document.createElement('canvas');
      bodyG = body.getContext('2d')!;
    }
    if (body.width !== bw || body.height < bh) {
      body.width = bw;
      body.height = Math.max(bh, body.height);
    }
    const g = bodyG!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(0, 0, bw, bh);
    if (topFill) {
      const gr = g.createLinearGradient(0, (massTop - 30 - y0) / BODY_RES, 0, (massTop + 40 - y0) / BODY_RES);
      gr.addColorStop(0, 'rgba(250,248,255,0.95)');
      gr.addColorStop(1, 'rgba(250,248,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, bw, (massTop + 40 - y0) / BODY_RES);
    }
    const B = blob;
    for (let i = 0; i < n; i++) {
      const nb = s.nb[i];
      const r = s.r[i];
      if (s.deep[i] !== want || (!any && s.tub[i] !== tubs) || s.loose[i] || nb < 2 || r < 5) continue;
      const y = s.py[i] + (s.y[i] - s.py[i]) * t;
      if (y + r * 2.3 < y0 || y - r * 2.3 > y1 || inside(y, r)) continue;
      const x = s.px[i] + (s.x[i] - s.px[i]) * t;
      const k = (r * 2.2) / 32 / BODY_RES;
      g.globalAlpha = s.alpha[i] * Math.min(1, (nb - 1) / 4) * 0.78;
      g.setTransform(k, 0, 0, k, (x - bx0) / BODY_RES, (y - y0) / BODY_RES);
      g.drawImage(B.c, -B.half, -B.half, B.half * 2, B.half * 2);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(ppu * BODY_RES, 0, 0, ppu * BODY_RES, ex + bx0 * ppu, ey + y0 * ppu);
    ctx.drawImage(body, 0, 0, bw, bh, 0, 0, bw, bh);
  }
  for (let i = 0; i < n; i++) {
    if (s.deep[i] !== want || (!any && s.tub[i] !== tubs)) continue;
    const r = s.r[i];
    const y = s.py[i] + (s.y[i] - s.py[i]) * t;
    if (y + r * 1.5 < top || y - r * 1.5 > bot) continue;
    const x = s.px[i] + (s.x[i] - s.px[i]) * t;
    const b = bucket(r);
    const sc = (ppu * r) / BUCKETS[b];
    // squashed (area kept): narrower and taller, or wider and shorter
    const f = 1 - s.q[i];
    ctx.globalAlpha = s.alpha[i];
    ctx.setTransform(sc * f, 0, 0, sc / f, ppu * x + ex, ppu * y + ey);
    // its film at the turn its swirl has reached, with the rim and highlights over it
    const turns = bubbles[b];
    const turn = turns.length > 1 ? (((Math.round((s.ph[i] / TAU) * TURNS) % TURNS) + TURNS) % TURNS) : 0;
    const sp = turns[turn];
    ctx.drawImage(sp.c, -sp.half, -sp.half, sp.half * 2, sp.half * 2);
  }
  ctx.globalAlpha = 1;
}

/**
 * Drops, splashes and the rings of popped bubbles (after the glass, over
 * everything). At the end, `kind` 0 draws only the foam's, 1 only the bath's
 * (-1: all).
 */
export function drawDrops(ctx: Ctx, s: Suds, ppu: number, ex: number, ey: number, kind: -1 | 0 | 1 = -1): void {
  ctx.setTransform(ppu, 0, 0, ppu, ex, ey);
  ctx.globalAlpha = 1;
  const any = kind === -1;
  const tubs = kind === 1 ? 1 : 0;
  // (drops and splats at the end are all the bath's)
  if (kind === 0) {
    drawRingsAndSpray(ctx, s, any, tubs);
    return;
  }
  if (s.dn > 0) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(112,164,224,0.9)';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    for (let k = 0; k < s.dn; k++) {
      const x = s.dx[k];
      const y = s.dy[k];
      const len = Math.min(0.022, 11 / Math.max(1, Math.abs(s.dvy[k])));
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
  // splats spreading where drops hit
  ctx.lineWidth = 1.1;
  for (let k = 0; k < s.kn; k++) {
    const u = s.ka[k] / 0.22;
    ctx.strokeStyle = `rgba(140,190,240,${0.85 * (1 - u)})`;
    ctx.beginPath();
    ctx.ellipse(s.kx[k], s.ky[k], s.ks[k] * (0.8 + u * 2), s.ks[k] * (0.3 + u * 0.5), s.kang[k], 0, TAU);
    ctx.stroke();
  }
  drawRingsAndSpray(ctx, s, any, tubs);
}

function drawRingsAndSpray(ctx: Ctx, s: Suds, any: boolean, tubs: number): void {
  if (s.sn > 0) {
    ctx.fillStyle = 'rgba(150,196,240,0.92)';
    ctx.beginPath();
    for (let k = 0; k < s.sn; k++) {
      if (!any && s.stub[k] !== tubs) continue;
      const rr = s.ss[k] * (1 - (s.sa[k] / s.sl[k]) * 0.6);
      ctx.moveTo(s.sx[k] + rr, s.sy[k]);
      ctx.arc(s.sx[k], s.sy[k], rr, 0, TAU);
    }
    ctx.fill();
  }
  // popped bubbles: a quick flash, and the film snapping back as a ring
  for (let k = 0; k < s.rn; k++) {
    if (!any && s.rtub[k] !== tubs) continue;
    const u = s.ra[k] / 0.2;
    const x = s.rx[k];
    const y = s.ry[k];
    const R = s.rr[k] * (0.85 + u * 0.75);
    if (u < 0.35) {
      ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - u / 0.35)})`;
      ctx.beginPath();
      ctx.arc(x, y, s.rr[k] * 0.8, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = `rgba(150,130,210,${0.45 * (1 - u)})`;
    ctx.lineWidth = Math.max(0.6, 2.4 * (1 - u));
    ctx.beginPath();
    ctx.arc(x, y, R + 0.8, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.95 * (1 - u)})`;
    ctx.lineWidth = Math.max(0.5, 1.8 * (1 - u));
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.stroke();
  }
}
