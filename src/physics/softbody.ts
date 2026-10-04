// A cat is a ring of nodes held together by soft edges, an area ("pressure")
// constraint, shape matching toward a rest shape (circle -> loaf), and a little
// surface tension. Viscosity damps deformation, never rigid motion, so a honey
// Persian falls as fast as a water kitten but oozes much more slowly.

import { BREEDS, type Breed, type BreedId, type BreedPhysics } from './breeds';
import { dcos, dsin, polygonArea, TAU } from '../util/math';

export const NODE_RADIUS = 2.5;
/** Angular damping per second while touching something. */
const ROLL_DAMP = 4;
/** Rest damping (see finishSubstep). */
const REST_SPEED2 = 10 * 10;
const REST_VISC = 30;
const REST_LINEAR = 6;
const REST_SPIN = 20;

export interface Grab {
  /** Pointer target in world space. */
  tx: number;
  ty: number;
  /** Pointer velocity (world units / s), used to damp toward. */
  tvx: number;
  tvy: number;
  count: number;
  nodes: Int32Array;
  weights: Float64Array;
  offX: Float64Array;
  offY: Float64Array;
  weightSum: number;
  /** Max force the finger may apply (mass * units / s^2). */
  force: number;
  /** Max upward share of that force (0..1); cats are lazy about being lifted. */
  lift: number;
  /** Touch point relative to the centroid at grab time (the cat hangs from here). */
  ax: number;
  ay: number;
}

/** Share of the finger's force that moves the whole cat (the rest stretches it). */
const BODY_SHARE = 0.65;

let nextBodyId = 1;

export class SoftBody {
  /** How much of a collision push-out may turn into bounce (0 = all, 1 = none). */
  static contactBounceKill = 0.85;
  /** Damping of the finger's whole-body spring: high, so a lifted cat eases
   *  up to the finger instead of bobbing like a yo-yo. */
  static grabDamp = 0.6;
  readonly id: number;
  readonly breed: Breed;
  readonly p: BreedPhysics;
  readonly n: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  /** Rest shape currently used by shape matching (centroid-relative). */
  readonly qx: Float64Array;
  readonly qy: Float64Array;
  /** Round and loaf reference shapes. */
  readonly roundX: Float64Array;
  readonly roundY: Float64Array;
  readonly loafX: Float64Array;
  readonly loafY: Float64Array;
  /** Contact info from the last substep, per node. -1 = no contact. */
  readonly contactShape: Int32Array;
  readonly contactNx: Float32Array;
  readonly contactNy: Float32Array;
  readonly restLen: number;
  readonly area0: number;
  readonly mass: number;
  readonly nodeMass: number;
  readonly invNodeMass: number;

  // Derived each substep
  cx = 0;
  cy = 0;
  vcx = 0;
  vcy = 0;
  rotC = 1;
  rotS = 0;
  area = 0;

  grab: Grab | null = null;
  /** 0 = round, 1 = loaf. Driven by the game layer. */
  loafiness = 0;
  /** 0..1, how much rest shape creeps toward the current shape (sitting). */
  plastic = 0;
  /** Multiplier on shape stiffness (game layer can relax a cat into a cup). */
  shapeMul = 1;
  /** Extra downward acceleration (units/s^2) for nodes inside a container opening. */
  settleForce = 0;
  settleX0 = 0;
  settleX1 = 0;
  settleY = 0;
  /** Set while the cat is pouring into something: no rest damping. */
  pouring = false;
  /** Set while the cat is seated (or perched on top): it loafs (always calm). */
  sitting = false;
  /** Kinetic energy per unit mass; used for "settled" detection. */
  energy = 0;
  /** Smoothed centroid velocity and whether the body is resting. */
  emaVx = 0;
  emaVy = 0;
  /** Energy smoothed over ~10 frames (what a viewer perceives as motion). */
  emaEnergy = 0;
  calm = false;
  /**
   * Asleep: resting so still that it is frozen (no solving, no micro-jitter)
   * until something disturbs it: a finger, a boop, a game force, a moving cat
   * bumping into it, or the furniture changing.
   */
  asleep = false;
  /** Multiplier on friction against furniture (the game eases cats off rims). */
  frictionMul = 1;
  private stillFrames = 0;
  private readonly refX: Float64Array;
  private readonly refY: Float64Array;
  /** Frames since the body last had any contact with anything. */
  airborneFrames = 0;
  /** Largest impact speed against a static shape this frame, and which. */
  impactSpeed = 0;
  impactShape = -1;

  constructor(breedId: BreedId, cx: number, cy: number) {
    this.id = nextBodyId++;
    this.breed = BREEDS[breedId];
    this.p = this.breed.physics;
    const n = (this.n = this.p.nodes);
    const r = this.p.radius;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.qx = new Float64Array(n);
    this.qy = new Float64Array(n);
    this.roundX = new Float64Array(n);
    this.roundY = new Float64Array(n);
    this.loafX = new Float64Array(n);
    this.loafY = new Float64Array(n);
    this.contactShape = new Int32Array(n).fill(-1);
    this.refX = new Float64Array(n);
    this.refY = new Float64Array(n);
    this.contactNx = new Float32Array(n);
    this.contactNy = new Float32Array(n);

    // Round rest shape (slightly squat so idle cats look relaxed)
    const sx = 1.04;
    const sy = 1 / sx;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      this.roundX[i] = r * sx * dcos(t);
      this.roundY[i] = r * sy * dsin(t);
    }
    buildLoaf(this.loafX, this.loafY, n, r, this.p.loafAspect);
    normalizeShape(this.roundX, this.roundY, n, Math.PI * r * r);
    normalizeShape(this.loafX, this.loafY, n, Math.PI * r * r);
    this.qx.set(this.roundX);
    this.qy.set(this.roundY);

    for (let i = 0; i < n; i++) {
      this.x[i] = this.px[i] = cx + this.roundX[i];
      this.y[i] = this.py[i] = cy + this.roundY[i];
    }
    this.area0 = polygonArea(this.roundX, this.roundY, n);
    // Edge rest length: perimeter of the round shape / n
    let per = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = this.roundX[j] - this.roundX[i];
      const dy = this.roundY[j] - this.roundY[i];
      per += Math.sqrt(dx * dx + dy * dy);
    }
    this.restLen = per / n;
    this.mass = (this.p.density * this.area0) / 1000;
    this.nodeMass = this.mass / n;
    this.invNodeMass = 1 / this.nodeMass;
    this.computeCentroid();
    this.area = this.area0;
  }

  computeCentroid(): void {
    let sx = 0;
    let sy = 0;
    let svx = 0;
    let svy = 0;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      sx += this.x[i];
      sy += this.y[i];
      svx += this.vx[i];
      svy += this.vy[i];
    }
    this.cx = sx / n;
    this.cy = sy / n;
    this.vcx = svx / n;
    this.vcy = svy / n;
  }

  /** Bounding box of node positions (no skin). */
  bounds(out: { minX: number; minY: number; maxX: number; maxY: number }): typeof out {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const x = this.x[i];
      const y = this.y[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    out.minX = minX;
    out.minY = minY;
    out.maxX = maxX;
    out.maxY = maxY;
    return out;
  }

  wake(): void {
    this.asleep = false;
    this.stillFrames = 0;
  }

  private sleep(): void {
    this.asleep = true;
    for (let i = 0; i < this.n; i++) {
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.vx[i] = 0;
      this.vy[i] = 0;
    }
    this.energy = 0;
    this.emaVx = 0;
    this.emaVy = 0;
    this.vcx = 0;
    this.vcy = 0;
  }

  /** Teleport the whole body so its centroid is at (x, y), killing velocity. */
  placeAt(x: number, y: number): void {
    this.wake();
    this.computeCentroid();
    const dx = x - this.cx;
    const dy = y - this.cy;
    for (let i = 0; i < this.n; i++) {
      this.x[i] += dx;
      this.y[i] += dy;
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.vx[i] = 0;
      this.vy[i] = 0;
    }
    this.computeCentroid();
  }

  /** Add a velocity to every node (boops and hops). */
  kick(dvx: number, dvy: number): void {
    this.wake();
    for (let i = 0; i < this.n; i++) {
      this.vx[i] += dvx;
      this.vy[i] += dvy;
    }
  }

  /** Nearest node index to a point. */
  nearestNode(wx: number, wy: number): number {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[i] - wx;
      const dy = this.y[i] - wy;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * Start a finger grab at (wx, wy). The half of the body nearest the finger
   * is pulled; the rest lags behind, which is what makes cats stretch.
   */
  startGrab(wx: number, wy: number, force: number, lift: number): Grab {
    this.wake();
    const n = this.n;
    const r = this.p.radius;
    const reach = r * 1.05;
    const nodes = new Int32Array(n);
    const weights = new Float64Array(n);
    const offX = new Float64Array(n);
    const offY = new Float64Array(n);
    // Anchor point: clamp the touch to inside the body so off-edge touches work.
    let count = 0;
    let wsum = 0;
    for (let i = 0; i < n; i++) {
      const dx = this.x[i] - wx;
      const dy = this.y[i] - wy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < reach) {
        const w = 1 - d / reach;
        const ww = w * w * (3 - 2 * w);
        nodes[count] = i;
        weights[count] = 0.25 + 0.75 * ww;
        offX[count] = dx * 0.55;
        offY[count] = dy * 0.55;
        wsum += weights[count];
        count++;
      }
    }
    if (count < 3) {
      // Touch was far from the ring (centre of a big cat): grab the 5 nearest.
      count = 0;
      wsum = 0;
      const order = Array.from({ length: n }, (_, i) => i);
      order.sort((a, b) => {
        const da = (this.x[a] - wx) ** 2 + (this.y[a] - wy) ** 2;
        const db = (this.x[b] - wx) ** 2 + (this.y[b] - wy) ** 2;
        return da - db;
      });
      for (let k = 0; k < Math.min(7, n); k++) {
        const i = order[k];
        nodes[count] = i;
        weights[count] = 1 - k / 9;
        offX[count] = (this.x[i] - wx) * 0.55;
        offY[count] = (this.y[i] - wy) * 0.55;
        wsum += weights[count];
        count++;
      }
    }
    this.computeCentroid();
    this.grab = {
      tx: wx,
      ty: wy,
      tvx: 0,
      tvy: 0,
      count,
      nodes,
      weights,
      offX,
      offY,
      weightSum: wsum,
      force,
      lift,
      ax: (wx - this.cx) * 0.6,
      ay: (wy - this.cy) * 0.6,
    };
    return this.grab;
  }

  releaseGrab(): void {
    this.grab = null;
  }

  // --- Simulation pieces (called by World) ---------------------------------

  integrate(h: number, g: number): void {
    const n = this.n;
    const sf = this.settleForce;
    const sx0 = this.settleX0;
    const sx1 = this.settleX1;
    const sy = this.settleY;
    for (let i = 0; i < n; i++) {
      // The part already inside a container is gently drawn down ("glorp"):
      // a ring body has no hydrostatic pressure, so we add it where it counts.
      const extra = sf > 0 && this.y[i] > sy && this.x[i] > sx0 && this.x[i] < sx1 ? sf : 0;
      this.vy[i] += (g + extra) * h;
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.x[i] += this.vx[i] * h;
      this.y[i] += this.vy[i] * h;
    }
  }

  solveInternal(h: number, first = true): void {
    this.solveEdges(h);
    this.solveArea();
    this.solveShape();
    if (this.grab && first) this.solveGrab(h);
    // Once a substep is plenty: folding through takes many substeps.
    if (first) this.solveSelf();
  }

  /**
   * The skin can't pass through itself. Squeezed hard (a neck pinched over a
   * rim while a finger pulls, a cat pressed into a wall) the ring could
   * otherwise fold through itself into a figure 8, with a wall running
   * through the middle of the cat, or crease into a hairpin. Every node keeps
   * a skin's width from the stretches of ring two or more nodes away.
   */
  private solveSelf(): void {
    const { n, x, y } = this;
    const skin = NODE_RADIUS * 2;
    const skin2 = skin * skin;
    // Each edge's box, grown by a skin, rules out almost every pair cheaply.
    const x0 = scratchA(n);
    const x1 = scratchB(n);
    const y0 = scratchC(n);
    const y1 = scratchD(n);
    for (let j = 0; j < n; j++) {
      const k = j + 1 === n ? 0 : j + 1;
      const ax = x[j];
      const bx = x[k];
      const ay = y[j];
      const by = y[k];
      x0[j] = (ax < bx ? ax : bx) - skin;
      x1[j] = (ax < bx ? bx : ax) + skin;
      y0[j] = (ay < by ? ay : by) - skin;
      y1[j] = (ay < by ? by : ay) + skin;
    }
    for (let i = 0; i < n; i++) {
      for (let s = 2; s <= n - 3; s++) {
        const j = i + s >= n ? i + s - n : i + s;
        const xi = x[i];
        const yi = y[i];
        if (xi < x0[j] || xi > x1[j] || yi < y0[j] || yi > y1[j]) continue;
        const k = j + 1 === n ? 0 : j + 1;
        const ax = x[j];
        const ay = y[j];
        const dx = xi - ax;
        const dy = yi - ay;
        const ex = x[k] - ax;
        const ey = y[k] - ay;
        const l2 = ex * ex + ey * ey;
        let t = l2 > 1e-12 ? (dx * ex + dy * ey) / l2 : 0;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const qx = dx - ex * t;
        const qy = dy - ey * t;
        const d2 = qx * qx + qy * qy;
        if (d2 >= skin2 || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const wa = 1 - t;
        const wb = t;
        const lam = (skin - d) / (d * (1 + wa * wa + wb * wb));
        x[i] += qx * lam;
        y[i] += qy * lam;
        x[j] -= qx * lam * wa;
        y[j] -= qy * lam * wa;
        x[k] -= qx * lam * wb;
        y[k] -= qy * lam * wb;
      }
    }
  }


  /**
   * The skin behaves like a liquid surface: a constant tension pulls every edge
   * shorter (Laplace pressure), edges are evened out toward the mean spacing
   * (so the surface may grow freely when a cat pours), and hard limits keep
   * node spacing sane.
   */
  private solveEdges(h: number): void {
    const { n, x, y } = this;
    const lens = scratchA(n);
    let per = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const l = Math.sqrt(dx * dx + dy * dy);
      lens[i] = l;
      per += l;
    }
    const mean = per / n;
    const eq = this.p.equalize;
    const tensionStep = 2 * this.p.tension * h * h * this.invNodeMass;
    const minL = this.restLen * 0.4;
    const maxL = this.restLen * this.p.maxStretch;
    for (let i = 0; i < n; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-9) continue;
      let target = len - eq * (len - mean) - tensionStep;
      if (target < minL) target = minL;
      else if (target > maxL) target = maxL;
      const corr = (0.5 * (len - target)) / len;
      x[i] += dx * corr;
      y[i] += dy * corr;
      x[j] -= dx * corr;
      y[j] -= dy * corr;
    }
  }

  private solveArea(): void {
    const { n, x, y } = this;
    const a = polygonArea(x, y, n);
    this.area = a;
    let k = this.p.pressure;
    // Fluffy cats compress cheaply down to (1 - squish) of their rest area.
    if (this.p.squish > 0 && a < this.area0 && a > this.area0 * (1 - this.p.squish)) k *= 0.08;
    const c = a - this.area0;
    if (c > -1e-6 && c < 1e-6) return;
    const gxs = scratchA(n);
    const gys = scratchB(n);
    let denom = 0;
    for (let i = 0; i < n; i++) {
      const ip = i + 1 === n ? 0 : i + 1;
      const im = i === 0 ? n - 1 : i - 1;
      const gx = 0.5 * (y[ip] - y[im]);
      const gy = 0.5 * (x[im] - x[ip]);
      gxs[i] = gx;
      gys[i] = gy;
      denom += gx * gx + gy * gy;
    }
    if (denom < 1e-9) return;
    const lambda = (-c / denom) * k;
    for (let i = 0; i < n; i++) {
      x[i] += lambda * gxs[i];
      y[i] += lambda * gys[i];
    }
  }

  private solveShape(): void {
    const k = this.p.shape * this.shapeMul;
    const { n, x, y, qx, qy } = this;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      cx += x[i];
      cy += y[i];
    }
    cx /= n;
    cy /= n;
    let a00 = 0;
    let a01 = 0;
    let a10 = 0;
    let a11 = 0;
    for (let i = 0; i < n; i++) {
      const px = x[i] - cx;
      const py = y[i] - cy;
      a00 += px * qx[i];
      a01 += px * qy[i];
      a10 += py * qx[i];
      a11 += py * qy[i];
    }
    let c = a00 + a11;
    let s = a10 - a01;
    let l = Math.sqrt(c * c + s * s);
    if (l < 1e-9) {
      c = 1;
      s = 0;
      l = 1;
    }
    c /= l;
    s /= l;
    this.rotC = c;
    this.rotS = s;
    this.cx = cx;
    this.cy = cy;
    if (k <= 0) return;
    // Upright bias: aim the goal frame partly back toward "no rotation".
    const u = this.p.upright;
    let gc = c + (1 - c) * u;
    let gs = s * (1 - u) + (c < -0.9 ? 0.02 * u : 0);
    const gl = Math.sqrt(gc * gc + gs * gs);
    gc /= gl;
    gs /= gl;
    for (let i = 0; i < n; i++) {
      const gx = cx + gc * qx[i] - gs * qy[i];
      const gy = cy + gs * qx[i] + gc * qy[i];
      x[i] += (gx - x[i]) * k;
      y[i] += (gy - y[i]) * k;
    }
  }

  private solveGrab(h: number): void {
    const g = this.grab!;
    const { n, x, y, px, py } = this;
    const h2 = h * h;
    const inv = 1 / h;
    // 1) Whole-body spring: the centroid follows the finger (minus the touch
    //    offset), with a capped force, so even a chonk can be scooted along.
    let cx = 0;
    let cy = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < n; i++) {
      cx += x[i];
      cy += y[i];
      vx += x[i] - px[i];
      vy += y[i] - py[i];
    }
    cx /= n;
    cy /= n;
    vx *= inv / n;
    vy *= inv / n;
    const bodyMax = (g.force * BODY_SHARE * h2) / this.mass;
    const kd = SoftBody.grabDamp;
    let bx = (g.tx - g.ax - cx) * 0.012 + (g.tvx - vx) * h * kd;
    let by = (g.ty - g.ay - cy) * 0.012 + (g.tvy - vy) * h * kd;
    if (by < 0 && -by > bodyMax * g.lift) by = -bodyMax * g.lift;
    const bl = Math.sqrt(bx * bx + by * by);
    if (bl > bodyMax) {
      bx *= bodyMax / bl;
      by *= bodyMax / bl;
    }
    for (let i = 0; i < n; i++) {
      x[i] += bx;
      y[i] += by;
    }
    // 2) Local spring on the touched nodes: this is what makes cats stretch
    //    toward your finger.
    const k = 0.05;
    const c = 0.06;
    const localForce = g.force * (1 - BODY_SHARE);
    for (let m = 0; m < g.count; m++) {
      const i = g.nodes[m];
      const w = g.weights[m];
      const tx = g.tx + g.offX[m];
      const ty = g.ty + g.offY[m];
      const nvx = (x[i] - px[i]) * inv;
      const nvy = (y[i] - py[i]) * inv;
      let dx = ((tx - x[i]) * k + (g.tvx - nvx) * h * c) * w;
      let dy = ((ty - y[i]) * k + (g.tvy - nvy) * h * c) * w;
      const share = (localForce * w) / g.weightSum;
      const maxStep = share * h2 * this.invNodeMass;
      if (dy < 0) {
        // Cats are lazy about being lifted.
        const maxUp = maxStep * g.lift;
        if (-dy > maxUp) dy = -maxUp;
      }
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > maxStep) {
        dx *= maxStep / len;
        dy *= maxStep / len;
      }
      x[i] += dx;
      y[i] += dy;
    }
  }

  /** Uniform horizontal acceleration (units/s^2) set by the game ("if it fits, I sits"). */
  assistAx = 0;

  applyAssist(h: number): void {
    if (this.assistAx === 0) return;
    const step = this.assistAx * h * h;
    const { n, x } = this;
    for (let i = 0; i < n; i++) x[i] += step;
  }

  /** After constraints: derive velocities and apply viscosity. */
  finishSubstep(h: number): void {
    const { n, x, y, px, py, vx, vy } = this;
    const inv = 1 / h;
    let cx = 0;
    let cy = 0;
    let mvx = 0;
    let mvy = 0;
    for (let i = 0; i < n; i++) {
      vx[i] = (x[i] - px[i]) * inv;
      vy[i] = (y[i] - py[i]) * inv;
      cx += x[i];
      cy += y[i];
      mvx += vx[i];
      mvy += vy[i];
    }
    const kill = SoftBody.contactBounceKill * (1 - this.p.shape * 20);
    for (let i = 0; i < n; i++) {
      if (this.contactShape[i] !== -1) {
        // The push-out from a collision shouldn't become a bounce (chatter).
        const nx = this.contactNx[i];
        const ny = this.contactNy[i];
        const vn = vx[i] * nx + vy[i] * ny;
        if (vn > 0) {
          vx[i] -= nx * vn * kill;
          vy[i] -= ny * vn * kill;
        }
      }
    }
    cx /= n;
    cy /= n;
    // Recompute the mean after smoothing / contact damping changed velocities.
    mvx = 0;
    mvy = 0;
    for (let i = 0; i < n; i++) {
      mvx += vx[i];
      mvy += vy[i];
    }
    mvx /= n;
    mvy /= n;
    // Angular velocity of the best-fit rigid motion
    let L = 0;
    let I = 0;
    for (let i = 0; i < n; i++) {
      const rx = x[i] - cx;
      const ry = y[i] - cy;
      L += rx * (vy[i] - mvy) - ry * (vx[i] - mvx);
      I += rx * rx + ry * ry;
    }
    const w = I > 1e-9 ? L / I : 0;
    // Rolling resistance: cats don't roll like balls, they scoot.
    let contacts = 0;
    for (let i = 0; i < n; i++) if (this.contactShape[i] !== -1) contacts++;
    const roll = contacts > 0 ? Math.min(1, ROLL_DAMP * h) : Math.min(1, 0.6 * h);
    const wKeep = w * (1 - roll);
    // Rest damping: once a cat's averaged motion is ~zero while touching
    // something, it loafs instead of wobbling forever.
    const a = h / 0.2;
    this.emaVx += (mvx - this.emaVx) * a;
    this.emaVy += (mvy - this.emaVy) * a;
    const calm = contacts > 0 && !this.grab && (this.sitting || (!this.pouring && this.emaVx * this.emaVx + this.emaVy * this.emaVy < REST_SPEED2));
    this.calm = calm;
    const lin = calm ? 1 - Math.min(1, REST_LINEAR * h) : 1;
    // Resting cats don't slowly churn in place either.
    const wRest = calm ? wKeep * (1 - Math.min(1, REST_SPIN * h)) : wKeep;
    const nmx = mvx * lin;
    const nmy = mvy * lin;
    const visc = (this.p.viscosity + (calm ? REST_VISC : 0)) * h;
    const keep = visc >= 1 ? 0 : 1 - visc;
    const air = 1 - 0.08 * h;
    let e = 0;
    for (let i = 0; i < n; i++) {
      const rx = x[i] - cx;
      const ry = y[i] - cy;
      const rvx = mvx - w * ry;
      const rvy = mvy + w * rx;
      // deformation part damped by viscosity; rigid rotation by rolling resistance
      let nvx = (nmx - wRest * ry + (vx[i] - rvx) * keep) * air * lin;
      let nvy = (nmy + wRest * rx + (vy[i] - rvy) * keep) * air * lin;
      // Speed limit keeps everything gentle (and stable).
      const sp2 = nvx * nvx + nvy * nvy;
      if (sp2 > 1400 * 1400) {
        const s = 1400 / Math.sqrt(sp2);
        nvx *= s;
        nvy *= s;
      }
      vx[i] = nvx;
      vy[i] = nvy;
      e += nvx * nvx + nvy * nvy;
    }
    this.cx = cx;
    this.cy = cy;
    this.vcx = nmx;
    this.vcy = nmy;
    this.energy = e / n;
  }

  /** Called once per frame by the world (not per substep). */
  frameUpdate(dt: number): void {
    this.emaEnergy += (this.energy - this.emaEnergy) * 0.15;
    if (!this.asleep) this.considerSleep();
    // Rest shape: blend round <-> loaf, plus plastic creep toward current shape.
    const n = this.n;
    const lf = this.loafiness;
    const relax = Math.min(1, dt * 3);
    const plasticRate = Math.min(1, this.p.plasticity * this.plastic * dt);
    const c = this.rotC;
    const s = this.rotS;
    for (let i = 0; i < n; i++) {
      const tx = this.roundX[i] + (this.loafX[i] - this.roundX[i]) * lf;
      const ty = this.roundY[i] + (this.loafY[i] - this.roundY[i]) * lf;
      let qx = this.qx[i] + (tx - this.qx[i]) * relax * (1 - this.plastic);
      let qy = this.qy[i] + (ty - this.qy[i]) * relax * (1 - this.plastic);
      if (plasticRate > 0) {
        // Current shape in the body frame: R^T (x - c)
        const dx = this.x[i] - this.cx;
        const dy = this.y[i] - this.cy;
        const lx = c * dx + s * dy;
        const ly = -s * dx + c * dy;
        qx += (lx - qx) * plasticRate;
        qy += (ly - qy) * plasticRate;
      }
      this.qx[i] = qx;
      this.qy[i] = qy;
    }
    normalizeShape(this.qx, this.qy, n, this.area0);
  }

  /**
   * Fall asleep after resting truly still for ~2/3 s: touching something,
   * nothing pulling on it, the centre not drifting, and no node creeping more
   * than half a unit (a seated cat: 1.2) in each of two 20-frame windows (a
   * slow ooze keeps it awake; invisible solver chatter in a tight cup does not).
   */
  private considerSleep(): void {
    const n = this.n;
    let contacts = false;
    for (let i = 0; i < n; i++)
      if (this.contactShape[i] !== -1) {
        contacts = true;
        break;
      }
    const quiet =
      contacts &&
      !this.grab &&
      this.settleForce === 0 &&
      this.assistAx > -40 &&
      this.assistAx < 40 &&
      this.emaVx * this.emaVx + this.emaVy * this.emaVy < (this.sitting ? 2.5 * 2.5 : 1.5 * 1.5);
    if (!quiet) {
      this.stillFrames = 0;
      return;
    }
    if (this.stillFrames === 0) {
      this.refX.set(this.x);
      this.refY.set(this.y);
    }
    this.stillFrames++;
    if (this.stillFrames % 20 !== 0) return;
    let drift = 0;
    for (let i = 0; i < n; i++) {
      const dx = this.x[i] - this.refX[i];
      const dy = this.y[i] - this.refY[i];
      const d2 = dx * dx + dy * dy;
      if (d2 > drift) drift = d2;
    }
    // a seated cat may doze off while still creeping a hair (it should stay put)
    const lim = this.sitting ? 1.2 : 0.5;
    if (drift > lim * lim) {
      this.stillFrames = 0;
      return;
    }
    if (this.stillFrames >= 40) this.sleep();
    else {
      this.refX.set(this.x);
      this.refY.set(this.y);
    }
  }

  /** Copy the full dynamic state (for undo snapshots). */
  snapshot(): BodySnapshot {
    return {
      x: this.x.slice(),
      y: this.y.slice(),
      vx: this.vx.slice(),
      vy: this.vy.slice(),
      qx: this.qx.slice(),
      qy: this.qy.slice(),
      loafiness: this.loafiness,
      plastic: this.plastic,
      contactShape: this.contactShape.slice(),
      contactNx: this.contactNx.slice(),
      contactNy: this.contactNy.slice(),
      ema: [this.emaVx, this.emaVy, this.emaEnergy, this.energy, this.airborneFrames],
      sleep: { asleep: this.asleep, still: this.stillFrames, refX: this.refX.slice(), refY: this.refY.slice() },
    };
  }

  restore(s: BodySnapshot): void {
    this.x.set(s.x);
    this.y.set(s.y);
    this.px.set(s.x);
    this.py.set(s.y);
    this.vx.set(s.vx);
    this.vy.set(s.vy);
    this.qx.set(s.qx);
    this.qy.set(s.qy);
    this.loafiness = s.loafiness;
    this.plastic = s.plastic;
    this.contactShape.set(s.contactShape);
    this.contactNx.set(s.contactNx);
    this.contactNy.set(s.contactNy);
    [this.emaVx, this.emaVy, this.emaEnergy, this.energy, this.airborneFrames] = s.ema;
    this.asleep = s.sleep.asleep;
    this.stillFrames = s.sleep.still;
    this.refX.set(s.sleep.refX);
    this.refY.set(s.sleep.refY);
    this.frictionMul = 1;
    this.grab = null;
    this.assistAx = 0;
    this.settleForce = 0;
    this.computeCentroid();
  }
}

export interface BodySnapshot {
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  qx: Float64Array;
  qy: Float64Array;
  loafiness: number;
  plastic: number;
  contactShape: Int32Array;
  contactNx: Float32Array;
  contactNy: Float32Array;
  ema: [number, number, number, number, number];
  sleep: { asleep: boolean; still: number; refX: Float64Array; refY: Float64Array };
}

/** Centre a shape on its centroid and scale it to the given area. */
export function normalizeShape(xs: Float64Array, ys: Float64Array, n: number, area: number): void {
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += xs[i];
    cy += ys[i];
  }
  cx /= n;
  cy /= n;
  for (let i = 0; i < n; i++) {
    xs[i] -= cx;
    ys[i] -= cy;
  }
  const a = polygonArea(xs, ys, n);
  if (a > 1e-6) {
    const s = Math.sqrt(area / a);
    for (let i = 0; i < n; i++) {
      xs[i] *= s;
      ys[i] *= s;
    }
  }
}

/** A cat loaf: flat bottom, domed top, rounded corners. */
function buildLoaf(xs: Float64Array, ys: Float64Array, n: number, r: number, aspect: number): void {
  // Sample a rounded-rectangle-ish superellipse with a flatter bottom.
  const a = r * Math.sqrt(aspect);
  const b = r / Math.sqrt(aspect);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    const c = dcos(t);
    const s = dsin(t);
    // exponent ~3 superellipse: |c|^(2/3)
    const ec = Math.sign(c) * cbrt(c * c);
    const es = Math.sign(s) * cbrt(s * s);
    // bottom (s > 0 in y-down) flatter than the top
    const bottom = s > 0 ? 1 : 0;
    const sy = bottom ? es : s * 0.55 + es * 0.45;
    xs[i] = a * ec;
    ys[i] = b * sy;
  }
}

function cbrt(v: number): number {
  if (v <= 0) return 0;
  let y = v < 1 ? 1 : v;
  for (let i = 0; i < 80; i++) {
    const ny = (2 * y + v / (y * y)) / 3;
    if (ny >= y) break;
    y = ny;
  }
  return y;
}

// Scratch buffers shared by all bodies (single-threaded).
let scratchBufA = new Float64Array(64);
let scratchBufB = new Float64Array(64);
function scratchA(n: number): Float64Array {
  if (scratchBufA.length < n) scratchBufA = new Float64Array(n * 2);
  return scratchBufA;
}
function scratchB(n: number): Float64Array {
  if (scratchBufB.length < n) scratchBufB = new Float64Array(n * 2);
  return scratchBufB;
}
let scratchBufC = new Float64Array(64);
let scratchBufD = new Float64Array(64);
function scratchC(n: number): Float64Array {
  if (scratchBufC.length < n) scratchBufC = new Float64Array(n * 2);
  return scratchBufC;
}
function scratchD(n: number): Float64Array {
  if (scratchBufD.length < n) scratchBufD = new Float64Array(n * 2);
  return scratchBufD;
}
