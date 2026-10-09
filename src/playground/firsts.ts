// Treats up in the clouds: the first time a cat does each thing up there in
// your own Playground (a cannon shot, a ride through a tube, the wind off a
// fan...) is worth a few treats, once each. The challenges pay theirs too
// (challenges.ts); the tour pays nothing (it's before there's a house).

export const FIRSTS_KEY = 'cozy-firsts:v1';

/** Treats for each first. */
export const FIRST_TREATS = 5;

export type FirstKind = 'cannon' | 'tube' | 'funnel' | 'fan' | 'bumper' | 'belt' | 'bounce' | 'hammock';

export const FIRSTS: Record<FirstKind, string> = {
  cannon: 'First cannon shot!',
  tube: 'First ride through a tube!',
  funnel: 'First cat down a funnel!',
  fan: 'First cat on the wind!',
  bumper: 'First ding off a bumper!',
  belt: 'First ride on a belt!',
  bounce: 'First boing!',
  hammock: 'First nap in a hammock!',
};

export class Firsts {
  private done: Set<string>;

  constructor() {
    this.done = new Set();
    try {
      const raw = JSON.parse(localStorage.getItem(FIRSTS_KEY) ?? '[]');
      if (Array.isArray(raw)) for (const k of raw) if (typeof k === 'string') this.done.add(k);
    } catch {
      // (none yet)
    }
  }

  has(k: FirstKind): boolean {
    return this.done.has(k);
  }

  /** Done for the first time? (Then it's done: true only once ever.) */
  claim(k: FirstKind): boolean {
    if (this.done.has(k)) return false;
    this.done.add(k);
    try {
      localStorage.setItem(FIRSTS_KEY, JSON.stringify([...this.done]));
    } catch {
      // (private browsing: only for now)
    }
    return true;
  }
}
