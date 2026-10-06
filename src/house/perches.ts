// Perches: cat furniture you buy with treats and put wherever you like in
// the house. Shelves, ledges, a hammock and a wicker pod go on the walls, a
// beanbag and a cat tree stand on a floor, and a cloud shelf goes anywhere,
// even out in the sky over the roof garden. The cats hop up onto them on
// their own, from one to the next, so a run of perches up a wall is a way up
// for them: build your way up the house. Geometry only (the art is in
// perchArt.ts).

import type { Surface } from '../game/props';
import { WORLD_W } from '../game/props';
import { capsule, roundedBox, type Material, type StaticShape } from '../physics/shapes';
import { FLOORS, floorAt, type FloorId } from './layout';

export type PerchKind = 'shelf' | 'beanbag' | 'cushion' | 'hammock' | 'pod' | 'cloud' | 'tree';

export interface PerchSpec {
  kind: PerchKind;
  name: string;
  blurb: string;
  /** The first one's price in treats, and how much more each one after it costs. */
  price: number;
  step: number;
  /** On a wall, standing on a floor, or (a cloud) anywhere at all. */
  mount: 'wall' | 'floor' | 'sky';
  /** How tall it stands, from its top (where a cat sits) down to the floor (floor perches). */
  height: number;
}

export const PERCHES: Record<PerchKind, PerchSpec> = {
  shelf: { kind: 'shelf', name: 'Wall shelf', blurb: 'A little plank on brass brackets', price: 15, step: 8, mount: 'wall', height: 0 },
  beanbag: { kind: 'beanbag', name: 'Beanbag', blurb: 'A squashy spot on the floor', price: 25, step: 10, mount: 'floor', height: 34 },
  cushion: { kind: 'cushion', name: 'Cushion ledge', blurb: 'A long ledge with a plump cushion', price: 35, step: 12, mount: 'wall', height: 0 },
  hammock: { kind: 'hammock', name: 'Hammock', blurb: 'A cosy sling between two pegs', price: 50, step: 15, mount: 'wall', height: 0 },
  pod: { kind: 'pod', name: 'Wicker pod', blurb: 'A round basket bed on the wall', price: 60, step: 20, mount: 'wall', height: 0 },
  cloud: { kind: 'cloud', name: 'Cloud shelf', blurb: 'Floats anywhere, even up in the sky', price: 75, step: 25, mount: 'sky', height: 0 },
  tree: { kind: 'tree', name: 'Cat tree', blurb: 'A tall scratching post with two decks', price: 100, step: 30, mount: 'floor', height: 196 },
};
export const PERCH_ORDER: PerchKind[] = ['shelf', 'beanbag', 'cushion', 'hammock', 'pod', 'cloud', 'tree'];

/** A perch in the house (saved): its kind, and where its top is (world). */
export interface PerchSave {
  id: number;
  kind: PerchKind;
  x: number;
  y: number;
  /** In the cupboard (bought, not put anywhere yet). */
  stored?: boolean;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A tree's middle deck sticks out toward the middle of the room. */
const treeSide = (x: number): 1 | -1 => (x < WORLD_W / 2 ? 1 : -1);

/** The painted extent of a perch with its top at (x, y). */
export function perchBox(kind: PerchKind, x: number, y: number): Box {
  switch (kind) {
    case 'shelf':
      return { x0: x - 36, y0: y - 4, x1: x + 36, y1: y + 24 };
    case 'cushion':
      return { x0: x - 47, y0: y - 8, x1: x + 47, y1: y + 26 };
    case 'hammock':
      return { x0: x - 56, y0: y - 40, x1: x + 56, y1: y + 12 };
    case 'pod':
      return { x0: x - 49, y0: y - 34, x1: x + 49, y1: y + 14 };
    case 'cloud':
      return { x0: x - 52, y0: y - 14, x1: x + 52, y1: y + 20 };
    case 'beanbag':
      return { x0: x - 52, y0: y - 6, x1: x + 52, y1: y + PERCHES.beanbag.height };
    case 'tree': {
      const s = treeSide(x);
      return { x0: x - (s > 0 ? 46 : 60), y0: y - 6, x1: x + (s > 0 ? 60 : 46), y1: y + PERCHES.tree.height };
    }
  }
}

export interface PerchProp {
  save: PerchSave;
  floor: FloorId;
  box: Box;
  shapes: StaticShape[];
  /** What a cat can sit on (for the cats' hops). */
  surfaces: Surface[];
  propId: number;
}

/** Perch props have ids of their own (their colliders carry them). */
export const PERCH_PROP_BASE = 100000;

/** The colliders and seats of a perch with its top at (x, y). */
export function buildPerch(p: PerchSave): PerchProp {
  const { kind, x, y } = p;
  const propId = PERCH_PROP_BASE + p.id;
  const wood = { material: 'wood' as Material, friction: 0.7, propId };
  const soft = { material: 'fabric' as Material, friction: 0.8, propId };
  const shapes: StaticShape[] = [];
  const surfaces: Surface[] = [];
  const floor = floorAt(y);
  switch (kind) {
    case 'shelf':
      shapes.push(roundedBox(x - 33, y, 66, 10, 4, wood));
      surfaces.push({ x0: x - 33, x1: x + 33, y, propId });
      break;
    case 'cushion':
      shapes.push(roundedBox(x - 43, y, 86, 18, 7, soft));
      surfaces.push({ x0: x - 43, x1: x + 43, y, propId });
      break;
    case 'cloud':
      shapes.push(roundedBox(x - 42, y, 84, 14, 7, soft));
      surfaces.push({ x0: x - 42, x1: x + 42, y, propId });
      break;
    case 'hammock':
      shapes.push(capsule(x - 50, y - 26, x - 26, y + 4, 4, soft), capsule(x - 26, y + 4, x + 26, y + 4, 4, soft), capsule(x + 26, y + 4, x + 50, y - 26, 4, soft));
      surfaces.push({ x0: x - 24, x1: x + 24, y, propId });
      break;
    case 'pod': {
      // a shallow wicker bowl: an arc of rods round its middle
      const cx = x;
      const cy = y - 36;
      const R = 41;
      const angles = [165, 135, 105, 75, 45, 15].map((a) => (a * Math.PI) / 180);
      for (let k = 1; k < angles.length; k++) {
        shapes.push(capsule(cx + R * Math.cos(angles[k - 1]), cy + R * Math.sin(angles[k - 1]), cx + R * Math.cos(angles[k]), cy + R * Math.sin(angles[k]), 5, { ...soft, material: 'wicker' }));
      }
      surfaces.push({ x0: x - 22, x1: x + 22, y, propId });
      break;
    }
    case 'beanbag': {
      const fy = y + PERCHES.beanbag.height;
      shapes.push(capsule(x - 44, fy - 10, x - 26, y + 8, 8, soft), capsule(x - 26, y + 8, x + 26, y + 8, 8, soft), capsule(x + 26, y + 8, x + 44, fy - 10, 8, soft));
      shapes.push(roundedBox(x - 42, fy - 14, 84, 14, 5, soft));
      surfaces.push({ x0: x - 26, x1: x + 26, y, propId });
      break;
    }
    case 'tree': {
      const fy = y + PERCHES.tree.height;
      const s = treeSide(x);
      const mid = y + 96;
      const m0 = s > 0 ? x + 2 : x - 56;
      shapes.push(capsule(x, y + 10, x, fy - 6, 7, { ...wood, material: 'fabric' }));
      shapes.push(roundedBox(x - 40, y, 80, 11, 5, soft));
      shapes.push(roundedBox(m0, mid, 54, 10, 4, soft));
      shapes.push(roundedBox(x - 34, fy - 8, 68, 8, 3, wood));
      surfaces.push({ x0: x - 40, x1: x + 40, y, propId }, { x0: m0, x1: m0 + 54, y: mid, propId });
      break;
    }
  }
  return { save: p, floor, box: perchBox(kind, x, y), shapes, surfaces, propId };
}

/** Where a floor perch's top is, standing on a floor. */
export function floorTop(kind: PerchKind, f: FloorId): number {
  return FLOORS[f].floorY - PERCHES[kind].height;
}

/** Why a perch can't go somewhere (null: it can). */
export type PlaceProblem = 'locked' | 'outside' | 'blocked' | 'sky' | 'cat' | null;

/**
 * Can a perch go with its top at (x, y)? It has to be on an open floor,
 * inside the room (clear of the ceiling and, on a wall, well clear of the
 * floor), not over anything else (`taken`), and on the roof only a cloud
 * can float in the open air (the others stand on the deck).
 */
export function placeProblem(kind: PerchKind, x: number, y: number, open: readonly FloorId[], taken: readonly Box[]): PlaceProblem {
  const spec = PERCHES[kind];
  const f = floorAt(y);
  if (!open.includes(f)) return 'locked';
  const fl = FLOORS[f];
  const b = perchBox(kind, x, y);
  if (b.x0 < 1 || b.x1 > WORLD_W - 1) return 'outside';
  if (b.y0 < fl.ceilY + 12) return 'outside';
  if (spec.mount === 'floor') {
    if (Math.abs(y - floorTop(kind, f)) > 0.5) return 'outside';
  } else if (b.y1 > fl.floorY - 30) return 'outside';
  if (f === 'roof' && spec.mount === 'wall') return 'sky';
  for (const t of taken) if (b.x0 < t.x1 + 3 && b.x1 > t.x0 - 3 && b.y0 < t.y1 + 3 && b.y1 > t.y0 - 3) return 'blocked';
  return null;
}

/** Snap a dragged perch to where it can be: floor perches onto the floor under the finger. */
export function snapPerch(kind: PerchKind, x: number, y: number): { x: number; y: number } {
  const spec = PERCHES[kind];
  const b = perchBox(kind, 0, 0);
  const cx = Math.max(-b.x0 + 2, Math.min(WORLD_W - 2 - b.x1, x));
  if (spec.mount !== 'floor') return { x: cx, y };
  // stand it on the floor of the storey the finger is in
  return { x: cx, y: floorTop(kind, floorAt(y)) };
}

/** What the next one of a kind costs, with `owned` of them already. */
export function perchPrice(kind: PerchKind, owned: number): number {
  const s = PERCHES[kind];
  return s.price + s.step * owned;
}
