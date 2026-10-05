// Cat Drop: bath time's foam, simulated. A few hundred soap bubbles packed
// into a mass that the bath-time front (game.foamY, which alone decides the
// catch) drives down the shaft. Position-based: bubbles keep apart (squishing
// a little), cling softly to their neighbours, slide off shelves, heap on
// cushions, pour through hatches, funnels and tubes, flow around the cat
// (never pushing it), and pop: now and then, when squeezed too hard, or when
// they hit the cat fast. Each keeps a springy squash for drawing. Drops drip
// from the front, fall, and splash on what they hit.
//
// Once bath time has the cat the foam pours on down over it and fills the
// screen (a solid white flood behind the bubbles, so there are no gaps). Then,
// under the full foam, the view moves on to the bath: the foam clears (the top
// of it popping in a cascade, the rest sliding down off the screen) and a few
// dozen bubbles float on the bath water, jostled by the cat, while little ones
// drift up and pop. Purely visual: nothing here feeds back into the game.

import type { StaticShape } from '../../physics/shapes';
import { NODE_RADIUS, type SoftBody } from '../../physics/softbody';
import type { DropGame } from './game';
import { SHAFT_W } from './level';

const DT = 1 / 60;
/** Most bubbles alive at once. */
export const CAP = 480;
/** Most in the mass while it chases the cat (the rest of the room is for the fill). */
const CHASE_CAP = 270;
const R_MIN = 3;
const R_SPAN = 25;
/** Bubble radii are R_MIN + R_SPAN u^SKEW: many small, some medium, a few big. */
const SKEW = 3;
/** Their mean area (to know how many fill a region), and how tightly they pack. */
const MEAN_AREA = 427;
const PACK = 0.9;
/** The foam pouring down to fill the screen is made of bigger bubbles (mean area to match). */
const FILL_MIN = 6;
const FILL_SPAN = 22;
const FILL_SKEW = 2;
const FILL_AREA = 680;
/** The flood's soft edge (world units), and how far it keeps behind the front as it fills the screen. */
export const FLOOD_EDGE = 30;
export const FLOOD_BACK = 64;
/** Clearing, the top of the foam billows this far either way (world units). */
export const CLEAR_WAVE = 14;
/** Bubbles floating on the bath. */
const FLOATS = 26;
/** Clearing the screen: how fast the rest of the foam slides off (units/s^2) and the cascade of pops eats in (units/s). */
const SLIDE = 1500;
const EAT = 230;
/** Contact distance as a fraction of the radii's sum (bubbles squish into each other a little). */
const SQUISH = 0.9;
/** Neighbours closer than this many radii-sums cling together. */
const COHESION = 1.3;
/** Grid cell: at least the furthest two bubbles can interact. */
const CELL = 76;
const ITER = 3;
/** How hard a bubble lagging behind the front is driven down (per second, per unit of lag). */
const DRIVE = 2.4;
/** Behind the front this far, held back by the geometry for a moment: pass in front of it. */
const DEEP_LAG = 110;
const DROPS = 220;
const SPRAY = 320;
const RINGS = 40;
const SPLATS = 60;
const SKIN = NODE_RADIUS * 0.95;

type Rand = () => number;

/** The bath the foam ends in: where its bubbles float, and the cat in it. */
export interface TubSurface {
  /** The tub's opening, inner edges (world x). */
  x0: number;
  x1: number;
  /** The top of the suds on the water at x (world y): where floating bubbles rest. */
  surface(x: number): number;
  /** The bathroom floor (world y). */
  floor: number;
  /** The cat in the bath (an obstacle), once it is in. */
  cat: SoftBody | null;
}

export type SudsMode = 'chase' | 'fill' | 'clear';

function rng(seed: number): Rand {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Suds {
  // --- bubbles (structure of arrays) ---
  n = 0;
  readonly x = new Float64Array(CAP);
  readonly y = new Float64Array(CAP);
  /** Where each bubble was before the last step (drawing goes between). */
  readonly px = new Float64Array(CAP);
  readonly py = new Float64Array(CAP);
  readonly vx = new Float64Array(CAP);
  readonly vy = new Float64Array(CAP);
  readonly r = new Float64Array(CAP);
  private readonly w = new Float64Array(CAP);
  /** Broken off the mass: drifting down on its own until it pops. */
  readonly loose = new Uint8Array(CAP);
  /** Deeper in the room: passes in front of the geometry instead of piling up behind it. */
  readonly deep = new Uint8Array(CAP);
  /** Floating on the bath (the rest are the mass, coming down the shaft). */
  readonly tub = new Uint8Array(CAP);
  readonly alpha = new Float32Array(CAP);
  private readonly fade = new Int8Array(CAP);
  /** Loose bubbles: seconds left, and the speed they drift down at. */
  private readonly life = new Float32Array(CAP);
  private readonly sink = new Float32Array(CAP);
  /** Where each sits against the front (a lumpy edge, not a ruled line). */
  private readonly off = new Float32Array(CAP);
  private readonly stuck = new Float32Array(CAP);
  /** Filling the screen: its place in the mass (0 at the top of the screen, 1 at the front), and its size before the foam swelled. */
  private readonly u = new Float32Array(CAP);
  private readonly r0 = new Float32Array(CAP);
  /**
   * Squash, and its rate: positive is pressed in from the sides (narrower and
   * taller), negative is flattened from above or below (wider and shorter);
   * the area stays the same. It springs back with a wobble that rings out.
   */
  readonly q = new Float32Array(CAP);
  private readonly qv = new Float32Array(CAP);
  /** Thin-film swirl: phase and speed. */
  readonly ph = new Float32Array(CAP);
  private readonly phv = new Float32Array(CAP);
  /** Packed neighbours (dense foam gets a white suds body behind it). */
  readonly nb = new Uint8Array(CAP);
  /** How hard each is pressed from the sides and from above/below (this step). */
  private readonly txx = new Float32Array(CAP);
  private readonly tyy = new Float32Array(CAP);
  private readonly hit = new Float32Array(CAP);
  private readonly touch = new Uint8Array(CAP);
  /** Resting on something (a bubble or a surface below it): no more drive than keeping pace. */
  private readonly held = new Uint8Array(CAP);
  /** Touching glass (a funnel or a tube), which channels the foam rather than holding it back. */
  private readonly glass = new Uint8Array(CAP);

  // --- drops falling from the foam (and from the tap, and off the cat in the bath) ---
  dn = 0;
  readonly dx = new Float64Array(DROPS);
  readonly dy = new Float64Array(DROPS);
  readonly dvx = new Float64Array(DROPS);
  readonly dvy = new Float64Array(DROPS);
  readonly ds = new Float32Array(DROPS);
  private readonly dage = new Float32Array(DROPS);

  // --- spray: splash droplets and the specks of popped bubbles ---
  sn = 0;
  readonly sx = new Float64Array(SPRAY);
  readonly sy = new Float64Array(SPRAY);
  private readonly svx = new Float64Array(SPRAY);
  private readonly svy = new Float64Array(SPRAY);
  readonly sa = new Float32Array(SPRAY);
  readonly sl = new Float32Array(SPRAY);
  readonly ss = new Float32Array(SPRAY);

  // --- rings of popped bubbles ---
  rn = 0;
  readonly rx = new Float64Array(RINGS);
  readonly ry = new Float64Array(RINGS);
  readonly rr = new Float32Array(RINGS);
  readonly ra = new Float32Array(RINGS);

  // --- splats: where a drop hit, a little flattened ring spreading along the surface ---
  kn = 0;
  readonly kx = new Float64Array(SPLATS);
  readonly ky = new Float64Array(SPLATS);
  /** The surface's angle there, the splat's size, and its age. */
  readonly kang = new Float32Array(SPLATS);
  readonly ks = new Float32Array(SPLATS);
  readonly ka = new Float32Array(SPLATS);

  /** The front line this step (world y) and how fast it moves. */
  front = 0;
  frontV = 0;
  active = false;
  time = 0;
  /** Chasing the cat, pouring on down to fill the screen, or clearing off it (the bath). */
  mode: SudsMode = 'chase';
  /**
   * The flood: solid suds behind the bubbles, from floodTop down to floodBot
   * (world y; soft edges FLOOD_EDGE deep beyond them), at opacity floodA.
   */
  floodTop = 0;
  floodBot = 0;
  floodA = 0;
  /** Seconds since the foam started clearing, and the bath it clears to. */
  clearT = 0;
  bath: TubSurface | null = null;
  /** Called for each visible pop (for a sound). */
  onPop: ((x: number, y: number, r: number) => void) | null = null;
  /** Debug: pops by cause. */
  readonly pops = { random: 0, loose: 0, squeeze: 0, hit: 0, cascade: 0 };

  private rnd: Rand = rng(1);
  private viewTop = 0;
  private viewBottom = 0;
  /** Filling the screen: the bottom of the mass (the front, until it is past the bottom of the screen) and its speed. */
  private massBot = 0;
  private massV = 0;
  /** How much the bubbles have swelled as the foam stretched down the screen (from `span0` deep). */
  private swell = 1;
  private span0 = 1;
  private dripOwed = 0;
  private looseOwed = 0;
  private riseOwed = 0;
  // scratch
  private head = new Int32Array(0);
  private next = new Int32Array(CAP);
  private pi = new Int32Array(CAP * 16);
  private pj = new Int32Array(CAP * 16);
  private np = 0;
  private gridCols = 0;
  private gridRows = 0;
  private gridMinY = 0;
  private shapes: StaticShape[] = [];
  private rows: StaticShape[][] = [];
  private rowTop = 0;

  /** A new run. */
  reset(game: DropGame): void {
    this.n = this.dn = this.sn = this.rn = this.kn = 0;
    this.front = game.foamY;
    this.frontV = 0;
    this.active = false;
    this.time = 0;
    this.mode = 'chase';
    this.floodTop = this.floodBot = this.floodA = 0;
    this.clearT = 0;
    this.bath = null;
    this.rnd = rng(game.seed * 7 + 3);
    this.dripOwed = this.looseOwed = this.riseOwed = 0;
  }

  /**
   * How much of the screen (camY .. camY + viewH) the solid flood covers, 0..1
   * (1: the whole screen is foam).
   */
  cover(camY: number, viewH: number): number {
    if (this.floodA <= 0) return 0;
    const top = this.mode === 'clear' ? this.solidTop() : this.floodTop;
    const a = Math.max(top, camY);
    const b = Math.min(this.floodBot, camY + viewH);
    return b > a ? (this.floodA * (b - a)) / viewH : 0;
  }

  /** Clearing: the top of the foam at x, billowing as it slides away. */
  clearLine(x: number): number {
    const t = this.time;
    return this.floodTop + 0.6 * CLEAR_WAVE * Math.sin(x * 0.024 + t * 1.1) + 0.4 * CLEAR_WAVE * Math.sin(x * 0.053 - t * 1.7 + 2);
  }

  /** Clearing: below this the flood is solid everywhere (its billowing top edge is softer above it). */
  solidTop(): number {
    return this.floodTop + FLOOD_EDGE * 0.6 + CLEAR_WAVE;
  }

  /** The front's line at x: gentle slow billows, so the edge is never ruled (bigger ones as it pours down to fill the screen). */
  line(x: number): number {
    const t = this.time;
    const k = this.mode === 'fill' ? 1 + 1.6 * this.floodA : 1;
    return this.front + k * (5 * Math.sin(x * 0.021 + t * 0.9) + 3.5 * Math.sin(x * 0.047 - t * 1.3 + 1.7));
  }

  // --- stepping -------------------------------------------------------------------

  /**
   * One physics frame. `camY`/`viewH`: the visible world span (bubbles are kept
   * flowing in from above the screen, and stranded ones far above fade out).
   */
  step(game: DropGame, camY: number, viewH: number): void {
    this.time += DT;
    this.viewTop = camY;
    this.viewBottom = camY + viewH;
    const F = game.foamY;
    const v = (F - this.front) / DT;
    this.frontV = this.frontV * 0.6 + v * 0.4;
    this.front = F;
    const phase = game.phase;
    const cat = game.cat;
    const near = phase === 'play' ? Math.max(0, Math.min(1, 1 - (game.bathGap - 60) / 700)) : phase === 'ready' ? 0 : 1;
    // bath time has the cat: the foam pours on down over it until the screen is full (each
    // bubble keeps its place in the mass as it swells)
    if ((phase === 'soak' || phase === 'over') && this.mode === 'chase') {
      this.mode = 'fill';
      this.massBot = Math.min(F, this.viewBottom + 50);
      this.massV = Math.max(0, this.frontV);
      const m0 = camY - 40;
      this.swell = 1;
      this.span0 = Math.max(60, this.massBot - m0);
      for (let i = 0; i < this.n; i++) {
        this.deep[i] = 1;
        this.r0[i] = this.r[i];
        const m1 = this.line(this.x[i]) + this.off[i] - this.r[i];
        this.u[i] = Math.max(0, Math.min(1, (this.y[i] - m0) / Math.max(1, m1 - m0)));
      }
    } else if (this.mode === 'fill') {
      const mb = Math.min(F, this.viewBottom + 50);
      this.massV = (mb - this.massBot) / DT;
      this.massBot = mb;
      // stretched down the screen, the foam swells: its bubbles grow (so it stays packed)
      this.swell = Math.max(this.swell, Math.min(2.3, Math.sqrt((mb - camY + 40) / this.span0)));
    }
    const filling = this.mode === 'fill';
    // the foam is simulated from just before it comes into view
    const want = phase !== 'ready' && F > camY - 420;
    const top = Math.min(F - 120, camY - 70);
    this.gather(game, Math.min(top, camY) - 80, camY + viewH + 160);
    if (!want) {
      if (F < camY - 650) this.n = 0;
      this.active = false;
    } else {
      if (!this.active) {
        this.active = true;
        this.fill(top, F);
      }
      this.forces(game, top, near);
      // (the foam swallows the cat whole a moment after it has it)
      this.solve(cat, filling && game.soakT > 0.12);
      this.settle(phase === 'play');
      this.replenish(top, F);
    }
    if (filling) {
      // a solid flood behind the bubbles, from the top of the screen to just behind the front
      const u = Math.min(1, game.soakT / 0.35);
      this.floodA = u * u * (3 - 2 * u);
      this.floodTop = camY - 60;
      // (its edge follows the front's billows: this is as high as it gets)
      this.floodBot = F - FLOOD_BACK - 22;
    }
    this.stepDrops(game, near);
    this.stepSpray();
  }

  /** Fill the region behind a front that is about to come into view (off screen). */
  private fill(top: number, F: number): void {
    const rnd = this.rnd;
    const target = Math.min(CHASE_CAP - 30, Math.round((SHAFT_W * (F - top) * PACK) / MEAN_AREA));
    let yRow = F - 12;
    while (this.n < target && yRow > top - 40) {
      let xc = 2 + rnd() * 8;
      let tallest = 0;
      while (xc < SHAFT_W - 4 && this.n < target) {
        const rr = R_MIN + R_SPAN * rnd() ** SKEW;
        const cx = xc + rr;
        if (cx + rr > SHAFT_W) break;
        this.spawn(cx, yRow - rr + rnd() * 6, rr, this.frontV, 1);
        xc = cx + rr * (0.95 + rnd() * 0.2);
        if (rr > tallest) tallest = rr;
      }
      yRow -= Math.max(10, tallest * 1.25);
    }
  }

  /** Add a bubble (to the mass, or loose). Returns its index, or -1 if full. */
  private spawn(x: number, y: number, r: number, vy: number, alpha: number, loose = false): number {
    if (this.n >= CAP) return -1;
    const rnd = this.rnd;
    const i = this.n++;
    this.x[i] = this.px[i] = x;
    this.y[i] = this.py[i] = y;
    this.vx[i] = (rnd() - 0.5) * 20;
    this.vy[i] = vy;
    this.r[i] = r;
    this.r0[i] = this.mode === 'fill' ? r / this.swell : r;
    this.w[i] = 1 / (r * r);
    this.loose[i] = loose ? 1 : 0;
    this.deep[i] = this.mode === 'chase' ? 0 : 1;
    this.tub[i] = 0;
    this.alpha[i] = alpha;
    this.fade[i] = alpha < 1 ? 1 : 0;
    this.life[i] = 0;
    this.sink[i] = 0;
    this.off[i] = -10 + rnd() * 14;
    this.stuck[i] = 0;
    this.u[i] = 0;
    this.q[i] = 0;
    this.qv[i] = 0;
    this.ph[i] = rnd() * Math.PI * 2;
    this.phv[i] = (rnd() - 0.5) * 1.4;
    this.nb[i] = 0;
    return i;
  }

  private remove(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.px[i] = this.px[j];
    this.py[i] = this.py[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.r[i] = this.r[j];
    this.r0[i] = this.r0[j];
    this.w[i] = this.w[j];
    this.loose[i] = this.loose[j];
    this.deep[i] = this.deep[j];
    this.tub[i] = this.tub[j];
    this.alpha[i] = this.alpha[j];
    this.fade[i] = this.fade[j];
    this.life[i] = this.life[j];
    this.sink[i] = this.sink[j];
    this.off[i] = this.off[j];
    this.stuck[i] = this.stuck[j];
    this.u[i] = this.u[j];
    this.q[i] = this.q[j];
    this.qv[i] = this.qv[j];
    this.ph[i] = this.ph[j];
    this.phv[i] = this.phv[j];
    this.nb[i] = this.nb[j];
  }

  private visible(x: number, y: number, r: number): boolean {
    return y + r > this.viewTop - 10 && y - r < this.viewBottom + 10 && x > -40 && x < SHAFT_W + 40;
  }

  /** Pop bubble i: a ring, a few specks of spray (and a sound, if it can be seen). */
  pop(i: number): void {
    const x = this.x[i];
    const y = this.y[i];
    const r = this.r[i];
    if (this.alpha[i] > 0.4 && this.visible(x, y, r)) {
      if (this.rn < RINGS) {
        const k = this.rn++;
        this.rx[k] = x;
        this.ry[k] = y;
        this.rr[k] = r;
        this.ra[k] = 0;
      }
      const rnd = this.rnd;
      const m = 3 + Math.round(Math.min(4, r / 6));
      for (let s = 0; s < m; s++) {
        const a = rnd() * Math.PI * 2;
        const sp = 60 + rnd() * 90;
        this.addSpray(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8, this.vx[i] * 0.3 + Math.cos(a) * sp, this.vy[i] * 0.3 + Math.sin(a) * sp - 30, 0.22 + rnd() * 0.18, 0.6 + rnd() * 0.6);
      }
      this.onPop?.(x, y, r);
    }
    this.remove(i);
  }

  /** Statics near the foam, bucketed in rows for quick lookups. */
  private gather(game: DropGame, y0: number, y1: number): void {
    this.shapes.length = 0;
    for (const s of game.world.statics) if (s.maxY > y0 && s.minY < y1) this.shapes.push(s);
    const H = 64;
    this.rowTop = Math.floor(y0 / H) * H;
    const rows = Math.max(1, Math.ceil((y1 - this.rowTop) / H) + 1);
    while (this.rows.length < rows) this.rows.push([]);
    for (let k = 0; k < rows; k++) this.rows[k].length = 0;
    for (const s of this.shapes) {
      const a = Math.max(0, Math.floor((s.minY - R_MIN - R_SPAN - this.rowTop) / H));
      const b = Math.min(rows - 1, Math.floor((s.maxY + R_MIN + R_SPAN - this.rowTop) / H));
      for (let k = a; k <= b; k++) this.rows[k].push(s);
    }
    this.rowCount = rows;
  }

  private rowCount = 0;

  private shapesAt(y: number): StaticShape[] | null {
    const k = Math.floor((y - this.rowTop) / 64);
    return k >= 0 && k < this.rowCount ? this.rows[k] : null;
  }

  /** The drive toward the front, loose bubbles drifting, random pops; then move. */
  private forces(game: DropGame, top: number, near: number): void {
    const rnd = this.rnd;
    const fv = Math.max(0, this.frontV);
    // now and then a bubble at the front breaks off and drifts down ahead
    this.looseOwed += DT * (game.phase === 'play' ? 0.4 + 3 * near : this.mode === 'fill' ? 5 : 0.5);
    while (this.looseOwed >= 1) {
      this.looseOwed--;
      for (let tries = 0; tries < 8; tries++) {
        const i = Math.floor(rnd() * this.n);
        if (i >= this.n || this.loose[i] || this.r[i] > 15 || this.y[i] + this.r[i] < this.line(this.x[i]) - 26) continue;
        this.loose[i] = 1;
        this.life[i] = 1.2 + rnd() * 1.8;
        this.sink[i] = fv + 35 + rnd() * 70;
        break;
      }
    }
    for (let i = 0; i < this.n; i++) {
      const r = this.r[i];
      // the odd bubble just pops (little ones most often)
      if (rnd() < DT * 0.016 * (10 / r)) {
        this.pops.random++;
        this.pop(i--);
        continue;
      }
      if (this.loose[i]) {
        this.life[i] -= DT;
        if (this.life[i] <= 0) {
          this.pops.loose++;
          this.pop(i--);
          continue;
        }
        this.vy[i] += (this.sink[i] - this.vy[i]) * 0.06;
        this.vx[i] += Math.sin(this.time * 2.3 + this.ph[i] * 3) * 3;
      } else if (this.mode === 'fill') {
        // the foam swells to fill the screen: each bubble keeps its place in the mass, between
        // the top of the screen and the front pouring on down (the bottom of the screen, once
        // it is past it)
        const rs = Math.min(34, this.r0[i] * this.swell);
        if (rs > r) {
          this.r[i] = rs;
          this.w[i] = 1 / (rs * rs);
        }
        const u = this.u[i];
        const m0 = this.viewTop - 40;
        const m1 = Math.min(this.line(this.x[i]) + this.off[i] - r, this.massBot);
        const want = m0 + u * (m1 - m0);
        const target = Math.min(1700, u * this.massV + (want - this.y[i]) * 9);
        this.vy[i] += (target - this.vy[i]) * 0.3;
        this.deep[i] = 1;
      } else {
        const lag = this.line(this.x[i]) + this.off[i] - (this.y[i] + r);
        if (lag > 0) {
          // free bubbles hurry after the front; ones resting on the pile just keep pace,
          // so the mass doesn't crush its bottom layer
          const target = Math.min(1600, fv + (this.held[i] ? Math.min(40, lag) : DRIVE * lag));
          if (this.vy[i] < target) this.vy[i] += (target - this.vy[i]) * 0.14;
        }
        // held back far behind the front by a shelf or a floor: it is deeper in the room
        // (glass funnels channel the foam for a while first, and big bubbles jammed in a
        // neck burst)
        if (!this.deep[i]) {
          const g = this.glass[i];
          if (lag > (g ? 60 : DEEP_LAG) && this.touch[i]) this.stuck[i] += DT;
          else this.stuck[i] = Math.max(0, this.stuck[i] - DT * 2);
          if (g && r > 9 && this.stuck[i] > 0.35 && rnd() < 0.05) {
            this.pops.squeeze++;
            this.pop(i--);
            continue;
          }
          if (this.stuck[i] > (g ? 1.1 : 0.3) && lag > DEEP_LAG) this.deep[i] = 1;
        } else if (lag < 40 && !this.overlapsStatic(i)) this.deep[i] = 0;
        // stranded far above the screen: fade away
        if (this.y[i] + r < top - 70 && this.fade[i] >= 0) this.fade[i] = -1;
      }
      if (this.fade[i] !== 0) {
        this.alpha[i] += this.fade[i] * DT * 3;
        if (this.alpha[i] >= 1) {
          this.alpha[i] = 1;
          this.fade[i] = 0;
        } else if (this.alpha[i] <= 0) {
          this.remove(i--);
          continue;
        }
      }
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.x[i] += this.vx[i] * DT;
      this.y[i] += this.vy[i] * DT;
    }
  }

  private overlapsStatic(i: number): boolean {
    const row = this.shapesAt(this.y[i]);
    if (!row) return false;
    for (const s of row) if (contact(s, this.x[i], this.y[i], this.r[i]) !== null) return true;
    return false;
  }

  /** Neighbour pairs, once per step (`sameKind`: only between bubbles both floating on the bath, or both not). */
  private buildPairs(sameKind: boolean): void {
    const { x, y, r } = this;
    const n = this.n;
    let minY = Infinity;
    for (let i = 0; i < n; i++) if (y[i] < minY) minY = y[i];
    const cols = Math.ceil((SHAFT_W + 120) / CELL);
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) if (y[i] > maxY) maxY = y[i];
    const rows = n > 0 ? Math.min(400, Math.floor((maxY - minY) / CELL) + 1) : 0;
    if (this.head.length < cols * rows) this.head = new Int32Array(cols * rows * 2);
    this.head.fill(-1, 0, cols * rows);
    this.gridCols = cols;
    this.gridRows = rows;
    this.gridMinY = minY;
    for (let i = 0; i < n; i++) {
      const cx = Math.max(0, Math.min(cols - 1, Math.floor((x[i] + 60) / CELL)));
      const cy = Math.min(rows - 1, Math.floor((y[i] - minY) / CELL));
      const c = cy * cols + cx;
      this.next[i] = this.head[c];
      this.head[c] = i;
    }
    this.np = 0;
    const cap = this.pi.length;
    for (let i = 0; i < n; i++) {
      const cx = Math.max(0, Math.min(cols - 1, Math.floor((x[i] + 60) / CELL)));
      const cy = Math.min(rows - 1, Math.floor((y[i] - minY) / CELL));
      for (let gy = Math.max(0, cy - 1); gy <= Math.min(rows - 1, cy + 1); gy++)
        for (let gx = Math.max(0, cx - 1); gx <= Math.min(cols - 1, cx + 1); gx++)
          for (let j = this.head[gy * cols + gx]; j !== -1; j = this.next[j]) {
            if (j <= i || (sameKind && this.tub[i] !== this.tub[j])) continue;
            const dx = x[j] - x[i];
            const dy = y[j] - y[i];
            const reach = (r[i] + r[j]) * COHESION + 4;
            if (dx * dx + dy * dy < reach * reach && this.np < cap) {
              this.pi[this.np] = i;
              this.pj[this.np] = j;
              this.np++;
            }
          }
    }
    this.txx.fill(0, 0, n);
    this.tyy.fill(0, 0, n);
    this.hit.fill(0, 0, n);
    this.touch.fill(0, 0, n);
    this.held.fill(0, 0, n);
    this.glass.fill(0, 0, n);
    this.nb.fill(0, 0, n);
  }

  /** Neighbours keep apart (squishing a little) and cling softly; on the `last` pass, what presses on each. */
  private relaxPairs(last: boolean): void {
    const { x, y, r, w } = this;
    for (let k = 0; k < this.np; k++) {
      const i = this.pi[k];
      const j = this.pj[k];
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const d2 = dx * dx + dy * dy;
      const sum = r[i] + r[j];
      const c = sum * SQUISH;
      const wi = w[i];
      const wj = w[j];
      const wt = wi + wj;
      if (d2 < c * c) {
        const d = Math.sqrt(d2) || 1e-6;
        const nx = dx / d;
        const ny = dy / d;
        const o = (c - d) * 0.8;
        x[i] -= nx * o * (wi / wt);
        y[i] -= ny * o * (wi / wt);
        x[j] += nx * o * (wj / wt);
        y[j] += ny * o * (wj / wt);
        if (last) {
          // the lower one holds the upper one up
          if (ny > 0.35) this.held[i] = 1;
          else if (ny < -0.35) this.held[j] = 1;
          const ci = (c - d) / r[i];
          const cj = (c - d) / r[j];
          this.txx[i] += ci * nx * nx;
          this.tyy[i] += ci * ny * ny;
          this.txx[j] += cj * nx * nx;
          this.tyy[j] += cj * ny * ny;
        }
      } else if (!this.loose[i] && !this.loose[j]) {
        const cc = sum * COHESION;
        if (d2 < cc * cc) {
          // a soft pull: suds clump together
          const d = Math.sqrt(d2);
          const o = (d - c) * 0.03;
          const nx = dx / d;
          const ny = dy / d;
          x[i] += nx * o * (wi / wt);
          y[i] += ny * o * (wi / wt);
          x[j] -= nx * o * (wj / wt);
          y[j] -= ny * o * (wj / wt);
        }
      }
      if (last && d2 < sum * sum * 1.3) {
        if (this.nb[i] < 255) this.nb[i]++;
        if (this.nb[j] < 255) this.nb[j]++;
      }
    }
  }

  /** Keep bubbles apart (and clinging), out of the geometry and the cat, behind the front. */
  private solve(cat: SoftBody, swallowed: boolean): void {
    const { x, y, r } = this;
    // the cat: an obstacle (until the foam swallows it whole)
    const catSolid = !swallowed;
    let cx0 = Infinity;
    let cy0 = Infinity;
    let cx1 = -Infinity;
    let cy1 = -Infinity;
    for (let k = 0; k < cat.n; k++) {
      if (cat.x[k] < cx0) cx0 = cat.x[k];
      if (cat.x[k] > cx1) cx1 = cat.x[k];
      if (cat.y[k] < cy0) cy0 = cat.y[k];
      if (cat.y[k] > cy1) cy1 = cat.y[k];
    }
    const n = this.n;
    this.buildPairs(false);
    for (let it = 0; it < ITER; it++) {
      const last = it === ITER - 1;
      this.relaxPairs(last);
      for (let i = 0; i < n; i++) {
        const ri = r[i];
        // the room's geometry
        if (!this.deep[i]) {
          const row = this.shapesAt(y[i]);
          if (row)
            for (const s of row) {
              const ct = contact(s, x[i], y[i], ri);
              if (!ct) continue;
              x[i] += ct.nx * ct.depth;
              y[i] += ct.ny * ct.depth;
              this.touch[i] = 1;
              if (s.material === 'glass') this.glass[i] = 1;
              if (ct.ny < -0.35) this.held[i] = 1;
              if (last) {
                const cs = ct.depth / ri;
                this.txx[i] += cs * ct.nx * ct.nx;
                this.tyy[i] += cs * ct.ny * ct.ny;
              }
              if (it === 0) {
                // a hard knock sets it wobbling (flattened along the knock)
                const vn = this.vx[i] * ct.nx + this.vy[i] * ct.ny;
                if (vn < -120) this.qv[i] += Math.min(2.2, -vn / 300) * (ct.nx * ct.nx - ct.ny * ct.ny);
              }
            }
        }
        // the cat
        if (catSolid && x[i] + ri > cx0 - SKIN && x[i] - ri < cx1 + SKIN && y[i] + ri > cy0 - SKIN && y[i] - ri < cy1 + SKIN) {
          const ct = ringContact(cat, x[i], y[i], ri + SKIN);
          if (ct) {
            x[i] += ct.nx * ct.depth;
            y[i] += ct.ny * ct.depth;
            if (ct.ny < -0.35) this.held[i] = 1;
            if (it === 0) {
              const vn = (this.vx[i] - cat.vcx) * ct.nx + (this.vy[i] - cat.vcy) * ct.ny;
              if (-vn > this.hit[i]) this.hit[i] = -vn;
              if (vn < -120) this.qv[i] += Math.min(2.2, -vn / 300) * (ct.nx * ct.nx - ct.ny * ct.ny);
            }
            if (last) {
              const cs = Math.min(1, ct.depth / ri);
              this.txx[i] += cs * ct.nx * ct.nx;
              this.tyy[i] += cs * ct.ny * ct.ny;
            }
          }
        }
        // behind the front (which holds the bottom layer up)
        if (!this.loose[i]) {
          const lim = this.line(x[i]) + this.off[i] - ri * 0.8;
          if (y[i] > lim) {
            y[i] -= (y[i] - lim) * 0.7;
            this.held[i] = 1;
          }
        }
        // the shaft's sides (deep bubbles too)
        const m = ri * 0.85;
        if (x[i] < m) x[i] = m;
        else if (x[i] > SHAFT_W - m) x[i] = SHAFT_W - m;
      }
    }
  }

  /** New velocities from the moves; squash springs; pops from squeezes and (`hits`) from being hit hard. */
  private settle(hits: boolean): void {
    const rnd = this.rnd;
    for (let i = 0; i < this.n; i++) {
      const r = this.r[i];
      let vx = (this.x[i] - this.px[i]) / DT;
      let vy = (this.y[i] - this.py[i]) / DT;
      vx *= this.loose[i] ? 0.985 : 0.95;
      vy *= 0.985;
      this.vx[i] = vx;
      this.vy[i] = vy;
      // squeezed too hard, or knocked by a falling cat: pop
      const press = this.txx[i] + this.tyy[i];
      const squeezed = press > 2 && r > 4 && rnd() < 0.03;
      if (squeezed || (this.hit[i] > 300 && rnd() < 0.6 && hits)) {
        if (squeezed) this.pops.squeeze++;
        else this.pops.hit++;
        this.pop(i--);
        continue;
      }
      // the shape: pressed in by what pushes on it, drawn out along a fast fall
      let sq = (this.txx[i] - this.tyy[i]) * 0.45;
      const sp2 = vx * vx + vy * vy;
      if (sp2 > 25600) {
        const sp = Math.sqrt(sp2);
        sq += (Math.min(0.08, (sp - 160) / 5000) * (vy * vy - vx * vx)) / sp2;
      }
      const target = Math.max(-0.13, Math.min(0.13, sq));
      // a springy wobble that rings out
      const om = 10 + 34 / Math.sqrt(r);
      this.qv[i] += (om * om * (target - this.q[i]) - 2 * 0.16 * om * this.qv[i]) * DT;
      this.q[i] = Math.max(-0.18, Math.min(0.18, this.q[i] + this.qv[i] * DT));
      this.ph[i] += this.phv[i] * DT;
    }
  }

  /** Keep the region behind the front full: new bubbles come in from above the screen. */
  private replenish(top: number, F: number): void {
    const rnd = this.rnd;
    let mass = 0;
    for (let i = 0; i < this.n; i++) if (!this.loose[i] && this.fade[i] >= 0) mass++;
    if (this.mode === 'fill') {
      // as the foam swells, new bubbles form in it wherever there is room (bigger ones)
      const m0 = this.viewTop - 40;
      const span = this.massBot - m0;
      const target = Math.min(CAP - FLOATS - 8, Math.round((SHAFT_W * Math.max(0, span) * PACK) / FILL_AREA) + 60);
      for (let tries = 0, made = 0; tries < 40 && made < 12 && mass < target && this.n < CAP; tries++) {
        const rr = FILL_MIN + FILL_SPAN * rnd() ** FILL_SKEW;
        const u = rnd();
        const x = rr + rnd() * (SHAFT_W - 2 * rr);
        const y = m0 + u * (Math.min(this.line(x) - rr, this.massBot) - m0);
        if (!this.room(x, y, rr)) continue;
        const i = this.spawn(x, y, rr, u * this.massV, 0);
        if (i < 0) break;
        this.u[i] = u;
        made++;
        mass++;
      }
      return;
    }
    const target = Math.min(CHASE_CAP - 30, Math.round((SHAFT_W * Math.max(0, F - top) * PACK) / MEAN_AREA));
    for (let k = 0; k < 8 && mass < target && this.n < CAP; k++, mass++) {
      const rr = R_MIN + R_SPAN * rnd() ** SKEW;
      const i = this.spawn(rr + rnd() * (SHAFT_W - 2 * rr), top - 30 - rnd() * 50, rr, Math.max(0, this.frontV) + 260, 0);
      if (i < 0) break;
    }
  }

  /** Is there room for a bubble of radius `rr` at (x, y)? (Against the bubbles as of the last solve.) */
  private room(x: number, y: number, rr: number): boolean {
    const cols = this.gridCols;
    const rows = this.gridRows;
    if (rows === 0) return true;
    const cx = Math.max(0, Math.min(cols - 1, Math.floor((x + 60) / CELL)));
    const cy = Math.floor((y - this.gridMinY) / CELL);
    for (let gy = Math.max(0, cy - 1); gy <= Math.min(rows - 1, cy + 1); gy++)
      for (let gx = Math.max(0, cx - 1); gx <= Math.min(cols - 1, cx + 1); gx++)
        for (let j = this.head[gy * cols + gx]; j !== -1; j = this.next[j]) {
          if (j >= this.n) continue;
          const dx = this.x[j] - x;
          const dy = this.y[j] - y;
          const c = (this.r[j] + rr) * 0.8;
          if (dx * dx + dy * dy < c * c) return false;
        }
    return true;
  }

  // --- the end: clearing off the screen, and floating on the bath -------------------------

  /**
   * The view has moved on to the bath, under the full foam: from now on the
   * foam clears off the screen (stepEnd), and a few dozen bubbles float on the
   * bath's water.
   */
  beginClear(camY: number, viewH: number, bath: TubSurface): void {
    this.mode = 'clear';
    this.clearT = 0;
    this.bath = bath;
    this.viewTop = camY;
    this.viewBottom = camY + viewH;
    this.floodTop = camY - 60;
    this.floodBot = Infinity;
    this.floodA = 1;
    // what is below the screen won't be seen again (room for the bath's bubbles)
    for (let i = 0; i < this.n; i++) if (this.y[i] - this.r[i] * 1.5 > this.viewBottom) this.remove(i--);
    this.dn = 0;
    this.addFloats(FLOATS, false);
  }

  /** The bath moved (the screen changed height): its bubbles go with it. */
  shiftBath(dy: number): void {
    for (let i = 0; i < this.n; i++)
      if (this.tub[i]) {
        this.y[i] += dy;
        this.py[i] += dy;
      }
    for (let k = 0; k < this.dn; k++) this.dy[k] += dy;
  }

  /** Bubbles floating on the bath (fading in, unless the foam still hides them). */
  private addFloats(k: number, fadeIn: boolean): void {
    const b = this.bath;
    if (!b) return;
    const rnd = this.rnd;
    for (let m = 0; m < k; m++) {
      const r = 3 + 7.5 * rnd() ** 1.5;
      const x = b.x0 + r + rnd() * (b.x1 - b.x0 - 2 * r);
      const i = this.spawn(x, b.surface(x) - r * (0.3 + rnd() * 0.6), r, 0, fadeIn ? 0 : 1);
      if (i < 0) return;
      this.tub[i] = 1;
      this.deep[i] = 0;
      this.vx[i] = (rnd() - 0.5) * 10;
    }
  }

  /** A little bubble lets go of the bath's suds and drifts up until it pops. */
  private riser(b: TubSurface): void {
    const rnd = this.rnd;
    const x = b.x0 + 16 + rnd() * (b.x1 - b.x0 - 32);
    const r = 1.6 + 3.4 * rnd() ** 1.4;
    const i = this.spawn(x, b.surface(x) - r - 2, r, -(20 + rnd() * 25), 0, true);
    if (i < 0) return;
    this.tub[i] = 1;
    this.deep[i] = 1;
    this.life[i] = 1.4 + rnd() * 1.8;
    this.sink[i] = -(22 + rnd() * 26);
  }

  /** One physics frame of the end: the foam clearing off the screen, and the bath's bubbles floating. */
  stepEnd(camY: number, viewH: number): void {
    const b = this.bath;
    if (!b) return;
    this.time += DT;
    this.viewTop = camY;
    this.viewBottom = camY + viewH;
    const t = (this.clearT += DT);
    // the rest of the foam slides down off the screen while its top pops away in a cascade
    const slideV = SLIDE * t;
    this.floodTop = camY - 60 + 0.5 * SLIDE * t * t + EAT * t;
    if (this.floodTop > this.viewBottom + 20) this.floodA = 0;
    this.endForces(b, slideV);
    this.endSolve(b);
    this.settle(true);
    this.stepDropsEnd(b);
    this.stepSpray();
  }

  private endForces(b: TubSurface, slideV: number): void {
    const rnd = this.rnd;
    // now and then a little bubble lets go of the suds and drifts up
    if (this.floodTop > b.surface((b.x0 + b.x1) / 2)) {
      this.riseOwed += DT * 1.3;
      while (this.riseOwed >= 1) {
        this.riseOwed--;
        this.riser(b);
      }
    }
    let floats = 0;
    for (let i = 0; i < this.n; i++) {
      const r = this.r[i];
      if (this.loose[i]) {
        // drifting (up, off the bath; on down, off the foam) until it pops
        this.life[i] -= DT;
        if (this.life[i] <= 0) {
          this.pops.loose++;
          this.pop(i--);
          continue;
        }
        this.vy[i] += ((this.tub[i] ? 0 : slideV) + this.sink[i] - this.vy[i]) * 0.05;
        this.vx[i] += Math.sin(this.time * 2.1 + this.ph[i] * 3) * 2.2;
        this.vx[i] *= 0.97;
      } else if (this.tub[i]) {
        floats++;
        // floating: held up by the suds under it (and its neighbours), drawn gently down
        // onto them, nudged about by the water; once in a while one pops
        this.vy[i] += 240 * DT;
        this.vx[i] += Math.sin(this.time * 0.8 + this.ph[i] * 5) * 1.6 + (rnd() - 0.5) * 6;
        this.vx[i] *= 0.95;
        this.vy[i] *= 0.92;
        if (rnd() < DT * 0.025) {
          this.pops.random++;
          this.pop(i--);
          continue;
        }
      } else {
        // the foam: popping where the cascade has reached it, sliding off the screen with the rest
        if (this.y[i] - r * 0.4 < this.clearLine(this.x[i]) && rnd() < 0.3) {
          this.pops.cascade++;
          this.pop(i--);
          continue;
        }
        if (this.y[i] - r > this.viewBottom + 30) {
          this.remove(i--);
          continue;
        }
        this.vy[i] += (slideV - this.vy[i]) * 0.3;
        this.vx[i] *= 0.9;
      }
      if (this.fade[i] !== 0) {
        this.alpha[i] += this.fade[i] * DT * 3;
        if (this.alpha[i] >= 1) {
          this.alpha[i] = 1;
          this.fade[i] = 0;
        } else if (this.alpha[i] <= 0) {
          this.remove(i--);
          continue;
        }
      }
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.x[i] += this.vx[i] * DT;
      this.y[i] += this.vy[i] * DT;
    }
    // keep a few dozen afloat
    if (floats < FLOATS - 6 && rnd() < DT * 2) this.addFloats(1, true);
  }

  /** The end's bubbles keep apart (the bath's among themselves), out of the cat, on the suds and in the tub. */
  private endSolve(b: TubSurface): void {
    const { x, y, r } = this;
    const cat = b.cat;
    let cx0 = Infinity;
    let cy0 = Infinity;
    let cx1 = -Infinity;
    let cy1 = -Infinity;
    if (cat)
      for (let k = 0; k < cat.n; k++) {
        if (cat.x[k] < cx0) cx0 = cat.x[k];
        if (cat.x[k] > cx1) cx1 = cat.x[k];
        if (cat.y[k] < cy0) cy0 = cat.y[k];
        if (cat.y[k] > cy1) cy1 = cat.y[k];
      }
    const n = this.n;
    this.buildPairs(true);
    for (let it = 0; it < ITER; it++) {
      const last = it === ITER - 1;
      this.relaxPairs(last);
      for (let i = 0; i < n; i++) {
        const ri = r[i];
        if (!this.tub[i]) {
          const m = ri * 0.85;
          if (x[i] < m) x[i] = m;
          else if (x[i] > SHAFT_W - m) x[i] = SHAFT_W - m;
          continue;
        }
        // the cat (pushing through them as it lands, jostling them as it bobs)
        if (cat && x[i] + ri > cx0 - SKIN && x[i] - ri < cx1 + SKIN && y[i] + ri > cy0 - SKIN && y[i] - ri < cy1 + SKIN) {
          const ct = ringContact(cat, x[i], y[i], ri + SKIN);
          if (ct) {
            x[i] += ct.nx * ct.depth;
            y[i] += ct.ny * ct.depth;
            if (it === 0) {
              const vn = (this.vx[i] - cat.vcx) * ct.nx + (this.vy[i] - cat.vcy) * ct.ny;
              if (-vn > this.hit[i]) this.hit[i] = -vn;
              if (vn < -120) this.qv[i] += Math.min(2.2, -vn / 300) * (ct.nx * ct.nx - ct.ny * ct.ny);
            }
            if (last) {
              const cs = Math.min(1, ct.depth / ri);
              this.txx[i] += cs * ct.nx * ct.nx;
              this.tyy[i] += cs * ct.ny * ct.ny;
            }
          }
        }
        if (this.loose[i]) {
          // (drifting loose: only the room's walls hold it in)
          const m = ri * 0.85;
          if (x[i] < m) x[i] = m;
          else if (x[i] > SHAFT_W - m) x[i] = SHAFT_W - m;
          continue;
        }
        // the suds under it hold it up
        const lim = b.surface(x[i]) - ri * 0.3;
        if (y[i] > lim) {
          y[i] -= (y[i] - lim) * 0.8;
          this.held[i] = 1;
          if (last) this.tyy[i] += Math.min(0.5, (y[i] - lim) / ri);
        }
        // the tub's sides
        const m = ri * 0.8;
        if (x[i] < b.x0 + m) x[i] = b.x0 + m;
        else if (x[i] > b.x1 - m) x[i] = b.x1 - m;
      }
    }
  }

  /**
   * The cat lands in the bath at (x, y), `width` across, at `speed`: water
   * flies up and out, and a flurry of suds with it.
   */
  splashAt(x: number, y: number, speed: number, width: number): void {
    const rnd = this.rnd;
    const k = Math.min(1, speed / 800);
    const m = Math.round(30 + 34 * k);
    for (let q = 0; q < m; q++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const at = 0.2 + rnd() * 0.75;
      const up = (260 + rnd() * 420) * (0.5 + 0.7 * k) * (1.2 - at * 0.55);
      this.addSpray(x + side * width * at, y - 4 - rnd() * 8, side * (40 + rnd() * 240) * (0.5 + k), -up, 0.6 + rnd() * 0.5, 1.8 + rnd() * 2.4);
    }
    // a flurry of suds thrown up (they drift back down and pop)
    const b = this.bath;
    for (let q = 0; q < 9 + Math.round(8 * k); q++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const r = 2 + rnd() * 5;
      const i = this.spawn(x + side * width * (0.2 + rnd() * 0.5), y - 6, r, -(160 + rnd() * 260) * (0.5 + k), 1, true);
      if (i < 0) break;
      this.tub[i] = b ? 1 : 0;
      this.deep[i] = 1;
      this.vx[i] = side * (40 + rnd() * 170);
      this.life[i] = 0.9 + rnd() * 1.3;
      this.sink[i] = 30 + rnd() * 40;
    }
  }

  // --- drops -------------------------------------------------------------------------------

  /** A drop falling from (x, y), moving (vx, vy). */
  drop(x: number, y: number, vx: number, vy: number): void {
    if (this.dn >= DROPS) return;
    const k = this.dn++;
    this.dx[k] = x;
    this.dy[k] = y;
    this.dvx[k] = vx;
    this.dvy[k] = vy;
    this.ds[k] = 1.3 + this.rnd() * 0.8;
    this.dage[k] = 0;
  }

  private stepDrops(game: DropGame, near: number): void {
    const rnd = this.rnd;
    const phase = game.phase;
    // drizzle: drips off the front bubbles, more as the front nears the cat
    const rate = phase === 'play' ? (near > 0 ? 3 + 36 * near * near : 0) : this.mode === 'fill' ? 30 : 0;
    this.dripOwed += rate * DT;
    while (this.dripOwed >= 1) {
      this.dripOwed--;
      let done = false;
      if (this.active && this.n > 0) {
        for (let tries = 0; tries < 6 && !done; tries++) {
          const i = Math.floor(rnd() * this.n);
          if (this.loose[i] || this.y[i] + this.r[i] < this.line(this.x[i]) - 30) continue;
          this.drop(this.x[i] + (rnd() - 0.5) * this.r[i], this.y[i] + this.r[i] * 0.9, this.vx[i] * 0.5, Math.max(0, this.vy[i]) + 40 + rnd() * 80);
          done = true;
        }
      }
      if (!done && phase === 'play') this.drop(rnd() * SHAFT_W, this.front - 4, 0, Math.max(0, this.frontV) + 60 + rnd() * 80);
    }
    const cat = game.cat;
    let cx0 = Infinity;
    let cy0 = Infinity;
    let cx1 = -Infinity;
    let cy1 = -Infinity;
    for (let k = 0; k < cat.n; k++) {
      if (cat.x[k] < cx0) cx0 = cat.x[k];
      if (cat.x[k] > cx1) cx1 = cat.x[k];
      if (cat.y[k] < cy0) cy0 = cat.y[k];
      if (cat.y[k] > cy1) cy1 = cat.y[k];
    }
    for (let k = 0; k < this.dn; k++) {
      this.dvy[k] += 1300 * DT;
      const drag = 1 - 0.5 * DT;
      this.dvx[k] *= drag;
      this.dvy[k] *= drag;
      const x0 = this.dx[k];
      const y0 = this.dy[k];
      const x = x0 + this.dvx[k] * DT;
      const y = y0 + this.dvy[k] * DT;
      this.dx[k] = x;
      this.dy[k] = y;
      this.dage[k] += DT;
      let gone = this.dage[k] > 3 || y > this.viewBottom + 120 || x < -20 || x > SHAFT_W + 20;
      if (!gone) {
        // splash on the geometry (checked along the step, so fast drops don't skip thin shelves)
        const s = this.dropHits(x0, y0, x, y, this.ds[k]);
        if (s) {
          this.splash(s.x, s.y, s.nx, s.ny, this.dvx[k], this.dvy[k]);
          gone = true;
        } else if (x > cx0 - 2 && x < cx1 + 2 && y > cy0 - 2 && y < cy1 + 2) {
          const ct = ringContact(cat, x, y, SKIN + this.ds[k]);
          if (ct) {
            this.splash(x + ct.nx * ct.depth, y + ct.ny * ct.depth, ct.nx, ct.ny, this.dvx[k], this.dvy[k]);
            gone = true;
          }
        }
      }
      if (gone) {
        const j = --this.dn;
        this.dx[k] = this.dx[j];
        this.dy[k] = this.dy[j];
        this.dvx[k] = this.dvx[j];
        this.dvy[k] = this.dvy[j];
        this.ds[k] = this.ds[j];
        this.dage[k] = this.dage[j];
        k--;
      }
    }
  }

  /** Drops at the end: falling until they land in the bath or on the floor (a little splash either way). */
  private stepDropsEnd(b: TubSurface): void {
    for (let k = 0; k < this.dn; k++) {
      this.dvy[k] += 1300 * DT;
      const x = (this.dx[k] += this.dvx[k] * DT);
      const y = (this.dy[k] += this.dvy[k] * DT);
      this.dage[k] += DT;
      let gone = this.dage[k] > 3 || y > this.viewBottom + 40;
      if (!gone && this.dvy[k] > 0) {
        const top = x > b.x0 && x < b.x1 ? b.surface(x) : Infinity;
        if (y > top) {
          this.splash(x, top, 0, -1, this.dvx[k] * 0.3, this.dvy[k] * 0.35);
          gone = true;
        } else if (y > b.floor) {
          this.splash(x, b.floor, 0, -1, this.dvx[k], this.dvy[k]);
          gone = true;
        }
      }
      if (gone) {
        const j = --this.dn;
        this.dx[k] = this.dx[j];
        this.dy[k] = this.dy[j];
        this.dvx[k] = this.dvx[j];
        this.dvy[k] = this.dvy[j];
        this.ds[k] = this.ds[j];
        this.dage[k] = this.dage[j];
        k--;
      }
    }
  }

  private readonly hitAt = { x: 0, y: 0, nx: 0, ny: 0 };

  private dropHits(x0: number, y0: number, x1: number, y1: number, rad: number): { x: number; y: number; nx: number; ny: number } | null {
    const steps = Math.max(1, Math.ceil(Math.abs(y1 - y0) / 6));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const row = this.shapesAt(y);
      if (!row) continue;
      for (const sh of row) {
        if (x < sh.minX - rad || x > sh.maxX + rad || y < sh.minY - rad || y > sh.maxY + rad) continue;
        const ct = contact(sh, x, y, rad);
        if (ct) {
          const h = this.hitAt;
          h.x = x + ct.nx * ct.depth;
          h.y = y + ct.ny * ct.depth;
          h.nx = ct.nx;
          h.ny = ct.ny;
          return h;
        }
      }
    }
    return null;
  }

  /** A drop hits something: a few tiny droplets jump off it. */
  private splash(x: number, y: number, nx: number, ny: number, vx: number, vy: number): void {
    const rnd = this.rnd;
    if (!this.visible(x, y, 10)) return;
    const sp = Math.min(1, Math.sqrt(vx * vx + vy * vy) / 700);
    const m = 3 + Math.round(rnd() * 2 + sp * 2);
    const tx = -ny;
    const ty = nx;
    for (let s = 0; s < m; s++) {
      const out = (60 + rnd() * 100) * (0.5 + sp);
      const side = (rnd() - 0.5) * 2 * (60 + rnd() * 90) * (0.5 + sp);
      this.addSpray(x, y, nx * out + tx * side, ny * out + ty * side, 0.28 + rnd() * 0.22, 1 + rnd() * 0.8);
    }
    if (this.kn < SPLATS) {
      const k = this.kn++;
      this.kx[k] = x;
      this.ky[k] = y;
      this.kang[k] = Math.atan2(ny, nx) + Math.PI / 2;
      this.ks[k] = 2.2 + sp * 2.5;
      this.ka[k] = 0;
    }
  }

  private addSpray(x: number, y: number, vx: number, vy: number, life: number, size: number): void {
    if (this.sn >= SPRAY) return;
    const k = this.sn++;
    this.sx[k] = x;
    this.sy[k] = y;
    this.svx[k] = vx;
    this.svy[k] = vy;
    this.sa[k] = 0;
    this.sl[k] = life;
    this.ss[k] = size;
  }

  private stepSpray(): void {
    // (in the bath, water thrown up falls back into it, or onto the floor)
    const b = this.mode === 'clear' ? this.bath : null;
    for (let k = 0; k < this.sn; k++) {
      this.svy[k] += 1100 * DT;
      const x = (this.sx[k] += this.svx[k] * DT);
      const y = (this.sy[k] += this.svy[k] * DT);
      this.sa[k] += DT;
      // (and nothing flies out through the house's walls)
      let gone = this.sa[k] >= this.sl[k] || x < 0 || x > SHAFT_W;
      if (b && !gone && this.svy[k] > 0 && ((x > b.x0 && x < b.x1 && y > b.surface(x) + 4) || y > b.floor)) gone = true;
      if (gone) {
        const j = --this.sn;
        this.sx[k] = this.sx[j];
        this.sy[k] = this.sy[j];
        this.svx[k] = this.svx[j];
        this.svy[k] = this.svy[j];
        this.sa[k] = this.sa[j];
        this.sl[k] = this.sl[j];
        this.ss[k] = this.ss[j];
        k--;
      }
    }
    for (let k = 0; k < this.kn; k++) {
      this.ka[k] += DT;
      if (this.ka[k] > 0.22) {
        const j = --this.kn;
        this.kx[k] = this.kx[j];
        this.ky[k] = this.ky[j];
        this.kang[k] = this.kang[j];
        this.ks[k] = this.ks[j];
        this.ka[k] = this.ka[j];
        k--;
      }
    }
    for (let k = 0; k < this.rn; k++) {
      this.ra[k] += DT;
      if (this.ra[k] > 0.2) {
        const j = --this.rn;
        this.rx[k] = this.rx[j];
        this.ry[k] = this.ry[j];
        this.rr[k] = this.rr[j];
        this.ra[k] = this.ra[j];
        k--;
      }
    }
  }
}

// --- contacts ------------------------------------------------------------------------------

interface Contact {
  nx: number;
  ny: number;
  depth: number;
}

const CT: Contact = { nx: 0, ny: 0, depth: 0 };

/** A circle against a static (a convex polygon grown by its rounding radius): the push out, or null. */
export function contact(s: StaticShape, px: number, py: number, rad: number): Contact | null {
  if (px < s.minX - rad || px > s.maxX + rad || py < s.minY - rad || py > s.maxY + rad) return null;
  const reach = s.radius + rad;
  let maxD = -Infinity;
  let maxK = 0;
  for (let k = 0; k < s.n; k++) {
    const dk = s.nx[k] * px + s.ny[k] * py - s.d[k];
    if (dk > maxD) {
      maxD = dk;
      maxK = k;
    }
  }
  if (maxD >= reach) return null;
  if (maxD <= 0) {
    CT.nx = s.nx[maxK];
    CT.ny = s.ny[maxK];
    CT.depth = reach - maxD;
    return CT;
  }
  let best = Infinity;
  let qx = 0;
  let qy = 0;
  for (let k = 0; k < s.n; k++) {
    const k2 = k + 1 === s.n ? 0 : k + 1;
    const ax = s.xs[k];
    const ay = s.ys[k];
    const ex = s.xs[k2] - ax;
    const ey = s.ys[k2] - ay;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 1e-12 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex * t;
    const cy = ay + ey * t;
    const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (d2 < best) {
      best = d2;
      qx = cx;
      qy = cy;
    }
  }
  if (best >= reach * reach) return null;
  const d = Math.sqrt(best);
  if (d < 1e-9) {
    CT.nx = s.nx[maxK];
    CT.ny = s.ny[maxK];
  } else {
    CT.nx = (px - qx) / d;
    CT.ny = (py - qy) / d;
  }
  CT.depth = reach - d;
  return CT;
}

const RC: Contact & { inside: boolean } = { nx: 0, ny: 0, depth: 0, inside: false };

/** A circle of radius `rad` against the cat's ring: the push out (or null), and whether its centre is inside. */
export function ringContact(b: SoftBody, px: number, py: number, rad: number): (Contact & { inside: boolean }) | null {
  const n = b.n;
  let inside = false;
  let best = Infinity;
  let qx = 0;
  let qy = 0;
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
    const cx = xj + ex * t;
    const cy = yj + ey * t;
    const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (d2 < best) {
      best = d2;
      qx = cx;
      qy = cy;
    }
  }
  const d = Math.sqrt(best);
  if (!inside && d >= rad) return null;
  if (d < 1e-6) return null;
  RC.inside = inside;
  if (inside) {
    RC.nx = (qx - px) / d;
    RC.ny = (qy - py) / d;
    RC.depth = d + rad;
  } else {
    RC.nx = (px - qx) / d;
    RC.ny = (py - qy) / d;
    RC.depth = rad - d;
  }
  return RC;
}
