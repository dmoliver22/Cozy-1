// Canvas renderer: cached painted layers (room + container backs / container
// fronts), live cats in between, effects and paper grain on top.

import type { Cat, Session } from '../game/session';
import { FLOOR_Y, WORLD_W, type Prop } from '../game/props';
import type { RoomDef } from '../game/room';
import { clamp, damp, easeInOut, lerp } from '../util/math';
import { CatView, drawCat, catFootprint, type CatPose, type Expression } from './catArt';
import { drawContainerBack, drawContainerFront, drawFurniture, containerShadow } from './propArt';
import { drawDecor, drawShell, drawSunbeams, THEMES, type Theme } from './roomArt';
import { PALETTE, paperGrain, pill, rgba, roundRect, softShadow, type Ctx } from './paint';

export const ROOM_TOP = -14;
export const ROOM_BOTTOM = 604;
const SIDE = 7;

export interface Insets {
  top: number;
  bottom: number;
}

interface Effect {
  kind: 'heart' | 'puff' | 'z' | 'spark' | 'label' | 'note';
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  size: number;
  color: string;
  text?: string;
}

export interface HintGhost {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: Ctx;
  dpr = 1;
  W = 0;
  H = 0;
  insets: Insets = { top: 60, bottom: 110 };
  scale = 1;
  ox = 0;
  oy = 0;
  cam = { x: WORLD_W / 2, y: (ROOM_TOP + ROOM_BOTTOM) / 2, zoom: 1 };
  private camTarget = { x: WORLD_W / 2, y: (ROOM_TOP + ROOM_BOTTOM) / 2, zoom: 1 };
  private layerBack: HTMLCanvasElement | null = null;
  private layerFront: HTMLCanvasElement | null = null;
  private layerKey = '';
  private layerRect = { x0: 0, y0: 0, x1: 0, y1: 0, ppu: 1 };
  private views = new Map<number, CatView>();
  private effects: Effect[] = [];
  private grain: CanvasPattern | null = null;
  session: Session | null = null;
  def: RoomDef | null = null;
  theme: Theme = THEMES.kitchen;
  glow = 0;
  glowTarget = 0;
  hint: HintGhost | null = null;
  pointer: { x: number; y: number } | null = null;
  time = 0;
  /** Props currently being dragged in the sandbox (drawn live, not cached). */
  liveProps = new Set<number>();
  reducedMotion = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  setRoom(session: Session): void {
    this.session = session;
    this.def = session.def;
    this.theme = THEMES[session.def.theme] ?? THEMES.kitchen;
    this.views.clear();
    this.effects = [];
    this.glow = 0;
    this.glowTarget = 0;
    this.hint = null;
    this.resetCamera(true);
    this.invalidate();
  }

  invalidate(): void {
    this.layerKey = '';
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const W = this.canvas.clientWidth;
    const H = this.canvas.clientHeight;
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.layout();
  }

  layout(): void {
    const { W, H } = this;
    const availH = Math.max(200, H - this.insets.top - this.insets.bottom * 0.62);
    const worldW = WORLD_W + SIDE * 2;
    const worldH = ROOM_BOTTOM - ROOM_TOP;
    this.scale = Math.min(W / worldW, availH / worldH);
    this.ox = W / 2 - (WORLD_W / 2) * this.scale;
    const usedH = worldH * this.scale;
    this.oy = this.insets.top + Math.max(0, (availH - usedH) / 2) - ROOM_TOP * this.scale;
    this.invalidate();
  }

  resetCamera(snap = false): void {
    this.camTarget = { x: WORLD_W / 2, y: (ROOM_TOP + ROOM_BOTTOM) / 2, zoom: 1 };
    if (snap) this.cam = { ...this.camTarget };
  }

  focus(x: number, y: number, zoom: number): void {
    this.camTarget = { x, y, zoom };
  }

  /** world -> css px for the current camera */
  private camTransform(): { s: number; tx: number; ty: number } {
    const s = this.scale * this.cam.zoom;
    const restX = this.ox + (WORLD_W / 2) * this.scale;
    const restY = this.oy + ((ROOM_TOP + ROOM_BOTTOM) / 2) * this.scale;
    return { s, tx: restX - this.cam.x * s, ty: restY - this.cam.y * s };
  }

  screenToWorld(px: number, py: number): { x: number; y: number } {
    const { s, tx, ty } = this.camTransform();
    return { x: (px - tx) / s, y: (py - ty) / s };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const { s, tx, ty } = this.camTransform();
    return { x: wx * s + tx, y: wy * s + ty };
  }

  view(cat: Cat): CatView {
    let v = this.views.get(cat.body.id);
    if (!v) {
      v = new CatView(cat.body.n, cat.index * 7 + cat.body.id);
      this.views.set(cat.body.id, v);
    }
    return v;
  }

  // ---------------------------------------------------------------------------
  // Cached layers

  private visibleWorldRect(): { x0: number; y0: number; x1: number; y1: number } {
    const x0 = -this.ox / this.scale;
    const x1 = (this.W - this.ox) / this.scale;
    const y0 = -this.oy / this.scale;
    const y1 = (this.H - this.oy) / this.scale;
    return { x0, y0, x1, y1 };
  }

  private ensureLayers(): void {
    const s = this.session;
    if (!s) return;
    const key = `${this.W}x${this.H}@${this.dpr}:${s.def.id}:${s.props.map((p) => `${p.uid}:${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('|')}:${[...this.liveProps].join(',')}`;
    if (key === this.layerKey && this.layerBack) return;
    this.layerKey = key;
    const r = this.visibleWorldRect();
    const ppu = Math.min(this.scale * this.dpr * 1.25, 4096 / (r.x1 - r.x0), 4096 / (r.y1 - r.y0));
    const pw = Math.ceil((r.x1 - r.x0) * ppu);
    const ph = Math.ceil((r.y1 - r.y0) * ppu);
    this.layerRect = { ...r, ppu };
    const mk = (old: HTMLCanvasElement | null): HTMLCanvasElement => {
      const c = old ?? document.createElement('canvas');
      c.width = pw;
      c.height = ph;
      return c;
    };
    this.layerBack = mk(this.layerBack);
    this.layerFront = mk(this.layerFront);
    const b = this.layerBack.getContext('2d')!;
    const f = this.layerFront.getContext('2d')!;
    for (const c of [b, f]) {
      c.setTransform(ppu, 0, 0, ppu, -r.x0 * ppu, -r.y0 * ppu);
      c.clearRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    }
    this.paintBack(b, r);
    this.paintFront(f);
  }

  private paintBack(ctx: Ctx, r: { x0: number; y0: number; x1: number; y1: number }): void {
    const s = this.session!;
    const def = s.def;
    const seed = hashStr(def.id);
    drawShell(ctx, this.theme, r.x0, r.y0, r.x1, r.y1, seed);
    for (const d of def.decor) if (d.type === 'rug' || d.type === 'backsplash' || d.type === 'window' || d.type === 'picture' || d.type === 'mirror' || d.type === 'clock' || d.type === 'garland' || d.type === 'radiator' || d.type === 'towel') drawDecor(ctx, d, this.theme, seed + d.x);
    for (const p of s.furniture) if (!this.liveProps.has(p.uid)) drawFurniture(ctx, p, this.theme);
    for (const d of def.decor) if (!(d.type === 'rug' || d.type === 'backsplash' || d.type === 'window' || d.type === 'picture' || d.type === 'mirror' || d.type === 'clock' || d.type === 'garland' || d.type === 'radiator' || d.type === 'towel')) drawDecor(ctx, d, this.theme, seed + d.x);
    for (const p of s.containers) {
      if (this.liveProps.has(p.uid)) continue;
      containerShadow(ctx, p);
      drawContainerBack(ctx, p);
    }
    drawSunbeams(ctx, def.decor);
    this.paintFrame(ctx, r);
  }

  private paintFront(ctx: Ctx): void {
    const s = this.session!;
    for (const p of s.containers) if (!this.liveProps.has(p.uid)) drawContainerFront(ctx, p);
  }

  /** Dollhouse cutaway edges around the room. */
  private paintFrame(ctx: Ctx, r: { x0: number; y0: number; x1: number; y1: number }): void {
    const edge = '#E9DCCB';
    const cut = '#B9A58E';
    const out = '#3E3A4F';
    ctx.save();
    // backdrop outside the house (only visible on wide screens)
    ctx.fillStyle = out;
    ctx.fillRect(r.x0, r.y0, -r.x0 - SIDE, r.y1 - r.y0);
    ctx.fillRect(WORLD_W + SIDE, r.y0, r.x1 - WORLD_W - SIDE, r.y1 - r.y0);
    // side walls (cut)
    ctx.fillStyle = edge;
    ctx.fillRect(-SIDE, r.y0, SIDE, r.y1 - r.y0);
    ctx.fillRect(WORLD_W, r.y0, SIDE, r.y1 - r.y0);
    ctx.fillStyle = cut;
    ctx.fillRect(-SIDE, r.y0, 2, r.y1 - r.y0);
    ctx.fillRect(WORLD_W + SIDE - 2, r.y0, 2, r.y1 - r.y0);
    // inner shadow along the cut edges
    const g = ctx.createLinearGradient(0, 0, 14, 0);
    g.addColorStop(0, 'rgba(62,58,79,0.12)');
    g.addColorStop(1, 'rgba(62,58,79,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, r.y0, 14, FLOOR_Y - r.y0);
    const g2 = ctx.createLinearGradient(WORLD_W, 0, WORLD_W - 14, 0);
    g2.addColorStop(0, 'rgba(62,58,79,0.12)');
    g2.addColorStop(1, 'rgba(62,58,79,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(WORLD_W - 14, r.y0, 14, FLOOR_Y - r.y0);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Effects

  emit(kind: Effect['kind'], x: number, y: number, opts: Partial<Effect> = {}): void {
    if (this.effects.length > 160) this.effects.shift();
    this.effects.push({
      kind,
      x,
      y,
      vx: opts.vx ?? 0,
      vy: opts.vy ?? -20,
      t: 0,
      life: opts.life ?? 1.2,
      size: opts.size ?? 8,
      color: opts.color ?? PALETTE.rose,
      text: opts.text,
    });
  }

  hearts(x: number, y: number, n = 3, color = PALETTE.rose): void {
    for (let k = 0; k < n; k++) {
      this.emit('heart', x + (k - (n - 1) / 2) * 12, y, { vx: (k - (n - 1) / 2) * 10, vy: -38 - k * 6, life: 1.4 + k * 0.15, size: 7 + (k % 2) * 2, color });
    }
  }

  puff(x: number, y: number, n = 5): void {
    for (let k = 0; k < n; k++) {
      const a = Math.PI + (k / (n - 1)) * Math.PI;
      this.emit('puff', x, y, { vx: Math.cos(a) * 45, vy: Math.sin(a) * 18 - 8, life: 0.5, size: 4 + (k % 2) * 2, color: 'rgba(255,255,255,0.8)' });
    }
  }

  label(x: number, y: number, text: string, color: string): void {
    this.emit('label', x, y, { vy: -16, life: 1.8, text, color });
  }

  private drawEffects(ctx: Ctx, dt: number): void {
    const keep: Effect[] = [];
    for (const e of this.effects) {
      e.t += dt;
      if (e.t >= e.life) continue;
      keep.push(e);
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      const k = e.t / e.life;
      const a = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      switch (e.kind) {
        case 'heart': {
          const s = e.size * (0.8 + 0.3 * Math.sin(e.t * 6));
          ctx.fillStyle = e.color;
          ctx.beginPath();
          ctx.moveTo(e.x, e.y + s * 0.9);
          ctx.bezierCurveTo(e.x - s * 1.4, e.y - s * 0.1, e.x - s * 0.6, e.y - s * 1.1, e.x, e.y - s * 0.35);
          ctx.bezierCurveTo(e.x + s * 0.6, e.y - s * 1.1, e.x + s * 1.4, e.y - s * 0.1, e.x, e.y + s * 0.9);
          ctx.fill();
          break;
        }
        case 'puff':
          ctx.fillStyle = e.color;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.size * (1 + k * 1.5), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'z':
          ctx.fillStyle = 'rgba(62,58,79,0.55)';
          ctx.font = `700 ${e.size}px "Baloo 2", system-ui`;
          ctx.textAlign = 'center';
          ctx.fillText('z', e.x + Math.sin(e.t * 3) * 4, e.y);
          break;
        case 'note':
          ctx.fillStyle = e.color;
          ctx.font = `700 ${e.size}px "Baloo 2", system-ui`;
          ctx.textAlign = 'center';
          ctx.fillText(e.text ?? '♪', e.x + Math.sin(e.t * 3) * 5, e.y);
          break;
        case 'spark': {
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          const s = e.size * (1 - k * 0.5);
          ctx.beginPath();
          ctx.moveTo(e.x - s, e.y);
          ctx.lineTo(e.x + s, e.y);
          ctx.moveTo(e.x, e.y - s);
          ctx.lineTo(e.x, e.y + s);
          ctx.stroke();
          break;
        }
        case 'label': {
          const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.5 : k < 0.2 ? 1.1 - ((k - 0.12) / 0.08) * 0.1 : 1;
          ctx.translate(e.x, e.y);
          ctx.scale(pop, pop);
          pill(ctx, e.text ?? '', 0, 0, { font: '800 14px "Baloo 2", system-ui', fg: '#FFFDF8', bg: e.color, pad: 9 });
          break;
        }
      }
      ctx.restore();
    }
    this.effects = keep;
  }

  // ---------------------------------------------------------------------------
  // Frame

  render(dt: number): void {
    const s = this.session;
    const ctx = this.ctx;
    this.time += dt;
    this.resize();
    if (!s || !this.W) return;
    this.ensureLayers();
    // camera easing
    const k = damp(this.reducedMotion ? 30 : 3.2, dt);
    this.cam.x = lerp(this.cam.x, this.camTarget.x, k);
    this.cam.y = lerp(this.cam.y, this.camTarget.y, k);
    this.cam.zoom = lerp(this.cam.zoom, this.camTarget.zoom, k);
    this.glow = lerp(this.glow, this.glowTarget, damp(1.5, dt));

    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(0, 0, this.W, this.H);
    const { s: sc, tx, ty } = this.camTransform();
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * tx, dpr * ty);
    const lr = this.layerRect;
    // Back layer
    if (this.layerBack) ctx.drawImage(this.layerBack, lr.x0, lr.y0, lr.x1 - lr.x0, lr.y1 - lr.y0);
    // live (dragged) props: back
    for (const p of s.props) {
      if (!this.liveProps.has(p.uid)) continue;
      if (p.kind === 'furniture') drawFurniture(ctx, p, this.theme);
      else {
        containerShadow(ctx, p);
        drawContainerBack(ctx, p);
      }
    }
    // cat shadows
    for (const cat of s.cats) this.drawCatShadow(ctx, cat);
    // cats
    for (const cat of s.cats) {
      const v = this.view(cat);
      v.update(dt);
      drawCat(ctx, cat.body, v, this.poseFor(cat, v), this.scale);
    }
    // Front layer
    if (this.layerFront) ctx.drawImage(this.layerFront, lr.x0, lr.y0, lr.x1 - lr.x0, lr.y1 - lr.y0);
    for (const p of s.props) if (this.liveProps.has(p.uid) && p.kind === 'container') drawContainerFront(ctx, p);
    // purr waves
    for (const cat of s.cats) if (cat.seat) this.drawPurr(ctx, cat);
    this.drawHint(ctx, dt);
    this.drawEffects(ctx, dt);
    // screen-space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.glow > 0.01) {
      const g = ctx.createRadialGradient(this.W / 2, this.H * 0.45, 0, this.W / 2, this.H * 0.45, Math.max(this.W, this.H) * 0.75);
      g.addColorStop(0, `rgba(255,214,130,${0.28 * this.glow})`);
      g.addColorStop(1, `rgba(255,190,90,${0.12 * this.glow})`);
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.restore();
    }
    if (!this.grain) this.grain = ctx.createPattern(paperGrain(), 'repeat');
    if (this.grain) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = this.grain;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.restore();
    }
    // vignette
    const vg = ctx.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.45, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.8);
    vg.addColorStop(0, 'rgba(62,58,79,0)');
    vg.addColorStop(1, 'rgba(62,58,79,0.14)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  private poseFor(cat: Cat, v: CatView): CatPose {
    const s = this.session!;
    const b = cat.body;
    let expression: Expression = 'open';
    let look = 0;
    const seat = cat.seat;
    if (cat.grabbed) {
      expression = 'wide';
      const g = b.grab;
      if (g) look = clamp((g.tx - b.cx) / (b.p.radius * 2), -1, 1);
    } else if (cat.sinceTouch < 22) expression = 'squint';
    else if (b.airborneFrames > 6) expression = 'wide';
    else if (seat) expression = s.complete || seat.cozy.score >= 78 ? 'happy' : 'content';
    else if (cat.settled > 30 && b.breed.look.persona === 'sleepy') expression = 'sleepy';
    else look = Math.sin(v.t * 0.5 + cat.index) > 0.85 ? 0.8 : Math.sin(v.t * 0.5 + cat.index) < -0.9 ? -0.8 : 0;
    const rimY = seat ? s.containers[seat.container].opening!.y : null;
    return { expression, look, rimY, purr: seat ? (s.complete ? 1 : 0.6) : 0, grabbed: cat.grabbed, glow: this.glow };
  }

  private drawCatShadow(ctx: Ctx, cat: Cat): void {
    const s = this.session!;
    if (cat.seat) return;
    const fp = catFootprint(cat.body);
    // find the surface below
    let ground = FLOOR_Y;
    for (const st of s.world.statics) {
      if (st.material === 'wall' && st.minY > FLOOR_Y - 1) continue;
      if (fp.cx < st.minX || fp.cx > st.maxX) continue;
      if (st.minY >= fp.maxY - 6 && st.minY < ground) ground = st.minY;
    }
    if (ground === FLOOR_Y) {
      // floor and walls
    }
    const hgt = Math.max(0, ground - fp.maxY);
    const w = (fp.maxX - fp.minX) * 0.5;
    const a = 0.26 * clamp(1 - hgt / 220, 0.15, 1);
    softShadow(ctx, fp.cx, ground + 1, w * (1 + hgt / 300), 5 + hgt * 0.01, a);
  }

  private drawPurr(ctx: Ctx, cat: Cat): void {
    const v = this.view(cat);
    const s = this.session!;
    const amp = s.complete ? 1 : 0.55;
    const t = this.time * 1.6 + cat.index;
    const ph = t % 1;
    const r = cat.body.p.radius;
    ctx.save();
    ctx.strokeStyle = rgba(PALETTE.ink, 0.28 * amp * (1 - ph));
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (const sgn of [-1, 1]) {
      const cx = v.hx + sgn * (r * 0.95 + ph * 10);
      const cy = v.hy + r * 0.35;
      ctx.beginPath();
      ctx.arc(cx - sgn * 8, cy, 8 + ph * 4, -0.6 + (sgn < 0 ? Math.PI : 0), 0.6 + (sgn < 0 ? Math.PI : 0));
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHint(ctx: Ctx, dt: number): void {
    const h = this.hint;
    if (!h) return;
    h.t += dt;
    if (h.t > 4.2) {
      this.hint = null;
      return;
    }
    const cyc = (h.t % 1.4) / 1.4;
    const e = easeInOut(clamp(cyc * 1.3, 0, 1));
    const x = lerp(h.fromX, h.toX, e);
    const y = lerp(h.fromY, h.toY, e) - Math.sin(e * Math.PI) * 26;
    const fade = Math.min(1, h.t * 3, (4.2 - h.t) * 2);
    ctx.save();
    ctx.globalAlpha = fade * 0.85;
    // dotted arc
    ctx.strokeStyle = 'rgba(255,253,247,0.95)';
    ctx.lineWidth = 3;
    ctx.setLineDash([2, 7]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(h.fromX, h.fromY);
    ctx.quadraticCurveTo((h.fromX + h.toX) / 2, Math.min(h.fromY, h.toY) - 52, h.toX, h.toY);
    ctx.stroke();
    ctx.setLineDash([]);
    // paw ghost
    drawPaw(ctx, x, y, 11, 'rgba(255,253,247,0.95)', 'rgba(62,58,79,0.5)');
    ctx.restore();
  }

  /** Draw a single prop live (sandbox drag preview). */
  drawPropPreview(ctx: Ctx, p: Prop): void {
    if (p.kind === 'furniture') drawFurniture(ctx, p, this.theme);
    else {
      drawContainerBack(ctx, p);
      drawContainerFront(ctx, p);
    }
  }

  /** Render the current room into a standalone canvas (photo mode). */
  snapshot(width: number, height: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const g = c.getContext('2d')!;
    g.drawImage(this.canvas, 0, 0, width, height);
    return c;
  }
}

export function drawPaw(ctx: Ctx, x: number, y: number, s: number, fill: string, stroke?: string): void {
  ctx.save();
  ctx.fillStyle = fill;
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
  }
  ctx.beginPath();
  ctx.ellipse(x, y + s * 0.25, s * 0.62, s * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (stroke) ctx.stroke();
  for (const [dx, dy] of [
    [-0.62, -0.38],
    [-0.22, -0.72],
    [0.22, -0.72],
    [0.62, -0.38],
  ]) {
    ctx.beginPath();
    ctx.ellipse(x + dx * s, y + dy * s, s * 0.22, s * 0.27, 0, 0, Math.PI * 2);
    ctx.fill();
    if (stroke) ctx.stroke();
  }
  ctx.restore();
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

export { roundRect };
