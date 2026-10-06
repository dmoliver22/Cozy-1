import { describe, expect, it } from 'vitest';
import { FLOOR_Y, WORLD_W } from '../src/game/props';
import { Session } from '../src/game/session';
import { canSit, fittingBoxes, houseRoom } from '../src/house/homeRoom';
import {
  ALL_CATS,
  DROP_FISH_PER_TREAT,
  DROP_METRES_PER_TREAT,
  FLOOR_PRICES,
  GIFT_TREATS,
  INKWELL_DEPTH,
  JAR_POINTS_PER_TREAT,
  START_TREATS,
  WELCOME_BACK,
  MOVE_INS,
  arrive,
  buyFloor,
  buyPerch,
  emptyHouse,
  giftDue,
  isOpen,
  loadHouse,
  moveInFor,
  nextMoveIn,
  payTreats,
  placePerch,
  placedPerches,
  priceOf,
  recordRun,
  settle,
  storePerch,
  takeGift,
  writeHouse,
} from '../src/house/house';
import { ATTIC_FUNNEL, BASEMENT_DY, FLOORS, FUNNEL, HOOD, LIVING_CEIL, LOFT_HOOD, TUBES, VIEWS, floorAt, houseShell, tubeShapes, type FloorId } from '../src/house/layout';
import { PERCHES, buildPerch, floorTop, perchBox, placeProblem, snapPerch } from '../src/house/perches';
import { Tubes } from '../src/house/tubes';
import { polygonArea } from '../src/util/math';

const jar = (biggest: number, over = true) => ({ game: 'jar' as const, daily: false, score: 1000, biggest, drops: 30, over });
const drop = (depth: number, fish: number, over = true) => ({ game: 'drop' as const, daily: false, score: 500, depth, fish, breed: 'tabby' as const, over });

describe('the house', () => {
  it('starts with Pip and Mochi, and four cats still to meet', () => {
    const h = emptyHouse();
    expect(h.residents).toEqual(['kitten', 'tabby']);
    expect(ALL_CATS).toHaveLength(6);
    expect(new Set(ALL_CATS).size).toBe(6);
    // (two in each game: an early one, and one that takes a little more)
    expect(nextMoveIn(h)?.breed).toBe('persian');
    expect(nextMoveIn(h, 'jar')?.breed).toBe('persian');
    expect(nextMoveIn(h, 'drop')?.breed).toBe('chonk');
    expect(MOVE_INS.filter((m) => m.game === 'jar').map((m) => m.breed)).toEqual(['persian', 'mainecoon']);
    expect(MOVE_INS.filter((m) => m.game === 'drop').map((m) => m.breed)).toEqual(['chonk', 'void']);
  });

  it('making a Persian in Cat Jar brings Duchess home, once', () => {
    const h = emptyHouse();
    expect(recordRun(h, jar(1, false))).toEqual([]);
    expect(recordRun(h, jar(2, false))).toEqual(['persian']);
    expect(h.arriving).toEqual(['persian']);
    expect(recordRun(h, jar(2, true))).toEqual([]);
    expect(arrive(h)).toBe('persian');
    expect(h.residents).toContain('persian');
    expect(h.arriving).toEqual([]);
    expect(arrive(h)).toBeNull();
  });

  it('Cat Jar and Cat Drop milestones count as soon as they happen, mid-run too', () => {
    const h = emptyHouse();
    expect(recordRun(h, jar(1, false))).toEqual([]);
    expect(recordRun(h, jar(3, false))).toEqual(['persian', 'mainecoon']);
    expect(h.stats.jarGames).toBe(0);
    recordRun(h, jar(3, true));
    expect(h.stats.jarGames).toBe(1);
    expect(recordRun(h, drop(60, 10, false))).toEqual([]);
    expect(recordRun(h, drop(140, 25, true))).toEqual(['chonk']);
    expect(h.stats.dropRuns).toBe(1);
    expect(h.stats.dropDeepest).toBe(140);
    expect(h.stats.dropMostFish).toBe(25);
    expect(h.arriving).toEqual(['persian', 'mainecoon', 'chonk']);
  });

  it('Inkwell, a small night, comes home from deep down: a long fall in Cat Drop', () => {
    const h = emptyHouse();
    expect(recordRun(h, drop(INKWELL_DEPTH - 10, 5, false))).toEqual([]);
    expect(recordRun(h, drop(INKWELL_DEPTH, 5, false))).toEqual(['void']);
    expect(moveInFor('void')?.game).toBe('drop');
  });

  it('a new house counts the best scores made before it', () => {
    const h = loadHouse({ jarBest: 900, dropBest: 300 });
    expect(h.stats.jarBest).toBe(900);
    expect(h.stats.dropBest).toBe(300);
    expect(h.arriving).toEqual([]);
    expect(settle(h)).toEqual([]);
  });

  it('a house from when If It Fits was here keeps who moved in for it, and the rest now come for the other games', () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    (globalThis as { localStorage?: unknown }).localStorage = ls;
    try {
      // Duchess came for If It Fits; Inkwell's room wasn't done, but a long fall was
      const stats = { ...emptyHouse().stats, fitsRooms: 2, fitsDone: ['sunny-kitchen'], dropDeepest: 900, jarBiggest: 1 };
      store.set('cozy-house:v1', JSON.stringify({ ...emptyHouse(), v: 5, welcomed: true, residents: ['kitten', 'tabby', 'persian'], stats }));
      const h = loadHouse();
      expect(h.v).toBe(6);
      expect(h.residents).toEqual(['kitten', 'tabby', 'persian']);
      expect(h.arriving).toEqual(['void']);
      expect(h.stats).not.toHaveProperty('fitsRooms');
      expect(h.stats).not.toHaveProperty('fitsDone');
      // and no cat of your own yet: the cat maker is offered
      expect(h.cat).toBeNull();
      expect(h.catAsked).toBe(false);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('an older house moves its Cat Jar record down a size (the sphynx left the chain), and Noodle with it', () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    (globalThis as { localStorage?: unknown }).localStorage = ls;
    try {
      // a Maine Coon was the fifth size of the old chain (tier 4)
      const old = { v: 1, residents: ['kitten', 'tabby', 'sphynx'], arriving: ['persian'], welcomed: true, stats: { ...emptyHouse().stats, jarBiggest: 4 } };
      store.set('cozy-house:v1', JSON.stringify(old));
      const h = loadHouse();
      expect(h.v).toBe(6);
      expect(h.stats.jarBiggest).toBe(3);
      expect(h.treats).toBe(START_TREATS + WELCOME_BACK);
      expect(h.residents).toEqual(['kitten', 'tabby']);
      // (and the Maine Coon it made brings Juniper)
      expect(h.arriving).toEqual(['persian', 'mainecoon']);
      expect(settle(h)).toEqual([]);
      // once is enough
      writeHouse(h);
      expect(loadHouse().stats.jarBiggest).toBe(3);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('a house from before the living room grew keeps its roof garden on the roof', () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    (globalThis as { localStorage?: unknown }).localStorage = ls;
    try {
      // (the old roof deck was at y -183, and the living room's ceiling at 0)
      const old = {
        ...emptyHouse(),
        v: 2,
        open: ['roof'],
        perches: [
          { id: 1, kind: 'cloud', x: 200, y: -383 },
          { id: 2, kind: 'shelf', x: 120, y: 300 },
        ],
        nextPerch: 3,
        // (and Duchess was on the middle cat step, which came down later)
        where: { kitten: { x: 200, y: -183 }, tabby: { x: 150, y: FLOOR_Y }, persian: { x: 248, y: 224 } },
      };
      store.set('cozy-house:v1', JSON.stringify(old));
      const h = loadHouse();
      expect(h.v).toBe(6);
      // (up with the living room, and up again over the attic; and a bouncy cushion came for the living room)
      expect(h.perches.map((p) => [p.kind, p.y, floorAt(p.y)])).toEqual([
        ['cloud', FLOORS.roof.floorY - 200, 'roof'],
        ['shelf', 300, 'living'],
        ['bounce', floorTop('bounce', 'living'), 'living'],
      ]);
      expect(h.nextPerch).toBe(4);
      expect(h.where.kitten).toEqual({ x: 200, y: FLOORS.roof.floorY });
      expect(h.where.tabby).toEqual({ x: 150, y: FLOOR_Y });
      expect(h.where.persian).toBeUndefined();
      // once is enough
      writeHouse(h);
      expect(loadHouse().perches[0].y).toBe(FLOORS.roof.floorY - 200);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('a house from before the attic keeps its roof garden on the roof (the roof went up over the attic)', () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    (globalThis as { localStorage?: unknown }).localStorage = ls;
    try {
      // (the roof deck was at -743, right over the living room's ceiling)
      const old = {
        ...emptyHouse(),
        v: 4,
        open: ['roof', 'basement'],
        perches: [
          { id: 1, kind: 'cloud', x: 200, y: -943 },
          { id: 2, kind: 'shelf', x: 200, y: -400 },
        ],
        nextPerch: 3,
        where: { kitten: { x: 200, y: -743 }, tabby: { x: 262, y: 338 } },
      };
      store.set('cozy-house:v1', JSON.stringify(old));
      const h = loadHouse();
      expect(h.v).toBe(6);
      expect(h.perches.filter((p) => p.kind !== 'bounce').map((p) => [p.y, floorAt(p.y)])).toEqual([
        [FLOORS.roof.floorY - 200, 'roof'],
        [-400, 'living'],
      ]);
      expect(h.where.kitten).toEqual({ x: 200, y: FLOORS.roof.floorY });
      expect(h.where.tabby).toEqual({ x: 262, y: 338 });
      expect(h.open).not.toContain('attic');
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('when everyone lives here there is nobody left to meet', () => {
    const h = emptyHouse();
    recordRun(h, jar(5));
    recordRun(h, drop(INKWELL_DEPTH + 50, 30));
    while (arrive(h));
    expect([...h.residents].sort()).toEqual([...ALL_CATS].sort());
    expect(nextMoveIn(h)).toBeNull();
  });
});

describe('the home room', () => {
  it('everyone fits in their spot and stays in the room', () => {
    const s = new Session(houseRoom({ open: [], residents: ALL_CATS, where: {} }), { shell: houseShell });
    for (let f = 0; f < 240; f++) s.step();
    for (const c of s.cats) {
      c.body.computeCentroid();
      expect(c.body.cx).toBeGreaterThan(0);
      expect(c.body.cx).toBeLessThan(WORLD_W);
      expect(c.body.cy).toBeLessThan(FLOOR_Y);
      expect(c.body.cy).toBeGreaterThan(0);
    }
    // Biscuit in his basket and Inkwell poured into the vase
    const seats = Object.fromEntries(s.cats.map((c) => [c.breed, c.seat ? s.containers[c.seat.container].type : null]));
    expect(seats.chonk).toBe('basket');
    expect(seats.void).toBe('vase');
  });

  it('is twice as tall as a room, and the view stops down by its floor and up by its ceiling', () => {
    expect(FLOORS.living.floorY - FLOORS.living.ceilY).toBe(2 * FLOOR_Y);
    expect(VIEWS.map((v) => v.id)).toEqual(['roof', 'attic', 'high', 'living', 'basement']);
    expect(VIEWS.map((v) => floorAt(v.y))).toEqual(['roof', 'attic', 'living', 'living', 'basement']);
    for (let i = 1; i < VIEWS.length; i++) expect(VIEWS[i].y).toBeGreaterThan(VIEWS[i - 1].y);
  });

  it('has an attic a room high between the living room\'s ceiling and the roof\'s deck', () => {
    const a = FLOORS.attic;
    expect(a.floorY).toBeLessThan(LIVING_CEIL);
    expect(a.ceilY).toBeGreaterThan(FLOORS.roof.floorY);
    expect(a.floorY - a.ceilY).toBe(FLOOR_Y);
    for (const y of [a.ceilY + 2, a.floorY - 2, (a.ceilY + a.floorY) / 2]) expect(floorAt(y)).toBe('attic');
    expect(floorAt(LIVING_CEIL + 2)).toBe('living');
    expect(floorAt(FLOORS.roof.floorY - 2)).toBe('roof');
    // a perch can go up there once it's open
    expect(placeProblem('shelf', 200, a.floorY - 200, ['living'], [])).toBe('locked');
    expect(placeProblem('shelf', 200, a.floorY - 200, ['living', 'attic'], [])).toBeNull();
  });

  it('the tubes are there from the start, capped: a cat sits on the funnel\'s lid and can\'t get up into the hood', () => {
    const chute = TUBES.find((t) => t.id === 'chute')!;
    const lift = TUBES.find((t) => t.id === 'lift')!;
    const loft = TUBES.find((t) => t.id === 'loft')!;
    expect(tubeShapes(chute, 1, false).length).toBeGreaterThan(tubeShapes(chute, 1, true).length);
    expect(tubeShapes(lift, 1, false).length).toBeGreaterThan(tubeShapes(lift, 1, true).length);
    expect(tubeShapes(loft, 1, false).length).toBeGreaterThan(tubeShapes(loft, 1, true).length);
    for (const open of [false, true]) {
      const def = houseRoom({ open: [], residents: ['kitten', 'tabby'], where: {} });
      const s = new Session(def, { shell: () => [...houseShell(), ...tubeShapes(chute, 9002, open), ...tubeShapes(lift, 9001, open)] });
      const [kitten, tabby] = s.cats;
      tabby.body.placeAt(FUNNEL.x, FUNNEL.rimY - 60);
      // the kitten, on the top step, is carried up into the hood (as at home: anywhere in the living room)
      kitten.body.placeAt(HOOD.x - 4, 126 - kitten.body.p.radius);
      for (let f = 0; f < 30; f++) s.step();
      s.grabBox = { x0: 4, x1: WORLD_W - 4, y0: LIVING_CEIL + 40, y1: FLOOR_Y - 4 };
      kitten.body.computeCentroid();
      s.beginGrab(kitten, kitten.body.cx, kitten.body.cy - kitten.body.p.radius * 0.6);
      let inBell = false;
      for (let f = 0; f < 90; f++) {
        s.moveGrab(HOOD.x - 4, HOOD.y - 60, 0, 0);
        s.step();
        for (let i = 0; i < kitten.body.n; i++) if (Math.abs(kitten.body.x[i] - HOOD.x) < 20 && kitten.body.y[i] < HOOD.y - 2) inBell = true;
      }
      s.endGrab();
      for (let f = 0; f < 240; f++) s.step();
      let bottom = -Infinity;
      for (let i = 0; i < tabby.body.n; i++) bottom = Math.max(bottom, tabby.body.y[i]);
      // (an open funnel takes the tabby; a capped one holds it up)
      expect(bottom < FUNNEL.rimY).toBe(!open);
      expect(inBell).toBe(open);
    }
  });

  it('keeps the tubes\' room clear of perches, open or capped', () => {
    const fit = fittingBoxes({ open: [] }, 'all');
    const hits = (kind: 'shelf' | 'cloud', x: number, y: number): boolean => {
      const b = perchBox(kind, x, y);
      return fit.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
    };
    // up the living room wall beside the roof tube's pipe, over the funnel, and by the attic tube's hood
    expect(hits('shelf', HOOD.x - 10, -300)).toBe(true);
    expect(hits('shelf', FUNNEL.x + 10, 450)).toBe(true);
    expect(hits('shelf', LOFT_HOOD.x + 10, LOFT_HOOD.y + 50)).toBe(true);
    // and over the funnel in the attic's floor
    expect(hits('shelf', ATTIC_FUNNEL.x + 10, ATTIC_FUNNEL.rimY - 20)).toBe(true);
    expect(hits('shelf', 200, -300)).toBe(false);
    // a cat can sit under a capped hood, not under an open one
    expect(fittingBoxes({ open: [] }).length).toBeLessThan(fit.length);
  });
});

describe('treats and the shop', () => {
  it('a Cat Jar or Cat Drop run pays as it goes, each treat once', () => {
    const h = emptyHouse();
    const t0 = h.treats;
    const j = (score: number, run: string, over = false) => ({ game: 'jar' as const, daily: false, score, biggest: 1, drops: 10, over, run });
    expect(payTreats(h, j(JAR_POINTS_PER_TREAT * 5 + 10, 'a'))).toBe(5);
    expect(payTreats(h, j(JAR_POINTS_PER_TREAT * 6 - 10, 'a'))).toBe(0);
    expect(payTreats(h, j(JAR_POINTS_PER_TREAT * 9, 'a', true))).toBe(4);
    // a new game starts from nothing
    expect(payTreats(h, j(JAR_POINTS_PER_TREAT * 2, 'b'))).toBe(2);
    const d = { game: 'drop' as const, daily: false, score: 900, depth: 140, fish: 12, breed: 'tabby' as const, over: true, run: 'c' };
    expect(payTreats(h, d)).toBe(12 / DROP_FISH_PER_TREAT + Math.floor(140 / DROP_METRES_PER_TREAT));
    expect(h.treats).toBe(t0 + 11 + 6 + 2);
  });

  it('opening a floor and buying perches spend treats; perches cost more the more you have', () => {
    const h = emptyHouse();
    h.treats = 120;
    expect(buyFloor(h, 'roof')).toBe(false);
    expect(buyFloor(h, 'basement')).toBe(true);
    expect(h.treats).toBe(120 - FLOOR_PRICES.basement);
    expect(buyFloor(h, 'basement')).toBe(false);
    expect(isOpen(h, 'basement') && isOpen(h, 'living') && !isOpen(h, 'roof')).toBe(true);
    const a = buyPerch(h, 'shelf')!;
    expect(a.stored).toBe(true);
    expect(priceOf(h, 'shelf')).toBe(PERCHES.shelf.price + PERCHES.shelf.step);
    placePerch(h, a.id, 60, 300);
    // (with the living room's bouncy cushion)
    expect(placedPerches(h).map((p) => p.kind)).toEqual(['bounce', 'shelf']);
    expect(placedPerches(h)[1]).toEqual({ id: a.id, kind: 'shelf', x: 60, y: 300 });
    storePerch(h, a.id);
    expect(placedPerches(h).map((p) => p.kind)).toEqual(['bounce']);
    h.treats = 3;
    expect(buyPerch(h, 'shelf')).toBeNull();
  });

  it('a house comes with a bouncy cushion on the living room floor, between the vase and the basket', () => {
    const h = emptyHouse();
    const c = h.perches.find((p) => p.kind === 'bounce')!;
    expect(c.y).toBe(floorTop('bounce', 'living'));
    const s = new Session(houseRoom(h), { shell: houseShell });
    const taken = [...fittingBoxes(h, 'all'), ...s.props.map((p) => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 }))];
    expect(placeProblem('bounce', c.x, c.y, ['living'], taken)).toBeNull();
    expect(s.containers.map((k) => k.type)).toEqual(['vase', 'basket']);
    // (it's a gift: the first one you buy is still the full price, not dearer)
    expect(priceOf(h, 'bounce')).toBe(PERCHES.bounce.price);
    h.treats = 500;
    buyPerch(h, 'bounce');
    expect(priceOf(h, 'bounce')).toBe(PERCHES.bounce.price + PERCHES.bounce.step);
  });

  it('the cats leave a present once a day', () => {
    const h = emptyHouse();
    h.welcomed = true;
    expect(giftDue(h, '2026-10-06')).toBe(true);
    const t = h.treats;
    expect(takeGift(h, '2026-10-06')).toBe(GIFT_TREATS);
    expect(giftDue(h, '2026-10-06')).toBe(false);
    expect(takeGift(h, '2026-10-06')).toBe(0);
    expect(h.treats).toBe(t + GIFT_TREATS);
    expect(giftDue(h, '2026-10-07')).toBe(true);
  });
});

describe('perches', () => {
  const all: FloorId[] = ['roof', 'living', 'basement'];
  it('go on a wall inside an open floor, or stand on a floor; out in the open only a cloud floats', () => {
    expect(placeProblem('shelf', 60, 300, all, [])).toBeNull();
    expect(placeProblem('shelf', 60, 300 + BASEMENT_DY, ['living'], [])).toBe('locked');
    expect(placeProblem('shelf', 10, 300, all, [])).toBe('outside');
    expect(placeProblem('shelf', 60, LIVING_CEIL + 10, all, [])).toBe('outside');
    // all the way up the living room's tall wall
    expect(placeProblem('shelf', 60, 10, all, [])).toBeNull();
    expect(placeProblem('shelf', 60, LIVING_CEIL + 40, all, [])).toBeNull();
    expect(placeProblem('shelf', 60, FLOOR_Y - 10, all, [])).toBe('outside');
    expect(placeProblem('shelf', 200, FLOORS.roof.floorY - 200, all, [])).toBe('sky');
    expect(placeProblem('cloud', 200, FLOORS.roof.floorY - 200, all, [])).toBeNull();
    expect(placeProblem('tree', 200, floorTop('tree', 'roof'), all, [])).toBeNull();
    expect(placeProblem('tree', 200, floorTop('tree', 'roof') - 30, all, [])).toBe('outside');
    expect(placeProblem('shelf', 60, 300, all, [{ x0: 40, y0: 290, x1: 90, y1: 320 }])).toBe('blocked');
    // dragged anywhere, a floor perch stands on the floor under the finger
    expect(snapPerch('beanbag', 150, 400)).toEqual({ x: 150, y: floorTop('beanbag', 'living') });
    expect(snapPerch('beanbag', 150, 900).y).toBe(floorTop('beanbag', 'basement'));
  });

  it('a cat on a wall shelf sits on it', () => {
    const p = buildPerch({ id: 1, kind: 'shelf', x: 120, y: 300 });
    const s = new Session(houseRoom({ open: [], residents: ['kitten'], where: { kitten: { x: 120, y: 300 } } }), { shell: () => [...houseShell(), ...p.shapes] });
    for (let f = 0; f < 240; f++) s.step();
    const c = s.cats[0].body;
    c.computeCentroid();
    expect(c.cy).toBeLessThan(300);
    expect(c.cy).toBeGreaterThan(300 - 2 * c.p.radius);
  });
});

describe('the tall house', () => {
  it('cats stay on their own floor: the roof deck, the living room floor and the basement floor', () => {
    const where = { kitten: { x: 200, y: FLOORS.roof.floorY }, tabby: { x: 150, y: FLOOR_Y }, chonk: { x: 200, y: FLOORS.basement.floorY } };
    const def = houseRoom({ open: ['roof', 'basement'], residents: ['kitten', 'tabby', 'chonk'], where });
    expect(def.cats.map((c) => [c.breed, c.y])).toEqual([
      ['kitten', FLOORS.roof.floorY],
      ['tabby', FLOOR_Y],
      ['chonk', FLOORS.basement.floorY],
    ]);
    const s = new Session(def, { shell: houseShell });
    for (let f = 0; f < 300; f++) s.step();
    const at = s.cats.map((c) => {
      c.body.computeCentroid();
      return floorAt(c.body.cy);
    });
    expect(at).toEqual(['roof', 'living', 'basement']);
    for (const c of s.cats) {
      let maxY = -Infinity;
      for (let i = 0; i < c.body.n; i++) maxY = Math.max(maxY, c.body.y[i]);
      expect(Math.abs(maxY - FLOORS[floorAt(c.body.cy)].floorY)).toBeLessThan(6);
    }
  });

  it('a cat that was on a floor that isn\'t open (or in a tube\'s way) goes back to its spot', () => {
    const def = houseRoom({ open: [], residents: ['kitten', 'tabby'], where: { kitten: { x: 200, y: FLOORS.basement.floorY }, tabby: { x: 340, y: 128 } } });
    expect(def.cats.map((c) => c.y)).toEqual([212, 128]);
    // (under the roof tube's hood: only if the tube isn't in)
    expect(canSit({ open: ['roof'] }, 'tabby', 340, 128)).toBe(false);
    expect(canSit({ open: [] }, 'tabby', 340, 128)).toBe(true);
  });

  it('a cat let go under the living room hood rides the tube up to the roof, and back down', () => {
    const lift = TUBES.find((t) => t.id === 'lift')!;
    const def = houseRoom({ open: ['roof'], residents: ['mainecoon'], where: {} });
    const s = new Session(def, { shell: () => [...houseShell(), ...tubeShapes(lift, 9001)] });
    // put down on the top step, under the hood
    const cat = s.cats[0];
    cat.body.placeAt(330, 128 - cat.body.p.radius);
    for (let f = 0; f < 60; f++) s.step();
    const tubes = new Tubes(() => s.world);
    cat.body.computeCentroid();
    expect(Tubes.mouthAt([lift], cat.body.cx, cat.body.cy, 'hood')).toEqual({ tube: lift, up: true });
    tubes.start(cat, lift, true);
    expect(s.world.bodies).not.toContain(cat.body);
    const area0 = Math.abs(polygonArea(cat.body.x, cat.body.y, cat.body.n));
    let frames = 0;
    while (tubes.riding(cat) && frames < 600) {
      tubes.step();
      s.step();
      frames++;
      // squeezed into a sausage, it's still the same cat: the same size, never inside out
      if (tubes.riding(cat)?.phase === 'go') {
        const a = polygonArea(cat.body.x, cat.body.y, cat.body.n);
        expect(Math.abs(Math.abs(a) / area0 - 1)).toBeLessThan(0.12);
      }
    }
    expect(frames).toBeLessThan(200);
    expect(s.world.bodies).toContain(cat.body);
    for (let f = 0; f < 240; f++) s.step();
    cat.body.computeCentroid();
    expect(floorAt(cat.body.cy)).toBe('roof');
    // and down again from the roof's hood
    tubes.start(cat, lift, false);
    for (let f = 0; f < 600 && tubes.riding(cat); f++) {
      tubes.step();
      s.step();
    }
    for (let f = 0; f < 240; f++) s.step();
    cat.body.computeCentroid();
    expect(floorAt(cat.body.cy)).toBe('living');
  });

  it('down the chute to the basement, and sucked back up through the funnel', () => {
    const chute = TUBES.find((t) => t.id === 'chute')!;
    const def = houseRoom({ open: ['basement'], residents: ['kitten'], where: { kitten: { x: 140, y: FLOOR_Y } } });
    const s = new Session(def, { shell: () => [...houseShell(), ...tubeShapes(chute, 9002)] });
    const cat = s.cats[0];
    const tubes = new Tubes(() => s.world);
    tubes.start(cat, chute, false);
    for (let f = 0; f < 600 && tubes.riding(cat); f++) {
      tubes.step();
      s.step();
    }
    for (let f = 0; f < 240; f++) s.step();
    cat.body.computeCentroid();
    expect(floorAt(cat.body.cy)).toBe('basement');
    tubes.start(cat, chute, true);
    for (let f = 0; f < 600 && tubes.riding(cat); f++) {
      tubes.step();
      s.step();
    }
    for (let f = 0; f < 240; f++) s.step();
    cat.body.computeCentroid();
    expect(floorAt(cat.body.cy)).toBe('living');
  });
});
