// The Playground: a corner of the sky of your own, as big as you like,
// built of perches and tubes, with a cloud in the middle where the cats
// start (and come back to: a cat that falls off everything lands on it
// again). Geometry and the save only, no drawing: the scene is
// playground.ts, the sky skyArt.ts.

import type { BreedId } from '../physics/breeds';
import { ALL_CATS } from '../house/house';
import { capsule, roundedBox, type StaticShape } from '../physics/shapes';
import type { Surface } from '../game/props';
import { PERCHES, PERCH_ORDER, buildPerch, perchBox, type Box, type PerchKind, type PerchProp } from '../house/perches';
import type { RideTube } from '../house/tubes';
import { pathLength, pointAt } from '../util/path';

/** The respawn cloud: its top's middle at (x, y), and how far it reaches either side. */
export const SPAWN = { x: 0, y: 0, half: 120, thick: 30 };
/** Its colliders carry this (a piece's carry PERCH_PROP_BASE + its id). */
export const SPAWN_PROP = 200000;

/** Fall this far below the lowest thing in the sky and a cat comes down on the respawn cloud again. */
export const FALL = 1100;

/** How near and how far the view goes (1: the house's). */
export const ZOOM = { min: 0.3, max: 2.4 };

/** A piece put up in the sky: a perch, with its top's middle at (x, y). */
export interface PlayPiece {
  id: number;
  kind: PerchKind;
  x: number;
  y: number;
}

type Pt = [number, number];

/**
 * A tube: its middle line, from one mouth (a: its first point) to the other
 * (b: its last), as drawn: as long and as bendy as you like, its points
 * evenly spaced along it (see evenTube).
 */
export interface PlayTube {
  id: number;
  pts: Pt[];
}

export interface PlaySave {
  v: 1;
  pieces: PlayPiece[];
  tubes: PlayTube[];
  nextId: number;
  /** Who came along last time (the picker starts with them). */
  cats: BreedId[];
}

export const PLAY_KEY = 'cozy-playground:v1';

export function emptyPlay(): PlaySave {
  return { v: 1, pieces: [], tubes: [], nextId: 1, cats: [] };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** (anywhere, but not so far out that the numbers get silly) */
const FAR = 200000;
const near = (v: unknown): v is number => finite(v) && Math.abs(v) < FAR;

/** The playground as saved, made safe: anything unknown or out of reach is dropped. */
export function readPlay(raw: string | null): PlaySave {
  const out = emptyPlay();
  if (!raw) return out;
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!d || typeof d !== 'object') return out;
  const o = d as Record<string, unknown>;
  const ids = new Set<number>();
  const fresh = (id: unknown): id is number => finite(id) && id > 0 && Number.isInteger(id) && !ids.has(id) && (ids.add(id), true);
  if (Array.isArray(o.pieces)) {
    for (const p of o.pieces as Record<string, unknown>[]) {
      if (!p || !(PERCH_ORDER as unknown[]).includes(p.kind) || !near(p.x) || !near(p.y) || !fresh(p.id)) continue;
      out.pieces.push({ id: p.id as number, kind: p.kind as PerchKind, x: p.x as number, y: p.y as number });
    }
  }
  if (Array.isArray(o.tubes)) {
    for (const t of o.tubes as Record<string, unknown>[]) {
      if (!t) continue;
      let pts: Pt[] | null = null;
      if (Array.isArray(t.pts)) {
        const raw = t.pts as unknown[];
        if (raw.length >= 2 && raw.length <= MAX_PTS && raw.every((q) => Array.isArray(q) && q.length === 2 && near(q[0]) && near(q[1]))) pts = (raw as Pt[]).map(([x, y]) => [x, y]);
      } else if ([t.ax, t.ay, t.bx, t.by].every(near)) {
        // (a straight one, from before tubes bent)
        pts = evenTube([
          [t.ax as number, t.ay as number],
          [t.bx as number, t.by as number],
        ]);
      }
      if (!pts || pathLength(pts) < 1 || !fresh(t.id)) continue;
      out.tubes.push({ id: t.id as number, pts });
    }
  }
  out.nextId = Math.max(1, ...[...ids].map((i) => i + 1), finite(o.nextId) ? Math.floor(o.nextId) : 1);
  if (Array.isArray(o.cats)) out.cats = [...new Set((o.cats as unknown[]).filter((b): b is BreedId => b === 'mine' || (ALL_CATS as unknown[]).includes(b)))];
  return out;
}

// ---------------------------------------------------------------------------
// The respawn cloud

/** The respawn cloud's colliders: a long soft slab, rounded at the ends. */
export function spawnShapes(): StaticShape[] {
  return [roundedBox(SPAWN.x - SPAWN.half, SPAWN.y, SPAWN.half * 2, SPAWN.thick, SPAWN.thick / 2, { material: 'fabric', friction: 0.8, propId: SPAWN_PROP })];
}

/** What a cat can sit on, on the respawn cloud. */
export const SPAWN_SURFACE: Surface = { x0: SPAWN.x - SPAWN.half + 14, x1: SPAWN.x + SPAWN.half - 14, y: SPAWN.y, propId: SPAWN_PROP };

/** Where the n cats who've come along stand on the respawn cloud to begin with (their middles, x). */
export function spawnSpots(n: number): number[] {
  const w = (SPAWN.half - 40) * 2;
  return Array.from({ length: n }, (_, i) => (n === 1 ? SPAWN.x : SPAWN.x - w / 2 + (w * i) / (n - 1)));
}

// ---------------------------------------------------------------------------
// Pieces

export function buildPiece(p: PlayPiece): PerchProp {
  return buildPerch({ id: p.id, kind: p.kind, x: p.x, y: p.y });
}

/** What a piece's top a cat sits on reaches across (a shelf's plank, a cushion's top): the bit that joins up with the next. */
function topSpan(kind: PerchKind, x: number): [number, number] {
  const half: Record<PerchKind, number> = { shelf: 33, cushion: 43, cloud: 42, hammock: 48, pod: 41, beanbag: 44, bounce: 33, bed: 40, tree: 40 };
  return [x - half[kind], x + half[kind]];
}

/** Does it stand on something (a beanbag, a cushion, a bed, a tree), rather than hang on a wall? */
export function standing(kind: PerchKind): boolean {
  return PERCHES[kind].mount === 'floor';
}

/** How near a piece has to be dragged to another to join up with it (world units). */
export const JOIN = 18;

/** The pieces that join end to end into longer platforms. */
export const JOINS: readonly PerchKind[] = ['shelf', 'cushion', 'cloud'];

/**
 * Where a piece dragged to (x, y) goes. A shelf, a ledge or a cloud dragged
 * up to the end of another of them at about its height joins it, end to end
 * at the same height: a longer platform. One that stands (a cushion, a bed)
 * dragged a little way over something's top stands on it; anywhere else it
 * floats.
 */
export function snapPiece(kind: PerchKind, x: number, y: number, others: readonly PlayPiece[]): { x: number; y: number } {
  const [a0, a1] = topSpan(kind, x);
  if (standing(kind)) {
    const h = PERCHES[kind].height;
    let best: { x: number; y: number } | null = null;
    for (const s of surfacesOf(others)) {
      // (its foot a little over the top, or a little in it)
      const foot = y + h;
      if (foot < s.y - JOIN * 2 || foot > s.y + JOIN || a1 < s.x0 + 8 || a0 > s.x1 - 8) continue;
      if (!best || Math.abs(s.y - h - y) < Math.abs(best.y - y)) best = { x, y: s.y - h };
    }
    return best ? { x: Math.round(best.x), y: Math.round(best.y) } : { x: Math.round(x), y: Math.round(y) };
  }
  if (!JOINS.includes(kind)) return { x: Math.round(x), y: Math.round(y) };
  let best: { x: number; y: number; d: number } | null = null;
  for (const o of others) {
    if (!JOINS.includes(o.kind) || Math.abs(o.y - y) > JOIN) continue;
    const [b0, b1] = topSpan(o.kind, o.x);
    // its left end up to the other's right end, or its right end up to the other's left end
    for (const [gap, nx] of [
      [a0 - b1, x - (a0 - b1)],
      [b0 - a1, x + (b0 - a1)],
    ] as const) {
      const d = Math.abs(gap) + Math.abs(o.y - y);
      if (Math.abs(gap) <= JOIN && (!best || d < best.d)) best = { x: nx, y: o.y, d };
    }
  }
  return best ? { x: Math.round(best.x), y: Math.round(best.y) } : { x: Math.round(x), y: Math.round(y) };
}

/** The tops of the pieces and of the respawn cloud: where things stand, and where cats sit. */
export function surfacesOf(pieces: readonly PlayPiece[]): Surface[] {
  const out: Surface[] = [SPAWN_SURFACE];
  for (const p of pieces) {
    if (p.kind === 'hammock' || p.kind === 'pod') continue;
    const [x0, x1] = topSpan(p.kind, p.x);
    out.push({ x0, x1, y: p.y, propId: p.id });
  }
  return out;
}

/** What a piece covers (as painted). */
export function pieceBox(p: Pick<PlayPiece, 'kind' | 'x' | 'y'>): Box {
  return perchBox(p.kind, p.x, p.y);
}

// ---------------------------------------------------------------------------
// Tubes

/**
 * A tube's bore; how far its mouths' bells reach out, and how far in their
 * throats are (where the bell meets the pipe); how fast a cat comes out;
 * how near a mouth sucks a cat in; how far apart the points along its
 * middle are; and the tightest it bends (the radius of its middle line
 * round a bend: any tighter, and its glass would pinch).
 */
export const TUBE = { bore: 30, bell: 24, throat: 24, speed: 720, reach: 42, step: 16, bend: 46 };

/** The shortest a tube can be, and the longest (as long as you like, near enough). */
export const TUBE_LEN = { min: 80, max: 12000 };
const MAX_PTS = Math.ceil(TUBE_LEN.max / TUBE.step) + 4;

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** A polyline with a point every `step` along it from its first point (its last point where it is: a short last stretch is taken in with the one before). */
function resample(p: readonly Pt[], step: number): Pt[] {
  const out: Pt[] = [[p[0][0], p[0][1]]];
  let need = step;
  for (let i = 1; i < p.length; i++) {
    let [ax, ay] = p[i - 1];
    const [bx, by] = p[i];
    let seg = Math.hypot(bx - ax, by - ay);
    while (seg >= need) {
      const u = need / seg;
      ax += (bx - ax) * u;
      ay += (by - ay) * u;
      out.push([ax, ay]);
      seg -= need;
      need = step;
    }
    need -= seg;
  }
  const last = p[p.length - 1];
  const tail = out[out.length - 1];
  if (out.length > 1 && Math.hypot(last[0] - tail[0], last[1] - tail[1]) < step * 0.35) out.pop();
  out.push([last[0], last[1]]);
  return out;
}

/** Ease every bend tighter than a tube can go: each such point a little toward between its neighbours, a pass at a time. True if anything moved. */
function relax(p: Pt[]): boolean {
  let moved = false;
  for (let it = 0; it < 40; it++) {
    let any = false;
    for (let i = 1; i < p.length - 1; i++) {
      const ax = p[i][0] - p[i - 1][0];
      const ay = p[i][1] - p[i - 1][1];
      const bx = p[i + 1][0] - p[i][0];
      const by = p[i + 1][1] - p[i][1];
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la < 1e-6 || lb < 1e-6) continue;
      // (how far it may turn here: its stretches' length over the tightest bend)
      if ((ax * bx + ay * by) / (la * lb) >= Math.cos(Math.min(Math.PI, (la + lb) / 2 / TUBE.bend) * 1.04)) continue;
      p[i][0] += ((p[i - 1][0] + p[i + 1][0]) / 2 - p[i][0]) * 0.5;
      p[i][1] += ((p[i - 1][1] + p[i + 1][1]) / 2 - p[i][1]) * 0.5;
      any = true;
    }
    if (!any) break;
    moved = true;
  }
  return moved;
}

/**
 * A tube's middle line made even: a point every TUBE.step along it, its
 * ends where they are, and no bend tighter than TUBE.bend (a sharp corner
 * drawn is eased round). Measured out from `anchor`, the end that stays as
 * it was (dragging the other end, the rest of it doesn't creep along).
 */
export function evenTube(pts: readonly Pt[], anchor: 'a' | 'b' = 'a'): Pt[] {
  let p: Pt[] = [];
  for (const q of anchor === 'b' ? [...pts].reverse() : pts) {
    const l = p[p.length - 1];
    if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 0.5) p.push([q[0], q[1]]);
  }
  if (p.length < 2) return p.map(([x, y]) => [round1(x), round1(y)]);
  for (let round = 0; round < 3; round++) {
    p = resample(p, TUBE.step);
    if (!relax(p)) break;
  }
  const out: Pt[] = p.map(([x, y]) => [round1(x), round1(y)]);
  return anchor === 'b' ? out.reverse() : out;
}

/** A straight tube from (ax, ay) to (bx, by). */
export function straightTube(id: number, ax: number, ay: number, bx: number, by: number): PlayTube {
  return {
    id,
    pts: evenTube([
      [ax, ay],
      [bx, by],
    ]),
  };
}

/** How long a tube is (along its middle, mouth to mouth). */
export function tubeLength(t: PlayTube): number {
  return pathLength(t.pts);
}

/**
 * A tube with one end (`end`) dragged on to (x, y): it carries on that way,
 * following the finger (any twists and turns), or, dragged back along
 * itself, it's taken in: shorter. Not past the longest a tube can be.
 */
export function extendTube(pts: readonly Pt[], end: 'a' | 'b', x: number, y: number): Pt[] {
  // (worked on at its last point: the a end turned round to be that)
  const p = end === 'a' ? [...pts].reverse() : [...pts];
  const n = p.length;
  if (n >= 2) {
    // back along itself, just behind the end (as far back as the finger's come, and a little): cut back to there
    const tip = p[n - 1];
    const back = Math.hypot(x - tip[0], y - tip[1]) + TUBE.step * 2;
    let s = 0;
    let cut = -1;
    let best = TUBE.step * 0.8;
    for (let j = n - 2; j >= 1; j--) {
      s += Math.hypot(p[j + 1][0] - p[j][0], p[j + 1][1] - p[j][1]);
      if (s > back) break;
      const d = Math.hypot(p[j][0] - x, p[j][1] - y);
      if (d < best) {
        best = d;
        cut = j;
      }
    }
    if (cut >= 1) p.length = cut + 1;
  }
  p.push([x, y]);
  let out = evenTube(p, 'a');
  // (no longer than a tube can be: the end stops where that runs out)
  if (pathLength(out) > TUBE_LEN.max) out = evenTube(cutAt(out, TUBE_LEN.max), 'a');
  return end === 'a' ? out.reverse() : out;
}

/** A polyline up to arc length s. */
function cutAt(p: readonly Pt[], s: number): Pt[] {
  const out: Pt[] = [[p[0][0], p[0][1]]];
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const l = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (acc + l >= s) {
      const u = l > 0 ? (s - acc) / l : 0;
      out.push([p[i - 1][0] + (p[i][0] - p[i - 1][0]) * u, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * u]);
      return out;
    }
    acc += l;
    out.push([p[i][0], p[i][1]]);
  }
  return out;
}

/** The stretch of a polyline between arc lengths s0 and s1. */
export function subPath(p: readonly Pt[], s0: number, s1: number): Pt[] {
  const a = pointAt(p, s0);
  const out: Pt[] = [[a.x, a.y]];
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    acc += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (acc <= s0) continue;
    if (acc >= s1) break;
    out.push([p[i][0], p[i][1]]);
  }
  const b = pointAt(p, s1);
  out.push([b.x, b.y]);
  return out;
}

/**
 * A tube pulled by a point along it (at arc length s, by dx, dy): that point
 * goes with the finger, and the tube round it bends along, less and less
 * further off (a long tube's pull reaches further along it).
 */
export function bendTube(pts: readonly Pt[], s: number, dx: number, dy: number): Pt[] {
  const R = Math.max(50, Math.min(180, pathLength(pts) * 0.2));
  let acc = 0;
  const out = pts.map(([x, y], i): Pt => {
    if (i > 0) acc += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
    const w = Math.exp(-(((acc - s) / R) ** 2));
    return [x + dx * w, y + dy * w];
  });
  return evenTube(out);
}

/** A tube moved, the whole of it. */
export function moveTube(pts: readonly Pt[], dx: number, dy: number): Pt[] {
  return pts.map(([x, y]) => [round1(x + dx), round1(y + dy)]);
}

/** A tube's mouth: where it is, and the way it faces (out of the tube). */
export interface TubeEnd {
  x: number;
  y: number;
  fx: number;
  fy: number;
}

/** A tube's two mouths (a, b), each facing out along the glass from its throat. */
export function tubeEnds(t: PlayTube): [TubeEnd, TubeEnd] {
  const L = pathLength(t.pts);
  const end = (p: readonly Pt[]): TubeEnd => {
    const q = pointAt(p, Math.min(TUBE.throat, L / 2));
    const dx = p[0][0] - q.x;
    const dy = p[0][1] - q.y;
    const l = Math.hypot(dx, dy);
    return l > 1e-6 ? { x: p[0][0], y: p[0][1], fx: dx / l, fy: dy / l } : { x: p[0][0], y: p[0][1], fx: -1, fy: 0 };
  };
  return [end(t.pts), end([...t.pts].reverse())];
}

/** A tube as the house's tubes are ridden (from its upper mouth, a, to its lower one, b), with where each mouth draws cats in. */
export interface SkyTube extends RideTube {
  play: PlayTube;
  /** Where a cat comes into each mouth's reach: a circle just in front of it. */
  zones: [{ x: number; y: number; r: number }, { x: number; y: number; r: number }];
}

export function skyTube(t: PlayTube): SkyTube {
  const [a, b] = tubeEnds(t);
  const r = TUBE.reach;
  return {
    id: `sky-${t.id}`,
    play: t,
    path: t.pts,
    upper: { x: a.x, y: a.y, dirX: a.fx, dirY: a.fy, speed: TUBE.speed },
    lower: { x: b.x, y: b.y, dirX: b.fx, dirY: b.fy, speed: TUBE.speed },
    bore: TUBE.bore,
    // (a long one's ridden faster: never more than a few seconds through)
    goSpeed: Math.max(900, pathLength(t.pts) / 4),
    zones: [
      { x: a.x + a.fx * r * 0.6, y: a.y + a.fy * r * 0.6, r },
      { x: b.x + b.fx * r * 0.6, y: b.y + b.fy * r * 0.6, r },
    ],
  };
}

/** A tube's colliders carry this plus its id. */
export const TUBE_PROP_BASE = 300000;

/** A polyline offset to one side by d (to its left, going along it, for d > 0; each point along the way it runs there). */
export function offsetLine(pts: readonly Pt[], d: number): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[Math.max(0, i - 1)];
    const [bx, by] = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    out.push([pts[i][0] - ((by - ay) / l) * d, pts[i][1] + ((bx - ax) / l) * d]);
  }
  return out;
}

/** A polyline with the points that hardly bend it left out (within `tol` of the line without them). */
function simplify(p: readonly Pt[], tol: number): Pt[] {
  if (p.length < 3) return [...p];
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const [ax, ay] = p[i0];
    const [bx, by] = p[i1];
    const ex = bx - ax;
    const ey = by - ay;
    const l = Math.hypot(ex, ey) || 1;
    let far = -1;
    let fd = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((p[i][0] - ax) * ey - (p[i][1] - ay) * ex) / l;
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([i0, far], [far, i1]);
    }
  }
  return p.filter((_, i) => keep[i]);
}

/** The pipe between a tube's bells (from one throat to the other). */
export function tubeRun(t: PlayTube): Pt[] {
  const L = pathLength(t.pts);
  return subPath(t.pts, TUBE.throat, Math.max(TUBE.throat + 1, L - TUBE.throat));
}

/**
 * A tube's glass: its two walls from bell to bell, along every bend, and the
 * bells' flares (a cat can sit on a tube, and only goes in at a mouth).
 */
export function tubeShapes(t: PlayTube): StaticShape[] {
  const o = { material: 'ceramic' as const, friction: 0.3, propId: TUBE_PROP_BASE + t.id };
  const half = 18;
  const bell = TUBE.bell + 1;
  const run = tubeRun(t);
  const [a, b] = tubeEnds(t);
  const out: StaticShape[] = [];
  for (const side of [-1, 1]) {
    const wall = simplify(offsetLine(run, side * half), 1.2);
    for (let i = 1; i < wall.length; i++) out.push(capsule(wall[i - 1][0], wall[i - 1][1], wall[i][0], wall[i][1], 3, o));
    // the bells: from the wall's end out to the rim, this side (the same side going along the tube: across a's way out the other way round)
    const wa = wall[0];
    const wb = wall[wall.length - 1];
    out.push(capsule(wa[0], wa[1], a.x + a.fy * side * bell, a.y - a.fx * side * bell, 3, o));
    out.push(capsule(wb[0], wb[1], b.x - b.fy * side * bell, b.y + b.fx * side * bell, 3, o));
  }
  return out;
}

/** The mouth (0: a, 1: b) whose reach (x, y) is in, if any. */
export function mouthOf(t: SkyTube, x: number, y: number): 0 | 1 | null {
  for (const k of [0, 1] as const) {
    const z = t.zones[k];
    if (Math.hypot(x - z.x, y - z.y) < z.r) return k;
  }
  return null;
}

/** What a tube covers: its glass and both bells. */
export function tubeBox(t: PlayTube): Box {
  const pad = TUBE.bell + 4;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of t.pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/** The nearest point along a tube's middle to (x, y): how far off it is, and how far along the tube (arc length from a). */
export function nearestOnTube(t: PlayTube, x: number, y: number): { d: number; s: number } {
  const p = t.pts;
  let best = Infinity;
  let bs = 0;
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const [ax, ay] = p[i - 1];
    const ex = p[i][0] - ax;
    const ey = p[i][1] - ay;
    const l2 = ex * ex + ey * ey;
    const l = Math.sqrt(l2);
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2)) : 0;
    const d = Math.hypot(x - (ax + ex * u), y - (ay + ey * u));
    if (d < best) {
      best = d;
      bs = acc + u * l;
    }
    acc += l;
  }
  if (p.length === 1) best = Math.hypot(x - p[0][0], y - p[0][1]);
  return { d: best, s: bs };
}

/** How far (x, y) is from a tube's glass (from the line along its middle). */
export function distToTube(t: PlayTube, x: number, y: number): number {
  return nearestOnTube(t, x, y).d;
}

/** The point halfway along a tube (where its grip is, to move it by). */
export function tubeMiddle(t: PlayTube): { x: number; y: number } {
  const p = pointAt(t.pts, pathLength(t.pts) / 2);
  return { x: p.x, y: p.y };
}

/** The lowest anything in the sky reaches (what a cat falls past before it's back on the respawn cloud). */
export function lowest(s: Pick<PlaySave, 'pieces' | 'tubes'>): number {
  let y = SPAWN.y + SPAWN.thick;
  for (const p of s.pieces) y = Math.max(y, pieceBox(p).y1);
  for (const t of s.tubes) for (const q of t.pts) y = Math.max(y, q[1]);
  return y;
}
