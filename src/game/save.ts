// Local progress: settings, collection, finished rooms, daily results, streak.

import { BASE_BREEDS, BREED_ORDER, type BreedId } from '../physics/breeds';
import { previousDateKey } from '../util/date';

export interface DailyRecord {
  cozy: number;
  paws: number;
  par: number;
  faces: string;
  name: string;
  number: number;
}

export interface SaveData {
  v: 1;
  tutorialDone: boolean;
  settings: { sfx: boolean; music: boolean };
  collection: Partial<Record<BreedId, { seated: number; best: number }>>;
  rooms: Record<string, { best: number; paws: number }>;
  daily: Record<string, DailyRecord>;
  streak: { count: number; last: string };
  voidUnlocked: boolean;
}

const KEY = 'if-it-fits:save:v1';

export function emptySave(): SaveData {
  return {
    v: 1,
    tutorialDone: false,
    settings: { sfx: true, music: true },
    collection: {},
    rooms: {},
    daily: {},
    streak: { count: 0, last: '' },
    voidUnlocked: false,
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptySave();
    const data = JSON.parse(raw) as Partial<SaveData>;
    return { ...emptySave(), ...data, settings: { ...emptySave().settings, ...(data.settings ?? {}) } };
  } catch {
    return emptySave();
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage may be unavailable (private mode); progress just won't persist
  }
}

/** Record seated cats; returns breeds collected for the first time. */
export function recordSeats(data: SaveData, seats: Array<{ breed: BreedId; score: number }>): BreedId[] {
  const fresh: BreedId[] = [];
  for (const s of seats) {
    const prev = data.collection[s.breed];
    if (!prev) fresh.push(s.breed);
    data.collection[s.breed] = { seated: (prev?.seated ?? 0) + 1, best: Math.max(prev?.best ?? 0, s.score) };
  }
  if (!data.voidUnlocked && (BASE_BREEDS.every((b) => data.collection[b]) || data.collection.void)) {
    data.voidUnlocked = true;
  }
  return fresh;
}

export function recordDaily(data: SaveData, dateKey: string, rec: DailyRecord): void {
  const first = !data.daily[dateKey];
  if (first || rec.cozy > data.daily[dateKey].cozy) data.daily[dateKey] = rec;
  if (first) {
    if (data.streak.last === previousDateKey(dateKey)) data.streak.count += 1;
    else if (data.streak.last !== dateKey) data.streak.count = 1;
    data.streak.last = dateKey;
  }
}

export function collectedCount(data: SaveData): number {
  return BREED_ORDER.filter((b) => data.collection[b]).length;
}
