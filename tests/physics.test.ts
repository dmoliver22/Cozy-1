import { describe, expect, it } from 'vitest';
import { BREED_ORDER, type BreedId } from '../src/physics/breeds';
import { SoftBody } from '../src/physics/softbody';
import { GRAVITY, World } from '../src/physics/world';
import { buildContainer, roomShell } from '../src/game/props';
import { LIFT, Session } from '../src/game/session';
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

  it('a cat squeezed into a snug mug comes to complete rest (no jitter)', () => {
    const s = new Session(
      {
        id: 'snug',
        name: 'snug',
        theme: 'kitchen',
        furniture: [],
        decor: [],
        containers: [{ type: 'mug', x: 190, y: 560 }],
        cats: [{ breed: 'tabby', x: 190, y: 486, name: 't' }],
      },
      { settleFrames: 0 },
    );
    for (let f = 0; f < 360; f++) s.step();
    const b = s.cats[0].body;
    expect(s.cats[0].seat).not.toBeNull();
    expect(b.asleep).toBe(true);
    const x = Array.from(b.x);
    const y = Array.from(b.y);
    for (let f = 0; f < 30; f++) s.step();
    expect(Array.from(b.x)).toEqual(x);
    expect(Array.from(b.y)).toEqual(y);
  });

  it('a cat that lands with a spin settles where it lands instead of rolling away', () => {
    for (const breed of ['tabby', 'mainecoon', 'chonk'] as const) {
      const world = new World();
      for (const s of roomShell()) world.addStatic(s);
      const body = world.addBody(new SoftBody(breed, 190, 380));
      body.computeCentroid();
      for (let i = 0; i < body.n; i++) {
        body.vx[i] = -80 + 3 * (body.y[i] - body.cy);
        body.vy[i] = -3 * (body.x[i] - body.cx);
      }
      let landed = -1;
      let xAt = 0;
      for (let f = 0; f < 420; f++) {
        body.loafiness = Math.min(1, f / 60);
        world.step();
        if (landed < 0 && body.airborneFrames === 0) landed = f;
        if (landed >= 0 && f === landed + 60) {
          body.computeCentroid();
          xAt = body.cx;
        }
      }
      body.computeCentroid();
      expect(Math.abs(body.cx - xAt)).toBeLessThan(5);
      expect(body.asleep).toBe(true);
    }
  });
});
