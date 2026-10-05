// How a prototype game (Cat Jar, Cat Drop) sits in the house: it's mounted
// into an element and unmounted again, shares the house's sound engine and
// settings, has a way back home, and tells the house how each run went (cats
// move in as you play). On a page of its own it gets a standalone shell with
// its own sound and settings instead.

import { AudioEngine } from '../audio/audio';
import type { BreedId } from '../physics/breeds';
import { unlockAudioOnGesture } from './kit';

/** How a run went, for the house (milestones: cats moving in). */
export type RunReport =
  | { game: 'jar'; daily: boolean; score: number; biggest: number; drops: number; over: boolean }
  | { game: 'drop'; daily: boolean; score: number; depth: number; fish: number; breed: BreedId; over: boolean };

export interface Settings {
  sfx: boolean;
  music: boolean;
}

export interface ProtoShell {
  /** The sound engine (shared by every game in the house). */
  audio: AudioEngine;
  /** Sound and music on or off (shared too). */
  readonly settings: Readonly<Settings>;
  setSetting(k: keyof Settings, on: boolean): void;
  /** Back to the home room (absent when the game has a page of its own). */
  home?: () => void;
  /**
   * Tell the house how a run went (\`over\`), or how it's going: a cat can
   * earn their place half way through a run, and the house says so at once.
   */
  report?: (r: RunReport) => void;
}

/** A game on screen. */
export interface Mounted {
  /** Stop it and take it off the page (listeners, styles, sound and all). */
  unmount(): void;
}

/** Put a game's stylesheet on the page while it's on screen; returns its remover. */
export function attachStyles(css: string, id: string): () => void {
  const el = document.createElement('style');
  el.dataset.styles = id;
  el.textContent = css;
  document.head.appendChild(el);
  return () => el.remove();
}

/** A shell for a game on a page of its own: its own sound, its settings kept under `key`. */
export function standaloneShell(key: string): ProtoShell {
  const audio = new AudioEngine();
  unlockAudioOnGesture(audio);
  const settings: Settings = { sfx: true, music: true };
  try {
    Object.assign(settings, JSON.parse(localStorage.getItem(`${key}.settings`) ?? '{}') as Partial<Settings>);
  } catch {
    // storage blocked: defaults
  }
  audio.setSfxEnabled(settings.sfx);
  audio.setMusicEnabled(settings.music);
  return {
    audio,
    settings,
    setSetting(k, on) {
      settings[k] = on;
      if (k === 'sfx') audio.setSfxEnabled(on);
      else audio.setMusicEnabled(on);
      try {
        localStorage.setItem(`${key}.settings`, JSON.stringify(settings));
      } catch {
        // fine
      }
    },
  };
}
