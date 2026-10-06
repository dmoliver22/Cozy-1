import { describe, expect, it } from 'vitest';
import { FLOOR_Y, WORLD_W } from '../src/game/props';
import { Session } from '../src/game/session';
import { canSit, houseRoom, portalAt, PORTALS } from '../src/house/homeRoom';
import {
  ALL_CATS,
  DROP_FISH_PER_TREAT,
  DROP_METRES_PER_TREAT,
  FLOOR_PRICES,
  GIFT_TREATS,
  INKWELL_ROOM,
  JAR_POINTS_PER_TREAT,
  START_TREATS,
  WELCOME_BACK,
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
import { BASEMENT_DY, FLOORS, TUBES, floorAt, houseShell, tubeShapes, type FloorId } from '../src/house/layout';
import { PERCHES, buildPerch, floorTop, placeProblem, snapPerch } from '../src/house/perches';
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
    expect(nextMoveIn(h)?.breed).toBe('persian');
    expect(nextMoveIn(h, 'jar')?.breed).toBe('mainecoon');
    expect(nextMoveIn(h, 'drop')?.breed).toBe('chonk');
  });

  it('a finished If It Fits room brings Duchess home, once', () => {
    const h = emptyHouse();
    expect(recordRun(h, { game: 'fits', room: 'sunny-kitchen' })).toEqual(['persian']);
    expect(h.arriving).toEqual(['persian']);
    expect(recordRun(h, { game: 'fits', room: 'bath-time' })).toEqual([]);
    expect(arrive(h)).toBe('persian');
    expect(h.residents).toContain('persian');
    expect(h.arriving).toEqual([]);
    expect(arrive(h)).toBeNull();
    expect(h.stats.fitsRooms).toBe(2);
    expect(h.stats.fitsDone).toEqual(['sunny-kitchen', 'bath-time']);
  });

  it('Cat Jar and Cat Drop milestones count as soon as they happen, mid-run too', () => {
    const h = emptyHouse();
    expect(recordRun(h, jar(2, false))).toEqual([]);
    expect(recordRun(h, jar(3, false))).toEqual(['mainecoon']);
    expect(h.stats.jarGames).toBe(0);
    recordRun(h, jar(3, true));
    expect(h.stats.jarGames).toBe(1);
    expect(recordRun(h, drop(60, 10, false))).toEqual([]);
    expect(recordRun(h, drop(140, 25, true))).toEqual(['chonk']);
    expect(h.stats.dropRuns).toBe(1);
    expect(h.stats.dropDeepest).toBe(140);
    expect(h.stats.dropMostFish).toBe(25);
    expect(h.arriving).toEqual(['mainecoon', 'chonk']);
  });

  it('Inkwell follows you home from the Midnight Study', () => {
    const h = emptyHouse();
    recordRun(h, { game: 'fits', room: 'sunny-kitchen' });
    expect(h.arriving).not.toContain('void');
    expect(recordRun(h, { game: 'fits', room: INKWELL_ROOM })).toEqual(['void']);
    expect(moveInFor('void')?.room).toBe(INKWELL_ROOM);
  });

  it('a new house counts progress made before it', () => {
    const h = loadHouse({ fitsRooms: 3, fitsDone: ['sunny-kitchen', INKWELL_ROOM], jarBest: 900, dropBest: 300 });
    expect(h.arriving).toEqual(['persian', 'void']);
    expect(h.stats.jarBest).toBe(900);
    // nothing new to settle
    expect(settle(h)).toEqual([]);
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
      expect(h.v).toBe(2);
      expect(h.stats.jarBiggest).toBe(3);
      expect(h.treats).toBe(START_TREATS + WELCOME_BACK);
      expect(h.residents).toEqual(['kitten', 'tabby']);
      expect(settle(h)).toEqual(['mainecoon']);
      // once is enough
      writeHouse(h);
      expect(loadHouse().stats.jarBiggest).toBe(3);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('when everyone lives here there is nobody left to meet', () => {
    const h = emptyHouse();
    recordRun(h, { game: 'fits', room: INKWELL_ROOM });
    recordRun(h, jar(5));
    recordRun(h, drop(200, 30));
    while (arrive(h));
    expect([...h.residents].sort()).toEqual([...ALL_CATS].sort());
    expect(nextMoveIn(h)).toBeNull();
  });
});

describe('the home room', () => {
  it('everyone fits in their spot and stays in the room', () => {
    const s = new Session(houseRoom({ open: [], residents: ALL_CATS, where: {} }), { mode: 'sandbox', shell: houseShell });
    for (let f = 0; f < 240; f++) s.step();
    for (const c of s.cats) {
      c.body.computeCentroid();
      expect(c.body.cx).toBeGreaterThan(0);
      expect(c.body.cx).toBeLessThan(WORLD_W);
      expect(c.body.cy).toBeLessThan(FLOOR_Y);
      expect(c.body.cy).toBeGreaterThan(0);
    }
    // Biscuit in his basket and Inkwell in the box
    const seats = Object.fromEntries(s.cats.map((c) => [c.breed, c.seat ? s.containers[c.seat.container].type : null]));
    expect(seats.chonk).toBe('basket');
    expect(seats.void).toBe('box');
    expect(s.complete).toBe(false);
  });

  it('the box, the jar and the hatch lead to the three games', () => {
    expect(PORTALS.map((p) => p.game).sort()).toEqual(['drop', 'fits', 'jar']);
    expect(portalAt(196, 530)?.game).toBe('fits');
    expect(portalAt(258, 300)?.game).toBe('jar');
    expect(portalAt(290, 10)?.game).toBe('drop');
    expect(portalAt(60, 300)).toBeNull();
  });
});

describe('treats and the shop', () => {
  it('If It Fits pays more the first time, and a little more for a cozy room in par', () => {
    const h = emptyHouse();
    const t0 = h.treats;
    expect(payTreats(h, { game: 'fits', room: 'sunny-kitchen', first: true, cozy: 95, underPar: true })).toBe(35);
    expect(payTreats(h, { game: 'fits', room: 'sunny-kitchen', first: false, cozy: 60, underPar: false })).toBe(5);
    expect(h.treats).toBe(t0 + 40);
    expect(h.earned).toBe(40);
  });

  it('a Cat Jar or Cat Drop run pays as it goes, each treat once', () => {
    const h = emptyHouse();
    const t0 = h.treats;
    const j = (score: number, run: string, over = false) => ({ game: 'jar' as const, daily: false, score, biggest: 1, drops: 10, over, run });
    expect(payTreats(h, j(JAR_POINTS_PER_TREAT * 5 + 10, 'a'))).toBe(5);
    expect(payTreats(h, j(JAR_POINTS_PER_TREAT * 5 + 300, 'a'))).toBe(0);
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
    expect(placedPerches(h)).toEqual([{ id: a.id, kind: 'shelf', x: 60, y: 300 }]);
    storePerch(h, a.id);
    expect(placedPerches(h)).toEqual([]);
    h.treats = 3;
    expect(buyPerch(h, 'shelf')).toBeNull();
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
    expect(placeProblem('shelf', 60, 10, all, [])).toBe('outside');
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
    const s = new Session(houseRoom({ open: [], residents: ['kitten'], where: { kitten: { x: 120, y: 300 } } }), { mode: 'sandbox', shell: () => [...houseShell(), ...p.shapes] });
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
    const s = new Session(def, { mode: 'sandbox', shell: houseShell });
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
    const s = new Session(def, { mode: 'sandbox', shell: () => [...houseShell(), ...tubeShapes(lift, 9001)] });
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
    const s = new Session(def, { mode: 'sandbox', shell: () => [...houseShell(), ...tubeShapes(chute, 9002)] });
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
