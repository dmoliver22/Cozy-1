// The living room's ceiling, painted into the renderer's cached tiles: the
// cut edge of the floor above (the dollhouse is open at the front), the
// plaster underside of the ceiling, lit from the window side, and a crown
// moulding where it meets the wall (the roof tube's pipe goes up through it).

import { WORLD_W } from '../game/props';
import { hash01, lightOf, mix, rgba, roundRect, shadowOf, type Ctx } from '../render/paint';
import type { Theme } from '../render/roomArt';
import { castShadow, inkLine, paintTex } from '../render/roomKit';

/** The ceiling's underside, seen from below: how far up the screen its front edge is. */
const BAND = 20;
/** The cut edge of the floor above. */
const SLAB = 11;
/** Vanishing point the ceiling recedes to (the floor uses the same idea). */
const VPX = WORLD_W / 2;
const CUT = '#E9DCCB';
const CUT_LINE = '#B9A58E';

/** Where a point on the back edge of the ceiling is at its front edge. */
const frontX = (x: number): number => x + (x - VPX) * 0.09;

/**
 * The ceiling across the top of a room whose wall meets it at y = ceil,
 * with gaps in the moulding where a pipe goes up through it (`gaps`: x0..x1).
 */
export function paintCeiling(ctx: Ctx, r: { x0: number; y0: number; x1: number; y1: number }, theme: Theme, seed: number, ceil: number, gaps: [number, number][] = []): void {
  const x0 = Math.max(r.x0, -10);
  const x1 = Math.min(r.x1, WORLD_W + 10);
  const front = ceil - BAND;
  const top = front - SLAB;
  ctx.save();
  // the cut edge, like the dollhouse's side walls
  ctx.fillStyle = CUT;
  ctx.fillRect(x0, top, x1 - x0, SLAB);
  ctx.fillStyle = CUT_LINE;
  ctx.fillRect(x0, top, x1 - x0, 2);
  ctx.fillStyle = rgba(shadowOf(CUT, 0.4), 0.5);
  ctx.fillRect(x0, front - 1.2, x1 - x0, 1.2);
  // the ceiling's underside: plaster, lit from the window side, darker in the corner
  const plaster = mix(theme.trim, theme.wall, 0.35);
  const band = (): void => {
    ctx.beginPath();
    ctx.moveTo(frontX(x0 - 40), front);
    ctx.lineTo(frontX(x1 + 40), front);
    ctx.lineTo(x1 + 40, ceil);
    ctx.lineTo(x0 - 40, ceil);
    ctx.closePath();
  };
  ctx.fillStyle = plaster;
  band();
  ctx.fill();
  const lg = ctx.createLinearGradient(0, front, 0, ceil);
  lg.addColorStop(0, rgba(lightOf(plaster, 0.5), 0.5));
  lg.addColorStop(1, rgba(shadowOf(plaster, 0.35), 0.45));
  ctx.fillStyle = lg;
  band();
  ctx.fill();
  paintTex(ctx, band, 'plaster', 0.12, 0.5, 0.5, seed % 97, 0);
  moulding(ctx, x0, x1, ceil, theme.trim, seed, gaps);
  ctx.restore();
}

function moulding(ctx: Ctx, x0: number, x1: number, y: number, trim: string, seed: number, gaps: [number, number][]): void {
  const h = 7;
  const runs: [number, number][] = [];
  let a = x0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 > a) runs.push([a, g0]);
    a = Math.max(a, g1);
  }
  if (a < x1) runs.push([a, x1]);
  castShadow(ctx, () => {
    ctx.beginPath();
    for (const [p, q] of runs) ctx.rect(p, y, q - p, h);
  }, 1.5, 3.5, 3.5, 0.24);
  for (const [p, q] of runs) {
    const path = (): void => roundRect(ctx, p, y - 1, q - p, h + 1, [0, 0, 2.5, 2.5]);
    ctx.fillStyle = trim;
    path();
    ctx.fill();
    paintTex(ctx, path, 'wood', 0.12, 0.45, 0.2, p + hash01(seed, 3) * 80, y);
    const g = ctx.createLinearGradient(0, y - 1, 0, y + h);
    g.addColorStop(0, rgba(shadowOf(trim, 0.35), 0.35));
    g.addColorStop(0.3, rgba(lightOf(trim, 1), 0.7));
    g.addColorStop(0.55, rgba(shadowOf(trim, 0.2), 0.25));
    g.addColorStop(0.7, rgba(lightOf(trim, 0.8), 0.55));
    g.addColorStop(1, rgba(shadowOf(trim, 0.5), 0.55));
    ctx.fillStyle = g;
    path();
    ctx.fill();
    inkLine(ctx, path, trim, 0.8, 0.45);
  }
}
