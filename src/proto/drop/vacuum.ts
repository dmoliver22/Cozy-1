// Cat Drop: the vacuum. A vintage upright hoover coming down the shaft head
// first: a wide red nozzle with a whirring brush roll in its mouth, two
// headlight eyes under grumpy lids, a chrome bumper, and its cloth bag and
// handle trailing above. Cute, but it means business. The body is cached as a
// sprite; the mouth, the eyes and the suction are painted live.

import { glint, lightOf, lineOf, mix, rgba, roundRect, shadowOf, specular, type Ctx } from '../../render/paint';
import { castShadow, cylinderShade, inkLine, knob, paintTex } from '../../render/roomKit';
import { SHAFT_W } from './level';

const RED = '#D8695F';
const CREAM = '#F7E6CC';
const CHROME = '#C3CDD7';
const INK = '#2E2A3D';
const BAG = '#E9DCC4';

/** Half width of the nozzle head, and its height. */
export const VAC_HW = 152;
const HEAD_H = 58;
/** How far the cached body sprite reaches above the nozzle (the bag's top). */
const SPRITE_TOP = 300;
/** The handle reaches at least this far up (and on to the top of the screen). */
const REACH = 420;

let sprite: HTMLCanvasElement | null = null;
let spritePpu = 0;

/**
 * The handle pole and the power cord, painted live (they run from the bag up
 * to local y `y1`, off the top of the screen) and tucked behind the bag.
 */
function handle(ctx: Ctx, y1: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  const pole = (x: number, w: number, color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, -250);
    ctx.stroke();
  };
  pole(8, 12, shadowOf(CHROME, 0.5));
  pole(8, 9, CHROME);
  pole(5.5, 2.2, 'rgba(255,255,255,0.8)');
  // the cord, hanging straight down and then loosely coiled
  ctx.strokeStyle = '#4E4656';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-30, y1);
  ctx.lineTo(-30, -REACH + 40);
  ctx.bezierCurveTo(-30, -350, -20, -330, -62, -280);
  ctx.bezierCurveTo(-90, -250, -40, -220, -36, -190);
  ctx.stroke();
  ctx.restore();
}

function body(ctx: Ctx): void {
  const cx = 0;
  const top = -HEAD_H;
  // the bag: a tall stuffed cloth sack with a patch and a zip
  const bag = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - 40, -262);
    ctx.bezierCurveTo(cx - 64, -230, cx - 66, -150, cx - 50, top - 24);
    ctx.lineTo(cx + 50, top - 24);
    ctx.bezierCurveTo(cx + 66, -150, cx + 64, -230, cx + 40, -262);
    ctx.quadraticCurveTo(cx, -276, cx - 40, -262);
    ctx.closePath();
  };
  castShadow(ctx, bag, 6, 8, 8, 0.25);
  ctx.fillStyle = BAG;
  bag();
  ctx.fill();
  paintTex(ctx, bag, 'weave', 0.4, 0.35, 0.35);
  // tartan stripes across the bag
  ctx.save();
  bag();
  ctx.clip();
  ctx.fillStyle = rgba(RED, 0.22);
  for (let y = -250; y < top - 20; y += 34) ctx.fillRect(cx - 70, y, 140, 9);
  for (let x = -60; x < 60; x += 34) ctx.fillRect(cx + x, -280, 9, 300);
  ctx.fillStyle = rgba('#7FA0C8', 0.22);
  for (let y = -238; y < top - 20; y += 34) ctx.fillRect(cx - 70, y, 140, 2.5);
  // form: lit left, round
  const g = ctx.createLinearGradient(cx - 66, 0, cx + 66, 0);
  g.addColorStop(0, rgba(shadowOf(BAG, 0.6), 0.35));
  g.addColorStop(0.25, rgba(lightOf(BAG, 0.9), 0.5));
  g.addColorStop(0.5, rgba(BAG, 0));
  g.addColorStop(1, rgba(shadowOf(BAG, 0.7), 0.6));
  ctx.fillStyle = g;
  ctx.fillRect(cx - 70, -280, 140, 300);
  ctx.restore();
  // a sewn-on patch
  const patch = (): void => roundRect(ctx, cx + 10, -200, 30, 26, 4);
  ctx.fillStyle = '#9DB894';
  patch();
  ctx.fill();
  ctx.save();
  ctx.setLineDash([2, 2]);
  ctx.strokeStyle = 'rgba(255,250,236,0.85)';
  ctx.lineWidth = 0.9;
  roundRect(ctx, cx + 12.5, -197.5, 25, 21, 3);
  ctx.stroke();
  ctx.restore();
  inkLine(ctx, patch, '#9DB894', 0.8, 0.6);
  // zip
  ctx.strokeStyle = rgba(shadowOf(BAG, 0.6), 0.7);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - 22, -250);
  ctx.quadraticCurveTo(cx - 32, -170, cx - 26, -96);
  ctx.stroke();
  inkLine(ctx, bag, BAG, 1.3, 0.75);
  // the neck: a chrome swivel joint into the head
  const neck = (): void => roundRect(ctx, cx - 22, top - 30, 44, 34, 8);
  ctx.fillStyle = CHROME;
  neck();
  ctx.fill();
  cylinderShade(ctx, neck, cx - 22, cx + 22, CHROME, 0.8, 0.6);
  inkLine(ctx, neck, CHROME, 1, 0.6);
  for (const k of [-1, 1]) knob(ctx, cx + k * 14, top - 14, 2.4, lightOf(CHROME, 0.2));
  // the head: a wide red hood
  const head = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - VAC_HW + 14, top);
    ctx.lineTo(cx + VAC_HW - 14, top);
    ctx.quadraticCurveTo(cx + VAC_HW + 2, top, cx + VAC_HW, top + 18);
    ctx.lineTo(cx + VAC_HW, -8);
    ctx.quadraticCurveTo(cx + VAC_HW, 0, cx + VAC_HW - 8, 0);
    ctx.lineTo(cx - VAC_HW + 8, 0);
    ctx.quadraticCurveTo(cx - VAC_HW, 0, cx - VAC_HW, -8);
    ctx.lineTo(cx - VAC_HW, top + 18);
    ctx.quadraticCurveTo(cx - VAC_HW - 2, top, cx - VAC_HW + 14, top);
    ctx.closePath();
  };
  castShadow(ctx, head, 6, 9, 9, 0.3);
  ctx.fillStyle = RED;
  head();
  ctx.fill();
  paintTex(ctx, head, 'brush', 0.25, 0.4, 0.4, cx, top);
  const hg = ctx.createLinearGradient(0, top, 0, 0);
  hg.addColorStop(0, rgba(lightOf(RED, 0.8), 0.75));
  hg.addColorStop(0.18, rgba(lightOf(RED, 0.5), 0.2));
  hg.addColorStop(0.6, rgba(RED, 0));
  hg.addColorStop(1, rgba(shadowOf(RED, 0.6), 0.6));
  ctx.fillStyle = hg;
  head();
  ctx.fill();
  const sg = ctx.createLinearGradient(cx - VAC_HW, 0, cx + VAC_HW, 0);
  sg.addColorStop(0, rgba(shadowOf(RED, 0.5), 0.35));
  sg.addColorStop(0.1, rgba(lightOf(RED, 0.6), 0.25));
  sg.addColorStop(0.3, rgba(RED, 0));
  sg.addColorStop(0.85, rgba(RED, 0));
  sg.addColorStop(1, rgba(shadowOf(RED, 0.6), 0.5));
  ctx.fillStyle = sg;
  head();
  ctx.fill();
  specular(ctx, cx - VAC_HW * 0.45, top + 7, VAC_HW * 0.7, 2.6, 0, 0.55);
  // cream racing stripe and a little brand plate
  ctx.fillStyle = CREAM;
  roundRect(ctx, cx - VAC_HW + 10, top + 30, VAC_HW * 2 - 20, 5, 2);
  ctx.fill();
  ctx.fillStyle = rgba(shadowOf(CREAM, 0.4), 0.5);
  ctx.fillRect(cx - VAC_HW + 12, top + 34, VAC_HW * 2 - 24, 1);
  const plate = (): void => roundRect(ctx, cx - 26, top + 8, 52, 15, 4);
  ctx.fillStyle = CHROME;
  plate();
  ctx.fill();
  cylinderShade(ctx, plate, cx - 26, cx + 26, CHROME, 0.7, 0.5);
  inkLine(ctx, plate, CHROME, 0.8, 0.6);
  ctx.fillStyle = INK;
  ctx.font = '800 10px "Baloo 2", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('HOOVA', cx, top + 16);
  inkLine(ctx, head, RED, 1.4, 0.8);
  // chrome bumper along the lip
  const bump = (): void => roundRect(ctx, cx - VAC_HW - 3, -13, VAC_HW * 2 + 6, 8, 4);
  ctx.fillStyle = CHROME;
  bump();
  ctx.fill();
  const bg = ctx.createLinearGradient(0, -13, 0, -5);
  bg.addColorStop(0, 'rgba(255,255,255,0.85)');
  bg.addColorStop(0.4, rgba(CHROME, 0));
  bg.addColorStop(1, rgba(shadowOf(CHROME, 0.6), 0.7));
  ctx.fillStyle = bg;
  bump();
  ctx.fill();
  inkLine(ctx, bump, CHROME, 0.9, 0.6);
  // wheels at the ends
  for (const s of [-1, 1]) {
    const wx = cx + s * (VAC_HW - 6);
    ctx.fillStyle = '#4E4656';
    ctx.beginPath();
    ctx.arc(wx, -22, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = CHROME;
    ctx.beginPath();
    ctx.arc(wx, -22, 5, 0, Math.PI * 2);
    ctx.fill();
    glint(ctx, wx - 1.5, -23.5, 1.1, 0.9);
  }
}

/** The vacuum body as a sprite (repainted only when the resolution changes). */
function bodySprite(ppu: number): HTMLCanvasElement {
  if (sprite && spritePpu === ppu) return sprite;
  const pad = 24;
  const w = VAC_HW * 2 + pad * 2;
  const h = SPRITE_TOP + pad;
  const c = sprite ?? document.createElement('canvas');
  c.width = Math.ceil(w * ppu);
  c.height = Math.ceil(h * ppu);
  const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, c.width, c.height);
  g.setTransform(ppu, 0, 0, ppu, (w / 2) * ppu, SPRITE_TOP * ppu);
  body(g);
  sprite = c;
  spritePpu = ppu;
  return c;
}

/**
 * Paint the vacuum with its nozzle's bottom edge at world y. `t` is the clock,
 * `danger` 0..1 how close it is to the cat, `chomp` 0..1 a slurp in progress.
 * `top` is the world y of the top of the screen, which the handle reaches up past.
 */
export function drawVacuum(ctx: Ctx, y: number, t: number, danger: number, chomp: number, ppu: number, top = y - REACH): void {
  const cx = SHAFT_W / 2;
  const shake = danger > 0.5 ? Math.sin(t * 61) * (danger - 0.5) * 1.6 : 0;
  ctx.save();
  ctx.translate(cx + shake, y);
  // the mouth (under the bumper): dark, with the whirring brush roll
  const mw = VAC_HW - 14;
  const open = 9 + chomp * 6;
  const mouth = (): void => roundRect(ctx, -mw, -6, mw * 2, open, 4);
  ctx.fillStyle = INK;
  mouth();
  ctx.fill();
  ctx.save();
  mouth();
  ctx.clip();
  const speed = 26 + danger * 30 + chomp * 40;
  ctx.fillStyle = '#5A5068';
  for (let x = -mw - 20 + ((t * speed) % 14); x < mw + 20; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, -6);
    ctx.lineTo(x + 6, -6);
    ctx.lineTo(x - 2, -6 + open);
    ctx.lineTo(x - 8, -6 + open);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // bristles along the lip
  ctx.strokeStyle = rgba('#8E7F6E', 0.9);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let x = -mw; x <= mw; x += 3) {
    const wob = Math.sin(x * 0.7 + t * 30) * (0.6 + danger);
    ctx.moveTo(x, -6 + open - 1);
    ctx.lineTo(x + wob, -6 + open + 3.5);
  }
  ctx.stroke();
  // the handle, then the body sprite over its foot
  handle(ctx, Math.min(-REACH, top - y));
  const s = bodySprite(ppu);
  const pad = 24;
  ctx.drawImage(s, -VAC_HW - pad, -SPRITE_TOP, s.width / ppu, s.height / ppu);
  // headlight eyes under grumpy lids, glowing as it gets close
  const eyeY = -HEAD_H + 30 - 9;
  for (const side of [-1, 1]) {
    const ex = side * 74;
    const r = 13;
    // casing
    ctx.fillStyle = CREAM;
    ctx.beginPath();
    ctx.arc(ex, eyeY, r + 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(lineOf(RED), 0.6);
    ctx.lineWidth = 1;
    ctx.stroke();
    // lens
    const glow = Math.max(0, Math.min(1, 0.4 + danger * 0.52 + Math.sin(t * 9) * 0.08 * danger));
    const lg = ctx.createRadialGradient(ex - 3, eyeY - 3, 1, ex, eyeY, r);
    lg.addColorStop(0, mix('#FFF7D6', '#FFFDF2', glow));
    lg.addColorStop(0.6, mix('#E9C46A', '#FFD86B', glow));
    lg.addColorStop(1, mix('#B98A3A', '#E8A33E', glow));
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(ex, eyeY, r, 0, Math.PI * 2);
    ctx.fill();
    // a pupil that looks down at the cat
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(ex + side * -1.5, eyeY + 4, 4.2, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(ex + side * -1.5 + 1.6, eyeY + 2.2, 1.4, 0, Math.PI * 2);
    ctx.fill();
    // the lid: a red band slanting down toward the middle (a grumpy brow)
    const tilt = 5 + danger * 3;
    ctx.save();
    ctx.beginPath();
    ctx.arc(ex, eyeY, r + 3.6, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(ex - side * (r + 4), eyeY - r - 5);
    ctx.lineTo(ex + side * (r + 4), eyeY - r - 5);
    ctx.lineTo(ex + side * (r + 4), eyeY - 3 - tilt * 0.4);
    ctx.lineTo(ex - side * (r + 4), eyeY - 3 + tilt);
    ctx.closePath();
    ctx.fillStyle = shadowOf(RED, 0.15);
    ctx.fill();
    ctx.strokeStyle = rgba(shadowOf(RED, 0.6), 0.8);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(ex + side * (r + 4), eyeY - 3 - tilt * 0.4);
    ctx.lineTo(ex - side * (r + 4), eyeY - 3 + tilt);
    ctx.stroke();
    ctx.restore();
    glint(ctx, ex - 5, eyeY - 1, 1.3, 0.8);
    // a warm light thrown down from each eye
    if (glow > 0.6) {
      const bg = ctx.createRadialGradient(ex, eyeY + 30, 0, ex, eyeY + 30, 70);
      bg.addColorStop(0, `rgba(255,226,150,${0.12 * (glow - 0.6) * 2.5})`);
      bg.addColorStop(1, 'rgba(255,226,150,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(ex - 70, eyeY - 40, 140, 140);
    }
  }
  ctx.restore();
}

/**
 * Suction drawn below the nozzle: streaks of air curving up into the mouth,
 * stronger as the vacuum closes in (`k` 0..1).
 */
export function drawSuction(ctx: Ctx, y: number, t: number, k: number): void {
  if (k <= 0.02) return;
  const cx = SHAFT_W / 2;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const u = (i + 0.5) / 14;
    const x0 = cx + (u - 0.5) * VAC_HW * 2.3;
    const phase = (t * (1.4 + (i % 3) * 0.25) + i * 0.37) % 1;
    const len = 150 + (i % 4) * 30;
    const yb = y + 10 + len * (1 - phase);
    const ya = yb - 46;
    const xEnd = cx + (u - 0.5) * VAC_HW * 1.6;
    const a = Math.sin(phase * Math.PI) * 0.35 * k;
    ctx.strokeStyle = `rgba(255,253,246,${a})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x0 + (xEnd - x0) * (1 - phase), yb);
    ctx.quadraticCurveTo(x0 + (xEnd - x0) * (1 - phase * 0.6), (ya + yb) / 2, xEnd, Math.max(y + 6, ya));
    ctx.stroke();
  }
  ctx.restore();
}

export { INK as VAC_INK, RED as VAC_RED };
