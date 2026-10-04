// Cat Jar: the numbers. World units (y down) like If It Fits, a portrait
// world centred on a big glass jar that stands on a kitchen counter.

import type { BreedId, BreedPhysics } from '../../physics/breeds';

/** Room width (the painted kitchen is 380 wide, like an If It Fits room). */
export const WORLD_W = 380;
/** Jar centre line. */
export const CX = 190;

/** The jar's glass, as physics parts (see jarShape.ts). */
export const JAR = {
  /** Inner faces of the walls. */
  inL: 72,
  inR: 308,
  /** Glass half thickness (wall capsule radius). */
  wall: 5,
  /** Top of the walls (centre of their rounded ends) = the rim. */
  rimY: 150,
  /** Inner floor (top face of the bottom glass). */
  floorY: 452,
  /** Inner bottom corner radius. */
  corner: 30,
  /** Thick glass foot under the floor (its bottom stands on the counter). */
  footY: 468,
};

/** Counter top (the jar's foot stands on it). */
export const COUNTER_Y = JAR.footY;
/** Where the next cat waits (centre). */
export const HOLD_Y = 74;
/** The "full" line: a cat resting with its top above it for FULL_FRAMES ends the game. */
export const LINE_Y = JAR.rimY + 22;
export const FULL_FRAMES = 120;
/** A cat dropped (or booped) this recently doesn't count for the full line. */
export const GRACE_DROP = 90;
export const GRACE_BOOP = 60;
/** Frames between a drop and the next cat appearing at the top. */
export const RELOAD_FRAMES = 27;

export const BOOPS_START = 3;
export const BOOPS_MAX = 5;
/** Merging two cats of this tier or bigger (persian+) earns a boop back. */
export const BOOP_EARN_TIER = 3;

export interface Tier {
  breed: BreedId;
  name: string;
  r: number;
  nodes: number;
  /** Physics tweaks on top of the breed's own numbers. */
  phys: Partial<BreedPhysics>;
}

/** Ring nodes for a radius: about one per 5.5 units of outline, 14..36. */
export const nodesFor = (r: number): number => Math.max(14, Math.min(36, Math.round((2 * Math.PI * r) / 5.5)));

const tier = (breed: BreedId, name: string, r: number, phys: Partial<BreedPhysics> = {}): Tier => ({ breed, name, r, nodes: nodesFor(r), phys });

/** The merge chain: two of a tier melt into one of the next. */
export const TIERS: Tier[] = [
  // A little shape memory all round: in a jar the cats are pudding, squashed
  // under the pile and springing back, not liquids poured into a cup.
  tier('kitten', 'Kitten', 18.5, { shape: 0.004 }),
  tier('sphynx', 'Sphynx', 23.5),
  tier('tabby', 'Tabby', 29.5, { shape: 0.004 }),
  tier('persian', 'Persian', 37, { shape: 0.003 }),
  tier('mainecoon', 'Maine Coon', 46, { shape: 0.003 }),
  tier('chonk', 'Chonk', 57, { shape: 0.004 }),
  tier('void', 'The Void', 70, { shape: 0.005 }),
];

export const LAST_TIER = TIERS.length - 1;

/** Drops come from the first four tiers, weighted toward the small ones. */
export const DROP_WEIGHTS = [0.37, 0.3, 0.21, 0.12];

/** Points for melting two cats of tier t: triangular numbers x 10 (kittens 10 ... chonks 210). */
export function mergePoints(t: number): number {
  if (t >= LAST_TIER) return 1000;
  const n = t + 1;
  return ((n * (n + 1)) / 2) * 10;
}
