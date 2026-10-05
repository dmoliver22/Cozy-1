// Cat Drop: the view. A camera that follows the falling cat (about a third of
// the way down the screen, leading a little when it falls fast), the house
// painted storey by storey into cached canvases a few frames ahead of the
// camera (blitted 1:1 on device pixels), and the live layers in between:
// cushions, fish, the cat, glass fronts, the bath foam, drizzle and effects.
// At the end of a run the camera stops, bath time's foam fills the screen and,
// under it, the house gives way to the bath (bath.ts): the foam clears, and the
// cat drops into the tub.

import { glint, softShadow, type Ctx } from '../../render/paint';
import { clipRect } from '../../render/roomKit';
import { drawCat, type CatPose, type CatView, type Expression } from '../../render/catArt';
import type { SoftBody } from '../../physics/softbody';
import { CatPainter, Lerp, type Stage } from '../kit';
import { FISH_LEN, SIDE, drawCushion, fishSprite, frontRect, hasFront, paintChunkBack, paintChunkFront, paintFrame, paintGrain, paintRoom } from './art';
import { BathScene, bathFraming, tubLayout, type BathEvent } from './bath';
import { bathroom, drawSteam, drawSudsBand, drawWater, paintBathroom, paintTubBack, paintTubFront, tubFrontSpan, zoomAbout, type Chin } from './bathArt';
import { Fx } from './fx';
import type { DropGame } from './game';
import { drawDrops, drawSuds, prepareFoam } from './foam';
import { SHAFT_W, type Chunk, type Storey } from './level';
import { drawSoaked, wetBreed, withBreed } from './soaked';
import { Suds } from './suds';

/** The end of a run: none yet, bath time's foam filling the screen, or the bath. */
export type EndStage = 'none' | 'fill' | 'bath';

/** Visible world height we aim for (the shaft fills the width on phones). */
const MIN_VIEW_H = 700;
/** Margin painted beyond the cut side walls. */
const PADX = 2;
/** Largest cache resolution (device px per world unit). */
const MAX_PPU = 2.6;
/** Where the end card's bottom edge is, roughly (css px from the top of the screen). */
const CARD_BOTTOM = 250;

let lastName = '';
function named(name: string, fn: () => void): () => void {
  return () => {
    lastName = name;
    fn();
  };
}

let flushCtx: Ctx | null = null;

/** Rasterize a canvas's pending drawing now (drawing it anywhere does). */
function flush(c: HTMLCanvasElement): void {
  if (!flushCtx) {
    const f = document.createElement('canvas');
    f.width = f.height = 1;
    flushCtx = f.getContext('2d')!;
  }
  flushCtx.drawImage(c, 0, 0, 1, 1, 0, 0, 1, 1);
}

interface Layer {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
  /** Device row of the canvas's top, in world-device space (y * ppu). */
  row: number;
  y0: number;
  y1: number;
  tasks: (() => void)[];
}

export class DropView {
  /** Debug: durations of cache painting tasks (ms), when set to an array. */
  static taskLog: number[] | null = null;
  static taskNames: string[] | null = null;
  readonly ctx: Ctx;
  readonly painter = new CatPainter();
  readonly lerp = new Lerp();
  readonly fx = new Fx();
  /** CSS px per world unit, and the css x of world x = 0. */
  scale = 1;
  ox = 0;
  /** Device px per world unit (live drawing), and for the caches. */
  ppu = 1;
  cachePpu = 1;
  viewH = 800;
  camY = 0;
  private camV = 0;
  private camInit = false;
  time = 0;
  private storeys = new Map<number, Layer>();
  private fronts = new Map<number, Layer>();
  private key = '';
  /** World->device x offset (pixel aligned for the cached layers) and the camera row. */
  private oxDev = 0;
  private camRow = 0;
  /** Shake (world units) from bumps, decaying. */
  shake = 0;
  /** Bath time's foam: bubbles, drops and spray, simulated every physics frame. */
  readonly suds = new Suds();
  /** Debug: draw the foam (off to measure what it costs). */
  showSuds = true;
  /** The end of the run, and the bath it ends in (with what happens there, for sounds and the card). */
  ending: EndStage = 'none';
  bath: BathScene | null = null;
  readonly bathEvents: BathEvent[] = [];
  /** How much of the screen the foam covers, 0..1 (as of the last physics frame). */
  cover = 0;
  /** The top of the screen when the bath came into view (the camera stays put). */
  private sceneTop = 0;
  /**
   * How close the bath is framed: the tub and the cat in it are drawn zoomed in
   * this much about the bottom middle of the screen (the clearing foam isn't),
   * as device px per world unit and offsets, like the world's.
   */
  bathZoom = 1;
  private bPpu = 1;
  private bEx = 0;
  private bEy = 0;
  /**
   * The bathroom (painted ahead, while there is time to spare) and the tub
   * (once bath time has the cat, sized for it), in screen-relative coordinates.
   */
  private bathRoom: { key: string; layer: Layer } | null = null;
  private bathTub: { key: string; back: Layer; front: Layer } | null = null;
  private bathSeeded = false;
  /** When the cat in the bath drips next (its seconds), and off which cheek. */
  private nextDrip = 0;
  private dripSide = 1;

  constructor(readonly stage: Stage) {
    this.ctx = stage.ctx;
    this.layout();
  }

  layout(): void {
    const { w, h, dpr } = this.stage;
    this.scale = Math.min(w / (SHAFT_W + SIDE * 2), h / MIN_VIEW_H);
    this.ox = (w - SHAFT_W * this.scale) / 2;
    this.ppu = this.scale * dpr;
    this.cachePpu = Math.min(this.ppu, MAX_PPU);
    this.viewH = h / this.scale;
    prepareFoam(this.ppu);
    const key = `${w}x${h}@${dpr}`;
    if (key !== this.key) {
      this.key = key;
      this.storeys.clear();
      this.fronts.clear();
    }
    // (the bath stands at the bottom of the screen, framed for it)
    if (this.bath) {
      const f = this.framing(this.bath.radius);
      this.bathZoom = f.tub;
      this.suds.shiftBath(this.bath.relayout(this.viewH, f.tub, f.floorGap));
    }
  }

  /** How close to frame the bath for a cat of radius `r` (with the end card up top). */
  private framing(r: number): { room: number; tub: number; floorGap: number } {
    return bathFraming(this.viewH, CARD_BOTTOM / this.scale, r);
  }

  /** A new run: forget the old house (and the old bath). */
  reset(game: DropGame): void {
    this.storeys.clear();
    this.fronts.clear();
    this.fx.clear();
    this.camInit = false;
    this.lerp.forget(game.cat);
    this.suds.reset(game);
    if (this.bath?.cat) {
      this.lerp.forget(this.bath.cat);
      this.painter.forget(this.bath.cat);
    }
    this.ending = 'none';
    this.bath = null;
    this.bathZoom = 1;
    this.bathEvents.length = 0;
    this.cover = 0;
    this.bathSeeded = false;
    this.nextDrip = 0;
  }

  screenToWorldX(px: number): number {
    return (px - this.ox) / this.scale;
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.ox + x * this.scale, y: (y - this.camY) * this.scale };
  }

  /** Remember positions before a physics step (for drawing between steps). */
  beforeStep(game: DropGame): void {
    this.lerp.remember(this.bodies(game));
  }

  private bodies(game: DropGame): SoftBody[] {
    const c = this.bath?.cat;
    return c ? [game.cat, c] : [game.cat];
  }

  /**
   * After a physics step: the foam follows (it reads the game, never changes
   * it). Once bath time has the cat, its foam fills the screen; under the full
   * foam the house gives way to the bath, which goes on from there.
   */
  afterStep(game: DropGame): void {
    if (this.ending === 'none' && (game.phase === 'soak' || game.phase === 'over')) this.ending = 'fill';
    if (this.ending !== 'bath') {
      this.suds.step(game, this.camY, this.viewH);
      this.cover = this.suds.cover(this.camY, this.viewH);
      if (this.ending === 'fill' && game.phase === 'over' && this.cover >= 0.999) this.toBath(game);
      return;
    }
    const b = this.bath!;
    // (how far the foam has cleared, in the bath's own framing)
    const ay = this.sceneTop + this.viewH;
    b.clearedTo = this.suds.mode === 'clear' && this.suds.floodA > 0 ? ay + (this.suds.floodTop - ay) / this.bathZoom : Infinity;
    b.step();
    for (const e of b.events) {
      if (e.t === 'splash') this.suds.splashAt(e.x, e.y, e.speed, e.size);
      // a drop from the tap
      else if (e.t === 'plink') this.suds.drop(e.x, b.tub.tapY + 1.5, 0, 25);
      this.bathEvents.push(e);
    }
    b.events.length = 0;
    // and now and then one off the soaked cat's cheeks
    const c = b.cat;
    if (c && b.readyT >= 0 && b.t > this.nextDrip) {
      const v = this.painter.view(c);
      const side = (this.dripSide = -this.dripSide);
      this.suds.drop(v.fx + side * c.p.radius * 0.45, v.fy + 7 * v.fs, side * 6, 10);
      this.nextDrip = b.t + 0.9 + ((b.t * 7.3) % 1) * 1.1;
    }
    this.suds.stepEnd(this.camY, this.viewH);
    this.cover = this.suds.cover(this.camY, this.viewH);
  }

  /** Under the full foam: the bath (the camera stays where it is), and the foam starts clearing. */
  private toBath(game: DropGame): void {
    this.ending = 'bath';
    this.sceneTop = this.camY;
    this.camV = 0;
    const f = this.framing(game.cat.p.radius);
    this.bathZoom = f.tub;
    const b = new BathScene(game.breed, game.cat.p.radius, this.camY, this.viewH, game.seed, f.tub, f.floorGap);
    this.bath = b;
    this.suds.beginClear(this.camY, this.viewH, b);
    this.bathEvents.push({ t: 'clear' });
    this.paintBath(true, b.radius);
  }

  // --- Camera ------------------------------------------------------------------

  /** Debug: hold the camera's top at this world y (null: follow the cat). */
  lookAt: number | null = null;

  private follow(game: DropGame, catY: number, dt: number): void {
    const c = game.cat;
    if (this.lookAt !== null) {
      this.camY = this.lookAt;
      this.camV = 0;
      this.camInit = true;
      return;
    }
    // in the bath, the camera holds still
    if (this.ending === 'bath') {
      this.camY = this.sceneTop;
      this.camV = 0;
      return;
    }
    // bath time has the cat: the camera stops (easing out of its last move)
    if (this.camInit && (game.phase === 'soak' || game.phase === 'over')) {
      this.camV *= Math.exp(-dt * 14);
      this.camY += this.camV * dt;
      return;
    }
    const lead = Math.max(-260, Math.min(900, c.vcy)) * 0.2;
    let target = catY - this.viewH * 0.34 + lead;
    const top = game.level.storeys[0]?.top ?? -Infinity;
    if (game.level.storeys[0]?.index === 0) target = Math.max(target, top);
    if (!this.camInit || dt <= 0) {
      if (!this.camInit) {
        this.camY = target;
        this.camV = 0;
        this.camInit = true;
      }
      return;
    }
    // critically damped spring: smooth, no overshoot
    const w = 6.5;
    const a = w * w * (target - this.camY) - 2 * w * this.camV;
    this.camV += a * dt;
    this.camY += this.camV * dt;
    // never let the cat leave the screen
    const r = c.p.radius;
    if (catY + r > this.camY + this.viewH - 30) this.camY = catY + r - this.viewH + 30;
    if (catY - r < this.camY + 20) this.camY = catY - r - 20;
  }

  // --- Cached layers -------------------------------------------------------------

  private layerFor(map: Map<number, Layer>, id: number, y0: number, y1: number, make: (l: Layer) => (() => void)[]): Layer {
    let l = map.get(id);
    if (l) return l;
    l = this.newLayer(y0, y1, make);
    map.set(id, l);
    return l;
  }

  private newLayer(y0: number, y1: number, make: (l: Layer) => (() => void)[]): Layer {
    const ppu = this.cachePpu;
    const row = Math.floor(y0 * ppu);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((SHAFT_W + (SIDE + PADX) * 2) * ppu);
    canvas.height = Math.max(1, Math.ceil(y1 * ppu) - row);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(ppu, 0, 0, ppu, (SIDE + PADX) * ppu, -row);
    const l: Layer = { canvas, ctx, row, y0, y1, tasks: [] };
    l.tasks = make(l);
    return l;
  }

  /**
   * The bathroom and the tub, painted into their own layers (relative to the
   * top of the screen, so they only depend on its size, and the tub on the
   * cat's): a task at a time while there is time to spare, or all at once
   * when the bath is needed now. `r`: the cat's size, once it is known.
   */
  private paintBath(now: boolean, r: number | null, budgetMs = 0, t0 = 0): void {
    if (!this.bathRoom || this.bathRoom.key !== this.key) {
      // (framed for a middling cat: the room is painted before the cat's size is known)
      const zoom = this.framing(40).room;
      const s = bathroom(tubLayout(0, this.viewH, 40), this.viewH, 77, CARD_BOTTOM / this.scale, zoom);
      const css = this.scale;
      const layer = this.newLayer(-10, this.viewH + 10, (l) => [named('bath room', () => paintBathroom(l.ctx, s, 'shell', css)), named('bath decor', () => paintBathroom(l.ctx, s, 'decor', css))]);
      this.bathRoom = { key: this.key, layer };
    }
    const layers = [this.bathRoom.layer];
    if (r !== null) {
      const key = `${this.key}|${r.toFixed(2)}`;
      if (!this.bathTub || this.bathTub.key !== key) {
        // the tub, framed close for this cat (zoomed in about the bottom middle of the screen)
        const f = this.framing(r);
        const L = tubLayout(0, this.viewH, r, f.floorGap);
        const span = tubFrontSpan(L);
        const ay = this.viewH;
        const sy = (y: number): number => ay + f.tub * (y - ay);
        const zoomed = (g: Ctx, paint: () => void): void => {
          g.save();
          zoomAbout(g, SHAFT_W / 2, ay, f.tub);
          paint();
          g.restore();
        };
        const back = this.newLayer(sy(span.y0 - 70), sy(span.y1), (l) => [named('tub back', () => zoomed(l.ctx, () => paintTubBack(l.ctx, L)))]);
        const front = this.newLayer(sy(span.y0), sy(span.y1), (l) => [named('tub front', () => zoomed(l.ctx, () => paintTubFront(l.ctx, L)))]);
        this.bathTub = { key, back, front };
      }
      layers.push(this.bathTub.back, this.bathTub.front);
    }
    // (ahead of time, one task a frame at most)
    for (const l of layers)
      while (l.tasks.length && (now || performance.now() - t0 < budgetMs)) {
        const ts = performance.now();
        l.tasks.shift()!();
        flush(l.canvas);
        DropView.taskLog?.push(performance.now() - ts);
        DropView.taskNames?.push(lastName);
        if (!now) return;
      }
  }

  private storeyLayer(s: Storey): Layer {
    return this.layerFor(this.storeys, s.index, s.top, s.bottom, (l) => {
      const g = l.ctx;
      const css = this.scale;
      return [
        named('room', () => paintRoom(g, s, 'shell')),
        named('decor', () => paintRoom(g, s, 'decor')),
        ...s.chunks.map((c) => named(c.kind, () => paintChunkBack(g, c, s))),
        named('frame', () => {
          paintFrame(g, s.top, s.bottom);
          paintGrain(g, -SIDE - PADX, s.top, SHAFT_W + SIDE + PADX, s.bottom, css);
        }),
      ];
    });
  }

  private frontLayer(c: Chunk): Layer {
    const b = frontRect(c);
    return this.layerFor(this.fronts, c.id, b.y0, b.y1, (l) => [named('front', () => paintChunkFront(l.ctx, c))]);
  }

  /** Paint ahead of the camera, a little each frame; anything on screen is finished first. */
  private pump(game: DropGame, budgetMs: number): void {
    const y0 = this.camY - 60;
    const y1 = this.camY + this.viewH + 60;
    const ahead = this.camY + this.viewH + 1400;
    const t0 = performance.now();
    const work: { l: Layer; urgent: boolean }[] = [];
    const keep = this.camY - 600;
    for (const s of game.level.storeys) {
      if (s.bottom < keep || s.top > ahead) continue;
      const l = this.storeyLayer(s);
      if (l.tasks.length) work.push({ l, urgent: s.bottom > y0 && s.top < y1 });
      for (const c of s.chunks) {
        if (!hasFront(c) || frontRect(c).y1 < keep) continue;
        const f = this.frontLayer(c);
        if (f.tasks.length) work.push({ l: f, urgent: f.y1 > y0 && f.y0 < y1 });
      }
    }
    work.sort((a, b) => a.l.y0 - b.l.y0);
    // (once bath time has the cat, the house below won't be needed: only what is on screen)
    const ending = this.ending !== 'none';
    let left = false;
    for (const w of work) {
      while (w.l.tasks.length && (w.urgent || (!ending && performance.now() - t0 < budgetMs))) {
        const ts = performance.now();
        w.l.tasks.shift()!();
        // canvases paint lazily: make this one do its work now, inside the budget,
        // not on the first frame it is shown
        flush(w.l.canvas);
        DropView.taskLog?.push(performance.now() - ts);
        DropView.taskNames?.push(lastName);
      }
      if (w.l.tasks.length && !ending) left = true;
    }
    // with nothing else to paint, while the cat waits on its perch (or once bath time has
    // it), the bath it will end in
    if (!left && (game.phase === 'ready' || this.ending === 'fill')) this.paintBath(false, this.ending === 'fill' ? game.cat.p.radius : null, budgetMs, t0);
    // drop what is far above
    for (const [k, l] of this.storeys) if (l.y1 < keep) this.storeys.delete(k);
    for (const [k, l] of this.fronts) if (l.y1 < keep) this.fronts.delete(k);
  }

  /** A layer painted relative to the top of the screen, at the bath's place. */
  private blitScene(l: Layer): void {
    const ctx = this.ctx;
    const off = Math.round(this.sceneTop * this.ppu) - this.camRow;
    if (this.cachePpu === this.ppu) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(l.canvas, Math.round(this.oxDev - (SIDE + PADX) * this.ppu), l.row + off);
    } else {
      const k = this.ppu / this.cachePpu;
      ctx.setTransform(k, 0, 0, k, this.oxDev - (SIDE + PADX) * this.ppu, l.row * k + off);
      ctx.drawImage(l.canvas, 0, 0);
    }
  }

  private blit(l: Layer): void {
    const ctx = this.ctx;
    if (l.y1 < this.camY - 4 || l.y0 > this.camY + this.viewH + 4) return;
    if (this.cachePpu === this.ppu) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(l.canvas, Math.round(this.oxDev - (SIDE + PADX) * this.ppu), l.row - this.camRow);
    } else {
      const k = this.ppu / this.cachePpu;
      ctx.setTransform(k, 0, 0, k, this.oxDev - (SIDE + PADX) * this.ppu, l.row * k - this.camRow);
      ctx.drawImage(l.canvas, 0, 0);
    }
  }

  /** World transform for live drawing. */
  private world(): void {
    this.ctx.setTransform(this.ppu, 0, 0, this.ppu, this.oxDev, -this.camRow + this.shakeOffset());
  }

  /** The bath's transform for live drawing: the world, framed close (see bathZoom). */
  private bathWorld(): void {
    this.ctx.setTransform(this.bPpu, 0, 0, this.bPpu, this.bEx, this.bEy);
  }

  /** Where a point in the bath shows on screen (css px), framed close. */
  bathToScreen(x: number, y: number): { x: number; y: number } {
    const z = this.bathZoom;
    const ay = this.sceneTop + this.viewH;
    return { x: this.ox + (SHAFT_W / 2 + z * (x - SHAFT_W / 2)) * this.scale, y: (ay + z * (y - ay) - this.camY) * this.scale };
  }

  private shakeOffset(): number {
    return this.shake > 0.05 ? Math.sin(this.time * 70) * this.shake * this.ppu : 0;
  }

  // --- Frame -------------------------------------------------------------------

  render(game: DropGame, alpha: number, dt: number): void {
    this.time += dt;
    const { stage, ctx } = this;
    if (this.key !== `${stage.w}x${stage.h}@${stage.dpr}`) this.layout();
    const cat = game.cat;
    // positions between physics steps
    const bodies = this.bodies(game);
    this.lerp.begin(bodies, alpha);
    cat.computeCentroid();
    const catY = cat.cy;
    const catX = cat.cx;
    this.follow(game, catY, dt);
    this.shake = Math.max(0, this.shake - dt * 6);
    // pixel-aligned origin for the cached layers
    const originPx = Math.round(this.ox * stage.dpr - (SIDE + PADX) * this.ppu);
    this.oxDev = originPx + (SIDE + PADX) * this.ppu;
    this.camRow = Math.round(this.camY * this.ppu);
    // (the bath, framed close: zoomed in about the bottom middle of the screen)
    const z = this.bathZoom;
    this.bPpu = this.ppu * z;
    this.bEx = this.oxDev + this.ppu * (SHAFT_W / 2) * (1 - z);
    this.bEy = this.ppu * (this.sceneTop + this.viewH) * (1 - z) - this.camRow;
    this.pump(game, 6);
    this.painter.tick(dt);

    // backdrop beyond the house
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#3E3A4F';
    const left = Math.round(this.oxDev - (SIDE + PADX) * this.ppu);
    const right = Math.round(this.oxDev + (SHAFT_W + SIDE + PADX) * this.ppu);
    if (left > 0) ctx.fillRect(0, 0, left, stage.canvas.height);
    if (right < stage.canvas.width) ctx.fillRect(right, 0, stage.canvas.width - right, stage.canvas.height);
    const ey = -this.camRow + this.shakeOffset();
    // the bath at the end of the run, or the house (unless the foam hides all of it): only
    // what the foam's solid flood doesn't cover
    const sd = this.suds;
    const y0 = sd.mode === 'fill' && sd.floodA >= 1 ? Math.max(this.camY - 4, sd.floodBot - 1) : this.camY - 4;
    const y1 = sd.mode === 'clear' && sd.floodA > 0 ? Math.min(this.camY + this.viewH + 4, sd.solidTop() + 1) : this.camY + this.viewH + 4;
    // (the bath, framed close, stays inside the house)
    const inBath = this.ending === 'bath';
    if (inBath) {
      ctx.save();
      this.world();
      clipRect(ctx, -SIDE - PADX, this.camY - 4, SHAFT_W + (SIDE + PADX) * 2, this.viewH + 8);
    }
    if (y1 > y0) {
      const clip = y0 > this.camY - 4 || y1 < this.camY + this.viewH + 4;
      if (clip) {
        ctx.save();
        this.world();
        clipRect(ctx, -SIDE - PADX - 2, y0, SHAFT_W + (SIDE + PADX) * 2 + 4, y1 - y0);
      }
      if (this.ending === 'bath') this.drawBath(game, alpha);
      else this.drawHouse(game, alpha, catX, catY, ey);
      if (clip) ctx.restore();
    }
    if (this.ending === 'bath') {
      // the bath's own loose bubbles, drops and spray, then the foam clearing off the screen
      // over it all (as it was when it filled the screen: not framed close)
      const zt = this.sceneTop + this.viewH - this.viewH / this.bathZoom;
      if (this.showSuds) {
        drawSuds(ctx, this.suds, alpha, this.bPpu, this.bEx, this.bEy, zt, this.viewH / this.bathZoom, 1, 1);
        drawDrops(ctx, this.suds, this.bPpu, this.bEx, this.bEy, 1);
        drawSuds(ctx, this.suds, alpha, this.ppu, this.oxDev, ey, this.camY, this.viewH, 1, 0);
        drawDrops(ctx, this.suds, this.ppu, this.oxDev, ey, 0);
      }
      this.bathWorld();
    } else {
      // foam passing in front of the geometry (and filling the screen), then drops and spray
      if (this.showSuds) {
        drawSuds(ctx, this.suds, alpha, this.ppu, this.oxDev, ey, this.camY, this.viewH, 1);
        drawDrops(ctx, this.suds, this.ppu, this.oxDev, ey);
      }
      this.world();
    }
    this.fx.update(dt);
    this.fx.draw(ctx);
    if (inBath) ctx.restore();
    this.lerp.end();
  }

  /** The house: its storeys (cached), cushions, fish, the cat, the foam in the room, and the glass. */
  private drawHouse(game: DropGame, alpha: number, catX: number, catY: number, ey: number): void {
    const ctx = this.ctx;
    const cat = game.cat;
    let covered = false;
    for (const s of game.level.storeys) {
      const l = this.storeys.get(s.index);
      if (!l || l.tasks.length) {
        if (s.bottom > this.camY && s.top < this.camY + this.viewH) {
          this.world();
          ctx.fillStyle = '#F4E6D2';
          ctx.fillRect(-SIDE, s.top, SHAFT_W + SIDE * 2, s.bottom - s.top);
        }
        continue;
      }
      this.blit(l);
      covered = true;
    }
    if (!covered) {
      this.world();
      ctx.fillStyle = '#F4E6D2';
      ctx.fillRect(-SIDE, this.camY, SHAFT_W + SIDE * 2, this.viewH);
    }
    this.world();
    const vy0 = this.camY - 80;
    const vy1 = this.camY + this.viewH + 80;
    const chunks = game.level.chunks.filter((c) => c.y1 > vy0 && c.y0 < vy1);
    // cushions and fish
    for (const c of chunks) for (const k of c.cushions) drawCushion(ctx, k, this.ppu);
    for (const c of chunks) for (const f of c.fish) if (!f.eaten) this.drawFish(ctx, f.x, f.y, f.golden, f.dir, f.phase);
    // the cat, with its soft shadow on the wall behind (soaked after bath time)
    const r = cat.p.radius;
    softShadow(ctx, catX + 10, catY + 13, r * 1.05, r * 0.92, 0.12);
    if (game.soaked) withBreed(cat, wetBreed(cat.breed), () => this.painter.draw(ctx, cat, this.pose(game)));
    else this.painter.draw(ctx, cat, this.pose(game));
    // bath time's bubbles, over the cat (and under the glass, when they are in a tube)
    if (this.showSuds) drawSuds(ctx, this.suds, alpha, this.ppu, this.oxDev, ey, this.camY, this.viewH, 0);
    // glass over the cat
    for (const c of chunks) {
      const f = this.fronts.get(c.id);
      if (f && !f.tasks.length) this.blit(f);
    }
  }

  /**
   * The bath: the bathroom and the back of the tub, the water and the suds
   * behind the cat, the cat (soaked, its lower half under the suds), the heap
   * of suds in front of it with bubbles floating on them, the tub's porcelain
   * front, the cat's paws over the rim, and the steam.
   */
  private drawBath(game: DropGame, alpha: number): void {
    const b = this.bath!;
    const ctx = this.ctx;
    this.paintBath(true, b.radius);
    const tub = this.bathTub!;
    this.blitScene(this.bathRoom!.layer);
    this.blitScene(tub.back);
    this.bathWorld();
    const ppu = this.bPpu;
    drawWater(ctx, b);
    drawSudsBand(ctx, b, false, ppu, null);
    const c = b.cat;
    let chin: Chin | null = null;
    let pose: CatPose | null = null;
    let view: CatView | null = null;
    if (c) {
      pose = this.bathPose(b);
      view = this.bathView(game, c);
      const v = view;
      const p = pose;
      withBreed(c, wetBreed(c.breed), () => drawCat(ctx, c, v, p, 1, 'body'));
      drawSoaked(ctx, c, v, this.time, ppu);
      chin = { x: v.fx, halfW: c.p.radius * 0.85, y: v.fy + 8 * v.fs };
    }
    drawSudsBand(ctx, b, true, ppu, chin);
    const zt = this.sceneTop + this.viewH - this.viewH / this.bathZoom;
    if (this.showSuds) drawSuds(ctx, this.suds, alpha, ppu, this.bEx, this.bEy, zt, this.viewH / this.bathZoom, 0, 1);
    this.blitScene(tub.front);
    this.bathWorld();
    if (c && pose && view) {
      const v = view;
      const p = pose;
      withBreed(c, wetBreed(c.breed), () => drawCat(ctx, c, v, p, 1, 'over'));
    }
    drawSteam(ctx, b);
  }

  /** The bath cat's face: wide-eyed as it drops, screwed up at the splash, then resigned and half asleep. */
  private bathPose(b: BathScene): CatPose {
    const L = b.tub;
    const inBath = b.splashT >= 0;
    const since = inBath ? b.t - b.splashT : -1;
    const expression: Expression = !inBath ? 'wide' : since < 0.45 ? 'squint' : 'sleepy';
    return {
      expression,
      look: 0,
      rim: inBath ? { x0: L.x0 + 4, x1: L.x1 - 4, y: L.rimY + 3, lip: 8 } : null,
      seated: inBath && since > 0.5,
      resting: false,
      purr: b.purring ? 0.7 : 0,
      grabbed: false,
      glow: 0,
    };
  }

  /** The bath cat's painted view: the same markings as the cat that fell. */
  private bathView(game: DropGame, c: SoftBody): CatView {
    const v = this.painter.view(c);
    if (!this.bathSeeded) {
      this.bathSeeded = true;
      const g = this.painter.view(game.cat);
      v.seed = g.seed;
      v.side = g.side;
    }
    return v;
  }

  /**
   * How near bath time is, 0 (far off) .. 1 (right over the cat): more drizzle
   * and more bubbles drift into view as it comes.
   */
  nearness(game: DropGame): number {
    if (game.phase !== 'play') return game.phase === 'ready' ? 0 : 1;
    return Math.max(0, Math.min(1, 1 - (game.bathGap - 60) / 700));
  }

  private pose(game: DropGame): { expression: Expression; look: number; resting: boolean; purr: number; grabbed: boolean } {
    const c = game.cat;
    let expression: Expression = 'open';
    const resting = c.airborneFrames < 3 && Math.abs(c.vcx) < 60 && Math.abs(c.vcy) < 60;
    const bath = game.phase === 'soak' || game.phase === 'over';
    if (bath) {
      // swallowed by the foam: wide-eyed, then eyes screwed shut
      expression = !game.soaked ? 'wide' : 'squint';
      return { expression, look: 0, resting: false, purr: 0, grabbed: game.soaked };
    }
    if (game.phase === 'ready') expression = 'sleepy';
    else if (game.sinceNom < 45) expression = 'happy';
    else if (game.sinceBoing < 24 || game.sinceHop < 18) expression = 'squint';
    // worried eyes when bath time is close (or on a long fast fall)
    else if (game.phase === 'play' && game.time > 1 && game.bathGap < 230) expression = 'wide';
    else if (c.airborneFrames > 6 && c.vcy > 360) expression = 'wide';
    else if (resting) expression = 'content';
    const look = game.steerX === null ? 0 : Math.max(-1, Math.min(1, (game.steerX - c.cx) / 90));
    return { expression, look, resting, purr: game.phase === 'ready' ? 0.6 : 0, grabbed: false };
  }

  private drawFish(ctx: Ctx, x: number, y: number, golden: boolean, dir: number, t: number): void {
    const { c, w, h } = fishSprite(golden, this.ppu * 1.3);
    const bob = Math.sin(t * 2.6) * 3;
    const wig = Math.sin(t * 7) * 0.08;
    // a soft halo so fish read against busy walls
    const R = FISH_LEN * 1.15;
    const g = ctx.createRadialGradient(x, y + bob, 2, x, y + bob, R);
    g.addColorStop(0, golden ? 'rgba(255,232,160,0.75)' : 'rgba(255,253,246,0.72)');
    g.addColorStop(0.5, golden ? 'rgba(255,232,160,0.3)' : 'rgba(255,253,246,0.28)');
    g.addColorStop(1, 'rgba(255,253,246,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - R, y + bob - R, R * 2, R * 2);
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(wig);
    ctx.scale(dir * 1.3, 1.3);
    ctx.drawImage(c, -w / 2, -h / 2, w, h);
    ctx.restore();
    if (golden) glint(ctx, x + Math.sin(t * 3) * 8, y + bob - 6, 1.2, 0.6 + 0.4 * Math.sin(t * 5));
  }

  /** Where effects for the cat's head go (last drawn frame). */
  head(game: DropGame): { x: number; y: number } {
    return this.painter.head(game.cat);
  }
}
