// App controller: the house's home room and If It Fits (rooms, input, HUD,
// the "Fits & sits" reveal, results, menu, collection, sandbox, saving), and
// Cat Jar and Cat Drop, mounted over the page while they're played.

import { AudioEngine } from './audio/audio';
import { getDailyRoom } from './game/daily';
import { HANDMADE } from './game/rooms';
import type { RoomDef } from './game/room';
import { collectedCount, loadSave, recordDaily, recordSeats, writeSave, type SaveData } from './game/save';
import { Session, type Cat, type GameEvent, type RoomResult } from './game/session';
import { gesturesFor, runGesture } from './game/solver';
import { shareOrCopy, shareText } from './game/share';
import { BASE_BREEDS, BREED_ORDER, BREEDS, type BreedId } from './physics/breeds';
import { FRAME_DT } from './physics/world';
import { Home } from './house/home';
import type { GameId } from './house/house';
import { pageStyles } from './pageStyles';
import { mountDrop } from './proto/drop/mount';
import { mountJar } from './proto/jar/mount';
import { loadBest } from './proto/kit';
import type { Mounted, ProtoShell } from './proto/shell';
import { PALETTE } from './render/paint';
import { Renderer } from './render/renderer';
import { SANDBOX_ROOM, SANDBOX_THINGS, Sandbox, thingPreview } from './sandbox';
import { faceSVG } from './ui/faces';
import { catPortrait } from './ui/portraits';
import { localDateKey, msUntilTomorrow, prettyDate, roomNumber } from './util/date';
import { clamp } from './util/math';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

type Kind = 'home' | 'handmade' | 'daily' | 'sandbox';

interface Gesture {
  id: number;
  catIndex: number;
  thing: boolean;
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

interface Reveal {
  t: number;
  order: Cat[];
  goldAt: number[];
  done: boolean;
}

const REVEAL_PER_CAT = 1.25;
/** Highest a carried cat's grab point may go (world y), so it stays in view. */
const CARRY_TOP = 40;

export class App {
  readonly canvas = $<HTMLCanvasElement>('game');
  readonly renderer = new Renderer(this.canvas);
  readonly audio = new AudioEngine();
  save: SaveData = loadSave();
  session!: Session;
  kind: Kind = 'handmade';
  roomIndex = 0;
  dateKey = localDateKey();
  dailyDef: RoomDef | null = null;
  private dailyPromise: Promise<RoomDef> | null = null;
  private returnTo: { kind: Kind; index: number } = { kind: 'handmade', index: 0 };
  private acc = 0;
  private last = 0;
  private gesture: Gesture | null = null;
  private lastFaces = '';
  private reveal: Reveal | null = null;
  private sandbox: Sandbox | null = null;
  private coach: { step: number; t: number } | null = null;
  private zTimer = 0;
  private paused = false;
  private goldCount = 0;
  private lastResult: RoomResult | null = null;
  readonly home: Home;
  /** Cat Jar or Cat Drop, while one is being played (the page is hidden). */
  private away: { game: 'jar' | 'drop'; mounted: Mounted; host: HTMLElement } | null = null;
  /** A tap on one of the home room's ways into a game. */
  private portalTap: { id: number; game: GameId; sx: number; sy: number } | null = null;

  constructor() {
    const app = this;
    this.home = new Home(
      {
        renderer: this.renderer,
        audio: this.audio,
        get session() {
          return app.session;
        },
        fitsNote: () => this.fitsNote(),
        openOverlay: (html, onBind) => this.openOverlay(html, onBind),
        closeOverlay: () => this.closeOverlay(),
        overlayOpen: () => !$('overlay').classList.contains('hidden'),
        busy: () => !!this.gesture,
        play: (g, room) => this.play(g, room),
      },
      {
        fitsRooms: Object.keys(this.save.rooms).length + Object.keys(this.save.daily).length,
        fitsDone: Object.keys(this.save.rooms),
        jarBest: loadBest('catjar.best'),
        dropBest: loadBest('catdrop.best'),
      },
    );
  }

  async start(): Promise<void> {
    this.bindInput();
    this.bindButtons();
    this.audio.setSfxEnabled(this.save.settings.sfx);
    this.audio.setMusicEnabled(this.save.settings.music);
    // Music begins on the first tap (browsers need a gesture before audio).
    this.audio.startMusic();
    document.addEventListener('visibilitychange', () => {
      this.paused = document.hidden;
      this.last = 0;
    });
    const params = new URLSearchParams(location.search);
    const roomParam = params.get('room');
    const dailyParam = params.get('daily');
    const gameParam = params.get('game');
    if (dailyParam && /^\d{4}-\d{2}-\d{2}$/.test(dailyParam)) this.dateKey = dailyParam;
    // Home first; links can go straight to a room or a game.
    if (roomParam && HANDMADE[Number(roomParam) - 1]) {
      this.loadHandmade(Number(roomParam) - 1);
    } else if (params.get('sandbox') !== null) {
      this.enterSandbox();
    } else if (dailyParam) {
      await this.loadDaily();
    } else {
      this.goHome();
      if (gameParam === 'fits') await this.playFits();
      else if (gameParam === 'jar' || gameParam === 'drop') this.openGame(gameParam);
    }
    $('loading').classList.add('done');
    requestAnimationFrame((t) => this.frame(t));
    // Warm up today's room in the background.
    if (!this.dailyDef) this.prefetchDaily();
    // Roll over at midnight if left open.
    setTimeout(() => {
      this.dateKey = localDateKey();
      this.dailyDef = null;
      this.dailyPromise = null;
      this.prefetchDaily();
    }, msUntilTomorrow() + 2000);
  }

  // ---------------------------------------------------------------------------
  // The house

  /** The home room, with everyone who lives here. */
  goHome(): void {
    this.kind = 'home';
    const def = this.home.room();
    const n = def.cats.length + this.home.house.arriving.length;
    this.startRoom({ ...def, subtitle: `${n} cat${n === 1 ? '' : 's'} live${n === 1 ? 's' : ''} here` });
    this.home.enter();
  }

  /** Into a game from the home room (for If It Fits, maybe a particular room). */
  play(game: GameId, room?: string): void {
    this.audio.unlock();
    this.audio.click();
    const i = room ? HANDMADE.findIndex((r) => r.id === room) : -1;
    if (game === 'fits' && i >= 0 && this.save.tutorialDone) this.loadHandmade(i);
    else if (game === 'fits') void this.playFits();
    else this.openGame(game);
  }

  /** If It Fits: the guided kitchen first, then this morning's room, then the rooms not done yet. */
  async playFits(): Promise<void> {
    if (!this.save.tutorialDone) return this.loadHandmade(0);
    if (!this.save.daily[this.dateKey]) return this.loadDaily();
    const next = HANDMADE.findIndex((r) => !this.save.rooms[r.id]);
    if (next >= 0) this.loadHandmade(next);
    else await this.loadDaily();
  }

  /** One line about If It Fits for its button on the home screen. */
  private fitsNote(): string {
    if (!this.save.tutorialDone) return 'start here';
    return this.save.daily[this.dateKey] ? 'done today' : 'new room!';
  }

  /** Cat Jar or Cat Drop takes over the screen; the page waits underneath. */
  openGame(game: 'jar' | 'drop'): void {
    if (this.away) return;
    this.closeOverlay();
    this.closeDrawer();
    this.audio.stopAllPurrs();
    this.home.leave();
    this.gesture = null;
    this.portalTap = null;
    $('app').style.display = 'none';
    pageStyles(false);
    const host = document.createElement('div');
    host.className = 'game-host';
    document.body.appendChild(host);
    const shell: ProtoShell = {
      audio: this.audio,
      settings: this.save.settings,
      setSetting: (k, on) => this.setSetting(k, on),
      home: () => this.closeGame(),
      report: (r) => this.home.report(r),
    };
    const mounted = game === 'jar' ? mountJar(host, shell) : mountDrop(host, shell);
    this.away = { game, mounted, host };
  }

  /** Back home from Cat Jar or Cat Drop. */
  closeGame(): void {
    const a = this.away;
    if (!a) return;
    this.away = null;
    a.mounted.unmount();
    a.host.remove();
    pageStyles(true);
    $('app').style.display = '';
    this.last = 0;
    this.goHome();
  }

  /** Which game is on screen ('fits' covers the home room too). */
  get playing(): 'home' | 'fits' | 'jar' | 'drop' {
    return this.away ? this.away.game : this.kind === 'home' ? 'home' : 'fits';
  }

  private setSetting(k: 'sfx' | 'music', on: boolean): void {
    this.save.settings[k] = on;
    writeSave(this.save);
    if (k === 'sfx') this.audio.setSfxEnabled(on);
    else this.audio.setMusicEnabled(on);
  }

  // ---------------------------------------------------------------------------
  // Rooms

  private prefetchDaily(): Promise<RoomDef> {
    if (!this.dailyPromise) {
      this.dailyPromise = getDailyRoom(this.dateKey).then((d) => {
        this.dailyDef = d;
        return d;
      });
    }
    return this.dailyPromise;
  }

  async loadDaily(): Promise<void> {
    const loading = $('loading');
    if (!this.dailyDef) {
      loading.classList.remove('done');
      $('loading').querySelector('.loading-text')!.textContent = "Tidying this morning's room…";
    }
    const def = await this.prefetchDaily();
    loading.classList.add('done');
    this.kind = 'daily';
    this.startRoom({ ...def, subtitle: `Morning #${roomNumber(this.dateKey)} · ${prettyDate(this.dateKey)}` });
  }

  loadHandmade(i: number): void {
    this.kind = 'handmade';
    this.roomIndex = i;
    const def = HANDMADE[i];
    this.startRoom({ ...def, subtitle: def.subtitle ?? `Room ${i + 1} of ${HANDMADE.length}` });
  }

  /** Load any room definition (also used by tests and tools). */
  loadRoom(def: RoomDef): void {
    this.kind = 'handmade';
    this.startRoom(def);
  }

  private startRoom(def: RoomDef): void {
    if (this.kind !== 'sandbox') this.sandbox = null;
    const home = this.kind === 'home';
    if (!home) this.home.leave();
    this.closeOverlay();
    this.closeDrawer();
    this.audio.stopAllPurrs();
    this.session = new Session(def, { mode: this.kind === 'sandbox' || home ? 'sandbox' : 'puzzle' });
    this.renderer.paintExtra = home ? this.home.paint : null;
    this.renderer.setRoom(this.session);
    this.reveal = null;
    this.goldCount = 0;
    this.lastResult = null;
    this.gesture = null;
    $('roomName').textContent = def.name;
    $('roomSub').textContent = def.subtitle ?? '';
    $('parCount').textContent = def.par ? String(def.par) : '–';
    $('par').classList.toggle('hidden', this.kind === 'sandbox' || home);
    $('faces').classList.toggle('hidden', this.kind === 'sandbox');
    $('tray').classList.toggle('hidden', this.kind === 'sandbox' || home);
    $('sandboxTray').classList.toggle('hidden', this.kind !== 'sandbox');
    $('homeBtn').classList.toggle('hidden', home);
    $('topbar').classList.toggle('with-home', !home);
    $('tray').classList.remove('faded');
    $('topbar').classList.remove('faded');
    this.lastFaces = '';
    this.coach = def.tutorial && !this.save.tutorialDone ? { step: 0, t: 0 } : null;
    this.setCoach(null);
    this.updateHud();
  }

  restart(): void {
    if (this.kind === 'daily' && this.dailyDef) this.startRoom({ ...this.session.def });
    else this.startRoom({ ...this.session.def });
  }

  enterSandbox(): void {
    if (this.kind !== 'sandbox') this.returnTo = { kind: this.kind, index: this.roomIndex };
    this.kind = 'sandbox';
    this.startRoom(SANDBOX_ROOM);
    this.sandbox = new Sandbox(this.session, this.renderer);
    this.toast('Pour any cat into anything, then take a photo.');
  }

  exitSandbox(): void {
    this.sandbox = null;
    if (this.returnTo.kind === 'home') this.goHome();
    else if (this.returnTo.kind === 'daily') void this.loadDaily();
    else this.loadHandmade(this.returnTo.index);
  }

  /** Test hook: replay the room's solver plan (synchronously, frame-exact). */
  autoplay(): number {
    let seated = 0;
    for (const step of this.session.def.plan ?? []) {
      const cat = this.session.cats[step.cat];
      if (!cat || cat.seat) continue;
      cat.body.computeCentroid();
      runGesture(
        this.session,
        step.cat,
        { kind: step.kind, gx: cat.body.cx + step.gx, gy: cat.body.cy + step.gy, tx: step.tx, ty: step.ty, move: 24, hold: step.hold, tol: 0.3, wx: step.wx, wy: step.wy },
        step.container,
      );
      // Physics is chaotic: if the replay missed, play it like the solver would.
      for (const g of cat.seat ? [] : gesturesFor(this.session, step.cat, step.container)) {
        if (cat.seat) break;
        this.session.undo();
        runGesture(this.session, step.cat, g, step.container);
      }
      if (cat.seat) seated++;
    }
    return seated;
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
      this.session.rememberPositions();
      this.session.step();
      this.acc -= FRAME_DT;
      steps++;
    }
    if (steps === 4) this.acc = 0;
    this.handleEvents(this.session.drainEvents());
    if (this.kind === 'home') this.home.tick(dt);
    this.tickReveal(dt);
    this.tickCoach(dt);
    this.tickAmbient(dt);
    // Draw between the last two physics steps: smooth on 90/120 Hz screens
    // and through uneven frame times.
    this.session.beginLerp(Math.min(1, this.acc / FRAME_DT));
    try {
      this.renderer.render(dt);
    } finally {
      this.session.endLerp();
    }
    this.updateHud();
  }

  private handleEvents(events: GameEvent[]): void {
    const r = this.renderer;
    for (const e of events) {
      switch (e.t) {
        case 'grab':
          this.audio.grab(BREEDS[e.cat.breed].voice.pitch, BREEDS[e.cat.breed].look.persona === 'sleepy');
          if (this.coach && this.coach.step === 0) this.renderer.hint = null;
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
          if (e.speed > 320 && !e.container) {
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
        case 'seat': {
          const v = r.view(e.cat);
          if (this.kind === 'home') {
            // at home a cat who settles in somewhere is just happy about it
            // (not the ones settling back into their spots as you come home)
            if (this.home.since > 1.5) {
              r.hearts(v.hx, v.hy - 12, 2);
              this.audio.seat(88);
            }
            break;
          }
          const snug = e.cozy.score >= 92;
          r.label(v.hx, v.hy - 28, e.cozy.label, snug ? '#D9A62E' : e.cozy.score >= 78 ? PALETTE.ginger : '#9A93AE');
          if (snug) r.hearts(v.hx, v.hy - 12);
          this.audio.seat(e.cozy.score);
          if (this.coach && this.coach.step <= 1) this.coach = { step: 2, t: 0 };
          break;
        }
        case 'undo':
          this.audio.undo();
          break;
        case 'complete':
          this.beginReveal();
          break;
        default:
          break;
      }
    }
  }

  private tickAmbient(dt: number): void {
    const s = this.session;
    // purrs: seated cats purr; the reveal swells them
    for (const cat of s.cats) {
      let level = cat.seat ? 0.32 : 0;
      if (this.reveal && cat.seat) {
        const i = this.reveal.order.indexOf(cat);
        const focusT = this.reveal.t - 0.5 - i * REVEAL_PER_CAT;
        level = focusT > 0 ? (this.reveal.done ? 0.7 : focusT < REVEAL_PER_CAT ? 1 : 0.6) : 0.35;
      }
      this.audio.setPurr(cat.body.id, level, BREEDS[cat.breed].purr);
    }
    // sleepy chonks snore little z's
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
  // "Fits & sits": the reveal pan

  private beginReveal(): void {
    const s = this.session;
    const order = [...s.cats].sort((a, b) => a.body.cx - b.body.cx);
    this.reveal = { t: 0, order, goldAt: [], done: false };
    $('tray').classList.add('faded');
    this.setCoach(null);
    this.renderer.hint = null;
    this.audio.reveal();
    this.recordResult();
  }

  private tickReveal(dt: number): void {
    const rv = this.reveal;
    if (!rv) return;
    rv.t += dt;
    const r = this.renderer;
    const n = rv.order.length;
    const quick = r.reducedMotion;
    const endT = 0.5 + n * REVEAL_PER_CAT;
    if (!quick && rv.t < endT) {
      const i = clamp(Math.floor((rv.t - 0.5) / REVEAL_PER_CAT), 0, n - 1);
      const cat = rv.order[i];
      const v = r.view(cat);
      r.focus(v.hx, v.hy + cat.body.p.radius * 0.4, 1.6);
      r.glowTarget = 0.35 + 0.4 * (i / Math.max(1, n - 1));
      const localT = rv.t - 0.5 - i * REVEAL_PER_CAT;
      if (localT > 0.45 && this.goldCount <= i) {
        this.goldCount = i + 1;
        r.hearts(v.hx, v.hy - 14, 3, PALETTE.rose);
        r.emit('note', v.hx + 18, v.hy - 18, { vy: -24, life: 1.6, size: 16, color: PALETTE.ginger, text: '♪' });
      }
    } else if (!rv.done) {
      rv.done = true;
      this.goldCount = n;
      r.resetCamera();
      r.glowTarget = 1;
      const session = this.session;
      setTimeout(() => {
        if (this.session === session) this.showResults();
      }, quick ? 300 : 1100);
    }
  }

  private recordResult(): void {
    const res = this.session.results();
    this.lastResult = res;
    const fresh = recordSeats(
      this.save,
      res.cats.map((c) => ({ breed: c.breed, score: c.score })),
    );
    if (this.kind === 'handmade') {
      const id = this.session.def.id;
      const prev = this.save.rooms[id];
      this.save.rooms[id] = { best: Math.max(prev?.best ?? 0, res.cozy), paws: Math.min(prev?.paws ?? 999, res.paws) };
      if (this.session.def.tutorial) this.save.tutorialDone = true;
    } else if (this.kind === 'daily') {
      recordDaily(this.save, this.dateKey, { cozy: res.cozy, paws: res.paws, par: res.par ?? 0, faces: res.faces, name: this.session.def.name, number: roomNumber(this.dateKey) });
    }
    writeSave(this.save);
    if (fresh.length) {
      const names = fresh.map((b) => BREEDS[b].name).join(' & ');
      setTimeout(() => this.toast(`New in your collection: ${names}!`), 2400);
    }
    if (this.kind !== 'sandbox') this.home.report({ game: 'fits', room: this.session.def.id });
  }

  // ---------------------------------------------------------------------------
  // HUD

  private updateHud(): void {
    const s = this.session;
    if (this.kind === 'home') {
      // everyone who lives here, in the top bar (tap for the cats card)
      const key = `home:${s.cats.map((c) => c.breed).join('|')}`;
      if (key !== this.lastFaces) {
        this.lastFaces = key;
        const faces = s.cats.map((c) => `<span class="face on" title="${c.name} the ${BREEDS[c.breed].name}">${faceSVG(c.breed, { mood: 'happy', size: 24 })}</span>`).join('');
        $('faces').innerHTML = `<button class="home-cats" aria-label="Your cats">${faces}</button>`;
        $('faces').querySelector('button')!.addEventListener('click', () => {
          this.audio.click();
          this.home.showCats();
        });
      }
    } else if (this.kind !== 'sandbox') {
      const key = s.cats.map((c) => `${c.breed}:${c.seat ? 1 : 0}`).join('|') + `:${this.goldCount}`;
      if (key !== this.lastFaces) {
        this.lastFaces = key;
        const order = this.reveal ? this.reveal.order : s.cats;
        $('faces').innerHTML = s.cats
          .map((c) => {
            const gold = this.reveal ? order.indexOf(c) < this.goldCount : false;
            return `<span class="face ${c.seat ? 'on' : ''} ${gold ? 'gold' : ''}" title="${c.name} the ${BREEDS[c.breed].name}">${faceSVG(c.breed, { mood: c.seat ? 'happy' : 'open', size: 26 })}</span>`;
          })
          .join('');
      }
      $('pawCount').textContent = String(s.paws);
      $('par').classList.toggle('under', !!s.def.par && s.paws <= s.def.par && s.paws > 0);
      ($('undoBtn') as HTMLButtonElement).disabled = !s.canUndo;
    }
  }

  private setCoach(text: string | null): void {
    let el = document.querySelector<HTMLElement>('.coach');
    if (!text) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'coach';
      $('app').appendChild(el);
    }
    if (el.textContent !== text) el.textContent = text;
  }

  private tickCoach(dt: number): void {
    const c = this.coach;
    if (!c) return;
    c.t += dt;
    const s = this.session;
    if (s.complete) {
      // the reveal and its toasts take over
      this.setCoach(null);
      this.coach = null;
      return;
    }
    if (c.step === 0) {
      const chonk = s.cats[0];
      this.setCoach(`Pick up ${chonk.name} and carry them to the teacup`);
      if (!this.renderer.hint && !chonk.grabbed && !chonk.seat && c.t > 0.8) {
        const v = this.renderer.view(chonk);
        const cup = s.containers[0];
        this.renderer.hint = { fromX: v.hx, fromY: v.hy + 14, toX: cup.x, toY: cup.opening!.y - 40, t: 0 };
      }
      if (chonk.grabbed) c.step = 1;
    } else if (c.step === 1) {
      this.setCoach('Let go above the cup and let gravity do the rest');
      if (c.t > 6) this.setCoach(null);
    } else if (c.step === 2) {
      this.setCoach('If it fits, it sits! Now the others. (Tap a cat to boop it.)');
      if (c.t > 4.5) c.step = 3;
    } else {
      this.setCoach(null);
      if (s.complete) this.coach = null;
    }
  }

  toast(text: string, ms = 2600): void {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout((t as unknown as { _h?: number })._h);
    (t as unknown as { _h?: number })._h = window.setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------------------------
  // Overlays

  private openOverlay(html: string, onBind?: (root: HTMLElement) => void): void {
    const o = $('overlay');
    o.innerHTML = html;
    o.classList.remove('hidden');
    onBind?.(o);
    o.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeOverlay()));
    o.addEventListener(
      'click',
      (e) => {
        if (e.target === o && !this.reveal) this.closeOverlay();
      },
      { once: true },
    );
  }

  closeOverlay(): void {
    const o = $('overlay');
    o.classList.add('hidden');
    o.innerHTML = '';
  }

  private showResults(): void {
    const res = this.lastResult ?? this.session.results();
    const s = this.session;
    const isDaily = this.kind === 'daily';
    const next = this.nextStep();
    const rows = res.cats
      .map(
        (c) => `<div class="catrow"><span>${faceSVG(c.breed, { mood: 'happy', size: 32 })}</span>
        <div><div class="who">${c.name} <span class="where">the ${BREEDS[c.breed].name}</span></div><div class="where">in the ${c.container}</div></div>
        <div class="score">${c.score}<small>${c.label}</small></div></div>`,
      )
      .join('');
    const streak = isDaily && this.save.streak.count > 1 ? `<p class="sub">☀️ ${this.save.streak.count} mornings in a row</p>` : '';
    this.openOverlay(
      `<div class="card" role="dialog" aria-label="Fits and sits">
        <h2>Fits &amp; sits!</h2>
        <p class="sub">${s.def.name}${isDaily ? ` · Morning #${roomNumber(this.dateKey)}` : ''}</p>
        <div class="stats">
          <div class="stat"><b>${res.cozy}</b><span>cozy points</span></div>
          <div class="stat"><b>${res.paws}${res.par ? `<small style="font-size:16px;opacity:.6"> / ${res.par}</small>` : ''}</b><span>paws${res.par ? ' / par' : ''}</span></div>
        </div>
        ${streak}
        <div class="catrows">${rows}</div>
        <div class="btns">
          <button class="btn primary" data-act="share"><svg viewBox="0 0 24 24"><use href="#i-share"/></svg>Share</button>
          <button class="btn mint" data-act="next">${next.label}</button>
          <button class="btn" data-act="again">Play again</button>
          <button class="btn" data-act="sandbox">Photo room</button>
          <button class="btn" data-act="home"><svg viewBox="0 0 24 24"><use href="#i-home"/></svg>Home</button>
        </div>
      </div>`,
      (root) => {
        root.querySelector('[data-act=share]')!.addEventListener('click', () => void this.share());
        root.querySelector('[data-act=next]')!.addEventListener('click', () => next.go());
        root.querySelector('[data-act=again]')!.addEventListener('click', () => this.restart());
        root.querySelector('[data-act=sandbox]')!.addEventListener('click', () => this.enterSandbox());
        root.querySelector('[data-act=home]')!.addEventListener('click', () => this.goHome());
      },
    );
  }

  private nextStep(): { label: string; go: () => void } {
    const todayDone = !!this.save.daily[this.dateKey];
    if (this.kind === 'handmade' && this.roomIndex < HANDMADE.length - 1 && this.session.def.id === HANDMADE[this.roomIndex].id) {
      const i = this.roomIndex + 1;
      return { label: `Next: ${HANDMADE[i].name}`, go: () => this.loadHandmade(i) };
    }
    if (!todayDone || this.kind !== 'daily') {
      if (!todayDone) return { label: "This morning's room", go: () => void this.loadDaily() };
    }
    const unfinished = HANDMADE.findIndex((r) => !this.save.rooms[r.id]);
    if (unfinished >= 0) return { label: `Next: ${HANDMADE[unfinished].name}`, go: () => this.loadHandmade(unfinished) };
    return { label: 'New room tomorrow', go: () => this.showMenu() };
  }

  private async share(): Promise<void> {
    const res = this.lastResult ?? this.session.results();
    let framed = true;
    try {
      framed = window.top !== window.self;
    } catch {
      framed = true;
    }
    // Only share our address when we're the page itself (not embedded in a portal or viewer).
    const url = !framed && location.protocol.startsWith('http') && !location.hostname.includes('localhost') ? location.origin + location.pathname : undefined;
    const text = shareText({
      result: res,
      roomName: this.session.def.name,
      number: this.kind === 'daily' ? roomNumber(this.dateKey) : undefined,
      url,
      streak: this.kind === 'daily' ? this.save.streak.count : 0,
    });
    const how = await shareOrCopy(text);
    if (how === 'copied') this.toast('Copied! Paste it anywhere.');
    else if (how === 'failed') this.toast(text.split('\n').slice(0, 3).join('  '), 5000);
  }

  /** Sound and music switches (the menu and the home menu). */
  private togglesHtml(): string {
    const st = this.save.settings;
    return `<div class="toggles">
          <button class="toggle" data-toggle="sfx" aria-pressed="${st.sfx}">Sound ${st.sfx ? 'on' : 'off'}</button>
          <button class="toggle" data-toggle="music" aria-pressed="${st.music}">Music ${st.music ? 'on' : 'off'}</button>
        </div>`;
  }

  private bindToggles(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('[data-toggle]').forEach((b) =>
      b.addEventListener('click', () => {
        const k = b.dataset.toggle as 'sfx' | 'music';
        this.setSetting(k, !this.save.settings[k]);
        b.setAttribute('aria-pressed', String(this.save.settings[k]));
        b.textContent = `${k === 'sfx' ? 'Sound' : 'Music'} ${this.save.settings[k] ? 'on' : 'off'}`;
      }),
    );
  }

  /** The menu at home: your cats, the three games, sound and music. */
  private showHomeMenu(): void {
    this.audio.click();
    const h = this.home.house;
    const best = (k: string): string => {
      const b = loadBest(k);
      return b > 0 ? `best ${b.toLocaleString('en-US')}` : 'not played yet';
    };
    this.openOverlay(
      `<div class="card" role="dialog" aria-label="Menu">
        <h2>Home</h2>
        <p class="sub">${h.residents.length} of 7 cats live here</p>
        <div class="menu-list">
          <button class="menu-item" data-act="cats"><span class="mi-icon">🐾</span><span>Your cats<small>Who lives here, and who's coming</small></span></button>
          <button class="menu-item" data-play="fits"><span class="mi-icon">📦</span><span>If It Fits<small>Pour cats into teacups and boxes · ${this.fitsNote()}</small></span></button>
          <button class="menu-item" data-play="jar"><span class="mi-icon">🫙</span><span>Cat Jar<small>Two the same melt into a bigger cat · ${best('catjar.best')}</small></span></button>
          <button class="menu-item" data-play="drop"><span class="mi-icon">🛁</span><span>Cat Drop<small>Drop down the house, ahead of bath time · ${best('catdrop.best')}</small></span></button>
        </div>
        ${this.togglesHtml()}
        <div class="btns" style="margin-top:12px"><button class="btn" data-close>Back home</button></div>
      </div>`,
      (root) => {
        root.querySelector('[data-act=cats]')!.addEventListener('click', () => this.home.showCats());
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

  showMenu(): void {
    if (this.kind === 'home') return this.showHomeMenu();
    this.audio.click();
    const today = this.save.daily[this.dateKey];
    const rooms = HANDMADE.map((r, i) => {
      const rec = this.save.rooms[r.id];
      return `<button class="menu-item ${rec ? 'done' : ''}" data-room="${i}"><span class="mi-icon">${rec ? '✓' : i + 1}</span><span>${r.name}<small>${rec ? `best cozy ${rec.best}` : 'hand-made room'}</small></span></button>`;
    }).join('');
    this.openOverlay(
      `<div class="card" role="dialog" aria-label="Menu">
        <h2>If It Fits</h2>
        <p class="sub">A new room every morning</p>
        <div class="menu-list">
          <button class="menu-item" data-act="home"><span class="mi-icon">🏠</span><span>Home<small>Your cats, and the other games</small></span></button>
          <button class="menu-item ${today ? 'done' : ''}" data-act="daily"><span class="mi-icon">${today ? '✓' : '☀️'}</span><span>This morning's room<small>Morning #${roomNumber(this.dateKey)} · ${prettyDate(this.dateKey)}${today ? ` · cozy ${today.cozy}` : ''}</small></span></button>
          ${rooms}
          <button class="menu-item" data-act="sandbox"><span class="mi-icon">📷</span><span>Photo room<small>Pour any cat into anything</small></span></button>
          <button class="menu-item" data-act="collection"><span class="mi-icon">🐾</span><span>Cat collection<small>${collectedCount(this.save)} of 7 breeds</small></span></button>
          <button class="menu-item" data-act="howto"><span class="mi-icon">?</span><span>How to play</span></button>
        </div>
        ${this.togglesHtml()}
        <div class="btns" style="margin-top:12px"><button class="btn" data-close>Back to the room</button></div>
      </div>`,
      (root) => {
        root.querySelector('[data-act=home]')!.addEventListener('click', () => this.goHome());
        root.querySelector('[data-act=daily]')!.addEventListener('click', () => void this.loadDaily());
        root.querySelectorAll<HTMLElement>('[data-room]').forEach((b) => b.addEventListener('click', () => this.loadHandmade(Number(b.dataset.room))));
        root.querySelector('[data-act=sandbox]')!.addEventListener('click', () => this.enterSandbox());
        root.querySelector('[data-act=collection]')!.addEventListener('click', () => this.showCollection());
        root.querySelector('[data-act=howto]')!.addEventListener('click', () => this.showHowTo());
        this.bindToggles(root);
      },
    );
  }

  showCollection(): void {
    const cards = BREED_ORDER.map((b) => {
      const got = this.save.collection[b];
      const secret = BREEDS[b].secret;
      const known = got || (secret && this.save.voidUnlocked);
      const name = known || !secret ? BREEDS[b].name : '???';
      const flow = known || !secret ? BREEDS[b].flow : 'a secret visitor';
      const blurb = got ? `${BREEDS[b].blurb}<br><b>Seated ${got.seated}×</b> · best ${got.best}` : secret ? (this.save.voidUnlocked ? 'Visits on rare mornings. Free to roam the photo room.' : 'Seat all six breeds to meet them.') : 'Seat one in any room to collect.';
      return `<div class="breed ${got ? '' : 'locked'} ${secret ? 'secret' : ''}" data-breed="${b}"><div class="pic"></div><b>${name}</b><div class="flow">${flow}</div><div class="blurb">${blurb}</div></div>`;
    }).join('');
    this.openOverlay(
      `<div class="card" role="dialog" aria-label="Cat collection">
        <h2>Cat collection</h2>
        <p class="sub">${collectedCount(this.save)} of 7 · every breed pours differently</p>
        <div class="collection">${cards}</div>
        <div class="btns"><button class="btn" data-close>Close</button></div>
      </div>`,
      (root) => {
        root.querySelectorAll<HTMLElement>('[data-breed]').forEach((el) => {
          const b = el.dataset.breed as BreedId;
          const got = !!this.save.collection[b];
          const silhouette = !got && (BREEDS[b].secret ? !this.save.voidUnlocked : false);
          const c = catPortrait(b, 150, 74, { silhouette, happy: got });
          el.querySelector('.pic')!.appendChild(c);
          c.style.opacity = !got && !silhouette ? '0.55' : '1';
        });
      },
    );
  }

  showHowTo(): void {
    this.openOverlay(
      `<div class="card" role="dialog" aria-label="How to play">
        <h2>How to play</h2>
        <p class="sub">Cats are liquid. Prove it.</p>
        <div class="howto">
          <div><span class="hi">👆</span><span><b>Drag</b> a cat to pick it up. Every cat can be carried; the big ones are just heavier and stretch on the way.</span></div>
          <div><span class="hi">🫖</span><span>Let go over a teacup, boot, box or sink and it <b>pours in</b>. If it fits, it sits.</span></div>
          <div><span class="hi">💛</span><span>Snug fits earn <b>cozy points</b>. Every breed pours differently: water, honey, pudding, jelly…</span></div>
          <div><span class="hi">🐾</span><span>Each nudge is a paw. <b>Par</b> is what our cat-solver needed. Undo is always free. There's no way to fail.</span></div>
          <div><span class="hi">☀️</span><span>A <b>new room every morning</b>, the same for everyone. Share your cat faces, not the answer.</span></div>
        </div>
        <div class="btns"><button class="btn primary" data-close>Got it</button></div>
      </div>`,
    );
  }

  private showPhoto(): void {
    if (!this.sandbox) return;
    const c = this.sandbox.photo();
    const url = c.toDataURL('image/png');
    this.audio.click();
    this.openOverlay(
      `<div class="card" role="dialog" aria-label="Photo">
        <h2>Say "loaf"!</h2>
        <div class="photo-frame"><img alt="A photo of your cats" src="${url}"></div>
        <p class="sub" style="margin-top:-4px">Long-press or right-click the photo to save it.</p>
        <div class="btns">
          <button class="btn primary" data-act="share"><svg viewBox="0 0 24 24"><use href="#i-share"/></svg>Share</button>
          <button class="btn mint" data-act="save">Save</button>
          <button class="btn" data-close>Back</button>
        </div>
      </div>`,
      (root) => {
        const save = (): void => {
          const a = document.createElement('a');
          a.href = url;
          a.download = `if-it-fits-${localDateKey()}.png`;
          a.click();
        };
        root.querySelector('[data-act=save]')!.addEventListener('click', save);
        root.querySelector('[data-act=share]')!.addEventListener('click', () => {
          c.toBlob(async (blob) => {
            if (!blob) return save();
            const file = new File([blob], 'if-it-fits.png', { type: 'image/png' });
            try {
              if (navigator.canShare?.({ files: [file] })) {
                await navigator.share({ files: [file], text: 'If it fits, I sits. 🐾' });
                return;
              }
            } catch (e) {
              if ((e as Error)?.name === 'AbortError') return;
            }
            save();
          });
        });
      },
    );
  }

  private openDrawer(kind: 'cats' | 'things'): void {
    const d = $('drawer');
    if (!d.classList.contains('hidden') && d.dataset.kind === kind) {
      this.closeDrawer();
      return;
    }
    d.dataset.kind = kind;
    d.innerHTML = '';
    if (kind === 'cats') {
      for (const b of BREED_ORDER) {
        const locked = BREEDS[b].secret && !this.save.voidUnlocked;
        const btn = document.createElement('button');
        btn.className = `pick ${locked ? 'locked' : ''}`;
        btn.setAttribute('aria-label', locked ? 'Secret cat (locked)' : `Add a ${BREEDS[b].name}`);
        btn.appendChild(catPortrait(b, 58, 52, { silhouette: locked }));
        btn.appendChild(document.createTextNode(locked ? '???' : BREEDS[b].name));
        btn.addEventListener('click', () => {
          if (locked) {
            this.toast('Seat all six breeds to meet this one.');
            return;
          }
          this.audio.click();
          this.sandbox?.addCat(b);
        });
        d.appendChild(btn);
      }
    } else {
      for (const t of SANDBOX_THINGS) {
        const btn = document.createElement('button');
        btn.className = 'pick';
        btn.setAttribute('aria-label', `Add a ${t}`);
        btn.appendChild(thingPreview(t, 58, 52));
        btn.appendChild(document.createTextNode(t === 'mixingbowl' ? 'bowl' : t === 'fruitbowl' ? 'fruit bowl' : t));
        btn.addEventListener('click', () => {
          this.audio.click();
          this.sandbox?.addThing(t);
        });
        d.appendChild(btn);
      }
      const tidy = document.createElement('button');
      tidy.className = 'pick';
      tidy.textContent = '🧹 tidy up';
      tidy.addEventListener('click', () => {
        this.sandbox?.tidy();
        this.closeDrawer();
      });
      d.appendChild(tidy);
    }
    d.classList.remove('hidden');
  }

  private closeDrawer(): void {
    $('drawer').classList.add('hidden');
  }

  // ---------------------------------------------------------------------------
  // Input

  private bindButtons(): void {
    const click = (id: string, fn: () => void): void =>
      $(id).addEventListener('click', () => {
        this.audio.unlock();
        fn();
      });
    click('undoBtn', () => this.session.undo());
    click('hintBtn', () => this.showHint());
    click('sandboxBtn', () => this.enterSandbox());
    click('menuBtn', () => this.showMenu());
    click('homeBtn', () => {
      this.audio.click();
      this.goHome();
    });
    click('sbCatsBtn', () => this.openDrawer('cats'));
    click('sbPropsBtn', () => this.openDrawer('things'));
    click('sbPhotoBtn', () => {
      this.closeDrawer();
      // let the drawer disappear before snapping
      requestAnimationFrame(() => requestAnimationFrame(() => this.showPhoto()));
    });
    click('sbBackBtn', () => this.exitSandbox());
    window.addEventListener('keydown', (e) => {
      // Cat Jar and Cat Drop have keys of their own
      if (this.away) return;
      this.audio.unlock();
      if (this.kind === 'home') {
        if (e.key === 'Escape') this.closeOverlay();
        return;
      }
      if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'u') this.session.undo();
      else if (e.key === 'h') this.showHint();
      else if (e.key === 'Escape') {
        this.closeOverlay();
        this.closeDrawer();
      }
    });
  }

  private showHint(): void {
    if (this.session.complete) return;
    const h = this.session.hint();
    if (!h) return;
    this.audio.click();
    const v = this.renderer.view(h.cat);
    this.renderer.hint = { fromX: v.hx, fromY: v.hy + 10, toX: h.tx, toY: h.ty, t: 0 };
    this.toast(`Try nudging ${h.cat.name} toward the ${h.container.name}.`);
  }

  private bindInput(): void {
    const c = this.canvas;
    const pos = (e: PointerEvent): { x: number; y: number } => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      this.closeDrawer();
      if (this.gesture || this.reveal) return;
      const p = pos(e);
      const w = this.renderer.screenToWorld(p.x, p.y);
      const cat = this.session.catAt(w.x, w.y, 18 / this.renderer.scale + 6);
      const now = performance.now();
      if (!cat) {
        const portal = this.kind === 'home' ? this.home.portalAt(w.x, w.y) : null;
        if (portal) {
          this.portalTap = { id: e.pointerId, game: portal.game, sx: p.x, sy: p.y };
          return;
        }
        if (this.sandbox && this.sandbox.pickThing(w.x, w.y)) {
          c.setPointerCapture(e.pointerId);
          this.gesture = { id: e.pointerId, catIndex: -1, thing: true, sx: p.x, sy: p.y, t0: now, dragging: true, lx: w.x, ly: w.y, lt: now, vx: 0, vy: 0 };
        }
        return;
      }
      c.setPointerCapture(e.pointerId);
      this.gesture = { id: e.pointerId, catIndex: cat.index, thing: false, sx: p.x, sy: p.y, t0: now, dragging: false, lx: w.x, ly: w.y, lt: now, vx: 0, vy: 0 };
    });
    c.addEventListener('pointermove', (e) => {
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      const p = pos(e);
      const w = this.renderer.screenToWorld(p.x, p.y);
      if (g.thing) {
        this.sandbox?.moveThing(w.x, w.y);
        return;
      }
      const now = performance.now();
      const cat = this.session.cats[g.catIndex];
      if (!cat) return;
      if (!g.dragging && (Math.hypot(p.x - g.sx, p.y - g.sy) > 7 || now - g.t0 > 180)) {
        const start = this.renderer.screenToWorld(g.sx, g.sy);
        this.session.beginGrab(cat, start.x, start.y);
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
        // cats can be carried anywhere in the room, but not up under the top bar
        this.session.moveGrab(w.x, Math.max(w.y, CARRY_TOP), g.vx, w.y > CARRY_TOP ? g.vy : 0);
      }
    });
    const end = (e: PointerEvent): void => {
      const tap = this.portalTap;
      if (tap && tap.id === e.pointerId) {
        this.portalTap = null;
        const p = pos(e);
        if (e.type === 'pointerup' && this.kind === 'home' && Math.hypot(p.x - tap.sx, p.y - tap.sy) < 14) this.play(tap.game);
        return;
      }
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      this.gesture = null;
      c.classList.remove('grabbing');
      if (g.thing) {
        this.sandbox?.dropThing();
        return;
      }
      const cat = this.session.cats[g.catIndex];
      if (!cat) return;
      if (g.dragging) this.session.endGrab();
      else if (e.type === 'pointerup') {
        const p = pos(e);
        const w = this.renderer.screenToWorld(p.x, p.y);
        this.session.boop(cat, w.x, w.y);
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => this.renderer.resize());
  }
}

export { BASE_BREEDS };
