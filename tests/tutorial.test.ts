import { describe, expect, it } from 'vitest';
import { Session, type Cat } from '../src/game/session';
import { FALL, gadgetOf, lowest } from '../src/playground/layout';
import { SkySim, type SkyEvent } from '../src/playground/sim';
import { TOUR_CAT, TOUR_START, Tour, course, hammockDrop, hammockOf, nearCannon, settleCourse } from '../src/playground/tutorial';
import { SPAWN } from '../src/playground/layout';
import { cannonMouth } from '../src/playground/gadgets';

// The first-time tour's course, run the way the Playground runs it: the
// session's step, then the sky's.
function setUp(breed = TOUR_CAT): { s: Session; sim: SkySim; cat: Cat; sea: number } {
  const save = course();
  let s!: Session;
  const sim = new SkySim(() => s);
  s = new Session(
    { id: 'playground', name: 'Playground', theme: 'living', furniture: [], containers: [], decor: [], cats: [{ breed, x: TOUR_START.x, y: SPAWN.y, name: 'Pip' }] },
    { shell: () => sim.build(save), spawnOk: () => true, unmerge: true },
  );
  sim.start();
  settleCourse(sim);
  return { s, sim, cat: s.cats[0], sea: lowest(save) + FALL };
}

/** From the cannon on: every step's events, until it's curled up in the hammock (or `frames` run out). */
function ride(w: ReturnType<typeof setUp>, tour: Tour, frames = 60 * 16, nudge?: (e: SkyEvent, cat: Cat) => void): { seen: string[]; at: [number, number] } {
  const seen: string[] = [];
  for (let f = 0; f < frames && tour.stage === 'ride'; f++) {
    w.s.step();
    for (const e of w.sim.step(w.sea)) {
      seen.push(e.t);
      tour.heard(e);
      nudge?.(e, w.cat);
      if (e.t === 'load') tour.loaded();
    }
    const r = tour.step(w.sim, w.cat);
    if (r === 'rescue') {
      const h = hammockDrop(w.sim)!;
      w.cat.body.reset(h.x, h.y);
    }
  }
  w.cat.body.computeCentroid();
  return { seen, at: [w.cat.body.cx, w.cat.body.cy] };
}

describe('the first-time tour', () => {
  it('a boop, then into the cannon: pomf, through the tube, the fan, boing, and snug in the hammock', () => {
    const w = setUp();
    const tour = new Tour();
    expect(tour.stage).toBe('boop');
    expect(tour.sub).toMatch(/Tap .* boop/);
    tour.booped();
    expect(tour.stage).toBe('carry');
    // carried over and let go near the cannon's mouth (not quite at it: near is near enough)
    const g = w.sim.toys().find((t) => t.kind === 'cannon')!;
    const m = cannonMouth(g);
    expect(nearCannon(w.sim, m.zx - 60, m.zy + 70)).toEqual(g);
    expect(nearCannon(w.sim, -100, 0)).toBeNull();
    expect(w.sim.works.load(w.cat, g)).toBe(true);
    tour.loaded();
    expect(tour.handsOff).toBe(true);
    const { seen } = ride(w, tour);
    expect(tour.stage).toBe('snug');
    // everything, in order, once each
    const order = ['fire', 'in', 'out', 'boing'].map((t) => seen.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(seen).not.toContain('fell');
    expect(hammockOf(w.sim)!.sling!.riders).toContain(w.cat.body);
    // (it's not been helped along)
    expect(seen.filter((t) => t === 'boing')).toHaveLength(1);
    // a little while curled up, then off home
    const said: string[] = [];
    for (let f = 0; f < 600 && said[said.length - 1] !== 'leave'; f++) {
      const r = tour.step(w.sim, w.cat);
      if (r) said.push(r);
    }
    expect(said).toEqual(['home', 'leave']);
    expect(tour.line).toMatch(/home/);
  });

  it('the same ride every time, however long the cat takes to get there and however it goes in', () => {
    const ends: [number, number][] = [];
    for (const [pre, how] of [
      [3, 'still'],
      [140, 'flung'],
      [433, 'carried'],
    ] as const) {
      const w = setUp();
      // a while on the cloud first, being played with
      for (let f = 0; f < pre; f++) {
        w.s.step();
        w.sim.step(w.sea);
        if (how === 'flung' && f === 20) w.cat.body.kick(300, -500);
        if (how === 'carried' && f === 30) w.cat.body.placeAt(-90, -150);
      }
      const tour = new Tour();
      tour.booped();
      const g = w.sim.toys().find((t) => t.kind === 'cannon')!;
      if (w.sim.works.inCannon(w.cat) === null) expect(w.sim.works.load(w.cat, g)).toBe(true);
      tour.loaded();
      ends.push(ride(w, tour).at);
      expect(tour.stage).toBe('snug');
    }
    expect(ends[1]).toEqual(ends[0]);
    expect(ends[2]).toEqual(ends[0]);
  });

  it('with room to spare: nudged on its way, it still ends up in the hammock', () => {
    for (const [at, dx, dy] of [
      ['fire', 25, 0],
      ['fire', -25, 0],
      ['fire', 0, 25],
      ['fire', 0, -25],
      // (way off: the funnel on the tube still catches it)
      ['fire', 212, 212],
      ['fire', -212, -212],
      ['fire', -212, 212],
      ['out', 15, 15],
      ['out', -15, -15],
      ['boing', 12, 0],
      ['boing', -12, 0],
    ] as const) {
      const w = setUp();
      const tour = new Tour();
      tour.booped();
      w.sim.works.load(w.cat, w.sim.toys().find((t) => t.kind === 'cannon')!);
      tour.loaded();
      const { seen } = ride(w, tour, 60 * 16, (e, cat) => {
        if (e.t === at) cat.body.kick(dx, dy);
      });
      expect(tour.stage, `${at} ${dx},${dy}`).toBe('snug');
      expect(seen).not.toContain('fell');
    }
  });

  it('one that goes astray anyway is put in the hammock', () => {
    const w = setUp();
    const tour = new Tour();
    tour.booped();
    w.sim.works.load(w.cat, w.sim.toys().find((t) => t.kind === 'cannon')!);
    tour.loaded();
    // (knocked right off course the moment it's out of the tube: onto the respawn cloud, say)
    const { seen } = ride(w, tour, 60 * 30, (e, cat) => {
      if (e.t === 'out') cat.body.reset(0, -40);
    });
    expect(seen).toContain('out');
    expect(tour.stage).toBe('snug');
    expect(hammockOf(w.sim)!.sling!.riders).toContain(w.cat.body);
  });

  it('the course is its own: nothing of it in your playground, and its cannon is where the cat starts', () => {
    const c = course();
    const cannon = c.pieces.map(gadgetOf).find((g) => g?.kind === 'cannon')!;
    expect(Math.abs(cannon.x - TOUR_START.x)).toBeLessThan(SPAWN.half);
    expect(Math.abs(TOUR_START.x - SPAWN.x)).toBeLessThan(SPAWN.half - 30);
    expect(course()).not.toBe(c);
  });
});
