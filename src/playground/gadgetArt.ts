// The toys' art (gadgets.ts), painted live: they move (the fan's blades
// turn, the belt runs, the cannon trembles with a cat in it and kicks back
// when it fires, the bumper lights up when it's hit). A circus cannon on a
// wooden cart, a mint fan with its wind drifting off it, a cherry pinball
// bumper with a star on top, and a belt between brass rollers.

import { lightOf, mix, rgba, roundRect, shadowOf, softShadow, type Ctx } from '../render/paint';
import { inkLine } from '../render/roomKit';
import { BELT, BUMPER, CANNON, FAN, FUNNEL, aimDir, gadgetBox, type Gadget } from './gadgets';

const TAU = Math.PI * 2;

/** How a toy's moving this frame: the time (for the fan and the belt), the bumper's flash, the cannon's kick back, how long a cat's been in it (0..1, 0: empty) and its tremble. */
export interface GadgetLook {
  time: number;
  flash: number;
  recoil: number;
  charge: number;
  shake: number;
}

/** A toy, its far part (under the cats) or its near part (over them: the cannon's barrel, with a cat in it). */
export function paintGadget(ctx: Ctx, g: Gadget, layer: 'back' | 'front', look: GadgetLook): void {
  switch (g.kind) {
    case 'cannon':
      if (layer === 'back') cannonCart(ctx, g);
      else cannonBarrel(ctx, g, look);
      return;
    case 'funnel':
      funnel(ctx, g, layer);
      return;
    case 'fan':
      if (layer === 'back') fan(ctx, g, look.time);
      return;
    case 'bumper':
      if (layer === 'back') bumper(ctx, g, look.flash, look.time);
      return;
    case 'belt':
      if (layer === 'back') belt(ctx, g, look.time);
  }
}

const CORAL = '#E88B7E';
const GOLD = '#E3B95A';
const WOOD = '#B9895F';

/** The cannon's cart: a little wooden carriage on two spoked wheels. */
function cannonCart(ctx: Ctx, g: Gadget): void {
  const { x, y } = g;
  softShadow(ctx, x, y + CANNON.cart + 2, 34, 5, 0.18);
  const body = (): void => roundRect(ctx, x - 28, y + 4, 56, 18, 6);
  ctx.fillStyle = WOOD;
  body();
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(WOOD, 0.6), 0.5);
  ctx.fillRect(x - 24, y + 6, 48, 3);
  ctx.fillStyle = rgba(shadowOf(WOOD, 0.4), 0.45);
  ctx.fillRect(x - 26, y + 17, 52, 4);
  inkLine(ctx, body, WOOD, 1, 0.55);
  // the trunnion the barrel turns on
  ctx.fillStyle = shadowOf(WOOD, 0.25);
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, TAU);
  ctx.fill();
  for (const s of [-1, 1]) wheel(ctx, x + s * 17, y + CANNON.cart - 9, 10);
}

function wheel(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.fillStyle = '#8C6448';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#C79A6C';
  ctx.beginPath();
  ctx.arc(x, y, r - 2.6, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#8C6448';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2));
  }
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(x, y, 2.6, 0, TAU);
  ctx.fill();
}

/** The barrel: coral with gold bands and a star, aimed its way (kicked back as it fires, trembling with a cat in it). */
function cannonBarrel(ctx: Ctx, g: Gadget, look: GadgetLook): void {
  const d = aimDir(g);
  const back = look.recoil * 9;
  const shake = look.shake;
  ctx.save();
  ctx.translate(g.x - d.x * back - d.y * shake, g.y - d.y * back + d.x * shake);
  ctx.rotate(Math.atan2(d.y, d.x));
  const r = CANNON.r;
  const x0 = -CANNON.back;
  const x1 = CANNON.fore;
  const barrel = (): void => {
    ctx.beginPath();
    ctx.moveTo(x0 + r * 0.6, -r * 0.92);
    ctx.lineTo(x1 - 4, -r * 1.02);
    ctx.lineTo(x1 - 4, r * 1.02);
    ctx.lineTo(x0 + r * 0.6, r * 0.92);
    ctx.arc(x0 + r * 0.6, 0, r * 0.92, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.closePath();
  };
  ctx.fillStyle = CORAL;
  barrel();
  ctx.fill();
  // round: lit along its top, shaded along its underside
  const sh = ctx.createLinearGradient(0, -r, 0, r);
  sh.addColorStop(0, 'rgba(255,240,226,0.45)');
  sh.addColorStop(0.35, 'rgba(255,240,226,0)');
  sh.addColorStop(1, 'rgba(98,52,62,0.35)');
  ctx.fillStyle = sh;
  barrel();
  ctx.fill();
  // gold bands, and the muzzle's lip
  for (const bx of [x0 + 10, 14]) band(ctx, bx, r * 0.98, 5);
  band(ctx, x1 - 6, r * 1.12, 8);
  // its mouth, dark inside (or full of cat)
  if (look.charge <= 0) {
    ctx.fillStyle = '#4A3B52';
    ctx.beginPath();
    ctx.ellipse(x1 - 1, 0, 4.5, r * 0.78, 0, 0, TAU);
    ctx.fill();
  }
  // a star on its side
  star(ctx, -1, 0, 6.5, '#FFF3D6');
  inkLine(ctx, barrel, CORAL, 1, 0.5);
  // the cap at its back
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(x0 + 2, 0, 6, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function band(ctx: Ctx, x: number, hr: number, w: number): void {
  const p = (): void => roundRect(ctx, x - w / 2, -hr, w, hr * 2, 2);
  ctx.fillStyle = GOLD;
  p();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,248,224,0.55)';
  ctx.fillRect(x - w / 2 + 1, -hr + 2, w - 2, hr * 0.5);
  inkLine(ctx, p, GOLD, 0.8, 0.5);
}

function star(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k / 10) * TAU;
    const rr = k % 2 ? r * 0.45 : r;
    if (k === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * The funnel: a glass cone, its far side and the dark of its spout under the
 * cats, its near side over them (a cat in it is seen through the glass), a
 * brass collar at the spout and a rolled rim round its mouth.
 */
function funnel(ctx: Ctx, g: Gadget, layer: 'back' | 'front'): void {
  const d = aimDir(g);
  const { spout: s, mouth: m, len: L } = FUNNEL;
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(Math.atan2(d.y, d.x));
  const cone = (): void => {
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(L, -m);
    ctx.lineTo(L, m);
    ctx.lineTo(0, s);
    ctx.closePath();
  };
  if (layer === 'back') {
    // the glass's far side: a pale tint, deeper toward the spout
    const tint = ctx.createLinearGradient(0, 0, L, 0);
    tint.addColorStop(0, 'rgba(120,160,182,0.34)');
    tint.addColorStop(1, 'rgba(190,222,236,0.16)');
    ctx.fillStyle = tint;
    cone();
    ctx.fill();
    // down the spout: dark
    ctx.fillStyle = 'rgba(46,40,62,0.42)';
    ctx.beginPath();
    ctx.ellipse(1, 0, 4, s - 3, 0, 0, TAU);
    ctx.fill();
    // the mouth's far lip
    ctx.strokeStyle = 'rgba(150,190,208,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(L, 0, 9, m, 0, -Math.PI / 2, Math.PI / 2, true);
    ctx.stroke();
    ctx.restore();
    return;
  }
  // the near glass: a wash, its two sides, a shine down one of them
  ctx.fillStyle = 'rgba(214,236,244,0.13)';
  cone();
  ctx.fill();
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.strokeStyle = 'rgba(122,160,180,0.85)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, side * s);
    ctx.lineTo(L, side * m);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(232,246,250,0.95)';
    ctx.lineWidth = 3.2;
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(10, -s - 2);
  ctx.lineTo(L - 14, -m + 12);
  ctx.stroke();
  // the rolled rim round its mouth, near half
  ctx.strokeStyle = 'rgba(122,160,180,0.85)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.ellipse(L, 0, 9, m, 0, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(240,250,252,0.98)';
  ctx.lineWidth = 3.4;
  ctx.stroke();
  // the brass collar at its spout
  const p = (): void => roundRect(ctx, -5, -s - 4, 10, s * 2 + 8, 3);
  ctx.fillStyle = GOLD;
  p();
  ctx.fill();
  inkLine(ctx, p, GOLD, 1, 0.5);
  ctx.fillStyle = 'rgba(255,243,214,0.7)';
  ctx.fillRect(-3, -s - 2, 2.5, s * 2 + 4);
  ctx.restore();
}

const MINT = '#8FCBB5';

/** The fan: its wind drifting off it (faint streaks going its way), its round housing, the blades turning, a guard over them. */
function fan(ctx: Ctx, g: Gadget, time: number): void {
  const d = aimDir(g);
  const nx = -d.y;
  const ny = d.x;
  // the wind
  ctx.save();
  ctx.lineCap = 'round';
  for (let k = 0; k < 7; k++) {
    const lane = (k / 6 - 0.5) * FAN.half * 1.7;
    const u = (time * 0.9 + k * 0.37) % 1;
    const s = FAN.r + u * FAN.reach;
    const len = 26 + 30 * (1 - u);
    const a = Math.sin(u * Math.PI) * 0.5;
    const wob = Math.sin(time * 3 + k) * 6;
    const sx = g.x + d.x * s + nx * (lane + wob);
    const sy = g.y + d.y * s + ny * (lane + wob);
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + d.x * len * 0.5 + nx * 4, sy + d.y * len * 0.5 + ny * 4, sx + d.x * len, sy + d.y * len);
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(Math.atan2(d.y, d.x));
  // the housing, a ring seen a little from the side
  const R = FAN.r;
  ctx.fillStyle = shadowOf(MINT, 0.35);
  ctx.beginPath();
  ctx.ellipse(-6, 0, 12, R, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = MINT;
  ctx.beginPath();
  ctx.rect(-6, -R, 10, R * 2);
  ctx.fill();
  ctx.fillStyle = mix(MINT, '#3E3A4F', 0.55);
  ctx.beginPath();
  ctx.ellipse(4, 0, 10, R, 0, 0, TAU);
  ctx.fill();
  // the blades, turning (seen edge-on-ish: squashed by the housing's tilt)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(4, 0, 9, R - 2.5, 0, 0, TAU);
  ctx.clip();
  const spin = time * 14;
  for (let k = 0; k < 4; k++) {
    const a = spin + (k * Math.PI) / 2;
    const c = Math.cos(a);
    ctx.fillStyle = k % 2 ? '#FFF6E6' : '#F3E3CC';
    ctx.beginPath();
    ctx.ellipse(4 + Math.sin(a) * 2.2, c * (R - 9) * 0.5, 4.5, Math.abs(c) * (R - 9) * 0.5 + 2, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.ellipse(5, 0, 3.4, 6, 0, 0, TAU);
  ctx.fill();
  // the guard: a rim and a few wires
  ctx.strokeStyle = lightOf(MINT, 0.4);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(4, 0, 10, R, 0, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 0.9;
  for (const f of [-0.6, -0.2, 0.2, 0.6]) {
    ctx.beginPath();
    ctx.moveTo(4 + 10 * Math.sqrt(1 - f * f) * 0.9, f * R);
    ctx.lineTo(4 - 10 * Math.sqrt(1 - f * f) * 0.9, f * R);
    ctx.stroke();
  }
  // the motor at its back
  ctx.fillStyle = shadowOf(MINT, 0.15);
  roundRect(ctx, -20, -8, 14, 16, 4);
  ctx.fill();
  ctx.restore();
}

/** The bumper: a gold rim, cherry red, a white cap with a star; lit up when a cat's just bounced off it. */
function bumper(ctx: Ctx, g: Gadget, flash: number, time: number): void {
  const { x, y } = g;
  const R = BUMPER.r;
  if (flash > 0) {
    const glow = ctx.createRadialGradient(x, y, R * 0.6, x, y, R * 2.2);
    glow.addColorStop(0, `rgba(255,230,160,${0.6 * flash})`);
    glow.addColorStop(1, 'rgba(255,230,160,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - R * 2.2, y - R * 2.2, R * 4.4, R * 4.4);
  }
  const s = 1 + flash * 0.08 * Math.sin(time * 60);
  softShadow(ctx, x + 3, y + R + 4, R * 0.9, 4, 0.14);
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.arc(x, y, R * s, 0, TAU);
  ctx.fill();
  const red = mix('#D9545E', '#FFD27A', flash * 0.6);
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.arc(x, y, R * s - 4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(red, 0.6), 0.5);
  ctx.beginPath();
  ctx.arc(x - 5, y - 6, R * 0.45, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#FFF8EE';
  ctx.beginPath();
  ctx.arc(x, y, R * 0.5, 0, TAU);
  ctx.fill();
  star(ctx, x, y + 0.5, R * 0.36, flash > 0.2 ? '#F2B33D' : '#E88B7E');
  inkLine(
    ctx,
    () => {
      ctx.beginPath();
      ctx.arc(x, y, R * s, 0, TAU);
    },
    GOLD,
    1,
    0.55,
  );
}

/** The belt: a dark rubber belt between two brass rollers, its chevrons running the way it goes. */
function belt(ctx: Ctx, g: Gadget, time: number): void {
  const { x, y } = g;
  const d = aimDir(g).x;
  const H = BELT.h;
  const half = BELT.half;
  softShadow(ctx, x, y + H + 4, half, 4, 0.14);
  const band = (): void => roundRect(ctx, x - half, y, half * 2, H, H / 2);
  ctx.fillStyle = '#5B566E';
  band();
  ctx.fill();
  // chevrons along its top, running its way
  ctx.save();
  band();
  ctx.clip();
  const step = 18;
  const off = (((time * BELT.speed * d) % step) + step) % step;
  ctx.strokeStyle = 'rgba(244,214,140,0.85)';
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  for (let cx = x - half - step + off; cx < x + half + step; cx += step) {
    ctx.beginPath();
    ctx.moveTo(cx - d * 4, y + 3.5);
    ctx.lineTo(cx + d * 2, y + H / 2);
    ctx.lineTo(cx - d * 4, y + H - 3.5);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(x - half, y + 1, half * 2, 3);
  ctx.restore();
  // the rollers at its ends, turning
  for (const s of [-1, 1]) {
    const rx = x + s * (half - H / 2);
    const ry = y + H / 2;
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.arc(rx, ry, H / 2 - 2.5, 0, TAU);
    ctx.fill();
    const a = (time * BELT.speed * d) / (H / 2);
    ctx.strokeStyle = shadowOf(GOLD, 0.35);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const b = a + (k * TAU) / 3;
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + Math.cos(b) * (H / 2 - 4), ry + Math.sin(b) * (H / 2 - 4));
    }
    ctx.stroke();
  }
  inkLine(ctx, band, '#5B566E', 1, 0.5);
}

/** A little picture of a toy, for the build list. */
export function gadgetThumb(kind: Gadget['kind'], w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const k = 2;
  c.width = w * k;
  c.height = h * k;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const ctx = c.getContext('2d')!;
  const g: Gadget = { id: 0, kind, x: 0, y: 0, aim: kind === 'cannon' ? -35 : 0 };
  // (fitted in, a little in from the edges)
  const box = gadgetBox(g);
  const scale = Math.min((w - 6) / (box.x1 - box.x0), (h - 6) / (box.y1 - box.y0));
  ctx.setTransform(k * scale, 0, 0, k * scale, (k * w) / 2 - k * scale * ((box.x0 + box.x1) / 2), (k * h) / 2 - k * scale * ((box.y0 + box.y1) / 2));
  const look: GadgetLook = { time: 0.3, flash: 0, recoil: 0, charge: 0, shake: 0 };
  // (the fan's wind left out: there's no room for it)
  if (kind === 'fan') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x - 40, g.y - 40, 80, 80);
    ctx.clip();
  }
  paintGadget(ctx, g, 'back', look);
  paintGadget(ctx, g, 'front', look);
  if (kind === 'fan') ctx.restore();
  return c;
}
