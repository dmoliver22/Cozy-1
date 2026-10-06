// Riding the tubes. A cat let go under a suction hood (or one that falls into
// the funnel in the living room floor) is drawn into the glass: it stretches
// into the mouth, squeezes into a sausage as wide as the bore and slides
// through to the other end, where it pops out round again ("blop") and
// lands. It's done by moving the cat's own outline, so it's drawn like any
// other cat, just very long; while it's in the tube it's out of the physics
// world, and when it comes out it goes back in with the speed it came out at.

import type { Cat } from '../game/session';
import type { World } from '../physics/world';
import { FRAME_DT } from '../physics/world';
import { pathLength, pointAt, type Mouth, type Tube } from './layout';

type Pt = [number, number];

export interface Transit {
  cat: Cat;
  tube: Tube;
  /** Up the tube (from its lower mouth to its upper one), or down. */
  up: boolean;
  phase: 'in' | 'go' | 'out';
  /** Seconds into the phase. */
  t: number;
  /** The way it goes: from where the cat was, through the tube and on out of the far mouth (extended straight at both ends). */
  route: Pt[];
  /** Arc lengths along the route: where it starts, the mouths it goes in and out of, and the end. */
  s0: number;
  sIn: number;
  sOut: number;
  /** Where the sausage's middle is now. */
  s: number;
  /** The sausage: how long, how wide. */
  len: number;
  bore: number;
  /** Node i sits at outline position (i * dir + k) / n. */
  k: number;
  dir: number;
  /** Where the cat was when it went in (its outline), and where it's going to be when it comes out. */
  from: Float64Array;
  out: Float64Array;
  exit: Mouth;
  /** How long the ride through the glass takes. */
  goTime: number;
}

export type TubeEvent = { t: 'in'; cat: Cat; tube: Tube; up: boolean } | { t: 'out'; cat: Cat; tube: Tube; up: boolean; x: number; y: number };

const IN_TIME = 0.26;
const FUNNEL_IN_TIME = 0.18;
const OUT_TIME = 0.15;

/** Outline point u (0..1) of a sausage `len` long and `w` wide whose middle is at arc length m along a route. */
function sausagePoint(route: Pt[], m: number, len: number, w: number, u: number): Pt {
  const straight = Math.max(0, len - w);
  const cap = (Math.PI * w) / 2;
  const P = 2 * straight + 2 * cap;
  let d = (((u % 1) + 1) % 1) * P;
  const st = m - straight / 2;
  const sh = m + straight / 2;
  const h = w / 2;
  if (d < straight) {
    // along one side, tail to head
    const p = pointAt(route, st + d);
    return [p.x - p.ty * h, p.y + p.tx * h];
  }
  d -= straight;
  if (d < cap) {
    // round the head
    const p = pointAt(route, sh);
    const a = (d / cap) * Math.PI;
    const nx = -p.ty;
    const ny = p.tx;
    return [p.x + (nx * Math.cos(a) + p.tx * Math.sin(a)) * h, p.y + (ny * Math.cos(a) + p.ty * Math.sin(a)) * h];
  }
  d -= cap;
  if (d < straight) {
    // back along the other side
    const p = pointAt(route, sh - d);
    return [p.x + p.ty * h, p.y - p.tx * h];
  }
  d -= straight;
  // round the tail
  const p = pointAt(route, st);
  const a = (d / cap) * Math.PI;
  const nx = p.ty;
  const ny = -p.tx;
  return [p.x + (nx * Math.cos(a) - p.tx * Math.sin(a)) * h, p.y + (ny * Math.cos(a) - p.ty * Math.sin(a)) * h];
}

function signedArea(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number): number {
  let a = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a += xs[j] * ys[i] - xs[i] * ys[j];
  return a / 2;
}

const ease = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const easeIn = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u);

export class Tubes {
  readonly transits: Transit[] = [];
  private events: TubeEvent[] = [];

  constructor(private readonly world: () => World) {}

  /** Is this cat in a tube (or on its way in or out)? */
  riding(cat: Cat): Transit | null {
    return this.transits.find((t) => t.cat === cat) ?? null;
  }

  /**
   * The mouth a cat let go at (x, y) goes into, if any: one of `tubes`
   * (the ones that are in), on the floor it's on.
   */
  static mouthAt(tubes: readonly Tube[], x: number, y: number, kind: Mouth['kind'] | null = null): { tube: Tube; up: boolean } | null {
    for (const tube of tubes) {
      for (const [m, up] of [
        [tube.lower, true],
        [tube.upper, false],
      ] as const) {
        if (kind && m.kind !== kind) continue;
        const z = m.zone;
        if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return { tube, up };
      }
    }
    return null;
  }

  /** Send a cat into a tube (up: in at its lower mouth). */
  start(cat: Cat, tube: Tube, up: boolean): void {
    if (this.riding(cat)) return;
    const b = cat.body;
    b.computeCentroid();
    const n = b.n;
    const exit = up ? tube.upper : tube.lower;
    const glass = up ? [...tube.path].reverse() : tube.path;
    // the sausage: the cat's area in the bore's width
    const w = tube.bore;
    const area = Math.abs(signedArea(b.x, b.y, n));
    const len = Math.max(w * 1.15, (area - (Math.PI * w * w) / 4) / w + w);
    // the route, with room for the sausage beyond either end
    const start: Pt = [b.cx, b.cy];
    const first = glass[0];
    let dx = first[0] - start[0];
    let dy = first[1] - start[1];
    let dl = Math.hypot(dx, dy);
    if (dl < 1) {
      dx = glass[1][0] - first[0];
      dy = glass[1][1] - first[1];
      dl = Math.hypot(dx, dy) || 1;
    }
    const before: Pt = [start[0] - (dx / dl) * len, start[1] - (dy / dl) * len];
    const last = glass[glass.length - 1];
    const ex = exit.dirX / Math.hypot(exit.dirX, exit.dirY);
    const ey = exit.dirY / Math.hypot(exit.dirX, exit.dirY);
    const after: Pt = [last[0] + ex * len * 2, last[1] + ey * len * 2];
    const route: Pt[] = [before, start, ...glass, after];
    const s0 = len;
    const sIn = s0 + Math.hypot(first[0] - start[0], first[1] - start[1]);
    const sOut = sIn + pathLength(glass);
    // which outline point each node goes to: keep the cat's ring turning the
    // same way, and start where the nodes are nearest (so nothing crosses)
    const from = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      from[i * 2] = b.x[i];
      from[i * 2 + 1] = b.y[i];
    }
    const sx = new Float64Array(n);
    const sy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = sausagePoint(route, s0, len, w, i / n);
      sx[i] = p[0];
      sy[i] = p[1];
    }
    const dir = Math.sign(signedArea(b.x, b.y, n)) === Math.sign(signedArea(sx, sy, n)) ? 1 : -1;
    let k = 0;
    let best = Infinity;
    for (let kk = 0; kk < n; kk++) {
      let d2 = 0;
      for (let i = 0; i < n; i++) {
        const j = (((i * dir + kk) % n) + n) % n;
        const ddx = sx[j] - b.x[i];
        const ddy = sy[j] - b.y[i];
        d2 += ddx * ddx + ddy * ddy;
      }
      if (d2 < best) {
        best = d2;
        k = kk;
      }
    }
    if (b.grab) b.releaseGrab();
    this.world().removeBody(b);
    const glassLen = sOut - sIn;
    this.transits.push({
      cat,
      tube,
      up,
      phase: 'in',
      t: 0,
      route,
      s0,
      sIn,
      sOut,
      s: s0,
      len,
      bore: w,
      k,
      dir,
      from,
      out: new Float64Array(n * 2),
      exit,
      goTime: Math.max(0.55, glassLen / 640),
    });
    this.events.push({ t: 'in', cat, tube, up });
  }

  /** Put a cat's outline on the sausage with its middle at arc length m (blended with `from` by 1 - wIn). */
  private shape(tr: Transit, m: number, wIn: number): void {
    const b = tr.cat.body;
    const n = b.n;
    for (let i = 0; i < n; i++) {
      const j = (((i * tr.dir + tr.k) % n) + n) % n;
      const p = sausagePoint(tr.route, m, tr.len, tr.bore, j / n);
      b.x[i] = tr.from[i * 2] + (p[0] - tr.from[i * 2]) * wIn;
      b.y[i] = tr.from[i * 2 + 1] + (p[1] - tr.from[i * 2 + 1]) * wIn;
    }
  }

  /** One fixed step of every ride. */
  step(): void {
    const dt = FRAME_DT;
    for (const tr of [...this.transits]) {
      tr.t += dt;
      const b = tr.cat.body;
      const n = b.n;
      if (tr.phase === 'in') {
        const T = tr.tube.id === 'chute' && !tr.up ? FUNNEL_IN_TIME : IN_TIME;
        const u = Math.min(1, tr.t / T);
        tr.s = tr.s0 + (tr.sIn - tr.s0) * easeIn(u);
        this.shape(tr, tr.s, ease(u));
        if (u >= 1) {
          tr.phase = 'go';
          tr.t = 0;
        }
      } else if (tr.phase === 'go') {
        const u = Math.min(1, tr.t / tr.goTime);
        // speeding up out of the mouth, slowing a touch toward the far one
        const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
        tr.s = tr.sIn + (tr.sOut - tr.sIn) * (0.15 * u + 0.85 * e);
        this.shape(tr, tr.s, 1);
        if (u >= 1) this.toOut(tr);
      } else {
        const u = Math.min(1, tr.t / OUT_TIME);
        const e = ease(u);
        for (let i = 0; i < n; i++) {
          b.x[i] = tr.from[i * 2] + (tr.out[i * 2] - tr.from[i * 2]) * e;
          b.y[i] = tr.from[i * 2 + 1] + (tr.out[i * 2 + 1] - tr.from[i * 2 + 1]) * e;
        }
        if (u >= 1) this.finish(tr);
      }
    }
  }

  /** At the far mouth: from here it pops out round, just clear of the mouth. */
  private toOut(tr: Transit): void {
    const b = tr.cat.body;
    const n = b.n;
    tr.phase = 'out';
    tr.t = 0;
    const r = b.p.radius;
    const l = Math.hypot(tr.exit.dirX, tr.exit.dirY) || 1;
    const cx = tr.exit.x + (tr.exit.dirX / l) * (r + 6);
    const cy = tr.exit.y + (tr.exit.dirY / l) * (r + 6);
    // the ring's turn that's nearest the sausage's nodes as they are
    let best = Infinity;
    let a0 = 0;
    const turn = Math.sign(signedArea(b.x, b.y, n)) || 1;
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      let d2 = 0;
      for (let i = 0; i < n; i += 2) {
        const ai = a + turn * (i / n) * Math.PI * 2;
        const ddx = cx + Math.cos(ai) * r - b.x[i];
        const ddy = cy + Math.sin(ai) * r - b.y[i];
        d2 += ddx * ddx + ddy * ddy;
      }
      if (d2 < best) {
        best = d2;
        a0 = a;
      }
    }
    for (let i = 0; i < n; i++) {
      const ai = a0 + turn * (i / n) * Math.PI * 2;
      tr.out[i * 2] = cx + Math.cos(ai) * r;
      tr.out[i * 2 + 1] = cy + Math.sin(ai) * r;
      tr.from[i * 2] = b.x[i];
      tr.from[i * 2 + 1] = b.y[i];
    }
  }

  /** Out of the far mouth and back into the world, moving the way the mouth points. */
  private finish(tr: Transit): void {
    const b = tr.cat.body;
    const m = tr.exit;
    const l = Math.hypot(m.dirX, m.dirY) || 1;
    const vx = (m.dirX / l) * m.speed;
    const vy = (m.dirY / l) * m.speed;
    for (let i = 0; i < b.n; i++) {
      b.px[i] = b.x[i];
      b.py[i] = b.y[i];
      b.vx[i] = vx;
      b.vy[i] = vy;
    }
    b.loafiness = 0;
    b.held.fill(0);
    b.wake();
    b.computeCentroid();
    this.world().addBody(b);
    tr.cat.sinceTouch = 0;
    tr.cat.settled = 0;
    tr.cat.intent = null;
    this.transits.splice(this.transits.indexOf(tr), 1);
    this.events.push({ t: 'out', cat: tr.cat, tube: tr.tube, up: tr.up, x: b.cx, y: b.cy });
  }

  /** Everyone still riding comes straight out at the far end (leaving the house mid-ride). */
  finishAll(): void {
    for (const tr of [...this.transits]) {
      if (tr.phase !== 'out') {
        this.shape(tr, tr.sOut, 1);
        this.toOut(tr);
      }
      const b = tr.cat.body;
      for (let i = 0; i < b.n; i++) {
        b.x[i] = tr.out[i * 2];
        b.y[i] = tr.out[i * 2 + 1];
      }
      this.finish(tr);
    }
  }

  drain(): TubeEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
