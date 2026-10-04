// Cat Drop: the view. A camera that follows the falling cat (about a third of
// the way down the screen, leading a little when it falls fast), the house
// painted storey by storey into cached canvases a few frames ahead of the
// camera (blitted 1:1 on device pixels), and the live layers in between:
// cushions, fish, the cat, glass fronts, the bath foam, drizzle and effects.

import { glint, softShadow, type Ctx } from '../../render/paint';
import type { Expression } from '../../render/catArt';
import { CatPainter, Lerp, type Stage } from '../kit';
import { FISH_LEN, SIDE, drawCushion, fishSprite, frontRect, hasFront, paintChunkBack, paintChunkFront, paintFrame, paintGrain, paintRoom } from './art';
import { Fx } from './fx';
import type { DropGame } from './game';
import { drawDrops, drawSuds, prepareFoam } from './foam';
import { SHAFT_W, type Chunk, type Storey } from './level';
import { drawSoaked, wetBreed, withBreed } from './soaked';
import { Suds } from './suds';

/** Visible world height we aim for (the shaft fills the width on phones). */
const MIN_VIEW_H = 700;
/** Margin painted beyond the cut side walls. */
const PADX = 2;
/** Largest cache resolution (device px per world unit). */
const MAX_PPU = 2.6;

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
  }

  /** A new run: forget the old house. */
  reset(game: DropGame): void {
    this.storeys.clear();
    this.fronts.clear();
    this.fx.clear();
    this.camInit = false;
    this.lerp.forget(game.cat);
    this.suds.reset(game);
  }

  screenToWorldX(px: number): number {
    return (px - this.ox) / this.scale;
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.ox + x * this.scale, y: (y - this.camY) * this.scale };
  }

  /** Remember positions before a physics step (for drawing between steps). */
  beforeStep(game: DropGame): void {
    this.lerp.remember([game.cat]);
  }

  /** After a physics step: the foam follows (it reads the game, never changes it). */
  afterStep(game: DropGame): void {
    this.suds.step(game, this.camY, this.viewH);
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
    // bath time: ease the soggy cat to just under the foam, clear of the end card below
    if (this.camInit && (game.phase === 'soak' || game.phase === 'over')) {
      const w = 3.2;
      const a = w * w * (catY - this.viewH * 0.4 - this.camY) - 2 * w * this.camV;
      this.camV += a * dt;
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
    const ppu = this.cachePpu;
    const row = Math.floor(y0 * ppu);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((SHAFT_W + (SIDE + PADX) * 2) * ppu);
    canvas.height = Math.max(1, Math.ceil(y1 * ppu) - row);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(ppu, 0, 0, ppu, (SIDE + PADX) * ppu, -row);
    l = { canvas, ctx, row, y0, y1, tasks: [] };
    l.tasks = make(l);
    map.set(id, l);
    return l;
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
    for (const w of work) {
      while (w.l.tasks.length && (w.urgent || performance.now() - t0 < budgetMs)) {
        const ts = performance.now();
        w.l.tasks.shift()!();
        // canvases paint lazily: make this one do its work now, inside the budget,
        // not on the first frame it is shown
        flush(w.l.canvas);
        DropView.taskLog?.push(performance.now() - ts);
        DropView.taskNames?.push(lastName);
      }
    }
    // drop what is far above
    for (const [k, l] of this.storeys) if (l.y1 < keep) this.storeys.delete(k);
    for (const [k, l] of this.fronts) if (l.y1 < keep) this.fronts.delete(k);
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
    this.lerp.begin([cat], alpha);
    cat.computeCentroid();
    const catY = cat.cy;
    const catX = cat.cx;
    this.follow(game, catY, dt);
    this.shake = Math.max(0, this.shake - dt * 6);
    // pixel-aligned origin for the cached layers
    const originPx = Math.round(this.ox * stage.dpr - (SIDE + PADX) * this.ppu);
    this.oxDev = originPx + (SIDE + PADX) * this.ppu;
    this.camRow = Math.round(this.camY * this.ppu);
    this.pump(game, 6);

    // backdrop beyond the house
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#3E3A4F';
    const left = Math.round(this.oxDev - (SIDE + PADX) * this.ppu);
    const right = Math.round(this.oxDev + (SHAFT_W + SIDE + PADX) * this.ppu);
    if (left > 0) ctx.fillRect(0, 0, left, stage.canvas.height);
    if (right < stage.canvas.width) ctx.fillRect(right, 0, stage.canvas.width - right, stage.canvas.height);
    // the house
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
    this.painter.tick(dt);
    if (game.soaked) {
      withBreed(cat, wetBreed(cat.breed), () => this.painter.draw(ctx, cat, this.pose(game)));
      drawSoaked(ctx, cat, this.painter.view(cat), this.time, this.ppu);
    } else this.painter.draw(ctx, cat, this.pose(game));
    // bath time's bubbles, over the cat (and under the glass, when they are in a tube)
    const ey = -this.camRow + this.shakeOffset();
    if (this.showSuds) drawSuds(ctx, this.suds, alpha, this.ppu, this.oxDev, ey, this.camY, this.viewH, 0);
    // glass over the cat
    for (const c of chunks) {
      const f = this.fronts.get(c.id);
      if (f && !f.tasks.length) this.blit(f);
    }
    // foam passing in front of the geometry, then drops and spray
    if (this.showSuds) {
      drawSuds(ctx, this.suds, alpha, this.ppu, this.oxDev, ey, this.camY, this.viewH, 1);
      drawDrops(ctx, this.suds, this.ppu, this.oxDev, ey);
    }
    this.world();
    this.fx.update(dt);
    this.fx.draw(ctx);
    this.lerp.end();
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
      // soggy and sorry for itself (and a squeezed-shut sneeze)
      expression = !game.soaked ? 'wide' : game.sinceSneeze < 22 ? 'squint' : 'sleepy';
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
