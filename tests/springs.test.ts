import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { houseRoom } from '../src/house/homeRoom';
import { FLOORS, houseShell } from '../src/house/layout';
import { BOUNCE, PERCHES, buildPerch, floorTop, type PerchKind } from '../src/house/perches';
import type { BreedId } from '../src/physics/breeds';
import type { SoftBody } from '../src/physics/softbody';
import { FRAME_DT, GRAVITY } from '../src/physics/world';
import { tangled } from '../src/proto/drop/game';

/**
 * A perch out on the roof garden (open sky, nothing in the way), a cat, and
 * a step that does what the home screen does for the perches that move.
 */
function roof(kind: PerchKind, x: number, y: number, breed: BreedId) {
  const p = buildPerch({ id: 50, kind, x, y });
  const s = new Session(houseRoom({ open: ['roof'], residents: [breed], where: { [breed]: { x: 140, y: FLOORS.roof.floorY } } }), { mode: 'sandbox', shell: () => [...houseShell(), ...p.shapes] });
  const cat = s.cats[0];
  const fell = new WeakMap<SoftBody, number>();
  const step = (): void => {
    s.step();
    if (p.sling) {
      p.sling.gather(s.world.bodies);
      p.sling.step(FRAME_DT, GRAVITY);
    }
    if (p.bouncer) p.bouncer.step(s.world.bodies, () => true, (b) => fell.get(b) ?? 0);
    for (const b of s.world.bodies) {
      b.computeCentroid();
      fell.set(b, b.vcy);
    }
  };
  const drop = (at: number, height: number, vx = 0): void => {
    cat.body.placeAt(at, height - cat.body.p.radius);
    cat.body.wake();
    if (vx) cat.body.kick(vx, 0);
  };
  return { p, s, cat, step, drop };
}

describe('the perches that move', () => {
  it('a cat dropped on a bouncy cushion bounces back up, less each time, then sits on it', () => {
    for (const breed of ['kitten', 'chonk'] as BreedId[]) {
      const y = floorTop('bounce', 'roof');
      const { cat, step, drop } = roof('bounce', 200, y, breed);
      drop(200, y - 400);
      const tops: number[] = [];
      let up = false;
      for (let f = 0; f < 600; f++) {
        step();
        cat.body.computeCentroid();
        const rising = cat.body.vcy < -20;
        if (up && !rising) tops.push(y - (cat.body.cy + cat.body.p.radius));
        up = rising;
      }
      // (up most of the way it fell, and less each time after)
      expect(tops[0]).toBeGreaterThan(400 * 0.45);
      expect(tops[0]).toBeLessThan(400);
      expect(tops[1]).toBeLessThan(tops[0]);
      expect(tops.filter((t) => t > 20).length).toBeGreaterThanOrEqual(3);
      // then it's sitting on top of it, still, in the middle
      cat.body.computeCentroid();
      expect(Math.abs(cat.body.cx - 200)).toBeLessThan(BOUNCE.w / 2);
      expect(Math.abs(cat.body.cy + cat.body.p.radius - y)).toBeLessThan(14);
      expect(Math.abs(cat.body.vcy)).toBeLessThan(5);
      expect(tangled(cat.body)).toBe(false);
    }
  });

  it('a hammock dips and sways under a cat landing in it, settles cradling it, deeper for a heavier cat, and springs back up when it\'s empty', () => {
    const y = FLOORS.roof.floorY - 260;
    const sag: Partial<Record<BreedId, number>> = {};
    for (const breed of ['kitten', 'chonk'] as BreedId[]) {
      const { p, cat, step, drop } = roof('hammock', 200, y, breed);
      const sl = p.sling!;
      for (let f = 0; f < 30; f++) step();
      const empty = sl.bottom.y;
      drop(212, y - 60, 50);
      let deepest = 0;
      let swing = 0;
      for (let f = 0; f < 600; f++) {
        step();
        deepest = Math.max(deepest, sl.bottom.y - empty);
        swing = Math.max(swing, Math.abs(sl.x[4] - 200));
      }
      cat.body.computeCentroid();
      // it's lying in it, in the middle, asleep, and the cloth's under it, lower than it hung empty
      expect(Math.abs(cat.body.cx - 200)).toBeLessThan(14);
      expect(cat.body.cy).toBeLessThan(sl.bottom.y);
      expect(cat.body.asleep).toBe(true);
      sag[breed] = sl.bottom.y - empty;
      expect(sag[breed]).toBeGreaterThan(6);
      expect(deepest).toBeGreaterThan(sag[breed]!);
      expect(swing).toBeGreaterThan(3);
      // its colliders are where its cloth is (the cat rides with it)
      const link = p.shapes[3];
      expect(Math.abs((link.minY + link.maxY) / 2 - (sl.y[3] + sl.y[4]) / 2)).toBeLessThan(1);
      // out it hops: up the cloth springs, back to how it hung
      cat.body.placeAt(60, FLOORS.roof.floorY - cat.body.p.radius - 2);
      for (let f = 0; f < 240; f++) step();
      expect(Math.abs(sl.bottom.y - empty)).toBeLessThan(1.5);
      expect(tangled(cat.body)).toBe(false);
    }
    expect(sag.chonk!).toBeGreaterThan(sag.kitten!);
  });

  it('a cat dropped into a cat bed sits down inside it, between the bolsters', () => {
    for (const breed of ['kitten', 'tabby', 'chonk'] as BreedId[]) {
      const y = floorTop('bed', 'roof');
      const { cat, step, drop } = roof('bed', 200, y, breed);
      drop(200, y - 80);
      for (let f = 0; f < 300; f++) step();
      cat.body.computeCentroid();
      let bottom = -Infinity;
      for (let i = 0; i < cat.body.n; i++) bottom = Math.max(bottom, cat.body.y[i]);
      expect(Math.abs(cat.body.cx - 200)).toBeLessThan(12);
      expect(Math.abs(bottom - y)).toBeLessThan(8);
      expect(bottom).toBeLessThan(y + PERCHES.bed.height);
    }
  });
});
