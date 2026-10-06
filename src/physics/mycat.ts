// Your own cat, as made in the cat maker: a name, a coat, a pattern, eye
// colour, fur, size, a personality, and how squishy it is, from a firm loaf
// to a puddle. A design becomes a breed of its own ('mine', see breeds.ts),
// so the house and Cat Drop paint it and simulate it like any other cat.
// Pure data and numbers: no DOM, no storage.

import type { Breed, BreedLook, BreedPhysics, FacePersona, FurPattern } from './breeds';

export type CoatId = 'ginger' | 'cream' | 'caramel' | 'brown' | 'chocolate' | 'grey' | 'silver' | 'blue' | 'black' | 'white';
export type PatternId = 'plain' | 'stripes' | 'tuxedo' | 'patches' | 'points';
export type EyeId = 'ink' | 'gold' | 'green' | 'blue' | 'copper';
export type PersonalityId = 'playful' | 'easygoing' | 'sleepy' | 'dramatic' | 'mischievous';

export interface CatDesign {
  name: string;
  coat: CoatId;
  pattern: PatternId;
  eyes: EyeId;
  /** Short (0) to fluffy (1). */
  fur: number;
  /** Tiny (0) to chonky (1). */
  size: number;
  /** How squishy: a firm loaf (0) to a puddle (1). */
  squish: number;
  personality: PersonalityId;
}

/** A coat's colours (as a breed's look has them). */
interface Coat {
  name: string;
  body: string;
  shade: string;
  light: string;
  accent: string;
  innerEar: string;
  nose: string;
  cheek: string;
  /** Painted the way the Void is (light lines on a dark coat, eyes that glow). */
  dark?: boolean;
  /** Painted with softer lines (white and cream). */
  pale?: boolean;
}

export const COATS: Record<CoatId, Coat> = {
  ginger: { name: 'Ginger', body: '#E8964A', shade: '#CF7A33', light: '#F7E6CC', accent: '#C46E2B', innerEar: '#F4B48D', nose: '#D9706A', cheek: '#F2A27E' },
  cream: { name: 'Cream', body: '#F2E3C6', shade: '#DDC8A4', light: '#FFFBF2', accent: '#D9B98A', innerEar: '#F2B8B0', nose: '#E8A0A0', cheek: '#F3B4A8', pale: true },
  caramel: { name: 'Caramel', body: '#C9965F', shade: '#AE7B47', light: '#F3DFC2', accent: '#7E5634', innerEar: '#F0B79C', nose: '#C9746C', cheek: '#EFA48E' },
  brown: { name: 'Brown', body: '#9C7458', shade: '#7E5A42', light: '#E9D3BC', accent: '#4E3628', innerEar: '#E2A49A', nose: '#C9827E', cheek: '#D99A8E' },
  chocolate: { name: 'Chocolate', body: '#6E4B3A', shade: '#563828', light: '#D9BFA8', accent: '#3B261C', innerEar: '#D99A94', nose: '#B87470', cheek: '#C98C80' },
  grey: { name: 'Grey', body: '#A9AEB8', shade: '#8C909B', light: '#F4EEE6', accent: '#7D828D', innerEar: '#F2B8B5', nose: '#E58F95', cheek: '#F3A9A6' },
  silver: { name: 'Silver', body: '#C4C8D0', shade: '#A6ABB6', light: '#F6F6F8', accent: '#5E636E', innerEar: '#EBB2B4', nose: '#D98C92', cheek: '#EDB0B4' },
  blue: { name: 'Blue', body: '#8E99AE', shade: '#727D93', light: '#E3E7EE', accent: '#5F6A80', innerEar: '#D9AEBB', nose: '#9F8796', cheek: '#C2A9BD' },
  black: { name: 'Black', body: '#3E3A4F', shade: '#2E2A3D', light: '#565070', accent: '#26232F', innerEar: '#6A5F86', nose: '#7C6E99', cheek: '#5D5478', dark: true },
  white: { name: 'White', body: '#F6F1EA', shade: '#E2D7CA', light: '#FFFFFF', accent: '#D8CBBB', innerEar: '#F2B6AC', nose: '#E0959A', cheek: '#F3B4A8', pale: true },
};
export const COAT_ORDER: CoatId[] = ['ginger', 'cream', 'caramel', 'brown', 'chocolate', 'grey', 'silver', 'blue', 'black', 'white'];

export const PATTERNS: Record<PatternId, string> = { plain: 'Plain', stripes: 'Stripes', tuxedo: 'Tuxedo', patches: 'Patches', points: 'Points' };
export const PATTERN_ORDER: PatternId[] = ['plain', 'stripes', 'tuxedo', 'patches', 'points'];

/** Eye colours ('ink' is the little dark dots every house cat has; on a black coat, gold). */
export const EYES: Record<EyeId, { name: string; color: string }> = {
  ink: { name: 'Classic', color: '#3E3A4F' },
  gold: { name: 'Gold', color: '#F2C54E' },
  green: { name: 'Green', color: '#8FC86A' },
  blue: { name: 'Blue', color: '#7FB8E6' },
  copper: { name: 'Copper', color: '#E0904A' },
};
export const EYE_ORDER: EyeId[] = ['ink', 'gold', 'green', 'blue', 'copper'];

/** Each personality: its face, and how it gets on at home (see antics.ts). */
export const PERSONALITIES: Record<PersonalityId, { name: string; persona: FacePersona; play: number; touchy: number; lazy: number; toy: number }> = {
  playful: { name: 'Playful', persona: 'zippy', play: 0.85, touchy: 0.1, lazy: 0.1, toy: 0.55 },
  easygoing: { name: 'Easygoing', persona: 'polite', play: 0.5, touchy: 0.25, lazy: 0.3, toy: 0.5 },
  sleepy: { name: 'Sleepy', persona: 'sleepy', play: 0.15, touchy: 0.4, lazy: 0.8, toy: 0.4 },
  dramatic: { name: 'Dramatic', persona: 'dramatic', play: 0.25, touchy: 0.75, lazy: 0.45, toy: 0.7 },
  mischievous: { name: 'Mischievous', persona: 'void', play: 0.7, touchy: 0.55, lazy: 0.2, toy: 0.35 },
};
export const PERSONALITY_ORDER: PersonalityId[] = ['playful', 'easygoing', 'sleepy', 'dramatic', 'mischievous'];

/** Radius from size: a kitten's 22 up to nearly a chonk's 42. */
export const MIN_R = 22;
export const MAX_R = 40;

/** Names offered (none of the cats who already have a home here). */
export const NAME_IDEAS = [
  'Noodle', 'Pudding', 'Toffee', 'Pickle', 'Bean', 'Waffles', 'Olive', 'Tofu', 'Pumpkin', 'Muffin', 'Clementine', 'Dumpling',
  'Marmalade', 'Crumpet', 'Scone', 'Nutmeg', 'Miso', 'Pancake', 'Butter', 'Fig', 'Gnocchi', 'Bao', 'Sesame', 'Truffle', 'Kiwi',
  'Maple', 'Peanut', 'Sushi', 'Custard', 'Ginger', 'Pretzel', 'Honey', 'Tater', 'Bagel', 'Crouton', 'Sprout', 'Pebble', 'Mittens',
];
export const NAME_MAX = 14;

export const DEFAULT_DESIGN: CatDesign = {
  name: 'Toffee',
  coat: 'ginger',
  pattern: 'stripes',
  eyes: 'ink',
  fur: 0.3,
  size: 0.4,
  squish: 0.5,
  personality: 'playful',
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Through `mid` at t = 0.5. */
const lerp3 = (a: number, mid: number, b: number, t: number): number => (t < 0.5 ? lerp(a, mid, t * 2) : lerp(mid, b, t * 2 - 1));
const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5);

/** A name the page can show anywhere: letters, numbers, spaces, ' . and -, at most NAME_MAX long. */
export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} '.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim() : '';
  return s;
}

/** A design from storage, made safe (null if there isn't one). */
export function cleanDesign(raw: unknown): CatDesign | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<Record<keyof CatDesign, unknown>>;
  const pick = <T extends string>(v: unknown, order: T[], def: T): T => (order.includes(v as T) ? (v as T) : def);
  const num = (v: unknown, def: number): number => (typeof v === 'number' ? clamp01(v) : def);
  return {
    name: cleanName(d.name) || DEFAULT_DESIGN.name,
    coat: pick(d.coat, COAT_ORDER, DEFAULT_DESIGN.coat),
    pattern: pick(d.pattern, PATTERN_ORDER, DEFAULT_DESIGN.pattern),
    eyes: pick(d.eyes, EYE_ORDER, DEFAULT_DESIGN.eyes),
    fur: num(d.fur, DEFAULT_DESIGN.fur),
    size: num(d.size, DEFAULT_DESIGN.size),
    squish: num(d.squish, DEFAULT_DESIGN.squish),
    personality: pick(d.personality, PERSONALITY_ORDER, DEFAULT_DESIGN.personality),
  };
}

/** A cat made at random ("surprise me"), with a name not in `taken`. */
export function randomDesign(rand: () => number = Math.random, taken: string[] = []): CatDesign {
  const one = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length) % xs.length];
  const names = NAME_IDEAS.filter((n) => !taken.includes(n));
  return {
    name: one(names.length ? names : NAME_IDEAS),
    coat: one(COAT_ORDER),
    pattern: one(PATTERN_ORDER),
    eyes: one(EYE_ORDER),
    fur: Math.round(rand() * 20) / 20,
    size: Math.round(rand() * 20) / 20,
    squish: Math.round(rand() * 20) / 20,
    personality: one(PERSONALITY_ORDER),
  };
}

/** How squishy, in words: the maker's readout, and the cats card ("pours like ..."). */
export function squishWords(q: number): { short: string; flow: string } {
  if (q < 0.15) return { short: 'loaf', flow: 'firm as a loaf' };
  if (q < 0.35) return { short: 'jelly', flow: 'wobbles like jelly' };
  if (q < 0.6) return { short: 'custard', flow: 'pours like custard' };
  if (q < 0.85) return { short: 'honey', flow: 'pours like honey' };
  return { short: 'puddle', flow: 'pours like a puddle' };
}

/**
 * The physics of a design. Size sets how big (and so how heavy and how
 * high it hops); squish sets how it holds together: a loaf keeps its shape
 * (stiff skin, a little shape memory, short stretch, a tall hang from the
 * scruff), a puddle doesn't (slack skin, no memory, a long stretch and a
 * long droop, slow to take its shape back, wide when it settles). The middle
 * is the tabby's custard.
 */
export function designPhysics(d: CatDesign): BreedPhysics {
  const s = clamp01(d.size);
  const q = clamp01(d.squish);
  const r = lerp(MIN_R, MAX_R, s);
  return {
    radius: r,
    nodes: 24 + 2 * Math.round(4 * s),
    density: lerp(1, 1.2, s),
    // (a big puddle spread flat struggled through Cat Drop's gaps: a little firmer)
    tension: r * r * lerp3(1.12, 0.83, lerp(0.38, 0.5, s), q),
    equalize: 0.08,
    maxStretch: lerp(2.15, 2.6, q),
    pressure: 0.85,
    squish: 0.02,
    shape: q < 0.5 ? lerp(0.006, 0, q * 2) : 0,
    viscosity: lerp3(11, 8, 3.5, q),
    friction: 0.4,
    upright: 0.03,
    hop: lerp(430, 230, s) * lerp(1.06, 0.94, q),
    slurp: lerp(0.9, 1.2, q),
    plasticity: lerp(0.6, 1.4, q),
    loafAspect: lerp(1.2, 1.45, q),
    hang: lerp(0.74, 0.56, q),
  };
}

/** How a design is painted. */
export function designLook(d: CatDesign): BreedLook {
  const c = COATS[d.coat] ?? COATS.ginger;
  const fur = clamp01(d.fur);
  let pattern: FurPattern = 'plain';
  let { body, shade, light, accent } = c;
  let pale = !!c.pale;
  let dark = !!c.dark;
  switch (d.pattern) {
    case 'stripes':
      pattern = 'tabby';
      break;
    case 'tuxedo':
      pattern = 'tuxedo';
      // (a crisp white shirt front, whatever the coat)
      if (d.coat !== 'white') light = '#FBF7F0';
      break;
    case 'patches': {
      // a white cat with patches of the coat's colour (a black one's a little
      // cow; a white one's patches are grey, or they wouldn't show)
      const w = COATS.white;
      pattern = 'patchy';
      accent = d.coat === 'white' ? COATS.grey.body : c.body;
      body = w.body;
      shade = w.shade;
      light = w.light;
      pale = true;
      dark = false;
      break;
    }
    case 'points': {
      // pale all over, the coat's colour on the face, ears and paws (a Siamese)
      pattern = 'points';
      // (deep enough to show, even on a pale coat)
      accent = c.dark ? c.body : mixHex(c.shade, '#4A3328', c.pale ? 0.42 : 0.2);
      body = mixHex(c.light, c.body, c.dark ? 0.12 : 0.22);
      shade = mixHex(c.light, c.shade, 0.35);
      light = c.dark ? '#EDE8F2' : c.light;
      pale = true;
      dark = false;
      break;
    }
    default:
      // (a black cat keeps its velvet sheen)
      pattern = c.dark ? 'none' : 'plain';
  }
  const p = PERSONALITIES[d.personality] ?? PERSONALITIES.playful;
  // dark eyes don't show on a dark coat
  const eye = d.eyes === 'ink' && dark ? EYES.gold.color : (EYES[d.eyes] ?? EYES.ink).color;
  return {
    body,
    shade,
    light,
    accent,
    innerEar: c.innerEar,
    nose: d.pattern === 'patches' ? COATS.white.nose : c.nose,
    eye,
    cheek: d.pattern === 'patches' ? COATS.white.cheek : c.cheek,
    pattern,
    fluff: lerp(0.12, 1, fur),
    earSize: lerp(1.12, 0.92, clamp01(d.size)),
    earTufts: fur >= 0.8,
    tailFluff: lerp(0.12, 1, fur),
    persona: p.persona,
    dark,
    pale,
    bib: fur >= 0.6,
  };
}

/** The whole breed for a design. */
export function designBreed(d: CatDesign): Breed {
  const s = clamp01(d.size);
  const words = squishWords(clamp01(d.squish));
  return {
    id: 'mine',
    name: cleanName(d.name) || DEFAULT_DESIGN.name,
    flow: words.flow,
    flowShort: words.short,
    blurb: 'Your very own cat.',
    physics: designPhysics(d),
    look: designLook(d),
    purr: { pitch: lerp(1.35, 0.75, s), rate: lerp(1.25, 0.8, s), rough: lerp(0.35, 0.7, s) },
    voice: { pitch: lerp(1.5, 0.65, s), length: lerp(0.7, 1.4, s) },
  };
}

/** Two #rrggbb colours mixed (t of the way from a to b). */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (v: number, sh: number): number => (v >> sh) & 255;
  const m = (sh: number): number => Math.round(lerp(ch(pa, sh), ch(pb, sh), t));
  return `#${((1 << 24) | (m(16) << 16) | (m(8) << 8) | m(0)).toString(16).slice(1).toUpperCase()}`;
}
