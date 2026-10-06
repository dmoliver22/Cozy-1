// A plump tufted cushion, velvet with piping and buttons: Cat Drop's
// bouncy cushions, and the house's. Painted with its top-left at 0,0.

import { hash01, lightOf, rgba, shadowOf, specular, type Box, type Ctx } from './paint';
import { inkLine, knob, paintTex, roundShade } from './roomKit';

export function paintCushion(ctx: Ctx, w: number, h: number, color: string, seed: number): void {
  const path = (): void => {
    const b = 5;
    ctx.beginPath();
    ctx.moveTo(8, 3);
    ctx.quadraticCurveTo(w / 2, -b, w - 8, 3);
    ctx.quadraticCurveTo(w + 1, 3, w, 12);
    ctx.quadraticCurveTo(w + 3, h * 0.6, w - 3, h - 2);
    ctx.quadraticCurveTo(w / 2, h + 2, 3, h - 2);
    ctx.quadraticCurveTo(-3, h * 0.6, 0, 12);
    ctx.quadraticCurveTo(-1, 3, 8, 3);
    ctx.closePath();
  };
  const box: Box = { x0: 0, y0: 0, x1: w, y1: h };
  ctx.fillStyle = color;
  path();
  ctx.fill();
  paintTex(ctx, path, 'weave', 0.3, 0.32, 0.32, hash01(seed, 1) * 50, 0);
  roundShade(ctx, path, box, color, 0.5, 0.45);
  // tufting buttons and their creases
  const n = Math.max(2, Math.round(w / 46));
  ctx.strokeStyle = rgba(shadowOf(color, 0.6), 0.45);
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const bx = (w * (i + 0.5)) / n;
    const by = h * 0.42;
    ctx.beginPath();
    for (const [dx, dy] of [
      [-9, -6],
      [9, -6],
      [-8, 6],
      [8, 6],
    ]) {
      ctx.moveTo(bx + dx * 0.2, by + dy * 0.2);
      ctx.quadraticCurveTo(bx + dx * 0.6, by + dy * 0.3, bx + dx, by + dy);
    }
    ctx.stroke();
    knob(ctx, bx, by, 2.1, shadowOf(color, 0.2));
  }
  // a velvet sheen, piping and a lit top edge
  specular(ctx, w * 0.3, 6, w * 0.32, 2, -0.05, 0.4);
  ctx.strokeStyle = rgba(lightOf(color, 0.75), 0.75);
  ctx.lineWidth = 1.6;
  path();
  ctx.stroke();
  inkLine(ctx, path, color, 1.1, 0.7);
}
