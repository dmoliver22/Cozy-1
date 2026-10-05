// The home room: a sunny living room where your cats live, and the ways
// into the three games. The glass box on the rug is If It Fits, the little
// jar of cats on the shelf is Cat Jar, and the attic hatch at the top of the
// cat steps is Cat Drop (a cat starts up in the attic and drops down through
// the house).

import type { BreedId } from '../physics/breeds';
import type { CatPlacement, RoomDef } from '../game/room';
import type { GameId } from './house';
import { CEIL_Y, HATCH, TOP_STEP } from './homeArt';
import { NAMES } from './house';

/** The room without its cats. */
const ROOM: Omit<RoomDef, 'cats'> = {
  id: 'home',
  name: 'Home',
  theme: 'living',
  // (every spot can be reached from above: nothing for a cat to be stuck under)
  furniture: [
    // the cat steps up to the attic hatch
    { type: 'shelf', ...TOP_STEP },
    { type: 'shelf', x0: 200, x1: 296, y: 224 },
    // the shelf with the jar of cats (clear of the box, so Inkwell lifts straight out)
    { type: 'shelf', x0: 222, x1: 380, y: 338 },
    { type: 'sill', x0: 40, x1: 164, y: 212 },
    { type: 'bookcase', x0: 12, x1: 118, y: 432 },
  ],
  containers: [
    { type: 'box', x: 196, y: 560, tint: 0 },
    { type: 'basket', x: 318, y: 560, tint: 0, scale: 0.95 },
  ],
  decor: [
    { type: 'window', x: 102, y: 56, w: 112, h: 136, variant: 0 },
    { type: 'picture', x: 96, y: 300, w: 46, h: 38, variant: 1 },
    { type: 'clock', x: 228, y: 112, w: 15 },
    { type: 'pendant', x: 186, y: 44 },
    { type: 'rug', x: 238, y: 560, w: 220 },
  ],
};

/** The little jar of cats: where it stands and how big it's drawn. */
export const JAR_SPOT = { x: 258, y: 338, s: 0.42 };

/** Where each cat likes to be when you come home (x, and the top of what they sit on). */
const SPOTS: Record<BreedId, { x: number; y: number }> = {
  kitten: { x: 102, y: 212 },
  tabby: { x: 64, y: 432 },
  persian: { x: 345, y: 338 },
  sphynx: { x: 334, y: 128 },
  mainecoon: { x: 248, y: 224 },
  chonk: { x: 318, y: 552 },
  void: { x: 196, y: 553 },
};

/** The home room with these cats in their favourite spots. */
export function homeRoom(residents: readonly BreedId[]): RoomDef {
  const cats: CatPlacement[] = residents.map((b) => ({ breed: b, x: SPOTS[b].x, y: SPOTS[b].y, name: NAMES[b] }));
  return { ...ROOM, cats };
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
  { game: 'fits', name: 'If It Fits', x0: 128, y0: 470, x1: 264, y1: 564, lx: 196, ly: 466 },
  { game: 'jar', name: 'Cat Jar', x0: 220, y0: 254, x1: 298, y1: 340, lx: 258, ly: 252 },
  // the hatch and its ladder (a cat on the step below gets the tap first)
  { game: 'drop', name: 'Cat Drop', x0: TOP_STEP.x0 - 4, y0: CEIL_Y - 26, x1: HATCH.x1 + 10, y1: TOP_STEP.y - 4, lx: HATCH.x0 - 46, ly: CEIL_Y + 30 },
];

/** The game whose way in is at a world point (null if none). */
export function portalAt(x: number, y: number): Portal | null {
  return PORTALS.find((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) ?? null;
}
