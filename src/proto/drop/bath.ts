// Cat Drop: the bath at the end of a run. Bath time's foam fills the screen,
// and under it the house gives way to a cozy bathroom with a clawfoot tub full
// of water and suds. Once the foam has cleared, the cat (the same breed, at the
// size it grew to) drops in from above: a real soft body that plops into the
// water with a splash, bobs and settles, half under the suds. Headless (no
// DOM): bathArt.ts paints it, the view drives it one physics frame at a time.

import type { BreedId } from '../../physics/breeds';
import { capsule, translateShape } from '../../physics/shapes';
import { SoftBody } from '../../physics/softbody';
import { FRAME_DT, GRAVITY, World } from '../../physics/world';
import { SHAFT_W } from './level';
import type { TubSurface } from './suds';

/** When things happen (seconds since the bath came into view, under the foam). */
export const BATH = {
  /** The cat drops in from above the screen (once the top of the screen has cleared). */
  drop: 0.3,
  /** Its speed as it comes into view (it has been falling all this time), and the most it falls at. */
  dropSpeed: 460,
  terminal: 800,
  /** Settled this long after the splash: the bath is ready (the card shows). */
  settle: 0.8,
  /** And this long after that, a little purr. */
  purr: 1.6,
  /** The card shows by now whatever happens. */
  latest: 3.4,
};

/** Where everything in the bathroom is (world units: x across the shaft, y down from wherever the screen's top is). */
export interface TubLayout {
  /** The middle of the tub, and its outer half-width at the rim. */
  cx: number;
  halfW: number;
  /** Its opening (inner edges of the rim). */
  x0: number;
  x1: number;
  /** The rim's top (the front of the rolled lip), and the opening seen a little from above: its half-height. */
  rimY: number;
  persp: number;
  /** The water's still level, the bottom inside, the tub's underside, where its feet stand, and the floor line (the foot of the wall). */
  waterY: number;
  innerBottom: number;
  baseY: number;
  footY: number;
  floorY: number;
  /** The suds on the water: how high they stand over it. */
  suds: number;
  /** Where the tap's spout drips. */
  tapX: number;
  tapY: number;
}

/**
 * The bathroom's layout for a screen `viewH` tall whose top is at world y
 * `top`: the tub stands low in the middle, sized for a cat of radius `r` (snug
 * enough that a small cat doesn't get lost in it, roomy enough for the biggest).
 */
export function tubLayout(top: number, viewH: number, r: number): TubLayout {
  const floorY = top + viewH - 46;
  const footY = floorY + 15;
  const baseY = footY - 27;
  const halfW = Math.max(96, Math.min(140, 60 + 1.5 * r));
  const rimY = baseY - (84 + 0.24 * halfW);
  const cx = SHAFT_W / 2;
  return {
    cx,
    halfW,
    x0: cx - halfW + 13,
    x1: cx + halfW - 13,
    rimY,
    persp: 12,
    waterY: rimY + 5,
    innerBottom: rimY + 102,
    baseY,
    footY,
    floorY,
    suds: 13,
    tapX: cx - halfW + 51,
    tapY: rimY - 30,
  };
}

/** A soft white wisp of steam rising off the bath. */
export interface Wisp {
  x: number;
  y: number;
  vx: number;
  age: number;
  life: number;
  size: number;
  seed: number;
}

/** One of the painted suds piled on the water: where it sits, and the springy bob the splash sets off. */
export interface Sud {
  x: number;
  /** How far below the top of the suds (negative: higher), size and tint. */
  dy: number;
  r: number;
  tint: number;
  /** In front of the cat (else behind it). */
  front: boolean;
  oy: number;
  ov: number;
}

export type BathEvent =
  /** The house has given way to the bath, under the full foam; the foam starts clearing. */
  | { t: 'clear' }
  /** The cat drops in from above. */
  | { t: 'drop' }
  /** It lands in the water (the cat's radius as `size`). */
  | { t: 'splash'; x: number; y: number; speed: number; size: number }
  /** It has settled in: the card can show. */
  | { t: 'ready' }
  /** A drop leaves the tap (it lands in the bath `delay` seconds later). */
  | { t: 'plink'; x: number; delay: number };

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

export class BathScene implements TubSurface {
  readonly world = new World();
  tub: TubLayout;
  /** The cat, once it has dropped in. */
  cat: SoftBody | null = null;
  /** Seconds since the bath came into view (under the foam), and when the cat splashed in and settled. */
  t = 0;
  splashT = -1;
  readyT = -1;
  /** Purring (a while after it has settled in). */
  purring = false;
  events: BathEvent[] = [];
  readonly steam: Wisp[] = [];
  readonly suds: Sud[] = [];
  /** How far the foam has cleared down the screen (world y; the view tells), so steam waits for it. */
  clearedTo = -Infinity;
  /** Buoyancy for the cat's nodes under water (so it floats with its middle just over the suds). */
  private lift = 2 * GRAVITY;
  private readonly rnd: Rand;
  private ripX = 0;
  private ripT = -10;
  private ripA = 0;
  private steamOwed = 0;
  private plinkAt = 1.2;

  constructor(
    readonly breed: BreedId,
    /** The cat's size (it keeps what it grew to). */
    readonly radius: number,
    /** World y of the top of the screen, and its height. */
    readonly top: number,
    public viewH: number,
    seed: number,
  ) {
    this.tub = tubLayout(top, viewH, radius);
    this.rnd = rng(seed * 31 + 7);
    this.world.substeps = 10;
    const L = this.tub;
    // the inside of the tub: sloping ends and a flat bottom (and walls up past the rim, unseen)
    const o = { radius: 6, material: 'ceramic' as const, friction: 0.4 };
    this.world.addStatic(capsule(L.x0 - 2, L.rimY - 160, L.x0 + 16, L.innerBottom - 6, 6, o));
    this.world.addStatic(capsule(L.x1 + 2, L.rimY - 160, L.x1 - 16, L.innerBottom - 6, 6, o));
    this.world.addStatic(capsule(L.x0 + 18, L.innerBottom, L.x1 - 18, L.innerBottom, 6, o));
    this.layoutSuds();
  }

  /**
   * The screen changed height (the bath stands on its floor, at the bottom of
   * the screen): move everything with the floor. Returns how far it moved.
   */
  relayout(viewH: number): number {
    const dy = viewH - this.viewH;
    if (dy === 0) return 0;
    this.viewH = viewH;
    this.tub = tubLayout(this.top, viewH, this.radius);
    for (const sh of this.world.statics) translateShape(sh, 0, dy);
    const c = this.cat;
    if (c) {
      for (let i = 0; i < c.n; i++) {
        c.y[i] += dy;
        c.py[i] += dy;
      }
      c.computeCentroid();
    }
    for (const w of this.steam) w.y += dy;
    return dy;
  }

  // --- TubSurface (for the floating bubbles) ---

  get x0(): number {
    return this.tub.x0;
  }

  get x1(): number {
    return this.tub.x1;
  }

  get floor(): number {
    return this.tub.footY;
  }

  /** The water's level at x: a slow gentle sway, and rings spreading out from the splash. */
  water(x: number): number {
    const L = this.tub;
    let y = L.waterY + 1.1 * Math.sin(this.t * 1.5 + x * 0.027) + 0.6 * Math.sin(this.t * 2.3 - x * 0.05 + 1.3);
    const age = this.t - this.ripT;
    if (age >= 0 && age < 2.5) {
      const d = Math.abs(x - this.ripX);
      y += this.ripA * Math.exp(-age * 2) * Math.exp(-d / 150) * Math.sin(d * 0.075 - age * 11);
    }
    return y;
  }

  /** The top of the suds on the water at x (lumpy, and thinning toward the tub's ends). */
  surface(x: number): number {
    const L = this.tub;
    const u = (x - L.x0) / (L.x1 - L.x0);
    const ends = Math.min(1, Math.min(u, 1 - u) * 6);
    const lump = 3 * Math.sin(x * 0.083 + 0.6) + 2 * Math.sin(x * 0.21 + 2.1);
    return this.water(x) - (L.suds + lump) * (0.45 + 0.55 * ends);
  }

  // --- stepping ---

  step(): void {
    this.t += FRAME_DT;
    const L = this.tub;
    if (!this.cat && this.t >= BATH.drop) this.dropCat();
    const c = this.cat;
    if (c) {
      c.computeCentroid();
      // the water holds up what is under it, and slows it down (hard, when it is moving fast)
      let under = 0;
      const lift = this.lift * FRAME_DT;
      const drag = Math.exp(-FRAME_DT * 6);
      const calm = this.splashT >= 0 ? Math.exp(-FRAME_DT * 1.6) : 1;
      for (let i = 0; i < c.n; i++) {
        c.vy[i] *= calm;
        if (c.y[i] <= this.water(c.x[i])) continue;
        under++;
        c.vy[i] -= lift;
        c.vx[i] *= drag;
        c.vy[i] *= drag / (1 + 0.03 * Math.abs(c.vy[i]) * FRAME_DT);
      }
      if (this.splashT < 0 && under > 0) {
        this.splashT = this.t;
        const speed = Math.max(0, c.vcy);
        this.ripX = c.cx;
        this.ripT = this.t;
        this.ripA = Math.min(7, 2 + speed / 160);
        this.bump(c.cx, c.p.radius, speed);
        this.events.push({ t: 'splash', x: c.cx, y: L.waterY, speed, size: c.p.radius });
      }
      if (this.splashT < 0 && c.vcy > BATH.terminal) {
        // (falls stay readable)
        const dv = (c.vcy - BATH.terminal) * 0.35;
        for (let i = 0; i < c.n; i++) c.vy[i] -= dv;
      }
      if (this.splashT >= 0) {
        // in the bath: it drifts to the middle and stays upright-ish, calm
        const a = (L.cx - c.cx) * 4 - c.vcx * 3;
        c.assistAx = Math.max(-260, Math.min(260, a));
        if (Math.abs(c.assistAx) < 4) c.assistAx = 0;
      }
      c.wake();
      this.world.step();
      this.world.drainImpacts();
      c.computeCentroid();
      if (this.readyT < 0 && this.splashT >= 0 && this.t - this.splashT > BATH.settle && Math.abs(c.vcy) < 40) this.ready();
      // a while after that, it starts to purr
      if (this.readyT >= 0 && this.t - this.readyT > BATH.purr) this.purring = true;
    }
    if (this.readyT < 0 && this.t > BATH.latest) this.ready();
    this.stepSuds();
    this.stepSteam();
    // now and then the tap drips
    if (this.t > this.plinkAt) {
      this.plinkAt = this.t + 1.6 + this.rnd() * 1.6;
      if (this.clearedTo > L.rimY) this.events.push({ t: 'plink', x: L.tapX, delay: Math.sqrt((2 * Math.max(4, this.surface(L.tapX) - L.tapY)) / 1300) });
    }
  }

  private ready(): void {
    this.readyT = this.t;
    this.events.push({ t: 'ready' });
  }

  /** The cat drops in from above the top of the screen, over the tub, already falling. */
  private dropCat(): void {
    const L = this.tub;
    const r = this.radius;
    // its middle should float a little over the suds (its paws can reach the rim): how much of
    // it the water must hold up for that
    const h = Math.min(r * 0.78, 16 + r * 0.12);
    const under = Math.acos(Math.min(0.95, h / r)) / Math.PI;
    this.lift = GRAVITY / Math.max(0.12, under);
    const c = new SoftBody(this.breed, L.cx + (this.rnd() - 0.5) * 24, this.top - r - 14, { radius: r });
    for (let i = 0; i < c.n; i++) c.vy[i] = BATH.dropSpeed;
    this.cat = this.world.addBody(c);
    this.events.push({ t: 'drop' });
  }

  // --- the painted suds on the water ---

  private layoutSuds(): void {
    const L = this.tub;
    const rnd = this.rnd;
    // behind the cat: a row along the back of the water, a little higher up
    for (let x = L.x0 + 8; x < L.x1 - 6; x += 9 + rnd() * 8) {
      this.suds.push({ x, dy: -3 - rnd() * 5, r: 6 + rnd() * 6, tint: Math.floor(rnd() * 3), front: false, oy: 0, ov: 0 });
    }
    // in front of it: a thick heap, two rows deep (the lower one down to the rim)
    for (let row = 0; row < 2; row++) {
      for (let x = L.x0 + 4 + rnd() * 6; x < L.x1 - 2; x += (row ? 12 : 10) + rnd() * 8) {
        const r = row ? 7 + rnd() * 5 : 6 + rnd() * 7;
        this.suds.push({ x, dy: row ? 10 + rnd() * 5 : rnd() * 4, r, tint: Math.floor(rnd() * 3), front: true, oy: 0, ov: 0 });
      }
    }
  }

  /** The splash shoves the suds near it down and out (they spring back up). */
  private bump(x: number, r: number, speed: number): void {
    const k = Math.min(1, speed / 700);
    for (const s of this.suds) {
      const d = (s.x - x) / (r * 1.6);
      s.ov += 160 * k * Math.exp(-d * d) - 40 * k * Math.exp(-((Math.abs(d) - 1.3) ** 2) * 2);
    }
  }

  private stepSuds(): void {
    const dt = FRAME_DT;
    for (const s of this.suds) {
      s.ov += (-170 * s.oy - 7 * s.ov) * dt;
      s.oy += s.ov * dt;
    }
  }

  // --- steam ---

  private stepSteam(): void {
    const L = this.tub;
    const rnd = this.rnd;
    // (once the foam has cleared off the bath)
    if (this.clearedTo > L.rimY + 30) {
      this.steamOwed += FRAME_DT * 2.2;
      while (this.steamOwed >= 1 && this.steam.length < 18) {
        this.steamOwed--;
        const x = L.x0 + 20 + rnd() * (L.x1 - L.x0 - 40);
        this.steam.push({ x, y: this.surface(x) - 6, vx: (rnd() - 0.5) * 8, age: 0, life: 2.6 + rnd() * 1.6, size: 10 + rnd() * 8, seed: rnd() * 100 });
      }
    }
    for (let k = this.steam.length - 1; k >= 0; k--) {
      const w = this.steam[k];
      w.age += FRAME_DT;
      if (w.age >= w.life) {
        this.steam.splice(k, 1);
        continue;
      }
      w.y -= (16 + 10 * Math.sin(w.seed)) * FRAME_DT;
      w.x += (w.vx + 9 * Math.sin(w.age * 1.7 + w.seed)) * FRAME_DT;
    }
  }
}
