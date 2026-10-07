// The house as a room: its furniture on every floor, the vase and the glass
// tub (each where it always was, or wherever you've moved it), the living
// room's decor (up its tall wall too) and where the cats are, and the room
// the tubes, the chimney and the attic's rafters take up.

import { CONTAINERS, FLOOR_Y, WORLD_W, buildContainer, buildFurniture, type ContainerPlacement, type FurniturePlacement, type Prop } from '../game/props';
import type { CatPlacement, DecorPlacement, RoomDef, SpawnOk } from '../game/room';
import { BREEDS, type BreedId } from '../physics/breeds';
import type { HouseSave } from './house';
import { NAMES, isOpen, openFloors } from './house';
import { ATTIC_DY, ATTIC_FUNNEL, ATTIC_FURNITURE, BASEMENT_DY, CHIMNEY, FLOORS, FUNNEL, HOOD, LIVING_CEIL, LIVING_CUSHION_X, LOFT_HOOD, LOFT_STEP, OUTLET, RAFTER, SKY_HOOD, SKY_TOP, SPOUT, TUBES, floorAt, type FloorId, type Tube } from './layout';
import { BOUNCE, type Box, type PlaceProblem } from './perches';

/** The top cat step, under the roof tube's hood. */
export const TOP_STEP = { x0: 286, x1: 380, y: 128 };

/** Across the living room floor: the funnel, a tall thin vase, the bouncy cushion (a perch) and a big glass tub. */
export const VASE_X = 144;

// ---------------------------------------------------------------------------
// The house's own things

/** The house's own furniture, the vase and the glass tub. */
export type ThingId = 'topStep' | 'shelf' | 'sill' | 'loftStep' | 'crate' | 'cabinet' | 'atticShelf' | 'bookcase' | 'denShelf' | 'vase' | 'basket';

export type Thing = {
  id: ThingId;
  /** What it's called ("Drag the vase where you'd like it"). */
  name: string;
  /** The floor it's on to begin with (the attic's and the basement's are there once it's open). */
  floor: FloorId;
  /** Why it can't be moved, if it can't: it goes with the window, or with a tube. */
  stays?: string;
} & ({ kind: 'furniture'; at: FurniturePlacement } | { kind: 'container'; at: ContainerPlacement });

const ATTIC = ATTIC_FURNITURE;
const WITH_TUBE = 'That step goes with the tube over it';

/**
 * Everything the house comes with, where it is to begin with. A long press
 * picks one up to move it, anywhere on an open floor (but the roof): see
 * Home's placing.
 */
export const THINGS: Thing[] = [
  // the cat steps up to the roof tube's suction hood (one over the other,
  // with room between them to get a cat past)
  { id: 'topStep', name: 'step', floor: 'living', kind: 'furniture', at: { type: 'shelf', ...TOP_STEP }, stays: WITH_TUBE },
  // (clear of the space over the bouncy cushion, so a cat dropped on it from up high gets there)
  { id: 'shelf', name: 'shelf', floor: 'living', kind: 'furniture', at: { type: 'shelf', x0: 252, x1: 380, y: 338 } },
  { id: 'sill', name: 'window sill', floor: 'living', kind: 'furniture', at: { type: 'sill', x0: 40, x1: 164, y: 212 }, stays: 'The sill goes with its window' },
  // the little step under the attic tube's hood, high on the left wall
  { id: 'loftStep', name: 'step', floor: 'living', kind: 'furniture', at: { type: 'shelf', ...LOFT_STEP }, stays: WITH_TUBE },
  // an old crate, a cabinet and a shelf up in the attic
  { id: 'crate', name: 'crate', floor: 'attic', kind: 'furniture', at: { type: 'crate', ...ATTIC.crate, dy: ATTIC_DY } },
  { id: 'cabinet', name: 'cabinet', floor: 'attic', kind: 'furniture', at: { type: 'cabinet', ...ATTIC.cabinet, dy: ATTIC_DY } },
  { id: 'atticShelf', name: 'shelf', floor: 'attic', kind: 'furniture', at: { type: 'shelf', ...ATTIC.shelf, dy: ATTIC_DY } },
  // the old bookcase went down to the den
  { id: 'bookcase', name: 'bookcase', floor: 'basement', kind: 'furniture', at: { type: 'bookcase', x0: 286, x1: 376, y: 420, dy: BASEMENT_DY } },
  { id: 'denShelf', name: 'shelf', floor: 'basement', kind: 'furniture', at: { type: 'shelf', x0: 130, x1: 214, y: 300, dy: BASEMENT_DY } },
  { id: 'vase', name: 'vase', floor: 'living', kind: 'container', at: { type: 'vase', x: VASE_X, y: FLOOR_Y, tint: 0, scale: 1.08 } },
  { id: 'basket', name: 'glass tub', floor: 'living', kind: 'container', at: { type: 'basket', x: 322, y: FLOOR_Y, tint: 0, scale: 0.95 } },
];
export const THING = Object.fromEntries(THINGS.map((t) => [t.id, t])) as Record<ThingId, Thing>;

type Moved = HouseSave['moved'];

/** Where a thing is (as you move it about: furniture by the middle of its top, a container by the middle of its bottom), as it came or as moved. */
export function thingPos(t: Thing, moved?: Moved): { x: number; y: number } {
  const m = t.stays ? undefined : moved?.[t.id];
  if (m) return m;
  if (t.kind === 'container') return { x: t.at.x, y: t.at.y };
  return { x: (t.at.x0 + t.at.x1) / 2, y: t.at.y + (t.at.dy ?? 0) };
}

/** Does it go on a wall (a shelf, the sill), or stand on a floor? */
export function onWall(t: Thing): boolean {
  return t.kind === 'furniture' && (t.at.type === 'shelf' || t.at.type === 'sill');
}

/** A piece of furniture with its top's middle at (x, y), on whichever floor that is. */
function furnitureAt(t: Thing & { kind: 'furniture' }, x: number, y: number): FurniturePlacement {
  const half = (t.at.x1 - t.at.x0) / 2;
  const dy = FLOORS[floorAt(y)].dy;
  return { ...t.at, x0: x - half, x1: x + half, y: y - dy, dy: dy || undefined, id: t.id };
}

function containerAt(t: Thing & { kind: 'container' }, x: number, y: number): ContainerPlacement {
  return { ...t.at, x, y, id: t.id };
}

/** A thing built at (x, y) (see thingPos), its colliders carrying `uid`. */
export function thingProp(t: Thing, x: number, y: number, uid: number): Prop {
  return t.kind === 'container' ? buildContainer(containerAt(t, x, y), uid) : buildFurniture(furnitureAt(t, x, y), uid);
}

/** The house's things on its open floors, where they are (as moved), but one (`but`): what's in its way. */
export function thingBoxes(h: Pick<HouseSave, 'open' | 'moved'>, but: ThingId | null = null): Box[] {
  return THINGS.filter((t) => t.id !== but && (t.floor === 'living' || isOpen(h as HouseSave, t.floor))).map((t) => {
    const q = thingPos(t, h.moved);
    return thingProp(t, q.x, q.y, -1);
  });
}

/**
 * Things moved somewhere they can't be (in a tube's way, on a floor that
 * isn't open, in one another) go back where they always were; and then any
 * moved to where one of those was, and so on.
 */
export function settleMoved(h: Pick<HouseSave, 'open' | 'moved'>): void {
  const fit = fittingBoxes(h, 'all');
  const open = openFloors(h as HouseSave);
  for (let again = true; again; ) {
    again = false;
    for (const [id, m] of Object.entries(h.moved)) {
      const t = THING[id as ThingId] as Thing | undefined;
      if (t && !t.stays && thingProblem(t, m.x, m.y, open, [...fit, ...thingBoxes(h, t.id)]) === null) continue;
      delete h.moved[id];
      again = true;
      break;
    }
  }
}

/** The living room's furniture, and (once they're open) the attic's and the basement's: each where it always was, or where you've put it. */
export function homeFurniture(open: { attic: boolean; basement: boolean }, moved?: Moved): FurniturePlacement[] {
  const out: FurniturePlacement[] = [];
  for (const t of THINGS) {
    if (t.kind !== 'furniture' || (t.floor === 'attic' && !open.attic) || (t.floor === 'basement' && !open.basement)) continue;
    const p = thingPos(t, moved);
    out.push(furnitureAt(t, p.x, p.y));
  }
  return out;
}

/** The vase and the glass tub, where they always were or where you've put them. */
export function homeContainers(moved?: Moved): ContainerPlacement[] {
  const out: ContainerPlacement[] = [];
  for (const t of THINGS) {
    if (t.kind !== 'container') continue;
    const p = thingPos(t, moved);
    out.push(containerAt(t, p.x, p.y));
  }
  return out;
}

/** How far a thing reaches either side of its middle. */
function reach(t: Thing): { l: number; r: number } {
  if (t.kind === 'furniture') {
    const half = (t.at.x1 - t.at.x0) / 2;
    return { l: half, r: half };
  }
  const s = t.at.scale ?? 1;
  const [bx0, , bx1] = CONTAINERS[t.at.type].bounds;
  return { l: -bx0 * s, r: bx1 * s };
}

/**
 * Where a thing dragged to (x, y) goes: in the room, standing on the floor
 * of the storey it's in (a shelf anywhere up a wall, and up against the
 * wall's end if it's nearly there).
 */
export function snapThing(t: Thing, x: number, y: number): { x: number; y: number } {
  const { l, r } = reach(t);
  let cx = Math.max(l, Math.min(WORLD_W - r, x));
  if (onWall(t)) {
    if (cx - l < 10) cx = l;
    else if (cx + r > WORLD_W - 10) cx = WORLD_W - r;
    return { x: Math.round(cx), y: Math.round(y) };
  }
  const fl = FLOORS[floorAt(y)];
  return { x: Math.round(cx), y: t.kind === 'container' ? fl.floorY : fl.floorY - (FLOOR_Y - t.at.y) };
}

/**
 * Can a thing go at (x, y)? On an open floor indoors, in the room (a shelf
 * clear of the ceiling and well clear of the floor, the rest standing on
 * it), and not in anything else (`taken`).
 */
export function thingProblem(t: Thing, x: number, y: number, open: readonly FloorId[], taken: readonly Box[]): PlaceProblem {
  const f = floorAt(t.kind === 'container' ? y - 1 : y);
  if (!open.includes(f)) return 'locked';
  if (f === 'roof') return 'sky';
  const fl = FLOORS[f];
  const p = thingProp(t, x, y, -1);
  if (p.x0 < -0.5 || p.x1 > WORLD_W + 0.5 || p.y0 < fl.ceilY + 12) return 'outside';
  if (onWall(t) ? p.y1 > fl.floorY - 30 : Math.abs(p.y1 - fl.floorY) > 0.5) return 'outside';
  for (const b of taken) if (p.x0 < b.x1 && p.x1 > b.x0 && p.y0 < b.y1 && p.y1 > b.y0) return 'blocked';
  return null;
}

/**
 * The living room's decor (the other floors paint their own): down by the
 * floor as it always was, and up the tall wall a high window, pictures and
 * bunting under the ceiling, with the lamp hanging down from it on a long cord.
 */
export function homeDecor(): DecorPlacement[] {
  return [
    { type: 'window', x: 102, y: 56, w: 112, h: 136, variant: 0 },
    { type: 'picture', x: 96, y: 300, w: 46, h: 38, variant: 1 },
    { type: 'clock', x: 228, y: 112, w: 15 },
    { type: 'pendant', x: 160, y: 44, h: 44 - LIVING_CEIL },
    { type: 'rug', x: 238, y: FLOOR_Y, w: 220 },
    { type: 'window', x: 236, y: -410, w: 92, h: 118, variant: 1, outlook: 'high' },
    // (clear of the attic tube's pipe and hood, and the step under it)
    { type: 'picture', x: 124, y: -370, w: 44, h: 56, variant: 0 },
    { type: 'picture', x: 124, y: -150, w: 40, h: 34, variant: 2 },
    { type: 'garland', x: 168, y: LIVING_CEIL + 12, w: 300 },
  ];
}

/**
 * Where the cats leave their present: on the window sill, at the end Pip
 * doesn't sit on (the yarn's at the other). The floor along the wall is full
 * (the funnel, the vase, the cushion and the basket), and on a short screen
 * the bar along the bottom and the way down hide the front of it.
 */
export const GIFT_SPOT = { x: 57, y: 212 };

/** Where each cat likes to be when it first moves in (x, and the top of what it sits on), and what that is (the spot goes where it's moved to). */
export const SPOTS: Record<BreedId, { x: number; y: number; on?: ThingId }> = {
  kitten: { x: 102, y: 212, on: 'sill' },
  tabby: { x: 290, y: 338, on: 'shelf' },
  persian: { x: 345, y: 338, on: 'shelf' },
  mainecoon: { x: 316, y: 128, on: 'topStep' },
  // (curled up in the glass tub)
  chonk: { x: 318, y: 552, on: 'basket' },
  // (poured into the vase)
  void: { x: VASE_X, y: 553, on: 'vase' },
  // yours, on the bouncy cushion
  mine: { x: LIVING_CUSHION_X, y: FLOOR_Y - BOUNCE.h },
};

/** Where a cat likes to be: on what it likes, wherever that's been moved to. */
export function spotOf(h: { moved?: Moved }, b: BreedId): { x: number; y: number } {
  const s = SPOTS[b];
  if (!s.on) return s;
  const t = THING[s.on];
  const from = thingPos(t);
  const to = thingPos(t, h.moved);
  return { x: s.x + to.x - from.x, y: s.y + to.y - from.y };
}

/** The glass of a tube (there from the start, capped or not). */
function glassBoxes(t: Tube): Box[] {
  if (t.id === 'chute') {
    return [
      { x0: FUNNEL.x - FUNNEL.rimHw - 6, y0: FUNNEL.rimY - 6, x1: FUNNEL.x + FUNNEL.rimHw + 6, y1: FLOOR_Y },
      { x0: SPOUT.x - 26, y0: BASEMENT_DY - 4, x1: SPOUT.x + 26, y1: SPOUT.y + 6 },
    ];
  }
  if (t.id === 'sky') return [{ x0: SKY_HOOD.x - 26, y0: SKY_TOP, x1: SKY_HOOD.x + 26, y1: SKY_HOOD.y + 6 }];
  if (t.id === 'loft') {
    return [
      { x0: ATTIC_FUNNEL.x - ATTIC_FUNNEL.rimHw - 6, y0: ATTIC_FUNNEL.rimY - 6, x1: ATTIC_FUNNEL.x + ATTIC_FUNNEL.rimHw + 6, y1: ATTIC_FUNNEL.floorY },
      // down the living room wall to its hood, and the cat step under it
      { x0: LOFT_HOOD.x - 26, y0: LIVING_CEIL, x1: LOFT_HOOD.x + 26, y1: LOFT_HOOD.y + 6 },
      { x0: LOFT_STEP.x0, y0: LOFT_STEP.y - 4, x1: LOFT_STEP.x1, y1: LOFT_STEP.y + 26 },
    ];
  }
  return [
    // up out of the roof deck and over to its hood, down through the attic, and down the living room wall to the hood over the cat steps
    { x0: OUTLET.x - 30, y0: OUTLET.top - 46, x1: HOOD.x + 26, y1: OUTLET.y + 6 },
    { x0: HOOD.x - 26, y0: FLOORS.roof.floorY - 200, x1: HOOD.x + 26, y1: FLOORS.roof.floorY },
    { x0: HOOD.x - 26, y0: FLOORS.attic.ceilY, x1: HOOD.x + 26, y1: FLOORS.attic.floorY },
    { x0: HOOD.x - 26, y0: LIVING_CEIL, x1: HOOD.x + 26, y1: HOOD.y + 6 },
  ];
}

/**
 * Room nothing else may take: every tube's glass, the chimney, and the space
 * at an open tube's mouths, where cats go in and come out (with `mouths`
 * 'all', a capped tube's too: a perch mustn't be in the way of a tube that
 * opens later).
 */
export function fittingBoxes(h: Pick<HouseSave, 'open'>, mouths: 'open' | 'all' = 'open'): Box[] {
  const out: Box[] = [];
  for (const t of TUBES) {
    out.push(...glassBoxes(t));
    if (mouths === 'open' && !isOpen(h as HouseSave, t.needs)) continue;
    for (const m of [t.upper, t.lower]) out.push({ x0: m.zone.x0 - 6, y0: m.zone.y0 - 30, x1: m.zone.x1 + 6, y1: m.zone.y1 });
  }
  out.push({ x0: CHIMNEY.x0 - 4, y0: CHIMNEY.y, x1: CHIMNEY.x1 + 4, y1: FLOORS.roof.floorY });
  // the attic's rafters, sloping down into its top corners
  const ceil = FLOORS.attic.ceilY;
  out.push({ x0: 0, y0: ceil - 16, x1: RAFTER.run * 0.75, y1: ceil + RAFTER.drop * 0.75 }, { x0: WORLD_W - RAFTER.run * 0.75, y0: ceil - 16, x1: WORLD_W, y1: ceil + RAFTER.drop * 0.75 });
  return out;
}

/** Can a cat be put down with its bottom at (x, y): on an open floor, in the room, clear of the fittings? */
export function canSit(h: Pick<HouseSave, 'open'>, b: BreedId, x: number, y: number): boolean {
  const f = floorAt(y - 1);
  if (!isOpen(h as HouseSave, f)) return false;
  const r = BREEDS[b].physics.radius;
  const fl = FLOORS[f];
  if (x < r + 2 || x > WORLD_W - r - 2 || y > fl.floorY + 0.5 || y - 2 * r < fl.ceilY + 4) return false;
  const box: Box = { x0: x - r, y0: y - 2 * r, x1: x + r, y1: y - 2 };
  return !fittingBoxes(h).some((t) => box.x0 < t.x1 && box.x1 > t.x0 && box.y0 < t.y1 && box.y1 > t.y0);
}

/**
 * Where in the house a cat may be put instead, when its place isn't clear
 * (see buildRoom) or it's stuck fast (see Session.unstick): on the floor it
 * was on, in the room, clear of the fittings.
 */
export function houseSpawnOk(h: Pick<HouseSave, 'open'>): SpawnOk {
  return (x, y, r, from) => {
    const f = floorAt(from.y);
    if (floorAt(y + r * 0.9) !== f) return false;
    const fl = FLOORS[f];
    if (x < r + 2 || x > WORLD_W - r - 2 || y + r * 0.9 > fl.floorY || y - r < fl.ceilY + 4) return false;
    return !fittingBoxes(h).some((t) => x + r > t.x0 && x - r < t.x1 && y + r > t.y0 && y - r < t.y1);
  };
}

/** The house, with everyone who lives here where they last were (or in their favourite spot), and its things where you've put them. */
export function houseRoom(h: Pick<HouseSave, 'open' | 'residents' | 'where'> & { moved?: Moved }): RoomDef {
  const cats: CatPlacement[] = h.residents.map((b) => {
    const w = h.where[b];
    if (w && canSit(h, b, w.x, w.y)) return { breed: b, x: w.x, y: w.y, name: NAMES[b] };
    const s = spotOf(h, b);
    return { breed: b, x: s.x, y: s.y, name: NAMES[b] };
  });
  const open = { attic: isOpen(h as HouseSave, 'attic'), basement: isOpen(h as HouseSave, 'basement') };
  return { id: 'home', name: 'Home', theme: 'living', furniture: homeFurniture(open, h.moved), containers: homeContainers(h.moved), decor: homeDecor(), cats };
}
