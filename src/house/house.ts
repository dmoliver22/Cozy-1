// The house: who lives in the home room, who's on the way, and what brings
// each cat home. Two cats live here from the start; the other five move in
// as you play, each waiting on something in one of the three games. Pure
// logic plus localStorage, no DOM (the home screen shows it).

import type { BreedId } from '../physics/breeds';
import type { RunReport } from '../proto/shell';

export type GameId = 'fits' | 'jar' | 'drop';

/** A finished If It Fits room (its id), or a Cat Jar or Cat Drop run. */
export type HouseReport = { game: 'fits'; room: string } | RunReport;

export interface HouseStats {
  /** If It Fits rooms finished (every finish counts). */
  fitsRooms: number;
  /** Which rooms (ids), each once. */
  fitsDone: string[];
  jarGames: number;
  /** Biggest cat made in Cat Jar: its tier (0 a kitten .. 6 the Void). */
  jarBiggest: number;
  jarBest: number;
  dropRuns: number;
  /** Deepest Cat Drop run, in metres. */
  dropDeepest: number;
  /** Most fish eaten in one Cat Drop run. */
  dropMostFish: number;
  dropBest: number;
}

export interface HouseSave {
  v: 1;
  /** Cats living here, in the order they moved in. */
  residents: BreedId[];
  /** Cats who've earned their place: they arrive the next time you're home. */
  arriving: BreedId[];
  /** The welcome card has been read. */
  welcomed: boolean;
  stats: HouseStats;
}

/** Everyone's name (the same cats as in the If It Fits rooms). */
export const NAMES: Record<BreedId, string> = {
  kitten: 'Pip',
  tabby: 'Mochi',
  persian: 'Duchess',
  sphynx: 'Noodle',
  mainecoon: 'Juniper',
  chonk: 'Biscuit',
  void: 'Inkwell',
};

/** Who lives here from the start. */
export const FIRST_RESIDENTS: BreedId[] = ['kitten', 'tabby'];

export interface MoveIn {
  breed: BreedId;
  /** The game it happens in (and the room, for one in a particular If It Fits room). */
  game: GameId;
  room?: string;
  /** What brings them home, for the cats card. */
  how: string;
  met(s: HouseStats): boolean;
}

/** Cat Jar's chain: a Maine Coon is the fifth size (two Persians snuggled up). */
const JAR_MAINECOON = 4;
/** Inkwell lives in the third If It Fits room, and follows you home from it. */
export const INKWELL_ROOM = 'midnight-study';

/**
 * The other five, roughly in the order a new player meets them: one early
 * one in each game, then two that take a little more (measured with bots:
 * a fair Cat Drop run eats 20 to 60 fish; Cat Jar makes Maine Coons within
 * its first twenty drops, and even the Void within forty, so the last cat
 * comes from If It Fits).
 */
export const MOVE_INS: MoveIn[] = [
  { breed: 'persian', game: 'fits', how: 'Finish a room in If It Fits', met: (s) => s.fitsRooms >= 1 },
  { breed: 'mainecoon', game: 'jar', how: 'Make a Maine Coon in Cat Jar', met: (s) => s.jarBiggest >= JAR_MAINECOON },
  { breed: 'sphynx', game: 'drop', how: 'Drop 100 m down the house in Cat Drop', met: (s) => s.dropDeepest >= 100 },
  { breed: 'chonk', game: 'drop', how: 'Eat 25 fish in one Cat Drop', met: (s) => s.dropMostFish >= 25 },
  { breed: 'void', game: 'fits', room: INKWELL_ROOM, how: 'Finish the Midnight Study in If It Fits', met: (s) => s.fitsDone.includes(INKWELL_ROOM) },
];

export const ALL_CATS: BreedId[] = [...FIRST_RESIDENTS, ...MOVE_INS.map((m) => m.breed)];

const KEY = 'cozy-house:v1';

export function emptyStats(): HouseStats {
  return { fitsRooms: 0, fitsDone: [], jarGames: 0, jarBiggest: 0, jarBest: 0, dropRuns: 0, dropDeepest: 0, dropMostFish: 0, dropBest: 0 };
}

export function emptyHouse(): HouseSave {
  return { v: 1, residents: [...FIRST_RESIDENTS], arriving: [], welcomed: false, stats: emptyStats() };
}

/** Progress made before there was a house (If It Fits rooms, the games' best scores). */
export interface Earlier {
  fitsRooms: number;
  /** Hand-made rooms finished (ids). */
  fitsDone: string[];
  jarBest: number;
  dropBest: number;
}

/**
 * The house as saved, or a new one. A new house counts progress made before
 * it existed, so a cat already earned is on the way.
 */
export function loadHouse(earlier?: Earlier): HouseSave {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<HouseSave>;
      const h = { ...emptyHouse(), ...d, stats: { ...emptyStats(), ...(d.stats ?? {}) } };
      if (!Array.isArray(h.stats.fitsDone)) h.stats.fitsDone = [];
      h.residents = h.residents.filter((b) => ALL_CATS.includes(b));
      h.arriving = h.arriving.filter((b) => ALL_CATS.includes(b) && !h.residents.includes(b));
      return h;
    }
  } catch {
    // storage blocked or garbled: a new house
  }
  const h = emptyHouse();
  if (earlier) {
    h.stats.fitsRooms = earlier.fitsRooms;
    h.stats.fitsDone = [...earlier.fitsDone];
    h.stats.jarBest = earlier.jarBest;
    h.stats.dropBest = earlier.dropBest;
    settle(h);
  }
  return h;
}

export function writeHouse(h: HouseSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    // private mode: the house just won't be remembered
  }
}

/** Cats whose milestone is met but who aren't here or on the way yet: put them on the way. */
export function settle(h: HouseSave): BreedId[] {
  const fresh: BreedId[] = [];
  for (const m of MOVE_INS) {
    if (h.residents.includes(m.breed) || h.arriving.includes(m.breed)) continue;
    if (m.met(h.stats)) {
      h.arriving.push(m.breed);
      fresh.push(m.breed);
    }
  }
  return fresh;
}

/** Fold a report into the stats. Returns the cats it just earned (now on their way). */
export function recordRun(h: HouseSave, r: HouseReport): BreedId[] {
  const s = h.stats;
  if (r.game === 'fits') {
    s.fitsRooms++;
    if (!s.fitsDone.includes(r.room)) s.fitsDone.push(r.room);
  }
  else if (r.game === 'jar') {
    if (r.over) s.jarGames++;
    s.jarBiggest = Math.max(s.jarBiggest, r.biggest);
    if (!r.daily) s.jarBest = Math.max(s.jarBest, r.score);
  } else {
    if (r.over) s.dropRuns++;
    s.dropDeepest = Math.max(s.dropDeepest, r.depth);
    s.dropMostFish = Math.max(s.dropMostFish, r.fish);
    if (!r.daily) s.dropBest = Math.max(s.dropBest, r.score);
  }
  return settle(h);
}

/** The next cat on the way moves in (null when nobody's coming). */
export function arrive(h: HouseSave): BreedId | null {
  const b = h.arriving.shift() ?? null;
  if (b && !h.residents.includes(b)) h.residents.push(b);
  return b;
}

/** The milestone for a cat (null for the first two). */
export function moveInFor(breed: BreedId): MoveIn | null {
  return MOVE_INS.find((m) => m.breed === breed) ?? null;
}

/** The next cat still to earn in a game (or in any game), in MOVE_INS order. */
export function nextMoveIn(h: HouseSave, game?: GameId): MoveIn | null {
  for (const m of MOVE_INS) {
    if (game && m.game !== game) continue;
    if (h.residents.includes(m.breed) || h.arriving.includes(m.breed)) continue;
    return m;
  }
  return null;
}
