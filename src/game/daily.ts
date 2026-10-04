// Getting today's room: cached, else built in a worker, else on the main thread.

import DailyWorker from './daily.worker?worker&inline';
import { GENERATOR_VERSION, dailyRoom } from './generator';
import type { RoomDef } from './room';

const cacheKey = (dateKey: string): string => `if-it-fits:daily:v${GENERATOR_VERSION}:${dateKey}`;

function readCache(dateKey: string): RoomDef | null {
  try {
    const raw = localStorage.getItem(cacheKey(dateKey));
    return raw ? (JSON.parse(raw) as RoomDef) : null;
  } catch {
    return null;
  }
}

function writeCache(dateKey: string, room: RoomDef): void {
  try {
    // keep the cache small: drop other days
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('if-it-fits:daily:') && k !== cacheKey(dateKey)) localStorage.removeItem(k);
    }
    localStorage.setItem(cacheKey(dateKey), JSON.stringify(room));
  } catch {
    // ignore
  }
}

export async function getDailyRoom(dateKey: string): Promise<RoomDef> {
  const cached = readCache(dateKey);
  if (cached) return cached;
  let room: RoomDef | null = null;
  try {
    room = await new Promise<RoomDef>((resolve, reject) => {
      const w = new DailyWorker();
      const timer = setTimeout(() => {
        w.terminate();
        reject(new Error('timeout'));
      }, 30000);
      w.onmessage = (e: MessageEvent<{ room: RoomDef }>) => {
        clearTimeout(timer);
        w.terminate();
        resolve(e.data.room);
      };
      w.onerror = (err) => {
        clearTimeout(timer);
        w.terminate();
        reject(err);
      };
      w.postMessage({ dateKey });
    });
  } catch {
    // Workers unavailable (or blocked): build it here, after letting a frame paint.
    await new Promise((r) => setTimeout(r, 30));
    room = dailyRoom(dateKey);
  }
  writeCache(dateKey, room);
  return room;
}
