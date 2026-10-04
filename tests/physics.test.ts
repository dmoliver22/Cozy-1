import { describe, expect, it } from 'vitest';
import { BREED_ORDER, type BreedId } from '../src/physics/breeds';
import { SoftBody } from '../src/physics/softbody';
import { GRAVITY, World } from '../src/physics/world';
import { buildContainer, roomShell } from '../src/game/props';
import { LIFT } from '../src/game/session';
import { polygonArea, dsin, dcos } from '../src/util/math';

function dropInto(breed: BreedId, container?: 'teacup' | 'box'): { body: SoftBody; world: World } {
  const world = new World();
  for (const s of roomShell()) world.addStatic(s);
  if (container) for (const s of buildContainer({ type: container, x: 180, y: 560 }).shapes) world.addStatic(s);
  const body = world.addBody(new SoftBody(breed, 180, 380));
  for (let f = 0; f < 360; f++) world.step();
  return { body, world };
}

describe('soft-body cats', () => {
  it('deterministic trig matches Math within 1e-12', () => {
    for (let x = -10; x <= 10; x += 0.37) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-12);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-12);
    }
  });

  it.each(BREED_ORDER)('%s keeps its volume and comes to rest on the floor', (breed) => {
    const { body } = dropInto(breed);
    const area = polygonArea(body.x, body.y, body.n);
    expect(area / body.area0).toBeGreaterThan(breed === 'mainecoon' ? 0.75 : 0.93);
    expect(area / body.area0).toBeLessThan(1.05);
    expect(body.emaEnergy).toBeLessThan(50);
    for (let i = 0; i < body.n; i++) {
      expect(Number.isFinite(body.x[i])).toBe(true);
      expect(body.y[i]).toBeLessThan(561);
    }
  });

  it('is bit-for-bit deterministic', () => {
    const a = dropInto('chonk', 'teacup').body;
    const b = dropInto('chonk', 'teacup').body;
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(Array.from(a.y)).toEqual(Array.from(b.y));
  });

  it('every cat can be picked up, heavy cats just rise more slowly', () => {
    const early: Record<string, number> = {};
    for (const breed of BREED_ORDER) {
      const world = new World();
      for (const s of roomShell()) world.addStatic(s);
      const body = world.addBody(new SoftBody(breed, 180, 520));
      for (let f = 0; f < 60; f++) world.step();
      body.computeCentroid();
      const startY = body.cy;
      body.startGrab(body.cx, body.cy - 5, body.p.pull * body.mass * GRAVITY, LIFT);
      for (let f = 1; f <= 120; f++) {
        body.grab!.tx = 180;
        body.grab!.ty = startY - 200;
        world.step();
        if (f === 24) {
          body.computeCentroid();
          early[breed] = startY - body.cy;
        }
      }
      body.computeCentroid();
      // carried up to the finger, without bobbing past it
      expect(startY - body.cy).toBeGreaterThan(185);
      expect(startY - body.cy).toBeLessThan(215);
    }
    expect(early.kitten).toBeGreaterThan(early.chonk + 10);
  });
});
