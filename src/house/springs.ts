// The perches that move: the hammock's sling, and the bouncy cushion.
//
// A sling is a chain of points hung between the hammock's two pegs. Its links
// are the colliders the cats lie on, moved every step so the cats ride along
// with it. The cats push back through what they're touching: the points
// under a cat carry its weight (they're as heavy as the cat lying on them,
// so a heavy cat sinks deeper as the cloth stretches), and a cat coming down
// into it, or moving across it, drags them along (so landing in it sends it
// dipping and swinging). Only that much: feeding back all of a cat's speed,
// which the cloth itself has just given it, set them swinging ever wider.
//
// A bouncy cushion is a squashy box: a cat that lands on top of it fast
// enough squashes it down and is sprung back up, a little less high each
// time, until it's sitting on it.

import { capsule, translateShape, updateShapeDerived, type Material, type StaticShape } from '../physics/shapes';
import { NODE_RADIUS, type SoftBody } from '../physics/softbody';

/** Points along a sling, its substeps per frame, and the mass of each point of cloth. */
const N = 9;
const SUB = 14;
const CLOTH = 0.12;
/** Link stiffness (the cloth gives under a cat, and stiffens as it stretches) and damping. */
const STIFF = 420;
const DAMP = 36;
/** How much of a cat's push into the cloth, and of its sideways speed, the points under it take on each frame. */
const PUSH = 0.35;
const DRIFT = 0.12;
/** Air drag on the cloth (per second): it swings a little while. (Cloth is lossy: a hammock cradles a cat, it doesn't bounce it.) */
const DRAG = 0.8;
/** The links' thickness, and how close a cat's skin is to a point of it that it's lying on. */
export const SLING_R = 4;
const TOUCH = SLING_R + NODE_RADIUS + 1.5;

export class Sling {
  readonly n = N;
  readonly x = new Float64Array(N);
  readonly y = new Float64Array(N);
  readonly vx = new Float64Array(N);
  readonly vy = new Float64Array(N);
  /** The cats' mass on each point, and their momentum (mass x speed). */
  private readonly load = new Float64Array(N);
  private readonly loadPx = new Float64Array(N);
  private readonly loadPy = new Float64Array(N);
  private readonly fx = new Float64Array(N);
  private readonly fy = new Float64Array(N);
  private readonly weights = new Float64Array(N);
  /** Frames since each cat last touched it (a big cat's touch flickers as it settles: it's still lying in it). */
  private readonly lastTouch = new Map<SoftBody, { frames: number; share: number }>();
  readonly rest: number;
  readonly links: StaticShape[] = [];
  /** Where it hangs when it's first put up (and goes back to, if it ever comes apart). */
  private readonly homeX: Float64Array;
  private readonly homeY: Float64Array;
  private readonly linkOf = new Map<number, number>();
  /** Frames it has hung still with nothing in it (then it isn't worked out at all). */
  private idle = 0;
  /** Who's lying in it (they ride along, and are kept awake while it moves). */
  riders: SoftBody[] = [];

  /** Hanging still, with nothing in it (it looks as it does at rest). */
  get still(): boolean {
    return this.idle > 60;
  }

  constructor(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    sag: number,
    opts: { friction?: number; material?: Material; propId?: number },
  ) {
    // hung in a curve that dips `sag` under its pegs, at rest like that
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      this.x[i] = ax + (bx - ax) * u;
      this.y[i] = ay + (by - ay) * u + 4 * sag * u * (1 - u);
    }
    let len = 0;
    for (let i = 1; i < N; i++) len += Math.hypot(this.x[i] - this.x[i - 1], this.y[i] - this.y[i - 1]);
    // (a little short, so it hangs about as drawn under its own weight)
    this.rest = (len / (N - 1)) * 0.955;
    this.homeX = Float64Array.from(this.x);
    this.homeY = Float64Array.from(this.y);
    for (let i = 0; i < N - 1; i++) {
      const s = capsule(this.x[i], this.y[i], this.x[i + 1], this.y[i + 1], SLING_R, opts);
      this.links.push(s);
      this.linkOf.set(s.id, i);
    }
  }

  /** The middle of the cloth (where a cat lies). */
  get bottom(): { x: number; y: number } {
    let k = 0;
    for (let i = 1; i < N; i++) if (this.y[i] > this.y[k]) k = i;
    return { x: this.x[k], y: this.y[k] };
  }

  /**
   * Who's in it, from what the cats are touching (or were, a moment ago):
   * each cat's mass, as much of it as rests on the cloth rather than on
   * something else, goes onto the points under its middle, spread over its
   * width, with its momentum. (By where its middle is, which moves smoothly:
   * by which points it touches, which flicker as it settles, the cloth
   * jittered under a big cat.)
   */
  gather(bodies: readonly SoftBody[]): void {
    this.load.fill(0);
    this.loadPx.fill(0);
    this.loadPy.fill(0);
    this.riders = [];
    for (const b of bodies) {
      let total = 0;
      let on = 0;
      for (let i = 0; i < b.n; i++) {
        const sid = b.contactShape[i];
        if (sid === -1) continue;
        total++;
        if (this.linkOf.has(sid)) on++;
      }
      const was = this.lastTouch.get(b);
      if (on) this.lastTouch.set(b, { frames: 0, share: on / total });
      else if (was && was.frames < 6) was.frames++;
      else {
        this.lastTouch.delete(b);
        continue;
      }
      const t = this.lastTouch.get(b)!;
      this.riders.push(b);
      b.computeCentroid();
      const m = b.mass * t.share;
      const half = b.p.radius * 1.1;
      // the points under it: near its middle, and up against its outline
      // (a big cat lying across it bridges the middle of the cloth)
      const w = this.weights;
      let sum = 0;
      for (let i = 1; i < N - 1; i++) {
        let d2 = Infinity;
        for (let k = 0; k < b.n; k++) d2 = Math.min(d2, (b.x[k] - this.x[i]) ** 2 + (b.y[k] - this.y[i]) ** 2);
        const near = Math.max(0, Math.min(1, 1 - (Math.sqrt(d2) - TOUCH) / 8));
        w[i] = Math.max(0, 1 - Math.abs(this.x[i] - b.cx) / half) * near;
        sum += w[i];
      }
      if (sum <= 0) continue;
      for (let i = 1; i < N - 1; i++) {
        if (w[i] <= 0) continue;
        w[i] /= sum;
        this.load[i] += m * w[i];
        this.loadPx[i] += m * w[i] * b.vcx;
        this.loadPy[i] += m * w[i] * b.vcy;
      }
    }
  }

  /** One frame (dt), pulled down by gravity g. Returns how far it moved at most. */
  step(dt: number, g: number): number {
    let loaded = false;
    for (let i = 1; i < N - 1; i++) if (this.load[i] > 0) loaded = true;
    if (!loaded && this.idle > 60) return 0;
    // a cat coming down into it pushes it down; one moving across it drags it along
    for (let i = 1; i < N - 1; i++) {
      const m = this.load[i];
      if (m <= 0) continue;
      const share = m / (CLOTH + m);
      const cvx = this.loadPx[i] / m;
      const cvy = this.loadPy[i] / m;
      if (cvy > this.vy[i]) this.vy[i] += (cvy - this.vy[i]) * share * PUSH;
      this.vx[i] += (cvx - this.vx[i]) * share * DRIFT;
    }
    const h = dt / SUB;
    const x0 = Float64Array.from(this.x);
    const y0 = Float64Array.from(this.y);
    for (let s = 0; s < SUB; s++) {
      for (let i = 0; i < N; i++) {
        this.fx[i] = 0;
        this.fy[i] = (CLOTH + this.load[i]) * g;
      }
      for (let i = 0; i < N - 1; i++) {
        const dx = this.x[i + 1] - this.x[i];
        const dy = this.y[i + 1] - this.y[i];
        const l = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        const ux = dx / l;
        const uy = dy / l;
        // cloth pulls, it doesn't push; and it gives less the more it's stretched
        const stretch = l - this.rest;
        const rel = (this.vx[i + 1] - this.vx[i]) * ux + (this.vy[i + 1] - this.vy[i]) * uy;
        const f = stretch > 0 ? STIFF * stretch * (1 + (stretch * stretch) / 4) + DAMP * rel : Math.max(0, DAMP * rel * 0.2);
        this.fx[i] += f * ux;
        this.fy[i] += f * uy;
        this.fx[i + 1] -= f * ux;
        this.fy[i + 1] -= f * uy;
      }
      const drag = 1 - DRAG * h;
      for (let i = 1; i < N - 1; i++) {
        const m = CLOTH + this.load[i];
        this.vx[i] = (this.vx[i] + (this.fx[i] / m) * h) * drag;
        this.vy[i] = (this.vy[i] + (this.fy[i] / m) * h) * drag;
        this.x[i] += this.vx[i] * h;
        this.y[i] += this.vy[i] * h;
      }
    }
    let moved = 0;
    for (let i = 1; i < N - 1; i++) moved = Math.max(moved, Math.abs(this.x[i] - x0[i]), Math.abs(this.y[i] - y0[i]));
    if (!Number.isFinite(moved)) {
      // (never: but a sling that came apart hangs back up as it was)
      this.x.set(this.homeX);
      this.y.set(this.homeY);
      this.vx.fill(0);
      this.vy.fill(0);
      moved = 0;
    }
    this.idle = !loaded && moved < 0.02 ? this.idle + 1 : 0;
    this.syncShapes();
    // whoever's in it rides along (a cat dozing in it would otherwise hang in the air)
    if (moved > 0.12) for (const b of this.riders) b.wake();
    return moved;
  }

  /** Move the link colliders to where the cloth is. */
  private syncShapes(): void {
    for (let i = 0; i < N - 1; i++) {
      const s = this.links[i];
      const ax = this.x[i];
      const ay = this.y[i];
      const bx = this.x[i + 1];
      const by = this.y[i + 1];
      const l = Math.hypot(bx - ax, by - ay) || 1;
      const px = (-(by - ay) / l) * 0.05;
      const py = ((bx - ax) / l) * 0.05;
      // (the same hair-thin quad as a capsule's, kept wound the same way round)
      const pts = [
        [ax + px, ay + py],
        [bx + px, by + py],
        [bx - px, by - py],
        [ax - px, ay - py],
      ];
      let area = 0;
      for (let i2 = 0, j = 3; i2 < 4; j = i2++) area += pts[j][0] * pts[i2][1] - pts[i2][0] * pts[j][1];
      const order = area >= 0 ? [0, 1, 2, 3] : [3, 2, 1, 0];
      for (let k = 0; k < 4; k++) {
        s.xs[k] = pts[order[k]][0];
        s.ys[k] = pts[order[k]][1];
      }
      updateShapeDerived(s);
    }
  }
}

/** How much of a bouncy cushion's height its squash takes (art and collider agree). */
export const BOUNCE_GIVE = 0.6;
/** Of a cat's landing speed, how much the cushion gives back; slower than this and it just sits. */
const RESTITUTION = 0.86;
const MIN_BOUNCE = 230;

export interface Boing {
  body: SoftBody;
  /** How fast it landed. */
  speed: number;
}

export class Bouncer {
  /** Squash (0 at rest, + pressed down), and how fast it's changing. */
  squash = 0;
  vel = 0;
  private sunk = 0;
  private hitAt = -999;
  private pending: { body: SoftBody; speed: number; at: number } | null = null;
  private frame = 0;

  constructor(
    /** The cushion's collider (its top sinks with the squash). */
    readonly top: StaticShape,
    readonly x: number,
    readonly y: number,
    readonly w: number,
    readonly h: number,
  ) {}

  /**
   * One frame: a cat that landed on top (fast enough: `fell` is how fast it
   * was coming down the frame before) squashes it, and a moment later is
   * sprung back up. `free` says whether a cat may bounce (not held, riding a
   * tube, leaping...). Returns a landing, for its boing.
   */
  step(bodies: readonly SoftBody[], free: (b: SoftBody) => boolean, fell: (b: SoftBody) => number): Boing | null {
    this.frame++;
    let hit: Boing | null = null;
    if (this.frame - this.hitAt > 10) {
      for (const b of bodies) {
        let touching = false;
        for (let i = 0; i < b.n && !touching; i++) if (b.contactShape[i] === this.top.id) touching = true;
        const speed = fell(b);
        if (!touching || speed < 140 || !free(b)) continue;
        b.computeCentroid();
        // only one landing on top (one brushing past its side just slides off)
        if (b.cy > this.y + 2 || b.cx < this.x - this.w / 2 - 4 || b.cx > this.x + this.w / 2 + 4) continue;
        this.hitAt = this.frame;
        this.vel += 4 + speed / 110;
        this.pending = { body: b, speed, at: this.frame + 4 };
        hit = { body: b, speed };
        break;
      }
    }
    const p = this.pending;
    if (p && this.frame >= p.at) {
      this.pending = null;
      const out = p.speed * RESTITUTION;
      if (out >= MIN_BOUNCE && free(p.body)) {
        const b = p.body;
        b.computeCentroid();
        // straight back up, and a little toward the middle (it's a springy hump: off its edge, it'd shoot you sideways)
        const vx = (this.x - b.cx) * 1.6;
        const vy = -out;
        // and whoever's lying on it goes up with it, just as fast: sprung up
        // alone, it would be shot up into them and come out the other side
        for (const o of [b, ...stackedOn(b, bodies, free)]) {
          o.computeCentroid();
          o.kick(vx - o.vcx, vy - o.vcy);
        }
      }
    }
    // a springy squash: stiff, lightly damped
    if (this.squash !== 0 || this.vel !== 0) {
      this.vel += (-this.squash * 260 - this.vel * 9) / 60;
      this.squash += this.vel / 60;
      if (Math.abs(this.squash) < 0.002 && Math.abs(this.vel) < 0.02) {
        this.squash = 0;
        this.vel = 0;
      }
    }
    // the top of the collider follows the squash down (and back up)
    const sunk = Math.max(0, Math.min(0.45, this.squash)) * this.h * BOUNCE_GIVE;
    if (sunk !== this.sunk) {
      translateShape(this.top, 0, sunk - this.sunk);
      this.sunk = sunk;
    }
    return hit;
  }
}

/** The bodies lying on b (touching its top half), and those lying on them. */
function stackedOn(b: SoftBody, bodies: readonly SoftBody[], free: (b: SoftBody) => boolean): SoftBody[] {
  const out: SoftBody[] = [];
  const queue = [b];
  const bb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const ob = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  while (queue.length) {
    const under = queue.pop()!;
    under.bounds(bb);
    under.computeCentroid();
    for (const o of bodies) {
      if (o === b || out.includes(o) || !free(o)) continue;
      o.bounds(ob);
      o.computeCentroid();
      // (above its middle, and near enough to be resting on it)
      if (o.cy >= under.cy || ob.maxX < bb.minX || ob.minX > bb.maxX || ob.maxY < bb.minY - 2 || ob.minY > bb.maxY) continue;
      let near = false;
      for (let i = 0; i < o.n && !near; i++) {
        for (let j = 0; j < under.n; j++) {
          const dx = o.x[i] - under.x[j];
          const dy = o.y[i] - under.y[j];
          if (dx * dx + dy * dy < 64) {
            near = true;
            break;
          }
        }
      }
      if (!near) continue;
      out.push(o);
      queue.push(o);
    }
  }
  return out;
}
