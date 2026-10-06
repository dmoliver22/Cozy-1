// Cat Drop: an endless squishy fall through a cozy house. Drag to steer, tap
// to bounce, eat fish to grow (more points, slower squeezes) and stay ahead of
// bath time; when it catches the cat, its foam fills the screen and the run
// ends in the bath. mountDrop wires the simulation (game.ts) to the screen
// (view.ts), the HUD (ui.ts), input and sound inside an element, and exposes
// `window.__drop`. It runs in the house (shared sound, a way home, run
// reports) or on a page of its own (main.ts).

import protoCss from '../proto.css?inline';
import dropCss from './drop.css?inline';
import type { ImpactMaterial } from '../../audio/audio';
import { BREEDS, type BreedId } from '../../physics/breeds';
import { Listeners, Loop, bindPointer, loadBest, saveBest, makeStage, todaySeed } from '../kit';
import { attachStyles, type Mounted, type ProtoShell } from '../shell';
import { BathScene } from './bath';
import { DropGame, SOAK, type DropState, type GameEvent } from './game';
import { DropSfx } from './sfx';
import { Suds } from './suds';
import { BREED_CHOICES, DropUi } from './ui';
import { DropView, type EndStage } from './view';

const BEST_KEY = 'catdrop.best';
const PREF_KEY = 'catdrop.prefs';

/** The cat you last played with (sound and music belong to the shell). */
interface Prefs {
  breed: BreedId;
}

function loadPrefs(): Prefs {
  const def: Prefs = { breed: 'tabby' };
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<Prefs>;
    return { breed: BREED_CHOICES.includes(p.breed as BreedId) ? (p.breed as BreedId) : def.breed };
  } catch {
    return def;
  }
}

/** Bath time's sounds have their own little audio graph, made once and kept across visits. */
let sharedSfx: DropSfx | null = null;

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // private mode
  }
}

/** Start Cat Drop inside `host` (its start card first). */
export function mountDrop(host: HTMLElement, shell: ProtoShell): Mounted {
  const removeStyles = attachStyles(protoCss + dropCss, 'drop');
  host.innerHTML = '<canvas class="proto-stage" aria-label="Cat Drop"></canvas><div class="proto-ui"></div>';
  const listeners = new Listeners();
  let disposed = false;
  const prefs = loadPrefs();
  const audio = shell.audio;
  sharedSfx ??= new DropSfx();
  const sfx = sharedSfx;
  const unlockSfx = (): void => sfx.unlock();
  listeners.on(window, 'pointerdown', unlockSfx, { capture: true });
  listeners.on(window, 'keydown', unlockSfx, { capture: true });
  sfx.setEnabled(shell.settings.sfx);
  audio.startMusic();

  let viewRef: DropView | null = null;
  const stage = makeStage(host.querySelector('canvas') as HTMLCanvasElement, () => viewRef?.layout());
  const v = new DropView(stage);
  viewRef = v;
  v.suds.onPop = () => sfx.pop();

  let daily = false;
  let seed = randomSeed();
  let game = new DropGame(seed, prefs.breed);
  v.reset(game);
  /** The frame the run ended on (-1: still going), and whether its card is up. */
  let overFrame = -1;
  let finished = false;
  /** What the house was last told about this run. */
  let told = { depth: 0, fish: 0 };
  /** This run, for the house (its reports come as it goes). */
  let runId = '';

  function randomSeed(): number {
    return (Math.random() * 2 ** 31) >>> 0;
  }

  function bestKey(): string {
    return daily ? `${BEST_KEY}.daily.${seed}` : BEST_KEY;
  }

  const ui = new DropUi(
    host.querySelector('.proto-ui') as HTMLElement,
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
        shell.setSetting('music', !shell.settings.music);
        return shell.settings.music;
      },
      toggleSound() {
        shell.setSetting('sfx', !shell.settings.sfx);
        sfx.setEnabled(shell.settings.sfx);
        return shell.settings.sfx;
      },
      home: shell.home
        ? () => {
            audio.click();
            shell.home?.();
          }
        : undefined,
    },
    prefs.breed,
    shell.settings.music,
    shell.settings.sfx,
  );
  ui.showStart(loadBest(BEST_KEY));
  ui.setBest(loadBest(BEST_KEY), false);

  function newRun(s: number, breed: BreedId): void {
    seed = s;
    audio.stopAllPurrs();
    game = new DropGame(seed, breed);
    v.reset(game);
    overFrame = -1;
    finished = false;
    told = { depth: 0, fish: 0 };
    runId = `drop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
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
  listeners.on(window, 'keydown', (e) => {
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
      (host.querySelector(`#${id}`) as HTMLButtonElement | null)?.click();
      return;
    } else return;
    steerKeys = (keys.has('R') ? 1 : 0) - (keys.has('L') ? 1 : 0);
    applySteer();
  });
  listeners.on(window, 'keyup', (e) => {
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
        case 'boost':
          // into a slide: whee
          sfx.slide(e.secs);
          audio.glorp(1.3 - sizeOf() * 0.3, 0.4 + sizeOf() * 0.3, 0.2);
          v.fx.sparks(e.x, e.y, 9, '#FFE9A8');
          break;
        case 'boostOut':
          audio.glorp(0.9 - sizeOf() * 0.25, 0.6 + sizeOf() * 0.4, 0.2);
          v.fx.puff(e.x, e.y + 8, 6);
          v.fx.ring(e.x, e.y + 6, '#FFF8EE', c.p.radius * 1.5);
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
          // the foam has the cat, and pours on down to fill the screen
          audio.stopAllPurrs();
          audio.duckMusic(0.6, 5);
          sfx.fill(SOAK.end);
          break;
        case 'sploosh':
          sfx.sploosh();
          break;
        case 'over':
          overFrame = game.frame;
          break;
      }
    }
    // the bath at the end
    for (const e of v.bathEvents) {
      switch (e.t) {
        case 'clear':
          sfx.drain();
          break;
        case 'drop':
          audio.boop(voice() * 1.15);
          break;
        case 'splash':
          sfx.splash(Math.max(0, Math.min(1, (e.size - 20) / 36)), Math.min(1, e.speed / 800));
          audio.boop(voice() * 0.85);
          v.fx.puff(e.x, e.y - 10, 9);
          break;
        case 'ready':
          finish(game.state());
          break;
        case 'plink':
          sfx.plink(e.delay);
          break;
      }
    }
    v.bathEvents.length = 0;
    // (the card shows whatever happens, a while after the run ended)
    if (overFrame >= 0 && !finished && game.frame - overFrame > 480) finish(game.state());
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
      if (game.phase === 'play' && (s.fish > told.fish || s.depth >= told.depth + 10)) report(s, false);
      // bath time's patter and bloops, louder as it comes (then the bath's water lapping)
      const inBath = v.ending === 'bath';
      // (only while the chase is on: after the catch the fill, drain and bath have their own sounds)
      const near = game.phase === 'play' && game.time > 1 ? v.nearness(game) : 0;
      sfx.bath(near, dt);
      sfx.lap(inBath ? 1 : 0, dt);
      // purring on the perch before the run, and in the bath once it has settled in
      if (game.phase === 'ready' && !ui.cardShown) audio.setPurr(1, 0.5, BREEDS[game.breed].purr);
      else if (game.phase === 'ready') audio.setPurr(1, 0.35, BREEDS[game.breed].purr);
      else if (v.bath?.purring) audio.setPurr(1, 0.4, BREEDS[game.breed].purr);
    },
  );
  loop.start();

  /**
   * While the start card is up, run the bubble simulation through a throwaway
   * bath (a few steps at a time): the catch, the foam filling the screen and
   * clearing off it, and a cat dropping into the tub, so that the first real
   * ones don't stutter while the browser compiles them.
   */
  function warmFoam(): void {
    const g = new DropGame(4242, prefs.breed);
    const s = new Suds();
    s.reset(g);
    g.start();
    let bath: BathScene | null = null;
    let f = 0;
    const N = 420;
    const chunk = (): void => {
      if (disposed || game.phase !== 'ready') return;
      for (let k = 0; k < 8 && f < N; k++, f++) {
        const camY = g.cat.cy - 300;
        if (!bath) {
          if (f === 30) g.foamY = g.catTop() - 60;
          g.step();
          g.events.length = 0;
          s.step(g, camY, 860);
          if (g.phase === 'over' && s.cover(camY, 860) >= 0.999) {
            bath = new BathScene(g.breed, g.cat.p.radius, camY, 860, 1);
            s.beginClear(camY, 860, bath);
          }
        } else {
          bath.step();
          for (const e of bath.events) if (e.t === 'splash') s.splashAt(e.x, e.y, e.speed, e.size);
          bath.events.length = 0;
          s.stepEnd(bath.top, 860);
        }
      }
      if (f < N) window.setTimeout(chunk, 30);
    };
    window.setTimeout(chunk, 500);
  }
  warmFoam();

  /** Tell the house how the run is going (each 10 m and each fish), and how it went. */
  function report(s: DropState, over: boolean): void {
    told = { depth: s.depth, fish: s.fish };
    shell.report?.({ game: 'drop', daily, score: s.score, depth: s.depth, fish: s.fish, breed: game.breed, over, run: runId });
  }

  function finish(s: DropState): void {
    if (finished) return;
    finished = true;
    const key = bestKey();
    const prev = loadBest(key);
    const isBest = s.score > prev;
    if (isBest) saveBest(key, s.score);
    if (!daily && s.score > loadBest(BEST_KEY)) saveBest(BEST_KEY, s.score);
    report(s, true);
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
    /**
     * The end of the run: 'none' yet, the foam 'fill'ing the screen, or the
     * 'bath'; how much of the screen the foam covers (0..1); whether the cat is
     * in the bath, and whether the card is up.
     */
    get ending(): { stage: EndStage; cover: number; inBath: boolean; card: boolean } {
      return { stage: v.ending, cover: v.cover, inBath: (v.bath?.splashT ?? -1) >= 0, card: finished && ui.cardShown };
    },
    /** Jump to the end: bath time gets the cat now, and it plays out (synchronously) until the card is up. */
    endNow(): DropState {
      if (game.phase === 'ready') begin();
      for (let i = 0; i < 1200 && !finished; i++) {
        if (game.phase === 'play') game.foamY = game.catTop() - 20;
        v.beforeStep(game);
        game.step();
        v.afterStep(game);
        handleEvents();
      }
      return game.state();
    },
    /** Debug: start logging cache paint task times (ms); returns the log. */
    logTasks(): { times: number[]; names: string[] } {
      DropView.taskLog = [];
      DropView.taskNames = [];
      return { times: DropView.taskLog, names: DropView.taskNames };
    },
  };
  const w = window as unknown as { __drop?: typeof handle };
  w.__drop = handle;

  return {
    unmount() {
      disposed = true;
      loop.stop();
      stage.dispose();
      listeners.off();
      sfx.bath(0, 0);
      sfx.lap(0, 0);
      audio.stopAllPurrs();
      removeStyles();
      host.innerHTML = '';
      if (w.__drop === handle) delete w.__drop;
    },
  };
}
