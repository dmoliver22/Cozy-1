import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHiss, renderNom, renderScratch } from '../src/audio/sounds';
import { FLOOR_Y } from '../src/game/props';
import { Session, type Cat } from '../src/game/session';
import { Antics, TEMPERS, YARN_HOME, YARN_R, moodOf, scrapChance, temperOf, type AnticsHost } from '../src/house/antics';
import { houseRoom } from '../src/house/homeRoom';
import { emptyHouse, feedFish, hurtCat } from '../src/house/house';
import { houseShell } from '../src/house/layout';
import type { BreedId } from '../src/physics/breeds';
import { tangled } from '../src/proto/drop/game';

/** A stand-in for the home screen: leaps land at once, and sounds and puffs go nowhere. */
function house(
  residents: BreedId[],
  where: Partial<Record<BreedId, { x: number; y: number }>>,
  opts: { offLimits?: AnticsHost['offLimits']; toy?: { x: number; y: number } } = {},
) {
  const offLimits = opts.offLimits ?? (() => false);
  const s = new Session(houseRoom({ open: [], residents, where }), { mode: 'sandbox', shell: houseShell });
  const hurt = new Set<BreedId>();
  const hurtLog: BreedId[] = [];
  const host: AnticsHost = {
    session: s,
    renderer: { puff() {} } as unknown as AnticsHost['renderer'],
    audio: { hiss() {}, scuffle() {}, chitter() {}, boop() {}, impact() {} } as unknown as AnticsHost['audio'],
    day: () => '2026-10-06',
    hurt: (b) => hurt.has(b),
    hurtCat: (c) => {
      hurtLog.push(c.breed);
      hurt.add(c.breed);
    },
    leap: (cat, x, y, _low, land) => {
      cat.body.placeAt(x, y - cat.body.p.radius - 2);
      land?.();
    },
    away: (cat) => cat.grabbed,
    escape: () => null,
    offLimits: (x, y) => offLimits(x, y),
  };
  const antics = new Antics(host);
  for (let f = 0; f < 120; f++) s.step();
  antics.enter(opts.toy ?? null);
  const run = (frames: number, each?: () => void): void => {
    for (let f = 0; f < frames; f++) {
      s.step();
      antics.step();
      each?.();
    }
  };
  const cat = (b: BreedId): Cat => s.cats.find((c) => c.breed === b)!;
  return { s, antics, run, cat, hurtLog };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the cats at home', () => {
  it('each has a temperament, and a mood that holds all day and changes from day to day', () => {
    for (const b of Object.keys(TEMPERS) as BreedId[]) {
      expect(moodOf(b, '2026-10-06')).toBe(moodOf(b, '2026-10-06'));
      const moods = new Set(Array.from({ length: 60 }, (_, d) => moodOf(b, `2026-08-${d}`)));
      expect(moods.size).toBeGreaterThan(1);
    }
    expect(temperOf('tabby', 'sunny').play).toBeGreaterThan(TEMPERS.tabby.play);
    expect(temperOf('tabby', 'grumpy').touchy).toBeGreaterThan(TEMPERS.tabby.touchy);
    expect(temperOf('tabby', 'dozy').lazy).toBeGreaterThan(TEMPERS.tabby.lazy);
    // Pip plays the most, Biscuit the least; Duchess is the touchiest
    expect(TEMPERS.kitten.play).toBe(Math.max(...Object.values(TEMPERS).map((t) => t.play)));
    expect(TEMPERS.chonk.play).toBe(Math.min(...Object.values(TEMPERS).map((t) => t.play)));
    expect(TEMPERS.persian.touchy).toBe(Math.max(...Object.values(TEMPERS).map((t) => t.touchy)));
  });

  it('two touchy cats scrap far more often than a kitten and an easygoing tabby (and more when cross)', () => {
    const t = (b: BreedId) => temperOf(b, null);
    expect(scrapChance(t('void'), t('persian'), false)).toBeGreaterThan(scrapChance(t('kitten'), t('tabby'), false) * 4);
    expect(scrapChance(t('void'), t('persian'), true)).toBeGreaterThan(scrapChance(t('void'), t('persian'), false));
    expect(scrapChance(t('void'), t('persian'), true)).toBeLessThan(1);
  });

  it('a hurt cat is made better with fish, one at a time (no fish, no feeding)', () => {
    const h = emptyHouse();
    h.treats = 3;
    hurtCat(h, 'tabby', 5);
    expect(feedFish(h, 'tabby')).toBe('fed');
    expect(feedFish(h, 'tabby')).toBe('fed');
    expect(feedFish(h, 'tabby')).toBe('fed');
    expect(h.treats).toBe(0);
    expect(feedFish(h, 'tabby')).toBe('empty');
    expect(h.hurt.tabby).toEqual({ need: 5, fed: 3 });
    h.treats = 10;
    expect(feedFish(h, 'tabby')).toBe('fed');
    expect(feedFish(h, 'tabby')).toBe('healed');
    expect(h.hurt.tabby).toBeUndefined();
    expect(h.treats).toBe(8);
    expect(feedFish(h, 'tabby')).toBe('well');
    // hurt again while still hurt: a few more fish
    hurtCat(h, 'kitten', 6);
    hurtCat(h, 'kitten', 6);
    expect(h.hurt.kitten!.need).toBe(9);
  });

  it('the ball of yarn settles on the window sill, flies off when batted, comes to rest again, and stays round', () => {
    const { antics, run } = house(['tabby'], {});
    run(90);
    const toy = antics.toy!;
    toy.computeCentroid();
    expect(Math.abs(toy.cx - YARN_HOME.x)).toBeLessThan(6);
    expect(Math.abs(toy.cy + YARN_R + 2.5 - YARN_HOME.y)).toBeLessThan(5);
    const [x0, y0] = [toy.cx, toy.cy];
    expect(antics.tapToy(toy.cx - 6, toy.cy)).toBe(true);
    let minArea = 1;
    let far = 0;
    run(300, () => {
      toy.computeCentroid();
      minArea = Math.min(minArea, toy.area / toy.area0);
      far = Math.max(far, Math.hypot(toy.cx - x0, toy.cy - y0));
    });
    expect(far).toBeGreaterThan(20);
    expect(Math.abs(toy.vcx) + Math.abs(toy.vcy)).toBeLessThan(20);
    expect(minArea).toBeGreaterThan(0.85);
    expect(tangled(toy)).toBe(false);
    expect(antics.tapToy(toy.cx + 200, toy.cy)).toBe(false);
  });

  it('a cat stalks the yarn: crouches low, wiggles its back end, pounces, and the yarn shoots out from under it', () => {
    // (Pip and the yarn side by side on the window sill; no chasing after it again this time)
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { antics, run, cat } = house(['kitten'], {});
    run(60);
    const pip = cat('kitten');
    const toy = antics.toy!;
    toy.computeCentroid();
    const toyX = toy.cx;
    antics.startStalk(pip, { kind: 'toy' }, 0);
    let crouched = 0;
    let swayed = 0;
    const faces = new Set<string>();
    run(360, () => {
      crouched = Math.max(crouched, pip.body.crouch);
      const f = antics.face(pip);
      if (f) faces.add(f.expression);
      swayed = Math.max(swayed, Math.abs(f?.wiggle?.sway ?? 0));
    });
    expect(crouched).toBe(1);
    expect(swayed).toBeGreaterThan(2);
    expect(faces.has('stalk')).toBe(true);
    expect(antics.stalks.length).toBe(0);
    toy.computeCentroid();
    pip.body.computeCentroid();
    expect(Math.abs(toy.cx - toyX)).toBeGreaterThan(15);
    // never inside the cat
    expect(Math.hypot(toy.cx - pip.body.cx, toy.cy - pip.body.cy)).toBeGreaterThan(pip.body.p.radius);
    expect(pip.body.crouch).toBe(0);
  });

  it('a scrap: the two tumble in a cloud of dust, then pop out apart, untangled, and one may come out hurt', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const { s, antics, run, cat, hurtLog } = house(['tabby', 'persian'], { tabby: { x: 150, y: FLOOR_Y }, persian: { x: 260, y: FLOOR_Y } });
    // (Mochi and Duchess on the floor, a little apart)
    const a = cat('tabby');
    const b = cat('persian');
    antics.startFight(a, b);
    expect(antics.fighting(a) && antics.fighting(b)).toBe(true);
    expect(s.world.bodies).not.toContain(a.body);
    expect(antics.face(a)).toEqual({ expression: 'cross', shadow: false });
    run(60);
    expect(antics.fluff.length).toBeGreaterThan(5);
    run(200);
    expect(antics.fights.length).toBe(0);
    expect(s.world.bodies).toContain(a.body);
    expect(s.world.bodies).toContain(b.body);
    run(120);
    for (const c of [a, b]) {
      c.body.computeCentroid();
      expect(Number.isFinite(c.body.cx)).toBe(true);
      expect(tangled(c.body)).toBe(false);
    }
    expect(Math.hypot(a.body.cx - b.body.cx, a.body.cy - b.body.cy)).toBeGreaterThan(a.body.p.radius + b.body.p.radius - 8);
    expect(hurtLog.length).toBe(1);
    // and they're cross with each other for a while (no playing)
    expect(antics.sulking(a) && antics.sulking(b)).toBe(true);
    expect(antics.turn(a)).toBe(false);
  });

  it('nobody pounces on a cat sitting by a tube\'s open mouth (sliding off its back, the pouncer would fall in)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    // (Mochi and Pip up on the long shelf with a mouth just past its end, and
    // the yarn out of reach up on the top step)
    let mouthX = 245;
    const mouth = (x: number, y: number): boolean => x < mouthX && y > 250 && y < 345;
    const { antics, cat } = house(['kitten', 'tabby'], { kitten: { x: 345, y: 338 }, tabby: { x: 280, y: 338 } }, { offLimits: mouth, toy: { x: 330, y: 128 } });
    expect(antics.turn(cat('kitten'))).toBe(false);
    expect(antics.stalks).toEqual([]);
    // (with the mouth further off, Mochi's fair game)
    mouthX = 180;
    expect(antics.turn(cat('kitten'))).toBe(true);
    expect(antics.stalks[0].target).toEqual({ kind: 'cat', cat: cat('tabby') });
  });

  it('out of a scrap up on a shelf, nobody is flung off it into a mouth below, or back into the other cat', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // (flung hard off the end of the shelf, Mochi would come down in it)
    const mouth = (x: number, y: number): boolean => x < 150 && y > 440;
    const { antics, run, cat } = house(['tabby', 'persian'], { tabby: { x: 280, y: 338 }, persian: { x: 345, y: 338 } }, { offLimits: mouth });
    const a = cat('tabby');
    const b = cat('persian');
    antics.startFight(a, b);
    let out = false;
    let fell = false;
    run(400, () => {
      for (const c of [a, b]) c.body.computeCentroid();
      if (!out && !antics.fights.length) {
        out = true;
        // (popping apart, not back together)
        expect(a.body.vcx * Math.sign(a.body.cx - b.body.cx)).toBeGreaterThanOrEqual(0);
        expect(b.body.vcx * Math.sign(b.body.cx - a.body.cx)).toBeGreaterThanOrEqual(0);
      }
      for (const c of [a, b]) if (mouth(c.body.cx, c.body.cy)) fell = true;
    });
    expect(out).toBe(true);
    expect(fell).toBe(false);
    for (const c of [a, b]) expect(tangled(c.body)).toBe(false);
  });

  it('a tap on the cloud breaks the scrap up, and nobody is hurt', () => {
    const { antics, run, cat, hurtLog } = house(['tabby', 'persian'], { tabby: { x: 150, y: FLOOR_Y }, persian: { x: 260, y: FLOOR_Y } });
    antics.startFight(cat('tabby'), cat('persian'));
    run(30);
    const f = antics.fights[0];
    expect(antics.breakUp(f.x + 300, f.y)).toBe(false);
    expect(antics.breakUp(f.x, f.y)).toBe(true);
    expect(antics.fights.length).toBe(0);
    run(200);
    expect(hurtLog).toEqual([]);
  });

  it('leaving the house mid-scrap puts both cats down, nobody hurt', () => {
    const { s, antics, cat, hurtLog } = house(['tabby', 'persian'], { tabby: { x: 150, y: FLOOR_Y }, persian: { x: 260, y: FLOOR_Y } });
    antics.startFight(cat('tabby'), cat('persian'));
    antics.leave();
    expect(s.world.bodies).toContain(cat('tabby').body);
    expect(s.world.bodies).toContain(cat('persian').body);
    expect(hurtLog).toEqual([]);
  });

  it('the new sounds are real sounds: a hiss, a nom, a scratch', () => {
    for (const buf of [renderHiss(24000, 1, 1), renderNom(24000, 1, 2), renderScratch(24000, 3)]) {
      let peak = 0;
      let sum = 0;
      for (const v of buf) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
      }
      expect(peak).toBeGreaterThan(0.5);
      expect(peak).toBeLessThanOrEqual(1);
      expect(Math.sqrt(sum / buf.length)).toBeGreaterThan(0.02);
    }
  });
});
