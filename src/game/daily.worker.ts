// Builds and solver-checks the morning's room off the main thread.
import { dailyRoom } from './generator';

self.onmessage = (e: MessageEvent<{ dateKey: string }>) => {
  const room = dailyRoom(e.data.dateKey);
  (self as unknown as Worker).postMessage({ dateKey: e.data.dateKey, room });
};
