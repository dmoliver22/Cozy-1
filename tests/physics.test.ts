import { describe, expect, it } from 'vitest';
import { BREED_ORDER, BREEDS, type BreedId } from '../src/physics/breeds';
import { SoftBody, TENT, crossingAt } from '../src/physics/softbody';
import { World } from '../src/physics/world';
import { CONTAINER_TYPES, buildContainer, roomShell } from '../src/game/props';
import { Session } from '../src/game/session';
import { houseRoom } from '../src/house/homeRoom';
import { houseShell } from '../src/house/layout';
import { ALL_CATS } from '../src/house/house';
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

  it('every cat can be picked up by the scruff: the pinch follows the finger, the body hangs and stretches', () => {
    const tall: Record<string, number> = {};
    for (const breed of BREED_ORDER) {
      const world = new World();
      for (const s of roomShell()) world.addStatic(s);
      const body = world.addBody(new SoftBody(breed, 180, 520));
      for (let f = 0; f < 60; f++) world.step();
      body.computeCentroid();
      const startY = body.cy;
      const r = body.p.radius;
      const g = body.startGrab(body.cx, body.cy - r * 0.5);
      const pinch = (): { x: number; y: number } => {
        let x = 0;
        let y = 0;
        for (let m = 0; m < g.count; m++) {
          x += body.x[g.nodes[m]];
          y += body.y[g.nodes[m]];
        }
        return { x: x / g.count, y: y / g.count };
      };
      // carried up and across, then held still
      for (let f = 1; f <= 150; f++) {
        const t = Math.min(1, f / 40);
        g.tx = 180 + 60 * t;
        g.ty = startY - r * 0.5 - 220 * t;
        world.step();
        if (f === 20 || f === 150) {
          // the pinch is right where the finger has it (within a few units)
          const p = pinch();
          expect(Math.hypot(p.x - (g.hx + g.midX), p.y - (g.hy + g.midY)), `${breed} frame ${f}`).toBeLessThan(6);
        }
      }
      body.computeCentroid();
      // hanging straight down under the pinch, and long
      expect(Math.abs(body.cx - pinch().x)).toBeLessThan(6);
      expect(body.cy).toBeGreaterThan(pinch().y + r * 0.6);
      let y0 = Infinity;
      let y1 = -Infinity;
      let x0 = Infinity;
      let x1 = -Infinity;
      for (let i = 0; i < body.n; i++) {
        y0 = Math.min(y0, body.y[i]);
        y1 = Math.max(y1, body.y[i]);
        x0 = Math.min(x0, body.x[i]);
        x1 = Math.max(x1, body.x[i]);
      }
      tall[breed] = (y1 - y0) / (x1 - x0);
      expect(tall[breed], breed).toBeGreaterThan(1.1);
      // let go: it falls and loafs
      body.releaseGrab();
      for (let f = 0; f < 120; f++) world.step();
      body.computeCentroid();
      expect(body.cy).toBeGreaterThan(500);
    }
    // a chonk droops longer than a springy kitten
    expect(tall.chonk).toBeGreaterThan(tall.kitten);
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
    // (held by the scruff, the pinch can also be pulled over a rim, or into
    // the corner a wall makes with what the cat stands on)
    const cases = [
      ['shoebox', 'tabby'],
      ['shoebox', 'void'],
      ['saucepan', 'void'],
      ['teacup', 'void'],
      ['box', 'chonk'],
      ['bucket', 'kitten'],
      ['vase', 'persian'],
      ['basket', 'mainecoon'],
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

  it('skin that crossed over itself comes undone at once, drawn through the very same points', () => {
    const { body } = dropInto('tabby');
    const n = body.n;
    const before = (): string[] => Array.from({ length: n }, (_, i) => `${body.x[i].toFixed(6)},${body.y[i].toFixed(6)}`).sort();
    // a stretch of skin flipped over (a figure 8), then the whole cat turned inside out
    for (const [from, to] of [
      [3, 9],
      [0, n - 1],
    ]) {
      for (let a = from, b = to; a < b; a++, b--) {
        for (const arr of [body.x, body.y]) {
          const t = arr[a];
          arr[a] = arr[b];
          arr[b] = t;
        }
      }
      expect(crossingAt(body.x, body.y, n) >= 0 || polygonArea(body.x, body.y, n) < 0).toBe(true);
      const points = before();
      body.frameUpdate(1 / 60);
      expect(crossingAt(body.x, body.y, n)).toBe(-1);
      expect(polygonArea(body.x, body.y, n)).toBeGreaterThan(0);
      expect(before()).toEqual(points);
    }
  });

  it('a cat that has rolled over is picked up without its shape collapsing or turning inside out', () => {
    for (const breed of ['kitten', 'persian', 'chonk', 'tabby'] as const) {
      const world = new World();
      for (const s of roomShell()) world.addStatic(s);
      const body = world.addBody(new SoftBody(breed, 180, 500));
      // upside down (cats roll; most have no sense of up of their own)
      body.computeCentroid();
      for (let i = 0; i < body.n; i++) {
        body.x[i] = body.px[i] = 2 * body.cx - body.x[i];
        body.y[i] = body.py[i] = 2 * body.cy - body.y[i];
      }
      for (let f = 0; f < 90; f++) world.step();
      body.computeCentroid();
      const g = body.startGrab(body.cx, body.cy - body.p.radius * 0.8);
      for (let f = 0; f < 150; f++) {
        g.tx = 180;
        g.ty = Math.max(200, g.ty - 4);
        world.step();
        // the rest shape it eases toward stays a proper, right-way-round cat
        const n = body.n;
        const tx = new Float64Array(n);
        const ty = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const rx = body.roundX[i] + (body.loafX[i] - body.roundX[i]) * body.loafiness;
          const ry = body.roundY[i] + (body.loafY[i] - body.roundY[i]) * body.loafiness;
          tx[i] = rx + (body.hangX[i] - rx) * body.hang;
          ty[i] = ry + (body.hangY[i] - ry) * body.hang;
        }
        expect(polygonArea(tx, ty, n) / body.area0, `${breed} frame ${f}`).toBeGreaterThan(0.6);
        expect(crossingAt(body.qx, body.qy, n), `${breed} frame ${f}`).toBe(-1);
        expect(crossingAt(body.x, body.y, n), `${breed} frame ${f}`).toBe(-1);
      }
      expect(body.hang).toBeGreaterThan(0.9);
    }
  });

  it('a held cat lowered onto a cat below rests on it instead of squashing it', () => {
    for (const [held, under, grip] of [
      ['chonk', 'mainecoon', 0.9],
      ['persian', 'kitten', 0],
      ['tabby', 'void', -0.9],
    ] as const) {
      const s = new Session(
        {
          id: 'stack',
          name: 'stack',
          theme: 'kitchen',
          furniture: [],
          decor: [],
          containers: [],
          cats: [
            { breed: under, x: 190, y: 560, name: 'u' },
            { breed: held, x: 190, y: 330, name: 'h' },
          ],
        },
        { settleFrames: 0, mode: 'sandbox' },
      );
      const [low, cat] = s.cats;
      for (let f = 0; f < 60; f++) s.step();
      const b = cat.body;
      b.computeCentroid();
      const r = b.p.radius;
      s.beginGrab(cat, b.cx + grip * r, b.cy - r * 0.4);
      const y0 = b.cy - r * 0.4;
      for (let f = 0; f < 240; f++) {
        // pressed right down through the cat underneath, to the floor
        s.moveGrab(190 + grip * r, Math.min(552, y0 + f * 3), 0, 180);
        s.step();
        const area = polygonArea(low.body.x, low.body.y, low.body.n) / low.body.area0;
        expect(area, `${held} on ${under} frame ${f}`).toBeGreaterThan(0.6);
        expect(crossingAt(low.body.x, low.body.y, low.body.n), `${held} on ${under} frame ${f}`).toBe(-1);
      }
      // still on top of it
      low.body.computeCentroid();
      b.computeCentroid();
      expect(b.cy).toBeLessThan(low.body.cy);
    }
  });

  it('carrying cats round the house never leaves one knotted or inside out', () => {
    const s = new Session(houseRoom({ open: [], residents: ALL_CATS, where: {} }), { mode: 'sandbox', shell: houseShell });
    for (let f = 0; f < 90; f++) s.step();
    // pick each cat up and carry it a lap: up, through the room past the
    // furniture and the other cats, down into the box, quick shakes, and off
    const lap: [number, number][] = [
      [190, 120],
      [330, 260],
      [60, 300],
      [196, 520],
      [120, 450],
      [300, 420],
    ];
    for (const cat of s.cats) {
      const b = cat.body;
      b.computeCentroid();
      let fx = b.cx;
      let fy = b.cy - b.p.radius * 0.6;
      s.beginGrab(cat, fx, fy);
      for (const [wx, wy] of lap) {
        for (let f = 0; f < 40; f++) {
          const k = 1 / (40 - f);
          fx += (wx - fx) * k;
          fy += (wy - fy) * k;
          const shake = f > 30 ? Math.sin(f * 1.7) * 40 : 0;
          s.moveGrab(fx + shake, fy, 0, 0);
          s.step();
          for (const c of s.cats) {
            const area = polygonArea(c.body.x, c.body.y, c.body.n) / c.body.area0;
            expect(crossingAt(c.body.x, c.body.y, c.body.n), `${c.breed} (holding ${cat.breed})`).toBe(-1);
            expect(area, `${c.breed} (holding ${cat.breed})`).toBeGreaterThan(0.5);
            expect(area, `${c.breed} (holding ${cat.breed})`).toBeLessThan(1.6);
          }
        }
      }
      s.endGrab();
      for (let f = 0; f < 60; f++) s.step();
    }
  });

  it('the scruff stretches as a cat is lifted, more the harder, and springs back once it hangs', () => {
    for (const breed of ['kitten', 'chonk'] as const) {
      const peak: Record<string, number> = {};
      for (const lift of [80, 24]) {
        const s = openRoom([{ breed, x: 190, y: 560 }]);
        const cat = s.cats[0];
        const b = cat.body;
        b.computeCentroid();
        const r = b.p.radius;
        const y0 = b.cy - r * 0.8;
        s.beginGrab(cat, b.cx, y0);
        let most = 0;
        for (let f = 1; f <= lift + 150; f++) {
          const t = Math.min(1, f / lift);
          s.moveGrab(190, y0 - 200 * t * t * (3 - 2 * t), 0, 0);
          s.step();
          if (f <= lift) most = Math.max(most, b.tent / r);
        }
        peak[lift] = most;
        // hanging still: the skin at the scruff drawn up to its resting
        // stretch, with the scruff the top of the cat
        expect(b.tent / r, `${breed} lifted in ${lift}`).toBeGreaterThan(TENT * 0.8);
        expect(b.tent / r, `${breed} lifted in ${lift}`).toBeLessThan(TENT * 1.2);
        const g = b.grab!;
        let top = Infinity;
        for (let m = 0; m < g.count; m++) top = Math.min(top, b.y[g.nodes[m]]);
        for (let i = 0; i < b.n; i++) expect(b.y[i], `${breed} node ${i}`).toBeGreaterThan(top - 1);
        // let go, the skin springs back
        s.endGrab();
        for (let f = 0; f < 60; f++) s.step();
        expect(b.tent).toBe(0);
      }
      // yanked up, the scruff stretches further than lifted gently
      expect(peak[24], breed).toBeGreaterThan(peak[80] + 0.1);
      expect(peak[24], breed).toBeGreaterThan(0.45);
    }
  });

  it('a cat lying on top of the one being picked up comes up too, or rolls off, never speared', () => {
    for (const [low, high] of [
      ['kitten', 'tabby'],
      ['persian', 'mainecoon'],
    ] as const) {
      // (one lying on the other on the floor, with the rest of the cats round them)
      const rLow = BREEDS[low].physics.radius;
      const s = openRoom([
        { breed: low, x: 190, y: 560 },
        { breed: high, x: 186, y: 560 - rLow * 1.7 },
        ...ALL_CATS.filter((b) => b !== low && b !== high).map((breed, k) => ({ breed, x: k < 2 ? 40 + k * 60 : 280 + (k - 2) * 60, y: 560 })),
      ]);
      const under = s.cats.find((c) => c.breed === low)!;
      const over = s.cats.find((c) => c.breed === high)!;
      under.body.computeCentroid();
      over.body.computeCentroid();
      expect(over.body.cy, `${high} on ${low}`).toBeLessThan(under.body.cy - under.body.p.radius * 0.8);
      const b = under.body;
      const r = b.p.radius;
      const x0 = b.cx;
      const y0 = b.cy - r * 0.8;
      s.beginGrab(under, x0, y0);
      for (let f = 1; f <= 240; f++) {
        const t = Math.min(1, f / 40);
        s.moveGrab(x0, y0 + (200 - y0) * t * t * (3 - 2 * t), 0, 0);
        s.step();
        for (const c of s.cats) {
          const area = polygonArea(c.body.x, c.body.y, c.body.n) / c.body.area0;
          expect(crossingAt(c.body.x, c.body.y, c.body.n), `${c.breed} (${high} on ${low}) frame ${f}`).toBe(-1);
          expect(area, `${c.breed} (${high} on ${low}) frame ${f}`).toBeGreaterThan(0.6);
        }
      }
      // it came up to the finger
      b.computeCentroid();
      expect(b.cy, `${low} under ${high}`).toBeLessThan(200 + r * 2.5);
    }
  });

  it('a carried cat follows a smooth path smoothly, swings a little and comes to hang straight', () => {
    for (const breed of BREED_ORDER) {
      const s = openRoom([{ breed, x: 120, y: 560 }]);
      const cat = s.cats[0];
      const b = cat.body;
      b.computeCentroid();
      const r = b.p.radius;
      const legs: [number, number, number][] = [
        [b.cx, b.cy - r * 0.8, 0],
        [120, 220, 40],
        [280, 220, 50],
        [200, 320, 40],
        [200, 320, 90],
      ];
      s.beginGrab(cat, legs[0][0], legs[0][1]);
      const cx: number[] = [];
      const cy: number[] = [];
      let swing = 0;
      let tilt = 0;
      for (let k = 1; k < legs.length; k++) {
        const [ax, ay] = legs[k - 1];
        const [bx, by, frames] = legs[k];
        for (let f = 1; f <= frames; f++) {
          const t = f / frames;
          const e = t * t * (3 - 2 * t);
          s.moveGrab(ax + (bx - ax) * e, ay + (by - ay) * e, 0, 0);
          s.step();
          b.computeCentroid();
          cx.push(b.cx);
          cy.push(b.cy);
          const g = b.grab!;
          let px = 0;
          let py = 0;
          let ws = 0;
          for (let m = 0; m < g.count; m++) {
            px += b.x[g.nodes[m]] * g.weights[m];
            py += b.y[g.nodes[m]] * g.weights[m];
            ws += g.weights[m];
          }
          tilt = (Math.abs(Math.atan2(px / ws - b.cx, b.cy - py / ws)) * 180) / Math.PI;
          if (k > 1 && k < 4) swing = Math.max(swing, tilt);
        }
      }
      // no shudder: the third difference of the body's middle (per frame) stays small
      const jerk: number[] = [];
      for (let i = 3; i < cx.length; i++) jerk.push(Math.hypot(cx[i] - 3 * cx[i - 1] + 3 * cx[i - 2] - cx[i - 3], cy[i] - 3 * cy[i - 1] + 3 * cy[i - 2] - cy[i - 3]));
      jerk.sort((p, q) => p - q);
      const mean = jerk.reduce((p, q) => p + q, 0) / jerk.length;
      expect(mean, breed).toBeLessThan(0.6);
      expect(jerk[Math.floor(jerk.length * 0.95)], breed).toBeLessThan(2.5);
      // it swings as it's carried, but not like a pendulum on a string, and
      // hangs straight once the finger stops
      expect(swing, breed).toBeLessThan(60);
      expect(tilt, breed).toBeLessThan(8);
    }
  });

  it('a cat whose skin was just untangled is drawn where it is, not blended across the change', () => {
    const s = openRoom([{ breed: 'tabby', x: 190, y: 400 }]);
    const b = s.cats[0].body;
    s.rememberPositions();
    s.step();
    const now = Array.from(b.x);
    b.ringVersion++;
    s.beginLerp(0.5);
    expect(Array.from(b.x)).toEqual(now);
    s.endLerp();
    // (and an ordinary step is blended)
    s.rememberPositions();
    const before = Array.from(b.x);
    s.step();
    const after = Array.from(b.x);
    s.beginLerp(0.5);
    expect(b.x[3]).toBeCloseTo((before[3] + after[3]) / 2, 9);
    s.endLerp();
    expect(Array.from(b.x)).toEqual(after);
  });

  it('a cat in the hand is drawn flowing a moment behind its own shape, never behind where it is', () => {
    const s = openRoom([{ breed: 'kitten', x: 190, y: 560 }]);
    const cat = s.cats[0];
    const b = cat.body;
    b.computeCentroid();
    const x0 = b.cx;
    const y0 = b.cy - b.p.radius * 0.8;
    s.beginGrab(cat, x0, y0);
    const mid = (xs: ArrayLike<number>): number => Array.from(xs).reduce((p, q) => p + q, 0) / xs.length;
    let lagged = 0;
    for (let f = 1; f <= 90; f++) {
      // up, then a quick shake
      const t = Math.min(1, f / 20);
      s.moveGrab(x0 + (f > 30 ? 40 * Math.sin(f * 0.6) : 0), y0 - 150 * t * t * (3 - 2 * t), 0, 0);
      s.rememberPositions();
      s.step();
      const realX = Array.from(b.x);
      const realY = Array.from(b.y);
      s.beginLerp(1, 1 / 60);
      // where it is: exactly where the physics has it
      expect(mid(b.x)).toBeCloseTo(mid(realX), 6);
      expect(mid(b.y)).toBeCloseTo(mid(realY), 6);
      let off = 0;
      for (let i = 0; i < b.n; i++) off = Math.max(off, Math.hypot(b.x[i] - realX[i], b.y[i] - realY[i]));
      lagged = Math.max(lagged, off);
      s.endLerp();
      expect(Array.from(b.x)).toEqual(realX);
    }
    // its shape was drawn behind, a little
    expect(lagged).toBeGreaterThan(0.5);
    expect(lagged).toBeLessThan(b.p.radius);
    // let go, the drawing comes back to exact
    s.endGrab();
    for (let f = 0; f < 60; f++) {
      s.rememberPositions();
      s.step();
      s.beginLerp(1, 1 / 60);
      s.endLerp();
    }
    s.rememberPositions();
    s.step();
    const realX = Array.from(b.x);
    s.beginLerp(1, 1 / 60);
    expect(Array.from(b.x)).toEqual(realX);
    s.endLerp();
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

/** A bare room with these cats in it, settled. */
function openRoom(cats: { breed: BreedId; x: number; y: number }[]): Session {
  const s = new Session({ id: 'open', name: 'open', theme: 'living', furniture: [], decor: [], containers: [], cats: cats.map((c, k) => ({ ...c, name: `c${k}` })) }, { mode: 'sandbox' });
  for (let f = 0; f < 90; f++) s.step();
  return s;
}

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
