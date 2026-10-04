import { describe, expect, it } from 'vitest';
import { composeRoom, dailyRoom } from '../src/game/generator';
import { nextDateKey } from '../src/util/date';

describe('daily generator', () => {
  it('is deterministic', () => {
    const a = composeRoom('if-it-fits:2026-10-04', '2026-10-04', 0);
    const b = composeRoom('if-it-fits:2026-10-04', '2026-10-04', 0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produces solvable rooms for a run of mornings', () => {
    let key = '2026-10-01';
    const stats: string[] = [];
    let fallbacks = 0;
    const days = Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DAYS ?? 14);
    for (let i = 0; i < days; i++) {
      const t0 = performance.now();
      const room = dailyRoom(key);
      const ms = Math.round(performance.now() - t0);
      if (room.name === 'Snug Corner') fallbacks++;
      stats.push(`${key} ${room.name.padEnd(24)} cats=${room.cats.map((c) => c.breed).join(',')} par=${room.par} ms=${ms}`);
      expect(room.par).toBeGreaterThan(0);
      key = nextDateKey(key);
    }
    console.log(stats.join('\n'));
    console.log('fallbacks', fallbacks);
  });
});

import INDEX from '../src/game/daily-index.json';
import { GENERATOR_VERSION } from '../src/game/generator';

describe('precomputed mornings', () => {
  it('match what the generator + solver produce today', () => {
    const idx = INDEX as unknown as { v: number; days: Record<string, [number, number, unknown[]]> };
    expect(idx.v).toBe(GENERATOR_VERSION);
    const keys = Object.keys(idx.days);
    expect(keys.length).toBeGreaterThan(90);
    for (const key of [keys[3], keys[Math.floor(keys.length / 2)], keys[keys.length - 1]]) {
      const room = dailyRoom(key);
      expect([room.variant, room.par]).toEqual(idx.days[key].slice(0, 2));
    }
  });
});
