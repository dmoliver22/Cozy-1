// A play session in one room: cats, containers, nudges ("paws"), undo, hints,
// seating and the "Fits & sits" completion. Pure logic, no rendering.

import { BREEDS, breedArea, type BreedId } from '../physics/breeds';
import type { Material } from '../physics/shapes';
import type { BodySnapshot, SoftBody } from '../physics/softbody';
import { GRAVITY, type World } from '../physics/world';
import { clamp } from '../util/math';
import { cozyScore, measureOverlap, shareFace, type CozyResult, type Overlap } from './fit';
import { FLOOR_Y, WORLD_W, type Prop } from './props';
import { buildRoom, type RoomDef } from './room';

/** Fraction of the finger's force that may point upward (cats are lazy). */
export const LIFT = 0.55;
const SETTLE_ENERGY = 90;
const SETTLE_FRAMES = 16;
const COMPLETE_FRAMES = 40;

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
}

export type GameEvent =
  | { t: 'impact'; cat: Cat; material: Material; speed: number; container: boolean }
  | { t: 'pour'; cat: Cat; container: Prop }
  | { t: 'seat'; cat: Cat; container: Prop; cozy: CozyResult }
  | { t: 'unseat'; cat: Cat }
  | { t: 'grab'; cat: Cat }
  | { t: 'release'; cat: Cat }
  | { t: 'boop'; cat: Cat }
  | { t: 'complete' }
  | { t: 'undo' };

interface UndoState {
  bodies: BodySnapshot[];
  seats: (SeatInfo | null)[];
  paws: number;
}

export interface CatResult {
  name: string;
  breed: BreedId;
  container: string;
  score: number;
  label: string;
  face: string;
}

export interface RoomResult {
  cats: CatResult[];
  cozy: number;
  paws: number;
  par: number | undefined;
  faces: string;
}

export interface SessionOptions {
  mode?: 'puzzle' | 'sandbox';
  settleFrames?: number;
}

export class Session {
  readonly def: RoomDef;
  readonly mode: 'puzzle' | 'sandbox';
  world!: World;
  props!: Prop[];
  containers!: Prop[];
  furniture!: Prop[];
  cats!: Cat[];
  paws = 0;
  hints = 0;
  frame = 0;
  complete = false;
  completeFrame = -1;
  events: GameEvent[] = [];
  private allSeatedFrames = 0;
  private undoStack: UndoState[] = [];
  private shapeToContainer = new Map<number, number>();
  private shapeIsFurniture = new Set<number>();
  private grabbing: Cat | null = null;
  private readonly settleFrames: number;

  constructor(def: RoomDef, opts: SessionOptions = {}) {
    this.def = def;
    this.mode = opts.mode ?? 'puzzle';
    this.settleFrames = opts.settleFrames ?? 75;
    this.load();
  }

  private load(): void {
    const built = buildRoom(this.def, this.settleFrames);
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
    }));
    this.paws = 0;
    this.hints = 0;
    this.frame = 0;
    this.complete = false;
    this.completeFrame = -1;
    this.allSeatedFrames = 0;
    this.undoStack = [];
    this.grabbing = null;
    this.events = [];
    // Evaluate starting seats (a cat may begin inside something in the sandbox).
    this.updateCats();
    this.events = [];
  }

  restart(): void {
    this.load();
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
      const atRest = !cat.grabbed && b.energy < SETTLE_ENERGY && b.airborneFrames < 3;
      cat.settled = atRest ? cat.settled + 1 : 0;
      this.applyAssist(cat, k, onFurniture, touchK, rimSupportN > 0 ? rimSupportX / rimSupportN : NaN);
      // Loaf when resting, round when moving
      const dt = 1 / 60;
      if (cat.settled > 8) b.loafiness = Math.min(1, b.loafiness + dt * 1.4);
      else if (cat.grabbed || b.energy > 900) b.loafiness = Math.max(0, b.loafiness - dt * 3);
      b.plastic = cat.seat ? Math.min(1, b.plastic + dt * 1.2) : Math.max(0, b.plastic - dt * 5);
      this.updateSeat(cat, best);
    }
    this.resolveClaims();
    this.checkComplete();
  }

  /**
   * "If it fits, I sits": a cat touching a container gently settles into it.
   * A cat left balancing on a rim slides off to whichever side it leans, so
   * nobody ever stays awkwardly draped over the edge of a teacup.
   */
  private applyAssist(cat: Cat, k: number, onFurniture: boolean, touchK: number, rimX: number): void {
    const b = cat.body;
    b.assistAccel = 0;
    b.settleForce = 0;
    b.shapeMul = 1;
    if (cat.grabbed || k < 0 || this.complete || onFurniture) return;
    const c = this.containers[k];
    const op = c.opening!;
    const ov = cat.overlaps[k];
    let inCol = 0;
    for (let i = 0; i < b.n; i++) if (b.x[i] > op.x0 && b.x[i] < op.x1) inCol++;
    const frac = inCol / b.n;
    const mid = (op.x0 + op.x1) / 2;
    const taken = this.cats.some((o) => o !== cat && o.seat && o.seat.container === k);
    if (!taken && (frac >= 0.3 || ov.inside > 0.08)) {
      b.assistX = mid;
      b.assistAccel = 650;
      b.assistMinY = -Infinity;
      b.settleForce = ov.inside > 0.04 ? 420 : 0;
      b.shapeMul = 0.35;
    } else if (touchK >= 0 && ov.inside < 0.15) {
      // Balanced on a rim (or on an occupied container): slide off the way it leans.
      const r = b.p.radius;
      const pivot = Number.isFinite(rimX) ? rimX : mid;
      let dir = Math.sign(b.cx - pivot);
      if (dir === 0) dir = b.cx < mid ? -1 : 1;
      const tc = this.containers[touchK];
      b.assistX = dir < 0 ? Math.min(tc.x0, b.cx) - r * 1.2 : Math.max(tc.x1, b.cx) + r * 1.2;
      b.assistAccel = 560;
      b.assistMinY = -Infinity;
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

  private checkComplete(): void {
    if (this.complete || this.mode === 'sandbox' || this.cats.length === 0) return;
    const all = this.cats.every((c) => c.seat && !c.grabbed);
    this.allSeatedFrames = all ? this.allSeatedFrames + 1 : 0;
    if (this.allSeatedFrames >= COMPLETE_FRAMES) {
      for (const c of this.cats) {
        const k = c.seat!.container;
        c.seat!.cozy = cozyScore(c.overlaps[k].fill, c.overlaps[k].inside);
      }
      this.complete = true;
      this.completeFrame = this.frame;
      this.events.push({ t: 'complete' });
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

  private pushUndo(): void {
    this.undoStack.push({
      bodies: this.cats.map((c) => c.body.snapshot()),
      seats: this.cats.map((c) => (c.seat ? { ...c.seat } : null)),
      paws: this.paws,
    });
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0 && !this.complete;
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    if (this.grabbing) this.endGrab();
    const s = this.undoStack.pop()!;
    this.cats.forEach((c, i) => {
      c.body.restore(s.bodies[i]);
      c.seat = s.seats[i];
      c.settled = c.seat ? SETTLE_FRAMES : 0;
      c.grabbed = false;
    });
    this.paws = s.paws;
    this.allSeatedFrames = 0;
    this.events.push({ t: 'undo' });
    return true;
  }

  fingerForce(cat: Cat): number {
    const pull = this.mode === 'sandbox' ? Math.max(3, cat.body.p.pull) : cat.body.p.pull;
    return pull * cat.body.mass * GRAVITY;
  }

  beginGrab(cat: Cat, wx: number, wy: number): void {
    if (this.complete) return;
    if (this.grabbing) this.endGrab();
    this.pushUndo();
    if (this.mode === 'puzzle') this.paws++;
    cat.body.startGrab(wx, wy, this.fingerForce(cat), this.mode === 'sandbox' ? 0.8 : LIFT);
    cat.grabbed = true;
    cat.sinceTouch = 0;
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
    g.tx = clamp(wx, 4, WORLD_W - 4);
    g.ty = clamp(wy, -40, FLOOR_Y - 4);
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
    if (this.complete) return;
    this.pushUndo();
    if (this.mode === 'puzzle') this.paws++;
    const b = cat.body;
    b.computeCentroid();
    const side = clamp((b.cx - wx) / b.p.radius, -1, 1);
    b.kick(side * b.p.hop * 0.38, -b.p.hop);
    cat.sinceTouch = 0;
    if (cat.seat) {
      cat.seat = null;
      this.events.push({ t: 'unseat', cat });
    }
    this.events.push({ t: 'boop', cat });
  }

  // --- Reporting -------------------------------------------------------------

  seatedCount(): number {
    return this.cats.filter((c) => c.seat).length;
  }

  results(): RoomResult {
    const cats = this.cats.map((c) => {
      const score = c.seat?.cozy.score ?? 0;
      return {
        name: c.name,
        breed: c.breed,
        container: c.seat ? this.containers[c.seat.container].name : '',
        score,
        label: c.seat?.cozy.label ?? '',
        face: shareFace(score),
      };
    });
    const cozy = cats.length ? Math.round(cats.reduce((a, c) => a + c.score, 0) / cats.length) : 0;
    return { cats, cozy, paws: this.paws, par: this.def.par, faces: cats.map((c) => c.face).join('') };
  }

  /** A gentle suggestion: which cat to nudge toward which container. */
  hint(): { cat: Cat; container: Prop; tx: number; ty: number } | null {
    const free = this.containers.map((_, k) => !this.cats.some((c) => c.seat && c.seat.container === k));
    const unseated = this.cats.filter((c) => !c.seat);
    if (!unseated.length) return null;
    // Prefer the solver's plan when it still applies.
    for (const step of this.def.plan ?? []) {
      const cat = this.cats[step.cat];
      if (!cat || cat.seat || !free[step.container]) continue;
      const c = this.containers[step.container];
      this.hints++;
      return { cat, container: c, tx: step.tx, ty: step.ty };
    }
    // Otherwise: best estimated snugness among free containers below the cat.
    let bestScore = -Infinity;
    let pick: { cat: Cat; container: Prop; tx: number; ty: number } | null = null;
    for (const cat of unseated) {
      const area = breedArea(cat.breed);
      for (let k = 0; k < this.containers.length; k++) {
        if (!free[k]) continue;
        const c = this.containers[k];
        const ratio = area / c.capacity;
        const snug = -Math.abs(Math.log(ratio / 1.35));
        const below = c.opening!.y > cat.body.cy ? 0.6 : 0;
        const dist = Math.abs(c.x - cat.body.cx) / WORLD_W;
        const s = snug + below - dist * 0.8;
        if (s > bestScore) {
          bestScore = s;
          const r = BREEDS[cat.breed].physics.radius;
          pick = { cat, container: c, tx: (c.opening!.x0 + c.opening!.x1) / 2, ty: c.opening!.y - r };
        }
      }
    }
    if (pick) this.hints++;
    return pick;
  }
}
