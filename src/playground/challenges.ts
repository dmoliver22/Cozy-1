// Challenges up in the clouds: a little course built for you, a cat waiting
// at its start, a goal with a star on it, and a few pieces of your own to put
// anywhere. Put them, press Go, and watch. Every Go starts from the same
// fresh world (the cat set off the same way: a fresh round cat from a held
// cannon, or one dropped from a cloud that puffs away), so a way that works
// once works every time, and one that doesn't is never down to luck.

import type { Cat, Session } from '../game/session';
import { NAMES } from '../house/house';
import { PERCH_PROP_BASE } from '../house/perches';
import { gadgetOf, evenTube, pieceBox, snapFunnel, type PieceKind, type PlayPiece, type PlaySave, type PlayTube } from './layout';
import type { SkyEvent, SkySim } from './sim';

/** A piece you may put (how many), or tubes (how many, and how long each at most). */
export interface KitItem {
  kind: PieceKind | 'tube';
  n: number;
  /** A tube's longest (units). */
  max?: number;
}

export interface Challenge {
  id: string;
  name: string;
  /** What to do, in a line. */
  goal: string;
  /** A nudge, for when it's hard going. */
  hint: string;
  treats: number;
  /** The course (nothing of it can be moved). */
  course: () => PlaySave;
  /** How the cat sets off: fired by a cannon (held till Go), or dropped when the cloud it's on puffs away. */
  start: { kind: 'cannon' | 'drop'; piece: number };
  /** The piece the cat's to end up on (or in). */
  target: number;
  kit: KitItem[];
  /** A way that works (the tests check it, and that nothing at all doesn't). */
  solution: { pieces: PlayPiece[]; tubes: PlayTube[] };
}

/** The cat that takes the challenges (the courses are made for its size). */
export const CHALLENGE_CAT = 'kitten' as const;

/** A challenge's words with the cat called what you've called it. */
export function told(text: string): string {
  return text.replace(/\bKitten\b/g, NAMES[CHALLENGE_CAT]);
}

/** A course's pieces and tubes as a save (ids from 1; yours carry on after). */
function save(pieces: PlayPiece[], tubes: PlayTube[] = []): PlaySave {
  const ids = [...pieces.map((p) => p.id), ...tubes.map((t) => t.id)];
  return { v: 1, pieces, tubes, nextId: Math.max(0, ...ids) + 1, cats: [] };
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'belt',
    name: 'Carried along',
    goal: 'Get Kitten into the cat bed',
    hint: 'Put the belt under Kitten, running toward the bed',
    treats: 10,
    course: () =>
      save([
        { id: 1, kind: 'cloud', x: 0, y: 0 },
        { id: 2, kind: 'bed', x: 200, y: 160 },
        { id: 3, kind: 'cloud', x: 200, y: 180 },
      ]),
    start: { kind: 'drop', piece: 1 },
    target: 2,
    kit: [{ kind: 'belt', n: 1 }],
    solution: { pieces: [{ id: 50, kind: 'belt', x: 40, y: 80, aim: 0 }], tubes: [] },
  },
  {
    id: 'fan',
    name: 'Blown away',
    goal: 'Get Kitten into the cat bed',
    hint: 'A fan beside Kitten’s fall, blowing toward the bed',
    treats: 15,
    course: () =>
      save([
        { id: 1, kind: 'cloud', x: 0, y: 0 },
        { id: 2, kind: 'bed', x: 190, y: 320 },
        { id: 3, kind: 'cloud', x: 190, y: 340 },
      ]),
    start: { kind: 'drop', piece: 1 },
    target: 2,
    kit: [{ kind: 'fan', n: 1 }],
    solution: { pieces: [{ id: 50, kind: 'fan', x: -90, y: 90, aim: 0 }], tubes: [] },
  },
  {
    id: 'funnel',
    name: 'Catch!',
    goal: 'Get Kitten into the cat bed',
    hint: 'The cannon just misses the tube: put a funnel on its end',
    treats: 20,
    course: () => {
      // (the tube's end a little off the cannon's line: it misses, but a funnel on it doesn't)
      const tube: PlayTube = {
        id: 4,
        pts: evenTube([
          [392, -462],
          [476, -533],
          [652, -482],
          [722, -342],
          [732, -162],
          [732, -102],
        ]),
      };
      return save(
        [
          { id: 1, kind: 'cloud', x: 0, y: 0 },
          { id: 2, kind: 'cannon', x: 0, y: -30, aim: -60 },
          { id: 3, kind: 'bed', x: 732, y: 58 },
          { id: 5, kind: 'cloud', x: 732, y: 78 },
        ],
        [tube],
      );
    },
    start: { kind: 'cannon', piece: 2 },
    target: 3,
    kit: [{ kind: 'funnel', n: 1 }],
    solution: { pieces: [{ id: 50, kind: 'funnel', x: 392, y: -462, aim: 140 }], tubes: [] },
  },
  {
    id: 'tube',
    name: 'Pipe dream',
    goal: 'Get Kitten into the cat bed',
    hint: 'Draw a tube from under Kitten round to just over the bed',
    treats: 25,
    course: () =>
      save([
        { id: 1, kind: 'cloud', x: 0, y: 0 },
        { id: 2, kind: 'bed', x: 420, y: 480 },
        { id: 3, kind: 'cloud', x: 420, y: 500 },
      ]),
    start: { kind: 'drop', piece: 1 },
    target: 2,
    kit: [{ kind: 'tube', n: 1, max: 1100 }],
    solution: {
      pieces: [],
      tubes: [
        {
          id: 50,
          pts: evenTube([
            [0, 110],
            [0, 200],
            [70, 250],
            [250, 250],
            [380, 230],
            [420, 130],
            [420, 330],
          ]),
        },
      ],
    },
  },
  {
    id: 'fanfunnel',
    name: 'Blown in',
    goal: 'Get Kitten into the cat bed',
    hint: 'Blow Kitten across to the tube, and give the tube a funnel to catch it',
    treats: 30,
    course: () =>
      save(
        [
          { id: 1, kind: 'cloud', x: 0, y: 0 },
          { id: 2, kind: 'bed', x: 480, y: 600 },
          { id: 3, kind: 'cloud', x: 480, y: 620 },
        ],
        [
          {
            id: 4,
            pts: evenTube([
              [320, 130],
              [420, 130],
              [490, 250],
              [500, 340],
              [480, 400],
              [480, 450],
            ]),
          },
        ],
      ),
    start: { kind: 'drop', piece: 1 },
    target: 2,
    kit: [
      { kind: 'fan', n: 1 },
      { kind: 'funnel', n: 1 },
    ],
    solution: {
      pieces: [
        { id: 50, kind: 'fan', x: -90, y: 20, aim: 0 },
        { id: 51, kind: 'funnel', x: 320, y: 130, aim: -180 },
      ],
      tubes: [],
    },
  },
  {
    id: 'grand',
    name: 'The grand tour',
    goal: 'Get Kitten into the hammock, the way the tour went',
    hint: 'The tube needs a funnel, and the fall from it needs a push toward the cushion',
    treats: 40,
    course: () =>
      save(
        [
          { id: 1, kind: 'cloud', x: 40, y: 0 },
          { id: 2, kind: 'cannon', x: 40, y: -30, aim: -45 },
          { id: 3, kind: 'bounce', x: 860, y: 150 },
          { id: 4, kind: 'cloud', x: 860, y: 184 },
          { id: 5, kind: 'hammock', x: 1330, y: 140 },
        ],
        [
          {
            id: 6,
            pts: evenTube([
              [231, -274],
              [311, -354],
              [500, -370],
              [620, -360],
              [720, -300],
              [790, -220],
              [800, -160],
              [800, -130],
            ]),
          },
        ],
      ),
    start: { kind: 'cannon', piece: 2 },
    target: 5,
    kit: [
      { kind: 'funnel', n: 1 },
      { kind: 'fan', n: 1 },
    ],
    solution: {
      pieces: [
        { id: 50, kind: 'funnel', x: 231, y: -274, aim: 135 },
        { id: 51, kind: 'fan', x: 720, y: -20, aim: 0 },
      ],
      tubes: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Going

/** Where the cat waits at the start: on the start cloud, or in the cannon. */
export function startSpot(ch: Challenge, course: PlaySave): { x: number; y: number } {
  const p = course.pieces.find((q) => q.id === ch.start.piece)!;
  return ch.start.kind === 'drop' ? { x: p.x, y: p.y - 23 } : { x: p.x, y: p.y };
}

/**
 * Go: the cat sets off. A held cannon fires it; or the cloud it's sitting on
 * puffs away under it (the cat a fresh round cat right where it sat, so it's
 * the same every time). Returns where, for a puff.
 */
export function setOff(ch: Challenge, sim: SkySim, s: Session, cat: Cat): { x: number; y: number } {
  const p = sim.props.find((q) => q.save.id === ch.start.piece)!;
  // (however long it waited: off it goes fresh)
  cat.settled = 0;
  cat.intent = null;
  cat.sinceTouch = 0;
  if (ch.start.kind === 'cannon') {
    sim.works.fire(p.save.id);
    return { x: p.save.x, y: p.save.y };
  }
  s.world.removeStaticsOfProp(PERCH_PROP_BASE + p.save.id);
  sim.props.splice(sim.props.indexOf(p), 1);
  s.registerShapes();
  const at = startSpot(ch, { v: 1, pieces: [p.save], tubes: [], nextId: 0, cats: [] });
  cat.body.reset(at.x, at.y);
  return at;
}

/** Load the cat in the start cannon, to wait for Go (a cannon start). */
export function holdInCannon(ch: Challenge, sim: SkySim, cat: Cat): void {
  if (ch.start.kind !== 'cannon') return;
  const g = sim.toys().find((t) => t.id === ch.start.piece);
  if (g) sim.works.load(cat, g, true);
}

/** How long a go can take, how long the cat must lie still on the goal to have made it, and still anywhere else to have stopped short (frames). */
const GO_MAX = 60 * 12;
const SETTLE_WIN = 30;
const SETTLE_LOSE = 100;

export type Outcome = { t: 'won' } | { t: 'lost'; why: 'fell' | 'stuck' | 'slow' };

/** A go, watched: made it (lying still on the goal), or not (fell into the clouds, stopped somewhere else, or took too long). */
export class Attempt {
  private t = 0;
  done: Outcome | null = null;

  constructor(private readonly ch: Challenge) {}

  heard(e: SkyEvent): void {
    if (!this.done && e.t === 'fell') this.done = { t: 'lost', why: 'fell' };
  }

  step(sim: SkySim, cat: Cat): Outcome | null {
    if (this.done) return this.done;
    this.t++;
    const b = cat.body;
    if (sim.tubes.riding(cat) || sim.works.inCannon(cat) !== null) return null;
    b.computeCentroid();
    if (onTarget(this.ch, sim, cat) && cat.settled > SETTLE_WIN) this.done = { t: 'won' };
    else if (cat.settled > SETTLE_LOSE) this.done = { t: 'lost', why: 'stuck' };
    else if (this.t > GO_MAX) this.done = { t: 'lost', why: 'slow' };
    return this.done;
  }
}

/** Is the cat on (or in) the goal? */
export function onTarget(ch: Challenge, sim: SkySim, cat: Cat): boolean {
  const p = sim.props.find((q) => q.save.id === ch.target);
  if (!p) return false;
  if (p.sling) return p.sling.riders.includes(cat.body);
  const b = cat.body;
  const box = pieceBox(p.save);
  return b.cx > box.x0 && b.cx < box.x1 && b.cy > box.y0 - b.p.radius * 1.5 && b.cy < box.y1;
}

/** Your pieces and tubes in a challenge: what's not the course's. */
export function yours(ch: Challenge, s: PlaySave): { pieces: PlayPiece[]; tubes: PlayTube[] } {
  const c = ch.course();
  const pid = new Set(c.pieces.map((p) => p.id));
  const tid = new Set(c.tubes.map((t) => t.id));
  return { pieces: s.pieces.filter((p) => !pid.has(p.id)), tubes: s.tubes.filter((t) => !tid.has(t.id)) };
}

/** How many more of each kit item you may put. */
export function kitLeft(ch: Challenge, s: PlaySave): KitItem[] {
  const y = yours(ch, s);
  return ch.kit.map((k) => ({ ...k, n: k.n - (k.kind === 'tube' ? y.tubes.length : y.pieces.filter((p) => p.kind === k.kind).length) }));
}

/** Is this one of the course's own (not to be moved)? */
export function ofCourse(ch: Challenge, id: number): boolean {
  const c = ch.course();
  return c.pieces.some((p) => p.id === id) || c.tubes.some((t) => t.id === id);
}

// (for courses with a tube to snap a funnel onto, and a tidy tube)
export { evenTube, gadgetOf, snapFunnel };

// ---------------------------------------------------------------------------
// Progress

export const CHALLENGES_KEY = 'cozy-challenges:v1';

/** The challenges done (ids). */
export function solvedChallenges(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CHALLENGES_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Done: true the first time (its treats are paid then). */
export function markSolved(id: string): boolean {
  const done = solvedChallenges();
  if (done.includes(id)) return false;
  try {
    localStorage.setItem(CHALLENGES_KEY, JSON.stringify([...done, id]));
  } catch {
    // (private browsing: it's only for now)
  }
  return true;
}

/** Open to try: the first, and each after one that's done. */
export function unlocked(i: number, done: readonly string[]): boolean {
  return i === 0 || done.includes(CHALLENGES[i - 1].id);
}
