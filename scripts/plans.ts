// Dev tool: print solver par + plan for the hand-made rooms.
// Build: npx rolldown scripts/plans.ts --file /tmp/plans.mjs --format esm --platform node
import { HANDMADE } from '../src/game/rooms';
import { solveRoom } from '../src/game/solver';

for (const def of HANDMADE) {
  const res = solveRoom({ ...def, plan: undefined, par: undefined });
  const plan = res.plan.map((p) => ({ ...p, gx: Math.round(p.gx), gy: Math.round(p.gy), tx: Math.round(p.tx), ty: Math.round(p.ty), wx: p.wx === undefined ? undefined : Math.round(p.wx), wy: p.wy === undefined ? undefined : Math.round(p.wy) }));
  console.log(def.id, JSON.stringify({ ok: res.ok, par: res.par, cozy: res.cozy }));
  console.log(JSON.stringify(plan));
}
