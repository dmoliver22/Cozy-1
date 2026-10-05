// Cat Jar rules: a "Suika" game with soft cats. The next cat waits over the
// pile; you aim and drop it. Two cats of the same tier that touch melt into one
// of the next tier (spawned small between them, growing in so the pile makes
// room instead of exploding); a Little Void melts into any cat. Boops make a
// cat hop to jiggle the pile. Each breed has its ways (config.ts): kittens
// hop about before settling, a chonk pops small cats up. A cat resting above
// the full line for two seconds ends the game.
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
  DOZE_FRAMES,
  DROP_GAP,
  DROP_WEIGHTS,
  FULL_FRAMES,
  GRACE_BOOP,
  GRACE_DROP,
  HOLD_Y,
  JAR,
  LAST_TIER,
  LINE_Y,
  RELOAD_FRAMES,
  SNUGGLE_FRAMES,
  TIERS,
  WILD,
  WILD_AFTER,
  WILD_CHANCE,
  WILD_GAP,
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
  /** In the air from a drop, or a hop or a boop (for the landing thump and the face), since this frame. */
  falling: boolean;
  fallKind: 'drop' | 'air';
  fallFrom: number;
  prevVy: number;
  /** It was off the ground last frame (a hop's landing is a touch-down, not a thump). */
  wasAir: boolean;
  /** Frame of its last landing. */
  landedAt: number;
  /** Hops a kitten has left before it settles, and the frame of its last one. */
  hops: number;
  lastHop: number;
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
  | { t: 'hop'; cat: JarCat }
  | { t: 'pop'; cat: JarCat; popped: JarCat[] }
  | { t: 'danger'; on: boolean }
  | { t: 'over' };

export interface Waiting {
  tier: number;
  body: SoftBody;
  /** Frame it appeared (pop-in). */
  since: number;
}

let nextCatId = 1;

/**
 * Frames a cat has been off the ground. (The engine leaves a sleeping cat's
 * count running when it lies on other cats, but a sleeper is at rest.)
 */
export const airborne = (b: SoftBody): number => (b.asleep ? 0 : b.airborneFrames);

/** How hard a kitten scoots toward a twin (a sideways acceleration, units/s^2). */
const KITTEN_PULL = 320;

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
  /**
   * The line the waiting cat's bottom hangs on: DROP_GAP over the top of the
   * pile (it follows the pile up and down, unhurried). See holdY.
   */
  holdBase = JAR.floorY - DROP_GAP;
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
  /** Drop number of the last Little Void put in the queue. */
  private lastWild = -1e9;
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
    this.holdBase = JAR.floorY - DROP_GAP;
    this.easing = false;
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
    this.lastWild = -1e9;
    this.snug.clear();
    this.fillQueue();
    this.spawnWaiting();
  }

  // --- Queue and the waiting cat ---------------------------------------------

  private fillQueue(): void {
    while (this.queue.length < 3) {
      // now and then a Little Void (never two close together)
      const n = this.drops + this.queue.length;
      const w = this.rand();
      if (n >= WILD_AFTER && n - this.lastWild >= WILD_GAP && w < WILD_CHANCE) {
        this.queue.push(WILD);
        this.lastWild = n;
        continue;
      }
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
    this.queue = tiers.map((t) => clamp(Math.round(t), 0, WILD));
    this.fillQueue();
    if (this.waiting) this.spawnWaiting();
  }

  private spawnWaiting(): void {
    const t = this.queue[0];
    const T = TIERS[t];
    const x = this.clampAim(this.aimX, t);
    this.holdX = x;
    const body = new SoftBody(T.breed, x, this.holdY(t), { ...T.phys, radius: T.r, nodes: T.nodes });
    this.waiting = { tier: t, body, since: this.frame };
    this.events.push({ t: 'spawn', tier: t });
  }

  /** Where a waiting cat of tier t hangs (its centre): on holdBase, but never above HOLD_Y. */
  holdY(t: number): number {
    return Math.max(HOLD_Y, this.holdBase - TIERS[t].r);
  }

  /** Top of the settled pile (cats not falling or hopping), or the floor. */
  pileTop(): number {
    let top: number = JAR.floorY;
    for (const c of this.cats) {
      if (c.falling || this.frame - c.booped < 50) continue;
      top = Math.min(top, JarGame.top(c.body));
    }
    return top;
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
      this.waiting.body.placeAt(this.holdX, this.holdY(this.waiting.tier));
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
    b.placeAt(this.holdX, this.clearDrop(this.holdX, this.holdY(w.tier), TIERS[w.tier].r));
    b.kick(0, 40);
    this.world.addBody(b);
    const cat = this.addCat(w.tier, b, true);
    if (TIERS[w.tier].breed === 'kitten') cat.hops = 3;
    this.waiting = null;
    this.queue.shift();
    this.fillQueue();
    this.reloadAt = this.frame + RELOAD_FRAMES;
    this.drops++;
    this.events.push({ t: 'drop', cat });
    return true;
  }

  /** Lift a drop point clear of any cat in the way (one that just hopped up there). */
  private clearDrop(x: number, y: number, r: number): number {
    const R = r + NODE_RADIUS * 2 + 3;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const c of this.cats) {
        const b = c.body;
        for (let i = 0; i < b.n; i++) {
          const dx = b.x[i] - x;
          if (dx <= -R || dx >= R) continue;
          const reach = Math.sqrt(R * R - dx * dx);
          if (Math.abs(b.y[i] - y) < reach) {
            y = b.y[i] - reach;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return y;
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
      fallKind: 'drop',
      fallFrom: this.frame,
      prevVy: 0,
      wasAir: false,
      landedAt: -1e9,
      hops: 0,
      lastHop: -1e9,
      sleepRefs: null,
      rest: 0,
      removed: false,
      chain: 0,
    };
    this.cats.push(cat);
    if (tier > this.biggest && tier <= LAST_TIER) this.biggest = tier;
    return cat;
  }

  /** Put a cat of a tier straight into the jar (tests, the attract screen). */
  place(tier: number, x: number, y: number): JarCat {
    const t = clamp(Math.round(tier), 0, WILD);
    const T = TIERS[t];
    const b = this.world.addBody(new SoftBody(T.breed, x, y, { ...T.phys, radius: T.r, nodes: T.nodes }));
    const cat = this.addCat(t, b, false);
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
    this.takeOff(cat);
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
    this.followPile();
    // the waiting cat follows the aim (quickly, but not instantly)
    if (this.waiting) {
      const tx = this.clampAim(this.aimX, this.waiting.tier);
      this.holdX += (tx - this.holdX) * 0.4;
      if (Math.abs(tx - this.holdX) < 0.05) this.holdX = tx;
      this.waiting.body.placeAt(this.holdX, this.holdY(this.waiting.tier));
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

  /**
   * Keep the waiting cat's line DROP_GAP over the pile: it eases toward a new
   * height once the pile has grown (or melted down) by more than a little,
   * so the view isn't nudged by every settling wobble.
   */
  private followPile(): void {
    const want = this.pileTop() - DROP_GAP;
    const d = want - this.holdBase;
    if (Math.abs(d) > 10 || this.easing) {
      this.easing = Math.abs(d) > 0.5;
      this.holdBase += d * 0.05;
    }
  }

  private easing = false;
  /** Twins touching now: how many frames they've snuggled, and the last frame they touched. */
  private snug = new Map<number, { a: JarCat; b: JarCat; n: number; seen: number }>();

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
      if (t >= 1) {
        cat.grow = null;
        // a new chonk settles in with a flop
        if (TIERS[cat.tier].breed === 'chonk') this.chonkPop(cat);
      }
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
      // a sharp stop (a drop's thump), or touching down after a hop or a boop
      const thump = cat.prevVy > 140 && cat.prevVy - vy > 110;
      const down = cat.fallKind === 'air' && cat.wasAir && airborne(b) === 0;
      if (this.frame - cat.fallFrom > 3 && (thump || down)) {
        cat.falling = false;
        cat.landedAt = this.frame;
        // the glass reports its own clink; this is the soft thump on a cat
        if (thump && b.impactShape === -1) this.events.push({ t: 'land', cat, speed: cat.prevVy });
        // a chonk landing on small cats pops them up
        if (TIERS[cat.tier].breed === 'chonk' && cat.prevVy > 200) this.chonkPop(cat);
      } else if (this.frame - cat.fallFrom > 240) cat.falling = false;
      cat.prevVy = vy;
      cat.wasAir = airborne(b) > 2;
    }
    // kittens scoot over to a twin sitting close by
    if (TIERS[cat.tier].breed === 'kitten') b.assistAx = this.kittenPull(cat);
    // a kitten hops about a little before it settles (once it's had a moment on its feet)
    if (cat.hops > 0 && !cat.falling && this.frame - cat.landedAt > 16 && airborne(b) === 0 && Math.abs(b.vcy) < 60 && !cat.grow) this.kittenHop(cat);
    const still = b.asleep || (b.emaVx * b.emaVx + b.emaVy * b.emaVy < 20 * 20 && airborne(b) < 3);
    cat.rest = still ? cat.rest + 1 : 0;
    // A resting cat curls into a loaf (the rest shape only matters for the
    // jelly and pudding breeds); a moving one rounds out.
    if (cat.rest > 20) b.loafiness = Math.min(1, b.loafiness + 0.02);
    else if (b.energy > 900) b.loafiness = Math.max(0, b.loafiness - 0.05);
    this.watchSleep(cat);
  }

  /** The cat leaves the ground (a boop, a hop): watch for its landing. */
  private takeOff(cat: JarCat): void {
    cat.falling = true;
    cat.fallKind = 'air';
    cat.fallFrom = this.frame;
    cat.prevVy = 0;
    cat.wasAir = false;
  }

  /**
   * A kitten's hop: over to another kitten if one is near (they like to play;
   * it lands right beside it), else down the slope it sits on (on the level,
   * toward the middle). Not from under other cats, nor away from a twin it's
   * already snuggled up to.
   */
  private kittenHop(cat: JarCat): void {
    const b = cat.body;
    cat.hops--;
    if (this.stackAbove(cat).length) {
      cat.hops = 0;
      return;
    }
    b.computeCentroid();
    const r = TIERS[cat.tier].r;
    let twin: JarCat | null = null;
    let near = r * 6;
    for (const o of this.cats) {
      if (o === cat || o.removed || o.tier !== cat.tier) continue;
      const d = Math.hypot(o.body.cx - b.cx, o.body.cy - b.cy);
      if (d < near) {
        near = d;
        twin = o;
      }
    }
    if (twin && bodiesTouch(b, twin.body)) return;
    let dx: number;
    if (twin) {
      // (just short of it: the last bit it scoots, see kittenPull)
      const side = twin.body.cx < b.cx ? 1 : -1;
      dx = twin.body.cx + side * r * 2.5 - b.cx;
    } else {
      const left = this.surfaceAt(b.cx - r * 1.8, r, cat);
      const right = this.surfaceAt(b.cx + r * 1.8, r, cat);
      const dir = Math.abs(left - right) >= 4 ? (left > right ? -1 : 1) : b.cx > CX ? -1 : 1;
      dx = dir * 30;
    }
    // (not into the glass)
    dx = clamp(b.cx + dx, JAR.inL + r + 3, JAR.inR - r - 3) - b.cx;
    const vy = Math.sqrt(2 * GRAVITY * 26);
    const vx = clamp(dx / ((2 * vy) / GRAVITY), -200, 200);
    // a fresh hop, whatever it was doing
    b.kick(vx - b.vcx, -vy - b.vcy);
    cat.lastHop = this.frame;
    cat.rest = 0;
    this.takeOff(cat);
    this.wakeNear(b, 6);
    this.events.push({ t: 'hop', cat });
  }

  /**
   * A kitten on its feet scoots toward a twin sitting near it, about level,
   * till they touch (they like to play): a sideways push, 0 if none.
   */
  private kittenPull(cat: JarCat): number {
    const b = cat.body;
    if (cat.falling || airborne(b) > 0 || JarGame.dozing(cat)) return 0;
    const r = TIERS[cat.tier].r;
    let push = 0;
    let near = r * 3.6;
    for (const o of this.cats) {
      if (o === cat || o.removed || o.tier !== cat.tier || JarGame.dozing(o)) continue;
      const dx = o.body.cx - b.cx;
      const d = Math.hypot(dx, o.body.cy - b.cy);
      if (d >= near || Math.abs(o.body.cy - b.cy) > r) continue;
      near = d;
      push = bodiesTouch(b, o.body) ? 0 : dx < 0 ? -KITTEN_PULL : KITTEN_PULL;
    }
    return push;
  }

  /** Top of the pile (or the floor) under a column at x, for a cat of radius r (the glass: very high). */
  private surfaceAt(x: number, r: number, except: JarCat): number {
    if (x < JAR.inL + 4 || x > JAR.inR - 4) return -Infinity;
    let best: number = JAR.floorY;
    for (const c of this.cats) {
      if (c === except || c.removed) continue;
      const b = c.body;
      for (let i = 0; i < b.n; i++) {
        if (Math.abs(b.x[i] - x) > r) continue;
        if (b.y[i] < best) best = b.y[i];
      }
    }
    return best;
  }

  /** A chonk flops down: the small cats it touches (kittens, sphynxes, tabbies) pop up and away. */
  private chonkPop(chonk: JarCat): void {
    const b = chonk.body;
    b.computeCentroid();
    const popped: JarCat[] = [];
    for (const c of this.cats) {
      if (c === chonk || c.removed || c.tier > 2) continue;
      if (!bodiesTouch(b, c.body, NODE_RADIUS * 2 + 6)) continue;
      c.body.computeCentroid();
      const r = TIERS[c.tier].r;
      const side = clamp((c.body.cx - b.cx) / TIERS[chonk.tier].r, -1, 1);
      c.body.kick(side * 140, -Math.sqrt(2 * GRAVITY * (r * 1.4 + 26)));
      c.booped = this.frame;
      c.rest = 0;
      this.takeOff(c);
      this.wakeNear(c.body, 8);
      popped.push(c);
    }
    if (popped.length) this.events.push({ t: 'pop', cat: chonk, popped });
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
    // a Little Void melts into the biggest cat it touches
    for (const w of cats) {
      if (w.tier !== WILD || w.removed || this.frame < w.lockUntil) continue;
      let best: JarCat | null = null;
      for (const o of cats) {
        if (o === w || o.removed || o.tier === WILD || this.frame < o.lockUntil) continue;
        if (best && o.tier <= best.tier) continue;
        if (bodiesTouch(w.body, o.body)) best = o;
      }
      if (best) this.merge(best, w, best.tier);
    }
    // twins melt once they've snuggled a moment (both awake)
    for (let i = 0; i < cats.length; i++) {
      const a = cats[i];
      if (a.removed || a.tier === WILD || this.frame < a.lockUntil || JarGame.dozing(a)) continue;
      for (let j = i + 1; j < cats.length; j++) {
        const b = cats[j];
        if (b.removed || b.tier !== a.tier || this.frame < b.lockUntil || JarGame.dozing(b)) continue;
        if (!bodiesTouch(a.body, b.body)) continue;
        const key = a.id < b.id ? a.id * 65536 + b.id : b.id * 65536 + a.id;
        const s = this.snug.get(key) ?? { a, b, n: 0, seen: 0 };
        s.n++;
        s.seen = this.frame;
        this.snug.set(key, s);
        if (s.n < SNUGGLE_FRAMES) continue;
        this.merge(a, b, a.tier);
        break;
      }
    }
    // a snuggle forgets once they've been apart a moment (a bump and back doesn't count), or one of them melted
    for (const [key, s] of this.snug) if (this.frame - s.seen > 12 || s.a.removed || s.b.removed) this.snug.delete(key);
  }

  /** Twins snuggling right now, and how far along (0..1) to melting. */
  snuggles(): { a: JarCat; b: JarCat; t: number }[] {
    const out: { a: JarCat; b: JarCat; t: number }[] = [];
    for (const s of this.snug.values()) if (!s.a.removed && !s.b.removed && this.frame - s.seen <= 1) out.push({ a: s.a, b: s.b, t: Math.min(1, s.n / SNUGGLE_FRAMES) });
    return out;
  }

  /** Two cats of a tier melt into one of the next (or a Little Void melts into a cat of that tier). */
  private merge(a: JarCat, b: JarCat, tier: number): void {
    const A = a.body;
    const B = b.body;
    A.computeCentroid();
    B.computeCentroid();
    // the new cat appears between them, nearer the bigger one
    const wa = A.p.radius * A.p.radius;
    const wb = B.p.radius * B.p.radius;
    const x = (A.cx * wa + B.cx * wb) / (wa + wb);
    const y = (A.cy * wa + B.cy * wb) / (wa + wb);
    const vx = (A.vcx * wa + B.vcx * wb) / (wa + wb);
    const vy = (A.vcy * wa + B.vcy * wb) / (wa + wb);
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
        { body: A, tier: a.tier, tx: x, ty: y },
        { body: B, tier: b.tier, tx: x, ty: y },
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

  /** Dozed off: lying still too long to snuggle up (a boop or a bump wakes it). */
  static dozing(c: JarCat): boolean {
    return c.rest > DOZE_FRAMES;
  }

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

