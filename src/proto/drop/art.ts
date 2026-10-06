// Cat Drop: painting the house. Each storey is painted once into a cached
// canvas (its room from roomArt.ts, wall decor, the boards, pillows, glass
// backs and the floor slab with its hatch), the glass fronts that go over the
// cat into small canvases of their own, and the few moving things (cushions,
// fish) are stamped from cached sprites. Same light as the game: one warm key
// light from the upper left, gouache textures, never a black line.

import { FLOOR_Y } from '../../game/props';
import type { DecorPlacement } from '../../game/room';
import { PALETTE, contactShadow, glint, hash01, lightOf, lineOf, mix, paperGrain, rgba, roundRect, shadowOf, softShadow, specular, type Box, type Ctx } from '../../render/paint';
import { glassSolid, ribbonPath, rimLip, sparkle, type GlassPart } from '../../render/propKit';
import { THEMES, drawDecor, drawShell } from '../../render/roomArt';
import { bakedFill, castShadow, cylinderShade, inkLine, knob, paintTex, roundShade } from '../../render/roomKit';
import { CUSHION_GIVE } from './game';
import { SHAFT_W, SLAB, SLAB_BAND, type Art, type Chunk, type Cushion, type Storey } from './level';

/** Width of the dollhouse's cut side walls, either side of the shaft. */
export const SIDE = 8;
const WOOD = PALETTE.oak;
const WALNUT = '#A9805F';
const BRASS = '#CDA86C';
const CUT = '#E9DCCB';
const CUT_LINE = '#B9A58E';

// ---------------------------------------------------------------------------
// Storeys

/**
 * Paint the room behind a storey: walls, wainscot and floor ('shell'), then
 * its wall decor and the cornice under the slab above ('decor').
 */
export function paintRoom(ctx: Ctx, s: Storey, part: 'shell' | 'decor'): void {
  const theme = THEMES[s.theme];
  const dy = s.floor - FLOOR_Y;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-SIDE - 2, s.top, SHAFT_W + SIDE * 2 + 4, s.bottom - s.top);
  ctx.clip();
  ctx.translate(0, dy);
  if (part === 'shell') drawShell(ctx, theme, -SIDE, s.top - dy, SHAFT_W + SIDE, s.bottom - dy + 1, s.seed);
  else for (const d of s.decor) drawDecor(ctx, d as DecorPlacement, theme, s.seed + d.x);
  ctx.restore();
  if (part === 'shell') return;
  // a soft shade under the slab above (the ceiling)
  const g = ctx.createLinearGradient(0, s.top, 0, s.top + 46);
  g.addColorStop(0, rgba(shadowOf(theme.wall, 0.7), 0.4));
  g.addColorStop(1, rgba(shadowOf(theme.wall, 0.7), 0));
  ctx.fillStyle = g;
  ctx.fillRect(-SIDE, s.top, SHAFT_W + SIDE * 2, 46);
  if (s.index > 0) cornice(ctx, theme.trim, s.top);
}

/** The crown moulding where a room's wall meets the ceiling (the slab above). */
function cornice(ctx: Ctx, trim: string, y: number): void {
  const w = SHAFT_W + SIDE * 2;
  const x = -SIDE;
  castShadow(
    ctx,
    () => {
      ctx.beginPath();
      ctx.rect(x, y, w, 9);
    },
    0,
    3,
    4,
    0.22,
  );
  ctx.fillStyle = trim;
  ctx.fillRect(x, y, w, 9);
  const g = ctx.createLinearGradient(0, y, 0, y + 9);
  g.addColorStop(0, rgba(shadowOf(trim, 0.4), 0.45));
  g.addColorStop(0.3, rgba(lightOf(trim, 1), 0.9));
  g.addColorStop(0.55, rgba(shadowOf(trim, 0.3), 0.3));
  g.addColorStop(0.75, rgba(lightOf(trim, 0.8), 0.6));
  g.addColorStop(1, rgba(shadowOf(trim, 0.55), 0.55));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, 9);
  ctx.fillStyle = rgba(lineOf(trim), 0.45);
  ctx.fillRect(x, y + 8.4, w, 0.7);
}

/** The dollhouse's cut side walls running down the shaft, over everything in the room. */
export function paintFrame(ctx: Ctx, y0: number, y1: number): void {
  const h = y1 - y0;
  ctx.save();
  for (const [x, dir] of [
    [0, 1],
    [SHAFT_W, -1],
  ] as const) {
    const g = ctx.createLinearGradient(x, 0, x + dir * 16, 0);
    g.addColorStop(0, 'rgba(62,58,79,0.16)');
    g.addColorStop(1, 'rgba(62,58,79,0)');
    ctx.fillStyle = g;
    ctx.fillRect(dir > 0 ? x : x - 16, y0, 16, h);
  }
  ctx.fillStyle = CUT;
  ctx.fillRect(-SIDE, y0, SIDE, h);
  ctx.fillRect(SHAFT_W, y0, SIDE, h);
  ctx.fillStyle = CUT_LINE;
  ctx.fillRect(-SIDE, y0, 1.6, h);
  ctx.fillRect(SHAFT_W + SIDE - 1.6, y0, 1.6, h);
  ctx.fillStyle = rgba(lightOf(CUT, 1), 0.8);
  ctx.fillRect(-1.6, y0, 1, h);
  ctx.fillRect(SHAFT_W + 0.6, y0, 1, h);
  ctx.restore();
}

let grainTile: HTMLCanvasElement | null = null;

/**
 * Paper grain over a painted storey (as the game multiplies over its room
 * layer), baked once into translucent paint so it goes on with a plain
 * source-over fill: a full-storey multiply is slow on software canvases.
 */
export function paintGrain(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, cssPerUnit: number): void {
  if (!grainTile) {
    const src = paperGrain();
    const d = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d')!;
    const img = g.createImageData(c.width, c.height);
    // multiply by v/255 at 20% == laying (1 - v/255) * 20% of a deep warm grey
    for (let i = 0; i < d.length; i += 4) {
      img.data[i] = 92;
      img.data[i + 1] = 76;
      img.data[i + 2] = 84;
      img.data[i + 3] = Math.round((255 - d[i]) * 0.2 * 1.6);
    }
    g.putImageData(img, 0, 0);
    grainTile = c;
  }
  const k = 1 / cssPerUnit;
  bakedFill(
    ctx,
    () => {
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
    },
    grainTile,
    k,
    k,
    0,
    0,
  );
}

// ---------------------------------------------------------------------------
// Chunk art (the cached back layer)

export function paintChunkBack(ctx: Ctx, c: Chunk, s: Storey): void {
  const theme = THEMES[s.theme];
  for (const a of c.art) {
    ctx.save();
    switch (a.k) {
      case 'shelf':
        shelfArt(ctx, a, c.id);
        break;
      case 'ramp':
        rampArt(ctx, a, c.id);
        break;
      case 'beam':
        board(ctx, a.ax, a.ay, a.bx, a.by, 6, WALNUT, c.id);
        break;
      case 'pillow':
        break;
      case 'slab':
        slabArt(ctx, a, theme.floor, theme.wall, c.id);
        break;
      case 'roof':
        roofArt(ctx, a.y, s.top);
        break;
      case 'perch':
        perchArt(ctx, a, c.id);
        break;
      case 'funnel':
        funnelBack(ctx, a);
        break;
      case 'tube':
        tubeBack(ctx, a);
        break;
      case 'slide':
        slideBack(ctx, a);
        break;
    }
    ctx.restore();
  }
  // pillows hang from a line strung across the shaft
  const pillows = c.art.filter((a): a is Extract<Art, { k: 'pillow' }> => a.k === 'pillow');
  if (pillows.length) {
    const rows = [...new Set(pillows.map((p) => p.y))];
    for (const y of rows) clothesline(ctx, y - 5, pillows.filter((p) => p.y === y), c.id);
  }
  for (const k of c.cushions) cushionSupport(ctx, k, s.top);
}

/** Does this chunk paint anything over the cat? */
export function hasFront(c: Chunk): boolean {
  return c.art.some((a) => a.k === 'funnel' || a.k === 'tube' || a.k === 'slide');
}

/** World rect of a chunk's front (glass) art. */
export function frontRect(c: Chunk): Box {
  const b = { x0: -SIDE, y0: Infinity, x1: SHAFT_W + SIDE, y1: -Infinity };
  for (const a of c.art) {
    if (a.k === 'funnel') {
      b.y0 = Math.min(b.y0, Math.min(a.ly, a.ry) - 40);
      b.y1 = Math.max(b.y1, a.mouth + 10);
    } else if (a.k === 'tube') {
      b.y0 = Math.min(b.y0, a.y0 - 20);
      b.y1 = Math.max(b.y1, a.y1 + 16);
    } else if (a.k === 'slide') {
      for (const [, y] of a.path) {
        b.y0 = Math.min(b.y0, y - a.hw - 12);
        b.y1 = Math.max(b.y1, y + a.hw + 12);
      }
    }
  }
  return b;
}

export function paintChunkFront(ctx: Ctx, c: Chunk): void {
  // the glass of a funnel and its tube is one piece: draw their walls as one union
  for (const a of c.art) {
    if (a.k !== 'funnel') continue;
    const tube = c.art.find((t): t is Extract<Art, { k: 'tube' }> => t.k === 'tube' && Math.abs(t.cx - a.cx) < 1);
    ctx.save();
    funnelFront(ctx, a, tube ?? null);
    ctx.restore();
  }
  for (const a of c.art) {
    if (a.k !== 'slide') continue;
    ctx.save();
    slideFront(ctx, a);
    ctx.restore();
  }
}

// --- Wood --------------------------------------------------------------------------

/** Painted wood: grain, a sunlit top face, a crisp arris, deeper underside (as furnitureArt's planks). */
function plank(ctx: Ctx, x: number, y: number, w: number, h: number, base: string, seed: number, r = Math.min(3.5, h / 3), top = Math.min(3.4, h * 0.3)): void {
  const path = (): void => roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = base;
  path();
  ctx.fill();
  paintTex(ctx, path, 'wood', 0.55, 0.42, Math.min(0.3, 0.1 + h * 0.012), x - hash01(seed, 11) * 160, y - hash01(seed, 12) * 160);
  const g = ctx.createLinearGradient(0, y + top, 0, y + h);
  g.addColorStop(0, rgba(lightOf(base, 0.4), 0.18));
  g.addColorStop(0.55, rgba(base, 0));
  g.addColorStop(1, rgba(shadowOf(base, 0.65), 0.55));
  ctx.fillStyle = g;
  path();
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(base, 0.55), 0.7);
  roundRect(ctx, x, y, w, top + r * 0.3, [r, r, 0, 0]);
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(base, 0.9), 0.75);
  ctx.fillRect(x + r * 0.5, y + top - 0.45, w - r, 0.9);
  ctx.fillStyle = rgba(lightOf(base, 0.6), 0.3);
  ctx.fillRect(x + 0.6, y + top + 0.5, 1.4, h - top - 1.5);
  ctx.fillStyle = rgba(shadowOf(base, 0.6), 0.35);
  ctx.fillRect(x + w - 2.2, y + top + 0.5, 1.6, h - top - 1.2);
  inkLine(ctx, path, base, 1.1, 0.72);
}

/** A board along a capsule's centre line (the capsule's radius is half its thickness). */
function board(ctx: Ctx, ax: number, ay: number, bx: number, by: number, r: number, base: string, seed: number, shadow = true): void {
  const len = Math.hypot(bx - ax, by - ay);
  const a = Math.atan2(by - ay, bx - ax);
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  if (shadow)
    castShadow(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(ax - nx * r, ay - ny * r);
        ctx.lineTo(bx - nx * r, by - ny * r);
        ctx.lineTo(bx + nx * r, by + ny * r);
        ctx.lineTo(ax + nx * r, ay + ny * r);
        ctx.closePath();
      },
      3,
      7,
      5,
      0.28,
    );
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(a);
  plank(ctx, -r, -r, len + r * 2, r * 2, base, seed, Math.min(3.5, r * 0.6), Math.min(3.4, r * 0.6));
  ctx.restore();
}

/** A wall bracket (corbel) under a board. */
function corbel(ctx: Ctx, bx: number, y: number, flip: number, seed: number): void {
  const bc = shadowOf(WOOD, 0.22);
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(bx - 3 * flip, y);
    ctx.lineTo(bx + 9 * flip, y);
    ctx.bezierCurveTo(bx + 8 * flip, y + 6, bx + 1 * flip, y + 8, bx + 0.5 * flip, y + 16);
    ctx.bezierCurveTo(bx + 0.5 * flip, y + 19, bx - 3 * flip, y + 19.5, bx - 3 * flip, y + 17);
    ctx.closePath();
  };
  ctx.fillStyle = bc;
  path();
  ctx.fill();
  paintTex(ctx, path, 'wood', 0.45, 0.3, 0.3, bx, y);
  ctx.fillStyle = rgba(lightOf(bc, 0.6), 0.55);
  ctx.fillRect(flip > 0 ? bx - 2.6 : bx + 1.3, y + 1, 1.3, 14);
  inkLine(ctx, path, bc, 1, 0.7);
  knob(ctx, bx - 0.8 * flip, y + 11, 0.9, '#A99582');
  void seed;
}

function shelfArt(ctx: Ctx, a: Extract<Art, { k: 'shelf' }>, seed: number): void {
  // brackets near the wall end (under the board, which slopes a little)
  const len = Math.abs(a.bx - a.ax);
  const yAt = (x: number): number => a.ay + ((x - a.ax) / (a.bx - a.ax)) * (a.by - a.ay);
  const xs = [a.wall < 0 ? 18 : SHAFT_W - 18];
  if (len > 210) xs.push(a.wall < 0 ? a.bx - 40 : a.bx + 40);
  for (const x of xs) corbel(ctx, x, yAt(x) + 5, a.wall < 0 ? 1 : -1, seed);
  board(ctx, a.ax, a.ay, a.bx, a.by, 6, WOOD, seed);
  // a small something on longer shelves: a plant pot or books
  if (len > 150) {
    const x = a.wall < 0 ? 40 + hash01(seed, 5) * 30 : SHAFT_W - 40 - hash01(seed, 5) * 30;
    if (hash01(seed, 6) > 0.5) shelfBooks(ctx, x, yAt(x) - 6, seed);
    else shelfPot(ctx, x, yAt(x) - 6, seed);
  }
}

function shelfBooks(ctx: Ctx, x: number, y: number, seed: number): void {
  const cols = ['#8FA9C8', '#D99A92', '#E8CB86', '#9DB894', '#B8A6CC', '#D6A27E'];
  let bx = x - 12;
  for (let i = 0; i < 4; i++) {
    const bw = 4.5 + hash01(seed, 20 + i) * 3;
    const bh = 14 + hash01(seed, 30 + i) * 8;
    const c = cols[Math.floor(hash01(seed, 40 + i) * cols.length)];
    const p = (): void => roundRect(ctx, bx, y - bh, bw, bh, 0.8);
    ctx.fillStyle = c;
    p();
    ctx.fill();
    cylinderShade(ctx, p, bx, bx + bw, c, 0.5, 0.5);
    ctx.fillStyle = rgba(mix(PALETTE.butter, '#FFF6E0', 0.3), 0.8);
    ctx.fillRect(bx + 0.6, y - bh + 2.2, bw - 1.2, 0.7);
    inkLine(ctx, p, c, 0.7, 0.6);
    bx += bw + 0.4;
  }
}

function shelfPot(ctx: Ctx, x: number, y: number, seed: number): void {
  const pot = PALETTE.terracotta;
  contactShadow(ctx, x, y, 8, 0.3, 0.5);
  // a little round succulent
  const green = hash01(seed, 9) > 0.5 ? '#8DB283' : '#9DBF8E';
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k - 2) * 0.55;
    ctx.fillStyle = k % 2 ? green : shadowOf(green, 0.2);
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * 5, y - 13 + Math.sin(a) * 5, 3.2, 6, a + Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const p = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 12);
    ctx.lineTo(x + 8, y - 12);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x - 6, y);
    ctx.closePath();
  };
  ctx.fillStyle = pot;
  p();
  ctx.fill();
  cylinderShade(ctx, p, x - 8, x + 8, pot, 0.5, 0.5);
  ctx.fillStyle = lightOf(pot, 0.3);
  roundRect(ctx, x - 9, y - 14, 18, 3.4, 1.2);
  ctx.fill();
  inkLine(ctx, p, pot, 0.8, 0.6);
}

function rampArt(ctx: Ctx, a: Extract<Art, { k: 'ramp' }>, seed: number): void {
  // a slide: a long sloping board on two wall brackets, bolted to the wall
  const dir = a.ax < SHAFT_W / 2 ? 1 : -1;
  const yAt = (x: number): number => a.ay + ((x - a.ax) / (a.bx - a.ax)) * (a.by - a.ay);
  for (const x of [dir > 0 ? 18 : SHAFT_W - 18, dir > 0 ? 46 : SHAFT_W - 46]) corbel(ctx, x, yAt(x) + 5, dir, seed);
  board(ctx, a.ax, a.ay, a.bx, a.by, 6, mix(WOOD, '#D8B48A', 0.25), seed);
  // a rounded nose at the low end, where cats slide off
  knob(ctx, a.bx - dir * 4, a.by - 1.5, 1, '#A99582');
}

function perchArt(ctx: Ctx, a: Extract<Art, { k: 'perch' }>, seed: number): void {
  corbel(ctx, 18, a.y + 5, 1, seed);
  corbel(ctx, a.x1 - 30, a.y + 5, 1, seed);
  board(ctx, a.x0, a.y, a.x1, a.y, 6, WALNUT, seed);
  // a folded knitted blanket on it
  const x0 = 40;
  const x1 = a.x1 - 4;
  const y = a.y - 6;
  const p = (): void => roundRect(ctx, x0, y - 7, x1 - x0, 8, [4, 4, 1.5, 1.5]);
  ctx.fillStyle = '#E9A6A0';
  p();
  ctx.fill();
  ctx.save();
  p();
  ctx.clip();
  ctx.fillStyle = '#F7E6CC';
  for (let x = x0 + 4; x < x1; x += 10) ctx.fillRect(x, y - 7, 3, 8);
  ctx.restore();
  paintTex(ctx, p, 'weave', 0.35, 0.3);
  inkLine(ctx, p, '#E9A6A0', 0.8, 0.55);
}

// --- The attic roof ---------------------------------------------------------------

function roofArt(ctx: Ctx, y: number, top: number): void {
  // the underside of the roof: two slopes meeting high in the middle,
  // dark rafters, and the night sky through a little round window
  const peakY = y - 40;
  const eaveY = y + 160;
  const slope = (): void => {
    ctx.beginPath();
    ctx.moveTo(-SIDE, top - 2);
    ctx.lineTo(SHAFT_W + SIDE, top - 2);
    ctx.lineTo(SHAFT_W + SIDE, eaveY);
    ctx.lineTo(SHAFT_W / 2, peakY);
    ctx.lineTo(-SIDE, eaveY);
    ctx.closePath();
  };
  const sky = ctx.createLinearGradient(0, top, 0, eaveY);
  sky.addColorStop(0, '#2E2A4A');
  sky.addColorStop(1, '#4A4468');
  ctx.fillStyle = sky;
  slope();
  ctx.fill();
  // stars and a moon outside
  for (let k = 0; k < 40; k++) {
    const sx = hash01(k, 3) * SHAFT_W;
    const sy = top + hash01(k, 4) * (eaveY - top);
    const dy = Math.abs(sx - SHAFT_W / 2) * ((eaveY - peakY) / (SHAFT_W / 2)) + peakY;
    if (sy > dy - 30) continue;
    ctx.fillStyle = `rgba(255,246,214,${0.4 + hash01(k, 5) * 0.5})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 0.6 + hash01(k, 6) * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  const mx = 300;
  const my = top + 40;
  const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 40);
  mg.addColorStop(0, 'rgba(255,240,200,0.4)');
  mg.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = mg;
  ctx.fillRect(mx - 40, my - 40, 80, 80);
  ctx.fillStyle = '#FFF1CF';
  ctx.beginPath();
  ctx.arc(mx, my, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2E2A4A';
  ctx.beginPath();
  ctx.arc(mx + 5, my - 3, 9.5, 0, Math.PI * 2);
  ctx.fill();
  // the roof in section: shingles over boards over a rafter
  for (const side of [-1, 1]) {
    const ex = side < 0 ? -SIDE - 6 : SHAFT_W + SIDE + 6;
    const len = Math.hypot(SHAFT_W / 2 - ex, eaveY - peakY);
    const a = Math.atan2(peakY - eaveY, SHAFT_W / 2 - ex);
    ctx.save();
    ctx.translate(ex, eaveY + 6);
    ctx.rotate(a);
    // shingles (outside, above), sarking, rafter (inside, below)
    const sh = '#B86B5B';
    for (let i = 0; i * 13 < len + 13; i++) {
      ctx.fillStyle = i % 2 ? sh : shadowOf(sh, 0.12);
      roundRect(ctx, i * 13 - 2, -22 - (i % 3) * 0.6, 15, 9, [1, 1, 4, 4]);
      ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.translate(ex, eaveY);
    ctx.rotate(a);
    plank(ctx, -4, -14, len + 8, 9, shadowOf(WALNUT, 0.1), 77 + side, 2, 2);
    plank(ctx, -4, -5, len + 8, 13, WALNUT, 99 + side, 3, 3.4);
    ctx.restore();
  }
  // rafters' shadow on the attic wall
  const g = ctx.createLinearGradient(0, peakY, 0, eaveY + 50);
  g.addColorStop(0, 'rgba(62,58,79,0.2)');
  g.addColorStop(1, 'rgba(62,58,79,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-SIDE, eaveY + 4);
  ctx.lineTo(SHAFT_W / 2, peakY + 4);
  ctx.lineTo(SHAFT_W + SIDE, eaveY + 4);
  ctx.lineTo(SHAFT_W + SIDE, eaveY + 50);
  ctx.lineTo(-SIDE, eaveY + 50);
  ctx.closePath();
  ctx.fill();
  // a round window in the gable, warm from the attic lamp's side
  const wx = 190;
  const wy = y + 70;
  ctx.fillStyle = '#2E2A4A';
  ctx.beginPath();
  ctx.arc(wx, wy, 22, 0, Math.PI * 2);
  ctx.fill();
  for (let k = 0; k < 6; k++) {
    ctx.fillStyle = `rgba(255,246,214,${0.5 + hash01(k, 9) * 0.4})`;
    ctx.beginPath();
    ctx.arc(wx - 12 + hash01(k, 7) * 24, wy - 12 + hash01(k, 8) * 24, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#F7EEE2';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(wx, wy, 23, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(wx - 22, wy);
  ctx.lineTo(wx + 22, wy);
  ctx.moveTo(wx, wy - 22);
  ctx.lineTo(wx, wy + 22);
  ctx.stroke();
  ctx.strokeStyle = rgba(lineOf('#F7EEE2'), 0.5);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(wx, wy, 25, 0, Math.PI * 2);
  ctx.stroke();
}

// --- Floor slabs and hatches ----------------------------------------------------

function slabArt(ctx: Ctx, a: Extract<Art, { k: 'slab' }>, floor: string, wall: string, seed: number): void {
  const y = a.y;
  const band = SLAB_BAND;
  const x0 = -SIDE;
  const x1 = SHAFT_W + SIDE;
  // the cut through the floor: floorboards' end grain, a joist, the plaster ceiling below
  const cy = y + band;
  const ch = SLAB - band;
  ctx.fillStyle = CUT;
  ctx.fillRect(x0, cy, x1 - x0, ch);
  ctx.fillStyle = mix(floor, CUT, 0.35);
  ctx.fillRect(x0, cy, x1 - x0, 6);
  ctx.fillStyle = rgba(shadowOf(floor, 0.5), 0.55);
  ctx.fillRect(x0, cy + 6, x1 - x0, 1);
  // joist ends
  for (let x = 14 + hash01(seed, 1) * 20; x < x1; x += 46) {
    ctx.fillStyle = mix(WOOD, CUT, 0.25);
    ctx.fillRect(x, cy + 8, 9, ch - 14);
    ctx.fillStyle = rgba(shadowOf(WOOD, 0.4), 0.5);
    ctx.fillRect(x + 7.6, cy + 8, 1.4, ch - 14);
  }
  ctx.fillStyle = rgba(lightOf(CUT, 1), 0.85);
  ctx.fillRect(x0, cy + ch - 5, x1 - x0, 1.2);
  ctx.fillStyle = CUT_LINE;
  ctx.fillRect(x0, cy, x1 - x0, 0.9);
  ctx.fillRect(x0, y + SLAB - 1, x1 - x0, 1);
  // the hatches: openings right through the floor, their cut edges catching the light
  for (const [h0, h1] of a.holes) {
    const g = ctx.createLinearGradient(0, y - 2, 0, y + SLAB);
    g.addColorStop(0, '#433D57');
    g.addColorStop(0.45, '#5A536F');
    g.addColorStop(1, mix('#5A536F', wall, 0.45));
    ctx.fillStyle = g;
    ctx.fillRect(h0, y, h1 - h0, SLAB);
    // light falling in from the room above, onto the far side
    const lg = ctx.createLinearGradient(h0, 0, h1, 0);
    lg.addColorStop(0, 'rgba(255,240,214,0)');
    lg.addColorStop(0.7, 'rgba(255,240,214,0.06)');
    lg.addColorStop(1, 'rgba(255,240,214,0.2)');
    ctx.fillStyle = lg;
    ctx.fillRect(h0, y, h1 - h0, SLAB);
    // the cut ends of the floor: shaded on the left wall of the hole, lit on the right
    holeEdge(ctx, h0, y, -1, floor);
    holeEdge(ctx, h1, y, 1, floor);
  }
}

/** The end of a cut floor at a hatch: boards' end grain, the joist, the plaster. */
function holeEdge(ctx: Ctx, x: number, y: number, side: -1 | 1, floor: string): void {
  // side -1: the hole's left edge (the floor ends to the left of x), lit by the room light
  const w = 4;
  const x0 = side < 0 ? x - w : x;
  const lit = side > 0;
  ctx.fillStyle = lit ? mix(floor, '#FFF4DE', 0.35) : shadowOf(floor, 0.35);
  ctx.fillRect(x0, y, w, SLAB_BAND + 6);
  ctx.fillStyle = lit ? lightOf(CUT, 0.6) : shadowOf(CUT, 0.25);
  ctx.fillRect(x0, y + SLAB_BAND + 6, w, SLAB - SLAB_BAND - 6);
  ctx.fillStyle = rgba(lineOf(floor), 0.6);
  ctx.fillRect(side < 0 ? x0 : x0 + w - 0.8, y, 0.8, SLAB);
  // a soft shade cast into the hole under the lip
  const sg = ctx.createLinearGradient(0, y, 0, y + 14);
  sg.addColorStop(0, 'rgba(40,34,56,0.45)');
  sg.addColorStop(1, 'rgba(40,34,56,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(side < 0 ? x : x - 18, y, 18, 14);
}

// --- Pillows on a line ------------------------------------------------------------

function clothesline(ctx: Ctx, y: number, ps: Extract<Art, { k: 'pillow' }>[], seed: number): void {
  // the line, sagging a touch between pegs
  ctx.strokeStyle = '#D8C7A8';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-SIDE, y - 2);
  ctx.quadraticCurveTo(SHAFT_W / 2, y + 6, SHAFT_W + SIDE, y - 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,250,236,0.6)';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  for (const p of ps) pillowArt(ctx, p);
  // pegs on each pillow
  for (const p of ps) {
    for (const f of [0.25, 0.75]) {
      const px = p.x + p.w * f;
      if (px < 6 || px > SHAFT_W - 6) continue;
      const sag = y - 2 + 8 * (1 - ((px - SHAFT_W / 2) / (SHAFT_W / 2 + SIDE)) ** 2);
      const peg = (): void => roundRect(ctx, px - 2.2, sag - 6, 4.4, 13, 1.6);
      const c = hash01(seed, Math.round(px)) > 0.5 ? '#E8D3B0' : '#CFE0D4';
      ctx.fillStyle = c;
      peg();
      ctx.fill();
      ctx.fillStyle = rgba(lightOf(c, 0.8), 0.8);
      ctx.fillRect(px - 1.6, sag - 5, 1, 11);
      inkLine(ctx, peg, c, 0.7, 0.6);
      knob(ctx, px, sag + 1, 0.9, '#B9B3BC');
    }
  }
}

function pillowPath(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  // plump: the sides bow out, the corners pinch a little
  const b = 3.5;
  ctx.beginPath();
  ctx.moveTo(x + 6, y + 2);
  ctx.quadraticCurveTo(x + w / 2, y - b, x + w - 6, y + 2);
  ctx.quadraticCurveTo(x + w + 2, y + 1, x + w - 1, y + 8);
  ctx.quadraticCurveTo(x + w + b, y + h / 2, x + w - 1, y + h - 8);
  ctx.quadraticCurveTo(x + w + 2, y + h - 1, x + w - 6, y + h - 2);
  ctx.quadraticCurveTo(x + w / 2, y + h + b, x + 6, y + h - 2);
  ctx.quadraticCurveTo(x - 2, y + h - 1, x + 1, y + h - 8);
  ctx.quadraticCurveTo(x - b, y + h / 2, x + 1, y + 8);
  ctx.quadraticCurveTo(x - 2, y + 1, x + 6, y + 2);
  ctx.closePath();
}

function pillowArt(ctx: Ctx, p: Extract<Art, { k: 'pillow' }>): void {
  const { x, y, w, h, color, seed } = p;
  const path = (): void => pillowPath(ctx, x, y, w, h);
  const box: Box = { x0: x, y0: y, x1: x + w, y1: y + h };
  softShadow(ctx, x + w / 2 + 6, y + h + 6, w * 0.5, 7, 0.16);
  ctx.fillStyle = color;
  path();
  ctx.fill();
  paintTex(ctx, path, 'weave', 0.28, 0.35, 0.35, x + hash01(seed, 1) * 40, y);
  roundShade(ctx, path, box, color, 0.45, 0.4);
  // a pattern: stripes or dots
  const kind = Math.floor(hash01(seed, 2) * 3);
  ctx.save();
  path();
  ctx.clip();
  if (kind === 0) {
    ctx.fillStyle = rgba(lightOf(color, 0.8), 0.45);
    for (let sx = x + 8; sx < x + w; sx += 14) ctx.fillRect(sx, y - 4, 4, h + 8);
  } else if (kind === 1) {
    ctx.fillStyle = rgba(lightOf(color, 0.85), 0.55);
    for (let sy = y + 7; sy < y + h; sy += 10)
      for (let sx = x + 7 + ((sy - y) % 20 ? 5 : 0); sx < x + w; sx += 10) {
        ctx.beginPath();
        ctx.arc(sx, sy, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  ctx.restore();
  // the tuft: a button with creases
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.strokeStyle = rgba(shadowOf(color, 0.6), 0.4);
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [dx, dy] of [
    [-11, -6],
    [11, -6],
    [-11, 6],
    [11, 6],
  ]) {
    ctx.moveTo(cx + dx * 0.25, cy + dy * 0.25);
    ctx.quadraticCurveTo(cx + dx * 0.6, cy + dy * 0.4, cx + dx, cy + dy);
  }
  ctx.stroke();
  knob(ctx, cx, cy, 1.9, shadowOf(color, 0.15));
  // piping round the edge, lit on the upper left
  ctx.strokeStyle = rgba(lightOf(color, 0.7), 0.7);
  ctx.lineWidth = 1.4;
  path();
  ctx.stroke();
  inkLine(ctx, path, color, 1, 0.6);
  specular(ctx, x + w * 0.28, y + h * 0.25, w * 0.25, 1.4, -0.12, 0.35);
}

// --- Cushions (painted live from a cached sprite; their supports are cached) ---

function cushionSupport(ctx: Ctx, k: Cushion, ceiling: number): void {
  const atWall = k.x <= 0 || k.x + k.w >= SHAFT_W;
  const y = k.y + k.h - 2;
  if (atWall) {
    const left = k.x <= 0;
    const x0 = left ? -10 : k.x - 2;
    const x1 = left ? k.x + k.w + 2 : SHAFT_W + 10;
    corbel(ctx, left ? 18 : SHAFT_W - 18, y + 9, left ? 1 : -1, k.seed);
    board(ctx, x0, y + 4, x1, y + 4, 4.5, WOOD, k.seed);
  } else {
    // a little hanging board, on two ropes from hooks in the ceiling
    for (const rx of [k.x + 10, k.x + k.w - 10]) {
      const tx = rx + (rx < k.x + k.w / 2 ? 10 : -10);
      ctx.strokeStyle = '#C9B48F';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rx, y + 2);
      ctx.lineTo(tx, ceiling + 6);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,248,230,0.5)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      knob(ctx, tx, ceiling + 5, 2, BRASS);
    }
    board(ctx, k.x - 4, y + 4, k.x + k.w + 4, y + 4, 4.5, WALNUT, k.seed, true);
  }
}

const cushionCache = new Map<string, HTMLCanvasElement>();

/** A plump tufted cushion: a cached sprite, squashed as it bounces. */
export function drawCushion(ctx: Ctx, k: Cushion, ppu: number): void {
  const pad = 6;
  const key = `${k.w.toFixed(1)}|${k.h}|${k.color}|${k.seed}|${ppu.toFixed(3)}`;
  let c = cushionCache.get(key);
  if (!c) {
    if (cushionCache.size > 40) cushionCache.clear();
    c = document.createElement('canvas');
    c.width = Math.ceil((k.w + pad * 2) * ppu);
    c.height = Math.ceil((k.h + pad * 2 + 6) * ppu);
    const g = c.getContext('2d')!;
    g.setTransform(ppu, 0, 0, ppu, pad * ppu, pad * ppu);
    paintCushion(g, k.w, k.h + 4, k.color, k.seed);
  }
  cushionCache.set(key, c);
  const s = Math.max(-0.3, Math.min(0.45, k.squash));
  const sy = 1 - (s * CUSHION_GIVE * k.h) / (k.h + 4);
  const sx = 1 + s * 0.24;
  const bottom = k.y + k.h + 2;
  ctx.save();
  ctx.translate(k.x + k.w / 2, bottom);
  ctx.scale(sx, sy);
  ctx.drawImage(c, -k.w / 2 - pad, -(k.h + 4) - pad - 2, c.width / ppu, c.height / ppu);
  ctx.restore();
}

function paintCushion(ctx: Ctx, w: number, h: number, color: string, seed: number): void {
  const path = (): void => {
    const b = 5;
    ctx.beginPath();
    ctx.moveTo(8, 3);
    ctx.quadraticCurveTo(w / 2, -b, w - 8, 3);
    ctx.quadraticCurveTo(w + 1, 3, w, 12);
    ctx.quadraticCurveTo(w + 3, h * 0.6, w - 3, h - 2);
    ctx.quadraticCurveTo(w / 2, h + 2, 3, h - 2);
    ctx.quadraticCurveTo(-3, h * 0.6, 0, 12);
    ctx.quadraticCurveTo(-1, 3, 8, 3);
    ctx.closePath();
  };
  const box: Box = { x0: 0, y0: 0, x1: w, y1: h };
  ctx.fillStyle = color;
  path();
  ctx.fill();
  paintTex(ctx, path, 'weave', 0.3, 0.32, 0.32, hash01(seed, 1) * 50, 0);
  roundShade(ctx, path, box, color, 0.5, 0.45);
  // tufting buttons and their creases
  const n = Math.max(2, Math.round(w / 46));
  ctx.strokeStyle = rgba(shadowOf(color, 0.6), 0.45);
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const bx = (w * (i + 0.5)) / n;
    const by = h * 0.42;
    ctx.beginPath();
    for (const [dx, dy] of [
      [-9, -6],
      [9, -6],
      [-8, 6],
      [8, 6],
    ]) {
      ctx.moveTo(bx + dx * 0.2, by + dy * 0.2);
      ctx.quadraticCurveTo(bx + dx * 0.6, by + dy * 0.3, bx + dx, by + dy);
    }
    ctx.stroke();
    knob(ctx, bx, by, 2.1, shadowOf(color, 0.2));
  }
  // a velvet sheen, piping and a lit top edge
  specular(ctx, w * 0.3, 6, w * 0.32, 2, -0.05, 0.4);
  ctx.strokeStyle = rgba(lightOf(color, 0.75), 0.75);
  ctx.lineWidth = 1.6;
  path();
  ctx.stroke();
  inkLine(ctx, path, color, 1.1, 0.7);
}

// --- Glass funnels and tubes -------------------------------------------------------

type FunnelArt = Extract<Art, { k: 'funnel' }>;
type TubeArt = Extract<Art, { k: 'tube' }>;

function conePath(ctx: Ctx, a: FunnelArt): void {
  ctx.beginPath();
  ctx.moveTo(a.lx, a.ly);
  ctx.lineTo(a.rx, a.ry);
  ctx.lineTo(a.cx + a.hw, a.mouth);
  ctx.lineTo(a.cx - a.hw, a.mouth);
  ctx.closePath();
}

/**
 * Glass seen face-on across a hollow: clearer in the middle, denser toward
 * the sides where we look through it at a grazing angle; the near wall also
 * mirrors the window in a soft band on the lit side.
 */
function veil(ctx: Ctx, x0: number, x1: number, y0: number, y1: number, tint: string, far: boolean): CanvasGradient {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  const T = far ? mix(tint, shadowOf(tint, 0.5), 0.3) : tint;
  if (far) {
    g.addColorStop(0, rgba(T, 0.42));
    g.addColorStop(0.18, rgba(T, 0.24));
    g.addColorStop(0.5, rgba(T, 0.18));
    g.addColorStop(0.75, rgba(lightOf(tint, 0.6), 0.26));
    g.addColorStop(1, rgba(T, 0.42));
  } else {
    g.addColorStop(0, rgba(T, 0.3));
    g.addColorStop(0.12, 'rgba(255,255,255,0.32)');
    g.addColorStop(0.22, rgba(T, 0.1));
    g.addColorStop(0.3, 'rgba(255,255,255,0.2)');
    g.addColorStop(0.4, rgba(T, 0.06));
    g.addColorStop(0.8, rgba(T, 0.1));
    g.addColorStop(1, rgba(T, 0.32));
  }
  void y0;
  void y1;
  return g;
}

function funnelBack(ctx: Ctx, a: FunnelArt): void {
  const x0 = Math.min(a.lx, a.cx - a.hw);
  const x1 = Math.max(a.rx, a.cx + a.hw);
  const top = Math.min(a.ly, a.ry);
  // the far wall, deepening toward the neck
  ctx.fillStyle = veil(ctx, x0, x1, top, a.mouth, a.tint, true);
  conePath(ctx, a);
  ctx.fill();
  const dg = ctx.createLinearGradient(0, top, 0, a.mouth);
  dg.addColorStop(0, rgba(shadowOf(a.tint, 0.4), 0));
  dg.addColorStop(1, rgba(shadowOf(a.tint, 0.45), 0.22));
  ctx.fillStyle = dg;
  conePath(ctx, a);
  ctx.fill();
  // the far half of the rim
  rimAt(ctx, a, 'far');
  // light focused down the neck
  const lg = ctx.createRadialGradient(a.cx, a.mouth - 10, 0, a.cx, a.mouth - 10, a.hw * 2.2);
  lg.addColorStop(0, 'rgba(255,246,222,0.35)');
  lg.addColorStop(1, 'rgba(255,246,222,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(a.cx - a.hw * 2.2, a.mouth - 10 - a.hw * 2.2, a.hw * 4.4, a.hw * 4.4);
}

/** The funnel's round rim (a tilted ellipse when its two sides start at different heights). */
function rimAt(ctx: Ctx, a: FunnelArt, half: 'near' | 'far'): void {
  const mx = (a.lx + a.rx) / 2;
  const my = (a.ly + a.ry) / 2;
  const rxm = Math.hypot(a.rx - a.lx, a.ry - a.ly) / 2;
  const ang = Math.atan2(a.ry - a.ly, a.rx - a.lx);
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(ang);
  // a wide funnel seen from a little above: a flatter ellipse than a cup's
  ctx.scale(1, 0.6);
  rimLip(ctx, { cx: 0, y: 0, rxm, r: 4.5 }, a.tint, half);
  ctx.restore();
}

function tubeBack(ctx: Ctx, a: TubeArt): void {
  const x0 = a.cx - a.hw;
  const x1 = a.cx + a.hw;
  ctx.fillStyle = veil(ctx, x0, x1, a.y0, a.y1, a.tint, true);
  ctx.fillRect(x0, a.y0, x1 - x0, a.y1 - a.y0);
  // a soft shadow of the tube on the wall behind it (down and to the right)
  softShadow(ctx, a.cx + 9, (a.y0 + a.y1) / 2 + 8, a.hw * 1.2, (a.y1 - a.y0) * 0.55, 0.08);
}

function funnelFront(ctx: Ctx, a: FunnelArt, t: TubeArt | null): void {
  const x0 = Math.min(a.lx, a.cx - a.hw);
  const x1 = Math.max(a.rx, a.cx + a.hw);
  const top = Math.min(a.ly, a.ry);
  // the near wall of the cone, and of the tube
  ctx.fillStyle = veil(ctx, x0, x1, top, a.mouth, a.tint, false);
  conePath(ctx, a);
  ctx.fill();
  if (t) {
    ctx.fillStyle = veil(ctx, t.cx - t.hw, t.cx + t.hw, t.y0, t.y1, t.tint, false);
    ctx.fillRect(t.cx - t.hw, t.y0, t.hw * 2, t.y1 - t.y0);
  }
  // the walls seen edge-on: one glass body for the cone's sides and the tube's
  const r = 4;
  const parts: GlassPart[] = [
    { k: 'cap', ax: a.lx, ay: a.ly, bx: a.cx - a.hw, by: a.mouth, r },
    { k: 'cap', ax: a.rx, ay: a.ry, bx: a.cx + a.hw, by: a.mouth, r },
  ];
  if (t) parts.push({ k: 'cap', ax: t.cx - t.hw, ay: t.y0, bx: t.cx - t.hw, by: t.y1, r }, { k: 'cap', ax: t.cx + t.hw, ay: t.y0, bx: t.cx + t.hw, by: t.y1, r });
  glassSolid(ctx, parts, [], a.tint, { body: 0.34 });
  rimAt(ctx, a, 'near');
  // crisp streaks: down the cone's lit side, then down the tube
  const L = 0.82;
  const sx0 = a.lx + (a.cx - a.hw - a.lx) * 0.1;
  const sy0 = a.ly + (a.mouth - a.ly) * 0.1 + 6;
  const sx1 = a.lx + (a.cx - a.hw - a.lx) * L;
  const sy1 = a.ly + (a.mouth - a.ly) * L;
  streak(ctx, sx0 + 10, sy0 + 4, sx1 + 6, sy1 - 2, 2.4, 0.6);
  streak(ctx, a.rx - (a.rx - a.cx - a.hw) * 0.25 - 10, a.ry + (a.mouth - a.ry) * 0.25, a.rx - (a.rx - a.cx - a.hw) * 0.6 - 6, a.ry + (a.mouth - a.ry) * 0.6, 1.2, 0.25);
  if (t) {
    const len = t.y1 - t.y0;
    streak(ctx, t.cx - t.hw * 0.55, t.y0 + 10, t.cx - t.hw * 0.55, t.y0 + len * 0.78, Math.min(3, t.hw * 0.16), 0.7);
    streak(ctx, t.cx - t.hw * 0.25, t.y0 + len * 0.12, t.cx - t.hw * 0.25, t.y0 + len * 0.42, 1.1, 0.4);
    streak(ctx, t.cx + t.hw * 0.62, t.y0 + len * 0.35, t.cx + t.hw * 0.62, t.y0 + len * 0.85, 1.2, 0.22);
    collar(ctx, t.cx, t.y0 + 2, t.hw + 4.5);
    collar(ctx, t.cx, t.y1 - 4, t.hw + 4.5);
    glint(ctx, t.cx - t.hw * 0.55, t.y0 + 12, 1, 0.9);
  }
  sparkle(ctx, a.lx + (a.rx - a.lx) * 0.18, (a.ly + a.ry) / 2 + 8, 4.2, 0.85);
  sparkle(ctx, a.cx - a.hw - 8, a.mouth - 30, 2.4, 0.6);
}

type SlideArt = Extract<Art, { k: 'slide' }>;

/** A line `d` to the side of a path (its glass wall, seen edge-on). */
function offsetPath(pts: readonly [number, number][], d: number): [number, number][] {
  const n = pts.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[Math.max(0, i - 1)];
    const [bx, by] = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    out.push([pts[i][0] - ((by - ay) / l) * d, pts[i][1] + ((bx - ax) / l) * d]);
  }
  return out;
}

/** A boost slide's far wall, and its shadow on the wall behind. */
function slideBack(ctx: Ctx, a: SlideArt): void {
  ctx.save();
  ctx.translate(8, 7);
  ribbonPath(ctx, a.path, a.hw * 2 + 2);
  ctx.fillStyle = 'rgba(74,64,96,0.09)';
  ctx.fill();
  ctx.restore();
  ribbonPath(ctx, a.path, a.hw * 2);
  ctx.fillStyle = rgba(mix(a.tint, shadowOf(a.tint, 0.5), 0.3), 0.34);
  ctx.fill();
  ctx.strokeStyle = rgba(shadowOf(a.tint, 0.4), 0.22);
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [i, [x, y]] of offsetPath(a.path, a.hw - 6).entries()) {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * A boost slide's near wall: the glass seen edge-on down both sides, a
 * streak of light, brass collars at its two ends, and chevrons down its long
 * run (this way, fast!).
 */
function slideFront(ctx: Ctx, a: SlideArt): void {
  const pts = a.path;
  ribbonPath(ctx, pts, a.hw * 2);
  ctx.fillStyle = rgba(a.tint, 0.16);
  ctx.fill();
  const wall: GlassPart[] = [];
  for (const side of [-1, 1]) {
    const line = offsetPath(pts, side * (a.hw - 2));
    for (let i = 1; i < line.length; i++) wall.push({ k: 'cap', ax: line[i - 1][0], ay: line[i - 1][1], bx: line[i][0], by: line[i][1], r: 2.6 });
  }
  glassSolid(ctx, wall, [], a.tint, { body: 0.36 });
  // a long streak down the lit side
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2.4;
  ctx.setLineDash([70, 30, 16, 34]);
  ctx.beginPath();
  for (const [i, [x, y]] of offsetPath(pts, -a.hw * 0.5).entries()) {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
  // chevrons down the long straight run at the end
  const [ex, ey] = pts[pts.length - 1];
  const [sx, sy] = pts[pts.length - 2];
  const run = ey - sy;
  const deep = shadowOf(a.tint, 0.45);
  for (let k = 1; k <= Math.floor(run / 110); k++) {
    const y = sy + k * 110 - 40;
    const x = sx + ((ex - sx) * (y - sy)) / Math.max(1, run);
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [w, c] of [
      [4.4, rgba(deep, 0.55)],
      [2.2, 'rgba(255,255,255,0.9)'],
    ] as const) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (const dy of [-6, 4]) {
        ctx.moveTo(-7, dy - 5);
        ctx.lineTo(0, dy + 2);
        ctx.lineTo(7, dy - 5);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  collar(ctx, pts[0][0], pts[0][1] + 6, a.hw + 4.5);
  collar(ctx, ex, ey - 4, a.hw + 4.5);
  sparkle(ctx, pts[0][0] - a.hw * 0.4, pts[0][1] + 28, 3.4, 0.85);
  glint(ctx, ex - a.hw * 0.5, ey - 20, 1, 0.8);
}

/** A tapered white streak on glass, from (x0,y0) to (x1,y1). */
function streak(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, alpha: number): void {
  const n = 12;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.8})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ww = w * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.7) * 0.5;
    ctx.lineTo(x0 + dx * t + nx * ww, y0 + dy * t + ny * ww);
  }
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const ww = w * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.7) * 0.5;
    ctx.lineTo(x0 + dx * t - nx * ww, y0 + dy * t - ny * ww);
  }
  ctx.closePath();
  ctx.fill();
}

/** A brass band round a tube. */
function collar(ctx: Ctx, cx: number, y: number, hw: number): void {
  const p = (): void => roundRect(ctx, cx - hw, y - 3.5, hw * 2, 7, 2.2);
  ctx.fillStyle = BRASS;
  p();
  ctx.fill();
  cylinderShade(ctx, p, cx - hw, cx + hw, BRASS, 0.75, 0.55);
  ctx.fillStyle = rgba(lightOf(BRASS, 0.9), 0.85);
  ctx.fillRect(cx - hw + 2, y - 2.6, hw * 2 - 4, 0.9);
  inkLine(ctx, p, BRASS, 0.8, 0.6);
  for (const s of [-1, 1]) knob(ctx, cx + s * (hw - 3), y, 0.9, lightOf(BRASS, 0.2));
}

// ---------------------------------------------------------------------------
// Fish

const fishCache = new Map<string, HTMLCanvasElement>();
export const FISH_LEN = 26;

/** A little painted fish (cached per look and resolution), drawn centred on (0, 0) facing +x. */
export function fishSprite(golden: boolean, ppu: number): { c: HTMLCanvasElement; w: number; h: number } {
  const key = `${golden}|${ppu.toFixed(3)}`;
  const W = FISH_LEN + 16;
  const H = 26;
  let c = fishCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = Math.ceil(W * ppu);
    c.height = Math.ceil(H * ppu);
    const g = c.getContext('2d')!;
    g.setTransform(ppu, 0, 0, ppu, (W / 2) * ppu, (H / 2) * ppu);
    paintFish(g, golden);
    fishCache.set(key, c);
  }
  return { c, w: W, h: H };
}

function paintFish(ctx: Ctx, golden: boolean): void {
  const body = golden ? '#F2C14E' : '#8FB3D9';
  const back = golden ? '#E39A2E' : '#6F93BE';
  const belly = golden ? '#FFF1C2' : '#EAF2F7';
  const fin = golden ? '#F0A93E' : '#A9C6E4';
  const L = FISH_LEN / 2;
  // tail
  const tail = (): void => {
    ctx.beginPath();
    ctx.moveTo(-L + 3, 0);
    ctx.quadraticCurveTo(-L - 4, -2, -L - 7, -7.5);
    ctx.quadraticCurveTo(-L - 4.5, 0, -L - 7, 7.5);
    ctx.quadraticCurveTo(-L - 4, 2, -L + 3, 0);
    ctx.closePath();
  };
  ctx.fillStyle = fin;
  tail();
  ctx.fill();
  ctx.strokeStyle = rgba(shadowOf(fin, 0.4), 0.6);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (const t of [-0.5, 0, 0.5]) {
    ctx.moveTo(-L, 0);
    ctx.lineTo(-L - 6, t * 12);
  }
  ctx.stroke();
  inkLine(ctx, tail, fin, 0.8, 0.6);
  // dorsal and belly fins
  ctx.fillStyle = fin;
  ctx.beginPath();
  ctx.moveTo(-3, -5.5);
  ctx.quadraticCurveTo(0, -10.5, 5, -6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-2, 5);
  ctx.quadraticCurveTo(0, 8.5, 3, 5.4);
  ctx.closePath();
  ctx.fill();
  // body
  const bodyP = (): void => {
    ctx.beginPath();
    ctx.moveTo(L, 0.5);
    ctx.bezierCurveTo(L - 1, -6.8, -2, -7.4, -L + 2, -1.8);
    ctx.quadraticCurveTo(-L + 0.5, 0, -L + 2, 1.8);
    ctx.bezierCurveTo(-2, 7.6, L - 1, 6.6, L, 0.5);
    ctx.closePath();
  };
  ctx.fillStyle = body;
  bodyP();
  ctx.fill();
  ctx.save();
  bodyP();
  ctx.clip();
  const g = ctx.createLinearGradient(0, -7, 0, 7);
  g.addColorStop(0, back);
  g.addColorStop(0.45, rgba(body, 0));
  g.addColorStop(0.62, rgba(belly, 0));
  g.addColorStop(1, belly);
  ctx.fillStyle = g;
  ctx.fillRect(-L, -8, L * 2, 16);
  // scales: little arcs
  ctx.strokeStyle = rgba(golden ? '#FFF6D8' : '#F4FAFF', 0.45);
  ctx.lineWidth = 0.55;
  for (let sx = -L + 5; sx < L - 4; sx += 3.4)
    for (let sy = -3; sy <= 2; sy += 3) {
      ctx.beginPath();
      ctx.arc(sx + (sy % 2 ? 1.7 : 0), sy, 1.6, -1.2, 1.2);
      ctx.stroke();
    }
  // a stripe
  ctx.fillStyle = rgba(golden ? '#FFF1C2' : '#D9726A', golden ? 0.5 : 0.55);
  ctx.beginPath();
  ctx.ellipse(-1, -0.6, 1.3, 6.5, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // gill and eye
  ctx.strokeStyle = rgba(shadowOf(body, 0.5), 0.6);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.arc(L - 7.5, 0.2, 4, -1.1, 1.1);
  ctx.stroke();
  ctx.fillStyle = '#3E3A4F';
  ctx.beginPath();
  ctx.arc(L - 4.2, -1.6, 1.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(L - 3.7, -2.1, 0.55, 0, Math.PI * 2);
  ctx.fill();
  // a soft smile
  ctx.strokeStyle = rgba(shadowOf(body, 0.6), 0.7);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(L - 1.6, 1.8, 1.2, 0.3, 1.8);
  ctx.stroke();
  inkLine(ctx, bodyP, body, 0.9, 0.7);
  specular(ctx, 2, -4.2, 9, 1.1, 0.05, 0.55);
}
