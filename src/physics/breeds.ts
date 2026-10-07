// The six cats' breeds, and your own cat's ('mine', from the cat maker: see
// mycat.ts). Each pours differently: these numbers are how each one moves,
// not decoration.

import { DEFAULT_DESIGN, designBreed, type CatDesign } from './mycat';

export type BreedId = 'kitten' | 'persian' | 'chonk' | 'tabby' | 'mainecoon' | 'void' | 'mine';

export interface BreedPhysics {
  /** Rest radius in world units (the world is 360 units wide). */
  radius: number;
  /** Ring nodes (spec: ~24-32). */
  nodes: number;
  /** Mass per 1000 square units. */
  density: number;
  /** Surface tension (force per edge). Higher = rounder, harder to pour. */
  tension: number;
  /** How strongly edges even out toward the mean spacing (0..1). */
  equalize: number;
  /** Hard stretch limit as a multiple of the edge rest length. */
  maxStretch: number;
  /** Area (pressure) constraint stiffness per substep (0..1). */
  pressure: number;
  /** How much the body may squash below its rest area (fluff), 0..0.3. */
  squish: number;
  /** Shape-matching stiffness per substep (jelly high, honey low). */
  shape: number;
  /** Damping of deformation velocity, per second (honey/pudding high). */
  viscosity: number;
  /** Coulomb friction against furniture. */
  friction: number;
  /** Upright bias applied through shape matching (0..1 per substep). */
  upright: number;
  /** Vertical speed of a boop-hop. */
  hop: number;
  /** How willingly it pours into narrow openings (jelly resists). */
  slurp: number;
  /** Rest-shape creep per second while sitting (keeps the container's shape). */
  plasticity: number;
  /** Width/height of the settled loaf. */
  loafAspect: number;
  /** Width/height dangling from the scruff (pudding and honey droop longest, jelly springs back). */
  hang: number;
}

export type FacePersona = 'sleepy' | 'dramatic' | 'zippy' | 'polite' | 'fluffy' | 'void';
export type FurPattern = 'none' | 'tabby' | 'patches' | 'fluff' | 'mane' | 'belly' | 'plain' | 'tuxedo' | 'patchy' | 'points';

export interface BreedLook {
  body: string;
  shade: string;
  light: string;
  accent: string;
  innerEar: string;
  nose: string;
  eye: string;
  cheek: string;
  pattern: FurPattern;
  /** Outline fluffiness, 0 = smooth .. 1 = cloud (Persian). */
  fluff: number;
  earSize: number;
  earTufts: boolean;
  tailFluff: number;
  persona: FacePersona;
  /** Painted like the Void: light lines on a dark coat (unset: only the Void is). */
  dark?: boolean;
  /** Softer lines, for a white or cream coat. */
  pale?: boolean;
  /** A fluffy bib under the chin. */
  bib?: boolean;
}

export interface Breed {
  id: BreedId;
  name: string;
  /** "pours like ..." */
  flow: string;
  flowShort: string;
  blurb: string;
  physics: BreedPhysics;
  look: BreedLook;
  purr: { pitch: number; rate: number; rough: number };
  voice: { pitch: number; length: number };
}

export const BREEDS: Record<BreedId, Breed> = {
  kitten: {
    id: 'kitten',
    name: 'Kitten',
    flow: 'pours like water',
    flowShort: 'water',
    blurb: 'Zippy, tiny and always halfway into something already.',
    physics: {
      radius: 22,
      nodes: 24,
      density: 1.0,
      tension: 360,
      equalize: 0.08,
      maxStretch: 2.4,
      pressure: 0.9,
      squish: 0.02,
      shape: 0.0,
      viscosity: 3,
      friction: 0.25,
      upright: 0.03,
      hop: 430,
      slurp: 1,
      plasticity: 1.2,
      loafAspect: 1.25,
      hang: 0.7,
    },
    look: {
      body: '#A9AEB8',
      shade: '#8C909B',
      light: '#F4EEE6',
      accent: '#7D828D',
      innerEar: '#F2B8B5',
      nose: '#E58F95',
      eye: '#3E3A4F',
      cheek: '#F3A9A6',
      pattern: 'patches',
      fluff: 0.25,
      earSize: 1.15,
      earTufts: false,
      tailFluff: 0.2,
      persona: 'zippy',
    },
    purr: { pitch: 1.35, rate: 1.25, rough: 0.35 },
    voice: { pitch: 1.5, length: 0.7 },
  },
  persian: {
    id: 'persian',
    name: 'Persian',
    flow: 'pours like honey',
    flowShort: 'honey',
    blurb: 'Dramatic. Will ooze into a fruit bowl and then sigh about it.',
    physics: {
      radius: 32,
      nodes: 30,
      density: 0.9,
      tension: 680,
      equalize: 0.08,
      maxStretch: 2.4,
      pressure: 0.8,
      squish: 0.04,
      shape: 0.0,
      viscosity: 26,
      friction: 0.45,
      upright: 0.02,
      hop: 260,
      slurp: 1,
      plasticity: 0.8,
      loafAspect: 1.4,
      hang: 0.58,
    },
    look: {
      body: '#F7E6CC',
      shade: '#E6CBA6',
      light: '#FFF7EA',
      accent: '#D9B88E',
      innerEar: '#EFB7AE',
      nose: '#D98B87',
      eye: '#3E3A4F',
      cheek: '#F2B2A4',
      pattern: 'fluff',
      fluff: 1,
      earSize: 0.7,
      earTufts: false,
      tailFluff: 1,
      persona: 'dramatic',
    },
    purr: { pitch: 1.0, rate: 0.9, rough: 0.5 },
    voice: { pitch: 0.95, length: 1.2 },
  },
  chonk: {
    id: 'chonk',
    name: 'Chonk',
    flow: 'pours like pudding',
    flowShort: 'pudding',
    blurb: 'A sleepy ginger loaf. Moves for nobody, fits in everything.',
    physics: {
      radius: 42,
      nodes: 32,
      density: 1.25,
      tension: 1500,
      equalize: 0.08,
      maxStretch: 2.2,
      pressure: 0.85,
      squish: 0.02,
      shape: 0.0015,
      viscosity: 12,
      friction: 0.5,
      upright: 0.03,
      hop: 220,
      slurp: 1,
      plasticity: 0.7,
      loafAspect: 1.45,
      hang: 0.55,
    },
    look: {
      body: '#E8964A',
      shade: '#CF7A33',
      light: '#F7E6CC',
      accent: '#C46E2B',
      innerEar: '#F4B48D',
      nose: '#D9706A',
      eye: '#3E3A4F',
      cheek: '#F2A27E',
      pattern: 'belly',
      fluff: 0.2,
      earSize: 0.8,
      earTufts: false,
      tailFluff: 0.35,
      persona: 'sleepy',
    },
    purr: { pitch: 0.75, rate: 0.8, rough: 0.7 },
    voice: { pitch: 0.65, length: 1.4 },
  },
  tabby: {
    id: 'tabby',
    name: 'Tabby',
    flow: 'pours like custard',
    flowShort: 'custard',
    blurb: 'Polite. Waits its turn, then settles in with a tidy little loaf.',
    physics: {
      radius: 29,
      nodes: 28,
      density: 1.0,
      tension: 700,
      equalize: 0.08,
      maxStretch: 2.3,
      pressure: 0.85,
      squish: 0.02,
      shape: 0,
      viscosity: 8,
      friction: 0.4,
      upright: 0.04,
      hop: 330,
      slurp: 1,
      plasticity: 0.9,
      loafAspect: 1.3,
      hang: 0.66,
    },
    look: {
      body: '#C9965F',
      shade: '#AE7B47',
      light: '#F3DFC2',
      accent: '#7E5634',
      innerEar: '#F0B79C',
      nose: '#C9746C',
      eye: '#3E3A4F',
      cheek: '#EFA48E',
      pattern: 'tabby',
      fluff: 0.3,
      earSize: 1,
      earTufts: false,
      tailFluff: 0.3,
      persona: 'polite',
    },
    purr: { pitch: 1.0, rate: 1.0, rough: 0.45 },
    voice: { pitch: 1.0, length: 0.9 },
  },
  mainecoon: {
    id: 'mainecoon',
    name: 'Maine Coon',
    flow: 'squishes like a cloud',
    flowShort: 'cloud',
    blurb: 'Enormous and fluffy, but mostly fluff. Squishes smaller than it looks.',
    physics: {
      radius: 37,
      nodes: 32,
      density: 0.6,
      tension: 700,
      equalize: 0.08,
      maxStretch: 2.3,
      pressure: 0.35,
      squish: 0.22,
      shape: 0,
      viscosity: 9,
      friction: 0.45,
      upright: 0.03,
      hop: 300,
      slurp: 1,
      plasticity: 0.8,
      loafAspect: 1.35,
      hang: 0.62,
    },
    look: {
      body: '#8A6F5C',
      shade: '#6E5545',
      light: '#E9D8C4',
      accent: '#5B4436',
      innerEar: '#E2AA97',
      nose: '#B8706A',
      eye: '#3E3A4F',
      cheek: '#D99A88',
      pattern: 'mane',
      fluff: 0.85,
      earSize: 1.1,
      earTufts: true,
      tailFluff: 0.9,
      persona: 'fluffy',
    },
    purr: { pitch: 0.85, rate: 0.85, rough: 0.6 },
    voice: { pitch: 0.8, length: 1.1 },
  },
  void: {
    id: 'void',
    name: 'The Void',
    flow: 'pours like ink',
    flowShort: 'ink',
    blurb: 'A small night that wandered in. Light as a shadow, fits in absolutely anything.',
    physics: {
      radius: 28,
      nodes: 28,
      density: 0.95,
      tension: 420,
      equalize: 0.08,
      maxStretch: 2.6,
      pressure: 0.9,
      squish: 0.02,
      shape: 0.0,
      viscosity: 5,
      friction: 0.3,
      upright: 0.03,
      hop: 360,
      slurp: 1.2,
      plasticity: 1.4,
      loafAspect: 1.3,
      hang: 0.64,
    },
    look: {
      body: '#3E3A4F',
      shade: '#2E2A3D',
      light: '#565070',
      accent: '#26232F',
      innerEar: '#6A5F86',
      nose: '#7C6E99',
      eye: '#F2D46B',
      cheek: '#5D5478',
      pattern: 'none',
      fluff: 0.15,
      earSize: 1,
      earTufts: false,
      tailFluff: 0.15,
      persona: 'void',
    },
    purr: { pitch: 0.95, rate: 1.0, rough: 0.4 },
    voice: { pitch: 1.1, length: 0.8 },
  },
  // your own cat: replaced by whatever you make in the cat maker (setMyCat)
  mine: designBreed(DEFAULT_DESIGN),
};

let myCatMade = false;
let myCatRev = 0;

/** Your cat, as you made it (null: not made yet, and 'mine' stays a stand-in). */
export function setMyCat(d: CatDesign | null): void {
  BREEDS.mine = designBreed(d ?? DEFAULT_DESIGN);
  myCatMade = !!d;
  myCatRev++;
}

/** The names you've given your cats (see the house): a cat without one goes by its kind. */
const given: Partial<Record<BreedId, string>> = {};

/** A cat's name: the one you've given it, or its kind ("Persian"; your own cat, the name you made it with). */
export function catName(b: BreedId): string {
  return given[b] ?? BREEDS[b].name;
}

/** The names you've given your cats (any not among them go by their kind again). */
export function nameCats(names: Partial<Record<BreedId, string>>): void {
  for (const k of Object.keys(given) as BreedId[]) delete given[k];
  Object.assign(given, names);
}

/** Has your cat been made? */
export function hasMyCat(): boolean {
  return myCatMade;
}

/** A key that changes whenever a breed's looks do (only yours ever change): for caches of its pictures. */
export function lookKey(b: BreedId): string {
  return b === 'mine' ? `mine${myCatRev}` : b;
}

export const BREED_ORDER: BreedId[] = ['kitten', 'persian', 'chonk', 'tabby', 'mainecoon', 'void'];
