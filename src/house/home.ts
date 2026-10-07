// The home screen, where the page opens: the tall house you scroll up and
// down (the roof garden, the attic, the living room with its tall wall, the
// basement), a sandbox of cats to pick up, carry, boop and pour into things,
// and their little lives (now and then one hops to another spot, up a run of
// perches if there is one, or plays: see antics.ts; a cat hurt in a scrap is
// made better with fish), your own cat (the cat maker: catMaker.ts), the bar
// of big buttons into the two games, the treats the games earn you and the
// shop they're spent in (opening up the basement, the attic and the roof
// garden, perches you put wherever you like), the glass tubes between the
// floors (capped and padlocked until the floor they go to is open), the cats
// card (who lives here, what brings each of the others home), cats moving in
// (they hop in at the window) and, the first time you're home each day, a
// little present from the cats.

import type { AudioEngine } from '../audio/audio';
import { FLOOR_Y, WORLD_W, localFurniture, type Prop } from '../game/props';
import type { DecorPlacement, RoomDef } from '../game/room';
import type { Cat, Session, SessionOptions } from '../game/session';
import { roomFor } from '../game/spawn';
import { BREEDS, lookKey, type BreedId } from '../physics/breeds';
import { NAME_IDEAS, NAME_MAX, randomDesign, type CatDesign } from '../physics/mycat';
import type { StaticShape } from '../physics/shapes';
import type { SoftBody } from '../physics/softbody';
import { FRAME_DT, GRAVITY } from '../physics/world';
import { loadBest } from '../proto/kit';
import { drawFurniture } from '../render/furnitureArt';
import { lightOf, rgba, roundRect, shadowOf, type Ctx } from '../render/paint';
import { containerShadow, drawContainerBack, drawContainerFront } from '../render/propArt';
import type { Expression } from '../render/catArt';
import type { Renderer, Stage } from '../render/renderer';
import { THEMES, drawDecor, drawShell, drawSunbeams } from '../render/roomArt';
import { faceSVG } from '../ui/faces';
import { catPortrait } from '../ui/portraits';
import { clamp } from '../util/math';
import { localDateKey } from '../util/date';
import { Antics, MOOD_WORDS, TEMPERS, moodOf } from './antics';
import { CatMaker } from './catMaker';
import { paintFish, paintHealBadge, paintPlaster } from './anticsArt';
import { paintCeiling } from './homeArt';
import { GIFT_SPOT, THING, fittingBoxes, houseRoom, houseSpawnOk, onWall, settleMoved, snapThing, thingBoxes, thingPos, thingProblem, thingProp, type Thing, type ThingId } from './homeRoom';
import { inRingOf, planFlight, release, stepFlight, type Flight } from './leap';
import { ATTIC_THEME, BASEMENT_THEME, paintAttic, paintAtticShade, paintBasement, paintBasementShade, paintRoof, paintTubeBack, paintTubeFront, type Rect } from './houseArt';
import { paintAround } from './outsideArt';
import {
  ALL_CATS,
  FLOOR_PRICES,
  NAMES,
  aCat,
  applyMyCat,
  applyNames,
  arrive,
  buyFloor,
  buyPerch,
  feedFish,
  giftDue,
  HURT_FISH,
  hurtCat,
  isOpen,
  kindOf,
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
  renameCat,
  storePerch,
  takeGift,
  whoIs,
  writeHouse,
  type Earlier,
  type GameId,
  type HouseReport,
  type HouseSave,
} from './house';
import {
  ATTIC_DY,
  ATTIC_FLOOR_FRONT,
  ATTIC_FUNNEL,
  ATTIC_TOP,
  BASEMENT_DY,
  CHIMNEY,
  FLOORS,
  FLOOR_ORDER,
  FUNNEL,
  HOOD,
  HOUSE_TILES,
  LIVING_CEIL,
  LIVING_CUT,
  LOFT_HOOD,
  OUTLET,
  SKY_HOOD,
  SPOUT,
  TUBES,
  VIEWS,
  chimneyShapes,
  floorAt,
  funnelOf,
  houseShell,
  tubeShapes,
  viewMid,
  type ExtraFloor,
  type FloorId,
  type Funnel,
  type Tube,
  type View,
} from './layout';
import { hasFront, isLive, paintLiveBack, paintLiveFront, paintPerchBack as paintPerch, paintPerchFront, perchThumb } from './perchArt';
import { PERCHES, PERCH_ORDER, buildPerch, perchBox, placeProblem, snapPerch, type Box, type PerchKind, type PerchProp, type PlaceProblem } from './perches';
import { Tubes } from './tubes';
import { coach } from '../ui/coach';

export interface HomeHost {
  readonly renderer: Renderer;
  readonly audio: AudioEngine;
  /** The home room's session (while home). */
  readonly session: Session;
  openOverlay(html: string, onBind?: (root: HTMLElement) => void): void;
  closeOverlay(): void;
  overlayOpen(): boolean;
  /** A finger is on a cat (the cats hold still for it). */
  busy(): boolean;
  /** Into a game. */
  play(game: GameId): void;
  /** Build the house again (a floor was opened): the cats stay where they are. */
  rebuild(): void;
  /** Where the finger carrying a cat is on screen (null if no cat is being carried). */
  carryFinger(): { x: number; y: number } | null;
  /** Up to the Playground (who's coming, first). */
  playground(): void;
  /** A cat gone up the sky tube from the roof garden: up to the Playground with it. */
  toSky(b: BreedId): void;
}

const GAME_NAMES: Record<GameId, string> = { jar: 'Cat Jar', drop: 'Cat Drop' };

/** Seconds between a cat's hops, at the least and the most. */
const HOP_GAP: [number, number] = [6, 13];

/** A place a cat may hop to: the top of what it lands on, how far either side of x, and the biggest cat that fits. */
interface Spot {
  x: number;
  y: number;
  half: number;
  maxR: number;
  floor: FloorId;
  /** One of the perches you've put up (the cats love those), and which. */
  perch?: boolean;
  kind?: PerchKind;
}

/** Collider ids of the house's own fittings (the tubes, the chimney). */
const FITTING_IDS = { chute: 90001, lift: 90002, chimney: 90003, loft: 90004, sky: 90005 };

/** What each floor is, in the shop; and how to get a cat there, once it's open. */
const FLOOR_BLURBS: Record<ExtraFloor, string> = {
  basement: 'A snug den downstairs. Opens the funnel in the floor, to drop cats down to it',
  attic: 'A cosy loft under the roof. Opens the tube up the left wall, to whoosh cats up to it',
  roof: 'A sunny garden up top. Opens the tube over the cat steps, to whoosh cats up',
};
const FLOOR_HOWTO: Record<ExtraFloor, string> = {
  basement: 'Drop a cat in the funnel to send it down!',
  attic: 'Put a cat under the hood high on the left wall to whoosh it up to the attic!',
  roof: 'Put a cat under the hood by the cat steps to whoosh it up!',
};

/** Where the view stops (world y of the middle of the screen). */
const VIEW_Y = Object.fromEntries(VIEWS.map((v) => [v.id, v.y])) as Record<View['id'], number>;

/** The stop nearest a world row. */
function nearestView(y: number): number {
  return VIEWS.reduce((a, v) => (Math.abs(v.y - y) < Math.abs(a.y - y) ? v : a)).y;
}

/** The low window, where cats moving in hop in (its middle, and the bottom of a cat in it, clear of one on the sill). */
const WINDOW = { x: 102, y: 160 };

/** Long-press on a perch (or one of the house's things) to pick it up (ms), and how far a finger may wander before it's a scroll (px). */
const HOLD_MS = 420;
const SLOP = 9;

/**
 * Something being put somewhere: a perch (just bought, or picked up), or
 * one of the house's own things (picked up: it's out of the room till it's
 * put down, `prop` as it was).
 */
type Placing = {
  x: number;
  y: number;
  /** Where it was (moving one that's out), to put it back on cancel. */
  prev: { x: number; y: number } | null;
} & ({ k: 'perch'; id: number; kind: PerchKind } | { k: 'thing'; thing: Thing; prop: Prop });
type PlacingThing = Placing & { k: 'thing' };

type Drag =
  | { k: 'scroll'; id: number; sy: number; camY: number; t: number; lastY: number; lastT: number; v: number; moved: boolean }
  | { k: 'ghost'; id: number; dx: number; dy: number; sx: number; sy: number }
  | { k: 'hold'; id: number; sx: number; sy: number; timer: number };

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
  /** The cat maker, while it's open. */
  private maker: CatMaker | null = null;
  private lastLabels = '';
  /** Perches out in the house (their colliders are in the world). */
  private perchProps: PerchProp[] = [];
  /** A perch (or one of the house's things) being put somewhere. */
  placing: Placing | null = null;
  /** A thing being moved, as it would be where it's been dragged to. */
  private ghostAt: { key: string; prop: Prop } | null = null;
  private drag: Drag | null = null;
  /** The camera: where it is, how fast it's going, and what it's after. */
  private camY = VIEW_Y.living;
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
  /** Cats bouncing on a bouncy cushion, until this frame. */
  private boinging = new Map<Cat, number>();
  /** Physics steps while home. */
  private frame = 0;
  /** A cat that's just gone up the sky tube, off to the Playground. */
  private skyBound: BreedId | null = null;
  /** How fast each body was coming down last frame (a bouncy cushion's landings). */
  private fellAt = new WeakMap<SoftBody, number>();
  /** The cat last let go of, and when: one dropped in the funnel takes the view down with it. */
  private letGo: { cat: Cat; at: number } | null = null;
  /** Cats leaping to another spot (landing at x1 on a surface at top), and what to do when they land. */
  private leaps: (Flight & { cat: Cat; top: number; land?: () => void })[] = [];
  /** What the cats get up to: games, pounces, scraps. */
  readonly antics: Antics;
  /** Fish on their way into a hurt cat's mouth. */
  private feeding: { cat: Cat; t: number; healed: boolean }[] = [];
  private saveIn = 5;

  constructor(
    private readonly host: HomeHost,
    earlier: Earlier,
  ) {
    this.house = loadHouse(earlier);
    applyMyCat(this.house);
    applyNames(this.house);
    // a thing moved somewhere it can't be goes back where it always was; a
    // perch put up where a tube is now (the tubes used to come with their
    // floor), or in one of the house's things, goes back in the cupboard
    const h = this.house;
    settleMoved(h);
    const taken: Box[] = [...fittingBoxes(h, 'all'), ...thingBoxes(h)];
    for (const p of h.perches) {
      if (p.stored) continue;
      const b = perchBox(p.kind, p.x, p.y);
      if (taken.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0)) p.stored = true;
    }
    writeHouse(this.house);
    this.shownTreats = this.house.treats;
    this.tubes = new Tubes(() => host.session.world);
    this.tubes.inTheWay = (cat, out) => this.inTheWay(cat, out);
    this.antics = new Antics({
      get session() {
        return host.session;
      },
      renderer: host.renderer,
      audio: host.audio,
      day: () => localDateKey(),
      hurt: (b) => !!this.house.hurt[b],
      hurtCat: (cat) => this.hurt(cat),
      leap: (cat, x, y, low, land) => this.hop(cat, x, y, low, land),
      away: (cat) => cat.grabbed || !!this.tubes.riding(cat) || this.leaping(cat),
      escape: (cat, fromX) => this.escape(cat, fromX),
      offLimits: (x, y) => this.offLimits(x, y),
    });
    // signs on the floors still to open
    this.labels = document.createElement('div');
    this.labels.className = 'home-labels hidden';
    for (const f of ['basement', 'attic', 'roof'] as ExtraFloor[]) {
      const b = document.createElement('button');
      b.className = 'home-label home-sign';
      b.addEventListener('click', () => this.offerFloor(f));
      this.labels.appendChild(b);
      this.labelEls.set(f, b);
    }
    document.getElementById('app')!.appendChild(this.labels);
    for (const b of this.bar.querySelectorAll<HTMLElement>('[data-game]'))
      b.addEventListener('click', () => {
        coach.done('home-games');
        host.play(b.dataset.game as GameId);
      });
    this.bar.querySelector('[data-act=shop]')?.addEventListener('click', () => this.showShop());
    this.bar.querySelector('[data-act=playground]')?.addEventListener('click', () => {
      coach.done('home-sky');
      host.playground();
    });
    // the next stop up and down: a pill at the top and the bottom of the view
    this.lift = document.createElement('div');
    this.lift.className = 'home-floors hidden';
    for (const dir of ['up', 'down'] as const) {
      const b = document.createElement('button');
      b.className = `floor-pill floor-${dir}`;
      b.dataset.dir = dir;
      b.addEventListener('click', () => {
        const v = this.nextView(dir === 'up' ? -1 : 1);
        if (!v) return;
        host.audio.click();
        this.follow = null;
        this.camGoal = v.y;
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
      shell: () => {
        this.perchProps = placedPerches(this.house).map((p) => buildPerch(p));
        return [...houseShell(), ...this.fittingShapes(), ...this.perchProps.flatMap((p) => p.shapes)];
      },
      // a cat whose place isn't clear any more (or that gets stuck fast) goes to the nearest one that is, on its floor
      spawnOk: houseSpawnOk(this.house),
      unmerge: true,
    };
  }

  /** The house's own fittings' colliders: the chimney, and the tubes (capped ones shut). */
  private fittingShapes(): StaticShape[] {
    return [...chimneyShapes(FITTING_IDS.chimney), ...TUBES.flatMap((t) => tubeShapes(t, FITTING_IDS[t.id], isOpen(this.house, t.needs)))];
  }

  /** The tubes that are open (the others are capped). */
  private tubesIn(): Tube[] {
    return TUBES.filter((t) => isOpen(this.house, t.needs));
  }

  // ---------------------------------------------------------------------------
  // Painting (the renderer's stage)

  /** What's painted into the house's tiles: the floors open, the perches, and the house's things as they are (one being moved isn't there). */
  private perchKey(): string {
    const things = this.host.session.props.map((p) => `${p.uid}@${Math.round(p.x)},${Math.round(p.y)}`).join(';');
    return `${this.house.open.join(',')}|${this.perchProps.map((p) => `${p.save.kind}@${p.save.x},${p.save.y}`).join(';')}|${things}`;
  }

  readonly stage: Stage = {
    pan: [viewMid('roof'), viewMid('basement')],
    tiles: HOUSE_TILES,
    key: () => this.perchKey(),
    paintBack: (ctx, r) => this.paintBack(ctx, r),
    paintFront: (ctx, r) => this.paintFront(ctx, r),
    underlay: (ctx, dt) => {
      this.paintLive(ctx, false);
      this.antics.underlay(ctx);
      // (behind the cats: one sitting by it is in front of it, not in it)
      const g = this.gift;
      if (g) {
        g.t += dt;
        paintPresent(ctx, g.x, g.y, g.t);
      }
    },
    liveFront: (ctx) => this.paintLive(ctx, true),
    overlay: (ctx, dt) => this.paintOverlay(ctx, dt),
    inTube: (cat) => this.tubeFace(cat),
    face: (cat) => this.antics.face(cat) ?? this.restFace(cat),
    behindFront: (cat) => this.behindFront(cat),
  };

  private paintBack(ctx: Ctx, r: Rect): void {
    const s = this.host.session;
    const h = this.house;
    const seed = 11;
    paintRoof(ctx, r, seed);
    // the attic, and (once it's open) its furniture and perches
    paintAttic(ctx, r, isOpen(h, 'attic'), seed);
    if (isOpen(h, 'attic') && r.y0 < ATTIC_FLOOR_FRONT && r.y1 > ATTIC_TOP) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x0, ATTIC_TOP, r.x1 - r.x0, ATTIC_FLOOR_FRONT - ATTIC_TOP);
      ctx.clip();
      for (const p of s.furniture) {
        if (p.dy !== ATTIC_DY) continue;
        ctx.save();
        ctx.translate(0, p.dy);
        drawFurniture(ctx, localFurniture(p), ATTIC_THEME);
        ctx.restore();
      }
      this.paintPerches(ctx, 'attic', false);
      this.paintContainers(ctx, 'attic');
      ctx.restore();
    }
    // the living room: its tall walls, the floor, decor, furniture, the ceiling (the roof tube's pipe goes up through it)
    const living = s.furniture.filter((p) => !p.dy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x0, LIVING_CUT, r.x1 - r.x0, FLOOR_Y + 44 - LIVING_CUT);
    ctx.clip();
    if (r.y1 > LIVING_CUT && r.y0 < FLOOR_Y + 44) {
      const decor = s.def.decor;
      const theme = THEMES.living;
      drawShell(ctx, theme, r.x0, Math.max(r.y0, LIVING_CUT), r.x1, Math.min(r.y1, FLOOR_Y + 44), seed, LIVING_CEIL);
      for (const d of decor) if (isFlat(d)) drawDecor(ctx, d, theme, seed + d.x);
      for (const p of living) drawFurniture(ctx, p, theme);
      for (const d of decor) if (!isFlat(d)) drawDecor(ctx, d, theme, seed + d.x);
      paintCeiling(ctx, r, theme, seed, LIVING_CEIL, [
        [HOOD.x - 21, HOOD.x + 21],
        [LOFT_HOOD.x - 21, LOFT_HOOD.x + 21],
      ]);
      this.paintPerches(ctx, 'living', false);
      this.paintContainers(ctx, 'living');
      // (sun through the low window: the high one is in the shade of the eaves)
      drawSunbeams(ctx, decor.filter((d) => d.y > 0));
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
        if (p.dy !== BASEMENT_DY) continue;
        ctx.save();
        ctx.translate(0, p.dy);
        drawFurniture(ctx, localFurniture(p), BASEMENT_THEME);
        ctx.restore();
      }
      // where cats land, under the chute
      paintPerch(ctx, 'beanbag', SPOUT.x, FLOORS.basement.floorY - PERCHES.beanbag.height, 7);
      this.paintPerches(ctx, 'basement', false);
      this.paintContainers(ctx, 'basement');
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
    for (const t of TUBES) paintTubeBack(ctx, t, !isOpen(h, t.needs));
    paintHouseFrame(ctx, r, seed);
  }

  /** The vase and the glass tub on a floor, under the cats (the renderer paints their fronts over them). */
  private paintContainers(ctx: Ctx, floor: FloorId): void {
    for (const p of this.host.session.containers) {
      if (floorAt(p.y - 1) !== floor) continue;
      containerShadow(ctx, p);
      drawContainerBack(ctx, p);
    }
  }

  /** One of the house's things, whole: one being moved, where it's been dragged to. */
  private paintThing(ctx: Ctx, p: Prop): void {
    if (p.kind === 'container') {
      containerShadow(ctx, p);
      drawContainerBack(ctx, p);
      drawContainerFront(ctx, p);
      return;
    }
    const f = floorAt(p.y);
    ctx.save();
    ctx.translate(0, p.dy ?? 0);
    drawFurniture(ctx, localFurniture(p), f === 'attic' ? ATTIC_THEME : f === 'basement' ? BASEMENT_THEME : THEMES.living);
    ctx.restore();
  }

  private paintPerches(ctx: Ctx, floor: FloorId, front: boolean): void {
    for (const p of this.perchProps) {
      if (p.floor !== floor || isLive(p.save.kind)) continue;
      if (front) {
        if (hasFront(p.save.kind)) paintPerchFront(ctx, p.save.kind, p.save.x, p.save.y, p.save.id);
      } else paintPerch(ctx, p.save.kind, p.save.x, p.save.y, p.save.id);
    }
  }

  /** The perches that move (hammocks, bouncy cushions), where they are this frame: their backs under the cats, their fronts over. */
  private paintLive(ctx: Ctx, front: boolean): void {
    for (const p of this.perchProps) {
      if (!isLive(p.save.kind)) continue;
      if (front) paintLiveFront(ctx, p);
      else paintLiveBack(ctx, p);
    }
  }

  private paintFront(ctx: Ctx, r: Rect): void {
    for (const f of FLOOR_ORDER) this.paintPerches(ctx, f, true);
    for (const t of TUBES) paintTubeFront(ctx, t, !isOpen(this.house, t.needs));
    if (!isOpen(this.house, 'basement')) paintBasementShade(ctx, r);
    if (!isOpen(this.house, 'attic')) paintAtticShade(ctx, r);
  }

  /** Over everything, each frame: the cats' antics, hurt cats' plasters and fish, a perch being placed. */
  private paintOverlay(ctx: Ctx, dt: number): void {
    this.antics.overlay(ctx);
    this.paintHurt(ctx, dt);
    const pl = this.placing;
    if (pl) {
      const problem = this.problem(pl);
      const b = this.placeBox(pl);
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
      if (pl.k === 'thing') this.paintThing(ctx, this.ghost(pl));
      else {
        paintPerch(ctx, pl.kind, pl.x, pl.y, pl.id);
        if (hasFront(pl.kind)) paintPerchFront(ctx, pl.kind, pl.x, pl.y, pl.id);
      }
      ctx.restore();
    }
  }

  /** A hurt cat's plaster, and over it a fish in a bubble ringed by how far it is to better; fish flying in. */
  private paintHurt(ctx: Ctx, dt: number): void {
    const r = this.host.renderer;
    for (const c of this.host.session.cats) {
      const h = this.house.hurt[c.breed];
      if (!h || this.tubes.riding(c) || this.antics.fighting(c)) continue;
      const v = r.view(c);
      const rad = c.body.p.radius;
      paintPlaster(ctx, v.fx + rad * 0.36, v.fy - rad * 0.5, v.fs, -0.55, h.need >= 8);
      if (!c.grabbed) paintHealBadge(ctx, v.hx, v.hy - rad * 0.55 - 16, h.fed, h.need, this.since + c.index);
    }
    for (const f of [...this.feeding]) {
      f.t += dt;
      const v = r.view(f.cat);
      const u = Math.min(1, f.t / 0.32);
      // in an arc, down into its mouth
      const x = v.fx + (1 - u) * 18;
      const y = v.fy + 4 - (1 - u) * 46 + Math.sin(u * Math.PI) * -10;
      if (u < 1) paintFish(ctx, x, y, 1.1 - u * 0.5, -0.8 + u * 1.2);
      else {
        this.feeding.splice(this.feeding.indexOf(f), 1);
        this.host.audio.nom(BREEDS[f.cat.breed].voice.pitch);
        if (f.healed) {
          r.hearts(v.hx, v.hy - 16, 4);
          r.puff(v.fx + f.cat.body.p.radius * 0.36, v.fy - f.cat.body.p.radius * 0.5, 4);
          this.host.audio.seat(96);
        }
      }
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
    this.antics.enter(this.house.toy);
    this.feeding = [];
    this.camY = VIEW_Y.living;
    this.camV = 0;
    this.camGoal = null;
    this.follow = null;
    this.letGo = null;
    this.host.renderer.scrollTo(this.camY, true);
    this.bar.classList.remove('hidden');
    this.labels.classList.remove('hidden');
    this.lift.classList.remove('hidden');
    this.lastLabels = '';
    this.hopIn = 5 + Math.random() * 4;
    this.newcomer = null;
    this.arrivalIn = this.house.arriving.length ? 1.1 : -1;
    // (on the window sill)
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
      this.antics.leave();
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
    const toy = this.antics.toyAt();
    if (toy) this.house.toy = toy;
    for (const c of this.host.session.cats) {
      if (this.tubes.riding(c) || this.antics.fighting(c) || this.leaping(c)) continue;
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

  /** The floor a capped tube at a world point goes to (a tap on it offers to open it), if any. */
  lockAt(x: number, y: number): ExtraFloor | null {
    if (!this.active || this.placing) return null;
    const near = (p: { x: number; y: number }, w: number, up: number, down: number): boolean => Math.abs(x - p.x) < w && y > p.y - up && y < p.y + down;
    if (!isOpen(this.house, 'basement')) {
      if (near({ x: FUNNEL.x, y: FUNNEL.rimY }, FUNNEL.rimHw + 8, 22, FLOOR_Y + 6 - FUNNEL.rimY)) return 'basement';
      if (near(SPOUT, 30, 40, 22)) return 'basement';
    }
    if (!isOpen(this.house, 'attic')) {
      if (near({ x: ATTIC_FUNNEL.x, y: ATTIC_FUNNEL.rimY }, ATTIC_FUNNEL.rimHw + 8, 22, ATTIC_FUNNEL.floorY + 6 - ATTIC_FUNNEL.rimY)) return 'attic';
      if (near(LOFT_HOOD, 30, LOFT_HOOD.y - LIVING_CEIL, 22)) return 'attic';
    }
    if (!isOpen(this.house, 'roof')) {
      if (near(HOOD, 30, HOOD.y - LIVING_CEIL, 22) || near(OUTLET, 30, 40, 22) || near(SKY_HOOD, 30, 40, 22)) return 'roof';
    }
    return null;
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
      const more = fresh.length > 1 ? ` (and ${aCat(fresh[1])}!)` : '';
      this.toast(b, `${cap(aCat(b))} wants to move in!${more}`);
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
      jar: this.bestNote(loadBest('catjar.best')),
      drop: this.bestNote(loadBest('catdrop.best')),
    };
    for (const game of ['jar', 'drop'] as GameId[]) {
      const btn = this.bar.querySelector<HTMLElement>(`[data-game=${game}]`);
      if (!btn) continue;
      (btn.querySelector('.tin-note') as HTMLElement).textContent = notes[game];
      // the next cat you can meet in this game peeks over its lid
      const next = nextMoveIn(this.house, game);
      const badge = btn.querySelector('.face-badge') as HTMLElement;
      badge.innerHTML = next ? faceSVG(next.breed, { size: 22 }) : '';
      badge.classList.toggle('hidden', !next);
      btn.setAttribute('aria-label', `Play ${GAME_NAMES[game]}${next ? `. ${next.how} and ${aCat(next.breed)} moves in` : ''}`);
    }
    if (this.shownTreats > this.house.treats) this.shownTreats = this.house.treats;
    this.refreshTreats();
  }

  private bestNote(best: number): string {
    return best > 0 ? `best ${best.toLocaleString('en-US')}` : 'new!';
  }

  /** The next stop up (-1) or down (1) from where the view is. */
  private nextView(dir: -1 | 1): View | null {
    const above = VIEWS.filter((v) => v.y < this.camY - 40);
    const below = VIEWS.filter((v) => v.y > this.camY + 40);
    return (dir < 0 ? above[above.length - 1] : below[0]) ?? null;
  }

  private refreshLift(): void {
    this.lastLabels = '';
  }

  // ---------------------------------------------------------------------------
  // Every step and every frame while home

  /** One fixed physics step: the tubes. */
  step(): void {
    if (!this.active) return;
    this.frame++;
    this.stepLive();
    this.tubes.step();
    this.stepLeaps();
    this.antics.step();
    // a cat that falls into a funnel goes down its pipe (to the basement, or from the attic to the living room)
    for (const tube of this.tubesIn()) {
      const fn = funnelOf(tube);
      if (!fn) continue;
      for (const c of this.host.session.cats) {
        // (not one flying over it, or tumbling about in a scrap)
        if (c.grabbed || this.tubes.riding(c) || this.leaping(c) || this.antics.fighting(c) || (this.cooldown.get(c) ?? 0) > 0) continue;
        const b = c.body;
        b.computeCentroid();
        const z = tube.upper.zone;
        if (b.cx > z.x0 && b.cx < z.x1 && b.cy > z.y0 && b.cy < z.y1 && b.vcy > -60 && inFunnel(fn, b.cx, b.cy)) {
          // (one that tumbled in by itself just goes, and says so)
          const dropped = this.letGo?.cat === c && this.since - this.letGo.at < 4;
          this.ride(c, tube, false, dropped);
          if (!dropped) this.toast(c.breed, `Wheee! ${NAMES[c.breed]} tumbled down the funnel to the ${FLOORS[tube.lower.floor].name.toLowerCase()}.`);
        }
      }
    }
    for (const [c, t] of this.cooldown) {
      if (t <= 1) this.cooldown.delete(c);
      else this.cooldown.set(c, t - 1);
    }
    for (const e of this.tubes.drain()) {
      const b = BREEDS[e.cat.breed];
      if (e.t === 'out' && e.tube.id === 'sky') {
        // up and away to the clouds (and when it's back, it's on the roof garden, under the hood)
        const body = e.cat.body;
        body.placeAt(SKY_HOOD.x, FLOORS.roof.floorY - body.p.radius - 2);
        this.skyBound = e.cat.breed;
        continue;
      }
      if (e.t === 'in') {
        this.host.audio.glorp(b.voice.pitch * 1.1, 0.4, 0.1);
      } else {
        e.cat.sinceTouch = 0;
        e.cat.settled = 0;
        e.cat.intent = null;
        this.host.audio.boop(b.voice.pitch);
        this.host.renderer.puff(e.x, e.y + e.cat.body.p.radius, 5);
        this.cooldown.set(e.cat, 70);
        if (this.follow === e.cat) {
          this.follow = null;
          this.camGoal = nearestView(e.y);
        }
      }
    }
  }

  /**
   * The perches that move: a hammock's sling takes the weight (and the
   * landing) of who's lying in it; a bouncy cushion springs a cat that lands
   * on it back up, boing.
   */
  private stepLive(): void {
    const s = this.host.session;
    const bodies = s.world.bodies;
    const fell = (b: SoftBody): number => this.fellAt.get(b) ?? 0;
    const catOf = (b: SoftBody): Cat | undefined => s.cats.find((c) => c.body === b);
    const free = (b: SoftBody): boolean => {
      const c = catOf(b);
      return !c || (!c.grabbed && !this.tubes.riding(c) && !this.leaping(c) && !this.antics.fighting(c));
    };
    for (const p of this.perchProps) {
      if (p.sling) {
        p.sling.gather(bodies);
        p.sling.step(FRAME_DT, GRAVITY);
      }
      if (p.bouncer) {
        const hit = p.bouncer.step(bodies, free, fell);
        if (hit) {
          const c = catOf(hit.body);
          const size = c ? clamp((c.body.p.radius - 22) / 20, 0, 1) : 0;
          this.host.audio.boing(hit.speed, size);
          if (c) {
            c.sinceTouch = Math.min(c.sinceTouch, 120);
            c.settled = 0;
            this.boinging.set(c, this.frame + 50);
          }
        }
      }
    }
    // a cat bouncing isn't trying to get into the vase beside the cushion
    // (squashed on it, it brushes the glass, and would be steered off its bounce)
    for (const c of s.cats) {
      const until = this.boinging.get(c);
      if (until === undefined) continue;
      if (this.frame > until || c.grabbed) this.boinging.delete(c);
      else c.intent = null;
    }
    // (how fast each was coming down, for the next frame's landings)
    for (const b of bodies) {
      b.computeCentroid();
      this.fellAt.set(b, b.vcy);
    }
  }

  tick(dt: number): void {
    if (!this.active) return;
    // (a cat that's gone up the sky tube: the Playground, now the step it came out in is over)
    const sky = this.skyBound;
    if (sky) {
      this.skyBound = null;
      this.host.toSky(sky);
      return;
    }
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
      // (its card waits for any other card to be closed)
      if (!this.leaping(n.cat) && ((n.cat.settled > 20 && n.t > 1) || n.t > 4) && !this.host.overlayOpen()) {
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
    // a house from before the cat maker: offer it, once (when nobody's arriving)
    if (this.house.welcomed && !this.house.catAsked && !this.house.cat && this.since > 1.2) {
      this.offerMaker();
      return;
    }
    if (this.house.welcomed && this.since > 1.5) this.tips();
    this.hopIn -= dt;
    if (this.hopIn <= 0) {
      this.hopIn = HOP_GAP[0] + Math.random() * (HOP_GAP[1] - HOP_GAP[0]);
      this.turn(s);
    }
  }

  /**
   * The camera: follows a finger, coasts after a fling, eases to a stop,
   * follows a cat through a tube, and scrolls along when a cat is carried to
   * the top or the bottom of the screen (up the living room's tall wall).
   */
  private moveCamera(dt: number): void {
    const r = this.host.renderer;
    const [lo, hi] = this.stage.pan;
    const edge = this.carryEdge();
    const ghost = this.ghostEdge();
    const d = this.drag;
    if (d?.k === 'scroll') {
      // (the finger moves it: see the pointer handlers)
    } else if (ghost && d?.k === 'ghost') {
      // (and what's being placed stays under the finger)
      this.camGoal = null;
      this.follow = null;
      this.camV = ghost;
      this.camY = clamp(this.camY + ghost * dt, lo, hi);
      this.carried = true;
      const w = r.screenToWorld(d.sx, d.sy);
      this.dragGhostTo(w.x, w.y);
    } else if (edge) {
      this.camGoal = null;
      this.follow = null;
      this.camV = edge.v;
      this.camY = clamp(this.camY + edge.v * dt, edge.lo, edge.hi);
      this.carried = true;
    } else if (this.carried) {
      // put down: settle on the nearest stop if it's close
      this.carried = false;
      this.camV = 0;
      const near = nearestView(this.camY);
      if (Math.abs(near - this.camY) < 150) this.camGoal = near;
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
        const near = nearestView(this.camY);
        if (Math.abs(near - this.camY) < 150) this.camGoal = near;
      }
    }
    this.camY = clamp(this.camY, lo, hi);
    r.scrollTo(this.camY, true);
  }

  /** Has the camera been scrolling along with a carried cat? */
  private carried = false;

  /**
   * A cat carried to the top or the bottom of the screen: how fast to scroll
   * (faster the nearer the edge), within the stops of the floor it's on.
   */
  private carryEdge(): { v: number; lo: number; hi: number } | null {
    const f = this.host.carryFinger();
    const cat = this.host.session.grabbed;
    if (!f || !cat) return null;
    const r = this.host.renderer;
    // (a band under the top bar, and one over the bottom bar's top)
    const band = 75;
    const top = r.insets.top + band;
    const bottom = r.H - r.insets.bottom - band * 0.7;
    const u = f.y < top ? -(top - f.y) / band : f.y > bottom ? (f.y - bottom) / band : 0;
    if (!u) return null;
    cat.body.computeCentroid();
    const floor = floorAt(cat.body.cy);
    const stops = VIEWS.filter((v) => floorAt(v.y) === floor).map((v) => v.y);
    const lo = Math.min(...stops);
    const hi = Math.max(...stops);
    if ((u < 0 && this.camY <= lo) || (u > 0 && this.camY >= hi)) return null;
    return { v: Math.sign(u) * Math.min(1, Math.abs(u)) * 520, lo, hi };
  }

  private spring(goal: number, k: number, dt: number): void {
    const a = k * k * (goal - this.camY) - 2 * k * this.camV;
    this.camV += a * dt;
    this.camY += this.camV * dt;
  }

  /** Scroll to a floor (the living room: down by its floor). */
  goTo(f: FloorId): void {
    this.follow = null;
    this.camGoal = f === 'living' ? VIEW_Y.living : viewMid(f);
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
    const h = this.house;
    const bs = this.labelEls.get('basement')!;
    bs.innerHTML = `🔒 Basement · ${treatIcon(13)} ${FLOOR_PRICES.basement}`;
    bs.setAttribute('aria-label', `Open the basement for ${FLOOR_PRICES.basement} treats`);
    show(bs, WORLD_W / 2, BASEMENT_DY + 230, !isOpen(h, 'basement') && !this.placing);
    const as = this.labelEls.get('attic')!;
    as.innerHTML = `🔒 Attic · ${treatIcon(13)} ${FLOOR_PRICES.attic}`;
    as.setAttribute('aria-label', `Open the attic for ${FLOOR_PRICES.attic} treats`);
    show(as, WORLD_W / 2, FLOORS.attic.floorY - 250, !isOpen(h, 'attic') && !this.placing);
    const rs = this.labelEls.get('roof')!;
    rs.innerHTML = `🔒 Roof garden · ${treatIcon(13)} ${FLOOR_PRICES.roof}`;
    rs.setAttribute('aria-label', `Open the roof garden for ${FLOOR_PRICES.roof} treats`);
    show(rs, 230, FLOORS.roof.floorY - 150, !isOpen(h, 'roof') && !this.placing);
    // the next stop up and down
    for (const b of this.lift.querySelectorAll<HTMLElement>('[data-dir]')) {
      const up = b.dataset.dir === 'up';
      const v = this.nextView(up ? -1 : 1);
      b.classList.toggle('off', !v || !!this.placing);
      if (!v) continue;
      const lock = isOpen(h, floorAt(v.y)) ? '' : ' 🔒';
      b.innerHTML = `<span class="floor-arrow" aria-hidden="true">${up ? '▲' : '▼'}</span><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-floor-${v.id}"/></svg>${v.name}${lock}`;
      b.setAttribute('aria-label', `${up ? 'Up to' : 'Down to'} ${v.id === 'high' ? 'the top of the living room' : `the ${v.name.toLowerCase()}`}${lock ? ' (not open yet)' : ''}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Cats' lives

  /** The places a cat may hop to on a floor. */
  private spots(): Spot[] {
    const s = this.host.session;
    const out: Spot[] = [];
    const funnels = this.tubesIn().flatMap((t) => {
      const fn = funnelOf(t);
      return fn ? [{ fn, floor: t.upper.floor }] : [];
    });
    const add = (x0: number, x1: number, y: number, maxR: number, perch = false, kind?: PerchKind): void => {
      const f = floorAt(y - 1);
      if (!isOpen(this.house, f)) return;
      // (not out over an open funnel: a cat that slid off the end would go down it)
      for (const { fn, floor } of funnels) {
        const clear = fn.x + fn.rimHw + 10;
        if (floor === f && y < fn.rimY && x0 < clear) {
          if (x1 - clear < 24) return;
          x0 = clear;
        }
      }
      out.push({ x: (x0 + x1) / 2, y, half: Math.max(4, (x1 - x0) / 2 - 22), maxR, floor: f, perch, kind });
    };
    for (const p of s.furniture) for (const sf of p.surfaces) add(sf.x0, sf.x1, sf.y, Math.min(44, (sf.x1 - sf.x0) * 0.42));
    for (const p of this.perchProps) {
      for (const sf of p.surfaces) {
        const k = p.save.kind;
        const maxR = k === 'hammock' || k === 'pod' || k === 'beanbag' || k === 'bed' || k === 'bounce' ? 42 : Math.min(40, (sf.x1 - sf.x0) * 0.44);
        add(sf.x0, sf.x1, sf.y, maxR, true, k);
      }
    }
    // into the vase and the basket: onto its opening, to pour in from there (one that fits through it)
    for (const c of s.containers) {
      const o = c.opening;
      if (o) out.push({ x: (o.x0 + o.x1) / 2, y: o.y, half: 4, maxR: Math.min(44, o.x1 - o.x0), floor: floorAt(o.y - 1) });
    }
    // the floors, where they're clear of the tubes and of what stands on them (the living room's isn't, to begin with: the funnel, the vase, the cushion and the tub)
    for (const f of ['attic', 'living', 'basement'] as const) {
      if (isOpen(this.house, f)) for (const [x0, x1] of this.floorSpans(f)) add(x0, x1, FLOORS[f].floorY, 44);
    }
    if (isOpen(this.house, 'basement')) add(SPOUT.x - 20, SPOUT.x + 20, FLOORS.basement.floorY - PERCHES.beanbag.height, 44);
    if (isOpen(this.house, 'roof')) {
      add(110, 270, FLOORS.roof.floorY, 44);
      add(CHIMNEY.x0, CHIMNEY.x1, CHIMNEY.y, 40);
    }
    return out;
  }

  /** The stretches of a floor clear of the tubes and of anything standing on it, wide enough for a cat to land on. */
  private floorSpans(f: FloorId): [number, number][] {
    const fy = FLOORS[f].floorY;
    const cuts: [number, number][] = [];
    const stand = (b: Box): void => {
      if (b.y1 > fy - 8 && b.y0 < fy) cuts.push([b.x0 - 4, b.x1 + 4]);
    };
    for (const b of fittingBoxes(this.house)) stand(b);
    for (const p of this.host.session.props) stand(p);
    for (const p of this.perchProps) stand(p.box);
    cuts.sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    let x = 0;
    for (const [a, b] of cuts) {
      if (a - x >= 48) out.push([x, a]);
      x = Math.max(x, b);
    }
    if (WORLD_W - x >= 48) out.push([x, WORLD_W]);
    return out;
  }

  /**
   * The free places a cat (at x, its bottom at `bottom`) can leap to on its
   * floor: within `reach` either side and `climb` up, not straight up into
   * the underside of a ledge overhead (up from the side), and with nobody
   * there or on the way there.
   */
  private reachable(cat: Cat, x: number, bottom: number, reach = 260, climb = 230): Spot[] {
    const s = this.host.session;
    const r = cat.body.p.radius;
    const floor = floorAt(bottom - r);
    return this.spots().filter((p) => {
      if (p.floor !== floor || r > p.maxR) return false;
      if (p.y - 2 * r - 8 < FLOORS[floor].ceilY) return false;
      const dx = p.x - x;
      const rise = bottom - p.y;
      if (Math.abs(dx) < 30 && Math.abs(rise) < 30) return false;
      if (Math.abs(dx) > reach || rise > climb) return false;
      if (rise > 10 && Math.abs(dx) < p.half + 22 + r + 4) return false;
      // (room for it there, all along: not a spot that's too small for it, or that something stands in)
      const ly = p.y - r * 0.92 - 2;
      if ([p.x - p.half, p.x, p.x + p.half].some((lx) => !roomFor(s.world.statics, [], lx, ly, r))) return false;
      const there = (ox: number, oy: number, or: number): boolean => Math.abs(ox - p.x) < or + r - 4 && Math.abs(oy - p.y) < 40;
      if (this.leaps.some((l) => l.cat !== cat && there(l.x1, l.top, l.cat.body.p.radius))) return false;
      return !s.cats.some((o) => {
        if (o === cat || this.leaping(o)) return false;
        o.body.computeCentroid();
        return there(o.body.cx, o.body.cy + o.body.p.radius, o.body.p.radius);
      });
    });
  }

  /**
   * Every so often one of the cats who've been resting a while does
   * something: plays, if it's in the mood (see Antics); otherwise hops off
   * somewhere, unless it would rather stay put (a lazy cat, or a hurt one).
   */
  private turn(s: Session): void {
    const idle = s.cats.filter((c) => !c.grabbed && !this.tubes.riding(c) && !this.leaping(c) && !this.antics.busy(c) && c.settled > 90 && c.sinceTouch > 240);
    if (!idle.length) return;
    const cat = idle[Math.floor(Math.random() * idle.length)];
    if (this.antics.turn(cat)) return;
    const lazy = this.antics.temper(cat).lazy * 0.5 + (this.house.hurt[cat.breed] ? 0.4 : 0);
    if (Math.random() < lazy) return;
    this.wander(cat);
  }

  /**
   * Where the cats' games mustn't go: into a tube's mouth, or, with a
   * funnel open, anywhere over it, where a cat knocked off something (the
   * window sill) would fall in (a cat goes down a funnel when you drop it there).
   */
  private offLimits(x: number, y: number): boolean {
    const tubes = this.tubesIn();
    if (Tubes.mouthAt(tubes, x, y)) return true;
    return tubes.some((t) => {
      const f = funnelOf(t);
      return !!f && y < f.rimY && y > FLOORS[t.upper.floor].ceilY && Math.abs(x - f.x) < f.rimHw + 24;
    });
  }

  /** A hop to a free spot nearby (they like going up, and the perches most of all). */
  private wander(cat: Cat): void {
    const b = cat.body;
    b.computeCentroid();
    let bottom = -Infinity;
    for (let i = 0; i < b.n; i++) bottom = Math.max(bottom, b.y[i]);
    const free = this.reachable(cat, b.cx, bottom);
    if (!free.length) {
      // nowhere to go: a stretch and a little hop on the spot
      b.kick(0, -b.p.hop * 0.55);
      cat.sinceTouch = 0;
      return;
    }
    // (a bed to nap in, the sleepy ones above all; a bouncy cushion, the playful ones)
    const t = this.antics.temper(cat);
    const weights = free.map((p) => (1 + Math.max(0, bottom - p.y) / 50) * (p.perch ? 2.5 : 1) * (p.kind === 'bed' ? 2 + 3 * t.lazy : p.kind === 'bounce' ? 0.6 + 2 * t.play : 1));
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

  /** Somewhere free for a cat to leap off to, away from x if it can (the far side, a little at random). */
  private escape(cat: Cat, fromX: number): { x: number; y: number } | null {
    const b = cat.body;
    b.computeCentroid();
    let bottom = -Infinity;
    for (let i = 0; i < b.n; i++) bottom = Math.max(bottom, b.y[i]);
    const away = Math.sign(b.cx - fromX) || 1;
    const free = this.reachable(cat, b.cx, bottom).filter((p) => Math.sign(p.x - fromX) === away || Math.abs(p.x - fromX) > 120);
    if (!free.length) return null;
    free.sort((p, q) => Math.abs(q.x - fromX) - Math.abs(p.x - fromX));
    const p = free[Math.floor(Math.random() * Math.min(3, free.length))];
    return { x: p.x + (Math.random() * 2 - 1) * p.half, y: p.y };
  }

  /**
   * Leap so as to land with the cat's middle just over (x, y - r): a real
   * gravity arc, high enough to clear the edge of what it's landing on, the
   * cat stretching a little along the way it's flying. (A ballistic kick
   * fell short: a soft body pushing off the floor loses much of its spring,
   * and up onto a shelf it bumped the edge.) It's out of the physics while it
   * flies, and lands in it with the speed it's falling at.
   */
  private hop(cat: Cat, x: number, y: number, low = false, land?: () => void): void {
    const b = cat.body;
    b.computeCentroid();
    const f = planFlight(b, x, y, low, FLOORS[floorAt(b.cy)].ceilY + b.p.radius + 6);
    this.host.session.world.removeBody(b);
    this.leaps.push({ ...f, cat, top: y, land });
    cat.intent = null;
    cat.sinceTouch = 0;
    if (!low || Math.random() < 0.5) this.host.audio.grab(BREEDS[cat.breed].voice.pitch, false);
  }

  /**
   * One step of every leap: on along its arc, or, at its end or as it
   * touches something on the way (see leap.ts), back into the physics.
   */
  private stepLeaps(): void {
    const w = this.host.session.world;
    for (const l of [...this.leaps]) {
      const b = l.cat.body;
      if (stepFlight(l, b, w.statics, w.bodies) === 'flying') continue;
      release(l, b);
      w.addBody(b);
      this.leaps.splice(this.leaps.indexOf(l), 1);
      this.antics.clearToy(l.cat);
      l.land?.();
    }
  }

  /**
   * Is another cat where one's coming out of a tube (its ring, `out`)? It
   * waits at the mouth till there isn't, and whoever's in the way (sitting on
   * the beanbag under the spout, say) is shooed off with a little hop aside.
   */
  private inTheWay(cat: Cat, out: Float64Array): boolean {
    const s = this.host.session;
    const n = cat.body.n;
    const by = inRingOf(out, n, s.world.bodies, cat.body);
    if (this.frame % 20 === 0) {
      let mx = 0;
      for (let i = 0; i < n; i++) mx += out[i * 2] / n;
      for (const b of by) {
        const o = s.cats.find((c) => c.body === b);
        if (o?.grabbed) continue;
        b.computeCentroid();
        b.kick((Math.sign(b.cx - mx) || (Math.random() < 0.5 ? -1 : 1)) * 170, -200);
        if (o) {
          o.intent = null;
          o.sinceTouch = 0;
        }
      }
    }
    return by.length > 0;
  }

  /** Is this cat in the middle of a leap? */
  private leaping(cat: Cat): boolean {
    return this.leaps.some((l) => l.cat === cat);
  }

  /** The next cat on the way hops in at the window. */
  private dropIn(): void {
    const b = arrive(this.house);
    writeHouse(this.house);
    if (!b) return;
    applyNames(this.house);
    const s = this.host.session;
    // in at the window, and a leap from there to the nearest free place in
    // the room (it's out of the world until it lands: whoever's on the sill
    // stays put)
    const cat = s.addCat(b, WINDOW.x, WINDOW.y, NAMES[b]);
    cat.sinceTouch = 0;
    const to = this.reachable(cat, WINDOW.x, WINDOW.y, WORLD_W, 120).sort((p, q) => Math.hypot(p.x - WINDOW.x, p.y - WINDOW.y) - Math.hypot(q.x - WINDOW.x, q.y - WINDOW.y))[0];
    if (to) this.hop(cat, to.x, to.y);
    else cat.body.kick(110, -150);
    this.host.renderer.puff(WINDOW.x, WINDOW.y - BREEDS[b].physics.radius, 6);
    this.host.audio.reveal();
    this.newcomer = { cat, t: 0 };
    this.arrivalIn = this.house.arriving.length ? 0.6 : -1;
    this.goTo('living');
    this.refreshBar();
  }

  // ---------------------------------------------------------------------------
  // The tubes

  /** Send a cat through a tube (the camera goes along, unless it went in by itself). */
  private ride(cat: Cat, tube: Tube, up: boolean, follow = true): void {
    this.tubes.start(cat, tube, up);
    if (!follow) return;
    this.follow = cat;
    this.camGoal = null;
  }

  /** A cat was let go: under a hood, it's sucked in. */
  released(cat: Cat): void {
    if (!this.active) return;
    this.letGo = { cat, at: this.since };
    const b = cat.body;
    b.computeCentroid();
    const hit = Tubes.mouthAt(this.tubesIn(), b.cx, b.cy, 'hood');
    if (hit) this.ride(cat, hit.tube, hit.up);
  }

  /** Can this cat be picked up or booped (not while it's in a tube)? */
  canTouch(cat: Cat): boolean {
    return !this.tubes.riding(cat) && !this.leaping(cat) && !this.antics.fighting(cat);
  }

  /** A tap on a cat at home: a hurt one is fed a fish (true); any other is just booped (false). */
  tapCat(cat: Cat): boolean {
    if (!this.active || !this.house.hurt[cat.breed]) return false;
    const b = cat.breed;
    const r = feedFish(this.house, b);
    writeHouse(this.house);
    this.shownTreats = this.house.treats;
    this.refreshTreats();
    if (r === 'empty') {
      const h = this.house.hurt[b]!;
      this.host.audio.boop(BREEDS[b].voice.pitch * 0.85);
      this.toast(b, `${NAMES[b]} needs ${h.need - h.fed} more fish to feel better. Play a game to catch some!`, 4200);
      return true;
    }
    this.feeding.push({ cat, t: 0, healed: r === 'healed' });
    cat.sinceTouch = 0;
    if (r === 'healed') setTimeout(() => this.active && this.toast(b, `${NAMES[b]}'s all better!`), 380);
    return true;
  }

  /** A tap where there's no cat: on a scrap it breaks it up, on the yarn it bats it (true if it was either). */
  tapThing(x: number, y: number): boolean {
    if (!this.active || this.placing) return false;
    return this.antics.breakUp(x, y) || this.antics.tapToy(x, y);
  }

  /** Is (x, y) on the ball of yarn? */
  yarnAt(x: number, y: number): boolean {
    return this.active && !this.placing && this.antics.onToy(x, y);
  }

  /** A scrap left a cat hurt: it needs fish to feel better. */
  private hurt(cat: Cat): void {
    const b = cat.breed;
    const first = !Object.keys(this.house.hurt).length && !this.house.scraped;
    hurtCat(this.house, b, HURT_FISH[0] + Math.floor(Math.random() * (HURT_FISH[1] - HURT_FISH[0] + 1)));
    this.house.scraped = true;
    writeHouse(this.house);
    const h = this.house.hurt[b]!;
    setTimeout(() => {
      if (!this.active) return;
      this.toast(b, first ? `Ouch! ${NAMES[b]} got scratched. Tap ${NAMES[b]} to feed fish till better (${h.need - h.fed} fish).` : `${NAMES[b]} got scratched! Tap to feed ${h.need - h.fed} fish.`, 5200);
    }, 600);
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
  /** A cat curled up in a cat bed dozes off. */
  private restFace(cat: Cat): { expression: Expression } | null {
    if (cat.grabbed || cat.settled < 120) return null;
    const b = cat.body;
    for (const p of this.perchProps) {
      if (p.save.kind !== 'bed') continue;
      const bx = p.box;
      if (b.cx > bx.x0 && b.cx < bx.x1 && b.cy > bx.y0 - b.p.radius && b.cy < bx.y1) return { expression: 'sleepy' };
    }
    return null;
  }

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
    // (one finger at a time: a second does nothing)
    if (!this.active || this.drag) return false;
    const pl = this.placing;
    if (pl) {
      const b = this.placeBox(pl);
      const slop = 26 * this.host.renderer.unitsPerPx * 2;
      if (wx > b.x0 - slop && wx < b.x1 + slop && wy > b.y0 - slop && wy < b.y1 + slop) {
        this.drag = { k: 'ghost', id, dx: pl.x - wx, dy: pl.y - wy, sx, sy };
        return true;
      }
    }
    if (!pl) {
      // (held still a moment, it comes up: a perch, or one of the house's own things)
      const perch = this.perchProps.find((p) => wx > p.box.x0 && wx < p.box.x1 && wy > p.box.y0 && wy < p.box.y1);
      const thing = perch ? null : this.thingUnder(wx, wy);
      if (perch || thing) {
        const timer = window.setTimeout(() => (perch ? this.pickUp(perch.save.id) : this.liftThing(thing!)), HOLD_MS);
        this.drag = { k: 'hold', id, sx, sy, timer };
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
      if (Math.abs(sy - d.sy) > SLOP && !d.moved) {
        d.moved = true;
        coach.done('home-scroll');
      }
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
    // dragging a perch (or a thing): it follows the finger (and the view scrolls along at the screen's top and bottom: see moveCamera)
    d.sx = sx;
    d.sy = sy;
    this.dragGhostTo(wx, wy);
  }

  /** What's being placed follows the finger, to where it can go there. */
  private dragGhostTo(wx: number, wy: number): void {
    const d = this.drag;
    const pl = this.placing;
    if (d?.k !== 'ghost' || !pl) return;
    const p = pl.k === 'perch' ? snapPerch(pl.kind, wx + d.dx, wy + d.dy) : snapThing(pl.thing, wx + d.dx, wy + d.dy);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x === pl.x && y === pl.y) return;
    pl.x = x;
    pl.y = y;
    this.refreshPlaceBar();
  }

  /** How fast the view scrolls with what's being placed dragged to the top or the bottom of the screen (anywhere in the house: to another floor). */
  private ghostEdge(): number {
    const d = this.drag;
    if (d?.k !== 'ghost' || !this.placing) return 0;
    const r = this.host.renderer;
    const band = 75;
    const top = r.insets.top + band;
    const bottom = r.H - r.insets.bottom - band * 0.7;
    const u = d.sy < top ? -(top - d.sy) / band : d.sy > bottom ? (d.sy - bottom) / band : 0;
    return Math.sign(u) * Math.min(1, Math.abs(u)) * 520;
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
        // a still finger: ease onto the nearest stop if it's close
        this.camV = 0;
        const near = nearestView(this.camY);
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
    coach.done('home-scroll');
    this.follow = null;
    this.camGoal = null;
    this.camV = 0;
    this.camY = clamp(this.camY + dy * 0.9, this.stage.pan[0], this.stage.pan[1]);
    window.clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => {
      const near = nearestView(this.camY);
      if (Math.abs(near - this.camY) < 120) this.camGoal = near;
    }, 220);
  }
  private wheelTimer = 0;

  // ---------------------------------------------------------------------------
  // Perches: buying, putting somewhere, moving

  private problem(pl: Placing): PlaceProblem {
    const taken: Box[] = fittingBoxes(this.house, 'all');
    const s = this.host.session;
    // (a thing being moved is out of the room till it's put down)
    for (const p of s.props) taken.push({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 });
    for (const p of this.perchProps) if (pl.k !== 'perch' || p.save.id !== pl.id) taken.push(p.box);
    const open = openFloors(this.house);
    const pr = pl.k === 'perch' ? placeProblem(pl.kind, pl.x, pl.y, open, taken) : thingProblem(pl.thing, pl.x, pl.y, open, taken);
    if (pr) return pr;
    // not on top of a cat
    const b = this.placeBox(pl);
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
    // (in the living room, wherever up its wall you're looking)
    const mid = f === this.floorInView ? this.camY : f === 'living' ? VIEW_Y.living : viewMid(f);
    const pl: Placing = { k: 'perch', id, kind, x: WORLD_W / 2, y: mid, prev };
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
    const name = pl.k === 'perch' ? PERCHES[pl.kind].name.toLowerCase() : pl.thing.name;
    const standing = pl.k === 'perch' ? PERCHES[pl.kind].mount === 'floor' : !onWall(pl.thing);
    const why: Record<Exclude<PlaceProblem, null>, string> = {
      locked: 'That floor isn’t open yet',
      outside: standing ? 'It stands on a floor' : 'Keep it inside the room, off the floor',
      blocked: 'Something’s in the way',
      sky: pl.k === 'perch' ? 'Out in the open only a cloud shelf floats' : 'That stays indoors',
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
    if (pl.k === 'thing') this.putThing(pl, ok);
    else {
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
    }
    writeHouse(h);
    this.host.renderer.invalidate();
  }

  /** A thing put down where it's been dragged to (where it always was, it's not "moved" any more), or back where it was. */
  private putThing(pl: PlacingThing, ok: boolean): void {
    const t = pl.thing;
    let prop = pl.prop;
    if (ok) {
      const home = thingPos(t);
      if (pl.x === home.x && pl.y === home.y) delete this.house.moved[t.id];
      else this.house.moved[t.id] = { x: pl.x, y: pl.y };
      prop = thingProp(t, pl.x, pl.y, prop.uid);
      this.host.audio.seat(80);
      this.host.renderer.puff(pl.x, t.kind === 'container' ? pl.y - 6 : pl.y + 4, 6);
    }
    this.ghostAt = null;
    this.host.session.addProp(prop);
  }

  /** What a perch or thing being placed takes up. */
  private placeBox(pl: Placing): Box {
    if (pl.k === 'perch') return perchBox(pl.kind, pl.x, pl.y);
    const g = this.ghost(pl);
    return { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 };
  }

  /** A thing being moved, as it would be where it's been dragged to. */
  private ghost(pl: PlacingThing): Prop {
    const key = `${pl.thing.id}@${pl.x},${pl.y}`;
    if (this.ghostAt?.key !== key) this.ghostAt = { key, prop: thingProp(pl.thing, pl.x, pl.y, pl.prop.uid) };
    return this.ghostAt.prop;
  }

  /** The house's own thing under a finger, if any (the smallest, where they overlap). */
  private thingUnder(wx: number, wy: number): Prop | null {
    let best: Prop | null = null;
    const area = (p: Prop): number => (p.x1 - p.x0) * (p.y1 - p.y0);
    for (const p of this.host.session.props) {
      if (!p.id || wx < p.x0 - 4 || wx > p.x1 + 4 || wy < p.y0 - 4 || wy > p.y1 + 4) continue;
      if (!best || area(p) < area(best)) best = p;
    }
    return best;
  }

  /** Long-pressed one of the house's things: up it comes, to be put somewhere else (or a word on why it stays where it is). */
  private liftThing(prop: Prop): void {
    const d = this.drag;
    if (d?.k === 'hold') this.drag = null;
    const t = THING[prop.id as ThingId] as Thing | undefined;
    if (!t || this.placing || !this.host.session.props.includes(prop)) return;
    if (t.stays) {
      this.toast(this.house.residents[0] ?? 'kitten', `${t.stays}.`, 2600);
      return;
    }
    const prev = thingPos(t, this.house.moved);
    this.host.session.removeProp(prop);
    this.host.renderer.invalidate();
    this.host.audio.grab(1.2, false);
    this.beginMoving({ k: 'thing', thing: t, prop, x: prev.x, y: prev.y, prev }, d);
  }

  /** Moving something that was out (a perch, or one of the house's things): the bar for it, and the finger that picked it up drags it. */
  private beginMoving(pl: Placing, d: Drag | null): void {
    this.placing = pl;
    this.bar.classList.add('hidden');
    this.placeBar.classList.remove('hidden');
    this.lastLabels = '';
    this.refreshPlaceBar();
    if (d?.k === 'hold') {
      const w = this.host.renderer.screenToWorld(d.sx, d.sy);
      this.drag = { k: 'ghost', id: d.id, dx: pl.x - w.x, dy: pl.y - w.y, sx: d.sx, sy: d.sy };
    }
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
    this.beginMoving({ k: 'perch', id, kind: p.save.kind, x: prev.x, y: prev.y, prev }, d);
  }

  // ---------------------------------------------------------------------------
  // The day's present

  /** Is (x, y) on the present? */
  giftAt(wx: number, wy: number): boolean {
    const g = this.gift;
    return this.active && !!g && !this.placing && Math.abs(wx - g.x) <= 24 && wy >= g.y - 40 && wy <= g.y + 8;
  }

  /** A tap on the present opens it. */
  openGiftAt(wx: number, wy: number): boolean {
    if (!this.giftAt(wx, wy)) return false;
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
    const namers = this.house.residents.map((b) => `<div class="hc-namer"><span class="hc-face">${faceSVG(b, { mood: 'happy', size: 44 })}</span>${this.nameField(b, `hcName-${b}`)}</div>`).join('');
    this.host.openOverlay(
      `<div class="card" role="dialog" aria-label="Welcome home">
        <h2>Welcome home!</h2>
        <p class="sub">Two cats live here already. What are they called?</p>
        <div class="hc-namers">${namers}</div>
        <p class="hc-games">And make a cat of your very own to live here too.</p>
        <div class="btns"><button class="btn primary" data-act="make">Make my cat</button><button class="btn" data-close>Later</button></div>
      </div>`,
      (root) => {
        this.bindNames(root);
        root.querySelector('[data-act=make]')!.addEventListener('click', () => this.showMaker());
      },
    );
    this.house.welcomed = true;
    this.house.catAsked = true;
    this.house.gift = localDateKey();
    writeHouse(this.house);
  }

  /** The house's tips, each once, one at a time (ui/coach.ts): what the welcome card used to say, by what it's about. */
  private tips(): void {
    const bar = this.bar;
    coach.tip('home-games', 'Play Cat Jar and Cat Drop to earn treats for the shop. More cats move in as you play.', () => bar.querySelector<HTMLElement>('[data-game=jar]'));
    coach.tip('home-faces', 'Tap the faces up here to see your cats, and rename them.', () => document.getElementById('faces'));
    coach.tip('home-scroll', 'Swipe up and down to look round the house.', () => this.lift.querySelector<HTMLElement>('.floor-up:not(.off)'));
    coach.tip('home-sky', 'Take your cats up to the Playground, and build them anything you like.', () => bar.querySelector<HTMLElement>('[data-act=playground]'));
  }

  /** Once, for a house from before there was a cat maker: make your own cat? */
  private offerMaker(): void {
    this.house.catAsked = true;
    writeHouse(this.house);
    this.host.openOverlay(
      `<div class="card" role="dialog" aria-label="Make your own cat">
        <h2>Make your own cat!</h2>
        <p class="sub">A cat of your very own, to live here with ${this.names(this.house.residents.filter((b) => b !== 'mine'))}.</p>
        <p class="hc-games">Pick its coat and pattern, its eyes, how fluffy, how big, its personality, and how squishy it is: anything from a firm loaf to a puddle. It moves in right away, and it can play Cat Drop too.</p>
        <div class="btns"><button class="btn primary" data-act="make">Make my cat</button><button class="btn" data-close>Maybe later</button></div>
      </div>`,
      (root) => root.querySelector('[data-act=make]')!.addEventListener('click', () => this.showMaker()),
    );
  }

  /** The cat maker: make your own cat, or restyle it. */
  showMaker(): void {
    this.host.audio.click();
    const fresh = !this.house.cat;
    const taken = this.house.residents.filter((b) => b !== 'mine').map((b) => NAMES[b]);
    const start = this.house.cat ?? randomDesign(Math.random, [...ALL_CATS.map((b) => NAMES[b])]);
    const maker = new CatMaker(this.host, start, { fresh, taken, done: (d) => this.catMade(d, fresh) });
    // (opening it closes whatever card was up, and that card's maker with it)
    maker.open();
    this.maker = maker;
  }

  /** The card's closed (by any means): the cat maker's preview stops with it. */
  overlayClosed(): void {
    this.maker?.stop();
    this.maker = null;
  }

  /** Your cat, made or restyled. */
  private catMade(d: CatDesign, fresh: boolean): void {
    this.house.cat = d;
    this.house.catAsked = true;
    applyMyCat(this.house);
    applyNames(this.house);
    if (fresh || !this.house.residents.includes('mine')) {
      // in at the window, first in the queue
      if (!this.house.arriving.includes('mine')) this.house.arriving.unshift('mine');
      writeHouse(this.house);
      if (this.active && this.arrivalIn < 0 && !this.newcomer) this.arrivalIn = 0.5;
      return;
    }
    writeHouse(this.house);
    // (the house again, with your cat in its new look and squish, where it was)
    this.host.rebuild();
    // (hearts over it: from its body, as it hasn't been drawn in this house yet)
    const cat = this.host.session.cats.find((c) => c.breed === 'mine');
    if (cat) {
      const b = cat.body;
      b.computeCentroid();
      this.host.renderer.hearts(b.cx, b.cy - b.p.radius - 8, 3);
      this.host.renderer.puff(b.cx, b.cy, 5);
    }
  }

  /** Something that changes when your cat's looks do, or anyone's name (the top bar's faces). */
  get catKey(): string {
    return `${lookKey('mine')}:${Object.values(NAMES).join('|')}`;
  }

  /** "2 of 6 cats live here, and Toffee". */
  countLine(): string {
    const h = this.house;
    const six = h.residents.filter((b) => b !== 'mine').length;
    return `${six} of ${ALL_CATS.length} cats live here${h.residents.includes('mine') ? `, and ${NAMES.mine}` : ''}`;
  }

  private arrivalCard(b: BreedId): void {
    const m = moveInFor(b);
    const mine = b === 'mine';
    this.host.audio.seat(96);
    const cat = this.host.session.cats.find((c) => c.breed === b);
    if (cat) {
      const v = this.host.renderer.view(cat);
      this.host.renderer.hearts(v.hx, v.hy - 16, 3);
    }
    const kind = kindOf(b);
    // (one that goes by its kind is "a Persian" till you name it)
    const title = (n: string): string => (!mine && n === kind ? `A ${kind} moved in!` : `${n} moved in!`);
    const welcome = (n: string): string => (!mine && n === kind ? 'Welcome home' : `Welcome home, ${n}`);
    this.host.openOverlay(
      `<div class="card" role="dialog" aria-label="${title(NAMES[b])}">
        <h2 data-title>${title(NAMES[b])}</h2>
        <div class="hc-portrait"></div>
        <p class="sub">${mine ? `Your very own cat · ${TEMPERS.mine.word} · ${BREEDS.mine.flow}` : `${kind} · ${TEMPERS[b].word} · ${BREEDS[b].flow}`}</p>
        ${m ? `<p class="hc-why">${m.how}: done!</p>` : ''}
        ${mine ? '<p class="hc-why">Restyle them any time: tap the faces up top.</p>' : `<p class="hc-ask">What will you call them?</p>${this.nameField(b, 'hcName')}`}
        <p class="hc-count">${this.countLine()}</p>
        <div class="btns"><button class="btn primary" data-close data-welcome>${welcome(NAMES[b])}</button></div>
      </div>`,
      (root) => {
        root.querySelector('.hc-portrait')!.appendChild(catPortrait(b, 150, 92, { happy: true }));
        this.bindNames(root, (_, n) => {
          root.querySelector('[data-title]')!.textContent = title(n);
          root.querySelector('[data-welcome]')!.textContent = welcome(n);
        });
      },
    );
  }

  /** Who lives here, and what brings each of the others home (yours first: make it, or restyle it). */
  showCats(): void {
    coach.done('home-faces');
    const h = this.house;
    const mineHere = h.residents.includes('mine') || h.arriving.includes('mine');
    const row = (b: BreedId): string => {
      const here = h.residents.includes(b);
      const coming = h.arriving.includes(b);
      const m = moveInFor(b);
      const hurt = here ? h.hurt[b] : undefined;
      const mood = moodOf(b, localDateKey());
      const what = b === 'mine' ? `your own cat, ${TEMPERS.mine.word}` : `${NAMES[b] === kindOf(b) ? '' : `${kindOf(b)}, `}${TEMPERS[b].word}`;
      const status = hurt
        ? `<small class="hc-hurt">hurt in a scrap · ${hurt.need - hurt.fed} more fish to feel better (tap to feed)</small>`
        : here
          ? `<small>${what}${mood ? `, ${MOOD_WORDS[mood]}` : ''} · ${BREEDS[b].flow}</small>`
          : coming
            ? '<small class="hc-coming">on the way home!</small>'
            : `<small>${m?.how ?? ''}</small>`;
      const btn =
        b === 'mine'
          ? '<button class="hc-play" data-act="maker">Restyle</button>'
          : !here && !coming && m
            ? `<button class="hc-play" data-play="${m.game}" aria-label="Play ${GAME_NAMES[m.game]}">Play</button>`
            : '';
      const name = here
        ? `<input class="hc-rename" type="text" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" data-name="${b}" value="${NAMES[b] === kindOf(b) ? '' : NAMES[b]}" placeholder="${kindOf(b)}" aria-label="${whoIs(b)}: name">`
        : `<b>${kindOf(b)}</b>`;
      return `<div class="hc-row ${here || b === 'mine' ? '' : 'away'}" data-breed="${b}"><span class="hc-pic"></span><span class="hc-who">${name}${status}</span>${btn}</div>`;
    };
    const make = mineHere
      ? row('mine')
      : `<div class="hc-row hc-make"><span class="hc-pic hc-plus" aria-hidden="true">+</span><span class="hc-who"><b>Your own cat</b><small>Make one: coat, fur, size, and how squishy</small></span><button class="hc-play" data-act="maker">Make</button></div>`;
    this.host.openOverlay(
      `<div class="card" role="dialog" aria-label="Your cats">
        <h2>Your cats</h2>
        <p class="sub">${this.countLine()} · cats move in as you play</p>
        <div class="hc-rows">${make}${ALL_CATS.map(row).join('')}</div>
        <div class="btns"><button class="btn" data-close>Close</button></div>
      </div>`,
      (root) => {
        root.querySelectorAll<HTMLElement>('[data-breed]').forEach((el) => {
          const b = el.dataset.breed as BreedId;
          const known = h.residents.includes(b) || h.arriving.includes(b);
          el.querySelector('.hc-pic')!.appendChild(catPortrait(b, 64, 46, { silhouette: !known, happy: known }));
        });
        root.querySelectorAll<HTMLElement>('[data-act=maker]').forEach((el) => el.addEventListener('click', () => this.showMaker()));
        this.bindNames(root);
        root.querySelectorAll<HTMLElement>('[data-play]').forEach((el) =>
          el.addEventListener('click', () => {
            this.host.closeOverlay();
            this.host.play(el.dataset.play as GameId);
          }),
        );
      },
    );
  }

  /** The shop: the floors still to open, and perches. */
  showShop(): void {
    this.host.audio.click();
    const h = this.house;
    const floors = (['basement', 'attic', 'roof'] as ExtraFloor[])
      .map((f) => {
        const open = isOpen(h, f);
        const price = FLOOR_PRICES[f];
        const blurb = FLOOR_BLURBS[f];
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

  /** The lock sign on a floor, or a capped tube: open it up? */
  offerFloor(f: ExtraFloor): void {
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
    const y = FLOORS[f].floorY - 200;
    setTimeout(() => {
      r.hearts(WORLD_W / 2, y, 5);
      r.label(WORLD_W / 2, y - 20, `The ${FLOORS[f].name.toLowerCase()}’s open!`, '#D9A62E');
    }, 500);
    const cat = this.house.residents[0];
    if (cat) this.toast(cat, FLOOR_HOWTO[f], 4200);
  }

  /** A box to name a cat of yours in (blank: it goes by its kind), and a button for an idea for one. */
  private nameField(b: BreedId, id: string): string {
    const kind = kindOf(b);
    return `<div class="mk-name hc-name"><label for="${id}">Name</label><input id="${id}" type="text" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" data-name="${b}" placeholder="${kind}" value="${NAMES[b] === kind ? '' : NAMES[b]}"><button class="mk-chip" data-idea="${b}" aria-label="An idea for a name">↻</button></div>`;
  }

  /** Name boxes save as you type (`then` hears each new name); an idea button fills one in. */
  private bindNames(root: HTMLElement, then?: (b: BreedId, name: string) => void): void {
    root.querySelectorAll<HTMLInputElement>('input[data-name]').forEach((el) => {
      const b = el.dataset.name as BreedId;
      el.addEventListener('input', () => then?.(b, this.rename(b, el.value)));
      // (tidied once you're done: what it's actually called, or blank if it goes by its kind)
      el.addEventListener('change', () => {
        const n = this.rename(b, el.value);
        el.value = b !== 'mine' && n === kindOf(b) ? '' : n;
      });
    });
    root.querySelectorAll<HTMLElement>('[data-idea]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const el = root.querySelector<HTMLInputElement>(`input[data-name="${btn.dataset.idea}"]`);
        if (!el) return;
        const taken = Object.values(NAMES);
        const ideas = NAME_IDEAS.filter((n) => !taken.includes(n));
        el.value = ideas[Math.floor(Math.random() * ideas.length)] ?? el.value;
        this.host.audio.click();
        el.dispatchEvent(new Event('input'));
      }),
    );
  }

  /** Give a cat of yours a name (see renameCat): kept with the house, and it goes by it everywhere. */
  private rename(b: BreedId, name: string): string {
    const n = renameCat(this.house, b, name);
    writeHouse(this.house);
    for (const c of this.host.session.cats) c.name = NAMES[c.breed];
    return n;
  }

  private names(list: BreedId[]): string {
    const n = list.map((b) => NAMES[b]);
    return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  }
}

/**
 * Is a cat's middle down inside the funnel's cone (fallen into it), rather
 * than beside it on the floor under its rim, bumped there?
 */
function inFunnel(f: Funnel, x: number, y: number): boolean {
  const u = clamp((y - f.rimY) / (f.neckY - f.rimY), 0, 1);
  return Math.abs(x - f.x) < f.rimHw + (f.neckHw - f.rimHw) * u - 2;
}

/** Decor laid flat on the wall or floor (painted under the furniture). */
function isFlat(d: DecorPlacement): boolean {
  return d.type === 'rug' || d.type === 'backsplash' || d.type === 'window' || d.type === 'picture' || d.type === 'mirror' || d.type === 'clock' || d.type === 'garland' || d.type === 'radiator' || d.type === 'towel';
}

/** The house's side walls, cut (the dollhouse is open at the front), and the world outside them. */
function paintHouseFrame(ctx: Ctx, r: Rect, seed: number): void {
  const edge = '#E9DCCB';
  const cut = '#B9A58E';
  const y0 = Math.max(r.y0, FLOORS.roof.floorY);
  if (y0 >= r.y1) return;
  paintAround(ctx, r, seed);
  ctx.save();
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

/** A sentence's first word with a capital ("a Persian" → "A Persian"). */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
