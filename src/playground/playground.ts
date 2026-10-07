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
import type { SoftBody } from '../physics/softbody';
import { FRAME_DT, GRAVITY } from '../physics/world';
import type { Expression } from '../render/catArt';
import { roundRect, type Ctx } from '../render/paint';
import type { Renderer, Stage } from '../render/renderer';
import { faceSVG } from '../ui/faces';
import { clamp } from '../util/math';
import { NAMES } from '../house/house';
import { paintPipeRun, paintSkyBell } from '../house/houseArt';
import { inRingOf } from '../house/leap';
import { hasFront, isLive, paintLiveBack, paintLiveFront, paintPerchBack, paintPerchFront, perchThumb } from '../house/perchArt';
import { PERCHES, PERCH_ORDER, perchBox, type Box, type PerchKind, type PerchProp } from '../house/perches';
import { Tubes } from '../house/tubes';
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
  extendTube,
  lowest,
  mouthOf,
  moveTube,
  nearestOnTube,
  pieceBox,
  readPlay,
  skyTube,
  snapPiece,
  spawnShapes,
  spawnSpots,
  standing,
  surfacesOf,
  tubeBox,
  tubeEnds,
  tubeLength,
  tubeMiddle,
  tubeRun,
  tubeShapes,
  type PlayPiece,
  type PlaySave,
  type PlayTube,
  type SkyTube,
} from './layout';
import { floatPuff, paintSky, paintSpawn } from './skyArt';

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

/** Something being put somewhere: a piece (new, or picked up: `prev`), or a tube. */
type Placing = { k: 'piece'; piece: PlayPiece; prev: PlayPiece | null } | { k: 'tube'; tube: PlayTube; prev: PlayTube | null };

type Pt = [number, number];

type Drag =
  | { k: 'pan'; id: number; sx: number; sy: number; cx: number; cy: number; moved: boolean; lastX: number; lastY: number; lastT: number; vx: number; vy: number }
  | { k: 'hold'; id: number; sx: number; sy: number; timer: number }
  /** Dragging a piece that's being placed. */
  | { k: 'ghost'; id: number; dx: number; dy: number; sx: number; sy: number }
  /**
   * Working on a tube that's being placed: drawing it on from an end (the
   * finger `dx, dy` off the end), moving the whole of it by its grip, or
   * bending it, pulled by the point `at` along it (as it was, `from`, when
   * the finger came down at x0, y0).
   */
  | ({ k: 'tube'; id: number; sx: number; sy: number } & ({ how: 'end'; end: 'a' | 'b'; dx: number; dy: number } | { how: 'move'; lx: number; ly: number } | { how: 'bend'; at: number; from: Pt[]; x0: number; y0: number }));

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
  readonly tubes: Tubes<Cat, SkyTube>;
  /** The pieces up in the sky (their colliders are in the world), and the tubes as they're ridden. */
  private props: PerchProp[] = [];
  private skyTubes: SkyTube[] = [];
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
  private cooldown = new Map<Cat, number>();
  private fellAt = new WeakMap<SoftBody, number>();
  private frame = 0;
  private time = 0;
  /** Painted pieces, kept (a piece's kind and look, how sharp: pixels per unit). */
  private sprites = new Map<string, { c: HTMLCanvasElement; ppu: number; x0: number; y0: number; w: number; h: number }>();
  /** Each tube's pipe and mouths, worked out once. */
  private geoms = new WeakMap<PlayTube, { run: Pt[]; along: number[]; ends: ReturnType<typeof tubeEnds> }>();
  private readonly bar: HTMLElement;
  private readonly placeBar: HTMLElement;
  private lastHud = '';

  constructor(private readonly host: PlayHost) {
    this.save = readPlay(safeGet(PLAY_KEY));
    this.tubes = new Tubes<Cat, SkyTube>(() => host.session.world);
    this.tubes.inTheWay = (cat, out) => this.inTheWay(cat, out);
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
    this.placeBar.innerHTML = `<p class="place-hint"></p><div class="place-btns"><button class="btn" data-place="redraw" hidden>Redraw</button><button class="btn" data-place="away">Remove</button><button class="btn primary" data-place="ok">Put it here</button></div>`;
    this.placeBar.querySelector('[data-place=away]')!.addEventListener('click', () => this.endPlacing(false));
    this.placeBar.querySelector('[data-place=redraw]')!.addEventListener('click', () => this.redraw());
    this.placeBar.querySelector('[data-place=ok]')!.addEventListener('click', () => this.endPlacing(true));
    document.getElementById('app')!.appendChild(this.placeBar);
  }

  get isActive(): boolean {
    return this.active;
  }

  // ---------------------------------------------------------------------------
  // The sky as a room

  /** The cats who've come, on the respawn cloud. */
  room(): RoomDef {
    const xs = spawnSpots(this.who.length);
    const cats = this.who.map((b, i) => ({ breed: b, x: xs[i], y: SPAWN.y, name: NAMES[b] }));
    return { id: 'playground', name: 'Playground', theme: 'living', furniture: [], containers: [], decor: [], cats };
  }

  get sessionOptions(): SessionOptions {
    return {
      shell: () => {
        this.props = this.save.pieces.map(buildPiece);
        this.skyTubes = this.save.tubes.map(skyTube);
        return [...spawnShapes(), ...this.props.flatMap((p) => p.shapes), ...this.save.tubes.flatMap(tubeShapes)];
      },
      // (a cat stuck fast goes to the nearest clear place: up here, anywhere)
      spawnOk: () => true,
      unmerge: true,
    };
  }

  /** Called once the playground's session is up (`arriving`: a cat that's come up the sky tube from the roof garden, dropping in from above). */
  enter(arriving: BreedId | null = null): void {
    this.active = true;
    this.time = 0;
    this.frame = 0;
    this.cooldown.clear();
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
  }

  leave(): void {
    if (this.active) {
      if (this.placing) this.endPlacing(false, true);
      this.tubes.finishAll();
      this.write();
    }
    this.active = false;
    this.drag = null;
    this.pinch = null;
    this.fingers.clear();
    this.bar.classList.add('hidden');
    this.placeBar.classList.add('hidden');
    this.host.renderer.stage = null;
  }

  private write(): void {
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
        <p class="hc-games">Build with perches and tubes (they're free up there): put shelves end to end and they join into longer platforms, and draw tubes with your finger, as long and twisty as you like. Pinch to zoom, drag the sky to look about, and tap a cat's face up top to follow it.</p>
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
        const foot = s.y + PERCHES[s.kind].height;
        const on = tops.some((t) => t.propId !== s.id && Math.abs(t.y - foot) < 1 && t.x0 < s.x + 20 && t.x1 > s.x - 20);
        if (!on) floatPuff(ctx, s.x, foot, (p.box.x1 - p.box.x0) * 1.2);
      }
      if (!this.moving(p)) this.stampPiece(ctx, s.kind, s.x, s.y, s.id, 'back');
    }
  }

  private paintFront(ctx: Ctx, r: Rect): void {
    for (const p of this.props) {
      const s = p.save;
      if (hasFront(s.kind) && !this.moving(p) && overlaps(p.box, r, 40)) this.stampPiece(ctx, s.kind, s.x, s.y, s.id, 'front');
    }
    for (const t of this.save.tubes) if (overlaps(tubeBox(t), r)) this.paintTube(ctx, t, 'front', r);
  }

  /** A hammock or a bouncy cushion that's moving (one at rest looks as it always does, and is painted from what's kept). */
  private moving(p: PerchProp): boolean {
    if (p.sling) return !p.sling.still;
    if (p.bouncer) return Math.abs(p.bouncer.squash) > 0.01 || Math.abs(p.bouncer.vel) > 0.01;
    return false;
  }

  /** The pieces that are moving (hammocks, bouncy cushions), where they are this frame, in the look they're kept in. */
  private paintLive(ctx: Ctx, front: boolean): void {
    const r = this.host.renderer.onScreen();
    for (const p of this.props) {
      if (!isLive(p.save.kind) || !this.moving(p) || !overlaps(p.box, r, 60)) continue;
      const look = { ...p, save: { ...p.save, id: 3 + (p.save.id % 3) } };
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
  }

  /** A tube's pipe between its bells, how far along it each of its points is, and its mouths (kept while it's as it is). */
  private tubeGeom(t: PlayTube): { run: Pt[]; along: number[]; ends: ReturnType<typeof tubeEnds> } {
    let g = this.geoms.get(t);
    if (!g) {
      const run = tubeRun(t);
      const along = [0];
      for (let i = 1; i < run.length; i++) along.push(along[i - 1] + Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]));
      g = { run, along, ends: tubeEnds(t) };
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
    const p = pl.piece;
    if (standing(p.kind) && !this.standsOn(p)) floatPuff(ctx, p.x, p.y + PERCHES[p.kind].height, (b.x1 - b.x0) * 1.2);
    paintPerchBack(ctx, p.kind, p.x, p.y, 3 + (p.id % 3));
    if (hasFront(p.kind)) paintPerchFront(ctx, p.kind, p.x, p.y, 3 + (p.id % 3));
    ctx.restore();
  }

  /**
   * The tube being drawn: a glow along it (green, or red where it can't go),
   * the tube itself, and its handles: an end each (drag one to draw on, or
   * back along it to take it in) and a grip in its middle to move it by.
   */
  private paintTubeGhost(ctx: Ctx, t: PlayTube): void {
    const pts = t.pts;
    if (!pts.length) return;
    const pl = this.placing;
    const ok = pl !== null && this.problem(pl) === null;
    const k = 1 / Math.max(0.6, this.cam.zoom);
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
      const r = this.host.renderer.onScreen();
      this.paintTube(ctx, t, 'back', r);
      this.paintTube(ctx, t, 'front', r);
      const handle = (x: number, y: number, rad: number): void => {
        ctx.fillStyle = 'rgba(255,253,248,0.92)';
        ctx.strokeStyle = ok ? 'rgba(79,154,107,0.95)' : 'rgba(200,90,90,0.95)';
        ctx.lineWidth = 2.4 * k;
        ctx.beginPath();
        ctx.arc(x, y, rad * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
      for (const e of tubeEnds(t)) handle(e.x, e.y, 11);
      // the grip: four little arrows (move it)
      const m = tubeMiddle(t);
      handle(m.x, m.y, 13);
      ctx.fillStyle = ok ? 'rgba(79,154,107,0.95)' : 'rgba(200,90,90,0.95)';
      for (let q = 0; q < 4; q++) {
        const a = (q * Math.PI) / 2;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(m.x + cx * 9 * k, m.y + cy * 9 * k);
        ctx.lineTo(m.x + (cx * 4.5 - cy * 3.6) * k, m.y + (cy * 4.5 + cx * 3.6) * k);
        ctx.lineTo(m.x + (cx * 4.5 + cy * 3.6) * k, m.y + (cy * 4.5 - cx * 3.6) * k);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private standsOn(p: PlayPiece): boolean {
    const foot = p.y + PERCHES[p.kind].height;
    return surfacesOf(this.save.pieces.filter((q) => q.id !== p.id)).some((t) => Math.abs(t.y - foot) < 1 && t.x0 < p.x + 20 && t.x1 > p.x - 20);
  }

  private tubeFace(cat: Cat): Expression | null {
    const t = this.tubes.riding(cat);
    if (!t) return null;
    return t.phase === 'go' ? 'happy' : 'wide';
  }

  private behindFront(cat: Cat): boolean {
    if (this.tubes.riding(cat)) return true;
    const b = cat.body;
    for (const p of this.props) {
      if (!hasFront(p.save.kind)) continue;
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
    this.time += dt;
    const r = this.host.renderer;
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
    if (!this.active) return;
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
    const key = `${s.cats.map((c) => c.breed).join('|')}:${this.follow?.breed ?? ''}`;
    if (key === this.lastHud) return;
    this.lastHud = key;
    const $ = (id: string): HTMLElement => document.getElementById(id)!;
    $('roomName').textContent = 'Playground';
    $('roomSub').textContent = this.follow ? `Following ${NAMES[this.follow.breed]}` : 'Tap a face to follow that cat';
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
    if (!this.active) return false;
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
    if (pl) {
      // a finger on what's being placed drags it
      const zoomSlop = 26 / (this.host.renderer.scale * this.cam.zoom);
      if (pl.k === 'tube') {
        const t = pl.tube;
        if (t.pts.length < 2) {
          // nothing drawn yet: the finger draws it, from here
          pl.tube = { ...t, pts: [[Math.round(wx), Math.round(wy)]] };
          this.drag = { k: 'tube', id, sx, sy, how: 'end', end: 'b', dx: 0, dy: 0 };
          this.refreshPlaceBar();
          return true;
        }
        // by an end: drawn on from there; by its grip: moved; anywhere along it: bent
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
          this.drag = { k: 'tube', id, sx, sy, how: 'move', lx: wx, ly: wy };
          return true;
        }
        const near = nearestOnTube(t, wx, wy);
        if (near.d < zoomSlop + TUBE.bell) {
          this.drag = { k: 'tube', id, sx, sy, how: 'bend', at: near.s, from: t.pts, x0: wx, y0: wy };
          return true;
        }
      } else {
        const b = this.placeBox(pl);
        if (wx > b.x0 - zoomSlop && wx < b.x1 + zoomSlop && wy > b.y0 - zoomSlop && wy < b.y1 + zoomSlop) {
          this.drag = { k: 'ghost', id, dx: pl.piece.x - wx, dy: pl.piece.y - wy, sx, sy };
          return true;
        }
      }
    } else {
      // held still a moment on a piece or a tube, it comes up
      const hit = this.pieceAt(wx, wy) ?? this.tubeAt(wx, wy);
      if (hit) {
        const timer = window.setTimeout(() => this.pickUp(hit), HOLD_MS);
        this.drag = { k: 'hold', id, sx, sy, timer };
        return true;
      }
    }
    this.startPan(id, sx, sy);
    return true;
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

  pointerUp(id: number): boolean {
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
    if (d.k === 'hold') clearTimeout(d.timer);
    if (d.k === 'tube') this.refreshPlaceBar();
    if (d.k === 'pan' && d.moved && performance.now() - d.lastT < 80) this.camV = { x: clamp(d.vx, -3000, 3000), y: clamp(d.vy, -3000, 3000) };
    return true;
  }

  private endDrag(): void {
    const d = this.drag;
    if (d?.k === 'hold') clearTimeout(d.timer);
    this.drag = null;
  }

  /** What's being placed follows the finger: a piece, or the tube (drawn on, moved or bent). */
  private dragGhostTo(wx: number, wy: number): void {
    const d = this.drag;
    const pl = this.placing;
    if (!pl || !d) return;
    if (d.k === 'ghost' && pl.k === 'piece') {
      const p = snapPiece(pl.piece.kind, wx + d.dx, wy + d.dy, this.save.pieces.filter((q) => q.id !== pl.piece.id));
      pl.piece = { ...pl.piece, x: p.x, y: p.y };
    } else if (d.k === 'tube' && pl.k === 'tube') {
      const t = pl.tube;
      if (d.how === 'end') {
        const x = wx + d.dx;
        const y = wy + d.dy;
        const tip = d.end === 'a' ? t.pts[0] : t.pts[t.pts.length - 1];
        // (a little way at a time)
        if (Math.hypot(x - tip[0], y - tip[1]) < 1.5) return;
        pl.tube = { ...t, pts: extendTube(t.pts, d.end, x, y) };
      } else if (d.how === 'move') {
        pl.tube = { ...t, pts: moveTube(t.pts, wx - d.lx, wy - d.ly) };
        d.lx = wx;
        d.ly = wy;
      } else pl.tube = { ...t, pts: bendTube(d.from, d.at, wx - d.x0, wy - d.y0) };
    } else return;
    this.refreshPlaceBar();
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
          <button class="pg-piece" data-piece="tube"><span class="shop-pic pg-tube-pic"><svg viewBox="0 0 64 46" aria-hidden="true"><path d="M10 38 L54 8" stroke="#BFD9E4" stroke-width="13" stroke-linecap="round"/><path d="M10 38 L54 8" stroke="#E8F4F8" stroke-width="6" stroke-linecap="round"/></svg></span><span class="shop-what"><b>Tube</b><small>In at either end, whoosh, and out of the other: draw it with your finger, as long and as twisty as you like</small></span></button>
          ${rows}
        </div>
        <p class="shop-tip">Press and hold anything you've built to move it, or to take it away.</p>
        <div class="btns"><button class="btn" data-close>Close</button></div>
      </div>`,
      (root) => {
        root.querySelectorAll<HTMLElement>('[data-piece]').forEach((el) => {
          const k = el.dataset.piece!;
          if (k !== 'tube') el.querySelector('.shop-pic')!.appendChild(perchThumb(k as PerchKind, 64, 46));
          el.addEventListener('click', () => {
            this.host.closeOverlay();
            this.host.audio.seat(70);
            if (k === 'tube') this.startTube();
            else this.startPiece(k as PerchKind);
          });
        });
      },
    );
  }

  /** A new piece, in the middle of the view (joined up to whatever's there), or as near as it can be put. */
  private startPiece(kind: PerchKind): void {
    const id = this.save.nextId++;
    const at = this.freeSpot((x, y) => {
      const p = snapPiece(kind, x, y, this.save.pieces);
      return { k: 'piece', piece: { id, kind, x: p.x, y: p.y }, prev: null };
    });
    this.beginPlacing(at);
  }

  /** A new tube: nothing yet, till a finger draws it. */
  private startTube(): void {
    const id = this.save.nextId++;
    this.beginPlacing({ k: 'tube', tube: { id, pts: [] }, prev: null });
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

  /** Long-pressed: up it comes (out of the sky till it's put down). */
  private pickUp(hit: PlayPiece | PlayTube): void {
    const d = this.drag;
    if (d?.k === 'hold') this.drag = null;
    if (this.placing) return;
    this.host.audio.grab(1.2, false);
    if ('kind' in hit) {
      this.removePiece(hit.id);
      this.beginPlacing({ k: 'piece', piece: { ...hit }, prev: hit }, d);
    } else {
      this.removeTube(hit.id);
      this.beginPlacing({ k: 'tube', tube: { ...hit }, prev: hit }, d);
    }
  }

  private beginPlacing(pl: Placing, d: Drag | null = null): void {
    this.placing = pl;
    this.follow = null;
    this.bar.classList.add('hidden');
    this.placeBar.classList.remove('hidden');
    this.refreshPlaceBar();
    // (the finger that picked it up carries on dragging it: a tube, the whole of it)
    if (d?.k === 'hold') {
      const w = this.host.renderer.screenToWorld(d.sx, d.sy);
      if (pl.k === 'piece') this.drag = { k: 'ghost', id: d.id, dx: pl.piece.x - w.x, dy: pl.piece.y - w.y, sx: d.sx, sy: d.sy };
      else this.drag = { k: 'tube', id: d.id, sx: d.sx, sy: d.sy, how: 'move', lx: w.x, ly: w.y };
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
    const what = pl.k === 'piece' ? PERCHES[pl.piece.kind].name.toLowerCase() : 'tube';
    const why = {
      cat: 'A cat’s in the way',
      empty: 'Draw your tube: drag a finger through the sky',
      short: 'Keep going: draw it a little longer',
      long: 'That’s as long as a tube can be',
    };
    const hint = pl.k === 'tube' ? 'Drag an end to draw on (or back, shorter), the tube to bend it, its knob to move it' : `Drag the ${what} where you’d like it`;
    (this.placeBar.querySelector('.place-hint') as HTMLElement).textContent = pr ? why[pr] : hint;
    (this.placeBar.querySelector('[data-place=ok]') as HTMLButtonElement).disabled = pr !== null;
    (this.placeBar.querySelector('[data-place=away]') as HTMLElement).textContent = pl.prev ? 'Remove' : 'Cancel';
    const redraw = this.placeBar.querySelector('[data-place=redraw]') as HTMLElement;
    redraw.hidden = pl.k !== 'tube' || pl.tube.pts.length === 0;
  }

  /** Done placing: put it there (or, cancelled, away: a new one's never built, one picked up is taken away; leaving, it goes back). */
  endPlacing(ok: boolean, back = false): void {
    const pl = this.placing;
    if (!pl) return;
    if (ok && this.problem(pl) !== null) return;
    this.placing = null;
    this.drag = null;
    this.placeBar.classList.add('hidden');
    if (this.active) this.bar.classList.remove('hidden');
    const keep = ok ? (pl.k === 'piece' ? pl.piece : pl.tube) : back ? pl.prev : null;
    if (keep) {
      if (pl.k === 'piece') this.addPiece(keep as PlayPiece);
      else this.addTube(keep as PlayTube);
      if (ok) {
        this.host.audio.seat(80);
        const b = this.placeBox(pl);
        this.host.renderer.puff((b.x0 + b.x1) / 2, b.y1 - 6, 6);
      }
    } else if (!ok && pl.prev) this.host.renderer.puff((this.placeBox(pl).x0 + this.placeBox(pl).x1) / 2, this.placeBox(pl).y1, 8);
    this.write();
  }

  /** The tube being drawn, rubbed out: draw it again. */
  private redraw(): void {
    const pl = this.placing;
    if (pl?.k !== 'tube') return;
    this.host.audio.click();
    if (this.drag?.k === 'tube') this.drag = null;
    pl.tube = { ...pl.tube, pts: [] };
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
    this.skyTubes.push(skyTube(t));
    const w = this.host.session.world;
    for (const sh of tubeShapes(t)) w.addStatic(sh);
    this.host.session.registerShapes();
  }

  private removeTube(id: number): void {
    this.save.tubes = this.save.tubes.filter((t) => t.id !== id);
    this.skyTubes = this.skyTubes.filter((t) => t.play.id !== id);
    this.host.session.world.removeStaticsOfProp(TUBE_PROP_BASE + id);
    this.host.session.registerShapes();
  }

  /** Everything built taken away (the menu's Clear the sky): just the respawn cloud left. */
  clearSky(): void {
    if (this.placing) this.endPlacing(false);
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
    return !this.tubes.riding(cat);
  }

  /** A cat can be carried anywhere up here. */
  carryBox(): { x0: number; x1: number; y0: number; y1: number } {
    return { x0: -1e6, x1: 1e6, y0: -1e6, y1: 1e6 };
  }

  /** Let go by a tube's mouth: in it goes. */
  released(cat: Cat): void {
    if (!this.active) return;
    const b = cat.body;
    b.computeCentroid();
    for (const t of this.skyTubes) {
      const m = mouthOf(t, b.cx, b.cy);
      if (m !== null) {
        this.ride(cat, t, m);
        return;
      }
    }
  }

  private ride(cat: Cat, t: SkyTube, mouth: 0 | 1): void {
    // (in at b, its lower mouth, is "up" the way the house's tubes go)
    this.tubes.start(cat, t, mouth === 1);
  }

  /** One physics step: the springy pieces, the tubes, cats put in a tube's mouth or falling into the sea. */
  step(): void {
    if (!this.active) return;
    this.frame++;
    const s = this.host.session;
    this.stepLive();
    this.tubes.step();
    // (out of a tube: a moment before a mouth can have it again. Its own is
    // right there: without that, it'd go straight back in, and back and forth)
    for (const e of this.tubes.drain()) {
      const v = BREEDS[e.cat.breed].voice;
      if (e.t === 'in') this.host.audio.glorp(v.pitch * 1.1, 0.4, 0.1);
      else {
        e.cat.sinceTouch = 0;
        e.cat.settled = 0;
        e.cat.intent = null;
        this.host.audio.boop(v.pitch);
        this.host.renderer.puff(e.x, e.y + e.cat.body.p.radius, 5);
        this.cooldown.set(e.cat, 45);
      }
    }
    const sea = this.seaY;
    for (const c of s.cats) {
      if (c.grabbed || this.tubes.riding(c)) continue;
      const b = c.body;
      b.computeCentroid();
      if (b.cy > sea) {
        this.respawn(c);
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
  }

  /** Hammocks take the weight of who's in them; bouncy cushions spring a cat that lands on them back up, boing. */
  private stepLive(): void {
    const s = this.host.session;
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
          const c = catOf(hit.body);
          this.host.audio.boing(hit.speed, c ? clamp((c.body.p.radius - 22) / 20, 0, 1) : 0);
          if (c) {
            c.settled = 0;
            c.intent = null;
          }
        }
      }
    }
    for (const b of bodies) this.fellAt.set(b, b.vcy);
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

  /** Something in the way of a cat coming out of a tube: it waits, and whoever's there is shooed off. */
  private inTheWay(cat: Cat, out: Float64Array): boolean {
    const s = this.host.session;
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

// ---------------------------------------------------------------------------

type Rect = { x0: number; y0: number; x1: number; y1: number };

const overlaps = (b: Box, r: Rect, pad = 0): boolean => b.x1 + pad > r.x0 && b.x0 - pad < r.x1 && b.y1 + pad > r.y0 && b.y0 - pad < r.y1;

/** Which way (and how hard, 0..1) a finger at the screen's edge pushes the view. */
function edgePush(x: number, y: number, W: number, H: number, top: number, bottom: number): { x: number; y: number } {
  const ex = x < EDGE ? -(EDGE - x) / EDGE : x > W - EDGE ? (x - (W - EDGE)) / EDGE : 0;
  const t0 = top + EDGE;
  const b0 = H - bottom - EDGE * 0.8;
  const ey = y < t0 ? -(t0 - y) / EDGE : y > b0 ? (y - b0) / EDGE : 0;
  return { x: clamp(ex, -1, 1), y: clamp(ey, -1, 1) };
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

