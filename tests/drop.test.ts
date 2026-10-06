import { describe, expect, it } from 'vitest';
import { DropGame, tangled } from '../src/proto/drop/game';
import { Level, UNITS_PER_M } from '../src/proto/drop/level';

describe('Cat Drop boost slides', () => {
  it('turn up every so often: a funnel into a long glass slide with a corkscrew in it', () => {
    let levels = 0;
    let slides = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const L = new Level(seed);
      L.ensure(40000);
      const b = L.chunks.filter((c) => c.kind === 'boost');
      if (b.length) levels++;
      slides += b.length;
      for (const c of b) {
        const z = c.boosts[0];
        const path = z.tube.path;
        // from its mouth, a long way down...
        expect(path[0]).toEqual([z.x, z.y]);
        expect(path[path.length - 1][1] - z.y).toBeGreaterThan(800);
        // ...going round: somewhere it climbs back up for a while
        expect(path.some((p, i) => i > 0 && p[1] < path[i - 1][1] - 2)).toBe(true);
        expect(c.art.some((a) => a.k === 'slide') && c.art.some((a) => a.k === 'funnel')).toBe(true);
      }
    }
    // (now and then: in nearly every run, a few times in 800 m)
    expect(levels).toBeGreaterThan(30);
    expect(slides / 40).toBeGreaterThan(1.5);
    expect(slides / 40).toBeLessThan(6);
    // never in the attic
    expect(new Level(3).chunks.filter((c) => c.storey === 0 && c.kind === 'boost')).toEqual([]);
  });

  it('a cat that drops into one whooshes round and down, out much further on and faster than falling', () => {
    // the first seed with a slide near the top of the house
    let seed = 1;
    for (; seed < 200; seed++) {
      const L = new Level(seed);
      L.ensure(8000);
      if (L.chunks.some((c) => c.kind === 'boost' && c.y0 < 6000)) break;
    }
    const g = new DropGame(seed, 'tabby');
    g.start();
    let rideFrames = 0;
    let inAt = -1;
    let depthIn = 0;
    let outAt = -1;
    for (let f = 0; f < 60 * 120 && g.phase === 'play'; f++) {
      g.cat.computeCentroid();
      // steer for the slide's mouth once over it, otherwise for the nearest way down
      const slide = g.level.chunks.find((c) => c.boosts.length && c.y0 - 60 < g.cat.cy && c.y1 > g.cat.cy);
      if (slide) g.steer(slide.boosts[0].x);
      else {
        const gap = g.level.chunks
          .flatMap((c) => c.gaps)
          .filter((q) => q.y > g.cat.cy)
          .sort((a, b) => a.y - b.y)[0];
        g.steer(gap ? (gap.x0 + gap.x1) / 2 : null);
      }
      // (bath time kept well back)
      g.foamY = Math.min(g.foamY, g.catTop() - 700);
      g.step();
      if (g.riding) {
        if (inAt < 0) {
          inAt = f;
          depthIn = g.deepest;
          expect(g.world.bodies).not.toContain(g.cat);
          expect(g.events.some((e) => e.t === 'boost')).toBe(true);
          // (a tap mid-ride does nothing: no hopping out of the glass)
          expect(g.bounce()).toBe(false);
        }
        rideFrames++;
      } else if (inAt >= 0) {
        outAt = f;
        break;
      }
    }
    expect(inAt).toBeGreaterThan(0);
    expect(outAt).toBeGreaterThan(inAt);
    const metres = (g.deepest - depthIn) / UNITS_PER_M;
    expect(metres).toBeGreaterThan(15);
    // faster than falling flat out (the soft cap on a fall is 720 units/s)
    expect((g.deepest - depthIn) / (rideFrames / 60)).toBeGreaterThan(720 * 1.2);
    // out, round again, in the world, and on its way down
    expect(g.world.bodies).toContain(g.cat);
    expect(tangled(g.cat)).toBe(false);
    g.cat.computeCentroid();
    expect(g.cat.vcy).toBeGreaterThan(400);
    expect(g.events.some((e) => e.t === 'boostOut')).toBe(true);
  });
});
