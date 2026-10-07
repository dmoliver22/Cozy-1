// The Playground (see layout.ts): a corner of the sky of your own. The cats
// you bring start on the respawn cloud. You build with perches and tubes (as
// many as you like, free: pieces join end to end into longer platforms),
// look about with a finger and zoom with two, and tap a cat's face up top
// for the view to follow it wherever it goes. The cats stay where they're
// put (they're yours to play with: carry one anywhere, fling it, drop it on
// a bouncy cushion, or into a tube's mouth: in at either end, shot out of
// the other). One that falls off everything drops into the sea of cloud and
// comes back on the respawn cloud; Respawn brings everyone back there. It's
// built like the house (house/home.ts): the same soft cats in a Session, and
// the house's perches and tubes.

import type { AudioEngine } from '../audio/audio';
import type { RoomDef } from '../game/room';
import type { Cat, Session, SessionOptions } from '../game/session';
import { roomFor } from '../game/spawn';
import { BREEDS, type BreedId } from '../physics/breeds';
import type { Expression } from '../render/catArt';
import { roundRect, type Ctx } from '../render/paint';
import type { Renderer, Stage } from '../render/renderer';
import { faceSVG } from '../ui/faces';
import { clamp } from '../util/math';
import { NAMES } from '../house/house';
import { paintPipeJoint, paintPipeRun, paintSkyBell } from '../house/houseArt';
import { hasFront, isLive, paintLiveBack, paintLiveFront, paintPerchBack, paintPerchFront, perchThumb } from '../house/perchArt';
import { PERCHES, PERCH_ORDER, perchBox, type Box, type PerchKind } from '../house/perches';
import {
  FALL,
  PLAY_KEY,
  SPAWN,
  TUBE,
  TUBE_LEN,
  TUBE_PROP_BASE,
  ZOOM,
  bendTube,
  buildPiece,
  distToTube,
  drawPipe,
  footOf,
  gadgetOf,
  extendTube,
  lowest,
  movePipe,
  moveTube,
  nearestOnTube,
  nearestRun,
  pipeJoints,
  pipeOf,
  slidePipeRun,
  straighten,
  pieceBox,
  readPlay,
  skyTube,
  snapPiece,
  spawnSpots,
  standing,
  surfacesOf,
  tubeBox,
  tubeEnds,
  tubeLength,
  tubeMiddle,
  tubeRun,
  tubeShapes,
  type PieceKind,
  type PieceProp,
  type PlayPiece,
  type PlaySave,
  type PlayTube,
} from './layout';
import { floatPuff, paintSky, paintSpawn } from './skyArt';
import { BELT, CANNON, FAN, GADGETS, GADGET_ORDER, aimDir, cannonMouth, fitAim, isGadget, type Gadget, type Rump } from './gadgets';
import { gadgetThumb, paintGadget } from './gadgetArt';
import { SkySim } from './sim';
import { TOUR_CAT, TOUR_START, Tour, course, hammockDrop, markTourSeen, nearCannon, settleCourse } from './tutorial';

export interface PlayHost {
  readonly renderer: Renderer;
  readonly audio: AudioEngine;
  readonly session: Session;
  openOverlay(html: string, onBind?: (root: HTMLElement) => void): void;
  closeOverlay(): void;
  overlayOpen(): boolean;
  /** Where the finger carrying a cat is on screen (null if no cat is being carried). */
  carryFinger(): { x: number; y: number } | null;
  /** Back home. */
  home(): void;
}

/** Long-press on a piece or a tube to pick it up (ms), and how far a finger may wander before it's a look about (px). */
const HOLD_MS = 420;
const SLOP = 9;
/** How near the screen's edge a carried cat (or a piece being placed) takes the view along (px). */
const EDGE = 70;

/**
 * Something being put somewhere, or changed: a piece, or a tube (new; or one
 * that's built, `prev` as it was). One that's built stays where it is, in the
 * sky with cats on it, till it's changed: then it's `lifted` out to be put
 * back changed (something new is out of the sky from the start).
 */
type Placing = ({ k: 'piece'; piece: PlayPiece; prev: PlayPiece | null } | { k: 'tube'; tube: PlayTube; prev: PlayTube | null }) & { lifted: boolean };

type Pt = [number, number];

/** Something built: a piece or a tube. */
type Built = PlayPiece | PlayTube;

/** A tube as it's painted: its pipe between the bells, how far along each point is, its mouths, its joints. */
type Geom = { run: Pt[]; along: number[]; ends: ReturnType<typeof tubeEnds>; joints: { x: number; y: number; ux: number; uy: number }[] };

type Drag =
  | { k: 'pan'; id: number; sx: number; sy: number; cx: number; cy: number; moved: boolean; lastX: number; lastY: number; lastT: number; vx: number; vy: number }
  /** A finger down on something built: a tap picks it to change, held still it comes up on the finger. */
  | { k: 'hold'; id: number; sx: number; sy: number; timer: number; hit: Built }
  /** Dragging a piece that's being placed. */
  | { k: 'ghost'; id: number; dx: number; dy: number; sx: number; sy: number }
  /** Turning a toy (by the arrow on its aim handle). */
  | { k: 'aim'; id: number; sx: number; sy: number }
  /**
   * Working on a tube that's being placed: drawing it on from an end (the
   * finger `dx, dy` off the end), moving the whole of it by its knob, bending
   * it, pulled by the point `at` along it, or (a pipe) sliding its straight
   * run `run` sideways (each as it was, `from`, when the finger came down at
   * x0, y0).
   */
  | ({ k: 'tube'; id: number; sx: number; sy: number } & (
      | { how: 'end'; end: 'a' | 'b'; dx: number; dy: number }
      | { how: 'move'; from: PlayTube; x0: number; y0: number }
      | { how: 'bend'; at: number; from: Pt[]; x0: number; y0: number }
      | { how: 'slide'; run: number; from: Pt[]; x0: number; y0: number }
    ));

/** A piece's name. */
const nameOf = (k: PieceKind): string => (isGadget(k) ? GADGETS[k].name : PERCHES[k].name);
/** Does a piece have a part painted over the cats (a perch's front, a cannon's barrel)? */
const fronted = (k: PieceKind): boolean => (isGadget(k) ? k === 'cannon' : hasFront(k));

/** What each piece is, up here (there are no walls or floors in the sky). */
const SKY_BLURBS: Record<PerchKind, string> = {
  shelf: 'A plank on brass brackets: a few end to end make a long walk',
  beanbag: 'A squashy spot to flop on',
  cushion: 'A long ledge with a plump cushion',
  bounce: 'Plump and springy: drop a cat on it, boing!',
  bed: 'A round plush bed to curl up in for a nap',
  hammock: 'A cosy sling between two pegs: it sags and sways',
  pod: 'A round wicker basket to curl up in',
  cloud: 'A little cloud to sit on',
  tree: 'A tall scratching post with two decks',
};

export class Playground {
  save: PlaySave;
  /** Who's come along this time. */
  who: BreedId[] = [];
  private active = false;
  /** What goes on up here each step: the pieces, tubes and toys at work (sim.ts). */
  readonly sim: SkySim;
  /** The view: where its middle is, and how far it's zoomed in. */
  private cam = { x: SPAWN.x, y: SPAWN.y - 120, zoom: 1 };
  private camV = { x: 0, y: 0 };
  /** The cat the view follows (tap its face). */
  follow: Cat | null = null;
  /** Where it was last frame (a cat in a tube: how far it's gone since). */
  private followAt: { cat: Cat; x: number; y: number } | null = null;
  /** Fingers down on the sky (two: a pinch), and the pinch: how far apart they started, and what was under them. */
  private fingers = new Map<number, { sx: number; sy: number }>();
  private pinch: { d0: number; z0: number; wx: number; wy: number } | null = null;
  private drag: Drag | null = null;
  placing: Placing | null = null;
  private time = 0;
  /** Painted pieces, kept (a piece's kind and look, how sharp: pixels per unit). */
  private sprites = new Map<string, { c: HTMLCanvasElement; ppu: number; x0: number; y0: number; w: number; h: number }>();
  /** Each tube's pipe and mouths, worked out once. */
  private geoms = new WeakMap<PlayTube, Geom>();
  private readonly bar: HTMLElement;
  private readonly placeBar: HTMLElement;
  /** What was taken away last, for a moment (Undo puts it back). */
  private readonly undoBar: HTMLElement;
  private undo: { item: Built; timer: number } | null = null;
  private lastHud = '';
  /** The first-time tour (tutorial.ts), while it's on: the course is up instead of your own sky, which waits here. */
  tour: Tour | null = null;
  private ownSave: PlaySave | null = null;
  private readonly tourCard: HTMLElement;
  private tourShown = '';
  /** Time to go home (the tour's over): done from tick, not mid-step. */
  private tourOver = false;

  constructor(private readonly host: PlayHost) {
    this.save = readPlay(safeGet(PLAY_KEY));
    this.sim = new SkySim(() => host.session);
    // along the bottom: home, build, respawn
    this.bar = document.createElement('footer');
    this.bar.id = 'playBar';
    this.bar.className = 'tray play-bar hidden';
    this.bar.innerHTML = `
      <button class="tin tin-cream" data-pg="home" aria-label="Back home"><span class="tin-lid"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-home" /></svg></span><span class="tin-label">Home</span></button>
      <button class="tin tin-mint" data-pg="build" aria-label="Build"><span class="tin-lid"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-build" /></svg></span><span class="tin-label">Build</span></button>
      <button class="tin tin-blue" data-pg="respawn" aria-label="Respawn"><span class="tin-lid"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-star" /></svg></span><span class="tin-label">Respawn</span></button>`;
    this.bar.querySelector('[data-pg=home]')!.addEventListener('click', () => {
      host.audio.click();
      host.home();
    });
    this.bar.querySelector('[data-pg=build]')!.addEventListener('click', () => this.showBuild());
    this.bar.querySelector('[data-pg=respawn]')!.addEventListener('click', () => this.respawnAll());
    document.getElementById('app')!.appendChild(this.bar);
    // the bar shown while putting something somewhere
    this.placeBar = document.createElement('div');
    this.placeBar.className = 'play-place hidden';
    this.placeBar.innerHTML = `<div class="pg-style" role="group" aria-label="What kind of tube" hidden><button data-style="twisty" aria-pressed="true">Twisty</button><button data-style="pipe" aria-pressed="false">Pipe</button></div><p class="place-hint"></p><div class="place-btns"><button class="btn" data-place="redraw" hidden>Redraw</button><button class="btn" data-place="away">Remove</button><button class="btn primary" data-place="ok">Put it here</button></div>`;
    this.placeBar.querySelector('[data-place=away]')!.addEventListener('click', () => this.endPlacing(false));
    this.placeBar.querySelector('[data-place=redraw]')!.addEventListener('click', () => this.redraw());
    this.placeBar.querySelector('[data-place=ok]')!.addEventListener('click', () => this.endPlacing(true));
    this.placeBar.querySelectorAll<HTMLElement>('[data-style]').forEach((el) => el.addEventListener('click', () => this.setStyle(el.dataset.style === 'pipe')));
    document.getElementById('app')!.appendChild(this.placeBar);
    // a moment after something's taken away: Undo
    this.undoBar = document.createElement('div');
    this.undoBar.className = 'pg-undo hidden';
    this.undoBar.innerHTML = `<span>Taken away</span><button class="btn" data-undo>Undo</button>`;
    this.undoBar.querySelector('[data-undo]')!.addEventListener('click', () => this.undoRemove());
    document.getElementById('app')!.appendChild(this.undoBar);
    // the tour's card, where the bar goes: what to do, and a way out
    this.tourCard = document.createElement('div');
    this.tourCard.className = 'pg-tour hidden';
    this.tourCard.setAttribute('role', 'status');
    this.tourCard.setAttribute('aria-live', 'polite');
    this.tourCard.innerHTML = `<p class="pg-tour-line"></p><p class="pg-tour-sub"></p><button class="pg-tour-skip" data-tour="skip">Skip</button>`;
    this.tourCard.querySelector('[data-tour=skip]')!.addEventListener('click', () => this.skipTour());
    document.getElementById('app')!.appendChild(this.tourCard);
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Something's being drawn or moved (a finger on a cat then is for it, not the cat); something only picked to change, the cats can still be picked up. */
  get busy(): boolean {
    return !!this.placing?.lifted;
  }

  // ---------------------------------------------------------------------------
  // The sky as a room

  /** The cats who've come, on the respawn cloud. */
  room(): RoomDef {
    const xs = this.tour ? [TOUR_START.x] : spawnSpots(this.who.length);
    const cats = this.who.map((b, i) => ({ breed: b, x: xs[i], y: SPAWN.y, name: NAMES[b] }));
    return { id: 'playground', name: 'Playground', theme: 'living', furniture: [], containers: [], decor: [], cats };
  }

  get sessionOptions(): SessionOptions {
    return {
      shell: () => this.sim.build(this.save),
      // (a cat stuck fast goes to the nearest clear place: up here, anywhere)
      spawnOk: () => true,
      unmerge: true,
    };
  }

  /** Called once the playground's session is up (`arriving`: a cat that's come up the sky tube from the roof garden, dropping in from above). */
  enter(arriving: BreedId | null = null): void {
    this.active = true;
    this.time = 0;
    this.sim.start();
    this.tourOver = false;
    this.follow = null;
    this.camV = { x: 0, y: 0 };
    this.cam = { x: SPAWN.x, y: SPAWN.y - 110, zoom: 1 };
    this.syncCam();
    this.host.renderer.stage = this.stage;
    this.host.renderer.invalidate();
    this.bar.classList.remove('hidden');
    this.lastHud = '';
    const cat = arriving ? this.host.session.cats.find((c) => c.breed === arriving) : null;
    if (cat) {
      // out of the clouds overhead, down onto the respawn cloud (the view goes with it)
      cat.body.placeAt(SPAWN.x, SPAWN.y - 520);
      cat.body.kick(0, 260);
      this.follow = cat;
      this.cam.y = SPAWN.y - 520;
      this.syncCam();
      this.host.renderer.puff(SPAWN.x, SPAWN.y - 560, 8);
    }
    if (this.tour) {
      // (the hammock hung still before anyone's there: the ride's the same whenever it starts)
      settleCourse(this.sim);
      this.bar.classList.add('hidden');
      this.cam = { x: TOUR_FRAME.x, y: TOUR_FRAME.y, zoom: TOUR_FRAME.zoom };
      this.syncCam();
      this.tourShown = '';
      this.refreshTour();
    }
  }

  leave(): void {
    if (this.active) {
      if (this.placing) this.endPlacing(false, true);
      this.tubes.finishAll();
      this.works.releaseAll();
      this.write();
    }
    this.active = false;
    this.drag = null;
    this.pinch = null;
    this.fingers.clear();
    this.bar.classList.add('hidden');
    this.placeBar.classList.add('hidden');
    this.forgetUndo();
    this.host.renderer.stage = null;
    if (this.tour) {
      // (your own sky back, as it was)
      this.tour = null;
      this.save = this.ownSave ?? this.save;
      this.ownSave = null;
      this.tourCard.classList.add('hidden');
    }
  }

  // ---------------------------------------------------------------------------
  // The first-time tour (tutorial.ts)

  /** The tour's next: the course goes up in place of your own sky (put back as it was when you leave). */
  startTour(): void {
    if (!this.tour) this.ownSave = this.save;
    this.tour = new Tour();
    this.save = course();
    this.who = [TOUR_CAT];
  }

  /** No more tour: home. */
  skipTour(): void {
    if (!this.tour) return;
    this.host.audio.click();
    markTourSeen();
    this.host.closeOverlay();
    this.host.home();
  }

  /** A cat booped: the tour's first step done. */
  booped(cat: Cat): void {
    const t = this.tour;
    if (!t || t.stage !== 'boop') return;
    t.booped();
    cat.body.computeCentroid();
    this.host.renderer.hearts(cat.body.cx, cat.body.cy - cat.body.p.radius - 6, 2);
    this.refreshTour();
  }

  /** In it went: off it goes, the view along with it. */
  private tourRide(cat: Cat): void {
    const t = this.tour;
    if (!t || t.handsOff) return;
    t.loaded();
    this.follow = cat;
    this.camV = { x: 0, y: 0 };
    this.refreshTour();
  }

  /** The tour's card says where it's got to. */
  private refreshTour(): void {
    const t = this.tour;
    if (!t) return;
    const key = `${t.line}|${t.sub}`;
    if (key === this.tourShown) return;
    this.tourShown = key;
    this.tourCard.classList.remove('hidden');
    this.tourCard.dataset.stage = t.stage;
    this.tourCard.querySelector('.pg-tour-line')!.textContent = t.line;
    this.tourCard.querySelector('.pg-tour-sub')!.textContent = t.sub;
    // (no skipping once it's all but over)
    this.tourCard.querySelector<HTMLElement>('[data-tour=skip]')!.hidden = t.stage === 'snug' || t.stage === 'home';
  }

  /** The tour, each step: how it's going, and what it's said to do. */
  private stepTour(): void {
    const t = this.tour;
    const cat = this.host.session.cats[0];
    if (!t || !cat) return;
    const b = cat.body;
    if (!t.handsOff && !cat.grabbed && cat.settled > 90) {
      // (put down somewhere off the cloud: back on it, by the cannon)
      b.computeCentroid();
      if (Math.abs(b.cx - SPAWN.x) > SPAWN.half || b.cy > SPAWN.y + 5) this.respawn(cat);
    }
    switch (t.step(this.sim, cat)) {
      case 'snug':
        b.computeCentroid();
        this.host.renderer.hearts(b.cx, b.cy - b.p.radius - 6, 4);
        this.host.audio.reveal();
        break;
      case 'rescue':
        this.tourRescue(cat);
        break;
      case 'home':
        markTourSeen();
        break;
      case 'leave':
        this.tourOver = true;
        break;
    }
    this.refreshTour();
  }

  /** Gone astray (it never has, but if it ever did): a puff, and it's in the hammock. */
  private tourRescue(cat: Cat): void {
    const h = hammockDrop(this.sim);
    if (!h) return;
    const b = cat.body;
    b.computeCentroid();
    this.host.renderer.puff(b.cx, b.cy, 7);
    b.reset(h.x, h.y);
    this.host.renderer.puff(h.x, h.y, 7);
    this.host.audio.boop(BREEDS[cat.breed].voice.pitch);
  }

  private write(): void {
    // (the tour's course is never kept)
    if (this.tour) return;
    try {
      localStorage.setItem(PLAY_KEY, JSON.stringify(this.save));
    } catch {
      // (private browsing: it's only for now)
    }
  }

  // ---------------------------------------------------------------------------
  // Who comes along

  /** Who comes along to the playground: your cats as faces to pick (your own cat first), and then up you go. */
  askWho(residents: readonly BreedId[], go: (who: BreedId[]) => void): void {
    const all = [...residents].sort((a, b) => (a === 'mine' ? -1 : b === 'mine' ? 1 : 0));
    const last = this.save.cats.filter((b) => all.includes(b));
    const picked = new Set<BreedId>(last.length ? last : all.includes('mine') ? ['mine'] : all.slice(0, 2));
    const chips = all
      .map((b) => `<button class="pg-pick${picked.has(b) ? ' on' : ''}" data-who="${b}" aria-pressed="${picked.has(b)}"><span class="pg-face">${faceSVG(b, { mood: 'happy', size: 46 })}</span><span class="pg-name">${NAMES[b]}</span></button>`)
      .join('');
    this.host.openOverlay(
      `<div class="card" role="dialog" aria-label="The Playground">
        <h2>The Playground</h2>
        <p class="sub">Up in the clouds, as much sky as you like: build them the best playground ever. Who's coming?</p>
        <div class="pg-picks">${chips}</div>
        <p class="hc-games">Build with perches and tubes (they're free up there): put shelves end to end and they join into longer platforms, and draw tubes with your finger, as long and twisty as you like (or pipes, all straight runs and neat elbows). Tap anything you've built to change it. Pinch to zoom, drag the sky to look about, and tap a cat's face up top to follow it.</p>
        <div class="btns"><button class="btn primary" data-go>Up we go!</button><button class="btn" data-close>Not now</button></div>
      </div>`,
      (root) => {
        const go1 = root.querySelector<HTMLButtonElement>('[data-go]')!;
        const refresh = (): void => {
          go1.disabled = picked.size === 0;
        };
        root.querySelectorAll<HTMLElement>('[data-who]').forEach((el) =>
          el.addEventListener('click', () => {
            const b = el.dataset.who as BreedId;
            if (picked.has(b)) picked.delete(b);
            else picked.add(b);
            el.classList.toggle('on', picked.has(b));
            el.setAttribute('aria-pressed', String(picked.has(b)));
            this.host.audio.click();
            refresh();
          }),
        );
        go1.addEventListener('click', () => {
          const who = all.filter((b) => picked.has(b));
          if (!who.length) return;
          this.save.cats = who;
          this.write();
          this.host.closeOverlay();
          go(who);
        });
        refresh();
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Painting

  readonly stage: Stage = {
    pan: [0, 0],
    tiles: [],
    key: () => '',
    camera: () => this.cam,
    paintBack: (ctx, r) => this.paintBack(ctx, r),
    paintFront: (ctx, r) => this.paintFront(ctx, r),
    underlay: (ctx) => this.paintLive(ctx, false),
    liveFront: (ctx) => this.paintLive(ctx, true),
    overlay: (ctx) => this.paintOverlay(ctx),
    inTube: (cat) => this.tubeFace(cat),
    face: (cat) => this.cannonFace(cat),
    behindFront: (cat) => this.behindFront(cat),
  };

  /** How far down the sea of cloud is: well under everything. */
  private get seaY(): number {
    return lowest(this.save) + FALL;
  }

  private paintBack(ctx: Ctx, r: Rect): void {
    paintSky(ctx, r, this.cam.x, this.cam.y, this.seaY);
    paintSpawn(ctx, this.time);
    for (const t of this.save.tubes) if (overlaps(tubeBox(t), r)) this.paintTube(ctx, t, 'back', r);
    const tops = surfacesOf(this.save.pieces);
    for (const p of this.props) {
      const s = p.save;
      if (!overlaps(p.box, r, 40)) continue;
      // (something that stands, with nothing under it, floats on a little cloud)
      if (standing(s.kind)) {
        const foot = s.y + footOf(s.kind);
        const on = tops.some((t) => t.propId !== s.id && Math.abs(t.y - foot) < 1 && t.x0 < s.x + 20 && t.x1 > s.x - 20);
        if (!on) floatPuff(ctx, s.x, foot, (p.box.x1 - p.box.x0) * 1.2);
      }
      // (a toy moves: painted as it is now)
      const g = gadgetOf(s);
      if (g) this.paintToy(ctx, g, 'back');
      else if (!this.moving(p)) this.stampPiece(ctx, s.kind as PerchKind, s.x, s.y, s.id, 'back');
    }
  }

  /** A toy as it is this frame (its blades turning, its belt running, a cat in its barrel...). */
  private paintToy(ctx: Ctx, g: Gadget, layer: 'back' | 'front'): void {
    paintGadget(ctx, g, layer, { time: this.time, flash: this.works.flash.get(g.id) ?? 0, recoil: this.works.recoil.get(g.id) ?? 0, charge: this.works.charge(g.id), shake: this.works.shake(g.id) });
  }

  private paintFront(ctx: Ctx, r: Rect): void {
    for (const p of this.props) {
      const s = p.save;
      if (!fronted(s.kind) || !overlaps(p.box, r, 40)) continue;
      const g = gadgetOf(s);
      if (g) this.paintToy(ctx, g, 'front');
      else if (!this.moving(p)) this.stampPiece(ctx, s.kind as PerchKind, s.x, s.y, s.id, 'front');
    }
    for (const t of this.save.tubes) if (overlaps(tubeBox(t), r)) this.paintTube(ctx, t, 'front', r);
  }

  /** A hammock or a bouncy cushion that's moving (one at rest looks as it always does, and is painted from what's kept). */
  private moving(p: PieceProp): boolean {
    if (p.sling) return !p.sling.still;
    if (p.bouncer) return Math.abs(p.bouncer.squash) > 0.01 || Math.abs(p.bouncer.vel) > 0.01;
    return false;
  }

  /** The pieces that are moving (hammocks, bouncy cushions), where they are this frame, in the look they're kept in. */
  private paintLive(ctx: Ctx, front: boolean): void {
    const r = this.host.renderer.onScreen();
    for (const p of this.props) {
      const k = p.save.kind;
      if (isGadget(k) || !isLive(k) || !this.moving(p) || !overlaps(p.box, r, 60)) continue;
      const look = { ...p, save: { ...p.save, kind: k, id: 3 + (p.save.id % 3) } };
      if (front) paintLiveFront(ctx, look);
      else paintLiveBack(ctx, look);
    }
  }

  /**
   * A tube: its glass painted along it, however it bends (only the stretches
   * of it on screen), and a bell at each end, from a painting of one kept as
   * sharp as the view needs and turned to face its way.
   */
  private paintTube(ctx: Ctx, t: PlayTube, layer: 'back' | 'front', r: Rect): void {
    const g = this.tubeGeom(t);
    const pad = 70;
    const inView = (x: number, y: number): boolean => x > r.x0 - pad && x < r.x1 + pad && y > r.y0 - pad && y < r.y1 + pad;
    // (the stretches of it in view, each with the point either side, from how far along the tube it starts)
    const run = g.run;
    let from = -1;
    for (let i = 0; i <= run.length; i++) {
      const on = i < run.length && inView(run[i][0], run[i][1]);
      if (on && from < 0) from = i;
      if (!on && from >= 0) {
        const i0 = Math.max(0, from - 1);
        const i1 = Math.min(run.length - 1, i);
        if (i1 > i0) paintPipeRun(ctx, run.slice(i0, i1 + 1), layer, g.along[i0]);
        from = -1;
      }
    }
    for (const e of g.ends) if (inView(e.x, e.y)) this.stampBell(ctx, e.x, e.y, e.fx, e.fy, layer);
    // a pipe's brass joints, where its straight runs meet its elbows
    if (layer === 'front') for (const j of g.joints) if (inView(j.x, j.y)) paintPipeJoint(ctx, j.x, j.y, j.ux, j.uy);
  }

  /** A tube's pipe between its bells, how far along it each of its points is, its mouths, and (a pipe) its joints (kept while it's as it is). */
  private tubeGeom(t: PlayTube): Geom {
    let g = this.geoms.get(t);
    if (!g) {
      const run = tubeRun(t);
      const along = [0];
      for (let i = 1; i < run.length; i++) along.push(along[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
      g = { run, along, ends: tubeEnds(t), joints: t.bends ? pipeJoints(t.bends) : [] };
      this.geoms.set(t, g);
    }
    return g;
  }

  /** A tube's bell, its mouth at (x, y) facing (fx, fy), from a painting of one. */
  private stampBell(ctx: Ctx, x: number, y: number, fx: number, fy: number, layer: 'back' | 'front'): void {
    const need = this.host.renderer.scale * this.cam.zoom * this.host.renderer.dpr;
    const ppu = Math.min(8, 2 ** Math.ceil(Math.log2(Math.max(0.5, need))));
    const key = `bell:${layer}`;
    let sp = this.sprites.get(key);
    if (!sp || sp.ppu < ppu) {
      const x0 = -34;
      const y0 = -38;
      const w = 68;
      const h = 48;
      const c = sp?.c ?? document.createElement('canvas');
      c.width = Math.ceil(w * ppu);
      c.height = Math.ceil(h * ppu);
      const g = c.getContext('2d')!;
      g.setTransform(ppu, 0, 0, ppu, -x0 * ppu, -y0 * ppu);
      paintSkyBell(g, layer);
      sp = { c, ppu, x0, y0, w, h };
      this.sprites.set(key, sp);
    }
    ctx.save();
    ctx.translate(x, y);
    // (a bell faces down: turned to face its way)
    ctx.rotate(Math.atan2(-fx, fy));
    ctx.drawImage(sp.c, sp.x0, sp.y0, sp.w, sp.h);
    ctx.restore();
  }

  /**
   * A piece, from a painting of it kept for its kind and look (three looks
   * a kind), as sharp as the view needs: pieces join up into platforms, and
   * the view can take in a lot of them.
   */
  private stampPiece(ctx: Ctx, kind: PerchKind, x: number, y: number, id: number, layer: 'back' | 'front'): void {
    const look = id % 3;
    // (a cat tree's middle deck sticks out toward the middle: two ways round)
    const side = kind === 'tree' ? Math.round(perchBox(kind, x, 0).x0 - x) : 0;
    const need = this.host.renderer.scale * this.cam.zoom * this.host.renderer.dpr;
    const ppu = Math.min(8, 2 ** Math.ceil(Math.log2(Math.max(0.5, need))));
    const key = `${kind}:${look}:${side}:${layer}`;
    let sp = this.sprites.get(key);
    if (!sp || sp.ppu < ppu) {
      const at = kind === 'tree' ? (side === -46 ? 100 : 300) : 0;
      const b = perchBox(kind, at, 0);
      const pad = 12;
      const x0 = b.x0 - at - pad;
      const y0 = b.y0 - pad;
      const w = b.x1 - b.x0 + pad * 2;
      const h = b.y1 - b.y0 + pad * 2;
      const c = sp?.c ?? document.createElement('canvas');
      c.width = Math.ceil(w * ppu);
      c.height = Math.ceil(h * ppu);
      const g = c.getContext('2d')!;
      g.setTransform(ppu, 0, 0, ppu, -(x0 + at) * ppu, -y0 * ppu);
      if (layer === 'back') paintPerchBack(g, kind, at, 0, 3 + look);
      else paintPerchFront(g, kind, at, 0, 3 + look);
      sp = { c, ppu, x0, y0, w, h };
      this.sprites.set(key, sp);
    }
    ctx.drawImage(sp.c, x + sp.x0, y + sp.y0, sp.w, sp.h);
  }

  /** Over everything: what's being placed, and a little marker over the cat the view's following. */
  private paintOverlay(ctx: Ctx): void {
    if (this.tour) this.paintTourHint(ctx);
    const f = this.follow;
    if (f && !this.tubes.riding(f)) {
      const b = f.body;
      b.computeCentroid();
      let top = Infinity;
      for (let i = 0; i < b.n; i++) top = Math.min(top, b.y[i]);
      const bob = Math.sin(this.time * 4) * 2;
      ctx.save();
      ctx.fillStyle = 'rgba(246,200,95,0.95)';
      ctx.strokeStyle = 'rgba(122,90,42,0.7)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(b.cx - 7, top - 20 + bob);
      ctx.lineTo(b.cx + 7, top - 20 + bob);
      ctx.lineTo(b.cx, top - 10 + bob);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    const pl = this.placing;
    if (!pl) return;
    if (pl.k === 'tube') {
      this.paintTubeGhost(ctx, pl.tube);
      return;
    }
    const ok = this.problem(pl) === null;
    const b = this.placeBox(pl);
    ctx.save();
    ctx.fillStyle = ok ? 'rgba(127,196,140,0.18)' : 'rgba(226,120,120,0.24)';
    ctx.strokeStyle = ok ? 'rgba(79,154,107,0.9)' : 'rgba(200,90,90,0.9)';
    ctx.lineWidth = 1.6 / Math.max(0.6, this.cam.zoom);
    ctx.setLineDash([5, 4]);
    roundRect(ctx, b.x0 - 6, b.y0 - 6, b.x1 - b.x0 + 12, b.y1 - b.y0 + 12, 8);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = ok ? 1 : 0.7;
    // (one that's built and not moved yet is where it always was, cats on it and all)
    const p = pl.piece;
    const g = gadgetOf(p);
    if (pl.lifted) {
      if (standing(p.kind) && !this.standsOn(p)) floatPuff(ctx, p.x, p.y + footOf(p.kind), (b.x1 - b.x0) * 1.2);
      if (g) {
        this.paintToy(ctx, g, 'back');
        this.paintToy(ctx, g, 'front');
      } else {
        const k = p.kind as PerchKind;
        paintPerchBack(ctx, k, p.x, p.y, 3 + (p.id % 3));
        if (hasFront(k)) paintPerchFront(ctx, k, p.x, p.y, 3 + (p.id % 3));
      }
    }
    ctx.globalAlpha = 1;
    // a toy that turns: its aim handle, an arrow out on a stem (drag it round)
    const h = g ? aimHandle(g) : null;
    if (g && h) {
      const k = 1 / Math.max(0.6, this.cam.zoom);
      const ink = ok ? 'rgba(79,154,107,0.95)' : 'rgba(200,90,90,0.95)';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.4 * k;
      ctx.setLineDash([4 * k, 3 * k]);
      ctx.beginPath();
      ctx.moveTo(h.cx, h.cy);
      ctx.lineTo(h.x, h.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,253,248,0.95)';
      ctx.beginPath();
      ctx.arc(h.x, h.y, 13 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // (an arrow pointing the way it's aimed)
      const d = aimDir(g);
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(h.x + d.x * 8 * k, h.y + d.y * 8 * k);
      ctx.lineTo(h.x - d.x * 5 * k - d.y * 6 * k, h.y - d.y * 5 * k + d.x * 6 * k);
      ctx.lineTo(h.x - d.x * 2 * k, h.y - d.y * 2 * k);
      ctx.lineTo(h.x - d.x * 5 * k + d.y * 6 * k, h.y - d.y * 5 * k - d.x * 6 * k);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * The tube being drawn: a glow along it (green, or red where it can't go),
   * the tube itself, and its handles: an end each (drag one to draw on, or
   * back along it to take it in) and a grip in its middle to move it by.
   */
  /** The tour's pointers: rings round the cat to boop it, then the way to the cannon's mouth, and rings round that. */
  private paintTourHint(ctx: Ctx): void {
    const t = this.tour!;
    const cat = this.host.session.cats[0];
    if (!cat || t.handsOff) return;
    const b = cat.body;
    b.computeCentroid();
    const rings = (x: number, y: number, r: number): void => {
      for (let k = 0; k < 2; k++) {
        const u = (this.time * 0.9 + k * 0.5) % 1;
        ctx.strokeStyle = `rgba(246,200,95,${(0.9 * (1 - u)).toFixed(3)})`;
        ctx.lineWidth = 4 * (1 - u) + 1;
        ctx.beginPath();
        ctx.arc(x, y, r + u * 22, 0, Math.PI * 2);
        ctx.stroke();
      }
    };
    ctx.save();
    if (t.stage === 'boop') {
      rings(b.cx, b.cy, b.p.radius + 6);
      ctx.restore();
      return;
    }
    const g = this.toys().find((q) => q.kind === 'cannon');
    if (!g) {
      ctx.restore();
      return;
    }
    const m = cannonMouth(g);
    rings(m.zx, m.zy, 20);
    if (!cat.grabbed) {
      // from over the cat, up and across to the mouth (marching along)
      const x0 = b.cx;
      const y0 = b.cy - b.p.radius - 14;
      const cx = (x0 + m.zx) / 2;
      const cy = Math.min(y0, m.zy) - 70;
      ctx.setLineDash([9, 8]);
      ctx.lineDashOffset = -this.time * 30;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(122,90,42,0.45)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx, cy, m.zx, m.zy - 24);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(246,200,95,0.95)';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.setLineDash([]);
      // an arrowhead, pointing on along the curve
      const dx = m.zx - cx;
      const dy = m.zy - 24 - cy;
      const a = Math.atan2(dy, dx);
      ctx.translate(m.zx, m.zy - 24);
      ctx.rotate(a);
      ctx.fillStyle = 'rgba(246,200,95,0.98)';
      ctx.strokeStyle = 'rgba(122,90,42,0.7)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(-10, -8);
      ctx.lineTo(-10, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private paintTubeGhost(ctx: Ctx, t: PlayTube): void {
    const pts = t.pts;
    if (!pts.length) return;
    const pl = this.placing;
    const ok = pl !== null && this.problem(pl) === null;
    const k = 1 / Math.max(0.6, this.cam.zoom);
    const ink = ok ? 'rgba(79,154,107,0.95)' : 'rgba(200,90,90,0.95)';
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ok ? 'rgba(127,196,140,0.32)' : 'rgba(226,120,120,0.38)';
    ctx.lineWidth = TUBE.bell * 2 + 16;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
    ctx.stroke();
    if (pts.length >= 2) {
      // (one that's built and not changed yet is still up in the sky, painted there)
      if (pl?.lifted) {
        const r = this.host.renderer.onScreen();
        this.paintTube(ctx, t, 'back', r);
        this.paintTube(ctx, t, 'front', r);
      }
      const handle = (x: number, y: number, rad: number): void => {
        ctx.fillStyle = 'rgba(255,253,248,0.92)';
        ctx.strokeStyle = ink;
        ctx.lineWidth = 2.4 * k;
        ctx.beginPath();
        ctx.arc(x, y, rad * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
      /** A little arrowhead at (x, y), pointing (ux, uy). */
      const arrow = (x: number, y: number, ux: number, uy: number): void => {
        ctx.beginPath();
        ctx.moveTo(x + ux * 4.5 * k, y + uy * 4.5 * k);
        ctx.lineTo(x - ux * 1 * k - uy * 3.6 * k, y - uy * 1 * k + ux * 3.6 * k);
        ctx.lineTo(x - ux * 1 * k + uy * 3.6 * k, y - uy * 1 * k - ux * 3.6 * k);
        ctx.closePath();
        ctx.fill();
      };
      for (const e of tubeEnds(t)) handle(e.x, e.y, 11);
      // the knob, on its stem: four little arrows (move it all)
      const m = tubeMiddle(t);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.4 * k;
      ctx.setLineDash([4 * k, 3 * k]);
      ctx.beginPath();
      ctx.moveTo(m.at.x, m.at.y);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      ctx.setLineDash([]);
      handle(m.x, m.y, 13);
      ctx.fillStyle = ink;
      for (let q = 0; q < 4; q++) {
        const a = (q * Math.PI) / 2;
        arrow(m.x + Math.cos(a) * 4.5 * k, m.y + Math.sin(a) * 4.5 * k, Math.cos(a), Math.sin(a));
      }
      // a pipe's straight runs: a grip on each, two arrows square to it (slide it sideways)
      const b = t.bends;
      if (b) {
        for (let i = 1; i < b.length; i++) {
          const len = Math.hypot(b[i][0] - b[i - 1][0], b[i][1] - b[i - 1][1]);
          const gx = (b[i][0] + b[i - 1][0]) / 2;
          const gy = (b[i][1] + b[i - 1][1]) / 2;
          if (len < 90) continue;
          const nx = -(b[i][1] - b[i - 1][1]) / len;
          const ny = (b[i][0] - b[i - 1][0]) / len;
          ctx.fillStyle = 'rgba(255,253,248,0.92)';
          ctx.strokeStyle = ink;
          ctx.lineWidth = 2 * k;
          ctx.beginPath();
          ctx.ellipse(gx, gy, 7 * k, 13 * k, Math.atan2(ny, nx) - Math.PI / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = ink;
          arrow(gx + nx * 6 * k, gy + ny * 6 * k, nx, ny);
          arrow(gx - nx * 6 * k, gy - ny * 6 * k, -nx, -ny);
        }
      }
    }
    ctx.restore();
  }

  private standsOn(p: PlayPiece): boolean {
    const foot = p.y + footOf(p.kind);
    return surfacesOf(this.save.pieces.filter((q) => q.id !== p.id)).some((t) => Math.abs(t.y - foot) < 1 && t.x0 < p.x + 20 && t.x1 > p.x - 20);
  }

  private tubeFace(cat: Cat): Expression | null {
    const t = this.tubes.riding(cat);
    if (!t) return null;
    return t.phase === 'go' ? 'happy' : 'wide';
  }

  /** A cat stuffed in a cannon: only its back end shows, out of the muzzle (no face, no shadow). */
  private cannonFace(cat: Cat): { expression: Expression; shadow: boolean; rump: Rump } | null {
    const rump = this.works.rump(cat);
    return rump ? { expression: 'wide', shadow: false, rump } : null;
  }

  private behindFront(cat: Cat): boolean {
    if (this.tubes.riding(cat) || this.works.inCannon(cat) !== null) return true;
    const b = cat.body;
    for (const p of this.props) {
      const k = p.save.kind;
      if (isGadget(k) || !hasFront(k)) continue;
      const bx = p.box;
      if (b.cx > bx.x0 && b.cx < bx.x1 && b.cy > bx.y0 - b.p.radius && b.cy < bx.y1) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // The view

  /** Keep the renderer's camera where ours is (so a finger's world point is read right away). */
  private syncCam(): void {
    this.host.renderer.cam = { ...this.cam };
  }

  /** Each frame: the view coasts after a fling, follows a cat, and goes along with a carried cat (or what's being placed) at the screen's edges. */
  tick(dt: number): void {
    if (!this.active) return;
    if (this.tourOver) {
      this.tourOver = false;
      this.host.home();
      return;
    }
    this.time += dt;
    const r = this.host.renderer;
    if (this.tour) {
      // the tour's view: the cat and the cannon, then along with the ride, out a little to see more of it
      const k = 1 - Math.exp(-2.5 * dt);
      const riding = this.tour.handsOff;
      this.cam.zoom += ((riding ? TOUR_FRAME.ride : TOUR_FRAME.zoom) - this.cam.zoom) * k;
      if (!riding && !this.host.carryFinger()) {
        this.cam.x += (TOUR_FRAME.x - this.cam.x) * k;
        this.cam.y += (TOUR_FRAME.y - this.cam.y) * k;
      }
    }
    const upp = 1 / (r.scale * this.cam.zoom);
    // a carried cat, or what's being placed, at the edge of the screen: the view goes that way
    const f = this.host.carryFinger() ?? (this.drag?.k === 'ghost' || this.drag?.k === 'tube' ? { x: this.drag.sx, y: this.drag.sy } : null);
    const edge = f ? edgePush(f.x, f.y, r.W, r.H, r.insets.top, r.insets.bottom) : null;
    if (edge && (edge.x || edge.y)) {
      this.follow = null;
      this.cam.x += edge.x * 560 * upp * dt;
      this.cam.y += edge.y * 560 * upp * dt;
      if (this.drag?.k === 'ghost' || this.drag?.k === 'tube') {
        const w = r.screenToWorld(this.drag.sx, this.drag.sy);
        this.dragGhostTo(w.x, w.y);
      }
    } else if (this.follow) {
      const c = this.follow;
      const b = c.body;
      b.computeCentroid();
      // (along at its speed, so even a long fall is kept in view; in a tube, its speed's not its own: along as far as it's gone since)
      const last = this.followAt;
      if (!this.tubes.riding(c)) {
        this.cam.x += b.vcx * dt;
        this.cam.y += b.vcy * dt;
      } else if (last && last.cat === c) {
        this.cam.x += b.cx - last.x;
        this.cam.y += b.cy - last.y;
      }
      this.followAt = { cat: c, x: b.cx, y: b.cy };
      const k = 1 - Math.exp(-6 * dt);
      this.cam.x += (b.cx - this.cam.x) * k;
      this.cam.y += (b.cy - 30 - this.cam.y) * k;
    } else if (!this.drag && !this.pinch && (Math.abs(this.camV.x) > 1 || Math.abs(this.camV.y) > 1)) {
      this.cam.x += this.camV.x * dt;
      this.cam.y += this.camV.y * dt;
      const k = Math.exp(-4 * dt);
      this.camV.x *= k;
      this.camV.y *= k;
    }
    // (not out of sight of everything: within reach of what's been built, and above the sea)
    const reach = this.reach();
    this.cam.x = clamp(this.cam.x, reach.x0, reach.x1);
    this.cam.y = clamp(this.cam.y, reach.y0, reach.y1);
    this.syncCam();
    this.updateHud();
  }

  /** How far the view goes: a good way round everything there is (more as you build). */
  private reach(): Box {
    let x0 = SPAWN.x - SPAWN.half;
    let x1 = SPAWN.x + SPAWN.half;
    let y0 = SPAWN.y;
    for (const p of this.save.pieces) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
    }
    for (const t of this.save.tubes) {
      const b = tubeBox(t);
      x0 = Math.min(x0, b.x0);
      x1 = Math.max(x1, b.x1);
      y0 = Math.min(y0, b.y0);
    }
    const more = 1400;
    return { x0: x0 - more, x1: x1 + more, y0: y0 - more, y1: this.seaY };
  }

  private zoomTo(z: number, sx: number, sy: number): void {
    const r = this.host.renderer;
    const w = r.screenToWorld(sx, sy);
    const zoom = clamp(z, ZOOM.min, ZOOM.max);
    const c = r.camFor(w.x, w.y, sx, sy, zoom);
    this.cam = { x: c.x, y: c.y, zoom };
    this.syncCam();
  }

  /** Mouse wheel or trackpad: zoom in and out where it's pointing (and a trackpad's two-finger slide looks about). */
  wheel(dx: number, dy: number, sx: number, sy: number, pinch: boolean): void {
    if (!this.active || this.tour) return;
    this.follow = null;
    if (pinch || Math.abs(dx) < 0.5) this.zoomTo(this.cam.zoom * Math.exp(-dy * (pinch ? 0.01 : 0.0015)), sx, sy);
    else {
      const upp = 1 / (this.host.renderer.scale * this.cam.zoom);
      this.cam.x += dx * upp;
      this.cam.y += dy * upp;
      this.syncCam();
    }
  }

  /** Follow a cat with the view (tap its face); its face again, and the view stays put. */
  followCat(b: BreedId): void {
    const cat = this.host.session.cats.find((c) => c.breed === b) ?? null;
    this.follow = this.follow === cat ? null : cat;
    this.camV = { x: 0, y: 0 };
    this.host.audio.click();
    this.lastHud = '';
  }

  /** The top bar: where you are, and the cats here (tap one to follow it). */
  private updateHud(): void {
    const s = this.host.session;
    const key = `${s.cats.map((c) => c.breed).join('|')}:${this.follow?.breed ?? ''}:${!!this.tour}`;
    if (key === this.lastHud) return;
    this.lastHud = key;
    const $ = (id: string): HTMLElement => document.getElementById(id)!;
    $('roomName').textContent = 'Playground';
    $('roomSub').textContent = this.tour ? 'Your first visit' : this.follow ? `Following ${NAMES[this.follow.breed]}` : 'Tap a face to follow that cat';
    if (this.tour) {
      $('faces').innerHTML = '';
      return;
    }
    $('faces').innerHTML = s.cats
      .map((c) => `<button class="face pg-follow${this.follow === c ? ' on' : ''}" data-follow="${c.breed}" aria-pressed="${this.follow === c}" aria-label="Follow ${NAMES[c.breed]}" title="${NAMES[c.breed]}">${faceSVG(c.breed, { mood: 'happy', size: 26 })}</button>`)
      .join('');
    $('faces')
      .querySelectorAll<HTMLElement>('[data-follow]')
      .forEach((el) => el.addEventListener('click', () => this.followCat(el.dataset.follow as BreedId)));
  }

  // ---------------------------------------------------------------------------
  // Fingers on the sky: looking about, zooming, picking up pieces, placing

  /** A finger down where there's no cat (the app has a cat that's touched). True if the playground takes it. */
  pointerDown(id: number, sx: number, sy: number, wx: number, wy: number): boolean {
    // (on the tour, the sky's just to look at)
    if (!this.active || this.tour) return false;
    this.fingers.set(id, { sx, sy });
    if (this.fingers.size === 2) {
      // a second finger: a pinch (whatever the first was doing stops)
      this.endDrag();
      const [a, b] = [...this.fingers.values()];
      const mx = (a.sx + b.sx) / 2;
      const my = (a.sy + b.sy) / 2;
      const w = this.host.renderer.screenToWorld(mx, my);
      this.pinch = { d0: Math.max(20, Math.hypot(a.sx - b.sx, a.sy - b.sy)), z0: this.cam.zoom, wx: w.x, wy: w.y };
      this.follow = null;
      return true;
    }
    if (this.fingers.size > 2) return true;
    const pl = this.placing;
    if (pl && this.grab(pl, id, sx, sy, wx, wy)) return true;
    // on something built (not what's being changed): a tap picks it to change (whatever's being changed done with), held still it comes up on the finger
    const hit = this.builtAt(wx, wy);
    if (hit && !(pl && hit.id === (pl.k === 'piece' ? pl.piece.id : pl.tube.id))) {
      const timer = window.setTimeout(() => this.pickUp(hit), HOLD_MS);
      this.drag = { k: 'hold', id, sx, sy, timer, hit };
      return true;
    }
    this.startPan(id, sx, sy);
    return true;
  }

  /**
   * A finger down on what's being placed: a piece is dragged; a tube not
   * drawn yet is drawn from there; a tube by an end is drawn on from there,
   * by its knob moved, anywhere along it bent (a pipe: its straight run
   * there slid sideways). False if it's not on it.
   */
  private grab(pl: Placing, id: number, sx: number, sy: number, wx: number, wy: number): boolean {
    const zoomSlop = 26 / (this.host.renderer.scale * this.cam.zoom);
    if (pl.k === 'piece') {
      const g = gadgetOf(pl.piece);
      const h = g ? aimHandle(g) : null;
      if (h && Math.hypot(wx - h.x, wy - h.y) < zoomSlop + 8) {
        this.drag = { k: 'aim', id, sx, sy };
        return true;
      }
      const b = this.placeBox(pl);
      if (wx > b.x0 - zoomSlop && wx < b.x1 + zoomSlop && wy > b.y0 - zoomSlop && wy < b.y1 + zoomSlop) {
        this.drag = { k: 'ghost', id, dx: pl.piece.x - wx, dy: pl.piece.y - wy, sx, sy };
        return true;
      }
      return false;
    }
    const t = pl.tube;
    if (t.pts.length < 2) {
      // nothing drawn yet: the finger draws it, from here
      if (t.bends) {
        const bends = drawPipe([], 'b', wx, wy);
        pl.tube = { ...t, bends, pts: bends.map(([x, y]): Pt => [x, y]) };
      } else pl.tube = { ...t, pts: [[Math.round(wx), Math.round(wy)]] };
      this.drag = { k: 'tube', id, sx, sy, how: 'end', end: 'b', dx: 0, dy: 0 };
      this.refreshPlaceBar();
      return true;
    }
    const [a, b] = tubeEnds(t);
    const da = Math.hypot(wx - a.x, wy - a.y);
    const db = Math.hypot(wx - b.x, wy - b.y);
    const m = tubeMiddle(t);
    if (Math.min(da, db) < zoomSlop + 8) {
      const e = da <= db ? a : b;
      this.drag = { k: 'tube', id, sx, sy, how: 'end', end: da <= db ? 'a' : 'b', dx: e.x - wx, dy: e.y - wy };
      return true;
    }
    if (Math.hypot(wx - m.x, wy - m.y) < zoomSlop + 6) {
      this.drag = { k: 'tube', id, sx, sy, how: 'move', from: t, x0: wx, y0: wy };
      return true;
    }
    if (t.bends) {
      const run = nearestRun(t.bends, wx, wy);
      if (run.d < zoomSlop + TUBE.bell) {
        this.drag = { k: 'tube', id, sx, sy, how: 'slide', run: run.i, from: t.bends, x0: wx, y0: wy };
        return true;
      }
      return false;
    }
    const near = nearestOnTube(t, wx, wy);
    if (near.d < zoomSlop + TUBE.bell) {
      this.drag = { k: 'tube', id, sx, sy, how: 'bend', at: near.s, from: t.pts, x0: wx, y0: wy };
      return true;
    }
    return false;
  }

  private startPan(id: number, sx: number, sy: number): void {
    const t = performance.now();
    this.drag = { k: 'pan', id, sx, sy, cx: this.cam.x, cy: this.cam.y, moved: false, lastX: sx, lastY: sy, lastT: t, vx: 0, vy: 0 };
    this.camV = { x: 0, y: 0 };
  }

  pointerMove(id: number, sx: number, sy: number, wx: number, wy: number): void {
    const f = this.fingers.get(id);
    if (f) {
      f.sx = sx;
      f.sy = sy;
    }
    const pz = this.pinch;
    if (pz && this.fingers.size >= 2) {
      const [a, b] = [...this.fingers.values()];
      const d = Math.max(20, Math.hypot(a.sx - b.sx, a.sy - b.sy));
      const zoom = clamp((pz.z0 * d) / pz.d0, ZOOM.min, ZOOM.max);
      const c = this.host.renderer.camFor(pz.wx, pz.wy, (a.sx + b.sx) / 2, (a.sy + b.sy) / 2, zoom);
      this.cam = { x: c.x, y: c.y, zoom };
      this.syncCam();
      return;
    }
    const d = this.drag;
    if (!d || d.id !== id) return;
    if (d.k === 'hold') {
      if (Math.hypot(sx - d.sx, sy - d.sy) > SLOP) {
        clearTimeout(d.timer);
        this.startPan(id, d.sx, d.sy);
        this.pointerMove(id, sx, sy, wx, wy);
      }
      return;
    }
    if (d.k === 'pan') {
      const upp = 1 / (this.host.renderer.scale * this.cam.zoom);
      if (Math.hypot(sx - d.sx, sy - d.sy) > SLOP) {
        d.moved = true;
        this.follow = null;
      }
      if (!d.moved) return;
      this.cam.x = d.cx - (sx - d.sx) * upp;
      this.cam.y = d.cy - (sy - d.sy) * upp;
      const now = performance.now();
      const dtv = Math.max(1, now - d.lastT) / 1000;
      d.vx = d.vx * 0.6 + (-(sx - d.lastX) * upp * 0.4) / dtv;
      d.vy = d.vy * 0.6 + (-(sy - d.lastY) * upp * 0.4) / dtv;
      d.lastX = sx;
      d.lastY = sy;
      d.lastT = now;
      this.syncCam();
      return;
    }
    d.sx = sx;
    d.sy = sy;
    this.dragGhostTo(wx, wy);
  }

  /** A finger up (`tap`: lifted, not cancelled). */
  pointerUp(id: number, tap = true): boolean {
    this.fingers.delete(id);
    if (this.pinch) {
      if (this.fingers.size < 2) this.pinch = null;
      // (the finger left down looks about from here)
      const rest = [...this.fingers.entries()][0];
      if (rest) this.startPan(rest[0], rest[1].sx, rest[1].sy);
      return true;
    }
    const d = this.drag;
    if (!d || d.id !== id) return false;
    this.drag = null;
    if (d.k === 'hold') {
      clearTimeout(d.timer);
      // a tap on something built: it's picked, to change
      if (tap) this.select(d.hit);
    }
    if (d.k === 'tube') this.refreshPlaceBar();
    if (d.k === 'pan' && d.moved && performance.now() - d.lastT < 80) this.camV = { x: clamp(d.vx, -3000, 3000), y: clamp(d.vy, -3000, 3000) };
    // a tap on the sky, something built being changed: done with it (if it can go there; something new waits for Put it here)
    const pl = this.placing;
    if (d.k === 'pan' && !d.moved && tap && pl?.prev && this.problem(pl) === null) this.endPlacing(true);
    return true;
  }

  private endDrag(): void {
    const d = this.drag;
    if (d?.k === 'hold') clearTimeout(d.timer);
    this.drag = null;
  }

  /** What's being placed follows the finger: a piece, or the tube (drawn on, moved, bent or, a pipe, a run slid). */
  private dragGhostTo(wx: number, wy: number): void {
    const d = this.drag;
    const pl = this.placing;
    if (!pl || !d) return;
    if (d.k === 'ghost' && pl.k === 'piece') {
      const p = snapPiece(pl.piece.kind, wx + d.dx, wy + d.dy, this.save.pieces.filter((q) => q.id !== pl.piece.id));
      if (p.x === pl.piece.x && p.y === pl.piece.y) return;
      this.lift(pl);
      pl.piece = { ...pl.piece, x: p.x, y: p.y };
    } else if (d.k === 'aim' && pl.k === 'piece') {
      // (turned to point at the finger, in steps)
      const g = gadgetOf(pl.piece);
      if (!g) return;
      const h = aimHandle(g)!;
      const aim = fitAim(g.kind, (Math.atan2(wy - h.cy, wx - h.cx) * 180) / Math.PI);
      if (aim === g.aim) return;
      this.lift(pl);
      pl.piece = { ...pl.piece, aim };
    } else if (d.k === 'tube' && pl.k === 'tube') {
      const t = pl.tube;
      let next: PlayTube;
      if (d.how === 'end') {
        const x = wx + d.dx;
        const y = wy + d.dy;
        if (t.bends) next = pipeOf(t.id, drawPipe(t.bends, d.end, x, y));
        else {
          const tip = d.end === 'a' ? t.pts[0] : t.pts[t.pts.length - 1];
          // (a little way at a time)
          if (Math.hypot(x - tip[0], y - tip[1]) < 1.5) return;
          next = { ...t, pts: extendTube(t.pts, d.end, x, y) };
        }
      } else if (d.how === 'move') {
        const f = d.from;
        next = f.bends ? pipeOf(t.id, movePipe(f.bends, wx - d.x0, wy - d.y0)) : { ...t, pts: moveTube(f.pts, wx - d.x0, wy - d.y0) };
      } else if (d.how === 'slide') next = pipeOf(t.id, slidePipeRun(d.from, d.run, wx - d.x0, wy - d.y0));
      else next = { ...t, pts: bendTube(d.from, d.at, wx - d.x0, wy - d.y0) };
      if (samePoints(next.pts, t.pts) && samePoints(next.bends ?? [], t.bends ?? [])) return;
      this.lift(pl);
      pl.tube = next;
    } else return;
    this.refreshPlaceBar();
  }

  /** Something built that's being changed: out of the sky it comes (cats on it drop), to go back as it's left. */
  private lift(pl: Placing): void {
    if (pl.lifted) return;
    pl.lifted = true;
    if (pl.k === 'piece') this.removePiece(pl.piece.id);
    else this.removeTube(pl.tube.id);
    this.host.session.world.wakeAll();
  }

  /** What's built under a finger, if anything: a piece, or a tube. */
  private builtAt(wx: number, wy: number): Built | null {
    return this.pieceAt(wx, wy) ?? this.tubeAt(wx, wy);
  }

  /** The piece under a finger, if any. */
  private pieceAt(wx: number, wy: number): PlayPiece | null {
    for (let i = this.save.pieces.length - 1; i >= 0; i--) {
      const p = this.save.pieces[i];
      const b = pieceBox(p);
      if (wx > b.x0 && wx < b.x1 && wy > b.y0 && wy < b.y1) return p;
    }
    return null;
  }

  private tubeAt(wx: number, wy: number): PlayTube | null {
    for (let i = this.save.tubes.length - 1; i >= 0; i--) {
      const t = this.save.tubes[i];
      if (distToTube(t, wx, wy) < TUBE.bell + 6) return t;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Building

  /** The pieces to build with: every perch, and a tube. */
  showBuild(): void {
    this.host.audio.click();
    const rows = PERCH_ORDER.map(
      (k) => `<button class="pg-piece" data-piece="${k}"><span class="shop-pic"></span><span class="shop-what"><b>${PERCHES[k].name}</b><small>${SKY_BLURBS[k]}</small></span></button>`,
    ).join('');
    this.host.openOverlay(
      `<div class="card shop-card" role="dialog" aria-label="Build">
        <h2>Build</h2>
        <p class="sub">As many as you like, free. Shelves, ledges and clouds put end to end join into one long platform.</p>
        <div class="shop-rows">
          <button class="pg-piece" data-piece="tube"><span class="shop-pic pg-tube-pic"><svg viewBox="0 0 64 46" aria-hidden="true"><path d="M8 38 C 20 6, 34 44, 56 10" fill="none" stroke="#BFD9E4" stroke-width="12" stroke-linecap="round"/><path d="M8 38 C 20 6, 34 44, 56 10" fill="none" stroke="#E8F4F8" stroke-width="5" stroke-linecap="round"/></svg></span><span class="shop-what"><b>Twisty tube</b><small>In at either end, whoosh, and out of the other: draw it with your finger, as long and as twisty as you like</small></span></button>
          <button class="pg-piece" data-piece="pipe"><span class="shop-pic pg-tube-pic"><svg viewBox="0 0 64 46" aria-hidden="true"><path d="M8 36 H 34 Q 46 36, 46 24 V 8" fill="none" stroke="#BFD9E4" stroke-width="12"/><path d="M8 36 H 34 Q 46 36, 46 24 V 8" fill="none" stroke="#E8F4F8" stroke-width="5"/><path d="M30 29 V 43 M46 20 H 39 M46 20 H 53" stroke="#CDA86C" stroke-width="3.5"/></svg></span><span class="shop-what"><b>Pipe</b><small>Like a real one: straight runs and neat elbows, all lined up. Draw it, and it goes straight</small></span></button>
          <p class="shop-h">Toys</p>
          ${GADGET_ORDER.map((k) => `<button class="pg-piece" data-piece="${k}"><span class="shop-pic"></span><span class="shop-what"><b>${GADGETS[k].name}</b><small>${GADGETS[k].blurb}</small></span></button>`).join('')}
          <p class="shop-h">Perches</p>
          ${rows}
        </div>
        <p class="shop-tip">Tap anything you've built to change it: move it, reshape it, or take it away.</p>
        <div class="btns"><button class="btn" data-close>Close</button></div>
      </div>`,
      (root) => {
        root.querySelectorAll<HTMLElement>('[data-piece]').forEach((el) => {
          const k = el.dataset.piece!;
          if (isGadget(k)) el.querySelector('.shop-pic')!.appendChild(gadgetThumb(k, 64, 46));
          else if (k !== 'tube' && k !== 'pipe') el.querySelector('.shop-pic')!.appendChild(perchThumb(k as PerchKind, 64, 46));
          el.addEventListener('click', () => {
            this.host.closeOverlay();
            this.host.audio.seat(70);
            if (k === 'tube' || k === 'pipe') this.startTube(k === 'pipe');
            else this.startPiece(k as PieceKind);
          });
        });
      },
    );
  }

  /** A new piece, in the middle of the view (joined up to whatever's there), or as near as it can be put. */
  private startPiece(kind: PieceKind): void {
    const id = this.save.nextId++;
    const at = this.freeSpot((x, y) => {
      const p = snapPiece(kind, x, y, this.save.pieces);
      const piece: PlayPiece = { id, kind, x: p.x, y: p.y };
      if (isGadget(kind)) piece.aim = GADGETS[kind].aim0;
      return { k: 'piece', piece, prev: null, lifted: true };
    });
    this.beginPlacing(at);
  }

  /** A new tube (or pipe): nothing yet, till a finger draws it. */
  private startTube(pipe: boolean): void {
    const id = this.save.nextId++;
    this.beginPlacing({ k: 'tube', tube: pipe ? { id, pts: [], bends: [] } : { id, pts: [] }, prev: null, lifted: true });
  }

  /** Something new to put somewhere, in the middle of the view if it can go there, or the nearest place it can (rings out from there). */
  private freeSpot(at: (x: number, y: number) => Placing): Placing {
    const step = 30 / Math.max(0.5, this.cam.zoom);
    const mid = { x: this.cam.x, y: this.cam.y - 30 };
    for (let ring = 0; ring < 10; ring++) {
      for (const [ox, oy] of [[0, 0], [0, -1], [-1, 0], [1, 0], [-1, -1], [1, -1], [0, 1], [-1, 1], [1, 1]]) {
        if (ring === 0 && (ox || oy)) continue;
        const pl = at(mid.x + ox * ring * step, mid.y + oy * ring * step);
        if (this.problem(pl) === null) return pl;
      }
    }
    return at(mid.x, mid.y);
  }

  /** Long-pressed: up it comes on the finger (out of the sky till it's put down). Whatever was being changed is done with first. */
  private pickUp(hit: Built): void {
    const d = this.drag;
    if (d?.k === 'hold') this.drag = null;
    if (!this.letGo()) return;
    this.host.audio.grab(1.2, false);
    const pl: Placing = 'kind' in hit ? { k: 'piece', piece: { ...hit }, prev: hit, lifted: false } : { k: 'tube', tube: { ...hit }, prev: hit, lifted: false };
    this.lift(pl);
    this.beginPlacing(pl, d);
  }

  /** Tapped: picked, to change (it stays where it is till it's changed). Whatever was being changed is done with first. */
  private select(hit: Built): void {
    if (!this.letGo()) return;
    this.host.audio.click();
    this.beginPlacing('kind' in hit ? { k: 'piece', piece: { ...hit }, prev: hit, lifted: false } : { k: 'tube', tube: { ...hit }, prev: hit, lifted: false });
  }

  /** Done with what's being changed, to pick something else: put there if it can go there, else back as it was (something new: not built). */
  private letGo(): boolean {
    const pl = this.placing;
    if (!pl) return true;
    if (this.problem(pl) === null) this.endPlacing(true);
    else this.endPlacing(false, true);
    return this.placing === null;
  }

  private beginPlacing(pl: Placing, d: Drag | null = null): void {
    this.forgetUndo();
    this.placing = pl;
    this.follow = null;
    this.bar.classList.add('hidden');
    this.placeBar.classList.remove('hidden');
    this.refreshPlaceBar();
    // (the finger that picked it up carries on dragging it: a tube, the whole of it)
    if (d?.k === 'hold') {
      const w = this.host.renderer.screenToWorld(d.sx, d.sy);
      if (pl.k === 'piece') this.drag = { k: 'ghost', id: d.id, dx: pl.piece.x - w.x, dy: pl.piece.y - w.y, sx: d.sx, sy: d.sy };
      else this.drag = { k: 'tube', id: d.id, sx: d.sx, sy: d.sy, how: 'move', from: pl.tube, x0: w.x, y0: w.y };
    }
  }

  private placeBox(pl: Placing): Box {
    return pl.k === 'piece' ? pieceBox(pl.piece) : tubeBox(pl.tube);
  }

  /** Why it can't go there (null: it can): on a cat, or a tube not drawn yet, or too short or long. */
  private problem(pl: Placing): 'cat' | 'empty' | 'short' | 'long' | null {
    if (pl.k === 'tube') {
      if (pl.tube.pts.length < 2) return 'empty';
      const len = tubeLength(pl.tube);
      if (len < TUBE_LEN.min) return 'short';
      if (len > TUBE_LEN.max + 1) return 'long';
    }
    // (one that's built and not changed is where it was: cats on it are fine)
    if (!pl.lifted) return null;
    const b = this.placeBox(pl);
    for (const c of this.host.session.cats) {
      if (this.tubes.riding(c)) continue;
      const cb = c.body;
      cb.computeCentroid();
      const r = cb.p.radius * 0.8;
      if (cb.cx + r > b.x0 && cb.cx - r < b.x1 && cb.cy + r > b.y0 && cb.cy - r < b.y1) {
        // (a tube's box is all the sky round a slanting one: only its glass counts)
        if (pl.k === 'tube' && distToTube(pl.tube, cb.cx, cb.cy) > TUBE.bell + r) continue;
        return 'cat';
      }
    }
    return null;
  }

  private refreshPlaceBar(): void {
    const pl = this.placing;
    if (!pl) return;
    const pr = this.problem(pl);
    const what = pl.k === 'piece' ? nameOf(pl.piece.kind).toLowerCase() : 'tube';
    const pipe = pl.k === 'tube' && !!pl.tube.bends;
    const why = {
      cat: 'A cat’s in the way',
      empty: pipe ? 'Draw your pipe: drag a finger through the sky, and it goes straight' : 'Draw your tube: drag a finger through the sky',
      short: 'Keep going: draw it a little longer',
      long: 'That’s as long as a tube can be',
    };
    const hint =
      pl.k === 'piece'
        ? isGadget(pl.piece.kind) && GADGETS[pl.piece.kind].aim
          ? `Drag the ${what} where you’d like it, and its arrow to ${pl.piece.kind === 'belt' ? 'turn it round' : 'aim it'}`
          : `Drag the ${what} where you’d like it`
        : pipe
          ? 'Drag an end to lay more pipe (or back, less), a straight bit to slide it, its knob to move it'
          : 'Drag an end to draw on (or back, shorter), the tube to bend it, its knob to move it';
    (this.placeBar.querySelector('.place-hint') as HTMLElement).textContent = pr ? why[pr] : hint;
    const ok = this.placeBar.querySelector('[data-place=ok]') as HTMLButtonElement;
    ok.disabled = pr !== null;
    ok.textContent = pl.prev ? 'Done' : 'Put it here';
    (this.placeBar.querySelector('[data-place=away]') as HTMLElement).textContent = pl.prev ? 'Remove' : 'Cancel';
    const redraw = this.placeBar.querySelector('[data-place=redraw]') as HTMLElement;
    redraw.hidden = pl.k !== 'tube' || pl.tube.pts.length === 0;
    // a tube: twisty, or a pipe (switch it either way)
    const style = this.placeBar.querySelector('.pg-style') as HTMLElement;
    style.hidden = pl.k !== 'tube';
    for (const el of style.querySelectorAll<HTMLElement>('[data-style]')) el.setAttribute('aria-pressed', String((el.dataset.style === 'pipe') === pipe));
  }

  /**
   * Done placing: put it there (or, cancelled, away: something new is never
   * built, something built is taken away, for a moment to undo; leaving, it
   * goes back as it was). Something built that was never changed is where it
   * always was.
   */
  endPlacing(ok: boolean, back = false): void {
    const pl = this.placing;
    if (!pl) return;
    if (ok && this.problem(pl) !== null) return;
    this.placing = null;
    this.drag = null;
    this.placeBar.classList.add('hidden');
    if (this.active) this.bar.classList.remove('hidden');
    const now = pl.k === 'piece' ? pl.piece : pl.tube;
    const box = (): Box => (pl.k === 'piece' ? pieceBox(pl.prev ?? pl.piece) : tubeBox(pl.prev ?? pl.tube));
    if (!ok && !back && pl.prev) {
      // taken away
      const b = box();
      if (!pl.lifted) {
        if (pl.k === 'piece') this.removePiece(pl.prev.id);
        else this.removeTube(pl.prev.id);
        this.host.session.world.wakeAll();
      }
      this.host.renderer.puff((b.x0 + b.x1) / 2, b.y1, 8);
      this.offerUndo(pl.prev);
    } else if (pl.lifted) {
      const keep = ok ? now : back ? pl.prev : null;
      if (keep) {
        if (pl.k === 'piece') this.addPiece(keep as PlayPiece);
        else this.addTube(keep as PlayTube);
        if (ok) {
          this.host.audio.seat(80);
          const b = pl.k === 'piece' ? pieceBox(keep as PlayPiece) : tubeBox(keep as PlayTube);
          this.host.renderer.puff((b.x0 + b.x1) / 2, b.y1 - 6, 6);
          // (the first time: how to change it again)
          if (!pl.prev) this.host.renderer.label((b.x0 + b.x1) / 2, b.y0 - 10, 'Tap it to change it', '#4F9A6B');
        }
      }
    }
    this.write();
  }

  /** Something just taken away: a moment to put it back. */
  private offerUndo(item: Built): void {
    this.forgetUndo();
    const timer = window.setTimeout(() => this.forgetUndo(), 6000);
    this.undo = { item, timer };
    this.undoBar.classList.remove('hidden');
  }

  private forgetUndo(): void {
    if (this.undo) clearTimeout(this.undo.timer);
    this.undo = null;
    this.undoBar.classList.add('hidden');
  }

  /** Put back what was just taken away. */
  private undoRemove(): void {
    const u = this.undo;
    this.forgetUndo();
    if (!u || !this.active) return;
    this.host.audio.seat(80);
    if ('kind' in u.item) this.addPiece(u.item);
    else this.addTube(u.item);
    const b = 'kind' in u.item ? pieceBox(u.item) : tubeBox(u.item);
    this.host.renderer.puff((b.x0 + b.x1) / 2, b.y1 - 6, 6);
    this.write();
  }

  /** The tube being changed made twisty (free to bend anywhere) or a pipe (laid straight along it). */
  private setStyle(pipe: boolean): void {
    const pl = this.placing;
    if (pl?.k !== 'tube' || !!pl.tube.bends === pipe) return;
    this.host.audio.click();
    if (this.drag?.k === 'tube') this.drag = null;
    const t = pl.tube;
    if (t.pts.length < 2) pl.tube = pipe ? { id: t.id, pts: [], bends: [] } : { id: t.id, pts: [] };
    else {
      this.lift(pl);
      if (pipe) {
        const bends = straighten(t.pts);
        if (bends.length < 2) return;
        pl.tube = pipeOf(t.id, bends);
      } else pl.tube = { id: t.id, pts: t.pts };
    }
    this.refreshPlaceBar();
  }

  /** The tube being drawn, rubbed out: draw it again. */
  private redraw(): void {
    const pl = this.placing;
    if (pl?.k !== 'tube') return;
    this.host.audio.click();
    if (this.drag?.k === 'tube') this.drag = null;
    this.lift(pl);
    pl.tube = pl.tube.bends ? { id: pl.tube.id, pts: [], bends: [] } : { id: pl.tube.id, pts: [] };
    this.refreshPlaceBar();
  }

  private addPiece(p: PlayPiece): void {
    this.save.pieces.push(p);
    const prop = buildPiece(p);
    this.props.push(prop);
    const w = this.host.session.world;
    for (const sh of prop.shapes) w.addStatic(sh);
    this.host.session.registerShapes();
  }

  private removePiece(id: number): void {
    this.save.pieces = this.save.pieces.filter((p) => p.id !== id);
    const i = this.props.findIndex((p) => p.save.id === id);
    if (i < 0) return;
    this.host.session.world.removeStaticsOfProp(this.props[i].propId);
    this.props.splice(i, 1);
    this.host.session.registerShapes();
  }

  private addTube(t: PlayTube): void {
    this.save.tubes.push(t);
    this.sim.skyTubes.push(skyTube(t));
    const w = this.host.session.world;
    for (const sh of tubeShapes(t)) w.addStatic(sh);
    this.host.session.registerShapes();
  }

  private removeTube(id: number): void {
    this.save.tubes = this.save.tubes.filter((t) => t.id !== id);
    this.sim.skyTubes = this.sim.skyTubes.filter((t) => t.play.id !== id);
    this.host.session.world.removeStaticsOfProp(TUBE_PROP_BASE + id);
    this.host.session.registerShapes();
  }

  /** Everything built taken away (the menu's Clear the sky): just the respawn cloud left. */
  clearSky(): void {
    if (this.placing) this.endPlacing(false, true);
    this.forgetUndo();
    for (const p of [...this.save.pieces]) this.removePiece(p.id);
    for (const t of [...this.save.tubes]) this.removeTube(t.id);
    this.tubes.finishAll();
    this.host.session.world.wakeAll();
    this.host.audio.seat(60);
    this.write();
  }

  // ---------------------------------------------------------------------------
  // Life up here

  canTouch(cat: Cat): boolean {
    return !this.tubes.riding(cat) && this.works.inCannon(cat) === null && !this.tour?.handsOff;
  }

  /** A cat can be carried anywhere up here. */
  carryBox(): { x0: number; x1: number; y0: number; y1: number } {
    return { x0: -1e6, x1: 1e6, y0: -1e6, y1: 1e6 };
  }

  /** Let go at a cannon's mouth or a tube's: in it goes. */
  released(cat: Cat): void {
    if (!this.active) return;
    const into = this.sim.released(cat);
    if (into === 'cannon') this.loaded(cat);
    if (!this.tour) return;
    if (into) {
      this.tourRide(cat);
      return;
    }
    // (on the tour, let go anywhere near the cannon's mouth and in it goes)
    const b = cat.body;
    const g = nearCannon(this.sim, b.cx, b.cy);
    if (g && this.works.load(cat, g)) {
      this.loaded(cat);
      this.tourRide(cat);
    }
  }

  /** One physics step: the springy pieces, the tubes, the toys, cats put in a tube's mouth or falling into the sea (sim.ts), and their sounds. */
  step(): void {
    if (!this.active) return;
    for (const e of this.sim.step(this.seaY)) {
      const v = BREEDS[e.cat ? e.cat.breed : 'kitten'].voice;
      if (this.tour) {
        this.tour.heard(e);
        if (e.t === 'load') this.tourRide(e.cat);
        if (e.t === 'fell' && this.tour.handsOff) {
          // (never, but just in case: off the course on the tour, into the hammock)
          this.tourRescue(e.cat);
          continue;
        }
      }
      switch (e.t) {
        case 'in':
          this.host.audio.glorp(v.pitch * 1.1, 0.4, 0.1);
          break;
        case 'out':
          this.host.audio.boop(v.pitch);
          this.host.renderer.puff(e.x, e.y + e.cat.body.p.radius, 5);
          break;
        case 'load':
          this.loaded(e.cat);
          break;
        case 'fire':
          this.host.audio.pomf();
          this.host.renderer.puff(e.x, e.y, 8);
          if (Math.random() < 0.6) this.host.audio.grab(v.pitch, false);
          break;
        case 'bump':
          this.host.audio.boing(e.speed, 0.15);
          this.host.renderer.puff(e.cat.body.cx, e.cat.body.cy, 3);
          break;
        case 'boing':
          this.host.audio.boing(e.speed, e.cat ? clamp((e.cat.body.p.radius - 22) / 20, 0, 1) : 0);
          break;
        case 'fell':
          this.respawn(e.cat);
          break;
      }
    }
    if (this.tour) this.stepTour();
  }

  /** The toys up in the sky, as the toys' works take them. */
  toys(): Gadget[] {
    return this.sim.toys();
  }

  private get props(): PieceProp[] {
    return this.sim.props;
  }

  private get tubes(): SkySim['tubes'] {
    return this.sim.tubes;
  }

  get works(): SkySim['works'] {
    return this.sim.works;
  }

  /** A cat into a cannon: a little glorp, and a puff at its mouth. */
  private loaded(cat: Cat): void {
    const v = BREEDS[cat.breed].voice;
    this.host.audio.glorp(v.pitch * 1.2, 0.3, 0.1);
    cat.sinceTouch = 0;
  }

  /** Back on the respawn cloud, where there's room (or dropped onto it from above), with a puff. */
  private respawn(cat: Cat): void {
    const s = this.host.session;
    const b = cat.body;
    const r = b.p.radius;
    const others = s.cats.filter((c) => c !== cat && !this.tubes.riding(c)).map((c) => {
      c.body.computeCentroid();
      return { x: c.body.cx, y: c.body.cy, r: c.body.p.radius };
    });
    const y = SPAWN.y - r * 0.92 - 3;
    const xs = spawnSpots(5).sort((a, c) => Math.abs(a - SPAWN.x) - Math.abs(c - SPAWN.x));
    const x = xs.find((xx) => roomFor(s.world.statics, others, xx, y, r)) ?? null;
    b.placeAt(x ?? SPAWN.x + (Math.random() - 0.5) * 60, x === null ? y - 220 : y);
    cat.settled = 0;
    cat.intent = null;
    cat.sinceTouch = 0;
    b.computeCentroid();
    this.host.renderer.puff(b.cx, b.cy + r * 0.6, 7);
    this.host.renderer.hearts(b.cx, b.cy - r - 6, 1);
    this.host.audio.boop(BREEDS[cat.breed].voice.pitch);
  }

  /** Everyone back on the respawn cloud (and the view with them). */
  respawnAll(): void {
    this.host.audio.click();
    this.tubes.finishAll();
    this.works.releaseAll();
    for (const c of this.host.session.cats) {
      if (c.grabbed) continue;
      this.respawn(c);
    }
    this.follow = null;
    this.camV = { x: 0, y: 0 };
    this.cam.x = SPAWN.x;
    this.cam.y = SPAWN.y - 110;
    this.syncCam();
  }
}

// ---------------------------------------------------------------------------

type Rect = { x0: number; y0: number; x1: number; y1: number };

/** The tour's view to begin with (the cat and the cannon), and how far out it goes for the ride. */
const TOUR_FRAME = { x: SPAWN.x + 10, y: SPAWN.y - 80, zoom: 1.2, ride: 0.85 };

const overlaps = (b: Box, r: Rect, pad = 0): boolean => b.x1 + pad > r.x0 && b.x0 - pad < r.x1 && b.y1 + pad > r.y0 && b.y0 - pad < r.y1;

/** Which way (and how hard, 0..1) a finger at the screen's edge pushes the view. */
function edgePush(x: number, y: number, W: number, H: number, top: number, bottom: number): { x: number; y: number } {
  const ex = x < EDGE ? -(EDGE - x) / EDGE : x > W - EDGE ? (x - (W - EDGE)) / EDGE : 0;
  const t0 = top + EDGE;
  const b0 = H - bottom - EDGE * 0.8;
  const ey = y < t0 ? -(t0 - y) / EDGE : y > b0 ? (y - b0) / EDGE : 0;
  return { x: clamp(ex, -1, 1), y: clamp(ey, -1, 1) };
}

/** Where a toy that turns has its aim handle (out the way it's aimed), and the middle it turns about; null if it doesn't turn. */
function aimHandle(g: Gadget): { x: number; y: number; cx: number; cy: number } | null {
  if (!GADGETS[g.kind].aim) return null;
  const d = aimDir(g);
  if (g.kind === 'belt') {
    const cy = g.y + BELT.h / 2;
    return { x: g.x + d.x * (BELT.half + 30), y: cy, cx: g.x, cy };
  }
  const out = g.kind === 'cannon' ? CANNON.fore + 40 : FAN.r + 42;
  return { x: g.x + d.x * out, y: g.y + d.y * out, cx: g.x, cy: g.y };
}

/** Two lines of points the same? */
function samePoints(a: readonly Pt[], b: readonly Pt[]): boolean {
  return a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

