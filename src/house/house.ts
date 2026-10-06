// The house: who lives here, who's on the way, and what brings each cat
// home; your own cat, as you made it; the treats you earn in the games and
// what you spend them on (the basement, the attic, the roof garden, perches
// you put wherever you like); and where everyone was. Two cats live here from
// the start, and yours once you've made it; the other four move in as you
// play, each waiting on something in one of the two games. Pure logic plus
// localStorage, no DOM (the home screen shows it).

import { setMyCat, type BreedId } from '../physics/breeds';
import { PERSONALITIES, cleanDesign, type CatDesign } from '../physics/mycat';
import type { RunReport } from '../proto/shell';
import { TEMPERS } from './antics';
import { LIVING_CEIL, LIVING_CUSHION_X, ROOF_DY, type ExtraFloor, type FloorId } from './layout';
import { PERCH_ORDER, floorTop, perchBox, perchPrice, type PerchKind, type PerchSave } from './perches';

export type GameId = 'jar' | 'drop';

/** How a Cat Jar or Cat Drop run went (or is going). */
export type HouseReport = RunReport;

export interface HouseStats {
  jarGames: number;
  /** Biggest cat made in Cat Jar: its tier (0 a kitten .. 5 the Void). */
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
  v: 6;
  /** Cats living here, in the order they moved in ('mine' is yours). */
  residents: BreedId[];
  /** Cats who've earned their place: they arrive the next time you're home. */
  arriving: BreedId[];
  /** The welcome card has been read. */
  welcomed: boolean;
  stats: HouseStats;
  /** Treats to spend, and every treat ever earned. */
  treats: number;
  earned: number;
  /** The floors opened up (the living room always is). */
  open: ExtraFloor[];
  /** Perches bought: where each one is, or in the cupboard. */
  perches: PerchSave[];
  nextPerch: number;
  /** Where each cat was last (its middle's x, and the y of its bottom). */
  where: Partial<Record<BreedId, { x: number; y: number }>>;
  /** The game run being paid for (treats come as it goes), and what it's had. */
  run: { id: string; paid: number } | null;
  /** The last day the cats left you a present (local date key). */
  gift: string;
  /** Cats hurt in a scrap: how many fish each needs to be well again, and how many it's had. */
  hurt: Partial<Record<BreedId, Hurt>>;
  /** Where the ball of yarn was left (its bottom). */
  toy: { x: number; y: number } | null;
  /** There's been a scrap (the first one comes with a word on fish making it better). */
  scraped: boolean;
  /** Your own cat, as made in the cat maker (null until it's made). */
  cat: CatDesign | null;
  /** The cat maker's been offered (on the first visit home, or the first since it came). */
  catAsked: boolean;
}

export interface Hurt {
  need: number;
  fed: number;
}

/** Everyone's name (yours is whatever you called it: see applyMyCat). */
export const NAMES: Record<BreedId, string> = {
  kitten: 'Pip',
  tabby: 'Mochi',
  persian: 'Duchess',
  mainecoon: 'Juniper',
  chonk: 'Biscuit',
  void: 'Inkwell',
  mine: 'Your cat',
};

/** Who a cat is, in a few words: "Pip the Kitten", or just your cat's name. */
export function whoIs(b: BreedId): string {
  return b === 'mine' ? NAMES.mine : `${NAMES[b]} the ${BREEDS_NAME[b]}`;
}
const BREEDS_NAME: Record<Exclude<BreedId, 'mine'>, string> = { kitten: 'Kitten', tabby: 'Tabby', persian: 'Persian', mainecoon: 'Maine Coon', chonk: 'Chonk', void: 'Void' };

/** Make your cat the one in the house's save: its breed, name and temperament. */
export function applyMyCat(h: Pick<HouseSave, 'cat'>): void {
  setMyCat(h.cat);
  NAMES.mine = h.cat?.name ?? 'Your cat';
  const p = PERSONALITIES[h.cat?.personality ?? 'playful'];
  TEMPERS.mine = { word: p.name.toLowerCase(), play: p.play, touchy: p.touchy, lazy: p.lazy, toy: p.toy };
}

/** Who lives here from the start. */
export const FIRST_RESIDENTS: BreedId[] = ['kitten', 'tabby'];

export interface MoveIn {
  breed: BreedId;
  /** The game it happens in. */
  game: GameId;
  /** What brings them home, for the cats card. */
  how: string;
  met(s: HouseStats): boolean;
}

/** Cat Jar's chain: a Persian is the third size (two tabbies snuggled up), a Maine Coon the fourth. */
const JAR_PERSIAN = 2;
const JAR_MAINECOON = 3;
/** Inkwell, a small night that wandered in, lives deep down in the dark. */
export const INKWELL_DEPTH = 750;

/**
 * The other four, two in each game, roughly in the order a new player meets
 * them: an early one and one that takes a little more (measured with bots: a
 * fair Cat Drop run eats 20 to 60 fish and falls 400 to 1,300 m).
 */
export const MOVE_INS: MoveIn[] = [
  { breed: 'persian', game: 'jar', how: 'Make a Persian in Cat Jar', met: (s) => s.jarBiggest >= JAR_PERSIAN },
  { breed: 'chonk', game: 'drop', how: 'Eat 25 fish in one Cat Drop', met: (s) => s.dropMostFish >= 25 },
  { breed: 'mainecoon', game: 'jar', how: 'Make a Maine Coon in Cat Jar', met: (s) => s.jarBiggest >= JAR_MAINECOON },
  { breed: 'void', game: 'drop', how: `Fall ${INKWELL_DEPTH} m in one Cat Drop`, met: (s) => s.dropDeepest >= INKWELL_DEPTH },
];

export const ALL_CATS: BreedId[] = [...FIRST_RESIDENTS, ...MOVE_INS.map((m) => m.breed)];

const KEY = 'cozy-house:v1';

export function emptyStats(): HouseStats {
  return { jarGames: 0, jarBiggest: 0, jarBest: 0, dropRuns: 0, dropDeepest: 0, dropMostFish: 0, dropBest: 0 };
}

/** Where the roof garden began in a house saved before the living room grew (world y). */
const OLD_ROOF_LINE = -85;
/** And before the attic went in under it: where it began, and where it was. */
const OLD_ATTIC_LINE = -645;
const OLD_ROOF_DY = -1303;
/** The cat step that used to be between the top step and the shelf under it. */
const OLD_MIDDLE_STEP = { x0: 200, x1: 296, y: 224 };

/** Treats in a new house: enough for a first shelf. */
export const START_TREATS = 20;
/** And for a house from before there were treats, a welcome-back bag. */
export const WELCOME_BACK = 40;

/** The bouncy cushion every house has in its living room (a perch, so it can be moved). */
function livingCushion(id: number): PerchSave {
  return { id, kind: 'bounce', x: LIVING_CUSHION_X, y: floorTop('bounce', 'living') };
}

export function emptyHouse(): HouseSave {
  return {
    v: 6,
    residents: [...FIRST_RESIDENTS],
    arriving: [],
    welcomed: false,
    stats: emptyStats(),
    treats: START_TREATS,
    earned: 0,
    open: [],
    perches: [livingCushion(1)],
    nextPerch: 2,
    where: {},
    run: null,
    gift: '',
    hurt: {},
    toy: null,
    scraped: false,
    cat: null,
    catAsked: false,
  };
}

/** Progress made before there was a house (the games' best scores). */
export interface Earlier {
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
      const d = JSON.parse(raw) as Partial<Omit<HouseSave, 'v'>> & { v?: number };
      const h: HouseSave = { ...emptyHouse(), ...d, v: 6, stats: { ...emptyStats(), ...(d.stats ?? {}) } };
      if ((d.v ?? 1) < 2) {
        // the first house's Cat Jar had a sphynx between the kitten and the
        // tabby; and there were no treats yet: a bag of them to start with
        h.stats.jarBiggest = Math.max(0, h.stats.jarBiggest - 1);
        h.treats = START_TREATS + WELCOME_BACK;
      }
      if ((d.v ?? 1) < 3) {
        // the living room grew to twice its height (its ceiling was at 0):
        // the roof garden went up with it, and its perches and cats too
        const up = (p: unknown): void => {
          if (p && typeof p === 'object' && Number.isFinite((p as { y: number }).y) && (p as { y: number }).y < OLD_ROOF_LINE) (p as { y: number }).y += LIVING_CEIL;
        };
        if (Array.isArray(h.perches)) h.perches.forEach(up);
        if (h.where && typeof h.where === 'object') Object.values(h.where).forEach(up);
      }
      if ((d.v ?? 1) < 5) {
        // the attic went in under the roof garden: up went the roof, and its perches and cats
        const up = (p: unknown): void => {
          if (p && typeof p === 'object' && Number.isFinite((p as { y: number }).y) && (p as { y: number }).y < OLD_ATTIC_LINE) (p as { y: number }).y += ROOF_DY - OLD_ROOF_DY;
        };
        if (Array.isArray(h.perches)) h.perches.forEach(up);
        if (h.where && typeof h.where === 'object') Object.values(h.where).forEach(up);
      }
      if ((d.v ?? 1) < 5 && Array.isArray(h.perches) && !h.perches.some((p) => p && p.kind === 'bounce')) {
        // a bouncy cushion came for the living room (in the cupboard if something's where it goes)
        const id = Math.max(Number(h.nextPerch) || 1, ...h.perches.map((p) => (p && Number.isFinite(p.id) ? p.id + 1 : 1)));
        const c = livingCushion(id);
        const b = perchBox('bounce', c.x, c.y);
        const taken = h.perches.some((p) => {
          if (!p || p.stored || !PERCH_ORDER.includes(p.kind)) return false;
          const q = perchBox(p.kind, p.x, p.y);
          return b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0;
        });
        if (taken) c.stored = true;
        h.perches.push(c);
        h.nextPerch = id + 1;
      }
      if ((d.v ?? 1) < 4 && h.where && typeof h.where === 'object') {
        // the middle cat step came down: whoever was on it goes back to their spot
        for (const b of Object.keys(h.where) as BreedId[]) {
          const w = h.where[b];
          if (w && Math.abs(w.y - OLD_MIDDLE_STEP.y) < 3 && w.x > OLD_MIDDLE_STEP.x0 && w.x < OLD_MIDDLE_STEP.x1) delete h.where[b];
        }
      }
      // (If It Fits went: what it counted goes with it)
      const st = h.stats as HouseStats & { fitsRooms?: unknown; fitsDone?: unknown };
      delete st.fitsRooms;
      delete st.fitsDone;
      h.cat = cleanDesign(d.cat);
      h.catAsked = d.catAsked === true;
      const known = (b: BreedId): boolean => ALL_CATS.includes(b) || (b === 'mine' && !!h.cat);
      h.residents = h.residents.filter(known);
      h.arriving = h.arriving.filter((b) => known(b) && !h.residents.includes(b));
      // (and the cats who moved in for it now come for something in the other games)
      settle(h);
      if (!Number.isFinite(h.treats) || h.treats < 0) h.treats = 0;
      h.open = (Array.isArray(h.open) ? h.open : []).filter((f) => f === 'basement' || f === 'attic' || f === 'roof');
      h.perches = (Array.isArray(h.perches) ? h.perches : []).filter((p) => p && PERCH_ORDER.includes(p.kind) && Number.isFinite(p.x) && Number.isFinite(p.y));
      h.nextPerch = Math.max(h.nextPerch || 1, ...h.perches.map((p) => p.id + 1));
      if (!h.where || typeof h.where !== 'object') h.where = {};
      const hurt: HouseSave['hurt'] = {};
      for (const b of h.residents) {
        const v = (h.hurt as Record<string, Hurt | undefined> | null)?.[b];
        if (v && Number.isFinite(v.need) && Number.isFinite(v.fed) && v.fed < v.need) hurt[b] = { need: Math.min(20, Math.max(1, Math.round(v.need))), fed: Math.max(0, Math.round(v.fed)) };
      }
      h.hurt = hurt;
      if (!h.toy || !Number.isFinite(h.toy.x) || !Number.isFinite(h.toy.y)) h.toy = null;
      return h;
    }
  } catch {
    // storage blocked or garbled: a new house
  }
  const h = emptyHouse();
  if (earlier) {
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
  if (r.game === 'jar') {
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

// ---------------------------------------------------------------------------
// Treats

/**
 * Cat Jar points per treat; Cat Drop: a treat for every two fish and every
 * fifty metres down. (Each game pays about the same for the time it takes,
 * ten or fifteen treats a minute: a whole jar, about 30, more for a good one;
 * a Cat Drop run, 20 to 60.)
 */
export const JAR_POINTS_PER_TREAT = 150;
export const DROP_FISH_PER_TREAT = 2;
export const DROP_METRES_PER_TREAT = 50;

/** Treats a Cat Jar or Cat Drop run has earned so far (they're paid as it goes). */
export function runTreats(r: RunReport): number {
  return r.game === 'jar' ? Math.floor(r.score / JAR_POINTS_PER_TREAT) : Math.floor(r.fish / DROP_FISH_PER_TREAT) + Math.floor(r.depth / DROP_METRES_PER_TREAT);
}

/**
 * Pay the treats a report has earned (a run's reports come as it goes: each
 * pays what the run has earned since the last one). Returns how many.
 */
export function payTreats(h: HouseSave, r: HouseReport): number {
  const total = runTreats(r);
  const id = r.run ?? '';
  const paid = h.run && h.run.id === id ? h.run.paid : 0;
  const add = Math.max(0, total - paid);
  h.run = { id, paid: Math.max(paid, total) };
  h.treats += add;
  h.earned += add;
  return add;
}

/** Spend treats (false if there aren't enough). */
export function spend(h: HouseSave, n: number): boolean {
  if (h.treats < n) return false;
  h.treats -= n;
  return true;
}

/** What it costs to open up a floor. */
export const FLOOR_PRICES: Record<ExtraFloor, number> = { basement: 80, attic: 110, roof: 150 };

export function isOpen(h: HouseSave, f: FloorId): boolean {
  return f === 'living' || h.open.includes(f);
}

export function openFloors(h: HouseSave): FloorId[] {
  return (['roof', 'attic', 'living', 'basement'] as FloorId[]).filter((f) => isOpen(h, f));
}

/** Open a floor up (false if it's open already or there aren't enough treats). */
export function buyFloor(h: HouseSave, f: ExtraFloor): boolean {
  if (h.open.includes(f) || !spend(h, FLOOR_PRICES[f])) return false;
  h.open.push(f);
  return true;
}

export function ownedOf(h: HouseSave, kind: PerchKind): number {
  return h.perches.filter((p) => p.kind === kind).length;
}

/** Perches every house comes with, which don't put the price of the next one up. */
const GIVEN: Partial<Record<PerchKind, number>> = { bounce: 1 };

export function priceOf(h: HouseSave, kind: PerchKind): number {
  return perchPrice(kind, Math.max(0, ownedOf(h, kind) - (GIVEN[kind] ?? 0)));
}

/** Buy a perch: it goes in the cupboard until it's put somewhere (null if there aren't enough treats). */
export function buyPerch(h: HouseSave, kind: PerchKind): PerchSave | null {
  if (!spend(h, priceOf(h, kind))) return null;
  const p: PerchSave = { id: h.nextPerch++, kind, x: 0, y: 0, stored: true };
  h.perches.push(p);
  return p;
}

/** Put a perch somewhere (its top at x, y). */
export function placePerch(h: HouseSave, id: number, x: number, y: number): void {
  const p = h.perches.find((q) => q.id === id);
  if (!p) return;
  p.x = Math.round(x * 10) / 10;
  p.y = Math.round(y * 10) / 10;
  delete p.stored;
}

/** Back in the cupboard. */
export function storePerch(h: HouseSave, id: number): void {
  const p = h.perches.find((q) => q.id === id);
  if (p) p.stored = true;
}

/** Perches out in the house. */
export function placedPerches(h: HouseSave): PerchSave[] {
  return h.perches.filter((p) => !p.stored);
}

/** The cats leave you a little present the first time you're home each day. */
export const GIFT_TREATS = 10;

export function giftDue(h: HouseSave, today: string): boolean {
  return h.welcomed && h.gift !== today;
}

export function takeGift(h: HouseSave, today: string): number {
  if (h.gift === today) return 0;
  h.gift = today;
  h.treats += GIFT_TREATS;
  h.earned += GIFT_TREATS;
  return GIFT_TREATS;
}

/** Fish a cat needs after a scrap, at the least and the most. */
export const HURT_FISH: [number, number] = [5, 9];

/** A scrap left a cat hurt: it needs `need` fish to be well again (a few more if it was hurt already). */
export function hurtCat(h: HouseSave, b: BreedId, need: number): void {
  const cur = h.hurt[b];
  h.hurt[b] = cur ? { need: Math.min(20, cur.need + Math.ceil(need / 2)), fed: cur.fed } : { need, fed: 0 };
}

/**
 * Feed a hurt cat one fish (a treat): 'fed' (it's a little better), 'healed'
 * (all better), 'empty' (no treats to give it) or 'well' (it isn't hurt).
 */
export function feedFish(h: HouseSave, b: BreedId): 'fed' | 'healed' | 'empty' | 'well' {
  const cur = h.hurt[b];
  if (!cur) return 'well';
  if (h.treats < 1) return 'empty';
  h.treats--;
  cur.fed++;
  if (cur.fed < cur.need) return 'fed';
  delete h.hurt[b];
  return 'healed';
}
