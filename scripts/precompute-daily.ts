// Runs the daily generator + solver ahead of time and writes a tiny index so
// mornings load instantly. Same code the browser runs, just earlier.
// Usage: npx rolldown scripts/precompute-daily.ts --file /tmp/pre.mjs --format esm --platform node && node /tmp/pre.mjs [days]
import { writeFileSync } from 'node:fs';
import { GENERATOR_VERSION, dailyRoom } from '../src/game/generator';
import { nextDateKey } from '../src/util/date';

const START = '2026-10-01';
const days = Number(process.argv[2] ?? 200);
const out: Record<string, unknown[]> = {};
let key = START;
const t0 = Date.now();
for (let i = 0; i < days; i++) {
  const room = dailyRoom(key);
  const plan = (room.plan ?? []).map((p) => [p.cat, p.container, Math.round(p.gx), Math.round(p.gy), Math.round(p.tx), Math.round(p.ty), p.hold, p.kind === 'boop' ? 1 : 0, p.wx === undefined ? null : Math.round(p.wx), p.wy === undefined ? null : Math.round(p.wy)]);
  out[key] = [room.variant ?? -1, room.par ?? 0, plan];
  if (i % 20 === 0) console.log(key, room.name, `variant ${room.variant}`, `par ${room.par}`, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  key = nextDateKey(key);
}
writeFileSync('src/game/daily-index.json', JSON.stringify({ v: GENERATOR_VERSION, days: out }));
console.log(`wrote ${days} mornings in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
