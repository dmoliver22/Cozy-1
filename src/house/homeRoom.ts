// The house as a room: its furniture on every floor, the box and the basket,
// the living room's decor and where the cats are; and the ways into the three
// games. The glass box on the rug is If It Fits, the little jar of cats on the
// shelf is Cat Jar, and the attic hatch over the cat steps is Cat Drop (a cat
// starts up in the attic and drops down through the house).

import { FLOOR_Y, WORLD_W, type ContainerPlacement, type FurniturePlacement } from '../game/props';
import type { CatPlacement, DecorPlacement, RoomDef } from '../game/room';
import { BREEDS, type BreedId } from '../physics/breeds';
import type { GameId, HouseSave } from './house';
import { CEIL_Y, HATCH, TOP_STEP } from './homeArt';
import { NAMES, isOpen } from './house';
import { BASEMENT_DY, CHIMNEY, FLOORS, SPOUT, TUBES, floorAt } from './layout';
import type { Box } from './perches';

/** The living room's furniture, and (once it's open) the basement's. */
export function homeFurniture(basement: boolean): FurniturePlacement[] {
  const out: FurniturePlacement[] = [
    // the cat steps up to the attic hatch (and the roof's suction hood)
    { type: 'shelf', ...TOP_STEP },
    { type: 'shelf', x0: 200, x1: 296, y: 224 },
    // the shelf with the jar of cats (clear of the box, so Inkwell lifts straight out)
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

/** The living room's decor (the other floors paint their own). */
export function homeDecor(): DecorPlacement[] {
  return [
    { type: 'window', x: 102, y: 56, w: 112, h: 136, variant: 0 },
    { type: 'picture', x: 96, y: 300, w: 46, h: 38, variant: 1 },
    { type: 'clock', x: 228, y: 112, w: 15 },
    { type: 'pendant', x: 160, y: 44 },
    { type: 'rug', x: 238, y: FLOOR_Y, w: 220 },
  ];
}

/** The little jar of cats: where it stands and how big it's drawn. */
export const JAR_SPOT = { x: 258, y: 338, s: 0.42 };
/** Where the cats leave their present (on the floor between the funnel and the box). */
export const GIFT_SPOT = { x: 128, y: FLOOR_Y };

/** Where each cat likes to be when it first moves in (x, and the top of what it sits on). */
export const SPOTS: Record<BreedId, { x: number; y: number }> = {
  kitten: { x: 102, y: 212 },
  tabby: { x: 248, y: 224 },
  persian: { x: 345, y: 338 },
  mainecoon: { x: 316, y: 128 },
  chonk: { x: 318, y: 552 },
  void: { x: 196, y: 553 },
};

/** Room nothing else may take: the tubes, their mouths and the space under them, and the chimney. */
export function fittingBoxes(h: Pick<HouseSave, 'open'>): Box[] {
  const out: Box[] = [];
  for (const t of TUBES) {
    if (!isOpen(h as HouseSave, t.needs)) continue;
    for (const m of [t.upper, t.lower]) out.push({ x0: m.zone.x0 - 6, y0: m.zone.y0 - 30, x1: m.zone.x1 + 6, y1: m.zone.y1 });
    if (t.id === 'chute') out.push({ x0: SPOUT.x - 26, y0: BASEMENT_DY - 4, x1: SPOUT.x + 26, y1: SPOUT.y });
    else out.push({ x0: t.upper.x - 30, y0: FLOORS.roof.floorY - 200, x1: t.lower.x + 26, y1: FLOORS.roof.floorY }, { x0: t.lower.x - 26, y0: 0, x1: t.lower.x + 26, y1: t.lower.y });
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

export interface Portal {
  game: GameId;
  name: string;
  /** Tap area (world). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Where its label sits (world): the label's bottom middle. */
  lx: number;
  ly: number;
}

export const PORTALS: Portal[] = [
  { game: 'fits', name: 'If It Fits', x0: 146, y0: 470, x1: 264, y1: 564, lx: 196, ly: 466 },
  { game: 'jar', name: 'Cat Jar', x0: 220, y0: 254, x1: 298, y1: 340, lx: 258, ly: 252 },
  // the hatch and its ladder (a cat on the step below gets the tap first)
  { game: 'drop', name: 'Cat Drop', x0: HATCH.x0 - 4, y0: CEIL_Y - 26, x1: HATCH.x1 + 10, y1: TOP_STEP.y - 4, lx: HATCH.x0 - 46, ly: CEIL_Y + 30 },
];

/** The game whose way in is at a world point (null if none). */
export function portalAt(x: number, y: number): Portal | null {
  return PORTALS.find((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) ?? null;
}
