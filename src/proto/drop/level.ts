// Cat Drop: the endless house, generated storey by storey below the cat. Each
// storey is a room of the house in cross-section (its own theme) holding one or
// two hand-designed obstacle patterns, and ends in a floor slab with a hatch to
// fall through. Geometry and gameplay only (no drawing): every piece also
// leaves a small art description that the painter turns into cached art.

import type { ThemeId } from '../../game/room';
import type { DecorPlacement } from '../../game/room';
import { capsule, roundedBox, type Material, type StaticShape } from '../../physics/shapes';
import { rng } from '../kit';

/** Shaft width in world units (the original room's width). */
export const SHAFT_W = 380;
/** World units per metre of depth. */
export const UNITS_PER_M = 50;
/** Floor slab thickness: the floorboards seen from above, then the cut. */
export const SLAB = 56;
/** The floorboards' band at the top of the slab (seen in perspective). */
export const SLAB_BAND = 24;
/** Largest radius any cat may grow to (the biggest cat must fit every gap). */
export const MAX_RADIUS = 56;

const PLANK_R = 6;
const GLASS_R = 4;

/** A painted piece of the level, in world units. */
export type Art =
  | { k: 'shelf'; ax: number; ay: number; bx: number; by: number; wall: -1 | 1 }
  | { k: 'ramp'; ax: number; ay: number; bx: number; by: number }
  | { k: 'beam'; ax: number; ay: number; bx: number; by: number }
  | { k: 'pillow'; x: number; y: number; w: number; h: number; color: string; seed: number }
  /** A glass cone: its left and right walls run from (lx, ly) and (rx, ry) down to the tube's neck. */
  | { k: 'funnel'; cx: number; lx: number; ly: number; rx: number; ry: number; mouth: number; hw: number; tint: string }
  | { k: 'tube'; cx: number; y0: number; y1: number; hw: number; tint: string; funnel: boolean }
  | { k: 'slab'; y: number; holes: [number, number][] }
  | { k: 'roof'; y: number }
  | { k: 'perch'; x0: number; x1: number; y: number };

export interface Fish {
  x: number;
  y: number;
  /** Resting place (fish bob around it and drift to a nearby cat). */
  hx: number;
  hy: number;
  golden: boolean;
  eaten: boolean;
  phase: number;
  dir: 1 | -1;
}

export interface Cushion {
  shape: StaticShape;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  seed: number;
  /** Squash spring (0 = rest), its velocity, and the frame it last bounced a cat. */
  squash: number;
  vel: number;
  hitFrame: number;
  /** How far its collider has sunk with the squash. */
  sunk: number;
}

/**
 * A narrow place the cat squeezes through (glass tubes, hatch holes, gaps
 * between pillows): inside it the cat is gently drawn down, which a ring body
 * needs (it has no hydrostatic pressure to push itself through).
 */
export interface Squeeze {
  x0: number;
  x1: number;
  /** Where the pull starts (the mouth) and where the narrow part ends. */
  y0: number;
  y1: number;
  /** Pull strength (units/s^2). */
  force: number;
  /**
   * 'tube': glass tubes (the cat's shape relaxes so it noodles through);
   * 'soft': gaps between pillows (always helped); 'gap': hatches and shelf
   * gaps, and 'funnel': the cone above a tube (both helped only once the
   * cat is stuck in or over them).
   */
  kind: 'tube' | 'soft' | 'gap' | 'funnel';
  entered: boolean;
  exited: boolean;
}

/** An opening below which the way continues (for nudging, or rescuing, a stuck cat). */
export interface Gap {
  y: number;
  x0: number;
  x1: number;
  /** Just below the opening: where the way down is clear again. */
  below: number;
}

export type PatternKind = 'attic' | 'shelves' | 'zigzag' | 'cushions' | 'pillows' | 'funnel' | 'twin' | 'floor';

export interface Chunk {
  id: number;
  kind: PatternKind;
  storey: number;
  y0: number;
  y1: number;
  shapes: StaticShape[];
  cushions: Cushion[];
  squeezes: Squeeze[];
  fish: Fish[];
  gaps: Gap[];
  /** Painted under the cat, and over it (glass fronts). */
  art: Art[];
}

export interface StoreyTheme {
  theme: ThemeId;
  name: string;
}

/** The house from the attic down, cycling. */
export const STOREYS: StoreyTheme[] = [
  { theme: 'studio', name: 'Attic' },
  { theme: 'bedroom', name: 'Bedroom' },
  { theme: 'bathroom', name: 'Bathroom' },
  { theme: 'kitchen', name: 'Kitchen' },
  { theme: 'study', name: 'Library' },
  { theme: 'living', name: 'Living room' },
  { theme: 'laundry', name: 'Laundry' },
  { theme: 'pantry', name: 'Pantry' },
  { theme: 'sunroom', name: 'Sunroom' },
];

export interface Storey {
  index: number;
  theme: ThemeId;
  name: string;
  /** Top of the room (under the slab above), its floor line, and the bottom of its slab. */
  top: number;
  floor: number;
  bottom: number;
  seed: number;
  /** Wall decor, in the room's own coordinates (floor line at FLOOR_Y). */
  decor: DecorPlacement[];
  chunks: Chunk[];
}

const TINTS = ['#A9CCEC', '#A6DCC5', '#EDBACB', '#EED49C', '#B4CBEB'];
const PILLOWS = ['#E9A6A0', '#A9C3A0', '#C9B8DD', '#F4D88A', '#8FB3D9', '#F2C7A5'];
const CUSHIONS = ['#D9726A', '#7FA0C8', '#E8964A', '#9DB894', '#B48CC8'];

let nextChunkId = 1;

/** Builds one chunk's pieces. */
class Builder {
  readonly c: Chunk;
  constructor(kind: PatternKind, storey: number, y0: number) {
    this.c = { id: nextChunkId++, kind, storey, y0, y1: y0, shapes: [], cushions: [], squeezes: [], fish: [], gaps: [], art: [] };
  }

  add(s: StaticShape): StaticShape {
    this.c.shapes.push(s);
    return s;
  }

  cap(ax: number, ay: number, bx: number, by: number, r: number, material: Material, friction?: number): StaticShape {
    return this.add(capsule(ax, ay, bx, by, r, { material, friction, propId: this.c.id }));
  }

  box(x: number, y: number, w: number, h: number, r: number, material: Material, friction?: number): StaticShape {
    return this.add(roundedBox(x, y, w, h, r, { material, friction, propId: this.c.id }));
  }

  fish(x: number, y: number, golden = false, dir: 1 | -1 = 1): void {
    this.c.fish.push({ x, y, hx: x, hy: y, golden, eaten: false, phase: x * 0.13 + y * 0.07, dir });
  }

  /** A shelf board from a wall out to `x` (its free end lower by `drop`, so cats slide off). */
  shelf(wall: -1 | 1, x: number, y: number, drop: number): void {
    const wx = wall < 0 ? -10 : SHAFT_W + 10;
    this.cap(wx, y - drop, x, y, PLANK_R, 'wood', 0.45);
    this.c.art.push({ k: 'shelf', ax: wx, ay: y - drop, bx: x, by: y, wall });
  }

  /** The shaft's side walls over this chunk. */
  walls(): void {
    const y0 = this.c.y0 - 90;
    const h = this.c.y1 - this.c.y0 + 180;
    this.box(-80, y0, 80, h, 4, 'wall', 0.3);
    this.box(SHAFT_W, y0, 80, h, 4, 'wall', 0.3);
  }

  done(y1: number): Chunk {
    this.c.y1 = y1;
    this.walls();
    return this.c;
  }
}

type Rand = () => number;

const between = (r: Rand, a: number, b: number): number => a + (b - a) * r();
const chance = (r: Rand, p: number): boolean => r() < p;

/** Context a pattern is generated in. */
interface Ctx {
  r: Rand;
  storey: number;
  /** 0..1, grows with depth. */
  diff: number;
  /** The biggest radius this run's cat can grow to: openings are made to fit it. */
  fit: number;
  /** The narrowest glass tube this cat's skin can stretch through at that size. */
  minTube: number;
}

// ---------------------------------------------------------------------------
// Patterns. Each returns a chunk starting at y0. Every opening is wide enough
// for the biggest cat (MAX_RADIUS), or a squeeze zone helps it through.

function shelves(g: Ctx, y0: number): Chunk {
  const { r } = g;
  const b = new Builder('shelves', g.storey, y0);
  const levels = chance(r, 0.35 + g.diff * 0.4) ? 3 : 2;
  let y = y0 + 80;
  let prev = between(r, 100, 280);
  for (let k = 0; k < levels; k++) {
    const gw = Math.max(between(r, 132, 160) - g.diff * 10, 2 * g.fit + 20);
    // the next gap is on the other side of the shaft: steer!
    let gx: number;
    if (k === 0) gx = between(r, gw / 2 + 24, SHAFT_W - gw / 2 - 24);
    else {
      const left = prev > SHAFT_W / 2;
      gx = left ? between(r, gw / 2 + 10, Math.min(prev - 140, SHAFT_W / 2 - 20)) : between(r, Math.max(prev + 140, SHAFT_W / 2 + 20), SHAFT_W - gw / 2 - 10);
      gx = Math.max(gw / 2 + 4, Math.min(SHAFT_W - gw / 2 - 4, gx));
    }
    const x0 = gx - gw / 2;
    const x1 = gx + gw / 2;
    const drop = between(r, 6, 14);
    if (x0 > 30) b.shelf(-1, x0, y, drop);
    if (x1 < SHAFT_W - 30) b.shelf(1, x1, y, drop);
    b.c.gaps.push({ y, x0, x1, below: y + PLANK_R + 4 });
    b.c.squeezes.push({ x0: x0 + 4, x1: x1 - 4, y0: y - 8, y1: y + 10, force: 900, kind: 'gap', entered: false, exited: false });
    if (chance(r, 0.17)) b.fish(gx + between(r, -20, 20), y - 52, chance(r, 0.06), chance(r, 0.5) ? 1 : -1);
    else if (chance(r, 0.18)) {
      // on a board, near the wall: a detour
      const onLeft = x0 > 110;
      const fx = onLeft ? between(r, 40, x0 - 40) : between(r, x1 + 40, SHAFT_W - 40);
      if (fx > 30 && fx < SHAFT_W - 30) b.fish(fx, y - 30, false, onLeft ? 1 : -1);
    }
    prev = gx;
    y += between(r, 150, 170);
  }
  return b.done(y - 30);
}

function zigzag(g: Ctx, y0: number): Chunk {
  const { r } = g;
  const b = new Builder('zigzag', g.storey, y0);
  const n = chance(r, 0.4 + g.diff * 0.3) ? 4 : 3;
  let side: -1 | 1 = chance(r, 0.5) ? -1 : 1;
  let y = y0 + 70;
  for (let k = 0; k < n; k++) {
    const len = Math.min(SHAFT_W * between(r, 0.6, 0.66), SHAFT_W - 2 * g.fit - 30);
    const drop = between(r, 84, 104);
    const wx = side < 0 ? -10 : SHAFT_W + 10;
    const ex = side < 0 ? len : SHAFT_W - len;
    b.cap(wx, y, ex, y + drop, PLANK_R, 'wood', 0.35);
    b.c.art.push({ k: 'ramp', ax: wx, ay: y, bx: ex, by: y + drop });
    const gx0 = side < 0 ? ex + PLANK_R : 0;
    const gx1 = side < 0 ? SHAFT_W : ex - PLANK_R;
    b.c.gaps.push({ y: y + drop, x0: gx0, x1: gx1, below: y + drop + PLANK_R + 6 });
    if (chance(r, 0.15)) b.fish((gx0 + gx1) / 2 + side * 6, y + drop + 34, chance(r, 0.05), side < 0 ? 1 : -1);
    y += drop + between(r, 96, 112);
    side = side < 0 ? 1 : -1;
  }
  return b.done(y - 40);
}

function cushions(g: Ctx, y0: number): Chunk {
  const { r } = g;
  const b = new Builder('cushions', g.storey, y0);
  let y = y0 + 150;
  let centre = chance(r, 0.5);
  const rows = 2;
  for (let k = 0; k < rows; k++) {
    const h = 30;
    const color = CUSHIONS[Math.floor(r() * CUSHIONS.length)];
    const add = (x: number, w: number): void => {
      const shape = b.box(x, y, w, h, 13, 'fabric', 0.6);
      b.c.cushions.push({ shape, x, y, w, h, color, seed: Math.floor(r() * 1e6), squash: 0, vel: 0, hitFrame: -999, sunk: 0 });
    };
    if (centre) {
      const side = 2 * g.fit + 26;
      const w = Math.max(70, Math.min(between(r, 124, 146), SHAFT_W - 2 * side - 8));
      const x = between(r, side, SHAFT_W - side - w);
      add(x, w);
      b.c.gaps.push({ y, x0: 0, x1: x, below: y + h + 14 }, { y, x0: x + w, x1: SHAFT_W, below: y + h + 14 });
      // a fish high over the cushion: bounce for it
      if (chance(r, 0.34)) b.fish(x + w / 2, y - between(r, 100, 130), chance(r, 0.15), chance(r, 0.5) ? 1 : -1);
    } else {
      const gw = Math.max(between(r, 140, 160), 2 * g.fit + 34);
      const gx = between(r, Math.max(150, gw / 2 + 50), Math.min(SHAFT_W - 150, SHAFT_W - gw / 2 - 50));
      add(-14, gx - gw / 2 + 14);
      add(gx + gw / 2, SHAFT_W - gx - gw / 2 + 14);
      b.c.gaps.push({ y, x0: gx - gw / 2, x1: gx + gw / 2, below: y + h + 14 });
      if (chance(r, 0.15)) b.fish(gx, y + 10, false, chance(r, 0.5) ? 1 : -1);
    }
    centre = !centre;
    y += between(r, 190, 215);
  }
  return b.done(y - 50);
}

function pillows(g: Ctx, y0: number): Chunk {
  const { r } = g;
  const b = new Builder('pillows', g.storey, y0);
  let y = y0 + 90;
  const rows = 2;
  let prev: number[] = [];
  for (let k = 0; k < rows; k++) {
    const h = 40;
    const gw = Math.max(between(r, 72, 84) - g.diff * 6, 1.45 * g.fit + 6);
    // two gaps per row, away from the walls and from the row above's
    const lo = gw / 2 + 46;
    const hi = SHAFT_W - gw / 2 - 46;
    // (a pillow between them at least 60 wide; one gap if two don't fit)
    let gaps: number[] = [];
    for (let tries = 0; tries < 12; tries++) {
      const a = between(r, lo, (lo + hi) / 2 - 20);
      const c = Math.max(a + gw + 60, between(r, (lo + hi) / 2 + 20, hi));
      gaps = c <= hi ? [a, c] : [between(r, lo, hi)];
      if (!prev.some((p) => gaps.some((q) => Math.abs(p - q) < 50))) break;
    }
    prev = gaps;
    // pillows between the gaps, the outer ones tucked into the walls
    const edges = [-20, ...gaps.flatMap((gx) => [gx - gw / 2, gx + gw / 2]), SHAFT_W + 20];
    for (let i = 0; i < edges.length; i += 2) {
      const x0 = edges[i];
      const x1 = edges[i + 1];
      if (x1 - x0 < 24) continue;
      b.box(x0, y, x1 - x0, h, 16, 'fabric', 0.4);
      b.c.art.push({ k: 'pillow', x: x0, y, w: x1 - x0, h, color: PILLOWS[Math.floor(r() * PILLOWS.length)], seed: Math.floor(r() * 1e6) });
    }
    for (const gx of gaps) {
      const gx0 = gx - gw / 2;
      const gx1 = gx + gw / 2;
      b.c.gaps.push({ y, x0: gx0, x1: gx1, below: y + h + 6 });
      b.c.squeezes.push({ x0: gx0 + 2, x1: gx1 - 2, y0: y - 6, y1: y + h + 6, force: 1600, kind: 'soft', entered: false, exited: false });
      if (chance(r, 0.11)) b.fish(gx, y + h / 2, chance(r, 0.08), chance(r, 0.5) ? 1 : -1);
    }
    y += h + between(r, 110, 130);
  }
  return b.done(y - 40);
}

/** A glass funnel across the shaft narrowing into a glass tube: squeeze through. */
function funnel(g: Ctx, y0: number): Chunk {
  const { r } = g;
  const b = new Builder('funnel', g.storey, y0);
  const tint = TINTS[Math.floor(r() * TINTS.length)];
  const inner = Math.max(g.minTube, 30, between(r, 32, 38) - g.diff * 3);
  const hw = inner / 2 + GLASS_R;
  const cx = between(r, 120, SHAFT_W - 120);
  const top = y0 + 80;
  const x0 = -6;
  const x1 = SHAFT_W + 6;
  // steep enough on both sides that nobody sits on the slope
  const span = Math.max(cx - hw - x0, x1 - cx - hw);
  const mouth = top + Math.max(130, span * 0.72);
  const len = between(r, 120, 170) + g.diff * 60;
  const exit = mouth + len;
  const glass = 0.12;
  b.cap(x0, top, cx - hw, mouth, GLASS_R, 'glass', glass);
  b.cap(x1, top, cx + hw, mouth, GLASS_R, 'glass', glass);
  b.cap(cx - hw, mouth, cx - hw, exit, GLASS_R, 'glass', glass);
  b.cap(cx + hw, mouth, cx + hw, exit, GLASS_R, 'glass', glass);
  b.c.art.push({ k: 'funnel', cx, lx: x0, ly: top, rx: x1, ry: top, mouth, hw, tint });
  b.c.art.push({ k: 'tube', cx, y0: mouth, y1: exit, hw, tint, funnel: true });
  b.c.squeezes.push({ x0, x1, y0: top, y1: mouth - 8, force: 1400, kind: 'funnel', entered: false, exited: false });
  b.c.squeezes.push({ x0: cx - inner / 2 - 1, x1: cx + inner / 2 + 1, y0: mouth - 8, y1: exit, force: 2600, kind: 'tube', entered: false, exited: false });
  b.c.gaps.push({ y: mouth, x0: cx - inner / 2, x1: cx + inner / 2, below: exit + 6 });
  // a fish in the tube (eaten mid-squeeze), sometimes golden, and one in the funnel
  if (chance(r, 0.3)) b.fish(cx, mouth + len * 0.55, chance(r, 0.2), chance(r, 0.5) ? 1 : -1);
  if (chance(r, 0.11)) b.fish(cx + between(r, -60, 60), top + 30, false, chance(r, 0.5) ? 1 : -1);
  return b.done(exit + 120);
}

/** Two funnels side by side: a narrow tube with a golden fish, a wide one without. */
function twin(g: Ctx, y0: number): Chunk {
  const { r } = g;
  const b = new Builder('twin', g.storey, y0);
  const tint = TINTS[Math.floor(r() * TINTS.length)];
  const top = y0 + 80;
  const peak = between(r, 170, 210);
  const narrowLeft = chance(r, 0.5);
  const glass = 0.12;
  const tubes: { cx: number; inner: number }[] = [
    { cx: between(r, 80, 100), inner: narrowLeft ? Math.max(30, g.minTube) : Math.max(44, g.minTube + 12) },
    { cx: SHAFT_W - between(r, 80, 100), inner: narrowLeft ? Math.max(44, g.minTube + 12) : Math.max(30, g.minTube) },
  ];
  const mouth = top + 150;
  const len = between(r, 120, 150) + g.diff * 40;
  const exit = mouth + len;
  // the divider: an inverted V between the two funnels
  const ridgeY = top - 30;
  tubes.forEach((t, i) => {
    const hw = t.inner / 2 + GLASS_R;
    const outer = i === 0 ? -6 : SHAFT_W + 6;
    const inX = i === 0 ? t.cx - hw : t.cx + hw;
    const midX = i === 0 ? t.cx + hw : t.cx - hw;
    b.cap(outer, top, inX, mouth, GLASS_R, 'glass', glass);
    b.cap(peak, ridgeY, midX, mouth, GLASS_R, 'glass', glass);
    b.cap(t.cx - hw, mouth, t.cx - hw, exit, GLASS_R, 'glass', glass);
    b.cap(t.cx + hw, mouth, t.cx + hw, exit, GLASS_R, 'glass', glass);
    const fx0 = i === 0 ? outer : peak;
    const fx1 = i === 0 ? peak : outer;
    b.c.art.push({ k: 'funnel', cx: t.cx, lx: fx0, ly: i === 0 ? top : ridgeY, rx: fx1, ry: i === 0 ? ridgeY : top, mouth, hw, tint });
    b.c.art.push({ k: 'tube', cx: t.cx, y0: mouth, y1: exit, hw, tint, funnel: true });
    b.c.squeezes.push({ x0: Math.min(fx0, fx1), x1: Math.max(fx0, fx1), y0: top, y1: mouth - 8, force: 1400, kind: 'funnel', entered: false, exited: false });
    b.c.squeezes.push({ x0: t.cx - t.inner / 2 - 1, x1: t.cx + t.inner / 2 + 1, y0: mouth - 8, y1: exit, force: 2600, kind: 'tube', entered: false, exited: false });
    b.c.gaps.push({ y: mouth, x0: t.cx - t.inner / 2, x1: t.cx + t.inner / 2, below: exit + 6 });
    const narrow = t.inner === Math.min(tubes[0].inner, tubes[1].inner);
    if (narrow) b.fish(t.cx, mouth + len * 0.5, true, 1);
    else if (chance(r, 0.15)) b.fish(t.cx, mouth + len * 0.5, false, -1);
  });
  return b.done(exit + 120);
}

/** The floor slab at the bottom of a storey, with one or two open hatches. */
function floor(g: Ctx, y: number): Chunk {
  const { r } = g;
  const b = new Builder('floor', g.storey, y - 70);
  const holes: [number, number][] = [];
  const w2 = Math.max(between(r, 128, 140), 2 * g.fit + 18);
  if (chance(r, 0.3) && SHAFT_W - 2 * w2 >= 84) {
    // two hatches, one at each wall, with a solid floor between them
    holes.push([0, w2], [SHAFT_W - w2, SHAFT_W]);
  } else {
    const w = Math.max(between(r, 146, 168) - g.diff * 8, 2 * g.fit + 30);
    const c = between(r, 30 + w / 2, SHAFT_W - 30 - w / 2);
    holes.push([c - w / 2, c + w / 2]);
  }
  // the solid floor between the hatches (a hatch at a wall reaches into it)
  let x = -40;
  for (const [h0, h1] of holes) {
    if (h0 > 1) b.box(x, y, h0 - x, SLAB, 6, 'wood', 0.5);
    x = h1 < SHAFT_W - 1 ? h1 : SHAFT_W + 40;
  }
  if (x < SHAFT_W + 40) b.box(x, y, SHAFT_W + 40 - x, SLAB, 6, 'wood', 0.5);
  for (const [h0, h1] of holes) {
    b.c.gaps.push({ y, x0: h0, x1: h1, below: y + SLAB + 4 });
    b.c.squeezes.push({ x0: h0 + 4, x1: h1 - 4, y0: y - 8, y1: y + SLAB, force: 900, kind: 'gap', entered: false, exited: false });
    if (chance(r, 0.12)) b.fish((h0 + h1) / 2, y - 46, chance(r, 0.05), chance(r, 0.5) ? 1 : -1);
  }
  b.c.art.push({ k: 'slab', y, holes });
  return b.done(y + SLAB);
}

/** The attic: under the roof, a perch where the cat starts. */
function attic(g: Ctx, y0: number, startX: number): { chunk: Chunk; perchY: number } {
  const b = new Builder('attic', g.storey, y0);
  const perchY = y0 + 330;
  const x0 = -10;
  const x1 = startX + 46;
  b.cap(x0, perchY, x1, perchY, PLANK_R, 'wood', 0.6);
  b.c.art.push({ k: 'roof', y: y0 });
  b.c.art.push({ k: 'perch', x0, x1, y: perchY });
  b.c.gaps.push({ y: perchY, x0: x1, x1: SHAFT_W, below: perchY + PLANK_R + 4 });
  b.fish(258, perchY + 90, false, -1);
  return { chunk: b.done(perchY + 170), perchY };
}

// ---------------------------------------------------------------------------

type PatternFn = (g: Ctx, y0: number) => Chunk;
const PATTERNS: [Exclude<PatternKind, 'attic' | 'floor'>, PatternFn, number][] = [
  ['shelves', shelves, 1.1],
  ['funnel', funnel, 1.2],
  ['zigzag', zigzag, 0.9],
  ['cushions', cushions, 0.9],
  ['pillows', pillows, 0.8],
  ['twin', twin, 0.55],
];

/**
 * Wall and floor decor for a room of the given height, in the room's own
 * coordinates (floor line at 560), varied by room type; nothing stands on the
 * floor over a hatch.
 */
function decorFor(r: Rand, theme: ThemeId, height: number, attic: boolean, holes: [number, number][]): DecorPlacement[] {
  const out: DecorPlacement[] = [];
  const F = 560;
  const top = F - height;
  if (attic) {
    // under the roof: a picture and a clock, low on the wall
    out.push({ type: 'picture', x: 300, y: top + 300, w: 50, h: 40, variant: 1 });
    out.push({ type: 'clock', x: 64, y: top + 520, w: 17 });
    return out;
  }
  const solid = (x: number, half: number): boolean => holes.every(([h0, h1]) => x + half < h0 - 4 || x - half > h1 + 4);
  const floorSpot = (half: number): number | null => {
    for (let k = 0; k < 10; k++) {
      const x = between(r, 24 + half, SHAFT_W - 24 - half);
      if (solid(x, half)) return x;
    }
    return null;
  };
  // one main window, somewhere along the wall (sunrooms get two)
  const wy = top + between(r, 90, Math.max(110, height * 0.32));
  const wx = between(r, 110, 270);
  const variant = theme === 'bathroom' || theme === 'laundry' ? 1 : chance(r, 0.5) ? 0 : 2;
  out.push({ type: 'window', x: wx, y: wy, w: theme === 'pantry' ? 76 : 92, h: theme === 'pantry' ? 100 : 124, variant });
  if (theme === 'sunroom') out.push({ type: 'window', x: wx < 190 ? wx + 150 : wx - 150, y: wy + 30, w: 76, h: 110, variant: 0 });
  const side = wx < 190 ? 1 : -1;
  const far = (a: number, b: number): number => (side > 0 ? between(r, SHAFT_W - b, SHAFT_W - a) : between(r, a, b));
  const lower = top + height * 0.62;
  switch (theme) {
    case 'bedroom':
      out.push({ type: 'garland', x: 190, y: top + 34, w: 300 });
      out.push({ type: 'picture', x: far(54, 80), y: wy + 20, w: 46, h: 58, variant: Math.floor(r() * 3) });
      if (height > 700) out.push({ type: 'mirror', x: far(60, 90), y: lower, w: 46, h: 64 });
      break;
    case 'bathroom':
      out.push({ type: 'mirror', x: far(56, 76), y: wy + 6, w: 50, h: 72 });
      out.push({ type: 'towel', x: side > 0 ? 54 : 326, y: wy + 40 });
      break;
    case 'kitchen':
      out.push({ type: 'clock', x: far(50, 70), y: wy + 26, w: 18 });
      out.push({ type: 'backsplash', x: side > 0 ? SHAFT_W - 130 : 0, y: F - 176, w: 130, h: 86 });
      break;
    case 'study':
      // a little gallery wall
      out.push({ type: 'picture', x: far(48, 64), y: wy - 6, w: 44, h: 54, variant: 0 });
      out.push({ type: 'picture', x: far(48, 64) + (side > 0 ? -2 : 2), y: wy + 64, w: 40, h: 32, variant: 2 });
      out.push({ type: 'clock', x: side > 0 ? 50 : 330, y: lower, w: 17 });
      break;
    case 'living':
      out.push({ type: 'garland', x: 190, y: top + 30, w: 320 });
      out.push({ type: 'picture', x: far(56, 76), y: wy + 10, w: 56, h: 44, variant: Math.floor(r() * 3) });
      break;
    case 'laundry':
      out.push({ type: 'clock', x: far(54, 74), y: wy + 20, w: 17 });
      break;
    case 'pantry':
      out.push({ type: 'picture', x: far(54, 74), y: wy + 10, w: 44, h: 36, variant: 1 });
      break;
    case 'sunroom':
      break;
    default:
      out.push({ type: 'picture', x: far(54, 74), y: wy + 10, w: 50, h: 40, variant: Math.floor(r() * 3) });
  }
  if (height > 800 && theme !== 'study' && theme !== 'bedroom') out.push({ type: 'picture', x: between(r, 110, 270), y: lower, w: 46, h: 58, variant: Math.floor(r() * 3) });
  // (a pendant's cord is painted from a fixed height: only in rooms it reaches the ceiling of)
  if (height < 950 && chance(r, 0.55)) out.push({ type: 'pendant', x: side > 0 ? between(r, 270, 330) : between(r, 50, 110), y: top + 64 });
  // on the floor, clear of the hatches: a rug, a plant, a radiator
  const rugX = floorSpot(70);
  if (rugX !== null && chance(r, 0.6)) out.push({ type: 'rug', x: rugX, y: F, w: 130 });
  if (theme === 'living' || theme === 'laundry' || theme === 'study') {
    const x = floorSpot(42);
    if (x !== null) out.push({ type: 'radiator', x, y: F - 12, w: 76 });
  }
  if (theme === 'sunroom' || theme === 'living' || theme === 'bedroom' || chance(r, 0.3)) {
    const x = floorSpot(20);
    if (x !== null) out.push({ type: 'plant', x, y: F, w: between(r, 34, 44) });
  }
  return out;
}

export class Level {
  readonly storeys: Storey[] = [];
  readonly chunks: Chunk[] = [];
  private readonly r: Rand;
  private cursor: number;
  private last: PatternKind[] = [];
  readonly startX: number;
  readonly perchY: number;

  /**
   * `fit`: the biggest radius the cat can grow to (every opening fits it);
   * `minTube`: the narrowest tube its skin can stretch through at that size.
   */
  constructor(seed: number, readonly fit = MAX_RADIUS, readonly minTube = 30, top = 0) {
    this.r = rng(seed);
    this.cursor = top;
    this.startX = 92;
    this.perchY = 0;
    // the attic: the run starts here
    const s0 = this.beginStorey();
    const { chunk, perchY } = attic({ r: this.r, storey: 0, diff: 0, fit, minTube }, s0.top + 40, this.startX);
    this.perchY = perchY;
    this.push(s0, chunk);
    this.push(s0, this.pattern(s0, chunk.y1));
    this.endStorey(s0, this.lastY(s0) + 50);
  }

  /** Generate storeys until the house reaches below `y`. */
  ensure(y: number): void {
    while (this.cursor < y) {
      const s = this.beginStorey();
      let yy = s.top + 70;
      const n = this.chanceTwo(s.index) ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const c = this.pattern(s, yy);
        this.push(s, c);
        yy = c.y1 + 10;
      }
      this.endStorey(s, yy + 50);
    }
  }

  /** Forget everything above `y` (returns the chunks dropped, so their statics can go). */
  dropAbove(y: number): Chunk[] {
    const out: Chunk[] = [];
    while (this.chunks.length && this.chunks[0].y1 < y) out.push(this.chunks.shift()!);
    while (this.storeys.length > 1 && this.storeys[0].bottom < y) this.storeys.shift();
    return out;
  }

  storeyAt(y: number): Storey | null {
    for (const s of this.storeys) if (y >= s.top && y < s.bottom) return s;
    return null;
  }

  private chanceTwo(index: number): boolean {
    return this.r() < Math.min(0.75, 0.35 + index * 0.04);
  }

  private beginStorey(): Storey {
    const index = this.storeys.length ? this.storeys[this.storeys.length - 1].index + 1 : 0;
    const t = STOREYS[index % STOREYS.length];
    const s: Storey = { index, theme: t.theme, name: t.name, top: this.cursor, floor: 0, bottom: 0, seed: Math.floor(this.r() * 1e6), decor: [], chunks: [] };
    this.storeys.push(s);
    return s;
  }

  private lastY(s: Storey): number {
    return s.chunks.length ? s.chunks[s.chunks.length - 1].y1 : s.top;
  }

  private endStorey(s: Storey, floorY: number): void {
    const diff = Math.min(1, s.index / 14);
    const f = floor({ r: this.r, storey: s.index, diff, fit: this.fit, minTube: this.minTube }, floorY);
    this.push(s, f);
    s.floor = floorY;
    s.bottom = floorY + SLAB;
    const slab = f.art.find((a): a is Extract<Art, { k: 'slab' }> => a.k === 'slab');
    s.decor = decorFor(this.r, s.theme, s.floor - s.top, s.index === 0, slab?.holes ?? []);
    this.cursor = s.bottom;
  }

  private push(s: Storey, c: Chunk): void {
    s.chunks.push(c);
    this.chunks.push(c);
  }

  private pattern(s: Storey, y0: number): Chunk {
    const diff = Math.min(1, s.index / 14);
    const pool = PATTERNS.filter(([k]) => !this.last.includes(k) && (k !== 'twin' || s.index > 1));
    let total = 0;
    for (const p of pool) total += p[2];
    let pick = this.r() * total;
    let chosen = pool[0];
    for (const p of pool) {
      pick -= p[2];
      if (pick <= 0) {
        chosen = p;
        break;
      }
    }
    this.last.push(chosen[0]);
    if (this.last.length > 2) this.last.shift();
    return chosen[1]({ r: this.r, storey: s.index, diff, fit: this.fit, minTube: this.minTube }, y0);
  }
}
