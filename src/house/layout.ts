// The tall house: the roof garden on top, the attic under it, the living
// room in the middle (the home room, where everything starts: twice as tall
// as a room, with a high wall to put perches up) and the basement right under
// it, all in one world you scroll up and down. Each floor is laid out in the
// same local frame as an If It Fits room (floor at FLOOR_Y) and moved up or
// down by its `dy`, so the room painters and furniture work on every floor
// unchanged. Between the floors: solid slabs. Three glass tubes join the
// floors, there from the start but capped until you open the floor they go
// to: a funnel in the living room floor drops a cat down to the basement (and
// sucks it back up), a funnel in the attic floor drops a cat down to a hood
// high on the living room's left wall (and the hood whooshes it back up), and
// a suction hood over the top cat step sends a cat up the wall, through the
// ceiling and the attic to the roof (and back down).

import { FLOOR_Y, WORLD_W } from '../game/props';
import { capsule, roundedBox, type Material, type StaticShape } from '../physics/shapes';
import { ROOM_BOTTOM, ROOM_TOP } from '../render/renderer';

export type FloorId = 'roof' | 'attic' | 'living' | 'basement';
/** The floors you open with treats. */
export type ExtraFloor = 'roof' | 'attic' | 'basement';

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

/** The living room's ceiling: twice a room's height over its floor. */
export const LIVING_CEIL = -FLOOR_Y;
/** The living room ceiling's cut edge (its top). */
export const LIVING_CUT = LIVING_CEIL - 31;
/** The attic, a room's height over that: the front edge of its floor just over the ceiling's cut. */
export const ATTIC_DY = LIVING_CUT - 12 - ROOM_BOTTOM;
/** The roof garden over the attic: its deck's cut edge just over the attic's top. */
export const ROOF_DY = ROOM_TOP + ATTIC_DY - 12 - (ROOM_BOTTOM - FLOOR_Y) - FLOOR_Y;
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
  attic: floor('attic', 'Attic', ATTIC_DY, ATTIC_DY),
  living: floor('living', 'Living room', 0, LIVING_CEIL),
  basement: floor('basement', 'Basement', BASEMENT_DY, BASEMENT_DY),
};
export const FLOOR_ORDER: FloorId[] = ['roof', 'attic', 'living', 'basement'];

/** Top and bottom of the whole painted house (world y). */
export const HOUSE_TOP = FLOORS.roof.view0;
export const HOUSE_BOTTOM = FLOORS.basement.view1;
/** The middle of a screen showing a floor (the living room: its floor end): the camera scrolls between the roof's and the basement's. */
export const viewMid = (f: FloorId): number => (FLOORS[f].view0 + FLOORS[f].view1) / 2;

/** Where the view stops, top to bottom: the roof, the attic, high up the living room, down by its floor, the basement. */
export interface View {
  id: 'roof' | 'attic' | 'high' | 'living' | 'basement';
  name: string;
  y: number;
}
export const VIEWS: View[] = [
  { id: 'roof', name: 'Roof garden', y: viewMid('roof') },
  { id: 'attic', name: 'Attic', y: viewMid('attic') },
  { id: 'high', name: 'Up high', y: viewMid('living') + LIVING_CEIL },
  { id: 'living', name: 'Living room', y: viewMid('living') },
  { id: 'basement', name: 'Basement', y: viewMid('basement') },
];

/** The roof deck's front edge, the cut slab under it, and the top of the attic (world y). */
export const DECK_FRONT = FLOORS.roof.floorY + (ROOM_BOTTOM - FLOOR_Y);
export const ATTIC_TOP = DECK_FRONT + 12;
/** The front edge of the attic's floor (the cut down to the living room's ceiling under it). */
export const ATTIC_FLOOR_FRONT = FLOORS.attic.view1;
/** The cut between the living room and the basement. */
export const BASEMENT_CUT = ROOM_BOTTOM + 12;

/** Which floor a world y is on. */
export function floorAt(y: number): FloorId {
  if (y < (DECK_FRONT + ATTIC_TOP) / 2) return 'roof';
  if (y < (ATTIC_FLOOR_FRONT + LIVING_CUT) / 2) return 'attic';
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
  { y0: ATTIC_TOP + 20, y1: LIVING_CUT + 20 },
  { y0: LIVING_CUT + 20, y1: -20 },
  { y0: -20, y1: BASEMENT_CUT },
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
  id: 'chute' | 'loft' | 'lift';
  /** The floor that has to be open for it to be there. */
  needs: ExtraFloor;
  /** The glass, as a path from the upper mouth to the lower one (world points). */
  path: [number, number][];
  upper: Mouth;
  lower: Mouth;
  /** Inner width of the glass (a cat squeezes into a sausage this wide). */
  bore: number;
}

/** A glass funnel standing in a floor, its pipe going down through it. */
export interface Funnel {
  x: number;
  rimY: number;
  rimHw: number;
  neckY: number;
  neckHw: number;
  /** The floor it stands in. */
  floorY: number;
}
/** The funnel in the living room floor, over the chute down to the basement. */
export const FUNNEL: Funnel = { x: 58, rimY: 482, rimHw: 40, neckY: 538, neckHw: 17, floorY: FLOOR_Y };
/** The attic's funnel, the same in its floor (on the left), over the pipe down to the living room. */
export const ATTIC_FUNNEL: Funnel = { ...FUNNEL, rimY: FUNNEL.rimY + ATTIC_DY, neckY: FUNNEL.neckY + ATTIC_DY, floorY: FLOORS.attic.floorY };
/**
 * The living room end of the attic's pipe: a suction hood high on the left
 * wall, and a little cat step under it (where a cat from the attic lands).
 */
export const LOFT_HOOD = { x: FUNNEL.x, y: -300 };
export const LOFT_STEP = { x0: 0, x1: 106, y: LOFT_HOOD.y + 92 };
/** The basement end of the chute: a long glass pipe down the wall to a hood. */
export const SPOUT = { x: FUNNEL.x, y: BASEMENT_DY + 400 };
/**
 * The living room's suction hood, over the right end of the top cat step
 * (with room under it for the biggest cat), its pipe going up the wall and
 * through the ceiling.
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
    id: 'loft',
    needs: 'attic',
    path: [
      [ATTIC_FUNNEL.x, ATTIC_FUNNEL.neckY - 26],
      [ATTIC_FUNNEL.x, ATTIC_FUNNEL.floorY],
      [LOFT_HOOD.x, LIVING_CEIL],
      [LOFT_HOOD.x, LOFT_HOOD.y - 4],
    ],
    upper: {
      floor: 'attic',
      x: ATTIC_FUNNEL.x,
      y: ATTIC_FUNNEL.rimY - 6,
      dirX: 0.42,
      dirY: -1,
      speed: 560,
      zone: { x0: ATTIC_FUNNEL.x - ATTIC_FUNNEL.rimHw + 6, y0: ATTIC_FUNNEL.rimY - 14, x1: ATTIC_FUNNEL.x + ATTIC_FUNNEL.rimHw - 6, y1: ATTIC_FUNNEL.floorY },
      kind: 'funnel',
    },
    lower: {
      floor: 'living',
      x: LOFT_HOOD.x,
      y: LOFT_HOOD.y + 8,
      dirX: 0,
      dirY: 1,
      speed: 120,
      zone: { x0: 0, y0: LOFT_HOOD.y, x1: LOFT_HOOD.x + 46, y1: LOFT_STEP.y },
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
      [HOOD.x, LIVING_CEIL],
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

/** Where the living room's bouncy cushion stands (its middle), between the vase and the basket. */
export const LIVING_CUSHION_X = 224;

/** The rafters sloping down into the attic's top corners (its room frame): how far along the ceiling, and how far down the wall. */
export const RAFTER = { run: 104, drop: 150 };
/** The attic's furniture, where it stands in its room frame (the cats sit on it once it's open). */
export const ATTIC_FURNITURE = {
  crate: { x0: 108, x1: 172, y: 486 },
  cabinet: { x0: 230, x1: 316, y: 446 },
  shelf: { x0: 132, x1: 236, y: 316 },
};

/** The funnel a tube's top end is (the chute's, in the living room floor; the loft's, in the attic's), if it is one. */
export function funnelOf(t: Tube): Funnel | null {
  return t.id === 'chute' ? FUNNEL : t.id === 'loft' ? ATTIC_FUNNEL : null;
}

export { pathLength, pointAt } from '../util/path';

// ---------------------------------------------------------------------------
// Physics

const WALL = { material: 'wall' as Material, friction: 0.6 };

/** The house's shell: side walls top to bottom, the slabs between the floors, the sky's lid. */
export function houseShell(): StaticShape[] {
  return [
    roundedBox(-200, HOUSE_TOP - 600, 200, HOUSE_BOTTOM - HOUSE_TOP + 1200, 4, WALL),
    roundedBox(WORLD_W, HOUSE_TOP - 600, 200, HOUSE_BOTTOM - HOUSE_TOP + 1200, 4, WALL),
    roundedBox(-200, FLOORS.roof.ceilY - 340, WORLD_W + 400, 300, 4, WALL),
    // the roof deck down to the attic's ceiling, and the attic's floor down to the living room's ceiling
    roundedBox(-200, FLOORS.roof.floorY, WORLD_W + 400, FLOORS.attic.ceilY - FLOORS.roof.floorY, 4, WALL),
    roundedBox(-200, FLOORS.attic.floorY, WORLD_W + 400, LIVING_CEIL - FLOORS.attic.floorY, 4, WALL),
    // the living room floor, down to the basement's ceiling
    roundedBox(-200, FLOOR_Y, WORLD_W + 400, BASEMENT_DY - FLOOR_Y, 4, WALL),
    roundedBox(-200, FLOORS.basement.floorY, WORLD_W + 400, 300, 4, WALL),
  ];
}

/** Half the width of a hood's bell at its mouth. */
export const BELL = 24;

const GLASS = (propId: number): { material: Material; friction: number; propId: number } => ({ material: 'glass', friction: 0.3, propId });

/**
 * The glass of a tube (its walls, so cats sit beside and under it rather
 * than in it); while it's capped (the floor it goes to isn't open yet), its
 * mouths are shut too.
 */
export function tubeShapes(t: Tube, propId: number, open = true): StaticShape[] {
  const o = GLASS(propId);
  const out: StaticShape[] = [];
  const funnel = (f: Funnel): void => {
    out.push(
      capsule(f.x - f.rimHw, f.rimY, f.x - f.neckHw, f.neckY, 4, o),
      capsule(f.x + f.rimHw, f.rimY, f.x + f.neckHw, f.neckY, 4, o),
      capsule(f.x - f.neckHw, f.neckY, f.x - f.neckHw, f.floorY + 2, 4, o),
      capsule(f.x + f.neckHw, f.neckY, f.x + f.neckHw, f.floorY + 2, 4, o),
    );
    // a lid on it while it's shut
    if (!open) out.push(capsule(f.x - f.rimHw - 2, f.rimY - 3, f.x + f.rimHw + 2, f.rimY - 3, 5, { ...o, material: 'wood' }));
  };
  const hood = (m: { x: number; y: number }, pipeFrom: number | null): void => {
    if (pipeFrom !== null) out.push(capsule(m.x, pipeFrom, m.x, m.y - 22, 17, o));
    out.push(capsule(m.x - 17, m.y - 22, m.x - BELL, m.y, 4, o), capsule(m.x + 17, m.y - 22, m.x + BELL, m.y, 4, o));
    // and a cap on it
    if (!open) out.push(capsule(m.x - BELL, m.y + 2, m.x + BELL, m.y + 2, 4, { ...o, material: 'metal' }));
  };
  if (t.id === 'chute') {
    funnel(FUNNEL);
    // the basement pipe, and its hood
    hood(SPOUT, BASEMENT_DY - 4);
    return out;
  }
  if (t.id === 'loft') {
    funnel(ATTIC_FUNNEL);
    // down through the living room's ceiling to the hood high on the wall
    hood(LOFT_HOOD, LIVING_CEIL - 4);
    return out;
  }
  // the living room hood, and its pipe up the wall; up through the attic; the roof's hood
  hood(HOOD, LIVING_CEIL - 4);
  out.push(capsule(HOOD.x, FLOORS.attic.ceilY, HOOD.x, FLOORS.attic.floorY + 4, 17, o));
  hood(OUTLET, null);
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
