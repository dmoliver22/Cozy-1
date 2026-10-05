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

/**
 * A finger holding a cat by the scruff: a pinch of skin near the touch (never
 * the tummy) goes wherever the finger goes, and the rest of the cat hangs from
 * it, stretching under its own weight and swinging as it's carried.
 */
export interface Grab {
  /** The finger, in world space. */
  tx: number;
  ty: number;
  /** The finger's velocity (world units / s). */
  tvx: number;
  tvy: number;
  /**
   * The hand this substep: it moves from where it was at the start of the
   * frame to the finger in even steps across the frame's substeps (the world
   * sets it), so the pinch moves smoothly, not in one jump per frame.
   */
  hx: number;
  hy: number;
  fromX: number;
  fromY: number;
  /** The pinched nodes, how firmly each is held, and where each is held relative to the hand. */
  count: number;
  nodes: Int32Array;
  weights: Float64Array;
  offX: Float64Array;
  offY: Float64Array;
  /** The middle of the pinch relative to the hand: the skin bunches up toward it. */
  midX: number;
  midY: number;
  /**
   * Lowest the pinch's middle may go while the cat still stands on something
   * (a finger pushing down slides a cat off its shelf, it doesn't squash it in).
   */
  low: number;
  /** Substeps since the grab began (the pinch tightens over the first few). */
  age: number;
  /** Touch point relative to the centroid at grab time. */
  ax: number;
  ay: number;
}

/** Nodes either side of the middle one in the pinch. */
const PINCH_HALF = 2;
/** How much the pinched skin bunches together (share of its spread). */
const PINCH = 0.3;
/** Substeps the pinch takes to tighten (~0.1 s). */
const PINCH_SUBSTEPS = 48;
/**
 * Furthest a pinched node moves toward the hand in one constraint pass: less
 * than the half thickness of the thinnest glass, so a cat held against a wall
 * slides along it instead of being pulled through, however far the finger goes.
 */
const PIN_STEP = 3;
/** The same, while the skin around the pinch is pressed against something. */
const PIN_STEP_PRESSED = 0.6;
/** Substeps the skin where a pinch let go stays guarded against creasing (~1/4 s). */
const LET_GO_SUBSTEPS = 120;
/** Damping of a held cat's swing and wobble, relative to the pinch (per second). */
const SWING_DAMP = 2.6;
/**
 * Shape stiffness toward the dangling shape while held: every breed goes long
 * in the hand, even the ones with no shape of their own (honey and pudding
 * just get there slowly, through their viscosity).
 */
const HANG_SHAPE = 0.02;
/** How strongly a held cat's body drifts sideways to hang under the pinch (per substep), and its cap (units). */
const FOLLOW = 0.02;
const FOLLOW_MAX = 0.6;
/** How fast a picked-up cat goes long, and comes back round once let go (per second). */
const HANG_IN = 5;
const HANG_OUT = 3;

let nextBodyId = 1;

export class SoftBody {
  /** How much of a collision push-out may turn into bounce (0 = all, 1 = none). */
  static contactBounceKill = 0.85;
  /**
   * Let resting on another cat count as contact for rest damping, sleep and
   * airborne frames (normally only furniture and containers count). Off by
   * default, so If It Fits keeps its tuned behaviour; a game where cats pile
   * up on each other (Cat Jar) turns it on, or the top of a pile never settles.
   */
  static restOnBodies = false;
  readonly id: number;
  readonly breed: Breed;
  /** Physics numbers (the breed's, unless overridden; resize() changes radius). */
  p: BreedPhysics;
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
  /** Dangling from the scruff: long and narrow at the pinch (built when picked up). */
  readonly hangX: Float64Array;
  readonly hangY: Float64Array;
  /** How far into its dangling shape the cat is (0..1, eases in when picked up). */
  hang = 0;
  /** How firmly each node is held by the finger (0 = free): the edges pull the free end. */
  private readonly held: Float64Array;
  /** Contact info from the last substep, per node. -1 = no contact. */
  readonly contactShape: Int32Array;
  readonly contactNx: Float32Array;
  readonly contactNy: Float32Array;
  // Rest size (changed only by resize()).
  restLen: number;
  area0: number;
  mass: number;
  nodeMass: number;
  invNodeMass: number;

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
  /** Node pushes against other bodies this substep (counted by World). */
  bodyContacts = 0;

  /**
   * `physics` overrides the breed's numbers for this one body (other games
   * built on the engine use breeds at other sizes, e.g. a radius and node
   * count per merge tier).
   */
  constructor(breedId: BreedId, cx: number, cy: number, physics?: Partial<BreedPhysics>) {
    this.id = nextBodyId++;
    this.breed = BREEDS[breedId];
    this.p = physics ? { ...this.breed.physics, ...physics } : this.breed.physics;
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
    this.hangX = new Float64Array(n);
    this.hangY = new Float64Array(n);
    this.held = new Float64Array(n);
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

  /**
   * Grow or shrink to a new rest radius, keeping the node count: the rest
   * shapes, area, edge length and mass all scale, and the outline eases to the
   * new size through the area and edge constraints over the next few frames.
   */
  resize(radius: number): void {
    const k = radius / this.p.radius;
    if (!(k > 0) || k === 1) return;
    this.p = { ...this.p, radius };
    const n = this.n;
    for (let i = 0; i < n; i++) {
      this.roundX[i] *= k;
      this.roundY[i] *= k;
      this.loafX[i] *= k;
      this.loafY[i] *= k;
      this.qx[i] *= k;
      this.qy[i] *= k;
    }
    this.area0 *= k * k;
    this.restLen *= k;
    this.mass = (this.p.density * this.area0) / 1000;
    this.nodeMass = this.mass / n;
    this.invNodeMass = 1 / this.nodeMass;
    this.wake();
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

  /**
   * Fall asleep now: the game knows the cat has settled (deep in a pile a cat
   * keeps creeping a hair under the weight above it, so it never qualifies by
   * itself, and every awake cat costs collisions each substep).
   */
  sleepNow(): void {
    if (!this.asleep) this.sleep();
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
   * Pick the cat up by the scruff at (wx, wy): the ring nodes nearest the
   * touch, but from the top half (touch a cat's tummy and you still get the
   * scruff above it). The pinch keeps its place relative to the finger, so the
   * spot you touched stays put under it.
   */
  startGrab(wx: number, wy: number): Grab {
    this.wake();
    this.computeCentroid();
    const { n, x, y } = this;
    const top = this.cy - this.p.radius * 0.15;
    let mid = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - wx;
      const dy = y[i] - wy;
      const low = y[i] > top ? (y[i] - top) * 1.6 : 0;
      const d = Math.sqrt(dx * dx + dy * dy) + low;
      if (d < bestD) {
        bestD = d;
        mid = i;
      }
    }
    const count = PINCH_HALF * 2 + 1;
    const nodes = new Int32Array(count);
    const weights = new Float64Array(count);
    const offX = new Float64Array(count);
    const offY = new Float64Array(count);
    let ws = 0;
    let mx = 0;
    let my = 0;
    for (let k = -PINCH_HALF; k <= PINCH_HALF; k++) {
      const m = k + PINCH_HALF;
      const i = (mid + k + n) % n;
      const w = 1 - (0.45 * (k < 0 ? -k : k)) / PINCH_HALF;
      nodes[m] = i;
      weights[m] = w;
      offX[m] = x[i] - wx;
      offY[m] = y[i] - wy;
      mx += offX[m] * w;
      my += offY[m] * w;
      ws += w;
    }
    this.held.fill(0);
    for (let m = 0; m < count; m++) this.held[nodes[m]] = weights[m];
    buildHang(this.hangX, this.hangY, n, this.p.radius, this.p.hang, mid);
    normalizeShape(this.hangX, this.hangY, n, this.area0);
    this.grab = {
      tx: wx,
      ty: wy,
      tvx: 0,
      tvy: 0,
      hx: wx,
      hy: wy,
      fromX: wx,
      fromY: wy,
      count,
      nodes,
      weights,
      offX,
      offY,
      midX: mx / ws,
      midY: my / ws,
      low: wy + my / ws,
      age: 0,
      ax: wx - this.cx,
      ay: wy - this.cy,
    };
    return this.grab;
  }

  releaseGrab(): void {
    // the skin where the pinch was keeps its guard against creasing for a
    // moment, while the bunched-up skin springs back
    if (this.grab) this.letGo = { first: this.grab.nodes[0], count: this.grab.count, left: LET_GO_SUBSTEPS };
    this.grab = null;
    this.held.fill(0);
  }

  /** Where a pinch just let go of, and for how many more substeps it's guarded. */
  private letGo: { first: number; count: number; left: number } | null = null;

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
    // every pass: the pinch is held after the body's own constraints tug at it
    if (this.grab) this.solveGrab(first);
    // Once a substep is plenty, folding through takes many substeps; but a
    // pinch pulled against a wall can fold the skin in one pass, so after it too.
    if (first || this.grab) this.solveSelf();
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
    if (this.grab) this.unfoldPinch(this.grab.nodes[0], this.grab.count);
    else if (this.letGo) {
      this.unfoldPinch(this.letGo.first, this.letGo.count);
      if (--this.letGo.left <= 0) this.letGo = null;
    }
  }

  /**
   * Around a held pinch the skin is pulled one way by the finger and pushed
   * the other by whatever the cat is pressed against, and can crease into a
   * hairpin right beside the pinch, where the check above doesn't look (the
   * stretch just past a node's neighbour). There, a node also keeps clear of
   * the stretch beyond its neighbour: no sharper bend than about 60 degrees.
   */
  private unfoldPinch(a: number, count: number): void {
    const { n, x, y } = this;
    const skin = NODE_RADIUS * 1.6;
    const skin2 = skin * skin;
    const span = count + 4;
    for (let q = -2; q < span - 2; q++) {
      const i = (a + q + n) % n;
      for (const side of [1, -2]) {
        // the stretch (j, k) just past i's neighbour on that side
        const j = (i + side + n) % n;
        const k = j + 1 === n ? 0 : j + 1;
        const ax = x[j];
        const ay = y[j];
        const dx = x[i] - ax;
        const dy = y[i] - ay;
        const ex = x[k] - ax;
        const ey = y[k] - ay;
        const l2 = ex * ex + ey * ey;
        if (l2 < 1e-12) continue;
        let t = (dx * ex + dy * ey) / l2;
        if (t <= 0 || t >= 1) continue;
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
    const { n, x, y, held } = this;
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
      const corr = (len - target) / len;
      // split the correction by how free each end is: the finger's pinch
      // barely gives, so a hanging cat pulls on its own skin, not the finger
      const fi = 1 - held[i] * 0.9;
      const fj = 1 - held[j] * 0.9;
      const ci = (corr * fi) / (fi + fj);
      const cj = (corr * fj) / (fi + fj);
      x[i] += dx * ci;
      y[i] += dy * ci;
      x[j] -= dx * cj;
      y[j] -= dy * cj;
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
    const k = Math.max(this.p.shape * this.shapeMul, HANG_SHAPE * this.hang);
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

  /** Hold the pinch at the hand; the rest of the cat hangs from it. */
  private solveGrab(first: boolean): void {
    const g = this.grab!;
    const { n, x, y, contactShape, contactNx, contactNy } = this;
    // where the pinch's middle is now
    let px = 0;
    let py = 0;
    let ws = 0;
    for (let m = 0; m < g.count; m++) {
      const i = g.nodes[m];
      const w = g.weights[m];
      px += x[i] * w;
      py += y[i] * w;
      ws += w;
    }
    px /= ws;
    py /= ws;
    if (first) {
      if (g.age < PINCH_SUBSTEPS) g.age++;
      // Standing on something right under the pinch, the pinch lifts and
      // slides the cat but won't push down into what it stands on: drag a cat
      // down off a shelf and it slides to the edge and steps off (once the
      // pinch is out past the edge, down it goes), then hangs to the finger.
      // (Not when the pinch itself rests on something, the rim of a wall it's
      // being pulled over: holding it up there would leave it straddling.)
      const reach = this.p.radius * 0.6;
      let standing = false;
      for (let i = 0; i < n; i++) {
        if (contactShape[i] !== -1 && contactNy[i] < -0.45 && x[i] > px - reach && x[i] < px + reach) {
          standing = true;
          break;
        }
      }
      for (let m = 0; m < g.count && standing; m++) {
        const i = g.nodes[m];
        if (contactShape[i] !== -1 && contactNy[i] < -0.45) standing = false;
      }
      const want = g.hy + g.midY;
      g.low = standing && want > g.low ? g.low : want;
      let bx = 0;
      for (let i = 0; i < n; i++) bx += x[i];
      bx /= n;
      // The body drifts round to hang right under the pinch: a cat draped
      // over the edge it was dragged off slides the rest of the way off, and
      // ends up where the finger put it (sideways only: gravity does the rest).
      // (Not into a wall it's pressed against: that would only crumple it.)
      let fx = (px - bx) * FOLLOW;
      if (fx > FOLLOW_MAX) fx = FOLLOW_MAX;
      else if (fx < -FOLLOW_MAX) fx = -FOLLOW_MAX;
      for (let i = 0; i < n && fx !== 0; i++) if (contactShape[i] !== -1 && contactNx[i] * fx < -0.5 * (fx > 0 ? fx : -fx)) fx = 0;
      const held = this.held;
      if (fx !== 0) for (let i = 0; i < n; i++) x[i] += fx * (1 - held[i]);
    }
    // 1) The pinch moves as one piece toward the hand, a few units a pass at
    //    most, and slides along whatever any part of it is pressed against
    //    (a pinch split by a thin wall would fold the skin over it).
    let dx = g.hx + g.midX - px;
    // (held up off what it stands on)
    let dy = Math.min(g.hy + g.midY, g.low) - py;
    // (the skin around the pinch counts too: pushing it into a wall folds it)
    // Pressed against something there, the hand eases off and the pinch
    // creeps (a hand feels the cat catch on a rim and stops yanking): the
    // skin gets the time to slide round the obstacle instead of folding.
    const near2 = this.p.radius * this.p.radius * 0.64;
    let pressed = false;
    for (let i = 0; i < n; i++) {
      if (contactShape[i] === -1) continue;
      const ux = x[i] - px;
      const uy = y[i] - py;
      if (ux * ux + uy * uy > near2) continue;
      pressed = true;
      const into = dx * contactNx[i] + dy * contactNy[i];
      if (into < 0) {
        dx -= into * contactNx[i];
        dy -= into * contactNy[i];
      }
    }
    // (sliding along a slanted face mustn't take it down past where it may go)
    if (dy > 0 && py + dy > g.low) dy = g.low > py ? g.low - py : 0;
    const step = pressed ? PIN_STEP_PRESSED : PIN_STEP;
    const d2 = dx * dx + dy * dy;
    if (d2 > step * step) {
      const k = step / Math.sqrt(d2);
      dx *= k;
      dy *= k;
    }
    // Skin right at the pinch resting on a rim: the pinch is lifted up over
    // it rather than held level with it, where the rim would come up between
    // the two sides of the pinch and fold them over each other.
    const reach = this.p.radius * 0.6;
    for (let i = 0; i < n; i++) {
      if (contactShape[i] === -1 || contactNy[i] > -0.45) continue;
      const ux = x[i] - px;
      const uy = y[i] - py;
      if (ux > -reach && ux < reach && uy > -4 && uy < 14) {
        if (dy > -1) dy = -1;
        break;
      }
    }
    // 2) Each pinched node keeps its place in the pinch (the skin bunches up
    //    a little between the fingers as it's picked up).
    const t = g.age / PINCH_SUBSTEPS;
    const bunch = 1 - PINCH * t * t * (3 - 2 * t);
    for (let m = 0; m < g.count; m++) {
      const i = g.nodes[m];
      const w = g.weights[m];
      // (a node pressed against something stays put in the pinch: bunching
      // it toward the others could pull it across a thin wall)
      const touching = contactShape[i] !== -1;
      const ex = touching ? 0 : (px + (g.offX[m] - g.midX) * bunch - x[i]) * w * 0.5;
      const ey = touching ? 0 : (py + (g.offY[m] - g.midY) * bunch - y[i]) * w * 0.5;
      x[i] += dx + ex;
      y[i] += dy + ey;
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
    if (SoftBody.restOnBodies) contacts += this.bodyContacts;
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
    if (this.grab) this.dampSwing(h);
  }

  /** A held cat swings and wobbles a little, then hangs still: damp its motion relative to the pinch. */
  private dampSwing(h: number): void {
    const g = this.grab!;
    const { n, vx, vy } = this;
    let pvx = 0;
    let pvy = 0;
    let ws = 0;
    for (let m = 0; m < g.count; m++) {
      const i = g.nodes[m];
      const w = g.weights[m];
      pvx += vx[i] * w;
      pvy += vy[i] * w;
      ws += w;
    }
    pvx /= ws;
    pvy /= ws;
    const keep = 1 - Math.min(1, SWING_DAMP * h);
    for (let i = 0; i < n; i++) {
      vx[i] = pvx + (vx[i] - pvx) * keep;
      vy[i] = pvy + (vy[i] - pvy) * keep;
    }
  }

  /** Called once per frame by the world (not per substep). */
  frameUpdate(dt: number): void {
    this.emaEnergy += (this.energy - this.emaEnergy) * 0.15;
    if (!this.asleep) this.considerSleep();
    // Rest shape: blend round <-> loaf, plus plastic creep toward current shape.
    const n = this.n;
    const lf = this.loafiness;
    // long only while actually dangling: a held cat still standing on
    // something (or pressed into a wall) keeps its own shape
    const dangling = !!this.grab && this.airborneFrames > 2;
    this.hang += ((dangling ? 1 : 0) - this.hang) * Math.min(1, dt * (dangling ? HANG_IN : HANG_OUT));
    if (this.hang < 1e-3) this.hang = 0;
    const hg = this.hang;
    const relax = Math.min(1, dt * 3);
    const plasticRate = Math.min(1, this.p.plasticity * this.plastic * dt);
    const c = this.rotC;
    const s = this.rotS;
    for (let i = 0; i < n; i++) {
      let tx = this.roundX[i] + (this.loafX[i] - this.roundX[i]) * lf;
      let ty = this.roundY[i] + (this.loafY[i] - this.roundY[i]) * lf;
      if (hg > 0) {
        tx += (this.hangX[i] - tx) * hg;
        ty += (this.hangY[i] - ty) * hg;
      }
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
    let contacts = SoftBody.restOnBodies && this.bodyContacts > 0;
    for (let i = 0; i < n && !contacts; i++)
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
      hang: this.hang,
      hangX: this.hangX.slice(),
      hangY: this.hangY.slice(),
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
    this.hang = s.hang;
    this.hangX.set(s.hangX);
    this.hangY.set(s.hangY);
    this.held.fill(0);
    this.letGo = null;
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
  hang: number;
  hangX: Float64Array;
  hangY: Float64Array;
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

/**
 * A cat dangling by the scruff: taller than wide by `aspect`, narrow up at the
 * pinch and fuller below, turned so ring node `top` (the middle of the pinch)
 * is at the top.
 */
function buildHang(xs: Float64Array, ys: Float64Array, n: number, r: number, aspect: number, top: number): void {
  const a = r * Math.sqrt(aspect);
  const b = r / Math.sqrt(aspect);
  for (let i = 0; i < n; i++) {
    const t = ((i - top) / n) * TAU - TAU / 4;
    const c = dcos(t);
    const s = dsin(t);
    xs[i] = a * c * (1 + 0.22 * s);
    ys[i] = b * s;
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
