import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLOOR_Y } from '../src/game/props';
import { Session, type GameEvent } from '../src/game/session';
import { distToShape, nearestRoom, roomFor, stuckFast } from '../src/game/spawn';
import { GIFT_SPOT, SPOTS, VASE_X, homeFurniture, houseRoom, houseSpawnOk } from '../src/house/homeRoom';
import { YARN_HOME, YARN_R } from '../src/house/antics';
import { ALL_CATS, applyMyCat, type HouseSave } from '../src/house/house';
import { LIVING_CUSHION_X, TUBES, chimneyShapes, floorAt, houseShell, tubeShapes } from '../src/house/layout';
import { BOUNCE, buildPerch, floorTop } from '../src/house/perches';
import type { BreedId } from '../src/physics/breeds';
import { DEFAULT_DESIGN, type CatDesign } from '../src/physics/mycat';
import { capsule } from '../src/physics/shapes';
import { SoftBody } from '../src/physics/softbody';

// Cats never end up in one another or in the furniture: a cat whose place
// is taken starts somewhere clear, cats found in one another are slid apart,
// and a cat stuck fast is put down again somewhere clear.

/** The house as Home builds it: its shell, the chimney and the capped tubes, the bouncy cushion, and the house's own options. */
function house(residents: BreedId[], where: HouseSave['where'], opts: { unmerge?: boolean } = {}) {
  const h = { open: [] as HouseSave['open'], residents, where };
  const cushion = buildPerch({ id: 1, kind: 'bounce', x: LIVING_CUSHION_X, y: floorTop('bounce', 'living') });
  const shell = () => [...houseShell(), ...chimneyShapes(90003), ...TUBES.map((t, k) => tubeShapes(t, 90010 + k, false)).flat(), ...cushion.shapes];
  const s = new Session(houseRoom(h), opts.unmerge === false ? { shell } : { shell, spawnOk: houseSpawnOk(h), unmerge: true });
  const fell = new WeakMap<SoftBody, number>();
  const events: GameEvent[] = [];
  const step = (frames = 1) => {
    for (let f = 0; f < frames; f++) {
      s.step();
      events.push(...s.drainEvents());
      cushion.bouncer!.step(s.world.bodies, (b) => !s.cats.some((c) => c.body === b && c.grabbed), (b) => fell.get(b) ?? 0);
      for (const b of s.world.bodies) {
        b.computeCentroid();
        fell.set(b, b.vcy);
      }
    }
  };
  const rescued = () => events.filter((e): e is Extract<GameEvent, { t: 'unstuck' }> => e.t === 'unstuck');
  return { s, step, rescued };
}

function inside(b: SoftBody, x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = b.n - 1; i < b.n; j = i++) if (b.y[i] > y !== b.y[j] > y && x < b.x[j] + ((y - b.y[j]) * (b.x[i] - b.x[j])) / (b.y[i] - b.y[j])) c = !c;
  return c;
}

/** Are two cats in one another: any of their nodes inside the other, or a middle inside it? */
function inOneAnother(a: SoftBody, b: SoftBody): boolean {
  a.computeCentroid();
  b.computeCentroid();
  if (inside(a, b.cx, b.cy) || inside(b, a.cx, a.cy)) return true;
  for (let i = 0; i < a.n; i++) if (inside(b, a.x[i], a.y[i])) return true;
  for (let i = 0; i < b.n; i++) if (inside(a, b.x[i], b.y[i])) return true;
  return false;
}

function allClear(s: Session): string[] {
  const out: string[] = [];
  for (const c of s.cats) if (stuckFast(s.world.statics, c.body)) out.push(`${c.breed} stuck`);
  for (let i = 0; i < s.cats.length; i++) for (let j = i + 1; j < s.cats.length; j++) if (inOneAnother(s.cats[i].body, s.cats[j].body)) out.push(`${s.cats[i].breed} in ${s.cats[j].breed}`);
  return out;
}

const big = (over: Partial<CatDesign> = {}): CatDesign => ({ ...DEFAULT_DESIGN, size: 1, squish: 0.6, ...over });

afterEach(() => {
  applyMyCat({ cat: null });
  vi.restoreAllMocks();
});

describe('a cat whose place is taken', () => {
  it('starts in the nearest clear place: two saved in one spot on the shelf, one where the old jar stood, one astride the basket\'s wall', () => {
    applyMyCat({ cat: big() });
    const where = {
      persian: { x: 300, y: 338 },
      void: { x: 306, y: 338 },
      // (between the vase and the cushion: they weren't there before)
      mine: { x: 196, y: 560 },
      chonk: { x: 268, y: 541 },
    };
    const { s, step, rescued } = house(['kitten', 'tabby', 'persian', 'void', 'chonk', 'mine'], where);
    expect(allClear(s)).toEqual([]);
    step(240);
    expect(allClear(s)).toEqual([]);
    expect(rescued()).toEqual([]);
    // (and nobody's left the living room)
    for (const c of s.cats) expect(floorAt(c.body.cy)).toBe('living');
  });

  it('without the check, the same save leaves cats in one another and in the furniture for good', () => {
    applyMyCat({ cat: big() });
    const { s, step } = house(['persian', 'void', 'mine', 'chonk'], { persian: { x: 300, y: 338 }, void: { x: 306, y: 338 }, mine: { x: 196, y: 560 }, chonk: { x: 268, y: 541 } }, { unmerge: false });
    step(240);
    expect(allClear(s).length).toBeGreaterThan(0);
  });

  it('a big cat of your own restyled in the vase, on the cushion or beside Duchess finds room', () => {
    for (const where of [
      { x: VASE_X, y: 553 },
      { x: LIVING_CUSHION_X, y: FLOOR_Y - BOUNCE.h },
      { x: 330, y: 338 },
    ]) {
      for (const squish of [0, 1]) {
        applyMyCat({ cat: big({ squish }) });
        const { s, step, rescued } = house(['kitten', 'tabby', 'persian', 'mine'], { mine: where, persian: { x: 345, y: 338 } });
        step(300);
        expect(allClear(s)).toEqual([]);
        expect(rescued()).toEqual([]);
      }
    }
  });

  it('a thin wall through the middle of a ring counts (not just one round its edge)', () => {
    // a rod standing up 12 units to the side of the middle of a ring of 40
    const rod = capsule(212, 400, 212, 520, 4);
    expect(roomFor([rod], [], 200, 460, 40)).toBe(false);
    expect(roomFor([rod], [], 140, 460, 40)).toBe(true);
    expect(distToShape(rod, 200, 460)).toBeCloseTo(8, 0);
    // and the nearest clear place is off to the side of it, or up over its top
    const p = nearestRoom([rod], [], 200, 460, 40, () => true)!;
    expect(roomFor([rod], [], p.x, p.y, 40)).toBe(true);
    expect(Math.abs(p.x - 212) >= 36 || p.y + 36 <= 400).toBe(true);
    // (another cat's ring counts too)
    expect(roomFor([], [{ x: 230, y: 460, r: 30 }], 200, 460, 40)).toBe(false);
  });
});

describe('cats in one another', () => {
  it('are slid apart, or the smaller is put down somewhere clear: never left in one another', () => {
    for (const [a, b, dx] of [
      ['tabby', 'persian', 6],
      ['void', 'mine', 0],
      ['mainecoon', 'tabby', 3],
      ['kitten', 'chonk', 10],
    ] as [BreedId, BreedId, number][]) {
      applyMyCat({ cat: big({ squish: 1 }) });
      const { s, step } = house([a, b], { [a]: { x: 290, y: 338 }, [b]: { x: 345, y: 338 } });
      step(120);
      const A = s.cats[0].body;
      const B = s.cats[1].body;
      A.computeCentroid();
      B.computeCentroid();
      // b slid right into a, as it is
      B.shift(A.cx + dx - B.cx, A.cy - B.cy);
      step(360);
      expect(inOneAnother(A, B)).toBe(false);
    }
  });

  it('but cats piled up by hand are never slid about or moved: they only ever touch', () => {
    const shift = vi.spyOn(SoftBody.prototype, 'shift');
    let seed = 41;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    applyMyCat({ cat: big() });
    const { s, step, rescued } = house([...ALL_CATS, 'mine'], {});
    step(30);
    for (let g = 0; g < 10; g++) {
      const c = s.cats[g % s.cats.length];
      const b = c.body;
      b.computeCentroid();
      s.beginGrab(c, b.cx, b.cy - b.p.radius * 0.5);
      // into the basket, onto the cushion, onto the vase, and in between
      const tx = [322, 224, 144, 270, 190][g % 5] + (rnd() - 0.5) * 30;
      const ty = 380 + rnd() * 150;
      for (let f = 0; f < 50; f++) {
        b.computeCentroid();
        s.moveGrab(b.cx + (tx - b.cx) * Math.min(1, f / 30), b.cy + (ty - b.cy) * Math.min(1, f / 30), 0, 0);
        step();
      }
      s.endGrab();
      step(100);
    }
    step(200);
    expect(shift).not.toHaveBeenCalled();
    expect(rescued()).toEqual([]);
    expect(allClear(s)).toEqual([]);
  });
});

describe('a cat stuck fast', () => {
  it('is put down again somewhere clear on its floor, with a puff, within a second or so', () => {
    const { s, step, rescued } = house(['kitten', 'tabby'], {});
    step(30);
    const c = s.cats[1];
    // jammed into the long shelf
    c.body.placeAt(300, 344);
    step(1);
    expect(stuckFast(s.world.statics, c.body)).toBe(true);
    step(80);
    expect(rescued().map((e) => e.cat.breed)).toEqual(['tabby']);
    expect(Math.hypot(rescued()[0].x - 300, rescued()[0].y - 344)).toBeLessThan(30);
    step(120);
    expect(allClear(s)).toEqual([]);
    expect(floorAt(c.body.cy)).toBe('living');
  });

  it('but never while it\'s being carried, however hard it\'s pushed into things', () => {
    const { s, step, rescued } = house(['kitten', 'tabby'], {});
    step(30);
    const c = s.cats[1];
    const b = c.body;
    b.computeCentroid();
    s.beginGrab(c, b.cx, b.cy - b.p.radius * 0.5);
    for (let f = 0; f < 150; f++) {
      s.moveGrab(300 + Math.sin(f / 6) * 20, 360, 0, 0);
      step();
    }
    expect(rescued()).toEqual([]);
    s.endGrab();
  });

  it('a cat sitting in the vase or the basket, or under another, isn\'t stuck', () => {
    applyMyCat({ cat: big() });
    const { s, step, rescued } = house([...ALL_CATS, 'mine'], { mine: { x: 322, y: 400 } });
    step(400);
    const seats = Object.fromEntries(s.cats.map((c) => [c.breed, c.seat ? s.containers[c.seat.container].type : null]));
    expect(seats.chonk).toBe('basket');
    expect(seats.void).toBe('vase');
    expect(rescued()).toEqual([]);
    expect(allClear(s)).toEqual([]);
  });
});

it('the day\'s present stands on the window sill, clear of everything, between Pip and the yarn', () => {
  const { s } = house(['kitten', 'tabby'], {});
  const sill = homeFurniture({ attic: false, basement: false }).find((f) => f.type === 'sill')!;
  expect(GIFT_SPOT.y).toBe(sill.y);
  // (its box is 30 wide and its lid 34; its bow 38 up)
  expect(GIFT_SPOT.x - 17).toBeGreaterThanOrEqual(sill.x0);
  expect(GIFT_SPOT.x + 17).toBeLessThan(SPOTS.kitten.x - 22);
  expect(GIFT_SPOT.x + 17).toBeLessThan(YARN_HOME.x - YARN_R);
  for (let x = GIFT_SPOT.x - 17; x <= GIFT_SPOT.x + 17; x += 2) {
    for (let y = GIFT_SPOT.y - 38; y <= GIFT_SPOT.y - 1; y += 2) {
      for (const sh of s.world.statics) expect(distToShape(sh, x, y)).toBeGreaterThan(0);
    }
  }
});
