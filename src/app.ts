// App controller: owns the session, the renderer, input and the HUD.

import { HANDMADE } from './game/rooms';
import { Session, type GameEvent } from './game/session';
import type { RoomDef } from './game/room';
import { FRAME_DT } from './physics/world';
import { Renderer } from './render/renderer';
import { PALETTE } from './render/paint';
import { faceSVG } from './ui/faces';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

interface Gesture {
  id: number;
  catIndex: number;
  sx: number;
  sy: number;
  t0: number;
  dragging: boolean;
  lx: number;
  ly: number;
  lt: number;
  vx: number;
  vy: number;
}

export class App {
  readonly canvas = $<HTMLCanvasElement>('game');
  readonly renderer = new Renderer(this.canvas);
  session!: Session;
  private acc = 0;
  private last = 0;
  private gesture: Gesture | null = null;
  private lastFaces = '';

  async start(): Promise<void> {
    this.bindInput();
    this.bindButtons();
    this.loadRoom(HANDMADE[0]);
    $('loading').classList.add('done');
    requestAnimationFrame((t) => this.frame(t));
  }

  loadRoom(def: RoomDef): void {
    this.session = new Session(def);
    this.renderer.setRoom(this.session);
    $('roomName').textContent = def.name;
    $('roomSub').textContent = def.subtitle ?? '';
    $('parCount').textContent = def.par ? String(def.par) : '–';
    this.lastFaces = '';
    this.updateHud();
  }

  private frame(t: number): void {
    const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : FRAME_DT;
    this.last = t;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FRAME_DT && steps < 4) {
      this.session.step();
      this.acc -= FRAME_DT;
      steps++;
    }
    if (steps === 4) this.acc = 0;
    this.handleEvents(this.session.drainEvents());
    this.renderer.render(dt);
    this.updateHud();
    requestAnimationFrame((tt) => this.frame(tt));
  }

  private handleEvents(events: GameEvent[]): void {
    const r = this.renderer;
    for (const e of events) {
      switch (e.t) {
        case 'seat': {
          const v = r.view(e.cat);
          const good = e.cozy.score >= 92;
          r.label(v.hx, v.hy - 26, e.cozy.label, good ? PALETTE.gold : e.cozy.score >= 78 ? PALETTE.ginger : '#9A93AE');
          if (good) r.hearts(v.hx, v.hy - 10);
          break;
        }
        case 'impact':
          if (e.speed > 300) {
            const fp = e.cat.body;
            let maxY = -Infinity;
            let sx = 0;
            for (let i = 0; i < fp.n; i++) {
              if (fp.y[i] > maxY) maxY = fp.y[i];
              sx += fp.x[i];
            }
            r.puff(sx / fp.n, maxY + 2, 5);
          }
          break;
        default:
          break;
      }
    }
  }

  private updateHud(): void {
    const s = this.session;
    const key = s.cats.map((c) => `${c.breed}:${c.seat ? 1 : 0}`).join('|') + (s.complete ? '!' : '');
    if (key !== this.lastFaces) {
      this.lastFaces = key;
      $('faces').innerHTML = s.cats
        .map((c) => `<span class="face ${c.seat ? 'on' : ''} ${s.complete ? 'gold' : ''}" title="${c.name}">${faceSVG(c.breed, { mood: c.seat ? 'happy' : 'open', size: 26 })}</span>`)
        .join('');
    }
    $('pawCount').textContent = String(s.paws);
    ($('undoBtn') as HTMLButtonElement).disabled = !s.canUndo;
  }

  private bindButtons(): void {
    $('undoBtn').addEventListener('click', () => this.session.undo());
    $('hintBtn').addEventListener('click', () => {
      const h = this.session.hint();
      if (!h) return;
      const v = this.renderer.view(h.cat);
      this.renderer.hint = { fromX: v.hx, fromY: v.hy + 10, toX: h.tx, toY: h.ty, t: 0 };
    });
  }

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (this.gesture) return;
      const w = this.renderer.screenToWorld(e.offsetX, e.offsetY);
      const cat = this.session.catAt(w.x, w.y, 18 / this.renderer.scale + 6);
      if (!cat) return;
      c.setPointerCapture(e.pointerId);
      this.gesture = { id: e.pointerId, catIndex: cat.index, sx: e.offsetX, sy: e.offsetY, t0: performance.now(), dragging: false, lx: w.x, ly: w.y, lt: performance.now(), vx: 0, vy: 0 };
    });
    c.addEventListener('pointermove', (e) => {
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      const w = this.renderer.screenToWorld(e.offsetX, e.offsetY);
      const now = performance.now();
      if (!g.dragging && (Math.hypot(e.offsetX - g.sx, e.offsetY - g.sy) > 7 || now - g.t0 > 180)) {
        const start = this.renderer.screenToWorld(g.sx, g.sy);
        this.session.beginGrab(this.session.cats[g.catIndex], start.x, start.y);
        g.dragging = true;
        c.classList.add('grabbing');
      }
      if (g.dragging) {
        const dt = Math.max(1, now - g.lt) / 1000;
        g.vx = g.vx * 0.6 + ((w.x - g.lx) / dt) * 0.4;
        g.vy = g.vy * 0.6 + ((w.y - g.ly) / dt) * 0.4;
        g.lx = w.x;
        g.ly = w.y;
        g.lt = now;
        this.session.moveGrab(w.x, w.y, g.vx, g.vy);
      }
    });
    const end = (e: PointerEvent): void => {
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      this.gesture = null;
      c.classList.remove('grabbing');
      if (g.dragging) this.session.endGrab();
      else if (e.type === 'pointerup') {
        const w = this.renderer.screenToWorld(e.offsetX, e.offsetY);
        this.session.boop(this.session.cats[g.catIndex], w.x, w.y);
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => this.renderer.resize());
  }
}
