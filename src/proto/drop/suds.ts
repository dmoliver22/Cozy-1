// Cat Drop: bath time's foam, simulated. A few hundred soap bubbles packed
// into a mass that the bath-time front (game.foamY, which alone decides the
// catch) drives down the shaft. Position-based: bubbles keep apart (squishing
// a little), cling softly to their neighbours, slide off shelves, heap on
// cushions, pour through hatches, funnels and tubes, flow around the cat
// (never pushing it), and pop: now and then, when squeezed too hard, or when
// they hit the cat fast. Each keeps a springy squash for drawing. Drops drip
// from the front and off a soaked cat, fall, and splash on what they hit.
// Purely visual: nothing here feeds back into the game.

import type { StaticShape } from '../../physics/shapes';
import { NODE_RADIUS, type SoftBody } from '../../physics/softbody';
import { SOAK, type DropGame } from './game';
import { SHAFT_W } from './level';

const DT = 1 / 60;
/** Most bubbles alive at once. */
export const CAP = 270;
const R_MIN = 3;
const R_SPAN = 25;
/** Bubble radii are R_MIN + R_SPAN u^SKEW: many small, some medium, a few big. */
const SKEW = 3;
/** Their mean area (to know how many fill a region), and how tightly they pack. */
const MEAN_AREA = 427;
const PACK = 0.9;
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
const SKIN = NODE_RADIUS * 0.95;

type Rand = () => number;

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
  readonly alpha = new Float32Array(CAP);
  private readonly fade = new Int8Array(CAP);
  /** Loose bubbles: seconds left, and the speed they drift down at. */
  private readonly life = new Float32Array(CAP);
  private readonly sink = new Float32Array(CAP);
  /** Where each sits against the front (a lumpy edge, not a ruled line). */
  private readonly off = new Float32Array(CAP);
  private readonly stuck = new Float32Array(CAP);
  /** Squash: amount (0 round .. 0.2 flattened, negative while it wobbles back), its rate, and its axis. */
  readonly q = new Float32Array(CAP);
  private readonly qv = new Float32Array(CAP);
  readonly qa = new Float32Array(CAP);
  /** Thin-film swirl: phase and speed. */
  readonly ph = new Float32Array(CAP);
  private readonly phv = new Float32Array(CAP);
  /** Packed neighbours (dense foam gets a white suds body behind it). */
  readonly nb = new Uint8Array(CAP);
  private readonly txx = new Float32Array(CAP);
  private readonly txy = new Float32Array(CAP);
  private readonly tyy = new Float32Array(CAP);
  private readonly hit = new Float32Array(CAP);
  private readonly touch = new Uint8Array(CAP);
  /** Resting on something (a bubble or a surface below it): no more drive than keeping pace. */
  private readonly held = new Uint8Array(CAP);

  // --- drops falling from the foam (and off a soaked cat) ---
  dn = 0;
  readonly dx = new Float64Array(DROPS);
  readonly dy = new Float64Array(DROPS);
  readonly dvx = new Float64Array(DROPS);
  readonly dvy = new Float64Array(DROPS);
  readonly ds = new Float32Array(DROPS);
  private readonly dage = new Float32Array(DROPS);
  private readonly dcat = new Uint8Array(DROPS);

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

  /** The front line this step (world y) and how fast it moves. */
  front = 0;
  frontV = 0;
  active = false;
  time = 0;
  /** Called for each visible pop (for a sound). */
  onPop: ((x: number, y: number, r: number) => void) | null = null;
  /** Debug: pops by cause. */
  readonly pops = { random: 0, loose: 0, squeeze: 0, hit: 0, release: 0 };
  readonly prof = [0, 0, 0, 0];

  private rnd: Rand = rng(1);
  private viewTop = 0;
  private viewBottom = 0;
  private dripOwed = 0;
  private looseOwed = 0;
  private catDripOwed = 0;
  // scratch
  private head = new Int32Array(0);
  private next = new Int32Array(CAP);
  private pi = new Int32Array(CAP * 16);
  private pj = new Int32Array(CAP * 16);
  private np = 0;
  private shapes: StaticShape[] = [];
  private rows: StaticShape[][] = [];
  private rowTop = 0;

  /** Debug: how hard each bubble is pressed (sum of its overlaps over its radius). */
  pressures(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.n; i++) out.push(this.txx[i] + this.tyy[i]);
    return out;
  }

  /** A new run. */
  reset(game: DropGame): void {
    this.n = this.dn = this.sn = this.rn = 0;
    this.front = game.foamY;
    this.frontV = 0;
    this.active = false;
    this.time = 0;
    this.rnd = rng(game.seed * 7 + 3);
    this.dripOwed = this.looseOwed = this.catDripOwed = 0;
  }

  /** The front's line at x: gentle slow billows, so the edge is never ruled. */
  line(x: number): number {
    const t = this.time;
    return this.front + 5 * Math.sin(x * 0.021 + t * 0.9) + 3.5 * Math.sin(x * 0.047 - t * 1.3 + 1.7);
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
      const t0 = performance.now();
      this.forces(game, top, near);
      const t1 = performance.now();
      this.solve(cat, phase === 'soak' ? game.soakT : -1);
      const t2 = performance.now();
      this.settle(phase);
      this.replenish(top, F);
      const t3 = performance.now();
      this.prof[0] = t1 - t0;
      this.prof[1] = t2 - t1;
      this.prof[2] = t3 - t2;
    }
    const t4 = performance.now();
    this.stepDrops(game, near);
    this.stepSpray();
    this.prof[3] = performance.now() - t4;
  }

  /** Fill the region behind a front that is about to come into view (off screen). */
  private fill(top: number, F: number): void {
    const rnd = this.rnd;
    const target = Math.min(CAP - 30, Math.round((SHAFT_W * (F - top) * PACK) / MEAN_AREA));
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
    this.w[i] = 1 / (r * r);
    this.loose[i] = loose ? 1 : 0;
    this.deep[i] = 0;
    this.alpha[i] = alpha;
    this.fade[i] = alpha < 1 ? 1 : 0;
    this.life[i] = 0;
    this.sink[i] = 0;
    this.off[i] = -10 + rnd() * 14;
    this.stuck[i] = 0;
    this.q[i] = 0;
    this.qv[i] = 0;
    this.qa[i] = rnd() * Math.PI;
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
    this.w[i] = this.w[j];
    this.loose[i] = this.loose[j];
    this.deep[i] = this.deep[j];
    this.alpha[i] = this.alpha[j];
    this.fade[i] = this.fade[j];
    this.life[i] = this.life[j];
    this.sink[i] = this.sink[j];
    this.off[i] = this.off[j];
    this.stuck[i] = this.stuck[j];
    this.q[i] = this.q[j];
    this.qv[i] = this.qv[j];
    this.qa[i] = this.qa[j];
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
    this.looseOwed += DT * (game.phase === 'play' ? 0.4 + 3 * near : game.phase === 'soak' ? 2 : 0.5);
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
      } else {
        const lag = this.line(this.x[i]) + this.off[i] - (this.y[i] + r);
        if (lag > 0) {
          // free bubbles hurry after the front; ones resting on the pile just keep pace,
          // so the mass doesn't crush its bottom layer
          const target = Math.min(1600, fv + (this.held[i] ? Math.min(40, lag) : DRIVE * lag));
          if (this.vy[i] < target) this.vy[i] += (target - this.vy[i]) * 0.14;
        }
        // held back far behind the front by a shelf or a floor: it is deeper in the room
        if (!this.deep[i]) {
          if (lag > DEEP_LAG && this.touch[i]) this.stuck[i] += DT;
          else this.stuck[i] = Math.max(0, this.stuck[i] - DT * 2);
          if (this.stuck[i] > 0.3) this.deep[i] = 1;
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

  /** Keep bubbles apart (and clinging), out of the geometry and the cat, behind the front. */
  private solve(cat: SoftBody, soakT: number): void {
    const n = this.n;
    const { x, y, r, w } = this;
    // neighbour pairs, once per step
    let minY = Infinity;
    for (let i = 0; i < n; i++) if (y[i] < minY) minY = y[i];
    const cols = Math.ceil((SHAFT_W + 120) / CELL);
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) if (y[i] > maxY) maxY = y[i];
    const rows = n > 0 ? Math.min(400, Math.floor((maxY - minY) / CELL) + 1) : 0;
    if (this.head.length < cols * rows) this.head = new Int32Array(cols * rows * 2);
    this.head.fill(-1, 0, cols * rows);
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
            if (j <= i) continue;
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
    this.txy.fill(0, 0, n);
    this.tyy.fill(0, 0, n);
    this.hit.fill(0, 0, n);
    this.touch.fill(0, 0, n);
    this.held.fill(0, 0, n);
    this.nb.fill(0, 0, n);
    // the cat: an obstacle (except while the foam swallows it whole)
    const release = SOAK.hold + 0.05;
    const catSolid = soakT < 0.16 || soakT > release;
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
    // the moment the foam lets go of the cat, most of what is still on it fizzes away
    if (soakT > release && soakT - DT <= release) {
      for (let i = 0; i < this.n; i++) {
        if (x[i] < cx0 || x[i] > cx1 || y[i] < cy0 || y[i] > cy1) continue;
        const c = ringContact(cat, x[i], y[i], 0);
        if (c && c.inside && this.rnd() < 0.85) {
          this.pops.release++;
          this.pop(i--);
        }
      }
      return this.solve(cat, soakT + 1);
    }
    for (let it = 0; it < ITER; it++) {
      const last = it === ITER - 1;
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
            this.txy[i] += ci * nx * ny;
            this.tyy[i] += ci * ny * ny;
            this.txx[j] += cj * nx * nx;
            this.txy[j] += cj * nx * ny;
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
              if (ct.ny < -0.35) this.held[i] = 1;
              if (last) {
                const cs = ct.depth / ri;
                this.txx[i] += cs * ct.nx * ct.nx;
                this.txy[i] += cs * ct.nx * ct.ny;
                this.tyy[i] += cs * ct.ny * ct.ny;
              }
              if (it === 0) {
                // a hard knock sets it wobbling
                const vn = this.vx[i] * ct.nx + this.vy[i] * ct.ny;
                if (vn < -120) this.qv[i] += Math.min(2.2, -vn / 300);
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
              if (vn < -120) this.qv[i] += Math.min(2.2, -vn / 300);
            }
            if (last) {
              const cs = Math.min(1, ct.depth / ri);
              this.txx[i] += cs * ct.nx * ct.nx;
              this.txy[i] += cs * ct.nx * ct.ny;
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

  /** New velocities from the moves; squash springs; pops from squeezes and hits. */
  private settle(phase: string): void {
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
      if (squeezed || (this.hit[i] > 300 && rnd() < 0.6 && phase === 'play')) {
        if (squeezed) this.pops.squeeze++;
        else this.pops.hit++;
        this.pop(i--);
        continue;
      }
      // the shape: flattened by what presses on it, drawn out along a fast fall
      let a = this.txx[i];
      let b = this.txy[i];
      let c = this.tyy[i];
      const sp = Math.sqrt(vx * vx + vy * vy);
      if (sp > 160) {
        const k = Math.min(0.1, (sp - 160) / 4000);
        const ux = -vy / sp;
        const uy = vx / sp;
        a += k * ux * ux;
        b += k * ux * uy;
        c += k * uy * uy;
      }
      const half = (a - c) / 2;
      const aniso = 2 * Math.sqrt(half * half + b * b);
      const target = Math.min(0.13, aniso * 0.45);
      if (target > 0.015) {
        const ang = 0.5 * Math.atan2(2 * b, a - c);
        let dA = ang - this.qa[i];
        while (dA > Math.PI / 2) dA -= Math.PI;
        while (dA < -Math.PI / 2) dA += Math.PI;
        this.qa[i] += dA * Math.min(1, 10 * DT * (0.3 + target * 4));
      }
      // a springy wobble that rings out
      const om = 10 + 34 / Math.sqrt(r);
      this.qv[i] += (om * om * (target - this.q[i]) - 2 * 0.16 * om * this.qv[i]) * DT;
      this.q[i] = Math.max(-0.12, Math.min(0.2, this.q[i] + this.qv[i] * DT));
      this.ph[i] += this.phv[i] * DT;
    }
  }

  /** Keep the region behind the front full: new bubbles come in from above the screen. */
  private replenish(top: number, F: number): void {
    const rnd = this.rnd;
    let mass = 0;
    for (let i = 0; i < this.n; i++) if (!this.loose[i] && this.fade[i] >= 0) mass++;
    const target = Math.min(CAP - 30, Math.round((SHAFT_W * Math.max(0, F - top) * PACK) / MEAN_AREA));
    for (let k = 0; k < 8 && mass < target && this.n < CAP; k++, mass++) {
      const rr = R_MIN + R_SPAN * rnd() ** SKEW;
      const i = this.spawn(rr + rnd() * (SHAFT_W - 2 * rr), top - 30 - rnd() * 50, rr, Math.max(0, this.frontV) + 260, 0);
      if (i < 0) break;
    }
  }

  // --- puffs of bubbles (a sneeze, a sploosh) ---------------------------------------------

  /** Loose bubbles blown out from (x, y): `n` of them, radii r0..r1, moving (vx, vy) give or take `spread`. */
  puff(x: number, y: number, n: number, r0: number, r1: number, vx: number, vy: number, spread: number): void {
    const rnd = this.rnd;
    for (let k = 0; k < n; k++) {
      const i = this.spawn(x + (rnd() - 0.5) * spread * 0.2, y + (rnd() - 0.5) * spread * 0.2, r0 + (r1 - r0) * rnd() ** 1.6, vy + (rnd() - 0.5) * spread, 1, true);
      if (i < 0) return;
      this.vx[i] = vx + (rnd() - 0.5) * spread;
      this.life[i] = 0.8 + rnd() * 1.4;
      this.sink[i] = 20 + rnd() * 40;
    }
  }

  // --- drops -------------------------------------------------------------------------------

  /** A drop falling from (x, y), moving (vx, vy); `fromCat` ones don't splash on the cat they left. */
  drop(x: number, y: number, vx: number, vy: number, fromCat = false): void {
    if (this.dn >= DROPS) return;
    const k = this.dn++;
    this.dx[k] = x;
    this.dy[k] = y;
    this.dvx[k] = vx;
    this.dvy[k] = vy;
    this.ds[k] = 1.1 + this.rnd() * 0.7;
    this.dage[k] = 0;
    this.dcat[k] = fromCat ? 1 : 0;
  }

  private stepDrops(game: DropGame, near: number): void {
    const rnd = this.rnd;
    const phase = game.phase;
    // drizzle: drips off the front bubbles, more as the front nears the cat
    const rate = phase === 'play' ? (near > 0 ? 3 + 36 * near * near : 0) : phase === 'soak' ? 30 : phase === 'over' ? 6 : 0;
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
    // drips off a soaked cat
    const cat = game.cat;
    if (game.soaked && game.soakT > 0.95) {
      this.catDripOwed += 5 * DT;
      while (this.catDripOwed >= 1) {
        this.catDripOwed--;
        const p = underside(cat, rnd());
        this.drop(p.x, p.y + 2, (rnd() - 0.5) * 10, 20 + rnd() * 30, true);
      }
    }
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
        } else if (!this.dcat[k] && x > cx0 - 2 && x < cx1 + 2 && y > cy0 - 2 && y < cy1 + 2) {
          const ct = ringContact(cat, x, y, SKIN + this.ds[k]);
          if (ct) {
            this.splash(x + ct.nx * ct.depth, y + ct.ny * ct.depth, ct.nx, ct.ny, this.dvx[k], this.dvy[k]);
            gone = true;
          }
        } else if (this.dcat[k] && (y > cy1 + 4 || x < cx0 - 4 || x > cx1 + 4)) this.dcat[k] = 0;
      }
      if (gone) {
        const j = --this.dn;
        this.dx[k] = this.dx[j];
        this.dy[k] = this.dy[j];
        this.dvx[k] = this.dvx[j];
        this.dvy[k] = this.dvy[j];
        this.ds[k] = this.ds[j];
        this.dage[k] = this.dage[j];
        this.dcat[k] = this.dcat[j];
        k--;
      }
    }
  }

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
        if (ct) return { x: x + ct.nx * ct.depth, y: y + ct.ny * ct.depth, nx: ct.nx, ny: ct.ny };
      }
    }
    return null;
  }

  /** A drop hits something: a few tiny droplets jump off it. */
  private splash(x: number, y: number, nx: number, ny: number, vx: number, vy: number): void {
    const rnd = this.rnd;
    if (!this.visible(x, y, 10)) return;
    const sp = Math.min(1, Math.sqrt(vx * vx + vy * vy) / 700);
    const m = 2 + Math.round(rnd() * 2 + sp * 2);
    const tx = -ny;
    const ty = nx;
    for (let s = 0; s < m; s++) {
      const out = (50 + rnd() * 90) * (0.5 + sp);
      const side = (rnd() - 0.5) * 2 * (60 + rnd() * 80) * (0.5 + sp);
      this.addSpray(x, y, nx * out + tx * side, ny * out + ty * side, 0.25 + rnd() * 0.2, 0.7 + rnd() * 0.6);
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
    for (let k = 0; k < this.sn; k++) {
      this.svy[k] += 1100 * DT;
      this.sx[k] += this.svx[k] * DT;
      this.sy[k] += this.svy[k] * DT;
      this.sa[k] += DT;
      if (this.sa[k] >= this.sl[k]) {
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

/** A point on the cat's underside, `u` 0..1 from left to right. */
function underside(b: SoftBody, u: number): { x: number; y: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  for (let i = 0; i < b.n; i++) {
    if (b.x[i] < x0) x0 = b.x[i];
    if (b.x[i] > x1) x1 = b.x[i];
  }
  const x = x0 + (x1 - x0) * (0.2 + 0.6 * u);
  let y = -Infinity;
  for (let i = 0, j = b.n - 1; i < b.n; j = i++) {
    const xa = b.x[j];
    const xb = b.x[i];
    if ((xa - x) * (xb - x) > 0 || xa === xb) continue;
    const yy = b.y[j] + ((b.y[i] - b.y[j]) * (x - xa)) / (xb - xa);
    if (yy > y) y = yy;
  }
  return { x, y: (y === -Infinity ? b.y[0] : y) + SKIN };
}
