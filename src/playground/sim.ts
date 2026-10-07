// What goes on up in the sky each physics step, with no screen (playground.ts
// plays the sounds and the puffs for what it reports; the tests and the
// tutorial's course run it just the same): the hammocks and bouncy cushions,
// the tubes, the toys, and cats falling into the sea of cloud.

import type { Cat, Session } from '../game/session';
import type { StaticShape } from '../physics/shapes';
import type { SoftBody } from '../physics/softbody';
import { FRAME_DT, GRAVITY } from '../physics/world';
import { inRingOf } from '../house/leap';
import { Tubes } from '../house/tubes';
import { GadgetWorks, type Gadget, type GadgetEvent } from './gadgets';
import { buildPiece, gadgetOf, mouthOf, skyTube, spawnShapes, tubeShapes, type PieceProp, type PlaySave, type SkyTube } from './layout';

/** What happened this step: into a tube or out of one, a toy at work, a landing on a bouncy cushion, a fall into the sea. */
export type SkyEvent =
  | { t: 'in'; cat: Cat }
  | { t: 'out'; cat: Cat; x: number; y: number }
  | GadgetEvent
  | { t: 'boing'; cat: Cat | null; speed: number }
  | { t: 'fell'; cat: Cat };

export class SkySim {
  /** The pieces up in the sky (their colliders are in the world), and the tubes as they're ridden. */
  props: PieceProp[] = [];
  skyTubes: SkyTube[] = [];
  readonly tubes: Tubes<Cat, SkyTube>;
  /** The toys at work (cannons, fans, bumpers, belts). */
  readonly works: GadgetWorks;
  frame = 0;
  /** Just out of a tube: a moment before a mouth can have it again. */
  private cooldown = new Map<Cat, number>();
  /** How fast each body was coming down the step before (a bouncy cushion springs back one that lands hard). */
  private fellAt = new WeakMap<SoftBody, number>();

  constructor(private readonly session: () => Session) {
    this.tubes = new Tubes<Cat, SkyTube>(() => session().world);
    this.tubes.inTheWay = (cat, out) => this.inTheWay(cat, out);
    this.works = new GadgetWorks(() => session().world);
  }

  /** The sky as built: its pieces and tubes, and every collider (the respawn cloud's too). */
  build(save: PlaySave): StaticShape[] {
    this.props = save.pieces.map(buildPiece);
    this.skyTubes = save.tubes.map(skyTube);
    return [...spawnShapes(), ...this.props.flatMap((p) => p.shapes), ...save.tubes.flatMap(tubeShapes)];
  }

  /** A fresh start (a new session). */
  start(): void {
    this.frame = 0;
    this.cooldown.clear();
  }

  /** The toys up in the sky, as the toys' works take them. */
  toys(): Gadget[] {
    const out: Gadget[] = [];
    for (const p of this.props) {
      const g = gadgetOf(p.save);
      if (g) out.push(g);
    }
    return out;
  }

  /** Let go at a cannon's mouth or a tube's: in it goes ('cannon' or 'tube'; null: neither). */
  released(cat: Cat): 'cannon' | 'tube' | null {
    const b = cat.body;
    b.computeCentroid();
    const cannon = GadgetWorks.cannonAt(this.toys(), b.cx, b.cy);
    if (cannon && this.works.load(cat, cannon)) return 'cannon';
    for (const t of this.skyTubes) {
      const m = mouthOf(t, b.cx, b.cy);
      if (m !== null) {
        this.ride(cat, t, m);
        return 'tube';
      }
    }
    return null;
  }

  private ride(cat: Cat, t: SkyTube, mouth: 0 | 1): void {
    // (in at b, its lower mouth, is "up" the way the house's tubes go)
    this.tubes.start(cat, t, mouth === 1);
  }

  /** One physics step (after the session's): `seaY`, how far down a cat falls into the sea. */
  step(seaY: number): SkyEvent[] {
    const s = this.session();
    const out: SkyEvent[] = [];
    this.frame++;
    this.stepLive(out);
    this.tubes.step();
    // (out of a tube: a moment before a mouth can have it again. Its own is
    // right there: without that, it'd go straight back in, and back and forth)
    for (const e of this.tubes.drain()) {
      if (e.t === 'in') out.push({ t: 'in', cat: e.cat });
      else {
        e.cat.sinceTouch = 0;
        e.cat.settled = 0;
        e.cat.intent = null;
        this.cooldown.set(e.cat, 45);
        out.push({ t: 'out', cat: e.cat, x: e.x, y: e.y });
      }
    }
    // the toys at work: fans blowing, belts running, bumpers and cannons
    for (const e of this.works.step(this.toys(), s.cats, (c) => !c.grabbed && !this.tubes.riding(c))) {
      e.cat.settled = 0;
      e.cat.intent = null;
      if (e.t !== 'bump') e.cat.sinceTouch = 0;
      out.push(e);
    }
    for (const c of s.cats) {
      if (c.grabbed || this.tubes.riding(c) || this.works.inCannon(c) !== null) continue;
      const b = c.body;
      b.computeCentroid();
      if (b.cy > seaY) {
        out.push({ t: 'fell', cat: c });
        continue;
      }
      if ((this.cooldown.get(c) ?? 0) > 0) continue;
      for (const t of this.skyTubes) {
        const m = mouthOf(t, b.cx, b.cy);
        if (m !== null) {
          this.ride(c, t, m);
          break;
        }
      }
    }
    for (const [c, t] of this.cooldown) {
      if (t <= 1) this.cooldown.delete(c);
      else this.cooldown.set(c, t - 1);
    }
    return out;
  }

  /** Hammocks take the weight of who's in them; bouncy cushions spring a cat that lands on them back up, boing. */
  private stepLive(out: SkyEvent[]): void {
    const s = this.session();
    const bodies = s.world.bodies;
    const catOf = (b: SoftBody): Cat | undefined => s.cats.find((c) => c.body === b);
    const free = (b: SoftBody): boolean => {
      const c = catOf(b);
      return !c || (!c.grabbed && !this.tubes.riding(c));
    };
    const fell = (b: SoftBody): number => this.fellAt.get(b) ?? 0;
    for (const p of this.props) {
      if (p.sling) {
        p.sling.gather(bodies);
        p.sling.step(FRAME_DT, GRAVITY);
      }
      if (p.bouncer) {
        const hit = p.bouncer.step(bodies, free, fell);
        if (hit) {
          const c = catOf(hit.body) ?? null;
          if (c) {
            c.settled = 0;
            c.intent = null;
          }
          out.push({ t: 'boing', cat: c, speed: hit.speed });
        }
      }
    }
    for (const b of bodies) this.fellAt.set(b, b.vcy);
  }

  /** Something in the way of a cat coming out of a tube: it waits, and whoever's there is shooed off. */
  private inTheWay(cat: Cat, out: Float64Array): boolean {
    const s = this.session();
    const n = cat.body.n;
    const by = inRingOf(out, n, s.world.bodies, cat.body);
    if (this.frame % 20 === 0) {
      let mx = 0;
      for (let i = 0; i < n; i++) mx += out[i * 2] / n;
      for (const b of by) {
        const o = s.cats.find((c) => c.body === b);
        if (o?.grabbed) continue;
        b.computeCentroid();
        b.kick((Math.sign(b.cx - mx) || 1) * 170, -200);
      }
    }
    return by.length > 0;
  }
}
