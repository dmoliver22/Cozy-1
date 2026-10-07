import { describe, expect, it } from 'vitest';
import { Session, type Cat } from '../src/game/session';
import { distToShape } from '../src/game/spawn';
import { PERCHES } from '../src/house/perches';
import { Tubes } from '../src/house/tubes';
import { pathLength, pointAt } from '../src/util/path';
import {
  JOIN,
  SPAWN,
  TUBE,
  TUBE_LEN,
  PIPE,
  bendTube,
  buildPiece,
  drawPipe,
  evenTube,
  extendTube,
  pipeJoints,
  pipeOf,
  pipePath,
  slidePipeRun,
  straighten,
  lowest,
  mouthOf,
  readPlay,
  skyTube,
  snapPiece,
  spawnShapes,
  spawnSpots,
  straightTube,
  surfacesOf,
  tubeEnds,
  tubeLength,
  tubeShapes,
  gadgetOf,
  type PlayPiece,
  type SkyTube,
} from '../src/playground/layout';
import { CANNON, FAN, GadgetWorks, cannonMouth, fitAim, type GadgetEvent } from '../src/playground/gadgets';

type Pt = [number, number];

/** The sharpest a polyline turns anywhere along it, for how far apart its points are (radians a unit: 1 / its tightest radius). */
const sharpest = (p: readonly Pt[]): number => {
  let k = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const ax = p[i][0] - p[i - 1][0];
    const ay = p[i][1] - p[i - 1][1];
    const bx = p[i + 1][0] - p[i][0];
    const by = p[i + 1][1] - p[i][1];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    const turn = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
    k = Math.max(k, turn / ((la + lb) / 2));
  }
  return k;
};

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
      tubes: [
        // (a straight one from before tubes bent, a drawn one, and some nonsense)
        { id: 9, ax: 0, ay: 0, bx: 100, by: -100 },
        { id: 10, ax: 'x' },
        { id: 11, pts: [[0, 0], [16, 0], [32, 4]] },
        { id: 12, pts: [[0, 0]] },
        { id: 13, pts: [[0, 0], [1, Number.NaN]] },
        { id: 14, pts: [[5, 5], [5, 5]] },
      ],
      nextId: 2,
      cats: ['kitten', 'mine', 'kitten', 'unicorn'],
    });
    const s = readPlay(raw);
    expect(s.pieces.map((p) => p.id)).toEqual([3, 7]);
    expect(s.tubes.map((t) => t.id)).toEqual([9, 11]);
    // the straight one, as a line of points from end to end
    const old = s.tubes[0].pts;
    expect(old[0]).toEqual([0, 0]);
    expect(old[old.length - 1]).toEqual([100, -100]);
    expect(old.length).toBeGreaterThan(5);
    expect(s.tubes[1].pts).toEqual([
      [0, 0],
      [16, 0],
      [32, 4],
    ]);
    // (new ids never clash with old ones)
    expect(s.nextId).toBe(12);
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
    expect(lowest({ pieces: [], tubes: [straightTube(1, 0, 0, 0, 900)] })).toBe(900);
    expect(lowest({ pieces: [], tubes: [{ id: 1, pts: evenTube([[0, 0], [200, 1300], [400, 0]]) }] })).toBeGreaterThan(1000);
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

describe('drawing a tube', () => {
  it('is evened out: a point every step along it, its ends where they were drawn', () => {
    const p = evenTube([
      [0, 0],
      [3, 1],
      [90, 2],
      [100, 70],
      [101, 300],
    ]);
    expect(p[0]).toEqual([0, 0]);
    expect(p[p.length - 1]).toEqual([101, 300]);
    for (let i = 1; i < p.length - 1; i++) expect(Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])).toBeCloseTo(TUBE.step, 0);
    // (the last stretch takes up the rest)
    const last = Math.hypot(p[p.length - 1][0] - p[p.length - 2][0], p[p.length - 1][1] - p[p.length - 2][1]);
    expect(last).toBeGreaterThan(TUBE.step * 0.3);
    expect(last).toBeLessThan(TUBE.step * 1.4);
  });

  it('a sharp corner drawn is eased round: no tighter than a tube bends', () => {
    // an L, and a zigzag
    for (const raw of [
      [
        [0, 0],
        [300, 0],
        [300, 300],
      ],
      [
        [0, 0],
        [200, 0],
        [0, 120],
        [200, 240],
      ],
    ] as Pt[][]) {
      const p = evenTube(raw);
      expect(sharpest(p)).toBeLessThan((1 / TUBE.bend) * 1.25);
      expect(p[0]).toEqual(raw[0]);
      expect(p[p.length - 1]).toEqual(raw[raw.length - 1]);
    }
  });

  it('drawn on from an end, it follows the finger; back along itself, it gets shorter', () => {
    let p: Pt[] = [[0, 0]];
    // a finger going right, then curling round and up
    for (let k = 1; k <= 60; k++) {
      const a = (k / 60) * Math.PI;
      p = extendTube(p, 'b', 200 * Math.sin(a) + k * 4, -200 + 200 * Math.cos(a));
    }
    const tip = p[p.length - 1];
    expect(tip[0]).toBeCloseTo(240, 0);
    expect(tip[1]).toBeCloseTo(-400, 0);
    expect(p[0]).toEqual([0, 0]);
    const long = pathLength(p);
    expect(long).toBeGreaterThan(600);
    // dragged back along itself a way: taken in, still from where it began
    const back = pointAt(p, long - 150);
    const q = extendTube(p, 'b', back.x, back.y);
    expect(pathLength(q)).toBeLessThan(long - 120);
    expect(q[0]).toEqual([0, 0]);
    // and from its other end too, the far end staying put
    const r = extendTube(p, 'a', -120, 10);
    expect(r[0]).toEqual([-120, 10]);
    expect(r[r.length - 1]).toEqual(tip);
    expect(pathLength(r)).toBeGreaterThan(long + 100);
  });

  it('as long as you like, up to a point', () => {
    let p: Pt[] = [[0, 0]];
    for (let x = 400; x <= TUBE_LEN.max + 2000; x += 400) p = extendTube(p, 'b', x, 0);
    expect(pathLength(p)).toBeGreaterThan(TUBE_LEN.max - TUBE.step);
    expect(pathLength(p)).toBeLessThanOrEqual(TUBE_LEN.max + 1);
  });

  it('pulled by its middle, it bends there and its ends stay put', () => {
    const t = straightTube(1, 0, 0, 600, 0);
    const p = bendTube(t.pts, 300, 0, -160);
    const mid = pointAt(p, pathLength(p) / 2);
    expect(mid.y).toBeLessThan(-140);
    expect(p[0][1]).toBeCloseTo(0, 0);
    expect(p[p.length - 1][0]).toBeCloseTo(600, -1);
    expect(p[p.length - 1][1]).toBeGreaterThan(-12);
  });
});

describe('pipes: straight runs and neat elbows, like real ones', () => {
  /** A finger drawing a pipe through these points, a little way at a time. */
  const draw = (path: Pt[]): Pt[] => {
    let b: Pt[] = drawPipe([], 'b', path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1];
      const [bx, by] = path[i];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 6);
      for (let k = 1; k <= n; k++) b = drawPipe(b, 'b', ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
    }
    return b;
  };
  const way = (a: Pt, b: Pt): number => (Math.round((Math.atan2(b[1] - a[1], b[0] - a[0]) * 4) / Math.PI) + 8) % 8;
  const onGrid = (p: Pt): boolean => Math.abs(p[0] / PIPE.grid - Math.round(p[0] / PIPE.grid)) < 0.01 && Math.abs(p[1] / PIPE.grid - Math.round(p[1] / PIPE.grid)) < 0.01;

  it('drawn along and round a corner: two straight runs, square, with an elbow on the grid', () => {
    const b = draw([
      [3, 2],
      [240, 8],
      [244, 250],
    ]);
    expect(b).toHaveLength(3);
    expect(b[0]).toEqual([0, 0]);
    expect(way(b[0], b[1])).toBe(0);
    expect(way(b[1], b[2])).toBe(2);
    expect(onGrid(b[1])).toBe(true);
    expect(b[1][0]).toBeGreaterThan(200);
    expect(b[1][0]).toBeLessThan(270);
    expect(b[2][1]).toBeGreaterThan(200);
    // its line: straight, then round the elbow (no tighter than a tube bends), then straight
    const p = pipePath(b);
    for (const q of p) {
      const onFirst = Math.abs(q[1]) < 0.2;
      const onSecond = Math.abs(q[0] - b[1][0]) < 0.2;
      const round = Math.hypot(q[0] - (b[1][0] - PIPE.elbow), q[1] - PIPE.elbow);
      expect(onFirst || onSecond || Math.abs(round - PIPE.elbow) < 0.6).toBe(true);
    }
    expect(pipeJoints(b)).toHaveLength(2);
  });

  it('turns 45° when the finger goes off at a slant, and never sharper than a right angle', () => {
    const b = draw([
      [0, 0],
      [200, 0],
      [400, 200],
    ]);
    expect(way(b[0], b[1])).toBe(0);
    expect(way(b[1], b[2])).toBe(1);
    for (const p of b.slice(0, -1)) expect(onGrid(p)).toBe(true);
    // a finger doubling back: a right angle, not straight back
    const c = draw([
      [0, 0],
      [200, 0],
      [200, 60],
      [0, 60],
    ]);
    for (let i = 2; i < c.length; i++) {
      const t = (way(c[i - 1], c[i]) - way(c[i - 2], c[i - 1]) + 8) % 8;
      expect([1, 2, 6, 7]).toContain(t);
    }
  });

  it('wherever along the grid the finger turns, a slant turns 45° and a square turn a right angle', () => {
    for (let at = 160; at < 200; at += 3) {
      const slant = draw([
        [0, 0],
        [at, 0],
        [at + 200, 200],
      ]);
      expect(slant.length).toBe(3);
      expect(way(slant[1], slant[2])).toBe(1);
      expect(onGrid(slant[1])).toBe(true);
      const square = draw([
        [0, 0],
        [at, 0],
        [at, 220],
      ]);
      expect(square.length).toBe(3);
      expect(way(square[1], square[2])).toBe(2);
      expect(Math.abs(square[1][0] - at)).toBeLessThanOrEqual(PIPE.grid / 2);
    }
  });

  it('wherever the finger comes down, between the grid lines, a run drawn straight goes straight', () => {
    for (let ox = 1; ox < 20; ox += 3) {
      for (let oy = 1; oy < 20; oy += 3) {
        for (const [dx, dy, w] of [
          [240, 0, 0],
          [0, -240, 6],
          [170, 170, 1],
          [-170, -170, 5],
        ] as const) {
          const b = draw([
            [ox, oy],
            [ox + dx, oy + dy],
          ]);
          expect(b).toHaveLength(2);
          expect(way(b[0], b[1])).toBe(w);
          expect(onGrid(b[0])).toBe(true);
        }
      }
    }
  });

  it('back over its last elbow, that run is taken in', () => {
    const b = draw([
      [0, 0],
      [240, 0],
      [240, 200],
    ]);
    expect(b).toHaveLength(3);
    let c = b;
    for (let y = 200; y >= -4; y -= 6) c = drawPipe(c, 'b', 240, y);
    for (let x = 240; x >= 150; x -= 6) c = drawPipe(c, 'b', x, 0);
    expect(c).toHaveLength(2);
    expect(c[1][0]).toBeLessThan(180);
    // and on from its other end too
    const d = drawPipe(b, 'a', -100, 0);
    expect(d[d.length - 1]).toEqual(b[b.length - 1]);
    expect(d[0][0]).toBeLessThan(-80);
  });

  it('a straight run slid sideways: the runs either side stretch to meet it, the way they went', () => {
    const b: Pt[] = [
      [0, 0],
      [200, 0],
      [200, 200],
      [400, 200],
    ];
    // the middle one, 40 along
    const c = slidePipeRun(b, 1, 47, 3);
    expect(c).toEqual([
      [0, 0],
      [240, 0],
      [240, 200],
      [400, 200],
    ]);
    // the first: its mouth goes with it
    expect(slidePipeRun(b, 0, 0, -40)).toEqual([
      [0, -40],
      [200, -40],
      [200, 200],
      [400, 200],
    ]);
    // not so far that a run's too short for its elbows: as far as it'll go
    const d = slidePipeRun(b, 1, 400, 0);
    expect(d[1][0]).toBeLessThan(400 - PIPE.elbow);
    expect(d[1][0]).toBeGreaterThan(300);
  });

  it('a drawn tube straightened: runs of the eight ways, bends on the grid, end to end where it was', () => {
    const arc: Pt[] = [];
    for (let k = 0; k <= 40; k++) arc.push([Math.sin((k / 40) * Math.PI) * 300, -k * 12]);
    const b = straighten(evenTube(arc));
    expect(b.length).toBeGreaterThan(2);
    for (let i = 1; i < b.length; i++) {
      const a = Math.atan2(b[i][1] - b[i - 1][1], b[i][0] - b[i - 1][0]) / (Math.PI / 4);
      expect(Math.abs(a - Math.round(a))).toBeLessThan(0.01);
    }
    for (const p of b.slice(0, -1)) expect(onGrid(p)).toBe(true);
    expect(Math.hypot(b[b.length - 1][0] - 0, b[b.length - 1][1] + 480)).toBeLessThan(60);
  });

  it('saved and read back: its line made again from its bends', () => {
    const t = pipeOf(4, [
      [0, 0],
      [200, 0],
      [200, -200],
    ]);
    const s = readPlay(JSON.stringify({ v: 1, pieces: [], tubes: [{ ...t, pts: [[0, 0], [1, 1]] }], nextId: 5, cats: [] }));
    expect(s.tubes[0].bends).toEqual(t.bends);
    expect(s.tubes[0].pts).toEqual(t.pts);
  });
});

describe('tubes', () => {
  it('face away from each other, with a reach in front of each mouth', () => {
    const t = skyTube(straightTube(1, 0, 0, 300, -300));
    const ux = Math.SQRT1_2;
    const uy = -Math.SQRT1_2;
    expect(t.upper.dirX * ux + t.upper.dirY * uy).toBeCloseTo(-1);
    expect(t.lower.dirX * ux + t.lower.dirY * uy).toBeCloseTo(1);
    expect(mouthOf(t, -20, 20)).toBe(0);
    expect(mouthOf(t, 320, -320)).toBe(1);
    expect(mouthOf(t, 150, -150)).toBeNull();
    // the glass: two walls and four flares, none of it in a mouth's way
    const shapes = tubeShapes(t.play);
    expect(shapes).toHaveLength(6);
    for (const z of t.zones) for (const sh of shapes) expect(distToShape(sh, z.x, z.y)).toBeGreaterThan(TUBE.bore / 2);
  });

  it('a bendy one: its mouths face out along it, its walls follow every bend, and nothing blocks its bore', () => {
    // up, over and down: a hairpin bend
    const t = skyTube({ id: 2, pts: evenTube([[0, 0], [0, -300], [200, -300], [200, 0]]) });
    const [a, b] = tubeEnds(t.play);
    expect(a.fy).toBeGreaterThan(0.9);
    expect(b.fy).toBeGreaterThan(0.9);
    const shapes = tubeShapes(t.play);
    expect(shapes.length).toBeGreaterThan(10);
    for (const z of t.zones) for (const sh of shapes) expect(distToShape(sh, z.x, z.y)).toBeGreaterThan(TUBE.bore / 2);
    // (all along its middle, the walls are clear of the bore)
    const L = tubeLength(t.play);
    for (let s = 30; s < L - 30; s += 10) {
      const q = pointAt(t.play.pts, s);
      for (const sh of shapes) expect(distToShape(sh, q.x, q.y)).toBeGreaterThan(TUBE.bore / 2 - 1);
    }
  });

  it('a cat in at one end comes out of the other, going the way that mouth faces', () => {
    const s = sky([], ['kitten']);
    const cat = s.cats[0];
    const t: SkyTube = skyTube(straightTube(1, 0, -40, 260, -300));
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

  it('round every bend of a twisty one and out of the far end', () => {
    const s = sky([], ['kitten']);
    const cat = s.cats[0];
    // an S: along, down, back, down and out to the right
    const t: SkyTube = skyTube({ id: 3, pts: evenTube([[-300, -600], [200, -600], [200, -450], [-200, -450], [-200, -300], [300, -300]]) });
    for (const sh of tubeShapes(t.play)) s.world.addStatic(sh);
    const tubes = new Tubes<Cat, SkyTube>(() => s.world);
    cat.body.placeAt(t.zones[0].x, t.zones[0].y);
    tubes.start(cat, t, false);
    let out: { x: number; y: number } | null = null;
    let lowestY = -Infinity;
    for (let f = 0; f < 600 && !out; f++) {
      tubes.step();
      s.step();
      cat.body.computeCentroid();
      lowestY = Math.max(lowestY, cat.body.cy);
      for (const e of tubes.drain()) if (e.t === 'out') out = { x: e.x, y: e.y };
    }
    expect(out).not.toBeNull();
    const end = t.play.pts[t.play.pts.length - 1];
    expect(Math.hypot(out!.x - end[0], out!.y - end[1])).toBeLessThan(80);
    // (it went the whole way round: down past the second bend)
    expect(lowestY).toBeGreaterThan(-340);
    let vx = 0;
    for (let i = 0; i < cat.body.n; i++) vx += cat.body.vx[i] / cat.body.n;
    expect(vx).toBeGreaterThan(200);
  });
});

describe('toys', () => {
  const run = (pieces: PlayPiece[], frames: number, cat: Cat, s: Session, works: GadgetWorks, on?: (f: number) => void): GadgetEvent[] => {
    const toys = pieces.map(gadgetOf).filter((g): g is NonNullable<typeof g> => !!g);
    const out: GadgetEvent[] = [];
    for (let f = 0; f < frames; f++) {
      out.push(...works.step(toys, s.cats, (c) => !c.grabbed));
      s.step();
      on?.(f);
    }
    void cat;
    return out;
  };

  it('a fan pointing up floats a cat on its wind; pointing along, blows it along', () => {
    const fan: PlayPiece = { id: 1, kind: 'fan', x: 300, y: -100, aim: -90 };
    const s = sky([fan]);
    const cat = s.addCat('kitten', 300, -200, 'Pip');
    const works = new GadgetWorks(() => s.world);
    let top = Infinity;
    run([fan], 240, cat, s, works, () => {
      cat.body.computeCentroid();
      top = Math.min(top, cat.body.cy);
    });
    cat.body.computeCentroid();
    // up it went, and it's still up there, hovering over the fan
    expect(top).toBeLessThan(-300);
    expect(cat.body.cy).toBeLessThan(-200);
    expect(cat.body.cy).toBeGreaterThan(-100 - FAN.reach - 60);
    const side: PlayPiece = { id: 2, kind: 'fan', x: -400, y: -100, aim: 0 };
    const s2 = sky([side]);
    const c2 = s2.addCat('kitten', -330, -100, 'Pip');
    run([side], 40, c2, s2, new GadgetWorks(() => s2.world));
    c2.body.computeCentroid();
    expect(c2.body.cx).toBeGreaterThan(-200);
  });

  it('a belt carries a cat sitting on it its way; turned round, the other way', () => {
    for (const aim of [0, 180]) {
      const belt: PlayPiece = { id: 1, kind: 'belt', x: 300, y: -200, aim };
      const s = sky([belt]);
      const cat = s.addCat('kitten', 300, -200 - 22, 'Pip');
      const works = new GadgetWorks(() => s.world);
      run([belt], 50, cat, s, works);
      cat.body.computeCentroid();
      if (aim === 0) expect(cat.body.cx).toBeGreaterThan(340);
      else expect(cat.body.cx).toBeLessThan(260);
    }
  });

  it('a bumper bounces a cat dropped on it off, hard, and lights up', () => {
    const bumper: PlayPiece = { id: 5, kind: 'bumper', x: 300, y: -200 };
    const s = sky([bumper]);
    const cat = s.addCat('kitten', 310, -300, 'Pip');
    const works = new GadgetWorks(() => s.world);
    let bumped: GadgetEvent | null = null;
    let top = Infinity;
    let after = false;
    run([bumper], 90, cat, s, works, () => {
      cat.body.computeCentroid();
      if (after) top = Math.min(top, cat.body.cy);
      if (!after && works.flash.get(5)) after = true;
    });
    bumped = run([bumper], 0, cat, s, works)[0] ?? null;
    void bumped;
    expect(after).toBe(true);
    // (up and away again, higher than it'd bounce off anything soft)
    expect(top).toBeLessThan(-330);
  });

  it('a cat let go at a cannon is loaded, and a moment later fired the way it points', () => {
    const cannon: PlayPiece = { id: 7, kind: 'cannon', x: 300, y: -200, aim: -45 };
    const s = sky([cannon]);
    const cat = s.addCat('kitten', 0, -40, 'Pip');
    const works = new GadgetWorks(() => s.world);
    const g = gadgetOf(cannon)!;
    const m = cannonMouth(g);
    cat.body.placeAt(m.zx, m.zy);
    expect(GadgetWorks.cannonAt([g], m.zx, m.zy)).toBe(g);
    expect(works.load(cat, g)).toBe(true);
    expect(works.inCannon(cat)).toBe(7);
    expect(s.world.bodies).not.toContain(cat.body);
    let fired: { x: number; y: number } | null = null;
    let vx = 0;
    let vy = 0;
    for (let f = 0; f < 80 && !fired; f++) {
      for (const e of works.step([g], s.cats, (c) => !c.grabbed)) {
        if (e.t === 'fire') {
          fired = { x: e.x, y: e.y };
          for (let i = 0; i < cat.body.n; i++) {
            vx += cat.body.vx[i] / cat.body.n;
            vy += cat.body.vy[i] / cat.body.n;
          }
        }
      }
      s.step();
    }
    expect(fired).not.toBeNull();
    expect(works.inCannon(cat)).toBeNull();
    expect(s.world.bodies).toContain(cat.body);
    // out of its muzzle, up and to the right, fast
    expect(fired!.x).toBeGreaterThan(m.x);
    expect(fired!.y).toBeLessThan(m.y);
    expect(vx).toBeGreaterThan(600);
    expect(vy).toBeLessThan(-600);
    // (not straight back in)
    expect(works.load(cat, g)).toBe(false);
  });

  it('a cat in a cannon is stuffed in head first, its back end too big to go in bulging out of the muzzle', () => {
    for (const [breed, aim] of [['kitten', -90], ['chonk', -45], ['tabby', 0]] as const) {
      const cannon: PlayPiece = { id: 7, kind: 'cannon', x: 300, y: -200, aim };
      const s = sky([cannon]);
      const cat = s.addCat(breed, 0, -40, 'Pip');
      const works = new GadgetWorks(() => s.world);
      const g = gadgetOf(cannon)!;
      const m = cannonMouth(g);
      cat.body.placeAt(m.zx, m.zy);
      expect(works.load(cat, g)).toBe(true);
      for (let f = 0; f < 20; f++) works.step([g], s.cats, (c) => !c.grabbed);
      const d = { x: Math.cos((aim * Math.PI) / 180), y: Math.sin((aim * Math.PI) / 180) };
      const b = cat.body;
      let wide = 0;
      for (let i = 0; i < b.n; i++) {
        const u = (b.x[i] - g.x) * d.x + (b.y[i] - g.y) * d.y;
        const v = Math.abs(-(b.x[i] - g.x) * d.y + (b.y[i] - g.y) * d.x);
        // (never out of the back of the barrel; down the bore, no wider than it)
        expect(u).toBeGreaterThan(-2);
        if (u < CANNON.fore - 4) expect(v).toBeLessThan(CANNON.r + 4);
        else wide = Math.max(wide, v);
      }
      // its back end won't fit: out of the muzzle, wider than the barrel
      expect(wide).toBeGreaterThan(CANNON.r * 1.2);
      const r = works.rump(cat)!;
      expect(r).not.toBeNull();
      expect((r.x - m.x) * d.x + (r.y - m.y) * d.y).toBeGreaterThan(8);
      expect(r.dx).toBeCloseTo(d.x);
      expect(r.dy).toBeCloseTo(d.y);
      // and fired, it's a whole cat again
      for (let f = 0; f < 60 && works.inCannon(cat) !== null; f++) works.step([g], s.cats, (c) => !c.grabbed);
      expect(works.rump(cat)).toBeNull();
      expect(works.shake(7)).toBe(0);
    }
  });

  it('saved with its aim; an aim that makes no sense is put right', () => {
    const s = readPlay(JSON.stringify({ v: 1, pieces: [{ id: 1, kind: 'cannon', x: 0, y: -100, aim: 60 }, { id: 2, kind: 'belt', x: 0, y: -300, aim: 170 }, { id: 3, kind: 'fan', x: 0, y: -500 }], tubes: [], nextId: 4, cats: [] }));
    expect(s.pieces.map((p) => p.aim)).toEqual([0, 180, -90]);
    expect(fitAim('cannon', -52)).toBe(-45);
    expect(fitAim('fan', 97)).toBe(90);
  });
});
