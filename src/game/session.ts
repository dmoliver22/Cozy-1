// The cats in a room (the house): carrying and booping them, and cats
// pouring into containers and settling in ("if it fits, I sits"). Pure
// logic, no rendering.

import { BREEDS, type BreedId } from '../physics/breeds';
import type { Material, StaticShape } from '../physics/shapes';
import type { SoftBody } from '../physics/softbody';
import type { World } from '../physics/world';
import { clamp } from '../util/math';
import { cozyScore, measureOverlap, type CozyResult, type Overlap } from './fit';
import { FLOOR_Y, WORLD_W, type Prop } from './props';
import { SoftBody as Body } from '../physics/softbody';
import { buildRoom, type RoomDef, type SpawnOk } from './room';
import { inSomething, nearestRoom, roomFor, stuckFast, type Ring } from './spawn';

const SETTLE_ENERGY = 400;
const SETTLE_SPEED2 = 14 * 14;
const SETTLE_FRAMES = 16;
/** Downward pull on the part of a cat inside a container opening (units/s^2). */
const SLURP = 2600;
/** Frames a cat is stuck fast before it's put down somewhere clear (see Session.unstick). */
const UNSTICK_FRAMES = 60;

export interface SeatInfo {
  container: number;
  cozy: CozyResult;
  since: number;
}

export interface Cat {
  index: number;
  name: string;
  breed: BreedId;
  body: SoftBody;
  seat: SeatInfo | null;
  /** Consecutive frames at rest. */
  settled: number;
  /** Container the cat is currently in or on (-1 = none). */
  near: number;
  overlaps: Overlap[];
  /** Container the cat would like but someone else is in. */
  blockedBy: number;
  lastPour: number;
  grabbed: boolean;
  /** Frames since last boop/grab, for face animation. */
  sinceTouch: number;
  /** Frames held still in a finger: a scruffed cat goes calm. */
  heldStill: number;
  /** Committed settling decision for the container being touched. */
  intent: Intent | null;
}

interface Intent {
  k: number;
  mode: 'in' | 'out' | 'perch';
  dir: number;
  since: number;
  lastTouch: number;
  bestInside: number;
}

export type GameEvent =
  | { t: 'impact'; cat: Cat; material: Material; speed: number; container: boolean }
  | { t: 'pour'; cat: Cat; container: Prop }
  | { t: 'seat'; cat: Cat; container: Prop; cozy: CozyResult }
  | { t: 'unseat'; cat: Cat }
  | { t: 'grab'; cat: Cat }
  | { t: 'release'; cat: Cat }
  | { t: 'boop'; cat: Cat }
  /** A cat stuck fast was put down somewhere clear (it was at x, y). */
  | { t: 'unstuck'; cat: Cat; x: number; y: number };

export interface SessionOptions {
  settleFrames?: number;
  /** The room's walls, floor and ceiling (the house has floors of its own). */
  shell?: () => StaticShape[];
  /**
   * Where a cat whose place isn't clear may go instead (see buildRoom), and
   * where one stuck fast may be put down again (see Session.unstick).
   */
  spawnOk?: SpawnOk;
  /** Cats found in one another are slid apart (see World.unmerge). */
  unmerge?: boolean;
}

/** Where a cat was drawn from and to (see Session.beginLerp), and its flowing shape. */
interface Drawn {
  x: Float64Array;
  y: Float64Array;
  sx: Float64Array;
  sy: Float64Array;
  ring: number;
  /** The shape it's drawn with while held (node offsets from its middle), how much, and whether that's started. */
  fx: Float64Array;
  fy: Float64Array;
  fw: number;
  fOn: boolean;
}

/** How quickly a held cat's drawn shape eases after its real one (per second). */
const SHAPE_FLOW = 22;

export class Session {
  readonly def: RoomDef;
  world!: World;
  props!: Prop[];
  containers!: Prop[];
  furniture!: Prop[];
  cats!: Cat[];
  frame = 0;
  events: GameEvent[] = [];
  private shapeToContainer = new Map<number, number>();
  private shapeIsFurniture = new Set<number>();
  private grabbing: Cat | null = null;
  private readonly settleFrames: number;
  private readonly shell: SessionOptions['shell'];
  private readonly spawnOk: SessionOptions['spawnOk'];
  private readonly unmerge: boolean;
  /** Frames each cat has been stuck fast (see unstick). */
  private stuck = new Map<Cat, number>();
  /** When each was last put down somewhere clear, and how many times running. */
  private unstuck = new Map<Cat, { frame: number; n: number }>();
  /** Where a carried cat can be taken (world): the room, or the house's floor it's on. */
  grabBox = { x0: 4, x1: WORLD_W - 4, y0: -40, y1: FLOOR_Y - 4 };

  constructor(def: RoomDef, opts: SessionOptions = {}) {
    this.def = def;
    this.settleFrames = opts.settleFrames ?? 75;
    this.shell = opts.shell;
    this.spawnOk = opts.spawnOk;
    this.unmerge = opts.unmerge ?? false;
    this.load();
  }

  private load(): void {
    const built = buildRoom(this.def, this.settleFrames, this.shell, this.spawnOk, this.unmerge);
    this.world = built.world;
    this.props = built.props;
    this.containers = built.containers;
    this.furniture = built.furniture;
    this.shapeToContainer.clear();
    this.shapeIsFurniture.clear();
    this.containers.forEach((c, i) => c.shapes.forEach((s) => this.shapeToContainer.set(s.id, i)));
    for (const s of this.world.statics) if (!this.shapeToContainer.has(s.id)) this.shapeIsFurniture.add(s.id);
    this.cats = built.bodies.map((body, index) => ({
      index,
      name: this.def.cats[index].name,
      breed: this.def.cats[index].breed,
      body,
      seat: null,
      settled: 0,
      near: -1,
      overlaps: this.containers.map(() => ({ covered: 0, fill: 0, inside: 0 })),
      blockedBy: -1,
      lastPour: -999,
      grabbed: false,
      sinceTouch: 999,
      heldStill: 0,
      intent: null,
    }));
    this.frame = 0;
    this.grabbing = null;
    this.stuck.clear();
    this.unstuck.clear();
    this.events = [];
    // Evaluate starting seats (a cat may begin inside something).
    this.updateCats();
    this.events = [];
  }

  private lerpFrom = new Map<SoftBody, Drawn>();
  private lerping = false;

  /** Remember where every cat is before the next step (for smooth drawing). */
  rememberPositions(): void {
    for (const cat of this.cats) {
      const b = cat.body;
      let m = this.lerpFrom.get(b);
      if (!m || m.x.length !== b.n) {
        m = { x: new Float64Array(b.n), y: new Float64Array(b.n), sx: new Float64Array(b.n), sy: new Float64Array(b.n), ring: 0, fx: new Float64Array(b.n), fy: new Float64Array(b.n), fw: 0, fOn: false };
        this.lerpFrom.set(b, m);
      }
      m.x.set(b.x);
      m.y.set(b.y);
      m.ring = b.ringVersion;
    }
  }

  /**
   * For drawing only: put every cat `alpha` of the way from where it was
   * before the last step to where it is now, so motion stays smooth on
   * screens faster than the 60 Hz simulation. A cat in the hand is drawn
   * flowing from one shape to the next (see drawFlowing). `dt` is the time
   * since the last frame drawn. Always pair with endLerp().
   */
  beginLerp(alpha: number, dt = 1 / 60): void {
    if (this.lerping) return;
    this.lerping = true;
    for (const cat of this.cats) {
      const b = cat.body;
      const m = this.lerpFrom.get(b);
      if (!m || m.x.length !== b.n) continue;
      m.sx.set(b.x);
      m.sy.set(b.y);
      // a cat put somewhere (popping out of a tube, say) teleports: never blend across that
      // (nor across skin that was untangled: its nodes traded places)
      const jump = Math.abs(b.x[0] - m.x[0]) + Math.abs(b.y[0] - m.y[0]);
      const fresh = jump > 40 || b.ringVersion !== m.ring;
      if (!fresh) {
        for (let i = 0; i < b.n; i++) {
          b.x[i] = m.x[i] + (m.sx[i] - m.x[i]) * alpha;
          b.y[i] = m.y[i] + (m.sy[i] - m.y[i]) * alpha;
        }
      }
      this.drawFlowing(cat, m, dt, fresh);
    }
  }

  /**
   * A cat in the hand is drawn a moment behind its own shape (the shape eases
   * after it, about 1/20 s behind; where it is, never): however it's tugged,
   * bumped or snagged, what you see flows from one shape to the next like
   * something liquid, and never flickers. Let go, it eases back to exact.
   */
  private drawFlowing(cat: Cat, m: Drawn, dt: number, fresh: boolean): void {
    const b = cat.body;
    const want = cat.grabbed ? 1 : 0;
    m.fw += (want - m.fw) * Math.min(1, dt * (want > m.fw ? 12 : 8));
    if (m.fw < 0.01) {
      m.fw = 0;
      m.fOn = false;
      return;
    }
    const n = b.n;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      cx += b.x[i];
      cy += b.y[i];
    }
    cx /= n;
    cy /= n;
    const k = 1 - Math.exp(-dt * SHAPE_FLOW);
    const snap = fresh || !m.fOn;
    for (let i = 0; i < n; i++) {
      const ox = b.x[i] - cx;
      const oy = b.y[i] - cy;
      if (snap) {
        m.fx[i] = ox;
        m.fy[i] = oy;
      } else {
        m.fx[i] += (ox - m.fx[i]) * k;
        m.fy[i] += (oy - m.fy[i]) * k;
      }
      b.x[i] = cx + ox + (m.fx[i] - ox) * m.fw;
      b.y[i] = cy + oy + (m.fy[i] - oy) * m.fw;
    }
    m.fOn = true;
  }

  endLerp(): void {
    if (!this.lerping) return;
    this.lerping = false;
    for (const cat of this.cats) {
      const b = cat.body;
      const m = this.lerpFrom.get(b);
      if (!m || m.x.length !== b.n) continue;
      b.x.set(m.sx);
      b.y.set(m.sy);
    }
  }

  /** Advance one fixed 1/60 s frame. */
  step(): void {
    this.world.step();
    this.frame++;
    for (const imp of this.world.drainImpacts()) {
      const cat = this.cats.find((c) => c.body === imp.body);
      if (cat) this.events.push({ t: 'impact', cat, material: imp.shape.material, speed: imp.speed, container: imp.shape.container });
    }
    this.updateCats();
    if (this.spawnOk && this.frame % 10 === 0) this.unstick();
  }

  /**
   * A cat stuck fast for a second (its skin crossed over itself, or caught
   * in the furniture), or in another cat for a second that it couldn't be
   * slid out of (see World.unmerge: the smaller one), is put down again in
   * the nearest clear place that spawnOk allows, a fresh round cat: never
   * left stuck for good. Not one being carried, or out of the world (in a
   * tube, mid-leap, in a scrap). One that gets stuck again soon after is
   * given more room.
   */
  private unstick(): void {
    const w = this.world;
    for (const c of this.cats) {
      const b = c.body;
      const free = !c.grabbed && w.bodies.includes(b);
      const n = free && stuckFast(w.statics, b) ? (this.stuck.get(c) ?? 0) + 10 : 0;
      const m = free && this.unmerge ? w.mergedWith(b) : null;
      const caught = m !== null && m.frames >= UNSTICK_FRAMES && (m.other.grab !== null || b.p.radius < m.other.p.radius || (b.p.radius === m.other.p.radius && b.id < m.other.id));
      if (n < UNSTICK_FRAMES && !caught) {
        if (n) this.stuck.set(c, n);
        else this.stuck.delete(c);
        continue;
      }
      this.stuck.delete(c);
      const last = this.unstuck.get(c);
      const again = last && this.frame - last.frame < 600 ? last.n + 1 : 0;
      const from = this.relocate(c, 0.9 + 0.3 * Math.min(again, 2));
      if (!from) continue;
      this.unstuck.set(c, { frame: this.frame, n: again });
      this.events.push({ t: 'unstuck', cat: c, x: from.x, y: from.y });
    }
  }

  /**
   * Put a cat down again in the nearest clear place spawnOk allows, a fresh
   * round cat (`room`: see roomFor). Where it was, or null if there's
   * nowhere (it stays as it is).
   */
  private relocate(c: Cat, room = 0.9): { x: number; y: number } | null {
    const w = this.world;
    const b = c.body;
    const others = this.ringsBut(b);
    b.computeCentroid();
    const r = b.p.radius;
    const from = { x: b.cx, y: b.cy };
    const at = nearestRoom(w.statics, others, from.x, from.y, r, (x, y) => this.spawnOk!(x, y, r, from), 320, room);
    if (!at) return null;
    b.reset(at.x, at.y);
    c.intent = null;
    c.settled = 0;
    return from;
  }

  /** The other cats in the world (and the yarn) as rings that take in all of each, however it's lying. */
  private ringsBut(b: SoftBody | null): Ring[] {
    const out: Ring[] = [];
    for (const o of this.world.bodies) {
      if (o === b) continue;
      o.computeCentroid();
      let r2 = 0;
      for (let i = 0; i < o.n; i++) r2 = Math.max(r2, (o.x[i] - o.cx) ** 2 + (o.y[i] - o.cy) ** 2);
      out.push({ x: o.cx, y: o.cy, r: Math.sqrt(r2) + 1 });
    }
    return out;
  }

  /**
   * A cat just put back into the world (out of a scrap, say): if it's come
   * back in the furniture or in another cat, it goes to the nearest clear
   * place instead, moving as it was. True if it moved.
   */
  placeClear(cat: Cat): boolean {
    const b = cat.body;
    if (!this.spawnOk || !inSomething(this.world.statics, this.world.bodies, b)) return false;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < b.n; i++) {
      vx += b.vx[i] / b.n;
      vy += b.vy[i] / b.n;
    }
    if (!this.relocate(cat)) return false;
    b.kick(vx, vy);
    return true;
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private updateCats(): void {
    const containers = this.containers;
    for (const cat of this.cats) {
      const b = cat.body;
      cat.sinceTouch++;
      cat.heldStill = cat.grabbed && b.emaVx * b.emaVx + b.emaVy * b.emaVy < 30 * 30 ? cat.heldStill + 1 : 0;
      // Overlap with every container
      let best = -1;
      let bestCovered = 0;
      for (let k = 0; k < containers.length; k++) {
        const ov = measureOverlap(b, containers[k], cat.overlaps[k]);
        if (ov.covered > bestCovered) {
          bestCovered = ov.covered;
          best = k;
        }
      }
      // Pour event: entering a container while moving
      if (best >= 0 && cat.near !== best && b.energy > 400 && this.frame - cat.lastPour > 40) {
        cat.lastPour = this.frame;
        this.events.push({ t: 'pour', cat, container: containers[best] });
      }
      // Contacts: is the cat standing on furniture, or only on container rims?
      let onFurniture = false;
      let touchK = -1;
      let touchCount = 0;
      let rimSupportX = 0;
      let rimSupportN = 0;
      const counts = new Map<number, number>();
      for (let i = 0; i < b.n; i++) {
        const sid = b.contactShape[i];
        if (sid === -1) continue;
        const k = this.shapeToContainer.get(sid);
        const upward = b.contactNy[i] < -0.45;
        if (k === undefined) {
          if (upward && this.shapeIsFurniture.has(sid)) onFurniture = true;
        } else {
          const c = (counts.get(k) ?? 0) + 1;
          counts.set(k, c);
          if (c > touchCount) {
            touchCount = c;
            touchK = k;
          }
          if (upward) {
            rimSupportX += b.x[i];
            rimSupportN++;
          }
        }
      }
      const k = best >= 0 ? best : touchK;
      cat.near = k;
      // Settled?
      const atRest = !cat.grabbed && b.emaVx * b.emaVx + b.emaVy * b.emaVy < SETTLE_SPEED2 && b.emaEnergy < SETTLE_ENERGY && b.airborneFrames < 3;
      cat.settled = atRest ? cat.settled + 1 : 0;
      this.applyAssist(cat, k, onFurniture, touchK, rimSupportN > 0 ? rimSupportX / rimSupportN : NaN);
      // Loaf when resting, round when moving
      const dt = 1 / 60;
      if (cat.settled > 8) b.loafiness = Math.min(1, b.loafiness + dt * 1.4);
      else if (cat.grabbed || b.energy > 900) b.loafiness = Math.max(0, b.loafiness - dt * 3);
      b.plastic = cat.seat ? Math.min(1, b.plastic + dt * 1.2) : Math.max(0, b.plastic - dt * 5);
      // Seated cats, and cats that gave up and perch on top, just sit there.
      b.sitting = (!!cat.seat || cat.intent?.mode === 'perch') && !cat.grabbed;
      this.updateSeat(cat, best);
    }
    this.resolveClaims();
  }

  /**
   * "If it fits, I sits": a cat touching a container commits to a decision.
   * 'in'  - a damped, whole-body pull toward the opening and a gentle press
   *         down so it pours in;
   * 'out' - it was only balanced on a rim, so it slides off the way it leans;
   * 'perch' - it tried and it really doesn't fit: it just sits on top.
   * Decisions are sticky, which keeps cats calm instead of jittery.
   */
  private applyAssist(cat: Cat, k: number, onFurniture: boolean, touchK: number, rimX: number): void {
    const b = cat.body;
    b.assistAx = 0;
    b.settleForce = 0;
    b.shapeMul = 1;
    b.pouring = false;
    b.frictionMul = 1;
    const it = cat.intent;
    if (cat.grabbed) {
      cat.intent = null;
      return;
    }
    // A seated cat just sits: no more nudging (so it can rest perfectly still).
    if (cat.seat) return;
    const touching = k >= 0 && (touchK === k || cat.overlaps[k].covered > 0);
    if (it) {
      if (touching && k === it.k) it.lastTouch = this.frame;
      else if (this.frame - it.lastTouch > 24) cat.intent = null;
    }
    if (!cat.intent) {
      if (!touching || onFurniture) return;
      const c = this.containers[k];
      const op = c.opening!;
      const ov = cat.overlaps[k];
      let inCol = 0;
      for (let i = 0; i < b.n; i++) if (b.x[i] > op.x0 && b.x[i] < op.x1) inCol++;
      const frac = inCol / b.n;
      const taken = this.cats.some((o) => o !== cat && o.seat && o.seat.container === k);
      const mid = (op.x0 + op.x1) / 2;
      let mode: Intent['mode'] = !taken && (frac >= 0.3 || ov.inside > 0.08) ? 'in' : 'out';
      const pivot = Number.isFinite(rimX) ? rimX : mid;
      let dir = Math.sign(b.cx - pivot) || (b.cx < mid ? -1 : 1);
      if (mode === 'out' && !(touchK === k && ov.inside < 0.15)) mode = 'perch';
      if (mode === 'out' && b.cx < c.x0) dir = -1;
      if (mode === 'out' && b.cx > c.x1) dir = 1;
      cat.intent = { k, mode, dir, since: this.frame, lastTouch: this.frame, bestInside: ov.inside };
    }
    const intent = cat.intent!;
    const c = this.containers[intent.k];
    const op = c.opening!;
    const ov = cat.overlaps[intent.k];
    if (ov.inside > intent.bestInside + 0.02) {
      intent.bestInside = ov.inside;
      intent.since = this.frame;
    }
    if (intent.mode === 'in') {
      if (this.frame - intent.since > 150 && ov.inside < 0.15) {
        // Tried for a while and it really doesn't fit: just perch.
        intent.mode = 'perch';
        return;
      }
      const mid = (op.x0 + op.x1) / 2;
      b.assistAx = clamp(42 * (mid - b.cx) - 11 * b.vcx, -700, 700);
      // Draw the part that's already in down into the container; once the
      // cat is mostly in, let it just be liquid.
      b.settleForce = SLURP * b.p.slurp * clamp((ov.inside + 0.06) / 0.1, 0, 1) * clamp((0.95 - ov.inside) / 0.2, 0, 1) * clamp((0.97 - ov.fill) / 0.15, 0, 1);
      b.settleX0 = op.x0;
      b.settleX1 = op.x1;
      b.settleY = op.y + 2;
      b.shapeMul = 0;
      b.pouring = b.settleForce > 0 && this.frame - intent.since < 240;
    } else if (intent.mode === 'out') {
      if (onFurniture) {
        cat.intent = null;
        return;
      }
      // Slide off the rim it's balanced on: a slippery rim and a push that
      // builds over a third of a second, so it eases off instead of teetering.
      const ramp = clamp((this.frame - intent.since) / 20, 0, 1);
      b.frictionMul = 0.3;
      b.assistAx = clamp(intent.dir * (300 + 360 * ramp) - 6 * b.vcx, -700, 700);
    }
  }

  private updateSeat(cat: Cat, best: number): void {
    const b = cat.body;
    if (cat.seat) {
      const k = cat.seat.container;
      const ov = cat.overlaps[k];
      if (cat.grabbed || (ov.inside < 0.1 && ov.fill < 0.35) || (best !== k && ov.covered === 0)) {
        cat.seat = null;
        this.events.push({ t: 'unseat', cat });
        return;
      }
      if (cat.settled > 0 && this.frame % 6 === 0) cat.seat.cozy = cozyScore(ov.fill, ov.inside);
      return;
    }
    cat.blockedBy = -1;
    if (best < 0 || cat.grabbed) return;
    const ov = cat.overlaps[best];
    const qualifies = ov.inside >= 0.2 || ov.fill >= 0.55;
    if (!qualifies) return;
    const holder = this.cats.find((o) => o !== cat && o.seat && o.seat.container === best);
    if (holder) {
      cat.blockedBy = holder.index;
      return;
    }
    if (cat.settled < SETTLE_FRAMES) return;
    cat.seat = { container: best, cozy: cozyScore(ov.fill, ov.inside), since: this.frame };
    b.plastic = 0.2;
    this.events.push({ t: 'seat', cat, container: this.containers[best], cozy: cat.seat.cozy });
  }

  private resolveClaims(): void {
    for (let k = 0; k < this.containers.length; k++) {
      const seated = this.cats.filter((c) => c.seat && c.seat.container === k);
      if (seated.length < 2) continue;
      seated.sort((a, b) => b.overlaps[k].covered - a.overlaps[k].covered);
      for (const c of seated.slice(1)) {
        c.seat = null;
        c.blockedBy = seated[0].index;
        this.events.push({ t: 'unseat', cat: c });
      }
    }
  }

  // --- Player actions -------------------------------------------------------

  /** Cat under a world point, with some finger slop. */
  catAt(wx: number, wy: number, slop = 14): Cat | null {
    let best: Cat | null = null;
    let bestD = Infinity;
    for (const cat of this.cats) {
      const b = cat.body;
      let inside = false;
      let minD = Infinity;
      for (let i = 0, j = b.n - 1; i < b.n; j = i++) {
        const yi = b.y[i];
        const yj = b.y[j];
        if (yi > wy !== yj > wy) {
          const xc = b.x[j] + ((wy - yj) * (b.x[i] - b.x[j])) / (yi - yj);
          if (wx < xc) inside = !inside;
        }
        const dx = b.x[i] - wx;
        const dy = b.y[i] - wy;
        minD = Math.min(minD, Math.sqrt(dx * dx + dy * dy));
      }
      const d = inside ? -1 : minD;
      if (d < slop && d < bestD) {
        bestD = d;
        best = cat;
      }
    }
    return best;
  }

  beginGrab(cat: Cat, wx: number, wy: number): void {
    if (this.grabbing) this.endGrab();
    cat.body.startGrab(wx, wy);
    cat.grabbed = true;
    cat.sinceTouch = 0;
    cat.intent = null;
    this.grabbing = cat;
    if (cat.seat) {
      cat.seat = null;
      this.events.push({ t: 'unseat', cat });
    }
    this.events.push({ t: 'grab', cat });
  }

  moveGrab(wx: number, wy: number, vx: number, vy: number): void {
    const g = this.grabbing?.body.grab;
    if (!g) return;
    const b = this.grabBox;
    g.tx = clamp(wx, b.x0, b.x1);
    g.ty = clamp(wy, b.y0, b.y1);
    g.tvx = clamp(vx, -900, 900);
    g.tvy = clamp(vy, -900, 900);
  }

  endGrab(): void {
    const cat = this.grabbing;
    if (!cat) return;
    cat.body.releaseGrab();
    cat.grabbed = false;
    cat.sinceTouch = 0;
    this.grabbing = null;
    this.events.push({ t: 'release', cat });
  }

  get grabbed(): Cat | null {
    return this.grabbing;
  }

  /** Tap: a little hop away from the finger. */
  boop(cat: Cat, wx: number, _wy: number): void {
    const b = cat.body;
    b.computeCentroid();
    const side = clamp((b.cx - wx) / b.p.radius, -1, 1);
    b.kick(side * b.p.hop * 0.38, -b.p.hop);
    cat.sinceTouch = 0;
    cat.intent = null;
    if (cat.seat) {
      cat.seat = null;
      this.events.push({ t: 'unseat', cat });
    }
    this.events.push({ t: 'boop', cat });
  }

  // --- The house -----------------------------------------------------------

  /**
   * A prop taken out of the room (the house: picked up to be moved): its
   * colliders go (what was on it falls), and a cat in it isn't any more.
   */
  removeProp(p: Prop): void {
    const k = this.containers.indexOf(p);
    this.props = this.props.filter((q) => q !== p);
    this.furniture = this.furniture.filter((q) => q !== p);
    for (const sh of p.shapes) this.world.removeStatic(sh);
    if (k >= 0) {
      this.containers.splice(k, 1);
      // (the cats keep track of the containers by where they are in the list)
      const after = (i: number): number => (i === k ? -1 : i > k ? i - 1 : i);
      for (const cat of this.cats) {
        cat.overlaps.splice(k, 1);
        cat.near = after(cat.near);
        cat.blockedBy = after(cat.blockedBy);
        if (cat.intent) cat.intent = cat.intent.k === k ? null : { ...cat.intent, k: after(cat.intent.k) };
        if (cat.seat) {
          if (cat.seat.container === k) {
            cat.seat = null;
            this.events.push({ t: 'unseat', cat });
          } else cat.seat.container = after(cat.seat.container);
        }
      }
    }
    this.registerShapes();
    this.world.wakeAll();
  }

  /** A prop put (back) in the room. */
  addProp(p: Prop): void {
    this.props.push(p);
    if (p.kind === 'container') {
      this.containers.push(p);
      for (const cat of this.cats) cat.overlaps.push({ covered: 0, fill: 0, inside: 0 });
    } else this.furniture.push(p);
    for (const sh of p.shapes) this.world.addStatic(sh);
    this.registerShapes();
    this.world.wakeAll();
  }

  /** Colliders came or went (a perch, a tube): sort out again which are containers and which are furniture. */
  registerShapes(): void {
    this.shapeToContainer.clear();
    this.shapeIsFurniture.clear();
    this.containers.forEach((c, i) => c.shapes.forEach((sh) => this.shapeToContainer.set(sh.id, i)));
    for (const sh of this.world.statics) if (!this.shapeToContainer.has(sh.id)) this.shapeIsFurniture.add(sh.id);
  }

  /** A new cat in the room (one moving in, in at the window): there, or the nearest clear place if someone's there (see spawnOk). */
  addCat(breed: BreedId, x: number, y: number, name: string): Cat {
    const r = BREEDS[breed].physics.radius;
    if (this.spawnOk) {
      const others = this.ringsBut(null);
      if (!roomFor(this.world.statics, others, x, y, r)) {
        const from = { x, y };
        const at = nearestRoom(this.world.statics, others, x, y, r, (px, py) => this.spawnOk!(px, py, r, from));
        if (at) ({ x, y } = at);
      }
    }
    const body = new Body(breed, x, y);
    this.world.addBody(body);
    const cat: Cat = {
      index: this.cats.length,
      name,
      breed,
      body,
      seat: null,
      settled: 0,
      near: -1,
      overlaps: this.containers.map(() => ({ covered: 0, fill: 0, inside: 0 })),
      blockedBy: -1,
      lastPour: -999,
      grabbed: false,
      sinceTouch: 999,
      heldStill: 0,
      intent: null,
    };
    this.cats.push(cat);
    return cat;
  }
}
