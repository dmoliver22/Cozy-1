// The home screen: your cats in the home room and their little lives (now
// and then one hops over to another spot), the ways into the three games (a
// label on the box, the jar and the attic hatch, and a bar of big buttons),
// the cats card (who lives here, and what brings each of the others home),
// and cats moving in: a cat who's earned their place drops in through the
// attic hatch the next time you're home.

import type { AudioEngine } from '../audio/audio';
import type { Cat, Session } from '../game/session';
import { BREEDS, type BreedId } from '../physics/breeds';
import { GRAVITY } from '../physics/world';
import { loadBest } from '../proto/kit';
import type { Renderer } from '../render/renderer';
import { THEMES } from '../render/roomArt';
import { faceSVG } from '../ui/faces';
import { catPortrait } from '../ui/portraits';
import { clamp } from '../util/math';
import { HATCH, CEIL_Y, paintCeiling, paintJarOfCats } from './homeArt';
import { JAR_SPOT, PORTALS, homeRoom, portalAt, type Portal } from './homeRoom';
import {
  ALL_CATS,
  NAMES,
  arrive,
  loadHouse,
  moveInFor,
  nextMoveIn,
  recordRun,
  writeHouse,
  type Earlier,
  type GameId,
  type HouseReport,
  type HouseSave,
} from './house';

export interface HomeHost {
  readonly renderer: Renderer;
  readonly audio: AudioEngine;
  /** The home room's session (while home). */
  readonly session: Session;
  /** One line about If It Fits for its button ("new room", "done today"). */
  fitsNote(): string;
  openOverlay(html: string, onBind?: (root: HTMLElement) => void): void;
  closeOverlay(): void;
  overlayOpen(): boolean;
  /** A finger is on a cat (the cats hold still for it). */
  busy(): boolean;
  /** Into a game (for If It Fits, maybe a particular room). */
  play(game: GameId, room?: string): void;
}

const GAME_NAMES: Record<GameId, string> = { fits: 'If It Fits', jar: 'Cat Jar', drop: 'Cat Drop' };

/** Seconds between a cat's hops, at the least and the most. */
const HOP_GAP: [number, number] = [6, 13];

/** Places a cat may hop to: the top of what it lands on, and how far either side of x it may sit. */
const PERCHES: { x: number; y: number; half: number; maxR: number }[] = [
  { x: 102, y: 212, half: 40, maxR: 34 }, // the windowsill
  { x: 334, y: 128, half: 30, maxR: 40 }, // the top cat step
  { x: 248, y: 224, half: 30, maxR: 40 }, // the lower step
  { x: 345, y: 338, half: 22, maxR: 34 }, // beside the jar
  { x: 64, y: 432, half: 30, maxR: 44 }, // on the bookcase
  { x: 196, y: 556, half: 6, maxR: 40 }, // in the box
  { x: 318, y: 552, half: 6, maxR: 44 }, // in the basket
];

export class Home {
  house: HouseSave;
  private active = false;
  private readonly bar = document.getElementById('homeBar') as HTMLElement;
  private readonly labels: HTMLElement;
  private readonly labelEls = new Map<GameId, HTMLElement>();
  private readonly toastEl: HTMLElement;
  private toastTimer = 0;
  private hopIn = 4;
  private arrivalIn = -1;
  /** The cat who just arrived: their card shows once they've landed. */
  private newcomer: { cat: Cat; t: number } | null = null;
  private lastLabels = '';

  constructor(
    private readonly host: HomeHost,
    earlier: Earlier,
  ) {
    this.house = loadHouse(earlier);
    writeHouse(this.house);
    // labels on the box, the jar and the hatch
    this.labels = document.createElement('div');
    this.labels.className = 'home-labels hidden';
    for (const p of PORTALS) {
      const b = document.createElement('button');
      b.className = `home-label home-label-${p.game}`;
      b.textContent = p.name;
      b.setAttribute('aria-label', `Play ${p.name}`);
      b.addEventListener('click', () => host.play(p.game));
      this.labels.appendChild(b);
      this.labelEls.set(p.game, b);
    }
    document.getElementById('app')!.appendChild(this.labels);
    for (const b of this.bar.querySelectorAll<HTMLElement>('[data-game]')) b.addEventListener('click', () => host.play(b.dataset.game as GameId));
    // the house's own toast: it shows over any game (the games hide the room's page)
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'hh-toast';
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.toastEl);
  }

  /** The home room with everyone who lives here. */
  room(): ReturnType<typeof homeRoom> {
    return homeRoom(this.house.residents);
  }

  /** Paints the home's own art into the renderer's back layer. */
  readonly paint = (ctx: CanvasRenderingContext2D, r: { x0: number; y0: number; x1: number; y1: number }, cssPerUnit: number): void => {
    paintCeiling(ctx, r, THEMES.living, 11);
    paintJarOfCats(ctx, JAR_SPOT.x, JAR_SPOT.y, JAR_SPOT.s, cssPerUnit);
  };

  /** Seconds since the home room came up (cats settling into their spots don't fuss). */
  since = 0;

  /** Called once the home room is up. */
  enter(): void {
    this.active = true;
    this.since = 0;
    this.bar.classList.remove('hidden');
    this.labels.classList.remove('hidden');
    this.lastLabels = '';
    this.hopIn = 5 + Math.random() * 4;
    this.newcomer = null;
    this.arrivalIn = this.house.arriving.length ? 1.1 : -1;
    this.refreshBar();
    if (!this.house.welcomed) setTimeout(() => this.active && this.welcome(), 600);
  }

  leave(): void {
    this.active = false;
    this.bar.classList.add('hidden');
    this.labels.classList.add('hidden');
  }

  get isActive(): boolean {
    return this.active;
  }

  /** The way into a game at a world point, if any. */
  portalAt(x: number, y: number): Portal | null {
    return portalAt(x, y);
  }

  // ---------------------------------------------------------------------------
  // Progress

  /** A game says how a run went: cats may have earned their place. */
  report(r: HouseReport): void {
    const fresh = recordRun(this.house, r);
    writeHouse(this.house);
    if (fresh.length) {
      const b = fresh[0];
      const more = fresh.length > 1 ? ` (and ${NAMES[fresh[1]]}!)` : '';
      this.toast(b, `${NAMES[b]} the ${BREEDS[b].name} wants to move in!${more}`);
    }
    if (this.active) this.refreshBar();
  }

  /** A toast with a cat's face, over whatever's on screen. */
  toast(breed: BreedId, text: string, ms = 3600): void {
    const t = this.toastEl;
    t.innerHTML = `<span class="hh-face">${faceSVG(breed, { mood: 'happy', size: 30 })}</span><span>${text}</span><span class="hh-house" aria-hidden="true">🏠</span>`;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), ms);
  }

  private refreshBar(): void {
    const notes: Record<GameId, string> = {
      fits: this.host.fitsNote(),
      jar: this.bestNote(loadBest('catjar.best')),
      drop: this.bestNote(loadBest('catdrop.best')),
    };
    for (const game of ['fits', 'jar', 'drop'] as GameId[]) {
      const btn = this.bar.querySelector<HTMLElement>(`[data-game=${game}]`);
      if (!btn) continue;
      (btn.querySelector('.tin-note') as HTMLElement).textContent = notes[game];
      // the next cat you can meet in this game peeks over its lid
      const next = nextMoveIn(this.house, game);
      const badge = btn.querySelector('.face-badge') as HTMLElement;
      badge.innerHTML = next ? faceSVG(next.breed, { size: 22 }) : '';
      badge.classList.toggle('hidden', !next);
      btn.setAttribute('aria-label', `Play ${GAME_NAMES[game]}${next ? `. ${next.how} and ${NAMES[next.breed]} moves in` : ''}`);
    }
  }

  private bestNote(best: number): string {
    return best > 0 ? `best ${best.toLocaleString('en-US')}` : 'new!';
  }

  // ---------------------------------------------------------------------------
  // Every frame while home

  tick(dt: number): void {
    if (!this.active) return;
    this.since += dt;
    this.placeLabels();
    const s = this.host.session;
    if (this.newcomer) {
      const n = this.newcomer;
      n.t += dt;
      if ((n.cat.settled > 20 && n.t > 1) || n.t > 4) {
        this.newcomer = null;
        this.arrivalCard(n.cat.breed);
      }
      return;
    }
    if (this.arrivalIn >= 0 && !this.host.overlayOpen()) {
      this.arrivalIn -= dt;
      if (this.arrivalIn < 0) this.dropIn();
      return;
    }
    if (this.host.overlayOpen() || this.host.busy()) return;
    this.hopIn -= dt;
    if (this.hopIn <= 0) {
      this.hopIn = HOP_GAP[0] + Math.random() * (HOP_GAP[1] - HOP_GAP[0]);
      this.wander(s);
    }
  }

  /** Keep the labels on their things (they only move when the screen does). */
  private placeLabels(): void {
    const r = this.host.renderer;
    const key = `${r.W}x${r.H}:${r.scale.toFixed(3)}:${r.ox.toFixed(1)}:${r.oy.toFixed(1)}`;
    if (key === this.lastLabels) return;
    this.lastLabels = key;
    for (const p of PORTALS) {
      const el = this.labelEls.get(p.game)!;
      const q = r.worldToScreen(p.lx, p.ly);
      el.style.transform = `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  // ---------------------------------------------------------------------------
  // Cats' lives

  /** Now and then a cat who's been resting a while hops to a free spot nearby. */
  private wander(s: Session): void {
    const idle = s.cats.filter((c) => !c.grabbed && c.settled > 90 && c.sinceTouch > 240);
    if (!idle.length) return;
    const cat = idle[Math.floor(Math.random() * idle.length)];
    const b = cat.body;
    b.computeCentroid();
    const r = b.p.radius;
    const free = PERCHES.filter((p) => {
      if (r > p.maxR) return false;
      const dx = p.x - b.cx;
      const rise = b.cy + r - p.y;
      if (Math.abs(dx) < 30 && Math.abs(rise) < 30) return false;
      if (Math.abs(dx) > 230 || rise > 150) return false;
      // someone's already there
      return !s.cats.some((o) => {
        if (o === cat) return false;
        o.body.computeCentroid();
        return Math.abs(o.body.cx - p.x) < o.body.p.radius + r - 4 && Math.abs(o.body.cy + o.body.p.radius - p.y) < 40;
      });
    });
    if (!free.length) {
      // nowhere to go: a stretch and a little hop on the spot
      b.kick(0, -b.p.hop * 0.55);
      cat.sinceTouch = 0;
      return;
    }
    const p = free[Math.floor(Math.random() * free.length)];
    this.hop(cat, p.x + (Math.random() * 2 - 1) * p.half, p.y);
  }

  /** Jump so as to land with the cat's centre over (x, y - r): a ballistic arc. */
  private hop(cat: Cat, x: number, y: number): void {
    const b = cat.body;
    b.computeCentroid();
    const r = b.p.radius;
    const ty = y - r * 0.9;
    const apex = Math.min(b.cy, ty) - 46 - Math.abs(x - b.cx) * 0.12;
    const up = Math.sqrt(2 * GRAVITY * Math.max(10, b.cy - apex));
    const tUp = up / GRAVITY;
    const tDown = Math.sqrt((2 * Math.max(4, ty - apex)) / GRAVITY);
    const vx = clamp((x - b.cx) / (tUp + tDown), -520, 520);
    b.kick(vx - b.vcx, -up - b.vcy);
    cat.intent = null;
    cat.sinceTouch = 0;
    this.host.audio.grab(BREEDS[cat.breed].voice.pitch, false);
  }

  /** The next cat on the way drops in through the attic hatch. */
  private dropIn(): void {
    const b = arrive(this.house);
    writeHouse(this.house);
    if (!b) return;
    const s = this.host.session;
    // out of the hatch and onto the top cat step
    const x = (HATCH.x0 + HATCH.x1) / 2 + 6;
    const cat = s.addCat(b, x, CEIL_Y + 4 - BREEDS[b].physics.radius, NAMES[b]);
    cat.body.kick(0, 90);
    cat.sinceTouch = 0;
    this.host.renderer.puff(x - 6, CEIL_Y + 10, 6);
    this.host.audio.reveal();
    this.newcomer = { cat, t: 0 };
    this.arrivalIn = this.house.arriving.length ? 0.6 : -1;
    this.refreshBar();
  }

  // ---------------------------------------------------------------------------
  // Cards

  private welcome(): void {
    const faces = this.house.residents.map((b) => `<span class="hc-face">${faceSVG(b, { mood: 'happy', size: 44 })}</span>`).join('');
    this.host.openOverlay(
      `<div class="card" role="dialog" aria-label="Welcome home">
        <h2>Welcome home!</h2>
        <div class="hc-faces">${faces}</div>
        <p class="sub">${this.names(this.house.residents)} live here. Play any game and more cats will move in.</p>
        <p class="hc-games"><b>If It Fits</b> · the box on the rug<br><b>Cat Jar</b> · the jar on the shelf<br><b>Cat Drop</b> · up through the attic hatch</p>
        <div class="btns"><button class="btn primary" data-close>Let's play</button></div>
      </div>`,
    );
    this.house.welcomed = true;
    writeHouse(this.house);
  }

  private arrivalCard(b: BreedId): void {
    const m = moveInFor(b);
    this.host.audio.seat(96);
    const cat = this.host.session.cats.find((c) => c.breed === b);
    if (cat) {
      const v = this.host.renderer.view(cat);
      this.host.renderer.hearts(v.hx, v.hy - 16, 3);
    }
    this.host.openOverlay(
      `<div class="card" role="dialog" aria-label="${NAMES[b]} moved in">
        <h2>${NAMES[b]} moved in!</h2>
        <div class="hc-portrait"></div>
        <p class="sub">${NAMES[b]} the ${BREEDS[b].name} · ${BREEDS[b].flow}</p>
        ${m ? `<p class="hc-why">${m.how}: done!</p>` : ''}
        <p class="hc-count">${this.house.residents.length} of ${ALL_CATS.length} cats live here</p>
        <div class="btns"><button class="btn primary" data-close>Welcome home, ${NAMES[b]}</button></div>
      </div>`,
      (root) => root.querySelector('.hc-portrait')!.appendChild(catPortrait(b, 150, 92, { happy: true })),
    );
  }

  /** Who lives here, and what brings each of the others home. */
  showCats(): void {
    const h = this.house;
    const rows = ALL_CATS.map((b) => {
      const here = h.residents.includes(b);
      const coming = h.arriving.includes(b);
      const m = moveInFor(b);
      const status = here ? `<small>lives here · ${BREEDS[b].flow}</small>` : coming ? '<small class="hc-coming">on the way home!</small>' : `<small>${m?.how ?? ''}</small>`;
      const play = !here && !coming && m ? `<button class="hc-play" data-play="${m.game}" data-room="${m.room ?? ''}" aria-label="Play ${GAME_NAMES[m.game]}">Play</button>` : '';
      return `<div class="hc-row ${here ? '' : 'away'}" data-breed="${b}"><span class="hc-pic"></span><span class="hc-who"><b>${here || coming ? NAMES[b] : '???'}</b>${status}</span>${play}</div>`;
    }).join('');
    this.host.openOverlay(
      `<div class="card" role="dialog" aria-label="Your cats">
        <h2>Your cats</h2>
        <p class="sub">${h.residents.length} of ${ALL_CATS.length} live here · cats move in as you play</p>
        <div class="hc-rows">${rows}</div>
        <div class="btns"><button class="btn" data-close>Close</button></div>
      </div>`,
      (root) => {
        root.querySelectorAll<HTMLElement>('[data-breed]').forEach((el) => {
          const b = el.dataset.breed as BreedId;
          const known = h.residents.includes(b) || h.arriving.includes(b);
          el.querySelector('.hc-pic')!.appendChild(catPortrait(b, 64, 46, { silhouette: !known, happy: known }));
        });
        root.querySelectorAll<HTMLElement>('[data-play]').forEach((el) =>
          el.addEventListener('click', () => {
            this.host.closeOverlay();
            this.host.play(el.dataset.play as GameId, el.dataset.room || undefined);
          }),
        );
      },
    );
  }

  private names(list: BreedId[]): string {
    const n = list.map((b) => NAMES[b]);
    return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  }
}
