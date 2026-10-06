// The house as a room: its furniture on every floor, the box and the basket,
// the living room's decor (up its tall wall too) and where the cats are, and
// the room the tubes and the chimney take up.

import { FLOOR_Y, WORLD_W, type ContainerPlacement, type FurniturePlacement } from '../game/props';
import type { CatPlacement, DecorPlacement, RoomDef } from '../game/room';
import { BREEDS, type BreedId } from '../physics/breeds';
import type { HouseSave } from './house';
import { NAMES, isOpen } from './house';
import { BASEMENT_DY, CHIMNEY, FLOORS, FUNNEL, HOOD, LIVING_CEIL, OUTLET, SPOUT, TUBES, floorAt, type Tube } from './layout';
import type { Box } from './perches';

/** The top cat step, under the roof tube's hood. */
export const TOP_STEP = { x0: 286, x1: 380, y: 128 };

/** The living room's furniture, and (once it's open) the basement's. */
export function homeFurniture(basement: boolean): FurniturePlacement[] {
  const out: FurniturePlacement[] = [
    // the cat steps up to the roof tube's suction hood (one over the other,
    // with room between them to get a cat past)
    { type: 'shelf', ...TOP_STEP },
    // (clear of the box, so Inkwell lifts straight out)
    { type: 'shelf', x0: 222, x1: 380, y: 338 },
    { type: 'sill', x0: 40, x1: 164, y: 212 },
  ];
  if (basement) {
    // the old bookcase went down to the den
    out.push({ type: 'bookcase', x0: 286, x1: 376, y: 420, dy: BASEMENT_DY });
    out.push({ type: 'shelf', x0: 130, x1: 214, y: 300, dy: BASEMENT_DY });
  }
  return out;
}

export function homeContainers(): ContainerPlacement[] {
  return [
    { type: 'box', x: 196, y: FLOOR_Y, tint: 0 },
    { type: 'basket', x: 318, y: FLOOR_Y, tint: 0, scale: 0.95 },
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
    { type: 'picture', x: 92, y: -300, w: 54, h: 66, variant: 0 },
    { type: 'picture', x: 98, y: -170, w: 40, h: 34, variant: 2 },
    { type: 'garland', x: 168, y: LIVING_CEIL + 12, w: 300 },
  ];
}

/** Where the cats leave their present (on the floor between the funnel and the box). */
export const GIFT_SPOT = { x: 128, y: FLOOR_Y };

/** Where each cat likes to be when it first moves in (x, and the top of what it sits on). */
export const SPOTS: Record<BreedId, { x: number; y: number }> = {
  kitten: { x: 102, y: 212 },
  tabby: { x: 262, y: 338 },
  persian: { x: 345, y: 338 },
  mainecoon: { x: 316, y: 128 },
  chonk: { x: 318, y: 552 },
  void: { x: 196, y: 553 },
};

/** The glass of a tube (there from the start, capped or not). */
function glassBoxes(t: Tube): Box[] {
  if (t.id === 'chute') {
    return [
      { x0: FUNNEL.x - FUNNEL.rimHw - 6, y0: FUNNEL.rimY - 6, x1: FUNNEL.x + FUNNEL.rimHw + 6, y1: FLOOR_Y },
      { x0: SPOUT.x - 26, y0: BASEMENT_DY - 4, x1: SPOUT.x + 26, y1: SPOUT.y + 6 },
    ];
  }
  return [
    // up out of the roof deck and over to its hood, and down the living room wall to the hood over the cat steps
    { x0: OUTLET.x - 30, y0: OUTLET.top - 46, x1: HOOD.x + 26, y1: OUTLET.y + 6 },
    { x0: HOOD.x - 26, y0: FLOORS.roof.floorY - 200, x1: HOOD.x + 26, y1: FLOORS.roof.floorY },
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

/** The house, with everyone who lives here where they last were (or in their favourite spot). */
export function houseRoom(h: Pick<HouseSave, 'open' | 'residents' | 'where'>): RoomDef {
  const cats: CatPlacement[] = h.residents.map((b) => {
    const w = h.where[b];
    if (w && canSit(h, b, w.x, w.y)) return { breed: b, x: w.x, y: w.y, name: NAMES[b] };
    return { breed: b, x: SPOTS[b].x, y: SPOTS[b].y, name: NAMES[b] };
  });
  return { id: 'home', name: 'Home', theme: 'living', furniture: homeFurniture(isOpen(h as HouseSave, 'basement')), containers: homeContainers(), decor: homeDecor(), cats };
}
