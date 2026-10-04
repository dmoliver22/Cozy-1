// Shared bits for the prototype games built on the If It Fits engine (Cat Jar,
// Cat Drop): a DPR-aware canvas, a fixed-step loop that draws between physics
// steps, pointer input that tells taps from drags, a cat painter that keeps one
// CatView per body, and a few small helpers.

import type { AudioEngine } from '../audio/audio';
import { CatView, drawCat, type CatLayer, type CatPose, type Expression } from '../render/catArt';
import type { Ctx } from '../render/paint';
import { NODE_RADIUS, type SoftBody } from '../physics/softbody';
import { FRAME_DT } from '../physics/world';

// ---------------------------------------------------------------------------
// Canvas

export interface Stage {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
  /** Size in CSS pixels. */
  w: number;
  h: number;
  dpr: number;
  /** Re-measure (called automatically on resize). */
  resize(): void;
  /** Draw in world units: screen = (world - origin) * scale + offset (CSS px). */
  world(scale: number, ox: number, oy: number): void;
  /** Draw in CSS pixels. */
  screen(): void;
}

export function makeStage(canvas: HTMLCanvasElement, onResize?: () => void): Stage {
  const ctx = canvas.getContext('2d')!;
  const stage: Stage = {
    canvas,
    ctx,
    w: 0,
    h: 0,
    dpr: 1,
    resize() {
      const r = canvas.getBoundingClientRect();
      stage.dpr = Math.min(3, window.devicePixelRatio || 1);
      stage.w = Math.max(1, r.width);
      stage.h = Math.max(1, r.height);
      canvas.width = Math.round(stage.w * stage.dpr);
      canvas.height = Math.round(stage.h * stage.dpr);
      onResize?.();
    },
    world(scale, ox, oy) {
      const d = stage.dpr;
      ctx.setTransform(d * scale, 0, 0, d * scale, d * ox, d * oy);
    },
    screen() {
      const d = stage.dpr;
      ctx.setTransform(d, 0, 0, d, 0, 0);
    },
  };
  stage.resize();
  window.addEventListener('resize', () => stage.resize());
  return stage;
}

// ---------------------------------------------------------------------------
// Loop

/**
 * Fixed 60 Hz physics with drawing in between: `step()` runs 0-4 times per
 * animation frame, then `draw(alpha, dt)` where alpha (0..1) is how far we are
 * between the last two steps (use it with Lerp for smooth 90/120 Hz motion).
 */
export class Loop {
  paused = false;
  private acc = 0;
  private last = 0;
  private running = false;

  constructor(
    private readonly step: () => void,
    private readonly draw: (alpha: number, dt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = (t: number): void => {
      if (!this.running) return;
      requestAnimationFrame(tick);
      const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : FRAME_DT;
      this.last = t;
      if (!this.paused) {
        this.acc += dt;
        let n = 0;
        while (this.acc >= FRAME_DT && n < 4) {
          this.step();
          this.acc -= FRAME_DT;
          n++;
        }
        if (n === 4) this.acc = 0;
      }
      this.draw(Math.min(1, this.acc / FRAME_DT), this.paused ? 0 : dt);
    };
    requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
  }
}

/**
 * Draw bodies between their last two physics positions. Call remember() just
 * before each physics step, begin(alpha) before drawing and end() after.
 */
export class Lerp {
  private readonly from = new Map<SoftBody, { x: Float64Array; y: Float64Array }>();
  private readonly saved: { b: SoftBody; x: Float64Array; y: Float64Array }[] = [];

  remember(bodies: Iterable<SoftBody>): void {
    for (const b of bodies) {
      let f = this.from.get(b);
      if (!f || f.x.length !== b.n) {
        f = { x: new Float64Array(b.n), y: new Float64Array(b.n) };
        this.from.set(b, f);
      }
      f.x.set(b.x);
      f.y.set(b.y);
    }
  }

  begin(bodies: Iterable<SoftBody>, alpha: number): void {
    this.saved.length = 0;
    if (alpha >= 1) return;
    for (const b of bodies) {
      const f = this.from.get(b);
      if (!f || f.x.length !== b.n) continue;
      // a teleport (respawn, merge) shouldn't smear
      const jx = b.x[0] - f.x[0];
      const jy = b.y[0] - f.y[0];
      if (jx * jx + jy * jy > 40 * 40) continue;
      this.saved.push({ b, x: Float64Array.from(b.x), y: Float64Array.from(b.y) });
      for (let i = 0; i < b.n; i++) {
        b.x[i] = f.x[i] + (b.x[i] - f.x[i]) * alpha;
        b.y[i] = f.y[i] + (b.y[i] - f.y[i]) * alpha;
      }
    }
  }

  end(): void {
    for (const s of this.saved) {
      s.b.x.set(s.x);
      s.b.y.set(s.y);
    }
    this.saved.length = 0;
  }

  forget(b: SoftBody): void {
    this.from.delete(b);
  }
}

// ---------------------------------------------------------------------------
// Pointer

export interface PointerInfo {
  /** Short press without much movement. */
  tap: boolean;
  /** Seconds the pointer was down. */
  dur: number;
  /** Largest distance (CSS px) from where it went down. */
  dist: number;
}

export interface PointerHandlers {
  down?(x: number, y: number): void;
  move?(x: number, y: number): void;
  up?(x: number, y: number, info: PointerInfo): void;
}

/** One-finger input in CSS pixels relative to `el`, with tap detection. */
export function bindPointer(el: HTMLElement, h: PointerHandlers): void {
  let id = -1;
  let x0 = 0;
  let y0 = 0;
  let t0 = 0;
  let far = 0;
  const pos = (e: PointerEvent): [number, number] => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  el.addEventListener('pointerdown', (e) => {
    if (id !== -1) return;
    id = e.pointerId;
    el.setPointerCapture(e.pointerId);
    [x0, y0] = pos(e);
    t0 = performance.now();
    far = 0;
    h.down?.(x0, y0);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const [x, y] = pos(e);
    far = Math.max(far, Math.hypot(x - x0, y - y0));
    h.move?.(x, y);
  });
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== id) return;
    id = -1;
    const [x, y] = pos(e);
    far = Math.max(far, Math.hypot(x - x0, y - y0));
    const dur = (performance.now() - t0) / 1000;
    h.up?.(x, y, { tap: e.type === 'pointerup' && dur < 0.28 && far < 10, dur, dist: far });
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/** Unlock Web Audio on the first gesture (browsers start it muted). */
export function unlockAudioOnGesture(audio: AudioEngine): void {
  const go = (): void => audio.unlock();
  window.addEventListener('pointerdown', go, { capture: true });
  window.addEventListener('keydown', go, { capture: true });
}

// ---------------------------------------------------------------------------
// Cats

export interface CatLook {
  expression?: Expression;
  /** -1..1 where the eyes look. */
  look?: number;
  grabbed?: boolean;
  /** Paws tucked in front (sitting on something). */
  resting?: boolean;
  /** 0..1 ear wiggle. */
  purr?: number;
  /** 0..1 golden glow. */
  glow?: number;
}

/** Keeps a CatView per body (ears, blinks, breathing are stateful) and paints it. */
export class CatPainter {
  private readonly views = new Map<SoftBody, CatView>();
  private seed = 1;

  view(b: SoftBody): CatView {
    let v = this.views.get(b);
    if (!v || v.ox.length !== b.n) {
      v = new CatView(b.n, this.seed++ * 7919);
      this.views.set(b, v);
    }
    return v;
  }

  /** Advance every view's clock (blinks, twitches); call once per drawn frame. */
  tick(dt: number): void {
    for (const v of this.views.values()) v.update(dt);
  }

  draw(ctx: Ctx, b: SoftBody, look: CatLook = {}, layer: CatLayer = 'all'): void {
    const pose: CatPose = {
      expression: look.expression ?? 'open',
      look: look.look ?? 0,
      rim: null,
      seated: false,
      resting: look.resting ?? false,
      purr: look.purr ?? 0,
      grabbed: look.grabbed ?? false,
      glow: look.glow ?? 0,
    };
    drawCat(ctx, b, this.view(b), pose, 1, layer);
  }

  forget(b: SoftBody): void {
    this.views.delete(b);
  }

  /** Head anchor of the last drawn frame (for effects that pop out of a cat). */
  head(b: SoftBody): { x: number; y: number } {
    const v = this.view(b);
    return { x: v.hx, y: v.hy };
  }
}

/** Do two cats touch (skins within `gap` of each other, default a hair over touching)? */
export function bodiesTouch(a: SoftBody, b: SoftBody, gap = NODE_RADIUS * 2 + 1.5): boolean {
  const ba = bbox(a);
  const bb = bbox(b);
  if (ba.x1 + gap < bb.x0 || bb.x1 + gap < ba.x0 || ba.y1 + gap < bb.y0 || bb.y1 + gap < ba.y0) return false;
  return nodesNear(a, b, bb, gap) || nodesNear(b, a, ba, gap);
}

function bbox(b: SoftBody): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < b.n; i++) {
    if (b.x[i] < x0) x0 = b.x[i];
    if (b.x[i] > x1) x1 = b.x[i];
    if (b.y[i] < y0) y0 = b.y[i];
    if (b.y[i] > y1) y1 = b.y[i];
  }
  return { x0, y0, x1, y1 };
}

function nodesNear(a: SoftBody, b: SoftBody, box: { x0: number; y0: number; x1: number; y1: number }, gap: number): boolean {
  const g2 = gap * gap;
  for (let i = 0; i < a.n; i++) {
    const px = a.x[i];
    const py = a.y[i];
    if (px < box.x0 - gap || px > box.x1 + gap || py < box.y0 - gap || py > box.y1 + gap) continue;
    for (let k = 0, j = b.n - 1; k < b.n; j = k++) {
      const ex = b.x[k] - b.x[j];
      const ey = b.y[k] - b.y[j];
      const l2 = ex * ex + ey * ey;
      let t = l2 > 1e-12 ? ((px - b.x[j]) * ex + (py - b.y[j]) * ey) / l2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const dx = b.x[j] + ex * t - px;
      const dy = b.y[j] + ey * t - py;
      if (dx * dx + dy * dy < g2) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Small helpers

/** Deterministic PRNG (mulberry32): the same seed gives the same game. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed for today's date (local time), shared by everyone playing today. */
export function todaySeed(d = new Date()): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** Best score per game, kept in this browser (localStorage may be unavailable). */
export function loadBest(key: string): number {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    // private mode: fine
  }
}
