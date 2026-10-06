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
  /** The pinched nodes, how firmly each is held, and how far each was from the pinch's middle. */
  count: number;
  nodes: Int32Array;
  weights: Float64Array;
  spread: Float64Array;
  /** The middle of the pinch relative to the hand (it stays put under the finger). */
  midX: number;
  midY: number;
  /** The scruff's distance from the body's middle, dangling (its rest stretch). */
  rest: number;
  /** How firmly the cat is standing on something under the scruff (0..1, eased). */
  support: number;
  /** The scruff's own speed (units/s), where it's going this substep, and where the hand was last substep. */
  vx: number;
  vy: number;
  goalX: number;
  goalY: number;
  lastHx: number;
  lastHy: number;
  /** Touch point relative to the centroid at grab time. */
  ax: number;
  ay: number;
  /** The scruff's speed last substep, and its acceleration, eased (units/s^2). */
  lastVx: number;
  lastVy: number;
  pullX: number;
  pullY: number;
  /** How far the fingers have gathered the pinched skin in (0..1). */
  gathered: number;
}

/** Nodes either side of the middle one in the pinch. */
const PINCH_HALF = 2;
/**
 * Furthest a pinched node moves toward the hand in one constraint pass: less
 * than the half thickness of the thinnest glass, so a cat held against a wall
 * slides along it instead of being pulled through, however far the finger goes.
 */
const PIN_STEP = 3;
/** Substeps the skin where a pinch let go stays guarded against creasing (~1/4 s). */
const LET_GO_SUBSTEPS = 120;
/** Damping of a held cat's swing and wobble, relative to the pinch (per second). */
const SWING_DAMP = 2.6;
/**
 * How thick a held cat is, at least (its viscosity, per second): springy
 * breeds would otherwise bounce between squashed and stretched every time
 * they're lifted, swung or bumped.
 */
const HELD_VISC = 60;
/**
 * Shape stiffness toward the dangling shape while held: every breed goes long
 * in the hand, even the ones with no shape of their own (honey and pudding
 * just get there slowly, through their viscosity).
 */
const HANG_SHAPE = 0.02;
/** Shape stiffness of a held cat that isn't dangling yet (being lifted off something). */
const HOLD_SHAPE = 0.012;
/**
 * The scruff: the loose skin at the pinch is drawn up into a tent above the
 * body, as tall as the load on it (radii per g of pull: the cat's weight,
 * plus whatever the hand's acceleration adds), up to TENT_MAX of that, and
 * easing to it at TENT_FREQ (rad/s), critically damped, so it stretches and
 * settles without ever bouncing. How
 * wide the tent is (radians round the ring either side of the pinch) and how
 * much it narrows the skin in toward the pinch.
 */
export const TENT = 0.3;
const TENT_MAX = 2.6;
const TENT_FREQ = 11;
const TENT_DAMP = 1;
const TENT_WIDTH = 0.55;
const TENT_NARROW = 0.5;
/** How quickly the scruff feels a change in the hand's acceleration (s). */
const PULL_EASE = 0.05;
/** How far the fingers gather the pinched skin in (share of its spread), and how fast (per second). */
const GATHER = 0.45;
const GATHER_IN = 8;
/** How firmly a dangling cat is turned back to hang straight down from its scruff (per pass). */
const HANG_UPRIGHT = 0.01;
/** How fast a picked-up cat goes long, and comes back round once let go (per second). */
const HANG_IN = 5;
const HANG_OUT = 3;
/**
 * How far past its dangling length a held cat can be drawn out (a share of
 * each node's distance from the pinch, and units): a flick of the finger
 * swings the whole cat along instead of pulling it out into a strand.
 */
const TETHER_STRETCH = 1.25;
const TETHER_SLACK = 4;
/**
 * Share of a tether's overshoot taken up each pass (soft, so a swing eases to
 * a stop), and the most it moves a node in one pass (units): a cat that comes
 * free of a snag flows back under its scruff instead of snapping back.
 */
const TETHER_PULL = 0.5;
const TETHER_STEP = 0.6;
/**
 * How quickly the scruff closes a gap to the hand (s), how fast it may close
 * it (units/s: a cat that comes free of a snag swoops back to the finger,
 * rather than jumping), and how fast its speed may change (units/s^2).
 */
const FOLLOW_TIME = 0.04;
const CATCH_UP = 900;
const ACCEL = 16000;
/** Push-back (summed push-outs per substep, in radii) at which the scruff stops going that way. */
const RESIST_FULL = 0.3;
/**
 * How far the finger may stretch the scruff from the body's middle, as a
 * share of its dangling distance: freely up to SCRUFF_FREE, fading out by
 * SCRUFF_MAX (beyond that the cat has to come along first). And how far it
 * may press the scruff in toward the middle: freely down to SCRUFF_FIRM,
 * fading out by SCRUFF_MIN.
 */
const SCRUFF_FREE = 1.2;
const SCRUFF_MAX = 1.6;
const SCRUFF_FIRM = 0.85;
const SCRUFF_MIN = 0.55;
/**
 * How fast standing on something holds the scruff up, and lets it go (per
 * substep), and how much of the scruff's speed down it stops (per substep).
 */
const SUPPORT_IN = 0.12;
const SUPPORT_OUT = 0.05;
const SUPPORT_HOLD = 0.5;
/** How much of a touch is still felt one substep later. */
const FELT_FADE = 0.7;
/** How fast a carried cat may lift a cat lying on top of it (units/s). */
const CAT_LIFT = 150;
/** Frames a just-untangled cat in a finger is eased back toward its rest shape, and how firmly (per pass). */
const KNOT_FRAMES = 4;
const RESHAPE = 0.02;

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
  /**
   * The scruff tent: how far the skin at the pinch is drawn up above the body
   * (units; it springs back once let go), how fast that's changing, and where:
   * the ring node in the middle of the pinch, and which way the scruff is from
   * the body's middle in its own rest shape.
   */
  tent = 0;
  private tentV = 0;
  private tentMid = 0;
  private tentUpX = 0;
  private tentUpY = -1;
  /** The tent laid over the rest shape this substep (body frame), and whether it's on. */
  private readonly tentX: Float64Array;
  private readonly tentY: Float64Array;
  private tentOn = false;
  /** Gravity, as the world last integrated it. */
  private gravity = 0;
  /** How firmly each node is held by the finger (0 = free): the edges pull the free end. */
  readonly held: Float64Array;
  /** While held: the furthest each node may hang from the pinch (its dangling distance, plus a little stretch). */
  private readonly tether: Float64Array;
  /** Contact info from the last substep, per node. -1 = no contact. */
  readonly contactShape: Int32Array;
  readonly contactNx: Float32Array;
  readonly contactNy: Float32Array;
  /** Pushed against another cat this substep, per node (set by World), and which way is out. */
  readonly bodyTouch: Uint8Array;
  readonly bodyNx: Float32Array;
  readonly bodyNy: Float32Array;
  /**
   * How hard what the cat is pressed against pushes it back (the sum of
   * last substep's collision push-outs, eased over a few substeps; set by
   * World): the finger holding it eases off that way.
   */
  resistX = 0;
  resistY = 0;
  /**
   * While held: what each node has lately been pressed against (furniture or
   * another cat), fading over a few substeps, and which way is out, so a
   * touch that flickers on and off steers the scruff steadily.
   */
  private readonly feltW: Float32Array;
  private readonly feltX: Float32Array;
  private readonly feltY: Float32Array;
  /** ...and whether that's a cat lying on top, which can be lifted (0..1). */
  private readonly feltLift: Float32Array;
  /** This substep's collision push-outs on a held cat, summed (World adds them up). */
  pushX = 0;
  pushY = 0;
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
    this.tether = new Float64Array(n);
    this.contactShape = new Int32Array(n).fill(-1);
    this.bodyTouch = new Uint8Array(n);
    this.bodyNx = new Float32Array(n);
    this.bodyNy = new Float32Array(n);
    this.feltW = new Float32Array(n);
    this.feltX = new Float32Array(n);
    this.feltY = new Float32Array(n);
    this.feltLift = new Float32Array(n);
    this.tentX = new Float64Array(n);
    this.tentY = new Float64Array(n);

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
    const r = this.p.radius;
    const top = this.cy - r * 0.15;
    let mid = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - wx;
      const dy = y[i] - wy;
      const low = y[i] > top ? (y[i] - top) * 1.6 : 0;
      // and skin that faces up: on a cat squashed into a dent, the skin
      // nearest the touch can be its underside, and lifting by that would
      // pull the skin up through the cat
      const ip = i + 1 === n ? 0 : i + 1;
      const im = i === 0 ? n - 1 : i - 1;
      const tx = x[ip] - x[im];
      const ty = y[ip] - y[im];
      const tl = Math.sqrt(tx * tx + ty * ty);
      const ny = tl > 1e-9 ? -tx / tl : 0;
      const down = ny > -0.25 ? (ny + 0.25) * r * 1.4 : 0;
      const d = Math.sqrt(dx * dx + dy * dy) + low + down;
      if (d < bestD) {
        bestD = d;
        mid = i;
      }
    }
    const count = PINCH_HALF * 2 + 1;
    const nodes = new Int32Array(count);
    const weights = new Float64Array(count);
    const spread = new Float64Array(count);
    let ws = 0;
    let mx = 0;
    let my = 0;
    for (let k = -PINCH_HALF; k <= PINCH_HALF; k++) {
      const m = k + PINCH_HALF;
      const i = (mid + k + n) % n;
      const w = 1 - (0.45 * (k < 0 ? -k : k)) / PINCH_HALF;
      nodes[m] = i;
      weights[m] = w;
      mx += (x[i] - wx) * w;
      my += (y[i] - wy) * w;
      ws += w;
    }
    for (let m = 0; m < count; m++) {
      const dx = x[nodes[m]] - wx - mx / ws;
      const dy = y[nodes[m]] - wy - my / ws;
      spread[m] = Math.sqrt(dx * dx + dy * dy);
    }
    this.held.fill(0);
    for (let m = 0; m < count; m++) this.held[nodes[m]] = weights[m];
    this.resistX = 0;
    this.resistY = 0;
    this.feltW.fill(0);
    buildHang(this.hangX, this.hangY, n, this.p.radius, this.p.hang, mid);
    normalizeShape(this.hangX, this.hangY, n, this.area0);
    // Turned so the pinch is where it is in the cat's own rest shape: cats
    // roll, so the scruff can be anywhere round it, and easing between two
    // shapes turned far apart passes through a collapsed, inside-out outline.
    let ux = 0;
    let uy = 0;
    for (let m = 0; m < count; m++) {
      ux += this.qx[nodes[m]] * weights[m];
      uy += this.qy[nodes[m]] * weights[m];
    }
    const ul = Math.sqrt(ux * ux + uy * uy);
    this.tentMid = mid;
    this.tentUpX = ul > 1e-9 ? ux / ul : 0;
    this.tentUpY = ul > 1e-9 ? uy / ul : -1;
    if (ul > 1e-9) {
      // the rotation taking straight up (0, -1) to the pinch's way, (ux, uy)
      const c = -uy / ul;
      const s = ux / ul;
      for (let i = 0; i < n; i++) {
        const hx = this.hangX[i];
        const hy = this.hangY[i];
        this.hangX[i] = c * hx - s * hy;
        this.hangY[i] = s * hx + c * hy;
      }
    }
    // how far each node hangs from the pinch, dangling
    let hpx = 0;
    let hpy = 0;
    for (let m = 0; m < count; m++) {
      hpx += this.hangX[nodes[m]] * weights[m];
      hpy += this.hangY[nodes[m]] * weights[m];
    }
    hpx /= ws;
    hpy /= ws;
    for (let i = 0; i < n; i++) {
      const dx = this.hangX[i] - hpx;
      const dy = this.hangY[i] - hpy;
      this.tether[i] = Math.sqrt(dx * dx + dy * dy) * TETHER_STRETCH + TETHER_SLACK;
    }
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
      spread,
      midX: mx / ws,
      midY: my / ws,
      rest: Math.max(this.p.radius * 0.5, Math.sqrt(hpx * hpx + hpy * hpy)),
      support: 0,
      vx: 0,
      vy: 0,
      goalX: wx + mx / ws,
      goalY: wy + my / ws,
      lastHx: wx,
      lastHy: wy,
      ax: wx - this.cx,
      ay: wy - this.cy,
      lastVx: 0,
      lastVy: 0,
      pullX: 0,
      pullY: 0,
      gathered: 0,
    };
    return this.grab;
  }

  releaseGrab(): void {
    // the skin where the pinch was keeps its guard against creasing for a
    // moment, while it springs back
    if (this.grab) this.letGo = { first: this.grab.nodes[0], count: this.grab.count, left: LET_GO_SUBSTEPS };
    this.grab = null;
    this.held.fill(0);
  }

  /** Where a pinch just let go of, and for how many more substeps it's guarded. */
  private letGo: { first: number; count: number; left: number } | null = null;

  /** Frames left easing the crease out of a just-untangled cat (see untangle()). */
  knotted = 0;
  /**
   * Bumped whenever the ring's nodes trade places (untangling), so anything
   * that follows node positions over time (drawing between steps) knows they
   * don't line up with last time's.
   */
  ringVersion = 0;

  // --- Simulation pieces (called by World) ---------------------------------

  integrate(h: number, g: number): void {
    this.gravity = g;
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
    if (first) this.stepTent(h);
    this.solveEdges(h);
    this.solveArea();
    this.solveShape();
    // every pass: the pinch is held after the body's own constraints tug at it
    if (this.grab) this.solveGrab(first, h);
    // Once a substep is plenty, folding through takes many substeps; but a
    // pinch pulled against a wall can fold the skin in one pass, so after it too.
    if (first || this.grab) this.solveSelf();
  }

  /**
   * The scruff tent, once a substep. Held, the skin at the pinch carries the
   * cat: it's drawn up as far as the load on it, the cat's weight (what isn't
   * stood on something) plus the pull of the hand's acceleration along it. A
   * hand lifting fast stretches it tall and the body comes up after, a hand
   * slowing at the top lets it spring back, and a scruff can't push: thrown
   * up, or set down, the skin goes slack. Let go, it springs back flat.
   */
  private stepTent(h: number): void {
    const g = this.grab;
    const { n, x, y } = this;
    const r = this.p.radius;
    let target = 0;
    if (g) {
      let px = 0;
      let py = 0;
      let ws = 0;
      for (let m = 0; m < g.count; m++) {
        const i = g.nodes[m];
        px += x[i] * g.weights[m];
        py += y[i] * g.weights[m];
        ws += g.weights[m];
      }
      px /= ws;
      py /= ws;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < n; i++) {
        cx += x[i];
        cy += y[i];
      }
      const ux = cx / n - px;
      const uy = cy / n - py;
      const ul = Math.sqrt(ux * ux + uy * uy);
      const G = this.gravity;
      if (ul > 1e-9 && G > 0) {
        const fx = -g.pullX;
        const fy = G * (1 - g.support) - g.pullY;
        const load = (fx * ux + fy * uy) / (ul * G);
        if (load > 0) target = TENT * r * (load < TENT_MAX ? load : TENT_MAX);
      }
    }
    const w = TENT_FREQ;
    this.tentV += (w * w * (target - this.tent) - 2 * TENT_DAMP * w * this.tentV) * h;
    this.tent += this.tentV * h;
    if (this.tent < 0) {
      this.tent = 0;
      if (this.tentV < 0) this.tentV = 0;
    }
    if (!g && this.tent < r * 0.002 && this.tentV < r * 0.01) {
      this.tent = 0;
      this.tentV = 0;
    }
    const T = this.tent;
    this.tentOn = T > 0;
    if (!this.tentOn) return;
    // the skin round the pinch drawn up along the scruff's way, and in toward it
    const { qx, qy, tentX, tentY } = this;
    const upX = this.tentUpX;
    const upY = this.tentUpY;
    const narrow = TENT_NARROW * (T < TENT * r ? T / (TENT * r) : 1);
    const W2 = TENT_WIDTH * TENT_WIDTH;
    const cut = 9 * W2;
    const fc = 0.01; // the bump at the cut, so it fades to nothing there
    let mx = 0;
    let my = 0;
    const half = n / 2;
    for (let i = 0; i < n; i++) {
      let d = i - this.tentMid;
      if (d > half) d -= n;
      else if (d <= -half) d += n;
      const u = (d / n) * TAU;
      let ox = 0;
      let oy = 0;
      if (u * u < cut) {
        const b = 1 / (1 + (u * u) / W2);
        const k = (b * b - fc) / (1 - fc);
        const along = qx[i] * upX + qy[i] * upY;
        ox = (upX * T - (qx[i] - along * upX) * narrow) * k;
        oy = (upY * T - (qy[i] - along * upY) * narrow) * k;
      }
      tentX[i] = ox;
      tentY[i] = oy;
      mx += ox;
      my += oy;
    }
    // (centred, so it draws the skin up and lets the body down, rather than
    // shifting the cat)
    mx /= n;
    my /= n;
    for (let i = 0; i < n; i++) {
      tentX[i] -= mx;
      tentY[i] -= my;
    }
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
    // (and a cat in a finger, or just let go, that came untangled is eased
    // smooth again: the finger keeps squeezing out the same crease)
    const reshape = this.knotted > 0 && (this.grab !== null || this.letGo !== null) ? RESHAPE : 0;
    // (and a held cat keeps its shape from the moment it's picked up: lifted
    // off a shelf it comes up in one piece, the scruff stretching, rather
    // than the whole cat drawing out into a tube that then snaps free)
    const k = Math.max(this.p.shape * this.shapeMul, HANG_SHAPE * this.hang, reshape, this.grab !== null ? HOLD_SHAPE : 0);
    const { n, x, y } = this;
    // (the rest shape with the scruff tent laid over it)
    let qx: Float64Array = this.qx;
    let qy: Float64Array = this.qy;
    if (this.tentOn) {
      const ax = scratchA(n);
      const ay = scratchB(n);
      for (let i = 0; i < n; i++) {
        ax[i] = qx[i] + this.tentX[i];
        ay[i] = qy[i] + this.tentY[i];
      }
      qx = ax;
      qy = ay;
    }
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
    // (Not while dangling: then the pinch is up, wherever it is on the cat.)
    const u = this.p.upright * (1 - this.hang);
    let gc = c + (1 - c) * u;
    let gs = s * (1 - u) + (c < -0.9 ? 0.02 * u : 0);
    let gl = Math.sqrt(gc * gc + gs * gs);
    gc /= gl;
    gs /= gl;
    // (a dangling cat is turned, gently, back to hanging straight down from
    // its scruff: it swings when carried, but not like a pendulum on a string)
    if (this.grab && this.hang > 0) {
      const v = HANG_UPRIGHT * this.hang;
      const uc = gc + (-this.tentUpY - gc) * v;
      const us = gs + (-this.tentUpX - gs) * v;
      gl = Math.sqrt(uc * uc + us * us);
      if (gl > 1e-6) {
        gc = uc / gl;
        gs = us / gl;
      }
    }
    for (let i = 0; i < n; i++) {
      const gx = cx + gc * qx[i] - gs * qy[i];
      const gy = cy + gs * qx[i] + gc * qy[i];
      x[i] += (gx - x[i]) * k;
      y[i] += (gy - y[i]) * k;
    }
  }

  /**
   * The finger carries the scruff the way a hand would: the scruff has a
   * speed of its own that keeps pace with the hand and closes any gap, but
   * can only change so fast, so it never starts, stops or turns with a jolt.
   * In the air it stays right under the finger and the rest of the cat hangs
   * from it, swinging. What it's pressed against holds it back in
   * proportion, like a hand feeling the cat catch; it stretches away from
   * the body's middle only up to SCRUFF_MAX of its dangling distance, and
   * isn't pushed in toward it past SCRUFF_MIN (press a cat down onto a shelf,
   * or another cat, and it settles there instead of being squashed or
   * folded). All of it fades in smoothly, so nothing snaps or shudders.
   */
  private solveGrab(first: boolean, h: number): void {
    const g = this.grab!;
    const { n, x, y, held, contactShape, contactNx, contactNy, bodyTouch, bodyNx, bodyNy } = this;
    // where the scruff (the pinch's middle) and the body's middle are now
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
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      cx += x[i];
      cy += y[i];
    }
    cx /= n;
    cy /= n;
    if (first) {
      // Standing on something under the scruff (furniture just below it, or
      // another cat anywhere below), the scruff isn't pulled down: a finger
      // pushing down slides a cat to the edge of its shelf and it steps off,
      // rather than dragging its scruff down its side and under it, or
      // squashing the cat underneath. Eased in and out over a few substeps,
      // so it never jerks.
      const reach = this.p.radius * 0.6;
      const below = py + this.p.radius * 0.3;
      let standing = 0;
      for (let i = 0; i < n && standing === 0; i++) {
        if (y[i] < below) continue;
        if (bodyTouch[i] !== 0 && bodyNy[i] < -0.45) standing = 1;
        else if (contactShape[i] !== -1 && contactNy[i] < -0.45 && x[i] > px - reach && x[i] < px + reach) standing = 1;
      }
      g.support += (standing - g.support) * (standing > g.support ? SUPPORT_IN : SUPPORT_OUT);
      const { feltW, feltX, feltY, feltLift } = this;
      for (let i = 0; i < n; i++) {
        if (contactShape[i] !== -1) {
          feltW[i] = 1;
          feltX[i] = contactNx[i];
          feltY[i] = contactNy[i];
          feltLift[i] = 0;
        } else if (bodyTouch[i] !== 0) {
          feltW[i] = 1;
          feltX[i] = bodyNx[i];
          feltY[i] = bodyNy[i];
          feltLift[i] = 1 - catPushback(bodyNy[i]);
        } else feltW[i] *= FELT_FADE;
      }
    }
    if (first) {
      // 1) The scruff keeps pace with the hand and closes any gap within
      //    FOLLOW_TIME. But its speed can only change so fast, like a real
      //    hand's: whatever the rules below make of the way it wants to go,
      //    it eases into it, so nothing starts, stops or turns with a jolt.
      const hvx = (g.hx - g.lastHx) / h;
      const hvy = (g.hy - g.lastHy) / h;
      g.lastHx = g.hx;
      g.lastHy = g.hy;
      // (closing a gap no faster than it can still stop in: no overshoot)
      const gx = g.hx + g.midX - px;
      const gy = g.hy + g.midY - py;
      const gl = Math.sqrt(gx * gx + gy * gy);
      const close = gl > 1e-9 ? Math.min(gl / FOLLOW_TIME, Math.sqrt(1.6 * ACCEL * gl), CATCH_UP) / gl : 0;
      let vx = hvx + gx * close;
      let vy = hvy + gy * close;
      // (held up off what it stands on)
      if (vy > 0) vy *= 1 - g.support;
      // What it's pressed against pushes back, and the scruff eases off that
      // way in proportion, like a hand feeling the cat catch: a brush past
      // the furniture barely slows it; a cat jammed against a wall, stood on
      // a shelf or pressed onto another cat stops coming.
      const rl0 = Math.sqrt(this.resistX * this.resistX + this.resistY * this.resistY);
      if (rl0 > 1e-6) {
        const ux = this.resistX / rl0;
        const uy = this.resistY / rl0;
        const into = vx * ux + vy * uy;
        if (into < 0) {
          const k = smooth(0, RESIST_FULL * this.p.radius, rl0);
          vx -= into * ux * k;
          vy -= into * uy * k;
        }
      }
      // How far it may stretch the scruff from the body's middle, or press it in.
      const rx = px - cx;
      const ry = py - cy;
      const rl = Math.sqrt(rx * rx + ry * ry);
      if (rl > 1e-6) {
        const ux = rx / rl;
        const uy = ry / rl;
        const rho = rl / (g.rest + this.tent * 0.8);
        const out = vx * ux + vy * uy;
        const keep = out > 0 ? 1 - smooth(SCRUFF_FREE, SCRUFF_MAX, rho) : smooth(SCRUFF_MIN, SCRUFF_FIRM, rho);
        vx -= ux * out * (1 - keep);
        vy -= uy * out * (1 - keep);
      }
      let ax = vx - g.vx;
      let ay = vy - g.vy;
      const al = Math.sqrt(ax * ax + ay * ay);
      const amax = ACCEL * h;
      if (al > amax) {
        ax *= amax / al;
        ay *= amax / al;
      }
      g.vx += ax;
      g.vy += ay;
      if (g.vy > 0) g.vy *= 1 - g.support * SUPPORT_HOLD;
      // The scruff itself is never driven into what the skin round it is
      // pressed against, furniture or cat: it stops that way and slides along
      // (driven in, the pinched skin pokes through a thin floor or folds over
      // a rim). A bump, not a jolt: only its speed into the thing stops. A
      // cat lying on top of it is lifted, but only gently: it has time to
      // come up as a whole, or roll off, rather than being speared.
      const near2 = this.p.radius * this.p.radius * 0.64;
      const { feltW, feltX, feltY, feltLift } = this;
      for (let i = 0; i < n; i++) {
        const w = feltW[i];
        if (w < 0.02) continue;
        const ux = x[i] - px;
        const uy = y[i] - py;
        if (ux * ux + uy * uy > near2) continue;
        const into = g.vx * feltX[i] + g.vy * feltY[i] + feltLift[i] * CAT_LIFT;
        if (into < 0) {
          g.vx -= into * feltX[i] * w;
          g.vy -= into * feltY[i] * w;
        }
      }
      // (how hard the scruff is being swung about, felt by the tent)
      const ease = h < PULL_EASE ? h / PULL_EASE : 1;
      g.pullX += ((g.vx - g.lastVx) / h - g.pullX) * ease;
      g.pullY += ((g.vy - g.lastVy) / h - g.pullY) * ease;
      g.lastVx = g.vx;
      g.lastVy = g.vy;
      g.gathered += (1 - g.gathered) * Math.min(1, h * GATHER_IN);
    }
    if (first) {
      // 2) Where the scruff is to be at the end of this substep: where it was
      //    at the start of it, moved on at its own speed (its skin already
      //    coasts on its momentum, so this is a target, not an extra push).
      //    Every pass draws it there.
      let sx0 = 0;
      let sy0 = 0;
      for (let m = 0; m < g.count; m++) {
        const i = g.nodes[m];
        sx0 += this.px[i] * g.weights[m];
        sy0 += this.py[i] * g.weights[m];
      }
      g.goalX = sx0 / ws + g.vx * h;
      g.goalY = sy0 / ws + g.vy * h;
    }
    let dx = g.goalX - px;
    let dy = g.goalY - py;
    // (a few units a pass at most: less than the thinnest glass is thick, so
    // nothing is ever pulled through a wall, however far the finger goes)
    const d2 = dx * dx + dy * dy;
    if (d2 > PIN_STEP * PIN_STEP) {
      const k = PIN_STEP / Math.sqrt(d2);
      dx *= k;
      dy *= k;
    }
    // 3) The pinched skin stays gathered: no pinched node strays further
    //    from the middle of the pinch than it was when picked up (less, as
    //    the fingers close on it: the skin bunches up between them).
    //    Gathered, never held in a fixed pattern: fingers turn with the cat,
    //    so when it swings round or flops over the hand the pinch turns too,
    //    instead of crossing the skin over itself.
    for (let m = 0; m < g.count; m++) {
      const i = g.nodes[m];
      let ex = 0;
      let ey = 0;
      // (a node pressed against something isn't gathered in: that could pull
      // it across a thin wall)
      if (contactShape[i] === -1 && bodyTouch[i] === 0) {
        const ux = x[i] - px;
        const uy = y[i] - py;
        const u = Math.sqrt(ux * ux + uy * uy);
        const r0 = g.spread[m] * (1 - GATHER * g.gathered);
        if (u > r0) {
          const k = ((u - r0) / u) * g.weights[m] * 0.5;
          ex = -ux * k;
          ey = -uy * k;
        }
      }
      x[i] += dx + ex;
      y[i] += dy + ey;
    }
    // 4) Nothing hangs further from the scruff than it would dangling, plus a
    //    little stretch: a quick flick of the finger swings the whole cat
    //    along instead of drawing it out into a strand that folds over itself.
    //    (A few units a pass at most, and along whatever the skin is pressed
    //    against rather than into it.)
    const sx = px + dx;
    const sy = py + dy;
    const tether = this.tether;
    for (let i = 0; i < n; i++) {
      const free = 1 - held[i];
      const ux = x[i] - sx;
      const uy = y[i] - sy;
      const u2 = ux * ux + uy * uy;
      const L = tether[i] + this.tent;
      if (u2 <= L * L) continue;
      const u = Math.sqrt(u2);
      let pull = (u - L) * free * TETHER_PULL;
      if (pull > TETHER_STEP) pull = TETHER_STEP;
      let mx = -(ux / u) * pull;
      let my = -(uy / u) * pull;
      if (contactShape[i] !== -1) {
        const into = mx * contactNx[i] + my * contactNy[i];
        if (into < 0) {
          mx -= into * contactNx[i];
          my -= into * contactNy[i];
        }
      }
      if (bodyTouch[i] !== 0) {
        const into = mx * bodyNx[i] + my * bodyNy[i];
        if (into < 0) {
          mx -= into * bodyNx[i];
          my -= into * bodyNy[i];
        }
      }
      x[i] += mx;
      y[i] += my;
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
    // (a cat in the hand is honey-thick, whatever its breed: it flows into
    // each new shape, never jiggles)
    const v0 = this.grab && this.p.viscosity < HELD_VISC ? HELD_VISC : this.p.viscosity;
    const visc = (v0 + (calm ? REST_VISC : 0)) * h;
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
    // skin crossed over itself: turn the crossed stretch the right way round
    // (and ease the crease out over the next few frames)
    if (this.untangle()) this.knotted = KNOT_FRAMES;
    else if (this.knotted > 0) this.knotted--;
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
    // (and a rest shape that crept into a knot starts over from clean)
    if (crossingAt(this.qx, this.qy, n) >= 0) {
      for (let i = 0; i < n; i++) {
        const tx = this.roundX[i] + (this.loafX[i] - this.roundX[i]) * lf;
        const ty = this.roundY[i] + (this.loafY[i] - this.roundY[i]) * lf;
        this.qx[i] = tx + (this.hangX[i] - tx) * hg;
        this.qy[i] = ty + (this.hangY[i] - ty) * hg;
      }
      normalizeShape(this.qx, this.qy, n, this.area0);
    }
  }

  /**
   * Untangle skin that has crossed over itself (squeezed harder than the
   * solver could keep up with: a cat crushed into a corner, dragged hard over
   * a rim). Nothing else can undo a crossing once it's made: the
   * self-collision only keeps skin apart, it can't tell which side is out, so
   * it would hold the knot in place for good. The stretch of skin between the
   * two crossing edges is turned the right way round (the nodes trade places
   * end for end, a "2-opt" move): the outline is drawn through the very same
   * points, so nothing jumps, but it no longer crosses there.
   */
  private untangle(): boolean {
    const { n, x, y } = this;
    let fixed = false;
    for (let pass = 0; pass < 8; pass++) {
      const c = crossingAt(x, y, n);
      if (c < 0) break;
      const i = Math.floor(c / n);
      const j = c - i * n;
      // The crossing splits the ring into two loops, one of them inside out
      // (wound the wrong way round): that's the one to turn.
      const i2 = i + 1;
      const j2 = j + 1 === n ? 0 : j + 1;
      const d1 = (x[j2] - x[j]) * (y[i] - y[j]) - (y[j2] - y[j]) * (x[i] - x[j]);
      const d2 = (x[j2] - x[j]) * (y[i2] - y[j]) - (y[j2] - y[j]) * (x[i2] - x[j]);
      const t = d1 / (d1 - d2);
      const qx = x[i] + (x[i2] - x[i]) * t;
      const qy = y[i] + (y[i2] - y[i]) * t;
      let a1 = 0;
      let lx = qx;
      let ly = qy;
      for (let k = i2; k <= j; k++) {
        a1 += lx * y[k] - x[k] * ly;
        lx = x[k];
        ly = y[k];
      }
      a1 += lx * qy - qx * ly;
      const a2 = 2 * polygonArea(x, y, n) - a1;
      const short1 = j - i <= n - (j - i);
      if (a1 < 0 && a2 >= 0) this.reverseNodes(i2, j);
      else if (a2 < 0 && a1 >= 0) this.reverseNodes(j + 1, i + n);
      else if (short1) this.reverseNodes(i2, j);
      else this.reverseNodes(j + 1, i + n);
      fixed = true;
    }
    // (a ring wound the wrong way round all over is a cat turned inside out:
    // the same points, traced the other way)
    if (polygonArea(x, y, n) < 0) {
      this.reverseNodes(0, n - 1);
      fixed = true;
    }
    return fixed;
  }

  /** Swap nodes end for end along the ring from `from` to `to` (indices may run past n). */
  private reverseNodes(from: number, to: number): void {
    this.ringVersion++;
    const n = this.n;
    const per = [this.x, this.y, this.px, this.py, this.vx, this.vy];
    const touch = [this.contactNx, this.contactNy, this.bodyNx, this.bodyNy];
    for (let a = from, b = to; a < b; a++, b--) {
      const i = a % n;
      const j = b % n;
      for (const arr of per) {
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      for (const arr of touch) {
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      const cs = this.contactShape[i];
      this.contactShape[i] = this.contactShape[j];
      this.contactShape[j] = cs;
      const bt = this.bodyTouch[i];
      this.bodyTouch[i] = this.bodyTouch[j];
      this.bodyTouch[j] = bt;
    }
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
      knotted: this.knotted,
      contactShape: this.contactShape.slice(),
      contactNx: this.contactNx.slice(),
      contactNy: this.contactNy.slice(),
      bodyTouch: this.bodyTouch.slice(),
      bodyNx: this.bodyNx.slice(),
      bodyNy: this.bodyNy.slice(),
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
    this.knotted = s.knotted;
    this.held.fill(0);
    this.letGo = null;
    this.tent = 0;
    this.tentV = 0;
    this.tentOn = false;
    this.contactShape.set(s.contactShape);
    this.contactNx.set(s.contactNx);
    this.contactNy.set(s.contactNy);
    this.bodyTouch.set(s.bodyTouch);
    this.bodyNx.set(s.bodyNx);
    this.bodyNy.set(s.bodyNy);
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
  knotted: number;
  contactShape: Int32Array;
  contactNx: Float32Array;
  contactNy: Float32Array;
  bodyTouch: Uint8Array;
  bodyNx: Float32Array;
  bodyNy: Float32Array;
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
 * How much a push from another cat (its way out, y down) holds a carried cat
 * back: a cat underneath or alongside does, standing its ground; one on top
 * doesn't (lifted from under it, it just comes too, or rolls off).
 */
export function catPushback(ny: number): number {
  return 1 - smooth(0.2, 0.5, ny);
}

/** 0 below a, 1 above b, easing in between (either way round). */
function smooth(a: number, b: number, v: number): number {
  let t = (v - a) / (b - a);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * The first place a closed ring crosses itself: edges i and j (i < j, not
 * neighbours) as i * n + j, or -1 if it doesn't.
 */
export function crossingAt(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number): number {
  for (let i = 0; i < n; i++) {
    const i2 = i + 1 === n ? 0 : i + 1;
    const ax = xs[i];
    const ay = ys[i];
    const bx = xs[i2];
    const by = ys[i2];
    const x0 = ax < bx ? ax : bx;
    const x1 = ax < bx ? bx : ax;
    const y0 = ay < by ? ay : by;
    const y1 = ay < by ? by : ay;
    for (let j = i + 2; j < n; j++) {
      const j2 = j + 1 === n ? 0 : j + 1;
      if (j2 === i) continue;
      const cx = xs[j];
      const cy = ys[j];
      const dx = xs[j2];
      const dy = ys[j2];
      if ((cx < x0 && dx < x0) || (cx > x1 && dx > x1) || (cy < y0 && dy < y0) || (cy > y1 && dy > y1)) continue;
      const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
      const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
      if (d1 * d2 >= 0) continue;
      const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      if (d3 * d4 < 0) return i * n + j;
    }
  }
  return -1;
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
