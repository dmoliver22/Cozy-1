// Canvas renderer: cached painted layers (room + container backs / container
// fronts), live cats in between, effects and paper grain on top.

import type { Cat, Session } from '../game/session';
import { FLOOR_Y, WORLD_W } from '../game/props';
import type { DecorPlacement, RoomDef } from '../game/room';
import { clamp, damp, lerp } from '../util/math';
import { CatView, drawCat, catFootprint, type CatPose, type Expression } from './catArt';
import { drawContainerBack, drawContainerFront, containerShadow } from './propArt';
import { drawFurniture } from './furnitureArt';
import { SUN_DRIFT, drawDecor, drawShell, drawSunbeams, THEMES, type Theme } from './roomArt';
import { PALETTE, contactShadow, hash01, lightOf, paperGrain, pill, rgba, roundRect, shadowOf, softShadow, type Ctx } from './paint';

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

/**
 * A painted world other than a single room (the tall house): it paints its
 * own cached layers, in tiles (each painted when it first comes into view),
 * and the camera can scroll between `pan` rows; `overlay` draws live over
 * the cats each frame (glass in front of them, things being placed).
 */
export interface Stage {
  /** World rows the camera's middle can scroll between. */
  pan: [number, number];
  /** Horizontal bands (world y) painted and cached separately. */
  tiles: { y0: number; y1: number }[];
  /** Changes when something painted in the cached layers changes. */
  key(): string;
  paintBack(ctx: Ctx, r: { x0: number; y0: number; x1: number; y1: number }, cssPerUnit: number): void;
  paintFront?(ctx: Ctx, r: { x0: number; y0: number; x1: number; y1: number }): void;
  /** Drawn live each frame: under the cats, and over them. */
  underlay?(ctx: Ctx, dt: number): void;
  overlay?(ctx: Ctx, dt: number): void;
  /** Drawn live each frame with the front layer: over the cats under it (behindFront), under the rest. */
  liveFront?(ctx: Ctx, dt: number): void;
  /** A cat in a glass tube: drawn without a shadow, with this face (null: not in a tube). */
  inTube?(cat: Cat): Expression | null;
  /**
   * What a cat is up to says how it looks (null: the usual): its face, where
   * it's looking (-1..1), and whether it casts its shadow (not in a scuffle).
   */
  face?(cat: Cat): { expression: Expression; look?: number; shadow?: boolean; wiggle?: { sway: number; rear: 1 | -1 } } | null;
  /** Cats drawn under the front layer (in a tube, or curled in something with a front). */
  behindFront?(cat: Cat): boolean;
}

interface Tile {
  y0: number;
  y1: number;
  back: HTMLCanvasElement | null;
  front: HTMLCanvasElement | null;
  key: string;
  rect: { x0: number; y0: number; x1: number; y1: number; ppu: number };
}

export class Renderer {
  static nightAmbient: [number, number, number] = [108, 104, 180];
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
  private frontRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private views = new Map<number, CatView>();
  private effects: Effect[] = [];
  session: Session | null = null;
  def: RoomDef | null = null;
  theme: Theme = THEMES.kitchen;
  pointer: { x: number; y: number } | null = null;
  time = 0;
  /** The house (null: a room). */
  stage: Stage | null = null;
  private tiles: Tile[] = [];
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
    this.resetCamera(true);
    this.invalidate();
  }

  invalidate(): void {
    this.layerKey = '';
    for (const t of this.tiles) t.key = '';
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

  /** Scroll the house to put world row y in the middle (at once, or easing there). */
  scrollTo(y: number, snap = false): void {
    const p = this.stage?.pan;
    const yy = p ? clamp(y, p[0], p[1]) : y;
    this.camTarget = { x: WORLD_W / 2, y: yy, zoom: 1 };
    if (snap) this.cam = { ...this.camTarget };
  }

  /** Where the camera is headed (the world row it'll have in the middle). */
  get scrollTarget(): number {
    return this.camTarget.y;
  }

  /** World units per css pixel (for scrolling by finger). */
  get unitsPerPx(): number {
    return 1 / (this.scale * this.cam.zoom);
  }

  /** Keep a zoomed camera inside the painted room (no peeking past the edges). */
  private clampCamera(): void {
    const p = this.stage?.pan;
    if (p) {
      this.cam.y = clamp(this.cam.y, p[0], p[1]);
      return;
    }
    const z = this.cam.zoom;
    if (z <= 1.0001) return;
    const vr = this.visibleWorldRect();
    const halfW = (vr.x1 - vr.x0) / 2 / z;
    const halfH = (vr.y1 - vr.y0) / 2 / z;
    // the rest view is centred on (restCx, restCy); visible rect at zoom 1 is vr
    const restCx = WORLD_W / 2;
    const restCy = (ROOM_TOP + ROOM_BOTTOM) / 2;
    const offX = (vr.x0 + vr.x1) / 2 - restCx;
    const offY = (vr.y0 + vr.y1) / 2 - restCy;
    const minX = vr.x0 + halfW - offX;
    const maxX = vr.x1 - halfW - offX;
    const minY = vr.y0 + halfH - offY;
    const maxY = vr.y1 - halfH - offY;
    this.cam.x = clamp(this.cam.x, Math.min(minX, maxX), Math.max(minX, maxX));
    this.cam.y = clamp(this.cam.y, Math.min(minY, maxY), Math.max(minY, maxY));
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

  /** The world rows on screen right now. */
  private viewRows(): { y0: number; y1: number } {
    return { y0: this.screenToWorld(0, 0).y, y1: this.screenToWorld(0, this.H).y };
  }

  /**
   * The house's cached tiles: the ones on screen are painted now, the others
   * one a frame after that (so scrolling to them never waits).
   */
  private ensureTiles(): void {
    const st = this.stage!;
    const s = this.session!;
    if (this.tiles.length !== st.tiles.length || this.tiles.some((t, i) => t.y0 !== st.tiles[i].y0 || t.y1 !== st.tiles[i].y1)) {
      this.tiles = st.tiles.map((t) => ({ y0: t.y0, y1: t.y1, back: null, front: null, key: '', rect: { x0: 0, y0: t.y0, x1: 0, y1: t.y1, ppu: 1 } }));
    }
    const key = `${this.W}x${this.H}@${this.dpr}:${s.def.id}:${st.key()}`;
    const view = this.viewRows();
    let painted = 0;
    for (const near of [true, false]) {
      for (const t of this.tiles) {
        if (t.key === key) continue;
        const onScreen = t.y1 > view.y0 - 40 && t.y0 < view.y1 + 40;
        if (near ? !onScreen : painted > 0) continue;
        this.paintTile(t, key);
        painted++;
      }
    }
  }

  private paintTile(t: Tile, key: string): void {
    const st = this.stage!;
    const s = this.session!;
    const vr = this.visibleWorldRect();
    // (a little past its rows at either end, so neighbouring tiles overlap: no seam)
    const r = { x0: vr.x0, y0: t.y0 - 3, x1: vr.x1, y1: t.y1 + 3 };
    const ppu = Math.min(this.scale * this.dpr, 4096 / (r.x1 - r.x0), 4096 / (r.y1 - r.y0));
    const pw = Math.ceil((r.x1 - r.x0) * ppu);
    const ph = Math.ceil((r.y1 - r.y0) * ppu);
    t.key = key;
    t.rect = { ...r, ppu };
    const mk = (old: HTMLCanvasElement | null): HTMLCanvasElement => {
      const c = old ?? document.createElement('canvas');
      c.width = pw;
      c.height = ph;
      return c;
    };
    t.back = mk(t.back);
    const b = t.back.getContext('2d', { alpha: false })!;
    b.setTransform(ppu, 0, 0, ppu, -r.x0 * ppu, -r.y0 * ppu);
    b.save();
    b.beginPath();
    b.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    b.clip();
    st.paintBack(b, r, this.scale);
    this.paintGrain(b, r);
    b.restore();
    // container fronts (only tiles that have any keep a front layer)
    const fronts = s.containers.filter((p) => p.y1 > r.y0 && p.y0 - 16 < r.y1);
    if (fronts.length || st.paintFront) {
      t.front = mk(t.front);
      const f = t.front.getContext('2d')!;
      f.setTransform(ppu, 0, 0, ppu, -r.x0 * ppu, -r.y0 * ppu);
      f.clearRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      for (const p of fronts) drawContainerFront(f, p);
      st.paintFront?.(f, r);
    } else t.front = null;
  }

  private ensureLayers(): void {
    const s = this.session;
    if (!s) return;
    if (this.stage) {
      this.ensureTiles();
      return;
    }
    const key = `${this.W}x${this.H}@${this.dpr}:${s.def.id}:${s.props.map((p) => `${p.uid}:${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('|')}`;
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
    const b = this.layerBack.getContext('2d', { alpha: false })!;
    const f = this.layerFront.getContext('2d')!;
    for (const c of [b, f]) {
      c.setTransform(ppu, 0, 0, ppu, -r.x0 * ppu, -r.y0 * ppu);
      c.clearRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    }
    this.paintBack(b, r);
    this.paintPaper(b, r);
    this.paintFront(f);
    // Only the part of the front layer that has container fronts on it gets
    // composited every frame.
    let fx0 = Infinity;
    let fy0 = Infinity;
    let fx1 = -Infinity;
    let fy1 = -Infinity;
    for (const p of s.containers) {
      fx0 = Math.min(fx0, p.x0 - 12);
      fy0 = Math.min(fy0, p.y0 - 16);
      fx1 = Math.max(fx1, p.x1 + 12);
      fy1 = Math.max(fy1, p.y1 + 12);
    }
    this.frontRect = fx1 > fx0 ? { x0: Math.max(r.x0, fx0), y0: Math.max(r.y0, fy0), x1: Math.min(r.x1, fx1), y1: Math.min(r.y1, fy1) } : null;
  }

  /** Paper grain alone (the house's tiles: a vignette would band at their seams). */
  private paintGrain(ctx: Ctx, r: { x0: number; y0: number; x1: number; y1: number }): void {
    const grain = ctx.createPattern(paperGrain(), 'repeat');
    if (!grain) return;
    const css = 1 / this.scale;
    grain.setTransform?.({ a: css, b: 0, c: 0, d: css, e: 0, f: 0 });
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = grain;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.restore();
  }

  /** Paper grain and a soft vignette, baked into the back layer. */
  private paintPaper(ctx: Ctx, r: { x0: number; y0: number; x1: number; y1: number }): void {
    const grain = ctx.createPattern(paperGrain(), 'repeat');
    const css = 1 / this.scale;
    ctx.save();
    if (grain) {
      grain.setTransform?.({ a: css, b: 0, c: 0, d: css, e: 0, f: 0 });
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = grain;
      ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const wv = (r.x1 - r.x0) / 2;
    const hv = (r.y1 - r.y0) / 2;
    const vg = ctx.createRadialGradient(cx, cy, Math.min(wv, hv) * 0.9, cx, cy, Math.max(wv, hv) * 1.6);
    vg.addColorStop(0, 'rgba(62,58,79,0)');
    vg.addColorStop(1, 'rgba(62,58,79,0.12)');
    ctx.fillStyle = vg;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.restore();
  }

  private decorFor: RoomDef | null = null;
  private decorList: DecorPlacement[] = [];

  /**
   * The room's decor as painted: a daytime room never looks out of a night
   * window (generated sills can pick the night view), it gets golden hour.
   */
  private decor(): DecorPlacement[] {
    const def = this.def;
    if (!def) return [];
    if (this.decorFor !== def) {
      this.decorFor = def;
      this.decorList = def.mood === 'night' ? def.decor : def.decor.map((d) => (d.type === 'window' && d.variant === 3 ? { ...d, variant: 2 } : d));
    }
    return this.decorList;
  }

  private paintBack(ctx: Ctx, r: { x0: number; y0: number; x1: number; y1: number }): void {
    const s = this.session!;
    const def = s.def;
    const seed = hashStr(def.id);
    drawShell(ctx, this.theme, r.x0, r.y0, r.x1, r.y1, seed);
    const decor = this.decor();
    for (const d of decor) if (d.type === 'rug' || d.type === 'backsplash' || d.type === 'window' || d.type === 'picture' || d.type === 'mirror' || d.type === 'clock' || d.type === 'garland' || d.type === 'radiator' || d.type === 'towel') drawDecor(ctx, d, this.theme, seed + d.x);
    for (const p of s.furniture) drawFurniture(ctx, p, this.theme);
    for (const d of decor) if (!(d.type === 'rug' || d.type === 'backsplash' || d.type === 'window' || d.type === 'picture' || d.type === 'mirror' || d.type === 'clock' || d.type === 'garland' || d.type === 'radiator' || d.type === 'towel')) drawDecor(ctx, d, this.theme, seed + d.x);
    for (const p of s.containers) {
      containerShadow(ctx, p);
      drawContainerBack(ctx, p);
    }
    drawSunbeams(ctx, decor);
    this.paintFrame(ctx, r);
  }

  private paintFront(ctx: Ctx): void {
    const s = this.session!;
    for (const p of s.containers) drawContainerFront(ctx, p);
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
          ctx.beginPath();
          ctx.moveTo(e.x, e.y + s * 0.9);
          ctx.bezierCurveTo(e.x - s * 1.4, e.y - s * 0.1, e.x - s * 0.6, e.y - s * 1.1, e.x, e.y - s * 0.35);
          ctx.bezierCurveTo(e.x + s * 0.6, e.y - s * 1.1, e.x + s * 1.4, e.y - s * 0.1, e.x, e.y + s * 0.9);
          const hg = ctx.createLinearGradient(e.x - s, e.y - s, e.x + s, e.y + s);
          hg.addColorStop(0, e.color.startsWith('#') ? lightOf(e.color, 0.4) : e.color);
          hg.addColorStop(1, e.color.startsWith('#') ? shadowOf(e.color, 0.3) : e.color);
          ctx.fillStyle = hg;
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.beginPath();
          ctx.ellipse(e.x - s * 0.45, e.y - s * 0.38, s * 0.22, s * 0.14, -0.6, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'puff': {
          const pr = e.size * (1 + k * 1.5);
          const pg = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, pr);
          pg.addColorStop(0, 'rgba(255,253,247,0.9)');
          pg.addColorStop(0.6, 'rgba(255,253,247,0.55)');
          pg.addColorStop(1, 'rgba(255,253,247,0)');
          ctx.fillStyle = pg;
          ctx.beginPath();
          ctx.arc(e.x, e.y, pr, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
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
    this.clampCamera();

    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(0, 0, this.W, this.H);
    const { s: sc, tx, ty } = this.camTransform();
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * tx, dpr * ty);
    const lr = this.layerRect;
    // Back layer
    const st = this.stage;
    const rows = st ? this.viewRows() : null;
    if (st && rows) {
      for (const t of this.tiles) {
        if (!t.back || !t.key || t.y1 < rows.y0 || t.y0 > rows.y1) continue;
        const r = t.rect;
        ctx.drawImage(t.back, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      }
      st.underlay?.(ctx, dt);
    } else if (this.layerBack) ctx.drawImage(this.layerBack, lr.x0, lr.y0, lr.x1 - lr.x0, lr.y1 - lr.y0);
    // cat shadows
    const poses = s.cats.map((cat) => {
      const v = this.view(cat);
      v.update(dt);
      return this.poseFor(cat, v);
    });
    for (let i = 0; i < s.cats.length; i++) if (!poses[i].rim && !st?.inTube?.(s.cats[i]) && st?.face?.(s.cats[i])?.shadow !== false) this.drawCatShadow(ctx, s.cats[i]);
    // Cats in a container go under its (glass) front, resting on its floor in
    // a soft shadow; their front paws go over the rim.
    for (let i = 0; i < s.cats.length; i++) {
      const cat = s.cats[i];
      if (!poses[i].rim) continue;
      const fp = catFootprint(cat.body);
      contactShadow(ctx, fp.cx, fp.maxY, (fp.maxX - fp.minX) * 0.36, 0.2, 0.5);
      drawCat(ctx, cat.body, this.view(cat), poses[i], this.scale, 'body');
    }
    // cats in the house's glass tubes and pods: under its front layer
    const behind = st?.behindFront ? s.cats.map((c, i) => !poses[i].rim && st.behindFront!(c)) : null;
    if (behind) for (let i = 0; i < s.cats.length; i++) if (behind[i]) drawCat(ctx, s.cats[i].body, this.view(s.cats[i]), poses[i], this.scale, 'all');
    // Front layer
    const fr = this.frontRect;
    if (st && rows) {
      for (const t of this.tiles) {
        if (!t.front || !t.key || t.y1 < rows.y0 || t.y0 > rows.y1) continue;
        const r = t.rect;
        // only the rows with container fronts in them
        let fy0 = Infinity;
        let fy1 = -Infinity;
        for (const p of s.containers) {
          if (p.y1 < r.y0 || p.y0 - 16 > r.y1) continue;
          fy0 = Math.min(fy0, p.y0 - 16);
          fy1 = Math.max(fy1, p.y1 + 12);
        }
        if (st.paintFront) {
          fy0 = r.y0;
          fy1 = r.y1;
        }
        fy0 = Math.max(r.y0, fy0);
        fy1 = Math.min(r.y1, fy1);
        if (fy1 <= fy0) continue;
        const sy = Math.floor((fy0 - r.y0) * r.ppu);
        const sh = Math.min(t.front.height - sy, Math.ceil((fy1 - fy0) * r.ppu) + 2);
        if (sh > 0) ctx.drawImage(t.front, 0, sy, t.front.width, sh, r.x0, r.y0 + sy / r.ppu, r.x1 - r.x0, sh / r.ppu);
      }
    } else if (this.layerFront && fr) {
      const ppu = lr.ppu;
      const sx = Math.floor((fr.x0 - lr.x0) * ppu);
      const sy = Math.floor((fr.y0 - lr.y0) * ppu);
      const sw = Math.min(this.layerFront.width - sx, Math.ceil((fr.x1 - fr.x0) * ppu) + 2);
      const sh = Math.min(this.layerFront.height - sy, Math.ceil((fr.y1 - fr.y0) * ppu) + 2);
      if (sw > 0 && sh > 0) ctx.drawImage(this.layerFront, sx, sy, sw, sh, lr.x0 + sx / ppu, lr.y0 + sy / ppu, sw / ppu, sh / ppu);
    }
    st?.liveFront?.(ctx, dt);
    for (let i = 0; i < s.cats.length; i++) {
      const cat = s.cats[i];
      if (poses[i].rim) drawCat(ctx, cat.body, this.view(cat), poses[i], this.scale, 'over');
    }
    // Free cats (and the one in your hand, last) are in front of everything.
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i < s.cats.length; i++) {
        const cat = s.cats[i];
        if (!poses[i].rim && cat.grabbed === (pass === 1) && !behind?.[i]) drawCat(ctx, cat.body, this.view(cat), poses[i], this.scale, 'all');
      }
    st?.overlay?.(ctx, dt);
    // purr waves
    for (const cat of s.cats) if (cat.seat) this.drawPurr(ctx, cat);
    if (this.def?.mood !== 'night' && !this.reducedMotion) this.drawMotes(ctx);
    this.drawEffects(ctx, dt);
    // lamp-lit night rooms: dusk tint with warm pools of light
    if (this.def?.mood === 'night') this.drawNight(ctx);
  }

  /** Dust motes drifting down the window's shaft of light. */
  private drawMotes(ctx: Ctx): void {
    const t = this.time;
    ctx.save();
    for (const d of this.decor()) {
      if (d.type !== 'window' || d.variant === 3) continue;
      const w = d.w ?? 110;
      const h = d.h ?? 130;
      const x = d.x - w / 2;
      const top = d.y + h * 0.75;
      const span = FLOOR_Y - top;
      for (let i = 0; i < 18; i++) {
        const sp = 0.01 + hash01(i, 3) * 0.018;
        const u = (hash01(i, 1) + t * sp) % 1;
        const py = top + u * span * 0.92;
        const v = 0.12 + 0.76 * ((hash01(i, 2) + Math.sin(t * (0.25 + hash01(i, 4) * 0.3) + i) * 0.06 + 1) % 1);
        const px = x + w * v + (py - d.y - h * 0.5) * SUN_DRIFT;
        const a = Math.sin(u * Math.PI) * (0.45 + 0.35 * Math.sin(t * (1 + hash01(i, 5)) + i * 1.7));
        if (a <= 0.03) continue;
        const rr = 0.5 + hash01(i, 6) * 0.9;
        const g = ctx.createRadialGradient(px, py, 0, px, py, rr * 2.2);
        g.addColorStop(0, `rgba(255,250,232,${a})`);
        g.addColorStop(0.4, `rgba(255,246,220,${a * 0.5})`);
        g.addColorStop(1, 'rgba(255,246,220,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px - rr * 2.2, py - rr * 2.2, rr * 4.4, rr * 4.4);
      }
    }
    ctx.restore();
  }

  /**
   * Lamp-lit night: the scene is multiplied by a light map (deep indigo
   * ambient, darker toward the corners, warm pools under the lamps, cool
   * moonlight by night windows), then each bulb gets a small glow.
   */
  private drawNight(ctx: Ctx): void {
    const r = this.layerRect;
    const map = this.nightLightMap();
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(map, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    ctx.globalCompositeOperation = 'screen';
    for (const d of this.decor()) {
      if (d.type !== 'pendant') continue;
      const g = ctx.createRadialGradient(d.x, d.y + 4, 0, d.x, d.y + 4, 42);
      g.addColorStop(0, 'rgba(255,226,170,0.55)');
      g.addColorStop(0.4, 'rgba(255,200,140,0.18)');
      g.addColorStop(1, 'rgba(255,200,140,0)');
      ctx.fillStyle = g;
      ctx.fillRect(d.x - 42, d.y - 38, 84, 84);
    }
    ctx.restore();
  }

  private nightMap: HTMLCanvasElement | null = null;
  private nightMapKey = '';

  /** The night light map, painted once per room and layout at low resolution. */
  private nightLightMap(): HTMLCanvasElement {
    const r = this.layerRect;
    const key = `${this.layerKey}`;
    if (this.nightMap && this.nightMapKey === key) return this.nightMap;
    const k = 0.5;
    const c = this.nightMap ?? document.createElement('canvas');
    c.width = Math.max(1, Math.ceil((r.x1 - r.x0) * k));
    c.height = Math.max(1, Math.ceil((r.y1 - r.y0) * k));
    const g = c.getContext('2d')!;
    g.setTransform(k, 0, 0, k, -r.x0 * k, -r.y0 * k);
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    const [ar, ag, ab] = Renderer.nightAmbient;
    g.fillStyle = `rgb(${ar},${ag},${ab})`;
    g.fillRect(r.x0, r.y0, w, h);
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const vg = g.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.72);
    vg.addColorStop(0, 'rgba(54,50,112,0)');
    vg.addColorStop(1, 'rgba(54,50,112,0.6)');
    g.fillStyle = vg;
    g.fillRect(r.x0, r.y0, w, h);
    for (const d of this.decor()) {
      if (d.type === 'pendant') {
        const lx = d.x;
        const ly = d.y + 30;
        const rad = 265;
        const lg = g.createRadialGradient(lx, ly, 0, lx, ly, rad);
        lg.addColorStop(0, 'rgba(255,238,206,1)');
        lg.addColorStop(0.16, 'rgba(255,218,176,0.92)');
        lg.addColorStop(0.45, 'rgba(214,168,160,0.5)');
        lg.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
        g.fillStyle = lg;
        g.fillRect(lx - rad, ly - rad, rad * 2, rad * 2);
      } else if (d.type === 'window' && d.variant === 3) {
        const wx = d.x;
        const wy = d.y + (d.h ?? 120) / 2;
        const rad = 130;
        const wg = g.createRadialGradient(wx, wy, 0, wx, wy, rad);
        wg.addColorStop(0, 'rgba(170,184,240,0.75)');
        wg.addColorStop(1, 'rgba(170,184,240,0)');
        g.fillStyle = wg;
        g.fillRect(wx - rad, wy - rad, rad * 2, rad * 2);
      }
    }
    this.nightMap = c;
    this.nightMapKey = key;
    return c;
  }

  private poseFor(cat: Cat, v: CatView): CatPose {
    const s = this.session!;
    const b = cat.body;
    let expression: Expression = 'open';
    let look = 0;
    let wiggle: CatPose['wiggle'] = null;
    const seat = cat.seat;
    if (cat.grabbed) {
      // startled when scooped up; held still by the scruff, it goes calm
      expression = cat.heldStill > 40 ? 'content' : 'wide';
      const g = b.grab;
      if (g && cat.heldStill <= 40) look = clamp((g.tx - b.cx) / (b.p.radius * 2), -1, 1);
    } else if (cat.sinceTouch < 22) expression = 'squint';
    else if (b.airborneFrames > 6) expression = 'wide';
    else if (seat) expression = seat.cozy.score >= 78 ? 'happy' : 'content';
    else if (cat.settled > 30 && b.breed.look.persona === 'sleepy') expression = 'sleepy';
    else look = Math.sin(v.t * 0.5 + cat.index) > 0.85 ? 0.8 : Math.sin(v.t * 0.5 + cat.index) < -0.9 ? -0.8 : 0;
    const tubeFace = this.stage?.inTube?.(cat);
    if (tubeFace) {
      expression = tubeFace;
      look = 0;
    } else {
      const f = this.stage?.face?.(cat);
      if (f) {
        expression = f.expression;
        if (f.look !== undefined) look = f.look;
        wiggle = f.wiggle ?? null;
      }
    }
    const k = this.containerFor(cat);
    const c = k >= 0 ? s.containers[k] : null;
    const rim = c ? { x0: c.opening!.x0, x1: c.opening!.x1, y: c.opening!.y, lip: 7 * c.scale } : null;
    const resting = !cat.grabbed && b.airborneFrames < 2 && cat.settled > 6;
    // where the finger holds it: the middle of the pinched skin
    let pinch: { x: number; y: number } | null = null;
    const g = cat.grabbed ? b.grab : null;
    if (g) {
      let px = 0;
      let py = 0;
      let ws = 0;
      for (let m = 0; m < g.count; m++) {
        const w = g.weights[m];
        px += b.x[g.nodes[m]] * w;
        py += b.y[g.nodes[m]] * w;
        ws += w;
      }
      pinch = { x: px / ws, y: py / ws };
    }
    return {
      expression,
      look,
      wiggle,
      rim,
      seated: !!seat,
      resting,
      purr: seat ? 0.6 : 0,
      grabbed: cat.grabbed,
      glow: 0,
      pinch,
    };
  }

  /** The container a cat is sitting in or pouring into (-1 = none). */
  private containerFor(cat: Cat): number {
    if (cat.seat) return cat.seat.container;
    let best = -1;
    let most = 0.02;
    for (let k = 0; k < cat.overlaps.length; k++) {
      if (cat.overlaps[k].inside > most) {
        most = cat.overlaps[k].inside;
        best = k;
      }
    }
    return best;
  }

  private drawCatShadow(ctx: Ctx, cat: Cat): void {
    const s = this.session!;
    if (cat.seat) return;
    const fp = catFootprint(cat.body);
    // find the surface below
    // the nearest surface below it (the floor, or whatever it's over)
    let ground = Infinity;
    for (const st of s.world.statics) {
      if (fp.cx < st.minX || fp.cx > st.maxX) continue;
      if (st.minY >= fp.maxY - 6 && st.minY < ground) ground = st.minY;
    }
    if (ground === Infinity) ground = FLOOR_Y;
    const hgt = Math.max(0, ground - fp.maxY);
    const w = (fp.maxX - fp.minX) * 0.5;
    const a = 0.3 * clamp(1 - hgt / 220, 0.12, 1);
    // a tight contact shadow while touching down, a soft blur while in the air
    const touch = clamp(1 - hgt / 10, 0, 1);
    softShadow(ctx, fp.cx + hgt * 0.08, ground + 1, w * (1.05 + hgt / 300), 5 + hgt * 0.012, a * (0.65 + 0.35 * (1 - touch)));
    if (touch > 0) contactShadow(ctx, fp.cx, ground, w * 0.86, 0.3 * touch, 0.6);
  }

  private drawPurr(ctx: Ctx, cat: Cat): void {
    const v = this.view(cat);
    const amp = 0.55;
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
