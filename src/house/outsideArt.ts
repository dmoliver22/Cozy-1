// The world outside the tall house. The house stands in its garden with the
// ground level with the living room's floor: the basement is down in the
// earth under it, the neighbours' houses and the trees stand along the
// street beside it, the hills are far off, and the sky is over it all, with
// the roof garden up high in it among the clouds. Painted into the house's
// cached tiles: the sky over the roof garden across the whole width (what's
// over its railing), and everything beside the house's walls (wide screens).

import { FLOOR_Y, WORLD_W } from '../game/props';
import { hash01, lightOf, mix, rgba, shadowOf, softShadow, type Ctx } from '../render/paint';
import { inkLine, paintTex } from '../render/roomKit';
import { FLOORS, HOUSE_BOTTOM, HOUSE_TOP } from './layout';

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const TAU = Math.PI * 2;
/** The ground outside: level with the living room's floor (its back edge; the lawn comes forward to its front edge, like the floor). */
export const GROUND_Y = FLOOR_Y;
const LAWN_FRONT = GROUND_Y + 44;
const DECK = FLOORS.roof.floorY;
/** The outer faces of the house's walls. */
const WALL_L = -7;
const WALL_R = WORLD_W + 7;
/** How far out either side there's anything (the widest screens). */
const REACH = 2600;
const SKY_TOP = HOUSE_TOP - 300;
const BOTTOM = HOUSE_BOTTOM + 300;

/** The sky, fixed to the world: clear blue up high, paling and warming down to the hills. */
function skyGradient(ctx: Ctx): CanvasGradient {
  const g = ctx.createLinearGradient(0, SKY_TOP, 0, GROUND_Y);
  const at = (y: number): number => (y - SKY_TOP) / (GROUND_Y - SKY_TOP);
  g.addColorStop(0, '#8DB8E0');
  g.addColorStop(at(DECK - 420), '#A4C8E7');
  g.addColorStop(at(DECK + 120), '#C2DBEE');
  g.addColorStop(at(GROUND_Y - 640), '#DCE8F1');
  g.addColorStop(at(GROUND_Y - 260), '#F3E7D9');
  g.addColorStop(1, '#F8DCBE');
  return g;
}

/** The sky's colour at a height (for the haze over far things). */
function skyAt(y: number): string {
  const stops: [number, string][] = [
    [SKY_TOP, '#8DB8E0'],
    [DECK - 420, '#A4C8E7'],
    [DECK + 120, '#C2DBEE'],
    [GROUND_Y - 640, '#DCE8F1'],
    [GROUND_Y - 260, '#F3E7D9'],
    [GROUND_Y, '#F8DCBE'],
  ];
  if (y <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [ya, ca] = stops[i - 1];
    const [yb, cb] = stops[i];
    if (y <= yb) return mix(ca, cb, (y - ya) / (yb - ya));
  }
  return stops[stops.length - 1][1];
}

// ---------------------------------------------------------------------------
// Up in the sky: the sun, the clouds and a few birds

/** Puffy afternoon cloud: overlapping rounds, lit on top, a lilac shade underneath. */
function cloud(ctx: Ctx, x: number, y: number, s: number, seed: number): void {
  const puffs: [number, number, number][] = [];
  const n = 5;
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1) - 0.5;
    puffs.push([x + u * 70 * s, y - (1 - Math.abs(u) * 1.6) * 10 * s + hash01(seed, k) * 4 * s, (14 + (1 - Math.abs(u) * 1.5) * 12 + hash01(seed, k + 9) * 5) * s]);
  }
  const path = (): void => {
    ctx.beginPath();
    for (const [px, py, pr] of puffs) {
      ctx.moveTo(px + pr, py);
      ctx.arc(px, py, pr, 0, TAU);
    }
    ctx.rect(x - 38 * s, y - 2 * s, 76 * s, 12 * s);
  };
  ctx.save();
  ctx.fillStyle = 'rgba(255,253,248,0.92)';
  path();
  ctx.fill();
  ctx.clip();
  const g = ctx.createLinearGradient(0, y - 30 * s, 0, y + 12 * s);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(206,196,226,0.05)');
  g.addColorStop(1, 'rgba(176,164,206,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 80 * s, y - 40 * s, 160 * s, 60 * s);
  ctx.restore();
}

/**
 * The clouds, world-fixed: the roof garden's own over the house, a few low
 * ones down past its railing (the roof is up high), and, out either side,
 * more and more of them the higher up it is.
 */
const CLOUDS: [number, number, number, number][] = (() => {
  const out: [number, number, number, number][] = [
    [268, DECK - 470, 1.05, 0],
    [150, DECK - 330, 0.7, 3],
    [330, DECK - 250, 0.55, 7],
    [-20, DECK - 230, 0.8, 11],
    // down below the deck, peeping over the railing
    [64, DECK - 6, 1.15, 13],
    [262, DECK + 4, 1.35, 17],
    [400, DECK - 24, 0.75, 19],
  ];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 30; k++) {
      const band = hash01(k, side + 40);
      // (thinning out lower down: next to none by the time it's over the neighbours)
      const y = DECK - 520 + band * band * 1500 + hash01(k, side + 50) * 60;
      const d = 90 + hash01(k, side + 60) * (REACH - 90);
      const x = side < 0 ? WALL_L - d : WALL_R + d;
      out.push([x, y, 0.55 + hash01(k, side + 70) * 0.8, 23 + k * 7 + (side + 1) * 300]);
    }
  }
  return out;
})();

/** Little birds far off: two arcs each. */
const BIRDS: [number, number, number][] = [
  [226, DECK - 392, 1],
  [242, DECK - 404, 0.8],
  [255, DECK - 386, 0.9],
  [-300, DECK + 160, 1],
  [-318, DECK + 150, 0.8],
  [WALL_R + 260, DECK - 120, 1],
  [WALL_R + 280, DECK - 132, 0.9],
  [WALL_R + 520, DECK + 420, 1],
];

function bird(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x - 7 * s, y - 2 * s);
  ctx.quadraticCurveTo(x - 3 * s, y - 5 * s, x, y);
  ctx.quadraticCurveTo(x + 3 * s, y - 5 * s, x + 7 * s, y - 2.5 * s);
  ctx.stroke();
}

/** The sun, up to the left of the roof garden, and its warmth. */
function sun(ctx: Ctx): void {
  const sx = 64;
  const sy = DECK - 418;
  const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 220);
  sg.addColorStop(0, 'rgba(255,246,214,0.95)');
  sg.addColorStop(0.08, 'rgba(255,240,200,0.85)');
  sg.addColorStop(0.1, 'rgba(255,236,196,0.5)');
  sg.addColorStop(0.45, 'rgba(255,226,180,0.16)');
  sg.addColorStop(1, 'rgba(255,226,180,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(sx - 220, sy - 220, 440, 440);
}

/** Sky, sun, clouds and birds over the rect (clipped by the caller). */
function paintSky(ctx: Ctx, r: Rect, seed: number): void {
  const y1 = Math.min(r.y1, GROUND_Y + 2);
  if (y1 <= r.y0) return;
  ctx.fillStyle = skyGradient(ctx);
  ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, y1 - r.y0);
  if (r.y0 < DECK - 180 && r.y1 > DECK - 640) sun(ctx);
  for (const [x, y, s, k] of CLOUDS) {
    if (x + 90 * s < r.x0 || x - 90 * s > r.x1 || y + 20 * s < r.y0 || y - 50 * s > r.y1) continue;
    cloud(ctx, x, y, s, seed + k);
  }
  ctx.save();
  ctx.strokeStyle = 'rgba(86,84,118,0.5)';
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  for (const [x, y, s] of BIRDS) if (x > r.x0 - 10 && x < r.x1 + 10 && y > r.y0 - 10 && y < r.y1 + 10) bird(ctx, x, y, s);
  ctx.restore();
}

/** The sky over the roof garden, from the top of the rect down to the deck, the whole width (painted under the deck and its railing). */
export function paintSkyOverRoof(ctx: Ctx, r: Rect, seed: number): void {
  // (a row past the deck's line: no seam)
  const y1 = Math.min(r.y1, DECK + 1);
  if (y1 <= r.y0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x0, r.y0, r.x1 - r.x0, y1 - r.y0);
  ctx.clip();
  paintSky(ctx, { ...r, y1 }, seed);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Down on the ground: the hills, the street, the garden and the earth

/** A soft ridge of hills across x0..x1, its top line from a few sines, filled down to `bottom`. */
function hills(ctx: Ctx, x0: number, x1: number, base: number, amp: number, wave: number, seed: number, bottom: number): void {
  const p1 = hash01(seed, 1) * TAU;
  const p2 = hash01(seed, 2) * TAU;
  const yAt = (x: number): number => base - amp * (0.6 + 0.4 * Math.sin(x / wave + p1)) * (0.75 + 0.25 * Math.sin(x / (wave * 0.37) + p2));
  ctx.beginPath();
  ctx.moveTo(x0, bottom);
  for (let x = x0; x <= x1 + 24; x += 24) ctx.lineTo(x, yAt(x));
  ctx.lineTo(x1 + 24, bottom);
  ctx.closePath();
}

/** Pale far hills along the horizon, and a nearer, greener rise with a hedge line. */
function farHills(ctx: Ctx, x0: number, x1: number, seed: number): void {
  ctx.fillStyle = mix('#B9C3DA', skyAt(GROUND_Y - 120), 0.35);
  hills(ctx, x0, x1, GROUND_Y - 90, 120, 210, seed + 1, GROUND_Y + 2);
  ctx.fill();
  ctx.fillStyle = mix('#A9BFA6', skyAt(GROUND_Y - 60), 0.4);
  hills(ctx, x0, x1, GROUND_Y - 40, 70, 150, seed + 2, GROUND_Y + 2);
  ctx.fill();
  // tiny far-off trees along its crest
  ctx.fillStyle = mix('#8FAE8E', skyAt(GROUND_Y - 60), 0.45);
  for (let x = Math.floor(x0 / 37) * 37; x < x1; x += 37) {
    const h = hash01(Math.round(x), seed + 3);
    if (h < 0.55) continue;
    const p1 = hash01(seed + 2, 1) * TAU;
    const p2 = hash01(seed + 2, 2) * TAU;
    const y = GROUND_Y - 40 - 70 * (0.6 + 0.4 * Math.sin(x / 150 + p1)) * (0.75 + 0.25 * Math.sin(x / (150 * 0.37) + p2));
    ctx.beginPath();
    ctx.ellipse(x, y - 6, 5 + h * 4, 7 + h * 6, 0, 0, TAU);
    ctx.fill();
  }
}

interface Neighbour {
  x0: number;
  w: number;
  /** Storeys, each this tall. */
  floors: number;
  wall: string;
  roof: string;
  seed: number;
}

const STOREY = 230;
const WALLS = ['#EBDCC5', '#CBD5BB', '#E3C3B6', '#C6CEDB', '#EED6AE'];
const ROOFS = ['#B9785F', '#8C8EA8', '#9C8F78', '#A86F6A'];

/** A neighbour's house: its walls, its gabled roof and chimney, its windows and door, in a little haze (it's back along the street). */
function neighbour(ctx: Ctx, n: Neighbour): void {
  const { x0, w, floors, seed } = n;
  const x1 = x0 + w;
  const eaves = GROUND_Y - floors * STOREY;
  const peak = eaves - w * 0.36;
  const haze = (c: string): string => mix(c, skyAt((eaves + GROUND_Y) / 2), 0.28);
  const wall = haze(n.wall);
  const roof = haze(n.roof);
  // the walls
  const body = (): void => {
    ctx.beginPath();
    ctx.rect(x0, eaves, w, GROUND_Y - eaves);
  };
  ctx.fillStyle = wall;
  body();
  ctx.fill();
  ctx.save();
  body();
  ctx.clip();
  paintTex(ctx, body, 'plaster', 0.16, 0.6, 0.6, x0, eaves);
  // the light from the left, shade on the right
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, 'rgba(255,240,214,0.18)');
  g.addColorStop(0.6, 'rgba(255,240,214,0)');
  g.addColorStop(1, 'rgba(74,62,100,0.14)');
  ctx.fillStyle = g;
  ctx.fillRect(x0, eaves, w, GROUND_Y - eaves);
  // under the eaves
  ctx.fillStyle = 'rgba(74,62,100,0.16)';
  ctx.fillRect(x0, eaves, w, 14);
  ctx.restore();
  // the chimney (behind the roof's slope)
  const cx = x0 + w * (0.68 + hash01(seed, 1) * 0.12);
  const cTop = peak + (cx - x0 - w / 2) * 0.72 - 46;
  ctx.fillStyle = haze('#B97C62');
  ctx.fillRect(cx - 12, cTop, 24, eaves - cTop);
  ctx.fillStyle = haze('#D8CDBF');
  ctx.fillRect(cx - 15, cTop - 6, 30, 7);
  // the roof
  const roofPath = (): void => {
    ctx.beginPath();
    ctx.moveTo(x0 - 18, eaves + 4);
    ctx.lineTo(x0 + w / 2, peak);
    ctx.lineTo(x1 + 18, eaves + 4);
    ctx.closePath();
  };
  ctx.fillStyle = roof;
  roofPath();
  ctx.fill();
  ctx.save();
  roofPath();
  ctx.clip();
  // rows of tiles
  ctx.strokeStyle = rgba(shadowOf(roof, 0.3), 0.35);
  ctx.lineWidth = 1.4;
  for (let y = peak + 16; y < eaves + 4; y += 15) {
    ctx.beginPath();
    ctx.moveTo(x0 - 20, y);
    ctx.lineTo(x1 + 20, y);
    ctx.stroke();
  }
  // lit on the left slope
  ctx.fillStyle = rgba(lightOf(roof, 0.5), 0.22);
  ctx.beginPath();
  ctx.moveTo(x0 - 18, eaves + 4);
  ctx.lineTo(x0 + w / 2, peak);
  ctx.lineTo(x0 + w / 2, eaves + 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  inkLine(ctx, roofPath, roof, 1.1, 0.35);
  // a round window up in the gable
  const gy = eaves - (eaves - peak) * 0.42;
  ctx.fillStyle = haze('#F6EEDF');
  ctx.beginPath();
  ctx.arc(x0 + w / 2, gy, 15, 0, TAU);
  ctx.fill();
  ctx.fillStyle = haze('#9FB9CF');
  ctx.beginPath();
  ctx.arc(x0 + w / 2, gy, 11, 0, TAU);
  ctx.fill();
  // windows, a row a storey (some lit warm, some with the sky in them)
  const cols = Math.max(2, Math.round(w / 110));
  for (let f = 0; f < floors; f++) {
    const top = eaves + f * STOREY + 58;
    for (let c = 0; c < cols; c++) {
      const wx = x0 + (w / cols) * (c + 0.5);
      // (the door goes on the ground floor, in the middle)
      if (f === floors - 1 && cols % 2 === 1 && c === (cols - 1) / 2) continue;
      if (f === floors - 1 && cols % 2 === 0 && c === cols / 2 - 1) continue;
      window_(ctx, wx, top, haze, hash01(seed, f * 10 + c) < 0.35);
    }
  }
  // the front door, its step and its little lamp
  const dx = cols % 2 === 1 ? x0 + w / 2 : x0 + (w / cols) * (cols / 2 - 0.5);
  const door = haze(['#7C93B5', '#B9705E', '#7FA284', '#C79A55'][Math.floor(hash01(seed, 7) * 4)]);
  ctx.fillStyle = haze('#F6EEDF');
  ctx.beginPath();
  ctx.rect(dx - 30, GROUND_Y - 150, 60, 150);
  ctx.arc(dx, GROUND_Y - 150, 30, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = door;
  ctx.beginPath();
  ctx.rect(dx - 23, GROUND_Y - 146, 46, 146);
  ctx.arc(dx, GROUND_Y - 146, 23, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = haze('#E8C46A');
  ctx.beginPath();
  ctx.arc(dx + 12, GROUND_Y - 70, 3, 0, TAU);
  ctx.fill();
  inkLine(ctx, body, wall, 1, 0.3);
}

/** A sash window with its sill: warm light in it, or the sky's reflection. */
function window_(ctx: Ctx, x: number, top: number, haze: (c: string) => string, lit: boolean): void {
  const w = 54;
  const h = 84;
  ctx.fillStyle = haze('#F6EEDF');
  ctx.fillRect(x - w / 2 - 6, top - 6, w + 12, h + 12);
  const g = ctx.createLinearGradient(0, top, 0, top + h);
  if (lit) {
    g.addColorStop(0, haze('#F7D99A'));
    g.addColorStop(1, haze('#EFB878'));
  } else {
    g.addColorStop(0, haze('#B8D0E6'));
    g.addColorStop(1, haze('#8FA9C6'));
  }
  ctx.fillStyle = g;
  ctx.fillRect(x - w / 2, top, w, h);
  // a curtain at one side
  ctx.fillStyle = haze(lit ? '#E6A889' : '#E7D6C7');
  ctx.fillRect(x - w / 2, top, 12, h);
  ctx.fillStyle = haze('#F6EEDF');
  ctx.fillRect(x - 2, top, 4, h);
  ctx.fillRect(x - w / 2, top + h / 2 - 2, w, 4);
  ctx.fillRect(x - w / 2 - 10, top + h + 5, w + 20, 7);
}

/** A big round garden tree: its trunk, and a crown of overlapping rounds lit from the upper left. */
function bigTree(ctx: Ctx, x: number, s: number, seed: number): void {
  const green = mix('#86A96F', skyAt(GROUND_Y - 300), 0.12);
  const top = GROUND_Y - 520 * s;
  // trunk and two limbs
  const bark = '#8C735F';
  ctx.fillStyle = bark;
  ctx.beginPath();
  ctx.moveTo(x - 20 * s, GROUND_Y);
  ctx.quadraticCurveTo(x - 10 * s, GROUND_Y - 160 * s, x - 14 * s, top + 220 * s);
  ctx.lineTo(x + 14 * s, top + 220 * s);
  ctx.quadraticCurveTo(x + 10 * s, GROUND_Y - 160 * s, x + 22 * s, GROUND_Y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = bark;
  ctx.lineCap = 'round';
  ctx.lineWidth = 9 * s;
  ctx.beginPath();
  ctx.moveTo(x, top + 260 * s);
  ctx.quadraticCurveTo(x - 40 * s, top + 200 * s, x - 70 * s, top + 160 * s);
  ctx.moveTo(x + 2 * s, top + 240 * s);
  ctx.quadraticCurveTo(x + 50 * s, top + 190 * s, x + 76 * s, top + 140 * s);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,240,214,0.18)';
  ctx.fillRect(x - 16 * s, top + 230 * s, 8 * s, GROUND_Y - top - 230 * s);
  // the crown
  const puffs: [number, number, number][] = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU + hash01(seed, k) * 0.5;
    const d = (60 + hash01(seed, k + 20) * 40) * s;
    puffs.push([x + Math.cos(a) * d * 1.15, top + 150 * s + Math.sin(a) * d * 0.85, (62 + hash01(seed, k + 40) * 26) * s]);
  }
  puffs.push([x, top + 140 * s, 96 * s]);
  const crown = (dx: number, dy: number, k: number): void => {
    ctx.beginPath();
    for (const [px, py, pr] of puffs) {
      ctx.moveTo(px + dx + pr * k, py + dy);
      ctx.arc(px + dx, py + dy, pr * k, 0, TAU);
    }
  };
  ctx.fillStyle = shadowOf(green, 0.3);
  crown(6 * s, 8 * s, 1);
  ctx.fill();
  ctx.fillStyle = green;
  crown(0, 0, 0.93);
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(green, 0.55), 0.55);
  crown(-14 * s, -16 * s, 0.6);
  ctx.fill();
  // a few leaf dabs
  ctx.fillStyle = rgba(lightOf(green, 0.8), 0.5);
  for (let k = 0; k < 14; k++) {
    const [px, py, pr] = puffs[k % puffs.length];
    ctx.beginPath();
    ctx.ellipse(px - pr * 0.4 + hash01(seed, k + 60) * pr * 0.5, py - pr * 0.5 + hash01(seed, k + 80) * pr * 0.4, 7 * s, 4 * s, -0.5, 0, TAU);
    ctx.fill();
  }
}

/** A slim poplar. */
function poplar(ctx: Ctx, x: number, s: number): void {
  const green = mix('#7E9F6E', skyAt(GROUND_Y - 300), 0.22);
  ctx.fillStyle = '#8C735F';
  ctx.fillRect(x - 6 * s, GROUND_Y - 90 * s, 12 * s, 90 * s);
  ctx.fillStyle = shadowOf(green, 0.25);
  ctx.beginPath();
  ctx.ellipse(x + 6 * s, GROUND_Y - 330 * s, 62 * s, 250 * s, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = green;
  ctx.beginPath();
  ctx.ellipse(x, GROUND_Y - 338 * s, 54 * s, 240 * s, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(green, 0.5), 0.5);
  ctx.beginPath();
  ctx.ellipse(x - 18 * s, GROUND_Y - 400 * s, 20 * s, 150 * s, 0.05, 0, TAU);
  ctx.fill();
}

/** A round bush. */
function bush(ctx: Ctx, x: number, w: number, seed: number): void {
  const green = '#8DB07A';
  const path = (dy: number, k: number): void => {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const u = i / 3 - 0.5;
      const r = (w * 0.3 + hash01(seed, i) * w * 0.08) * k;
      ctx.moveTo(x + u * w * 0.7 + r, GROUND_Y - r * 0.7 + dy);
      ctx.arc(x + u * w * 0.7, GROUND_Y - r * 0.7 + dy, r, 0, TAU);
    }
  };
  ctx.fillStyle = shadowOf(green, 0.3);
  path(3, 1);
  ctx.fill();
  ctx.fillStyle = green;
  path(0, 0.92);
  ctx.fill();
  ctx.fillStyle = rgba(lightOf(green, 0.6), 0.5);
  path(-6, 0.5);
  ctx.fill();
  // a few flowers on it
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#F4C6CF' : '#FFF4E4';
    ctx.beginPath();
    ctx.arc(x + (hash01(seed, i + 10) - 0.5) * w * 0.8, GROUND_Y - w * 0.15 - hash01(seed, i + 20) * w * 0.3, 3.2, 0, TAU);
    ctx.fill();
  }
}

/** The white picket fence along the back of the lawn. */
function fence(ctx: Ctx, x0: number, x1: number): void {
  const wood = '#F4EDE2';
  const top = GROUND_Y - 74;
  ctx.fillStyle = mix(wood, '#C9BBA8', 0.35);
  ctx.fillRect(x0, GROUND_Y - 58, x1 - x0, 7);
  ctx.fillRect(x0, GROUND_Y - 26, x1 - x0, 7);
  for (let x = Math.floor(x0 / 19) * 19 + 4; x < x1; x += 19) {
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.moveTo(x - 4.5, GROUND_Y);
    ctx.lineTo(x - 4.5, top + 6);
    ctx.lineTo(x, top);
    ctx.lineTo(x + 4.5, top + 6);
    ctx.lineTo(x + 4.5, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(122,104,140,0.22)';
    ctx.fillRect(x + 2, top + 6, 2.5, GROUND_Y - top - 6);
  }
}

/** The lawn: from the fence forward to its front edge, mown in stripes (seen a little from above, like the floors). */
function lawn(ctx: Ctx, x0: number, x1: number, seed: number): void {
  const g = ctx.createLinearGradient(0, GROUND_Y, 0, LAWN_FRONT);
  g.addColorStop(0, '#9DBE83');
  g.addColorStop(1, '#88AE6F');
  ctx.fillStyle = g;
  ctx.fillRect(x0, GROUND_Y - 1, x1 - x0, LAWN_FRONT - GROUND_Y + 1);
  // stripes toward the vanishing point (the floors' own: over the middle of the house, high up)
  const vx = WORLD_W / 2;
  const vy = -900;
  const k = (GROUND_Y - vy) / (LAWN_FRONT - vy);
  ctx.fillStyle = 'rgba(255,255,236,0.1)';
  for (let x = Math.floor(x0 / 80) * 80; x < x1 + 80; x += 80) {
    const a = x;
    const b = x + 40;
    ctx.beginPath();
    ctx.moveTo(a, LAWN_FRONT);
    ctx.lineTo(b, LAWN_FRONT);
    ctx.lineTo(vx + (b - vx) * k, GROUND_Y);
    ctx.lineTo(vx + (a - vx) * k, GROUND_Y);
    ctx.closePath();
    ctx.fill();
  }
  // shade along the back, under the fence
  ctx.fillStyle = 'rgba(74,92,64,0.16)';
  ctx.fillRect(x0, GROUND_Y - 1, x1 - x0, 5);
  // flowers in the grass
  for (let x = Math.floor(x0 / 23) * 23; x < x1; x += 23) {
    const h = hash01(Math.round(x), seed + 5);
    if (h > 0.5) continue;
    const fy = GROUND_Y + 8 + hash01(Math.round(x), seed + 6) * 30;
    const fx = x + hash01(Math.round(x), seed + 7) * 18;
    ctx.fillStyle = h < 0.16 ? '#F7D27A' : h < 0.32 ? '#FFF6EA' : '#F2B8C6';
    ctx.beginPath();
    ctx.arc(fx, fy, 2.2, 0, TAU);
    ctx.fill();
  }
  // blades along the front edge
  ctx.strokeStyle = '#7FA466';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let x = Math.floor(x0 / 6) * 6; x < x1; x += 6) {
    const h = 3 + hash01(Math.round(x), seed + 8) * 5;
    ctx.moveTo(x, LAWN_FRONT + 1);
    ctx.lineTo(x + (hash01(Math.round(x), seed + 9) - 0.5) * 4, LAWN_FRONT + 1 - h);
  }
  ctx.stroke();
}

/** The earth under the lawn, cut through (the basement is down in it): layers of soil, pebbles, roots, and a buried treasure or two. */
function earth(ctx: Ctx, x0: number, x1: number, y0: number, y1: number, seed: number): void {
  const top = Math.max(y0, LAWN_FRONT);
  if (y1 <= top) return;
  const g = ctx.createLinearGradient(0, LAWN_FRONT, 0, BOTTOM);
  g.addColorStop(0, '#8C6B4F');
  g.addColorStop(0.08, '#9A7A5C');
  g.addColorStop(0.45, '#A88B6C');
  g.addColorStop(0.75, '#9C8670');
  g.addColorStop(1, '#8D7D6E');
  ctx.fillStyle = g;
  ctx.fillRect(x0, top, x1 - x0, y1 - top);
  const area = (): void => {
    ctx.beginPath();
    ctx.rect(x0, top, x1 - x0, y1 - top);
  };
  paintTex(ctx, area, 'speckle', 0.22, 0.8, 0.8, 0, LAWN_FRONT);
  // the turf's edge: dark, with the grass's roots
  ctx.fillStyle = '#6E7F52';
  ctx.fillRect(x0, LAWN_FRONT, x1 - x0, 7);
  ctx.strokeStyle = 'rgba(94,72,52,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.floor(x0 / 9) * 9; x < x1; x += 9) {
    ctx.moveTo(x, LAWN_FRONT + 6);
    ctx.lineTo(x + (hash01(Math.round(x), seed + 30) - 0.5) * 6, LAWN_FRONT + 10 + hash01(Math.round(x), seed + 31) * 9);
  }
  ctx.stroke();
  // soft bands of darker and lighter soil
  for (const [y, h, c] of [
    [LAWN_FRONT + 120, 70, 'rgba(110,80,58,0.18)'],
    [LAWN_FRONT + 330, 50, 'rgba(255,236,206,0.1)'],
    [LAWN_FRONT + 560, 90, 'rgba(96,80,72,0.14)'],
  ] as const) {
    if (y + h < top || y - h > y1) continue;
    ctx.fillStyle = c;
    hills(ctx, x0, x1, y, 14, 90, seed + y, y + h);
    ctx.fill();
  }
  // pebbles and stones
  for (let x = Math.floor(x0 / 31) * 31; x < x1; x += 31) {
    for (let j = 0; j < 4; j++) {
      const h = hash01(Math.round(x) + j * 7919, seed + 40);
      const py = LAWN_FRONT + 30 + hash01(Math.round(x) + j * 7919, seed + 41) * (BOTTOM - LAWN_FRONT - 30);
      if (py < top - 20 || py > y1 + 20) continue;
      const deep = (py - LAWN_FRONT) / (BOTTOM - LAWN_FRONT);
      if (h > 0.22 + deep * 0.3) continue;
      const px = x + hash01(Math.round(x) + j * 7919, seed + 42) * 31;
      const rw = 3 + hash01(Math.round(x) + j, seed + 43) * (4 + deep * 14);
      const stone = mix('#C2B4A2', '#9A928A', hash01(Math.round(x) + j, seed + 44));
      ctx.fillStyle = shadowOf(stone, 0.35);
      ctx.beginPath();
      ctx.ellipse(px + 1, py + 1.2, rw, rw * 0.62, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = stone;
      ctx.beginPath();
      ctx.ellipse(px, py, rw, rw * 0.62, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,248,236,0.35)';
      ctx.beginPath();
      ctx.ellipse(px - rw * 0.3, py - rw * 0.25, rw * 0.4, rw * 0.2, -0.3, 0, TAU);
      ctx.fill();
    }
  }
}

/** The big trees' roots, down in the earth. */
function roots(ctx: Ctx, x: number, s: number, seed: number): void {
  ctx.strokeStyle = 'rgba(112,86,64,0.75)';
  ctx.lineCap = 'round';
  for (let k = 0; k < 5; k++) {
    const dir = k / 4 - 0.5;
    ctx.lineWidth = (5 - Math.abs(dir) * 4) * s;
    ctx.beginPath();
    ctx.moveTo(x + dir * 20 * s, LAWN_FRONT + 4);
    ctx.bezierCurveTo(x + dir * 70 * s, LAWN_FRONT + 50 * s, x + dir * 120 * s + (hash01(seed, k) - 0.5) * 40, LAWN_FRONT + (90 + hash01(seed, k + 5) * 60) * s, x + dir * 190 * s, LAWN_FRONT + (130 + hash01(seed, k + 9) * 90) * s);
    ctx.stroke();
  }
}

/** A fish's bones, buried long ago (somebody's treasure). */
function fishBones(ctx: Ctx, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.12);
  ctx.strokeStyle = 'rgba(246,238,224,0.85)';
  ctx.fillStyle = 'rgba(246,238,224,0.85)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(18, 0);
  for (let i = 0; i < 5; i++) {
    const bx = -16 + i * 7;
    ctx.moveTo(bx, -8 + Math.abs(i - 2) * 1.2);
    ctx.quadraticCurveTo(bx + 3, 0, bx, 8 - Math.abs(i - 2) * 1.2);
  }
  // the tail
  ctx.moveTo(-26, 0);
  ctx.lineTo(-34, -7);
  ctx.moveTo(-26, 0);
  ctx.lineTo(-34, 7);
  ctx.stroke();
  // the head
  ctx.beginPath();
  ctx.moveTo(18, -8);
  ctx.quadraticCurveTo(32, -4, 32, 0);
  ctx.quadraticCurveTo(32, 4, 18, 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(140,107,79,0.9)';
  ctx.beginPath();
  ctx.arc(24, -1.5, 1.8, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A worm, curled up. */
function worm(ctx: Ctx, x: number, y: number): void {
  ctx.strokeStyle = '#D99A8C';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 14, y + 2);
  ctx.bezierCurveTo(x - 8, y - 8, x - 2, y + 8, x + 4, y - 1);
  ctx.bezierCurveTo(x + 8, y - 7, x + 13, y - 2, x + 15, y - 5);
  ctx.stroke();
}

/** What stands along the street on one side of the house, from the house outwards. */
interface Street {
  trees: { x: number; s: number; seed: number }[];
  poplars: { x: number; s: number }[];
  houses: Neighbour[];
  bushes: { x: number; w: number; seed: number }[];
}

function street(side: -1 | 1): Street {
  const out: Street = { trees: [], poplars: [], houses: [], bushes: [] };
  const at = (d: number): number => (side < 0 ? WALL_L - d : WALL_R + d);
  // a big garden tree by the house, then houses with gaps, trees and bushes between them
  out.trees.push({ x: at(side < 0 ? 170 : 210), s: side < 0 ? 1 : 0.85, seed: 3 + side });
  out.bushes.push({ x: at(60), w: 90, seed: 5 + side });
  let d = side < 0 ? 330 : 380;
  let k = 0;
  while (d < REACH) {
    const w = 300 + hash01(k, side + 90) * 120;
    const floors = 2 + (hash01(k, side + 91) < 0.3 ? 1 : 0);
    const x0 = side < 0 ? at(d) - w : at(d);
    out.houses.push({ x0, w, floors, wall: WALLS[(k * 2 + (side > 0 ? 1 : 0)) % WALLS.length], roof: ROOFS[(k + (side > 0 ? 2 : 0)) % ROOFS.length], seed: 100 + k * 13 + side });
    d += w + 70 + hash01(k, side + 92) * 70;
    if (hash01(k, side + 93) < 0.5) out.poplars.push({ x: at(d - 35), s: 0.8 + hash01(k, side + 94) * 0.35 });
    else out.trees.push({ x: at(d + 60), s: 0.7 + hash01(k, side + 95) * 0.3, seed: 40 + k * 3 + side });
    out.bushes.push({ x: at(d - 20), w: 60 + hash01(k, side + 96) * 50, seed: 60 + k * 5 + side });
    d += 150;
    k++;
  }
  return out;
}

const STREETS = [street(-1), street(1)];

/**
 * Everything out either side of the house's walls, from the roof's deck
 * down (painted over the rooms' ragged outer edges): the sky and its
 * clouds, the far hills, the neighbours' houses and the trees along the
 * street, the fence, the lawn level with the living room's floor, and the
 * earth the basement is dug into.
 */
export function paintAround(ctx: Ctx, r: Rect, seed: number): void {
  const y0 = Math.max(r.y0, DECK);
  if (y0 >= r.y1) return;
  for (const [side, x0, x1] of [
    [0, r.x0, Math.min(r.x1, WALL_L)],
    [1, Math.max(r.x0, WALL_R), r.x1],
  ] as const) {
    if (x1 <= x0) continue;
    const rr = { x0, y0, x1, y1: r.y1 };
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, r.y1 - y0);
    ctx.clip();
    paintSky(ctx, rr, seed);
    const st = STREETS[side];
    if (r.y1 > GROUND_Y - 1500 && y0 < LAWN_FRONT) {
      if (r.y1 > GROUND_Y - 260) farHills(ctx, x0, x1, seed + side * 7);
      for (const n of st.houses) if (n.x0 < x1 && n.x0 + n.w > x0) neighbour(ctx, n);
      for (const p of st.poplars) if (Math.abs(p.x - (x0 + x1) / 2) < (x1 - x0) / 2 + 80) poplar(ctx, p.x, p.s);
      for (const t of st.trees) if (Math.abs(t.x - (x0 + x1) / 2) < (x1 - x0) / 2 + 220) bigTree(ctx, t.x, t.s, t.seed);
      if (r.y1 > GROUND_Y - 80) {
        lawn(ctx, x0, x1, seed + side);
        // the trees' shadows on the lawn
        for (const t of st.trees) softShadow(ctx, t.x + 20, GROUND_Y + 22, 150 * t.s, 16, 0.16);
        fence(ctx, x0, x1);
        for (const b of st.bushes) if (Math.abs(b.x - (x0 + x1) / 2) < (x1 - x0) / 2 + b.w) bush(ctx, b.x, b.w, b.seed);
      }
    }
    if (r.y1 > LAWN_FRONT) {
      earth(ctx, x0, x1, y0, r.y1, seed + side * 11);
      for (const t of st.trees) roots(ctx, t.x, t.s, t.seed);
      if (side === 0) {
        fishBones(ctx, WALL_L - 230, LAWN_FRONT + 300);
        worm(ctx, WALL_L - 520, LAWN_FRONT + 120);
      } else {
        worm(ctx, WALL_R + 300, LAWN_FRONT + 210);
        fishBones(ctx, WALL_R + 640, LAWN_FRONT + 470);
      }
    }
    ctx.restore();
  }
}
