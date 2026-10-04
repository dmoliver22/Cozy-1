import { describe, expect, it } from 'vitest';
import { HANDMADE } from '../src/game/rooms';
import { solveRoom } from '../src/game/solver';

describe('solver', () => {
  it('solves the hand-made rooms', () => {
    for (const def of HANDMADE) {
      const t0 = performance.now();
      const res = solveRoom(def);
      const ms = performance.now() - t0;
      console.log(def.id, JSON.stringify({ ok: res.ok, par: res.par, cozy: res.cozy, frames: res.frames, failed: res.failed, ms: Math.round(ms) }));
      console.log(JSON.stringify(res.plan));
      expect(res.ok).toBe(true);
    }
  });
});
