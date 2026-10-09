// The Playground's toys: things that make the cats do things. A cannon (let
// a cat go at its mouth and it's loaded, the cannon trembles, and pomf! out
// it flies, the way the cannon's aimed); a fan (it blows cats along its
// wind: an upward one floats a cat in the air); a bumper (a cat that touches
// it is bounced off, ding, like a pinball); and a conveyor belt (a platform
// that carries a cat sitting on it along). Each is built, moved, aimed and
// taken away like any piece (layout.ts). Geometry and what they do to the
// cats; the art is gadgetArt.ts.

import type { Cat } from '../game/session';
import type { Surface } from '../game/props';
import { capsule, roundedBox, type StaticShape } from '../physics/shapes';
import type { SoftBody } from '../physics/softbody';
import { FRAME_DT, type World } from '../physics/world';

export type GadgetKind = 'cannon' | 'funnel' | 'fan' | 'bumper' | 'belt';

export interface GadgetSpec {
  name: string;
  blurb: string;
  /** Which way it can be aimed: anywhere up (a cannon), anywhere (a fan), left or right (a belt), or not at all. */
  aim: 'up' | 'any' | 'side' | null;
  /** Which way it's aimed to begin with (degrees: 0 right, -90 up). */
  aim0: number;
}

export const GADGETS: Record<GadgetKind, GadgetSpec> = {
  cannon: { name: 'Cat cannon', blurb: 'Let a cat go at its mouth: it trembles, and pomf! Out it flies, the way it’s aimed', aim: 'up', aim0: -50 },
  fan: { name: 'Fan', blurb: 'Blows cats along: point it up, and a cat floats on its wind', aim: 'any', aim0: -90 },
  funnel: { name: 'Funnel', blurb: 'A wide glass mouth that draws cats in: put its spout on the end of a tube and it catches cats for it, or pour one right through', aim: 'any', aim0: -90 },
  bumper: { name: 'Bumper', blurb: 'Ding! A cat that touches it is bounced off, like a pinball', aim: null, aim0: 0 },
  belt: { name: 'Conveyor belt', blurb: 'A moving platform: a cat sitting on it gets carried along', aim: 'side', aim0: 0 },
};
export const GADGET_ORDER: GadgetKind[] = ['cannon', 'funnel', 'fan', 'bumper', 'belt'];

export function isGadget(kind: string): kind is GadgetKind {
  return kind in GADGETS;
}

/** A toy up in the sky: where it is (a belt: its top's middle; the others, their middle), and which way it's aimed. */
export interface Gadget {
  id: number;
  kind: GadgetKind;
  x: number;
  y: number;
  aim: number;
}

/** Sizes: the cannon's barrel (from its pivot back, and on to the muzzle; its radius) and its cart; the fan's housing and its wind; the bumper; the belt. */
export const CANNON = { back: 22, fore: 56, r: 19, cart: 30, speed: 1250, wait: 0.55, reach: 34 };
export const FAN = { r: 30, reach: 460, half: 58, push: 2600, drag: 2.4 };
export const BUMPER = { r: 24, kick: 760 };
export const BELT = { half: 75, h: 20, speed: 230 };
/** The funnel: half as wide at its spout as a tube's bell, half as wide at its mouth, how far apart they are; how hard it draws a cat in (gravity's 1100), and how near a tube's end its spout goes onto it. */
export const FUNNEL = { spout: 25, mouth: 78, len: 95, pull: 1900, snap: 70 };

/** How tall a toy that stands on something is, from where it's put (its middle) down to its foot (a cannon's cart), or 0. */
export const gadgetFoot = (kind: GadgetKind): number => (kind === 'cannon' ? CANNON.cart : 0);

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Which way a toy's aimed, as a direction (a belt: straight along, left or right). */
export function aimDir(g: Pick<Gadget, 'kind' | 'aim'>): { x: number; y: number } {
  if (g.kind === 'belt') return { x: Math.cos(rad(g.aim)) < 0 ? -1 : 1, y: 0 };
  return { x: Math.cos(rad(g.aim)), y: Math.sin(rad(g.aim)) };
}

/** An aim made right for a toy: a cannon's anywhere up (and level), a belt's left or right, in steps of 15°. */
export function fitAim(kind: GadgetKind, deg: number): number {
  const spec = GADGETS[kind];
  if (!spec.aim) return 0;
  let a = ((((deg + 180) % 360) + 360) % 360) - 180;
  if (spec.aim === 'side') return Math.cos(rad(a)) < 0 ? 180 : 0;
  // (a funnel goes on a tube's end whichever way that points)
  if (kind === 'funnel') return Math.round(a) === 180 ? -180 : Math.round(a);
  a = Math.round(a / 15) * 15;
  if (spec.aim === 'up') {
    // (pointing down: it'd shoot into its own cart)
    if (a > 0) a = a > 90 ? -180 : 0;
  }
  return a === 180 ? -180 : a;
}

/** Where a cannon's muzzle is, and the reach in front of it where a cat is loaded. */
export function cannonMouth(g: Pick<Gadget, 'x' | 'y' | 'aim'>): { x: number; y: number; zx: number; zy: number } {
  const d = { x: Math.cos(rad(g.aim)), y: Math.sin(rad(g.aim)) };
  return { x: g.x + d.x * CANNON.fore, y: g.y + d.y * CANNON.fore, zx: g.x + d.x * (CANNON.fore + 14), zy: g.y + d.y * (CANNON.fore + 14) };
}

/** What a toy covers (as painted). */
export function gadgetBox(g: Pick<Gadget, 'kind' | 'x' | 'y' | 'aim'>): { x0: number; y0: number; x1: number; y1: number } {
  const { x, y } = g;
  switch (g.kind) {
    case 'cannon': {
      const d = { x: Math.cos(rad(g.aim)), y: Math.sin(rad(g.aim)) };
      const ends = [
        [x + d.x * CANNON.fore, y + d.y * CANNON.fore],
        [x - d.x * CANNON.back, y - d.y * CANNON.back],
      ];
      const pad = CANNON.r + 4;
      return {
        x0: Math.min(x - 34, ...ends.map((e) => e[0] - pad)),
        y0: Math.min(y - 30, ...ends.map((e) => e[1] - pad)),
        x1: Math.max(x + 34, ...ends.map((e) => e[0] + pad)),
        y1: y + CANNON.cart + 2,
      };
    }
    case 'funnel': {
      const c = funnelCorners(g);
      const xs = c.map((q) => q[0]);
      const ys = c.map((q) => q[1]);
      return { x0: Math.min(...xs) - 8, y0: Math.min(...ys) - 8, x1: Math.max(...xs) + 8, y1: Math.max(...ys) + 8 };
    }
    case 'fan':
      return { x0: x - FAN.r - 8, y0: y - FAN.r - 8, x1: x + FAN.r + 8, y1: y + FAN.r + 8 };
    case 'bumper':
      return { x0: x - BUMPER.r - 6, y0: y - BUMPER.r - 6, x1: x + BUMPER.r + 6, y1: y + BUMPER.r + 6 };
    case 'belt':
      return { x0: x - BELT.half - 6, y0: y - 4, x1: x + BELT.half + 6, y1: y + BELT.h + 4 };
  }
}

/** A funnel's corners: its spout's two sides, then its mouth's (in the same order across). */
export function funnelCorners(g: Pick<Gadget, 'x' | 'y' | 'aim'>): [number, number][] {
  const d = { x: Math.cos(rad(g.aim)), y: Math.sin(rad(g.aim)) };
  const p = { x: -d.y, y: d.x };
  const { spout, mouth, len } = FUNNEL;
  return [
    [g.x - p.x * spout, g.y - p.y * spout],
    [g.x + p.x * spout, g.y + p.y * spout],
    [g.x + d.x * len + p.x * mouth, g.y + d.y * len + p.y * mouth],
    [g.x + d.x * len - p.x * mouth, g.y + d.y * len - p.y * mouth],
  ];
}

/** Is (x, y) in a funnel (between its sides, from just past its spout to its mouth; `pad`: a little more all round)? */
export function inFunnel(g: Pick<Gadget, 'x' | 'y' | 'aim'>, x: number, y: number, pad = 4): boolean {
  const d = { x: Math.cos(rad(g.aim)), y: Math.sin(rad(g.aim)) };
  const rx = x - g.x;
  const ry = y - g.y;
  const u = rx * d.x + ry * d.y;
  const v = -rx * d.y + ry * d.x;
  if (u < -pad || u > FUNNEL.len + pad) return false;
  const hw = FUNNEL.spout + ((FUNNEL.mouth - FUNNEL.spout) * Math.max(0, Math.min(FUNNEL.len, u))) / FUNNEL.len;
  return Math.abs(v) < hw + pad;
}

/** A toy's colliders (carrying propId). */
export function gadgetShapes(g: Gadget, propId: number): StaticShape[] {
  const { x, y } = g;
  const metal = { material: 'ceramic' as const, friction: 0.5, propId };
  switch (g.kind) {
    case 'cannon': {
      const d = { x: Math.cos(rad(g.aim)), y: Math.sin(rad(g.aim)) };
      // the barrel, solid (a cat's loaded from in front of its mouth), and the cart under it
      return [
        capsule(x - d.x * CANNON.back, y - d.y * CANNON.back, x + d.x * (CANNON.fore - CANNON.r), y + d.y * (CANNON.fore - CANNON.r), CANNON.r, metal),
        roundedBox(x - 30, y + 6, 60, CANNON.cart - 6, 8, { material: 'wood', friction: 0.7, propId }),
      ];
    }
    case 'funnel': {
      // its two glass sides, spout to mouth
      const [s0, s1, m1, m0] = funnelCorners(g);
      const glass = { material: 'ceramic' as const, friction: 0.25, propId };
      return [capsule(s0[0], s0[1], m0[0], m0[1], 4, glass), capsule(s1[0], s1[1], m1[0], m1[1], 4, glass)];
    }
    case 'fan':
      return [capsule(x - 0.5, y, x + 0.5, y, FAN.r - 2, metal)];
    case 'bumper':
      return [capsule(x - 0.5, y, x + 0.5, y, BUMPER.r, { material: 'fabric', friction: 0.3, propId })];
    case 'belt':
      return [roundedBox(x - BELT.half, y, BELT.half * 2, BELT.h, BELT.h / 2, { material: 'fabric', friction: 0.9, propId })];
  }
}

/** What a cat can sit on (a belt's top), or nothing. */
export function gadgetSurface(g: Pick<Gadget, 'kind' | 'x' | 'y'>, propId: number): Surface | null {
  return g.kind === 'belt' ? { x0: g.x - BELT.half + 6, x1: g.x + BELT.half - 6, y: g.y, propId } : null;
}

/** Something a toy did, for its sound and its puff. */
export type GadgetEvent =
  | { t: 'load'; cat: Cat; id: number }
  | { t: 'fire'; cat: Cat; id: number; x: number; y: number }
  | { t: 'bump'; cat: Cat; id: number; speed: number }
  /** Caught by a fan's wind, a funnel's pull, or a belt, just now (it wasn't the step before). */
  | { t: 'blow' | 'suck' | 'ride'; cat: Cat; id: number };

/** A cat in a cannon: how long it's been in, its shape as it went in (which way round each bit of it is, stuffed in), and where its back end sticks out. */
interface Loaded {
  cat: Cat;
  id: number;
  t: number;
  shape: Float64Array;
  rump: Rump | null;
  /** Waiting to be fired (a challenge's cannon, till Go). */
  held: boolean;
}

/** The back end of a cat stuffed in a cannon: the tip of it (world), the way it points (out of the muzzle), and how long and wide its bulge is. */
export interface Rump {
  x: number;
  y: number;
  dx: number;
  dy: number;
  len: number;
  half: number;
}

/** A loaded cannon's tremble (units across its barrel), from how long the cat's been in. */
const tremble = (t: number): number => Math.sin(t * 70) * 1.6 * Math.min(1, t / CANNON.wait);

/**
 * The toys at work: each frame the fans blow, the belts carry, the bumpers
 * bounce, and the cannons load and fire. A loaded cat is out of the physics
 * till it's fired: stuffed head first into the barrel (drawn behind it), its
 * back end too big to go in, bulging out of the muzzle.
 */
export class GadgetWorks {
  private loaded: Loaded[] = [];
  private bumped = new Map<Cat, number>();
  /** Who each fan, funnel and belt had last step (to say when one's newly caught). */
  private had = new Map<number, Set<Cat>>();
  /** Each bumper's flash (1 just hit, fading), each cannon's kick back. */
  readonly flash = new Map<number, number>();
  readonly recoil = new Map<number, number>();
  /** A cat just fired: no going straight back in. */
  private fired = new Map<Cat, number>();

  constructor(private readonly world: () => World) {}

  /** Is this cat in a cannon? */
  inCannon(cat: Cat): number | null {
    return this.loaded.find((l) => l.cat === cat)?.id ?? null;
  }

  /** How long the cat's been in its cannon (for its tremble), 0..1. */
  charge(id: number): number {
    const l = this.loaded.find((q) => q.id === id);
    return l ? Math.min(1, l.t / CANNON.wait) : 0;
  }

  /** A held cannon goes: it trembles, and fires (false: no cat waiting in it). */
  fire(id: number): boolean {
    const l = this.loaded.find((q) => q.id === id && q.held);
    if (!l) return false;
    l.held = false;
    l.t = 0;
    return true;
  }

  /** How far a cannon's barrel is shaken across this frame (a cat in it, about to go). */
  shake(id: number): number {
    const l = this.loaded.find((q) => q.id === id);
    return l ? tremble(l.t) : 0;
  }

  /** The back end of a cat in a cannon, sticking out of it (null: not in one). */
  rump(cat: Cat): Rump | null {
    return this.loaded.find((l) => l.cat === cat)?.rump ?? null;
  }

  /** The cannon (if any) whose mouth (x, y) is at (`more`: how forgiving: a cat let go by a hand, a good way round it). */
  static cannonAt(gadgets: readonly Gadget[], x: number, y: number, more = 1.6): Gadget | null {
    let best: Gadget | null = null;
    let bd = CANNON.reach * more;
    for (const g of gadgets) {
      if (g.kind !== 'cannon') continue;
      const m = cannonMouth(g);
      const d = Math.hypot(x - m.zx, y - m.zy);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }

  /** Into the cannon a cat goes (if there's room: one at a time). */
  load(cat: Cat, g: Gadget, held = false): boolean {
    if (this.loaded.some((l) => l.id === g.id || l.cat === cat) || (this.fired.get(cat) ?? 0) > 0) return false;
    const b = cat.body;
    if (b.grab) b.releaseGrab();
    b.computeCentroid();
    const shape = new Float64Array(b.n * 2);
    for (let i = 0; i < b.n; i++) {
      shape[i * 2] = b.x[i] - b.cx;
      shape[i * 2 + 1] = b.y[i] - b.cy;
    }
    this.world().removeBody(b);
    const l: Loaded = { cat, id: g.id, t: 0, shape, rump: null, held };
    this.loaded.push(l);
    this.stuff(l, g);
    return true;
  }

  /**
   * One frame. `free`: may this cat be pushed about (not held, not in a
   * tube)? Returns what happened, for the sounds.
   */
  step(gadgets: readonly Gadget[], cats: readonly Cat[], free: (cat: Cat) => boolean): GadgetEvent[] {
    const out: GadgetEvent[] = [];
    const dt = FRAME_DT;
    const byId = new Map(gadgets.map((g) => [g.id, g]));
    for (const [k, v] of this.flash) this.flash.set(k, Math.max(0, v - dt * 3));
    for (const [k, v] of this.recoil) this.recoil.set(k, Math.max(0, v - dt * 5));
    for (const [c, f] of this.fired) f <= 1 ? this.fired.delete(c) : this.fired.set(c, f - 1);
    for (const [c, f] of this.bumped) f <= 1 ? this.bumped.delete(c) : this.bumped.set(c, f - 1);
    // the cats in cannons: squeezed into the barrel, till it fires
    for (const l of [...this.loaded]) {
      const g = byId.get(l.id);
      if (!l.held) l.t += dt;
      if (!g) {
        // (its cannon's gone: out it comes, where it was)
        this.unload(l, null);
        continue;
      }
      if (l.t >= CANNON.wait) {
        const m = this.unload(l, g);
        out.push({ t: 'fire', cat: l.cat, id: g.id, x: m.x, y: m.y });
        continue;
      }
      this.stuff(l, g);
    }
    for (const cat of cats) {
      if (this.inCannon(cat) !== null || !free(cat)) continue;
      const b = cat.body;
      b.computeCentroid();
      for (const g of gadgets) {
        if (g.kind === 'fan' || g.kind === 'belt' || g.kind === 'funnel') {
          const caught = g.kind === 'fan' ? this.blow(g, b) : g.kind === 'belt' ? this.carry(g, b) : this.suck(g, b);
          const had = this.had.get(g.id) ?? new Set<Cat>();
          this.had.set(g.id, had);
          if (caught && !had.has(cat)) out.push({ t: g.kind === 'fan' ? 'blow' : g.kind === 'belt' ? 'ride' : 'suck', cat, id: g.id });
          if (caught) had.add(cat);
          else had.delete(cat);
        } else if (g.kind === 'bumper') {
          const hit = this.bump(g, cat);
          if (hit) out.push({ t: 'bump', cat, id: g.id, speed: hit });
        } else if (g.kind === 'cannon') {
          // wandered (or fell, or was flung) into its mouth: in it goes
          const m = cannonMouth(g);
          if (Math.hypot(b.cx - m.zx, b.cy - m.zy) < CANNON.reach && this.load(cat, g)) out.push({ t: 'load', cat, id: g.id });
        }
      }
    }
    return out;
  }

  /**
   * A cat in a cannon, stuffed in head first: down the bore it goes as a
   * sausage, but its back end's too big to follow, so it bulges out of the
   * muzzle, squashed against it (wider than the barrel, jiggling as the
   * cannon trembles). Each node goes where its own way round the cat points
   * (the outline of the bore plus the bulge, seen from the bulge's middle),
   * eased there so it squishes in over a moment.
   */
  private stuff(l: Loaded, g: Gadget): void {
    const d = aimDir(g);
    const b = l.cat.body;
    const R = b.p.radius;
    const jiggle = 1 + Math.sin(l.t * 31) * 0.05 * Math.min(1, l.t / CANNON.wait);
    const along = Math.max(R * 0.72, 14);
    const across = Math.max(R * 0.98, CANNON.r * 1.3) * jiggle;
    const w = CANNON.r * 0.72;
    const deep = CANNON.fore + along * 0.3;
    // (how far back of the bulge's middle the muzzle is)
    const lip = along * 0.3 + 3;
    const sh = tremble(l.t);
    const ox = g.x + d.x * deep - d.y * sh;
    const oy = g.y + d.y * deep + d.x * sh;
    const k = 1 - Math.exp(-FRAME_DT * 28);
    for (let i = 0; i < b.n; i++) {
      const sx = l.shape[i * 2];
      const sy = l.shape[i * 2 + 1];
      const u = sx * d.x + sy * d.y;
      const v = -sx * d.y + sy * d.x;
      const m = Math.hypot(u, v) || 1;
      const cu = u / m;
      const cv = v / m;
      // out to the bulge (an ellipse, squashed along the barrel, pressed flat
      // against the muzzle), or down the bore
      let r = 1 / Math.hypot(cu / along, cv / across);
      if (cu < 0) {
        r = Math.min(r, lip / -cu);
        r = Math.max(r, Math.min(deep / -cu, Math.abs(cv) > 1e-6 ? w / Math.abs(cv) : Infinity));
      }
      const tx = ox + (d.x * cu - d.y * cv) * r;
      const ty = oy + (d.y * cu + d.x * cv) * r;
      b.x[i] = b.px[i] = b.x[i] + (tx - b.x[i]) * k;
      b.y[i] = b.py[i] = b.y[i] + (ty - b.y[i]) * k;
    }
    b.computeCentroid();
    l.rump = { x: ox + d.x * along, y: oy + d.y * along, dx: d.x, dy: d.y, len: along, half: across };
  }

  /** Out of its cannon: a fresh round cat just out of the muzzle, flying the way it's aimed (or, its cannon gone, put back still). */
  private unload(l: Loaded, g: Gadget | null): { x: number; y: number } {
    this.loaded.splice(this.loaded.indexOf(l), 1);
    const b = l.cat.body;
    b.computeCentroid();
    let x = b.cx;
    let y = b.cy;
    let vx = 0;
    let vy = 0;
    if (g) {
      const d = aimDir(g);
      const m = cannonMouth(g);
      x = m.x + d.x * (b.p.radius + 6);
      y = m.y + d.y * (b.p.radius + 6);
      vx = d.x * CANNON.speed;
      vy = d.y * CANNON.speed;
      this.recoil.set(g.id, 1);
      this.fired.set(l.cat, 40);
    }
    // (a fresh round cat, however it went in: a shot's the same every time)
    b.reset(x, y);
    for (let i = 0; i < b.n; i++) {
      b.vx[i] = vx;
      b.vy[i] = vy;
    }
    this.world().addBody(b);
    return { x, y };
  }

  /** Everyone in a cannon out of it, still, where they are (leaving, starting over). */
  releaseAll(): void {
    for (const l of [...this.loaded]) this.unload(l, null);
    this.fired.clear();
  }

  /** A fan's wind: a push along it, strongest by the fan (a cat in an upward one floats where the push and its weight match). */
  private blow(g: Gadget, b: SoftBody): boolean {
    const d = aimDir(g);
    const rx = b.cx - (g.x + d.x * FAN.r);
    const ry = b.cy - (g.y + d.y * FAN.r);
    const along = rx * d.x + ry * d.y;
    const across = Math.abs(rx * d.y - ry * d.x);
    if (along < -b.p.radius * 0.5 || along > FAN.reach || across > FAN.half + b.p.radius * 0.5) return false;
    const push = FAN.push * (1 - 0.65 * Math.max(0, along) / FAN.reach);
    b.wake();
    for (let i = 0; i < b.n; i++) {
      // (pushed less the faster it's already going with the wind: a cat floating on it settles, rather than bobbing)
      const v = b.vx[i] * d.x + b.vy[i] * d.y;
      const a = (push - FAN.drag * v) * FRAME_DT;
      b.vx[i] += d.x * a;
      b.vy[i] += d.y * a;
    }
    return true;
  }

  /**
   * A funnel: a cat in it is drawn in to its spout (into the tube there, if
   * there's one, or out through it), along it and in toward its middle, its
   * sideways swing damped, whichever way the funnel faces. Not one going out
   * of it fast: just shot out of the tube under it.
   */
  private suck(g: Gadget, b: SoftBody): boolean {
    if (!inFunnel(g, b.cx, b.cy)) return false;
    const d = aimDir(g);
    const out = b.vcx * d.x + b.vcy * d.y;
    if (out > 120) return false;
    const px = -d.y;
    const py = d.x;
    const v = (b.cx - g.x) * px + (b.cy - g.y) * py;
    const sway = b.vcx * px + b.vcy * py;
    const across = -v * 22 - sway * 3;
    b.wake();
    for (let i = 0; i < b.n; i++) {
      b.vx[i] += (-d.x * FUNNEL.pull + px * across) * FRAME_DT;
      b.vy[i] += (-d.y * FUNNEL.pull + py * across) * FRAME_DT;
    }
    return true;
  }

  /** A belt: a cat sitting on it is carried along (its feet at the belt's speed). */
  private carry(g: Gadget, b: SoftBody): boolean {
    const d = aimDir(g);
    const target = d.x * BELT.speed;
    let on = false;
    for (let i = 0; i < b.n; i++) {
      if (b.y[i] > g.y - 7 && b.y[i] < g.y + 3 && b.x[i] > g.x - BELT.half - 2 && b.x[i] < g.x + BELT.half + 2) {
        on = true;
        break;
      }
    }
    if (!on) return false;
    b.wake();
    for (let i = 0; i < b.n; i++) b.vx[i] += (target - b.vx[i]) * 0.18;
    return true;
  }

  /** A bumper: touched, the cat's bounced straight off it (not again for a moment). Returns how hard, or 0. */
  private bump(g: Gadget, cat: Cat): number {
    if (this.bumped.has(cat)) return 0;
    const b = cat.body;
    let near = Infinity;
    for (let i = 0; i < b.n; i++) near = Math.min(near, Math.hypot(b.x[i] - g.x, b.y[i] - g.y));
    if (near > BUMPER.r + 6) return 0;
    let nx = b.cx - g.x;
    let ny = b.cy - g.y;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    let speed = 0;
    for (let i = 0; i < b.n; i++) {
      const vn = b.vx[i] * nx + b.vy[i] * ny;
      speed = Math.max(speed, -vn);
      // (what was going along the bumper keeps going; away from it, hard)
      const tx = b.vx[i] - vn * nx;
      const ty = b.vy[i] - vn * ny;
      b.vx[i] = tx * 0.6 + nx * BUMPER.kick;
      b.vy[i] = ty * 0.6 + ny * BUMPER.kick;
    }
    b.wake();
    this.bumped.set(cat, 14);
    this.flash.set(g.id, 1);
    return Math.max(speed, BUMPER.kick * 0.6);
  }
}
