// Sound and music, on or off: shared by the house and both games. Kept where
// the page has always kept them, so they carry over from older visits.

import type { Settings } from './proto/shell';

const KEY = 'if-it-fits:save:v1';

export function loadSettings(): Settings {
  const s: Settings = { sfx: true, music: true };
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { settings?: Partial<Settings> };
    if (typeof d.settings?.sfx === 'boolean') s.sfx = d.settings.sfx;
    if (typeof d.settings?.music === 'boolean') s.music = d.settings.music;
  } catch {
    // storage blocked or garbled: both on
  }
  return s;
}

export function writeSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, settings: s }));
  } catch {
    // private mode: they just won't be remembered
  }
}
