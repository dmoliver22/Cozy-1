// Cat Jar: drop squishy cats into a big glass jar; two of the same melt into
// a bigger cat. A "Suika" game on the If It Fits soft-body engine.
//
// main wires it together: the game (rules, physics), the view (painting),
// the HUD and cards, input, sounds and effects for the game's events, and a
// `window.__jar` handle for tests.

import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/latin-800.css';
import '@fontsource/nunito/latin-700.css';
import '../proto.css';
import './jar.css';
import { AudioEngine } from '../../audio/audio';
import { BREEDS } from '../../physics/breeds';
import { PALETTE } from '../../render/paint';
import { clamp } from '../../util/math';
import { Loop, bindPointer, loadBest, makeStage, saveBest, todaySeed, unlockAudioOnGesture } from '../kit';
import { CHAIN_MAX, CX, JAR, LAST_TIER, TIERS, WILD } from './config';
import { JarGame, outlineDistance, type JarCat, type JarEvent, type Mode } from './game';
import { JarUI } from './ui';
import { JarView } from './view';

type Phase = 'start' | 'play' | 'over';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const root = document.getElementById('ui') as HTMLElement;
const audio = new AudioEngine();
unlockAudioOnGesture(audio);

const MUSIC_KEY = 'catjar.music';
let musicOn = true;
try {
  musicOn = localStorage.getItem(MUSIC_KEY) !== '0';
} catch {
  // storage blocked: music stays on
}

const game = new JarGame('play');
let phase: Phase = 'start';
let overAt = 0;
let best = 0;
let newBest = false;
/** The biggest cat made so far this game (its name pops up the first time). */
let topTier = 0;
let zTimer = 0;

const bestKey = (g: JarGame): string => (g.mode === 'daily' ? `catjar.daily.${g.seed}` : 'catjar.best');

/** Games started in this browser: the first few say what each breed does as it first turns up. */
const GAMES_KEY = 'catjar.games';
let gamesPlayed = loadBest(GAMES_KEY);
/** Tiers already introduced this game. */
const introduced = new Set<number>();

const ui = new JarUI(
  root,
  {
    play: (mode) => startGame(mode),
    music: (on) => {
      musicOn = on;
      try {
        localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
      } catch {
        // fine
      }
      audio.click();
      if (on && phase !== 'start') audio.startMusic();
      else audio.stopMusic();
    },
  },
  musicOn,
);

// (makeStage measures once while it is being built, before the view exists)
let ready = false;
const stage = makeStage(canvas, () => {
  if (!ready) return;
  view.hudPx = ui.hudBottom();
  view.invalidate();
});
const view = new JarView(stage);
view.hudPx = ui.hudBottom();
view.layout();
ready = true;

// ---------------------------------------------------------------------------
// Game flow

function startGame(mode: Mode, seed?: number): void {
  audio.click();
  game.restart(mode, seed ?? (mode === 'daily' ? todaySeed() : undefined));
  view.reset();
  view.snapHome(game);
  best = loadBest(bestKey(game));
  newBest = false;
  topTier = 0;
  introduced.clear();
  gamesPlayed++;
  saveBest(GAMES_KEY, gamesPlayed);
  phase = 'play';
  ui.hideCards();
  audio.stopAllPurrs();
  if (musicOn) audio.startMusic();
}

/** The start screen: a few cats tumble into the jar behind the card. */
function attract(): void {
  game.restart('play', 20261004);
  view.reset();
  view.snapHome(game);
  const drops: [number, number, number][] = [
    [5, CX + 40, -80],
    [3, CX - 70, -250],
    [4, CX - 20, -420],
    [1, CX + 85, -560],
    [2, CX + 30, -700],
    [0, CX - 90, -820],
  ];
  for (const [t, x, y] of drops) game.place(t, x, y);
  phase = 'start';
  ui.showStart(loadBest('catjar.best'), loadBest(`catjar.daily.${todaySeed()}`));
}

function gameOver(): void {
  phase = 'over';
  overAt = performance.now();
  if (game.score > best) {
    newBest = game.score > 0;
    best = game.score;
    saveBest(bestKey(game), best);
  }
}

// ---------------------------------------------------------------------------
// Input

// One finger: drag sideways to aim and let go to drop; drag up or down to look
// around the tall jar; tap a cat to boop it. A tap never drops a cat (a boop
// that misses must not send the next one falling), except a tap on the
// waiting cat itself, which lets it go.

/** A press that moves less than this (CSS px) is a tap, however long it lasts. */
const SLOP = 10;
/** How far (CSS px) outside a cat's outline a tap still boops it (ears, fur, a fat finger). */
const TAP_REACH = 30;

let gesture: 'press' | 'aim' | 'look' | 'none' = 'none';
/** The press started on the waiting cat: any drag moves it (you've picked it up). */
let onHeld = false;
let downX = 0;
let downY = 0;
let lastY = 0;
let lastT = 0;
/** Finger speed while looking around (CSS px / s), for the fling. */
let lookVel = 0;
/** Drops made by dragging (after a few, a tap on nothing stops showing the hint). */
let dragDrops = 0;
let hintAt = -1e9;

bindPointer(canvas, {
  down(x, y) {
    gesture = phase === 'play' ? 'press' : 'none';
    downX = x;
    downY = lastY = y;
    lastT = performance.now();
    lookVel = 0;
    const held = game.waiting;
    const w = view.toWorld(x, y);
    onHeld = held !== null && Math.hypot(w.x - game.holdX, w.y - game.holdY(held.tier)) < TIERS[held.tier].r + 10;
  },
  move(x, y) {
    if (phase !== 'play') return;
    if (gesture === 'press') {
      const dx = Math.abs(x - downX);
      const dy = Math.abs(y - downY);
      if ((dx > SLOP && dx >= dy) || (onHeld && Math.max(dx, dy) > SLOP)) {
        // sideways: aim (and look back at the waiting cat)
        gesture = 'aim';
        view.lookHome();
      } else if (dy > SLOP) {
        gesture = 'look';
        view.lookStart();
        lastY = downY;
      }
    }
    if (gesture === 'aim') game.aim(view.toWorld(x, y).x);
    else if (gesture === 'look') {
      const now = performance.now();
      const dt = Math.max(1, now - lastT) / 1000;
      lookVel = lookVel * 0.6 + ((y - lastY) / dt) * 0.4;
      view.lookBy(y - lastY);
      lastY = y;
      lastT = now;
    }
  },
  up(x, y, info) {
    const g = gesture;
    gesture = 'none';
    if (g === 'look') {
      // a pause before letting go means no fling
      view.lookEnd(performance.now() - lastT > 80 ? 0 : lookVel);
      return;
    }
    if (phase !== 'play' || info.cancel) return;
    if (g === 'aim') {
      game.aim(view.toWorld(x, y).x);
      if (game.drop()) dragDrops++;
    } else if (g === 'press') tap(x, y);
  },
});

// a mouse wheel or trackpad looks around too
canvas.addEventListener(
  'wheel',
  (e) => {
    if (phase !== 'play') return;
    e.preventDefault();
    view.lookStart();
    view.lookBy(-e.deltaY * (e.deltaMode === 1 ? 16 : 1));
    view.lookEnd(0);
  },
  { passive: false },
);

/** A tap: let the waiting cat go, or boop the cat nearest the finger. */
function tap(x: number, y: number): void {
  const w = view.toWorld(x, y);
  const cat = game.catAt(w.x, w.y, TAP_REACH / view.scale);
  // the gauge by the jar (unless the finger is right by a cat): look at that part of the jar
  const gr = view.gaugeRect();
  const byCat = cat !== null && outlineDistance(cat.body, w.x, w.y) * view.scale < 12;
  if (!byCat && Math.abs(x - gr.x) < 14 && y > gr.y0 - 8 && y < gr.y1 + 8) {
    view.lookStart();
    view.setCam(view.gaugeToCam(y));
    view.lookEnd(0);
    return;
  }
  const held = game.waiting;
  if (held) {
    // right on the waiting cat (and nearer it than any cat in the jar): drop it here
    const r = TIERS[held.tier].r;
    const d = Math.hypot(w.x - game.holdX, w.y - game.holdY(held.tier)) - r;
    if (d < 4 && (!cat || d < outlineDistance(cat.body, w.x, w.y))) {
      game.drop();
      return;
    }
  }
  if (cat) {
    if (game.boop(cat, w.x)) return;
    // out of boops: say so where the finger is, and shake the paws
    ui.noBoops();
    view.fx.label(w.x, w.y - 12, 'no boops left', '#A39BB0', 12);
    audio.click();
    return;
  }
  // a tap on nothing: maybe they expect a tap to drop, so show how
  if (dragDrops < 3 && performance.now() - hintAt > 2500) {
    hintAt = performance.now();
    view.fx.label(w.x, w.y - 12, 'drag sideways to drop', '#8E86A3', 12);
  }
}

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (phase !== 'play') return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    keys.add(e.key);
    view.lookHome();
    e.preventDefault();
  } else if ((e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') && !e.repeat) {
    game.drop();
    view.lookHome();
    e.preventDefault();
  } else if (e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'ArrowUp') {
    // look up or down the jar by most of a screen
    view.lookStart();
    view.lookBy((e.key === 'PageDown' ? -0.7 : 0.7) * (canvas.clientHeight - view.hudPx));
    view.lookEnd(0);
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

// ---------------------------------------------------------------------------
// Sounds and effects for what happened

/** 0 (a kitten) .. 1 (the Void), for how big a sound is. */
const sizeOf = (tier: number): number => clamp((TIERS[tier].r - TIERS[0].r) / (TIERS[LAST_TIER].r - TIERS[0].r), 0, 1);

const TRAIT_INK = '#8C7FA8';

/**
 * Say what a breed does the first time it turns up in a game (in a player's
 * first few games; the Little Void, every time).
 */
function introduce(tier: number, x: number, y: number): void {
  if (introduced.has(tier)) return;
  introduced.add(tier);
  const T = TIERS[tier];
  if (tier === WILD) view.fx.label(x, y, 'Little Void: melts into any cat!', '#5B4E86', 12);
  else if (gamesPlayed <= 3) view.fx.label(x, y, `${T.name} · ${T.trait}`, TRAIT_INK, 12);
}

function handle(events: JarEvent[]): void {
  for (const e of events) {
    switch (e.t) {
      case 'spawn': {
        const T = TIERS[e.tier];
        if (phase === 'play') introduce(e.tier, game.holdX, game.holdY(e.tier) - T.r * 1.5 - 14);
        break;
      }
      case 'hop': {
        audio.boop(BREEDS[TIERS[e.cat.tier].breed].voice.pitch * 1.2);
        break;
      }
      case 'pop': {
        // the chonk flops: a thud, a puff under it, and the little ones squeak
        const b = e.cat.body;
        let maxY = -Infinity;
        for (let i = 0; i < b.n; i++) maxY = Math.max(maxY, b.y[i]);
        audio.impact('wall', 900, 1);
        view.fx.puff(b.cx, maxY, 5, TIERS[e.cat.tier].r * 1.5);
        for (const c of e.popped) {
          const h = view.painter.head(c.body);
          view.fx.note(h.x + TIERS[c.tier].r * 0.4, h.y - 6, '!');
        }
        audio.boop(BREEDS[TIERS[e.popped[0].tier].breed].voice.pitch);
        break;
      }
      case 'drop': {
        const b = BREEDS[TIERS[e.cat.tier].breed];
        audio.grab(b.voice.pitch, false);
        break;
      }
      case 'clink':
        audio.impact('glass', e.speed, sizeOf(e.cat.tier));
        view.squash(e.cat, e.speed);
        break;
      case 'land': {
        const tier = e.cat.tier;
        view.squash(e.cat, e.speed);
        audio.impact(tier >= 4 ? 'wall' : 'fabric', e.speed + 120, sizeOf(tier));
        if (e.speed > 380) {
          const b = e.cat.body;
          let maxY = -Infinity;
          for (let i = 0; i < b.n; i++) maxY = Math.max(maxY, b.y[i]);
          view.fx.puff(b.cx, maxY, 4, TIERS[tier].r * 1.4);
        }
        break;
      }
      case 'merge':
        onMerge(e);
        break;
      case 'boop': {
        const b = BREEDS[TIERS[e.cat.tier].breed];
        audio.boop(b.voice.pitch);
        const h = view.painter.head(e.cat.body);
        view.fx.note(h.x + TIERS[e.cat.tier].r * 0.5, h.y - 6, '!');
        view.fx.sparkles(e.cat.body.cx, e.cat.body.cy, 4, TIERS[e.cat.tier].r * 0.8);
        break;
      }
      case 'over':
        gameOver();
        audio.seat(20);
        audio.duckMusic(0.5, 3);
        break;
      default:
        break;
    }
  }
}

function onMerge(e: Extract<JarEvent, { t: 'merge' }>): void {
  view.addGhosts(e.ghosts, game.frame);
  const fx = view.fx;
  if (e.tier >= LAST_TIER) {
    // two voids: they vanish in a starburst
    fx.starburst(e.x, e.y);
    fx.label(e.x, e.y - 50, `+${e.points}`, '#D9A62E', 20);
    view.flash = 1;
    audio.reveal();
    audio.seat(100);
    return;
  }
  const T = TIERS[e.tier + 1];
  const b = BREEDS[T.breed];
  const wild = e.ghosts.some((g) => g.tier === WILD);
  audio.glorp(b.voice.pitch, sizeOf(e.tier + 1), clamp(b.physics.viscosity / 26, 0, 1));
  audio.seat(wild || e.tier + 1 >= 5 ? 96 : e.tier + 1 >= 3 ? 75 : 50);
  fx.ring(e.x, e.y, T.r * 1.3);
  fx.sparkles(e.x, e.y, 5 + e.tier, T.r);
  fx.hearts(e.x, e.y - T.r * 0.6, e.tier >= 3 ? 3 : e.tier >= 1 ? 2 : 1, PALETTE.rose, T.r * 0.5);
  const color = e.tier >= 4 ? '#D9A62E' : e.tier >= 2 ? PALETTE.ginger : '#C98BA0';
  fx.label(e.x, e.y - T.r - 8, `+${e.points}`, color, 13 + Math.min(4, e.tier));
  if (e.chain > 1) fx.label(e.x, e.y - T.r - 8, `chain ×${Math.min(e.chain, CHAIN_MAX)}!`, '#B07AA8', 12);
  if (e.earned) fx.label(e.x, e.y - T.r - 8, '+1 boop', '#7FA877', 12);
  if (wild) fx.label(e.x, e.y - T.r - 8, 'one size up!', '#5B4E86', 12);
  // the first of a new kind this game: say hello (and, the first few games, what it does)
  if (e.tier + 1 > topTier) {
    introduced.add(e.tier + 1);
    fx.label(e.x, e.y - T.r - 8, gamesPlayed <= 3 || e.tier + 1 >= 4 ? `${T.name} · ${T.trait}!` : `${T.name}!`, '#6F8FB8', 13);
  }
  topTier = Math.max(topTier, e.tier + 1);
  if (e.cat && e.tier + 1 >= 3) setPurrCat(e.cat);
}

// The newest big cat purrs (ears wiggle; a soft purr, louder at first).
let purrSince = 0;

function setPurrCat(c: JarCat | null): void {
  const old = view.purrCat;
  if (old && old !== c) audio.setPurr(old.id, 0, BREEDS[TIERS[old.tier].breed].purr);
  view.purrCat = c;
  purrSince = game.frame;
}

function tickPurr(): void {
  const c = view.purrCat;
  if (!c) return;
  if (c.removed || !game.cats.includes(c)) {
    setPurrCat(null);
    return;
  }
  const age = game.frame - purrSince;
  const level = phase === 'play' ? (age < 180 ? 0.5 : 0.16) : 0;
  audio.setPurr(c.id, level, BREEDS[TIERS[c.tier].breed].purr);
}

// ---------------------------------------------------------------------------
// Loop

function step(): void {
  view.lerp.remember(game.cats.map((c) => c.body));
  if (keys.size && phase === 'play') {
    const dir = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
    game.aim(clamp(game.aimX, JAR.inL, JAR.inR) + dir * 3.2);
  }
  game.step();
  handle(game.drain());
}

/** Every dozing cat snores a little z now and then (they won't melt till they're woken). */
function tickSnores(dt: number): void {
  zTimer += dt;
  if (phase !== 'play') return;
  const period = 2.4;
  for (const c of game.cats) {
    if (!game.dozing(c)) continue;
    // each on its own beat
    const at = ((c.id * 0.37) % 1) * period;
    if (Math.floor((zTimer - at) / period) === Math.floor((zTimer - dt - at) / period)) continue;
    const h = view.painter.head(c.body);
    view.fx.add('note', h.x + TIERS[c.tier].r * 0.55, h.y - 2, { vy: -14, vx: 5, life: 1.8, size: 10 + TIERS[c.tier].r * 0.08, color: 'rgba(62,58,79,0.55)', text: 'z' });
  }
}

function draw(alpha: number, dt: number): void {
  view.follow(game, dt);
  view.draw(game, alpha, dt);
  ui.update(game, best, dt);
  tickPurr();
  tickSnores(dt);
  if (phase === 'over' && performance.now() - overAt > 1100 && !ui.endShown) {
    audio.stopAllPurrs();
    ui.showEnd(game, best, newBest);
  }
}

const loop = new Loop(step, draw);
attract();
loop.start();

// ---------------------------------------------------------------------------
// Test handle

const api = {
  game,
  view,
  loop,
  audio,
  /** Snapshot of the game for tests. */
  get state() {
    return {
      phase,
      mode: game.mode,
      score: game.score,
      best,
      boops: game.boops,
      over: game.over,
      danger: game.danger,
      frame: game.frame,
      waiting: game.waiting ? game.waiting.tier : -1,
      next: game.queue.slice(0, 3),
      cats: game.cats.map((c) => {
        c.body.computeCentroid();
        return { id: c.id, tier: c.tier, breed: TIERS[c.tier].breed, x: +c.body.cx.toFixed(1), y: +c.body.cy.toFixed(1), top: +JarGame.top(c.body).toFixed(1), asleep: c.body.asleep };
      }),
    };
  },
  /** Aim at world x and drop the waiting cat now (skips the reload wait). */
  drop(x?: number): boolean {
    game.reload();
    if (x !== undefined) game.aimNow(x);
    return game.drop();
  },
  /** Advance n physics frames synchronously. */
  step(n = 1): void {
    for (let i = 0; i < n; i++) step();
  },
  /** Start a new game ('play' or 'daily', optionally seeded), skipping the start card. */
  restart(mode: Mode = 'play', seed?: number): void {
    startGame(mode, seed);
  },
  /** Force the upcoming drops (tiers 0..6). */
  queue(tiers: number[]): void {
    game.setQueue(tiers);
  },
  /** Boop the cat with this id. */
  boop(id: number): boolean {
    const c = game.cats.find((k) => k.id === id);
    if (!c) return false;
    c.body.computeCentroid();
    return game.boop(c, c.body.cx - 5);
  },
  /** Put a cat of a tier anywhere (tests). */
  place(tier: number, x: number, y: number): number {
    return game.place(tier, x, y).id;
  },
  /** Draw one frame now (for captures while the loop is paused). */
  render(dt = 1 / 60): void {
    draw(1, dt);
  },
};

(window as unknown as { __jar: typeof api }).__jar = api;
