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
import { CHAIN_MAX, CX, JAR, LAST_TIER, TIERS } from './config';
import { JarGame, type JarCat, type JarEvent, type Mode } from './game';
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
  best = loadBest(bestKey(game));
  newBest = false;
  topTier = 0;
  phase = 'play';
  ui.hideCards();
  audio.stopAllPurrs();
  if (musicOn) audio.startMusic();
}

/** The start screen: a few cats tumble into the jar behind the card. */
function attract(): void {
  game.restart('play', 20261004);
  view.reset();
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

let aiming = false;

bindPointer(canvas, {
  down(x, y) {
    if (phase !== 'play') return;
    aiming = true;
    game.aim(view.toWorld(x, y).x);
  },
  move(x, y) {
    if (phase !== 'play' || !aiming) return;
    game.aim(view.toWorld(x, y).x);
  },
  up(x, y, info) {
    if (phase !== 'play') return;
    aiming = false;
    const w = view.toWorld(x, y);
    // a tap on a cat in the jar boops it (out of boops: the paws say so)
    if (info.tap) {
      const cat = game.catAt(w.x, w.y);
      if (cat) {
        if (!game.boop(cat, w.x)) ui.noBoops();
        return;
      }
    }
    game.aim(w.x);
    game.drop();
  },
});

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (phase !== 'play') return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    keys.add(e.key);
    e.preventDefault();
  } else if ((e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') && !e.repeat) {
    game.drop();
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

// ---------------------------------------------------------------------------
// Sounds and effects for what happened

const sizeOf = (tier: number): number => clamp(tier / LAST_TIER, 0, 1);

function handle(events: JarEvent[]): void {
  for (const e of events) {
    switch (e.t) {
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
  audio.glorp(b.voice.pitch, sizeOf(e.tier + 1), clamp(b.physics.viscosity / 26, 0, 1));
  audio.seat(e.tier + 1 >= 5 ? 96 : e.tier + 1 >= 3 ? 75 : 50);
  fx.ring(e.x, e.y, T.r * 1.3);
  fx.sparkles(e.x, e.y, 5 + e.tier, T.r);
  fx.hearts(e.x, e.y - T.r * 0.6, e.tier >= 3 ? 3 : e.tier >= 1 ? 2 : 1, PALETTE.rose, T.r * 0.5);
  const color = e.tier >= 4 ? '#D9A62E' : e.tier >= 2 ? PALETTE.ginger : '#C98BA0';
  fx.label(e.x, e.y - T.r - 8, `+${e.points}`, color, 13 + Math.min(4, e.tier));
  if (e.chain > 1) fx.label(e.x, e.y - T.r - 8, `chain ×${Math.min(e.chain, CHAIN_MAX)}!`, '#B07AA8', 12);
  if (e.earned) fx.label(e.x, e.y - T.r - 8, '+1 boop', '#7FA877', 12);
  // the first of a new kind this game: say hello
  if (e.tier + 1 > topTier) fx.label(e.x, e.y - T.r - 8, `${T.name}!`, '#6F8FB8', 13);
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

/** Now and then a long-sleeping cat snores a little z. */
function tickSnores(dt: number): void {
  zTimer += dt;
  if (zTimer < 1.7 || phase !== 'play') return;
  zTimer = 0;
  const sleepers = game.cats.filter((c) => c.body.asleep && c.rest > 600);
  if (!sleepers.length) return;
  const c = sleepers[Math.floor(Math.random() * sleepers.length)];
  const h = view.painter.head(c.body);
  view.fx.add('note', h.x + TIERS[c.tier].r * 0.55, h.y - 2, { vy: -14, vx: 5, life: 1.8, size: 12, color: 'rgba(62,58,79,0.55)', text: 'z' });
}

function draw(alpha: number, dt: number): void {
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
