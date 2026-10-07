// App controller: the house's home room (the frame loop, input, the menu and
// overlays, sound settings; the house itself is house/home.ts), the
// Playground up in the clouds (playground/playground.ts: the same canvas, the
// same cats), and Cat Jar and Cat Drop, mounted over the page while they're
// played.

import { AudioEngine } from './audio/audio';
import { Session, type GameEvent } from './game/session';
import { BREEDS, type BreedId } from './physics/breeds';
import { FRAME_DT } from './physics/world';
import { Home } from './house/home';
import { NAMES, type GameId } from './house/house';
import type { ExtraFloor } from './house/layout';
import { pageStyles } from './pageStyles';
import { Playground } from './playground/playground';
import { mountDrop } from './proto/drop/mount';
import { mountJar } from './proto/jar/mount';
import { loadBest } from './proto/kit';
import type { Mounted, ProtoShell, Settings } from './proto/shell';
import { PALETTE } from './render/paint';
import { Renderer } from './render/renderer';
import { loadSettings, writeSettings } from './settings';
import { faceSVG } from './ui/faces';
import { clamp } from './util/math';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

interface Gesture {
  id: number;
  catIndex: number;
  sx: number;
  sy: number;
  t0: number;
  dragging: boolean;
  /** The finger's recent path while carrying (screen px, and when, ms), read back at each physics step. */
  ts: number[];
  xs: number[];
  ys: number[];
}

/**
 * How far behind the finger a carried cat's hand is read (ms). Touches arrive
 * in uneven bunches, not one per physics step; read a moment behind, the
 * finger's path is always there to be read between two touches, so every
 * step moves the hand on as smoothly as the finger really moved.
 */
const FINGER_LAG = 24;

export class App {
  readonly canvas = $<HTMLCanvasElement>('game');
  readonly renderer = new Renderer(this.canvas);
  readonly audio = new AudioEngine();
  readonly settings: Settings = loadSettings();
  /** What's on screen: the house, the Playground, or a game over the house. */
  kind: 'home' | 'playground' | GameId = 'home';
  session!: Session;
  private acc = 0;
  private last = 0;
  private gesture: Gesture | null = null;
  private lastFaces = '';
  private zTimer = 0;
  private paused = false;
  readonly home: Home;
  readonly playground: Playground;
  /** Cat Jar or Cat Drop, while one is being played (the page is hidden). */
  private away: { game: GameId; mounted: Mounted; host: HTMLElement } | null = null;
  /** A tap on one of the house's capped tubes (it offers to open the floor it goes to). */
  private lockTap: { id: number; floor: ExtraFloor; sx: number; sy: number } | null = null;
  /** Fingers the house or the Playground has (looking about, zooming, putting something somewhere). */
  private placeFingers = new Set<number>();

  constructor() {
    const app = this;
    this.home = new Home(
      {
        renderer: this.renderer,
        audio: this.audio,
        get session() {
          return app.session;
        },
        openOverlay: (html, onBind) => this.openOverlay(html, onBind),
        closeOverlay: () => this.closeOverlay(),
        overlayOpen: () => !$('overlay').classList.contains('hidden'),
        busy: () => !!this.gesture,
        play: (g) => this.play(g),
        rebuild: () => {
          this.home.leave();
          this.goHome();
        },
        carryFinger: () => this.carryFinger(),
        playground: () => this.openPlayground(),
        toSky: (b) => this.goPlayground([b], b),
      },
      { jarBest: loadBest('catjar.best'), dropBest: loadBest('catdrop.best') },
    );
    this.playground = new Playground({
      renderer: this.renderer,
      audio: this.audio,
      get session() {
        return app.session;
      },
      openOverlay: (html, onBind) => this.openOverlay(html, onBind),
      closeOverlay: () => this.closeOverlay(),
      overlayOpen: () => !$('overlay').classList.contains('hidden'),
      carryFinger: () => this.carryFinger(),
      home: () => this.leavePlayground(),
    });
  }

  /** Where the finger carrying a cat is on screen (null if no cat is being carried). */
  private carryFinger(): { x: number; y: number } | null {
    const g = this.gesture;
    if (!g || !g.dragging || !g.xs.length) return null;
    return { x: g.xs[g.xs.length - 1], y: g.ys[g.ys.length - 1] };
  }

  /** Up in the clouds? */
  private get inSky(): boolean {
    return this.kind === 'playground';
  }

  async start(): Promise<void> {
    // the page never scrolls (a tall card scrolled into view would drag the room with it)
    const root = $('app');
    root.addEventListener('scroll', () => {
      if (root.scrollTop || root.scrollLeft) root.scrollTo(0, 0);
    });
    this.bindInput();
    this.bindButtons();
    this.audio.setSfxEnabled(this.settings.sfx);
    this.audio.setMusicEnabled(this.settings.music);
    // Music begins on the first tap (browsers need a gesture before audio).
    this.audio.startMusic();
    document.addEventListener('visibilitychange', () => {
      this.paused = document.hidden;
      this.last = 0;
    });
    // Home first; a link can go straight on into a game.
    this.goHome();
    const game = new URLSearchParams(location.search).get('game');
    if (game === 'jar' || game === 'drop') this.openGame(game);
    $('loading').classList.add('done');
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------------------
  // The house

  /** The home room, with everyone who lives here. */
  goHome(): void {
    const def = this.home.room();
    this.closeOverlay();
    this.audio.stopAllPurrs();
    this.session = new Session(def, this.home.sessionOptions);
    this.renderer.setRoom(this.session);
    this.gesture = null;
    $('roomName').textContent = def.name;
    this.lastFaces = '';
    this.updateHud();
    this.home.enter();
    // (the Playground's tin says it's new till you've been up)
    const note = document.querySelector<HTMLElement>('#homeBar [data-act=playground] .tin-note');
    if (note) note.textContent = this.playground.save.cats.length ? '' : 'new!';
  }

  // ---------------------------------------------------------------------------
  // The Playground

  /** Who's coming, and then up to the Playground. */
  openPlayground(): void {
    this.audio.unlock();
    this.audio.click();
    this.playground.askWho(this.home.house.residents, (who) => this.goPlayground(who));
  }

  /** Up to the Playground with these cats (the house waits): `arriving`, one that's come up the sky tube, drops in from above. */
  goPlayground(who: BreedId[], arriving: BreedId | null = null): void {
    if (this.away || !who.length) return;
    this.closeOverlay();
    this.audio.stopAllPurrs();
    this.home.leave();
    this.gesture = null;
    this.lockTap = null;
    this.placeFingers.clear();
    this.canvas.classList.remove('grabbing');
    this.playground.who = who;
    this.session = new Session(this.playground.room(), this.playground.sessionOptions);
    this.renderer.setRoom(this.session);
    this.kind = 'playground';
    this.lastFaces = '';
    this.playground.enter(arriving);
  }

  /** Back home from the Playground. */
  leavePlayground(): void {
    if (!this.inSky) return;
    this.playground.leave();
    this.kind = 'home';
    this.placeFingers.clear();
    this.goHome();
  }

  /** Into a game from the home room. */
  play(game: GameId): void {
    this.audio.unlock();
    this.audio.click();
    this.openGame(game);
  }

  /** Cat Jar or Cat Drop takes over the screen; the page waits underneath. */
  openGame(game: GameId): void {
    if (this.away) return;
    this.closeOverlay();
    this.audio.stopAllPurrs();
    this.home.leave();
    this.gesture = null;
    this.lockTap = null;
    $('app').style.display = 'none';
    pageStyles(false);
    const host = document.createElement('div');
    host.className = 'game-host';
    document.body.appendChild(host);
    const shell: ProtoShell = {
      audio: this.audio,
      settings: this.settings,
      setSetting: (k, on) => this.setSetting(k, on),
      home: () => this.closeGame(),
      report: (r) => this.home.report(r),
    };
    const mounted = game === 'jar' ? mountJar(host, shell) : mountDrop(host, shell);
    this.away = { game, mounted, host };
    this.kind = game;
  }

  /** Back home from Cat Jar or Cat Drop. */
  closeGame(): void {
    const a = this.away;
    if (!a) return;
    this.away = null;
    this.kind = 'home';
    a.mounted.unmount();
    a.host.remove();
    pageStyles(true);
    $('app').style.display = '';
    this.last = 0;
    this.goHome();
  }

  private setSetting(k: keyof Settings, on: boolean): void {
    this.settings[k] = on;
    writeSettings(this.settings);
    if (k === 'sfx') this.audio.setSfxEnabled(on);
    else this.audio.setMusicEnabled(on);
  }

  // ---------------------------------------------------------------------------
  // Loop

  private frame(t: number): void {
    requestAnimationFrame((tt) => this.frame(tt));
    if (this.paused || this.away) return;
    const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : FRAME_DT;
    this.last = t;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FRAME_DT && steps < 4) {
      // (the finger, where it was when this step ends)
      this.feedFinger(t - (this.acc - FRAME_DT) * 1000);
      this.session.rememberPositions();
      this.session.step();
      if (this.inSky) this.playground.step();
      else this.home.step();
      this.acc -= FRAME_DT;
      steps++;
    }
    if (steps === 4) this.acc = 0;
    this.handleEvents(this.session.drainEvents());
    if (this.inSky) this.playground.tick(dt);
    else this.home.tick(dt);
    this.tickAmbient(dt);
    // Draw between the last two physics steps: smooth on 90/120 Hz screens
    // and through uneven frame times.
    this.session.beginLerp(Math.min(1, this.acc / FRAME_DT), dt);
    try {
      this.renderer.render(dt);
    } finally {
      this.session.endLerp();
    }
    this.updateHud();
  }

  /** Move the hand carrying a cat to where the finger was FINGER_LAG ms before `at`. */
  private feedFinger(at: number): void {
    const g = this.gesture;
    if (!g || !g.dragging || !this.session.grabbed) return;
    const { ts, xs, ys } = g;
    const n = ts.length;
    if (n === 0) return;
    const q = at - FINGER_LAG;
    let x = xs[n - 1];
    let y = ys[n - 1];
    if (q <= ts[0]) {
      x = xs[0];
      y = ys[0];
    } else if (q < ts[n - 1]) {
      let k = n - 2;
      while (k > 0 && ts[k] > q) k--;
      const u = ts[k + 1] > ts[k] ? (q - ts[k]) / (ts[k + 1] - ts[k]) : 1;
      x = xs[k] + (xs[k + 1] - xs[k]) * u;
      y = ys[k] + (ys[k + 1] - ys[k]) * u;
    }
    const w = this.renderer.screenToWorld(x, y);
    // (anywhere on the floor it's on: see Home.carryBox)
    this.session.moveGrab(w.x, w.y, 0, 0);
  }

  private handleEvents(events: GameEvent[]): void {
    const r = this.renderer;
    for (const e of events) {
      switch (e.t) {
        case 'grab':
          this.audio.grab(BREEDS[e.cat.breed].voice.pitch, BREEDS[e.cat.breed].look.persona === 'sleepy');
          break;
        case 'boop': {
          this.audio.boop(BREEDS[e.cat.breed].voice.pitch);
          const v = r.view(e.cat);
          r.emit('note', v.hx + 14, v.hy - 8, { vy: -30, life: 0.9, size: 15, color: PALETTE.ink, text: '?' });
          break;
        }
        case 'pour': {
          const b = BREEDS[e.cat.breed];
          this.audio.glorp(b.voice.pitch, clamp((b.physics.radius - 22) / 22, 0, 1), clamp(b.physics.viscosity / 26, 0, 1));
          break;
        }
        case 'impact': {
          const size = clamp((e.cat.body.p.radius - 22) / 22, 0, 1);
          this.audio.impact(e.material, e.speed, size);
          if (e.speed > 320 && !e.container && !e.cat.grabbed) {
            const b = e.cat.body;
            let maxY = -Infinity;
            let sx = 0;
            for (let i = 0; i < b.n; i++) {
              if (b.y[i] > maxY) maxY = b.y[i];
              sx += b.x[i];
            }
            r.puff(sx / b.n, maxY + 2, 5);
          }
          break;
        }
        case 'unstuck': {
          // (a cat stuck fast, put down again somewhere clear: a puff where it was, and a boop)
          r.puff(e.x, e.y, 6);
          this.audio.boop(BREEDS[e.cat.breed].voice.pitch);
          break;
        }
        case 'seat': {
          // a cat who settles into the vase or the basket is happy about it
          // (not the ones settling back into their spots as you come home)
          if (!this.inSky && this.home.since > 1.5) {
            const v = r.view(e.cat);
            r.hearts(v.hx, v.hy - 12, 2);
            this.audio.seat(88);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private tickAmbient(dt: number): void {
    const s = this.session;
    // cats curled up in something purr
    for (const cat of s.cats) this.audio.setPurr(cat.body.id, cat.seat ? 0.32 : 0, BREEDS[cat.breed].purr);
    // sleepy cats snore little z's
    this.zTimer += dt;
    if (this.zTimer > 1.3) {
      this.zTimer = 0;
      for (const cat of s.cats) {
        if (!cat.seat && !cat.grabbed && cat.settled > 60 && BREEDS[cat.breed].look.persona === 'sleepy') {
          const v = this.renderer.view(cat);
          this.renderer.emit('z', v.hx + cat.body.p.radius * 0.6, v.hy - 4, { vy: -16, vx: 6, life: 2, size: 13 });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // HUD

  /** Everyone who lives here, in the top bar (tap for the cats card). */
  private updateHud(): void {
    // (up in the clouds, the top bar's the Playground's: see Playground.updateHud)
    if (this.inSky) return;
    const s = this.session;
    const key = `${s.cats.map((c) => c.breed).join('|')}:${this.home.catKey}:${this.home.house.arriving.length}`;
    if (key === this.lastFaces) return;
    this.lastFaces = key;
    // (and the cats on their way)
    const n = new Set([...s.cats.map((c) => c.breed), ...this.home.house.arriving]).size;
    $('roomSub').textContent = `${n} cat${n === 1 ? '' : 's'} live${n === 1 ? 's' : ''} here`;
    const faces = s.cats.map((c) => `<span class="face on" title="${NAMES[c.breed]}">${faceSVG(c.breed, { mood: 'happy', size: 24 })}</span>`).join('');
    $('faces').innerHTML = `<button class="home-cats" aria-label="Your cats">${faces}</button>`;
    $('faces').querySelector('button')!.addEventListener('click', () => {
      this.audio.click();
      this.home.showCats();
    });
  }

  // ---------------------------------------------------------------------------
  // Overlays

  private openOverlay(html: string, onBind?: (root: HTMLElement) => void): void {
    const o = $('overlay');
    o.innerHTML = html;
    o.classList.remove('hidden');
    onBind?.(o);
    o.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeOverlay()));
    o.onclick = (e) => {
      if (e.target === o) this.closeOverlay();
    };
  }

  closeOverlay(): void {
    const o = $('overlay');
    if (o.classList.contains('hidden')) return;
    o.classList.add('hidden');
    o.innerHTML = '';
    o.onclick = null;
    this.home.overlayClosed();
  }

  /** Sound and music switches. */
  private togglesHtml(): string {
    const st = this.settings;
    return `<div class="toggles">
          <button class="toggle" data-toggle="sfx" aria-pressed="${st.sfx}">Sound ${st.sfx ? 'on' : 'off'}</button>
          <button class="toggle" data-toggle="music" aria-pressed="${st.music}">Music ${st.music ? 'on' : 'off'}</button>
        </div>`;
  }

  private bindToggles(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('[data-toggle]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.toggle as keyof Settings;
        this.setSetting(k, !this.settings[k]);
        b.setAttribute('aria-pressed', String(this.settings[k]));
        b.textContent = `${k === 'sfx' ? 'Sound' : 'Music'} ${this.settings[k] ? 'on' : 'off'}`;
      }),
    );
  }

  /** The menu: your cat, the cats card, the shop, the two games, sound and music. */
  showMenu(): void {
    this.audio.click();
    if (this.inSky) {
      this.showSkyMenu();
      return;
    }
    const h = this.home.house;
    const best = (k: string): string => {
      const b = loadBest(k);
      return b > 0 ? `best ${b.toLocaleString('en-US')}` : 'not played yet';
    };
    const mine = h.cat;
    this.openOverlay(
      `<div class="card" role="dialog" aria-label="Menu">
        <h2>Home</h2>
        <p class="sub">${this.home.countLine()}</p>
        <div class="menu-list">
          <button class="menu-item" data-act="maker"><span class="mi-icon">🎨</span><span>${mine ? `Restyle ${mine.name}` : 'Make your own cat'}<small>${mine ? 'Coat, fur, size, squish…' : 'Your very own cat, to live here too'}</small></span></button>
          <button class="menu-item" data-act="cats"><span class="mi-icon">🐾</span><span>Your cats<small>Who lives here, and who's coming</small></span></button>
          <button class="menu-item" data-act="shop"><span class="mi-icon">🛍️</span><span>Shop<small>Perches and the rest of the house · ${h.treats} treats</small></span></button>
          <button class="menu-item" data-play="jar"><span class="mi-icon">🫙</span><span>Cat Jar<small>Two the same melt into a bigger cat · ${best('catjar.best')}</small></span></button>
          <button class="menu-item" data-play="drop"><span class="mi-icon">🛁</span><span>Cat Drop<small>Drop down the house, ahead of bath time · ${best('catdrop.best')}</small></span></button>
        </div>
        ${this.togglesHtml()}
        <div class="btns" style="margin-top:12px"><button class="btn" data-close>Back home</button></div>
      </div>`,
      (root) => {
        root.querySelector('[data-act=maker]')!.addEventListener('click', () => this.home.showMaker());
        root.querySelector('[data-act=cats]')!.addEventListener('click', () => this.home.showCats());
        root.querySelector('[data-act=shop]')!.addEventListener('click', () => this.home.showShop());
        root.querySelectorAll<HTMLElement>('[data-play]').forEach((b) =>
          b.addEventListener('click', () => {
            this.closeOverlay();
            this.play(b.dataset.play as GameId);
          }),
        );
        this.bindToggles(root);
      },
    );
  }

  /** Up in the clouds: home, everyone back on the respawn cloud, a clean sky. */
  private showSkyMenu(): void {
    const n = this.playground.save.pieces.length + this.playground.save.tubes.length;
    this.openOverlay(
      `<div class="card" role="dialog" aria-label="Menu">
        <h2>Playground</h2>
        <p class="sub">${n ? `${n} thing${n === 1 ? '' : 's'} built up here` : 'Nothing built up here yet: tap Build'}</p>
        <div class="menu-list">
          <button class="menu-item" data-act="home"><span class="mi-icon">🏠</span><span>Back home<small>The house, and everyone in it</small></span></button>
          <button class="menu-item" data-act="respawn"><span class="mi-icon">⭐</span><span>Respawn<small>Everyone back on the respawn cloud</small></span></button>
          <button class="menu-item" data-act="clear" ${n ? '' : 'disabled'}><span class="mi-icon">☁️</span><span>Clear the sky<small>Take away everything you've built</small></span></button>
        </div>
        <div class="pg-confirm hidden"><p>Take away all ${n} for good?</p><div class="btns"><button class="btn primary" data-act="clear-yes">Clear it all</button><button class="btn" data-act="clear-no">Keep it</button></div></div>
        ${this.togglesHtml()}
        <div class="btns" style="margin-top:12px"><button class="btn" data-close>Back</button></div>
      </div>`,
      (root) => {
        root.querySelector('[data-act=home]')!.addEventListener('click', () => this.leavePlayground());
        root.querySelector('[data-act=respawn]')!.addEventListener('click', () => {
          this.closeOverlay();
          this.playground.respawnAll();
        });
        const confirm = root.querySelector<HTMLElement>('.pg-confirm')!;
        root.querySelector('[data-act=clear]')!.addEventListener('click', () => confirm.classList.remove('hidden'));
        root.querySelector('[data-act=clear-no]')!.addEventListener('click', () => confirm.classList.add('hidden'));
        root.querySelector('[data-act=clear-yes]')!.addEventListener('click', () => {
          this.closeOverlay();
          this.playground.clearSky();
        });
        this.bindToggles(root);
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Input

  private bindButtons(): void {
    $('menuBtn').addEventListener('click', () => {
      this.audio.unlock();
      this.showMenu();
    });
    window.addEventListener('keydown', (e) => {
      // Cat Jar and Cat Drop have keys of their own
      if (this.away) return;
      this.audio.unlock();
      if (e.key === 'Escape') this.closeOverlay();
    });
  }

  private bindInput(): void {
    const c = this.canvas;
    const pos = (e: MouseEvent): { x: number; y: number } => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    // (a pointer the browser doesn't count as down, as a test's can be, can't be captured: no matter)
    const capture = (id: number): void => {
      try {
        c.setPointerCapture(id);
      } catch {
        // (it still gets its moves while it's over the canvas)
      }
    };
    c.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      if (this.gesture) return;
      const p = pos(e);
      const w = this.renderer.screenToWorld(p.x, p.y);
      let cat = this.session.catAt(w.x, w.y, 18 * this.renderer.unitsPerPx + 6);
      if (this.inSky) {
        // (a cat in a tube or mid-leap can't be picked up, nor any while something's being placed; and a second finger is a pinch)
        if (cat && (!this.playground.canTouch(cat) || this.playground.placing || this.placeFingers.size)) cat = null;
        if (!cat) {
          if (this.playground.pointerDown(e.pointerId, p.x, p.y, w.x, w.y)) {
            this.placeFingers.add(e.pointerId);
            capture(e.pointerId);
          }
          return;
        }
        capture(e.pointerId);
        this.gesture = { id: e.pointerId, catIndex: cat.index, sx: p.x, sy: p.y, t0: performance.now(), dragging: false, ts: [], xs: [], ys: [] };
        return;
      }
      // no picking up a cat that's in a tube, or while a perch is being put
      // somewhere; and a tap on the yarn or the present beside a cat (not on the cat itself) is for them
      if (cat && (!this.home.canTouch(cat) || this.home.placing || ((this.home.yarnAt(w.x, w.y) || this.home.giftAt(w.x, w.y)) && !this.session.catAt(w.x, w.y, 0)))) cat = null;
      if (!cat) {
        // the cats' present, opened; a scrap broken up, the yarn batted
        if (this.home.openGiftAt(w.x, w.y)) return;
        if (this.home.tapThing(w.x, w.y)) return;
        // a tap on a capped tube offers to open the floor it goes to; a drag scrolls the house
        const floor = this.home.lockAt(w.x, w.y);
        if (floor) this.lockTap = { id: e.pointerId, floor, sx: p.x, sy: p.y };
        if (this.home.pointerDown(e.pointerId, p.x, p.y, w.x, w.y)) {
          this.placeFingers.add(e.pointerId);
          capture(e.pointerId);
        }
        return;
      }
      capture(e.pointerId);
      this.gesture = { id: e.pointerId, catIndex: cat.index, sx: p.x, sy: p.y, t0: performance.now(), dragging: false, ts: [], xs: [], ys: [] };
    });
    c.addEventListener('pointermove', (e) => {
      if (this.placeFingers.has(e.pointerId)) {
        const p = pos(e);
        const w = this.renderer.screenToWorld(p.x, p.y);
        if (this.inSky) this.playground.pointerMove(e.pointerId, p.x, p.y, w.x, w.y);
        else this.home.pointerMove(e.pointerId, p.x, p.y, w.x, w.y);
        return;
      }
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      const p = pos(e);
      const now = performance.now();
      const cat = this.session.cats[g.catIndex];
      if (!cat) return;
      if (!g.dragging && (Math.hypot(p.x - g.sx, p.y - g.sy) > 7 || now - g.t0 > 180)) {
        const start = this.renderer.screenToWorld(g.sx, g.sy);
        // (a cat is carried about the floor it's on; up in the clouds, anywhere)
        this.session.grabBox = this.inSky ? this.playground.carryBox() : this.home.carryBox(cat);
        this.session.beginGrab(cat, start.x, start.y);
        g.dragging = true;
        c.classList.add('grabbing');
        // (the finger's path starts where it touched down, so the cat is
        // lifted from there smoothly rather than jumping to the finger)
        g.ts.push(g.t0);
        g.xs.push(g.sx);
        g.ys.push(g.sy);
      }
      if (g.dragging) {
        // (every touch the browser bunched into this event, each when it happened)
        const all = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        const shift = Math.abs(e.timeStamp - now) < 1000 ? 0 : now - e.timeStamp;
        for (const ev of all.length ? all : [e]) {
          const q = pos(ev);
          const t = ev.timeStamp + shift;
          if (g.ts.length && t < g.ts[g.ts.length - 1]) continue;
          g.ts.push(t);
          g.xs.push(q.x);
          g.ys.push(q.y);
        }
        while (g.ts.length > 2 && g.ts[g.ts.length - 1] - g.ts[0] > 250) {
          g.ts.shift();
          g.xs.shift();
          g.ys.shift();
        }
      }
    });
    const end = (e: PointerEvent): void => {
      if (this.placeFingers.has(e.pointerId)) {
        this.placeFingers.delete(e.pointerId);
        if (this.inSky) this.playground.pointerUp(e.pointerId);
        else this.home.pointerUp(e.pointerId);
      }
      const tap = this.lockTap;
      if (tap && tap.id === e.pointerId) {
        this.lockTap = null;
        const p = pos(e);
        if (e.type === 'pointerup' && Math.hypot(p.x - tap.sx, p.y - tap.sy) < 14) this.home.offerFloor(tap.floor);
        return;
      }
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      this.gesture = null;
      c.classList.remove('grabbing');
      const cat = this.session.cats[g.catIndex];
      if (!cat) return;
      if (g.dragging) {
        this.session.endGrab();
        // let go under a suction hood (or by a tube's mouth, up in the clouds): whoosh
        if (this.inSky) this.playground.released(cat);
        else this.home.released(cat);
      } else if (e.type === 'pointerup') {
        const p = pos(e);
        const w = this.renderer.screenToWorld(p.x, p.y);
        // (a hurt cat is fed a fish instead)
        if (this.inSky || !this.home.tapCat(cat)) this.session.boop(cat, w.x, w.y);
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    // a mouse wheel or a trackpad scrolls the house (and up in the clouds zooms, or looks about)
    c.addEventListener(
      'wheel',
      (e) => {
        if (this.away) return;
        e.preventDefault();
        const k = e.deltaMode === 1 ? 30 : 1;
        if (this.inSky) {
          const p = pos(e);
          this.playground.wheel(e.deltaX * k, e.deltaY * k, p.x, p.y, e.ctrlKey);
        } else this.home.wheel(e.deltaY * k);
      },
      { passive: false },
    );
    window.addEventListener('resize', () => this.renderer.resize());
  }
}
