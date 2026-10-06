import { describe, expect, it } from 'vitest';
import { COAT2_FROM, COAT_FROM, COAT_RAMP, COAT_SHARE, COAT_TIERS, DOZE_FIRST, DROP_GAP, JAR, LAST_TIER, SNUGGLE_FRAMES, TIERS, WILD, WILD_AFTER, coatChance, kindName, pickCoat } from '../src/proto/jar/config';
import { JarGame } from '../src/proto/jar/game';
import { polygonArea } from '../src/util/math';
import type { SoftBody } from '../src/physics/softbody';

const F = JAR.floorY;

function shape(b: SoftBody): { area: number; aspect: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < b.n; i++) {
    x0 = Math.min(x0, b.x[i]);
    x1 = Math.max(x1, b.x[i]);
    y0 = Math.min(y0, b.y[i]);
    y1 = Math.max(y1, b.y[i]);
  }
  return { area: polygonArea(b.x, b.y, b.n) / b.area0, aspect: (x1 - x0) / (y1 - y0) };
}

/** A cat of a tier settled on the floor, maybe with a Void put on top of it. */
function settled(tier: number, loaded: boolean): SoftBody {
  const g = new JarGame('play', 1);
  const c = g.place(tier, 190, F - TIERS[tier].r - 2);
  for (let f = 0; f < 60; f++) g.step();
  if (loaded) g.place(LAST_TIER, 190, F - TIERS[tier].r * 2 - 76);
  for (let f = 0; f < 300; f++) g.step();
  return c.body;
}

/** A game with a pile made by dropping cats along a fixed pattern. */
function pile(seed: number, drops: number): JarGame {
  const g = new JarGame('play', seed);
  const xs = [110, 270, 190, 140, 240, 170, 300, 90, 210, 130, 250, 190, 100, 280, 160, 220, 120, 260, 180, 200, 150, 230];
  for (let k = 0; k < drops; k++) {
    g.reload();
    g.aimNow(xs[k % xs.length]);
    g.drop();
    for (let f = 0; f < 70; f++) g.step();
  }
  for (let f = 0; f < 300; f++) g.step();
  return g;
}

describe('Cat Jar', () => {
  it('the next cat hangs a set height over the pile and rises with it', () => {
    const g = new JarGame('play', 9);
    expect(g.holdBase).toBe(JAR.floorY - DROP_GAP);
    // a chonk and a Maine Coon on the floor (they don't melt)
    g.place(4, 140, JAR.floorY - 56);
    g.place(3, 250, JAR.floorY - 44);
    for (let f = 0; f < 300; f++) g.step();
    expect(g.pileTop()).toBeLessThan(JAR.floorY - 80);
    expect(Math.abs(g.holdBase - (g.pileTop() - DROP_GAP))).toBeLessThan(11);
    g.reload();
    const w = g.waiting!;
    expect(g.holdY(w.tier)).toBeCloseTo(g.holdBase - TIERS[w.tier].r, 6);
  });

  it('a boop always shows: a cat buried under others still hops', () => {
    const base = pile(11, 22);
    // every cat with others piled on it
    const buried = base.cats.map((c, k) => ({ k, above: base.stackAbove(c).length })).filter((b) => b.above > 0);
    expect(buried.length).toBeGreaterThan(1);
    for (const { k } of buried) {
      const g = pile(11, 22);
      const c = g.cats[k];
      c.body.computeCentroid();
      const y0 = c.body.cy;
      g.boops = 5;
      expect(g.boop(c, c.body.cx)).toBe(true);
      let rise = 0;
      for (let f = 0; f < 40; f++) {
        g.step();
        c.body.computeCentroid();
        rise = Math.max(rise, y0 - c.body.cy);
      }
      // at least a third of the hop it makes on its own (1.2 radii + 16)
      expect(rise).toBeGreaterThan((TIERS[c.tier].r * 1.2 + 16) / 3);
    }
  });

  it('twins melt once they have snuggled a moment, not on a passing bump', () => {
    const g = new JarGame('play', 1);
    const r = TIERS[1].r;
    const a = g.place(1, 150, F - r - 2);
    const b = g.place(1, 150 + r * 2 + 5.5, F - r - 2);
    let touched = -1;
    let merged = -1;
    for (let f = 0; f < 200 && merged < 0; f++) {
      g.step();
      if (touched < 0 && g.snuggles().length) touched = f;
      for (const e of g.drain()) if (e.t === 'merge') merged = f;
    }
    expect(a.removed && b.removed).toBe(true);
    expect(merged - touched).toBeGreaterThanOrEqual(SNUGGLE_FRAMES - 1);
  });

  it('a cat left still a while dozes off, and wakes when its twin cuddles up to it: they melt', () => {
    const g = new JarGame('play', 1);
    const r = TIERS[2].r;
    const sleeper = g.place(2, 130, F - r - 3);
    for (let f = 0; f < DOZE_FIRST + 30; f++) g.step();
    expect(g.dozing(sleeper)).toBe(true);
    // a twin settles against it, as gently as can be (a Persian spreads out
    // as it settles: it's put down just clear of the sleeper's edge)
    let edge = -Infinity;
    for (let i = 0; i < sleeper.body.n; i++) edge = Math.max(edge, sleeper.body.x[i]);
    g.place(2, edge + r + 2, F - r - 3);
    let merged = -1;
    for (let f = 0; f < 200 && merged < 0; f++) {
      g.step();
      if (g.snuggles().length) expect(g.dozing(sleeper)).toBe(false);
      for (const e of g.drain()) if (e.t === 'merge') merged = f;
    }
    expect(merged).toBeGreaterThanOrEqual(SNUGGLE_FRAMES - 1);
    expect(g.cats.map((c) => c.tier)).toEqual([3]);
  });

  it('only twins in the same coat snuggle, and two of a coat make the next kind in that coat', () => {
    // a grey kitten and a ginger one side by side: not twins
    const g = new JarGame('play', 1);
    g.place(0, 150, F - 20);
    g.place(0, 150 + 18.5 * 2 + 5.5, F - 20, 1);
    for (let f = 0; f < 200; f++) g.step();
    expect(g.cats.map((c) => [c.tier, c.coat])).toEqual([
      [0, 0],
      [0, 1],
    ]);
    // two ginger kittens melt into a Silver Tabby (a tabby, in their coat)
    const g2 = new JarGame('play', 1);
    g2.place(0, 150, F - 20, 1);
    g2.place(0, 150 + 18.5 * 2 + 5.5, F - 20, 1);
    for (let f = 0; f < 200; f++) g2.step();
    expect(g2.cats.map((c) => [c.tier, c.coat])).toEqual([[1, 1]]);
    expect(kindName(1, 1)).toBe('Silver Tabby');
    // at the top of the drops, either coat makes a Maine Coon
    const g3 = new JarGame('play', 1);
    const r = TIERS[2].r;
    g3.place(2, 130, F - r - 3, 1);
    g3.place(2, 130 + r * 2 + 5.5, F - r - 3, 1);
    for (let f = 0; f < 200; f++) g3.step();
    expect(g3.cats.map((c) => [c.tier, c.coat])).toEqual([[3, 0]]);
  });

  it('the neighbours\' cats turn up after the first few drops, more of them as the afternoon wears on', () => {
    expect(coatChance(0)).toBe(0);
    expect(coatChance(COAT_FROM - 1)).toBe(0);
    expect(coatChance(COAT_FROM)).toBeGreaterThan(0);
    for (let d = COAT_FROM; d < COAT_FROM + COAT_RAMP; d += 10) expect(coatChance(d + 10)).toBeGreaterThanOrEqual(coatChance(d));
    expect(coatChance(COAT_FROM + COAT_RAMP)).toBeCloseTo(COAT_SHARE, 9);
    expect(coatChance(5000)).toBeCloseTo(COAT_SHARE, 9);
    // late in a game, about that share of the drops are the neighbours' cats, half of each neighbour's
    const g = new JarGame('play', 5);
    g.drops = COAT_FROM + COAT_RAMP + 10;
    const count = [0, 0, 0];
    for (let k = 0; k < 300; k++) {
      g.setQueue([]);
      for (const q of g.queue) if (q.tier < COAT_TIERS) count[q.coat]++;
    }
    const n = count[0] + count[1] + count[2];
    expect((count[1] + count[2]) / n).toBeGreaterThan(COAT_SHARE - 0.07);
    expect((count[1] + count[2]) / n).toBeLessThan(COAT_SHARE + 0.07);
    expect(Math.abs(count[1] - count[2]) / n).toBeLessThan(0.08);
    // the second neighbour comes round only after a while
    for (let d = 0; d < COAT2_FROM; d++) for (const r2 of [0, 0.3, 0.7]) expect(pickCoat(d, 0, r2)).toBeLessThan(2);
    expect(pickCoat(COAT2_FROM, 0, 0.2)).toBe(2);
    expect(kindName(2, 2)).toBe('Blue Persian');
  });

  it('a boop wakes a dozing cat', () => {
    const g = new JarGame('play', 1);
    const sleeper = g.place(2, 130, F - TIERS[2].r - 3);
    for (let f = 0; f < DOZE_FIRST + 30; f++) g.step();
    expect(g.dozing(sleeper)).toBe(true);
    expect(g.boop(sleeper, 120)).toBe(true);
    expect(g.dozing(sleeper)).toBe(false);
  });

  describe('breeds have their ways', () => {
    it('a kitten hops about before it settles, and toward another kitten', () => {
      const g = new JarGame('play', 1);
      g.setQueue([0, 2, 2]);
      g.aimNow(150);
      g.drop();
      const kitten = g.cats[0];
      let hops = 0;
      for (let f = 0; f < 400; f++) {
        g.step();
        for (const e of g.drain()) if (e.t === 'hop') hops++;
      }
      expect(hops).toBe(3);
      kitten.body.computeCentroid();
      expect(Math.abs(kitten.body.cx - 150)).toBeGreaterThan(25);
      // dropped off to one side of a kitten resting on the floor, it hops over and they melt
      const h = new JarGame('play', 1);
      h.place(1, 270, F - 26);
      h.place(0, 120, F - 20);
      for (let f = 0; f < 60; f++) h.step();
      h.setQueue([0, 2, 2]);
      h.aimNow(205);
      h.drop();
      for (let f = 0; f < 300; f++) h.step();
      expect(h.cats.map((c) => TIERS[c.tier].name).sort()).toEqual(['Tabby', 'Tabby']);
    });

    it('a Maine Coon squashes down under a load, a Persian spreads out, a tabby keeps its loaf', () => {
      const coon = shape(settled(3, true));
      expect(coon.area).toBeLessThan(0.85);
      const persian = shape(settled(2, false));
      const tabby = shape(settled(1, false));
      expect(persian.aspect).toBeGreaterThan(1.8);
      expect(tabby.aspect).toBeLessThan(1.5);
    });

    it('a new chonk pops up the small cats round it', () => {
      const g = new JarGame('play', 1);
      // a Maine Coon on the floor between a kitten and a tabby, and another landing on it
      g.place(3, 190, F - 44);
      g.place(0, 110, F - 20);
      g.place(1, 268, F - 26);
      for (let f = 0; f < 40; f++) g.step();
      g.place(3, 190, F - 140);
      let popped = 0;
      for (let f = 0; f < 200; f++) {
        g.step();
        for (const e of g.drain()) if (e.t === 'pop') popped += e.popped.length;
      }
      expect(g.cats.some((c) => TIERS[c.tier].breed === 'chonk')).toBe(true);
      expect(popped).toBeGreaterThan(0);
    });

    it('a Little Void melts into any cat, making it one size bigger (a Void: both vanish)', () => {
      for (const [tier, after, points] of [
        [1, ['Persian'], 30],
        [LAST_TIER, [], 1000],
      ] as const) {
        const g = new JarGame('play', 1);
        g.place(tier, 190, F - TIERS[tier].r - 2);
        for (let f = 0; f < 60; f++) g.step();
        g.setQueue([WILD, 0, 0]);
        g.aimNow(190);
        g.drop();
        for (let f = 0; f < 200; f++) g.step();
        expect(g.cats.map((c) => TIERS[c.tier].name)).toEqual(after);
        expect(g.score).toBe(points);
      }
    });

    it('Little Voids turn up now and then, never in the first drops', () => {
      let wilds = 0;
      let drops = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const g = new JarGame('daily', seed);
        for (let k = 0; k < 120; k++) {
          g.reload();
          if (g.waiting!.tier === WILD) {
            expect(k).toBeGreaterThanOrEqual(WILD_AFTER);
            wilds++;
          }
          drops++;
          g.drop();
          // (an empty jar each time: only the queue matters here)
          for (const c of g.cats) g.world.removeBody(c.body);
          g.cats.length = 0;
        }
      }
      expect(wilds / drops).toBeGreaterThan(0.01);
      expect(wilds / drops).toBeLessThan(0.05);
    });
  });
});
