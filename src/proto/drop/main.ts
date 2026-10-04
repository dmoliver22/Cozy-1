// Cat Drop: an endless squishy fall through a cozy house. Drag to steer, tap
// to bounce, eat fish to grow (more points, slower squeezes) and stay ahead of
// bath time. This file wires the simulation (game.ts) to the screen
// (view.ts), the HUD (ui.ts), input and sound, and exposes `window.__drop`.
import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/latin-800.css';
import '@fontsource/nunito/latin-700.css';
import '../proto.css';
import './drop.css';
import { AudioEngine, type ImpactMaterial } from '../../audio/audio';
import { BREEDS, type BreedId } from '../../physics/breeds';
import { Loop, bindPointer, loadBest, makeStage, saveBest, todaySeed, unlockAudioOnGesture } from '../kit';
import { DropGame, type DropState, type GameEvent } from './game';
import { DropSfx } from './sfx';
import { Suds } from './suds';
import { BREED_CHOICES, DropUi } from './ui';
import { DropView } from './view';

const BEST_KEY = 'catdrop.best';
const PREF_KEY = 'catdrop.prefs';

interface Prefs {
  breed: BreedId;
  music: boolean;
  sound: boolean;
}

function loadPrefs(): Prefs {
  const def: Prefs = { breed: 'tabby', music: true, sound: true };
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<Prefs>;
    return { breed: BREED_CHOICES.includes(p.breed as BreedId) ? (p.breed as BreedId) : def.breed, music: p.music ?? def.music, sound: p.sound ?? def.sound };
  } catch {
    return def;
  }
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // private mode
  }
}

const prefs = loadPrefs();
const audio = new AudioEngine();
const sfx = new DropSfx();
unlockAudioOnGesture(audio);
const unlockSfx = (): void => sfx.unlock();
window.addEventListener('pointerdown', unlockSfx, { capture: true });
window.addEventListener('keydown', unlockSfx, { capture: true });
audio.setSfxEnabled(prefs.sound);
sfx.setEnabled(prefs.sound);
audio.setMusicEnabled(prefs.music);
if (prefs.music) audio.startMusic();

let viewRef: DropView | null = null;
const stage = makeStage(document.getElementById('game') as HTMLCanvasElement, () => viewRef?.layout());
const v = new DropView(stage);
viewRef = v;
v.suds.onPop = () => sfx.pop();

let daily = false;
let seed = randomSeed();
let game = new DropGame(seed, prefs.breed);
v.reset(game);
let overAt = -1;

function randomSeed(): number {
  return (Math.random() * 2 ** 31) >>> 0;
}

function bestKey(): string {
  return daily ? `${BEST_KEY}.daily.${seed}` : BEST_KEY;
}

const ui = new DropUi(
  document.getElementById('ui') as HTMLElement,
  {
    play(breed, isDaily) {
      prefs.breed = breed;
      savePrefs(prefs);
      daily = isDaily;
      newRun(isDaily ? todaySeed() : randomSeed(), breed);
      begin();
    },
    again() {
      newRun(daily ? todaySeed() : randomSeed(), game.breed);
      begin();
    },
    menu() {
      newRun(randomSeed(), game.breed);
      ui.showStart(loadBest(BEST_KEY));
    },
    toggleMusic() {
      prefs.music = !prefs.music;
      savePrefs(prefs);
      audio.setMusicEnabled(prefs.music);
      if (prefs.music) audio.startMusic();
      return prefs.music;
    },
    toggleSound() {
      prefs.sound = !prefs.sound;
      savePrefs(prefs);
      audio.setSfxEnabled(prefs.sound);
      sfx.setEnabled(prefs.sound);
      return prefs.sound;
    },
  },
  prefs.breed,
  prefs.music,
  prefs.sound,
);
ui.showStart(loadBest(BEST_KEY));
ui.setBest(loadBest(BEST_KEY), false);

function newRun(s: number, breed: BreedId): void {
  seed = s;
  audio.stopAllPurrs();
  game = new DropGame(seed, breed);
  v.reset(game);
  overAt = -1;
  steerKeys = 0;
  ui.setBest(loadBest(bestKey()), daily);
}

function begin(): void {
  ui.hideCards();
  game.start();
  handleEvents();
}

// --- Input ---------------------------------------------------------------------

let pointerX: number | null = null;
let steerKeys = 0;

function applySteer(): void {
  if (steerKeys !== 0) {
    game.cat.computeCentroid();
    game.steer(game.cat.cx + steerKeys * 400);
  } else game.steer(pointerX === null ? null : v.screenToWorldX(pointerX));
}

bindPointer(stage.canvas, {
  down(x) {
    if (ui.cardShown) return;
    pointerX = x;
    applySteer();
  },
  move(x) {
    if (pointerX === null) return;
    pointerX = x;
    applySteer();
  },
  up(_x, _y, info) {
    if (pointerX === null) return;
    pointerX = null;
    applySteer();
    if (info.tap) {
      // a tap hops a little toward the side it was on
      game.cat.computeCentroid();
      game.steer(v.screenToWorldX(_x));
      game.bounce();
      game.steer(null);
      handleEvents();
    }
  },
});

const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.add('L');
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.add('R');
  else if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
    e.preventDefault();
    if (ui.cardShown) return;
    game.bounce();
    handleEvents();
    return;
  } else if (e.key === 'Enter' && ui.cardShown) {
    e.preventDefault();
    // press the showing card's main button
    const id = game.phase === 'over' ? 'dAgain' : 'dPlay';
    (document.getElementById(id) as HTMLButtonElement | null)?.click();
    return;
  } else return;
  steerKeys = (keys.has('R') ? 1 : 0) - (keys.has('L') ? 1 : 0);
  applySteer();
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.delete('L');
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.delete('R');
  else return;
  steerKeys = (keys.has('R') ? 1 : 0) - (keys.has('L') ? 1 : 0);
  applySteer();
});

// --- Events: sounds and effects ---------------------------------------------------

function sizeOf(): number {
  return Math.max(0, Math.min(1, (game.cat.p.radius - 20) / 40));
}

function voice(): number {
  const b = BREEDS[game.breed];
  return b.voice.pitch * (1.1 - sizeOf() * 0.25);
}

function handleEvents(): void {
  const evs: GameEvent[] = game.events;
  game.events = [];
  const c = game.cat;
  for (const e of evs) {
    switch (e.t) {
      case 'start':
        audio.boop(voice());
        audio.stopAllPurrs();
        break;
      case 'hop': {
        audio.boop(voice() * (e.air ? 1.15 : 1));
        c.computeCentroid();
        if (!e.air) v.fx.puff(c.cx, c.cy + c.p.radius * 0.9, 5);
        else v.fx.ring(c.cx, c.cy + c.p.radius, '#FFF8EE', c.p.radius * 1.4);
        break;
      }
      case 'boing':
        sfx.boing(e.speed);
        audio.impact('fabric', Math.max(160, e.speed), sizeOf());
        v.fx.puff(e.x, e.y, 6);
        v.shake = Math.min(1.5, 0.4 + e.speed / 900);
        break;
      case 'thump':
        audio.impact(e.material as ImpactMaterial, e.speed, sizeOf());
        if (e.speed > 500) {
          v.shake = Math.min(1.6, e.speed / 700);
          c.computeCentroid();
          v.fx.puff(c.cx, c.cy + c.p.radius, 4);
        }
        break;
      case 'nom': {
        sfx.nom(e.golden, sizeOf());
        audio.seat(e.golden ? 96 : 45);
        const h = v.head(game);
        v.fx.sparks(e.x, e.y, e.golden ? 12 : 7, e.golden ? '#FFE9A8' : '#FFF8EE');
        v.fx.labelOn(() => v.head(game), `+${e.points}`, e.golden ? '#E3A72F' : '#E8964A', c.p.radius * 0.7 + 8);
        if (e.golden) v.fx.hearts(h.x, h.y - 10, 3, '#F2C14E');
        break;
      }
      case 'squeeze':
        audio.glorp(1.25 - sizeOf() * 0.35, 0.3 + sizeOf() * 0.3, Math.min(1, BREEDS[game.breed].physics.viscosity / 26));
        break;
      case 'plop':
        audio.glorp(0.85 - sizeOf() * 0.25, 0.6 + sizeOf() * 0.4, Math.min(1, BREEDS[game.breed].physics.viscosity / 26));
        v.fx.drops(e.x, e.y + 6, 7, 'rgba(207,227,242,0.9)');
        v.fx.puff(e.x, e.y + 8, 5);
        break;
      case 'storey':
        ui.room(e.name);
        break;
      case 'nudge':
        audio.boop(voice() * 0.9);
        break;
      case 'rescue':
        audio.boop(voice() * 1.2);
        v.fx.puff(e.x, e.y, 8);
        v.fx.sparks(e.x, e.y, 6);
        break;
      case 'soak':
        audio.stopAllPurrs();
        audio.duckMusic(0.6, 2.5);
        break;
      case 'sploosh':
        sfx.sploosh();
        break;
      case 'sneeze': {
        sfx.sneeze(voice());
        // a puff of tiny bubbles out of the nose
        const f = v.painter.view(c);
        const ny = f.fy + 4 * f.fs;
        v.suds.puff(f.fx, ny, 7, 1.6, 4, 0, -50, 120);
        v.fx.puff(f.fx, ny + 2, 4);
        break;
      }
      case 'over':
        overAt = performance.now();
        break;
    }
  }
}

// --- Loop --------------------------------------------------------------------------

const loop = new Loop(
  () => {
    v.beforeStep(game);
    game.step();
    v.afterStep(game);
    handleEvents();
  },
  (alpha, dt) => {
    v.render(game, alpha, dt);
    const s = game.state();
    ui.update(s, game.foamY > v.camY + 30);
    // bath time's patter and bloops, louder as it comes (quieter once it has the cat)
    const near = game.phase === 'play' ? (game.time > 1 ? v.nearness(game) : 0) : game.phase === 'soak' ? 0.7 : game.phase === 'over' ? 0.2 : 0;
    sfx.bath(near, dt);
    // purring on the perch before the run
    if (game.phase === 'ready' && !ui.cardShown) audio.setPurr(1, 0.5, BREEDS[game.breed].purr);
    else if (game.phase === 'ready') audio.setPurr(1, 0.35, BREEDS[game.breed].purr);
    // game over: the card, a moment after the bath
    if (overAt > 0 && performance.now() - overAt > 650) {
      overAt = -1;
      finish(s);
    }
  },
);
loop.start();

/**
 * While the start card is up, run the bubble simulation through a throwaway
 * bath (a few steps at a time), so the first real foam and the first catch
 * don't stutter while the browser compiles it.
 */
function warmFoam(): void {
  const g = new DropGame(4242, prefs.breed);
  const s = new Suds();
  s.reset(g);
  g.start();
  let f = 0;
  const chunk = (): void => {
    if (game.phase !== 'ready') return;
    for (let k = 0; k < 8 && f < 240 && g.phase !== 'over'; k++, f++) {
      if (f === 30) g.foamY = g.catTop() - 60;
      g.step();
      g.events.length = 0;
      s.step(g, g.cat.cy - 300, 860);
    }
    if (f < 240 && g.phase !== 'over') window.setTimeout(chunk, 30);
  };
  window.setTimeout(chunk, 500);
}
warmFoam();

function finish(s: DropState): void {
  const key = bestKey();
  const prev = loadBest(key);
  const isBest = s.score > prev;
  if (isBest) saveBest(key, s.score);
  if (!daily && s.score > loadBest(BEST_KEY)) saveBest(BEST_KEY, s.score);
  ui.showOver(s, Math.max(prev, s.score), isBest && s.score > 0);
  ui.setBest(loadBest(key), daily);
}

// --- Test & debug handle ---------------------------------------------------------------

const handle = {
  /** Depth (m), fish, score, radius, bath gap, game over... */
  get state(): DropState {
    return game.state();
  },
  /** Steer toward a world x (0..380), or stop steering with null. */
  steer(x: number | null): void {
    game.steer(x);
  },
  /** A tap: hop (or start the run from the perch). */
  bounce(): boolean {
    const ok = game.bounce();
    handleEvents();
    return ok;
  },
  /** Advance n physics frames synchronously (pause the loop first for determinism). */
  step(n = 1): DropState {
    for (let i = 0; i < n; i++) {
      v.beforeStep(game);
      game.step();
      v.afterStep(game);
      handleEvents();
    }
    return game.state();
  },
  /** A fresh run (optionally seeded / another breed), already falling. */
  restart(s?: number, breed?: BreedId): DropState {
    daily = false;
    newRun(s ?? randomSeed(), breed ?? game.breed);
    begin();
    return game.state();
  },
  /** Stop or resume the real-time loop. */
  pause(on = true): void {
    loop.paused = on;
  },
  /** Put a fish just below the cat (for tests). */
  feed(golden = false): void {
    const c = game.cat;
    c.computeCentroid();
    const ch = game.chunksIn(c.cy, c.cy)[0] ?? game.level.chunks[0];
    ch.fish.push({ x: c.cx, y: c.cy + c.p.radius + 14, hx: c.cx, hy: c.cy + c.p.radius + 14, golden, eaten: false, phase: 0, dir: 1 });
  },
  /** Draw one frame now (for captures while paused). */
  render(dt = 1 / 60): void {
    v.render(game, 1, dt);
  },
  /** Move bath time's foam to `gap` units above the cat (for tests and captures). */
  bathTo(gap: number): void {
    game.foamY = game.catTop() - gap;
  },
  /** Debug (captures): hold bath time's edge at a world y (null: let it chase again). */
  foamTo(y: number | null): void {
    game.foamHold = y;
  },
  /** The same as bathTo (from when the chaser was a vacuum). */
  vacuumTo(gap: number): void {
    game.foamY = game.catTop() - gap;
  },
  get game(): DropGame {
    return game;
  },
  get view(): DropView {
    return v;
  },
  /** Debug: hold the camera's top at a world y (null to follow the cat again). */
  lookAt(y: number | null): void {
    v.lookAt = y;
  },
  /** Debug: chunks of the house so far (kind and world y range). */
  chunks(): { kind: string; y0: number; y1: number; storey: number }[] {
    return game.level.chunks.map((c) => ({ kind: c.kind, y0: c.y0, y1: c.y1, storey: c.storey }));
  },
  /** Debug: start logging cache paint task times (ms); returns the log. */
  logTasks(): { times: number[]; names: string[] } {
    DropView.taskLog = [];
    DropView.taskNames = [];
    return { times: DropView.taskLog, names: DropView.taskNames };
  },
};
(window as unknown as { __drop: typeof handle }).__drop = handle;
