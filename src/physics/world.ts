// Fixed-step world: 60 frames/s, 8 substeps each ("small steps" PBD).
// Only + - * / and sqrt are used so every device simulates the same room the
// same way, which is what lets the daily solver promise a fair par.

import { catPushback, NODE_RADIUS, SoftBody } from './softbody';
import type { StaticShape } from './shapes';

export const FRAME_DT = 1 / 60;
export const SUBSTEPS = 8;
export const GRAVITY = 1100;

export interface ImpactEvent {
  body: SoftBody;
  shape: StaticShape;
  speed: number;
}

export class World {
  static iterations = 2;
  /** Substeps per frame (other games on the engine may trade accuracy for speed). */
  substeps = SUBSTEPS;
  readonly bodies: SoftBody[] = [];
  readonly statics: StaticShape[] = [];
  frame = 0;
  /** Impacts above a threshold since the last drain (for sounds). */
  impacts: ImpactEvent[] = [];
  private shapeById = new Map<number, StaticShape>();

  addStatic(s: StaticShape): void {
    this.statics.push(s);
    this.shapeById.set(s.id, s);
    this.wakeAll();
  }

  /** Something in the room changed: every cat re-checks its footing. */
  wakeAll(): void {
    for (const b of this.bodies) b.wake();
  }

  removeStaticsOfProp(propId: number): void {
    for (let i = this.statics.length - 1; i >= 0; i--) {
      if (this.statics[i].propId === propId) {
        this.shapeById.delete(this.statics[i].id);
        this.statics.splice(i, 1);
      }
    }
    this.wakeAll();
  }

  shape(id: number): StaticShape | undefined {
    return this.shapeById.get(id);
  }

  addBody(b: SoftBody): SoftBody {
    this.bodies.push(b);
    return b;
  }

  removeBody(b: SoftBody): void {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  step(): void {
    const substeps = this.substeps;
    const h = FRAME_DT / substeps;
    const bodies = this.bodies;
    for (const b of bodies) {
      b.impactSpeed = 0;
      b.impactShape = -1;
      // A sleeping cat wakes the moment the game or a finger pulls on it.
      if (b.asleep && (b.grab || b.settleForce !== 0 || b.assistAx <= -40 || b.assistAx >= 40)) b.wake();
      if (b.grab) {
        b.grab.fromX = b.grab.hx;
        b.grab.fromY = b.grab.hy;
      }
    }
    for (let s = 0; s < substeps; s++) {
      const u = (s + 1) / substeps;
      for (const b of bodies) {
        b.bodyContacts = 0;
        const g = b.grab;
        if (g) {
          // the hand goes to the finger in even steps across the frame
          g.hx = g.fromX + (g.tx - g.fromX) * u;
          g.hy = g.fromY + (g.ty - g.fromY) * u;
        }
        if (!b.asleep) b.integrate(h, GRAVITY);
      }
      // Two passes so pressure and walls agree before velocities are derived
      // (one pass lets them fight, which shows up as chatter in tight cups).
      for (let it = 0; it < World.iterations; it++) {
        const first = it === 0;
        for (const b of bodies) {
          if (b.asleep) continue;
          b.solveInternal(h, first);
          if (first) b.applyAssist(h);
        }
        // (which cats touch which is worked out afresh each substep, after
        // the finger has read last substep's)
        if (first) for (const b of bodies) b.bodyTouch.fill(0);
        for (let i = 0; i < bodies.length; i++) {
          for (let j = i + 1; j < bodies.length; j++) collideBodies(bodies[i], bodies[j]);
        }
        for (const b of bodies) if (!b.asleep) this.collideStatics(b, h, s === 0 && first, first);
      }
      for (const b of bodies) {
        if (b.grab) {
          // what pushed back this substep, eased (a held cat feels it)
          b.resistX += (b.pushX - b.resistX) * RESIST_EASE;
          b.resistY += (b.pushY - b.resistY) * RESIST_EASE;
          b.pushX = 0;
          b.pushY = 0;
        }
        if (!b.asleep) b.finishSubstep(h);
      }
    }
    for (const b of bodies) {
      b.frameUpdate(FRAME_DT);
      let touching = SoftBody.restOnBodies && b.bodyContacts > 0;
      for (let i = 0; i < b.n && !touching; i++) {
        if (b.contactShape[i] !== -1) {
          touching = true;
          break;
        }
      }
      b.airborneFrames = touching ? 0 : b.airborneFrames + 1;
      if (b.impactSpeed > 160 && b.impactShape !== -1) {
        const shape = this.shapeById.get(b.impactShape);
        if (shape) this.impacts.push({ body: b, shape, speed: b.impactSpeed });
      }
    }
    this.frame++;
  }

  drainImpacts(): ImpactEvent[] {
    const out = this.impacts;
    this.impacts = [];
    return out;
  }

  private collideStatics(b: SoftBody, h: number, firstSubstep: boolean, resetContacts: boolean): void {
    const { n, x, y, px, py } = b;
    const statics = this.statics;
    const rN = NODE_RADIUS;
    // Held cats slide easily (you're carrying them, not dragging them along).
    const mu = b.p.friction * (b.grab ? 0.3 : 1) * b.frictionMul;
    // Body AABB for broad phase
    let bminX = Infinity;
    let bminY = Infinity;
    let bmaxX = -Infinity;
    let bmaxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (x[i] < bminX) bminX = x[i];
      if (x[i] > bmaxX) bmaxX = x[i];
      if (y[i] < bminY) bminY = y[i];
      if (y[i] > bmaxY) bmaxY = y[i];
      if (resetContacts) b.contactShape[i] = -1;
    }
    for (let si = 0; si < statics.length; si++) {
      const s = statics[si];
      const reach = s.radius + rN;
      if (bmaxX < s.minX - rN || bminX > s.maxX + rN || bmaxY < s.minY - rN || bminY > s.maxY + rN) continue;
      const sn = s.n;
      for (let i = 0; i < n; i++) {
        const nxp = x[i];
        const nyp = y[i];
        if (nxp < s.minX - rN || nxp > s.maxX + rN || nyp < s.minY - rN || nyp > s.maxY + rN) continue;
        // Max plane distance
        let maxD = -Infinity;
        let maxK = 0;
        for (let k = 0; k < sn; k++) {
          const dk = s.nx[k] * nxp + s.ny[k] * nyp - s.d[k];
          if (dk > maxD) {
            maxD = dk;
            maxK = k;
          }
        }
        if (maxD >= reach) continue;
        let nX: number;
        let nY: number;
        let depth: number;
        if (maxD <= 0) {
          nX = s.nx[maxK];
          nY = s.ny[maxK];
          depth = reach - maxD;
        } else {
          // Outside the core polygon: exact distance to the boundary.
          let bestD2 = Infinity;
          let cxp = 0;
          let cyp = 0;
          for (let k = 0; k < sn; k++) {
            const k2 = k + 1 === sn ? 0 : k + 1;
            const ax = s.xs[k];
            const ay = s.ys[k];
            const ex = s.xs[k2] - ax;
            const ey = s.ys[k2] - ay;
            const l2 = ex * ex + ey * ey;
            let t = l2 > 1e-12 ? ((nxp - ax) * ex + (nyp - ay) * ey) / l2 : 0;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            const qx = ax + ex * t;
            const qy = ay + ey * t;
            const ddx = nxp - qx;
            const ddy = nyp - qy;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 < bestD2) {
              bestD2 = d2;
              cxp = qx;
              cyp = qy;
            }
          }
          if (bestD2 >= reach * reach) continue;
          const dd = Math.sqrt(bestD2);
          if (dd < 1e-9) {
            nX = s.nx[maxK];
            nY = s.ny[maxK];
          } else {
            nX = (nxp - cxp) / dd;
            nY = (nyp - cyp) / dd;
          }
          depth = reach - dd;
        }
        // Normal velocity before resolving (for impact sounds)
        const vn = ((x[i] - px[i]) * nX + (y[i] - py[i]) * nY) / h;
        if (firstSubstep && -vn > b.impactSpeed) {
          b.impactSpeed = -vn;
          b.impactShape = s.id;
        }
        x[i] += nX * depth;
        y[i] += nY * depth;
        if (b.grab) {
          b.pushX += nX * depth;
          b.pushY += nY * depth;
        }
        // Positional Coulomb friction
        const dxs = x[i] - px[i];
        const dys = y[i] - py[i];
        const dn = dxs * nX + dys * nY;
        const tx = dxs - dn * nX;
        const ty = dys - dn * nY;
        const tl = Math.sqrt(tx * tx + ty * ty);
        const f = mu * s.friction * 2;
        if (tl > 1e-12) {
          const lim = f * depth;
          if (tl <= lim) {
            x[i] -= tx;
            y[i] -= ty;
          } else {
            const k = lim / tl;
            x[i] -= tx * k;
            y[i] -= ty * k;
          }
        }
        b.contactShape[i] = s.id;
        b.contactNx[i] = nX;
        b.contactNy[i] = nY;
      }
      this.skinVsCorners(b, s, s.radius + rN * CORNER_SKIN, bminX, bminY, bmaxX, bmaxY);
    }
  }

  /**
   * The skin between two nodes is solid too (a chain of capsules). Nodes alone
   * would let a thin rim slip between two of them like a cheese wire, leaving
   * a glass wall running through a cat. For a convex shape the skin can only
   * come too close at one of the shape's corners, so each corner pushes the
   * stretch of skin nearest to it back out, or, if the corner has just slipped
   * inside the cat, back out over the corner. Skin wrapped snugly round a rim
   * is left alone (the edges stay a little inside the nodes' reach there, and
   * fighting the skin's tension over that made cats quiver), and corners are
   * frictionless: skin slides over a rim like syrup over a spoon.
   */
  private skinVsCorners(b: SoftBody, s: StaticShape, reach: number, bminX: number, bminY: number, bmaxX: number, bmaxY: number): void {
    const { n, x, y } = b;
    for (let k = 0; k < s.n; k++) {
      const vx = s.xs[k];
      const vy = s.ys[k];
      if (vx < bminX - reach || vx > bmaxX + reach || vy < bminY - reach || vy > bmaxY + reach) continue;
      let bestD2 = reach * reach;
      let bi = -1;
      let bt = 0;
      let inside = false;
      for (let i = 0; i < n; i++) {
        const j = i + 1 === n ? 0 : i + 1;
        const yi = y[i];
        const yj = y[j];
        if (yi > vy !== yj > vy && vx < x[i] + ((vy - yi) * (x[j] - x[i])) / (yj - yi)) inside = !inside;
        const ex = x[j] - x[i];
        const ey = yj - yi;
        const l2 = ex * ex + ey * ey;
        let t = l2 > 1e-12 ? ((vx - x[i]) * ex + (vy - yi) * ey) / l2 : 0;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const qx = x[i] + ex * t - vx;
        const qy = yi + ey * t - vy;
        const d2 = qx * qx + qy * qy;
        if (d2 < bestD2) {
          bestD2 = d2;
          bi = i;
          bt = t;
        }
      }
      // Nearest to a node (or nothing in reach): the node pass handles it.
      if (bi < 0 || bt <= 0 || bt >= 1) continue;
      const i = bi;
      const j = i + 1 === n ? 0 : i + 1;
      const t = bt;
      // Direction to move the skin: away from the corner, or across it.
      let ux = x[i] + (x[j] - x[i]) * t - vx;
      let uy = y[i] + (y[j] - y[i]) * t - vy;
      const d = Math.sqrt(ux * ux + uy * uy);
      if (d < 1e-6) continue;
      ux /= d;
      uy /= d;
      let corr = reach - d;
      if (inside) {
        ux = -ux;
        uy = -uy;
        corr = reach + d;
      }
      const wa = 1 - t;
      const wb = t;
      const inv = 1 / (wa * wa + wb * wb);
      const m = corr * inv;
      x[i] += ux * m * wa;
      y[i] += uy * m * wa;
      x[j] += ux * m * wb;
      y[j] += uy * m * wb;
      if (b.contactShape[i] === -1) {
        b.contactShape[i] = s.id;
        b.contactNx[i] = ux;
        b.contactNy[i] = uy;
      }
      if (b.contactShape[j] === -1) {
        b.contactShape[j] = s.id;
        b.contactNx[j] = ux;
        b.contactNy[j] = uy;
      }
    }
  }
}

/** How quickly a held cat's felt push-back follows what's pushing it (per substep). */
const RESIST_EASE = 0.5;
/** How much pressing into another cat counts toward what a held cat feels. */
const CAT_PUSH = 2;

/** How much of a node's radius the skin between nodes keeps from a corner. */
const CORNER_SKIN = 0.5;

const skinBB = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const skinBB2 = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/**
 * Two cats squish against each other (node-vs-edge, both directions). A
 * sleeping cat is an immovable cushion for a gently settling neighbour, but a
 * moving or carried cat bumping into it wakes it up.
 */
export function collideBodies(a: SoftBody, b: SoftBody): void {
  if (a.asleep && b.asleep) return;
  const pad = NODE_RADIUS * 2;
  a.bounds(skinBB);
  b.bounds(skinBB2);
  if (
    skinBB.maxX + pad < skinBB2.minX ||
    skinBB2.maxX + pad < skinBB.minX ||
    skinBB.maxY + pad < skinBB2.minY ||
    skinBB2.maxY + pad < skinBB.minY
  )
    return;
  if (a.asleep && (b.grab || b.energy > BUMP_ENERGY)) a.wake();
  if (b.asleep && (a.grab || a.energy > BUMP_ENERGY)) b.wake();
  nodesVsBody(a, b, skinBB2);
  b.bounds(skinBB2);
  a.bounds(skinBB);
  nodesVsBody(b, a, skinBB);
}

/** Kinetic energy per unit mass above which a cat bumping a sleeper wakes it. */
const BUMP_ENERGY = 300;

/**
 * When one of two touching cats is being carried: which ways the other one is
 * being pushed by everything else it touches (furniture, other cats). One
 * pushed back toward the carried cat can't give way to it.
 */
const PIN_X = new Float64Array(64);
const PIN_Y = new Float64Array(64);
let pinCount = 0;

function gatherPins(o: SoftBody): void {
  pinCount = 0;
  for (let q = 0; q < o.n && pinCount < PIN_X.length; q++) {
    if (o.contactShape[q] !== -1) {
      PIN_X[pinCount] = o.contactNx[q];
      PIN_Y[pinCount++] = o.contactNy[q];
    } else if (o.bodyTouch[q] !== 0) {
      PIN_X[pinCount] = o.bodyNx[q];
      PIN_Y[pinCount++] = o.bodyNy[q];
    }
  }
}

/** How firmly the other cat is held in place against being pushed away along -(ux, uy) (0..1). */
function pinnedAgainst(ux: number, uy: number): number {
  let best = 0;
  for (let k = 0; k < pinCount; k++) {
    const d = PIN_X[k] * ux + PIN_Y[k] * uy;
    if (d > best) best = d;
  }
  if (best <= 0.2) return 0;
  if (best >= 0.6) return 1;
  const t = (best - 0.2) / 0.4;
  return t * t * (3 - 2 * t);
}

function nodesVsBody(a: SoftBody, b: SoftBody, bb: { minX: number; minY: number; maxX: number; maxY: number }): void {
  const pad = NODE_RADIUS * 2;
  const skin = NODE_RADIUS * 2;
  const bn = b.n;
  const bx = b.x;
  const by = b.y;
  const wa = a.asleep ? 0 : a.invNodeMass;
  const wb = b.asleep ? 0 : b.invNodeMass;
  if (a.grab) gatherPins(b);
  else if (b.grab) gatherPins(a);
  for (let i = 0; i < a.n; i++) {
    const px = a.x[i];
    const py = a.y[i];
    if (px < bb.minX - pad || px > bb.maxX + pad || py < bb.minY - pad || py > bb.maxY + pad) continue;
    // Inside test + closest edge in one pass
    let inside = false;
    let bestD2 = Infinity;
    let bestK = 0;
    let bestT = 0;
    for (let k = 0, j = bn - 1; k < bn; j = k++) {
      const yk = by[k];
      const yj = by[j];
      if (yk > py !== yj > py) {
        const xc = bx[j] + ((py - yj) * (bx[k] - bx[j])) / (yk - yj);
        if (px < xc) inside = !inside;
      }
      // edge j -> k
      const ex = bx[k] - bx[j];
      const ey = by[k] - by[j];
      const l2 = ex * ex + ey * ey;
      let t = l2 > 1e-12 ? ((px - bx[j]) * ex + (py - by[j]) * ey) / l2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const qx = bx[j] + ex * t - px;
      const qy = by[j] + ey * t - py;
      const d2 = qx * qx + qy * qy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestK = j;
        bestT = t;
      }
    }
    if (!inside && bestD2 >= skin * skin) continue;
    const j0 = bestK;
    const j1 = j0 + 1 === bn ? 0 : j0 + 1;
    const qx = bx[j0] + (bx[j1] - bx[j0]) * bestT;
    const qy = by[j0] + (by[j1] - by[j0]) * bestT;
    const d = Math.sqrt(bestD2);
    let nX: number;
    let nY: number;
    let depth: number;
    if (inside) {
      // push node from inside b to the closest edge point and a skin beyond
      if (d > 1e-9) {
        nX = (qx - px) / d;
        nY = (qy - py) / d;
      } else {
        const ex = bx[j1] - bx[j0];
        const ey = by[j1] - by[j0];
        const el = Math.sqrt(ex * ex + ey * ey) || 1;
        nX = ey / el;
        nY = -ex / el;
      }
      depth = d + skin;
    } else {
      if (d < 1e-9) continue;
      nX = (px - qx) / d;
      nY = (py - qy) / d;
      depth = skin - d;
    }
    const t = bestT;
    const w0 = (1 - t) * wb;
    const w1 = t * wb;
    const denom = wa + (1 - t) * w0 + t * w1;
    if (denom < 1e-12) continue;
    const lambda = (depth / denom) * 0.8;
    a.bodyContacts++;
    b.bodyContacts++;
    // (which way is out, for a finger holding either cat)
    a.bodyTouch[i] = 1;
    a.bodyNx[i] = nX;
    a.bodyNy[i] = nY;
    b.bodyTouch[j0] = 1;
    b.bodyNx[j0] = -nX;
    b.bodyNy[j0] = -nY;
    b.bodyTouch[j1] = 1;
    b.bodyNx[j1] = -nX;
    b.bodyNy[j1] = -nY;
    // (how deep a held cat presses into another counts in full: a squashy
    // cat gives way rather than pushing back, but it mustn't be squashed.
    // Except a cat lying on top of it, lifted: that one just comes too,
    // unless something above holds it down)
    if (a.grab) {
      const k = depth * CAT_PUSH * Math.max(catPushback(nY), pinnedAgainst(nX, nY));
      a.pushX += nX * k;
      a.pushY += nY * k;
    }
    if (b.grab) {
      const k = depth * CAT_PUSH * Math.max(catPushback(-nY), pinnedAgainst(-nX, -nY));
      b.pushX -= nX * k;
      b.pushY -= nY * k;
    }
    a.x[i] += nX * lambda * wa;
    a.y[i] += nY * lambda * wa;
    b.x[j0] -= nX * lambda * w0;
    b.y[j0] -= nY * lambda * w0;
    b.x[j1] -= nX * lambda * w1;
    b.y[j1] -= nY * lambda * w1;
  }
}
