// Cat Drop: the simulation. One squishy cat falls down the endless house,
// steered toward a finger's x and hopping on a tap; it eats fish and grows,
// squeezes through glass tubes, bounces on cushions, and stays ahead of a
// vacuum cleaner coming down the shaft. Headless (no DOM): the view reads the
// state and drains `events` for sounds and effects.

import { BREEDS, type BreedId } from '../../physics/breeds';
import { SoftBody } from '../../physics/softbody';
import { FRAME_DT, World } from '../../physics/world';
import type { Material } from '../../physics/shapes';
import { Level, MAX_RADIUS, SHAFT_W, UNITS_PER_M, type Chunk, type Cushion, type Fish, type Squeeze, type Storey } from './level';

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
  /** Vacuum: start gap, start speed, speed gained per second, leash, delay. */
  vacStartGap: 760,
  vacSpeed: 150,
  vacAccel: 2.2,
  vacLeash: 1250,
  vacDelay: 1.6,
  /** Seconds without new depth before the cat gets a helping nudge. */
  stuckAfter: 2.4,
};

export type Phase = 'ready' | 'play' | 'slurp' | 'over';

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
  | { t: 'slurp' }
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
  /** Distance from the vacuum's nozzle down to the cat, in world units and metres. */
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
  /** Nozzle (bottom) of the vacuum, its speed, and whether it is coming. */
  vacY: number;
  vacV = 0;
  /** Slurp progress (seconds) once caught. */
  slurpT = 0;
  /** Frames since the last hop/bounce/nom (for the face). */
  sinceHop = 999;
  sinceBoing = 999;
  sinceNom = 999;
  /** Storey the cat is in (for "entered the kitchen" toasts). */
  storeyIndex = 0;
  /** The squeeze zone the cat is in, if any. */
  squeeze: Squeeze | null = null;
  private added = new Set<number>();
  private prevVy = 0;
  private stuckMark = 0;
  private stuckFrames = 0;
  private hidden = false;

  constructor(seed: number, breed: BreedId = 'tabby') {
    this.seed = seed;
    this.breed = breed;
    const r0 = BREEDS[breed].physics.radius;
    this.baseR = r0;
    this.maxR = Math.min(MAX_RADIUS, r0 * TUNE.maxGrowth);
    this.level = new Level(seed, this.maxR);
    this.cat = this.world.addBody(new SoftBody(breed, this.level.startX, this.level.perchY - r0 - 8));
    this.cat.computeCentroid();
    this.startY = this.cat.cy;
    this.deepest = this.cat.cy;
    this.stuckMark = this.cat.cy;
    this.vacY = this.cat.cy - TUNE.vacStartGap;
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
    if (grounded) c.kick(side * TUNE.hopSide, -TUNE.hop);
    else {
      this.airHops--;
      // an air hop cancels the fall first
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

  get vacuumGap(): number {
    return this.catTop() - this.vacY;
  }

  get catHidden(): boolean {
    return this.hidden;
  }

  state(): DropState {
    const gap = this.vacuumGap;
    return {
      phase: this.phase,
      frame: this.frame,
      depth: this.depthM,
      fish: this.fishCount,
      golden: this.goldCount,
      score: this.score,
      radius: Math.round(this.radius * 100) / 100,
      mult: this.mult,
      vacuumGap: Math.round(gap),
      vacuumGapM: Math.max(0, Math.round(gap / UNITS_PER_M)),
      over: this.phase === 'over',
      breed: this.breed,
      seed: this.seed,
    };
  }

  storey(): Storey | null {
    this.cat.computeCentroid();
    return this.level.storeyAt(this.cat.cy);
  }

  /** Chunks overlapping a world y range. */
  chunksIn(y0: number, y1: number): Chunk[] {
    return this.level.chunks.filter((c) => c.y1 >= y0 && c.y0 <= y1);
  }

  // --- Simulation ----------------------------------------------------------------

  step(): void {
    const c = this.cat;
    c.computeCentroid();
    this.syncChunks(c.cy + 2400);
    if (this.phase === 'slurp') this.slurpStep();
    else {
      this.applySteer();
      this.applySqueeze();
    }
    this.prevVy = c.vcy;
    this.world.step();
    this.frame++;
    c.computeCentroid();
    if (this.phase === 'play' || this.phase === 'ready') {
      this.time += this.phase === 'play' ? FRAME_DT : 0;
      this.terminal();
      this.contacts();
      this.eatFish();
      this.trackStorey();
      if (this.phase === 'play') {
        this.trackDepth();
        this.vacuum();
      }
    }
    this.animateFish();
    this.animateCushions();
    this.sinceHop++;
    this.sinceBoing++;
    this.sinceNom++;
  }

  /** Add the statics of newly generated chunks; drop the ones far above. */
  private syncChunks(below: number): void {
    this.level.ensure(below);
    for (const ch of this.level.chunks) {
      if (this.added.has(ch.id)) continue;
      this.added.add(ch.id);
      for (const s of ch.shapes) this.world.addStatic(s);
    }
    const cut = Math.min(this.cat.cy - 1600, this.vacY - 400);
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
    if (!best || this.phase !== 'play') {
      c.settleForce = 0;
      c.shapeMul = 1;
      return;
    }
    const z = best;
    // bigger cats are pulled a little less hard: they squeeze through slower
    const grow = c.p.radius / this.baseR;
    const breedPull = 0.6 + 0.4 * (BREEDS[this.breed].physics.slurp > 0.5 ? 1 : 0.5);
    // hatches only help a cat that is actually stuck over them (not a quick drop through)
    const tube = z.kind === 'tube';
    const help = z.kind === 'gap' || z.kind === 'funnel' ? Math.min(1, this.stuckFrames / 50) : 1;
    c.settleForce = (z.force * help * breedPull) / (grow * Math.sqrt(grow));
    c.settleX0 = z.x0;
    c.settleX1 = z.x1;
    c.settleY = z.y0;
    c.shapeMul = z.kind === 'gap' ? 1 : 0;
    if (tube && !z.entered && maxY > z.y0 + 12) {
      z.entered = true;
      this.events.push({ t: 'squeeze' });
    }
    if (tube && z.entered && !z.exited && minY > z.y1 - 6) {
      z.exited = true;
      this.events.push({ t: 'plop', x: c.cx, y: z.y1 });
    }
  }

  /** Soft terminal velocity: falls stay readable. */
  private terminal(): void {
    const c = this.cat;
    const over = c.vcy - TUNE.terminal;
    if (over <= 0) return;
    const dv = over * 0.18;
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
        if (!touch || this.frame - k.hitFrame < 12) continue;
        // only a cat landing on top (one sliding past an edge just slides off)
        if (c.cy > k.y + 4 || c.cx < k.x + 4 || c.cx > k.x + k.w - 4) continue;
        k.hitFrame = this.frame;
        const vin = Math.max(0, this.prevVy);
        const out = Math.max(TUNE.boingMin, Math.min(TUNE.boingMax, vin * 0.95 + 160));
        this.squashCat(Math.min(0.22, 0.08 + vin / 3000));
        c.kick(0, -out - c.vcy);
        k.vel += 4 + vin / 120;
        this.airHops = 1;
        this.sinceBoing = 0;
        this.events.push({ t: 'boing', x: c.cx, y: k.y, speed: vin, cushion: k });
      }
    }
  }

  /** Squash the cat toward its bottom (it springs back by itself). */
  private squashCat(a: number): void {
    const c = this.cat;
    let bottom = -Infinity;
    for (let i = 0; i < c.n; i++) if (c.y[i] > bottom) bottom = c.y[i];
    const sy = 1 - a;
    const sx = 1 / Math.sqrt(sy);
    for (let i = 0; i < c.n; i++) {
      const nx = c.cx + (c.x[i] - c.cx) * sx;
      const ny = bottom - (bottom - c.y[i]) * sy;
      c.px[i] += nx - c.x[i];
      c.py[i] += ny - c.y[i];
      c.x[i] = nx;
      c.y[i] = ny;
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
    if (c.cy > this.stuckMark + 12) {
      this.stuckMark = c.cy;
      this.stuckFrames = 0;
      return;
    }
    this.stuckFrames++;
    if (this.stuckFrames < TUNE.stuckAfter * 60) return;
    this.stuckFrames = Math.round(TUNE.stuckAfter * 60 * 0.45);
    this.stuckMark = c.cy;
    this.nudge();
  }

  /** Hop toward the nearest way down. */
  nudge(): void {
    const c = this.cat;
    let best: { x: number; d: number } | null = null;
    for (const ch of this.level.chunks) {
      if (ch.y1 < c.cy - 100 || ch.y0 > c.cy + 500) continue;
      for (const g of ch.gaps) {
        if (g.y < c.cy - c.p.radius * 1.5 || g.y > c.cy + 420) continue;
        const gx = (g.x0 + g.x1) / 2;
        const d = Math.abs(g.y - c.cy) * 0.6 + Math.abs(gx - c.cx);
        if (!best || d < best.d) best = { x: gx, d };
      }
    }
    const dx = best ? best.x - c.cx : (c.cx < SHAFT_W / 2 ? 1 : -1) * 120;
    c.kick(Math.max(-300, Math.min(300, dx * 2.2)), -260);
    this.events.push({ t: 'nudge' });
  }

  private vacuum(): void {
    if (this.time < TUNE.vacDelay) return;
    const gap = this.vacuumGap;
    const base = TUNE.vacSpeed + TUNE.vacAccel * (this.time - TUNE.vacDelay);
    const leash = gap > TUNE.vacLeash ? (gap - TUNE.vacLeash) * 1.4 : 0;
    this.vacV = base + leash;
    this.vacY += this.vacV * FRAME_DT;
    if (this.vacuumGap < 6) this.caught();
  }

  private caught(): void {
    const c = this.cat;
    this.phase = 'slurp';
    this.slurpT = 0;
    this.steerX = null;
    c.assistAx = 0;
    c.settleForce = 0;
    c.shapeMul = 1;
    c.computeCentroid();
    c.startGrab(c.cx, this.catTop() + c.p.radius * 0.3, c.mass * 4200, 1);
    this.events.push({ t: 'slurp' });
  }

  /** Sucked up into the nozzle: a long stretch, then gone. */
  private slurpStep(): void {
    const c = this.cat;
    this.slurpT += FRAME_DT;
    this.vacV *= 0.9;
    this.vacY += this.vacV * FRAME_DT;
    const g = c.grab;
    if (g) {
      g.tx += (SHAFT_W / 2 - g.tx) * 0.02;
      g.ty = this.vacY - 30 - this.slurpT * 260;
      g.tvy = -400;
      g.force = c.mass * (4200 + this.slurpT * 9000);
    }
    if (this.slurpT > 0.35) {
      const nr = c.p.radius * 0.975;
      if (nr > 6) c.resize(nr);
    }
    const top = this.catTop();
    let bottom = -Infinity;
    for (let i = 0; i < c.n; i++) if (c.y[i] > bottom) bottom = c.y[i];
    if ((bottom < this.vacY + 4 && this.slurpT > 0.4) || this.slurpT > 1.6) {
      this.phase = 'over';
      this.hidden = true;
      c.releaseGrab();
      this.events.push({ t: 'over' });
    }
    void top;
  }

  private animateFish(): void {
    for (const ch of this.level.chunks) for (const f of ch.fish) f.phase += FRAME_DT;
  }

  private animateCushions(): void {
    for (const ch of this.level.chunks)
      for (const k of ch.cushions) {
        if (k.squash === 0 && k.vel === 0) continue;
        // a springy squash: stiff, lightly damped
        k.vel += (-k.squash * 260 - k.vel * 9) * FRAME_DT;
        k.squash += k.vel * FRAME_DT;
        if (Math.abs(k.squash) < 0.002 && Math.abs(k.vel) < 0.02) {
          k.squash = 0;
          k.vel = 0;
        }
      }
  }
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
