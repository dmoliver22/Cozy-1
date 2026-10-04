// Daily rooms. A room is composed from "vignettes": small, physically tested
// arrangements (a shelf over a cup, a counter beside a stool, a cabinet beside
// a box, a sill over a boot, a perch between two pots...). Everything is drawn
// from the shared prop library with a seeded RNG, so every device builds the
// same room for the same morning. The solver then plays it; if any cat can't
// be seated the room is thrown away and the next variant is tried.

import { BASE_BREEDS, BREEDS, CAT_NAMES, breedArea, type BreedId } from '../physics/breeds';
import { Rng } from '../util/rng';
import { weekdayOf } from '../util/date';
import { CONTAINERS, FLOOR_Y, WORLD_W, type ContainerPlacement, type ContainerType, type FurniturePlacement } from './props';
import type { CatPlacement, DecorPlacement, RoomDef, ThemeId } from './room';
import { solveRoom } from './solver';

/** Bump whenever the generator or the physics changes what a morning solves to. */
export const GENERATOR_VERSION = 9;

interface Span {
  x0: number;
  x1: number;
}

interface Vignette {
  width: number;
  furniture: FurniturePlacement[];
  containers: ContainerPlacement[];
  cats: Omit<CatPlacement, 'name'>[];
  decor: DecorPlacement[];
  /** Free spans of floor inside the vignette (for plants etc.). */
  floorFree: Span[];
  /** Wall spans above the furniture that are free for pictures. */
  wallFree: Array<{ x0: number; x1: number; y0: number; y1: number }>;
  hasWindow: boolean;
}

interface Builder {
  (rng: Rng, slot: { breeds: BreedId[]; containerPool: ContainerType[] }): Vignette | null;
}

const ALL_CONTAINERS = Object.keys(CONTAINERS) as ContainerType[];

/** Visual/physical extents of a container (unscaled, unflipped). */
function cExt(type: ContainerType, scale = 1): { left: number; right: number; height: number; openW: number } {
  const spec = CONTAINERS[type];
  const [bx0, by0, bx1] = spec.bounds;
  return { left: -bx0 * scale, right: bx1 * scale, height: -by0 * scale, openW: (spec.opening[1] - spec.opening[0]) * scale };
}

/** Extents accounting for a mirrored container. */
function cExtF(type: ContainerType, scale: number, flip: boolean): { left: number; right: number; height: number; openW: number } {
  const e = cExt(type, scale);
  return flip ? { ...e, left: e.right, right: e.left } : e;
}

/** Width of a cat sitting as a loaf. */
export function loafWidth(b: BreedId): number {
  const p = BREEDS[b].physics;
  return 2 * p.radius * Math.sqrt(p.loafAspect) * 1.08 + 6;
}

/** Pick a container that suits a cat (snug-ish) and fits the size limits. */
function pickContainer(rng: Rng, pool: ContainerType[], breed: BreedId, maxH: number, maxW: number, avoidNarrow: boolean): { type: ContainerType; scale: number } | null {
  const area = breedArea(breed);
  const options: Array<{ type: ContainerType; scale: number; w: number }> = [];
  for (const type of pool) {
    for (const scale of [0.85, 0.92, 1, 1.08]) {
      const e = cExt(type, scale);
      if (e.height > maxH || e.left + e.right > maxW) continue;
      const spec = CONTAINERS[type];
      if (avoidNarrow && e.openW < BREEDS[breed].physics.radius * 1.3) continue;
      if (type === 'sink' && scale !== 1) continue;
      const cap = capacityOf(type) * scale * scale;
      const ratio = area / cap;
      // Prefer containers the cat will fill (ratio ~1.1 - 2.2); allow others rarely.
      let w = ratio >= 1.0 && ratio <= 2.4 ? 3 : ratio >= 0.75 && ratio < 1.0 ? 1.4 : 0.35;
      if (spec.name === 'sink' || type === 'basket') w *= 0.7;
      options.push({ type, scale, w });
    }
  }
  if (!options.length) return null;
  const o = rng.weighted(
    options,
    options.map((x) => x.w),
  );
  return { type: o.type, scale: o.scale };
}

const capCache = new Map<ContainerType, number>();
function capacityOf(type: ContainerType): number {
  let c = capCache.get(type);
  if (c === undefined) {
    const pts = CONTAINERS[type].interior;
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    c = Math.abs(a / 2);
    capCache.set(type, c);
  }
  return c;
}

const round = (v: number): number => Math.round(v);

// ---------------------------------------------------------------------------
// Vignettes (built with the perch on the LEFT; the composer mirrors them)

/** A wall shelf with a cat; a container on the floor tucked under its end. */
const dropShelf: Builder = (rng, slot) => {
  const breed = slot.breeds[0];
  const lw = loafWidth(breed);
  const sl = round(Math.max(lw + rng.range(10, 20), 72));
  const ys = round(rng.range(215, 300));
  const pick = pickContainer(rng, slot.containerPool, breed, FLOOR_Y - ys - 95, 150, false);
  if (!pick) return null;
  const flip = rng.chance(0.5);
  const e = cExtF(pick.type, pick.scale, flip);
  // Opening's near edge sits a little under the shelf's end.
  const cx = sl + e.openW * rng.range(-0.15, 0.2);
  const width = Math.max(sl + 4, cx + e.right) + 4;
  return {
    width,
    furniture: [{ type: 'shelf', x0: 0, x1: sl, y: ys }],
    containers: [{ type: pick.type, x: cx, y: FLOOR_Y, scale: pick.scale, flip }],
    cats: [{ breed, x: round(Math.max(lw / 2 + 4, sl * 0.42)), y: ys }],
    decor: [],
    floorFree: [{ x0: 0, x1: Math.max(0, cx - e.left - 6) }],
    wallFree: [{ x0: 0, x1: sl, y0: 40, y1: ys - 70 }],
    hasWindow: false,
  };
};

/** The hero: a counter with a cat, a stool beside it with a small container. */
const counterStool: Builder = (rng, slot) => {
  const breed = slot.breeds[0];
  const lw = loafWidth(breed);
  const cw = round(Math.max(lw + rng.range(10, 18), 88));
  const yc = round(rng.range(340, 385));
  const gap = round(rng.range(8, 13));
  const sw = round(rng.range(54, 60));
  const ys = round(Math.min(482, yc + rng.range(100, 122)));
  const pick = pickContainer(rng, slot.containerPool, breed, ys - yc - 20, 104, false);
  if (!pick) return null;
  const flip = rng.chance(0.4);
  const e = cExtF(pick.type, pick.scale, flip);
  const sx0 = cw + 6 + gap;
  const cx = Math.max(sx0 + sw / 2, cw + 8 + e.left);
  const width = Math.max(sx0 + sw, cx + e.right) + 6;
  return {
    width,
    furniture: [
      { type: 'counter', x0: 0, x1: cw, y: yc },
      { type: 'stool', x0: sx0, x1: sx0 + sw, y: ys },
    ],
    containers: [{ type: pick.type, x: cx, y: ys, scale: pick.scale, flip }],
    cats: [{ breed, x: round(Math.max(lw / 2 + 2, cw * 0.46)), y: yc }],
    decor: [{ type: 'backsplash', x: 0, y: yc - 86, w: cw, h: 86 }],
    floorFree: [],
    wallFree: [{ x0: 0, x1: cw, y0: 40, y1: yc - 110 }],
    hasWindow: false,
  };
};

/** A cabinet / crate / bookcase / fridge top with a cat; a container on the floor beside it. */
const cabinetFloor: Builder = (rng, slot) => {
  const breed = slot.breeds[0];
  const lw = loafWidth(breed);
  const kind = rng.weighted(['cabinet', 'crate', 'bookcase', 'fridge'] as const, [3, 2, 2, 1.5]);
  const fw = round(Math.max(lw + rng.range(8, 16), kind === 'fridge' ? 80 : 70));
  const yf = round(kind === 'fridge' ? rng.range(250, 300) : kind === 'bookcase' ? rng.range(290, 360) : kind === 'crate' ? rng.range(430, 470) : rng.range(380, 440));
  const pick = pickContainer(rng, slot.containerPool, breed, FLOOR_Y - yf - 24, 132, false);
  if (!pick) return null;
  const flip = rng.chance(0.5);
  const e = cExtF(pick.type, pick.scale, flip);
  const cx = fw + 5 + e.left + rng.range(0, 5);
  const width = cx + e.right + 4;
  return {
    width,
    furniture: [{ type: kind, x0: 0, x1: fw, y: yf }],
    containers: [{ type: pick.type, x: cx, y: FLOOR_Y, scale: pick.scale, flip }],
    cats: [{ breed, x: round(fw / 2), y: yf }],
    decor: [],
    floorFree: [],
    wallFree: [{ x0: fw + 4, x1: width, y0: 60, y1: FLOOR_Y - e.height - 60 }],
    hasWindow: false,
  };
};

/** A window with a sill and a light cat on it; a container on the floor below the sill's end. */
const sillFloor: Builder = (rng, slot) => {
  const breed = slot.breeds[0];
  const lw = loafWidth(breed);
  const sl = round(Math.max(lw + rng.range(18, 30), 86));
  const ys = round(rng.range(205, 232));
  const pick = pickContainer(rng, slot.containerPool, breed, FLOOR_Y - ys - 110, 140, false);
  if (!pick) return null;
  const flip = rng.chance(0.5);
  const e = cExtF(pick.type, pick.scale, flip);
  const cx = sl + e.openW * rng.range(-0.1, 0.25);
  const width = Math.max(sl + 6, cx + e.right) + 4;
  const ww = sl - 18;
  return {
    width,
    furniture: [{ type: 'sill', x0: 0, x1: sl, y: ys }],
    containers: [{ type: pick.type, x: cx, y: FLOOR_Y, scale: pick.scale, flip }],
    cats: [{ breed, x: round(sl * 0.42), y: ys }],
    decor: [{ type: 'window', x: sl / 2, y: ys - 146, w: ww, h: 132, variant: rng.int(0, 3) }],
    floorFree: [{ x0: 0, x1: Math.max(0, cx - e.left - 6) }],
    wallFree: [],
    hasWindow: true,
  };
};

/** A table with a container under a high shelf (the Persian's perch). */
const shelfTable: Builder = (rng, slot) => {
  const breed = slot.breeds[0];
  const lw = loafWidth(breed);
  const sl = round(Math.max(lw + rng.range(14, 24), 86));
  const ys = round(rng.range(200, 260));
  const yt = round(rng.range(410, 450));
  const pick = pickContainer(rng, slot.containerPool, breed, yt - ys - 95, 128, false);
  if (!pick) return null;
  const flip = rng.chance(0.5);
  const e = cExtF(pick.type, pick.scale, flip);
  const cx = sl + e.openW * rng.range(-0.05, 0.25);
  const tx0 = Math.max(0, cx - 40);
  const tx1 = cx + Math.max(40, e.right * 0.6);
  const width = Math.max(sl, tx1, cx + e.right) + 6;
  return {
    width,
    furniture: [
      { type: 'shelf', x0: 0, x1: sl, y: ys },
      { type: 'table', x0: round(tx0), x1: round(tx1), y: yt },
    ],
    containers: [{ type: pick.type, x: cx, y: yt, scale: pick.scale, flip }],
    cats: [{ breed, x: round(Math.max(lw / 2 + 4, sl * 0.42)), y: ys }],
    decor: [],
    floorFree: [],
    wallFree: [{ x0: 0, x1: sl, y0: 40, y1: ys - 70 }],
    hasWindow: false,
  };
};

export const BUILDERS: Array<{ name: string; build: Builder; weight: number; maxR: number }> = [
  { name: 'dropShelf', build: dropShelf, weight: 3, maxR: 38 },
  { name: 'counterStool', build: counterStool, weight: 2.4, maxR: 44 },
  { name: 'cabinetFloor', build: cabinetFloor, weight: 2.4, maxR: 44 },
  { name: 'sillFloor', build: sillFloor, weight: 1.6, maxR: 30 },
  { name: 'shelfTable', build: shelfTable, weight: 1.6, maxR: 38 },
];

// ---------------------------------------------------------------------------

const THEMES: Array<Exclude<ThemeId, 'studio'>> = ['kitchen', 'bathroom', 'living', 'laundry', 'study', 'sunroom', 'pantry', 'bedroom'];
const ADJ: Record<Exclude<ThemeId, 'studio'>, string[]> = {
  kitchen: ['Sunny', 'Buttery', 'Toasty', 'Breakfast', 'Cinnamon'],
  bathroom: ['Steamy', 'Bubbly', 'Minty', 'Splashy', 'Fluffy-Towel'],
  living: ['Cozy', 'Sleepy', 'Sunday', 'Velvet', 'Teatime'],
  laundry: ['Warm-Laundry', 'Fresh', 'Sock-Drawer', 'Tumble', 'Linen'],
  study: ['Quiet', 'Inky', 'Bookish', 'Lamp-Lit', 'Paperback'],
  sunroom: ['Golden', 'Leafy', 'Afternoon', 'Honey', 'Greenhouse'],
  pantry: ['Pantry', 'Jam-Jar', 'Biscuit-Tin', 'Spice', 'Larder'],
  bedroom: ['Snoozy', 'Pillowy', 'Dreamy', 'Duvet', 'Lavender'],
};
const NOUN: Record<Exclude<ThemeId, 'studio'>, string[]> = {
  kitchen: ['Kitchen', 'Breakfast Nook', 'Countertop'],
  bathroom: ['Bathroom', 'Washroom', 'Tub Corner'],
  living: ['Living Room', 'Parlour', 'Den'],
  laundry: ['Laundry', 'Utility Room', 'Airing Cupboard'],
  study: ['Study', 'Reading Nook', 'Library'],
  sunroom: ['Sunroom', 'Conservatory', 'Porch'],
  pantry: ['Pantry', 'Larder', 'Scullery'],
  bedroom: ['Bedroom', 'Attic', 'Guest Room'],
};
const THEME_CONTAINERS: Record<Exclude<ThemeId, 'studio'>, ContainerType[]> = {
  kitchen: ['teacup', 'mug', 'fruitbowl', 'saucepan', 'mixingbowl', 'box', 'boot'],
  bathroom: ['sink', 'bucket', 'basket', 'slipper', 'mug', 'teacup', 'box'],
  living: ['box', 'shoebox', 'vase', 'pot', 'slipper', 'teacup', 'fruitbowl', 'basket'],
  laundry: ['basket', 'bucket', 'boot', 'slipper', 'box', 'shoebox', 'sink'],
  study: ['shoebox', 'box', 'mug', 'teacup', 'vase', 'pot'],
  sunroom: ['pot', 'vase', 'bucket', 'basket', 'teacup', 'boot', 'fruitbowl'],
  pantry: ['mixingbowl', 'saucepan', 'box', 'fruitbowl', 'bucket', 'mug', 'teacup'],
  bedroom: ['slipper', 'shoebox', 'box', 'basket', 'teacup', 'vase', 'boot'],
};

export interface DailyOptions {
  /** Max solver attempts before falling back. */
  attempts?: number;
  /** Is the secret cat unlocked/allowed? (It visits on rare mornings anyway.) */
  allowSecret?: boolean;
}

/** Build (but don't verify) a candidate room for a seed. */
export function composeRoom(seed: string, dateKey: string, variant: number): RoomDef | null {
  const rng = new Rng(`${seed}#${variant}`);
  const weekday = weekdayOf(dateKey);
  const theme = rng.pick(THEMES);
  // Gentle Mondays, busier weekends.
  const want = rng.chance([0.35, 0.15, 0.3, 0.25, 0.2, 0.1, 0.1][weekday]) ? 2 : 3;
  const pool = THEME_CONTAINERS[theme].filter((t) => ALL_CONTAINERS.includes(t));
  // Today's cats (fixed up front so big cats aren't quietly swapped for small ones).
  const chosen = rng.shuffle([...BASE_BREEDS]).slice(0, 3);
  // On rare mornings the Void wanders in.
  if (rng.chance(0.08)) chosen[rng.int(0, 2)] = 'void';
  // Three big cats rarely fit side by side; the zippy kitten can be carried
  // from a high shelf, so it often joins three-cat mornings.
  if (want === 3 && !chosen.includes('kitten') && rng.chance(0.6)) chosen[2] = 'kitten';
  // A kitten in a three-cat room is carried, so lay out the other two first.
  if (want === 3 && chosen.includes('kitten')) {
    chosen.splice(chosen.indexOf('kitten'), 1);
    chosen.push('kitten');
  }
  let vigs: Array<{ v: Vignette; mirror: boolean }> = [];
  let breeds: BreedId[] = [];
  let windowCount = 0;
  let usedWidth = 0;
  // Three cats if they fit side by side, otherwise two (plus a spare container).
  for (let nCats = want; nCats >= 2 && !vigs.length; nCats--) {
    for (let tries = 0; tries < 8 && !vigs.length; tries++) {
      breeds = chosen.slice(0, nCats);
      const out: Array<{ v: Vignette; mirror: boolean }> = [];
      let used = 0;
      let windows = 0;
      for (let i = 0; i < breeds.length; i++) {
        const b = breeds[i];
        const r = BREEDS[b].physics.radius;
        const options = BUILDERS.filter((x) => r <= x.maxR && !(x.name === 'sillFloor' && windows > 0));
        let built: Vignette | null = null;
        for (let t = 0; t < 5 && !built; t++) {
          const opt = rng.weighted(
            options,
            options.map((o) => o.weight),
          );
          const v = opt.build(rng, { breeds: [b], containerPool: pool });
          if (v && used + v.width <= WORLD_W) built = v;
        }
        if (!built) break;
        if (built.hasWindow) windows++;
        used += built.width;
        out.push({ v: built, mirror: i === breeds.length - 1 ? true : i === 0 ? false : rng.chance(0.5) });
      }
      if (out.length === breeds.length) {
        vigs = out;
        windowCount = windows;
        usedWidth = used;
      }
    }
  }
  if (!vigs.length) return null;
  // First vignette hugs the left wall, the last hugs the right wall, and the
  // leftover space is shared out between them.
  const slack = WORLD_W - usedWidth;
  const between = vigs.length > 1 ? slack / (vigs.length - 1) : 0;
  const furniture: FurniturePlacement[] = [];
  const containers: ContainerPlacement[] = [];
  const cats: CatPlacement[] = [];
  const decor: DecorPlacement[] = [];
  const floorFree: Span[] = [];
  const wallFree: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  let x = vigs.length === 1 ? slack / 2 : 0;
  const names = rng.shuffle([...CAT_NAMES]);
  vigs.forEach(({ v, mirror }) => {
    const ox = x;
    const mx = (vx: number): number => (mirror ? ox + v.width - vx : ox + vx);
    for (const f of v.furniture) {
      const a = mx(f.x0);
      const b = mx(f.x1);
      furniture.push({ ...f, x0: round(Math.min(a, b)), x1: round(Math.max(a, b)) });
    }
    for (const c of v.containers) containers.push({ ...c, x: round(mx(c.x)), flip: mirror ? !c.flip : c.flip, tint: rng.int(0, 3) });
    for (const c of v.cats) cats.push({ ...c, x: round(mx(c.x)), name: names[cats.length] });
    for (const d of v.decor) {
      if (d.type === 'backsplash') {
        const a = mx(d.x);
        const b = mx(d.x + (d.w ?? 0));
        decor.push({ ...d, x: Math.min(a, b), w: Math.abs(b - a) });
      } else decor.push({ ...d, x: mx(d.x) });
    }
    for (const s of v.floorFree) {
      const a = mx(s.x0);
      const b = mx(s.x1);
      floorFree.push({ x0: Math.min(a, b), x1: Math.max(a, b) });
    }
    for (const w of v.wallFree) {
      const a = mx(w.x0);
      const b = mx(w.x1);
      wallFree.push({ x0: Math.min(a, b), x1: Math.max(a, b), y0: w.y0, y1: w.y1 });
    }
    if (between > 30) floorFree.push({ x0: x + v.width, x1: x + v.width + between });
    x += v.width + between;
  });
  // Three cats wanted but only two fit side by side? The zippy kitten can be
  // carried, so it can start on a high shelf anywhere and still find a cup.
  if (want === 3 && cats.length === 2 && !cats.some((c) => c.breed === 'kitten') && (chosen[2] === 'kitten' || rng.chance(0.5))) {
    const slots = floorFree.filter((f) => f.x1 - f.x0 > 64).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0));
    const windows = decor.filter((d) => d.type === 'window');
    const shelfX = [40, 90, 140, 190, 240, 290].map((x) => x + rng.range(-12, 12)).filter((x) => x > 36 && x < WORLD_W - 36 && !windows.some((w) => Math.abs(w.x - x) < (w.w ?? 100) / 2 + 40) && !furniture.some((f) => f.type === 'shelf' && f.y < 210 && Math.abs((f.x0 + f.x1) / 2 - x) < 80));
    if (slots.length && shelfX.length) {
      const f = slots[0];
      const kitPool = (['slipper', 'mug', 'teacup', 'boot', 'pot', 'bucket'] as ContainerType[]).filter((t) => {
        const e = cExt(t, 1);
        return e.left + e.right <= f.x1 - f.x0 - 8;
      });
      if (kitPool.length) {
        const t = rng.pick(kitPool);
        const e = cExt(t, 1);
        const cx = (f.x0 + f.x1) / 2 - (e.right - e.left) / 2;
        containers.push({ type: t, x: round(cx), y: FLOOR_Y, tint: rng.int(0, 3) });
        floorFree.splice(floorFree.indexOf(f), 1);
        const sx = rng.pick(shelfX);
        const ys = round(rng.range(128, 168));
        furniture.push({ type: 'shelf', x0: round(sx - 36), x1: round(sx + 36), y: ys });
        cats.push({ breed: 'kitten', x: round(sx), y: ys, name: names[cats.length] });
      }
    }
  }
  // A spare container in a free stretch of floor makes the morning a choice.
  const roomy = floorFree.filter((f) => f.x1 - f.x0 > 70).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0));
  if (roomy.length && rng.chance(0.7)) {
    const f = roomy[0];
    const avail = f.x1 - f.x0 - 8;
    const present = new Set(containers.map((c) => c.type));
    const options = pool.filter((t) => {
      const e = cExt(t, 1);
      return e.left + e.right <= avail && e.height < 150 && t !== 'sink' && !present.has(t);
    });
    if (options.length) {
      const t = rng.pick(options);
      const e = cExt(t, 1);
      const cx = f.x0 + 4 + e.left + (avail - e.left - e.right) / 2;
      containers.push({ type: t, x: round(cx), y: FLOOR_Y, tint: rng.int(0, 3) });
      floorFree.splice(floorFree.indexOf(f), 1);
    }
  }
  // Sanity: nothing outside the room.
  for (const c of containers) {
    const e = cExtF(c.type, c.scale ?? 1, !!c.flip);
    if (c.x - e.left < 0 || c.x + e.right > WORLD_W) return null;
  }
  decorate(rng, theme, decor, floorFree, wallFree, windowCount, furniture);
  const adj = rng.pick(ADJ[theme]).replace(/-/g, ' ');
  const name = `${adj} ${rng.pick(NOUN[theme])}`;
  return { id: `daily-${dateKey}-${variant}`, name, theme, furniture, containers, cats, decor };
}

function decorate(
  rng: Rng,
  theme: ThemeId,
  decor: DecorPlacement[],
  floorFree: Span[],
  wallFree: Array<{ x0: number; x1: number; y0: number; y1: number }>,
  windowCount: number,
  furniture: FurniturePlacement[],
): void {
  // Everything on the wall gets a rectangle; nothing may overlap.
  type R = { x0: number; y0: number; x1: number; y1: number };
  const taken: R[] = [];
  const hits = (a: R): boolean => taken.some((b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);
  for (const d of decor) {
    if (d.type === 'window') taken.push({ x0: d.x - (d.w ?? 100) / 2 - 30, x1: d.x + (d.w ?? 100) / 2 + 30, y0: d.y - 20, y1: d.y + (d.h ?? 120) + 20 });
    if (d.type === 'backsplash') taken.push({ x0: d.x, x1: d.x + (d.w ?? 0), y0: d.y, y1: d.y + (d.h ?? 0) });
  }
  for (const f of furniture) {
    if (f.type === 'shelf' || f.type === 'sill') taken.push({ x0: f.x0, x1: f.x1, y0: f.y - 90, y1: f.y + 30 });
    else taken.push({ x0: f.x0, x1: f.x1, y0: f.y - 90, y1: FLOOR_Y });
  }
  const highest = Math.min(...furniture.map((f) => f.y), FLOOR_Y);
  if (windowCount === 0) {
    // A window somewhere high on the wall for the afternoon sun.
    const candidates: R[] = [];
    for (let x = 70; x <= WORLD_W - 70; x += 20) {
      const w = 96;
      const h = Math.min(126, highest - 110);
      if (h < 80) break;
      candidates.push({ x0: x - w / 2 - 30, x1: x + w / 2 + 30, y0: 36, y1: 36 + h + 20 });
    }
    const free = candidates.filter((c) => !hits(c));
    if (free.length) {
      const c = rng.pick(free);
      const w = 96;
      decor.push({ type: 'window', x: (c.x0 + c.x1) / 2, y: 40, w, h: c.y1 - c.y0 - 24, variant: rng.int(0, 2) });
      taken.push(c);
    }
  }
  for (const w of wallFree) {
    if (w.x1 - w.x0 < 50 || w.y1 - w.y0 < 50) continue;
    const kind = rng.weighted(['picture', 'clock', 'mirror', 'none'] as const, [3, 1.5, theme === 'bathroom' ? 2 : 0.4, 1.2]);
    const cx = (w.x0 + w.x1) / 2;
    let d: DecorPlacement | null = null;
    let r: R | null = null;
    if (kind === 'picture') {
      const pw = Math.min(56, w.x1 - w.x0 - 16);
      d = { type: 'picture', x: cx, y: w.y0 + 16, w: pw, h: 42, variant: rng.int(0, 2) };
      r = { x0: cx - pw / 2 - 6, x1: cx + pw / 2 + 6, y0: w.y0, y1: w.y0 + 64 };
    } else if (kind === 'clock') {
      d = { type: 'clock', x: cx, y: w.y0 + 30, w: 16 };
      r = { x0: cx - 24, x1: cx + 24, y0: w.y0 + 6, y1: w.y0 + 54 };
    } else if (kind === 'mirror' && w.y1 - w.y0 > 110) {
      d = { type: 'mirror', x: cx, y: w.y0 + 8, w: 56, h: 84 };
      r = { x0: cx - 34, x1: cx + 34, y0: w.y0, y1: w.y0 + 100 };
    }
    if (d && r && !hits(r)) {
      decor.push(d);
      taken.push(r);
    }
  }
  for (const f of floorFree) {
    if (f.x1 - f.x0 > 40) decor.push({ type: 'plant', x: (f.x0 + f.x1) / 2, y: FLOOR_Y, w: 34 });
  }
  if (rng.chance(0.55)) decor.push({ type: 'rug', x: rng.range(120, 260), y: FLOOR_Y, w: rng.range(120, 170) });
  if (rng.chance(0.35) && !taken.some((t) => t.y0 < 40)) decor.push({ type: 'garland', x: WORLD_W / 2, y: 10, w: 320 });
  if (theme === 'bathroom' && rng.chance(0.6)) {
    const x = rng.range(60, 320);
    const r = { x0: x - 32, x1: x + 32, y0: 110, y1: 180 };
    if (!hits(r)) decor.push({ type: 'towel', x, y: 120 });
  }
}

/** Deterministic daily room: composed, solver-checked, with par and plan. */
export function dailyRoom(dateKey: string, opts: DailyOptions = {}): RoomDef {
  const seed = `if-it-fits:${dateKey}`;
  const attempts = opts.attempts ?? 10;
  for (let v = 0; v < attempts; v++) {
    const def = composeRoom(seed, dateKey, v);
    if (!def) continue;
    const res = solveRoom(def, { maxFrames: 14000 });
    if (res.ok) {
      return { ...def, id: `daily-${dateKey}`, par: res.par, plan: res.plan, subtitle: '', variant: v };
    }
  }
  return fallbackRoom(dateKey);
}

/** Rebuild a known-good morning from the precomputed index (no solving needed). */
export function dailyFromIndex(dateKey: string, variant: number, par: number, plan: RoomDef['plan']): RoomDef | null {
  const def = variant < 0 ? fallbackRoom(dateKey) : composeRoom(`if-it-fits:${dateKey}`, dateKey, variant);
  if (!def) return null;
  return { ...def, id: `daily-${dateKey}`, par, plan, subtitle: '', variant };
}

/** Safe fallback: a known-good layout with today's cats. */
function fallbackRoom(dateKey: string): RoomDef {
  // (variant -1 in the index)
  const rng = new Rng(`fallback:${dateKey}`);
  const names = rng.shuffle([...CAT_NAMES]);
  return {
    id: `daily-${dateKey}`,
    name: 'Snug Corner',
    theme: 'living',
    furniture: [
      { type: 'counter', x0: 0, x1: 118, y: 362 },
      { type: 'stool', x0: 132, x1: 192, y: 472 },
      { type: 'shelf', x0: 252, x1: 360, y: 260 },
    ],
    containers: [
      { type: 'teacup', x: 162, y: 472 },
      { type: 'box', x: 280, y: FLOOR_Y, scale: 0.9 },
    ],
    cats: [
      { breed: 'chonk', x: 56, y: 362, name: names[0] },
      { breed: 'tabby', x: 310, y: 260, name: names[1] },
    ],
    decor: [
      { type: 'window', x: 200, y: 50, w: 96, h: 124 },
      { type: 'rug', x: 180, y: FLOOR_Y, w: 150 },
    ],
    par: 2,
    variant: -1,
  };
}
