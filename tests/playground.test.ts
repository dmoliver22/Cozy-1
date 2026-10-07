import { describe, expect, it } from 'vitest';
import { Session, type Cat } from '../src/game/session';
import { distToShape } from '../src/game/spawn';
import { PERCHES } from '../src/house/perches';
import { Tubes } from '../src/house/tubes';
import {
  JOIN,
  SPAWN,
  TUBE,
  buildPiece,
  lowest,
  mouthOf,
  newTube,
  readPlay,
  skyTube,
  snapPiece,
  spawnShapes,
  spawnSpots,
  surfacesOf,
  tubeDirs,
  tubeShapes,
  type PlayPiece,
  type SkyTube,
} from '../src/playground/layout';

// The Playground: a corner of the sky of your own, built of perches and tubes.

const sky = (pieces: PlayPiece[] = [], cats: Cat['breed'][] = []) =>
  new Session(
    { id: 'playground', name: 'Playground', theme: 'living', furniture: [], containers: [], decor: [], cats: cats.map((b, i) => ({ breed: b, x: spawnSpots(cats.length)[i], y: SPAWN.y, name: b })) },
    { shell: () => [...spawnShapes(), ...pieces.flatMap((p) => buildPiece(p).shapes)], unmerge: true, spawnOk: () => true },
  );

describe('the playground, as saved', () => {
  it('keeps what makes sense and drops the rest', () => {
    const raw = JSON.stringify({
      v: 1,
      pieces: [
        { id: 3, kind: 'shelf', x: 10, y: -80 },
        { id: 3, kind: 'cloud', x: 0, y: 0 },
        { id: 4, kind: 'rocket', x: 0, y: 0 },
        { id: 5, kind: 'bounce', x: Number.NaN, y: 0 },
        { id: 6, kind: 'bounce', x: 1e9, y: 0 },
        { id: 7, kind: 'tree', x: -200, y: -40 },
      ],
      tubes: [{ id: 9, ax: 0, ay: 0, bx: 100, by: -100 }, { id: 10, ax: 'x' }],
      nextId: 2,
      cats: ['kitten', 'mine', 'kitten', 'unicorn'],
    });
    const s = readPlay(raw);
    expect(s.pieces.map((p) => p.id)).toEqual([3, 7]);
    expect(s.tubes.map((t) => t.id)).toEqual([9]);
    // (new ids never clash with old ones)
    expect(s.nextId).toBe(10);
    expect(s.cats).toEqual(['kitten', 'mine']);
    expect(readPlay('nonsense{').pieces).toEqual([]);
    expect(readPlay(null)).toEqual({ v: 1, pieces: [], tubes: [], nextId: 1, cats: [] });
  });
});

describe('building', () => {
  it('a shelf dragged up to the end of another joins it, end to end at its height: one long platform', () => {
    const a: PlayPiece = { id: 1, kind: 'shelf', x: 0, y: -100 };
    // its plank's ends: 33 either side of its middle
    const right = snapPiece('shelf', 66 + JOIN - 4, -100 + 9, [a]);
    expect(right).toEqual({ x: 66, y: -100 });
    const left = snapPiece('cloud', -75 - 6, -104, [a]);
    expect(left).toEqual({ x: -75, y: -100 });
    // (a hammock, a pod: they don't make platforms)
    expect(snapPiece('hammock', 66 + JOIN - 4, -100, [a])).toEqual({ x: 66 + JOIN - 4, y: -100 });
    expect(snapPiece('shelf', 66 + JOIN - 4, -100, [{ id: 2, kind: 'pod', x: 0, y: -100 }])).toEqual({ x: 66 + JOIN - 4, y: -100 });
    // (too far off, it stays where it's put)
    expect(snapPiece('shelf', 140, -100, [a])).toEqual({ x: 140, y: -100 });
    expect(snapPiece('shelf', 66, -60, [a])).toEqual({ x: 66, y: -60 });
  });

  it('something that stands, dragged a little way over a top, stands on it; anywhere else it floats', () => {
    const h = PERCHES.bounce.height;
    expect(snapPiece('bounce', 30, SPAWN.y - h - 20, [])).toEqual({ x: 30, y: SPAWN.y - h });
    const shelf: PlayPiece = { id: 1, kind: 'cushion', x: 300, y: -200 };
    expect(snapPiece('bed', 300, -200 - PERCHES.bed.height + 6, [shelf])).toEqual({ x: 300, y: -200 - PERCHES.bed.height });
    expect(snapPiece('bed', 300, -420, [shelf])).toEqual({ x: 300, y: -420 });
    // (its tops: the respawn cloud's and each piece's)
    expect(surfacesOf([shelf]).map((s) => s.y)).toEqual([SPAWN.y, -200]);
  });

  it("the lowest thing up there sets where the sea of cloud is (a cat falls past it, it's back on the respawn cloud)", () => {
    expect(lowest({ pieces: [], tubes: [] })).toBe(SPAWN.y + SPAWN.thick);
    expect(lowest({ pieces: [{ id: 1, kind: 'tree', x: 0, y: 400 }], tubes: [] })).toBe(400 + PERCHES.tree.height);
    expect(lowest({ pieces: [], tubes: [{ id: 1, ax: 0, ay: 0, bx: 0, by: 900 }] })).toBe(900);
  });

  it('a cat walks across the seam of two joined shelves', () => {
    const s = sky(
      [
        { id: 1, kind: 'shelf', x: 300, y: -200 },
        { id: 2, kind: 'shelf', x: 366, y: -200 },
      ],
      [],
    );
    const cat = s.addCat('kitten', 300, -200 - 22, 'Pip');
    for (let f = 0; f < 120; f++) s.step();
    // nudged along, over the seam (at 333) onto the second: it's on top all the way
    let lowest = -Infinity;
    for (let f = 0; f < 240; f++) {
      cat.body.computeCentroid();
      if (cat.body.cx > 352) break;
      if (cat.body.vcx < 60) cat.body.kick(12, 0);
      s.step();
      lowest = Math.max(lowest, cat.body.cy);
    }
    cat.body.computeCentroid();
    expect(cat.body.cx).toBeGreaterThan(352);
    expect(lowest).toBeLessThan(-200);
  });
});

describe('tubes', () => {
  it('face away from each other, with a reach in front of each mouth', () => {
    const t = skyTube({ id: 1, ax: 0, ay: 0, bx: 300, by: -300 });
    const { ux, uy } = tubeDirs(t.play);
    expect(t.upper.dirX * ux + t.upper.dirY * uy).toBeCloseTo(-1);
    expect(t.lower.dirX * ux + t.lower.dirY * uy).toBeCloseTo(1);
    expect(mouthOf(t, -20, 20)).toBe(0);
    expect(mouthOf(t, 320, -320)).toBe(1);
    expect(mouthOf(t, 150, -150)).toBeNull();
    // the glass: two walls and four flares, none of it in a mouth's way
    const shapes = tubeShapes(t.play);
    expect(shapes).toHaveLength(6);
    for (const z of t.zones) for (const sh of shapes) expect(distToShape(sh, z.x, z.y)).toBeGreaterThan(TUBE.bore / 2);
    // a new one rises to the right: in at the bottom, out of the top
    const n = newTube(2, 0, 0);
    expect(n.by).toBeLessThan(n.ay);
  });

  it('a cat in at one end comes out of the other, going the way that mouth faces', () => {
    const s = sky([], ['kitten']);
    const cat = s.cats[0];
    const t: SkyTube = skyTube({ id: 1, ax: 0, ay: -40, bx: 260, by: -300 });
    for (const sh of tubeShapes(t.play)) s.world.addStatic(sh);
    const tubes = new Tubes<Cat, SkyTube>(() => s.world);
    cat.body.placeAt(t.zones[0].x, t.zones[0].y);
    tubes.start(cat, t, false);
    let out: { x: number; y: number } | null = null;
    for (let f = 0; f < 240 && !out; f++) {
      tubes.step();
      s.step();
      for (const e of tubes.drain()) if (e.t === 'out') out = { x: e.x, y: e.y };
    }
    expect(out).not.toBeNull();
    expect(Math.hypot(out!.x - 260, out!.y + 300)).toBeLessThan(80);
    // shot out up and to the right, and on up a way before it comes down
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < cat.body.n; i++) {
      vx += cat.body.vx[i] / cat.body.n;
      vy += cat.body.vy[i] / cat.body.n;
    }
    expect(vx).toBeGreaterThan(200);
    expect(vy).toBeLessThan(-200);
    let top = Infinity;
    for (let f = 0; f < 60; f++) {
      s.step();
      cat.body.computeCentroid();
      top = Math.min(top, cat.body.cy);
    }
    expect(top).toBeLessThan(out!.y - 60);
  });
});
