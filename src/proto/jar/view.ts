// The Cat Jar view: fits the jar's width to the screen under the HUD, with a
// camera that scrolls up and down the tall jar (it follows the pile, and the
// player can look around). Caches the painted back (the whole wall, top to
// bottom) and the jar's glass front, repainted only when the screen changes,
// and draws each frame: the back, the cats in the jar, the glass front, the
// full line, the waiting cat with its guide, the effects and a little gauge
// showing which part of the jar is on screen.

import { NODE_RADIUS, type SoftBody } from '../../physics/softbody';
import type { Expression } from '../../render/catArt';
import { rgba, type Ctx } from '../../render/paint';
import { clamp, easeOutBack } from '../../util/math';
import { CatPainter, Lerp, type CatLook, type Stage } from '../kit';
import { CAV, FRONT_RECT, floorShadow, paintBack, paintFront } from './art';
import { CX, HOLD_Y, JAR, LINE_Y, TIERS, WILD, WORLD_BOTTOM, WORLD_TOP } from './config';
import { Effects, heart } from './fx';
import { JarGame, airborne, type Ghost, type JarCat } from './game';

/** World columns that are always on screen (the jar plus a little wall). */
const NEED_X0 = CX - 160;
const NEED_X1 = CX + 160;
/** World rows the view shows at least (a wide, short window zooms out to see this much). */
const NEED_H = 514;
/** After the player scrolls, the view stays put this long (s) before following the pile again. */
const HOLD_LOOK = 2.4;

interface GhostView extends Ghost {
  t: number;
  /** Game frame it melted (a ghost never outlives a few frames of play). */
  f: number;
}

/** A still cat's picture: where it goes on screen (device px) and the outline it was painted from. */
interface CatSprite {
  canvas: HTMLCanvasElement;
  px: number;
  py: number;
  /** Size on screen and in the picture (device px), and the picture's resolution (1 = sharp). */
  w: number;
  h: number;
  cw: number;
  ch: number;
  q: number;
  key: string;
  ref: Float64Array;
  n: number;
  /** The camera (oy) it was painted under. */
  oy: number;
}

const shift = { x: 0, y: 0 };

/**
 * How much a cat changed shape since its picture was painted: the largest
 * node movement once the move of the whole cat is taken out (left in `shift`,
 * so a falling or sliding cat keeps its picture and just moves it).
 */
function reshaped(ref: Float64Array, b: SoftBody): number {
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < b.n; i++) {
    sx += b.x[i] - ref[i * 2];
    sy += b.y[i] - ref[i * 2 + 1];
  }
  sx /= b.n;
  sy /= b.n;
  shift.x = sx;
  shift.y = sy;
  let m = 0;
  for (let i = 0; i < b.n; i++) {
    const dx = b.x[i] - ref[i * 2] - sx;
    const dy = b.y[i] - ref[i * 2 + 1] - sy;
    const d = dx * dx + dy * dy;
    if (d > m) m = d;
  }
  return Math.sqrt(m);
}

export class JarView {
  readonly painter = new CatPainter();
  readonly lerp = new Lerp();
  readonly fx = new Effects();
  scale = 1;
  ox = 0;
  oy = 0;
  /** CSS px covered by the HUD at the top. */
  hudPx = 70;
  /** The camera: the world row at the top of the play area (just under the HUD). */
  camY = WORLD_BOTTOM;
  /** The player is dragging the view up or down. */
  looking = false;
  /** Fling speed after a look (world units / s). */
  private camVel = 0;
  /** View time until which the camera stays where the player left it. */
  private lookUntil = -1;
  /** The back picture: its first world row and its resolution (1 = sharp). */
  private backY0 = 0;
  private backK = 1;
  time = 0;
  /** 0..1 white flash (two voids vanishing). */
  flash = 0;
  /** No flashes or swaying for people who asked for less motion. */
  readonly calmMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private back: HTMLCanvasElement | null = null;
  private front: HTMLCanvasElement | null = null;
  private layerKey = '';
  private ghosts: GhostView[] = [];
  /** The newest big cat purrs (ears wiggle). */
  purrCat: JarCat | null = null;
  /** Parts to leave out (profiling). */
  skip = new Set<string>();
  private sprites = new Map<JarCat, CatSprite>();
  private looks = new Map<JarCat, number>();
  private squashes = new Map<JarCat, { a: number; t: number }>();
  /** Cats snuggling a twin this frame (they look content). */
  private snuggling = new Set<JarCat>();
  /** Sprite repaints, live cat paints and stamps so far (profiling). */
  repaints = 0;
  lives = 0;
  stamps = 0;

  constructor(readonly stage: Stage) {}

  // --- Layout ------------------------------------------------------------------

  layout(): void {
    const { w, h } = this.stage;
    const s = Math.min(w / (NEED_X1 - NEED_X0), (h - this.hudPx - 6) / NEED_H);
    this.scale = s;
    this.ox = w / 2 - CX * s;
    this.setCam(this.camY);
  }

  /** World rows of the play area (under the HUD). */
  get viewH(): number {
    return (this.stage.h - this.hudPx) / this.scale;
  }

  /** How far the camera can go: from the top of the world down to the counter at the bottom of the screen. */
  camRange(): [number, number] {
    const lo = WORLD_TOP;
    return [lo, Math.max(lo, WORLD_BOTTOM - this.viewH)];
  }

  /** Put the camera at a world row (clamped), on whole device pixels so pictures stay sharp. */
  setCam(y: number): void {
    const [lo, hi] = this.camRange();
    this.camY = clamp(y, lo, hi);
    const d = this.stage.dpr;
    this.oy = Math.round((this.hudPx - this.camY * this.scale) * d) / d;
  }

  /** Where the camera wants to be: the waiting cat at the top, the pile below it. */
  homeY(game: JarGame): number {
    // room above the waiting cat's line for the biggest cat that drops, and its ears
    const y = Math.max(game.holdBase - 106, HOLD_Y - 70);
    let want = y;
    // a cat dropped into a deep gap: keep it in sight on the way down
    for (const c of game.cats) {
      if (!c.falling) continue;
      const b = c.body;
      let maxY = -Infinity;
      for (let i = 0; i < b.n; i++) if (b.y[i] > maxY) maxY = b.y[i];
      want = Math.max(want, maxY + 40 - this.viewH);
    }
    return want;
  }

  /** Follow the pile, unless the player is looking around (see look*). */
  follow(game: JarGame, dt: number): void {
    if (this.looking) return;
    if (game.danger) this.lookUntil = -1;
    if (this.camVel !== 0) {
      // a fling glides to a stop
      const before = this.camY;
      this.setCam(this.camY + this.camVel * dt);
      this.camVel *= Math.exp(-dt * 3.5);
      if (Math.abs(this.camVel) < 8 || this.camY === before) this.camVel = 0;
      return;
    }
    if (this.time < this.lookUntil) return;
    const home = this.homeY(game);
    this.setCam(this.camY + (home - this.camY) * (1 - Math.exp(-dt * 3.2)));
  }

  /** The player starts dragging the view. */
  lookStart(): void {
    this.looking = true;
    this.camVel = 0;
  }

  /** ...moves it (CSS px; down drags the jar down, showing what's above)... */
  lookBy(dyPx: number): void {
    this.setCam(this.camY - dyPx / this.scale);
  }

  /** ...and lets go with a fling (CSS px / s). */
  lookEnd(vyPx: number): void {
    this.looking = false;
    this.camVel = clamp(-vyPx / this.scale, -2500, 2500);
    this.lookUntil = this.time + HOLD_LOOK;
  }

  /** Back to following the pile (the player is aiming again). */
  lookHome(): void {
    this.looking = false;
    this.camVel = 0;
    this.lookUntil = -1;
  }

  /** Jump the camera to its home now (a new game). */
  snapHome(game: JarGame): void {
    this.lookHome();
    this.setCam(this.homeY(game));
  }

  toWorld(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.ox) / this.scale, y: (py - this.oy) / this.scale };
  }

  toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.scale + this.ox, y: wy * this.scale + this.oy };
  }

  private ensureLayers(): void {
    const { stage } = this;
    const key = `${stage.w}x${stage.h}@${stage.dpr}:${this.hudPx}`;
    if (key === this.layerKey && this.back && this.front) return;
    this.layout();
    this.layerKey = key;
    const ppu = this.scale * stage.dpr;
    // The back covers every row the camera can show (the whole wall), on
    // whole device rows. On a huge screen it is painted a little softer, so
    // the picture stays a size every browser can hold.
    const [lo, hi] = this.camRange();
    const y0 = Math.floor((lo - this.hudPx / this.scale - 2) * ppu) / ppu;
    const y1 = hi + this.viewH + 2;
    const W = stage.canvas.width;
    const H = Math.ceil((y1 - y0) * ppu);
    const k = Math.min(1, Math.sqrt(14e6 / (W * H)));
    this.backY0 = y0;
    this.backK = k;
    const back = this.back ?? document.createElement('canvas');
    back.width = Math.ceil(W * k);
    back.height = Math.ceil(H * k);
    const b = back.getContext('2d', { alpha: false })!;
    b.setTransform(ppu * k, 0, 0, ppu * k, this.ox * stage.dpr * k, -y0 * ppu * k);
    paintBack(b, { x0: -this.ox / this.scale, y0, x1: (stage.w - this.ox) / this.scale, y1 }, this.scale);
    const front = this.front ?? document.createElement('canvas');
    const fr = FRONT_RECT;
    front.width = Math.ceil((fr.x1 - fr.x0) * ppu);
    front.height = Math.ceil((fr.y1 - fr.y0) * ppu);
    const f = front.getContext('2d')!;
    f.setTransform(ppu, 0, 0, ppu, -fr.x0 * ppu, -fr.y0 * ppu);
    f.clearRect(fr.x0, fr.y0, fr.x1 - fr.x0, fr.y1 - fr.y0);
    paintFront(f);
    this.back = back;
    this.front = front;
  }

  invalidate(): void {
    this.layerKey = '';
  }

  // --- Events from the game ----------------------------------------------------------

  addGhosts(gs: Ghost[], frame: number): void {
    for (const g of gs) {
      this.lerp.forget(g.body);
      this.ghosts.push({ ...g, t: 0, f: frame });
    }
  }

  /** A cat landed hard: squash it flat for a moment and let it spring back (on top of the physics). */
  squash(c: JarCat, speed: number): void {
    const a = clamp((speed - 180) / 900, 0, 1) * 0.14;
    if (a <= 0.01) return;
    const old = this.squashes.get(c);
    if (old && old.t < 0.08 && old.a >= a) return;
    this.squashes.set(c, { a, t: 0 });
  }

  reset(): void {
    for (const g of this.ghosts) this.painter.forget(g.body);
    this.ghosts = [];
    this.sprites.clear();
    this.looks.clear();
    this.squashes.clear();
    this.fx.clear();
    this.flash = 0;
    this.purrCat = null;
  }

  // --- Frame --------------------------------------------------------------------------

  draw(game: JarGame, alpha: number, dt: number): void {
    const { stage } = this;
    const ctx = stage.ctx;
    this.time += dt;
    this.ensureLayers();
    // the back, the rows under the camera (1:1 unless it was painted softer)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.back && !this.skip.has('back')) {
      const k = this.backK;
      const sy = (-this.oy * stage.dpr - this.backY0 * this.scale * stage.dpr) * k;
      const W = stage.canvas.width;
      const H = stage.canvas.height;
      if (k === 1) ctx.drawImage(this.back, 0, Math.round(sy), W, H, 0, 0, W, H);
      else ctx.drawImage(this.back, 0, sy, W * k, H * k, 0, 0, W, H);
    }
    stage.world(this.scale, this.ox, this.oy);
    this.painter.tick(dt);
    const bodies = game.cats.map((c) => c.body);
    this.lerp.begin(bodies, alpha);
    try {
      this.drawFloorShadows(ctx, game);
      this.drawGhosts(ctx, dt, game.frame);
      for (const [c, q] of this.squashes) {
        q.t += dt;
        if (q.t > 0.45 || c.removed) this.squashes.delete(c);
      }
      const snug = game.snuggles();
      this.snuggling.clear();
      for (const s of snug) {
        this.snuggling.add(s.a);
        this.snuggling.add(s.b);
      }
      if (!this.skip.has('cats')) for (const c of game.cats) this.drawCat(ctx, game, c);
      this.drawSnuggles(ctx, snug);
      for (const c of this.sprites.keys()) if (c.removed) this.sprites.delete(c);
      for (const c of this.looks.keys()) if (c.removed) this.looks.delete(c);
    } finally {
      this.lerp.end();
    }
    // the waiting cat hangs inside the jar (behind the glass) until the pile nears the rim
    const w = game.waiting;
    const inJar = w !== null && game.holdY(w.tier) - TIERS[w.tier].r * 1.5 > JAR.rimY;
    if (inJar && !this.skip.has('waiting')) this.drawWaiting(ctx, game);
    // the jar's glass front over them
    if (this.front && !this.skip.has('front')) {
      const fr = FRONT_RECT;
      ctx.drawImage(this.front, fr.x0, fr.y0, fr.x1 - fr.x0, fr.y1 - fr.y0);
    }
    this.drawFullLine(ctx, game);
    if (!inJar && !this.skip.has('waiting')) this.drawWaiting(ctx, game);
    if (!this.skip.has('fx')) this.fx.draw(ctx, dt);
    stage.screen();
    this.drawOffscreenWarning(ctx, game);
    if (!this.skip.has('gauge')) this.drawGauge(ctx, game);
    if (this.flash > 0.01 && !this.calmMotion) {
      ctx.fillStyle = `rgba(255,248,226,${this.flash * 0.7})`;
      ctx.fillRect(0, 0, stage.w, stage.h);
      this.flash *= Math.exp(-dt * 3.2);
    }
  }

  private drawFloorShadows(ctx: Ctx, game: JarGame): void {
    for (const c of game.cats) {
      const b = c.body;
      let minX = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < b.n; i++) {
        if (b.x[i] < minX) minX = b.x[i];
        if (b.x[i] > maxX) maxX = b.x[i];
        if (b.y[i] > maxY) maxY = b.y[i];
      }
      const gap = JAR.floorY - (maxY + NODE_RADIUS);
      if (gap > 30) continue;
      const a = 0.22 * clamp(1 - gap / 30, 0, 1);
      floorShadow(ctx, (minX + maxX) / 2, (maxX - minX) * 0.38, a);
    }
  }

  /** Twins snuggling: a heart swells where they touch until they melt. */
  private drawSnuggles(ctx: Ctx, snug: { a: JarCat; b: JarCat; t: number }[]): void {
    for (const { a, b, t } of snug) {
      const A = a.body;
      const B = b.body;
      A.computeCentroid();
      B.computeCentroid();
      const k = A.p.radius / (A.p.radius + B.p.radius);
      const x = A.cx + (B.cx - A.cx) * k;
      const y = A.cy + (B.cy - A.cy) * k - Math.min(A.p.radius, B.p.radius) * 0.35;
      const beat = 1 + 0.12 * Math.sin(this.time * 14);
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.65 * t;
      heart(ctx, x, y, (3 + 6 * t) * beat, '#F29AAE');
      ctx.restore();
    }
  }

  private drawGhosts(ctx: Ctx, dt: number, frame: number): void {
    const keep: GhostView[] = [];
    for (const g of this.ghosts) {
      g.t = Math.max(g.t + dt, (frame - g.f) / 60);
      const k = g.t / 0.14;
      if (k >= 1) {
        this.painter.forget(g.body);
        continue;
      }
      keep.push(g);
      g.body.computeCentroid();
      const s = 1 - k * 0.55;
      ctx.save();
      ctx.globalAlpha = 1 - k * k;
      // slide into the meeting point while shrinking
      const cx = g.body.cx + (g.tx - g.body.cx) * k;
      const cy = g.body.cy + (g.ty - g.body.cy) * k;
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-g.body.cx, -g.body.cy);
      this.painter.draw(ctx, g.body, { expression: 'happy', glow: k });
      ctx.restore();
    }
    this.ghosts = keep;
  }

  private drawCat(ctx: Ctx, game: JarGame, c: JarCat): void {
    const b = c.body;
    const f = game.frame;
    const age = f - c.born;
    let expression: Expression = 'open';
    let look = 0;
    const top = JarGame.top(b);
    if (game.over) expression = top < LINE_Y + 6 ? 'wide' : 'open';
    else if (f - c.lastHop < 34) expression = 'happy';
    else if (this.snuggling.has(c)) expression = 'content';
    else if (c.falling || airborne(b) > 8) expression = 'wide';
    else if (f - c.booped < 40) expression = 'squint';
    else if (!c.dropped && age < 100) expression = 'happy';
    else if (game.danger && top < LINE_Y + 4) expression = 'wide';
    // eyes shut means dozing (it won't melt till woken); awake cats keep their eyes open
    else if (JarGame.dozing(c)) expression = 'sleepy';
    if (expression === 'open' && game.waiting) {
      // look toward the next cat (left, ahead or right, with a little
      // hysteresis so a still cat's picture isn't repainted on every wiggle)
      b.computeCentroid();
      const d = game.holdX - b.cx;
      const was = this.looks.get(c) ?? 0;
      const want = d > (was > 0 ? 50 : 80) ? 1 : d < (was < 0 ? -50 : -80) ? -1 : 0;
      this.looks.set(c, want);
      look = want * 0.75;
    }
    const purr = this.purrCat === c && game.frame - c.born < 240 ? 1 : 0;
    // a brief golden shimmer as it's born; a Little Void shimmers all the time
    const glow = c.tier === WILD ? wildGlow(this.time) : !c.dropped && age < 18 ? (1 - age / 18) * 0.6 : 0;
    const resting = c.rest > 14 && !c.falling;
    // merged cats pop in with a little overshoot on top of their growth
    const pop = !c.dropped && age < 26 ? Math.sin((age / 26) * Math.PI) * 0.11 : 0;
    // a hard landing squashes the cat flat, then it springs back past round
    const q = this.squashes.get(c);
    const sq = q ? q.a * Math.exp(-q.t / 0.13) * Math.cos((q.t / 0.3) * Math.PI * 2) : 0;
    if (pop > 0.001 || Math.abs(sq) > 0.004) {
      b.computeCentroid();
      let maxY = -Infinity;
      for (let i = 0; i < b.n; i++) if (b.y[i] > maxY) maxY = b.y[i];
      // squash about the cat's feet, pop about its middle
      const ay = sq !== 0 ? maxY + NODE_RADIUS : b.cy;
      ctx.save();
      ctx.translate(b.cx, ay);
      ctx.scale((1 + pop) * (1 + sq), (1 + pop) * (1 - sq));
      ctx.translate(-b.cx, -ay);
      this.lives++;
      this.painter.draw(ctx, b, { expression, look, resting, purr, glow });
      ctx.restore();
      return;
    }
    // flying cats (dropped, hopping) are quick and their faces trail behind: paint them live
    const flying = c.falling || airborne(b) > 2 || f - c.booped < 30;
    if (flying || purr > 0 || glow > 0 || this.skip.has('sprites')) {
      this.sprites.delete(c);
      this.lives++;
      this.painter.draw(ctx, b, { expression, look, resting, purr, glow });
      return;
    }
    // A cat that isn't going anywhere is painted once into a picture and
    // stamped until it moves (half a unit), blinks or changes its face: a
    // settled pile costs almost nothing. Quick cats are painted live.
    const v = this.painter.view(b);
    const blink = (expression === 'open' || expression === 'content') && v.blinking();
    const key = `${expression}|${look}|${resting ? 1 : 0}|${blink ? 1 : 0}|${this.layerKey}`;
    // a cat still settling is painted at reduced resolution (motion hides it)
    // and repainted sharp once it's calm
    const calm = b.asleep || b.energy < 40;
    let sp = this.sprites.get(c);
    let dx = 0;
    let dy = 0;
    if (sp && sp.key === key && sp.n === b.n && (sp.q === 1 || !calm) && reshaped(sp.ref, b) <= 0.6) {
      // same shape, maybe moved (or the camera did): stamp it there, on whole device pixels
      const k = this.scale * this.stage.dpr;
      dx = Math.round(shift.x * k);
      dy = Math.round(shift.y * k + (this.oy - sp.oy) * this.stage.dpr);
    } else {
      sp = this.paintSprite(c, { expression, look, resting, purr, glow }, key, sp, calm ? 1 : 0.6);
    }
    this.stamps++;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(sp.canvas, 0, 0, sp.cw, sp.ch, sp.px + dx, sp.py + dy, sp.w, sp.h);
    ctx.restore();
  }

  /** Paint a cat into its own picture, aligned to the screen's pixels. */
  private paintSprite(c: JarCat, look: CatLook, key: string, old: CatSprite | undefined, q: number): CatSprite {
    const b = c.body;
    const { stage } = this;
    const r = b.p.radius;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < b.n; i++) {
      x0 = Math.min(x0, b.x[i]);
      x1 = Math.max(x1, b.x[i]);
      y0 = Math.min(y0, b.y[i]);
      y1 = Math.max(y1, b.y[i]);
    }
    // room for ears, fur, whiskers and paws, around the body and the face
    // (which eases after the body, so it can sit a little off it)
    const v = this.painter.view(b);
    if (v.inited) {
      x0 = Math.min(x0, v.hx - r);
      x1 = Math.max(x1, v.hx + r);
      y0 = Math.min(y0, v.hy);
    }
    x0 -= r * 0.55 + 8;
    x1 += r * 0.55 + 8;
    y0 -= r * 0.85 + 8;
    y1 += 8;
    const k = this.scale * stage.dpr;
    const px = Math.floor((x0 * this.scale + this.ox) * stage.dpr);
    const py = Math.floor((y0 * this.scale + this.oy) * stage.dpr);
    const w = Math.ceil((x1 - x0) * k) + 2;
    const h = Math.ceil((y1 - y0) * k) + 2;
    // the picture's own pixels (fewer of them while the cat is settling)
    const cw = Math.ceil(w * q);
    const ch = Math.ceil(h * q);
    const canvas = old?.canvas ?? document.createElement('canvas');
    if (canvas.width < w || canvas.height < h) {
      canvas.width = Math.max(canvas.width, w);
      canvas.height = Math.max(canvas.height, h);
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, Math.max(cw, old?.cw ?? 0) + 1, Math.max(ch, old?.ch ?? 0) + 1);
    const kq = (k * cw) / w;
    g.setTransform(kq, 0, 0, (k * ch) / h, (this.ox * stage.dpr - px) * (cw / w), (this.oy * stage.dpr - py) * (ch / h));
    this.painter.draw(g, b, look);
    const ref = old && old.ref.length === b.n * 2 ? old.ref : new Float64Array(b.n * 2);
    for (let i = 0; i < b.n; i++) {
      ref[i * 2] = b.x[i];
      ref[i * 2 + 1] = b.y[i];
    }
    const sp: CatSprite = { canvas, px, py, w, h, cw, ch, q, key, ref, n: b.n, oy: this.oy };
    this.sprites.set(c, sp);
    this.repaints++;
    return sp;
  }

  /** The dashed line on the glass: faint, pulsing red while a cat rests above it. */
  private drawFullLine(ctx: Ctx, game: JarGame): void {
    const warn = game.full > 0 || game.danger || game.over;
    const pulse = warn ? 0.5 + 0.5 * Math.sin(this.time * 9) : 0;
    const urgency = game.over ? 1 : clamp(game.full / 120, 0, 1);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -this.time * (warn ? 18 : 4);
    const x0 = JAR.inL + 5;
    const x1 = JAR.inR - 5;
    if (warn) {
      ctx.strokeStyle = rgba('#E0645C', 0.25 + 0.3 * pulse);
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x0, LINE_Y);
      ctx.lineTo(x1, LINE_Y);
      ctx.stroke();
    }
    ctx.strokeStyle = warn ? rgba('#D9534F', 0.65 + 0.35 * Math.max(pulse, urgency)) : 'rgba(255,253,247,0.55)';
    ctx.lineWidth = warn ? 2.4 : 1.6;
    ctx.beginPath();
    ctx.moveTo(x0, LINE_Y);
    ctx.lineTo(x1, LINE_Y);
    ctx.stroke();
    if (!warn) {
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(62,58,79,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, LINE_Y + 1.4);
      ctx.lineTo(x1, LINE_Y + 1.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** While the player looks down the jar and it's filling up past the line: a red glow at the top. */
  private drawOffscreenWarning(ctx: Ctx, game: JarGame): void {
    if (!(game.danger || game.full > 0) || game.over) return;
    const ly = this.toScreen(0, LINE_Y).y;
    if (ly > this.hudPx + 10) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
    const top = this.hudPx - 4;
    const g = ctx.createLinearGradient(0, top, 0, top + 46);
    g.addColorStop(0, rgba('#E0645C', 0.42 + 0.25 * pulse));
    g.addColorStop(1, rgba('#E0645C', 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, top, this.stage.w, 46);
    ctx.save();
    ctx.font = '800 13px "Baloo 2", system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = rgba('#B8423C', 0.85 + 0.15 * pulse);
    ctx.fillText('▲ the jar is full up there!', this.stage.w / 2, top + 22);
    ctx.restore();
  }

  /** Where the gauge goes (CSS px): beside the jar, on the wall, under the HUD. */
  gaugeRect(): { x: number; y0: number; y1: number; w: number } {
    const { w, h } = this.stage;
    const top = this.hudPx + 16;
    const len = Math.min(230, (h - top) * 0.36);
    // halfway across the wall to the right of the jar (or by the screen's edge)
    const jarRight = this.toScreen(JAR.inR + JAR.wall * 2, 0).x;
    const roomRight = this.toScreen(400, 0).x;
    const x = Math.min(w - 10, (jarRight + Math.min(w, roomRight)) / 2);
    return { x, y0: top, y1: top + len, w: 6 };
  }

  /** World row -> gauge row, over the jar from just above the rim to the floor. */
  private gaugeMap(): (wy: number) => number {
    const g = this.gaugeRect();
    const a = JAR.rimY - 60;
    const b = JAR.floorY;
    return (wy: number) => g.y0 + ((clamp(wy, a, b) - a) / (b - a)) * (g.y1 - g.y0);
  }

  /** Gauge row (CSS px) -> the camera row that centres the view there. */
  gaugeToCam(py: number): number {
    const g = this.gaugeRect();
    const a = JAR.rimY - 60;
    const b = JAR.floorY;
    const wy = a + ((py - g.y0) / (g.y1 - g.y0)) * (b - a);
    return wy - this.viewH / 2;
  }

  /**
   * A slim gauge by the jar: the jar's height, the cats in it (in roughly
   * their colours), the full line, and a window round the part on screen.
   */
  private drawGauge(ctx: Ctx, game: JarGame): void {
    const g = this.gaugeRect();
    const map = this.gaugeMap();
    const [lo, hi] = this.camRange();
    if (hi - lo < 1) return;
    const x = g.x;
    const hw = g.w / 2;
    ctx.save();
    // the track
    ctx.fillStyle = 'rgba(255,250,242,0.82)';
    ctx.strokeStyle = 'rgba(62,58,79,0.16)';
    ctx.lineWidth = 1;
    roundRect(ctx, x - hw - 1.5, g.y0 - 2, g.w + 3, g.y1 - g.y0 + 4, hw + 1.5);
    ctx.fill();
    ctx.stroke();
    // the cats, as little bars at their heights (big ones over small)
    const cats = game.cats.slice().sort((a, b) => a.tier - b.tier);
    for (const c of cats) {
      const b = c.body;
      const r = b.p.radius;
      const y0 = map(b.cy - r * 0.8);
      const y1 = map(b.cy + r * 0.8);
      ctx.fillStyle = rgba(TIER_INK[c.tier], 0.9);
      roundRect(ctx, x - hw + 0.5, y0, g.w - 1, Math.max(1.5, y1 - y0), hw);
      ctx.fill();
    }
    // the full line
    const ly = map(LINE_Y);
    ctx.strokeStyle = game.danger || game.full > 0 ? '#D9534F' : 'rgba(217,83,79,0.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - hw - 3, ly);
    ctx.lineTo(x + hw + 3, ly);
    ctx.stroke();
    // the window round the part on screen
    const v0 = map(this.camY);
    const v1 = map(this.camY + this.viewH);
    const active = this.looking || this.time < this.lookUntil;
    ctx.strokeStyle = active ? 'rgba(62,58,79,0.75)' : 'rgba(62,58,79,0.4)';
    ctx.lineWidth = active ? 1.6 : 1.2;
    roundRect(ctx, x - hw - 4, v0 - 1.5, g.w + 8, v1 - v0 + 3, 5);
    ctx.stroke();
    ctx.restore();
  }

  private drawWaiting(ctx: Ctx, game: JarGame): void {
    const w = game.waiting;
    if (!w) return;
    const b = w.body;
    const r = TIERS[w.tier].r;
    const age = (game.frame - w.since) / 60;
    const x = game.holdX;
    const y = game.holdY(w.tier);
    // the guide: straight down to whatever it would land on
    const land = landingY(game, x, r);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,253,247,0.7)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.setLineDash([2.5, 7]);
    ctx.lineDashOffset = -this.time * 20;
    ctx.beginPath();
    ctx.moveTo(x, y + r + 8);
    ctx.lineTo(x, land - 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,253,247,0.75)';
    ctx.beginPath();
    ctx.ellipse(x, land - 2, 6, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // pop in, then sway gently as if dangling from a paw
    const pop = age < 0.3 ? easeOutBack(age / 0.3) : 1;
    const still = this.calmMotion ? 0 : 1;
    const sway = Math.sin(this.time * 2.1) * 0.05 * still;
    const bob = Math.sin(this.time * 4.2) * 1.2 * still;
    ctx.save();
    ctx.translate(x, y - r * 1.4 + bob);
    ctx.rotate(sway);
    ctx.scale(pop, pop);
    ctx.translate(-x, -(y - r * 1.4));
    // it is carried rigidly: its face and ears go with it (no easing to lag behind)
    this.painter.view(b).inited = false;
    const glow = w.tier === WILD ? wildGlow(this.time) : 0;
    this.painter.draw(ctx, b, { expression: game.danger ? 'wide' : w.tier === WILD ? 'happy' : 'open', look: clamp((game.aimX - x) / 30, -1, 1), glow });
    ctx.restore();
    if (w.tier === WILD && Math.floor(this.time * 3) !== Math.floor((this.time - 1 / 60) * 3)) this.fx.sparkles(x, y, 2, r * 1.2);
  }
}

/** A colour per cat for the gauge (roughly their coats; the Little Void, violet). */
const TIER_INK = ['#F2A48C', '#E8A0A8', '#E8964A', '#D8CBB8', '#8A6A50', '#9A9AA6', '#3E3A4F', '#8C6FD0'];

/** The Little Void's shimmer, 0.2..0.5. */
const wildGlow = (t: number): number => 0.35 + 0.15 * Math.sin(t * 4.5);

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

/** Where a cat dropped at x would first touch: the top of the pile under it, or the floor. */
export function landingY(game: JarGame, x: number, r: number): number {
  let best = CAV.floorY;
  for (const c of game.cats) {
    const y = topAt(c.body, x, r);
    if (y < best) best = y;
  }
  return best;
}

/** Highest point of a body's skin within r of the vertical line x. */
function topAt(b: SoftBody, x: number, r: number): number {
  let best = Infinity;
  const R = r + NODE_RADIUS;
  for (let i = 0; i < b.n; i++) {
    const dx = b.x[i] - x;
    if (dx < -R || dx > R) continue;
    // a round cat touches down where the circle under its centre meets this node
    const lift = R - Math.sqrt(Math.max(0, R * R - dx * dx));
    const y = b.y[i] - NODE_RADIUS + lift;
    if (y < best) best = y;
  }
  return best;
}

