import { describe, expect, it } from 'vitest';
import { emptySave, recordDaily, recordSeats } from '../src/game/save';
import { BASE_BREEDS } from '../src/physics/breeds';
import { roomNumber, previousDateKey, nextDateKey } from '../src/util/date';
import { Rng } from '../src/util/rng';

describe('progress', () => {
  it('counts a streak of mornings', () => {
    const s = emptySave();
    const rec = { cozy: 90, paws: 3, par: 3, faces: '😻', name: 'x', number: 1 };
    recordDaily(s, '2026-10-01', rec);
    recordDaily(s, '2026-10-02', rec);
    recordDaily(s, '2026-10-02', rec);
    expect(s.streak.count).toBe(2);
    recordDaily(s, '2026-10-05', rec);
    expect(s.streak.count).toBe(1);
  });

  it('unlocks the secret cat after all five breeds', () => {
    const s = emptySave();
    const fresh = recordSeats(
      s,
      BASE_BREEDS.map((breed) => ({ breed, score: 90 })),
    );
    expect(fresh).toHaveLength(5);
    expect(s.voidUnlocked).toBe(true);
  });

  it('numbers mornings from launch day', () => {
    expect(roomNumber('2026-10-01')).toBe(1);
    expect(roomNumber('2026-10-04')).toBe(4);
    expect(previousDateKey('2026-11-01')).toBe('2026-10-31');
    expect(nextDateKey('2026-12-31')).toBe('2027-01-01');
  });

  it('rng is seeded and stable', () => {
    const a = new Rng('morning');
    const b = new Rng('morning');
    expect([a.next(), a.next(), a.int(1, 6)]).toEqual([b.next(), b.next(), b.int(1, 6)]);
  });
});
