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

/** A tube: a mouth at each end (a and b), each facing away from the other. */
export interface PlayTube {
  id: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
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
      if (!t || ![t.ax, t.ay, t.bx, t.by].every(near) || !fresh(t.id)) continue;
      out.tubes.push({ id: t.id as number, ax: t.ax as number, ay: t.ay as number, bx: t.bx as number, by: t.by as number });
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

/** A tube's bore, how far its mouth's bell reaches out, how fast a cat comes out, and how near a mouth sucks a cat in. */
export const TUBE = { bore: 30, bell: 24, speed: 720, reach: 42 };

/** A tube as the house's tubes are ridden (from its upper mouth, a, to its lower one, b), with where each mouth draws cats in. */
export interface SkyTube extends RideTube {
  play: PlayTube;
  /** Where a cat comes into each mouth's reach: a circle just in front of it. */
  zones: [{ x: number; y: number; r: number }, { x: number; y: number; r: number }];
}

/** Which way each end faces: away from the other (a straight tube). */
export function tubeDirs(t: PlayTube): { ux: number; uy: number; len: number } {
  const dx = t.bx - t.ax;
  const dy = t.by - t.ay;
  const len = Math.hypot(dx, dy);
  return len > 1e-6 ? { ux: dx / len, uy: dy / len, len } : { ux: 1, uy: 0, len: 0 };
}

export function skyTube(t: PlayTube): SkyTube {
  const { ux, uy } = tubeDirs(t);
  const r = TUBE.reach;
  return {
    id: `sky-${t.id}`,
    play: t,
    path: [
      [t.ax, t.ay],
      [t.bx, t.by],
    ],
    upper: { x: t.ax, y: t.ay, dirX: -ux, dirY: -uy, speed: TUBE.speed },
    lower: { x: t.bx, y: t.by, dirX: ux, dirY: uy, speed: TUBE.speed },
    bore: TUBE.bore,
    goSpeed: 900,
    zones: [
      { x: t.ax - ux * r * 0.6, y: t.ay - uy * r * 0.6, r },
      { x: t.bx + ux * r * 0.6, y: t.by + uy * r * 0.6, r },
    ],
  };
}

/** A tube's colliders carry this plus its id. */
export const TUBE_PROP_BASE = 300000;

/**
 * A tube's glass: its two walls from bell to bell and the bells' flares (a
 * cat can sit on a tube, and only goes in at a mouth).
 */
export function tubeShapes(t: PlayTube): StaticShape[] {
  const { ux, uy } = tubeDirs(t);
  const o = { material: 'ceramic' as const, friction: 0.3, propId: TUBE_PROP_BASE + t.id };
  const half = 18;
  const bell = TUBE.bell + 1;
  const out: StaticShape[] = [];
  // (each end's own frame: across it, and the way its mouth faces)
  const ends: [number, number, number, number][] = [
    [t.ax, t.ay, -ux, -uy],
    [t.bx, t.by, ux, uy],
  ];
  const at = (e: [number, number, number, number], across: number, along: number): [number, number] => [e[0] + e[3] * across + e[2] * along, e[1] - e[2] * across + e[3] * along];
  for (const side of [-1, 1]) {
    const [x0, y0] = at(ends[0], side * half, -24);
    const [x1, y1] = at(ends[1], -side * half, -24);
    out.push(capsule(x0, y0, x1, y1, 3, o));
    for (const e of ends) {
      const [tx, ty] = at(e, side * half, -24);
      const [mx, my] = at(e, side * bell, 0);
      out.push(capsule(tx, ty, mx, my, 3, o));
    }
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

/** The shortest a tube can be (between its mouths), and the longest. */
export const TUBE_LEN = { min: 70, max: 1400 };

/** What a tube covers: its glass and both bells. */
export function tubeBox(t: PlayTube): Box {
  const pad = TUBE.bell + 4;
  return { x0: Math.min(t.ax, t.bx) - pad, y0: Math.min(t.ay, t.by) - pad, x1: Math.max(t.ax, t.bx) + pad, y1: Math.max(t.ay, t.by) + pad };
}

/** How far (x, y) is from a tube's glass (from the line between its mouths). */
export function distToTube(t: PlayTube, x: number, y: number): number {
  const { ux, uy, len } = tubeDirs(t);
  const u = Math.max(0, Math.min(len, (x - t.ax) * ux + (y - t.ay) * uy));
  return Math.hypot(x - (t.ax + ux * u), y - (t.ay + uy * u));
}

/** A new tube, its middle at (x, y): a short one, rising to the right (a cat in at the bottom is shot out of the top). */
export function newTube(id: number, x: number, y: number): PlayTube {
  return { id, ax: x - 70, ay: y + 50, bx: x + 70, by: y - 50 };
}

/** The lowest anything in the sky reaches (what a cat falls past before it's back on the respawn cloud). */
export function lowest(s: Pick<PlaySave, 'pieces' | 'tubes'>): number {
  let y = SPAWN.y + SPAWN.thick;
  for (const p of s.pieces) y = Math.max(y, pieceBox(p).y1);
  for (const t of s.tubes) y = Math.max(y, t.ay, t.by);
  return y;
}
