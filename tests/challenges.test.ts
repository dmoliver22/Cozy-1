import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { SkySim } from '../src/playground/sim';
import { FALL, lowest, snapFunnel, tubeLength, type PlayPiece, type PlaySave, type PlayTube } from '../src/playground/layout';
import { Attempt, CHALLENGES, CHALLENGE_CAT, holdInCannon, kitLeft, ofCourse, setOff, startSpot, unlocked, yours, type Challenge, type Outcome } from '../src/playground/challenges';
import { settleCourse } from '../src/playground/tutorial';

// A go at a challenge, as the Playground runs it: a fresh world with the
// course and your pieces, the cat at the start, a moment's wait, Go, and
// watching till it's made it or not.
function attempt(ch: Challenge, add: { pieces: PlayPiece[]; tubes: PlayTube[] }, wait = 20): Outcome | null {
  const c = ch.course();
  const sv: PlaySave = { ...c, pieces: [...c.pieces, ...add.pieces], tubes: [...c.tubes, ...add.tubes] };
  const at = startSpot(ch, c);
  let s!: Session;
  const sim = new SkySim(() => s);
  s = new Session(
    { id: 'playground', name: 'Playground', theme: 'living', furniture: [], containers: [], decor: [], cats: [{ breed: CHALLENGE_CAT, x: at.x, y: at.y, name: 'Pip' }] },
    { shell: () => sim.build(sv, false), spawnOk: () => true, unmerge: true },
  );
  sim.start();
  settleCourse(sim);
  const cat = s.cats[0];
  holdInCannon(ch, sim, cat);
  const sea = lowest(sv) + FALL;
  for (let f = 0; f < wait; f++) {
    s.step();
    sim.step(sea);
  }
  setOff(ch, sim, s, cat);
  const a = new Attempt(ch);
  for (let f = 0; f < 60 * 14; f++) {
    s.step();
    for (const e of sim.step(sea)) a.heard(e);
    const o = a.step(sim, cat);
    if (o) return o;
  }
  return null;
}

describe('challenges', () => {
  for (const ch of CHALLENGES) {
    it(`${ch.name}: the way that works works (however long you wait to press Go), and nothing at all doesn't`, () => {
      expect(attempt(ch, ch.solution)).toEqual({ t: 'won' });
      expect(attempt(ch, ch.solution, 333)).toEqual({ t: 'won' });
      expect(attempt(ch, { pieces: [], tubes: [] })?.t).toBe('lost');
      // (and with more than one thing in the kit, no one of them does it alone)
      if (ch.solution.pieces.length > 1)
        for (const p of ch.solution.pieces) expect(attempt(ch, { pieces: [p], tubes: [] })?.t, `${ch.id} with only ${p.kind}`).toBe('lost');
    });

    it(`${ch.name}: its way is made of its kit, put the way a player could put it`, () => {
      const c = ch.course();
      const sv: PlaySave = { ...c, pieces: [...c.pieces, ...ch.solution.pieces], tubes: [...c.tubes, ...ch.solution.tubes] };
      expect(kitLeft(ch, sv).every((k) => k.n === 0)).toBe(true);
      expect(yours(ch, sv).pieces).toHaveLength(ch.solution.pieces.length);
      for (const p of ch.solution.pieces) {
        expect(ofCourse(ch, p.id)).toBe(false);
        // (a funnel on a tube's end: where it snaps)
        if (p.kind === 'funnel') expect(snapFunnel(p.x, p.y, c.tubes)).toEqual({ x: p.x, y: p.y, aim: p.aim });
      }
      for (const t of ch.solution.tubes) expect(tubeLength(t)).toBeLessThanOrEqual(ch.kit.find((k) => k.kind === 'tube')!.max!);
      expect(c.pieces.some((p) => p.id === ch.target)).toBe(true);
      expect(c.pieces.some((p) => p.id === ch.start.piece)).toBe(true);
    });
  }

  it('one at a time: the first is open, and each after one that is done', () => {
    expect(unlocked(0, [])).toBe(true);
    expect(unlocked(1, [])).toBe(false);
    expect(unlocked(1, [CHALLENGES[0].id])).toBe(true);
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
    // more treats the further you get
    for (let i = 1; i < CHALLENGES.length; i++) expect(CHALLENGES[i].treats).toBeGreaterThanOrEqual(CHALLENGES[i - 1].treats);
  });
});
