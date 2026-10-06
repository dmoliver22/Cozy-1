// The home screen: the tall house you scroll up and down (the roof garden,
// the living room, the basement), your cats and their little lives (now and
// then one hops to another spot, up a run of perches if there is one), the
// ways into the three games (a label on the box, the jar and the attic
// hatch, and a bar of big buttons), the treats the games earn you and the
// shop they're spent in (opening up the basement and the roof garden,
// perches you put wherever you like), the glass tubes between the floors,
// the cats card (who lives here, what brings each of the others home), cats
// moving in (they drop in through the attic hatch) and, the first time
// you're home each day, a little present from the cats.

import type { AudioEngine } from '../audio/audio';
import { FLOOR_Y, WORLD_W, localFurniture } from '../game/props';
import type { DecorPlacement, RoomDef } from '../game/room';
import type { Cat, Session, SessionOptions } from '../game/session';
import { BREEDS, type BreedId } from '../physics/breeds';
import type { StaticShape } from '../physics/shapes';
import { GRAVITY } from '../physics/world';
import { loadBest } from '../proto/kit';
import { drawFurniture } from '../render/furnitureArt';
import { lightOf, rgba, roundRect, shadowOf, type Ctx } from '../render/paint';
import { containerShadow, drawContainerBack } from '../render/propArt';
import type { Expression } from '../render/catArt';
import type { Renderer, Stage } from '../render/renderer';
import { THEMES, drawDecor, drawShell, drawSunbeams } from '../render/roomArt';
import { faceSVG } from '../ui/faces';
import { catPortrait } from '../ui/portraits';
import { clamp } from '../util/math';
import { localDateKey } from '../util/date';
import { CEIL_Y, HATCH, paintCeiling, paintJarOfCats } from './homeArt';
import { GIFT_SPOT, JAR_SPOT, PORTALS, fittingBoxes, houseRoom, portalAt, type Portal } from './homeRoom';
import { BASEMENT_THEME, paintAttic, paintBasement, paintRoof, paintTrapdoor, paintTubeBack, paintTubeFront, type Rect } from './houseArt';
import {
  ALL_CATS,
  FLOOR_PRICES,
  NAMES,
  arrive,
  buyFloor,
  buyPerch,
  giftDue,
  isOpen,
  loadHouse,
  moveInFor,
  nextMoveIn,
  openFloors,
  ownedOf,
  payTreats,
  placePerch,
  placedPerches,
  priceOf,
  recordRun,
  storePerch,
  takeGift,
  writeHouse,
  type Earlier,
  type GameId,
  type HouseReport,
  type HouseSave,
} from './house';
import {
  ATTIC_TOP,
  BASEMENT_DY,
  CHIMNEY,
  FLOORS,
  FLOOR_ORDER,
  HOUSE_TILES,
  LIVING_CUT,
  SPOUT,
  TUBES,
  chimneyShapes,
  floorAt,
  houseShell,
  tubeShapes,
  viewMid,
  type ExtraFloor,
  type FloorId,
  type Tube,
} from './layout';
import { hasFront, paintPerchBack as paintPerch, paintPerchFront, perchThumb } from './perchArt';
import { PERCHES, PERCH_ORDER, buildPerch, perchBox, placeProblem, snapPerch, type Box, type PerchKind, type PerchProp, type PlaceProblem } from './perches';
import { Tubes } from './tubes';

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
  /** Build the house again (a floor was opened): the cats stay where they are. */
  rebuild(): void;
}

const GAME_NAMES: Record<GameId, string> = { fits: 'If It Fits', jar: 'Cat Jar', drop: 'Cat Drop' };

/** Seconds between a cat's hops, at the least and the most. */
const HOP_GAP: [number, number] = [6, 13];

/** A place a cat may hop to: the top of what it lands on, how far either side of x, and the biggest cat that fits. */
interface Spot {
  x: number;
  y: number;
  half: number;
  maxR: number;
  floor: FloorId;
}

/** Collider ids of the house's own fittings (the tubes, the chimney). */
const FITTING_IDS = { chute: 90001, lift: 90002, chimney: 90003 };

/** Long-press on a perch to pick it up (ms), and how far a finger may wander before it's a scroll (px). */
const HOLD_MS = 420;
const SLOP = 9;

interface Placing {
  id: number;
  kind: PerchKind;
  x: number;
  y: number;
  /** Where it was (moving one that's out), to put it back on cancel. */
  prev: { x: number; y: number } | null;
}

type Drag =
  | { k: 'scroll'; id: number; sy: number; camY: number; t: number; lastY: number; lastT: number; v: number; moved: boolean }
  | { k: 'ghost'; id: number; dx: number; dy: number }
  | { k: 'hold'; id: number; sx: number; sy: number; perch: number; timer: number };

export class Home {
  house: HouseSave;
  readonly tubes: Tubes;
  private active = false;
  private readonly bar = document.getElementById('homeBar') as HTMLElement;
  private readonly labels: HTMLElement;
  private readonly labelEls = new Map<string, HTMLElement>();
  private readonly lift: HTMLElement;
  private readonly placeBar: HTMLElement;
  private readonly toastEl: HTMLElement;
  private toastTimer = 0;
  private hopIn = 4;
  private arrivalIn = -1;
  /** The cat who just arrived: their card shows once they've landed. */
  private newcomer: { cat: Cat; t: number } | null = null;
  private lastLabels = '';
  /** Perches out in the house (their colliders are in the world). */
  private perchProps: PerchProp[] = [];
  /** A perch being put somewhere. */
  placing: Placing | null = null;
  private drag: Drag | null = null;
  /** The camera: where it is, how fast it's going, and what it's after. */
  private camY = viewMid('living');
  private camV = 0;
  private camGoal: number | null = null;
  /** A cat riding a tube that the camera follows. */
  private follow: Cat | null = null;
  /** Treats earned while away, shown when you're back. */
  private pendingTreats = 0;
  private shownTreats = 0;
  /** The day's present, waiting on the floor to be opened. */
  private gift: { x: number; y: number; t: number } | null = null;
  /** Cats just out of a tube can't go straight back in. */
  private cooldown = new Map<Cat, number>();
  /** Cats leaping to another spot. */
  private leaps: { cat: Cat; t: number; T: number; x0: number; y0: number; x1: number; vUp: number; shape: Float64Array }[] = [];
  private saveIn = 5;

  constructor(
    private readonly host: HomeHost,
    earlier: Earlier,
  ) {
    this.house = loadHouse(earlier);
    writeHouse(this.house);
    this.shownTreats = this.house.treats;
    this.tubes = new Tubes(() => host.session.world);
    // labels in the house: the ways into the games, and the floors still to open
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
    for (const f of ['basement', 'roof'] as ExtraFloor[]) {
      const b = document.createElement('button');
      b.className = 'home-label home-sign';
      b.addEventListener('click', () => this.offerFloor(f));
      this.labels.appendChild(b);
      this.labelEls.set(f, b);
    }
    document.getElementById('app')!.appendChild(this.labels);
    for (const b of this.bar.querySelectorAll<HTMLElement>('[data-game]')) b.addEventListener('click', () => host.play(b.dataset.game as GameId));
    this.bar.querySelector('[data-act=shop]')?.addEventListener('click', () => this.showShop());
    // the next floor up and down: a pill at the top and the bottom of the view
    this.lift = document.createElement('div');
    this.lift.className = 'home-floors hidden';
    for (const dir of ['up', 'down'] as const) {
      const b = document.createElement('button');
      b.className = `floor-pill floor-${dir}`;
      b.dataset.dir = dir;
      b.addEventListener('click', () => {
        const f = this.nextFloor(dir === 'up' ? -1 : 1);
        if (!f) return;
        host.audio.click();
        this.goTo(f);
      });
      this.lift.appendChild(b);
    }
    document.getElementById('app')!.appendChild(this.lift);
    // the bar shown while putting a perch somewhere
    this.placeBar = document.createElement('div');
    this.placeBar.className = 'place-bar hidden';
    this.placeBar.innerHTML = `<p class="place-hint"></p><div class="place-btns"><button class="btn" data-place="away">Put away</button><button class="btn primary" data-place="ok">Put it here</button></div>`;
    this.placeBar.querySelector('[data-place=away]')!.addEventListener('click', () => this.endPlacing(false));
    this.placeBar.querySelector('[data-place=ok]')!.addEventListener('click', () => this.endPlacing(true));
    document.getElementById('app')!.appendChild(this.placeBar);
    // the house's own toast: it shows over any game (the games hide the room's page)
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'hh-toast';
    this.toastEl.setAttribute('role', 'status');
    this.toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.toastEl);
  }

  // ---------------------------------------------------------------------------
  // The house as a room

  /** The house, with everyone who lives here where they last were (or in their favourite spot). */
  room(): RoomDef {
    return houseRoom(this.house);
  }

  /**
   * The session's options for the house: its floors and slabs instead of a
   * room's walls, with the tubes, the chimney and the perches in from the
   * start (so a cat that was on a perch is still on it).
   */
  get sessionOptions(): SessionOptions {
    return {
      mode: 'sandbox',
      shell: () => {
        this.perchProps = placedPerches(this.house).map((p) => buildPerch(p));
        return [...houseShell(), ...this.fittingShapes(), ...this.perchProps.flatMap((p) => p.shapes)];
      },
    };
  }

  /** The house's own fittings' colliders: the chimney, and the tubes that are in. */
  private fittingShapes(): StaticShape[] {
    return [...chimneyShapes(FITTING_IDS.chimney), ...this.tubesIn().flatMap((t) => tubeShapes(t, FITTING_IDS[t.id]))];
  }

  /** The tubes that are in. */
  private tubesIn(): Tube[] {
    return TUBES.filter((t) => isOpen(this.house, t.needs));
  }

  private fittingBoxes(): Box[] {
    return fittingBoxes(this.house);
  }

  // ---------------------------------------------------------------------------
  // Painting (the renderer's stage)

  private perchKey(): string {
    return `${this.house.open.join(',')}|${this.perchProps.map((p) => `${p.save.kind}@${p.save.x},${p.save.y}`).join(';')}`;
  }

  readonly stage: Stage = {
    pan: [viewMid('roof'), viewMid('basement')],
    tiles: HOUSE_TILES,
    key: () => this.perchKey(),
    paintBack: (ctx, r, css) => this.paintBack(ctx, r, css),
    paintFront: (ctx, r) => this.paintFront(ctx, r),
    overlay: (ctx, dt) => this.paintOverlay(ctx, dt),
    inTube: (cat) => this.tubeFace(cat),
    behindFront: (cat) => this.behindFront(cat),
  };

  private paintBack(ctx: Ctx, r: Rect, css: number): void {
    const s = this.host.session;
    const h = this.house;
    const seed = 11;
    paintRoof(ctx, r, seed);
    paintAttic(ctx, r, seed);
    // the living room: walls, floor, decor, furniture, the ceiling with its hatch, the jar of cats
    const living = s.furniture.filter((p) => !p.dy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x0, LIVING_CUT, r.x1 - r.x0, FLOOR_Y + 44 - LIVING_CUT);
    ctx.clip();
    if (r.y1 > LIVING_CUT && r.y0 < FLOOR_Y + 44) {
      const decor = s.def.decor;
      const theme = THEMES.living;
      drawShell(ctx, theme, r.x0, Math.max(r.y0, LIVING_CUT), r.x1, Math.min(r.y1, FLOOR_Y + 44), seed);
      for (const d of decor) if (isFlat(d)) drawDecor(ctx, d, theme, seed + d.x);
      for (const p of living) drawFurniture(ctx, p, theme);
      for (const d of decor) if (!isFlat(d)) drawDecor(ctx, d, theme, seed + d.x);
      paintCeiling(ctx, { ...r, y0: Math.max(r.y0, LIVING_CUT) }, theme, seed);
      paintJarOfCats(ctx, JAR_SPOT.x, JAR_SPOT.y, JAR_SPOT.s, css);
      if (!isOpen(h, 'basement')) paintTrapdoor(ctx);
      this.paintPerches(ctx, 'living', false);
      for (const p of s.containers) {
        containerShadow(ctx, p);
        drawContainerBack(ctx, p);
      }
      drawSunbeams(ctx, decor);
    }
    ctx.restore();
    // the basement, and its furniture and perches
    paintBasement(ctx, r, isOpen(h, 'basement'), seed);
    if (isOpen(h, 'basement') && r.y1 > BASEMENT_DY - 20) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x0, BASEMENT_DY - 20, r.x1 - r.x0, FLOORS.basement.view1 - BASEMENT_DY + 20);
      ctx.clip();
      for (const p of s.furniture) {
        if (!p.dy) continue;
        ctx.save();
        ctx.translate(0, p.dy);
        drawFurniture(ctx, localFurniture(p), BASEMENT_THEME);
        ctx.restore();
      }
      // where cats land, under the chute
      paintPerch(ctx, 'beanbag', SPOUT.x, FLOORS.basement.floorY - PERCHES.beanbag.height, 7);
      this.paintPerches(ctx, 'basement', false);
      ctx.restore();
    }
    // the roof's perches
    if (r.y0 < ATTIC_TOP) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x0, r.y0, r.x1 - r.x0, ATTIC_TOP - r.y0);
      ctx.clip();
      this.paintPerches(ctx, 'roof', false);
      ctx.restore();
    }
    for (const t of this.tubesIn()) paintTubeBack(ctx, t);
    paintHouseFrame(ctx, r);
  }

  private paintPerches(ctx: Ctx, floor: FloorId, front: boolean): void {
    for (const p of this.perchProps) {
      if (p.floor !== floor) continue;
      if (front) {
        if (hasFront(p.save.kind)) paintPerchFront(ctx, p.save.kind, p.save.x, p.save.y, p.save.id);
      } else paintPerch(ctx, p.save.kind, p.save.x, p.save.y, p.save.id);
    }
  }

  private paintFront(ctx: Ctx, r: Rect): void {
    for (const f of FLOOR_ORDER) this.paintPerches(ctx, f, true);
    for (const t of this.tubesIn()) paintTubeFront(ctx, t);
    void r;
  }

  /** Over everything, each frame: a perch being placed, the day's present. */
  private paintOverlay(ctx: Ctx, dt: number): void {
    const pl = this.placing;
    if (pl) {
      const problem = this.problem(pl);
      const b = perchBox(pl.kind, pl.x, pl.y);
      const ok = problem === null;
      ctx.save();
      ctx.fillStyle = ok ? 'rgba(127,196,140,0.22)' : 'rgba(226,120,120,0.24)';
      ctx.strokeStyle = ok ? 'rgba(79,154,107,0.9)' : 'rgba(200,90,90,0.9)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      roundRect(ctx, b.x0 - 6, b.y0 - 6, b.x1 - b.x0 + 12, b.y1 - b.y0 + 12, 8);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = ok ? 1 : 0.7;
      paintPerch(ctx, pl.kind, pl.x, pl.y, pl.id);
      if (hasFront(pl.kind)) paintPerchFront(ctx, pl.kind, pl.x, pl.y, pl.id);
      ctx.restore();
    }
    const g = this.gift;
    if (g) {
      g.t += dt;
      paintPresent(ctx, g.x, g.y, g.t);
    }
  }

  // ---------------------------------------------------------------------------
  // Coming and going

  /** Seconds since the house came up (cats settling into their spots don't fuss). */
  since = 0;

  /** Called once the house's session is up. */
  enter(): void {
    this.active = true;
    this.since = 0;
    // (the fittings and perches came in with the house's shell: see sessionOptions)
    this.host.renderer.stage = this.stage;
    this.host.renderer.invalidate();
    this.camY = viewMid('living');
    this.camV = 0;
    this.camGoal = null;
    this.follow = null;
    this.host.renderer.scrollTo(this.camY, true);
    this.bar.classList.remove('hidden');
    this.labels.classList.remove('hidden');
    this.lift.classList.remove('hidden');
    this.lastLabels = '';
    this.hopIn = 5 + Math.random() * 4;
    this.newcomer = null;
    this.arrivalIn = this.house.arriving.length ? 1.1 : -1;
    // (on the floor between the funnel and the box)
    this.gift = giftDue(this.house, localDateKey()) ? { x: GIFT_SPOT.x, y: GIFT_SPOT.y, t: 0 } : null;
    this.refreshBar();
    this.refreshLift();
    if (this.pendingTreats > 0) {
      const n = this.pendingTreats;
      this.pendingTreats = 0;
      setTimeout(() => this.active && this.treatsGained(n), 500);
    }
    if (!this.house.welcomed) setTimeout(() => this.active && this.welcome(), 600);
  }

  leave(): void {
    if (this.active) {
      if (this.placing) this.endPlacing(false);
      this.tubes.finishAll();
      for (const l of this.leaps) l.t = l.T;
      this.stepLeaps();
      this.remember();
      writeHouse(this.house);
    }
    this.active = false;
    this.drag = null;
    this.bar.classList.add('hidden');
    this.labels.classList.add('hidden');
    this.lift.classList.add('hidden');
    this.placeBar.classList.add('hidden');
    this.host.renderer.stage = null;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Where everyone is, for next time. */
  private remember(): void {
    for (const c of this.host.session.cats) {
      if (this.tubes.riding(c)) continue;
      const b = c.body;
      b.computeCentroid();
      let maxY = -Infinity;
      for (let i = 0; i < b.n; i++) maxY = Math.max(maxY, b.y[i]);
      this.house.where[c.breed] = { x: Math.round(b.cx), y: Math.round(Math.min(maxY + 1, FLOORS[floorAt(b.cy)].floorY)) };
    }
  }

  private addShapes(propId: number, shapes: StaticShape[]): void {
    const w = this.host.session.world;
    w.removeStaticsOfProp(propId);
    for (const sh of shapes) w.addStatic(sh);
  }

  private addPerch(p: HouseSave['perches'][number]): void {
    const prop = buildPerch(p);
    this.perchProps.push(prop);
    this.addShapes(prop.propId, prop.shapes);
  }

  private removePerch(id: number): void {
    const i = this.perchProps.findIndex((p) => p.save.id === id);
    if (i < 0) return;
    this.host.session.world.removeStaticsOfProp(this.perchProps[i].propId);
    this.perchProps.splice(i, 1);
    this.host.session.registerShapes();
  }

  /** The way into a game at a world point, if any. */
  portalAt(x: number, y: number): Portal | null {
    return portalAt(x, y);
  }

  // ---------------------------------------------------------------------------
  // Progress

  /** A game says how a run went: treats, and cats may have earned their place. */
  report(r: HouseReport): void {
    const treats = payTreats(this.house, r);
    const fresh = recordRun(this.house, r);
    writeHouse(this.house);
    if (fresh.length) {
      const b = fresh[0];
      const more = fresh.length > 1 ? ` (and ${NAMES[fresh[1]]}!)` : '';
      this.toast(b, `${NAMES[b]} the ${BREEDS[b].name} wants to move in!${more}`);
    }
    if (treats > 0) {
      if (this.active) this.treatsGained(treats);
      else this.pendingTreats += treats;
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

  /** Treats came in: the count on the shop's tin goes up, with a "+n" over it. */
  private treatsGained(n: number): void {
    const note = this.bar.querySelector<HTMLElement>('[data-act=shop] .tin-note');
    if (note) {
      const pop = document.createElement('span');
      pop.className = 'treat-pop';
      pop.textContent = `+${n}`;
      note.parentElement!.appendChild(pop);
      setTimeout(() => pop.remove(), 1600);
    }
    this.host.audio.seat(90);
    const from = this.shownTreats;
    const to = this.house.treats;
    const t0 = performance.now();
    const tick = (): void => {
      const u = Math.min(1, (performance.now() - t0) / 900);
      this.shownTreats = Math.round(from + (to - from) * u);
      this.refreshTreats();
      if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private refreshTreats(): void {
    const note = this.bar.querySelector<HTMLElement>('[data-act=shop] .tin-note');
    if (note) note.innerHTML = `${treatIcon(13)} ${this.shownTreats}`;
    this.bar.querySelector('[data-act=shop]')?.setAttribute('aria-label', `Shop. ${this.house.treats} treats`);
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
    if (this.shownTreats > this.house.treats) this.shownTreats = this.house.treats;
    this.refreshTreats();
  }

  private bestNote(best: number): string {
    return best > 0 ? `best ${best.toLocaleString('en-US')}` : 'new!';
  }

  /** The floor above (-1) or below (1) the one in view. */
  private nextFloor(dir: -1 | 1): FloorId | null {
    const i = FLOOR_ORDER.indexOf(this.floorInView) + dir;
    return FLOOR_ORDER[i] ?? null;
  }

  private refreshLift(): void {
    this.lastLabels = '';
  }

  // ---------------------------------------------------------------------------
  // Every step and every frame while home

  /** One fixed physics step: the tubes. */
  step(): void {
    if (!this.active) return;
    this.tubes.step();
    this.stepLeaps();
    // a cat that falls into the funnel goes down to the basement
    const chute = this.tubesIn().find((t) => t.id === 'chute');
    if (chute) {
      for (const c of this.host.session.cats) {
        if (c.grabbed || this.tubes.riding(c) || (this.cooldown.get(c) ?? 0) > 0) continue;
        const b = c.body;
        b.computeCentroid();
        const z = chute.upper.zone;
        if (b.cx > z.x0 && b.cx < z.x1 && b.cy > z.y0 && b.cy < z.y1 && b.vcy > -60) this.ride(c, chute, false);
      }
    }
    for (const [c, t] of this.cooldown) {
      if (t <= 1) this.cooldown.delete(c);
      else this.cooldown.set(c, t - 1);
    }
    for (const e of this.tubes.drain()) {
      const b = BREEDS[e.cat.breed];
      if (e.t === 'in') {
        this.host.audio.glorp(b.voice.pitch * 1.1, 0.4, 0.1);
      } else {
        this.host.audio.boop(b.voice.pitch);
        this.host.renderer.puff(e.x, e.y + e.cat.body.p.radius, 5);
        this.cooldown.set(e.cat, 70);
        if (this.follow === e.cat) {
          this.follow = null;
          this.camGoal = viewMid(floorAt(e.y));
        }
      }
    }
  }

  tick(dt: number): void {
    if (!this.active) return;
    this.since += dt;
    this.moveCamera(dt);
    this.placeLabels();
    this.saveIn -= dt;
    if (this.saveIn <= 0) {
      this.saveIn = 5;
      this.remember();
      writeHouse(this.house);
    }
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
    if (this.host.overlayOpen() || this.host.busy() || this.placing) return;
    this.hopIn -= dt;
    if (this.hopIn <= 0) {
      this.hopIn = HOP_GAP[0] + Math.random() * (HOP_GAP[1] - HOP_GAP[0]);
      this.wander(s);
    }
  }

  /** The camera: follows a finger, coasts after a fling, eases to a floor, follows a cat through a tube. */
  private moveCamera(dt: number): void {
    const r = this.host.renderer;
    const [lo, hi] = this.stage.pan;
    if (this.drag?.k === 'scroll') {
      // (the finger moves it: see the pointer handlers)
    } else if (this.follow) {
      const t = this.tubes.riding(this.follow);
      if (t) {
        this.follow.body.computeCentroid();
        this.spring(clamp(this.follow.body.cy, lo, hi), 9, dt);
      } else this.follow = null;
    } else if (this.camGoal !== null) {
      this.spring(this.camGoal, 7, dt);
      if (Math.abs(this.camY - this.camGoal) < 0.5 && Math.abs(this.camV) < 5) {
        this.camY = this.camGoal;
        this.camV = 0;
        this.camGoal = null;
      }
    } else if (Math.abs(this.camV) > 1) {
      // coasting after a fling, then settling on the nearest floor if it's close
      this.camY += this.camV * dt;
      this.camV *= Math.exp(-4.5 * dt);
      if (this.camY < lo || this.camY > hi) {
        this.camY = clamp(this.camY, lo, hi);
        this.camV = 0;
      }
      if (Math.abs(this.camV) < 60) {
        this.camV = 0;
        const near = FLOOR_ORDER.map((f) => viewMid(f)).reduce((a, b) => (Math.abs(b - this.camY) < Math.abs(a - this.camY) ? b : a));
        if (Math.abs(near - this.camY) < 150) this.camGoal = near;
      }
    }
    this.camY = clamp(this.camY, lo, hi);
    r.scrollTo(this.camY, true);
  }

  private spring(goal: number, k: number, dt: number): void {
    const a = k * k * (goal - this.camY) - 2 * k * this.camV;
    this.camV += a * dt;
    this.camY += this.camV * dt;
  }

  /** Scroll to a floor. */
  goTo(f: FloorId): void {
    this.follow = null;
    this.camGoal = viewMid(f);
  }

  /** The floor most of the screen shows. */
  get floorInView(): FloorId {
    return floorAt(this.camY);
  }

  /** Keep the labels on their things (they only move when the view does). */
  private placeLabels(): void {
    const r = this.host.renderer;
    const key = `${r.W}x${r.H}:${r.scale.toFixed(3)}:${r.ox.toFixed(1)}:${r.oy.toFixed(1)}:${this.camY.toFixed(1)}:${this.house.open.join()}:${this.placing ? 1 : 0}`;
    if (key === this.lastLabels) return;
    this.lastLabels = key;
    const show = (el: HTMLElement, x: number, y: number, on: boolean): void => {
      const q = r.worldToScreen(x, y);
      const visible = on && q.y > 70 && q.y < r.H - 90;
      el.classList.toggle('off', !visible);
      el.style.transform = `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px) translate(-50%, -100%)`;
    };
    for (const p of PORTALS) show(this.labelEls.get(p.game)!, p.lx, p.ly, !this.placing);
    const h = this.house;
    const bs = this.labelEls.get('basement')!;
    bs.innerHTML = `🔒 Basement · ${treatIcon(13)} ${FLOOR_PRICES.basement}`;
    bs.setAttribute('aria-label', `Open the basement for ${FLOOR_PRICES.basement} treats`);
    show(bs, WORLD_W / 2, BASEMENT_DY + 230, !isOpen(h, 'basement') && !this.placing);
    const rs = this.labelEls.get('roof')!;
    rs.innerHTML = `🔒 Roof garden · ${treatIcon(13)} ${FLOOR_PRICES.roof}`;
    rs.setAttribute('aria-label', `Open the roof garden for ${FLOOR_PRICES.roof} treats`);
    show(rs, 230, FLOORS.roof.floorY - 150, !isOpen(h, 'roof') && !this.placing);
    // the next floor up and down
    for (const b of this.lift.querySelectorAll<HTMLElement>('[data-dir]')) {
      const up = b.dataset.dir === 'up';
      const f = this.nextFloor(up ? -1 : 1);
      b.classList.toggle('off', !f || !!this.placing);
      if (!f) continue;
      const lock = isOpen(h, f) ? '' : ' 🔒';
      b.innerHTML = `<span class="floor-arrow" aria-hidden="true">${up ? '▲' : '▼'}</span><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-floor-${f}"/></svg>${FLOORS[f].name}${lock}`;
      b.setAttribute('aria-label', `${up ? 'Up to' : 'Down to'} the ${FLOORS[f].name.toLowerCase()}${lock ? ' (not open yet)' : ''}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Cats' lives

  /** The places a cat may hop to on a floor. */
  private spots(): Spot[] {
    const s = this.host.session;
    const out: Spot[] = [];
    const add = (x0: number, x1: number, y: number, maxR: number): void => {
      const f = floorAt(y - 1);
      if (!isOpen(this.house, f)) return;
      out.push({ x: (x0 + x1) / 2, y, half: Math.max(4, (x1 - x0) / 2 - 22), maxR, floor: f });
    };
    for (const p of s.furniture) for (const sf of p.surfaces) add(sf.x0, sf.x1, sf.y, Math.min(44, (sf.x1 - sf.x0) * 0.42));
    for (const p of this.perchProps) {
      for (const sf of p.surfaces) {
        const k = p.save.kind;
        const maxR = k === 'hammock' || k === 'pod' || k === 'beanbag' ? 42 : Math.min(40, (sf.x1 - sf.x0) * 0.44);
        add(sf.x0, sf.x1, sf.y, maxR);
      }
    }
    // in the box and the basket
    for (const c of s.containers) out.push({ x: c.x, y: (c.opening?.y ?? c.y) + 60, half: 6, maxR: 44, floor: 'living' });
    // floors, clear of the tubes
    add(110, 132, FLOOR_Y, 30);
    if (isOpen(this.house, 'basement')) {
      add(110, 270, FLOORS.basement.floorY, 44);
      add(SPOUT.x - 20, SPOUT.x + 20, FLOORS.basement.floorY - PERCHES.beanbag.height, 44);
    }
    if (isOpen(this.house, 'roof')) {
      add(110, 270, FLOORS.roof.floorY, 44);
      add(CHIMNEY.x0, CHIMNEY.x1, CHIMNEY.y, 40);
    }
    return out;
  }

  /** Now and then a cat who's been resting a while hops to a free spot nearby (they like going up). */
  private wander(s: Session): void {
    const idle = s.cats.filter((c) => !c.grabbed && !this.tubes.riding(c) && !this.leaping(c) && c.settled > 90 && c.sinceTouch > 240);
    if (!idle.length) return;
    const cat = idle[Math.floor(Math.random() * idle.length)];
    const b = cat.body;
    b.computeCentroid();
    const r = b.p.radius;
    const floor = floorAt(b.cy);
    let bottom = -Infinity;
    for (let i = 0; i < b.n; i++) bottom = Math.max(bottom, b.y[i]);
    const free = this.spots().filter((p) => {
      if (p.floor !== floor || r > p.maxR) return false;
      if (p.y - 2 * r - 8 < FLOORS[floor].ceilY) return false;
      const dx = p.x - b.cx;
      const rise = bottom - p.y;
      if (Math.abs(dx) < 30 && Math.abs(rise) < 30) return false;
      if (Math.abs(dx) > 230 || rise > 150) return false;
      // (no jumping straight up into the underside of a shelf overhead: up from the side)
      if (rise > 10 && Math.abs(dx) < p.half + 22 + r + 4) return false;
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
    // higher spots are the favourites
    const weights = free.map((p) => 1 + Math.max(0, bottom - p.y) / 70);
    let pick = Math.random() * weights.reduce((a, w) => a + w, 0);
    let p = free[0];
    for (let i = 0; i < free.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        p = free[i];
        break;
      }
    }
    this.hop(cat, p.x + (Math.random() * 2 - 1) * p.half, p.y);
  }

  /**
   * Leap so as to land with the cat's middle just over (x, y - r): a real
   * gravity arc, high enough to clear the edge of what it's landing on, the
   * cat stretching a little along the way it's flying. (A ballistic kick
   * fell short: a soft body pushing off the floor loses much of its spring,
   * and up onto a shelf it bumped the edge.) It's out of the physics while it
   * flies, and lands in it with the speed it's falling at.
   */
  private hop(cat: Cat, x: number, y: number): void {
    const b = cat.body;
    b.computeCentroid();
    const r = b.p.radius;
    const x1 = x;
    const y1 = y - r * 0.92 - 2;
    const up = y1 < b.cy - 20;
    const ceil = FLOORS[floorAt(b.cy)].ceilY + r + 6;
    const apex = Math.max(ceil, Math.min(b.cy, y1) - 40 - Math.abs(x1 - b.cx) * 0.12 - (up ? 16 : 0));
    const vUp = Math.sqrt(2 * GRAVITY * Math.max(4, b.cy - apex));
    const tUp = vUp / GRAVITY;
    const T = tUp + Math.sqrt((2 * Math.max(4, y1 - apex)) / GRAVITY);
    const shape = new Float64Array(b.n * 2);
    for (let i = 0; i < b.n; i++) {
      shape[i * 2] = b.x[i] - b.cx;
      shape[i * 2 + 1] = b.y[i] - b.cy;
    }
    this.host.session.world.removeBody(b);
    this.leaps.push({ cat, t: 0, T, x0: b.cx, y0: b.cy, x1, vUp, shape });
    cat.intent = null;
    cat.sinceTouch = 0;
    this.host.audio.grab(BREEDS[cat.breed].voice.pitch, false);
  }

  /** One step of every leap. */
  private stepLeaps(): void {
    for (const l of [...this.leaps]) {
      l.t = Math.min(l.T, l.t + 1 / 60);
      const b = l.cat.body;
      const u = l.t / l.T;
      const cx = l.x0 + (l.x1 - l.x0) * u;
      const cy = l.y0 - l.vUp * l.t + 0.5 * GRAVITY * l.t * l.t;
      // stretched a touch along the way it's going (and as much thinner across)
      const vx = (l.x1 - l.x0) / l.T;
      const vy = -l.vUp + GRAVITY * l.t;
      const sp = Math.hypot(vx, vy) || 1;
      const k = 1 + Math.min(0.14, sp / 5000);
      const ux = vx / sp;
      const uy = vy / sp;
      for (let i = 0; i < b.n; i++) {
        const ox = l.shape[i * 2];
        const oy = l.shape[i * 2 + 1];
        const along = ox * ux + oy * uy;
        const across = -ox * uy + oy * ux;
        b.x[i] = cx + along * k * ux - (across / k) * uy;
        b.y[i] = cy + along * k * uy + (across / k) * ux;
      }
      b.airborneFrames++;
      if (l.t >= l.T) {
        for (let i = 0; i < b.n; i++) {
          b.px[i] = b.x[i];
          b.py[i] = b.y[i];
          b.vx[i] = vx * 0.5;
          b.vy[i] = vy;
        }
        b.wake();
        b.computeCentroid();
        this.host.session.world.addBody(b);
        this.leaps.splice(this.leaps.indexOf(l), 1);
      }
    }
  }

  /** Is this cat in the middle of a leap? */
  private leaping(cat: Cat): boolean {
    return this.leaps.some((l) => l.cat === cat);
  }

  /** The next cat on the way drops in through the attic hatch. */
  private dropIn(): void {
    const b = arrive(this.house);
    writeHouse(this.house);
    if (!b) return;
    const s = this.host.session;
    // out of the hatch and onto the top cat step
    const x = (HATCH.x0 + HATCH.x1) / 2;
    const cat = s.addCat(b, x, CEIL_Y + 4 - BREEDS[b].physics.radius, NAMES[b]);
    cat.body.kick(70, 90);
    cat.sinceTouch = 0;
    this.host.renderer.puff(x, CEIL_Y + 10, 6);
    this.host.audio.reveal();
    this.newcomer = { cat, t: 0 };
    this.arrivalIn = this.house.arriving.length ? 0.6 : -1;
    this.goTo('living');
    this.refreshBar();
  }

  // ---------------------------------------------------------------------------
  // The tubes

  /** Send a cat through a tube (the camera goes along). */
  private ride(cat: Cat, tube: Tube, up: boolean): void {
    this.tubes.start(cat, tube, up);
    this.follow = cat;
    this.camGoal = null;
  }

  /** A cat was let go: under a hood, it's sucked in. */
  released(cat: Cat): void {
    if (!this.active) return;
    const b = cat.body;
    b.computeCentroid();
    const hit = Tubes.mouthAt(this.tubesIn(), b.cx, b.cy, 'hood');
    if (hit) this.ride(cat, hit.tube, hit.up);
  }

  /** Can this cat be picked up or booped (not while it's in a tube)? */
  canTouch(cat: Cat): boolean {
    return !this.tubes.riding(cat) && !this.leaping(cat);
  }

  /** Where a carried cat can be taken: around its own floor. */
  carryBox(cat: Cat): { x0: number; x1: number; y0: number; y1: number } {
    cat.body.computeCentroid();
    const f = FLOORS[floorAt(cat.body.cy)];
    return { x0: 4, x1: WORLD_W - 4, y0: f.ceilY + 40, y1: f.floorY - 4 };
  }

  private tubeFace(cat: Cat): Expression | null {
    const t = this.tubes.riding(cat);
    if (!t) return null;
    return t.phase === 'go' ? 'happy' : 'wide';
  }

  /** Cats in the glass, and in a pod or a hammock, are drawn behind the glass and the perches' fronts. */
  private behindFront(cat: Cat): boolean {
    if (this.tubes.riding(cat)) return true;
    const b = cat.body;
    for (const p of this.perchProps) {
      if (!hasFront(p.save.kind)) continue;
      const bx = p.box;
      if (b.cx > bx.x0 && b.cx < bx.x1 && b.cy > bx.y0 - b.p.radius && b.cy < bx.y1) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Fingers: scrolling, placing perches, picking one up, the day's present

  /**
   * A finger down where there's no cat. Returns true if the house takes it
   * (a scroll, a perch, the present), false to let the room have it.
   */
  pointerDown(id: number, sx: number, sy: number, wx: number, wy: number): boolean {
    if (!this.active) return false;
    const pl = this.placing;
    if (pl) {
      const b = perchBox(pl.kind, pl.x, pl.y);
      const slop = 26 * this.host.renderer.unitsPerPx * 2;
      if (wx > b.x0 - slop && wx < b.x1 + slop && wy > b.y0 - slop && wy < b.y1 + slop) {
        this.drag = { k: 'ghost', id, dx: pl.x - wx, dy: pl.y - wy };
        return true;
      }
    }
    if (!pl) {
      const perch = this.perchProps.find((p) => wx > p.box.x0 && wx < p.box.x1 && wy > p.box.y0 && wy < p.box.y1);
      if (perch) {
        const timer = window.setTimeout(() => this.pickUp(perch.save.id), HOLD_MS);
        this.drag = { k: 'hold', id, sx, sy, perch: perch.save.id, timer };
        return true;
      }
    }
    this.startScroll(id, sy);
    return true;
  }

  private startScroll(id: number, sy: number): void {
    const t = performance.now();
    this.drag = { k: 'scroll', id, sy, camY: this.camY, t, lastY: sy, lastT: t, v: 0, moved: false };
    this.camGoal = null;
    this.follow = null;
    this.camV = 0;
  }

  pointerMove(id: number, sx: number, sy: number, wx: number, wy: number): void {
    const d = this.drag;
    if (!d || d.id !== id) return;
    if (d.k === 'hold') {
      if (Math.hypot(sx - d.sx, sy - d.sy) > SLOP) {
        clearTimeout(d.timer);
        this.startScroll(id, d.sy);
        this.pointerMove(id, sx, sy, wx, wy);
      }
      return;
    }
    if (d.k === 'scroll') {
      const r = this.host.renderer;
      if (Math.abs(sy - d.sy) > SLOP) d.moved = true;
      const [lo, hi] = this.stage.pan;
      const want = d.camY - (sy - d.sy) * r.unitsPerPx;
      // a little give past the ends
      this.camY = want < lo ? lo - (lo - want) * 0.3 : want > hi ? hi + (want - hi) * 0.3 : want;
      const now = performance.now();
      const dtv = Math.max(1, now - d.lastT);
      const v = (-(sy - d.lastY) * r.unitsPerPx) / (dtv / 1000);
      d.v = d.v * 0.6 + v * 0.4;
      d.lastY = sy;
      d.lastT = now;
      this.host.renderer.scrollTo(this.camY, true);
      return;
    }
    // dragging a perch: it follows the finger (and the view scrolls at the screen's edges)
    const pl = this.placing;
    if (!pl) return;
    const p = snapPerch(pl.kind, wx + d.dx, wy + d.dy);
    pl.x = Math.round(p.x);
    pl.y = Math.round(p.y);
    const r = this.host.renderer;
    const edge = sy < 110 ? -1 : sy > r.H - 150 ? 1 : 0;
    if (edge) {
      this.camGoal = null;
      this.camV = edge * 320;
    }
    this.refreshPlaceBar();
  }

  pointerUp(id: number): boolean {
    const d = this.drag;
    if (!d || d.id !== id) return false;
    this.drag = null;
    if (d.k === 'hold') {
      clearTimeout(d.timer);
      return true;
    }
    if (d.k === 'scroll') {
      const fresh = performance.now() - d.lastT < 80;
      this.camV = fresh ? clamp(d.v, -2600, 2600) : 0;
      if (!d.moved) this.camV = 0;
      if (Math.abs(this.camV) < 60) {
        // a still finger: ease onto the nearest floor if it's close
        this.camV = 0;
        const near = FLOOR_ORDER.map((f) => viewMid(f)).reduce((a, b) => (Math.abs(b - this.camY) < Math.abs(a - this.camY) ? b : a));
        const [lo, hi] = this.stage.pan;
        if (this.camY < lo || this.camY > hi) this.camGoal = clamp(this.camY, lo, hi);
        else if (Math.abs(near - this.camY) < 150) this.camGoal = near;
      }
      return true;
    }
    this.camV = 0;
    return true;
  }

  /** Mouse wheel / trackpad: scroll the house. */
  wheel(dy: number): void {
    if (!this.active) return;
    this.follow = null;
    this.camGoal = null;
    this.camV = 0;
    this.camY = clamp(this.camY + dy * 0.9, this.stage.pan[0], this.stage.pan[1]);
    window.clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => {
      const near = FLOOR_ORDER.map((f) => viewMid(f)).reduce((a, b) => (Math.abs(b - this.camY) < Math.abs(a - this.camY) ? b : a));
      if (Math.abs(near - this.camY) < 120) this.camGoal = near;
    }, 220);
  }
  private wheelTimer = 0;

  // ---------------------------------------------------------------------------
  // Perches: buying, putting somewhere, moving

  private problem(pl: Placing): PlaceProblem {
    const taken: Box[] = [...this.fittingBoxes()];
    const s = this.host.session;
    for (const p of s.props) taken.push({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 });
    for (const p of this.perchProps) if (p.save.id !== pl.id) taken.push(p.box);
    for (const pt of PORTALS) if (pt.game !== 'fits') taken.push({ x0: pt.x0, y0: pt.y0, x1: pt.x1, y1: pt.y1 });
    taken.push({ x0: JAR_SPOT.x - 40, y0: JAR_SPOT.y - 80, x1: JAR_SPOT.x + 40, y1: JAR_SPOT.y });
    const pr = placeProblem(pl.kind, pl.x, pl.y, openFloors(this.house), taken);
    if (pr) return pr;
    // not on top of a cat
    const b = perchBox(pl.kind, pl.x, pl.y);
    for (const c of s.cats) {
      const cb = c.body;
      cb.computeCentroid();
      const r = cb.p.radius * 0.8;
      if (cb.cx + r > b.x0 && cb.cx - r < b.x1 && cb.cy + r > b.y0 && cb.cy - r < b.y1) return 'cat';
    }
    return null;
  }

  /** Start putting a perch somewhere: in the middle of the floor you're looking at, somewhere free. */
  private startPlacing(id: number, kind: PerchKind, prev: Placing['prev']): void {
    this.host.closeOverlay();
    const f = isOpen(this.house, this.floorInView) ? this.floorInView : 'living';
    if (this.floorInView !== f) this.goTo(f);
    const mid = viewMid(f);
    const pl: Placing = { id, kind, x: WORLD_W / 2, y: mid, prev };
    // look for a free spot near the middle of the view
    let best: { x: number; y: number } | null = null;
    outer: for (let ring = 0; ring < 14; ring++) {
      for (const [ox, oy] of [
        [0, 0],
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const p = snapPerch(kind, WORLD_W / 2 + ox * ring * 22, mid - 40 + oy * ring * 22);
        pl.x = Math.round(p.x);
        pl.y = Math.round(p.y);
        if (this.problem(pl) === null) {
          best = { x: pl.x, y: pl.y };
          break outer;
        }
      }
    }
    if (best) {
      pl.x = best.x;
      pl.y = best.y;
    } else {
      const p = snapPerch(kind, WORLD_W / 2, mid);
      pl.x = Math.round(p.x);
      pl.y = Math.round(p.y);
    }
    this.placing = pl;
    this.bar.classList.add('hidden');
    this.placeBar.classList.remove('hidden');
    this.lastLabels = '';
    this.refreshPlaceBar();
  }

  private refreshPlaceBar(): void {
    const pl = this.placing;
    if (!pl) return;
    const pr = this.problem(pl);
    const name = PERCHES[pl.kind].name.toLowerCase();
    const why: Record<Exclude<PlaceProblem, null>, string> = {
      locked: 'That floor isn’t open yet',
      outside: PERCHES[pl.kind].mount === 'floor' ? 'It stands on a floor' : 'Keep it inside the room, off the floor',
      blocked: 'Something’s in the way',
      sky: 'Out in the open only a cloud shelf floats',
      cat: 'A cat’s in the way',
    };
    (this.placeBar.querySelector('.place-hint') as HTMLElement).textContent = pr ? why[pr] : `Drag the ${name} where you’d like it`;
    (this.placeBar.querySelector('[data-place=ok]') as HTMLButtonElement).disabled = pr !== null;
    (this.placeBar.querySelector('[data-place=away]') as HTMLElement).textContent = pl.prev ? 'Put it back' : 'Put away';
  }

  /** Done placing: put it there (or back in the cupboard / where it was). */
  endPlacing(ok: boolean): void {
    const pl = this.placing;
    if (!pl) return;
    if (ok && this.problem(pl) !== null) return;
    this.placing = null;
    this.drag = null;
    this.placeBar.classList.add('hidden');
    this.bar.classList.remove('hidden');
    this.lastLabels = '';
    const h = this.house;
    if (ok) {
      placePerch(h, pl.id, pl.x, pl.y);
      this.host.audio.seat(80);
      this.host.renderer.puff(pl.x, pl.y + 4, 6);
    } else if (pl.prev) placePerch(h, pl.id, pl.prev.x, pl.prev.y);
    else storePerch(h, pl.id);
    const save = h.perches.find((p) => p.id === pl.id);
    if (save && !save.stored) {
      this.addPerch(save);
      this.host.session.registerShapes();
      this.host.session.world.wakeAll();
    }
    writeHouse(h);
    this.host.renderer.invalidate();
  }

  /** Long-pressed a perch: up it comes, to be put somewhere else. */
  private pickUp(id: number): void {
    const d = this.drag;
    if (d?.k === 'hold') this.drag = null;
    const p = this.perchProps.find((q) => q.save.id === id);
    if (!p || this.placing) return;
    const prev = { x: p.save.x, y: p.save.y };
    this.removePerch(id);
    this.host.session.world.wakeAll();
    this.host.renderer.invalidate();
    this.host.audio.grab(1.2, false);
    this.placing = { id, kind: p.save.kind, x: prev.x, y: prev.y, prev };
    this.bar.classList.add('hidden');
    this.placeBar.classList.remove('hidden');
    this.lastLabels = '';
    this.refreshPlaceBar();
    // the same finger carries on dragging it
    if (d?.k === 'hold') {
      const r = this.host.renderer;
      const w = r.screenToWorld(d.sx, d.sy);
      this.drag = { k: 'ghost', id: d.id, dx: prev.x - w.x, dy: prev.y - w.y };
    }
  }

  // ---------------------------------------------------------------------------
  // The day's present

  /** A tap on the present opens it. */
  openGiftAt(wx: number, wy: number): boolean {
    const g = this.gift;
    if (!this.active || !g || this.placing || Math.abs(wx - g.x) > 24 || wy < g.y - 40 || wy > g.y + 8) return false;
    this.openGift();
    return true;
  }

  private openGift(): void {
    const g = this.gift;
    if (!g) return;
    this.gift = null;
    const n = takeGift(this.house, localDateKey());
    writeHouse(this.house);
    const r = this.host.renderer;
    r.hearts(g.x, g.y - 30, 3);
    r.label(g.x, g.y - 46, `+${n} treats!`, '#D9A62E');
    r.puff(g.x, g.y - 8, 6);
    this.host.audio.reveal();
    if (n > 0) this.treatsGained(n);
  }

  // ---------------------------------------------------------------------------
  // Cards

  private welcome(): void {
    const faces = this.house.residents.map((b) => `<span class="hc-face">${faceSVG(b, { mood: 'happy', size: 44 })}</span>`).join('');
    this.host.openOverlay(
      `<div class="card" role="dialog" aria-label="Welcome home">
        <h2>Welcome home!</h2>
        <div class="hc-faces">${faces}</div>
        <p class="sub">${this.names(this.house.residents)} live here. Play any game to earn treats, and more cats will move in.</p>
        <p class="hc-games"><b>If It Fits</b> · the box on the rug<br><b>Cat Jar</b> · the jar on the shelf<br><b>Cat Drop</b> · up through the attic hatch</p>
        <p class="hc-games">Spend treats in the <b>shop</b> on perches for the cats, and to open up the basement and the roof garden. Swipe up and down to look round the house.</p>
        <div class="btns"><button class="btn primary" data-close>Let's play</button></div>
      </div>`,
    );
    this.house.welcomed = true;
    this.house.gift = localDateKey();
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

  /** The shop: the floors still to open, and perches. */
  showShop(): void {
    this.host.audio.click();
    const h = this.house;
    const floors = (['basement', 'roof'] as ExtraFloor[])
      .map((f) => {
        const open = isOpen(h, f);
        const price = FLOOR_PRICES[f];
        const blurb = f === 'basement' ? 'A snug den right under the living room, and a funnel in the floor to drop cats down to it' : 'A sunny garden up on the roof, and a suction tube over the cat steps to whoosh cats up to it';
        const btn = open ? '<span class="shop-done">open ✓</span>' : `<button class="btn primary shop-buy" data-floor="${f}" ${h.treats < price ? 'disabled' : ''}>${treatIcon(14)} ${price}</button>`;
        return `<div class="shop-row"><span class="shop-pic shop-floor"><svg viewBox="0 0 24 24"><use href="#i-floor-${f}"/></svg></span><span class="shop-what"><b>${FLOORS[f].name}</b><small>${blurb}</small></span>${btn}</div>`;
      })
      .join('');
    const perches = PERCH_ORDER.map((k) => {
      const price = priceOf(h, k);
      const stored = h.perches.filter((p) => p.kind === k && p.stored).length;
      const owned = ownedOf(h, k);
      const extra = stored ? `<button class="btn shop-place" data-place="${k}">Place (${stored})</button>` : '';
      return `<div class="shop-row" data-kind="${k}"><span class="shop-pic"></span><span class="shop-what"><b>${PERCHES[k].name}</b><small>${PERCHES[k].blurb}${owned ? ` · you have ${owned}` : ''}</small></span><span class="shop-btns">${extra}<button class="btn primary shop-buy" data-perch="${k}" ${h.treats < price ? 'disabled' : ''}>${treatIcon(14)} ${price}</button></span></div>`;
    }).join('');
    this.host.openOverlay(
      `<div class="card shop-card" role="dialog" aria-label="Shop">
        <h2>Shop</h2>
        <p class="sub shop-treats">${treatIcon(18)} <b>${h.treats}</b> treats · earn more in every game</p>
        <h3 class="shop-h">The house</h3>
        <div class="shop-rows">${floors}</div>
        <h3 class="shop-h">Perches</h3>
        <div class="shop-rows">${perches}</div>
        <p class="shop-tip">Put perches anywhere: up a wall, the cats hop up them. Press and hold a perch to move it.</p>
        <div class="btns"><button class="btn" data-close>Close</button></div>
      </div>`,
      (root) => {
        root.querySelectorAll<HTMLElement>('[data-kind]').forEach((el) => el.querySelector('.shop-pic')!.appendChild(perchThumbSafe(el.dataset.kind as PerchKind)));
        root.querySelectorAll<HTMLElement>('[data-perch]').forEach((el) =>
          el.addEventListener('click', () => {
            const k = el.dataset.perch as PerchKind;
            const p = buyPerch(h, k);
            if (!p) return;
            writeHouse(h);
            this.shownTreats = h.treats;
            this.refreshTreats();
            this.host.audio.seat(70);
            this.startPlacing(p.id, k, null);
          }),
        );
        root.querySelectorAll<HTMLElement>('[data-place]').forEach((el) =>
          el.addEventListener('click', () => {
            const k = el.dataset.place as PerchKind;
            const p = h.perches.find((q) => q.kind === k && q.stored);
            if (p) this.startPlacing(p.id, k, null);
          }),
        );
        root.querySelectorAll<HTMLElement>('[data-floor]').forEach((el) => el.addEventListener('click', () => this.openFloor(el.dataset.floor as ExtraFloor)));
      },
    );
  }

  /** The lock sign on a floor: open it up? */
  private offerFloor(f: ExtraFloor): void {
    this.showShop();
    void f;
  }

  private openFloor(f: ExtraFloor): void {
    if (!buyFloor(this.house, f)) return;
    this.remember();
    writeHouse(this.house);
    this.host.closeOverlay();
    this.shownTreats = this.house.treats;
    this.host.rebuild();
    this.host.audio.reveal();
    this.goTo(f);
    const r = this.host.renderer;
    const y = f === 'basement' ? FLOORS.basement.floorY - 200 : FLOORS.roof.floorY - 200;
    setTimeout(() => {
      r.hearts(WORLD_W / 2, y, 5);
      r.label(WORLD_W / 2, y - 20, f === 'basement' ? 'The basement’s open!' : 'The roof garden’s open!', '#D9A62E');
    }, 500);
    const cat = this.house.residents[0];
    if (cat) this.toast(cat, f === 'basement' ? 'Drop a cat in the funnel to send it down!' : 'Put a cat under the hood by the cat steps to whoosh it up!', 4200);
  }

  private names(list: BreedId[]): string {
    const n = list.map((b) => NAMES[b]);
    return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  }
}

/** Decor laid flat on the wall or floor (painted under the furniture). */
function isFlat(d: DecorPlacement): boolean {
  return d.type === 'rug' || d.type === 'backsplash' || d.type === 'window' || d.type === 'picture' || d.type === 'mirror' || d.type === 'clock' || d.type === 'garland' || d.type === 'radiator' || d.type === 'towel';
}

/** The house's side walls, cut (the dollhouse is open at the front), and the dark beyond. */
function paintHouseFrame(ctx: Ctx, r: Rect): void {
  const edge = '#E9DCCB';
  const cut = '#B9A58E';
  const out = '#3E3A4F';
  const y0 = Math.max(r.y0, FLOORS.roof.floorY);
  if (y0 >= r.y1) return;
  ctx.save();
  ctx.fillStyle = out;
  ctx.fillRect(r.x0, y0, -r.x0 - 7, r.y1 - y0);
  ctx.fillRect(WORLD_W + 7, y0, r.x1 - WORLD_W - 7, r.y1 - y0);
  ctx.fillStyle = edge;
  ctx.fillRect(-7, y0, 7, r.y1 - y0);
  ctx.fillRect(WORLD_W, y0, 7, r.y1 - y0);
  ctx.fillStyle = cut;
  ctx.fillRect(-7, y0, 2, r.y1 - y0);
  ctx.fillRect(WORLD_W + 5, y0, 2, r.y1 - y0);
  ctx.restore();
}

/** The cats' present: a little box with a bow, bobbing now and then. */
function paintPresent(ctx: Ctx, x: number, y: number, t: number): void {
  const bob = Math.max(0, Math.sin(t * 3)) * Math.max(0, Math.sin(t * 0.7)) * 5;
  const w = 30;
  const h = 24;
  const top = y - h - bob;
  ctx.save();
  ctx.fillStyle = 'rgba(62,58,79,0.18)';
  ctx.beginPath();
  ctx.ellipse(x + 3, y + 1, w * 0.6 - bob, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  const c = '#E58F95';
  roundRect(ctx, x - w / 2, top, w, h, 3);
  ctx.fillStyle = c;
  ctx.fill();
  ctx.fillStyle = rgba(shadowOf(c, 0.4), 0.4);
  ctx.fillRect(x + w / 2 - 8, top, 8, h);
  ctx.fillStyle = '#F7E6CC';
  ctx.fillRect(x - 3, top, 6, h);
  roundRect(ctx, x - w / 2 - 2, top - 5, w + 4, 7, 2);
  ctx.fillStyle = lightOf(c, 0.2);
  ctx.fill();
  ctx.fillStyle = '#F7E6CC';
  ctx.fillRect(x - 3, top - 5, 6, 7);
  // the bow
  ctx.fillStyle = '#F2C14E';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + s * 7, top - 9, 7, 4.5, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, top - 7, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A treat: a little golden fish biscuit. */
export function treatIcon(size: number): string {
  return `<svg class="treat-icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-treat"/></svg>`;
}

function perchThumbSafe(kind: PerchKind): HTMLCanvasElement {
  return perchThumb(kind, 64, 46);
}
