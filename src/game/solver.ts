// The solver plays a room the way a person would: it drags one cat at a time
// toward a container with a finger-like gesture, lets physics run, and checks
// that the cat ends up seated. Rooms are only published if every cat fits, and
// the number of nudges it needed becomes the room's par.

import { breedArea } from '../physics/breeds';
import { Session } from './session';
import type { PlanStep, RoomDef } from './room';

export interface SolveResult {
  ok: boolean;
  par: number;
  plan: PlanStep[];
  cozy: number;
  /** Physics frames simulated (cost metric). */
  frames: number;
  /** Which cats failed (for generator diagnostics). */
  failed: number[];
}

export interface SolveOptions {
  /** Intended container for each cat (index into def.containers). */
  assignment?: number[];
  /** Cat order to try. */
  order?: number[];
  /** Give up after this many simulated frames. */
  maxFrames?: number;
}

const SETTLE_LIMIT = 260;

interface Gesture {
  kind: 'drag' | 'boop';
  gx: number;
  gy: number;
  tx: number;
  ty: number;
  /** Frames per leg of pointer travel. */
  move: number;
  /** Max frames to keep holding at the target waiting for a good release. */
  hold: number;
  /** Release when the cat is within this fraction of the opening width of its centre. */
  tol: number;
  /** Optional waypoint: slide off the edge first. */
  wx?: number;
  wy?: number;
}

/** Estimate a pleasant cat->container assignment by volume, slightly preferring drops. */
export function proposeAssignment(session: Session): number[] {
  const cats = session.cats;
  const cont = session.containers;
  const n = cats.length;
  const m = cont.length;
  const best = { score: -Infinity, assign: [] as number[] };
  const used = new Array<boolean>(m).fill(false);
  const cur: number[] = [];
  const scorePair = (ci: number, k: number): number => {
    const cat = cats[ci];
    const c = cont[k];
    const ratio = breedArea(cat.breed) / c.capacity;
    let s = -Math.abs(Math.log(ratio / 1.5));
    // Every cat can be carried, but a drop is still the natural move.
    if (c.opening!.y < cat.body.cy + cat.body.p.radius * 0.5) s -= 0.15;
    // narrow necks don't take big stiff cats
    const openW = c.opening!.x1 - c.opening!.x0;
    if (openW < cat.body.p.radius * 1.2 && cat.body.p.shape > 0.005) s -= 3;
    s -= Math.abs(c.x - cat.body.cx) / 600;
    return s;
  };
  const rec = (i: number, acc: number): void => {
    if (i === n) {
      if (acc > best.score) {
        best.score = acc;
        best.assign = cur.slice();
      }
      return;
    }
    for (let k = 0; k < m; k++) {
      if (used[k]) continue;
      used[k] = true;
      cur.push(k);
      rec(i + 1, acc + scorePair(i, k));
      cur.pop();
      used[k] = false;
    }
  };
  rec(0, 0);
  return best.assign;
}

export function gesturesFor(session: Session, catIndex: number, k: number): Gesture[] {
  const cat = session.cats[catIndex];
  const b = cat.body;
  b.computeCentroid();
  const c = session.containers[k];
  const op = c.opening!;
  const mid = (op.x0 + op.x1) / 2;
  const r = b.p.radius;
  const dir = Math.sign(mid - b.cx) || 1;
  // Held by the scruff (its top, about 0.7 r over where it's grabbed) a cat
  // hangs about 2 r / sqrt(hang) long: hold it so its bottom clears the rim.
  const above = op.y + r * 0.6 - (2 * r) / Math.sqrt(b.p.hang);
  const out: Gesture[] = [];
  const dist = Math.abs(mid - b.cx);
  const mv = Math.round(Math.min(40, 16 + dist / 5));
  // Grab on the far side so the cat stretches toward where it's going.
  const gx = b.cx + dir * r * 0.35;
  const gy = b.cy - r * 0.1;
  const ty = Math.min(above, b.cy - 4);
  const support = supportSpan(session, catIndex);
  const tucked = support && mid > support.x0 - r * 0.3 && mid < support.x1 + r * 0.3;
  if (tucked) {
    // The container is under the cat's own perch: slide off the nearer edge first.
    const rightGap = support.x1 - b.cx;
    const leftGap = b.cx - support.x0;
    const toRight = (mid > b.cx ? rightGap * 0.7 : rightGap * 1.4) < (mid < b.cx ? leftGap * 0.7 : leftGap * 1.4);
    const ex = toRight ? support.x1 + r * 0.9 : support.x0 - r * 0.9;
    // step off the edge and down to below the perch, then carry it in under
    // the perch (dangling by the scruff, the cat's top must clear its underside)
    const under = Math.max(above, support.y + r * 0.7 + 16);
    for (const [tol, hold] of [
      [0.3, 40],
      [0.18, 60],
      [0.45, 20],
    ] as const) {
      out.push({ kind: 'drag', gx: b.cx + (toRight ? 1 : -1) * r * 0.35, gy, tx: mid, ty: under, move: mv, hold, tol, wx: ex, wy: under });
    }
  }
  for (const [dx, tol, hold, m] of [
    [0, 0.3, 40, mv],
    [0, 0.15, 60, mv + 8],
    [-dir * 0.2, 0.25, 50, mv],
    [dir * 0.2, 0.4, 30, Math.max(12, mv - 6)],
  ] as const) {
    out.push({ kind: 'drag', gx, gy, tx: mid + dx * (op.x1 - op.x0), ty, move: m, hold, tol });
  }
  // A boop toward the container (useful for jumpy/light cats near an edge).
  out.push({ kind: 'boop', gx: b.cx - dir * r * 0.8, gy: b.cy, tx: 0, ty: 0, move: 0, hold: 0, tol: 0 });
  return out;
}

/** Horizontal extent of whatever the cat is standing on. */
function supportSpan(session: Session, catIndex: number): { x0: number; x1: number; y: number } | null {
  const b = session.cats[catIndex].body;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y = Infinity;
  for (let i = 0; i < b.n; i++) {
    if (b.contactShape[i] === -1 || b.contactNy[i] > -0.45) continue;
    const s = session.world.shape(b.contactShape[i]);
    if (!s || s.material === 'wall') continue;
    x0 = Math.min(x0, s.minX);
    x1 = Math.max(x1, s.maxX);
    y = Math.min(y, s.minY);
  }
  return x1 > x0 ? { x0, x1, y } : null;
}

export function runGesture(session: Session, catIndex: number, g: Gesture, k: number): number {
  const cat = session.cats[catIndex];
  let frames = 0;
  if (g.kind === 'boop') {
    session.boop(cat, g.gx, g.gy);
  } else {
    const op = session.containers[k].opening!;
    const mid = (op.x0 + op.x1) / 2;
    const half = (op.x1 - op.x0) * g.tol;
    // Like a person: watch the cat and let go once it's over the opening.
    // What the cat was standing on when grabbed: don't let go while it's still there.
    const perch = new Set<number>();
    for (let i = 0; i < cat.body.n; i++) {
      const sid = cat.body.contactShape[i];
      if (sid !== -1 && cat.body.contactNy[i] < -0.45 && !session.containers[k].shapes.some((sh) => sh.id === sid)) perch.add(sid);
    }
    const ready = (): boolean => {
      const b = cat.body;
      if (Math.abs(b.cx - mid) > half) return false;
      let maxY = -Infinity;
      let onPerch = 0;
      for (let i = 0; i < b.n; i++) {
        if (b.y[i] > maxY) maxY = b.y[i];
        if (perch.has(b.contactShape[i])) onPerch++;
      }
      return onPerch <= 1 && maxY < op.y + b.p.radius * 0.6;
    };
    session.beginGrab(cat, g.gx, g.gy);
    // Aim the scruff, not the finger: the cat hangs under the pinch, which
    // can sit a little to one side of where it was touched.
    const ox = cat.body.grab ? cat.body.grab.midX : 0;
    const tx = g.tx - ox;
    const legs: Array<[number, number, number, number, number, boolean]> = [];
    if (g.wx !== undefined && g.wy !== undefined) {
      const m1 = Math.max(10, Math.round(g.move * 0.55));
      legs.push([g.gx, g.gy, g.wx - ox, g.wy, m1, false], [g.wx - ox, g.wy, tx, g.ty, Math.max(10, g.move - m1), true]);
    } else legs.push([g.gx, g.gy, tx, g.ty, g.move, true]);
    let released = false;
    for (const [ax, ay, bx, by, mv, check] of legs) {
      for (let f = 1; f <= mv && !released; f++) {
        const t = f / mv;
        const e = t * t * (3 - 2 * t);
        const vx = ((bx - ax) * 6 * t * (1 - t) * 60) / mv;
        const vy = ((by - ay) * 6 * t * (1 - t) * 60) / mv;
        session.moveGrab(ax + (bx - ax) * e, ay + (by - ay) * e, vx, vy);
        session.step();
        frames++;
        if (check && ready()) released = true;
      }
    }
    for (let f = 0; f < g.hold && !released; f++) {
      session.moveGrab(tx, g.ty, 0, 0);
      session.step();
      frames++;
      if (ready()) released = true;
    }
    session.endGrab();
  }
  // Let things settle: wait until every cat is calm (or the limit).
  let calm = 0;
  for (let f = 0; f < SETTLE_LIMIT; f++) {
    session.step();
    frames++;
    const moving = session.cats.some((c) => c.body.emaEnergy > 120 || c.body.airborneFrames > 0);
    calm = moving ? 0 : calm + 1;
    if (calm > 30 && f > 40) break;
  }
  return frames;
}

/** Snapshot of everything the solver needs to rewind. */
function snap(session: Session): () => void {
  const bodies = session.cats.map((c) => c.body.snapshot());
  const seats = session.cats.map((c) => (c.seat ? { ...c.seat, cozy: { ...c.seat.cozy } } : null));
  const settled = session.cats.map((c) => c.settled);
  const paws = session.paws;
  return () => {
    session.cats.forEach((c, i) => {
      c.body.restore(bodies[i]);
      c.seat = seats[i] ? { ...seats[i]!, cozy: { ...seats[i]!.cozy } } : null;
      c.settled = settled[i];
      c.grabbed = false;
      c.intent = null;
    });
    session.paws = paws;
    session.complete = false;
    session.drainEvents();
  };
}

export function solveRoom(def: RoomDef, opts: SolveOptions = {}): SolveResult {
  const probe = new Session(def, { mode: 'puzzle' });
  const assignment = opts.assignment ?? proposeAssignment(probe);
  const n = probe.cats.length;
  const byHeight = [...Array(n).keys()].sort((a, b) => probe.cats[b].body.cy - probe.cats[a].body.cy);
  const orders = opts.order ? [opts.order] : [byHeight, [...byHeight].reverse()];
  let budget = opts.maxFrames ?? 24000;
  let best: SolveResult | null = null;
  for (const order of orders) {
    const res = attempt(def, assignment, order, budget);
    budget -= res.frames;
    if (!best || (res.ok && !best.ok) || res.plan.length > best.plan.length) best = res;
    if (res.ok || budget <= 0) break;
  }
  return best!;
}

function attempt(def: RoomDef, assignment: number[], order: number[], maxFrames: number): SolveResult {
  const session = new Session(def, { mode: 'puzzle' });
  const plan: PlanStep[] = [];
  let frames = 0;
  const failed: number[] = [];
  for (const ci of order) {
    if (session.cats[ci].seat) continue;
    const k = assignment[ci];
    let done = false;
    const restore = snap(session);
    const free = (j: number): boolean => !session.cats.some((c) => c.seat && c.seat.container === j);
    // Pass 1: the intended container. Pass 2: any other free container.
    // Pass 3: accept wherever the cat happily ends up.
    const others = session.containers.map((_, j) => j).filter((j) => j !== k);
    const passes: Array<[number, boolean]> = [];
    if (k !== undefined) passes.push([k, true]);
    for (const j of others) passes.push([j, true]);
    for (const j of [k, ...others]) if (j !== undefined) passes.push([j, false]);
    outer: for (const [target, strict] of passes) {
      if (!free(target)) continue;
      for (const g of gesturesFor(session, ci, target)) {
        if (frames > maxFrames) break outer;
        const cat = session.cats[ci];
        cat.body.computeCentroid();
        const ox = cat.body.cx;
        const oy = cat.body.cy;
        frames += runGesture(session, ci, g, target);
        const ok = cat.seat && (!strict || cat.seat.container === target) && plan.every((p) => session.cats[p.cat].seat);
        if (ok) {
          plan.push({ cat: ci, container: cat.seat!.container, gx: g.gx - ox, gy: g.gy - oy, tx: g.tx, ty: g.ty, hold: g.hold, kind: g.kind, wx: g.wx, wy: g.wy, move: g.move, tol: g.tol });
          done = true;
          break outer;
        }
        restore();
      }
    }
    if (!done) failed.push(ci);
  }
  // Let the room finish and read the final cozy score.
  for (let f = 0; f < 90 && !session.complete; f++) {
    session.step();
    frames++;
  }
  const ok = failed.length === 0 && session.cats.every((c) => c.seat);
  const cozy = ok ? session.results().cozy : 0;
  return { ok, par: plan.length, plan, cozy, frames, failed };
}
