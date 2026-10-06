// Walls, floors, windows full of afternoon sun, and the little decor bits,
// painted like a gouache storybook background. The room is the stage: richly
// painted on a close look, but calm, and a touch lower in contrast and
// saturation than the props and cats that play on it.

import type { DecorPlacement, ThemeId } from '../game/room';
import { FLOOR_Y, WORLD_W } from '../game/props';
import { PALETTE, contactShadow, edgeShade, glint, hash01, lightOf, lineOf, mix, rgba, roundRect, shadowOf, specular, type Box, type Ctx } from './paint';
import { bakedFill, bakedTexture, castShadow, clipRect, cylinderShade, inkLine, jit, knob, paintTex, pxPerUnit, roundShade, sprite, stamp } from './roomKit';

export interface Theme {
  wall: string;
  wallLow: string;
  trim: string;
  floor: string;
  accent: string;
  cabinet: string;
  pattern: 'plain' | 'stripes' | 'dots' | 'tiles' | 'leaves';
  /** Lower wall (non-tiled rooms): tongue-and-groove boards or raised panels. */
  dado?: 'beadboard' | 'panels';
  /** Flavour of the wallpaper motif. */
  motif?: 'regency' | 'pin' | 'flower' | 'star';
}

export const THEMES: Record<ThemeId, Theme> = {
  kitchen: { wall: '#F8EAD3', wallLow: '#F2DDBF', trim: '#FBF6EE', floor: PALETTE.oak, accent: PALETTE.teacup, cabinet: '#BFDCCB', pattern: 'plain', dado: 'beadboard' },
  bathroom: { wall: '#EEF3EC', wallLow: PALETTE.mint, trim: '#FBFAF5', floor: '#D9CFC2', accent: PALETTE.rose, cabinet: '#F3E6D6', pattern: 'tiles' },
  living: { wall: '#F4E1CF', wallLow: '#E9CDB4', trim: '#FBF3E8', floor: PALETTE.oak, accent: PALETTE.ginger, cabinet: '#E2C6A6', pattern: 'stripes', dado: 'panels', motif: 'regency' },
  laundry: { wall: '#E3ECF2', wallLow: '#CFDDE8', trim: '#FAFCFD', floor: '#CDB89C', accent: PALETTE.butter, cabinet: '#F4EADB', pattern: 'dots', dado: 'beadboard', motif: 'flower' },
  study: { wall: '#EFDCD6', wallLow: '#E2C4BA', trim: '#FAF1EC', floor: '#B8916A', accent: PALETTE.sage, cabinet: '#D7B99B', pattern: 'stripes', dado: 'panels', motif: 'pin' },
  sunroom: { wall: '#FBF0D2', wallLow: '#F2E0B0', trim: '#FFFBF0', floor: '#D4B48D', accent: PALETTE.sage, cabinet: '#EAD9B8', pattern: 'leaves', dado: 'beadboard' },
  pantry: { wall: '#E6EDDC', wallLow: '#D4E0C4', trim: '#F9FBF4', floor: PALETTE.oak, accent: PALETTE.terracotta, cabinet: '#F0E2C8', pattern: 'plain', dado: 'beadboard' },
  bedroom: { wall: '#EAE2F0', wallLow: '#DCD0E8', trim: '#FBF8FD', floor: '#C9A27A', accent: PALETTE.lilac, cabinet: '#E8D9C6', pattern: 'dots', dado: 'panels', motif: 'star' },
  studio: { wall: '#F7EEE2', wallLow: '#EFE0CC', trim: '#FFFCF6', floor: '#D3B38E', accent: PALETTE.ginger, cabinet: '#E8D6BE', pattern: 'plain', dado: 'panels' },
};

const SKIRT = 12;
const RAIL = 6;
const TILE_TOP = FLOOR_Y - 190;
/** Vanishing point of the floor: we look at the dollhouse slightly from above. */
const VPX = WORLD_W / 2;
const VPY = -900;

function dadoTop(theme: Theme): number {
  return theme.pattern === 'tiles' ? TILE_TOP : FLOOR_Y - (theme.dado === 'panels' ? 80 : 68);
}

/** Wall + floor + skirting, painted across the visible world rect. */
/**
 * A room's walls and floor over the rows vy0..vy1. `ceil` is where its
 * ceiling is, for a room taller than a screen (the home's living room): the
 * shade under the ceiling goes there.
 */
export function drawShell(ctx: Ctx, theme: Theme, vx0: number, vy0: number, vx1: number, vy1: number, seed: number, ceil = 0): void {
  // beyond the dollhouse's side walls the renderer paints the backdrop, so
  // there is no need to paint the room there (it matters on wide screens)
  vx0 = Math.max(vx0, -10);
  vx1 = Math.min(vx1, WORLD_W + 10);
  const top = dadoTop(theme);
  ctx.save();
  wallWash(ctx, theme, vx0, vy0, vx1, top, seed, ceil);
  // wallpaper (upper wall; motifs stop short of the rail, which covers the seam)
  wallpaper(ctx, theme, vx0, vy0, vx1, top - RAIL + 1, seed);
  // lower wall, rails and skirting
  if (theme.pattern === 'tiles') {
    tileDado(ctx, theme, vx0, vx1);
    tileCap(ctx, theme, vx0, vx1);
  } else {
    woodDado(ctx, theme, vx0, vx1, top, seed);
    chairRail(ctx, theme, vx0, vx1, top);
  }
  skirting(ctx, theme, vx0, vx1);
  ctx.restore();
  paintFloor(ctx, theme, vx0, vx1, vy1, seed);
}

/** Wallpaper stripes, painted into the low-resolution wall wash. */
function washStripes(ctx: Ctx, theme: Theme, vx0: number, vy0: number, vx1: number, y1: number, seed: number): void {
  const wall = theme.wall;
  const h = y1 - vy0;
  if (theme.motif === 'pin') {
    // narrow study stripes with a hairline between
    const P = 22;
    const deep = mix(wall, theme.wallLow, 0.62);
    const hair = mix(wall, shadowOf(theme.accent, 0.35), 0.36);
    for (let x = Math.floor(vx0 / P) * P; x < vx1; x += P) {
      const a = 0.72 + jit(seed, Math.round(x / P)) * 0.08;
      ctx.fillStyle = rgba(deep, a);
      ctx.fillRect(x, vy0, 7, h);
      ctx.fillStyle = rgba(deep, a * 0.3);
      ctx.fillRect(x - 0.7, vy0, 0.7, h);
      ctx.fillRect(x + 7, vy0, 0.7, h);
      ctx.fillStyle = rgba(lightOf(wall, 0.6), 0.45);
      ctx.fillRect(x + 1.2, vy0, 0.9, h);
      ctx.fillStyle = rgba(hair, 0.55);
      ctx.fillRect(x + 14.1, vy0, 0.8, h);
    }
  } else {
    // regency stripes: a broad satin stripe flanked by pinstripes
    const P = 40;
    const W = 13;
    const deep = mix(wall, theme.wallLow, 0.7);
    const pin = mix(wall, shadowOf(theme.accent, 0.2), 0.3);
    for (let x = Math.floor(vx0 / P) * P; x < vx1; x += P) {
      const a = 0.78 + jit(seed, Math.round(x / P)) * 0.07;
      ctx.fillStyle = rgba(deep, a);
      ctx.fillRect(x, vy0, W, h);
      ctx.fillStyle = rgba(deep, a * 0.3);
      ctx.fillRect(x - 0.7, vy0, 0.7, h);
      ctx.fillRect(x + W, vy0, 0.7, h);
      ctx.fillStyle = rgba(lightOf(deep, 0.7), 0.4);
      ctx.fillRect(x + 2.2, vy0, 1.4, h);
      ctx.fillStyle = rgba(pin, 0.6);
      ctx.fillRect(x - 4.4, vy0, 1, h);
      ctx.fillRect(x + W + 3.4, vy0, 1, h);
    }
  }
}

let washCanvas: HTMLCanvasElement | null = null;

/**
 * The wall's soft paint (base colours, one warm key light from the upper left,
 * shade toward the corners, the ceiling and the side walls, and dry gouache
 * texture) is all low-frequency, so it is laid at low resolution and scaled
 * up in one draw. Crisp details go on top at full resolution.
 */
function wallWash(ctx: Ctx, theme: Theme, vx0: number, vy0: number, vx1: number, top: number, seed: number, ceil: number): void {
  const q = Math.min(1.3, Math.max(0.5, pxPerUnit(ctx) * 0.45));
  const w = vx1 - vx0;
  const h = FLOOR_Y - vy0;
  const W = Math.ceil(w * q) + 2;
  const H = Math.ceil(h * q) + 2;
  if (!washCanvas) washCanvas = document.createElement('canvas');
  const c = washCanvas;
  if (c.width < W || c.height < H) {
    c.width = Math.max(c.width, W);
    c.height = Math.max(c.height, H);
  }
  const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  g.setTransform(q, 0, 0, q, -vx0 * q, -vy0 * q);
  const all = (): void => {
    g.beginPath();
    g.rect(vx0, vy0, w, h + 1);
  };
  const low = theme.pattern === 'tiles' ? tileGrout(theme) : theme.wallLow;
  g.fillStyle = theme.wall;
  g.fillRect(vx0, vy0, w, top - vy0);
  g.fillStyle = low;
  g.fillRect(vx0, top, w, FLOOR_Y - top + 1);
  if (theme.pattern === 'stripes') washStripes(g, theme, vx0, vy0, vx1, top - RAIL + 1, seed);
  // key light: a warm glow high on the left, deepening toward the far corners
  const lg = g.createRadialGradient(WORLD_W * 0.36, 110, 10, WORLD_W * 0.36, 110, 640);
  lg.addColorStop(0, 'rgba(255,248,226,0.5)');
  lg.addColorStop(0.3, 'rgba(255,248,226,0.12)');
  lg.addColorStop(0.5, 'rgba(70,56,96,0)');
  lg.addColorStop(1, 'rgba(70,56,96,0.3)');
  g.fillStyle = lg;
  all();
  g.fill();
  // gouache: paper grain and dry brush
  // one texel per wash pixel, so the pattern needs no filtering (fast path)
  g.imageSmoothingEnabled = false;
  bakedFill(g, all, bakedTexture([['plaster', 0.17], ['brush', 0.17], ['brush', 0.08, 'T']], '#FFFCF0', '#9A7E78'), 1 / q, 1 / q, vx0 - ((seed % 61) * 4) / q, vy0 - 30 / q);
  g.imageSmoothingEnabled = true;
  // the dado deepens toward the floor
  const dg = g.createLinearGradient(0, top, 0, FLOOR_Y);
  dg.addColorStop(0, rgba(shadowOf(low, 0.6), 0));
  dg.addColorStop(1, rgba(shadowOf(low, 0.6), 0.22));
  g.fillStyle = dg;
  g.fillRect(vx0, top, w, FLOOR_Y - top + 1);
  // shade under the ceiling and along the dollhouse side walls
  const dim = shadowOf(theme.wall, 0.6);
  if (vy0 < ceil + 40) {
    const cg = g.createLinearGradient(0, Math.min(vy0, ceil - 110), 0, ceil + 40);
    cg.addColorStop(0, rgba(dim, 0.4));
    cg.addColorStop(1, rgba(dim, 0));
    g.fillStyle = cg;
    g.fillRect(vx0, vy0, w, ceil + 40 - vy0);
  }
  for (const [x, dir] of [
    [0, 1],
    [WORLD_W, -1],
  ] as const) {
    const sg = g.createLinearGradient(x, 0, x + dir * 40, 0);
    sg.addColorStop(0, rgba(dim, 0.24));
    sg.addColorStop(1, rgba(dim, 0));
    g.fillStyle = sg;
    g.fillRect(dir > 0 ? x : x - 40, vy0, 40, h + 1);
  }
  ctx.drawImage(c, 0, 0, W, H, vx0, vy0, W / q, H / q);
}

// --- Wallpaper ---------------------------------------------------------------

function wallpaper(ctx: Ctx, theme: Theme, vx0: number, vy0: number, vx1: number, y1: number, seed: number): void {
  const wall = theme.wall;
  switch (theme.pattern) {
    case 'stripes':
      // painted into the wall wash (soft edges, under the paper texture)
      break;
    case 'dots': {
      // motifs are rendered once as little sprites and stamped across the wall
      const P = theme.motif === 'star' ? 34 : 32;
      const accent = theme.accent;
      const petal = rgba(mix(wall, accent, 0.5), 0.85);
      const heart = rgba(mix(wall, shadowOf(accent, 0.45), 0.55), 0.9);
      const dotC = rgba(mix(wall, shadowOf(theme.wallLow, 0.2), 0.75), 0.82);
      const starC = rgba(mix(wall, shadowOf(accent, 0.25), 0.42), 0.85);
      const goldC = rgba(mix(wall, PALETTE.butter, 0.55), 0.85);
      const dot = sprite(ctx, `dot${dotC}`, 1.6, (g) => {
        g.fillStyle = dotC;
        g.beginPath();
        g.arc(0, 0, 1.45, 0, Math.PI * 2);
        g.fill();
      });
      const flowers = [0, 1, 2].map((v) =>
        sprite(ctx, `flower${v}${petal}${heart}`, 4.2, (g) => {
          g.fillStyle = petal;
          g.beginPath();
          for (let k = 0; k < 5; k++) {
            const a = v * 0.42 + (k * Math.PI * 2) / 5;
            g.moveTo(Math.cos(a) * 2.3 + 1.6, Math.sin(a) * 2.3);
            g.arc(Math.cos(a) * 2.3, Math.sin(a) * 2.3, 1.6, 0, Math.PI * 2);
          }
          g.fill();
          g.fillStyle = heart;
          g.beginPath();
          g.arc(0, 0, 1.05, 0, Math.PI * 2);
          g.fill();
        }),
      );
      const stars = [starC, goldC].map((c) =>
        sprite(ctx, `star${c}`, 4.4, (g) => {
          g.fillStyle = c;
          const p = new Path2D();
          sparklePath(p, 0, 0, 3.8);
          g.fill(p);
        }),
      );
      const r0 = Math.floor(vy0 / P);
      for (let r = r0; r * P < y1 - 4; r++) {
        const y = r * P;
        const off = r % 2 ? P / 2 : 0;
        for (let x = Math.floor(vx0 / P) * P + off - P; x < vx1 + P; x += P) {
          const i = Math.round((x - off) / P);
          const sd = hash01(seed + i * 7, r);
          if ((i + r) % 2 !== 0) stamp(ctx, dot, x, y);
          else if (theme.motif === 'star') stamp(ctx, stars[sd > 0.75 ? 1 : 0], x, y);
          else stamp(ctx, flowers[Math.floor(sd * 3)], x, y);
        }
      }
      break;
    }
    case 'leaves': {
      const P = 52;
      const leaf = mix(wall, PALETTE.sage, 0.38);
      const lit = mix(wall, lightOf(PALETTE.sage, 0.5), 0.33);
      const stem = mix(wall, shadowOf(PALETTE.sage, 0.4), 0.36);
      // six variants: three tilts, mirrored
      const sprigs: HTMLCanvasElement[] = [];
      for (const flip of [1, -1])
        for (const tilt of [0.26, 0.38, 0.5])
          sprigs.push(
            sprite(ctx, `sprig${flip}${tilt}${leaf}${lit}${stem}`, 16, (g) => {
              const stems = new Path2D();
              const bases = new Path2D();
              const lits = new Path2D();
              sprig(stems, bases, lits, 0, 0, flip * tilt, flip);
              g.fillStyle = leaf;
              g.fill(bases);
              g.fillStyle = lit;
              g.fill(lits);
              g.strokeStyle = stem;
              g.lineWidth = 0.9;
              g.lineCap = 'round';
              g.stroke(stems);
            }),
          );
      for (let r = Math.floor(vy0 / P) - 1; r * P < y1 - 12; r++) {
        const off = r % 2 ? P / 2 : 0;
        for (let x = Math.floor(vx0 / P) * P + off - P; x < vx1 + P; x += P) {
          const i = Math.round((x - off) / P);
          const flip = (i + r) % 2 ? 3 : 0;
          stamp(ctx, sprigs[flip + Math.floor(hash01(seed + i, r) * 3)], x, r * P);
        }
      }
      break;
    }
    default:
      break;
  }
}

/** Four-point sparkle star. */
function sparkle(ctx: Ctx, x: number, y: number, r: number, color: string, alpha: number): void {
  ctx.fillStyle = rgba(color, alpha);
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + r * 0.16, y - r * 0.16, x + r, y);
  ctx.quadraticCurveTo(x + r * 0.16, y + r * 0.16, x, y + r);
  ctx.quadraticCurveTo(x - r * 0.16, y + r * 0.16, x - r, y);
  ctx.quadraticCurveTo(x - r * 0.16, y - r * 0.16, x, y - r);
  ctx.fill();
}

/** An almond leaf from (x, y) along angle `a`, two-toned along its vein. */
function leafShape(ctx: Ctx, x: number, y: number, len: number, wid: number, a: number, base: string, lit: string, vein?: string): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const tx = x + c * len;
  const ty = y + s * len;
  const nx = -s * wid;
  const ny = c * wid;
  const mx = x + c * len * 0.45;
  const my = y + s * len * 0.45;
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx + nx, my + ny, tx, ty);
  ctx.quadraticCurveTo(mx - nx, my - ny, x, y);
  ctx.fill();
  // the half facing the light
  const side = nx * -0.5 + ny * -0.866 > 0 ? 1 : -1;
  ctx.fillStyle = lit;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx + nx * side, my + ny * side, tx, ty);
  ctx.quadraticCurveTo(mx + nx * side * 0.15, my + ny * side * 0.15, x, y);
  ctx.fill();
  if (vein) {
    ctx.strokeStyle = vein;
    ctx.lineWidth = Math.max(0.5, wid * 0.16);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(mx + nx * 0.12, my + ny * 0.12, x + c * len * 0.85, y + s * len * 0.85);
    ctx.stroke();
  }
}

/** Four-point sparkle added to a path. */
function sparklePath(p: Path2D, x: number, y: number, r: number): void {
  p.moveTo(x, y - r);
  p.quadraticCurveTo(x + r * 0.16, y - r * 0.16, x + r, y);
  p.quadraticCurveTo(x + r * 0.16, y + r * 0.16, x, y + r);
  p.quadraticCurveTo(x - r * 0.16, y + r * 0.16, x - r, y);
  p.quadraticCurveTo(x - r * 0.16, y - r * 0.16, x, y - r);
  p.closePath();
}

/** An almond leaf added to two paths (whole leaf, and its half facing the light), in local coords mapped by `m`. */
function leafInto(base: Path2D, lit: Path2D, m: DOMMatrix, x: number, y: number, len: number, wid: number, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pt = (px: number, py: number): [number, number] => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f];
  const tx = x + c * len;
  const ty = y + s * len;
  const nx = -s * wid;
  const ny = c * wid;
  const mx = x + c * len * 0.45;
  const my = y + s * len * 0.45;
  const p0 = pt(x, y);
  const t = pt(tx, ty);
  const q1 = pt(mx + nx, my + ny);
  const q2 = pt(mx - nx, my - ny);
  base.moveTo(p0[0], p0[1]);
  base.quadraticCurveTo(q1[0], q1[1], t[0], t[1]);
  base.quadraticCurveTo(q2[0], q2[1], p0[0], p0[1]);
  // which side faces the light, in world space
  const wn = [m.a * nx + m.c * ny, m.b * nx + m.d * ny];
  const side = wn[0] * -0.5 + wn[1] * -0.866 > 0 ? 1 : -1;
  const l1 = pt(mx + nx * side, my + ny * side);
  const l2 = pt(mx + nx * side * 0.15, my + ny * side * 0.15);
  lit.moveTo(p0[0], p0[1]);
  lit.quadraticCurveTo(l1[0], l1[1], t[0], t[1]);
  lit.quadraticCurveTo(l2[0], l2[1], p0[0], p0[1]);
}

/** A plump, heart-based leaf from (x, y) toward angle a, lit on the side facing the light. */
function roundLeaf(ctx: Ctx, x: number, y: number, len: number, a: number, base: string): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const nx = -s;
  const ny = c;
  const P = (u: number, v: number): [number, number] => [x + c * u * len + nx * v * len, y + s * u * len + ny * v * len];
  const tip = P(1, 0);
  const l1 = P(0.15, 0.55);
  const l2 = P(0.75, 0.42);
  const r1 = P(0.75, -0.42);
  const r2 = P(0.15, -0.55);
  const notch = P(0.08, 0);
  const shape = (): void => {
    ctx.beginPath();
    ctx.moveTo(notch[0], notch[1]);
    ctx.bezierCurveTo(l1[0], l1[1], l2[0], l2[1], tip[0], tip[1]);
    ctx.bezierCurveTo(r1[0], r1[1], r2[0], r2[1], notch[0], notch[1]);
    ctx.closePath();
  };
  ctx.fillStyle = base;
  shape();
  ctx.fill();
  // the half facing the light
  const side = nx * -0.5 + ny * -0.866 > 0 ? 1 : -1;
  const m1 = P(0.15, 0.55 * side);
  const m2 = P(0.75, 0.42 * side);
  const mid = P(0.5, 0.04 * side);
  ctx.fillStyle = lightOf(base, 0.32);
  ctx.beginPath();
  ctx.moveTo(notch[0], notch[1]);
  ctx.bezierCurveTo(m1[0], m1[1], m2[0], m2[1], tip[0], tip[1]);
  ctx.quadraticCurveTo(mid[0], mid[1], notch[0], notch[1]);
  ctx.fill();
  ctx.strokeStyle = rgba(lightOf(base, 0.7), 0.55);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(notch[0], notch[1]);
  ctx.quadraticCurveTo(mid[0], mid[1], P(0.85, 0)[0], P(0.85, 0)[1]);
  ctx.stroke();
  ctx.strokeStyle = rgba(lineOf(base), 0.45);
  ctx.lineWidth = 0.7;
  shape();
  ctx.stroke();
}

/** A wallpaper sprig: a curved stem with alternate, plump leaves (added to shared paths). */
function sprig(stems: Path2D, bases: Path2D, lits: Path2D, x: number, y: number, rot: number, flip: number): void {
  const m = new DOMMatrix().translate(x, y).rotate((rot * 180) / Math.PI).scale(flip, 1);
  const pt = (px: number, py: number): [number, number] => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f];
  const a = pt(-1, 12);
  const c = pt(3, 1);
  const b = pt(0, -11);
  stems.moveTo(a[0], a[1]);
  stems.quadraticCurveTo(c[0], c[1], b[0], b[1]);
  leafInto(bases, lits, m, 0.6, 7, 8.5, 3.2, -0.35);
  leafInto(bases, lits, m, 1.6, 1.5, 8, 3, Math.PI + 0.45);
  leafInto(bases, lits, m, 1.4, -4, 7.5, 2.9, -0.55);
  leafInto(bases, lits, m, 0, -11, 7, 2.8, -Math.PI / 2 - 0.12);
}

// --- Lower wall, rails and skirting ------------------------------------------

function woodDado(ctx: Ctx, theme: Theme, vx0: number, vx1: number, top: number, seed: number): void {
  const base = theme.wallLow;
  const y0 = top;
  const y1 = FLOOR_Y - SKIRT;
  if (theme.dado === 'panels') {
    // stiles and rails framing raised, bevelled panels
    const P = 54;
    const groove = rgba(shadowOf(base, 0.6), 0.5);
    const hi = rgba(lightOf(base, 0.75), 0.75);
    const lo = rgba(shadowOf(base, 0.45), 0.4);
    for (let x = Math.floor(vx0 / P) * P + 7; x < vx1; x += P) {
      const px = x + 5;
      const pw = P - 10;
      const py = y0 + 9;
      const ph = y1 - py - 7;
      // the recess: the frame's edge throws a little shade into it
      ctx.fillStyle = rgba(shadowOf(base, 0.5), 0.26);
      ctx.fillRect(px - 1.4, py - 1.4, pw + 2.8, ph + 2.8);
      ctx.fillStyle = groove;
      ctx.fillRect(px - 1.4, py - 1.4, pw + 2.8, 1.1);
      ctx.fillRect(px - 1.4, py - 1.4, 1.1, ph + 2.8);
      ctx.fillStyle = rgba(lightOf(base, 0.7), 0.6);
      ctx.fillRect(px - 1.4, py + ph + 0.6, pw + 2.8, 0.9);
      ctx.fillRect(px + pw + 0.6, py - 1.4, 0.9, ph + 2.8);
      // the raised field: a bevel ring around a flat face
      ctx.fillStyle = rgba(lightOf(base, 0.4), 0.3);
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = hi;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + pw, py);
      ctx.lineTo(px + pw - 4, py + 4);
      ctx.lineTo(px + 4, py + 4);
      ctx.lineTo(px + 4, py + ph - 4);
      ctx.lineTo(px, py + ph);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = lo;
      ctx.beginPath();
      ctx.moveTo(px + pw, py);
      ctx.lineTo(px + pw, py + ph);
      ctx.lineTo(px, py + ph);
      ctx.lineTo(px + 4, py + ph - 4);
      ctx.lineTo(px + pw - 4, py + ph - 4);
      ctx.lineTo(px + pw - 4, py + 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(lineOf(base), 0.22);
      ctx.lineWidth = 0.8;
      ctx.strokeRect(px + 4, py + 4, pw - 8, ph - 8);
    }
  } else {
    // tongue-and-groove boards with a bead beside each joint
    const P = 9.5;
    for (let x = Math.floor(vx0 / P) * P; x < vx1; x += P) {
      const k = Math.round(x / P);
      const t = hash01(seed + 3, k);
      if (t > 0.55) {
        ctx.fillStyle = rgba(t > 0.8 ? lightOf(base, 0.5) : shadowOf(base, 0.4), 0.16);
        ctx.fillRect(x, y0, P, y1 - y0);
      }
      ctx.fillStyle = rgba(lineOf(base), 0.34);
      ctx.fillRect(x - 0.45, y0, 0.9, y1 - y0);
      ctx.fillStyle = rgba(lightOf(base, 0.8), 0.55);
      ctx.fillRect(x + 0.5, y0, 0.8, y1 - y0);
      ctx.fillStyle = rgba(shadowOf(base, 0.4), 0.18);
      ctx.fillRect(x + 1.9, y0, 1.1, y1 - y0);
    }
  }
}

function chairRail(ctx: Ctx, theme: Theme, vx0: number, vx1: number, top: number): void {
  const trim = theme.trim;
  const y = top - RAIL + 1;
  const w = vx1 - vx0;
  const path = (): void => {
    ctx.beginPath();
    ctx.rect(vx0, y, w, RAIL);
  };
  railShadow(ctx, vx0, w, y + RAIL, 5, 0.26);
  ctx.fillStyle = trim;
  path();
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(trim, 0.7), 0.9);
  ctx.fillRect(vx0, y, w, 1.6);
  ctx.fillStyle = rgba(shadowOf(trim, 0.35), 0.5);
  ctx.fillRect(vx0, y + 1.9, w, 0.7);
  ctx.fillStyle = rgba(lightOf(trim, 1), 0.8);
  ctx.fillRect(vx0, y + 3, w, 0.8);
  ctx.fillStyle = rgba(shadowOf(trim, 0.45), 0.55);
  ctx.fillRect(vx0, y + RAIL - 1.6, w, 1.6);
  paintTex(ctx, path, 'brush', 0.2, 0.5, 0.5, vx0, y);
  ctx.fillStyle = rgba(lineOf(trim), 0.35);
  ctx.fillRect(vx0, y + RAIL - 0.5, w, 0.6);
}

/** The soft shade a moulding throws on the wall just below it. */
function railShadow(ctx: Ctx, x: number, w: number, y: number, h: number, alpha: number): void {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, rgba('#4A4060', alpha));
  g.addColorStop(0.35, rgba('#4A4060', alpha * 0.45));
  g.addColorStop(1, rgba('#4A4060', 0));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/**
 * Glazed tiles over a region: each tile has its own tone, a lit and a shaded
 * lip and sometimes a glint. Eight tile variants are painted once as sprites
 * and stamped across the wall.
 */
function glazedTiles(ctx: Ctx, base: string, x0: number, x1: number, y0: number, y1: number, S: number, seed: number, alpha: number): void {
  const tones = [base, mix(base, lightOf(base, 0.5), 0.45), mix(base, shadowOf(base, 0.4), 0.25), mix(base, lightOf(base, 0.3), 0.8)];
  const ts = S - 1.8;
  const variants = tones.map((t) =>
    [false, true].map((glow) =>
      sprite(ctx, `tile${t}${S}${alpha}${glow}`, ts / 2 + 0.5, (g) => {
        const o = -ts / 2;
        g.fillStyle = rgba(t, alpha);
        roundRect(g, o, o, ts, ts, 1.6);
        g.fill();
        g.fillStyle = rgba(lightOf(base, 0.85), 0.55);
        g.beginPath();
        g.moveTo(o + 1, o + 0.4);
        g.lineTo(o + ts - 1.5, o + 0.4);
        g.lineTo(o + ts - 3, o + 2);
        g.lineTo(o + 2, o + 2);
        g.lineTo(o + 2, o + ts - 3);
        g.lineTo(o + 0.4, o + ts - 1.5);
        g.lineTo(o + 0.4, o + 1);
        g.closePath();
        g.fill();
        g.fillStyle = rgba(shadowOf(base, 0.5), 0.3);
        g.beginPath();
        g.moveTo(o + ts - 0.4, o + 1.5);
        g.lineTo(o + ts - 0.4, o + ts - 1);
        g.lineTo(o + ts - 1, o + ts - 0.4);
        g.lineTo(o + 1.5, o + ts - 0.4);
        g.lineTo(o + 3, o + ts - 2.2);
        g.lineTo(o + ts - 2.2, o + ts - 2.2);
        g.lineTo(o + ts - 2.2, o + 3);
        g.closePath();
        g.fill();
        if (glow) {
          g.fillStyle = 'rgba(255,253,246,0.4)';
          g.beginPath();
          g.ellipse(o + ts * 0.32, o + ts * 0.3, ts * 0.17, ts * 0.07, -0.6, 0, Math.PI * 2);
          g.fill();
        }
      }),
    ),
  );
  for (let y = y0, r = 0; y < y1; y += S, r++) {
    for (let x = x0; x < x1; x += S) {
      const h = hash01(seed + Math.round(x), r * 31 + 7);
      stamp(ctx, variants[Math.floor(h * tones.length)][h > 0.45 ? 1 : 0], x + S / 2, y + S / 2);
    }
  }
}

function tileGrout(theme: Theme): string {
  return mix(theme.wallLow, '#F4EEE3', 0.5);
}

const TILE = 21;

function tileDado(ctx: Ctx, theme: Theme, vx0: number, vx1: number): void {
  const grout = tileGrout(theme);
  const y0 = TILE_TOP + 4;
  const y1 = FLOOR_Y - SKIRT;
  // each tile: its own glaze tone over the washed wall (keeps the room's light)
  glazedTiles(ctx, theme.wallLow, Math.floor(vx0 / TILE) * TILE, vx1, y0, y1, TILE, 0, 0.9);
  // grout lines, slightly sunken
  ctx.fillStyle = rgba(shadowOf(grout, 0.35), 0.35);
  ctx.beginPath();
  for (let y = y0; y < y1; y += TILE) ctx.rect(vx0, y - 0.2, vx1 - vx0, 0.7);
  for (let x = Math.floor(vx0 / TILE) * TILE; x < vx1; x += TILE) ctx.rect(x - 0.2, y0, 0.7, y1 - y0);
  ctx.fill();
}

function tileCap(ctx: Ctx, theme: Theme, vx0: number, vx1: number): void {
  const w = vx1 - vx0;
  // a row of pencil liner tiles in the accent, then a bullnose cap
  const liner = mix(theme.accent, theme.wallLow, 0.35);
  const ly = TILE_TOP - 1;
  const lp = (): void => {
    ctx.beginPath();
    ctx.rect(vx0, ly, w, 5);
  };
  ctx.fillStyle = liner;
  lp();
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(liner, 0.8), 0.7);
  ctx.fillRect(vx0, ly + 0.6, w, 1.2);
  ctx.fillStyle = rgba(shadowOf(liner, 0.5), 0.5);
  ctx.fillRect(vx0, ly + 3.6, w, 1.4);
  for (let x = Math.floor(vx0 / 42) * 42; x < vx1; x += 42) {
    ctx.fillStyle = rgba(lineOf(liner), 0.35);
    ctx.fillRect(x, ly, 0.8, 5);
  }
  const cy = TILE_TOP - 7;
  const cp = (): void => {
    ctx.beginPath();
    ctx.rect(vx0, cy, w, 6);
  };
  railShadow(ctx, vx0, w, cy + 6, 4, 0.22);
  ctx.fillStyle = theme.trim;
  cp();
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(theme.trim, 1), 0.9);
  ctx.fillRect(vx0, cy + 1.2, w, 1.4);
  ctx.fillStyle = rgba(shadowOf(theme.trim, 0.45), 0.5);
  ctx.fillRect(vx0, cy + 4.3, w, 1.7);
  ctx.fillStyle = rgba(lineOf(theme.trim), 0.3);
  ctx.fillRect(vx0, cy, w, 0.6);
  ctx.fillRect(vx0, cy + 5.5, w, 0.6);
}

function skirting(ctx: Ctx, theme: Theme, vx0: number, vx1: number): void {
  const trim = theme.trim;
  const y = FLOOR_Y - SKIRT;
  const w = vx1 - vx0;
  const path = (): void => {
    ctx.beginPath();
    ctx.rect(vx0, y, w, SKIRT);
  };
  railShadow(ctx, vx0, w, y - 1.5, 3, 0.14);
  ctx.fillStyle = trim;
  path();
  ctx.fill();
  // profile: a rounded cap, a shadowed quirk under it, a flat face that
  // deepens toward the floor, and a small shoe moulding at the bottom
  const g = ctx.createLinearGradient(0, y, 0, FLOOR_Y);
  const S = SKIRT;
  g.addColorStop(0, rgba(shadowOf(trim, 0.3), 0.35));
  g.addColorStop(0.6 / S, rgba(lightOf(trim, 1), 0.95));
  g.addColorStop(1.8 / S, rgba(lightOf(trim, 0.8), 0.6));
  g.addColorStop(3 / S, rgba(shadowOf(trim, 0.35), 0.38));
  g.addColorStop(3.4 / S, rgba(shadowOf(trim, 0.6), 0.55));
  g.addColorStop(4.4 / S, rgba(shadowOf(trim, 0.3), 0.22));
  g.addColorStop(6 / S, rgba(trim, 0));
  g.addColorStop(9.6 / S, rgba(shadowOf(trim, 0.3), 0.2));
  g.addColorStop(10 / S, rgba(lightOf(trim, 0.9), 0.75));
  g.addColorStop(10.8 / S, rgba(shadowOf(trim, 0.35), 0.3));
  g.addColorStop(1, rgba(shadowOf(trim, 0.55), 0.55));
  ctx.fillStyle = g;
  path();
  ctx.fill();
  paintTex(ctx, path, 'brush', 0.22, 0.5, 0.5, vx0, y + 7);
  ctx.fillStyle = rgba(lineOf(trim), 0.32);
  ctx.fillRect(vx0, y - 0.3, w, 0.6);
  ctx.fillStyle = rgba(lineOf(trim), 0.5);
  ctx.fillRect(vx0, FLOOR_Y - 0.7, w, 0.9);
}

/** Horizontal offset of a board joint over a row of height h (lines run toward the vanishing point). */
function skewAt(x: number, y: number, h: number): number {
  return ((x - VPX) * h) / (y - VPY);
}

/** The plank floor in front of the skirting, down to vy1 (and a little past). */
export function paintFloor(ctx: Ctx, theme: Theme, vx0: number, vx1: number, vy1: number, seed: number): void {
  const base = theme.floor;
  const fy = FLOOR_Y;
  const w = vx1 - vx0;
  const yEnd = Math.max(vy1, fy + 200);
  ctx.save();
  // base light: occlusion at the skirting, a soft sheen, falling into shade toward us
  const lg = ctx.createLinearGradient(0, fy, 0, yEnd);
  const span = yEnd - fy;
  const dark = shadowOf(base, 0.75);
  lg.addColorStop(0, dark);
  lg.addColorStop(4 / span, mix(base, dark, 0.55));
  lg.addColorStop(16 / span, mix(base, dark, 0.15));
  lg.addColorStop(48 / span, lightOf(base, 0.16));
  lg.addColorStop(110 / span, base);
  lg.addColorStop(1, mix(base, shadowOf(base, 0.6), 0.45));
  ctx.fillStyle = lg;
  ctx.fillRect(vx0, fy, w, yEnd - fy);
  const tints = [rgba(lightOf(base, 0.6), 0.16), rgba(shadowOf(base, 0.6), 0.14), '', rgba(lightOf(base, 0.4), 0.28), rgba(shadowOf(base, 0.4), 0.26), ''];
  const seam = rgba(lineOf(base), 0.42);
  const edge = rgba(lightOf(base, 0.7), 0.3);
  const grain = bakedTexture([['wood', 0.5], ['plaster', 0.12]], lightOf(base, 0.7), shadowOf(base, 0.75));
  const joints = new Path2D();
  const lips = new Path2D();
  const rowSeams = new Path2D();
  const rowLips = new Path2D();
  let yTop = fy;
  for (let k = 1; yTop < vy1 && k < 40; k++) {
    const yBot = fy + 2.4 * k + 2.1 * k * k;
    const rh = yBot - yTop;
    const depth = (yTop + rh / 2 - VPY) / (fy - VPY);
    let x = vx0 - (10 + hash01(seed, k * 13) * 100) * depth;
    for (let j = 0; x < vx1; j++) {
      const len = (74 + hash01(seed + k * 31, j) * 76) * depth;
      const xa = x;
      const xb = x + len;
      const board = (): void => {
        ctx.beginPath();
        ctx.moveTo(xa, yTop);
        ctx.lineTo(xb, yTop);
        ctx.lineTo(xb + skewAt(xb, yTop, rh), yBot);
        ctx.lineTo(xa + skewAt(xa, yTop, rh), yBot);
        ctx.closePath();
      };
      const tint = tints[Math.floor(hash01(seed + k * 17, j + 5) * tints.length)];
      if (tint) {
        ctx.fillStyle = tint;
        board();
        ctx.fill();
      }
      bakedFill(ctx, board, grain, 0.55 * depth, Math.max(0.1, rh / 90), xa - hash01(seed + k, j * 3) * 240, yTop - hash01(seed + k, j * 3 + 1) * 240);
      // butt joint: a dark hairline with a lit lip beside it (stroked in one go below)
      joints.moveTo(xa, yTop);
      joints.lineTo(xa + skewAt(xa, yTop, rh), yBot);
      lips.moveTo(xa + 0.8, yTop + 0.6);
      lips.lineTo(xa + 0.8 + skewAt(xa, yTop, rh), yBot - 0.4);
      x = xb;
    }
    // seam between rows, the near board's edge catching the light
    rowSeams.rect(vx0, yTop - 0.4, w, Math.min(0.9, 0.35 + rh * 0.03));
    rowLips.rect(vx0, yTop + 0.55, w, Math.min(1, 0.4 + rh * 0.025));
    yTop = yBot;
  }
  ctx.fillStyle = seam;
  ctx.fill(rowSeams);
  ctx.fillStyle = edge;
  ctx.fill(rowLips);
  ctx.strokeStyle = seam;
  ctx.lineWidth = 0.85;
  ctx.stroke(joints);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 0.7;
  ctx.stroke(lips);
  // the floor catches the window light
  ctx.translate(WORLD_W * 0.4, fy + 42);
  ctx.scale(2.8, 1);
  const sh = ctx.createRadialGradient(0, 0, 0, 0, 0, 56);
  sh.addColorStop(0, rgba(lightOf(base, 0.9), 0.2));
  sh.addColorStop(1, rgba(lightOf(base, 0.9), 0));
  ctx.fillStyle = sh;
  ctx.fillRect(-56, -40, 112, 96);
  ctx.restore();
}

// --- Sunbeams ------------------------------------------------------------------

/** Sunlight comes from the upper left: per unit of drop it drifts right. */
/** Sideways drift of window light per unit it falls (the sun is up and to the left). */
export const SUN_DRIFT = 0.27;

interface WinBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function windowBox(d: DecorPlacement): WinBox {
  const w = d.w ?? 110;
  const h = d.h ?? 130;
  return { x: d.x - w / 2, y: d.y, w, h };
}

/**
 * Where light through a point of the window lands on the floor. Light through
 * the bottom of the window lands near the wall, through the top further toward
 * us; the depth is squeezed so the patch stays in the strip of floor we see.
 */
function sunOnFloor(px: number, py: number, b: WinBox): [number, number] {
  return [px + (FLOOR_Y - py) * SUN_DRIFT, FLOOR_Y + 7 + (b.y + b.h - py) * 0.2];
}

/** Sunbeams from windows, drawn over the back layer: soft shafts and a warm patch on the floor (the renderer adds drifting dust). */
export function drawSunbeams(ctx: Ctx, decor: DecorPlacement[]): void {
  for (const d of decor) {
    if (d.type !== 'window') continue;
    const b = windowBox(d);
    const night = d.variant === 3;
    ctx.save();
    lightShafts(ctx, b, night);
    ctx.restore();
  }
}

function lightShafts(ctx: Ctx, b: WinBox, night: boolean): void {
  const { x, y, w, h } = b;
  const mid = x + w / 2;
  const tr = y + h * 0.45; // transom
  const col: [number, number, number] = night ? [196, 206, 255] : [255, 222, 168];
  const peak = night ? 0.12 : 0.4;
  const c = (a: number): string => `rgba(${col[0]},${col[1]},${col[2]},${a})`;
  const cols: Array<[number, number]> = [
    [x + 3, mid - 2.6],
    [mid + 2.6, x + w - 3],
  ];
  // a shaft falling from the glass to the floor; two nested passes give it
  // soft edges
  {
    const c0 = x + 3;
    const c1 = x + w - 3;
    const a0 = y + h * 0.7;
    const a1 = y + h * 0.28;
    const [f0x, f0y] = sunOnFloor(c0, y + h, b);
    const [f1x, f1y] = sunOnFloor(c1, y, b);
    const g = ctx.createLinearGradient((c0 + c1) / 2, (a0 + a1) / 2, (f0x + f1x) / 2, (f0y + f1y) / 2);
    g.addColorStop(0, c(0));
    g.addColorStop(0.1, c(peak));
    g.addColorStop(0.55, c(peak * 0.5));
    g.addColorStop(1, c(peak * 0.3));
    ctx.fillStyle = g;
    for (let k = 0; k < 2; k++) {
      const ins = (c1 - c0) * 0.16 * k;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(c0 + ins, a0);
      ctx.lineTo(c1 - ins, a1);
      ctx.lineTo(f1x - ins, f1y);
      ctx.lineTo(f0x + ins, f0y);
      ctx.closePath();
      ctx.fill();
    }
  }
  // the warm patch on the floor: four panes, softened by a light-coloured
  // "shadow" (source-over only: a blend mode here would composite the whole canvas)
  const patch = (): void => {
    ctx.beginPath();
    for (const [c0, c1] of cols) {
      for (const [r0, r1] of [
        [y + 3, tr - 2.6],
        [tr + 2.6, y + h - 3],
      ]) {
        const p = [sunOnFloor(c0, r0, b), sunOnFloor(c1, r0, b), sunOnFloor(c1, r1, b), sunOnFloor(c0, r1, b)];
        ctx.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
        ctx.closePath();
      }
    }
  };
  castShadow(ctx, patch, 0, 0, 3.5, night ? 0.16 : 0.42, night ? '#C4CEFF' : '#FFE0A8');
  ctx.globalAlpha = night ? 0.08 : 0.26;
  ctx.fillStyle = night ? '#D8DEFF' : '#FFF3DA';
  patch();
  ctx.fill();
  ctx.globalAlpha = 1;
}

// --- Windows ---------------------------------------------------------------------

function drawWindow(ctx: Ctx, d: DecorPlacement, theme: Theme, seed: number): void {
  const b = windowBox(d);
  const { x, y, w, h } = b;
  const v = d.variant ?? 0;
  const night = v === 3;
  const trim = theme.trim;
  // the window lights the wall around it
  const cx = x + w / 2;
  const cy = y + h * 0.5;
  const R = Math.max(w, h) * 0.75 + 12;
  const glow = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, R);
  glow.addColorStop(0, night ? 'rgba(170,180,240,0.16)' : 'rgba(255,246,222,0.45)');
  glow.addColorStop(1, night ? 'rgba(170,180,240,0)' : 'rgba(255,246,222,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  // casing (architrave) with its shadow on the wall
  const casing = (): void => roundRect(ctx, x - 10, y - 10, w + 20, h + 20, 3);
  rectDrop(ctx, x - 10, y - 10, w + 20, h + 20, 2.6, 4, 0.3);
  ctx.fillStyle = trim;
  casing();
  ctx.fill();
  bevelRing(ctx, x - 10, y - 10, w + 20, h + 20, 6, trim);
  paintTex(ctx, casing, 'brush', 0.22, 0.45, 0.45, x);
  inkLine(ctx, casing, trim, 1, 0.55);
  // the reveal: the depth of the wall, shaded on top and left, lit below
  const rv = (): void => roundRect(ctx, x - 4, y - 4, w + 8, h + 8, 1.5);
  ctx.fillStyle = shadowOf(trim, 0.22);
  rv();
  ctx.fill();
  ctx.fillStyle = rgba(shadowOf(trim, 0.6), 0.45);
  ctx.fillRect(x - 4, y - 4, w + 8, 3.4);
  ctx.fillRect(x - 4, y - 4, 2.6, h + 8);
  ctx.fillStyle = rgba(lightOf(trim, 1), 0.85);
  ctx.fillRect(x - 3, y + h + 1.2, w + 6, 2.6);
  // the view
  ctx.save();
  clipRect(ctx, x, y, w, h);
  windowView(ctx, b, v, seed);
  glassSheen(ctx, b, night);
  ctx.restore();
  // sash frame and glazing bars, bevelled
  sashBars(ctx, b, trim);
  // a little sill ledge
  const sl = (): void => roundRect(ctx, x - 15, y + h + 8, w + 30, 5, 1.6);
  castShadow(ctx, sl, 1.5, 3, 3, 0.28);
  ctx.fillStyle = trim;
  sl();
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(trim, 1), 0.9);
  ctx.fillRect(x - 14, y + h + 8.4, w + 28, 1.6);
  ctx.fillStyle = rgba(shadowOf(trim, 0.45), 0.5);
  ctx.fillRect(x - 14, y + h + 11, w + 28, 2);
  inkLine(ctx, sl, trim, 0.9, 0.5);
  if (v === 1) rollerBlind(ctx, b, theme, seed);
  if (v % 2 === 0) {
    const cloth = mix(theme.accent, theme.wall, 0.22);
    curtainRod(ctx, b, theme);
    curtain(ctx, b, -1, cloth, seed);
    curtain(ctx, b, 1, cloth, seed + 5);
    curtainRings(ctx, b);
  }
}

/**
 * A cheap soft drop shadow for big shapes: the shape filled three times at
 * growing offsets with falling alpha (no blur pass).
 */
function softDrop(ctx: Ctx, path: () => void, dx: number, dy: number, alpha: number): void {
  ctx.save();
  ctx.fillStyle = '#4A4060';
  for (const [f, a] of [
    [1.4, 0.28],
    [1, 0.34],
    [0.6, 0.42],
  ]) {
    ctx.save();
    ctx.translate(dx * f, dy * f);
    ctx.globalAlpha = alpha * a;
    path();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Soft drop shadow of a rectangle, drawing only the part that shows beside it. */
function rectDrop(ctx: Ctx, x: number, y: number, w: number, h: number, dx: number, dy: number, alpha: number): void {
  ctx.save();
  ctx.fillStyle = '#4A4060';
  for (const [f, a] of [
    [1.45, 0.28],
    [1, 0.34],
    [0.6, 0.42],
  ]) {
    const ox = dx * f;
    const oy = dy * f;
    ctx.globalAlpha = alpha * a;
    ctx.beginPath();
    ctx.moveTo(x + w, y + oy + 2);
    ctx.lineTo(x + w + ox, y + oy + 2);
    ctx.lineTo(x + w + ox, y + h + oy);
    ctx.lineTo(x + ox + 2, y + h + oy);
    ctx.lineTo(x + ox + 2, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Bevelled ring of a frame (lit top/left faces, shaded bottom/right) of width `bw`. */
function bevelRing(ctx: Ctx, x: number, y: number, w: number, h: number, bw: number, base: string): void {
  const hi = rgba(lightOf(base, 0.9), 0.85);
  const lo = rgba(shadowOf(base, 0.45), 0.5);
  const x1 = x + w;
  const y1 = y + h;
  // top + left (outer slope)
  ctx.fillStyle = hi;
  ctx.beginPath();
  ctx.moveTo(x + 1, y + 1);
  ctx.lineTo(x1 - 1, y + 1);
  ctx.lineTo(x1 - bw * 0.45, y + bw * 0.45);
  ctx.lineTo(x + bw * 0.45, y + bw * 0.45);
  ctx.lineTo(x + bw * 0.45, y1 - bw * 0.45);
  ctx.lineTo(x + 1, y1 - 1);
  ctx.closePath();
  ctx.fill();
  // bottom + right
  ctx.fillStyle = lo;
  ctx.beginPath();
  ctx.moveTo(x1 - 1, y + 1);
  ctx.lineTo(x1 - 1, y1 - 1);
  ctx.lineTo(x + 1, y1 - 1);
  ctx.lineTo(x + bw * 0.45, y1 - bw * 0.45);
  ctx.lineTo(x1 - bw * 0.45, y1 - bw * 0.45);
  ctx.lineTo(x1 - bw * 0.45, y + bw * 0.45);
  ctx.closePath();
  ctx.fill();
  // the inner quirk: a fine groove at the inner edge
  ctx.strokeStyle = rgba(lineOf(base), 0.28);
  ctx.lineWidth = 0.7;
  ctx.strokeRect(x + bw * 0.7, y + bw * 0.7, w - bw * 1.4, h - bw * 1.4);
}

/** Smooth ridge line through points, closed down to `bottom` (for hills). */
function ridge(ctx: Ctx, x0: number, x1: number, ys: number[], bottom: number): void {
  const n = ys.length;
  const dx = (x1 - x0) / (n - 1);
  ctx.beginPath();
  ctx.moveTo(x0 - 2, bottom);
  ctx.lineTo(x0 - 2, ys[0]);
  for (let i = 0; i < n - 1; i++) {
    const xa = x0 + i * dx;
    const xb = xa + dx;
    ctx.quadraticCurveTo(xa, ys[i], (xa + xb) / 2, (ys[i] + ys[i + 1]) / 2);
  }
  ctx.lineTo(x1 + 2, ys[n - 1]);
  ctx.lineTo(x1 + 2, bottom);
  ctx.closePath();
}

function hillYs(seed: number, n: number, base: number, amp: number): number[] {
  const ys: number[] = [];
  const p1 = hash01(seed, 1) * 6.28;
  const p2 = hash01(seed, 2) * 6.28;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    ys.push(base - amp * (0.55 * Math.sin(t * 3.4 + p1) + 0.45 * Math.sin(t * 7.1 + p2)));
  }
  return ys;
}

/** Y of a ridge (as built by hillYs) at fraction t. */
function ridgeAt(ys: number[], t: number): number {
  const f = Math.max(0, Math.min(ys.length - 1.001, t * (ys.length - 1)));
  const i = Math.floor(f);
  const u = f - i;
  return ys[i] + (ys[i + 1] - ys[i]) * u;
}

/** A soft gouache cloud: puffs lit on top, a little lavender shade beneath. */
function cloud(ctx: Ctx, cx: number, cy: number, s: number, seed: number, lit: string, shade2: string, alpha: number): void {
  const puffs: Array<[number, number, number]> = [];
  const n = 4 + Math.floor(hash01(seed, 3) * 2);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5;
    const r = s * (0.32 + (1 - Math.abs(t) * 1.6) * 0.28 + hash01(seed, i + 10) * 0.08);
    puffs.push([cx + t * s * 1.9, cy - r * 0.55 + hash01(seed, i + 20) * s * 0.08, r]);
  }
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = shade2;
  ctx.beginPath();
  for (const [px, py, r] of puffs) {
    ctx.moveTo(px + 0.6 + r, py + s * 0.12);
    ctx.arc(px + 0.6, py + s * 0.12, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = lit;
  ctx.beginPath();
  for (const [px, py, r] of puffs) {
    ctx.moveTo(px + r * 0.94, py);
    ctx.arc(px, py, r * 0.94, 0, Math.PI * 2);
  }
  ctx.fill();
  // flat-ish base
  ctx.fillStyle = shade2;
  ctx.fillRect(cx - s * 1.05, cy + s * 0.04, s * 2.1, s * 0.12);
  ctx.restore();
}

/** A round storybook tree: trunk and a two-tone canopy (lit upper left). */
function tree(ctx: Ctx, x: number, y: number, s: number, green: string, trunk: string, poplar: boolean): void {
  ctx.fillStyle = trunk;
  ctx.fillRect(x - s * 0.08, y - s * 0.55, s * 0.16, s * 0.6);
  const lit = lightOf(green, 0.45);
  const dark = shadowOf(green, 0.35);
  if (poplar) {
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(x + s * 0.05, y - s * 1.15, s * 0.3, s * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = green;
    ctx.beginPath();
    ctx.ellipse(x - s * 0.02, y - s * 1.2, s * 0.25, s * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = lit;
    ctx.beginPath();
    ctx.ellipse(x - s * 0.1, y - s * 1.38, s * 0.12, s * 0.45, 0.1, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(x + s * 0.12, y - s * 0.78, s * 0.5, 0, Math.PI * 2);
  ctx.arc(x - s * 0.3, y - s * 0.72, s * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = green;
  ctx.beginPath();
  ctx.arc(x + s * 0.02, y - s * 0.9, s * 0.46, 0, Math.PI * 2);
  ctx.arc(x - s * 0.32, y - s * 0.76, s * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = lit;
  ctx.beginPath();
  ctx.arc(x - s * 0.14, y - s * 1.06, s * 0.26, 0, Math.PI * 2);
  ctx.fill();
}

/** The painted landscape seen through a window (clipped to the glass by the caller). */
function windowView(ctx: Ctx, b: WinBox, v: number, seed: number): void {
  const { x, y, w, h } = b;
  const night = v === 3;
  const golden = v === 2;
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  if (night) {
    sky.addColorStop(0, '#262B54');
    sky.addColorStop(0.55, '#3B3D70');
    sky.addColorStop(0.85, '#5A5186');
    sky.addColorStop(1, '#6E6092');
  } else if (golden) {
    sky.addColorStop(0, '#A9BFDD');
    sky.addColorStop(0.42, '#EAD6C8');
    sky.addColorStop(0.7, '#F7CDA0');
    sky.addColorStop(1, '#F4BE8E');
  } else {
    sky.addColorStop(0, v === 1 ? '#A6CBE5' : '#9DC2E0');
    sky.addColorStop(0.5, '#CDE2EF');
    sky.addColorStop(0.78, '#F4E9D2');
    sky.addColorStop(1, '#F7DFB5');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  if (night) {
    nightSky(ctx, b, sky, seed);
  } else {
    // the sun and its warm bloom
    const sx = x + w * (v === 1 ? 0.28 : 0.7);
    const sy = y + h * (golden ? 0.56 : v === 1 ? 0.3 : 0.36);
    const bloom = ctx.createRadialGradient(sx, sy, 0, sx, sy, w * 0.75);
    bloom.addColorStop(0, 'rgba(255,248,226,0.95)');
    bloom.addColorStop(0.18, 'rgba(255,240,206,0.7)');
    bloom.addColorStop(0.5, 'rgba(255,232,190,0.2)');
    bloom.addColorStop(1, 'rgba(255,232,190,0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = golden ? '#FFF1D2' : '#FFF8E6';
    ctx.beginPath();
    ctx.arc(sx, sy, w * 0.085, 0, Math.PI * 2);
    ctx.fill();
    // clouds
    const nc = 2 + Math.floor(hash01(seed, 7) * 2);
    for (let k = 0; k < nc; k++) {
      const cx = x + w * (0.12 + ((k + hash01(seed, k + 30) * 0.7) / nc) * 0.85);
      const cy = y + h * (0.12 + hash01(seed, k + 40) * 0.22);
      cloud(ctx, cx, cy, w * (0.11 + hash01(seed, k + 50) * 0.05), seed + k * 17, golden ? '#FFF3E6' : '#FFFDF6', golden ? '#E9C9C4' : '#D9DCEC', 0.92);
    }
  }
  // far hills (hazy), mid hills with trees, a near meadow
  const farC = night ? '#3A3F6A' : golden ? '#C9B7B9' : '#A9C2C6';
  const midC = night ? '#30365C' : golden ? '#B4B48A' : '#A3BF94';
  const nearC = night ? '#282D4E' : golden ? '#A3A774' : '#8EB083';
  const far = hillYs(seed + 3, 7, y + h * 0.64, h * 0.05);
  ctx.fillStyle = farC;
  ridge(ctx, x, x + w, far, y + h + 2);
  ctx.fill();
  const midY = hillYs(seed + 9, 6, y + h * 0.75, h * 0.045);
  ctx.fillStyle = midC;
  ridge(ctx, x, x + w, midY, y + h + 2);
  ctx.fill();
  if (!night) {
    // sunlit crest
    ctx.strokeStyle = rgba(lightOf(midC, 0.7), 0.7);
    ctx.lineWidth = 1.1;
    ridge(ctx, x, x + w, midY.map((v2) => v2 + 0.6), y + h + 40);
    ctx.stroke();
  }
  const trunk = night ? '#252846' : '#8A7262';
  const nt = 3 + Math.floor(hash01(seed, 60) * 3);
  for (let k = 0; k < nt; k++) {
    const t = (k + 0.2 + hash01(seed, k + 61) * 0.6) / nt;
    const tx = x + w * t;
    const ty = ridgeAt(midY, t) + 1.2;
    const ts = h * (0.09 + hash01(seed, k + 70) * 0.06);
    tree(ctx, tx, ty, ts, night ? '#2C3358' : golden ? '#8E9A62' : '#7FA275', trunk, hash01(seed, k + 80) > 0.65);
  }
  if (night) cottage(ctx, x + w * (0.25 + hash01(seed, 90) * 0.5), ridgeAt(midY, 0.25 + hash01(seed, 90) * 0.5) + 2, h * 0.08);
  const near = hillYs(seed + 21, 5, y + h * 0.9, h * 0.03);
  ctx.fillStyle = nearC;
  ridge(ctx, x, x + w, near, y + h + 2);
  ctx.fill();
  if (!night) {
    // a few flower dots in the meadow
    for (let k = 0; k < 7; k++) {
      const t = hash01(seed, k + 100);
      ctx.fillStyle = k % 2 ? 'rgba(255,250,236,0.85)' : 'rgba(246,206,140,0.85)';
      ctx.beginPath();
      ctx.arc(x + w * t, ridgeAt(near, t) + 3 + hash01(seed, k + 110) * (h * 0.06), 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // haze over the distance
    const hz = ctx.createLinearGradient(0, y + h * 0.5, 0, y + h * 0.8);
    hz.addColorStop(0, 'rgba(255,248,232,0)');
    hz.addColorStop(0.6, golden ? 'rgba(255,226,196,0.28)' : 'rgba(255,248,232,0.22)');
    hz.addColorStop(1, 'rgba(255,248,232,0)');
    ctx.fillStyle = hz;
    ctx.fillRect(x, y + h * 0.5, w, h * 0.3);
  }
  if (v === 1) blossomBranch(ctx, b, seed);
}

function nightSky(ctx: Ctx, b: WinBox, sky: CanvasGradient, seed: number): void {
  const { x, y, w, h } = b;
  // stars, a few of them twinkling
  for (let k = 0; k < 22; k++) {
    const sx = x + hash01(seed, k + 40) * w;
    const sy = y + hash01(seed, k + 80) * h * 0.62;
    const big = hash01(seed, k + 120) > 0.82;
    const a = 0.55 + hash01(seed, k + 160) * 0.45;
    if (big) {
      sparkle(ctx, sx, sy, 2.2, '#FFF6D8', a);
    } else {
      ctx.fillStyle = `rgba(255,246,220,${a})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 0.45 + hash01(seed, k + 200) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // crescent moon with a soft halo
  const mx = x + w * 0.68;
  const my = y + h * 0.26;
  const mr = w * 0.12;
  ctx.fillStyle = '#FFF2C8';
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = sky;
  ctx.beginPath();
  ctx.arc(mx + mr * 0.45, my - mr * 0.28, mr * 0.88, 0, Math.PI * 2);
  ctx.fill();
  const halo = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 3.6);
  halo.addColorStop(0, 'rgba(255,240,200,0.3)');
  halo.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(mx - mr * 3.6, my - mr * 3.6, mr * 7.2, mr * 7.2);
  // thin moonlit wisps
  for (let k = 0; k < 2; k++) {
    const cy = y + h * (0.36 + k * 0.14);
    const cx = x + w * (0.3 + hash01(seed, k + 9) * 0.4);
    ctx.fillStyle = 'rgba(180,176,226,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, w * 0.26, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(214,208,244,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx - w * 0.05, cy - 1, w * 0.16, 1.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A tiny far-off cottage with a lit window (night views). */
function cottage(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.fillStyle = '#323659';
  ctx.fillRect(x - s * 0.6, y - s * 0.9, s * 1.2, s * 0.9);
  ctx.fillStyle = '#2A2C4A';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.8, y - s * 0.85);
  ctx.lineTo(x, y - s * 1.55);
  ctx.lineTo(x + s * 0.8, y - s * 0.85);
  ctx.closePath();
  ctx.fill();
  const g = ctx.createRadialGradient(x + s * 0.15, y - s * 0.45, 0, x + s * 0.15, y - s * 0.45, s * 1.3);
  g.addColorStop(0, 'rgba(255,214,140,0.5)');
  g.addColorStop(1, 'rgba(255,214,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - s * 1.2, y - s * 1.8, s * 2.6, s * 2.6);
  ctx.fillStyle = '#FFD98E';
  ctx.fillRect(x + s * 0.02, y - s * 0.6, s * 0.3, s * 0.28);
}

/** A blossom branch reaching into the top corner of the view. */
function blossomBranch(ctx: Ctx, b: WinBox, seed: number): void {
  const { x, y, w, h } = b;
  const bx = x + w + 2;
  const by = y + h * 0.05;
  ctx.strokeStyle = '#7C6560';
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.quadraticCurveTo(x + w * 0.75, y + h * 0.1, x + w * 0.5, y + h * 0.2);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.74, y + h * 0.11);
  ctx.quadraticCurveTo(x + w * 0.68, y + h * 0.2, x + w * 0.62, y + h * 0.27);
  ctx.stroke();
  const leaf = '#8DB07E';
  for (let k = 0; k < 9; k++) {
    const t = k / 8;
    const px = bx + (x + w * 0.5 - bx) * t + jit(seed, k) * 3;
    const py = by + (y + h * 0.2 - by) * t + Math.sin(t * 3) * 3 + jit(seed, k + 9) * 2;
    if (k % 3 === 1) leafShape(ctx, px, py, 5.5, 1.8, 1.2 + jit(seed, k + 20) * 0.8, leaf, lightOf(leaf, 0.4));
    else {
      ctx.fillStyle = k % 2 ? '#F4C9CF' : '#F8DDE0';
      ctx.beginPath();
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 + k;
        ctx.moveTo(px + Math.cos(a) * 1.5 + 1.2, py + Math.sin(a) * 1.5);
        ctx.arc(px + Math.cos(a) * 1.5, py + Math.sin(a) * 1.5, 1.2, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.fillStyle = '#E8A0A8';
      ctx.beginPath();
      ctx.arc(px, py, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Glass: a faint cool tint, reflections streaking across each pane, darker near the frame. */
function glassSheen(ctx: Ctx, b: WinBox, night: boolean): void {
  const { x, y, w, h } = b;
  const tint2 = ctx.createLinearGradient(0, y, 0, y + h);
  tint2.addColorStop(0, night ? 'rgba(150,160,220,0.08)' : 'rgba(236,244,250,0.18)');
  tint2.addColorStop(1, 'rgba(236,244,250,0)');
  ctx.fillStyle = tint2;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.globalAlpha = night ? 0.1 : 0.22;
  ctx.fillStyle = '#FFFFFF';
  for (const [px, py, pw, ph] of [
    [x, y, w / 2, h * 0.45],
    [x + w / 2, y, w / 2, h * 0.45],
    [x, y + h * 0.45, w / 2, h * 0.55],
    [x + w / 2, y + h * 0.45, w / 2, h * 0.55],
  ]) {
    ctx.beginPath();
    ctx.moveTo(px + pw * 0.18, py + ph);
    ctx.lineTo(px + pw * 0.42, py + ph);
    ctx.lineTo(px + pw * 0.9, py);
    ctx.lineTo(px + pw * 0.66, py);
    ctx.closePath();
    ctx.moveTo(px + pw * 0.5, py + ph);
    ctx.lineTo(px + pw * 0.545, py + ph);
    ctx.lineTo(px + pw * 1.025, py);
    ctx.lineTo(px + pw * 0.98, py);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // the frame shades the edges of the glass
  ctx.strokeStyle = 'rgba(62,58,90,0.16)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function sashBars(ctx: Ctx, b: WinBox, trim: string): void {
  const { x, y, w, h } = b;
  const tr = y + h * 0.45;
  const bar = 4.6;
  const hi = rgba(lightOf(trim, 1), 0.95);
  const lo = rgba(shadowOf(trim, 0.5), 0.55);
  const line = rgba(lineOf(trim), 0.45);
  // shadows the bars cast onto the glass edge (soft)
  const bars = (): void => {
    ctx.beginPath();
    ctx.rect(x + w / 2 - bar / 2, y, bar, h);
    ctx.rect(x, tr - bar / 2, w, bar);
    ctx.rect(x - 1, y - 1, w + 2, 3.2);
    ctx.rect(x - 1, y - 1, 3.2, h + 2);
    ctx.rect(x + w - 2.2, y - 1, 3.2, h + 2);
    ctx.rect(x - 1, y + h - 2.2, w + 2, 3.2);
  };
  ctx.save();
  ctx.translate(1.2, 1.6);
  ctx.fillStyle = 'rgba(60,50,90,0.16)';
  bars();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = trim;
  bars();
  ctx.fill();
  // bevels: lit left/top faces, shaded right/bottom
  ctx.fillStyle = hi;
  ctx.fillRect(x + w / 2 - bar / 2, y, 1.2, h);
  ctx.fillRect(x, tr - bar / 2, w, 1.2);
  ctx.fillStyle = lo;
  ctx.fillRect(x + w / 2 + bar / 2 - 1.3, y, 1.3, h);
  ctx.fillRect(x, tr + bar / 2 - 1.3, w, 1.3);
  ctx.strokeStyle = line;
  ctx.lineWidth = 0.6;
  ctx.strokeRect(x + w / 2 - bar / 2, y + 2.2, bar, h - 4.4);
  ctx.strokeRect(x + 2.2, tr - bar / 2, w - 4.4, bar);
  ctx.strokeRect(x + 2.2, y + 2.2, w - 4.4, h - 4.4);
  // a brass sash lock on the meeting rail
  knob(ctx, x + w / 2, tr - 0.2, 1.5, '#D4B06A');
}

function curtainRod(ctx: Ctx, b: WinBox, theme: Theme): void {
  const { x, y, w } = b;
  const ry = y - 19;
  const x0 = x - 40;
  const x1 = x + w + 40;
  const wood = shadowOf(PALETTE.oak, 0.25);
  const rod = (): void => roundRect(ctx, x0, ry - 1.7, x1 - x0, 3.4, 1.7);
  castShadow(ctx, rod, 1.5, 3, 2.5, 0.3);
  // brackets
  for (const bx of [x - 26, x + w + 26]) {
    ctx.fillStyle = shadowOf(theme.trim, 0.3);
    roundRect(ctx, bx - 1.5, ry - 1, 3, 7, 1);
    ctx.fill();
  }
  ctx.fillStyle = wood;
  rod();
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(wood, 0.8), 0.7);
  ctx.fillRect(x0 + 2, ry - 1.1, x1 - x0 - 4, 0.9);
  inkLine(ctx, rod, wood, 0.8, 0.6);
  for (const fx of [x0 - 2.5, x1 + 2.5]) {
    knob(ctx, fx, ry, 3.4, wood);
  }
}

function curtainRings(ctx: Ctx, b: WinBox): void {
  const { x, y, w } = b;
  const ry = y - 19;
  ctx.strokeStyle = '#B5946C';
  ctx.lineWidth = 0.9;
  for (const [a, c] of [
    [x - 30, x + 6],
    [x + w - 6, x + w + 30],
  ]) {
    for (let k = 0; k < 5; k++) {
      const rx = a + ((c - a) * (k + 0.5)) / 5;
      ctx.beginPath();
      ctx.ellipse(rx, ry + 0.4, 1.6, 2.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/**
 * A curtain panel with gathered folds, pulled back by a tie at ~60% height.
 * side -1 = left of the window, 1 = right. Built in world space so the folds
 * keep their lit side toward the light on both panels.
 */
function curtain(ctx: Ctx, b: WinBox, side: -1 | 1, cloth: string, seed: number): void {
  const { x, y, w, h } = b;
  const cx = x + w / 2;
  const X = (dx: number): number => cx + side * dx; // dx measured outward from the window centre
  const half = w / 2;
  const top = y - 17;
  const tieY = y + h * 0.6;
  const hem = y + h + 20;
  const outerTop = half + 32;
  const innerTop = half - 6;
  const tieIn = half + 12;
  const tieOut = half + 33;
  const hemIn = half - 3;
  const hemOut = half + 37;
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(X(outerTop), top);
    ctx.lineTo(X(innerTop), top);
    ctx.bezierCurveTo(X(innerTop - 1), top + (tieY - top) * 0.5, X(tieIn - 4), tieY - 16, X(tieIn), tieY);
    ctx.bezierCurveTo(X(tieIn + 2), tieY + 12, X(hemIn - 2), hem - 22, X(hemIn), hem);
    // scalloped hem following the folds
    const n = 5;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const hx = hemIn + (hemOut - hemIn) * t;
      const px = hemIn + (hemOut - hemIn) * (t - 0.5 / n);
      ctx.quadraticCurveTo(X(px), hem + 3.4, X(hx), hem + (k === n ? 1 : 0));
    }
    ctx.bezierCurveTo(X(hemOut - 1), hem - 30, X(tieOut + 3), tieY + 10, X(tieOut), tieY);
    ctx.bezierCurveTo(X(tieOut - 1), tieY - 20, X(outerTop + 1), top + 30, X(outerTop), top);
    ctx.closePath();
  };
  softDrop(ctx, path, 3, 4.5, 0.24);
  ctx.fillStyle = cloth;
  path();
  ctx.fill();
  // folds: ridges run from the gathers at the rod, pinch at the tie, spread at
  // the hem (kept inside the panel, so no clip is needed). Each fold is a broad
  // soft light band, a deeper band in its lee, and a crisp ridge highlight.
  const n = 4;
  ctx.lineCap = 'round';
  const fold = (f: number, off: number): void => {
    const tx = innerTop + (outerTop - innerTop) * f;
    const mx = tieIn + (tieOut - tieIn) * f;
    const hx = hemIn + (hemOut - hemIn) * f;
    ctx.beginPath();
    ctx.moveTo(X(tx) + off, top + 3);
    ctx.bezierCurveTo(X(tx) + off, top + (tieY - top) * 0.55, X(mx) + off * 0.45, tieY - 14, X(mx) + off * 0.35, tieY);
    ctx.bezierCurveTo(X(mx) + off * 0.45, tieY + 12, X(hx) + off, hem - 20, X(hx) + off * 0.8, hem - 2);
  };
  for (let k = 0; k < n; k++) {
    const f = 0.2 + ((k + 0.5) / n) * 0.6 + jit(seed, k) * 0.03;
    ctx.strokeStyle = rgba(shadowOf(cloth, 0.6), 0.2);
    ctx.lineWidth = 4.6;
    fold(f, 2.6);
    ctx.stroke();
    ctx.strokeStyle = rgba(lightOf(cloth, 0.6), 0.28);
    ctx.lineWidth = 4;
    fold(f, -1.6);
    ctx.stroke();
    ctx.strokeStyle = rgba(lightOf(cloth, 0.9), 0.4);
    ctx.lineWidth = 0.8;
    fold(f, -0.6);
    ctx.stroke();
  }
  // the rod shades the top of the cloth
  const tg = ctx.createLinearGradient(0, top, 0, top + 7);
  tg.addColorStop(0, rgba(shadowOf(cloth, 0.7), 0.42));
  tg.addColorStop(1, rgba(shadowOf(cloth, 0.7), 0));
  ctx.fillStyle = tg;
  ctx.fillRect(Math.min(X(outerTop), X(innerTop - 1)), top, Math.abs(X(outerTop) - X(innerTop - 1)), 7);
  // the edge by the window glows with light through the cloth
  ctx.strokeStyle = rgba(lightOf(cloth, 0.9), 0.5);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(X(innerTop - 1.2), top + 2);
  ctx.bezierCurveTo(X(innerTop - 2.2), top + (tieY - top) * 0.5, X(tieIn - 5), tieY - 16, X(tieIn - 1), tieY);
  ctx.bezierCurveTo(X(tieIn + 1), tieY + 12, X(hemIn - 3), hem - 22, X(hemIn - 1.2), hem - 1);
  ctx.stroke();
  paintTex(ctx, path, 'weave', 0.3, 0.35);
  inkLine(ctx, path, cloth, 1, 0.6);
  // tie-back band with a little knot
  const tieC = mix(cloth, '#F7EBD8', 0.45);
  const tie = (): void => {
    ctx.beginPath();
    ctx.moveTo(X(tieIn - 1), tieY - 2.4);
    ctx.quadraticCurveTo(X((tieIn + tieOut) / 2), tieY + 1.5, X(tieOut + 1), tieY - 2);
    ctx.lineTo(X(tieOut + 1), tieY + 2.2);
    ctx.quadraticCurveTo(X((tieIn + tieOut) / 2), tieY + 5.6, X(tieIn - 1), tieY + 1.6);
    ctx.closePath();
  };
  ctx.fillStyle = tieC;
  tie();
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(tieC, 0.8), 0.7);
  ctx.fillRect(Math.min(X(tieIn), X(tieOut)), tieY - 1.2, Math.abs(X(tieOut) - X(tieIn)), 0.8);
  inkLine(ctx, tie, tieC, 0.8, 0.6);
  knob(ctx, X(tieOut + 1.5), tieY + 0.4, 2, tieC);
}

/** A fabric roller blind half-way down, with a dowel and a pull ring (variant 1). */
function rollerBlind(ctx: Ctx, b: WinBox, theme: Theme, seed: number): void {
  const { x, y, w, h } = b;
  const cloth = mix(theme.accent, '#F6EEDF', 0.55);
  const drop = h * (0.2 + hash01(seed, 5) * 0.08);
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - 1, y);
    ctx.lineTo(x + w + 1, y);
    ctx.lineTo(x + w + 1, y + drop);
    const n = 6;
    for (let k = n - 1; k >= 0; k--) {
      const px = x - 1 + ((w + 2) * (k + 0.5)) / n;
      ctx.quadraticCurveTo(px, y + drop + 4, x - 1 + ((w + 2) * k) / n, y + drop);
    }
    ctx.closePath();
  };
  castShadow(ctx, path, 1, 2.5, 2.5, 0.25);
  ctx.fillStyle = cloth;
  path();
  ctx.fill();
  // light glows through the cloth toward the bottom
  const g = ctx.createLinearGradient(0, y, 0, y + drop);
  g.addColorStop(0, rgba(shadowOf(cloth, 0.4), 0.25));
  g.addColorStop(1, rgba(lightOf(cloth, 0.9), 0.35));
  ctx.fillStyle = g;
  path();
  ctx.fill();
  paintTex(ctx, path, 'weave', 0.3, 0.32);
  // a stitched hem line
  ctx.save();
  ctx.setLineDash([1.6, 1.4]);
  ctx.strokeStyle = rgba(lightOf(cloth, 1), 0.8);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(x, y + drop - 2.2);
  ctx.lineTo(x + w, y + drop - 2.2);
  ctx.stroke();
  ctx.restore();
  inkLine(ctx, path, cloth, 0.9, 0.55);
  // a wooden dowel weighting the hem
  const dowel = (): void => roundRect(ctx, x - 3, y + drop - 1.4, w + 6, 2.8, 1.4);
  ctx.fillStyle = shadowOf(PALETTE.oak, 0.1);
  dowel();
  ctx.fill();
  cylinderShadeV(ctx, dowel, y + drop - 1.4, y + drop + 1.4, PALETTE.oak);
  inkLine(ctx, dowel, PALETTE.oak, 0.7, 0.6);
  // the roll at the top
  const roll = (): void => roundRect(ctx, x - 3, y - 4.5, w + 6, 5, 2.5);
  ctx.fillStyle = cloth;
  roll();
  ctx.fill();
  cylinderShadeV(ctx, roll, y - 4.5, y + 0.5, cloth);
  inkLine(ctx, roll, cloth, 0.8, 0.55);
  // pull cord and ring
  ctx.strokeStyle = '#9C8670';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y + drop + 1.4);
  ctx.lineTo(x + w / 2, y + drop + 9);
  ctx.stroke();
  ctx.strokeStyle = '#C9A46A';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + drop + 11, 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,248,230,0.8)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(x + w / 2, y + drop + 11, 2, Math.PI * 1.05, Math.PI * 1.5);
  ctx.stroke();
}

/** Vertical cylinder shading (for a horizontal roll or rod). */
function cylinderShadeV(ctx: Ctx, path: () => void, y0: number, y1: number, base: string): void {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, rgba(shadowOf(base, 0.4), 0.2));
  g.addColorStop(0.3, rgba(lightOf(base, 0.9), 0.6));
  g.addColorStop(0.55, rgba(base, 0));
  g.addColorStop(1, rgba(shadowOf(base, 0.7), 0.55));
  ctx.fillStyle = g;
  path();
  ctx.fill();
}

// --- Wall decor -------------------------------------------------------------------

const boxOf = (cx: number, cy: number, rx: number, ry = rx): Box => ({ x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry });

/** A frame of four mitred pieces: top and left catch the light, bottom and right turn away. */
function mitredFrame(ctx: Ctx, x: number, y: number, w: number, h: number, fw: number, base: string, gilt: boolean): void {
  const x1 = x + w;
  const y1 = y + h;
  const ring = (): void => {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.moveTo(x + fw, y + fw);
    ctx.lineTo(x + fw, y1 - fw);
    ctx.lineTo(x1 - fw, y1 - fw);
    ctx.lineTo(x1 - fw, y + fw);
    ctx.closePath();
  };
  const pieces: Array<[string, number[]]> = [
    [lightOf(base, 0.32), [x, y, x1, y, x1 - fw, y + fw, x + fw, y + fw]],
    [mix(base, lightOf(base, 0.3), 0.45), [x, y, x + fw, y + fw, x + fw, y1 - fw, x, y1]],
    [shadowOf(base, 0.2), [x, y1, x + fw, y1 - fw, x1 - fw, y1 - fw, x1, y1]],
    [shadowOf(base, 0.32), [x1, y, x1, y1, x1 - fw, y1 - fw, x1 - fw, y + fw]],
  ];
  for (const [c, p] of pieces) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.closePath();
    ctx.fill();
  }
  paintTex(ctx, ring, gilt ? 'speckle' : 'wood', gilt ? 0.35 : 0.5, gilt ? 0.25 : 0.22, gilt ? 0.25 : 0.22, x, y);
  // a rounded bead running round the moulding
  ctx.strokeStyle = rgba(lightOf(base, 1), gilt ? 0.75 : 0.5);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(x + fw * 0.42, y1 - fw * 0.42);
  ctx.lineTo(x + fw * 0.42, y + fw * 0.42);
  ctx.lineTo(x1 - fw * 0.42, y + fw * 0.42);
  ctx.stroke();
  ctx.strokeStyle = rgba(shadowOf(base, 0.5), 0.45);
  ctx.beginPath();
  ctx.moveTo(x1 - fw * 0.42, y + fw * 0.42);
  ctx.lineTo(x1 - fw * 0.42, y1 - fw * 0.42);
  ctx.lineTo(x + fw * 0.42, y1 - fw * 0.42);
  ctx.stroke();
  if (gilt) glint(ctx, x + fw * 0.6, y + fw * 0.55, 0.9, 0.8);
  ctx.strokeStyle = rgba(lineOf(base), 0.6);
  ctx.lineWidth = 0.9;
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 0.7;
  ctx.strokeRect(x + fw, y + fw, w - fw * 2, h - fw * 2);
}

/** Something hung on the wall: a cord up to a nail. */
function hangingCord(ctx: Ctx, cx: number, y: number, half: number, wall: string): void {
  ctx.strokeStyle = rgba(shadowOf(wall, 0.8), 0.75);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(cx - half, y + 2);
  ctx.lineTo(cx, y - 12);
  ctx.lineTo(cx + half, y + 2);
  ctx.stroke();
  knob(ctx, cx, y - 12.5, 1.3, '#A39080');
}

function drawPicture(ctx: Ctx, d: DecorPlacement, theme: Theme, seed: number): void {
  const w = d.w ?? 50;
  const h = d.h ?? 40;
  const x = d.x - w / 2;
  const y = d.y;
  const v = (d.variant ?? 0) % 3;
  const fw = 4.6;
  hangingCord(ctx, d.x, y, w / 2 - 8, theme.wall);
  castShadow(ctx, () => roundRect(ctx, x - fw, y - fw, w + fw * 2, h + fw * 2, 1), 2.6, 4, 4.5, 0.32);
  const frameC = v === 1 ? '#D2B272' : v === 2 ? '#94705A' : '#BC9470';
  // the mat, softly shaded by the frame's lip
  ctx.fillStyle = '#F4ECDD';
  ctx.fillRect(x, y, w, h);
  const m = Math.max(3.5, Math.min(w, h) * 0.12);
  const ax = x + m;
  const ay = y + m;
  const aw = w - m * 2;
  const ah = h - m * 2;
  ctx.save();
  clipRect(ctx, ax, ay, aw, ah);
  if (v === 0) catPortrait(ctx, ax, ay, aw, ah);
  else if (v === 1) tinyLandscape(ctx, ax, ay, aw, ah, seed);
  else stillLife(ctx, ax, ay, aw, ah);
  paintTex(ctx, () => ctx.rect(ax, ay, aw, ah), 'brush', 0.35, 0.28, 0.28, ax, ay);
  ctx.restore();
  // mat bevel: shaded top-left edge of the opening, lit bottom-right
  ctx.fillStyle = 'rgba(120,100,110,0.3)';
  ctx.fillRect(ax - 0.8, ay - 0.8, aw + 1.6, 0.8);
  ctx.fillRect(ax - 0.8, ay - 0.8, 0.8, ah + 1.6);
  ctx.fillStyle = 'rgba(255,253,246,0.9)';
  ctx.fillRect(ax - 0.8, ay + ah, aw + 1.6, 0.9);
  ctx.fillRect(ax + aw, ay - 0.8, 0.9, ah + 1.6);
  const ig = ctx.createLinearGradient(x, y, x + 6, y + 6);
  ig.addColorStop(0, 'rgba(110,90,110,0.22)');
  ig.addColorStop(1, 'rgba(110,90,110,0)');
  ctx.fillStyle = ig;
  ctx.fillRect(x, y, w, 3);
  ctx.fillRect(x, y, 3, h);
  mitredFrame(ctx, x - fw, y - fw, w + fw * 2, h + fw * 2, fw, frameC, v === 1);
  // glass glare
  ctx.save();
  clipRect(ctx, x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.1, y + h);
  ctx.lineTo(x + w * 0.3, y + h);
  ctx.lineTo(x + w * 0.62, y);
  ctx.lineTo(x + w * 0.42, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function catPortrait(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const bg = ctx.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, '#F2DCC0');
  bg.addColorStop(1, '#E6C4A2');
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  const cx = x + w / 2;
  const halo = ctx.createRadialGradient(cx - w * 0.1, y + h * 0.4, 0, cx - w * 0.1, y + h * 0.4, w * 0.5);
  halo.addColorStop(0, 'rgba(255,246,226,0.8)');
  halo.addColorStop(1, 'rgba(255,246,226,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(x, y, w, h);
  // cushion
  const cu = '#93AFCF';
  ctx.fillStyle = cu;
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.88, w * 0.4, h * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(cu, 0.7), 0.7);
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.05, y + h * 0.84, w * 0.3, h * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  // the loaf
  const g = PALETTE.ginger;
  const bx = cx + w * 0.03;
  const by = y + h * 0.66;
  const body = (): void => {
    ctx.beginPath();
    ctx.ellipse(bx, by, w * 0.3, h * 0.23, 0, 0, Math.PI * 2);
    ctx.moveTo(cx - w * 0.06 + h * 0.2, y + h * 0.44);
    ctx.arc(cx - w * 0.06, y + h * 0.44, h * 0.2, 0, Math.PI * 2);
  };
  // ears
  ctx.fillStyle = shadowOf(g, 0.15);
  for (const s of [-1, 1]) {
    const ex = cx - w * 0.06 + s * h * 0.12;
    ctx.beginPath();
    ctx.moveTo(ex - h * 0.08, y + h * 0.36);
    ctx.lineTo(ex + s * h * 0.03, y + h * 0.17);
    ctx.lineTo(ex + h * 0.08, y + h * 0.33);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = g;
  body();
  ctx.fill();
  roundShade(ctx, body, { x0: bx - w * 0.3, y0: y + h * 0.24, x1: bx + w * 0.3, y1: by + h * 0.23 }, g, 0.45, 0.4);
  // tabby marks
  ctx.strokeStyle = rgba(shadowOf(g, 0.45), 0.7);
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const sx = bx + w * (0.04 + k * 0.08);
    ctx.beginPath();
    ctx.moveTo(sx, by - h * 0.2);
    ctx.quadraticCurveTo(sx + 1, by - h * 0.1, sx - 0.5, by - h * 0.02);
    ctx.stroke();
  }
  // a sleepy face
  const fx = cx - w * 0.06;
  const fy = y + h * 0.47;
  ctx.strokeStyle = shadowOf(g, 0.7);
  ctx.lineWidth = 0.7;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(fx + s * h * 0.08, fy - 0.5, h * 0.04, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }
  ctx.fillStyle = '#E58F8A';
  ctx.beginPath();
  ctx.arc(fx, fy + h * 0.05, 0.7, 0, Math.PI * 2);
  ctx.fill();
  // curled tail
  ctx.strokeStyle = g;
  ctx.lineWidth = h * 0.08;
  ctx.beginPath();
  ctx.moveTo(bx + w * 0.26, by + h * 0.08);
  ctx.quadraticCurveTo(bx + w * 0.12, by + h * 0.26, bx - w * 0.12, by + h * 0.2);
  ctx.stroke();
}

function tinyLandscape(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  const sky = ctx.createLinearGradient(0, y, 0, y + h * 0.7);
  sky.addColorStop(0, '#BCD4E6');
  sky.addColorStop(1, '#F4E7CF');
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,248,226,0.95)';
  ctx.beginPath();
  ctx.arc(x + w * 0.74, y + h * 0.3, h * 0.1, 0, Math.PI * 2);
  ctx.fill();
  cloud(ctx, x + w * 0.3, y + h * 0.24, w * 0.12, seed, '#FFFDF6', '#DCDDEA', 0.9);
  const far = hillYs(seed + 2, 5, y + h * 0.58, h * 0.07);
  ctx.fillStyle = '#AFC4C4';
  ridge(ctx, x, x + w, far, y + h + 1);
  ctx.fill();
  const mid = hillYs(seed + 5, 5, y + h * 0.72, h * 0.06);
  ctx.fillStyle = '#9FBC8F';
  ridge(ctx, x, x + w, mid, y + h + 1);
  ctx.fill();
  tree(ctx, x + w * 0.3, ridgeAt(mid, 0.3) + 1, h * 0.26, '#7FA275', '#8A7262', false);
  tree(ctx, x + w * 0.4, ridgeAt(mid, 0.4) + 1, h * 0.18, '#86A97A', '#8A7262', true);
  ctx.fillStyle = '#CDBF86';
  ridge(ctx, x, x + w, hillYs(seed + 8, 4, y + h * 0.88, h * 0.03), y + h + 1);
  ctx.fill();
  // a winding path
  ctx.strokeStyle = 'rgba(244,230,200,0.9)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.62, y + h);
  ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.86, x + w * 0.58, y + h * 0.76);
  ctx.stroke();
}

function stillLife(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const bg = ctx.createLinearGradient(x, y, x + w, y + h);
  bg.addColorStop(0, '#EAD9DA');
  bg.addColorStop(1, '#D8C3CC');
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#C9A989';
  ctx.fillRect(x, y + h * 0.8, w, h * 0.2);
  ctx.fillStyle = 'rgba(255,240,220,0.5)';
  ctx.fillRect(x, y + h * 0.8, w, 0.8);
  const cx = x + w / 2;
  // leaves behind
  const leaf = '#93B08A';
  leafShape(ctx, cx - 1, y + h * 0.45, h * 0.3, h * 0.07, -2.4, leaf, lightOf(leaf, 0.4));
  leafShape(ctx, cx + 1, y + h * 0.45, h * 0.3, h * 0.07, -0.6, leaf, lightOf(leaf, 0.4));
  // blooms
  const blooms: Array<[number, number, string]> = [
    [cx - w * 0.15, y + h * 0.3, '#E8A39E'],
    [cx + w * 0.12, y + h * 0.26, '#F2D489'],
    [cx - w * 0.01, y + h * 0.16, '#F8EEDF'],
  ];
  for (const [bx, by, c] of blooms) {
    const r = h * 0.12;
    ctx.fillStyle = shadowOf(c, 0.2);
    ctx.beginPath();
    ctx.arc(bx + 0.5, by + 0.6, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath();
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      ctx.moveTo(bx + Math.cos(a) * r * 0.5 + r * 0.55, by + Math.sin(a) * r * 0.5);
      ctx.arc(bx + Math.cos(a) * r * 0.5, by + Math.sin(a) * r * 0.5, r * 0.55, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = shadowOf(c, 0.45);
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  // a round blue vase
  const vc = PALETTE.teacup;
  const vase = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.07, y + h * 0.42);
    ctx.bezierCurveTo(cx - w * 0.24, y + h * 0.5, cx - w * 0.2, y + h * 0.82, cx - w * 0.08, y + h * 0.84);
    ctx.lineTo(cx + w * 0.08, y + h * 0.84);
    ctx.bezierCurveTo(cx + w * 0.2, y + h * 0.82, cx + w * 0.24, y + h * 0.5, cx + w * 0.07, y + h * 0.42);
    ctx.closePath();
  };
  ctx.fillStyle = vc;
  vase();
  ctx.fill();
  cylinderShade(ctx, vase, cx - w * 0.2, cx + w * 0.2, vc, 0.6, 0.5);
  glint(ctx, cx - w * 0.09, y + h * 0.58, 0.9, 0.8);
}

function drawClock(ctx: Ctx, d: DecorPlacement, theme: Theme, seed: number): void {
  const r = d.w ?? 18;
  const cx = d.x;
  const cy = d.y;
  const R = r + 4.2;
  const rimC = mix(theme.accent, '#F3E7D6', 0.22);
  const outer = (): void => {
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
  };
  castShadow(ctx, outer, 2.4, 3.6, 4, 0.32);
  ctx.fillStyle = rimC;
  outer();
  ctx.fill();
  roundShade(ctx, outer, boxOf(cx, cy, R), rimC, 0.55, 0.45);
  ctx.strokeStyle = rgba(lightOf(rimC, 1), 0.75);
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, R - 1.7, Math.PI * 1.02, Math.PI * 1.42);
  ctx.stroke();
  inkLine(ctx, outer, rimC, 1, 0.7);
  // face, shaded by the raised rim on its lit side
  const face = (): void => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  };
  const fg = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, 0, cx, cy, r);
  fg.addColorStop(0, '#FFFBF2');
  fg.addColorStop(1, '#F1E6D6');
  ctx.fillStyle = fg;
  face();
  ctx.fill();
  edgeShade(ctx, face, boxOf(cx, cy, r), shadowOf('#F1E6D6', 0.7), r * 0.28, 0.45, 'light', 3);
  ctx.strokeStyle = rgba(shadowOf(rimC, 0.6), 0.5);
  ctx.lineWidth = 0.8;
  face();
  ctx.stroke();
  // ticks
  ctx.strokeStyle = '#6E6274';
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const major = i % 3 === 0;
    ctx.lineWidth = major ? 1.3 : 0.7;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * (major ? 0.68 : 0.76), cy + Math.sin(a) * r * (major ? 0.68 : 0.76));
    ctx.lineTo(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86);
    ctx.stroke();
  }
  // hands (a lazy afternoon time), with a whisper of shadow
  const hourA = -Math.PI / 2 + ((3 + (seed % 4)) / 12) * Math.PI * 2 + 0.2;
  const minA = -Math.PI / 2 + (hash01(seed, 3) * 0.6 + 0.55) * Math.PI * 2;
  const hand = (a: number, len: number, wd: number, dx: number, dy: number, col: string): void => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx + dx - c * len * 0.18 - s * wd, cy + dy - s * len * 0.18 + c * wd);
    ctx.lineTo(cx + dx + c * len, cy + dy + s * len);
    ctx.lineTo(cx + dx - c * len * 0.18 + s * wd, cy + dy - s * len * 0.18 - c * wd);
    ctx.closePath();
    ctx.fill();
  };
  hand(hourA, r * 0.5, 1.3, 0.7, 1, 'rgba(90,70,100,0.25)');
  hand(minA, r * 0.78, 1, 0.7, 1, 'rgba(90,70,100,0.25)');
  hand(hourA, r * 0.5, 1.3, 0, 0, '#4E4560');
  hand(minA, r * 0.78, 1, 0, 0, '#4E4560');
  knob(ctx, cx, cy, 1.6, rimC);
  // the domed glass
  specular(ctx, cx - r * 0.42, cy - r * 0.42, r * 0.95, r * 0.13, -Math.PI / 4, 0.45);
}

function drawMirror(ctx: Ctx, d: DecorPlacement, theme: Theme): void {
  const w = d.w ?? 70;
  const h = d.h ?? 90;
  const x = d.x - w / 2;
  const y = d.y;
  const fw = 5;
  const gold = '#D8B66E';
  hangingCord(ctx, d.x, y - fw, w / 2 - 6, theme.wall);
  const outer = (): void => roundRect(ctx, x - fw, y - fw, w + fw * 2, h + fw * 2, w / 2 + fw);
  const glass = (): void => roundRect(ctx, x, y, w, h, w / 2);
  castShadow(ctx, outer, 2.6, 4, 5, 0.32);
  ctx.fillStyle = gold;
  outer();
  ctx.fill();
  roundShade(ctx, outer, { x0: x - fw, y0: y - fw, x1: x + w + fw, y1: y + h + fw }, gold, 0.55, 0.5);
  paintTex(ctx, outer, 'speckle', 0.3, 0.25);
  // the reflection: the room's wall and window light, cooler and paler
  const rg = ctx.createLinearGradient(x, y, x + w, y + h);
  rg.addColorStop(0, '#E8F0F2');
  rg.addColorStop(0.45, mix(theme.wall, '#D7E4EA', 0.6));
  rg.addColorStop(1, mix(theme.wallLow, '#C3D3DE', 0.55));
  ctx.fillStyle = rg;
  glass();
  ctx.fill();
  ctx.save();
  glass();
  ctx.clip();
  // reflected window glow and the far wall's skirting line
  const wg = ctx.createRadialGradient(x + w * 0.3, y + h * 0.3, 0, x + w * 0.3, y + h * 0.3, w * 0.7);
  wg.addColorStop(0, 'rgba(255,250,236,0.75)');
  wg.addColorStop(1, 'rgba(255,250,236,0)');
  ctx.fillStyle = wg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgba(theme.trim, 0.55);
  ctx.fillRect(x, y + h * 0.8, w, 2.2);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.12, y + h * 0.62);
  ctx.lineTo(x + w * 0.34, y + h * 0.62);
  ctx.lineTo(x + w * 0.78, y + h * 0.06);
  ctx.lineTo(x + w * 0.56, y + h * 0.06);
  ctx.closePath();
  ctx.moveTo(x + w * 0.42, y + h * 0.66);
  ctx.lineTo(x + w * 0.49, y + h * 0.66);
  ctx.lineTo(x + w * 0.93, y + h * 0.1);
  ctx.lineTo(x + w * 0.86, y + h * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // bevelled glass edge
  edgeShade(ctx, glass, { x0: x, y0: y, x1: x + w, y1: y + h }, '#FFFFFF', 2.2, 0.6, 'shadow', 2);
  edgeShade(ctx, glass, { x0: x, y0: y, x1: x + w, y1: y + h }, '#7D7E9A', 2.2, 0.35, 'light', 2);
  inkLine(ctx, glass, gold, 0.9, 0.6);
  inkLine(ctx, outer, gold, 1, 0.65);
  ctx.strokeStyle = rgba(lightOf(gold, 1), 0.8);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(d.x, y + w / 2, w / 2 + fw * 0.55, Math.PI * 1.08, Math.PI * 1.5);
  ctx.stroke();
}

function drawGarland(ctx: Ctx, d: DecorPlacement, seed: number): void {
  const w = d.w ?? 200;
  const x0 = d.x - w / 2;
  const sag = 26;
  const cols = [PALETTE.rose, PALETTE.butter, PALETTE.teacup, PALETTE.sage, PALETTE.lilac].map((c) => mix(c, '#F3E9DA', 0.18));
  const at = (t: number): [number, number] => [x0 + w * t, d.y + 2 * sag * t * (1 - t)];
  const n = Math.max(2, Math.floor(w / 26));
  // pennants
  for (let k = 0; k <= n; k++) {
    const t = (k + 0.0) / n;
    if (t <= 0.02 || t >= 0.98) continue;
    const [px, py] = at(t);
    const slope = (2 * sag * (1 - 2 * t)) / w;
    const ang = Math.atan(slope);
    const c = cols[(k + Math.floor(hash01(seed, 1) * 5)) % cols.length];
    const flag = (): void => {
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(8, 0);
      ctx.quadraticCurveTo(1.8, 8, 0.3, 16);
      ctx.quadraticCurveTo(-1.2, 8, -8, 0);
      ctx.closePath();
    };
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang + jit(seed, k) * 0.08);
    ctx.save();
    ctx.translate(2, 2.8);
    ctx.fillStyle = 'rgba(80,64,96,0.16)';
    flag();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = c;
    flag();
    ctx.fill();
    // the half toward the light, and a little print
    ctx.fillStyle = rgba(lightOf(c, 0.6), 0.55);
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(0, 0);
    ctx.lineTo(0.3, 16);
    ctx.quadraticCurveTo(-1.2, 8, -8, 0);
    ctx.fill();
    if (k % 2) {
      ctx.fillStyle = rgba(lightOf(c, 1), 0.8);
      for (const [dx, dy] of [
        [-3, 2.8],
        [2.4, 3.2],
        [-0.3, 7.4],
      ]) {
        ctx.beginPath();
        ctx.arc(dx, dy, 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = rgba(lightOf(c, 1), 0.75);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-5.4, 3);
      ctx.lineTo(5.4, 3);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(lineOf(c), 0.5);
    ctx.lineWidth = 0.7;
    flag();
    ctx.stroke();
    ctx.restore();
  }
  // the string over the tops, with a nail at each end
  ctx.strokeStyle = '#8E7C78';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(x0, d.y);
  ctx.quadraticCurveTo(d.x, d.y + sag * 2, x0 + w, d.y);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,248,236,0.5)';
  ctx.lineWidth = 0.4;
  ctx.stroke();
  knob(ctx, x0, d.y, 1.4, '#A39080');
  knob(ctx, x0 + w, d.y, 1.4, '#A39080');
}

function drawTowel(ctx: Ctx, d: DecorPlacement, theme: Theme, seed: number): void {
  const x = d.x;
  const y = d.y;
  const cloth = mix(theme.accent, '#F3EADC', 0.2);
  const wood = shadowOf(PALETTE.oak, 0.12);
  // rail: two round wall plates and a bar
  for (const bx of [x - 27, x + 27]) {
    castShadow(ctx, () => {
      ctx.beginPath();
      ctx.arc(bx, y - 2, 3, 0, Math.PI * 2);
    }, 1.2, 2, 2, 0.3);
    knob(ctx, bx, y - 2, 3, wood);
  }
  const bar = (): void => roundRect(ctx, x - 29, y - 3.6, 58, 3.4, 1.7);
  ctx.fillStyle = wood;
  bar();
  ctx.fill();
  cylinderShadeV(ctx, bar, y - 3.6, y - 0.2, wood);
  // the towel folded over the bar
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - 21, y - 2.4);
    ctx.quadraticCurveTo(x, y - 5.4, x + 21, y - 2.4);
    ctx.lineTo(x + 22.5, y + 50);
    ctx.quadraticCurveTo(x + 11, y + 52.5, x, y + 51.2);
    ctx.quadraticCurveTo(x - 11, y + 52.8, x - 22.5, y + 50.4);
    ctx.closePath();
  };
  castShadow(ctx, path, 2.5, 4, 5, 0.26);
  ctx.fillStyle = cloth;
  path();
  ctx.fill();
  ctx.save();
  path();
  ctx.clip();
  // soft vertical folds
  for (let k = 0; k < 3; k++) {
    const fx = x - 12 + k * 12 + jit(seed, k) * 2;
    const g = ctx.createLinearGradient(fx - 5, 0, fx + 5, 0);
    g.addColorStop(0, rgba(lightOf(cloth, 0.6), 0));
    g.addColorStop(0.35, rgba(lightOf(cloth, 0.6), 0.45));
    g.addColorStop(0.65, rgba(shadowOf(cloth, 0.6), 0.3));
    g.addColorStop(1, rgba(shadowOf(cloth, 0.6), 0));
    ctx.fillStyle = g;
    ctx.fillRect(fx - 5, y, 10, 56);
  }
  // woven stripes and the fold over the bar
  const band = mix(cloth, '#FBF4E8', 0.65);
  ctx.fillStyle = band;
  ctx.fillRect(x - 24, y + 36, 48, 4.2);
  ctx.fillRect(x - 24, y + 42, 48, 1.6);
  ctx.fillStyle = rgba(shadowOf(cloth, 0.5), 0.35);
  ctx.fillRect(x - 24, y + 1.4, 48, 3.2);
  ctx.restore();
  edgeShade(ctx, path, { x0: x - 23, y0: y - 5, x1: x + 23, y1: y + 53 }, shadowOf(cloth, 0.6), 4, 0.35, 'shadow', 2);
  paintTex(ctx, path, 'weave', 0.4, 0.28);
  inkLine(ctx, path, cloth, 1, 0.6);
  // little fringe at the hem
  ctx.strokeStyle = rgba(shadowOf(cloth, 0.2), 0.8);
  ctx.lineWidth = 0.8;
  ctx.lineCap = 'round';
  for (let k = 0; k < 12; k++) {
    const fx = x - 21 + k * 3.8;
    const fy = y + 51 + Math.sin(k * 1.3) * 0.6;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + 0.3, fy + 2.4 + hash01(seed, k) * 0.8);
    ctx.stroke();
  }
}

function drawRadiator(ctx: Ctx, d: DecorPlacement, theme: Theme): void {
  const w = d.w ?? 80;
  const x0 = d.x - w / 2;
  const by = d.y;
  const enamel = mix(theme.trim, '#EDE6DC', 0.5);
  const n = Math.max(3, Math.floor(w / 10.5));
  const cw = w / n;
  const cols = (): void => {
    ctx.beginPath();
    for (let k = 0; k < n; k++) roundRect2(ctx, x0 + k * cw + 0.8, by - 56, cw - 1.6, 50, (cw - 1.6) / 2);
  };
  castShadow(ctx, cols, 2.5, 3, 4, 0.28);
  // the pipes behind
  ctx.fillStyle = shadowOf(enamel, 0.3);
  ctx.fillRect(x0 - 2, by - 50, w + 4, 4);
  ctx.fillRect(x0 - 2, by - 15, w + 4, 4);
  for (let k = 0; k < n; k++) {
    const cx = x0 + k * cw + 0.8;
    const col = (): void => roundRect(ctx, cx, by - 56, cw - 1.6, 50, (cw - 1.6) / 2);
    ctx.fillStyle = enamel;
    col();
    ctx.fill();
    cylinderShade(ctx, col, cx, cx + cw - 1.6, enamel, 0.6, 0.5);
    inkLine(ctx, col, enamel, 0.7, 0.45);
  }
  // feet, valve and its pipe
  ctx.fillStyle = shadowOf(enamel, 0.4);
  ctx.fillRect(x0 + 2, by - 6, 4, 6);
  ctx.fillRect(x0 + w - 6, by - 6, 4, 6);
  ctx.fillStyle = '#C9A26A';
  ctx.fillRect(x0 - 5, by - 14, 4, 14);
  knob(ctx, x0 - 3, by - 17, 3, '#C9A26A');
  contactShadow(ctx, d.x, by, w / 2, 0.3, 0.6);
}

function roundRect2(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  // like roundRect, but adds to the current path
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// --- Backsplash, rug ------------------------------------------------------------

function drawBacksplash(ctx: Ctx, d: DecorPlacement, theme: Theme, seed: number): void {
  const w = d.w ?? 120;
  const h = d.h ?? 80;
  const x0 = d.x;
  const y0 = d.y;
  const S = 15;
  const base = mix(theme.accent, '#F2EEE6', 0.62);
  const grout = mix(base, '#F7F2E9', 0.6);
  const paint = mix(theme.accent, '#5F6E9A', 0.25);
  ctx.save();
  clipRect(ctx, x0, y0, w, h);
  ctx.fillStyle = grout;
  ctx.fillRect(x0, y0, w, h);
  // rows counted up from the worktop, so whole tiles sit on the counter
  const rows = Math.ceil(h / S);
  const ty0 = y0 + h - rows * S;
  glazedTiles(ctx, base, x0, x0 + w, ty0, y0 + h, S, seed, 1);
  // hand-painted flowers on a few tiles
  const petals = new Path2D();
  const hearts = new Path2D();
  const frames = new Path2D();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c * S < w; c++) {
      if (hash01(seed + c, r + 50) <= 0.72) continue;
      const mx = x0 + c * S + S / 2;
      const my = ty0 + r * S + S / 2;
      for (let p = 0; p < 4; p++) {
        const a = (p * Math.PI) / 2 + Math.PI / 4;
        const px = mx + Math.cos(a) * 2.3;
        const py = my + Math.sin(a) * 2.3;
        petals.moveTo(px + Math.cos(a) * 2.1, py + Math.sin(a) * 2.1);
        petals.ellipse(px, py, 2.1, 1.25, a, 0, Math.PI * 2);
      }
      hearts.moveTo(mx + 1.2, my);
      hearts.arc(mx, my, 1.2, 0, Math.PI * 2);
      frames.rect(mx - S / 2 + 2.4, my - S / 2 + 2.4, S - 4.8, S - 4.8);
    }
  }
  ctx.fillStyle = rgba(paint, 0.65);
  ctx.fill(petals);
  ctx.fillStyle = rgba(PALETTE.butter, 0.9);
  ctx.fill(hearts);
  ctx.strokeStyle = rgba(paint, 0.45);
  ctx.lineWidth = 0.6;
  ctx.stroke(frames);
  ctx.restore();
  // a slim bullnose trim along the top
  const cap = (): void => roundRect(ctx, x0 - 0.5, y0 - 3.2, w + 1, 3.6, 1.4);
  castShadow(ctx, cap, 0.8, 1.6, 1.6, 0.25);
  ctx.fillStyle = mix(base, '#FBF7F0', 0.5);
  cap();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(x0, y0 - 2.6, w, 0.9);
  inkLine(ctx, cap, base, 0.7, 0.5);
  ctx.strokeStyle = rgba(lineOf(base), 0.35);
  ctx.lineWidth = 0.8;
  ctx.strokeRect(x0, y0, w, h);
}

function drawRug(ctx: Ctx, d: DecorPlacement, theme: Theme, seed: number): void {
  const w = d.w ?? 160;
  const cx = d.x;
  const yb = d.y + 2.5;
  const yf = d.y + 27;
  const hb = (w / 2) * 0.93;
  const hf = w / 2;
  // floor perspective: (u, v) in 0..1 -> the rug's trapezoid
  const P = (u: number, v: number): [number, number] => {
    const half = hb + (hf - hb) * v;
    return [cx + (u - 0.5) * 2 * half, yb + (yf - yb) * v];
  };
  const quad = (u0: number, v0: number, u1: number, v1: number): void => {
    const a = P(u0, v0);
    const b = P(u1, v0);
    const c = P(u1, v1);
    const e = P(u0, v1);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.lineTo(e[0], e[1]);
    ctx.closePath();
  };
  const all = (): void => {
    ctx.beginPath();
    quad(0, 0, 1, 1);
  };
  const field = mix(theme.accent, '#E9DCC8', 0.3);
  const border = mix(field, '#F6EEDF', 0.6);
  const deep = shadowOf(field, 0.4);
  // thickness and the shadow it throws on the boards
  castShadow(ctx, all, 0.8, 2.2, 2.5, 0.35);
  ctx.fillStyle = shadowOf(field, 0.45);
  ctx.beginPath();
  quad(0, 0.96, 1, 1.07);
  ctx.fill();
  ctx.fillStyle = field;
  all();
  ctx.fill();
  const kilim = hash01(seed, 9) > 0.4;
  const accent2 = mix(PALETTE.butter, field, 0.35);
  if (kilim) {
    // a zigzag band in the border, then a row of stepped diamonds
    ctx.fillStyle = rgba(deep, 0.75);
    const nz = Math.max(8, Math.round(w / 9));
    for (const [v0, v1] of [
      [0.02, 0.12],
      [0.88, 0.98],
    ]) {
      ctx.beginPath();
      for (let k = 0; k < nz; k++) {
        const u0 = 0.06 + (k / nz) * 0.88;
        const u1 = 0.06 + ((k + 1) / nz) * 0.88;
        const a = P(u0, v1);
        const b = P((u0 + u1) / 2, v0);
        const c = P(u1, v1);
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.closePath();
      }
      ctx.fill();
    }
    const n = Math.max(3, Math.round(w / 34));
    for (let k = 0; k < n; k++) {
      const u = 0.1 + ((k + 0.5) / n) * 0.8;
      const du = 0.36 / n;
      for (const [sc, col] of [
        [1, rgba(deep, 0.85)],
        [0.62, k % 2 ? accent2 : border],
        [0.28, rgba(deep, 0.9)],
      ] as const) {
        const pts = [P(u, 0.5 - 0.22 * sc), P(u + du * sc, 0.5), P(u, 0.5 + 0.22 * sc), P(u - du * sc, 0.5)];
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
        ctx.closePath();
        ctx.fill();
      }
    }
  } else {
    // woven stripes in three colours with little ticks
    const bands: Array<[number, number, string]> = [
      [0.27, 0.05, rgba(deep, 0.6)],
      [0.34, 0.03, accent2],
      [0.4, 0.2, rgba(border, 0.85)],
      [0.63, 0.03, accent2],
      [0.69, 0.05, rgba(deep, 0.6)],
    ];
    for (const [v, dv, col] of bands) {
      ctx.fillStyle = col;
      ctx.beginPath();
      quad(0.07, v, 0.93, v + dv);
      ctx.fill();
    }
    ctx.fillStyle = rgba(deep, 0.55);
    const nt = Math.round(w / 6);
    for (let k = 0; k < nt; k++) {
      const u = 0.08 + (k / nt) * 0.84;
      ctx.beginPath();
      quad(u, 0.46, u + 0.012, 0.54);
      ctx.fill();
    }
  }
  // light across the pile: lit at the back left
  ctx.save();
  all();
  ctx.clip();
  const lg = ctx.createLinearGradient(cx - hf, yb, cx + hf, yf);
  lg.addColorStop(0, 'rgba(255,248,230,0.22)');
  lg.addColorStop(0.5, 'rgba(255,248,230,0)');
  lg.addColorStop(1, rgba(shadowOf(field, 0.8), 0.18));
  ctx.fillStyle = lg;
  ctx.fillRect(cx - hf, yb, hf * 2, yf - yb);
  ctx.restore();
  paintTex(ctx, all, 'weave', 0.45, 0.3, 0.18);
  inkLine(ctx, all, field, 0.9, 0.45);
  // fringe on the two short ends
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    for (let k = 0; k < 9; k++) {
      const v = (k + 0.5) / 9;
      const [ex, ey] = P(side < 0 ? 0 : 1, v);
      const len = 3.6 + hash01(seed + side, k) * 1.4;
      const dx = side * len;
      const dy = (v - 0.5) * 1.2;
      ctx.strokeStyle = rgba(shadowOf(border, 0.4), 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ex, ey + 0.4);
      ctx.lineTo(ex + dx, ey + dy + 0.8);
      ctx.stroke();
      ctx.strokeStyle = border;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + dx, ey + dy);
      ctx.stroke();
    }
  }
}

// --- Things on surfaces --------------------------------------------------------

function drawPendant(ctx: Ctx, d: DecorPlacement, theme: Theme): void {
  const x = d.x;
  const y1 = d.y;
  const shadeC = mix(theme.accent, '#F3E8D8', 0.2);
  // warm light around the bulb
  const glow = ctx.createRadialGradient(x, y1 + 3, 0, x, y1 + 3, 70);
  glow.addColorStop(0, 'rgba(255,232,180,0.5)');
  glow.addColorStop(0.35, 'rgba(255,226,170,0.18)');
  glow.addColorStop(1, 'rgba(255,226,170,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 70, y1 - 67, 140, 140);
  // cord from the ceiling (`h` long; by default from well over the top of a room), brass fitting
  const top = y1 - (d.h ?? y1 + 400);
  ctx.strokeStyle = '#5E5468';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, y1 - 22);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,248,236,0.35)';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(x - 0.3, top);
  ctx.lineTo(x - 0.3, y1 - 22);
  ctx.stroke();
  const brass = '#CDA86C';
  const cap = (): void => roundRect(ctx, x - 3.2, y1 - 25, 6.4, 6, 1.6);
  ctx.fillStyle = brass;
  cap();
  ctx.fill();
  cylinderShade(ctx, cap, x - 3.2, x + 3.2, brass, 0.7, 0.5);
  // the enamel shade
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - 5.5, y1 - 19.5);
    ctx.bezierCurveTo(x - 12, y1 - 18.5, x - 21, y1 - 9, x - 23, y1);
    ctx.lineTo(x + 23, y1);
    ctx.bezierCurveTo(x + 21, y1 - 9, x + 12, y1 - 18.5, x + 5.5, y1 - 19.5);
    ctx.closePath();
  };
  castShadow(ctx, path, 3, 5, 6, 0.18);
  ctx.fillStyle = shadeC;
  path();
  ctx.fill();
  cylinderShade(ctx, path, x - 23, x + 23, shadeC, 0.65, 0.55);
  specular(ctx, x - 11, y1 - 11, 13, 1.6, -0.95, 0.55);
  inkLine(ctx, path, shadeC, 1, 0.65);
  // glowing underside and the bulb peeking out
  const inner = ctx.createRadialGradient(x, y1, 0, x, y1, 23);
  inner.addColorStop(0, '#FFF4D6');
  inner.addColorStop(1, '#F7D9A0');
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.ellipse(x, y1, 22.5, 3.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rgba(lightOf(shadeC, 0.8), 0.9);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(x, y1, 22.8, 3.8, 0, 0, Math.PI);
  ctx.stroke();
  const bulb = ctx.createRadialGradient(x - 1, y1 + 1.5, 0, x, y1 + 2, 6);
  bulb.addColorStop(0, '#FFFDF2');
  bulb.addColorStop(1, '#FBE6B4');
  ctx.fillStyle = bulb;
  ctx.beginPath();
  ctx.ellipse(x, y1 + 2.4, 5.2, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlant(ctx: Ctx, d: DecorPlacement, seed: number): void {
  const x = d.x;
  const y = d.y;
  const s = (d.w ?? 40) / 40;
  const kind = Math.floor(hash01(seed, 77) * 3);
  const pot = PALETTE.terracotta;
  const rimY = y - 24 * s;
  contactShadow(ctx, x, y, 13 * s, 0.32, 0.6);
  // leaves first (the pot overlaps their base)
  const green = '#8DB283';
  const deep = '#6F9668';
  if (kind === 1) {
    // snake plant: upright banded blades
    for (let k = 0; k < 6; k++) {
      const t = k / 5 - 0.5;
      const bx = x + t * 16 * s;
      const L = (30 + hash01(seed, k) * 16) * s;
      const a = -Math.PI / 2 + t * 0.55 + jit(seed, k + 9) * 0.08;
      const tipx = bx + Math.cos(a) * L;
      const tipy = rimY + 2 + Math.sin(a) * L;
      const c = k % 2 ? green : deep;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(bx - 3.2 * s, rimY + 3);
      ctx.quadraticCurveTo(bx - 3.6 * s + (tipx - bx) * 0.4, rimY - L * 0.5, tipx, tipy);
      ctx.quadraticCurveTo(bx + 3.6 * s + (tipx - bx) * 0.4, rimY - L * 0.5, bx + 3.2 * s, rimY + 3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(lightOf(c, 0.6), 0.55);
      ctx.lineWidth = 0.7;
      for (let b = 1; b < 5; b++) {
        const by = rimY - (L * b) / 5.5;
        const bxx = bx + ((tipx - bx) * b) / 5.5;
        ctx.beginPath();
        ctx.moveTo(bxx - 2 * s, by + 1);
        ctx.quadraticCurveTo(bxx, by - 0.6, bxx + 2 * s, by + 1);
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(PALETTE.butter, 0.5);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(bx + 2.6 * s, rimY + 2);
      ctx.quadraticCurveTo(bx + 2.8 * s + (tipx - bx) * 0.4, rimY - L * 0.5, tipx, tipy);
      ctx.stroke();
    }
  } else if (kind === 0) {
    // peperomia: plump round leaves on short stems, a back and a front layer
    const n = 11;
    for (let layer = 0; layer < 2; layer++) {
      for (let k = layer; k < n; k += 2) {
        const t = k / (n - 1) - 0.5;
        const a = -Math.PI / 2 + t * 2.5 + jit(seed, k) * 0.12;
        const L = (12 + hash01(seed, k + 5) * 7) * s;
        const reach = (7 + hash01(seed, k + 15) * 6) * s;
        const c = layer === 0 ? deep : green;
        const sx = x + Math.cos(a) * reach * 0.9;
        const sy = rimY + 1 + Math.sin(a) * reach;
        ctx.strokeStyle = shadowOf(c, 0.25);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(x + t * 4 * s, rimY + 2);
        ctx.quadraticCurveTo(x + Math.cos(a) * reach * 0.3, rimY - reach * 0.2, sx, sy);
        ctx.stroke();
        roundLeaf(ctx, sx, sy, L, a + jit(seed, k + 30) * 0.25, c);
      }
    }
  } else {
    // pothos: a few upright heart leaves and vines trailing over the rim
    for (let k = 0; k < 5; k++) {
      const t = k / 4 - 0.5;
      const a = -Math.PI / 2 + t * 1.6 + jit(seed, k) * 0.15;
      const L = (12 + hash01(seed, k + 3) * 5) * s;
      const sx = x + Math.cos(a) * 6 * s;
      const sy = rimY - 2 + Math.sin(a) * 6 * s;
      ctx.strokeStyle = shadowOf(green, 0.25);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(x, rimY + 2);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      roundLeaf(ctx, sx, sy, L, a, k % 2 ? deep : green);
    }
    for (const side of [-1, 1]) {
      // a vine arching over the rim and hanging down the pot
      const len = (16 + hash01(seed, side + 9) * 12) * s;
      const x0 = x + side * 9 * s;
      ctx.strokeStyle = shadowOf(green, 0.3);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(x0, rimY + 1);
      ctx.bezierCurveTo(x0 + side * 8 * s, rimY - 4 * s, x0 + side * 12 * s, rimY + len * 0.4, x0 + side * 11 * s, rimY + len);
      ctx.stroke();
      for (let k = 0; k < 4; k++) {
        const u = (k + 0.6) / 4;
        const lx = x0 + side * (8 + 3.5 * u) * s;
        const ly = rimY - 2 * s + len * u;
        roundLeaf(ctx, lx, ly, (8 - u * 2) * s, Math.PI / 2 + side * (0.9 - u * 0.6), k % 2 ? green : deep);
      }
    }
  }
  // the pot: tapered terracotta with a rolled rim
  const body = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - 13.5 * s, rimY + 4 * s);
    ctx.lineTo(x + 13.5 * s, rimY + 4 * s);
    ctx.lineTo(x + 10.5 * s, y);
    ctx.quadraticCurveTo(x, y + 1.4, x - 10.5 * s, y);
    ctx.closePath();
  };
  ctx.fillStyle = pot;
  body();
  ctx.fill();
  cylinderShade(ctx, body, x - 13.5 * s, x + 13.5 * s, pot, 0.5, 0.55);
  paintTex(ctx, body, 'speckle', 0.45, 0.3, 0.3, x);
  edgeShade(ctx, body, { x0: x - 13.5 * s, y0: rimY, x1: x + 13.5 * s, y1: y }, shadowOf(pot, 0.6), 4 * s, 0.35, 'bottom', 2);
  inkLine(ctx, body, pot, 1, 0.65);
  const rim = (): void => roundRect(ctx, x - 15 * s, rimY - 1, 30 * s, 6 * s, 2 * s);
  ctx.fillStyle = mix(pot, lightOf(pot, 0.4), 0.5);
  rim();
  ctx.fill();
  cylinderShade(ctx, rim, x - 15 * s, x + 15 * s, pot, 0.5, 0.5);
  ctx.fillStyle = rgba(lightOf(pot, 0.9), 0.55);
  ctx.fillRect(x - 13 * s, rimY - 0.4, 24 * s, 1);
  inkLine(ctx, rim, pot, 0.9, 0.6);
  ctx.fillStyle = rgba(shadowOf(pot, 0.6), 0.5);
  ctx.fillRect(x - 13 * s, rimY + 5 * s - 1, 26 * s, 1.2);
}

function drawBooks(ctx: Ctx, d: DecorPlacement, seed: number): void {
  const n = d.w ?? 5;
  if (n <= 0) return;
  const cols = ['#8FA9C8', '#D99A92', '#E8CB86', '#9DB894', '#B8A6CC', '#D6A27E', '#E9DFCB'];
  let x = d.x;
  const widths: number[] = [];
  for (let k = 0; k < n; k++) widths.push(6.5 + hash01(seed, k) * 4.5);
  const total = widths.reduce((a, b) => a + b + 0.6, 0);
  contactShadow(ctx, d.x + total / 2, d.y, total / 2 + 1, 0.3, 0.5);
  for (let k = 0; k < n; k++) {
    const bw = widths[k];
    const bh = 21 + hash01(seed, k + 3) * 12;
    const c = cols[Math.floor(hash01(seed, k + 7) * cols.length)];
    const lean = k === n - 1 && hash01(seed, 31) > 0.45 ? -0.2 : 0;
    ctx.save();
    ctx.translate(x + (lean ? bw : 0), d.y);
    ctx.rotate(lean);
    const bx = lean ? -bw : 0;
    const spine = (): void => roundRect(ctx, bx, -bh, bw, bh, 1.2);
    ctx.fillStyle = c;
    spine();
    ctx.fill();
    cylinderShade(ctx, spine, bx, bx + bw, c, 0.55, 0.5);
    // gilt bands and a label
    ctx.fillStyle = rgba(mix(PALETTE.butter, '#FFF6E0', 0.3), 0.85);
    ctx.fillRect(bx + 0.8, -bh + 3, bw - 1.6, 0.9);
    ctx.fillRect(bx + 0.8, -5, bw - 1.6, 0.9);
    if (hash01(seed, k + 50) > 0.4) {
      ctx.fillStyle = 'rgba(250,244,230,0.85)';
      ctx.fillRect(bx + 1.6, -bh * 0.62, bw - 3.2, bh * 0.16);
      ctx.fillStyle = rgba(lineOf(c), 0.5);
      ctx.fillRect(bx + 2.3, -bh * 0.56, bw - 4.6, 0.6);
    }
    inkLine(ctx, spine, c, 0.8, 0.6);
    ctx.restore();
    x += bw + 0.6;
  }
}

function drawJars(ctx: Ctx, d: DecorPlacement, seed: number): void {
  const n = d.w ?? 3;
  const fills = [PALETTE.butter, PALETTE.terracotta, PALETTE.sage, PALETTE.rose];
  for (let k = 0; k < n; k++) {
    const x = d.x + k * 18;
    const h = 18 + hash01(seed, k) * 10;
    const y = d.y;
    const glass = (): void => roundRect(ctx, x - 7, y - h, 14, h, 3.6);
    contactShadow(ctx, x, y, 7.5, 0.3, 0.5);
    // the wall seen through the glass, faintly tinted
    ctx.fillStyle = 'rgba(214,232,240,0.38)';
    glass();
    ctx.fill();
    // contents
    const fill = fills[(k + Math.floor(hash01(seed, 9) * 4)) % fills.length];
    const ch = h * (0.5 + hash01(seed, k + 4) * 0.2);
    const cont = (): void => roundRect(ctx, x - 6, y - ch - 1, 12, ch, 2.6);
    ctx.fillStyle = fill;
    cont();
    ctx.fill();
    paintTex(ctx, cont, 'speckle', 0.45, 0.28, 0.28, x);
    cylinderShade(ctx, cont, x - 6, x + 6, fill, 0.45, 0.5);
    ctx.fillStyle = rgba(lightOf(fill, 0.7), 0.6);
    ctx.fillRect(x - 5.4, y - ch - 1, 10.8, 1);
    // a hand-written label
    ctx.fillStyle = '#F7F0E2';
    ctx.fillRect(x - 5, y - h * 0.52, 10, 6.4);
    ctx.fillStyle = rgba(fill, 0.9);
    ctx.fillRect(x - 5, y - h * 0.52, 10, 1.2);
    ctx.strokeStyle = 'rgba(110,94,110,0.55)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x - 3.4, y - h * 0.52 + 3.4);
    ctx.quadraticCurveTo(x - 1.5, y - h * 0.52 + 2.4, x, y - h * 0.52 + 3.6);
    ctx.quadraticCurveTo(x + 1.6, y - h * 0.52 + 4.4, x + 3.2, y - h * 0.52 + 3.2);
    ctx.stroke();
    // glass: highlights and a crisp edge
    specular(ctx, x - 4.2, y - h * 0.55, h * 0.7, 1.4, Math.PI / 2, 0.75, '#FFFFFF', 0.05);
    glint(ctx, x - 4, y - h + 4, 0.8, 0.9);
    ctx.strokeStyle = 'rgba(120,150,170,0.6)';
    ctx.lineWidth = 0.9;
    glass();
    ctx.stroke();
    // a gingham cloth cover tied with string
    const cloth = k % 2 ? PALETTE.rose : PALETTE.teacup;
    ctx.fillStyle = cloth;
    ctx.beginPath();
    ctx.moveTo(x - 8.6, y - h + 3.4);
    ctx.quadraticCurveTo(x - 8, y - h - 3.6, x, y - h - 3.8);
    ctx.quadraticCurveTo(x + 8, y - h - 3.6, x + 8.6, y - h + 3.4);
    ctx.lineTo(x + 6, y - h + 1.4);
    ctx.lineTo(x + 3, y - h + 3);
    ctx.lineTo(x, y - h + 1.4);
    ctx.lineTo(x - 3, y - h + 3);
    ctx.lineTo(x - 6, y - h + 1.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(lightOf(cloth, 1), 0.55);
    for (let gx = -6; gx <= 6; gx += 3) ctx.fillRect(x + gx - 0.6, y - h - 3, 1.2, 5);
    ctx.fillStyle = rgba(lightOf(cloth, 0.6), 0.6);
    ctx.fillRect(x - 6, y - h - 2.2, 4, 1.2);
    ctx.strokeStyle = '#B79E7E';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x - 7.2, y - h + 0.6);
    ctx.lineTo(x + 7.2, y - h + 0.6);
    ctx.stroke();
  }
}

function drawTeapot(ctx: Ctx, d: DecorPlacement, seed: number): void {
  const x = d.x;
  const y = d.y;
  const c = mix(PALETTE.teacup, '#C9D6E4', 0.15);
  contactShadow(ctx, x, y, 14, 0.34, 0.6);
  // handle and spout behind/beside the belly
  ctx.lineCap = 'round';
  ctx.strokeStyle = shadowOf(c, 0.25);
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  ctx.moveTo(x - 13, y - 19);
  ctx.bezierCurveTo(x - 25, y - 21, x - 25, y - 6, x - 13, y - 8);
  ctx.stroke();
  ctx.strokeStyle = rgba(lightOf(c, 0.7), 0.7);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 15, y - 19.6);
  ctx.bezierCurveTo(x - 24, y - 20.5, x - 24.5, y - 10, x - 21, y - 9);
  ctx.stroke();
  const spout = (): void => {
    ctx.beginPath();
    ctx.moveTo(x + 11, y - 16);
    ctx.bezierCurveTo(x + 18, y - 16, x + 21, y - 21, x + 25, y - 27);
    ctx.lineTo(x + 28, y - 26);
    ctx.bezierCurveTo(x + 24, y - 18, x + 21, y - 9, x + 12, y - 7);
    ctx.closePath();
  };
  ctx.fillStyle = c;
  spout();
  ctx.fill();
  cylinderShade(ctx, spout, x + 11, x + 28, c, 0.5, 0.55);
  inkLine(ctx, spout, c, 0.9, 0.6);
  // the belly
  const belly = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - 9, y - 1);
    ctx.bezierCurveTo(x - 20, y - 3, x - 18, y - 24, x, y - 24);
    ctx.bezierCurveTo(x + 18, y - 24, x + 20, y - 3, x + 9, y - 1);
    ctx.closePath();
  };
  ctx.fillStyle = c;
  belly();
  ctx.fill();
  roundShade(ctx, belly, { x0: x - 17, y0: y - 24, x1: x + 17, y1: y }, c, 0.5, 0.45);
  // a hand-painted band of tiny flowers, squashed toward the edges
  for (let k = -3; k <= 3; k++) {
    const t = k / 3.6;
    const fx = x + Math.sin(t * 1.25) * 14.5;
    const sq = Math.cos(t * 1.25);
    ctx.fillStyle = 'rgba(252,247,236,0.88)';
    ctx.beginPath();
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2 + seed;
      ctx.moveTo(fx + Math.cos(a) * 1.3 * sq + 0.8 * sq, y - 12 + Math.sin(a) * 1.3);
      ctx.ellipse(fx + Math.cos(a) * 1.3 * sq, y - 12 + Math.sin(a) * 1.3, 0.8 * sq, 0.8, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = PALETTE.butter;
    ctx.beginPath();
    ctx.ellipse(fx, y - 12, 0.55 * sq, 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  specular(ctx, x - 9, y - 15, 12, 2.2, -1.25, 0.65);
  glint(ctx, x - 7.5, y - 19, 1.1);
  inkLine(ctx, belly, c, 1, 0.65);
  // lid and knob
  const lid = (): void => {
    ctx.beginPath();
    ctx.ellipse(x, y - 24, 9, 3.4, 0, Math.PI, 0);
    ctx.closePath();
  };
  ctx.fillStyle = lightOf(c, 0.15);
  lid();
  ctx.fill();
  inkLine(ctx, lid, c, 0.8, 0.55);
  knob(ctx, x, y - 28.6, 2.6, lightOf(c, 0.2));
}

function drawFruit(ctx: Ctx, d: DecorPlacement, seed: number): void {
  const fruit: Array<[number, number, number, string, 'orange' | 'apple' | 'lemon']> = [
    [d.x - 11, d.y - 6.4, 6.6, PALETTE.ginger, 'orange'],
    [d.x + 11, d.y - 6, 6.2, '#F0CE6E', 'lemon'],
    [d.x, d.y - 12, 6.6, '#E58C82', 'apple'],
  ];
  contactShadow(ctx, d.x, d.y, 18, 0.32, 0.6);
  for (const [fx, fy, r, c, kind] of fruit) {
    const path = (): void => {
      ctx.beginPath();
      if (kind === 'lemon') ctx.ellipse(fx, fy, r * 1.18, r * 0.9, -0.12, 0, Math.PI * 2);
      else ctx.arc(fx, fy, r, 0, Math.PI * 2);
    };
    ctx.fillStyle = c;
    path();
    ctx.fill();
    roundShade(ctx, path, boxOf(fx, fy, r * 1.15, r), c, 0.55, 0.5);
    if (kind === 'orange') paintTex(ctx, path, 'speckle', 0.5, 0.22, 0.22, fx);
    edgeShade(ctx, path, boxOf(fx, fy, r * 1.15, r), lightOf(c, 0.9), 1.4, 0.35, 'light', 2);
    inkLine(ctx, path, c, 0.9, 0.6);
    glint(ctx, fx - r * 0.38, fy - r * 0.4, r * 0.14, 0.75);
    if (kind === 'apple') {
      ctx.strokeStyle = '#7A5E4E';
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(fx, fy - r + 1.4);
      ctx.quadraticCurveTo(fx + 0.6, fy - r - 1.6, fx + 1.6, fy - r - 3);
      ctx.stroke();
      leafShape(ctx, fx + 1.2, fy - r - 1.4, 5, 1.7, -0.25 + jit(seed, 1) * 0.2, '#8DB283', lightOf('#8DB283', 0.4));
    } else if (kind === 'orange') {
      ctx.fillStyle = shadowOf(c, 0.5);
      ctx.beginPath();
      ctx.arc(fx + r * 0.25, fy - r * 0.62, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawYarn(ctx: Ctx, d: DecorPlacement, seed: number): void {
  const x = d.x;
  const r = 9.5;
  const cy = d.y - r;
  const c = mix(PALETTE.rose, '#E9B7B2', 0.3);
  contactShadow(ctx, x, d.y, r * 0.95, 0.34, 0.6);
  // the loose strand trailing across the floor
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + 6, d.y - 3);
  ctx.bezierCurveTo(x + 14, d.y + 3, x + 22, d.y - 1, x + 30, d.y + 2.5);
  ctx.stroke();
  // knitting needles behind the ball
  for (const [a, len] of [
    [-2.2, 21],
    [-1.75, 19],
  ]) {
    const ex = x + Math.cos(a) * len;
    const ey = cy + Math.sin(a) * len;
    ctx.strokeStyle = '#C8B39A';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 3, cy + Math.sin(a) * 3);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    knob(ctx, ex, ey, 1.7, '#D98C7C');
  }
  const ball = (): void => {
    ctx.beginPath();
    ctx.arc(x, cy, r, 0, Math.PI * 2);
  };
  ctx.fillStyle = c;
  ball();
  ctx.fill();
  // wound strands in three directions
  ctx.save();
  ball();
  ctx.clip();
  for (let g = 0; g < 3; g++) {
    const rot = g * 1.05 + hash01(seed, g) * 0.4;
    for (let k = -3; k <= 3; k++) {
      ctx.save();
      ctx.translate(x, cy);
      ctx.rotate(rot);
      ctx.strokeStyle = rgba(shadowOf(c, 0.45), 0.55);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(0, k * 2.2, r * 1.05, r * 0.38, 0, Math.PI * 0.05, Math.PI * 0.95);
      ctx.stroke();
      ctx.strokeStyle = rgba(lightOf(c, 0.6), 0.45);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.ellipse(0, k * 2.2 - 0.8, r * 1.05, r * 0.38, 0, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
  roundShade(ctx, ball, boxOf(x, cy, r), c, 0.45, 0.5);
  inkLine(ctx, ball, c, 1, 0.6);
}

export function drawDecor(ctx: Ctx, d: DecorPlacement, theme: Theme, seed: number): void {
  const s = Math.floor(seed);
  ctx.save();
  switch (d.type) {
    case 'window':
      drawWindow(ctx, d, theme, s);
      break;
    case 'plant':
      drawPlant(ctx, d, s);
      break;
    case 'picture':
      drawPicture(ctx, d, theme, s);
      break;
    case 'clock':
      drawClock(ctx, d, theme, s);
      break;
    case 'pendant':
      drawPendant(ctx, d, theme);
      break;
    case 'rug':
      drawRug(ctx, d, theme, s);
      break;
    case 'backsplash':
      drawBacksplash(ctx, d, theme, s);
      break;
    case 'books':
      drawBooks(ctx, d, s);
      break;
    case 'jars':
      drawJars(ctx, d, s);
      break;
    case 'towel':
      drawTowel(ctx, d, theme, s);
      break;
    case 'mirror':
      drawMirror(ctx, d, theme);
      break;
    case 'garland':
      drawGarland(ctx, d, s);
      break;
    case 'radiator':
      drawRadiator(ctx, d, theme);
      break;
    case 'teapot':
      drawTeapot(ctx, d, s);
      break;
    case 'fruit':
      drawFruit(ctx, d, s);
      break;
    case 'yarn':
      drawYarn(ctx, d, s);
      break;
  }
  ctx.restore();
}
