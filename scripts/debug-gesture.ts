// Dev tool: run a gesture in a room headlessly and dump SVG frames to HTML.
// Build: npx rolldown scripts/debug-gesture.ts --file /tmp/dbg.mjs --format esm --platform node
import { writeFileSync } from 'node:fs';
import { HANDMADE } from '../src/game/rooms';
import { Session } from '../src/game/session';

const args = JSON.parse(process.argv[2] ?? '{}') as { room?: number; cat: number; tx: number; ty: number; wx?: number; wy?: number; move?: number; hold?: number; gx?: number; gy?: number; frames?: number[] };
const def = HANDMADE[args.room ?? 0];
const s = new Session(def);
const svg = (label: string): string => {
  let o = `<svg xmlns="http://www.w3.org/2000/svg" width="270" height="450" viewBox="0 0 360 600"><rect width="360" height="600" fill="#fdf6ea"/>`;
  for (const st of s.world.statics) {
    const pts = Array.from({ length: st.n }, (_, i) => `${st.xs[i]},${st.ys[i]}`).join(' ');
    o += `<polygon points="${pts}" fill="${st.container ? '#8fb3d9' : '#c9a27a'}" stroke="${st.container ? '#8fb3d9' : '#c9a27a'}" stroke-width="${st.radius * 2}" stroke-linejoin="round"/>`;
  }
  for (const c of s.cats) {
    const b = c.body;
    const pts = Array.from({ length: b.n }, (_, i) => `${b.x[i].toFixed(1)},${b.y[i].toFixed(1)}`).join(' ');
    o += `<polygon points="${pts}" fill="${b.breed.look.body}" stroke="${c.seat ? '#2a2' : '#3e3a4f'}" stroke-width="${c.seat ? 3 : 1}"/>`;
  }
  const g = s.cats[args.cat].body.grab;
  if (g) o += `<circle cx="${g.tx}" cy="${g.ty}" r="5" fill="red"/>`;
  return o + `<text x="6" y="16" font-size="14">${label}</text></svg>`;
};
const cat = s.cats[args.cat];
cat.body.computeCentroid();
const gx = cat.body.cx + (args.gx ?? 0);
const gy = cat.body.cy + (args.gy ?? 0);
const frames: string[] = [svg('start')];
const want = new Set(args.frames ?? [10, 20, 30, 45, 60, 90, 130, 200]);
s.beginGrab(cat, gx, gy);
let f = 0;
const legs: Array<[number, number, number, number, number]> = [];
const move = args.move ?? 30;
if (args.wx !== undefined) legs.push([gx, gy, args.wx, args.wy!, Math.round(move * 0.55)], [args.wx, args.wy!, args.tx, args.ty, move - Math.round(move * 0.55)]);
else legs.push([gx, gy, args.tx, args.ty, move]);
for (const [ax, ay, bx, by, mv] of legs) {
  for (let k = 1; k <= mv; k++) {
    const t = k / mv;
    const e = t * t * (3 - 2 * t);
    s.moveGrab(ax + (bx - ax) * e, ay + (by - ay) * e, ((bx - ax) * 6 * t * (1 - t) * 60) / mv, ((by - ay) * 6 * t * (1 - t) * 60) / mv);
    s.step();
    f++;
    if (want.has(f)) frames.push(svg(`f${f}`));
  }
}
for (let k = 0; k < (args.hold ?? 10); k++) {
  s.step();
  f++;
  if (want.has(f)) frames.push(svg(`f${f} hold`));
}
s.endGrab();
for (let k = 0; k < 260; k++) {
  s.step();
  f++;
  if (want.has(f)) frames.push(svg(`f${f}`));
}
frames.push(svg(`end f${f}`));
console.log(JSON.stringify(s.cats.map((c) => ({ name: c.name, seat: c.seat?.container ?? null, cx: Math.round(c.body.cx), cy: Math.round(c.body.cy), e: Math.round(c.body.energy), ov: c.overlaps.map((o) => o.inside.toFixed(2)) }))));
writeFileSync(process.argv[3] ?? '/tmp/dbg.html', `<html><body style="margin:0;display:flex;flex-wrap:wrap;gap:2px">${frames.join('')}</body></html>`);
