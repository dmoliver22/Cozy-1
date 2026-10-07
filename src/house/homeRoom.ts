// The house as a room: its furniture on every floor, the vase and the basket,
// the living room's decor (up its tall wall too) and where the cats are, and
// the room the tubes, the chimney and the attic's rafters take up.

import { FLOOR_Y, WORLD_W, type ContainerPlacement, type FurniturePlacement } from '../game/props';
import type { CatPlacement, DecorPlacement, RoomDef, SpawnOk } from '../game/room';
import { BREEDS, type BreedId } from '../physics/breeds';
import type { HouseSave } from './house';
import { NAMES, isOpen } from './house';
import { ATTIC_DY, ATTIC_FUNNEL, ATTIC_FURNITURE, BASEMENT_DY, CHIMNEY, FLOORS, FUNNEL, HOOD, LIVING_CEIL, LIVING_CUSHION_X, LOFT_HOOD, LOFT_STEP, OUTLET, RAFTER, SPOUT, TUBES, floorAt, type Tube } from './layout';
import { BOUNCE, type Box } from './perches';

/** The top cat step, under the roof tube's hood. */
export const TOP_STEP = { x0: 286, x1: 380, y: 128 };

/** The living room's furniture, and (once they're open) the attic's and the basement's. */
export function homeFurniture(open: { attic: boolean; basement: boolean }): FurniturePlacement[] {
  const out: FurniturePlacement[] = [
    // the cat steps up to the roof tube's suction hood (one over the other,
    // with room between them to get a cat past)
    { type: 'shelf', ...TOP_STEP },
    // (clear of the space over the bouncy cushion, so a cat dropped on it from up high gets there)
    { type: 'shelf', x0: 252, x1: 380, y: 338 },
    { type: 'sill', x0: 40, x1: 164, y: 212 },
    // the little step under the attic tube's hood, high on the left wall
    { type: 'shelf', ...LOFT_STEP },
  ];
  if (open.attic) {
    // an old crate, a cabinet and a shelf up there
    const f = ATTIC_FURNITURE;
    out.push({ type: 'crate', ...f.crate, dy: ATTIC_DY }, { type: 'cabinet', ...f.cabinet, dy: ATTIC_DY }, { type: 'shelf', ...f.shelf, dy: ATTIC_DY });
  }
  if (open.basement) {
    // the old bookcase went down to the den
    out.push({ type: 'bookcase', x0: 286, x1: 376, y: 420, dy: BASEMENT_DY });
    out.push({ type: 'shelf', x0: 130, x1: 214, y: 300, dy: BASEMENT_DY });
  }
  return out;
}

/** Across the living room floor: the funnel, a tall thin vase, the bouncy cushion (a perch) and the basket. */
export const VASE_X = 144;
export function homeContainers(): ContainerPlacement[] {
  return [
    { type: 'vase', x: VASE_X, y: FLOOR_Y, tint: 0, scale: 1.08 },
    { type: 'basket', x: 322, y: FLOOR_Y, tint: 0, scale: 0.95 },
  ];
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
    { type: 'window', x: 236, y: -410, w: 92, h: 118, variant: 1 },
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

/** Where each cat likes to be when it first moves in (x, and the top of what it sits on). */
export const SPOTS: Record<BreedId, { x: number; y: number }> = {
  kitten: { x: 102, y: 212 },
  tabby: { x: 290, y: 338 },
  persian: { x: 345, y: 338 },
  mainecoon: { x: 316, y: 128 },
  chonk: { x: 318, y: 552 },
  // (poured into the vase)
  void: { x: VASE_X, y: 553 },
  // yours, on the bouncy cushion
  mine: { x: LIVING_CUSHION_X, y: FLOOR_Y - BOUNCE.h },
};

/** The glass of a tube (there from the start, capped or not). */
function glassBoxes(t: Tube): Box[] {
  if (t.id === 'chute') {
    return [
      { x0: FUNNEL.x - FUNNEL.rimHw - 6, y0: FUNNEL.rimY - 6, x1: FUNNEL.x + FUNNEL.rimHw + 6, y1: FLOOR_Y },
      { x0: SPOUT.x - 26, y0: BASEMENT_DY - 4, x1: SPOUT.x + 26, y1: SPOUT.y + 6 },
    ];
  }
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

/** The house, with everyone who lives here where they last were (or in their favourite spot). */
export function houseRoom(h: Pick<HouseSave, 'open' | 'residents' | 'where'>): RoomDef {
  const cats: CatPlacement[] = h.residents.map((b) => {
    const w = h.where[b];
    if (w && canSit(h, b, w.x, w.y)) return { breed: b, x: w.x, y: w.y, name: NAMES[b] };
    return { breed: b, x: SPOTS[b].x, y: SPOTS[b].y, name: NAMES[b] };
  });
  return { id: 'home', name: 'Home', theme: 'living', furniture: homeFurniture({ attic: isOpen(h as HouseSave, 'attic'), basement: isOpen(h as HouseSave, 'basement') }), containers: homeContainers(), decor: homeDecor(), cats };
}
