import { describe, expect, it } from 'vitest';
import { BREED_ORDER, BREEDS, type BreedId } from '../src/physics/breeds';
import { SoftBody } from '../src/physics/softbody';
import { GRAVITY, World } from '../src/physics/world';
import { CONTAINER_TYPES, buildContainer, roomShell } from '../src/game/props';
import { LIFT, Session } from '../src/game/session';
import { polygonArea, dsin, dcos } from '../src/util/math';
import type { StaticShape } from '../src/physics/shapes';

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

  it('a cat that slumped against any container can still be lifted straight up', () => {
    // The glass box's open flaps used to jut out over anything beside the box
    // and pin a big cat underneath when you tried to lift it.
    const stuck: string[] = [];
    for (const type of CONTAINER_TYPES) {
      const shapes = buildContainer({ type, x: 190, y: 560 }).shapes;
      let minX = Infinity;
      let maxX = -Infinity;
      for (const st of shapes) {
        for (let i = 0; i < st.n; i++) {
          minX = Math.min(minX, st.xs[i] - st.radius);
          maxX = Math.max(maxX, st.xs[i] + st.radius);
        }
      }
      for (const breed of BREED_ORDER) {
        for (const side of [-1, 1]) {
          const r = BREEDS[breed].physics.radius;
          const s = new Session(
            {
              id: 'lift',
              name: 'lift',
              theme: 'kitchen',
              furniture: [],
              decor: [],
              containers: [{ type, x: 190, y: 560 }],
              cats: [{ breed, x: side < 0 ? minX - r * 0.8 : maxX + r * 0.8, y: 400, name: 'c' }],
            },
            { settleFrames: 0 },
          );
          const cat = s.cats[0];
          const b = cat.body;
          for (let f = 0; f < 150; f++) s.step();
          b.computeCentroid();
          const sx = b.cx;
          const sy = b.cy;
          const bottom = (): number => Math.max(...Array.from(b.y));
          const bot0 = bottom();
          s.beginGrab(cat, sx, sy);
          for (let f = 0; f < 90; f++) {
            s.moveGrab(sx, Math.max(sy - 6 * f, sy - 200), 0, f < 33 ? -360 : 0);
            s.step();
          }
          if (bot0 - bottom() < 60) stuck.push(`${breed} beside ${type} (${side < 0 ? 'left' : 'right'})`);
        }
      }
    }
    expect(stuck).toEqual([]);
  });

  it('a cat dragged hard against a thin wall never folds through itself or the wall', () => {
    // Pulling a cat into a shoebox through its wall used to pinch the neck over
    // the rim until the ring twisted into a figure 8 with the wall inside it;
    // pressing one into the crevice under a teacup knotted the skin.
    const cases = [
      ['shoebox', 'tabby'],
      ['shoebox', 'void'],
      ['saucepan', 'void'],
      ['teacup', 'void'],
    ] as const;
    for (const [type, breed] of cases) {
      const s = new Session(
        {
          id: 'drag',
          name: 'drag',
          theme: 'kitchen',
          furniture: [],
          decor: [],
          containers: [{ type, x: 220, y: 560 }],
          cats: [{ breed, x: 70, y: 560, name: 'c' }],
        },
        { settleFrames: 0 },
      );
      const cat = s.cats[0];
      const b = cat.body;
      const walls = s.world.statics.filter((st) => st.propId !== -1);
      for (let f = 0; f < 300; f++) {
        if (f === 60) {
          b.computeCentroid();
          s.beginGrab(cat, b.cx, b.cy);
        }
        if (f >= 60 && f < 240) {
          const t = Math.min(1, (f - 60) / 30);
          s.moveGrab(70 + 150 * t, 545, t < 1 ? 300 : 0, 0);
        }
        if (f === 240) s.endGrab();
        s.step();
        expect(ringCrossings(b), `${type}/${breed} frame ${f}`).toBe(0);
        let deepest = 0;
        for (const st of walls) {
          for (let i = 0; i < b.n; i++) {
            const j = (i + 1) % b.n;
            for (let q = 0; q <= 4; q++) {
              const u = q / 4;
              deepest = Math.max(deepest, -shapeDistance(st, b.x[i] + (b.x[j] - b.x[i]) * u, b.y[i] + (b.y[j] - b.y[i]) * u));
            }
          }
        }
        expect(deepest, `${type}/${breed} frame ${f}`).toBeLessThan(0.5);
      }
    }
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

/** Number of pairs of non-adjacent ring edges that cross each other. */
function ringCrossings(b: SoftBody): number {
  const n = b.n;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = i + 2; j < n; j++) {
      const j2 = (j + 1) % n;
      if (j2 === i) continue;
      const d1 = cross(b.x[j], b.y[j], b.x[j2], b.y[j2], b.x[i], b.y[i]);
      const d2 = cross(b.x[j], b.y[j], b.x[j2], b.y[j2], b.x[i2], b.y[i2]);
      const d3 = cross(b.x[i], b.y[i], b.x[i2], b.y[i2], b.x[j], b.y[j]);
      const d4 = cross(b.x[i], b.y[i], b.x[i2], b.y[i2], b.x[j2], b.y[j2]);
      if (d1 * d2 < 0 && d3 * d4 < 0) count++;
    }
  }
  return count;
}

function cross(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

/** Signed distance from a point to a static's rounded surface (negative inside). */
function shapeDistance(s: StaticShape, px: number, py: number): number {
  let maxD = -Infinity;
  for (let k = 0; k < s.n; k++) maxD = Math.max(maxD, s.nx[k] * px + s.ny[k] * py - s.d[k]);
  if (maxD <= 0) return maxD - s.radius;
  let best = Infinity;
  for (let k = 0; k < s.n; k++) {
    const k2 = (k + 1) % s.n;
    const ax = s.xs[k];
    const ay = s.ys[k];
    const ex = s.xs[k2] - ax;
    const ey = s.ys[k2] - ay;
    const l2 = ex * ex + ey * ey;
    const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + ex * t), py - (ay + ey * t)));
  }
  return best - s.radius;
}
