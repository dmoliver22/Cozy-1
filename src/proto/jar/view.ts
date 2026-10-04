// The Cat Jar view: fits the world to the screen under the HUD, caches the
// painted back and front layers (repainted only when the screen changes) and
// draws each frame: the back layer, the cats in the jar, the jar's glass
// front, the full line, the waiting cat with its guide, and the effects.

import { NODE_RADIUS, type SoftBody } from '../../physics/softbody';
import type { Expression } from '../../render/catArt';
import { rgba, type Ctx } from '../../render/paint';
import { clamp } from '../../util/math';
import { CatPainter, Lerp, type Stage } from '../kit';
import { CAV, FRONT_RECT, floorShadow, paintBack, paintFront, type Rect } from './art';
import { COUNTER_Y, CX, HOLD_Y, JAR, LINE_Y, TIERS } from './config';
import { Effects } from './fx';
import { JarGame, type Ghost, type JarCat } from './game';

/** World rect that must always be on screen (x is the jar plus a little wall). */
const NEED = { x0: CX - 160, x1: CX + 160, y0: HOLD_Y - 56, y1: COUNTER_Y + 64 };

interface GhostView extends Ghost {
  t: number;
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
  time = 0;
  /** 0..1 white flash (two voids vanishing). */
  flash = 0;
  private back: HTMLCanvasElement | null = null;
  private front: HTMLCanvasElement | null = null;
  private layerKey = '';
  private ghosts: GhostView[] = [];
  /** The newest big cat purrs (its id), and how loudly. */
  purrCat: JarCat | null = null;

  constructor(readonly stage: Stage) {}

  // --- Layout ------------------------------------------------------------------

  layout(): void {
    const { w, h } = this.stage;
    const top = this.hudPx;
    const s = Math.min(w / (NEED.x1 - NEED.x0), (h - top - 6) / (NEED.y1 - NEED.y0));
    this.scale = s;
    this.ox = w / 2 - CX * s;
    const extra = Math.max(0, h - top - (NEED.y1 - NEED.y0) * s);
    this.oy = top + extra * 0.32 - NEED.y0 * s;
  }

  toWorld(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.ox) / this.scale, y: (py - this.oy) / this.scale };
  }

  toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.scale + this.ox, y: wy * this.scale + this.oy };
  }

  visibleRect(): Rect {
    const { w, h } = this.stage;
    return { x0: -this.ox / this.scale, y0: -this.oy / this.scale, x1: (w - this.ox) / this.scale, y1: (h - this.oy) / this.scale };
  }

  private ensureLayers(): void {
    const { stage } = this;
    const key = `${stage.w}x${stage.h}@${stage.dpr}:${this.hudPx}`;
    if (key === this.layerKey && this.back && this.front) return;
    this.layout();
    this.layerKey = key;
    const ppu = this.scale * stage.dpr;
    const r = this.visibleRect();
    const back = this.back ?? document.createElement('canvas');
    back.width = stage.canvas.width;
    back.height = stage.canvas.height;
    const b = back.getContext('2d', { alpha: false })!;
    b.setTransform(ppu, 0, 0, ppu, this.ox * stage.dpr, this.oy * stage.dpr);
    paintBack(b, r, this.scale);
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

  addGhosts(gs: Ghost[]): void {
    for (const g of gs) {
      this.lerp.forget(g.body);
      this.ghosts.push({ ...g, t: 0 });
    }
  }

  forget(b: SoftBody): void {
    this.painter.forget(b);
    this.lerp.forget(b);
  }

  reset(): void {
    for (const g of this.ghosts) this.painter.forget(g.body);
    this.ghosts = [];
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
    // back layer, 1:1
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.back) ctx.drawImage(this.back, 0, 0);
    stage.world(this.scale, this.ox, this.oy);
    this.painter.tick(dt);
    const bodies = game.cats.map((c) => c.body);
    this.lerp.begin(bodies, alpha);
    try {
      this.drawFloorShadows(ctx, game);
      this.drawGhosts(ctx, dt);
      for (const c of game.cats) this.drawCat(ctx, game, c);
    } finally {
      this.lerp.end();
    }
    // the jar's glass front over them
    if (this.front) {
      const fr = FRONT_RECT;
      ctx.drawImage(this.front, fr.x0, fr.y0, fr.x1 - fr.x0, fr.y1 - fr.y0);
    }
    this.drawFullLine(ctx, game);
    this.drawWaiting(ctx, game);
    this.fx.draw(ctx, dt);
    if (this.flash > 0.01) {
      stage.screen();
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

  private drawGhosts(ctx: Ctx, dt: number): void {
    const keep: GhostView[] = [];
    for (const g of this.ghosts) {
      g.t += dt;
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
    else if (c.falling || b.airborneFrames > 8) expression = 'wide';
    else if (f - c.booped < 40) expression = 'squint';
    else if (!c.dropped && age < 100) expression = 'happy';
    else if (game.danger && top < LINE_Y + 4) expression = 'wide';
    else if (b.asleep && c.rest > 420) expression = 'sleepy';
    else if (c.rest > 200 && (c.id % 3 === 0 || TIERS[c.tier].breed === 'chonk')) expression = c.id % 2 ? 'content' : 'sleepy';
    if (expression === 'open' && game.waiting) {
      b.computeCentroid();
      look = clamp((game.holdX - b.cx) / 140, -1, 1) * 0.8;
    }
    const purr = this.purrCat === c ? 1 : 0;
    const glow = !c.dropped && age < 30 ? (1 - age / 30) * 0.9 : 0;
    // merged cats pop in with a little overshoot on top of their growth
    const pop = !c.dropped && age < 24 ? Math.sin((age / 24) * Math.PI) * 0.09 : 0;
    if (pop > 0.001) {
      b.computeCentroid();
      ctx.save();
      ctx.translate(b.cx, b.cy);
      ctx.scale(1 + pop, 1 + pop);
      ctx.translate(-b.cx, -b.cy);
    }
    this.painter.draw(ctx, b, { expression, look, resting: c.rest > 14 && !c.falling, purr, glow });
    if (pop > 0.001) ctx.restore();
  }

  /** The dashed line on the glass: faint, pulsing red while a cat rests above it. */
  private drawFullLine(ctx: Ctx, game: JarGame): void {
    const { cx, hw } = { cx: (JAR.inL + JAR.inR) / 2, hw: (JAR.inR - JAR.inL) / 2 };
    const warn = game.full > 0 || game.danger || game.over;
    const pulse = warn ? 0.5 + 0.5 * Math.sin(this.time * 9) : 0;
    const urgency = game.over ? 1 : clamp(game.full / 120, 0, 1);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -this.time * (warn ? 18 : 4);
    const x0 = cx - hw + 5;
    const x1 = cx + hw - 5;
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

  private drawWaiting(ctx: Ctx, game: JarGame): void {
    const w = game.waiting;
    if (!w) return;
    const b = w.body;
    const r = TIERS[w.tier].r;
    const age = (game.frame - w.since) / 60;
    const x = game.holdX;
    // the guide: straight down to whatever it would land on
    const land = landingY(game, x, r);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,253,247,0.7)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.setLineDash([2.5, 7]);
    ctx.lineDashOffset = -this.time * 20;
    ctx.beginPath();
    ctx.moveTo(x, HOLD_Y + r + 8);
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
    const sway = Math.sin(this.time * 2.1) * 0.05;
    const bob = Math.sin(this.time * 4.2) * 1.2;
    ctx.save();
    ctx.translate(x, HOLD_Y - r * 1.4 + bob);
    ctx.rotate(sway);
    ctx.scale(pop, pop);
    ctx.translate(-x, -(HOLD_Y - r * 1.4));
    this.painter.draw(ctx, b, { expression: game.danger ? 'wide' : 'open', look: clamp((game.aimX - x) / 30, -1, 1) });
    ctx.restore();
  }
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

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

