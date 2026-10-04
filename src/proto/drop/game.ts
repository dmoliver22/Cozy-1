// Cat Drop: the simulation. One squishy cat falls down the endless house,
// steered toward a finger's x and hopping on a tap; it eats fish and grows,
// squeezes through glass tubes, bounces on cushions, and stays ahead of bath
// time: a wall of soap foam creeping down the shaft. Headless (no DOM): the
// view reads the state and drains `events` for sounds and effects.

import { BREEDS, type BreedId } from '../../physics/breeds';
import { SoftBody } from '../../physics/softbody';
import { FRAME_DT, GRAVITY, World } from '../../physics/world';
import { translateShape, type Material } from '../../physics/shapes';
import { Level, MAX_RADIUS, SHAFT_W, UNITS_PER_M, type Chunk, type Cushion, type Fish, type Squeeze } from './level';

/** Tuning (world units, seconds). */
export const TUNE = {
  /** Steering: speed toward the finger per unit of distance, top speed, max acceleration. */
  steerGain: 5,
  steerMax: 470,
  steerAccel: 2600,
  /** Sideways air drag when not steering (per second). */
  airDragX: 1.6,
  /** Terminal fall speed (soft cap). */
  terminal: 720,
  /** Hop speed on a tap, its sideways part, and the extra air hop's. */
  hop: 470,
  hopSide: 130,
  airHop: 400,
  /** Cushion bounce speed range. */
  boingMin: 540,
  boingMax: 780,
  /** Growth per fish (radius factor), golden fish, and the cap (x base radius). */
  grow: 1.06,
  growGolden: 1.1,
  maxGrowth: 1.8,
  /** Points per fish (times the size multiplier). */
  fishPoints: 10,
  goldenPoints: 50,
  /** Bath time (the foam): start gap, start speed, speed gained per second, leash, delay. */
  bathStartGap: 760,
  bathSpeed: 150,
  bathAccel: 2.0,
  bathLeash: 1500,
  bathDelay: 1.6,
  /** Seconds without new depth before the cat gets a helping nudge. */
  stuckAfter: 2.4,
  /** How close the foam's edge gets before it has you (it then billows down over the cat). */
  catchGap: 56,
  /** Seconds without any new depth before a stuck cat is popped free. */
  rescueAfter: 5,
  /** Physics substeps per frame (the engine's default is 8; falls and squeezes here are rougher). */
  substeps: 12,
};

/** How much of a cushion's height its squash takes (art and collider agree). */
export const CUSHION_GIVE = 0.75;

/** The bath, once it has the cat (seconds): the foam billows down over it, holds, and settles back. */
const SOAK = { cover: 0.32, hold: 0.58, settle: 1.05, sploosh: 0.2, sneeze: 1.3, end: 1.75 };

export type Phase = 'ready' | 'play' | 'soak' | 'over';

export type GameEvent =
  | { t: 'start' }
  | { t: 'hop'; air: boolean }
  | { t: 'boing'; x: number; y: number; speed: number; cushion: Cushion }
  | { t: 'thump'; material: Material; speed: number }
  | { t: 'nom'; x: number; y: number; golden: boolean; points: number; mult: number }
  | { t: 'squeeze' }
  | { t: 'plop'; x: number; y: number }
  | { t: 'storey'; name: string; index: number }
  | { t: 'nudge' }
  | { t: 'rescue'; x: number; y: number; why: 'stuck' | 'tangled' }
  /** Caught: the foam is coming down over the cat. */
  | { t: 'soak' }
  /** The foam swallows the cat: it comes out soaked. */
  | { t: 'sploosh'; x: number; y: number }
  | { t: 'sneeze'; x: number; y: number }
  | { t: 'over' };

export interface DropState {
  phase: Phase;
  frame: number;
  depth: number;
  fish: number;
  golden: number;
  score: number;
  radius: number;
  mult: number;
  /** Distance from the foam's edge down to the cat, in world units and metres. */
  bathGap: number;
  bathGapM: number;
  /** The same, by its old name (the chaser used to be a vacuum). */
  vacuumGap: number;
  vacuumGapM: number;
  over: boolean;
  breed: BreedId;
  seed: number;
}

export class DropGame {
  readonly world = new World();
  readonly level: Level;
  readonly cat: SoftBody;
  readonly breed: BreedId;
  readonly seed: number;
  readonly baseR: number;
  readonly maxR: number;
  phase: Phase = 'ready';
  frame = 0;
  /** Seconds since the run started. */
  time = 0;
  /** Finger target x (world), or null when not steering. */
  steerX: number | null = null;
  /** Hops left before touching something again. */
  airHops = 1;
  fishCount = 0;
  goldCount = 0;
  fishScore = 0;
  readonly startY: number;
  deepest: number;
  events: GameEvent[] = [];
  /** The lowest edge of the foam (world y), and its speed down the shaft. */
  foamY: number;
  foamV = 0;
  /** Seconds since the bath got the cat, and whether it is soaked yet. */
  soakT = 0;
  soaked = false;
  /** The foam's edge when it got the cat. */
  private soakFrom = 0;
  /** The size multiplier when the bath got the cat. */
  private finalMult = 0;
  /** Frames since the last hop/bounce/nom/sneeze (for the face). */
  sinceHop = 999;
  sinceBoing = 999;
  sinceNom = 999;
  sinceSneeze = 999;
  /** Storey the cat is in (for "entered the kitchen" toasts). */
  storeyIndex = 0;
  /** The squeeze zone the cat is in, if any. */
  squeeze: Squeeze | null = null;
  private added = new Set<number>();
  private prevVy = 0;
  /** A cushion bounce about to launch the cat. */
  private boing: { k: Cushion; vin: number; at: number } | null = null;
  private stuckMark = 0;
  private stuckFrames = 0;
  private nudges = 0;
  /** The deepest point when the cat last got deeper, and when (nudges don't count). */
  private progressMark = 0;
  private progressFrame = 0;
  private tangles = 0;

  constructor(seed: number, breed: BreedId = 'tabby') {
    this.seed = seed;
    this.breed = breed;
    const r0 = BREEDS[breed].physics.radius;
    this.baseR = r0;
    this.maxR = Math.min(MAX_RADIUS, r0 * TUNE.maxGrowth);
    this.level = new Level(seed, this.maxR, minTubeFor(BREEDS[breed].physics.maxStretch, this.maxR));
    this.world.substeps = TUNE.substeps;
    this.cat = this.world.addBody(new SoftBody(breed, this.level.startX, this.level.perchY - r0 - 8));
    this.cat.computeCentroid();
    this.startY = this.cat.cy;
    this.deepest = this.cat.cy;
    this.stuckMark = this.cat.cy;
    this.progressMark = this.cat.cy;
    this.foamY = this.cat.cy - TUNE.bathStartGap;
    this.syncChunks(this.cat.cy + 2400);
  }

  // --- Input -------------------------------------------------------------------

  start(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'play';
    this.cat.kick(150, -260);
    this.sinceHop = 0;
    this.events.push({ t: 'start' });
  }

  steer(x: number | null): void {
    this.steerX = x === null ? null : Math.max(-40, Math.min(SHAFT_W + 40, x));
  }

  /** A tap: hop off whatever the cat is on, or once more in the air. */
  bounce(): boolean {
    if (this.phase === 'ready') {
      this.start();
      return true;
    }
    if (this.phase !== 'play') return false;
    const c = this.cat;
    c.computeCentroid();
    const grounded = c.airborneFrames < 5;
    if (!grounded && this.airHops <= 0) return false;
    const side = this.steerX === null ? 0 : Math.max(-1, Math.min(1, (this.steerX - c.cx) / 60));
    // a hop cancels any fall first (sliding down a wall, or in the air)
    if (grounded) c.kick(side * TUNE.hopSide, -TUNE.hop - Math.max(0, c.vcy));
    else {
      this.airHops--;
      c.kick(side * TUNE.hopSide, -TUNE.airHop - Math.max(0, c.vcy));
    }
    this.sinceHop = 0;
    this.events.push({ t: 'hop', air: !grounded });
    return true;
  }

  // --- Derived state ------------------------------------------------------------

  get radius(): number {
    return this.cat.p.radius;
  }

  /** Size multiplier for points (1.0 .. 1.8), to one decimal. */
  get mult(): number {
    if (this.finalMult > 0) return this.finalMult;
    return Math.round((this.cat.p.radius / this.baseR) * 10) / 10;
  }

  get depthM(): number {
    return Math.max(0, Math.floor((this.deepest - this.startY) / UNITS_PER_M));
  }

  get score(): number {
    return this.depthM + Math.round(this.fishScore);
  }

  /** Top of the cat (nodes). */
  catTop(): number {
    let y = Infinity;
    for (let i = 0; i < this.cat.n; i++) if (this.cat.y[i] < y) y = this.cat.y[i];
    return y;
  }

  /** Bottom of the cat (nodes). */
  catBottom(): number {
    let y = -Infinity;
    for (let i = 0; i < this.cat.n; i++) if (this.cat.y[i] > y) y = this.cat.y[i];
    return y;
  }

  /** How far the foam's edge is above the cat. */
  get bathGap(): number {
    return this.catTop() - this.foamY;
  }

  state(): DropState {
    const gap = Math.round(this.bathGap);
    const gapM = Math.max(0, Math.round(gap / UNITS_PER_M));
    return {
      phase: this.phase,
      frame: this.frame,
      depth: this.depthM,
      fish: this.fishCount,
      golden: this.goldCount,
      score: this.score,
      radius: Math.round(this.radius * 100) / 100,
      mult: this.mult,
      bathGap: gap,
      bathGapM: gapM,
      vacuumGap: gap,
      vacuumGapM: gapM,
      over: this.phase === 'over',
      breed: this.breed,
      seed: this.seed,
    };
  }

  /** Chunks overlapping a world y range. */
  chunksIn(y0: number, y1: number): Chunk[] {
    return this.level.chunks.filter((c) => c.y1 >= y0 && c.y0 <= y1);
  }

  // --- Simulation ----------------------------------------------------------------

  step(): void {
    const c = this.cat;
    if (this.phase === 'over') {
      // a soggy cat sits it out: just the scenery idles on
      this.frame++;
      this.animateFish();
      this.animateCushions();
      return;
    }
    c.computeCentroid();
    this.syncChunks(c.cy + 2400);
    if (this.phase === 'soak') this.soakStep();
    else {
      this.applySteer();
      this.applySqueeze();
    }
    this.prevVy = c.vcy;
    this.world.step();
    this.frame++;
    if (this.phase === 'soak') this.world.drainImpacts();
    c.computeCentroid();
    if (this.phase === 'play' || this.phase === 'ready') {
      this.time += this.phase === 'play' ? FRAME_DT : 0;
      this.terminal();
      this.contacts();
      this.eatFish();
      this.trackStorey();
      if (this.phase === 'play') {
        this.trackDepth();
        this.bath();
      }
    }
    this.animateFish();
    this.animateCushions();
    this.sinceHop++;
    this.sinceBoing++;
    this.sinceNom++;
    this.sinceSneeze++;
  }

  /** Add the statics of newly generated chunks; drop the ones far above. */
  private syncChunks(below: number): void {
    this.level.ensure(below);
    for (const ch of this.level.chunks) {
      if (this.added.has(ch.id)) continue;
      this.added.add(ch.id);
      for (const s of ch.shapes) this.world.addStatic(s);
    }
    const cut = this.cat.cy - 1600;
    for (const ch of this.level.dropAbove(cut)) {
      this.world.removeStaticsOfProp(ch.id);
      this.added.delete(ch.id);
    }
  }

  private applySteer(): void {
    const c = this.cat;
    if (this.phase !== 'play' || this.steerX === null) {
      // a little air drag sideways, so the cat drifts to a stop
      c.assistAx = c.airborneFrames > 2 ? -c.vcx * TUNE.airDragX : 0;
      if (Math.abs(c.assistAx) < 40) c.assistAx = 0;
      return;
    }
    const want = Math.max(-TUNE.steerMax, Math.min(TUNE.steerMax, (this.steerX - c.cx) * TUNE.steerGain));
    let a = (want - c.vcx) * 10;
    a = Math.max(-TUNE.steerAccel, Math.min(TUNE.steerAccel, a));
    c.assistAx = a;
  }

  /** Inside a tube or a narrow gap the cat is drawn down (and relaxed, in glass tubes). */
  private applySqueeze(): void {
    const c = this.cat;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < c.n; i++) {
      if (c.y[i] < minY) minY = c.y[i];
      if (c.y[i] > maxY) maxY = c.y[i];
    }
    // the deepest zone the cat's bottom has reached (a tube beats its funnel),
    // that its top hasn't left yet, with the cat over the opening
    let best: Squeeze | null = null;
    let bestY = -Infinity;
    for (const ch of this.level.chunks) {
      if (ch.y0 > maxY + 20 || ch.y1 < minY - 20) continue;
      for (const z of ch.squeezes) {
        if (maxY < z.y0 - 4 || minY > z.y1 + 4) continue;
        if (c.cx < z.x0 - c.p.radius * 1.2 || c.cx > z.x1 + c.p.radius * 1.2) continue;
        if (z.y0 > bestY) {
          bestY = z.y0;
          best = z;
        }
      }
    }
    this.squeeze = best;
    const tension = BREEDS[this.breed].physics.tension;
    if (!best || this.phase !== 'play') {
      c.settleForce = 0;
      c.shapeMul = 1;
      this.setTension(tension);
      return;
    }
    const z = best;
    // bigger cats are pulled a little less hard: they squeeze through slower
    const grow = c.p.radius / this.baseR;
    const breedPull = 0.6 + 0.4 * (BREEDS[this.breed].physics.slurp > 0.5 ? 1 : 0.5);
    const tube = z.kind === 'tube';
    const narrow = tube || z.kind === 'soft';
    // hatches and funnels only help a cat that is actually stuck in them (not a
    // quick drop through); in a tube or between pillows a stuck cat is pulled harder
    // and harder (a long thin noodle has to beat its own skin's tension)
    const stuck = this.stuckFrames;
    const help = narrow ? 1 + Math.max(0, Math.min(1, (stuck - 40) / 120)) : Math.min(1, stuck / 50);
    // (tubes pull bigger cats less, so they squeeze through slower; a hatch just helps)
    const pull = z.kind === 'gap' ? z.force * 1.7 : Math.max(z.force * 0.4, (z.force * breedPull) / (grow * Math.sqrt(grow)));
    c.settleForce = Math.min(3600, pull * help);
    c.settleX0 = z.x0;
    c.settleX1 = z.x1;
    c.settleY = z.y0;
    c.shapeMul = z.kind === 'gap' ? 1 : 0;
    // in the glass a firm cat goes floppy: less skin tension, an easier noodle
    this.setTension(narrow && tension > 600 ? tension * 0.7 : tension);
    if (tube && !z.entered && maxY > z.y0 + 12) {
      z.entered = true;
      this.events.push({ t: 'squeeze' });
    }
    if (tube && z.entered && !z.exited && minY > z.y1 - 6) {
      z.exited = true;
      this.events.push({ t: 'plop', x: c.cx, y: z.y1 });
    }
  }

  private setTension(t: number): void {
    if (this.cat.p.tension !== t) this.cat.p = { ...this.cat.p, tension: t };
  }

  /** Soft terminal velocity: falls stay readable. */
  private terminal(): void {
    const c = this.cat;
    const over = c.vcy - TUNE.terminal;
    if (over <= 0) return;
    const dv = over * 0.35;
    for (let i = 0; i < c.n; i++) c.vy[i] -= dv;
  }

  /** Cushion bounces, landing thumps, and the air hop coming back. */
  private contacts(): void {
    const c = this.cat;
    if (c.airborneFrames === 0) this.airHops = 1;
    for (const im of this.world.drainImpacts()) {
      if (im.body === c && im.shape.material !== 'fabric') this.events.push({ t: 'thump', material: im.shape.material, speed: im.speed });
    }
    for (const ch of this.level.chunks) {
      if (!ch.cushions.length || ch.y1 < c.cy - 200 || ch.y0 > c.cy + 200) continue;
      for (const k of ch.cushions) {
        let touch = false;
        for (let i = 0; i < c.n; i++)
          if (c.contactShape[i] === k.shape.id) {
            touch = true;
            break;
          }
        if (!touch || this.frame - k.hitFrame < 14) continue;
        // only a cat landing on top (one sliding past an edge just slides off)
        if (c.cy > k.y + 4 || c.cx < k.x + 4 || c.cx > k.x + k.w - 4) continue;
        k.hitFrame = this.frame;
        const vin = Math.max(0, this.prevVy);
        // the cushion gives (and the cat sinks in with it), then springs back
        k.vel += 5 + vin / 90;
        this.boing = { k, vin, at: this.frame + 4 };
        this.sinceBoing = 0;
        this.events.push({ t: 'boing', x: c.cx, y: k.y, speed: vin, cushion: k });
      }
    }
    const b = this.boing;
    if (b && this.frame >= b.at) {
      this.boing = null;
      const out = Math.max(TUNE.boingMin, Math.min(TUNE.boingMax, b.vin * 0.95 + 160));
      c.kick(0, -out - c.vcy);
      this.airHops = 1;
      this.sinceBoing = 0;
    }
  }

  private eatFish(): void {
    const c = this.cat;
    const r = c.p.radius;
    for (const ch of this.level.chunks) {
      if (ch.y1 < c.cy - r - 60 || ch.y0 > c.cy + r + 60) continue;
      for (const f of ch.fish) {
        if (f.eaten || Math.abs(f.y - c.cy) > r * 2.2 + 40 || Math.abs(f.x - c.cx) > r * 2.2 + 40) continue;
        const d = distToRing(c, f.x, f.y);
        if (d < 7) this.eat(f);
        else if (d < 34) {
          // fish wiggle toward a cat that's almost there
          const k = 0.12;
          f.x += (c.cx - f.x) * k;
          f.y += (c.cy - f.y) * k;
        }
      }
    }
  }

  eat(f: Fish): void {
    const c = this.cat;
    f.eaten = true;
    const mult = this.mult;
    const pts = Math.round((f.golden ? TUNE.goldenPoints : TUNE.fishPoints) * mult);
    this.fishCount++;
    if (f.golden) this.goldCount++;
    this.fishScore += pts;
    const nr = Math.min(this.maxR, c.p.radius * (f.golden ? TUNE.growGolden : TUNE.grow));
    if (nr > c.p.radius) c.resize(nr);
    this.sinceNom = 0;
    this.events.push({ t: 'nom', x: f.x, y: f.y, golden: f.golden, points: pts, mult });
  }

  private trackStorey(): void {
    const s = this.level.storeyAt(this.cat.cy);
    if (s && s.index !== this.storeyIndex && s.index > this.storeyIndex) {
      this.storeyIndex = s.index;
      this.events.push({ t: 'storey', name: s.name, index: s.index });
    }
  }

  /** Depth so far, and a helping nudge when the cat stops making progress. */
  private trackDepth(): void {
    const c = this.cat;
    if (c.cy > this.deepest) this.deepest = c.cy;
    // the last resort: a cat that hasn't got any deeper for a long while is popped free
    if (this.deepest > this.progressMark + 12) {
      this.progressMark = this.deepest;
      this.progressFrame = this.frame;
    } else if (this.frame - this.progressFrame > TUNE.rescueAfter * 60) {
      this.rescue('stuck');
      return;
    }
    // a skin that has crossed itself (and stays crossed) is made round again
    if (this.frame % 10 === 0) {
      this.tangles = tangled(c) ? this.tangles + 1 : 0;
      if (this.tangles >= 3) {
        if (c.airborneFrames > 3) this.reround();
        else this.rescue('tangled');
        return;
      }
    }
    if (c.cy > this.stuckMark + 12) {
      this.stuckMark = c.cy;
      this.stuckFrames = 0;
      this.nudges = 0;
      return;
    }
    this.stuckFrames++;
    // mid-squeeze, a hop would only undo it (the squeeze itself pulls harder)
    const k = this.squeeze?.kind;
    if (k === 'tube' || k === 'soft') return;
    if (this.stuckFrames < TUNE.stuckAfter * 60) return;
    this.stuckFrames = Math.round(TUNE.stuckAfter * 60 * 0.45);
    this.stuckMark = c.cy;
    this.nudges++;
    this.nudge(Math.min(2.2, 1 + (this.nudges - 1) * 0.4));
  }

  /** The nearest way down from the cat: an opening's centre and the clear space below it. */
  private wayDown(): { x: number; below: number } | null {
    const c = this.cat;
    let best: { x: number; below: number; d: number } | null = null;
    for (const ch of this.level.chunks) {
      if (ch.y1 < c.cy - 100 || ch.y0 > c.cy + 500) continue;
      for (const g of ch.gaps) {
        if (g.below < c.cy - c.p.radius * 0.5 || g.y > c.cy + 420) continue;
        const gx = (g.x0 + g.x1) / 2;
        const d = Math.abs(g.y - c.cy) * 0.6 + Math.abs(gx - c.cx);
        if (!best || d < best.d) best = { x: gx, below: g.below, d };
      }
    }
    return best;
  }

  /**
   * Pop a stuck cat free: poof, it is round again just below the opening it
   * was stuck at. (A soft ring squeezed hard enough can tangle up in itself.)
   */
  rescue(why: 'stuck' | 'tangled' = 'stuck'): void {
    const c = this.cat;
    c.computeCentroid();
    const w = this.wayDown();
    const r = c.p.radius;
    const x = Math.max(r + 6, Math.min(SHAFT_W - r - 6, w ? w.x : c.cx));
    const y = (w ? w.below : c.cy + r * 2) + r + 10;
    for (let i = 0; i < c.n; i++) {
      c.x[i] = c.px[i] = x + c.roundX[i];
      c.y[i] = c.py[i] = y + c.roundY[i];
      c.vx[i] = 0;
      c.vy[i] = 120;
      c.qx[i] = c.roundX[i];
      c.qy[i] = c.roundY[i];
    }
    c.wake();
    c.computeCentroid();
    this.stuckFrames = 0;
    this.stuckMark = c.cy;
    this.nudges = 0;
    this.tangles = 0;
    this.progressFrame = this.frame;
    this.progressMark = this.deepest;
    this.events.push({ t: 'rescue', x, y, why });
  }

  /** Make a tangled cat round again where it is, keeping its motion (it is in the air). */
  private reround(): void {
    const c = this.cat;
    c.computeCentroid();
    const { cx, cy, vcx, vcy } = c;
    for (let i = 0; i < c.n; i++) {
      c.x[i] = c.px[i] = cx + c.roundX[i];
      c.y[i] = c.py[i] = cy + c.roundY[i];
      c.vx[i] = vcx;
      c.vy[i] = vcy;
      c.qx[i] = c.roundX[i];
      c.qy[i] = c.roundY[i];
    }
    c.computeCentroid();
    this.tangles = 0;
    this.events.push({ t: 'rescue', x: cx, y: cy, why: 'tangled' });
  }

  /** Hop toward the nearest way down (harder each time it didn't help). */
  nudge(strength = 1): void {
    const c = this.cat;
    const w = this.wayDown();
    const dx = w ? w.x - c.cx : (c.cx < SHAFT_W / 2 ? 1 : -1) * 120;
    c.kick(Math.max(-300, Math.min(300, dx * 2.2)) * strength, -260 * Math.min(1.5, strength));
    this.events.push({ t: 'nudge' });
  }

  /** Bath time creeps down the shaft, a little faster all the time, and never far behind. */
  private bath(): void {
    if (this.time < TUNE.bathDelay) return;
    const gap = this.bathGap;
    const base = TUNE.bathSpeed + TUNE.bathAccel * (this.time - TUNE.bathDelay);
    const leash = gap > TUNE.bathLeash ? (gap - TUNE.bathLeash) * 1.0 : 0;
    this.foamV = base + leash;
    this.foamY += this.foamV * FRAME_DT;
    if (this.bathGap < TUNE.catchGap) this.caught();
  }

  private caught(): void {
    const c = this.cat;
    this.phase = 'soak';
    this.soakT = 0;
    this.soakFrom = this.foamY;
    this.foamV = 0;
    this.steerX = null;
    c.assistAx = 0;
    c.settleForce = 0;
    c.shapeMul = 1;
    this.setTension(BREEDS[this.breed].physics.tension);
    this.finalMult = this.mult;
    this.events.push({ t: 'soak' });
  }

  /**
   * Bath time has the cat: the foam billows down over it, holds a moment and
   * settles back up, leaving a soaked cat. Foam is thick: the cat hangs in it,
   * barely sinking, and every motion soon dies away. Then a little sneeze.
   */
  private soakStep(): void {
    const c = this.cat;
    const t = (this.soakT += FRAME_DT);
    // where the foam's edge goes: over the cat, then back up just above it
    const cover = this.catBottom() + 34;
    const rest = this.catTop() - 70;
    if (t < SOAK.cover) this.foamY = this.soakFrom + (cover - this.soakFrom) * easeOut(t / SOAK.cover);
    else if (t < SOAK.hold) this.foamY = cover;
    else if (t < SOAK.settle) this.foamY = cover + (rest - cover) * easeInOut((t - SOAK.hold) / (SOAK.settle - SOAK.hold));
    else this.foamY = rest;
    for (let i = 0; i < c.n; i++) {
      c.vy[i] -= GRAVITY * FRAME_DT * 0.82;
      c.vx[i] *= 0.86;
      c.vy[i] *= 0.86;
    }
    c.wake();
    if (!this.soaked && t >= SOAK.sploosh) {
      this.soaked = true;
      c.computeCentroid();
      this.events.push({ t: 'sploosh', x: c.cx, y: c.cy });
    }
    if (t >= SOAK.sneeze && t - FRAME_DT < SOAK.sneeze) {
      c.computeCentroid();
      c.kick(0, -70);
      this.sinceSneeze = 0;
      this.events.push({ t: 'sneeze', x: c.cx, y: this.catTop() });
    }
    if (t >= SOAK.end) {
      this.phase = 'over';
      this.events.push({ t: 'over' });
    }
  }

  private animateFish(): void {
    for (const ch of this.level.chunks) for (const f of ch.fish) f.phase += FRAME_DT;
  }

  private animateCushions(): void {
    for (const ch of this.level.chunks)
      for (const k of ch.cushions) {
        if (k.squash === 0 && k.vel === 0 && k.sunk === 0) continue;
        // a springy squash: stiff, lightly damped
        k.vel += (-k.squash * 260 - k.vel * 9) * FRAME_DT;
        k.squash += k.vel * FRAME_DT;
        if (Math.abs(k.squash) < 0.002 && Math.abs(k.vel) < 0.02) {
          k.squash = 0;
          k.vel = 0;
        }
        // the top of the collider follows the squash down (and back up)
        const sunk = Math.max(0, Math.min(0.45, k.squash)) * k.h * CUSHION_GIVE;
        if (sunk !== k.sunk) {
          translateShape(k.shape, 0, sunk - k.sunk);
          k.sunk = sunk;
        }
      }
  }
}

/**
 * The narrowest tube a cat of radius `r` can be squeezed through: in a tube of
 * width w its area becomes a noodle whose skin is r/w + w/(2r) times its rest
 * length, which must stay (with a margin) under the skin's stretch limit.
 */
export function minTubeFor(maxStretch: number, r: number): number {
  const m = maxStretch * 0.88;
  const u = (m + Math.sqrt(Math.max(0, m * m - 2))) / 2;
  return Math.ceil(r / u);
}

/** Has the cat's skin crossed itself (a squeeze gone wrong)? */
export function tangled(b: SoftBody): boolean {
  const { n, x, y } = b;
  for (let i = 0; i < n; i++) {
    const i2 = i + 1 === n ? 0 : i + 1;
    const ax = x[i];
    const ay = y[i];
    const bx = x[i2];
    const by = y[i2];
    for (let j = i + 2; j < n; j++) {
      const j2 = j + 1 === n ? 0 : j + 1;
      if (j2 === i) continue;
      const cx = x[j];
      const cy = y[j];
      const dx = x[j2];
      const dy = y[j2];
      const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      if ((d1 > 0) === (d2 > 0)) continue;
      const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
      const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
      if ((d3 > 0) !== (d4 > 0)) return true;
    }
  }
  return false;
}

/** Signed distance from a point to a cat's ring (negative inside). */
export function distToRing(b: SoftBody, px: number, py: number): number {
  let inside = false;
  let best = Infinity;
  const n = b.n;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = b.x[i];
    const yi = b.y[i];
    const xj = b.x[j];
    const yj = b.y[j];
    if (yi > py !== yj > py && px < xj + ((py - yj) * (xi - xj)) / (yi - yj)) inside = !inside;
    const ex = xi - xj;
    const ey = yi - yj;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 1e-9 ? ((px - xj) * ex + (py - yj) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = xj + ex * t - px;
    const dy = yj + ey * t - py;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  const d = Math.sqrt(best) - 2.5;
  return inside ? -d : d;
}

const easeOut = (u: number): number => 1 - (1 - u) ** 3;
const easeInOut = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
