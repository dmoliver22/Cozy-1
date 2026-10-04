// Painted containers, in two layers: the "back" (the inside and the far rim)
// goes under the cats, the "front" (body and near rim) over them, so a poured
// cat really looks like it's sitting in the teacup. Fronts never paint above
// the near rim over the opening. Vessels use the kit in propKit.ts; drawing is
// in local space (origin bottom centre, up is -y), mirrored for flipped props
// while the light stays upper left.

import type { ContainerType, Prop } from '../game/props';
import { PALETTE, edgeShade, glint, hash01, lightGradient, lightOf, lineOf, mix, rgba, roundRect, shadowOf, softShadow, specular, type Box, type Ctx } from './paint';
import {
  aroundRing,
  band,
  edgeShadeL,
  inkPattern,
  kraftPaint,
  lightDir,
  litFrame,
  lsign,
  makeVessel,
  memo,
  outline,
  paintBody,
  paintInside,
  paintNearRim,
  resBucket,
  restShadow,
  ring,
  rivet,
  shadeCylinder,
  shadeDown,
  texPaint,
  tube,
  vesselPath,
  type PathFn,
  type Vessel,
} from './propKit';

const TINTS: Record<ContainerType, string[]> = {
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

const TAU = Math.PI * 2;
const PORCELAIN = '#F8F1E6';
const GOLD = '#D7AC57';
const CLAY = '#E7D2B3';

interface Look {
  base: string;
  /** Index of the tint within the container's palette. */
  v: number;
  /** Stable per prop, for deterministic decoration. */
  seed: number;
}

function lookOf(p: Prop): Look {
  const list = TINTS[p.type as ContainerType] ?? [PALETTE.teacup];
  const v = ((p.tint % list.length) + list.length) % list.length;
  return { base: list[v], v, seed: p.uid * 13 + p.tint };
}

function local(ctx: Ctx, p: Prop): void {
  ctx.translate(p.x, p.y);
  ctx.scale(p.flip ? -p.scale : p.scale, p.scale);
}

type Painter = (ctx: Ctx, l: Look) => void;

interface Art {
  back: Painter;
  front: Painter;
  /** Contact footprint: centre x, half width, base ellipse ry; plus an optional broad overhang shadow half width. */
  foot: [number, number, number, number?];
  /** Local extent of everything painted (x0, y0, x1, y1), for the sprite cache. */
  ext: [number, number, number, number];
}

// ---------------------------------------------------------------------------
// Shared bits

/** A painted line around the vessel at height y (front half), e.g. a gilded band. */
function ringLine(ctx: Ctx, v: Vessel, y: number, w: number, color: string): void {
  const r = ring(v, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.ellipse(0, y, r.rx + 1.5, r.ry, 0, 0, Math.PI);
  ctx.stroke();
}

/** Filled band around the vessel between heights y0 < y1. */
function ringBand(ctx: Ctx, v: Vessel, y0: number, y1: number, color: string): void {
  const a = ring(v, y0);
  const b = ring(v, y1);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.rx + 2, y0);
  ctx.ellipse(0, y0, a.rx + 2, a.ry, 0, 0, Math.PI, false);
  ctx.lineTo(-b.rx - 2, y1);
  ctx.ellipse(0, y1, b.rx + 2, b.ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
}

/** A raised ring (rib) pressed into a metal body: lit top edge, shaded underside. */
function rib(ctx: Ctx, v: Vessel, y: number, base: string): void {
  const r = ring(v, y);
  const b: Box = { x0: -r.rx, y0: y - 3, x1: r.rx, y1: y + r.ry + 3 };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = lightGradient(ctx, b, [[0, rgba(shadowOf(base, 0.5), 0.35)], [1, rgba(shadowOf(base, 0.6), 0.7)]]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, y + 1.1, r.rx + 1, r.ry, 0, 0, Math.PI);
  ctx.stroke();
  ctx.strokeStyle = lightGradient(ctx, b, [[0, rgba(lightOf(base, 0.8), 0.85)], [0.6, rgba(lightOf(base, 0.5), 0.45)], [1, rgba(lightOf(base, 0.3), 0.15)]]);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(0, y - 0.2, r.rx + 1, r.ry, 0, 0, Math.PI);
  ctx.stroke();
  ctx.restore();
}

/** Speckled stoneware / terracotta flecks. */
function speckle(ctx: Ctx, path: PathFn, alpha: number, scale = 0.5): void {
  texPaint(ctx, path, 'speckle', { alpha: alpha * 0.85, scale });
}

/** Little five-petal flower with two leaves, squashed by `s` as it turns away. */
function sprig(ctx: Ctx, x: number, y: number, s: number, a: number, c: { petal: string; heart: string; leaf: string }, size = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * size, size);
  ctx.globalAlpha *= a;
  ctx.fillStyle = c.leaf;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sx * 3.3, 2.5, 2.3, 0.95, sx * 0.55, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = c.petal;
  for (let k = 0; k < 5; k++) {
    const t = (k / 5) * TAU - Math.PI / 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(t) * 1.75, Math.sin(t) * 1.75, 1.45, 1.15, t, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = c.heart;
  ctx.beginPath();
  ctx.arc(0, 0, 0.9, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** An almond-shaped painted leaf at (x, y) pointing along `ang`. */
function leaf(ctx: Ctx, x: number, y: number, len: number, wid: number, ang: number, s = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, 1);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -wid, len, 0);
  ctx.quadraticCurveTo(len * 0.5, wid, 0, 0);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Teacup: porcelain cup on a saucer, gilded bands and a garland of flowers.

const CUP = makeVessel('teacup', [[-58, 40], [-53, 39.9], [-45, 38.7], [-37, 36.3], [-29, 32.5], [-22, 27.7], [-16.5, 22.6]], { lip: 2.8, lipC: 1.9 });
const CUP_FOOT = makeVessel('teacup.foot', [[-16.5, 18.2], [-12.5, 18.8], [-9.6, 20.4]]);
const CUP_FLOWERS = [
  { petal: '#FBF4EA', heart: GOLD, leaf: '#A3BF9B' },
  { petal: '#F4C9C4', heart: '#F4D88A', leaf: '#6E9E86' },
  { petal: '#FBF4EA', heart: GOLD, leaf: '#9CB993' },
  { petal: '#A9C2E2', heart: '#FBF4EA', leaf: '#94B28C' },
];
const cupRim = (base: string): string => lightOf(mix(base, PORCELAIN, 0.45), 0.25);

function saucer(ctx: Ctx, base: string): void {
  litFrame(ctx, () => {
    const cy = -9.6;
    const rx = 46;
    const ry = 7.4;
    const th = 2.3;
    const ob: Box = { x0: -rx, y0: cy - ry, x1: rx, y1: cy + ry + th };
    const sil = (): void => {
      ctx.beginPath();
      ctx.ellipse(0, cy, rx, ry, 0, Math.PI, TAU);
      ctx.lineTo(rx, cy + th);
      ctx.ellipse(0, cy + th, rx, ry, 0, 0, Math.PI);
      ctx.closePath();
    };
    sil();
    ctx.fillStyle = lightGradient(ctx, ob, [[0, shadowOf(base, 0.12)], [0.6, shadowOf(base, 0.3)], [1, shadowOf(base, 0.45)]]);
    ctx.fill();
    const top = (): void => {
      ctx.beginPath();
      ctx.ellipse(0, cy, rx, ry, 0, 0, TAU);
    };
    top();
    ctx.fillStyle = lightGradient(ctx, ob, [[0, lightOf(base, 0.45)], [0.55, base], [1, shadowOf(base, 0.14)]]);
    ctx.fill();
    // the well dips: shaded just inside its lit edge, catching light on the far side
    const wr = 0.64;
    const well = (): void => {
      ctx.beginPath();
      ctx.ellipse(0, cy + 0.3, rx * wr, ry * wr, 0, 0, TAU);
    };
    const wb: Box = { x0: -rx * wr, y0: cy - ry * wr, x1: rx * wr, y1: cy + ry * wr };
    ctx.save();
    well();
    ctx.clip();
    ctx.lineWidth = 3;
    ctx.strokeStyle = lightGradient(ctx, wb, [[0, rgba(shadowOf(base, 0.45), 0.45)], [0.5, rgba(shadowOf(base, 0.45), 0)], [0.6, rgba(lightOf(base, 0.6), 0)], [1, rgba(lightOf(base, 0.6), 0.55)]]);
    well();
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = rgba(GOLD, 0.9);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.ellipse(0, cy, rx - 3, ry - 0.5, 0, 0, TAU);
    ctx.stroke();
    // the cup's own shadow on the saucer
    softShadow(ctx, 4, cy + 0.9, 26, 4.4, 0.3);
    ctx.strokeStyle = rgba(lightOf(base, 0.9), 0.75);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, cy, rx - 0.7, ry - 0.25, 0, Math.PI * 0.55, Math.PI * 0.95);
    ctx.stroke();
    glint(ctx, -31, cy - 5.1, 0.85, 0.8);
    outline(ctx, sil, ob, lineOf(base), 1.2);
  });
}

function teacupBack(ctx: Ctx, l: Look): void {
  saucer(ctx, mix(l.base, PORCELAIN, 0.3));
  paintInside(ctx, CUP, { inner: mix(PORCELAIN, l.base, 0.3), rimTop: cupRim(l.base), line: lineOf(l.base), depth: 0.7, gloss: 0.65 });
}

function teacupFront(ctx: Ctx, l: Look): void {
  const line = lineOf(l.base);
  const fl = CUP_FLOWERS[l.v % CUP_FLOWERS.length];
  tube(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(35, -50.5);
      ctx.bezierCurveTo(47.5, -53.5, 53, -44.5, 49, -36.5);
      ctx.bezierCurveTo(46, -30.5, 38.5, -27.5, 29, -24.5);
    },
    6,
    l.base,
    { line, spec: 0.7 },
  );
  paintBody(ctx, CUP_FOOT, { base: shadowOf(l.base, 0.04), finish: 'gloss', line, decorate: () => ringLine(ctx, CUP_FOOT, -11.8, 0.9, GOLD), outlineW: 1.2 });
  paintBody(ctx, CUP, {
    base: l.base,
    finish: 'gloss',
    line,
    mottle: 0.22,
    decorate: () => {
      ringLine(ctx, CUP, -52.4, 1.6, GOLD);
      ringLine(ctx, CUP, -49.8, 0.6, GOLD);
      aroundRing(CUP, -41, 9, 0.25, (x, y, s, f) => sprig(ctx, x, y, s, f, fl, 1.18));
      ctx.fillStyle = fl.petal;
      aroundRing(CUP, -41, 9, 0.75, (x, y, s, f) => {
        ctx.globalAlpha = f;
        ctx.beginPath();
        ctx.ellipse(x, y - 1, 0.8 * s, 0.8, 0, 0, TAU);
        ctx.ellipse(x, y + 1.6, 0.6 * s, 0.6, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    },
    under: [-36, -12, 0.32],
    bounce: 0.14,
    spec: [[0.62, -51.5, -22, 3.2, 0.78]],
    glints: [[-25.5, -47.5, 1.1]],
  });
  paintNearRim(ctx, CUP, { top: cupRim(l.base), line, gloss: 0.8 });
}

// ---------------------------------------------------------------------------
// Mug: speckled stoneware, glaze dipped short of a raw clay foot, a paw print.

const MUG = makeVessel('mug', [[-66, 31], [-60, 31.2], [-40, 31.5], [-18, 31.3], [-8.5, 30.7], [-4.9, 30.1]], { lip: 3.5, lipC: 2.2 });
const MUG_PAW = ['#D98A63', '#F7E9D4', '#F7EEDF', '#F7EEDF'];

/** Wavy edge of a dipped glaze around the vessel at height y, with a few drips. */
function glazeEdge(v: Vessel, y: number, seed: number): [number, number][] {
  const r = ring(v, y);
  const drips = [0, 1, 2].map((k) => ({ x: (hash01(seed, k) - 0.5) * r.rx * 1.5, a: 1.4 + hash01(seed, k + 5) * 2.6, w: 1.6 + hash01(seed, k + 9) * 1.8 }));
  const pts: [number, number][] = [];
  for (let x = -r.rx - 2; x <= r.rx + 2; x += 1) {
    const c = Math.sqrt(Math.max(0, 1 - (x / r.rx) ** 2));
    let yy = y + r.ry * c + Math.sin(x * 0.45 + seed) * 0.35;
    for (const d of drips) yy += d.a * Math.exp(-(((x - d.x) / d.w) ** 2));
    pts.push([x, yy]);
  }
  return pts;
}

function paw(ctx: Ctx, x: number, y: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-4.2, 2.6);
  ctx.bezierCurveTo(-5.2, -1.2, -2, -2.6, 0, -2.6);
  ctx.bezierCurveTo(2, -2.6, 5.2, -1.2, 4.2, 2.6);
  ctx.bezierCurveTo(3.4, 4.6, 1.2, 3.6, 0, 3.6);
  ctx.bezierCurveTo(-1.2, 3.6, -3.4, 4.6, -4.2, 2.6);
  ctx.fill();
  for (const [tx, ty, r] of [
    [-5, -4.4, 1.45],
    [-1.8, -6.5, 1.6],
    [1.8, -6.5, 1.6],
    [5, -4.4, 1.45],
  ]) {
    ctx.beginPath();
    ctx.ellipse(tx, ty, r, r * 1.22, tx * 0.08, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function mugBack(ctx: Ctx, l: Look): void {
  paintInside(ctx, MUG, { inner: mix(l.base, PORCELAIN, 0.2), rimTop: lightOf(l.base, 0.5), line: lineOf(l.base), depth: 0.72, gloss: 0.55 });
}

function mugFront(ctx: Ctx, l: Look): void {
  const line = lineOf(l.base);
  tube(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(28.5, -56.5);
      ctx.bezierCurveTo(47.5, -58.5, 49, -25, 28.5, -22.5);
    },
    7.4,
    l.base,
    { line, spec: 0.6 },
  );
  const edge = glazeEdge(MUG, -10.5, l.seed);
  paintBody(ctx, MUG, {
    base: l.base,
    finish: 'gloss',
    line,
    mottle: 0.16,
    decorate: () => {
      ctx.fillStyle = CLAY;
      ctx.beginPath();
      edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineTo(40, 8);
      ctx.lineTo(-40, 8);
      ctx.closePath();
      ctx.fill();
      // glaze pools a little darker along its edge
      ctx.strokeStyle = rgba(shadowOf(l.base, 0.35), 0.65);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      edge.forEach(([x, y], i) => (i ? ctx.lineTo(x, y - 0.4) : ctx.moveTo(x, y - 0.4)));
      ctx.stroke();
      paw(ctx, 0, -35, MUG_PAW[l.v % MUG_PAW.length]);
    },
    texture: () => speckle(ctx, () => vesselPath(ctx, MUG), 0.26, 0.6),
    under: [-24, -1, 0.18],
    bounce: 0.15,
    spec: [[0.6, -61, -15, 3, 0.72]],
    glints: [[-19.5, -57.5, 1]],
  });
  paintNearRim(ctx, MUG, { top: lightOf(l.base, 0.5), line, gloss: 0.6 });
}

// ---------------------------------------------------------------------------
// Rain boot: glossy rubber, rolled top, toe bumper, buckled strap, tread sole.

const BOOT_RIM = makeVessel('boot.rim', [[-70, 23.5], [-60, 23.5]], { lip: 3, lipC: 2.1, k: 0.18 });
/** Shading map for the boot: a cylinder down the shaft, fading to flat over the foot. */
const BOOT_SHADE = makeVessel('boot.shade', [[-75, 23.6], [-44, 23.6], [-38, 28], [-32, 45], [-24, 90], [0, 90]]);

function bootPath(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(-23.5, -70);
  ctx.ellipse(0, -70, 23.5, 23.5 * 0.18, 0, Math.PI, 0, true);
  ctx.lineTo(23.4, -41);
  ctx.bezierCurveTo(23.4, -34, 25.5, -31, 31, -30.2);
  ctx.bezierCurveTo(40.5, -29.6, 46.8, -26.5, 47.2, -17);
  ctx.lineTo(47.2, -7.5);
  ctx.lineTo(-24.4, -7.5);
  ctx.bezierCurveTo(-25, -14, -24.6, -22, -23.8, -32);
  ctx.closePath();
}

function solePath(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(-25.4, -9);
  ctx.lineTo(46.4, -9);
  ctx.quadraticCurveTo(48.9, -8.8, 48.7, -5.2);
  ctx.quadraticCurveTo(48.5, -0.2, 44.8, 0);
  ctx.lineTo(10.5, 0);
  ctx.quadraticCurveTo(8, -2.3, 4.5, -2.4);
  ctx.lineTo(-2.4, -2.4);
  ctx.lineTo(-2.9, 0);
  ctx.lineTo(-22.6, 0);
  ctx.quadraticCurveTo(-25.6, 0, -25.6, -3.2);
  ctx.closePath();
}

const BOOT_LINING = ['#E9DDC9', '#F1E3CF', '#E6DCCB', '#E8DCCB'];
/** Dark rubber soles, one per boot colour. */
const BOOT_SOLE = ['#6E5140', '#6A4B52', '#4E5E58', '#4F5674'];

function bootBack(ctx: Ctx, l: Look): void {
  const line = lineOf(l.base);
  // pull tab at the back of the shaft
  const tab = (): void => roundRect(ctx, -23.5, -80.5, 7.5, 12, 3);
  tab();
  ctx.fillStyle = shadowOf(l.base, 0.1);
  ctx.fill();
  edgeShadeL(ctx, tab, { x0: -23.5, y0: -80.5, x1: -16, y1: -68.5 }, shadowOf(l.base, 0.5), 2, 0.4, 'shadow', 2);
  ctx.fillStyle = shadowOf(l.base, 0.75);
  roundRect(ctx, -21.6, -78.4, 3.7, 4.4, 1.8);
  ctx.fill();
  outline(ctx, tab, { x0: -23.5, y0: -80.5, x1: -16, y1: -68.5 }, line, 1.1);
  paintInside(ctx, BOOT_RIM, { inner: BOOT_LINING[l.v % BOOT_LINING.length], rimTop: lightOf(l.base, 0.25), line, depth: 0.85, gloss: 0.5 });
}

function bootFront(ctx: Ctx, l: Look): void {
  const base = l.base;
  const line = lineOf(base);
  const L = lsign(ctx);
  const b: Box = { x0: -25, y0: -74, x1: 48, y1: -7 };
  const path = (): void => bootPath(ctx);
  path();
  ctx.fillStyle = base;
  ctx.fill();
  ctx.save();
  path();
  ctx.clip();
  // toe bumper and the foxing strip above the sole
  const bumper = shadowOf(base, 0.16);
  ctx.fillStyle = bumper;
  ctx.beginPath();
  ctx.moveTo(29, -40);
  ctx.quadraticCurveTo(25.5, -20, 31, -6);
  ctx.lineTo(60, -6);
  ctx.lineTo(60, -40);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-30, -13.2, 90, 6);
  ctx.strokeStyle = rgba(shadowOf(base, 0.5), 0.7);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(29, -40);
  ctx.quadraticCurveTo(25.5, -20, 31, -6);
  ctx.moveTo(-30, -13.2);
  ctx.lineTo(60, -13.2);
  ctx.stroke();
  ctx.strokeStyle = rgba(lightOf(base, 0.65), 0.7);
  ctx.beginPath();
  ctx.moveTo(30.2, -38);
  ctx.quadraticCurveTo(27, -20, 32.2, -6);
  ctx.moveTo(-30, -12.2);
  ctx.lineTo(60, -12.2);
  ctx.stroke();
  // strap with a little buckle near the top
  ctx.fillStyle = shadowOf(base, 0.16);
  ctx.beginPath();
  ctx.moveTo(4, -56.6);
  ctx.quadraticCurveTo(15, -57.4, 25, -60.2);
  ctx.lineTo(25, -55.4);
  ctx.quadraticCurveTo(15, -52.6, 4, -51.8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  texPaint(ctx, path, 'plaster', { alpha: 0.14, scale: 0.32 });
  // rubber: a cylinder down the shaft, soft form over the foot
  shadeCylinder(ctx, BOOT_SHADE, base, 'satin', path);
  const toeLight = ctx.createRadialGradient(36 + 4 * L, -27, 1, 36, -24, 16);
  toeLight.addColorStop(0, rgba(lightOf(base, 0.7), 0.5));
  toeLight.addColorStop(1, rgba(lightOf(base, 0.7), 0));
  ctx.save();
  path();
  ctx.clip();
  ctx.fillStyle = toeLight;
  ctx.fillRect(18, -40, 32, 34);
  ctx.restore();
  path();
  ctx.fillStyle = lightGradient(ctx, b, [[0, rgba(shadowOf(base, 0.6), 0)], [0.55, rgba(shadowOf(base, 0.6), 0)], [1, rgba(shadowOf(base, 0.6), 0.45)]], lightDir(ctx));
  ctx.fill();
  shadeDown(ctx, path, -20, -7, base, 0.3, -30, 50);
  // buckle (crisp, after shading)
  const bx = 13.5;
  const by = -55.8;
  ctx.save();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = shadowOf(GOLD, 0.35);
  roundRect(ctx, bx - 2.6, by - 3.6, 5.2, 7, 1.4);
  ctx.stroke();
  ctx.strokeStyle = lightOf(GOLD, 0.3);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(bx, by - 3.4);
  ctx.lineTo(bx, by + 3.3);
  ctx.stroke();
  ctx.restore();
  // rubber sheen: a broad soft band and a crisp streak on the lit side of the shaft
  const sx = -11.5 * L;
  ctx.save();
  path();
  ctx.clip();
  specular(ctx, sx, -50, 34, 4.2, Math.PI / 2, 0.22, '#FFFFFF', 0);
  specular(ctx, sx - 1.5 * L, -52, 26, 1.3, Math.PI / 2, 0.7, '#FFFFFF', 0);
  ctx.restore();
  glint(ctx, sx - 1.2 * L, -63.5, 1, 0.85);
  glint(ctx, L > 0 ? 34 : 44.5, L > 0 ? -28.4 : -24, 1, 0.8);
  outline(ctx, path, b, line, 1.35);
  // sole with tread
  const sole = BOOT_SOLE[l.v % BOOT_SOLE.length];
  const sb: Box = { x0: -25.6, y0: -9, x1: 48.9, y1: 0 };
  const sp = (): void => solePath(ctx);
  sp();
  ctx.fillStyle = sole;
  ctx.fill();
  ctx.save();
  sp();
  ctx.clip();
  ctx.strokeStyle = rgba(shadowOf(sole, 0.6), 0.85);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-27, -4.6);
  ctx.lineTo(50, -4.6);
  for (let x = -23; x < 48; x += 3.4) {
    if (x > -4 && x < 10) continue;
    ctx.moveTo(x, -2.6);
    ctx.lineTo(x + 0.6, 0.5);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = rgba(lightOf(sole, 0.55), 0.8);
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-24.6, -8.3);
  ctx.lineTo(46.2, -8.3);
  ctx.stroke();
  outline(ctx, sp, sb, lineOf(sole), 1.2, 0.6);
  paintNearRim(ctx, BOOT_RIM, { top: lightOf(base, 0.25), line, gloss: 0.7 });
}

// ---------------------------------------------------------------------------
// Cardboard box: corrugated kraft, flaps with cut edges, tape and a stamp.

/** Cut edge of corrugated board from a to b: two liners and the wavy flute between. */
function cutEdge(ctx: Ctx, ax: number, ay: number, bx: number, by: number, th: number, base: string): void {
  const len = Math.hypot(bx - ax, by - ay);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(Math.atan2(by - ay, bx - ax));
  ctx.fillStyle = shadowOf(base, 0.42);
  ctx.fillRect(0, -th / 2, len, th);
  ctx.strokeStyle = lightOf(base, 0.2);
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, -th / 2 + 0.25);
  ctx.lineTo(len, -th / 2 + 0.25);
  ctx.moveTo(0, th / 2 - 0.25);
  ctx.lineTo(len, th / 2 - 0.25);
  const p = 2.1;
  const a = th / 2 - 0.45;
  ctx.moveTo(0, 0);
  for (let x = 0, s = 1; x < len; x += p / 2, s = -s) ctx.quadraticCurveTo(x + p / 4, s * a * 2, Math.min(len, x + p / 2), 0);
  ctx.stroke();
  ctx.restore();
}

function kraftPanel(ctx: Ctx, path: PathFn, b: Box, base: string, lit: number, flute = true): void {
  path();
  ctx.fillStyle = base;
  ctx.fill();
  kraftPaint(ctx, path, 0.5, flute);
  path();
  ctx.fillStyle = lightGradient(ctx, b, [[0, rgba(lightOf(base, 0.6), 0.3 * lit)], [0.5, rgba(base, 0)], [1, rgba(shadowOf(base, 0.6), 0.3)]]);
  ctx.fill();
}

function boxBack(ctx: Ctx, l: Look): void {
  litFrame(ctx, () => {
    const base = l.base;
    const line = lineOf(base);
    // far flap, standing up and leaning back (its inside faces us)
    const flap = (): void => {
      ctx.beginPath();
      ctx.moveTo(-44.5, -78.5);
      ctx.lineTo(-41, -93);
      ctx.lineTo(41.5, -94);
      ctx.lineTo(44.5, -78.5);
      ctx.closePath();
    };
    const fb: Box = { x0: -44.5, y0: -94, x1: 44.5, y1: -78.5 };
    kraftPanel(ctx, flap, fb, lightOf(base, 0.08), 1);
    const fold = ctx.createLinearGradient(0, -83, 0, -78.5);
    fold.addColorStop(0, rgba(shadowOf(base, 0.6), 0));
    fold.addColorStop(1, rgba(shadowOf(base, 0.6), 0.35));
    flap();
    ctx.fillStyle = fold;
    ctx.fill();
    cutEdge(ctx, -41, -93, 41.5, -94, 1.9, base);
    outline(ctx, flap, fb, line, 1.2);
    // inside: the back wall above the front edge, and the two side walls
    const back = (): void => {
      ctx.beginPath();
      ctx.rect(-44.5, -78.5, 89, 11.2);
    };
    const bb: Box = { x0: -44.5, y0: -78.5, x1: 44.5, y1: -67.3 };
    back();
    const g = ctx.createLinearGradient(0, -78.5, 0, -67.3);
    g.addColorStop(0, shadowOf(base, 0.22));
    g.addColorStop(1, shadowOf(base, 0.55));
    ctx.fillStyle = g;
    ctx.fill();
    kraftPaint(ctx, back, 0.45, true);
    // the left wall's shadow falls across the back wall
    ctx.fillStyle = rgba(shadowOf(base, 0.8), 0.35);
    ctx.beginPath();
    ctx.moveTo(-44.5, -78.5);
    ctx.lineTo(-33, -78.5);
    ctx.lineTo(-24, -67.3);
    ctx.lineTo(-44.5, -67.3);
    ctx.closePath();
    ctx.fill();
    for (const s of [-1, 1]) {
      const wall = (): void => {
        ctx.beginPath();
        ctx.moveTo(s * 50, -67.3);
        ctx.lineTo(s * 44.5, -78.5);
        ctx.lineTo(s * 44.5, -67.3);
        ctx.closePath();
      };
      wall();
      ctx.fillStyle = s < 0 ? shadowOf(base, 0.62) : shadowOf(base, 0.3);
      ctx.fill();
      kraftPaint(ctx, wall, 0.4, false);
    }
    const occ = shadowOf(base, 0.85);
    band(ctx, bb, 'top', 2.2, occ, 0.5);
    band(ctx, bb, 'left', 2.2, occ, 0.45);
    band(ctx, bb, 'right', 2.2, occ, 0.45);
    // folds along the top edges catch the light
    ctx.strokeStyle = rgba(lightOf(base, 0.5), 0.8);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-44, -78.3);
    ctx.lineTo(44, -78.3);
    ctx.stroke();
  });
}

function sideFlap(ctx: Ctx, s: number, base: string): void {
  const ax = 50 * s;
  const ay = -67.5;
  const bx = 44.5 * s;
  const by = -78.5;
  const fx = 17 * s;
  const fy = -16.5;
  const face = (): void => {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + fx, by + fy);
    ctx.lineTo(ax + fx, ay + fy);
    ctx.closePath();
  };
  const b: Box = { x0: Math.min(ax + fx, bx), y0: by + fy, x1: Math.max(ax + fx, bx), y1: ay };
  // the inside of the right flap faces the light, the left one turns away
  kraftPanel(ctx, face, b, s > 0 ? lightOf(base, 0.2) : shadowOf(base, 0.1), s > 0 ? 1.2 : 0.4, false);
  // shade where it folds over the wall
  ctx.save();
  face();
  ctx.clip();
  ctx.strokeStyle = rgba(shadowOf(base, 0.6), 0.3);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
  outline(ctx, face, b, lineOf(base), 1.1);
  cutEdge(ctx, ax + 0.6 * s, ay + 0.6, ax + fx + 0.6 * s, ay + fy + 0.6, 2, base);
}

function stamp(ctx: Ctx, l: Look): void {
  const red = inkPattern(ctx, '#B45A4C', 0.3) ?? '#B45A4C';
  const ink = inkPattern(ctx, '#5A536E', 0.3) ?? '#5A536E';
  ctx.save();
  ctx.translate(-14, -24);
  ctx.rotate(-0.08 + (hash01(l.seed, 3) - 0.5) * 0.06);
  ctx.font = '800 8.2px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.min(40, ctx.measureText('FRAGILE').width + 6);
  ctx.globalAlpha *= 0.9;
  ctx.strokeStyle = red;
  ctx.lineWidth = 1.1;
  roundRect(ctx, -w / 2, -6.3, w, 12.6, 1.2);
  ctx.stroke();
  ctx.fillStyle = red;
  ctx.fillText('FRAGILE', 0, 0.7);
  ctx.restore();
  // "this way up" arrows
  ctx.save();
  ctx.translate(27, -36);
  ctx.globalAlpha *= 0.75;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  for (const ax of [-3.2, 3.2]) {
    ctx.beginPath();
    ctx.moveTo(ax, 4);
    ctx.lineTo(ax, -3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax - 2.6, -2.4);
    ctx.lineTo(ax, -6.4);
    ctx.lineTo(ax + 2.6, -2.4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(-6.5, 6.2);
  ctx.lineTo(6.5, 6.2);
  ctx.stroke();
  ctx.restore();
}

function boxFront(ctx: Ctx, l: Look): void {
  litFrame(ctx, () => {
    const base = l.base;
    const line = lineOf(base);
    for (const s of [-1, 1]) sideFlap(ctx, s, base);
    const face = (): void => {
      ctx.beginPath();
      ctx.rect(-50, -67.5, 100, 67.5);
    };
    const fb: Box = { x0: -50, y0: -67.5, x1: 50, y1: 0 };
    face();
    ctx.fillStyle = base;
    ctx.fill();
    kraftPaint(ctx, face, 0.5, true);
    stamp(ctx, l);
    face();
    ctx.fillStyle = lightGradient(ctx, fb, [[0, rgba(lightOf(base, 0.6), 0.3)], [0.45, rgba(base, 0)], [1, rgba(shadowOf(base, 0.6), 0.34)]]);
    ctx.fill();
    band(ctx, fb, 'bottom', 7, shadowOf(base, 0.6), 0.4);
    band(ctx, fb, 'bottom', 2.2, '#F7C98F', 0.14);
    band(ctx, fb, 'right', 3, shadowOf(base, 0.5), 0.45);
    band(ctx, fb, 'left', 1.6, lightOf(base, 0.7), 0.5);
    outline(ctx, face, fb, line, 1.35);
    // the near flap, folded down over the front, and its shadow
    const sh = ctx.createLinearGradient(0, -56, 0, -50.5);
    sh.addColorStop(0, rgba(shadowOf(base, 0.75), 0.42));
    sh.addColorStop(1, rgba(shadowOf(base, 0.75), 0));
    ctx.fillStyle = sh;
    ctx.fillRect(-50, -56, 100, 5.5);
    const flap = (): void => {
      ctx.beginPath();
      ctx.moveTo(-51, -67.5);
      ctx.lineTo(51, -67.5);
      ctx.lineTo(50.3, -55.8);
      ctx.lineTo(-50.3, -55.8);
      ctx.closePath();
    };
    const lb: Box = { x0: -51, y0: -67.5, x1: 51, y1: -55.8 };
    kraftPanel(ctx, flap, lb, lightOf(base, 0.1), 1.2);
    band(ctx, lb, 'top', 1.5, lightOf(base, 0.7), 0.6);
    band(ctx, lb, 'bottom', 1.8, shadowOf(base, 0.5), 0.45);
    outline(ctx, flap, lb, line, 1.25);
    // packing tape down the middle, torn where the box was opened
    const end = -49.5 - hash01(l.seed, 2) * 2;
    const tape = (): void => {
      ctx.beginPath();
      ctx.moveTo(-6.6, -67.5);
      ctx.lineTo(6.6, -67.5);
      ctx.lineTo(6.6, end + 0.6);
      for (let k = 0; k <= 6; k++) ctx.lineTo(6.6 - (13.2 * k) / 6, end + (k % 2 ? -1.1 : 0.7) + hash01(l.seed, k + 20) * 0.6);
      ctx.closePath();
    };
    tape();
    ctx.fillStyle = 'rgba(214,170,104,0.62)';
    ctx.fill();
    ctx.save();
    tape();
    ctx.clip();
    specular(ctx, -2.8, -60, 18, 1.6, Math.PI / 2, 0.4, '#FFFFFF', 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-5, -53.5);
    ctx.lineTo(-1, -55.5);
    ctx.moveTo(1.5, -62);
    ctx.lineTo(5, -63.6);
    ctx.stroke();
    // the tape bridges the step at the flap's edge
    ctx.fillStyle = 'rgba(120,84,50,0.25)';
    ctx.fillRect(-7, -55.8, 14, 1.6);
    ctx.restore();
    ctx.strokeStyle = 'rgba(150,108,62,0.45)';
    ctx.lineWidth = 0.6;
    tape();
    ctx.stroke();
  });
}

// ---------------------------------------------------------------------------
// Shoebox: printed paper over board, lid propped behind, tissue inside.

const SHOE_PRINT = ['#F7EFE2', '#FBF1EA', '#F6F3E6'];

function shoeboxBack(ctx: Ctx, l: Look): void {
  litFrame(ctx, () => {
    const base = l.base;
    const line = lineOf(base);
    const print = SHOE_PRINT[l.v % SHOE_PRINT.length];
    // lid propped up behind the box
    ctx.save();
    ctx.translate(-1, -50.6);
    ctx.rotate(-0.04);
    const lid = (): void => roundRect(ctx, -44.5, -10.5, 89, 14, 2);
    const lb: Box = { x0: -44.5, y0: -10.5, x1: 44.5, y1: 3.5 };
    lid();
    ctx.fillStyle = lightOf(base, 0.1);
    ctx.fill();
    ctx.fillStyle = print;
    ctx.fillRect(-44.5, -4.6, 89, 1.3);
    ctx.fillRect(-44.5, -2.5, 89, 0.6);
    ctx.fillStyle = shadowOf(base, 0.14);
    roundRect(ctx, -44.5, -10.5, 89, 3.2, [2, 2, 0, 0]);
    ctx.fill();
    lid();
    ctx.fillStyle = lightGradient(ctx, lb, [[0, rgba(lightOf(base, 0.6), 0.25)], [1, rgba(shadowOf(base, 0.6), 0.3)]]);
    ctx.fill();
    outline(ctx, lid, lb, line, 1.15);
    ctx.restore();
    // inside: back wall and the side walls (plain board, faintly tinted)
    const board = mix('#D7C9B5', base, 0.22);
    const back = (): void => {
      ctx.beginPath();
      ctx.rect(-39, -52.5, 78, 9.3);
    };
    const bb: Box = { x0: -39, y0: -52.5, x1: 39, y1: -43.2 };
    const g = ctx.createLinearGradient(0, -52.5, 0, -43.2);
    g.addColorStop(0, shadowOf(board, 0.12));
    g.addColorStop(1, shadowOf(board, 0.5));
    back();
    ctx.fillStyle = g;
    ctx.fill();
    for (const sd of [-1, 1]) {
      ctx.fillStyle = sd < 0 ? shadowOf(board, 0.5) : shadowOf(board, 0.2);
      ctx.beginPath();
      ctx.moveTo(sd * 43.5, -43.2);
      ctx.lineTo(sd * 39, -52.5);
      ctx.lineTo(sd * 39, -43.2);
      ctx.closePath();
      ctx.fill();
    }
    band(ctx, bb, 'left', 1.8, shadowOf(board, 0.8), 0.4);
    band(ctx, bb, 'right', 1.8, shadowOf(board, 0.8), 0.4);
    // tissue paper draped over the back wall, crinkled
    const tissue = mix('#FBF7F1', base, 0.2);
    const tp = (): void => {
      ctx.beginPath();
      ctx.moveTo(-31, -48.6);
      ctx.lineTo(-31.5, -52);
      for (let k = 0; k <= 7; k++) {
        const x = -31.5 + k * 7.4;
        ctx.quadraticCurveTo(x - 3.7, -55.2 - hash01(l.seed, k) * 2.2, x, -52.8 - hash01(l.seed, k + 30) * 1.4);
      }
      ctx.lineTo(20.5, -49);
      for (let k = 0; k <= 5; k++) ctx.lineTo(20.5 - k * 10.3, -48.6 + (k % 2 ? 1 : -0.3) + hash01(l.seed, k + 50) * 0.8);
      ctx.closePath();
    };
    softShadow(ctx, -5, -48.2, 27, 2, 0.32);
    tp();
    ctx.fillStyle = lightGradient(ctx, { x0: -37, y0: -58, x1: 33, y1: -45 }, [[0, lightOf(tissue, 0.5)], [1, shadowOf(tissue, 0.18)]]);
    ctx.fill();
    ctx.save();
    tp();
    ctx.clip();
    ctx.strokeStyle = rgba(shadowOf(tissue, 0.45), 0.55);
    ctx.lineWidth = 0.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const x = -28 + k * 8.4 + hash01(l.seed, k + 70) * 3;
      ctx.moveTo(x, -54);
      ctx.quadraticCurveTo(x + 2, -51.5, x + 0.6 + hash01(l.seed, k + 80) * 2, -48.6);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = rgba(shadowOf(tissue, 0.5), 0.6);
    ctx.lineWidth = 0.6;
    tp();
    ctx.stroke();
    // the cut top edges of the walls (light board)
    ctx.strokeStyle = lightOf(board, 0.6);
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-43.2, -43.6);
    ctx.lineTo(-38.8, -52.4);
    ctx.moveTo(38.8, -52.4);
    ctx.lineTo(43.2, -43.6);
    ctx.stroke();
    ctx.strokeStyle = rgba(line, 0.7);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-43.6, -43.3);
    ctx.lineTo(-39.2, -53);
    ctx.lineTo(-32, -53);
    ctx.moveTo(21.5, -53);
    ctx.lineTo(39.2, -53);
    ctx.lineTo(43.6, -43.3);
    ctx.stroke();
  });
}

function shoeboxFront(ctx: Ctx, l: Look): void {
  litFrame(ctx, () => {
    const base = l.base;
    const line = lineOf(base);
    const print = SHOE_PRINT[l.v % SHOE_PRINT.length];
    const face = (): void => roundRect(ctx, -43.5, -43.5, 87, 43.5, [1, 1, 2, 2]);
    const fb: Box = { x0: -43.5, y0: -43.5, x1: 43.5, y1: 0 };
    face();
    ctx.fillStyle = base;
    ctx.fill();
    // printed paper: polka dots, a cream band, a darker foot band and a label
    ctx.save();
    face();
    ctx.clip();
    ctx.fillStyle = rgba(print, 0.5);
    ctx.beginPath();
    for (let row = 0, y = -28.5; y < -9; y += 5.6, row++)
      for (let x = -41 + (row % 2) * 3.4; x < 43; x += 6.8) {
        ctx.moveTo(x + 1, y);
        ctx.arc(x, y, 1, 0, TAU);
      }
    ctx.fill();
    ctx.fillStyle = print;
    ctx.fillRect(-43.5, -37.2, 87, 2.2);
    ctx.fillRect(-43.5, -33.9, 87, 0.7);
    ctx.fillStyle = shadowOf(base, 0.14);
    ctx.fillRect(-43.5, -7.5, 87, 7.5);
    ctx.fillStyle = rgba(print, 0.8);
    ctx.fillRect(-43.5, -7.5, 87, 0.6);
    ctx.restore();
    const lab = (): void => roundRect(ctx, 5, -27, 30, 14.5, 1.6);
    lab();
    ctx.fillStyle = print;
    ctx.fill();
    ctx.strokeStyle = rgba(shadowOf(base, 0.5), 0.7);
    ctx.lineWidth = 0.6;
    roundRect(ctx, 6.3, -25.7, 27.4, 11.9, 1);
    ctx.stroke();
    ctx.fillStyle = shadowOf(base, 0.55);
    // a little shoe on the label
    ctx.beginPath();
    ctx.moveTo(9.6, -18.2);
    ctx.lineTo(9.6, -22.6);
    ctx.lineTo(12.2, -22.6);
    ctx.quadraticCurveTo(13.4, -20.2, 16.8, -19.8);
    ctx.quadraticCurveTo(18.8, -19.4, 18.8, -18.2);
    ctx.closePath();
    ctx.fill();
    ctx.font = '700 4.4px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('N°38', 21, -20.4);
    ctx.fillRect(9.6, -16.4, 21.4, 0.6);
    // light and shade
    face();
    ctx.fillStyle = lightGradient(ctx, fb, [[0, rgba(lightOf(base, 0.6), 0.32)], [0.45, rgba(base, 0)], [1, rgba(shadowOf(base, 0.6), 0.32)]]);
    ctx.fill();
    band(ctx, fb, 'bottom', 6, shadowOf(base, 0.6), 0.32);
    band(ctx, fb, 'bottom', 2, '#F7C98F', 0.12);
    band(ctx, fb, 'right', 2.6, shadowOf(base, 0.5), 0.45);
    band(ctx, fb, 'left', 1.5, lightOf(base, 0.75), 0.55);
    // the front wall's cut top edge (board), just below the rim line
    ctx.fillStyle = mix(lightOf(base, 0.6), '#F4EEE4', 0.6);
    ctx.fillRect(-43.2, -43.5, 86.4, 1.3);
    outline(ctx, face, fb, line, 1.3);
  });
}

// ---------------------------------------------------------------------------
// Fruit bowl: wide glazed bowl on a ring foot, a painted laurel band.

const FRUIT = makeVessel('fruitbowl', [[-46, 61.5], [-42, 61.2], [-35, 58.6], [-28, 54], [-22, 48], [-17.5, 41.5], [-14, 34]], { lip: 3.4, lipC: 2.3 });
const FRUIT_FOOT = makeVessel('fruitbowl.foot', [[-14.5, 20.6], [-8, 21], [-3.5, 22.2]]);
const FRUIT_PAINT = ['#F6EEDC', '#F6EEDC', '#FBF0E2', '#FBF3E4'];
const FRUIT_LEAF = ['#F3EBD8', '#7FA36E', '#6F9A63', '#7FA36E'];
const CHERRY = '#C4544F';

/** A painted pair of cherries with a leaf, squashed by `s` as it turns away. */
function cherries(ctx: Ctx, x: number, y: number, s: number, a: number, leafC: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * 1.15, 1.15);
  ctx.globalAlpha *= a;
  ctx.strokeStyle = '#6E7F4E';
  ctx.lineWidth = 0.55;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-1.9, 1.4);
  ctx.quadraticCurveTo(-1.3, -2, 0.7, -3.7);
  ctx.moveTo(2.1, 1.9);
  ctx.quadraticCurveTo(1.5, -1.4, 0.7, -3.7);
  ctx.stroke();
  ctx.fillStyle = leafC;
  leaf(ctx, 0.7, -3.7, 3.8, 1.35, -0.3);
  ctx.fillStyle = CHERRY;
  ctx.beginPath();
  ctx.arc(-1.9, 2.3, 1.9, 0, TAU);
  ctx.moveTo(4, 2.8);
  ctx.arc(2.1, 2.8, 1.9, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,240,230,0.7)';
  ctx.beginPath();
  ctx.arc(-2.5, 1.6, 0.55, 0, TAU);
  ctx.moveTo(2, 2.1);
  ctx.arc(1.5, 2.1, 0.55, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function fruitbowlBack(ctx: Ctx, l: Look): void {
  paintInside(ctx, FRUIT, { inner: mix(l.base, PORCELAIN, 0.3), rimTop: lightOf(l.base, 0.45), line: lineOf(l.base), depth: 0.62, gloss: 0.6 });
}

function fruitbowlFront(ctx: Ctx, l: Look): void {
  const line = lineOf(l.base);
  const paint = FRUIT_PAINT[l.v % FRUIT_PAINT.length];
  paintBody(ctx, FRUIT_FOOT, {
    base: shadowOf(l.base, 0.06),
    finish: 'gloss',
    line,
    decorate: () => ringBand(ctx, FRUIT_FOOT, -5.4, 0, CLAY),
    outlineW: 1.2,
  });
  paintBody(ctx, FRUIT, {
    base: l.base,
    finish: 'gloss',
    line,
    mottle: 0.22,
    decorate: () => {
      ringLine(ctx, FRUIT, -41.6, 1.3, paint);
      ringLine(ctx, FRUIT, -39.6, 0.5, paint);
      ringLine(ctx, FRUIT, -26.2, 0.8, paint);
      const leafC = FRUIT_LEAF[l.v % FRUIT_LEAF.length];
      aroundRing(FRUIT, -35, 11, 0.3, (x, y, s, f) => cherries(ctx, x, y, s, f, leafC));
      ctx.fillStyle = paint;
      aroundRing(FRUIT, -33.5, 11, 0.8, (x, y, s, f) => {
        ctx.globalAlpha = f;
        ctx.beginPath();
        ctx.ellipse(x, y, 0.9 * s, 0.9, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    },
    under: [-30, -9, 0.38],
    bounce: 0.14,
    spec: [[0.66, -42.5, -22, 3.4, 0.75]],
    glints: [[-38, -39.5, 1.1]],
  });
  paintNearRim(ctx, FRUIT, { top: lightOf(l.base, 0.45), line, gloss: 0.75 });
}

// ---------------------------------------------------------------------------
// Mixing bowl: speckled stoneware, thick rolled rim, two painted stripes.

const MIXB = makeVessel('mixingbowl', [[-52, 53], [-46, 52.5], [-38, 51], [-30, 48.4], [-23.5, 44.5], [-18, 38.5], [-14, 31]], { lip: 4.6, lipC: 2.6 });
const MIXB_FOOT = makeVessel('mixingbowl.foot', [[-13, 18.4], [-7, 19], [-3.1, 19.8]]);
const MIXB_STRIPE = [PALETTE.teacup, '#F6EEDE', '#D9875F'];

function mixingbowlBack(ctx: Ctx, l: Look): void {
  paintInside(ctx, MIXB, { inner: mix(PORCELAIN, l.base, 0.25), rimTop: lightOf(l.base, 0.4), line: lineOf(l.base), depth: 0.62, gloss: 0.55 });
}

function mixingbowlFront(ctx: Ctx, l: Look): void {
  const line = lineOf(l.base);
  const stripe = MIXB_STRIPE[l.v % MIXB_STRIPE.length];
  const sp = (): void => vesselPath(ctx, MIXB);
  paintBody(ctx, MIXB_FOOT, { base: CLAY, finish: 'satin', line: lineOf(CLAY), texture: () => speckle(ctx, () => vesselPath(ctx, MIXB_FOOT), 0.5), outlineW: 1.2 });
  paintBody(ctx, MIXB, {
    base: l.base,
    finish: 'gloss',
    line,
    mottle: 0.16,
    decorate: () => {
      ringBand(ctx, MIXB, -45.2, -41, stripe);
      ringBand(ctx, MIXB, -38.6, -37.2, stripe);
    },
    texture: () => speckle(ctx, sp, 0.3, 0.6),
    under: [-30, -9, 0.34],
    bounce: 0.14,
    spec: [[0.64, -47.5, -22, 3.2, 0.72]],
    glints: [[-34, -44, 1]],
  });
  paintNearRim(ctx, MIXB, { top: lightOf(l.base, 0.45), line, gloss: 0.6 });
}

// ---------------------------------------------------------------------------
// Pedestal sink: glazed porcelain basin and column, chrome tap behind.

const BASIN = makeVessel('sink', [[-139, 76], [-134, 75.6], [-126, 73.4], [-117, 69.4], [-108, 63.6], [-101, 56.5], [-96, 48], [-92.6, 39]], { lip: 6.4, lipC: 3.4 });
const PED = makeVessel('sink.ped', [[-90, 14.6], [-74, 12.8], [-50, 12.7], [-28, 14.6], [-14, 18.4], [-6, 22.6], [-3.7, 23.4]]);
const CHROME = '#BAC6D1';
const SINK_LINE = '#9DA7B6';

function tap(ctx: Ctx, x: number, y: number, cap: string): void {
  // escutcheon on the deck, a short stem and a cross handle
  ctx.save();
  ctx.fillStyle = shadowOf(CHROME, 0.25);
  ctx.beginPath();
  ctx.ellipse(x, y, 5.2, 1.6, 0, 0, TAU);
  ctx.fill();
  tube(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(x, y - 0.5);
      ctx.lineTo(x, y - 5);
    },
    3.2,
    CHROME,
    { line: SINK_LINE, spec: 0.9 },
  );
  tube(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(x - 4.6, y - 6.2);
      ctx.lineTo(x + 4.6, y - 6.2);
    },
    1.9,
    CHROME,
    { line: SINK_LINE, spec: 0.9 },
  );
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.ellipse(x, y - 6.5, 1.7, 1.2, 0, 0, TAU);
  ctx.fill();
  glint(ctx, x - 0.5, y - 7, 0.5, 0.9);
  ctx.restore();
}

function sinkBack(ctx: Ctx): void {
  litFrame(ctx, () => {
    paintInside(ctx, BASIN, {
      inner: '#EDEEF0',
      rimTop: '#FBF8F3',
      line: SINK_LINE,
      depth: 0.56,
      gloss: 0.75,
      extra: () => {
        // overflow slot under the back of the rim
        ctx.fillStyle = shadowOf('#EDEEF0', 0.7);
        roundRect(ctx, -6, -144.6, 12, 2.4, 1.2);
        ctx.fill();
        ctx.strokeStyle = CHROME;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      },
    });
    // chrome tap on the deck: a column and a gooseneck spout, hot and cold handles
    const spout = (): void => {
      ctx.beginPath();
      ctx.moveTo(0, -148.5);
      ctx.lineTo(0, -168);
      ctx.bezierCurveTo(0, -181, 22, -182, 24.5, -167);
      ctx.lineTo(24.5, -163.5);
    };
    ctx.fillStyle = shadowOf(CHROME, 0.3);
    ctx.beginPath();
    ctx.ellipse(0, -148.5, 7.4, 2.2, 0, 0, TAU);
    ctx.fill();
    tube(ctx, spout, 4.6, CHROME, { line: SINK_LINE, spec: 0.95, shade: 0.5 });
    ctx.fillStyle = shadowOf(CHROME, 0.6);
    ctx.beginPath();
    ctx.ellipse(24.5, -162.9, 2.3, 0.8, 0, 0, TAU);
    ctx.fill();
    tube(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(-3.6, -149.2);
        ctx.lineTo(3.6, -149.2);
      },
      3,
      CHROME,
      { line: SINK_LINE, spec: 0.8 },
    );
    tap(ctx, -21, -148.4, '#E39C95');
    tap(ctx, 21, -148.4, '#86AAD4');
  });
}

function sinkFront(ctx: Ctx, l: Look): void {
  const base = l.base;
  paintBody(ctx, PED, {
    base: shadowOf(base, 0.03),
    finish: 'gloss',
    line: SINK_LINE,
    mottle: 0.12,
    under: [-30, 0, 0.12],
    bounce: 0.15,
    after: () => {
      // the basin overhang shades the top of the column
      const g = ctx.createLinearGradient(0, -90, 0, -70);
      g.addColorStop(0, rgba(shadowOf(base, 0.7), 0.45));
      g.addColorStop(1, rgba(shadowOf(base, 0.7), 0));
      ctx.fillStyle = g;
      ctx.fillRect(-20, -92, 40, 22);
    },
    spec: [[0.55, -80, -12, 2.6, 0.55]],
  });
  paintBody(ctx, BASIN, {
    base,
    finish: 'gloss',
    line: SINK_LINE,
    mottle: 0.15,
    under: [-118, -88, 0.3],
    spec: [
      [0.66, -133, -101, 4.2, 0.8],
      [0.4, -128, -112, 2, 0.35],
    ],
    glints: [[-49, -128.5, 1.4]],
  });
  paintNearRim(ctx, BASIN, { top: '#FCFAF6', line: SINK_LINE, gloss: 0.85 });
}

// ---------------------------------------------------------------------------
// Terracotta pot: matte speckled clay, rolled collar, a little bloom and wear.

const POT_RIM = makeVessel('pot.rim', [[-61, 38.2], [-56, 38.5], [-51.2, 38]], { lip: 4.8, lipC: 2.4 });
const POT = makeVessel('pot', [[-54, 34.8], [-44, 33.5], [-30, 31.7], [-16, 29.6], [-4.4, 27.6]]);

function potBack(ctx: Ctx, l: Look): void {
  paintInside(ctx, POT_RIM, { inner: shadowOf(l.base, 0.3), rimTop: lightOf(l.base, 0.28), line: lineOf(l.base), depth: 0.7 });
}

function potFront(ctx: Ctx, l: Look): void {
  const base = l.base;
  const line = lineOf(base);
  const bp = (): void => vesselPath(ctx, POT);
  paintBody(ctx, POT, {
    base,
    finish: 'matte',
    line,
    decorate: () => {
      // mineral bloom and a damp, darker foot
      for (let k = 0; k < 3; k++) {
        const x = (hash01(l.seed, k + 40) - 0.5) * 40;
        const y = -12 - hash01(l.seed, k + 44) * 26;
        const r = 5 + hash01(l.seed, k + 48) * 5;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(246,236,224,0.2)');
        g.addColorStop(1, 'rgba(246,236,224,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
    },
    texture: () => {
      speckle(ctx, bp, 0.3, 0.65);
      texPaint(ctx, bp, 'plaster', { alpha: 0.22, scale: 0.4 });
    },
    under: [-26, 0, 0.22],
    bounce: 0.18,
    after: () => {
      // the collar overhangs and casts a soft shade on the body
      const r = ring(POT_RIM, -51.2);
      for (const [dy, w, a] of [
        [1.4, 3, 0.3],
        [3, 6.5, 0.14],
      ] as const) {
        ctx.strokeStyle = rgba(shadowOf(base, 0.7), a);
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.ellipse(1, -51.2 + dy, r.rx, r.ry, 0, 0, Math.PI);
        ctx.stroke();
      }
    },
  });
  const rp = (): void => vesselPath(ctx, POT_RIM);
  paintBody(ctx, POT_RIM, {
    base: lightOf(base, 0.06),
    finish: 'matte',
    line,
    texture: () => {
      speckle(ctx, rp, 0.3, 0.65);
      texPaint(ctx, rp, 'plaster', { alpha: 0.22, scale: 0.4 });
    },
    after: () => {
      // the rolled lower edge of the collar
      const r = ring(POT_RIM, -51.2);
      ctx.strokeStyle = rgba(shadowOf(base, 0.4), 0.5);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(0, -52, r.rx + 1, r.ry, 0, 0, Math.PI);
      ctx.stroke();
      // a chip in the rim showing paler clay
      const cx = 10 + hash01(l.seed, 61) * 12;
      ctx.fillStyle = lightOf(base, 0.45);
      ctx.beginPath();
      ctx.moveTo(cx - 2.2, -60.9 + ring(POT_RIM, -61).ry * 0.95);
      ctx.lineTo(cx, -58.7 + ring(POT_RIM, -61).ry * 0.9);
      ctx.lineTo(cx + 2.4, -60.9 + ring(POT_RIM, -61).ry * 0.92);
      ctx.closePath();
      ctx.fill();
    },
  });
  paintNearRim(ctx, POT_RIM, { top: lightOf(base, 0.28), line });
}

// ---------------------------------------------------------------------------
// Wicker laundry basket: stakes and weavers, a wrapped rim, hand holes.

const BASKET = makeVessel('basket', [[-72, 61], [-66, 60.4], [-46, 58.2], [-24, 56], [-8.7, 54.4]], { lip: 6.6, lipC: 3.8 });
const STAKES = 13;
const HOLE_X = 39;
const HOLE_Y = -60;

function holePath(ctx: Ctx, s: number, grow = 0): void {
  const r = ring(BASKET, HOLE_Y);
  const th = Math.asin(HOLE_X / r.rx);
  const cx = s * HOLE_X;
  const cy = HOLE_Y + r.ry * Math.cos(th) - 4;
  const w = 8.5 * Math.cos(th) + grow;
  ctx.moveTo(cx + w, cy);
  ctx.ellipse(cx, cy, w, 3.6 + grow, s * -0.12, 0, TAU);
}

function basketBody(ctx: Ctx): void {
  vesselPath(ctx, BASKET);
  holePath(ctx, -1);
  holePath(ctx, 1);
}

function weave(ctx: Ctx, base: string): void {
  const v = BASKET;
  const dth = Math.PI / STAKES;
  // dark gaps between the canes
  ctx.fillStyle = shadowOf(base, 0.62);
  ctx.fillRect(-70, -80, 140, 85);
  // stakes: upright canes the weavers pass in front of and behind
  ctx.lineCap = 'butt';
  ctx.strokeStyle = shadowOf(base, 0.18);
  ctx.beginPath();
  for (let j = -STAKES; j <= STAKES; j++) {
    const th = j * dth;
    if (Math.abs(th) >= Math.PI / 2) continue;
    for (let y = -70; y <= -6; y += 4) {
      const r1 = ring(v, y);
      const r2 = ring(v, y + 4);
      const p1 = [r1.rx * Math.sin(th), y + r1.ry * Math.cos(th)];
      const p2 = [r2.rx * Math.sin(th), y + 4 + r2.ry * Math.cos(th)];
      if (y === -70) ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
    }
  }
  ctx.lineWidth = 3;
  ctx.stroke();
  // weavers: each row passes in front of every other stake, alternating by row
  const rowH = 5.3;
  const pills = [new Path2D(), new Path2D(), new Path2D()];
  const hi = new Path2D();
  const lo = new Path2D();
  let row = 0;
  for (let y = -66.4; y < -4; y += rowH, row++) {
    const r = ring(v, y);
    const off = row % 2;
    for (let j = -STAKES - 1; j <= STAKES + 1; j += 2) {
      const tc = (j + off) * dth;
      const ta = tc - dth * 0.93;
      const tb = tc + dth * 0.93;
      if (tb <= -Math.PI / 2 || ta >= Math.PI / 2) continue;
      const a = Math.max(-Math.PI / 2, ta);
      const b = Math.min(Math.PI / 2, tb);
      const m = (a + b) / 2;
      const P = (t: number, dy: number): [number, number] => [r.rx * Math.sin(t), y + dy + r.ry * Math.cos(t)];
      const h = rowH * 0.47;
      const [x0, y0t] = P(a, -h);
      const [xm, ymt] = P(m, -h);
      const [x1, y1t] = P(b, -h);
      const [, y0b] = P(a, h);
      const [, ymb] = P(m, h);
      const [, y1b] = P(b, h);
      const e0 = 1.5 * Math.cos(a);
      const e1 = 1.5 * Math.cos(b);
      const pill = pills[Math.floor(hash01(row * 31 + j, 5) * 3)];
      pill.moveTo(x0, y0t + 0.6);
      pill.quadraticCurveTo(2 * xm - (x0 + x1) / 2, 2 * ymt - (y0t + y1t) / 2, x1, y1t + 0.6);
      pill.quadraticCurveTo(x1 + e1, (y1t + y1b) / 2, x1, y1b - 0.6);
      pill.quadraticCurveTo(2 * xm - (x0 + x1) / 2, 2 * ymb - (y0b + y1b) / 2, x0, y0b - 0.6);
      pill.quadraticCurveTo(x0 - e0, (y0t + y0b) / 2, x0, y0t + 0.6);
      // highlight along the top of the cane, shade along its underside
      const [ha, hya] = P(a + dth * 0.25, -h * 0.45);
      const [hm, hym] = P(m, -h * 0.45);
      const [hb, hyb] = P(b - dth * 0.25, -h * 0.45);
      hi.moveTo(ha, hya);
      hi.quadraticCurveTo(2 * hm - (ha + hb) / 2, 2 * hym - (hya + hyb) / 2, hb, hyb);
      const [la, lya] = P(a + dth * 0.15, h * 0.6);
      const [lm, lym] = P(m, h * 0.6);
      const [lb, lyb] = P(b - dth * 0.15, h * 0.6);
      lo.moveTo(la, lya);
      lo.quadraticCurveTo(2 * lm - (la + lb) / 2, 2 * lym - (lya + lyb) / 2, lb, lyb);
    }
  }
  const tones = [base, lightOf(base, 0.12), shadowOf(base, 0.08)];
  pills.forEach((pp, i) => {
    ctx.fillStyle = tones[i];
    ctx.fill(pp);
  });
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(shadowOf(base, 0.45), 0.6);
  ctx.lineWidth = 1.5;
  ctx.stroke(lo);
  ctx.strokeStyle = rgba(lightOf(base, 0.6), 0.75);
  ctx.lineWidth = 1.1;
  ctx.stroke(hi);
}

/** Half of the wrapped rim of the basket: 'near' (front) or 'far' (back). */
function basketRim(ctx: Ctx, base: string, half: 'near' | 'far'): void {
  const v = BASKET;
  const { rimY, rx, ry } = v;
  const irx = rx - v.lip;
  const iry = ry - v.lipC;
  const a0 = half === 'near' ? 0 : Math.PI;
  const band = (): void => {
    ctx.beginPath();
    ctx.ellipse(0, rimY, rx, ry, 0, a0, a0 + Math.PI);
    ctx.ellipse(0, rimY, irx, iry, 0, a0 + Math.PI, a0, true);
    ctx.closePath();
  };
  const b: Box = { x0: -rx, y0: rimY - ry, x1: rx, y1: rimY + ry };
  band();
  ctx.fillStyle = lightGradient(ctx, b, [[0, lightOf(base, 0.35)], [0.5, base], [1, shadowOf(base, 0.3)]]);
  ctx.fill();
  // the wrapping cane: slanted turns all along the rim
  ctx.save();
  band();
  ctx.clip();
  const turns = 46;
  const lo = new Path2D();
  const hi = new Path2D();
  for (let k = 0; k <= turns / 2; k++) {
    const t = a0 + (k / (turns / 2)) * Math.PI;
    const t2 = t + 0.09;
    lo.moveTo(rx * Math.cos(t) * 1.02, rimY + ry * Math.sin(t) * 1.02);
    lo.lineTo(irx * Math.cos(t2) * 0.98, rimY + iry * Math.sin(t2) * 0.98);
    const t3 = t + 0.05;
    hi.moveTo((rx - 1.4) * Math.cos(t3), rimY + (ry - 0.6) * Math.sin(t3));
    hi.lineTo((irx + 1.6) * Math.cos(t3 + 0.08), rimY + (iry + 0.6) * Math.sin(t3 + 0.08));
  }
  ctx.strokeStyle = rgba(shadowOf(base, 0.55), 0.8);
  ctx.lineWidth = 1.1;
  ctx.stroke(lo);
  ctx.strokeStyle = rgba(lightOf(base, 0.65), 0.6);
  ctx.lineWidth = 0.8;
  ctx.stroke(hi);
  ctx.restore();
  ctx.strokeStyle = rgba(lineOf(base), 0.9);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(0, rimY, rx, ry, 0, a0, a0 + Math.PI);
  ctx.stroke();
  ctx.strokeStyle = rgba(lineOf(base), 0.55);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(0, rimY, irx, iry, 0, a0, a0 + Math.PI);
  ctx.stroke();
}

function basketBack(ctx: Ctx, l: Look): void {
  litFrame(ctx, () => {
    const base = l.base;
    // the far wall's inside, in shade, seen through the hand holes
    ctx.fillStyle = shadowOf(base, 0.78);
    ctx.beginPath();
    holePath(ctx, -1, 2);
    holePath(ctx, 1, 2);
    ctx.fill();
    paintInside(ctx, BASKET, {
      inner: shadowOf(base, 0.25),
      rimTop: base,
      line: lineOf(base),
      depth: 0.7,
      extra: () =>
        texPaint(
          ctx,
          () => {
            ctx.beginPath();
            ctx.rect(-60, -90, 120, 30);
          },
          'weave',
          { alpha: 0.45, scale: 0.55 },
        ),
    });
    memo(ctx, `basket.rim.far|${base}`, { x0: -63, y0: -84, x1: 63, y1: -70 }, (g) => basketRim(g, base, 'far'));
  });
}

function basketFront(ctx: Ctx, l: Look): void {
  litFrame(ctx, () => {
    const base = l.base;
    const v = BASKET;
    const vp = (): void => vesselPath(ctx, v);
    // weave, cane grain and light (cached), clipped to the body minus the hand holes
    ctx.save();
    ctx.beginPath();
    basketBody(ctx);
    ctx.clip('evenodd');
    memo(ctx, `basket.weave|${base}`, { x0: -62, y0: -73, x1: 62, y1: 1 }, (g) => {
      g.save();
      vesselPath(g, v);
      g.clip();
      weave(g, base);
      texPaint(g, () => vesselPath(g, v), 'card', { alpha: 0.3, scale: 0.28 });
      shadeCylinder(g, v, base, 'matte', () => vesselPath(g, v), { under: [-30, -2, 0.3], bounce: 0.16 });
      g.restore();
    });
    ctx.restore();
    // the wrapped edges of the hand holes
    ctx.save();
    ctx.beginPath();
    holePath(ctx, -1);
    holePath(ctx, 1);
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = shadowOf(base, 0.1);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(lightOf(base, 0.6), 0.8);
    ctx.translate(-0.4, -0.6);
    ctx.stroke();
    ctx.translate(0.4, 0.6);
    ctx.strokeStyle = rgba(lineOf(base), 0.8);
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
    outline(ctx, vp, { x0: -61, y0: -82, x1: 61, y1: 0 }, lineOf(base), 1.4);
    memo(ctx, `basket.rim.near|${base}`, { x0: -63, y0: -74, x1: 63, y1: -61 }, (g) => basketRim(g, base, 'near'));
  });
}

// ---------------------------------------------------------------------------
// Saucepan: brushed copper (tin lined) or steel, riveted iron handle.

const PAN = makeVessel('saucepan', [[-46, 47.5], [-42, 47.6], [-14, 47.4], [-9, 46.8], [-7.4, 46.2]], { lip: 2.4, lipC: 2 });
const IRON = '#575166';

function panHandle(ctx: Ctx): void {
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(42, -42.5);
    ctx.bezierCurveTo(62, -45, 80, -48, 93, -50.6);
    ctx.bezierCurveTo(100, -51.8, 103.4, -47.8, 101.6, -44.4);
    ctx.bezierCurveTo(100.4, -42.2, 97.5, -41.6, 94.5, -41.8);
    ctx.bezierCurveTo(80, -40.4, 62, -37.2, 42, -34.5);
    ctx.closePath();
    // hanging hole
    ctx.moveTo(96.6, -46.4);
    ctx.ellipse(94.6, -46.4, 2, 1.5, -0.16, 0, TAU);
  };
  const b: Box = { x0: 42, y0: -52, x1: 103, y1: -34 };
  path();
  ctx.fillStyle = IRON;
  ctx.fill('evenodd');
  ctx.save();
  path();
  ctx.clip('evenodd');
  const g = ctx.createLinearGradient(0, -50, 0, -36);
  g.addColorStop(0, rgba(lightOf(IRON, 0.6), 0.75));
  g.addColorStop(0.45, rgba(IRON, 0));
  g.addColorStop(1, rgba(shadowOf(IRON, 0.6), 0.6));
  ctx.fillStyle = g;
  ctx.fillRect(40, -54, 66, 22);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 0.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(52, -42.4);
  ctx.bezierCurveTo(66, -44.6, 80, -47, 90, -48.8);
  ctx.stroke();
  ctx.restore();
  outline(ctx, path, b, lineOf(IRON), 1.2, 0.7);
}

function saucepanBack(ctx: Ctx, l: Look): void {
  const lining = l.v === 0 ? '#C7CCD3' : shadowOf(l.base, 0.05);
  paintInside(ctx, PAN, {
    inner: lining,
    rimTop: lightOf(l.base, 0.5),
    line: lineOf(l.base),
    depth: 0.6,
    gloss: 0.8,
    extra: () => {
      // a bright reflection on the far inner wall, metal-style
      const g = ctx.createRadialGradient(17, -48, 0, 17, -48, 13);
      g.addColorStop(0, rgba(lightOf(lining, 0.9), 0.6));
      g.addColorStop(1, rgba(lightOf(lining, 0.9), 0));
      ctx.fillStyle = g;
      ctx.fillRect(2, -58, 30, 20);
    },
  });
}

function saucepanFront(ctx: Ctx, l: Look): void {
  const base = l.base;
  const line = lineOf(base);
  panHandle(ctx);
  const pp = (): void => vesselPath(ctx, PAN);
  paintBody(ctx, PAN, {
    base,
    finish: 'metal',
    line,
    decorate: () => {
      ringLine(ctx, PAN, -37.5, 0.8, shadowOf(base, 0.3));
      ringLine(ctx, PAN, -36.6, 0.6, lightOf(base, 0.4));
    },
    texture: () => texPaint(ctx, pp, 'brush', { alpha: 0.5, scale: 0.2 }),
    under: [-22, -1, 0.25],
    spec: [[0.7, -43, -9, 2.6, 0.85]],
    glints: [[-33, -42.5, 1.1]],
  });
  paintNearRim(ctx, PAN, { top: lightOf(base, 0.5), line, gloss: 0.85 });
  // riveted bracket where the handle meets the pan
  const plate = (): void => roundRect(ctx, 38.2, -44.5, 8.6, 12.5, 2.6);
  plate();
  ctx.fillStyle = shadowOf(base, 0.08);
  ctx.fill();
  edgeShadeL(ctx, plate, { x0: 38.2, y0: -44.5, x1: 46.8, y1: -32 }, shadowOf(base, 0.5), 2, 0.5, 'shadow', 2);
  outline(ctx, plate, { x0: 38.2, y0: -44.5, x1: 46.8, y1: -32 }, line, 1);
  rivet(ctx, 42.5, -41, 1.5, lightOf(base, 0.15));
  rivet(ctx, 42.5, -35.6, 1.5, lightOf(base, 0.15));
}

// ---------------------------------------------------------------------------
// Vase: round-shouldered, glossy, a hand-painted vine around the belly.

const VASE = makeVessel('vase', [[-98, 24], [-94.5, 22.6], [-88, 21.9], [-81, 23], [-73, 26.8], [-65, 31.3], [-57, 34.9], [-47, 36.3], [-33, 35.7], [-19, 34], [-10, 32], [-5.2, 30.6]], { lip: 4.8, lipC: 1.6 });
const VASE_PAINT = [
  { leaf: '#F7EFE0', berry: GOLD },
  { leaf: '#5E9A84', berry: '#E9A6A0' },
  { leaf: '#FBF2E6', berry: '#C77B82' },
];

function vaseBack(ctx: Ctx, l: Look): void {
  paintInside(ctx, VASE, { inner: shadowOf(l.base, 0.35), rimTop: lightOf(l.base, 0.45), line: lineOf(l.base), depth: 0.8, gloss: 0.6 });
}

function vaseFront(ctx: Ctx, l: Look): void {
  const base = l.base;
  const line = lineOf(base);
  const pc = VASE_PAINT[l.v % VASE_PAINT.length];
  paintBody(ctx, VASE, {
    base,
    finish: 'gloss',
    line,
    mottle: 0.22,
    decorate: () => {
      ringLine(ctx, VASE, -79.5, 1, pc.leaf);
      ringLine(ctx, VASE, -14, 1.2, pc.leaf);
      ringLine(ctx, VASE, -11.6, 0.6, pc.leaf);
      // a wavy vine all around the belly, leaves at its crests
      const yc = -45;
      const r = ring(VASE, yc);
      const n = 5;
      const ph = hash01(l.seed, 70) * TAU;
      const at = (t: number): [number, number] => [r.rx * Math.sin(t), yc + r.ry * Math.cos(t) + 4 * Math.sin(n * t + ph)];
      ctx.strokeStyle = pc.leaf;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) {
        const t = -Math.PI / 2 + (k / 48) * Math.PI;
        const [x, y] = at(t);
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = pc.leaf;
      for (let k = 0; k < 4 * n; k++) {
        const t = ((k + 0.5) / (4 * n)) * TAU - Math.PI;
        const c = Math.cos(t);
        if (c < 0.12) continue;
        const [x, y] = at(t);
        const up = Math.cos(n * t + ph) > 0 ? -1 : 1;
        ctx.globalAlpha = Math.min(1, (c - 0.12) * 3);
        leaf(ctx, x, y, 6.2, 2.3, up * 1.1 - (k % 2 ? 0.5 : -0.5), c);
        if (k % 2 === 0) {
          ctx.fillStyle = pc.berry;
          ctx.beginPath();
          ctx.ellipse(x + 2.4 * c, y - up * 3, 1.25 * c, 1.25, 0, 0, TAU);
          ctx.fill();
          ctx.fillStyle = pc.leaf;
        }
      }
      ctx.globalAlpha = 1;
    },
    under: [-30, -3, 0.3],
    bounce: 0.14,
    spec: [
      [0.6, -64, -16, 3.4, 0.78],
      [0.6, -95, -85, 1.6, 0.55],
    ],
    glints: [[-18, -66.5, 1.2]],
  });
  paintNearRim(ctx, VASE, { top: lightOf(base, 0.45), line, gloss: 0.7 });
}

// ---------------------------------------------------------------------------
// Bucket: galvanised steel with ribs, or enamel with a navy rim; bail handle.

const BUCKET = makeVessel('bucket', [[-61, 38.5], [-57.5, 38.1], [-32, 34.8], [-5, 31.2]], { lip: 2.8, lipC: 2.3 });
const NAVY = '#4D5779';
const BAIL = '#8F9BA8';

function bucketBack(ctx: Ctx, l: Look): void {
  const enamel = l.v === 1;
  litFrame(ctx, () => {
    // wire bail leaning back behind the rim, with a wooden grip
    const wire = (): void => {
      ctx.beginPath();
      ctx.moveTo(-37.2, -51);
      ctx.bezierCurveTo(-38, -91, 38, -91, 37.2, -51);
    };
    tube(ctx, wire, 2.2, BAIL, { spec: 0.6 });
    tube(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(-7.5, -80.5);
        ctx.quadraticCurveTo(0, -81.5, 7.5, -80.5);
      },
      5.4,
      PALETTE.oak,
      { spec: 0.25 },
    );
    ctx.strokeStyle = rgba(shadowOf(PALETTE.oak, 0.5), 0.6);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(-6, -80);
    ctx.quadraticCurveTo(0, -80.9, 6, -80);
    ctx.stroke();
  });
  paintInside(ctx, BUCKET, {
    inner: enamel ? '#F2EDE6' : shadowOf(l.base, 0.12),
    rimTop: enamel ? NAVY : lightOf(l.base, 0.4),
    line: lineOf(l.base),
    depth: 0.6,
    gloss: 0.6,
  });
}

function bucketFront(ctx: Ctx, l: Look): void {
  const base = l.base;
  const enamel = l.v === 1;
  const line = lineOf(base);
  const bp = (): void => vesselPath(ctx, BUCKET);
  paintBody(ctx, BUCKET, {
    base,
    finish: enamel ? 'gloss' : 'metal',
    line,
    mottle: enamel ? 0.16 : 0,
    decorate: () => {
      if (enamel) {
        ringBand(ctx, BUCKET, -62, -57.4, NAVY);
        // a couple of chips in the enamel
        for (let k = 0; k < 2; k++) {
          const x = (hash01(l.seed, k + 80) - 0.5) * 36;
          const y = k ? -10 - hash01(l.seed, 82) * 6 : -50 + hash01(l.seed, 83) * 8;
          ctx.fillStyle = lightOf(base, 0.45);
          ctx.beginPath();
          ctx.ellipse(x, y, 1.6, 1.1, 0.4, 0, TAU);
          ctx.fill();
          ctx.fillStyle = mix(NAVY, base, 0.3);
          ctx.beginPath();
          ctx.ellipse(x + 0.15, y + 0.1, 0.95, 0.6, 0.4, 0, TAU);
          ctx.fill();
        }
      }
    },
    texture: enamel
      ? undefined
      : () => {
          texPaint(ctx, bp, 'plaster', { alpha: 0.32, scale: 0.22 });
          texPaint(ctx, bp, 'brush', { alpha: 0.4, scale: 0.2 });
        },
    under: [-28, -1, 0.22],
    after: () => {
      rib(ctx, BUCKET, -45, base);
      rib(ctx, BUCKET, -19, base);
    },
    spec: [[0.66, -56, -9, 2.8, 0.75]],
    glints: [[-26, -54, 1]],
  });
  paintNearRim(ctx, BUCKET, { top: enamel ? NAVY : lightOf(base, 0.4), line, gloss: 0.7 });
  // ears where the bail hooks in
  litFrame(ctx, () => {
    for (const s of [-1, 1]) {
      const x = s * 36.6;
      const ear = (): void => roundRect(ctx, x - 3, -55.5, 6, 9.5, 2.6);
      ear();
      ctx.fillStyle = enamel ? NAVY : shadowOf(base, 0.06);
      ctx.fill();
      edgeShade(ctx, ear, { x0: x - 3, y0: -55.5, x1: x + 3, y1: -46 }, shadowOf(enamel ? NAVY : base, 0.5), 1.6, 0.5, 'shadow', 2);
      outline(ctx, ear, { x0: x - 3, y0: -55.5, x1: x + 3, y1: -46 }, line, 1);
      rivet(ctx, x, -48.6, 1.2, enamel ? lightOf(NAVY, 0.3) : lightOf(base, 0.2));
      ctx.strokeStyle = BAIL;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, -52.4, 1.6, 0, TAU);
      ctx.stroke();
    }
  });
}

// ---------------------------------------------------------------------------
// Slipper: plush fabric, fleece cuff, stitched cushion sole, pom-pom.

const SL_CX = -16.5;
const SL_OPEN = makeVessel('slipper.open', [[-26.6, 18.4], [-20, 18.4]], { lip: 2.8, lipC: 1.7, k: 0.2 });
const FLEECE = '#FBF4EA';
const SOLE_FELT = '#F1E4D2';

function slipperUpper(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(-38.8, -7);
  ctx.bezierCurveTo(-40.8, -14, -40.4, -22, -36.4, -26.4);
  ctx.ellipse(SL_CX, -26.6, 18.4, 18.4 * 0.2, 0, Math.PI, 0, true);
  ctx.bezierCurveTo(3.6, -29.6, 9, -31.2, 16, -31.2);
  ctx.bezierCurveTo(27, -31.2, 36, -27.6, 41, -20);
  ctx.bezierCurveTo(44, -15.5, 44, -10, 43, -7);
  ctx.closePath();
}

/** Short fibres sticking out along a polyline (a fuzzy edge). */
function fuzz(ctx: Ctx, pts: [number, number][], color: string, seed: number, len = 1.6, outward = 1): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let k = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const d = Math.hypot(bx - ax, by - ay);
    const nx = (-(by - ay) / d) * outward;
    const ny = ((bx - ax) / d) * outward;
    for (let t = 0; t < d; t += 1.05) {
      const h = hash01(seed, k++);
      const x = ax + ((bx - ax) * t) / d;
      const y = ay + ((by - ay) * t) / d;
      const l = len * (0.45 + h * 0.8);
      ctx.moveTo(x - nx * 0.9, y - ny * 0.9);
      ctx.lineTo(x + nx * l + (h - 0.5) * 1.2, y + ny * l + (hash01(seed, k) - 0.5) * 1.2);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function slipperBack(ctx: Ctx, l: Look): void {
  ctx.save();
  ctx.translate(SL_CX, 0);
  paintInside(ctx, SL_OPEN, { inner: mix(FLEECE, l.base, 0.15), rimTop: FLEECE, line: lineOf(l.base), depth: 0.7 });
  ctx.restore();
}

function slipperFront(ctx: Ctx, l: Look): void {
  const base = l.base;
  const line = lineOf(base);
  const L = lsign(ctx);
  // cushioned sole with a stitched welt
  const sole = (): void => roundRect(ctx, -39.8, -8, 83.8, 8, [3.6, 4.4, 3.6, 3.6]);
  const sb: Box = { x0: -39.8, y0: -8, x1: 44, y1: 0 };
  sole();
  ctx.fillStyle = SOLE_FELT;
  ctx.fill();
  texPaint(ctx, sole, 'weave', { alpha: 0.3, scale: 0.3 });
  ctx.save();
  sole();
  ctx.clip();
  band(ctx, sb, 'bottom', 3, shadowOf(SOLE_FELT, 0.4), 0.5);
  ctx.restore();
  ctx.fillStyle = shadowOf(SOLE_FELT, 0.32);
  ctx.fillRect(-38.4, -1.6, 81, 1.6);
  ctx.save();
  ctx.setLineDash([1.5, 1.3]);
  ctx.strokeStyle = rgba(shadowOf(SOLE_FELT, 0.55), 0.8);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-37.5, -4.6);
  ctx.lineTo(41.5, -4.6);
  ctx.stroke();
  ctx.restore();
  outline(ctx, sole, sb, lineOf(SOLE_FELT), 1.1);
  // plush upper
  const up = (): void => slipperUpper(ctx);
  const ub: Box = { x0: -40.5, y0: -31.5, x1: 44, y1: -7 };
  up();
  ctx.fillStyle = base;
  ctx.fill();
  texPaint(ctx, up, 'furFine', { alpha: 0.4, scale: 0.26 });
  const g = ctx.createRadialGradient(4 - 10 * L, -31, 2, 2, -22, 46);
  g.addColorStop(0, rgba(lightOf(base, 0.7), 0.5));
  g.addColorStop(0.5, rgba(lightOf(base, 0.7), 0));
  g.addColorStop(1, rgba(shadowOf(base, 0.6), 0.25));
  up();
  ctx.fillStyle = g;
  ctx.fill();
  up();
  ctx.fillStyle = lightGradient(ctx, ub, [[0, rgba(shadowOf(base, 0.55), 0)], [0.5, rgba(shadowOf(base, 0.55), 0)], [1, rgba(shadowOf(base, 0.55), 0.42)]], lightDir(ctx));
  ctx.fill();
  shadeDown(ctx, up, -17, -7, base, 0.32, -42, 46);
  // the apron seam stitched over the toe
  ctx.save();
  up();
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(shadowOf(base, 0.35), 0.5);
  ctx.lineWidth = 1.4;
  const seam = (): void => {
    ctx.beginPath();
    ctx.moveTo(4.6, -25.6);
    ctx.bezierCurveTo(9, -28, 25, -29.2, 33.4, -23.8);
    ctx.bezierCurveTo(38.2, -20.6, 40, -15, 39.8, -9);
  };
  seam();
  ctx.stroke();
  ctx.setLineDash([1.3, 1.1]);
  ctx.strokeStyle = rgba(lightOf(base, 0.6), 0.85);
  ctx.lineWidth = 0.55;
  ctx.translate(-0.3, -0.5);
  seam();
  ctx.stroke();
  ctx.restore();
  outline(ctx, up, ub, line, 1, 0.3);
  // plush: a soft halo over the edge and short fibres along the top
  ctx.save();
  ctx.strokeStyle = rgba(lightOf(base, 0.15), 0.4);
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  up();
  ctx.stroke();
  ctx.restore();
  const fib = rgba(mix(base, lightOf(base, 0.3), 0.5), 0.75);
  fuzz(
    ctx,
    [
      [-39.6, -9],
      [-40.4, -16],
      [-39.4, -22.5],
      [-36.6, -26.4],
    ],
    fib,
    l.seed,
    0.9,
    -1,
  );
  fuzz(
    ctx,
    [
      [3, -28],
      [8, -30.9],
      [16, -31.4],
      [26, -30.6],
      [34, -27.2],
      [40.4, -21],
      [43.3, -14],
      [43.4, -8.5],
    ],
    fib,
    l.seed + 7,
    0.9,
    -1,
  );
  // fleece cuff around the opening (near half), rolled and fluffy
  ctx.save();
  ctx.translate(SL_CX, 0);
  paintNearRim(ctx, SL_OPEN, { top: FLEECE, line: lineOf(base) });
  ctx.restore();
  // a soft, slightly fuzzy roll along its lower edge
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(shadowOf(FLEECE, 0.35), 0.45);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(SL_CX, -26.1, 18.4, 3.68, 0, 0.12, Math.PI - 0.12);
  ctx.stroke();
  ctx.strokeStyle = rgba(FLEECE, 0.9);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(SL_CX, -26.8, 18.2, 3.6, 0, 0.1, Math.PI - 0.1);
  ctx.stroke();
  ctx.restore();
  const cuff: [number, number][] = [];
  for (let k = 0; k <= 14; k++) {
    const t = Math.PI - 0.1 - (k / 14) * (Math.PI - 0.2);
    cuff.push([SL_CX + 18.6 * Math.cos(t), -26.2 + 3.8 * Math.sin(t)]);
  }
  fuzz(ctx, cuff, rgba(FLEECE, 0.8), l.seed + 3, 0.8, 1);
  // pom-pom: a bumpy little cluster of fluff
  const px = 25;
  const py = -34.6;
  const pc = mix(FLEECE, base, 0.22);
  softShadow(ctx, px + 1.2, py + 5.8, 6.6, 2.2, 0.32);
  const blobs: [number, number, number][] = [
    [2.6, 2.4, 3.1],
    [-2.4, 2.6, 3],
    [3.2, -1.2, 3],
    [0, 3.1, 3],
    [-3.1, -0.8, 3],
    [1.2, -3, 2.9],
    [-1.4, -2.6, 2.8],
    [0, 0, 3.4],
  ];
  for (const [bx, by, br] of blobs) {
    const x = px + bx * L;
    const y = py + by;
    const g2 = ctx.createRadialGradient(x - 1.2 * L, y - 1.4, 0.2, x, y, br + 0.4);
    g2.addColorStop(0, lightOf(pc, 0.55));
    g2.addColorStop(0.55, pc);
    g2.addColorStop(1, shadowOf(pc, 0.35 + 0.08 * (bx + by > 0 ? 1 : 0)));
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(x, y, br, 0, TAU);
    ctx.fill();
  }
  const pom = (): void => {
    ctx.beginPath();
    ctx.arc(px, py, 5.6, 0, TAU);
  };
  texPaint(ctx, pom, 'furFine', { alpha: 0.4, scale: 0.2 });
  const rim: [number, number][] = [];
  for (let k = 0; k <= 24; k++) {
    const t = (k / 24) * TAU;
    rim.push([px + 5.4 * Math.cos(t), py + 5.4 * Math.sin(t)]);
  }
  fuzz(ctx, rim, rgba(pc, 0.85), l.seed + 11, 0.9, -1);
}

// ---------------------------------------------------------------------------

const ART: Record<ContainerType, Art> = {
  teacup: { back: teacupBack, front: teacupFront, foot: [0, 45, 3], ext: [-50, -70, 56, 3] },
  mug: { back: mugBack, front: mugFront, foot: [0, 30.5, 4.8], ext: [-36, -76, 52, 3] },
  boot: { back: bootBack, front: bootFront, foot: [11.8, 36.5, 2], ext: [-30, -86, 52, 3] },
  box: { back: boxBack, front: boxFront, foot: [0, 50.5, 2.2], ext: [-72, -100, 72, 3] },
  shoebox: { back: shoeboxBack, front: shoeboxFront, foot: [0, 44, 2], ext: [-50, -70, 52, 3] },
  fruitbowl: { back: fruitbowlBack, front: fruitbowlFront, foot: [0, 22.5, 3.5, 52], ext: [-66, -60, 66, 3] },
  sink: { back: sinkBack, front: sinkFront, foot: [0, 23.5, 3.7, 40], ext: [-82, -190, 82, 3] },
  pot: { back: potBack, front: potFront, foot: [0, 28, 4.4], ext: [-42, -71, 42, 3] },
  basket: { back: basketBack, front: basketFront, foot: [0, 55, 8.5], ext: [-66, -86, 66, 3] },
  saucepan: { back: saucepanBack, front: saucepanFront, foot: [0, 46.5, 7.3], ext: [-52, -58, 106, 3] },
  vase: { back: vaseBack, front: vaseFront, foot: [0, 31, 4.9], ext: [-40, -106, 40, 3] },
  bucket: { back: bucketBack, front: bucketFront, foot: [0, 31.5, 4.9], ext: [-44, -90, 44, 3] },
  slipper: { back: slipperBack, front: slipperFront, foot: [2.2, 41.5, 2], ext: [-44, -44, 48, 3] },
  mixingbowl: { back: mixingbowlBack, front: mixingbowlFront, foot: [0, 20, 3.1, 44], ext: [-58, -64, 58, 3] },
};

// A prop painted again and again (the one being dragged in the sandbox) is
// drawn from a sprite: the first time a layer of it is seen it is painted
// directly, a second sighting soon after caches it at this resolution.

interface Sprite {
  c: HTMLCanvasElement;
  x0: number;
  y0: number;
  w: number;
  h: number;
}

const sprites = new Map<string, Sprite>();
const sightings = new Map<string, number>();
const SPRITE_MAX = 6;

function paintArt(ctx: Ctx, p: Prop, which: 'back' | 'front'): void {
  const art = ART[p.type as ContainerType];
  if (!art) return;
  const look = lookOf(p);
  const paint = which === 'back' ? art.back : art.front;
  const m = ctx.getTransform();
  const upright = Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6;
  const q = resBucket(Math.abs(m.a) * p.scale);
  const id = `${which}|${p.type}|${look.v}|${p.flip ? 1 : 0}|${p.scale}|${look.seed}|${q}`;
  let sp = sprites.get(id);
  if (!sp && upright) {
    const now = performance.now();
    const seen = sightings.get(id);
    if (sightings.size > 256) sightings.clear();
    sightings.set(id, now);
    if (seen !== undefined && now - seen < 1500) {
      const [ex0, ey0, ex1, ey1] = art.ext;
      const x0 = p.flip ? -ex1 : ex0;
      const c = document.createElement('canvas');
      c.width = Math.ceil((ex1 - ex0) * q);
      c.height = Math.ceil((ey1 - ey0) * q);
      const g = c.getContext('2d')!;
      g.setTransform(q, 0, 0, q, -x0 * q, -ey0 * q);
      if (p.flip) g.scale(-1, 1);
      paint(g, look);
      sp = { c, x0, y0: ey0, w: c.width / q, h: c.height / q };
      if (sprites.size >= SPRITE_MAX) sprites.delete(sprites.keys().next().value!);
    }
  }
  ctx.save();
  if (sp) {
    sprites.delete(id);
    sprites.set(id, sp);
    ctx.translate(p.x, p.y);
    ctx.scale(p.scale, p.scale);
    ctx.drawImage(sp.c, sp.x0, sp.y0, sp.w, sp.h);
  } else {
    local(ctx, p);
    paint(ctx, look);
  }
  ctx.restore();
}

/** Local extent of a container's painted art (x0, y0, x1, y1), wider than its physics bounds. */
export function containerArtExtent(type: ContainerType): [number, number, number, number] {
  return ART[type].ext;
}

export function drawContainerBack(ctx: Ctx, p: Prop): void {
  paintArt(ctx, p, 'back');
}

export function drawContainerFront(ctx: Ctx, p: Prop): void {
  paintArt(ctx, p, 'front');
}

/** Contact shadow under a container sitting on a surface (world space). */
export function containerShadow(ctx: Ctx, p: Prop): void {
  const art = ART[p.type as ContainerType];
  if (!art) return;
  const [cx, hw, ry, broad] = art.foot;
  const s = p.scale;
  const x = p.x + (p.flip ? -cx : cx) * s;
  if (broad) softShadow(ctx, x + broad * s * 0.12, p.y - 1, broad * s, 7 * s, 0.1);
  restShadow(ctx, x, p.y - ry * s * 0.5, hw * s, (ry + 1) * s, 0.3);
}
