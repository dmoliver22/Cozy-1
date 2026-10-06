// The tall house: the roof garden on top, the living room in the middle (the
// home room, where everything starts) and the basement right under it, all
// in one world you scroll up and down. Each floor is laid out in the same
// local frame as an If It Fits room (ceiling at y = 0, floor at FLOOR_Y) and
// moved up or down by its `dy`, so the room painters and furniture work on
// every floor unchanged. Between the floors: the living room's floor slab,
// and over its ceiling the attic (Cat Drop starts up there) and the roof's
// deck. Two glass tubes join the floors: a funnel in the living room floor
// drops a cat down to the basement (and sucks it back up), and a suction
// hood over the top cat step sends a cat up to the roof (and back down).

import { FLOOR_Y, WORLD_W } from '../game/props';
import { capsule, roundedBox, type Material, type StaticShape } from '../physics/shapes';
import { ROOM_BOTTOM, ROOM_TOP } from '../render/renderer';

export type FloorId = 'roof' | 'living' | 'basement';
/** The floors you open with treats. */
export type ExtraFloor = 'roof' | 'basement';

export interface Floor {
  id: FloorId;
  name: string;
  /** World y = local (room) y + dy. */
  dy: number;
  /** World y of the floor the cats stand on. */
  floorY: number;
  /** World y of the ceiling (on the roof: as high as a cat can be carried). */
  ceilY: number;
  /** World rows a screen centred on the floor shows. */
  view0: number;
  view1: number;
}

export const ROOF_DY = -743;
export const BASEMENT_DY = 647;

const floor = (id: FloorId, name: string, dy: number, ceilY: number): Floor => ({
  id,
  name,
  dy,
  floorY: FLOOR_Y + dy,
  ceilY,
  view0: ROOM_TOP + dy,
  view1: ROOM_BOTTOM + dy,
});

export const FLOORS: Record<FloorId, Floor> = {
  roof: floor('roof', 'Roof garden', ROOF_DY, ROOM_TOP + ROOF_DY + 40),
  living: floor('living', 'Living room', 0, 0),
  basement: floor('basement', 'Basement', BASEMENT_DY, BASEMENT_DY),
};
export const FLOOR_ORDER: FloorId[] = ['roof', 'living', 'basement'];

/** Top and bottom of the whole painted house (world y). */
export const HOUSE_TOP = FLOORS.roof.view0;
export const HOUSE_BOTTOM = FLOORS.basement.view1;
/** The middle of a screen showing a floor: the camera scrolls between the roof's and the basement's. */
export const viewMid = (f: FloorId): number => (FLOORS[f].view0 + FLOORS[f].view1) / 2;

/** The roof deck's front edge, the cut slab under it and the attic (world y). */
export const DECK_FRONT = FLOORS.roof.floorY + (ROOM_BOTTOM - FLOOR_Y);
export const ATTIC_TOP = DECK_FRONT + 12;
/** The living room ceiling's cut edge (its top), and the cut between the living room and the basement. */
export const LIVING_CUT = -31;
export const BASEMENT_CUT = ROOM_BOTTOM + 12;

/** Which floor a world y is on. */
export function floorAt(y: number): FloorId {
  if (y < (DECK_FRONT + LIVING_CUT) / 2) return 'roof';
  if (y < (ROOM_BOTTOM + BASEMENT_DY) / 2) return 'living';
  return 'basement';
}

/**
 * Tiles the house is painted in (each cached on its own), top to bottom:
 * the sky goes on up past the roof's view and the basement floor on down
 * past its view, for tall screens.
 */
export const HOUSE_TILES: { y0: number; y1: number }[] = [
  { y0: HOUSE_TOP - 260, y1: ATTIC_TOP + 20 },
  { y0: ATTIC_TOP + 20, y1: BASEMENT_CUT },
  { y0: BASEMENT_CUT, y1: HOUSE_BOTTOM + 260 },
];

// ---------------------------------------------------------------------------
// The tubes

export interface Mouth {
  floor: FloorId;
  /** Where a cat comes out of it (world), and which way. */
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  /** How fast it comes out. */
  speed: number;
  /**
   * Let go of a cat with its middle in here and it goes in: sucked up into a
   * hood, or (the funnel) any cat that falls in.
   */
  zone: { x0: number; y0: number; x1: number; y1: number };
  kind: 'hood' | 'funnel';
}

export interface Tube {
  id: 'chute' | 'lift';
  /** The floor that has to be open for it to be there. */
  needs: ExtraFloor;
  /** The glass, as a path from the upper mouth to the lower one (world points). */
  path: [number, number][];
  upper: Mouth;
  lower: Mouth;
  /** Inner width of the glass (a cat squeezes into a sausage this wide). */
  bore: number;
}

/** The funnel in the living room floor, over the chute down to the basement. */
export const FUNNEL = { x: 58, rimY: 482, rimHw: 40, neckY: 538, neckHw: 17 };
/** The basement end of the chute: a long glass pipe down the wall to a hood. */
export const SPOUT = { x: FUNNEL.x, y: BASEMENT_DY + 400 };
/**
 * The living room's suction hood, over the right end of the top cat step
 * (with room under it for the biggest cat), its pipe going up through the
 * ceiling beside the attic hatch.
 */
export const HOOD = { x: 354, y: 36 };
/** The roof end of the lift: up out of the deck and over, a hood facing down. */
export const OUTLET = { x: 312, y: FLOORS.roof.floorY - 104, top: FLOORS.roof.floorY - 152 };

const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
};

export const TUBES: Tube[] = [
  {
    id: 'chute',
    needs: 'basement',
    path: [
      [FUNNEL.x, FUNNEL.neckY - 26],
      [FUNNEL.x, FLOOR_Y],
      [SPOUT.x, BASEMENT_DY],
      [SPOUT.x, SPOUT.y + 6],
    ],
    upper: {
      floor: 'living',
      x: FUNNEL.x,
      y: FUNNEL.rimY - 6,
      dirX: 0.42,
      dirY: -1,
      speed: 560,
      zone: { x0: FUNNEL.x - FUNNEL.rimHw + 6, y0: FUNNEL.rimY - 14, x1: FUNNEL.x + FUNNEL.rimHw - 6, y1: FLOOR_Y },
      kind: 'funnel',
    },
    lower: {
      floor: 'basement',
      x: SPOUT.x,
      y: SPOUT.y + 10,
      dirX: 0,
      dirY: 1,
      speed: 160,
      zone: { x0: SPOUT.x - 46, y0: SPOUT.y, x1: SPOUT.x + 46, y1: FLOORS.basement.floorY },
      kind: 'hood',
    },
    bore: 30,
  },
  {
    id: 'lift',
    needs: 'roof',
    path: [
      [OUTLET.x, OUTLET.y + 6],
      [OUTLET.x, OUTLET.top],
      ...arc((OUTLET.x + HOOD.x) / 2, OUTLET.top, (HOOD.x - OUTLET.x) / 2, Math.PI, Math.PI * 2, 8).slice(1, -1),
      [HOOD.x, OUTLET.top],
      [HOOD.x, FLOORS.roof.floorY],
      [HOOD.x, 0],
      [HOOD.x, HOOD.y - 4],
    ],
    upper: {
      floor: 'roof',
      x: OUTLET.x,
      y: OUTLET.y + 10,
      dirX: -0.25,
      dirY: 1,
      speed: 180,
      zone: { x0: OUTLET.x - 40, y0: OUTLET.y, x1: OUTLET.x + 40, y1: FLOORS.roof.floorY },
      kind: 'hood',
    },
    lower: {
      floor: 'living',
      x: HOOD.x,
      y: HOOD.y + 8,
      dirX: 0,
      dirY: 1,
      speed: 120,
      zone: { x0: HOOD.x - 46, y0: HOOD.y, x1: WORLD_W, y1: 132 },
      kind: 'hood',
    },
    bore: 30,
  },
];

/** Length of a polyline. */
export function pathLength(path: readonly [number, number][]): number {
  let L = 0;
  for (let k = 1; k < path.length; k++) L += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
  return L;
}

/** The point at arc length s along a polyline (clamped), and the way it runs there. */
export function pointAt(path: readonly [number, number][], s: number): { x: number; y: number; tx: number; ty: number } {
  let rest = Math.max(0, s);
  for (let k = 1; k < path.length; k++) {
    const [ax, ay] = path[k - 1];
    const [bx, by] = path[k];
    const len = Math.hypot(bx - ax, by - ay);
    if (rest <= len || k === path.length - 1) {
      const u = len > 0 ? Math.min(1, rest / len) : 0;
      return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, tx: len > 0 ? (bx - ax) / len : 0, ty: len > 0 ? (by - ay) / len : 1 };
    }
    rest -= len;
  }
  const [x, y] = path[path.length - 1];
  return { x, y, tx: 0, ty: 1 };
}

// ---------------------------------------------------------------------------
// Physics

const WALL = { material: 'wall' as Material, friction: 0.6 };

/** The house's shell: side walls top to bottom, the slabs between the floors, the sky's lid. */
export function houseShell(): StaticShape[] {
  return [
    roundedBox(-200, HOUSE_TOP - 600, 200, HOUSE_BOTTOM - HOUSE_TOP + 1200, 4, WALL),
    roundedBox(WORLD_W, HOUSE_TOP - 600, 200, HOUSE_BOTTOM - HOUSE_TOP + 1200, 4, WALL),
    roundedBox(-200, FLOORS.roof.ceilY - 340, WORLD_W + 400, 300, 4, WALL),
    // the roof deck, the attic and the living room's ceiling: one solid slab
    roundedBox(-200, FLOORS.roof.floorY, WORLD_W + 400, -FLOORS.roof.floorY, 4, WALL),
    // the living room floor, down to the basement's ceiling
    roundedBox(-200, FLOOR_Y, WORLD_W + 400, BASEMENT_DY - FLOOR_Y, 4, WALL),
    roundedBox(-200, FLOORS.basement.floorY, WORLD_W + 400, 300, 4, WALL),
  ];
}

/** Half the width of a hood's bell at its mouth. */
export const BELL = 24;

const GLASS = (propId: number): { material: Material; friction: number; propId: number } => ({ material: 'glass', friction: 0.3, propId });

/** The glass of a tube that's in (its walls, so cats sit beside and under it rather than in it). */
export function tubeShapes(t: Tube, propId: number): StaticShape[] {
  const o = GLASS(propId);
  if (t.id === 'chute') {
    const f = FUNNEL;
    return [
      capsule(f.x - f.rimHw, f.rimY, f.x - f.neckHw, f.neckY, 4, o),
      capsule(f.x + f.rimHw, f.rimY, f.x + f.neckHw, f.neckY, 4, o),
      capsule(f.x - f.neckHw, f.neckY, f.x - f.neckHw, FLOOR_Y + 2, 4, o),
      capsule(f.x + f.neckHw, f.neckY, f.x + f.neckHw, FLOOR_Y + 2, 4, o),
      // the basement pipe, and its hood
      capsule(SPOUT.x, BASEMENT_DY - 4, SPOUT.x, SPOUT.y - 22, 17, o),
      capsule(SPOUT.x - 17, SPOUT.y - 22, SPOUT.x - BELL, SPOUT.y, 4, o),
      capsule(SPOUT.x + 17, SPOUT.y - 22, SPOUT.x + BELL, SPOUT.y, 4, o),
    ];
  }
  const out = [
    // the living room hood
    capsule(HOOD.x, -4, HOOD.x, HOOD.y - 22, 17, o),
    capsule(HOOD.x - 17, HOOD.y - 22, HOOD.x - BELL, HOOD.y, 4, o),
    capsule(HOOD.x + 17, HOOD.y - 22, HOOD.x + BELL, HOOD.y, 4, o),
    // the roof's hood
    capsule(OUTLET.x - 17, OUTLET.y - 22, OUTLET.x - BELL, OUTLET.y, 4, o),
    capsule(OUTLET.x + 17, OUTLET.y - 22, OUTLET.x + BELL, OUTLET.y, 4, o),
  ];
  // the pipe up out of the deck, over the top and down to the roof's hood
  const p = t.path.filter(([, y]) => y >= FLOORS.roof.floorY - 400 && y <= FLOORS.roof.floorY + 4);
  p[0] = [OUTLET.x, OUTLET.y - 22];
  for (let k = 1; k < p.length; k++) out.push(capsule(p[k - 1][0], p[k - 1][1], p[k][0], p[k][1], 17, o));
  return out;
}

/** The roof's brick chimney stack (cats love the top of it). */
export const CHIMNEY = { x0: 34, x1: 92, y: FLOORS.roof.floorY - 196 };

export function chimneyShapes(propId: number): StaticShape[] {
  return [roundedBox(CHIMNEY.x0, CHIMNEY.y, CHIMNEY.x1 - CHIMNEY.x0, FLOORS.roof.floorY - CHIMNEY.y + 2, 3, { material: 'terracotta', friction: 0.6, propId })];
}
