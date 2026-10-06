// Life at home: what the cats get up to while you're looking. Each cat has a
// temperament (Pip is playful, Duchess dramatic, Biscuit sleepy...) and a mood
// that changes from day to day. Now and then one goes after the ball of yarn,
// or another cat: it crouches low, creeps up, wiggles its back end... and
// pounces. The cat pounced on plays along, can't be bothered, or hisses; and
// now and then, with two touchy cats, it's a scrap: a tumbling cloud of dust
// with scratches and fluff flying out, and someone may come out of it hurt
// (fish make it better: see Home). A tap on the cloud breaks it up.

import type { AudioEngine } from '../audio/audio';
import { WORLD_W } from '../game/props';
import type { Cat, Session } from '../game/session';
import { BREEDS, type BreedId } from '../physics/breeds';
import { SoftBody } from '../physics/softbody';
import { FRAME_DT, GRAVITY } from '../physics/world';
import type { Expression } from '../render/catArt';
import type { Ctx } from '../render/paint';
import type { Renderer } from '../render/renderer';
import { paintDustCloud, paintFlash, paintFluff, paintYarn } from './anticsArt';
import { FLOORS, floorAt } from './layout';

// ---------------------------------------------------------------------------
// Temperaments and moods

export interface Temper {
  /** How it's described (the cats card). */
  word: string;
  /** How often it plays: stalks the yarn or another cat (0..1). */
  play: number;
  /** How badly it takes being pounced on (0..1): touchy cats hiss, and two touchy ones may scrap. */
  touchy: number;
  /** How much it would rather stay where it is (0..1). */
  lazy: number;
  /** How much it likes the yarn, over the other cats (0..1). */
  toy: number;
}

export const TEMPERS: Record<BreedId, Temper> = {
  kitten: { word: 'playful', play: 0.85, touchy: 0.1, lazy: 0.1, toy: 0.55 },
  tabby: { word: 'easygoing', play: 0.5, touchy: 0.25, lazy: 0.3, toy: 0.5 },
  persian: { word: 'dramatic', play: 0.25, touchy: 0.8, lazy: 0.45, toy: 0.7 },
  mainecoon: { word: 'a gentle hunter', play: 0.6, touchy: 0.15, lazy: 0.25, toy: 0.75 },
  chonk: { word: 'sleepy', play: 0.15, touchy: 0.5, lazy: 0.8, toy: 0.4 },
  void: { word: 'mischievous', play: 0.7, touchy: 0.6, lazy: 0.2, toy: 0.3 },
  // yours: whatever personality you gave it in the cat maker (see applyMyCat)
  mine: { word: 'playful', play: 0.85, touchy: 0.1, lazy: 0.1, toy: 0.55 },
};

export type Mood = 'sunny' | 'grumpy' | 'dozy';

export const MOOD_WORDS: Record<Mood, string> = { sunny: 'full of beans today', grumpy: 'a bit grumpy today', dozy: 'dozy today' };

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** A cat's mood today (null: its usual self): the same all day, different from day to day. */
export function moodOf(b: BreedId, day: string): Mood | null {
  const u = hashStr(`${day}:${b}`);
  return u < 0.2 ? 'sunny' : u < 0.33 ? 'grumpy' : u < 0.45 ? 'dozy' : null;
}

/** Its temperament as it is today. */
export function temperOf(b: BreedId, mood: Mood | null): Temper {
  const t = { ...TEMPERS[b] };
  if (mood === 'sunny') {
    t.play = Math.min(1, t.play + 0.2);
    t.touchy = Math.max(0, t.touchy - 0.15);
  } else if (mood === 'grumpy') {
    t.touchy = Math.min(1, t.touchy + 0.25);
    t.play = Math.max(0, t.play - 0.1);
  } else if (mood === 'dozy') {
    t.lazy = Math.min(1, t.lazy + 0.3);
    t.play = Math.max(0, t.play - 0.2);
  }
  return t;
}

/**
 * How likely a pounce ends in a scrap: it takes a touchy cat pounced on, and
 * a pouncer touchy enough to answer back (twice as likely when either is
 * cross already).
 */
export function scrapChance(pouncer: Temper, target: Temper, cross: boolean): number {
  return Math.min(0.75, 0.8 * target.touchy * (0.2 + 0.8 * pouncer.touchy) * (cross ? 1.6 : 1));
}

// ---------------------------------------------------------------------------

/** Of every turn a cat gets, how much of its playfulness goes into a game. */
const PLAY_CHANCE = 0.55;
/** At least this long between scraps (frames). */
const SCRAP_GAP = 180 * 60;
/** The yarn ball, and where it starts: on the window sill, beside Pip. */
export const YARN_R = 9;
export const YARN_HOME = { x: 150, y: 212 };

export interface AnticsHost {
  readonly session: Session;
  readonly renderer: Renderer;
  readonly audio: AudioEngine;
  /** Today (for moods). */
  day(): string;
  /** Is this cat hurt (it doesn't play)? */
  hurt(b: BreedId): boolean;
  /** A scrap left a cat hurt. */
  hurtCat(cat: Cat): void;
  /** Leap a cat to land on a surface at (x, y) (`low`: a quick, flat pounce), calling `land` as it touches down. */
  leap(cat: Cat, x: number, y: number, low: boolean, land?: () => void): void;
  /** Off doing something else: in a tube, leaping, held. */
  away(cat: Cat): boolean;
  /** Somewhere free for a cat to leap to, away from (x, y) if it can (null: nowhere). */
  escape(cat: Cat, fromX: number): { x: number; y: number } | null;
  /** Where the cats' games mustn't take them: an open tube's mouth, or right over one (they'd be whisked off to another floor). */
  offLimits(x: number, y: number): boolean;
}

type Target = { kind: 'cat'; cat: Cat } | { kind: 'toy' };

interface Stalk {
  cat: Cat;
  target: Target;
  phase: 'crouch' | 'creep' | 'wiggle' | 'leap';
  t: number;
  dir: 1 | -1;
  crouchFor: number;
  creepFor: number;
  wiggleFor: number;
  /** How many pounces in a row (a chase). */
  chain: number;
}

interface Fight {
  a: Cat;
  b: Cat;
  /** The cloud's middle at rest, the surface they're on, its size. */
  x: number;
  y: number;
  ground: number;
  r: number;
  t: number;
  T: number;
  seed: number;
  /** Their outlines (from their middles), to tumble round. */
  shapes: [Float64Array, Float64Array];
  /** Which way each went in from (a's side). */
  side: 1 | -1;
}

export interface Fluff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  age: number;
  life: number;
  color: string;
  light: string;
  ground: number;
  seed: number;
}

export interface Flash {
  x: number;
  y: number;
  ang: number;
  age: number;
  life: number;
  kind: 'scratch' | 'star';
}

/** Cats in the middle of something: what they look like meanwhile. */
interface Face {
  expression: Expression;
  look: number;
  until: number;
}

export class Antics {
  private frame = 0;
  readonly stalks: Stalk[] = [];
  readonly fights: Fight[] = [];
  readonly fluff: Fluff[] = [];
  readonly flashes: Flash[] = [];
  private faces = new Map<Cat, Face>();
  /** Cross after a hiss or a scrap (no playing), until this frame. */
  private crossUntil = new Map<Cat, number>();
  private pending: { at: number; fn: () => void }[] = [];
  private lastScrap = -SCRAP_GAP;
  /** The ball of yarn (in the living room). */
  toy: SoftBody | null = null;
  private toySpin = 0;
  private toyAngle = 0;
  /** Frames the yarn has sat still somewhere off limits. */
  private toyStuck = 0;

  constructor(private readonly host: AnticsHost) {}

  // ---------------------------------------------------------------------------
  // Coming and going

  /** The house's session is up: the yarn goes in (where it was left, or on the window sill). */
  enter(at: { x: number; y: number } | null): void {
    this.reset();
    const p = at && floorAt(at.y) === 'living' && at.x > YARN_R && at.x < WORLD_W - YARN_R ? at : YARN_HOME;
    // (a small soft ball: stiff enough to stay round, soft enough to be stable at this size)
    this.toy = new SoftBody('kitten', p.x, p.y - YARN_R - 3, {
      radius: YARN_R,
      nodes: 14,
      density: 0.8,
      tension: 250,
      equalize: 0.2,
      maxStretch: 1.4,
      pressure: 0.95,
      squish: 0.02,
      shape: 0.12,
      viscosity: 6,
      friction: 0.45,
      upright: 0,
      hop: 300,
      slurp: 0,
      plasticity: 0,
      loafAspect: 1,
      hang: 1,
    });
    this.host.session.world.addBody(this.toy);
  }

  /** Leaving the house: everyone's put down, scraps stop where they are (nobody hurt). */
  leave(): void {
    for (const f of [...this.fights]) this.endFight(f, false);
    for (const s of [...this.stalks]) this.endStalk(s);
    this.reset();
  }

  private reset(): void {
    this.stalks.length = 0;
    this.fights.length = 0;
    this.fluff.length = 0;
    this.flashes.length = 0;
    this.faces.clear();
    this.crossUntil.clear();
    this.pending = [];
  }

  /** Where the yarn is (to remember it). */
  toyAt(): { x: number; y: number } | null {
    const t = this.toy;
    if (!t) return null;
    t.computeCentroid();
    return { x: Math.round(t.cx), y: Math.round(t.cy + YARN_R) };
  }

  // ---------------------------------------------------------------------------
  // Who's doing what

  /** Busy with a game or a scrap (not to be sent anywhere else). */
  busy(cat: Cat): boolean {
    return this.stalks.some((s) => s.cat === cat) || this.fighting(cat);
  }

  fighting(cat: Cat): boolean {
    return this.fights.some((f) => f.a === cat || f.b === cat);
  }

  /** Cross after a hiss or a scrap. */
  sulking(cat: Cat): boolean {
    return (this.crossUntil.get(cat) ?? 0) > this.frame;
  }

  temper(cat: Cat): Temper {
    return temperOf(cat.breed, moodOf(cat.breed, this.host.day()));
  }

  /** How a cat looks while it's up to something (null: as usual): its face, and its back end wiggling before a pounce. */
  face(cat: Cat): { expression: Expression; look?: number; shadow?: boolean; wiggle?: { sway: number; rear: 1 | -1 } } | null {
    if (cat.grabbed) return null;
    if (this.fighting(cat)) return { expression: 'cross', shadow: false };
    const s = this.stalks.find((k) => k.cat === cat);
    if (s) {
      if (s.phase !== 'wiggle') return { expression: s.phase === 'leap' ? 'wide' : 'stalk', look: s.dir };
      // faster and faster, then a moment's stillness, then go
      const u = s.t / s.wiggleFor;
      const env = Math.min(1, u * 5) * (1 - Math.max(0, (u - 0.82) / 0.18));
      const sway = cat.body.p.radius * 0.2 * env * Math.sin(Math.PI * 2 * (4.5 + 2.5 * u) * s.t);
      return { expression: 'stalk', look: s.dir, wiggle: { sway, rear: s.dir > 0 ? -1 : 1 } };
    }
    const f = this.faces.get(cat);
    if (f && f.until > this.frame) return { expression: f.expression, look: f.look };
    if (this.host.hurt(cat.breed) && cat.sinceTouch > 22) return { expression: 'sad' };
    return null;
  }

  private show(cat: Cat, expression: Expression, seconds: number, look = 0): void {
    this.faces.set(cat, { expression, look, until: this.frame + Math.round(seconds * 60) });
  }

  private sulk(cat: Cat, seconds: number): void {
    this.crossUntil.set(cat, Math.max(this.crossUntil.get(cat) ?? 0, this.frame + Math.round(seconds * 60)));
  }

  private later(seconds: number, fn: () => void): void {
    this.pending.push({ at: this.frame + Math.round(seconds * 60), fn });
  }

  /** Free to be pounced on, or to pounce: not off somewhere, not busy, not hurt, not in a box. */
  private free(cat: Cat): boolean {
    return !cat.grabbed && !cat.seat && !this.host.away(cat) && !this.busy(cat) && !this.host.hurt(cat.breed);
  }

  // ---------------------------------------------------------------------------
  // A cat's turn

  /**
   * It's this cat's turn to do something: if it's in the mood to play, it
   * goes after the yarn or another cat (true); otherwise it's up to the house
   * (a hop somewhere, or a nap).
   */
  turn(cat: Cat): boolean {
    if (!this.free(cat) || this.sulking(cat)) return false;
    const t = this.temper(cat);
    if (Math.random() > t.play * PLAY_CHANCE) return false;
    const target = this.pickTarget(cat, t);
    if (!target) return false;
    this.startStalk(cat, target, 0);
    return true;
  }

  /** Something in reach to go after: the yarn, or a cat (weighted by how much it likes the yarn). */
  private pickTarget(cat: Cat, t: Temper): Target | null {
    const b = cat.body;
    b.computeCentroid();
    const floor = floorAt(b.cy);
    const bottom = bottomOf(b);
    const inReach = (x: number, top: number): boolean => {
      const rise = bottom - top;
      return Math.abs(x - b.cx) < 320 && Math.abs(x - b.cx) > 24 && rise < 200 && rise > -420;
    };
    const options: { t: Target; w: number }[] = [];
    const toy = this.toy;
    if (toy) {
      toy.computeCentroid();
      if (floorAt(toy.cy) === floor && Math.abs(toy.vcx) + Math.abs(toy.vcy) < 40 && inReach(toy.cx, bottomOf(toy)) && !this.nearOff(toy.cx, toy.cy, YARN_R + 8)) options.push({ t: { kind: 'toy' }, w: 0.4 + t.toy * 1.6 });
    }
    for (const o of this.host.session.cats) {
      if (o === cat || !this.free(o)) continue;
      o.body.computeCentroid();
      if (floorAt(o.body.cy) !== floor || !inReach(o.body.cx, topOf(o.body))) continue;
      // (not one by a tube's mouth: a cat sliding off its back would go in)
      if (this.nearOff(o.body.cx, topOf(o.body), o.body.p.radius + b.p.radius)) continue;
      options.push({ t: { kind: 'cat', cat: o }, w: 1.1 - t.toy });
    }
    if (!options.length) return null;
    let pick = Math.random() * options.reduce((a, o) => a + o.w, 0);
    for (const o of options) {
      pick -= o.w;
      if (pick <= 0) return o.t;
    }
    return options[options.length - 1].t;
  }

  // ---------------------------------------------------------------------------
  // Stalk, wiggle, pounce

  /** Go after a target: crouch, creep up if it's far along the same floor, wiggle, pounce (`chain`: a chase, quicker). */
  startStalk(cat: Cat, target: Target, chain: number): void {
    if (!this.free(cat)) return;
    if (target.kind === 'cat' && !this.free(target.cat)) return;
    if (target.kind === 'toy' && !this.toy) return;
    const t = this.temper(cat);
    const b = cat.body;
    b.computeCentroid();
    const quick = chain > 0;
    this.stalks.push({
      cat,
      target,
      phase: 'crouch',
      t: 0,
      dir: this.targetX(target) >= b.cx ? 1 : -1,
      crouchFor: quick ? 0.18 : 0.45,
      creepFor: quick ? 0 : 1.6 + Math.random() * 1.4,
      wiggleFor: (quick ? 0.35 : 0.55) + t.play * (quick ? 0.2 : 0.5) + Math.random() * 0.2,
      chain,
    });
    cat.intent = null;
    cat.sinceTouch = 0;
    b.wake();
  }

  private targetX(target: Target): number {
    if (target.kind === 'toy') {
      this.toy?.computeCentroid();
      return this.toy?.cx ?? 0;
    }
    target.cat.body.computeCentroid();
    return target.cat.body.cx;
  }

  /** Stop stalking (where it is: up out of the crouch). */
  private endStalk(s: Stalk): void {
    const i = this.stalks.indexOf(s);
    if (i >= 0) this.stalks.splice(i, 1);
    s.cat.body.crouch = 0;
  }

  private stepStalk(s: Stalk): void {
    const c = s.cat;
    const b = c.body;
    if (s.phase === 'leap') return;
    // picked up, or the target went off somewhere: never mind
    const gone = s.target.kind === 'cat' ? !this.free(s.target.cat) || floorAt(s.target.cat.body.cy) !== floorAt(b.cy) : !this.toy;
    if (c.grabbed || this.host.away(c) || gone) {
      this.endStalk(s);
      return;
    }
    s.t += FRAME_DT;
    b.computeCentroid();
    const tx = this.targetX(s.target);
    if (Math.abs(tx - b.cx) > 12) s.dir = tx > b.cx ? 1 : -1;
    b.wake();
    if (s.phase === 'crouch') {
      b.crouch = Math.min(1, s.t / s.crouchFor);
      if (s.t >= s.crouchFor) {
        const level = Math.abs(this.targetBottom(s.target) - bottomOf(b)) < 26;
        s.phase = level && Math.abs(tx - b.cx) > 170 && s.creepFor > 0 ? 'creep' : 'wiggle';
        s.t = 0;
        if (s.phase === 'wiggle') this.chitter(c);
      }
    } else if (s.phase === 'creep') {
      // slinking along, low, a paw at a time
      const v = s.dir * (30 + 22 * Math.abs(Math.sin(s.t * 5.2)));
      const d = v * FRAME_DT;
      for (let i = 0; i < b.n; i++) {
        b.x[i] += d;
        b.px[i] += d;
      }
      if (Math.abs(tx - b.cx) < 150 || s.t >= s.creepFor || b.cx < b.p.radius + 4 || b.cx > WORLD_W - b.p.radius - 4) {
        s.phase = 'wiggle';
        s.t = 0;
        this.chitter(c);
      }
    } else if (s.phase === 'wiggle') {
      // (the back end shimmies: see face)
      if (s.t >= s.wiggleFor) this.pounce(s);
    }
  }

  private chitter(cat: Cat): void {
    if (Math.random() < 0.3 + this.temper(cat).play * 0.4) this.host.audio.chitter(BREEDS[cat.breed].voice.pitch);
  }

  /** Is anywhere from x - pad to x + pad, at height y, off limits? */
  private nearOff(x: number, y: number, pad: number): boolean {
    return [x - pad, x, x + pad].some((px) => this.host.offLimits(px, y));
  }

  private targetBottom(target: Target): number {
    return target.kind === 'toy' ? (this.toy ? bottomOf(this.toy) : 0) : bottomOf(target.cat.body);
  }

  /** Go! A quick flat leap onto the yarn, or onto the other cat's back. */
  private pounce(s: Stalk): void {
    const c = s.cat;
    const b = c.body;
    b.crouch = 0;
    const r = b.p.radius;
    let x: number;
    let y: number;
    if (s.target.kind === 'toy') {
      const toy = this.toy!;
      toy.computeCentroid();
      x = toy.cx - s.dir * r * 0.55;
      y = bottomOf(toy);
    } else {
      const o = s.target.cat.body;
      o.computeCentroid();
      x = o.cx - s.dir * o.p.radius * 0.2;
      y = topOf(o) + 2;
    }
    x = Math.max(r + 4, Math.min(WORLD_W - r - 4, x));
    if (this.nearOff(x, y - r, s.target.kind === 'cat' ? r : 0)) {
      // (it's gone somewhere it can't follow)
      this.endStalk(s);
      return;
    }
    s.phase = 'leap';
    s.t = 0;
    this.host.leap(c, x, y, true, () => this.landed(s));
  }

  private landed(s: Stalk): void {
    const i = this.stalks.indexOf(s);
    if (i >= 0) this.stalks.splice(i, 1);
    const c = s.cat;
    if (s.target.kind === 'toy') {
      this.bat(s.dir, c);
      // a playful cat goes after it again
      if (s.chain < 3 && Math.random() < this.temper(c).play * 0.6) this.later(0.45 + Math.random() * 0.4, () => this.startStalk(c, { kind: 'toy' }, s.chain + 1));
      return;
    }
    this.react(c, s.target.cat, s.dir, s.chain);
  }

  /** The yarn's batted away (out from under the cat that got it). */
  private bat(dir: number, by: Cat | null): void {
    const toy = this.toy;
    if (!toy) return;
    toy.computeCentroid();
    if (by) dir = this.clearOf(by, dir);
    toy.kick(dir * (150 + Math.random() * 110), -(150 + Math.random() * 140));
    this.toySpin = dir * (12 + Math.random() * 8);
    this.host.audio.impact('rubber', 420, 0.15);
  }

  /**
   * Move the yarn out from under a cat, to its `dir` side if there's room
   * (or the other, or on top): it's small enough to end up inside one, which
   * the physics can't undo. Returns the side it went.
   */
  private clearOf(cat: Cat, dir: number): number {
    const toy = this.toy!;
    const b = cat.body;
    b.computeCentroid();
    toy.computeCentroid();
    const reach = b.p.radius + YARN_R + 3;
    if (Math.hypot(toy.cx - b.cx, toy.cy - b.cy) > reach) return dir;
    for (const d of [dir, -dir]) {
      const x = b.cx + d * reach;
      if (x > YARN_R + 2 && x < WORLD_W - YARN_R - 2) {
        toy.placeAt(x, Math.min(toy.cy, b.cy));
        return d;
      }
    }
    toy.placeAt(b.cx, topOf(b) - YARN_R - 3);
    return dir;
  }

  /** A cat just landed (or popped out of something): if it came down on the yarn, the yarn shoots out from under it. */
  clearToy(cat: Cat): void {
    const toy = this.toy;
    if (!toy) return;
    const b = cat.body;
    b.computeCentroid();
    toy.computeCentroid();
    if (Math.hypot(toy.cx - b.cx, toy.cy - b.cy) > b.p.radius + YARN_R + 3) return;
    this.bat(toy.cx >= b.cx ? 1 : -1, cat);
  }

  /** A tap on the yarn bats it (true if the tap was on it). */
  tapToy(x: number, y: number): boolean {
    const toy = this.toy;
    if (!toy || !this.onToy(x, y)) return false;
    this.bat(x < toy.cx ? 1 : -1, null);
    return true;
  }

  /** Is (x, y) on the yarn (or near enough to count as a tap on it)? */
  onToy(x: number, y: number): boolean {
    const toy = this.toy;
    if (!toy) return false;
    toy.computeCentroid();
    return Math.hypot(x - toy.cx, y - toy.cy) <= YARN_R + 16;
  }

  // ---------------------------------------------------------------------------
  // Pounced on: play along, can't be bothered, hiss, or scrap

  private react(pouncer: Cat, target: Cat, dir: 1 | -1, chain: number): void {
    if (!this.free(target) || pouncer.grabbed) return;
    const tp = this.temper(pouncer);
    const tt = this.temper(target);
    const cross = this.sulking(target) || this.sulking(pouncer);
    const roll = Math.random();
    const scrap = this.frame - this.lastScrap > SCRAP_GAP && !this.host.hurt(pouncer.breed) ? scrapChance(tp, tt, cross) : 0;
    if (roll < scrap) {
      this.startFight(pouncer, target);
      return;
    }
    const pitch = BREEDS[target.breed].voice.pitch;
    if (Math.random() < tt.touchy) {
      // a hiss: the pouncer thinks better of it
      this.show(target, 'cross', 1.4, -dir);
      this.host.audio.hiss(pitch);
      target.body.kick(0, -110);
      this.show(pouncer, 'wide', 0.9, dir);
      this.sulk(target, 35);
      this.sulk(pouncer, 20);
      this.later(0.35, () => this.runOff(pouncer, target));
      return;
    }
    if (Math.random() < tt.play || chain > 0) {
      // game on: off it goes, and the chase is on (or it pounces right back)
      this.show(target, 'happy', 0.8, -dir);
      this.host.audio.boop(pitch);
      if (chain < 2 && Math.random() < 0.5) {
        this.later(0.5, () => this.startStalk(target, { kind: 'cat', cat: pouncer }, chain + 1));
      } else {
        this.later(0.3, () => this.runOff(target, pouncer));
        if (chain < 2) this.later(1.3, () => this.startStalk(pouncer, { kind: 'cat', cat: target }, chain + 1));
      }
      return;
    }
    // can't be bothered
    this.show(target, 'squint', 1.6, -dir);
    this.show(pouncer, 'content', 1);
    this.later(0.9, () => this.runOff(pouncer, target));
  }

  /** Leap off somewhere away from the other cat. */
  private runOff(cat: Cat, from: Cat): void {
    if (!this.free(cat)) return;
    from.body.computeCentroid();
    const to = this.host.escape(cat, from.body.cx);
    if (to) this.host.leap(cat, to.x, to.y, false);
    else {
      cat.body.computeCentroid();
      cat.body.kick(this.safeFling(cat.body.cx, cat.body.cy, (cat.body.cx < from.body.cx ? -1 : 1) * 160, -230), -230);
    }
  }

  /**
   * A sideways speed for a cat flung up from (x, y) that won't land it in an
   * open tube's mouth (or out through a wall): softer if that's clear, else
   * straight up.
   */
  private safeFling(x: number, y: number, vx: number, vy: number): number {
    // where it comes down: level with where it was, or (flung off the end of
    // a ledge) all the way down on the floor, further on
    const t = (2 * Math.abs(vy)) / GRAVITY;
    const floorY = FLOORS[floorAt(y)].floorY;
    const tf = (Math.abs(vy) + Math.sqrt(vy * vy + 2 * GRAVITY * Math.max(0, floorY - y))) / GRAVITY;
    const ok = (v: number): boolean => {
      const lx = x + v * t;
      const fx = Math.max(30, Math.min(WORLD_W - 30, x + v * tf));
      return lx > 8 && lx < WORLD_W - 8 && ![lx, (x + lx) / 2].some((px) => this.host.offLimits(px, y)) && ![floorY - 10, floorY - 100].some((py) => this.host.offLimits(fx, py));
    };
    // (never turned round: that's back into whoever it's getting away from)
    return ok(vx) ? vx : ok(vx * 0.5) ? vx * 0.5 : 0;
  }

  // ---------------------------------------------------------------------------
  // A scrap

  /** A scrap between two cats (one pounced on the other, and it didn't go well). */
  startFight(a: Cat, b: Cat): void {
    const w = this.host.session.world;
    for (const c of [a, b]) {
      for (const s of this.stalks.filter((k) => k.cat === c)) this.endStalk(s);
      c.body.computeCentroid();
      c.body.crouch = 0;
      w.removeBody(c.body);
      c.intent = null;
    }
    const shape = (c: Cat): Float64Array => {
      const bd = c.body;
      const out = new Float64Array(bd.n * 2);
      for (let i = 0; i < bd.n; i++) {
        out[i * 2] = bd.x[i] - bd.cx;
        out[i * 2 + 1] = bd.y[i] - bd.cy;
      }
      return out;
    };
    const r = (a.body.p.radius + b.body.p.radius) * 0.82 + 8;
    const ground = Math.max(bottomOf(b.body), bottomOf(a.body) - 4);
    const x = Math.max(r * 0.85, Math.min(WORLD_W - r * 0.85, (a.body.cx + b.body.cx) / 2));
    const T = 2.4 + Math.random() * 0.8;
    this.fights.push({ a, b, x, y: ground - r * 0.72, ground, r, t: 0, T, seed: Math.floor(Math.random() * 1e6), shapes: [shape(a), shape(b)], side: a.body.cx <= b.body.cx ? -1 : 1 });
    this.lastScrap = this.frame;
    this.host.audio.hiss(BREEDS[b.breed].voice.pitch);
    this.host.audio.scuffle(T, BREEDS[a.breed].voice.pitch, BREEDS[b.breed].voice.pitch);
    this.host.renderer.puff(x, ground - 6, 10);
  }

  private stepFight(f: Fight): void {
    f.t += FRAME_DT;
    const cx = f.x + Math.sin(f.t * 3.1) * 7 + Math.sin(f.t * 8.3) * 2.5;
    const cy = f.y - Math.abs(Math.sin(f.t * 7.4)) * 5;
    // the two of them tumbling round and round inside it
    ([f.a, f.b] as const).forEach((c, k) => {
      const b = c.body;
      const th = f.t * 8.5 + k * Math.PI;
      const px = cx + Math.cos(th) * f.r * 0.2;
      const py = cy + Math.sin(th) * f.r * 0.16 + f.r * 0.08;
      const spin = (k ? -1 : 1) * f.t * 9.5;
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      const sh = f.shapes[k];
      for (let i = 0; i < b.n; i++) {
        const ox = sh[i * 2] * 0.92;
        const oy = sh[i * 2 + 1] * 0.92;
        b.x[i] = b.px[i] = px + ox * cs - oy * sn;
        b.y[i] = b.py[i] = py + ox * sn + oy * cs;
      }
      b.computeCentroid();
    });
    // fluff flying out, claws flashing, little stars
    if (Math.random() < 0.32) {
      const c = Math.random() < 0.5 ? f.a : f.b;
      const ang = -Math.PI * (0.1 + Math.random() * 0.8) + (Math.random() < 0.25 ? Math.PI : 0);
      this.puffOfFluff(c, cx + Math.cos(ang) * f.r * 0.85, cy + Math.sin(ang) * f.r * 0.7, Math.cos(ang), Math.sin(ang), f.ground);
    }
    if (this.frame % 9 === 0) this.flashes.push({ x: cx + (Math.random() - 0.5) * f.r * 1.2, y: cy + (Math.random() - 0.5) * f.r, ang: (Math.random() - 0.5) * 1.6, age: 0, life: 0.2, kind: 'scratch' });
    if (this.frame % 19 === 0) {
      const ang = Math.random() * Math.PI * 2;
      this.flashes.push({ x: cx + Math.cos(ang) * f.r * 0.95, y: cy + Math.sin(ang) * f.r * 0.8, ang: Math.random(), age: 0, life: 0.3, kind: 'star' });
    }
    if (f.t >= f.T) this.endFight(f, true);
  }

  private puffOfFluff(c: Cat, x: number, y: number, dx: number, dy: number, ground: number): void {
    const look = BREEDS[c.breed].look;
    const sp = 60 + Math.random() * 110;
    this.fluff.push({
      x,
      y,
      vx: dx * sp + (Math.random() - 0.5) * 40,
      vy: dy * sp - 40 - Math.random() * 50,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 6,
      size: 2.6 + Math.random() * 2.4,
      age: 0,
      life: 5 + Math.random() * 3,
      color: Math.random() < 0.7 ? look.body : look.accent,
      light: look.light,
      ground,
      seed: Math.random() * 100,
    });
    if (this.fluff.length > 140) this.fluff.shift();
  }

  /**
   * The cloud clears and out they pop, one each side, a little dazed and very
   * cross. Unless it was broken up, one of them (the smaller, more likely)
   * may well be hurt.
   */
  private endFight(f: Fight, hurt: boolean): void {
    const i = this.fights.indexOf(f);
    if (i >= 0) this.fights.splice(i, 1);
    const w = this.host.session.world;
    // where each pops out: either side of the cloud (not into a tube's mouth),
    // and clear of the walls and of each other by their real shapes (a cat
    // squashed wide, or stretched from a leap, is wider than it is round):
    // overlapping, they'd be shoved apart hard
    const ext = f.shapes.map((sh) => {
      let x0 = 0;
      let x1 = 0;
      let y1 = 0;
      for (let n = 0; n < sh.length; n += 2) {
        x0 = Math.min(x0, sh[n]);
        x1 = Math.max(x1, sh[n]);
        y1 = Math.max(y1, sh[n + 1]);
      }
      return { x0, x1, y1 };
    });
    const sides = [f.side, -f.side];
    const off = [false, false];
    const xs = [f.a, f.b].map((c, k) => {
      const x = f.x + sides[k] * (f.r * 0.5 + c.body.p.radius * 0.6);
      off[k] = this.host.offLimits(x, f.ground - ext[k].y1);
      return off[k] ? f.x : x;
    });
    const L = f.side < 0 ? 0 : 1;
    const R = 1 - L;
    const overlap = xs[L] + ext[L].x1 + 6 - (xs[R] + ext[R].x0);
    if (overlap > 0) {
      const share = off[L] ? 0 : off[R] ? 1 : 0.5;
      xs[L] -= overlap * share;
      xs[R] += overlap * (1 - share);
    }
    if (xs[L] + ext[L].x0 < 6) {
      xs[R] += 6 - (xs[L] + ext[L].x0);
      xs[L] = 6 - ext[L].x0;
    }
    if (xs[R] + ext[R].x1 > WORLD_W - 6) {
      xs[L] -= xs[R] + ext[R].x1 - (WORLD_W - 6);
      xs[R] = WORLD_W - 6 - ext[R].x1;
    }
    ([f.a, f.b] as const).forEach((c, k) => {
      const b = c.body;
      const side = sides[k];
      const x = xs[k];
      const y = f.ground - ext[k].y1 - 3;
      const sh = f.shapes[k];
      const vy = -(190 + Math.random() * 90);
      const vx = this.safeFling(x, y, side * (130 + Math.random() * 90), vy);
      for (let n = 0; n < b.n; n++) {
        b.x[n] = b.px[n] = x + sh[n * 2];
        b.y[n] = b.py[n] = y + sh[n * 2 + 1];
        b.vx[n] = vx;
        b.vy[n] = vy;
      }
      b.wake();
      b.computeCentroid();
      if (!w.bodies.includes(b)) w.addBody(b);
      c.settled = 0;
      c.sinceTouch = 0;
      this.show(c, 'cross', 2.4, -side);
      this.sulk(c, 75);
      this.clearToy(c);
    });
    this.host.renderer.puff(f.x, f.ground - 10, 16);
    for (let k = 0; k < 10; k++) {
      const c = k % 2 ? f.a : f.b;
      const ang = -Math.PI * Math.random();
      this.puffOfFluff(c, f.x + Math.cos(ang) * f.r * 0.6, f.y + Math.sin(ang) * f.r * 0.5, Math.cos(ang) * 0.6, Math.sin(ang) * 0.6, f.ground);
    }
    if (!hurt || Math.random() > 0.85) return;
    const ra = f.a.body.p.radius;
    const rb = f.b.body.p.radius;
    // (the bigger cat usually comes off better)
    const loser = Math.random() < rb / (ra + rb) ? f.a : f.b;
    this.host.hurtCat(loser);
  }

  /** A tap on a scrap breaks it up (nobody hurt). True if there was one there. */
  breakUp(x: number, y: number): boolean {
    const f = this.fights.find((k) => Math.hypot(x - k.x, y - k.y) < k.r * 1.15);
    if (!f) return false;
    this.endFight(f, false);
    this.host.audio.boop(1.2);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Every step

  step(): void {
    this.frame++;
    for (const p of [...this.pending]) {
      if (this.frame < p.at) continue;
      this.pending.splice(this.pending.indexOf(p), 1);
      p.fn();
    }
    for (const s of [...this.stalks]) this.stepStalk(s);
    for (const f of [...this.fights]) this.stepFight(f);
    const dt = FRAME_DT;
    for (const p of [...this.fluff]) {
      p.age += dt;
      if (p.y < p.ground - 1) {
        // fluff floats: a little gravity, a lot of air, and a flutter
        p.vy += 140 * dt;
        p.vx *= Math.exp(-1.6 * dt);
        p.vy *= Math.exp(-1.9 * dt);
        p.x += (p.vx + Math.sin(p.age * 4 + p.seed) * 14) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.x = Math.max(2, Math.min(WORLD_W - 2, p.x));
      } else {
        p.y = p.ground - 1;
        p.vx = 0;
        p.vy = 0;
      }
      if (p.age > p.life) this.fluff.splice(this.fluff.indexOf(p), 1);
    }
    for (const fl of [...this.flashes]) {
      fl.age += dt;
      if (fl.age > fl.life) this.flashes.splice(this.flashes.indexOf(fl), 1);
    }
    // the yarn's spin follows its roll, and it rolls to a stop (yarn drags);
    // come to rest where nobody may go after it (down a tube's mouth, over
    // the funnel), after a moment it bounces back out
    const toy = this.toy;
    if (toy) {
      toy.computeCentroid();
      const still = toy.asleep || Math.abs(toy.vcx) + Math.abs(toy.vcy) < 30;
      this.toyStuck = still && this.host.offLimits(toy.cx, toy.cy) ? this.toyStuck + 1 : 0;
      if (this.toyStuck > 90) {
        this.toyStuck = 0;
        toy.kick(toy.cx < WORLD_W / 2 ? 170 : -170, -440);
        this.toySpin = 10;
      }
    }
    if (toy && !toy.asleep) {
      this.toySpin *= Math.exp(-2 * dt);
      const grounded = toy.airborneFrames < 2;
      const roll = grounded ? toy.vcx / YARN_R : this.toySpin;
      this.toyAngle += roll * dt;
      if (grounded) {
        let vx = 0;
        for (let i = 0; i < toy.n; i++) vx += toy.vx[i];
        const dv = (vx / toy.n) * (1 - Math.exp(-2.2 * dt));
        for (let i = 0; i < toy.n; i++) toy.vx[i] -= dv;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Painting (live, each frame)

  /** Under the cats: the yarn. */
  underlay(ctx: Ctx): void {
    const toy = this.toy;
    if (!toy) return;
    toy.computeCentroid();
    paintYarn(ctx, toy.cx, toy.cy, YARN_R, this.toyAngle, toy.airborneFrames < 3);
  }

  /** Over the cats: the scraps, and the fluff and flashes coming off them. */
  overlay(ctx: Ctx): void {
    for (const p of this.fluff) paintFluff(ctx, p);
    for (const f of this.fights) {
      const cx = f.x + Math.sin(f.t * 3.1) * 7 + Math.sin(f.t * 8.3) * 2.5;
      const cy = f.y - Math.abs(Math.sin(f.t * 7.4)) * 5;
      paintDustCloud(ctx, cx, cy, f.r, f.t, f.seed, [BREEDS[f.a.breed].look, BREEDS[f.b.breed].look], Math.min(1, f.t * 6, (f.T - f.t) * 5 + 0.4));
    }
    for (const fl of this.flashes) paintFlash(ctx, fl);
  }
}

function bottomOf(b: SoftBody): number {
  let y = -Infinity;
  for (let i = 0; i < b.n; i++) if (b.y[i] > y) y = b.y[i];
  return y;
}

function topOf(b: SoftBody): number {
  let y = Infinity;
  for (let i = 0; i < b.n; i++) if (b.y[i] < y) y = b.y[i];
  return y;
}
