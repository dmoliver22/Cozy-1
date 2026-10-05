// Cat Jar rules: a "Suika" game with soft cats. The next cat waits above the
// jar; you aim and drop it. Two cats of the same tier that touch melt into one
// of the next tier (spawned small between them, growing in so the pile makes
// room instead of exploding). Boops make a cat hop to jiggle the pile. A cat
// resting above the full line for two seconds ends the game.
//
// Everything here runs in fixed 1/60 s frames and is deterministic for a given
// seed and inputs (no DOM, no wall clock), so tests can drive it frame by frame.

import { NODE_RADIUS, SoftBody } from '../../physics/softbody';
import { GRAVITY, World } from '../../physics/world';
import { clamp } from '../../util/math';
import { bodiesTouch, rng } from '../kit';
import {
  BOOP_EARN_TIER,
  BOOPS_MAX,
  BOOPS_START,
  CHAIN_FRAMES,
  CHAIN_MAX,
  CX,
  DROP_WEIGHTS,
  FULL_FRAMES,
  GRACE_BOOP,
  GRACE_DROP,
  HOLD_Y,
  JAR,
  LAST_TIER,
  LINE_Y,
  RELOAD_FRAMES,
  TIERS,
  mergePoints,
} from './config';
import { buildStatics } from './jarShape';

export type Mode = 'play' | 'daily';

export interface JarCat {
  /** Stable id (also the purr voice id). */
  id: number;
  tier: number;
  body: SoftBody;
  /** Frame it entered the jar (dropped, or melted from two). */
  born: number;
  dropped: boolean;
  /** Last boop frame (-1e9 = never). */
  booped: number;
  /** Growing in after a merge: radius from -> to over `frames`. */
  grow: { from: number; to: number; t0: number; frames: number } | null;
  /** Can't melt again before this frame (lets the pop register). */
  lockUntil: number;
  /** Still falling from its drop (for the landing thump and the 'wide' face). */
  falling: boolean;
  prevVy: number;
  /** Neighbours (and where they were) when it fell asleep: it wakes if any of them moves or leaves. */
  sleepRefs: { b: SoftBody; x: number; y: number }[] | null;
  /** Frames spent at rest (for faces and paws). */
  rest: number;
  /** Melted into another cat this frame. */
  removed: boolean;
  /** Links in the chain reaction that made it (0 = dropped). */
  chain: number;
}

/** A cat that just melted away (the view shrinks it into the new one). */
export interface Ghost {
  body: SoftBody;
  tier: number;
  tx: number;
  ty: number;
}

export type JarEvent =
  | { t: 'spawn'; tier: number }
  | { t: 'drop'; cat: JarCat }
  | { t: 'land'; cat: JarCat; speed: number }
  | { t: 'clink'; cat: JarCat; speed: number }
  | { t: 'merge'; tier: number; cat: JarCat | null; ghosts: Ghost[]; x: number; y: number; points: number; chain: number; earned: boolean }
  | { t: 'boop'; cat: JarCat }
  | { t: 'danger'; on: boolean }
  | { t: 'over' };

export interface Waiting {
  tier: number;
  body: SoftBody;
  /** Frame it appeared (pop-in). */
  since: number;
}

let nextCatId = 1;

// In a jar most cats rest on other cats, not on the glass: let that count as
// contact, so the whole pile gets the engine's rest damping and can doze off.
SoftBody.restOnBodies = true;

export class JarGame {
  world = new World();
  cats: JarCat[] = [];
  frame = 0;
  mode: Mode = 'play';
  seed = 1;
  /** Upcoming tiers: queue[0] is the one waiting at the top, queue[1] the preview. */
  queue: number[] = [];
  waiting: Waiting | null = null;
  /** Where the player aims (x of the waiting cat's centre), and where it is now. */
  aimX = CX;
  holdX = CX;
  score = 0;
  boops = BOOPS_START;
  over = false;
  /** Frames a cat has been resting above the full line. */
  full = 0;
  danger = false;
  biggest = 0;
  drops = 0;
  merges = 0;
  events: JarEvent[] = [];
  private rand: () => number = rng(1);
  private silent = new Set<number>();
  private reloadAt = 0;

  constructor(mode: Mode = 'play', seed?: number) {
    this.restart(mode, seed);
  }

  restart(mode: Mode, seed?: number): void {
    this.mode = mode;
    this.seed = (seed ?? (Math.random() * 4294967296) >>> 0) >>> 0;
    this.rand = rng(this.seed ^ 0x5bd1e995);
    this.world = new World();
    const st = buildStatics();
    for (const s of st.shapes) this.world.addStatic(s);
    this.silent = st.silent;
    this.cats = [];
    this.frame = 0;
    this.queue = [];
    this.waiting = null;
    this.aimX = this.holdX = CX;
    this.score = 0;
    this.boops = BOOPS_START;
    this.over = false;
    this.full = 0;
    this.danger = false;
    this.biggest = 0;
    this.drops = 0;
    this.merges = 0;
    this.events = [];
    this.reloadAt = 0;
    this.fillQueue();
    this.spawnWaiting();
  }

  // --- Queue and the waiting cat ---------------------------------------------

  private fillQueue(): void {
    while (this.queue.length < 3) {
      const u = this.rand();
      let acc = 0;
      let t = DROP_WEIGHTS.length - 1;
      for (let k = 0; k < DROP_WEIGHTS.length; k++) {
        acc += DROP_WEIGHTS[k];
        if (u < acc) {
          t = k;
          break;
        }
      }
      this.queue.push(t);
    }
  }

  /** Force the upcoming tiers (tests and tutorials); the waiting cat is replaced. */
  setQueue(tiers: number[]): void {
    this.queue = tiers.map((t) => clamp(Math.round(t), 0, LAST_TIER));
    this.fillQueue();
    if (this.waiting) this.spawnWaiting();
  }

  private spawnWaiting(): void {
    const t = this.queue[0];
    const T = TIERS[t];
    const x = this.clampAim(this.aimX, t);
    this.holdX = x;
    const body = new SoftBody(T.breed, x, HOLD_Y, { ...T.phys, radius: T.r, nodes: T.nodes });
    this.waiting = { tier: t, body, since: this.frame };
    this.events.push({ t: 'spawn', tier: t });
  }

  /** Aim range for a cat of tier t: its whole body must clear the opening. */
  aimRange(t: number): [number, number] {
    const r = TIERS[t].r + NODE_RADIUS + 2;
    return [JAR.inL + r, JAR.inR - r];
  }

  private clampAim(x: number, t: number): number {
    const [a, b] = this.aimRange(t);
    return clamp(x, a, b);
  }

  aim(x: number): void {
    this.aimX = x;
  }

  /** Aim and put the waiting cat right there (no easing). */
  aimNow(x: number): void {
    this.aimX = x;
    if (this.waiting) {
      this.holdX = this.clampAim(x, this.waiting.tier);
      this.waiting.body.placeAt(this.holdX, HOLD_Y);
    }
  }

  /** Skip the wait after a drop: the next cat appears now. */
  reload(): void {
    if (!this.waiting && !this.over) this.spawnWaiting();
  }

  /** Let the waiting cat go. Returns false while reloading or after the game. */
  drop(): boolean {
    const w = this.waiting;
    if (!w || this.over) return false;
    const b = w.body;
    b.placeAt(this.holdX, HOLD_Y);
    b.kick(0, 40);
    this.world.addBody(b);
    const cat = this.addCat(w.tier, b, true);
    this.waiting = null;
    this.queue.shift();
    this.fillQueue();
    this.reloadAt = this.frame + RELOAD_FRAMES;
    this.drops++;
    this.events.push({ t: 'drop', cat });
    return true;
  }

  private addCat(tier: number, body: SoftBody, dropped: boolean): JarCat {
    const cat: JarCat = {
      id: nextCatId++,
      tier,
      body,
      born: this.frame,
      dropped,
      booped: -1e9,
      grow: null,
      lockUntil: 0,
      falling: dropped,
      prevVy: 0,
      sleepRefs: null,
      rest: 0,
      removed: false,
      chain: 0,
    };
    this.cats.push(cat);
    if (tier > this.biggest) this.biggest = tier;
    return cat;
  }

  /** Put a cat of a tier straight into the jar (tests, the attract screen). */
  place(tier: number, x: number, y: number): JarCat {
    const T = TIERS[clamp(Math.round(tier), 0, LAST_TIER)];
    const b = this.world.addBody(new SoftBody(T.breed, x, y, { ...T.phys, radius: T.r, nodes: T.nodes }));
    const cat = this.addCat(TIERS.indexOf(T), b, false);
    cat.born = this.frame - GRACE_DROP;
    return cat;
  }

  // --- Boops -----------------------------------------------------------------

  /** The jar cat nearest a world point, if its outline is within `reach` (a point inside a cat is nearest). */
  catAt(x: number, y: number, reach = 7): JarCat | null {
    let best: JarCat | null = null;
    let bestD = reach;
    for (const c of this.cats) {
      const d = outlineDistance(c.body, x, y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Make a cat hop (scaled to its size) away from the finger. */
  boop(cat: JarCat, fromX: number): boolean {
    if (this.over || this.boops <= 0 || cat.removed) return false;
    const b = cat.body;
    b.computeCentroid();
    const r = TIERS[cat.tier].r;
    // a hop about 1.2 radii (+16) high: a kitten springs, a chonk heaves
    const vy = Math.sqrt(2 * GRAVITY * (r * 1.2 + 16));
    const side = clamp((b.cx - fromX) / r, -1, 1);
    // A cat buried in the pile heaves up everything piled on it (sleeping
    // cats on top would otherwise hold it down like a lid), so a boop always
    // shows: the stack rises with it, and it pushes up a little harder.
    const stack = this.stackAbove(cat);
    for (const o of stack) {
      o.body.kick(0, -vy);
      o.booped = this.frame;
      o.rest = 0;
    }
    b.kick(side * vy * 0.3, -vy * (stack.length ? 1.25 : 1));
    cat.booped = this.frame;
    cat.rest = 0;
    this.boops--;
    // the hop shoves its neighbours awake (the ones resting on them follow: watchSleep)
    this.wakeNear(b, 8);
    for (const o of stack) this.wakeNear(o.body, 8);
    this.events.push({ t: 'boop', cat });
    return true;
  }

  /** The cats piled on a cat: those touching it from above, those on them, and so on. */
  stackAbove(cat: JarCat): JarCat[] {
    const out: JarCat[] = [];
    const seen = new Set<JarCat>([cat]);
    const todo = [cat];
    for (const c of this.cats) c.body.computeCentroid();
    while (todo.length) {
      const c = todo.pop()!;
      for (const o of this.cats) {
        if (seen.has(o) || o.removed || o.body.cy >= c.body.cy) continue;
        if (!bodiesTouch(c.body, o.body, NODE_RADIUS * 2 + 4)) continue;
        seen.add(o);
        out.push(o);
        todo.push(o);
      }
    }
    return out;
  }

  // --- The frame ----------------------------------------------------------------

  step(): void {
    this.frame++;
    const f = this.frame;
    // the waiting cat follows the aim (quickly, but not instantly)
    if (this.waiting) {
      const tx = this.clampAim(this.aimX, this.waiting.tier);
      this.holdX += (tx - this.holdX) * 0.4;
      if (Math.abs(tx - this.holdX) < 0.05) this.holdX = tx;
      this.waiting.body.placeAt(this.holdX, HOLD_Y);
    } else if (!this.over && f >= this.reloadAt) this.spawnWaiting();
    this.growCats();
    this.world.step();
    for (const imp of this.world.drainImpacts()) {
      if (this.silent.has(imp.shape.id)) continue;
      const cat = this.cats.find((c) => c.body === imp.body);
      if (cat) this.events.push({ t: 'clink', cat, speed: imp.speed });
    }
    for (const cat of this.cats) this.updateCat(cat);
    if (!this.over) this.findMerges();
    this.cats = this.cats.filter((c) => !c.removed);
    this.checkFull();
  }

  private growCats(): void {
    for (const cat of this.cats) {
      const g = cat.grow;
      if (!g) continue;
      const t = clamp((this.frame - g.t0) / g.frames, 0, 1);
      // ease out: quick at first, settling into the full size
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      cat.body.resize(g.from + (g.to - g.from) * e);
      // the pile has to make room: neighbours wake up and get pushed
      this.wakeNear(cat.body, 12);
      if (t >= 1) cat.grow = null;
    }
  }

  private wakeNear(b: SoftBody, gap: number): void {
    const bb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const ob = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    b.bounds(bb);
    for (const c of this.cats) {
      const o = c.body;
      if (o === b || !o.asleep) continue;
      o.bounds(ob);
      if (ob.maxX + gap < bb.minX || bb.maxX + gap < ob.minX || ob.maxY + gap < bb.minY || bb.maxY + gap < ob.minY) continue;
      o.wake();
    }
  }

  private updateCat(cat: JarCat): void {
    const b = cat.body;
    // landing: a sharp stop while falling
    if (cat.falling) {
      const vy = b.vcy;
      if (this.frame - cat.born > 3 && cat.prevVy > 140 && cat.prevVy - vy > 110) {
        cat.falling = false;
        // the glass reports its own clink; this is the soft thump on a cat
        if (b.impactShape === -1) this.events.push({ t: 'land', cat, speed: cat.prevVy });
      } else if (this.frame - cat.born > 240) cat.falling = false;
      cat.prevVy = vy;
    }
    const still = b.asleep || (b.emaVx * b.emaVx + b.emaVy * b.emaVy < 20 * 20 && b.airborneFrames < 3);
    cat.rest = still ? cat.rest + 1 : 0;
    // A resting cat curls into a loaf (the rest shape only matters for the
    // jelly and pudding breeds); a moving one rounds out.
    if (cat.rest > 20) b.loafiness = Math.min(1, b.loafiness + 0.02);
    else if (b.energy > 900) b.loafiness = Math.max(0, b.loafiness - 0.05);
    this.watchSleep(cat);
  }

  /**
   * A sleeping cat is frozen in place. That's what keeps a settled pile calm,
   * but a sleeper must not float when what held it up moves away: remember its
   * neighbours when it dozes off, and wake it if any of them moves or leaves.
   */
  private watchSleep(cat: JarCat): void {
    const b = cat.body;
    if (!b.asleep) {
      cat.sleepRefs = null;
      return;
    }
    if (!cat.sleepRefs) {
      const refs: { b: SoftBody; x: number; y: number }[] = [];
      for (const o of this.cats) {
        if (o === cat || o.removed) continue;
        if (bodiesTouch(b, o.body, NODE_RADIUS * 2 + 4)) {
          o.body.computeCentroid();
          refs.push({ b: o.body, x: o.body.cx, y: o.body.cy });
        }
      }
      cat.sleepRefs = refs;
      return;
    }
    for (const r of cat.sleepRefs) {
      if (!this.world.bodies.includes(r.b)) {
        b.wake();
        break;
      }
      if (r.b.asleep) continue;
      r.b.computeCentroid();
      const dx = r.b.cx - r.x;
      const dy = r.b.cy - r.y;
      if (dx * dx + dy * dy > 1.2 * 1.2) {
        b.wake();
        break;
      }
    }
    if (!b.asleep) cat.sleepRefs = null;
  }

  // --- Merging ----------------------------------------------------------------

  private findMerges(): void {
    const cats = this.cats;
    for (let i = 0; i < cats.length; i++) {
      const a = cats[i];
      if (a.removed || this.frame < a.lockUntil) continue;
      for (let j = i + 1; j < cats.length; j++) {
        const b = cats[j];
        if (b.removed || b.tier !== a.tier || this.frame < b.lockUntil) continue;
        if (!bodiesTouch(a.body, b.body)) continue;
        this.merge(a, b);
        break;
      }
    }
  }

  private merge(a: JarCat, b: JarCat): void {
    const tier = a.tier;
    const A = a.body;
    const B = b.body;
    A.computeCentroid();
    B.computeCentroid();
    const x = (A.cx + B.cx) / 2;
    const y = (A.cy + B.cy) / 2;
    const vx = (A.vcx + B.vcx) / 2;
    const vy = (A.vcy + B.vcy) / 2;
    a.removed = b.removed = true;
    this.world.removeBody(A);
    this.world.removeBody(B);
    // A chain reaction: a cat fresh out of a merge melting again right away
    // is the next link, and links multiply the points (x2, then x3 at most).
    const link = (c: JarCat): number => (c.chain > 0 && this.frame - c.born < CHAIN_FRAMES ? c.chain : 0);
    const chain = 1 + Math.max(link(a), link(b));
    this.merges++;
    const points = mergePoints(tier) * Math.min(chain, CHAIN_MAX);
    this.score += points;
    let earned = false;
    if (tier >= BOOP_EARN_TIER && this.boops < BOOPS_MAX) {
      this.boops++;
      earned = true;
    }
    let cat: JarCat | null = null;
    if (tier < LAST_TIER) {
      const T = TIERS[tier + 1];
      // start small where there's room, then grow into the full size
      const room = this.clearance(x, y) - NODE_RADIUS * 2;
      const r0 = clamp(room, T.r * 0.45, T.r * 0.62);
      const body = new SoftBody(T.breed, x, y, { ...T.phys, radius: r0, nodes: T.nodes });
      body.kick(vx * 0.5, vy * 0.5);
      this.world.addBody(body);
      cat = this.addCat(tier + 1, body, false);
      cat.grow = { from: r0, to: T.r, t0: this.frame, frames: 16 };
      cat.lockUntil = this.frame + 10;
      cat.chain = chain;
    } else {
      // two voids vanished: whatever they held up comes down
      for (const c of this.cats) c.body.wake();
    }
    this.events.push({
      t: 'merge',
      tier,
      cat,
      ghosts: [
        { body: A, tier, tx: x, ty: y },
        { body: B, tier, tx: x, ty: y },
      ],
      x,
      y,
      points,
      chain,
      earned,
    });
  }

  /** Distance from a point to the nearest node of any live cat. */
  private clearance(x: number, y: number): number {
    let d2 = Infinity;
    for (const c of this.cats) {
      if (c.removed) continue;
      const b = c.body;
      for (let i = 0; i < b.n; i++) {
        const dx = b.x[i] - x;
        const dy = b.y[i] - y;
        const d = dx * dx + dy * dy;
        if (d < d2) d2 = d;
      }
    }
    // the glass counts too
    const wall = Math.min(x - JAR.inL, JAR.inR - x, JAR.floorY - y);
    return Math.min(Math.sqrt(d2), wall + NODE_RADIUS);
  }

  // --- Full jar -----------------------------------------------------------------

  /** Top of a cat's skin. */
  static top(b: SoftBody): number {
    let m = Infinity;
    for (let i = 0; i < b.n; i++) if (b.y[i] < m) m = b.y[i];
    return m - NODE_RADIUS;
  }

  /** Cats that count for the full line right now. */
  overLine(): JarCat[] {
    const f = this.frame;
    return this.cats.filter((c) => f - c.born > GRACE_DROP && f - c.booped > GRACE_BOOP && JarGame.top(c.body) < LINE_Y);
  }

  private checkFull(): void {
    if (this.over) return;
    const danger = this.overLine().length > 0;
    if (danger !== this.danger) {
      this.danger = danger;
      this.events.push({ t: 'danger', on: danger });
    }
    this.full = danger ? this.full + 1 : Math.max(0, this.full - 4);
    if (this.full >= FULL_FRAMES) {
      this.over = true;
      this.waiting = null;
      this.events.push({ t: 'over' });
    }
  }

  drain(): JarEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

/** Distance from a point to a cat's outline (negative inside). */
export function outlineDistance(b: SoftBody, x: number, y: number): number {
  let inside = false;
  let d2 = Infinity;
  const n = b.n;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = b.x[j];
    const ay = b.y[j];
    const ex = b.x[i] - ax;
    const ey = b.y[i] - ay;
    if (ay > y !== b.y[i] > y && x < ax + ((y - ay) * ex) / ey) inside = !inside;
    const l2 = ex * ex + ey * ey;
    const t = l2 > 1e-9 ? clamp(((x - ax) * ex + (y - ay) * ey) / l2, 0, 1) : 0;
    const dx = ax + ex * t - x;
    const dy = ay + ey * t - y;
    d2 = Math.min(d2, dx * dx + dy * dy);
  }
  const d = Math.sqrt(d2) - NODE_RADIUS;
  return inside ? -d : d;
}

