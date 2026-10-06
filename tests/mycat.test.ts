import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { TEMPERS } from '../src/house/antics';
import { houseRoom } from '../src/house/homeRoom';
import { NAMES, applyMyCat, emptyHouse, loadHouse, whoIs, writeHouse } from '../src/house/house';
import { houseShell } from '../src/house/layout';
import { BREEDS, hasMyCat, lookKey } from '../src/physics/breeds';
import { COATS, DEFAULT_DESIGN, NAME_MAX, cleanDesign, cleanName, designBreed, designLook, designPhysics, randomDesign, squishWords, type CatDesign } from '../src/physics/mycat';
import { DropGame, tangled } from '../src/proto/drop/game';
import { breedChoices } from '../src/proto/drop/ui';

const design = (over: Partial<CatDesign> = {}): CatDesign => ({ ...DEFAULT_DESIGN, ...over });

/** How wide for its height a cat ends up, dropped on an empty floor and left to settle. */
function settledAspect(d: CatDesign): number {
  applyMyCat({ cat: d });
  const s = new Session({ id: 'open', name: 'open', theme: 'living', furniture: [], decor: [], containers: [], cats: [{ breed: 'mine', x: 190, y: 560, name: 'm' }] }, { settleFrames: 0 });
  const b = s.cats[0].body;
  b.placeAt(190, 300);
  b.wake();
  for (let f = 0; f < 500; f++) s.step();
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
  expect(tangled(b)).toBe(false);
  return (x1 - x0) / (y1 - y0);
}

afterEach(() => applyMyCat({ cat: null }));

describe('your own cat', () => {
  it('a design from storage is made safe: names keep to letters and the like, everything else in range', () => {
    expect(cleanName('<img src=x onerror=alert(1)>Mo')).toBe('img srcx onerroralert1Mo'.slice(0, NAME_MAX));
    expect(cleanName('  Sir   Fluff  ')).toBe('Sir Fluff');
    expect(cleanName("Mrs. O'Mew-Mew")).toBe("Mrs. O'Mew-Mew");
    expect(cleanName('Zoë')).toBe('Zoë');
    expect(cleanName(42)).toBe('');
    expect(cleanDesign(null)).toBeNull();
    const d = cleanDesign({ name: '<b>', coat: 'plaid', pattern: 'stripes', eyes: 'green', fur: 7, size: -1, squish: Number.NaN, personality: 'grumpy' })!;
    expect(d.name).toBe('b');
    expect(d.coat).toBe(DEFAULT_DESIGN.coat);
    expect(d.pattern).toBe('stripes');
    expect(d.eyes).toBe('green');
    expect([d.fur, d.size, d.squish]).toEqual([1, 0, 0.5]);
    expect(d.personality).toBe(DEFAULT_DESIGN.personality);
    // a random one is always a proper design, and never one of the house's names
    for (let k = 0; k < 50; k++) expect(cleanDesign(randomDesign(Math.random, ['Toffee']))).toEqual(expect.objectContaining({ name: expect.not.stringMatching(/^Toffee$/) }));
  });

  it('size makes it bigger and heavier; squish takes it from a firm loaf to a puddle', () => {
    const small = designPhysics(design({ size: 0 }));
    const big = designPhysics(design({ size: 1 }));
    expect(small.radius).toBe(22);
    expect(big.radius).toBe(40);
    expect(big.nodes).toBeGreaterThan(small.nodes);
    expect(big.hop).toBeLessThan(small.hop);
    const loaf = designPhysics(design({ squish: 0 }));
    const custard = designPhysics(design({ squish: 0.5 }));
    const puddle = designPhysics(design({ squish: 1 }));
    // (firm skin and a little shape memory, down to slack skin and none)
    expect(loaf.tension).toBeGreaterThan(custard.tension);
    expect(custard.tension).toBeGreaterThan(puddle.tension);
    expect(loaf.shape).toBeGreaterThan(0);
    expect(puddle.shape).toBe(0);
    expect(puddle.maxStretch).toBeGreaterThan(loaf.maxStretch);
    expect(puddle.hang).toBeLessThan(loaf.hang);
    expect(squishWords(0).short).toBe('loaf');
    expect(squishWords(0.5).flow).toBe('pours like custard');
    expect(squishWords(1).short).toBe('puddle');
  });

  it('settled on the floor, a loaf holds its shape and a puddle spreads out, whatever its size', () => {
    for (const size of [0, 1]) {
      const loaf = settledAspect(design({ size, squish: 0 }));
      const custard = settledAspect(design({ size, squish: 0.5 }));
      const puddle = settledAspect(design({ size, squish: 1 }));
      expect(loaf).toBeLessThan(1.35);
      expect(custard).toBeGreaterThan(loaf + 0.1);
      expect(puddle).toBeGreaterThan(custard + 0.15);
    }
  });

  it('picked up, carried about and dropped, the firmest and the runniest stay in one piece', () => {
    for (const [size, squish] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]) {
      applyMyCat({ cat: design({ size, squish }) });
      const s = new Session(houseRoom({ open: [], residents: ['mine'], where: {} }), { shell: houseShell });
      const c = s.cats[0];
      const b = c.body;
      for (let f = 0; f < 60; f++) s.step();
      b.computeCentroid();
      s.beginGrab(c, b.cx, b.cy - b.p.radius * 0.6);
      let knots = 0;
      for (let f = 0; f < 240; f++) {
        const t = f / 60;
        s.moveGrab(200 + Math.sin(t * 5) * 120, 200 + Math.cos(t * 3.3) * 120, 0, 0);
        s.step();
        if (tangled(b)) knots++;
      }
      s.endGrab();
      for (let f = 0; f < 300; f++) {
        s.step();
        if (tangled(b)) knots++;
      }
      b.computeCentroid();
      expect(Number.isFinite(b.cx)).toBe(true);
      expect(knots).toBe(0);
      expect(b.cy).toBeLessThan(560);
    }
  });

  it('plays Cat Drop: first in the picker once made, and the firmest and runniest both get a fair way down', () => {
    expect(breedChoices()[0]).not.toBe('mine');
    for (const [size, squish] of [
      [0, 0],
      [1, 1],
    ]) {
      applyMyCat({ cat: design({ size, squish }) });
      expect(breedChoices()[0]).toBe('mine');
      const g = new DropGame(2, 'mine');
      g.start();
      for (let f = 0; f < 60 * 60 && g.phase === 'play'; f++) {
        g.cat.computeCentroid();
        const gap = g.level.chunks
          .flatMap((c) => c.gaps)
          .filter((q) => q.y > g.cat.cy)
          .sort((a, b) => a.y - b.y)[0];
        g.steer(gap ? (gap.x0 + gap.x1) / 2 : null);
        g.step();
        expect(Number.isFinite(g.cat.cx)).toBe(true);
      }
      expect(g.state().depth).toBeGreaterThan(150);
    }
  });

  it('is painted in its coat and pattern: patches on white, a pale Siamese, a black cat with gold eyes', () => {
    const patches = designLook(design({ coat: 'black', pattern: 'patches' }));
    expect(patches.body).toBe(COATS.white.body);
    expect(patches.accent).toBe(COATS.black.body);
    expect(patches.dark).toBe(false);
    // (pale all over, its points deeper than its coat)
    const lum = (hex: string): number => [1, 3, 5].reduce((a, k) => a + parseInt(hex.slice(k, k + 2), 16), 0);
    for (const coat of ['chocolate', 'cream'] as const) {
      const points = designLook(design({ coat, pattern: 'points' }));
      expect(points.pattern).toBe('points');
      expect(lum(points.body)).toBeGreaterThan(lum(COATS[coat].body));
      expect(lum(points.accent)).toBeLessThan(lum(COATS[coat].shade));
    }
    const black = designLook(design({ coat: 'black', pattern: 'plain', eyes: 'ink' }));
    expect(black.dark).toBe(true);
    expect(black.pattern).toBe('none');
    expect(black.eye).not.toBe(COATS.black.body);
    expect(designLook(design({ fur: 1 })).bib).toBe(true);
    expect(designLook(design({ fur: 0 })).bib).toBe(false);
  });

  it('moves into the house: its name, its breed and its temperament everywhere, and kept with the house', () => {
    const d = design({ name: 'Pebble', personality: 'sleepy', squish: 0.9 });
    const before = lookKey('mine');
    applyMyCat({ cat: d });
    expect(hasMyCat()).toBe(true);
    expect(lookKey('mine')).not.toBe(before);
    expect(NAMES.mine).toBe('Pebble');
    expect(whoIs('mine')).toBe('Pebble');
    expect(whoIs('kitten')).toBe('Pip the Kitten');
    expect(BREEDS.mine.look.persona).toBe('sleepy');
    expect(BREEDS.mine.flow).toBe(designBreed(d).flow);
    expect(TEMPERS.mine.lazy).toBeGreaterThan(TEMPERS.tabby.lazy);
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    try {
      const h = emptyHouse();
      h.cat = d;
      h.residents.push('mine');
      writeHouse(h);
      const back = loadHouse();
      expect(back.cat).toEqual(d);
      expect(back.residents).toContain('mine');
      // (a house that says your cat lives here but has lost its design drops it)
      store.set('cozy-house:v1', JSON.stringify({ ...h, cat: null }));
      expect(loadHouse().residents).not.toContain('mine');
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
