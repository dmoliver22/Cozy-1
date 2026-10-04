// Painted props. Containers are drawn in two layers: the "back" (inside and
// far rim) goes under the cats, the "front" (body and near rim) goes over
// them, so a poured cat really looks like it's sitting in the teacup.

import type { ContainerType, FurnitureType, Prop } from '../game/props';
import { FLOOR_Y } from '../game/props';
import { PALETTE, glaze, hash01, mix, roundRect, shade, softShadow, tint, type Ctx } from './paint';

interface Colors {
  body: string;
  inner: string;
  rim: string;
}

const TINTS: Partial<Record<ContainerType, string[]>> = {
  teacup: [PALETTE.teacup, '#9FCDB8', '#E9B4B0', '#F1D58F'],
  mug: ['#F3E6D2', PALETTE.terracotta, '#A9C9B6', '#B9C7E6'],
  boot: ['#F2C14E', '#E07F6E', '#8FB8A0', '#8FA6D9'],
  box: ['#D8B084'],
  shoebox: ['#B9CFE6', '#F0B9B4', '#C7DDB8'],
  fruitbowl: ['#A9C3A0', PALETTE.teacup, '#E6A88D', '#F0D9A8'],
  sink: ['#FBF7F0'],
  pot: [PALETTE.terracotta, '#C97E5A'],
  basket: ['#D7AF72'],
  saucepan: ['#D9895A', '#9FB2C2'],
  vase: [PALETTE.teacup, '#9FCDB8', '#E9B4B0'],
  bucket: ['#A7B7C4', '#E3A8A0'],
  slipper: ['#F2B8C6', '#C9B8DD', '#BFDCCB'],
  mixingbowl: ['#F6EBDA', '#BFDCCB', '#F2C9A0'],
};

function colorsFor(p: Prop): Colors {
  const list = TINTS[p.type as ContainerType] ?? [PALETTE.teacup];
  const body = list[p.tint % list.length];
  const inner = p.material === 'cardboard' ? shade(body, 0.3) : p.material === 'wicker' ? shade(body, 0.35) : shade(tint(body, 0.35), 0.32);
  return { body, inner, rim: tint(body, 0.35) };
}

function local(ctx: Ctx, p: Prop): void {
  ctx.translate(p.x, p.y);
  ctx.scale(p.flip ? -p.scale : p.scale, p.scale);
}

const LW = 2;

/** Back part of a simple vessel: the inside seen over the rim. */
function vesselBack(ctx: Ctx, rx: number, rimY: number, inner: string, rim: string, ry = rx * 0.16): void {
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.ellipse(0, rimY, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // inner shadow toward the back
  const g = ctx.createLinearGradient(0, rimY - ry, 0, rimY + ry);
  g.addColorStop(0, 'rgba(62,58,79,0.28)');
  g.addColorStop(1, 'rgba(62,58,79,0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.ellipse(0, rimY, rx - 1.6, ry - 0.8, 0, Math.PI, Math.PI * 2);
  ctx.stroke();
}

/**
 * Front body of a vessel: near rim (lower half-ellipse) down to the base.
 * `side(t)` returns the half-width at height fraction t (0 rim, 1 base).
 */
function vesselFront(
  ctx: Ctx,
  rx: number,
  rimY: number,
  baseHalf: number,
  baseY: number,
  colors: Colors,
  opts: { bulge?: number; ry?: number; outline?: string; glazeOn?: boolean; seed?: number } = {},
): void {
  const ry = opts.ry ?? rx * 0.16;
  const bulge = opts.bulge ?? 0;
  const outline = opts.outline ?? shade(colors.body, 0.3);
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(-rx, rimY);
    ctx.ellipse(0, rimY, rx, ry, 0, Math.PI, 0, true);
    const midY = (rimY + baseY) / 2;
    ctx.bezierCurveTo(rx + bulge, midY - (baseY - rimY) * 0.1, baseHalf + bulge * 0.6, baseY - 2, baseHalf - 3, baseY);
    ctx.lineTo(-baseHalf + 3, baseY);
    ctx.bezierCurveTo(-baseHalf - bulge * 0.6, baseY - 2, -rx - bulge, midY - (baseY - rimY) * 0.1, -rx, rimY);
    ctx.closePath();
  };
  path();
  ctx.fillStyle = colors.body;
  ctx.fill();
  // soft side shading
  ctx.save();
  path();
  ctx.clip();
  const g = ctx.createLinearGradient(-rx, 0, rx, 0);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(62,58,79,0.16)');
  ctx.fillStyle = g;
  ctx.fillRect(-rx - 10, rimY - 10, rx * 2 + 20, baseY - rimY + 20);
  ctx.restore();
  ctx.strokeStyle = outline;
  ctx.lineWidth = LW;
  ctx.lineJoin = 'round';
  path();
  ctx.stroke();
  // near rim band
  ctx.strokeStyle = colors.rim;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.ellipse(0, rimY, rx - 1.7, ry - 0.9, 0, 0, Math.PI);
  ctx.stroke();
  if (opts.glazeOn !== false) glaze(ctx, -rx * 0.62, rimY + ry + 4, rx * 0.35, (baseY - rimY) * 0.45, 0.5);
}

// ---------------------------------------------------------------------------
// Containers

export function drawContainerBack(ctx: Ctx, p: Prop): void {
  const c = colorsFor(p);
  ctx.save();
  local(ctx, p);
  switch (p.type as ContainerType) {
    case 'teacup':
      vesselBack(ctx, 38, -58, c.inner, c.rim);
      break;
    case 'mug':
      vesselBack(ctx, 30, -65, c.inner, c.rim);
      break;
    case 'boot':
      vesselBack(ctx, 23, -69, shade(c.body, 0.45), tint(c.body, 0.2), 5);
      break;
    case 'box':
      boxBack(ctx, c);
      break;
    case 'shoebox':
      ctx.fillStyle = c.inner;
      roundRect(ctx, -42, -46, 84, 12, 3);
      ctx.fill();
      break;
    case 'fruitbowl':
      vesselBack(ctx, 61, -45, c.inner, c.rim, 9);
      break;
    case 'sink':
      sinkBack(ctx, c);
      break;
    case 'pot':
      vesselBack(ctx, 35, -59, shade(c.body, 0.4), tint(c.body, 0.2), 6);
      break;
    case 'basket':
      vesselBack(ctx, 59, -73, c.inner, tint(c.body, 0.2), 9);
      break;
    case 'saucepan':
      vesselBack(ctx, 46.5, -45, c.inner, c.rim, 7);
      break;
    case 'vase':
      vesselBack(ctx, 22, -97, shade(c.body, 0.5), tint(c.body, 0.3), 4);
      break;
    case 'bucket':
      vesselBack(ctx, 36.5, -61, c.inner, tint(c.body, 0.3), 6);
      // handle (behind)
      ctx.strokeStyle = shade(c.body, 0.35);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-34, -50);
      ctx.bezierCurveTo(-30, -104, 30, -104, 34, -50);
      ctx.stroke();
      break;
    case 'slipper':
      ctx.fillStyle = shade(c.body, 0.35);
      ctx.beginPath();
      ctx.ellipse(-16, -25, 18, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'mixingbowl':
      vesselBack(ctx, 52, -51, c.inner, c.rim, 8.5);
      break;
  }
  ctx.restore();
}

export function drawContainerFront(ctx: Ctx, p: Prop): void {
  const c = colorsFor(p);
  ctx.save();
  local(ctx, p);
  const seed = p.uid * 13 + p.tint;
  switch (p.type as ContainerType) {
    case 'teacup': {
      // saucer
      const sau = tint(c.body, 0.25);
      ctx.fillStyle = sau;
      ctx.strokeStyle = shade(c.body, 0.3);
      ctx.lineWidth = LW;
      ctx.beginPath();
      ctx.ellipse(0, -4, 46, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = shade(sau, 0.1);
      ctx.beginPath();
      ctx.ellipse(0, -6, 30, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      // handle
      ctx.strokeStyle = shade(c.body, 0.3);
      ctx.lineWidth = 9.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(34, -47);
      ctx.bezierCurveTo(52, -50, 52, -24, 29, -24);
      ctx.stroke();
      ctx.strokeStyle = c.body;
      ctx.lineWidth = 6;
      ctx.stroke();
      vesselFront(ctx, 39.5, -58, 26, -11, c, { bulge: 6, seed });
      // gold band & dots
      ctx.strokeStyle = PALETTE.gold;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, -51, 38, 5.5, 0, 0.12, Math.PI - 0.12);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = tint(c.body, 0.6);
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.arc(k * 11, -33 + Math.abs(k) * 1.5, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'mug': {
      ctx.strokeStyle = shade(c.body, 0.3);
      ctx.lineWidth = 11;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(30, -54);
      ctx.bezierCurveTo(50, -54, 50, -20, 30, -20);
      ctx.stroke();
      ctx.strokeStyle = c.body;
      ctx.lineWidth = 7;
      ctx.stroke();
      vesselFront(ctx, 31, -65, 31, 0, c, { ry: 5, seed });
      ctx.fillStyle = shade(c.body, 0.15);
      ctx.fillRect(-29, -40, 58, 7);
      ctx.fillStyle = tint(c.body, 0.5);
      ctx.fillRect(-29, -30, 58, 3);
      break;
    }
    case 'boot':
      bootFront(ctx, c);
      break;
    case 'box':
      boxFront(ctx, c, seed);
      break;
    case 'shoebox':
      shoeboxFront(ctx, c);
      break;
    case 'fruitbowl': {
      ctx.fillStyle = shade(c.body, 0.12);
      roundRect(ctx, -21, -9, 42, 9, 3);
      ctx.fill();
      vesselFront(ctx, 62, -45, 28, -8, c, { bulge: 10, ry: 9, seed });
      ctx.strokeStyle = tint(c.body, 0.55);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let k = -4; k <= 4; k++) {
        const x = k * 11;
        const y = -26 + Math.abs(k) * k * 0.15;
        ctx.moveTo(x - 4, y);
        ctx.quadraticCurveTo(x, y - 5, x + 4, y);
      }
      ctx.stroke();
      break;
    }
    case 'sink':
      sinkFront(ctx, c);
      break;
    case 'pot': {
      vesselFront(ctx, 36.5, -52, 27, 0, c, { ry: 5, glazeOn: false, seed });
      // rim band
      ctx.fillStyle = tint(c.body, 0.1);
      ctx.strokeStyle = shade(c.body, 0.3);
      ctx.lineWidth = LW;
      roundRect(ctx, -38, -64, 76, 14, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(62,58,79,0.12)';
      ctx.fillRect(-35, -51, 70, 3);
      break;
    }
    case 'basket':
      basketFront(ctx, c);
      break;
    case 'saucepan': {
      ctx.strokeStyle = '#4A4458';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(47, -38);
      ctx.lineTo(98, -46);
      ctx.stroke();
      ctx.strokeStyle = '#6A6380';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(60, -41);
      ctx.lineTo(94, -46);
      ctx.stroke();
      vesselFront(ctx, 47.5, -45, 47.5, 0, c, { ry: 7, seed });
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-44, -30, 88, 4);
      break;
    }
    case 'vase':
      vaseFront(ctx, c);
      break;
    case 'bucket': {
      vesselFront(ctx, 38, -61, 29, 0, c, { ry: 6, seed });
      ctx.strokeStyle = shade(c.body, 0.2);
      ctx.lineWidth = 2;
      for (const y of [-46, -24]) {
        ctx.beginPath();
        ctx.moveTo(-36 + (y + 61) * 0.12, y);
        ctx.quadraticCurveTo(0, y + 5, 36 - (y + 61) * 0.12, y);
        ctx.stroke();
      }
      ctx.fillStyle = shade(c.body, 0.35);
      ctx.beginPath();
      ctx.arc(-35, -52, 3, 0, Math.PI * 2);
      ctx.arc(35, -52, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'slipper':
      slipperFront(ctx, c);
      break;
    case 'mixingbowl': {
      ctx.fillStyle = shade(c.body, 0.12);
      roundRect(ctx, -19, -7, 38, 7, 3);
      ctx.fill();
      vesselFront(ctx, 53, -51, 26, -6, c, { bulge: 8, ry: 8.5, seed });
      ctx.strokeStyle = PALETTE.teacup;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(0, -44, 50, 7, 0, 0.15, Math.PI - 0.15);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function boxBack(ctx: Ctx, c: Colors): void {
  // inside back wall and far flap
  ctx.fillStyle = c.inner;
  ctx.beginPath();
  ctx.moveTo(-48, -66);
  ctx.lineTo(-40, -74);
  ctx.lineTo(40, -74);
  ctx.lineTo(48, -66);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(c.body, 0.15);
  ctx.beginPath();
  ctx.moveTo(-40, -74);
  ctx.lineTo(-30, -92);
  ctx.lineTo(30, -92);
  ctx.lineTo(40, -74);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shade(c.body, 0.35);
  ctx.lineWidth = LW;
  ctx.stroke();
}

function boxFront(ctx: Ctx, c: Colors, seed: number): void {
  const out = shade(c.body, 0.35);
  // side flaps
  for (const s of [-1, 1]) {
    ctx.fillStyle = tint(c.body, 0.08);
    ctx.beginPath();
    ctx.moveTo(s * 49, -66);
    ctx.lineTo(s * 68, -86);
    ctx.lineTo(s * 62, -90);
    ctx.lineTo(s * 44, -68);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = out;
    ctx.lineWidth = LW;
    ctx.stroke();
  }
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(-50, -67);
    ctx.lineTo(50, -67);
    ctx.lineTo(50, 0);
    ctx.lineTo(-50, 0);
    ctx.closePath();
  };
  path();
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.strokeStyle = out;
  ctx.lineWidth = LW;
  ctx.stroke();
  // near flap folded down
  ctx.fillStyle = tint(c.body, 0.12);
  ctx.beginPath();
  ctx.moveTo(-50, -67);
  ctx.lineTo(50, -67);
  ctx.lineTo(46, -57);
  ctx.lineTo(-46, -57);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // tape and label
  ctx.fillStyle = 'rgba(240,226,190,0.8)';
  ctx.fillRect(-7, -57, 14, 22);
  ctx.fillStyle = 'rgba(62,58,79,0.25)';
  ctx.font = '700 9px "Baloo 2", system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('FRAGILE', 0, -18);
  ctx.strokeStyle = 'rgba(62,58,79,0.18)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-14, -26);
  ctx.lineTo(-10, -32);
  ctx.lineTo(-6, -26);
  ctx.moveTo(6, -26);
  ctx.lineTo(10, -32);
  ctx.lineTo(14, -26);
  ctx.stroke();
  void seed;
}

function shoeboxFront(ctx: Ctx, c: Colors): void {
  const out = shade(c.body, 0.35);
  // lid leaning on the back
  ctx.fillStyle = tint(c.body, 0.15);
  ctx.strokeStyle = out;
  ctx.lineWidth = LW;
  ctx.save();
  ctx.translate(30, -42);
  ctx.rotate(0.35);
  roundRect(ctx, -10, -14, 74, 14, 3);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  roundRect(ctx, -44, -44, 88, 44, 3);
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = tint(c.body, 0.45);
  ctx.fillRect(-42, -30, 84, 5);
  ctx.fillStyle = shade(c.body, 0.18);
  roundRect(ctx, -12, -22, 24, 12, 3);
  ctx.fill();
}

function bootFront(ctx: Ctx, c: Colors): void {
  const out = shade(c.body, 0.35);
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(-23.5, -69);
    ctx.ellipse(0, -69, 23.5, 5, 0, Math.PI, 0, true);
    ctx.lineTo(23.5, -36);
    ctx.quadraticCurveTo(26, -31, 36, -28);
    ctx.quadraticCurveTo(48, -25, 47, -10);
    ctx.lineTo(47, -6);
    ctx.lineTo(-23.5, -6);
    ctx.closePath();
  };
  path();
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.strokeStyle = out;
  ctx.lineWidth = LW;
  ctx.stroke();
  // sole
  ctx.fillStyle = shade(c.body, 0.45);
  roundRect(ctx, -25, -8, 73, 8, 3);
  ctx.fill();
  // rim band and toe cap
  ctx.strokeStyle = tint(c.body, 0.3);
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.ellipse(0, -69, 21.8, 4, 0, 0, Math.PI);
  ctx.stroke();
  ctx.fillStyle = shade(c.body, 0.12);
  ctx.beginPath();
  ctx.moveTo(31, -27);
  ctx.quadraticCurveTo(48, -25, 47, -8);
  ctx.lineTo(29, -8);
  ctx.closePath();
  ctx.fill();
  glaze(ctx, -15, -62, 8, 38, 0.45);
}

function sinkBack(ctx: Ctx, c: Colors): void {
  // faucet on the wall behind
  ctx.fillStyle = '#C9D3DC';
  ctx.strokeStyle = '#8D99A6';
  ctx.lineWidth = LW;
  roundRect(ctx, -6, -176, 12, 34, 4);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -172);
  ctx.quadraticCurveTo(28, -176, 30, -158);
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#8D99A6';
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#DDE5EC';
  ctx.stroke();
  ctx.fillStyle = '#E9A6A0';
  ctx.beginPath();
  ctx.arc(-14, -168, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.teacup;
  ctx.beginPath();
  ctx.arc(14, -170, 5, 0, Math.PI * 2);
  ctx.fill();
  vesselBack(ctx, 75, -139, mix(c.inner, '#C8D6E0', 0.4), c.rim, 11);
}

function sinkFront(ctx: Ctx, c: Colors): void {
  const out = shade(c.body, 0.3);
  // pedestal
  ctx.fillStyle = c.body;
  ctx.strokeStyle = out;
  ctx.lineWidth = LW;
  ctx.beginPath();
  ctx.moveTo(-15, -86);
  ctx.quadraticCurveTo(-11, -40, -22, 0);
  ctx.lineTo(22, 0);
  ctx.quadraticCurveTo(11, -40, 15, -86);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(62,58,79,0.1)';
  ctx.fillRect(3, -84, 8, 80);
  vesselFront(ctx, 76, -139, 32, -84, c, { bulge: 14, ry: 11, outline: '#B9C2CC', seed: 5 });
}

function basketFront(ctx: Ctx, c: Colors): void {
  const out = shade(c.body, 0.4);
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(-61, -73);
    ctx.ellipse(0, -73, 61, 9, 0, Math.PI, 0, true);
    ctx.lineTo(54, -3);
    ctx.quadraticCurveTo(54, 0, 50, 0);
    ctx.lineTo(-50, 0);
    ctx.quadraticCurveTo(-54, 0, -54, -3);
    ctx.closePath();
  };
  path();
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.save();
  path();
  ctx.clip();
  // weave
  ctx.strokeStyle = shade(c.body, 0.2);
  ctx.lineWidth = 2;
  for (let y = -66; y < 0; y += 8) {
    for (let x = -60; x < 60; x += 12) {
      const off = ((y / 8) | 0) % 2 === 0 ? 0 : 6;
      ctx.beginPath();
      ctx.moveTo(x + off, y);
      ctx.quadraticCurveTo(x + off + 6, y + 4, x + off + 12, y);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.strokeStyle = out;
  ctx.lineWidth = LW;
  path();
  ctx.stroke();
  ctx.strokeStyle = tint(c.body, 0.25);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(0, -73, 59, 7.5, 0, 0, Math.PI);
  ctx.stroke();
  // handles
  for (const s of [-1, 1]) {
    ctx.fillStyle = shade(c.body, 0.5);
    roundRect(ctx, s * 38 - 9, -60, 18, 7, 3.5);
    ctx.fill();
  }
}

function vaseFront(ctx: Ctx, c: Colors): void {
  const out = shade(c.body, 0.32);
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(-23.5, -97);
    ctx.ellipse(0, -97, 23.5, 4, 0, Math.PI, 0, true);
    ctx.quadraticCurveTo(20, -88, 21.5, -80);
    ctx.quadraticCurveTo(38, -66, 36, -50);
    ctx.quadraticCurveTo(35, -14, 30, -3);
    ctx.quadraticCurveTo(29, 0, 25, 0);
    ctx.lineTo(-25, 0);
    ctx.quadraticCurveTo(-29, 0, -30, -3);
    ctx.quadraticCurveTo(-35, -14, -36, -50);
    ctx.quadraticCurveTo(-38, -66, -21.5, -80);
    ctx.quadraticCurveTo(-20, -88, -23.5, -97);
    ctx.closePath();
  };
  path();
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.save();
  path();
  ctx.clip();
  ctx.fillStyle = tint(c.body, 0.65);
  ctx.fillRect(-40, -46, 80, 14);
  ctx.fillStyle = c.body;
  for (let k = -3; k <= 3; k++) {
    ctx.beginPath();
    ctx.arc(k * 10, -39, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = out;
  ctx.lineWidth = LW;
  path();
  ctx.stroke();
  ctx.strokeStyle = c.rim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, -97, 21.8, 2.8, 0, 0, Math.PI);
  ctx.stroke();
  glaze(ctx, -26, -70, 10, 40, 0.5);
}

function slipperFront(ctx: Ctx, c: Colors): void {
  const out = shade(c.body, 0.3);
  // sole
  ctx.fillStyle = tint(c.body, 0.5);
  ctx.strokeStyle = out;
  ctx.lineWidth = LW;
  roundRect(ctx, -40, -7, 83, 7, 3.5);
  ctx.fill();
  ctx.stroke();
  // heel cup (front part low)
  ctx.fillStyle = c.body;
  ctx.beginPath();
  ctx.moveTo(-39, -6);
  ctx.quadraticCurveTo(-41, -26, -33, -27);
  ctx.quadraticCurveTo(-30, -16, -16, -12);
  ctx.lineTo(-16, -6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // toe cover
  ctx.beginPath();
  ctx.moveTo(-18, -6);
  ctx.quadraticCurveTo(-8, -20, 4, -29);
  ctx.quadraticCurveTo(30, -30, 40, -18);
  ctx.quadraticCurveTo(45, -10, 43, -6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // fuzz
  ctx.strokeStyle = tint(c.body, 0.45);
  ctx.lineWidth = 1.6;
  for (let k = 0; k < 9; k++) {
    const x = -6 + k * 5.5;
    const y = -26 + Math.abs(k - 5) * 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 1.5, y - 3.5);
    ctx.stroke();
  }
  // pom-pom
  ctx.fillStyle = '#FFF7EE';
  ctx.beginPath();
  ctx.arc(30, -27, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = out;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Furniture (back layer only)

const WOOD = PALETTE.oak;

function plank(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, seed: number): void {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.fillStyle = tint(color, 0.3);
  ctx.fillRect(x + 3, y + 1.5, w - 6, 2.5);
  ctx.fillStyle = shade(color, 0.12);
  ctx.fillRect(x + 3, y + h - 3, w - 6, 2);
  ctx.strokeStyle = shade(color, 0.12);
  ctx.lineWidth = 1;
  for (let k = 0; k < Math.floor(w / 40); k++) {
    const gx = x + 10 + hash01(seed, k) * (w - 20);
    ctx.beginPath();
    ctx.moveTo(gx, y + 5);
    ctx.quadraticCurveTo(gx + 8, y + h * 0.5, gx + 16, y + h - 4);
    ctx.stroke();
  }
  ctx.strokeStyle = shade(color, 0.32);
  ctx.lineWidth = 1.6;
  roundRect(ctx, x, y, w, h, 4);
  ctx.stroke();
}

export function drawFurniture(ctx: Ctx, p: Prop, theme: { accent: string; cabinet: string }): void {
  const t = p.type as FurnitureType;
  ctx.save();
  const x0 = p.x0;
  const x1 = p.x1;
  const y = p.y;
  const seed = p.uid * 7;
  // floor shadow
  if (t !== 'shelf' && t !== 'sill' && t !== 'ramp') softShadow(ctx, (x0 + x1) / 2, FLOOR_Y + 2, (x1 - x0) * 0.55, 7, 0.22);
  switch (t) {
    case 'shelf': {
      // brackets
      ctx.fillStyle = shade(WOOD, 0.25);
      for (const bx of [x0 + 18, x1 - 18]) {
        if (bx < 4 || bx > 356) continue;
        ctx.beginPath();
        ctx.moveTo(bx - 4, y + 10);
        ctx.lineTo(bx + 4, y + 10);
        ctx.lineTo(bx + 4, y + 30);
        ctx.quadraticCurveTo(bx - 2, y + 18, bx - 4, y + 10);
        ctx.fill();
      }
      softShadow(ctx, (x0 + x1) / 2, y + 22, (x1 - x0) * 0.5, 6, 0.12);
      plank(ctx, x0, y, x1 - x0, 12, WOOD, seed);
      break;
    }
    case 'sill': {
      plank(ctx, x0, y, x1 - x0, 10, '#F6F0E6', seed);
      break;
    }
    case 'counter': {
      const cab = theme.cabinet;
      ctx.fillStyle = cab;
      ctx.fillRect(x0, y + 12, x1 - x0, FLOOR_Y - y - 12);
      // doors
      const doors = Math.max(1, Math.round((x1 - x0) / 62));
      const dw = (x1 - x0 - 8) / doors;
      for (let k = 0; k < doors; k++) {
        const dx = x0 + 4 + k * dw;
        ctx.fillStyle = tint(cab, 0.12);
        roundRect(ctx, dx + 3, y + 30, dw - 6, FLOOR_Y - y - 52, 5);
        ctx.fill();
        ctx.strokeStyle = shade(cab, 0.2);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = shade(cab, 0.45);
        ctx.beginPath();
        ctx.arc(dx + (k % 2 === 0 ? dw - 12 : 12), y + 44, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // drawer strip
      ctx.fillStyle = shade(cab, 0.08);
      ctx.fillRect(x0 + 2, y + 15, x1 - x0 - 4, 11);
      ctx.fillStyle = shade(cab, 0.3);
      ctx.fillRect(x0, FLOOR_Y - 14, x1 - x0, 14);
      ctx.strokeStyle = shade(cab, 0.3);
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x0, y + 12, x1 - x0, FLOOR_Y - y - 12);
      plank(ctx, x0 - 6, y, x1 - x0 + 12, 14, '#E9D5B8', seed);
      break;
    }
    case 'table': {
      ctx.fillStyle = shade(WOOD, 0.1);
      for (const [lx, dir] of [
        [x0 + 14, -1],
        [x1 - 14, 1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(lx - 5, y + 10);
        ctx.lineTo(lx + 5, y + 10);
        ctx.lineTo(lx + 2 + dir * 3, FLOOR_Y);
        ctx.lineTo(lx - 3 + dir * 3, FLOOR_Y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = shade(WOOD, 0.2);
      ctx.fillRect(x0 + 16, y + 10, x1 - x0 - 32, 8);
      plank(ctx, x0, y, x1 - x0, 12, WOOD, seed);
      break;
    }
    case 'stool': {
      const col = theme.accent;
      ctx.strokeStyle = shade(WOOD, 0.15);
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0 + 9, y + 10);
      ctx.lineTo(x0 + 4, FLOOR_Y - 2);
      ctx.moveTo(x1 - 9, y + 10);
      ctx.lineTo(x1 - 4, FLOOR_Y - 2);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x0 + 8, (y + FLOOR_Y) / 2 + 10);
      ctx.lineTo(x1 - 8, (y + FLOOR_Y) / 2 + 10);
      ctx.stroke();
      ctx.fillStyle = col;
      roundRect(ctx, x0, y, x1 - x0, 12, 6);
      ctx.fill();
      ctx.strokeStyle = shade(col, 0.3);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = tint(col, 0.35);
      ctx.fillRect(x0 + 6, y + 2, x1 - x0 - 12, 2.5);
      break;
    }
    case 'fridge': {
      const col = '#CFE6DD';
      roundRect(ctx, x0, y, x1 - x0, FLOOR_Y - y, [14, 14, 4, 4]);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = shade(col, 0.3);
      ctx.lineWidth = 1.8;
      ctx.stroke();
      const split = y + (FLOOR_Y - y) * 0.34;
      ctx.beginPath();
      ctx.moveTo(x0 + 2, split);
      ctx.lineTo(x1 - 2, split);
      ctx.stroke();
      ctx.fillStyle = '#E8EEF2';
      ctx.strokeStyle = '#9AA6B2';
      for (const [hy, hh] of [
        [y + 20, (split - y) * 0.55],
        [split + 16, 70],
      ]) {
        roundRect(ctx, x0 + 10, hy, 7, hh, 3.5);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      roundRect(ctx, x1 - 16, y + 12, 6, FLOOR_Y - y - 40, 3);
      ctx.fill();
      // little magnets
      ctx.fillStyle = PALETTE.ginger;
      ctx.beginPath();
      ctx.arc(x0 + (x1 - x0) * 0.6, split + 30, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.teacup;
      ctx.fillRect(x0 + (x1 - x0) * 0.45, split + 46, 14, 18);
      break;
    }
    case 'cabinet': {
      const col = theme.cabinet;
      plank(ctx, x0 - 3, y, x1 - x0 + 6, 10, shade(col, 0.05), seed);
      ctx.fillStyle = col;
      ctx.fillRect(x0, y + 10, x1 - x0, FLOOR_Y - y - 22);
      ctx.strokeStyle = shade(col, 0.3);
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x0, y + 10, x1 - x0, FLOOR_Y - y - 22);
      const rows = Math.max(2, Math.round((FLOOR_Y - y - 22) / 40));
      const rh = (FLOOR_Y - y - 26) / rows;
      for (let k = 0; k < rows; k++) {
        const ry = y + 13 + k * rh;
        ctx.fillStyle = tint(col, 0.1);
        roundRect(ctx, x0 + 5, ry, x1 - x0 - 10, rh - 5, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = shade(col, 0.45);
        roundRect(ctx, (x0 + x1) / 2 - 8, ry + rh / 2 - 4, 16, 4, 2);
        ctx.fill();
      }
      ctx.fillStyle = shade(col, 0.3);
      ctx.fillRect(x0 + 4, FLOOR_Y - 12, 6, 12);
      ctx.fillRect(x1 - 10, FLOOR_Y - 12, 6, 12);
      break;
    }
    case 'bookcase': {
      const col = shade(WOOD, 0.25);
      ctx.fillStyle = col;
      ctx.fillRect(x0, y, x1 - x0, FLOOR_Y - y);
      const shelves = Math.max(2, Math.round((FLOOR_Y - y) / 56));
      const sh = (FLOOR_Y - y - 10) / shelves;
      for (let k = 0; k < shelves; k++) {
        const sy = y + 6 + k * sh;
        ctx.fillStyle = shade(col, 0.35);
        ctx.fillRect(x0 + 6, sy, x1 - x0 - 12, sh - 6);
        let bx = x0 + 8;
        let i = 0;
        while (bx < x1 - 14) {
          const bw = 6 + hash01(seed + k, i) * 7;
          const bh = sh - 12 - hash01(seed + k, i + 50) * 14;
          const cols = [PALETTE.teacup, PALETTE.rose, PALETTE.butter, PALETTE.sage, PALETTE.cream, PALETTE.terracotta, PALETTE.lilac];
          ctx.fillStyle = cols[Math.floor(hash01(seed + k, i + 99) * cols.length)];
          ctx.fillRect(bx, sy + sh - 6 - bh, Math.min(bw, x1 - 8 - bx), bh);
          bx += bw + 1;
          i++;
        }
      }
      plank(ctx, x0 - 3, y - 2, x1 - x0 + 6, 10, WOOD, seed);
      break;
    }
    case 'crate': {
      const col = '#D9B98C';
      ctx.fillStyle = col;
      ctx.fillRect(x0, y, x1 - x0, FLOOR_Y - y);
      ctx.strokeStyle = shade(col, 0.3);
      ctx.lineWidth = 1.6;
      const slats = Math.max(2, Math.round((FLOOR_Y - y) / 18));
      for (let k = 1; k < slats; k++) {
        const sy = y + ((FLOOR_Y - y) * k) / slats;
        ctx.beginPath();
        ctx.moveTo(x0, sy);
        ctx.lineTo(x1, sy);
        ctx.stroke();
      }
      ctx.strokeRect(x0, y, x1 - x0, FLOOR_Y - y);
      ctx.fillStyle = shade(col, 0.15);
      ctx.fillRect(x0 + 4, y, 6, FLOOR_Y - y);
      ctx.fillRect(x1 - 10, y, 6, FLOOR_Y - y);
      plank(ctx, x0 - 2, y - 2, x1 - x0 + 4, 9, tint(col, 0.15), seed);
      break;
    }
    case 'ramp': {
      const r = p.ramp!;
      ctx.lineCap = 'round';
      ctx.strokeStyle = shade(WOOD, 0.35);
      ctx.lineWidth = 13.5;
      ctx.beginPath();
      ctx.moveTo(r.ax, r.ay);
      ctx.lineTo(r.bx, r.by);
      ctx.stroke();
      ctx.strokeStyle = WOOD;
      ctx.lineWidth = 10.5;
      ctx.stroke();
      ctx.strokeStyle = tint(WOOD, 0.35);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(r.ax, r.ay - 3.5);
      ctx.lineTo(r.bx, r.by - 3.5);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** Soft contact shadow under a container sitting on a surface. */
export function containerShadow(ctx: Ctx, p: Prop): void {
  const w = (p.x1 - p.x0) * 0.5;
  softShadow(ctx, p.x, p.y + 1, w * 0.9, 5, 0.22);
}
