// Cat Jar: the numbers. World units (y down) like If It Fits, a portrait
// world centred on a big glass jar that stands on a kitchen counter.

import { BREEDS, type BreedId, type BreedLook, type BreedPhysics } from '../../physics/breeds';

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
  /**
   * Top of the walls (centre of their rounded ends) = the rim. The jar is
   * about two screens tall: the view scrolls, following the pile up.
   */
  rimY: -200,
  /** Inner floor (top face of the bottom glass). */
  floorY: 452,
  /** Inner bottom corner radius. */
  corner: 30,
  /** Thick glass foot under the floor (its bottom stands on the counter). */
  footY: 468,
};

/** Counter top (the jar's foot stands on it). */
export const COUNTER_Y = JAR.footY;
/** Highest the next cat waits (its centre), above the rim. */
export const HOLD_Y = JAR.rimY - 66;
/**
 * Lower down, the next cat waits this far above the top of the pile (from its
 * bottom), so every drop falls about as far and the view can stay on the pile.
 */
export const DROP_GAP = 150;
/** World rows the view can show: the highest waiting cat's ears to under the counter top. */
export const WORLD_TOP = HOLD_Y - 120;
export const WORLD_BOTTOM = COUNTER_Y + 64;
/**
 * The "full" line: a cat resting with its top above it for FULL_FRAMES ends
 * the game. It sits clear of the near rim's front arc (which the 2.5D rim
 * ellipse dips 20 units below the wall tops) and the twine just under it.
 */
export const LINE_Y = JAR.rimY + 36;
export const FULL_FRAMES = 120;
/** A cat dropped (or booped) this recently doesn't count for the full line. */
export const GRACE_DROP = 90;
export const GRACE_BOOP = 60;
/** Frames between a drop and the next cat appearing at the top. */
export const RELOAD_FRAMES = 27;

export const BOOPS_START = 3;
export const BOOPS_MAX = 5;
/** Merging two cats of this tier or bigger (persian+) earns a boop back. */
export const BOOP_EARN_TIER = 2;

export interface Tier {
  breed: BreedId;
  name: string;
  /** How it behaves in the jar, in a word (the start card, its first appearance). */
  trait: string;
  r: number;
  nodes: number;
  /** Physics tweaks on top of the breed's own numbers. */
  phys: Partial<BreedPhysics>;
}

/** Ring nodes for a radius: about one per 5.5 units of outline, 14..36. */
export const nodesFor = (r: number): number => Math.max(14, Math.min(36, Math.round((2 * Math.PI * r) / 5.5)));

const tier = (breed: BreedId, name: string, trait: string, r: number, phys: Partial<BreedPhysics> = {}): Tier => ({ breed, name, trait, r, nodes: nodesFor(r), phys });

/**
 * The merge chain: two of a tier melt into one of the next. Each breed has
 * its own way in the jar (on top of a little shape memory all round: in a
 * jar the cats are pudding, squashed under the pile and springing back):
 *
 * - the kitten is bouncy: it hops about a couple of times before it settles,
 *   toward another kitten if one is near (game.ts);
 * - the tabby is steady: no surprises, the one to build on;
 * - the Persian is oozy: soft and slow, it seeps down into the gaps;
 * - the Maine Coon is squishy: all fluff, it squashes down to fit;
 * - the chonk is heavy: it presses the pile flat, and small cats it lands
 *   on (or arrives next to) pop up out of the way (game.ts);
 * - the Void is the biggest of all: two of them vanish.
 */
export const TIERS: Tier[] = [
  tier('kitten', 'Kitten', 'bouncy', 18.5, { shape: 0.004, friction: 0.2 }),
  tier('tabby', 'Tabby', 'steady', 24.5, { shape: 0.004 }),
  tier('persian', 'Persian', 'oozy', 32, { shape: 0, tension: 330, viscosity: 30, friction: 0.1, plasticity: 1.6 }),
  tier('mainecoon', 'Maine Coon', 'squishy', 41.5, { shape: 0.001, pressure: 0.04, squish: 0.3 }),
  tier('chonk', 'Chonk', 'heavy', 54, { shape: 0.004, density: 3.2 }),
  tier('void', 'The Void', 'enormous', 70, { shape: 0.005 }),
  // Not in the chain: now and then a Little Void drops, and melts into any
  // cat it touches, making it one size bigger (a Void: both vanish).
  tier('void', 'Little Void', 'wild', 20, { shape: 0.004, friction: 0.25 }),
];

/**
 * The neighbours' cats: each of the three kinds that drop also comes in two
 * more coats, the same size with the same ways (a Ginger Kitten is just as
 * bouncy as a Kitten), but a cat only snuggles up to a twin in the same
 * coat. Two of a coat make the next kind in that coat, and at the top of the
 * drops a pair of any of them (two Persians, two Turkish Vans, two Blue
 * Persians) makes a Maine Coon. With only one coat apiece the soft cats found
 * their twins so easily that a pile never grew; with more kinds of cat there
 * are fewer easy matches, so the jar slowly fills and where you drop a cat
 * matters.
 */
export interface Coat {
  name: string;
  look: BreedLook;
}

const coat = (breed: BreedId, name: string, look: Partial<BreedLook>): Coat => ({ name, look: { ...BREEDS[breed].look, ...look } });

/** The neighbours' coats of tiers 0..COAT_TIERS-1: COATS[tier][c - 1] is coat c (coat 0 is the breed's own). */
export const COATS: Coat[][] = [
  [
    coat('kitten', 'Ginger Kitten', { body: '#E9A867', shade: '#CF8A49', light: '#FFF4E6', accent: '#C9773A', innerEar: '#F4B79A', nose: '#E58F8A', cheek: '#F3A98C' }),
    coat('kitten', 'Cream Kitten', { body: '#F2E3C6', shade: '#DDC8A4', light: '#FFFBF2', accent: '#D9B98A', innerEar: '#F2B8B0', nose: '#E8A0A0', cheek: '#F3B4A8', pattern: 'none' }),
  ],
  [
    coat('tabby', 'Silver Tabby', { body: '#BCC1CA', shade: '#9EA3AE', light: '#F4F4F6', accent: '#5E636E', innerEar: '#EBB2B4', nose: '#D98C92', cheek: '#EDB0B4' }),
    coat('tabby', 'Brown Tabby', { body: '#9C7458', shade: '#7E5A42', light: '#E9D3BC', accent: '#4E3628', innerEar: '#E2A49A', nose: '#C9827E', cheek: '#D99A8E' }),
  ],
  [
    coat('persian', 'Turkish Van', { body: '#F6F1EA', shade: '#E2D7CA', light: '#FFFFFF', accent: '#DF8F4A', innerEar: '#F2B6AC', nose: '#E0959A', cheek: '#F3B4A8', pattern: 'patches' }),
    coat('persian', 'Blue Persian', { body: '#A9B2C6', shade: '#8C95AB', light: '#E2E6EF', accent: '#7D8699', innerEar: '#D9B0BC', nose: '#A891A6', cheek: '#C6AEC6' }),
  ],
];
export const COAT_TIERS = COATS.length;

/**
 * The chance a drop is a neighbour's cat, after this many drops: none for
 * the first COAT_FROM, then more and more of them as the afternoon wears on,
 * up to COAT_SHARE after COAT_RAMP more; the second neighbour's cats start
 * coming round after COAT2_FROM drops. (Bots at a human pace: dropping at
 * random fills the jar in ~260 drops (240 to 290), aiming for twins in ~310
 * (210 to 400); with one neighbour's coats it took twice that, and with
 * none the jar never filled.)
 */
export function coatChance(drops: number): number {
  return drops < COAT_FROM ? 0 : Math.min(COAT_SHARE, ((drops - COAT_FROM + 1) / COAT_RAMP) * COAT_SHARE);
}
export const COAT_FROM = 6;
export const COAT_RAMP = 400;
export const COAT_SHARE = 0.6;
export const COAT2_FROM = 40;

/** Which coat a drop comes in, given the drops so far and two random numbers. */
export function pickCoat(drops: number, r1: number, r2: number): number {
  if (r1 >= coatChance(drops)) return 0;
  return drops >= COAT2_FROM && r2 < 0.5 ? 2 : 1;
}

/** A kind's name and coat. */
export function kindName(tier: number, c: number): string {
  return c > 0 && tier < COAT_TIERS ? COATS[tier][c - 1].name : TIERS[tier].name;
}
export function kindLook(tier: number, c: number): BreedLook {
  return c > 0 && tier < COAT_TIERS ? COATS[tier][c - 1].look : BREEDS[TIERS[tier].breed].look;
}
/** What two of a kind make: the next tier, in the same coat while there is one. */
export const nextCoat = (tier: number, c: number): number => (tier + 1 < COAT_TIERS ? c : 0);

/** The top of the merge chain (two of these vanish). */
export const LAST_TIER = 5;
/** The Little Void: a wildcard drop. */
export const WILD = 6;
/** Drops before the first Little Void can come, the chance of one per drop after that, and the gap between two. */
export const WILD_AFTER = 12;
export const WILD_CHANCE = 1 / 26;
export const WILD_GAP = 15;

/** Drops come from the first three tiers, weighted toward the small ones. */
export const DROP_WEIGHTS = [0.44, 0.33, 0.23];

/**
 * Two of a kind melt once they've snuggled up this many frames: cats that
 * just brush past each other on the way down don't, so it's where you put a
 * cat that makes the match, not luck.
 */
export const SNUGGLE_FRAMES = 30;
/**
 * A cat left lying still a while dozes off (eyes shut, a little z now and
 * then; a dozing kitten stops scooting about), and wakes when it's booped,
 * bumped, or a twin cuddles up to it: twins that touch always snuggle. As the
 * game goes on the cats get sleepier (from DOZE_FIRST frames down to
 * DOZE_LAST by the drop DOZE_RAMP, then slowly on to half that), and the
 * kitchen's light warms toward evening with it.
 */
export const DOZE_FIRST = 1800;
export const DOZE_LAST = 300;
export const DOZE_RAMP = 250;

/** How long a cat lies still before it dozes off, after this many drops. */
export function dozeFrames(drops: number): number {
  if (drops <= DOZE_RAMP) return Math.round(DOZE_FIRST + (DOZE_LAST - DOZE_FIRST) * (drops / DOZE_RAMP));
  const t = Math.min(1, (drops - DOZE_RAMP) / DOZE_RAMP);
  return Math.round(DOZE_LAST * (1 - 0.5 * t));
}
/** A merged cat melting again within this many frames (after its snuggle) is a chain reaction... */
export const CHAIN_FRAMES = SNUGGLE_FRAMES + 50;
/** ...and its points are multiplied by the chain's length, up to this. */
export const CHAIN_MAX = 3;

/**
 * Points for melting two cats of tier t: triangular numbers x 10 (kittens 10
 * ... chonks 150), 1000 for two voids. Chain reactions multiply (game.ts).
 */
export function mergePoints(t: number): number {
  if (t >= LAST_TIER) return 1000;
  const n = t + 1;
  return ((n * (n + 1)) / 2) * 10;
}
