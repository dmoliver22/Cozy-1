// Glass containers, in two layers: the "back" (the far wall seen through the
// glass, the far half of the rim, light and shade on the floor) goes under the
// cats; the "front" (the near wall, walls and base seen edge-on, the near rim,
// highlights) goes over them, mostly clear so a cat inside shows through,
// slightly veiled. The glass is drawn exactly on the physics parts, so a
// squished cat presses against its inner face. Drawing is in local space
// (origin bottom centre, up is -y), mirrored for flipped props while the light
// stays upper left.

import { CONTAINERS, type ContainerType, type Prop } from '../game/props';
import { glint, hash01, lightGradient, lightOf, mix, rgba, roundRect, shadowOf, type Box, type Ctx } from './paint';
import {
  K,
  bezierPts,
  caustic,
  cavityAt,
  cavityPath,
  glassShape,
  glassSolid,
  glassStreak,
  glassWall,
  lightDir,
  litFrame,
  lsign,
  partPath,
  resBucket,
  restShadow,
  ribbonPath,
  rimLip,
  rivet,
  scanCavity,
  shapePart,
  sparkle,
  texPaint,
  tube,
  type Cavity,
  type GlassPart,
  type Part,
  type Rim,
  type ShapePart,
} from './propKit';

/** Light glass tints per container (variants are picked by the prop's tint). */
const TINTS: Record<ContainerType, string[]> = {
  teacup: ['#A9CCEC', '#A6DCC5', '#EDBACB', '#EED49C'],
  mug: ['#D9E9EF', '#E6D8C4', '#CDE7D6', '#D2DCF2'],
  boot: ['#F0BE6C', '#EFA77A', '#B4D8A6', '#A8C3EA'],
  box: ['#D6E8EA'],
  shoebox: ['#D3E5EE', '#EED5DC', '#D2E9D3'],
  fruitbowl: ['#BCE2C0', '#BAD4EE', '#EFC3C3', '#EFD9A2'],
  sink: ['#DDEBEF'],
  pot: ['#C9E5CD', '#E6D3BC'],
  basket: ['#DAE9E9'],
  saucepan: ['#E9AC62', '#E6A3AB'],
  vase: ['#A9DCCA', '#B4CBEB', '#EDC0CA'],
  bucket: ['#D9E7EE', '#EFD1D5'],
  slipper: ['#CFE3F7', '#E1D4F4', '#CFEDE1'],
  mixingbowl: ['#CFE2F2', '#DFEAEE', '#D2EBDC'],
};

const TAU = Math.PI * 2;
const GOLD = '#D7AC57';
const CHROME = '#BAC6D1';
const CHROME_LINE = '#8E9AA9';
const BRASS = '#C9A15A';

interface Look {
  base: string;
  /** Index of the tint within the container's palette. */
  v: number;
  /** Stable per prop, for deterministic decoration. */
  seed: number;
}

function lookOf(p: Prop): Look {
  const list = TINTS[p.type as ContainerType] ?? TINTS.mug;
  const v = ((p.tint % list.length) + list.length) % list.length;
  return { base: list[v], v, seed: p.uid * 13 + p.tint };
}

function local(ctx: Ctx, p: Prop): void {
  ctx.translate(p.x, p.y);
  ctx.scale(p.flip ? -p.scale : p.scale, p.scale);
}

/** The glass of a container type, derived once from its physics parts. */
interface Geo {
  type: ContainerType;
  solid: GlassPart[];
  thick: GlassPart[];
  cav: Cavity;
  rim: Rim;
}

type Painter = (ctx: Ctx, l: Look, g: Geo) => void;

interface Glass {
  /** Parts drawn by the type's own painters (handles, saucer), not as glass body. */
  skip?: number[];
  /** Thick parts (bases, feet): denser, greener glass. */
  thick: number[];
  /**
   * Extra solid glass, drawn only and thick: a smooth toe replacing the
   * physics' boxy one (listed in skip), tracing the hollow's exact inner face.
   */
  extra?: (cav: Cavity) => ShapePart[];
  /** Round rim: centre x, y and radius of the wall centres at the top, and the wall radius. */
  rim: [number, number, number, number];
  /** Straight-sided box: how deep its opening reaches back. */
  depth?: number;
  gold?: boolean;
  /** Under the far wall, and over the back layer (still under the cats). */
  back?: Painter;
  backOver?: Painter;
  /** Over the cats: before the glass body (things behind or inside the glass), and on top. */
  front?: Painter;
  frontOver?: Painter;
  /** Contact footprint: centre x, half width, base ellipse ry. */
  foot: [number, number, number];
  /** Local extent of everything painted (x0, y0, x1, y1). */
  ext: [number, number, number, number];
}

const geos = new Map<ContainerType, Geo>();

function geoOf(type: ContainerType): Geo {
  let g = geos.get(type);
  if (g) return g;
  const spec = CONTAINERS[type];
  const def = GLASS[type];
  const parts = spec.parts as Part[];
  const [cx, y, rxm, r] = def.rim;
  const cav = scanCavity(parts, (spec.opening[0] + spec.opening[1]) / 2, y);
  const extra = def.extra?.(cav) ?? [];
  g = {
    type,
    solid: [...parts.filter((_, i) => !def.skip?.includes(i)), ...extra],
    thick: [...def.thick.filter((i) => !def.skip?.includes(i)).map((i) => parts[i]), ...extra],
    cav,
    rim: { cx, y, rxm, r },
  };
  geos.set(type, g);
  return g;
}

// ---------------------------------------------------------------------------
// The generic glass layers

/** Light and shade where the hollow meets the floor: a soft ring of shade and a caustic. */
function floorLight(ctx: Ctx, c: Cavity, tint: string): void {
  if (c.n < 2) return;
  const L = lsign(ctx);
  const { cx, hw } = cavityAt(c, c.floorY - 0.6);
  const ry = Math.max(1.2, hw * K);
  const y = c.floorY;
  ctx.save();
  ctx.translate(cx, y);
  ctx.scale(1, ry / hw);
  const g = ctx.createRadialGradient(0, 0, hw * 0.35, 0, 0, hw);
  g.addColorStop(0, rgba(shadowOf(tint, 0.6), 0));
  g.addColorStop(1, rgba(shadowOf(tint, 0.6), 0.28));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, hw, 0, TAU);
  ctx.fill();
  ctx.restore();
  caustic(ctx, cx + L * hw * 0.32, y, hw * 0.42, ry * 0.5, 0.5, mix('#FFF4DA', tint, 0.25));
}

/** The far wall, floor light and far rim lip (under the cats). */
function glassBack(ctx: Ctx, l: Look, g: Geo): void {
  const def = GLASS[g.type];
  const { cav, rim } = g;
  def.back?.(ctx, l, g);
  if (def.depth) boxBack(ctx, l.base, g, def.depth);
  else {
    const ri = rim.rxm - rim.r;
    glassWall(
      ctx,
      g.type,
      cav,
      l.base,
      true,
      () => {
        ctx.beginPath();
        cavityPath(ctx, cav);
        ctx.ellipse(rim.cx, rim.y, ri, ri * K, 0, 0, TAU);
      },
      rim.y - ri * K,
    );
    floorLight(ctx, cav, l.base);
    rimLip(ctx, rim, l.base, 'far', def.gold ? GOLD : undefined);
  }
  def.backOver?.(ctx, l, g);
}

/** The near wall, the glass body, the near rim and the highlights (over the cats). */
function glassFront(ctx: Ctx, l: Look, g: Geo): void {
  const def = GLASS[g.type];
  const { cav, rim } = g;
  const T = l.base;
  def.front?.(ctx, l, g);
  ctx.save();
  if (!def.depth) {
    const ro = rim.rxm + rim.r;
    ctx.beginPath();
    ctx.moveTo(rim.cx - ro, rim.y);
    ctx.ellipse(rim.cx, rim.y, ro, ro * K, 0, Math.PI, 0, true);
    ctx.lineTo(rim.cx + ro, rim.y + 400);
    ctx.lineTo(rim.cx - ro, rim.y + 400);
    ctx.closePath();
    ctx.clip();
  }
  glassWall(ctx, g.type, cav, T, false, () => {
    ctx.beginPath();
    cavityPath(ctx, cav);
  });
  ctx.restore();
  glassSolid(ctx, g.solid, g.thick, T);
  floorEdge(ctx, cav, T);
  if (def.depth) boxNearEdge(ctx, T, g);
  else rimLip(ctx, rim, T, 'near', def.gold ? GOLD : undefined);
  def.frontOver?.(ctx, l, g);
  // crisp streaks down the near wall on the lit side, and a glint
  if (cav.n > 4) {
    const top = cav.y0 + (cav.floorY - cav.y0) * 0.08;
    const len = cav.floorY - cav.y0;
    glassStreak(ctx, cav, 0.72, top + 2, top + len * 0.72, Math.min(3, 0.9 + len * 0.04), 0.7);
    glassStreak(ctx, cav, 0.52, top + len * 0.1, top + len * 0.45, Math.min(1.4, 0.5 + len * 0.02), 0.45);
    glassStreak(ctx, cav, -0.8, top + len * 0.3, top + len * 0.8, Math.min(1.6, 0.6 + len * 0.02), 0.22);
    const L = lsign(ctx);
    const { cx, hw } = cavityAt(cav, top + 3);
    glint(ctx, cx - L * hw * 0.7, top + 3, 1, 0.9);
  }
}

/** The near edge of the floor (the inside bottom seen through the front), a thin bright arc. */
function floorEdge(ctx: Ctx, c: Cavity, tint: string): void {
  if (c.n < 2) return;
  const { cx, hw } = cavityAt(c, c.floorY - 0.6);
  ctx.save();
  ctx.strokeStyle = rgba(lightOf(tint, 0.85), 0.55);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(cx, c.floorY, hw, Math.max(1, hw * K), 0, 0.15, Math.PI - 0.15);
  ctx.stroke();
  ctx.restore();
}

// --- Straight-sided boxes -----------------------------------------------------------

/** Back pane and the opening of a glass box, with the glass edges round the top. */
function boxBack(ctx: Ctx, tint: string, g: Geo, depth: number): void {
  const { cav, rim } = g;
  const y = rim.y;
  const ri = rim.rxm - rim.r;
  const bx = ri - depth * 0.45;
  const by = y - depth;
  glassWall(
    ctx,
    g.type,
    cav,
    tint,
    true,
    () => {
      ctx.beginPath();
      cavityPath(ctx, cav);
      ctx.moveTo(-ri, y + 0.5);
      ctx.lineTo(-bx, by);
      ctx.lineTo(bx, by);
      ctx.lineTo(ri, y + 0.5);
      ctx.closePath();
    },
    by,
  );
  floorLight(ctx, cav, tint);
  // the panes' top edges: back, and the two sides running back from the front corners
  const b: Box = { x0: -rim.rxm - rim.r, y0: by - 2, x1: rim.rxm + rim.r, y1: y + 2 };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(mix(tint, shadowOf(tint, 0.3), 0.5), 0.4);
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(-rim.rxm, y);
  ctx.lineTo(-bx - rim.r * 0.6, by);
  ctx.lineTo(bx + rim.r * 0.6, by);
  ctx.lineTo(rim.rxm, y);
  ctx.stroke();
  ctx.strokeStyle = lightGradient(ctx, b, [[0, 'rgba(255,255,255,0.9)'], [1, rgba(lightOf(tint, 0.6), 0.55)]], lightDir(ctx));
  ctx.lineWidth = 0.9;
  ctx.stroke();
  // the back pane's lower edge meeting the floor, seen through the glass
  ctx.strokeStyle = rgba(lightOf(tint, 0.8), 0.35);
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-bx, cav.floorY - depth * 0.8);
  ctx.lineTo(bx, cav.floorY - depth * 0.8);
  ctx.stroke();
  ctx.restore();
}

/** The front pane's top edge: a thin bright strip of glass between the walls. */
function boxNearEdge(ctx: Ctx, tint: string, g: Geo): void {
  const { rim } = g;
  const ri = rim.rxm - rim.r;
  const b: Box = { x0: -ri, y0: rim.y - 1, x1: ri, y1: rim.y + 2 };
  ctx.save();
  ctx.fillStyle = rgba(lightOf(tint, 0.6), 0.45);
  ctx.fillRect(-ri, rim.y, 2 * ri, 1.5);
  ctx.strokeStyle = lightGradient(ctx, b, [[0, 'rgba(255,255,255,0.95)'], [1, rgba(lightOf(tint, 0.6), 0.6)]], lightDir(ctx));
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-ri, rim.y + 0.2);
  ctx.lineTo(ri, rim.y + 0.2);
  ctx.moveTo(-ri, rim.y + 1.6);
  ctx.lineTo(ri, rim.y + 1.6);
  ctx.stroke();
  ctx.restore();
}

/** The hollow's right inner face from height y0 down to the floor, as points. */
function rightFace(c: Cavity, y0: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < c.n; i++) {
    const y = c.y0 + i * c.step;
    if (y >= y0) out.push([c.xr[i], y]);
  }
  out.push([c.xr[c.n - 1], c.floorY]);
  return out;
}

// ---------------------------------------------------------------------------
// Small glass details

/** A glass handle or loop along a centre line: drawn behind the walls it joins. */
function glassHandle(ctx: Ctx, g: Geo, pts: [number, number][], w: number, tint: string): void {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const b: Box = { x0: Math.min(...xs) - w, y0: Math.min(...ys) - w, x1: Math.max(...xs) + w, y1: Math.max(...ys) + w };
  const pb = b;
  ctx.save();
  // keep out of the walls, so the handle joins them from behind
  ctx.beginPath();
  ctx.moveTo(pb.x0 - 60, pb.y0 - 60);
  ctx.lineTo(pb.x0 - 60, pb.y1 + 60);
  ctx.lineTo(pb.x1 + 60, pb.y1 + 60);
  ctx.lineTo(pb.x1 + 60, pb.y0 - 60);
  ctx.closePath();
  for (const p of g.solid) partPath(ctx, p);
  ctx.clip();
  glassShape(ctx, () => ribbonPath(ctx, pts, w), b, tint, 0.34);
  // a highlight running along the lit side of the handle
  const d = lightDir(ctx);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 0.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const k0 = Math.floor(pts.length * 0.15);
  const k1 = Math.ceil(pts.length * 0.75);
  for (let i = k0; i < k1; i++) {
    const x = pts[i][0] + d.x * w * 0.22;
    const y = pts[i][1] + d.y * w * 0.22;
    if (i === k0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Points around the glass at height y (front half), for etched or painted motifs. */
function aroundGlass(g: Geo, y: number, n: number, phase: number, fn: (x: number, y: number, squash: number, fade: number) => void): void {
  const { cx, hw } = cavityAt(g.cav, y);
  const R = hw + g.rim.r * 0.8;
  for (let i = 0; i < n; i++) {
    const th = ((i + phase) / n) * TAU;
    const c = Math.cos(th);
    if (c < 0.15) continue;
    fn(cx + R * Math.sin(th), y + R * K * c, c, Math.min(1, (c - 0.15) * 3));
  }
}

/** Small bubbles trapped in thick glass, deterministic per seed (only where the glass is). */
function bubbles(ctx: Ctx, seed: number, n: number, b: Box, inside: (x: number, y: number) => boolean): void {
  ctx.save();
  for (let k = 0; k < n; k++) {
    const x = b.x0 + hash01(seed, k * 2 + 1) * (b.x1 - b.x0);
    const y = b.y0 + hash01(seed, k * 2 + 2) * (b.y1 - b.y0);
    if (!inside(x, y)) continue;
    const r = 0.5 + hash01(seed, k + 70) * 0.9;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Teacup: pale blue glass on a glass saucer, gilded rim, etched flowers.

function saucer(ctx: Ctx, tint: string): void {
  litFrame(ctx, () => {
    const cy = -8;
    const rx = 45;
    const ry = rx * K;
    const th = 1.6;
    const ob: Box = { x0: -rx, y0: cy - ry, x1: rx, y1: cy + ry + th };
    const top = (): void => {
      ctx.beginPath();
      ctx.ellipse(0, cy, rx, ry, 0, 0, TAU);
    };
    // the plate's edge, thicker glass, along the near side
    ctx.fillStyle = rgba(mix(tint, shadowOf(tint, 0.3), 0.5), 0.45);
    ctx.beginPath();
    ctx.moveTo(-rx, cy);
    ctx.ellipse(0, cy + th, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(rx, cy);
    ctx.ellipse(0, cy, rx, ry, 0, 0, Math.PI, false);
    ctx.closePath();
    ctx.fill();
    glassShape(ctx, top, ob, tint, 0.24);
    // the well, a gilded edge, the cup's caustic and a crisp lip highlight
    ctx.strokeStyle = rgba(lightOf(tint, 0.8), 0.55);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.ellipse(0, cy + 0.3, rx * 0.6, ry * 0.6, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = rgba(GOLD, 0.9);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.ellipse(0, cy, rx - 2.6, ry - 0.45, 0, 0, TAU);
    ctx.stroke();
    caustic(ctx, 6, cy + 1, 16, 2.6, 0.45, '#FFF6DE');
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(0, cy, rx - 0.5, ry - 0.15, 0, Math.PI * 0.58, Math.PI * 0.92);
    ctx.stroke();
    ctx.strokeStyle = rgba(lightOf(tint, 0.6), 0.8);
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.ellipse(0, cy + th, rx, ry, 0, 0.05, Math.PI - 0.05);
    ctx.stroke();
  });
}

/** Etched (frosted) five-petal flower, squashed by `s` as the glass turns away. */
function etchedFlower(ctx: Ctx, x: number, y: number, s: number, a: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, 1);
  ctx.globalAlpha *= a;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let k = 0; k < 5; k++) {
    const t = (k / 5) * TAU - Math.PI / 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(t) * 1.8, Math.sin(t) * 1.8, 1.45, 1.1, t, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = rgba(GOLD, 0.9);
  ctx.beginPath();
  ctx.arc(0, 0, 0.8, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(-6, 2.6);
  ctx.quadraticCurveTo(-3, 4, 0, 2.8);
  ctx.quadraticCurveTo(3, 4, 6, 2.6);
  ctx.stroke();
  ctx.restore();
}

const teacup: Glass = {
  skip: [0, 5],
  thick: [1, 2],
  rim: [0, -56, 35, 4.5],
  gold: true,
  back: (ctx, l) => saucer(ctx, l.base),
  front: (ctx, l, g) => glassHandle(ctx, g, bezierPts(35, -50.5, 48, -55, 54, -32, 29.5, -25, 20), 6.2, l.base),
  frontOver: (ctx, _l, g) => {
    aroundGlass(g, -40, 9, 0.2, (x, y, s, f) => etchedFlower(ctx, x, y, s, f));
  },
  foot: [0, 45, 3],
  ext: [-50, -70, 58, 3],
};

// ---------------------------------------------------------------------------
// Mug: clear glass with a heavy base and a thick D handle, an etched paw.

const mug: Glass = {
  skip: [3],
  thick: [0],
  rim: [0, -64, 27, 4],
  front: (ctx, l, g) => glassHandle(ctx, g, bezierPts(28, -57, 47, -59.5, 50, -23, 28, -20, 20), 7.4, l.base),
  frontOver: (ctx, l) => {
    // an etched paw print, and a few bubbles in the thick base
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.translate(0, -36);
    ctx.beginPath();
    ctx.moveTo(-4.2, 2.6);
    ctx.bezierCurveTo(-5.2, -1.2, -2, -2.6, 0, -2.6);
    ctx.bezierCurveTo(2, -2.6, 5.2, -1.2, 4.2, 2.6);
    ctx.bezierCurveTo(3.4, 4.6, 1.2, 3.6, 0, 3.6);
    ctx.bezierCurveTo(-1.2, 3.6, -3.4, 4.6, -4.2, 2.6);
    for (const [tx, ty, r] of [
      [-5, -4.4, 1.45],
      [-1.8, -6.5, 1.6],
      [1.8, -6.5, 1.6],
      [5, -4.4, 1.45],
    ]) {
      ctx.moveTo(tx + r, ty);
      ctx.ellipse(tx, ty, r, r * 1.22, 0, 0, TAU);
    }
    ctx.fill();
    ctx.restore();
    bubbles(ctx, l.seed, 10, { x0: -24, y0: -8, x1: 24, y1: -2 }, () => true);
  },
  foot: [0, 30.5, 2.5],
  ext: [-36, -76, 56, 3],
};

// ---------------------------------------------------------------------------
// Boot: an amber "das Boot" glass boot, its toe stuffed with a knitted sock.

function sock(ctx: Ctx): void {
  const path = (): void => roundRect(ctx, 16.5, -28.5, 27, 23, [6, 9, 5, 4]);
  ctx.save();
  path();
  ctx.clip();
  const stripes = ['#F3E8D8', '#D9726A', '#F3E8D8', '#7FA0C8'];
  for (let k = 0; k < 8; k++) {
    ctx.fillStyle = stripes[k % stripes.length];
    ctx.fillRect(14, -30 + k * 3.4, 32, 3.4);
  }
  // knit: rows of little vees
  ctx.strokeStyle = 'rgba(80,60,70,0.25)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let y = -28; y < -4; y += 1.7)
    for (let x = 17; x < 44; x += 2) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + 1, y + 1.2);
      ctx.lineTo(x + 2, y);
    }
  ctx.stroke();
  ctx.restore();
}

/** The boot's foot: a smooth instep and toe over the physics' toe box, on its exact inner face. */
function bootFoot(c: Cavity): ShapePart {
  const face = rightFace(c, -31);
  const pts: [number, number][] = [
    [17, -33],
    [21, -36],
    ...bezierPts(21, -36, 26, -33.5, 33, -31.6, 39, -30.8, 12).slice(1),
    ...bezierPts(39, -30.8, 44, -30, 46.6, -25, 46.6, -17, 12).slice(1),
    [46.6, -5.5],
    [face[face.length - 1][0], -5.5],
  ];
  for (let i = face.length - 1; i >= 0; i--) pts.push([face[i][0], face[i][1]]);
  return shapePart(pts);
}

const boot: Glass = {
  skip: [3],
  thick: [0, 3],
  extra: (c) => [bootFoot(c)],
  rim: [0, -68, 19, 4],
  // the sock sits inside the glass toe, under the glass body
  front: (ctx) => sock(ctx),
  frontOver: (ctx, l) => {
    // trapped bubbles in the heavy sole
    bubbles(ctx, l.seed, 14, { x0: -20, y0: -6, x1: 44, y1: -1.5 }, () => true);
  },
  foot: [11, 34.5, 2],
  ext: [-30, -78, 52, 3],
};

// ---------------------------------------------------------------------------
// Box: a clear glass box whose side panes swing open on little brass hinges.

const box: Glass = {
  thick: [0],
  rim: [0, -64, 46, 3.5],
  depth: 11,
  back: (ctx, l) => {
    // the open side panes, running back from their front edges (behind the cats)
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(s * 46, -64);
      ctx.lineTo(s * 41, -75);
      ctx.lineTo(s * 58, -94);
      ctx.lineTo(s * 64, -84);
      ctx.closePath();
      ctx.fillStyle = rgba(l.base, 0.16);
      ctx.fill();
      ctx.strokeStyle = rgba(lightOf(l.base, 0.8), 0.6);
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.restore();
    }
  },
  frontOver: (ctx) => {
    for (const s of [-1, 1]) {
      for (const [x, y] of [
        [s * 46.2, -65.4],
        [s * 43.4, -70.8],
      ]) {
        ctx.fillStyle = BRASS;
        roundRect(ctx, x - 1.6, y - 1.3, 3.2, 2.6, 0.8);
        ctx.fill();
        rivet(ctx, x, y, 0.7, lightOf(BRASS, 0.3));
      }
    }
    // brass feet at the corners
    for (const s of [-1, 1]) {
      ctx.fillStyle = BRASS;
      roundRect(ctx, s * 47 - 3, -3, 6, 3, 1);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,200,0.6)';
      ctx.fillRect(s * 47 - 2, -2.6, 2.5, 0.7);
    }
  },
  foot: [0, 50, 2],
  ext: [-70, -98, 70, 3],
};

// ---------------------------------------------------------------------------
// Shoebox: a low glass box, its glass lid propped up behind.

const shoebox: Glass = {
  thick: [0],
  rim: [0, -40, 40, 3.5],
  depth: 9,
  back: (ctx, l) => {
    ctx.save();
    ctx.translate(-1, -48.6);
    ctx.rotate(-0.045);
    const lid = (): void => roundRect(ctx, -44.5, -12, 89, 15, 2.5);
    glassShape(ctx, lid, { x0: -44.5, y0: -12, x1: 44.5, y1: 3 }, l.base, 0.24);
    ctx.fillStyle = rgba(mix(l.base, shadowOf(l.base, 0.3), 0.5), 0.35);
    roundRect(ctx, -44.5, -12, 89, 3.2, [2.5, 2.5, 0, 0]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-40, -8);
    ctx.lineTo(-20, -8);
    ctx.stroke();
    ctx.restore();
  },
  foot: [0, 43.5, 2],
  ext: [-50, -64, 52, 3],
};

// ---------------------------------------------------------------------------
// Fruit bowl: pale green cut glass on a heavy foot.

const fruitbowl: Glass = {
  thick: [0],
  rim: [0, -44, 57, 5],
  frontOver: (ctx, _l, g) => {
    // diamond cuts round the bowl: two sets of diagonals that turn with the glass
    const { cx, hw } = cavityAt(g.cav, -30);
    const R = hw + 6;
    const y0 = -37;
    const y1 = -23;
    const n = 26;
    ctx.save();
    ctx.lineWidth = 0.6;
    for (const dir of [1, -1]) {
      for (let i = 0; i < n; i++) {
        const t0 = ((i + 0.5) / n) * TAU - Math.PI;
        const t1 = t0 + dir * (TAU / n) * 1.6;
        const c0 = Math.cos(t0);
        const c1 = Math.cos(t1);
        if (c0 < 0.2 || c1 < 0.2) continue;
        const ax = cx + R * Math.sin(t0);
        const ay = y0 + R * K * c0;
        const bx = cx + R * 0.92 * Math.sin(t1);
        const by = y1 + R * 0.92 * K * c1;
        ctx.strokeStyle = `rgba(255,255,255,${0.45 * Math.min(c0, c1)})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.strokeStyle = rgba(shadowOf(g.solid.length ? _l.base : _l.base, 0.5), 0.18 * Math.min(c0, c1));
        ctx.beginPath();
        ctx.moveTo(ax + 0.6, ay + 0.4);
        ctx.lineTo(bx + 0.6, by + 0.4);
        ctx.stroke();
      }
    }
    ctx.restore();
    // a scalloped, cut rim: little bright notches along the near lip
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 0.7;
    const r = g.rim;
    for (let k = 1; k < 14; k++) {
      const t = (k / 14) * Math.PI;
      const x = r.cx + (r.rxm + r.r) * Math.cos(t);
      const y = r.y + (r.rxm + r.r) * K * Math.sin(t);
      ctx.beginPath();
      ctx.arc(x, y + 0.6, 1.4, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
    ctx.restore();
  },
  foot: [0, 22, 3],
  ext: [-66, -58, 66, 3],
};

// ---------------------------------------------------------------------------
// Mixing bowl: clear Pyrex-style glass, faintly blue, with measuring marks.

const mixingbowl: Glass = {
  thick: [0],
  rim: [0, -50, 48, 5],
  frontOver: (ctx, _l, g) => {
    const L = lsign(ctx);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 0.7;
    for (let k = 0; k < 4; k++) {
      const y = -44 + k * 6.5;
      const { cx, hw } = cavityAt(g.cav, y);
      const x = cx + L * hw * 0.55;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + L * (k % 2 ? 3 : 5), y + 0.3);
      ctx.stroke();
    }
    ctx.restore();
  },
  foot: [0, 20, 3],
  ext: [-56, -64, 56, 3],
};

// ---------------------------------------------------------------------------
// Sink: a clear glass vessel basin on a frosted glass pedestal, chrome tap.

const SINK_PARTS = CONTAINERS.sink.parts as Part[];

function sinkTap(ctx: Ctx, x: number, y: number, cap: string): void {
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
    { line: CHROME_LINE, spec: 0.9 },
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
    { line: CHROME_LINE, spec: 0.9 },
  );
  ctx.fillStyle = cap;
  ctx.beginPath();
  ctx.ellipse(x, y - 6.5, 1.7, 1.2, 0, 0, TAU);
  ctx.fill();
  glint(ctx, x - 0.5, y - 7, 0.5, 0.9);
  ctx.restore();
}

const sink: Glass = {
  thick: [0, 1],
  rim: [0, -138, 70, 6],
  backOver: (ctx) => {
    litFrame(ctx, () => {
      const yb = -138 - 70 * K - 1;
      const spout = (): void => {
        ctx.beginPath();
        ctx.moveTo(0, yb);
        ctx.lineTo(0, yb - 19);
        ctx.bezierCurveTo(0, yb - 32, 22, yb - 33, 24.5, yb - 18);
        ctx.lineTo(24.5, yb - 14.5);
      };
      ctx.fillStyle = shadowOf(CHROME, 0.3);
      ctx.beginPath();
      ctx.ellipse(0, yb, 7.4, 2.2, 0, 0, TAU);
      ctx.fill();
      tube(ctx, spout, 4.6, CHROME, { line: CHROME_LINE, spec: 0.95, shade: 0.5 });
      ctx.fillStyle = shadowOf(CHROME, 0.6);
      ctx.beginPath();
      ctx.ellipse(24.5, yb - 13.9, 2.3, 0.8, 0, 0, TAU);
      ctx.fill();
      sinkTap(ctx, -21, yb + 0.2, '#E39C95');
      sinkTap(ctx, 21, yb + 0.2, '#86AAD4');
    });
  },
  front: () => undefined,
  frontOver: (ctx) => {
    // the pedestal and foot are frosted
    const ped = (): void => {
      ctx.beginPath();
      partPath(ctx, SINK_PARTS[1]);
      partPath(ctx, SINK_PARTS[0]);
    };
    ped();
    ctx.fillStyle = 'rgba(250,252,253,0.28)';
    ctx.fill();
    texPaint(ctx, ped, 'plaster', { alpha: 0.35, scale: 0.25, light: '#FFFFFF', dark: '#9FB3C2' });
  },
  foot: [0, 24, 3],
  ext: [-80, -186, 80, 3],
};

// ---------------------------------------------------------------------------
// Pot: a glass planter with a rolled lip and a jute twine tied round it.

const pot: Glass = {
  thick: [0],
  rim: [0, -58, 31, 5.5],
  frontOver: (ctx, l, g) => {
    const L = lsign(ctx);
    const y = -47;
    const { cx, hw } = cavityAt(g.cav, y);
    const R = hw + 5.6;
    ctx.save();
    ctx.lineCap = 'round';
    for (const [dy, w] of [
      [0, 1.3],
      [2.2, 1.1],
    ] as const) {
      ctx.strokeStyle = '#B98F58';
      ctx.lineWidth = w + 0.5;
      ctx.beginPath();
      ctx.ellipse(cx, y + dy, R, R * K, 0, 0, Math.PI);
      ctx.stroke();
      ctx.strokeStyle = '#DDBB83';
      ctx.lineWidth = w * 0.55;
      ctx.beginPath();
      ctx.ellipse(cx, y + dy - 0.3, R, R * K, 0, 0.05, Math.PI - 0.05);
      ctx.stroke();
    }
    // a little knot with two ends on the lit side
    const kx = cx - L * R * 0.62;
    const ky = y + R * K * 0.78 + 1;
    ctx.fillStyle = '#C9A066';
    ctx.beginPath();
    ctx.ellipse(kx, ky, 1.6, 1.3, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#B98F58';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(kx, ky + 0.8);
    ctx.quadraticCurveTo(kx - L * 1.5, ky + 4, kx - L * 0.6, ky + 7.5);
    ctx.moveTo(kx, ky + 0.8);
    ctx.quadraticCurveTo(kx + L * 1.8, ky + 3.6, kx + L * 2.2, ky + 6.8);
    ctx.stroke();
    ctx.restore();
    void l;
  },
  foot: [0, 27.5, 2.5],
  ext: [-40, -70, 40, 3],
};

// ---------------------------------------------------------------------------
// Basket: a big clear glass tub with two loop handles.

const basket: Glass = {
  thick: [0],
  rim: [0, -72, 56, 5],
  front: (ctx, l, g) => {
    for (const s of [-1, 1]) glassHandle(ctx, g, bezierPts(s * 59, -63, s * 70, -64, s * 71, -45, s * 58, -44, 14), 4.4, l.base);
  },
  foot: [0, 53, 2],
  ext: [-74, -86, 74, 3],
};

// ---------------------------------------------------------------------------
// Saucepan: amber glass cookware with a dark clamp-on handle.

function panHandle(ctx: Ctx): void {
  const IRON = '#4E4656';
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(44, -42.5);
    ctx.bezierCurveTo(62, -45, 80, -48, 93, -50.6);
    ctx.bezierCurveTo(100, -51.8, 103.4, -47.8, 101.6, -44.4);
    ctx.bezierCurveTo(100.4, -42.2, 97.5, -41.6, 94.5, -41.8);
    ctx.bezierCurveTo(80, -40.4, 62, -37.2, 44, -34.5);
    ctx.closePath();
    ctx.moveTo(96.6, -46.4);
    ctx.ellipse(94.6, -46.4, 2, 1.5, -0.16, 0, TAU);
  };
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
  ctx.strokeStyle = shadowOf(IRON, 0.5);
  ctx.lineWidth = 1;
  path();
  ctx.stroke();
}

const saucepan: Glass = {
  skip: [3],
  thick: [0],
  rim: [0, -44, 43, 4.5],
  front: (ctx) => panHandle(ctx),
  frontOver: (ctx) => {
    // the handle's steel clamp round the wall
    const plate = (): void => roundRect(ctx, 40.5, -46.5, 9, 14, 2.4);
    plate();
    ctx.fillStyle = CHROME;
    ctx.fill();
    ctx.strokeStyle = CHROME_LINE;
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(41.8, -45.6, 1.4, 12);
    rivet(ctx, 45, -42.5, 1.3, CHROME);
    rivet(ctx, 45, -36.5, 1.3, CHROME);
  },
  foot: [0, 46, 2.5],
  ext: [-52, -58, 106, 3],
};

// ---------------------------------------------------------------------------
// Vase: sea-green seeded glass.

const VASE_PARTS = CONTAINERS.vase.parts as Part[];

const vase: Glass = {
  thick: [0],
  rim: [0, -96, 19, 5],
  frontOver: (ctx, l) => {
    bubbles(ctx, l.seed, 70, { x0: -37, y0: -100, x1: 37, y1: -1 }, (x, y) => {
      let d = Infinity;
      for (const p of VASE_PARTS) {
        if (p.k !== 'cap') continue;
        const dx = p.bx - p.ax;
        const dy = p.by - p.ay;
        const t = Math.max(0, Math.min(1, ((x - p.ax) * dx + (y - p.ay) * dy) / (dx * dx + dy * dy)));
        d = Math.min(d, Math.hypot(x - p.ax - dx * t, y - p.ay - dy * t) - p.r);
      }
      return d < -1.2;
    });
  },
  foot: [0, 31, 3],
  ext: [-40, -106, 40, 3],
};

// ---------------------------------------------------------------------------
// Bucket: a clear glass ice bucket with a chrome bail and a chrome band.

const BAIL = '#9AA6B3';

const bucket: Glass = {
  thick: [0],
  rim: [0, -60, 34, 3.5],
  back: (ctx) => {
    litFrame(ctx, () => {
      tube(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(-37.2, -51);
          ctx.bezierCurveTo(-38, -91, 38, -91, 37.2, -51);
        },
        2.2,
        BAIL,
        { spec: 0.8 },
      );
      tube(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(-7.5, -80.5);
          ctx.quadraticCurveTo(0, -81.5, 7.5, -80.5);
        },
        5.4,
        '#3F3A48',
        { spec: 0.35 },
      );
    });
  },
  frontOver: (ctx, _l, g) => {
    // a chrome band just under the rim, and the ears the bail hooks into
    const y = -53.5;
    const { cx, hw } = cavityAt(g.cav, y);
    const R = hw + 3.8;
    const b: Box = { x0: cx - R, y0: y - 3, x1: cx + R, y1: y + R * K + 3 };
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = CHROME_LINE;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.ellipse(cx, y, R, R * K, 0, 0, Math.PI);
    ctx.stroke();
    ctx.strokeStyle = lightGradient(ctx, b, [[0, '#F4F7FA'], [0.4, CHROME], [1, shadowOf(CHROME, 0.35)]], lightDir(ctx));
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();
    for (const s of [-1, 1]) {
      const x = s * 36.6;
      const ear = (): void => roundRect(ctx, x - 3, -55.5, 6, 9, 2.6);
      ear();
      ctx.fillStyle = CHROME;
      ctx.fill();
      ctx.strokeStyle = CHROME_LINE;
      ctx.lineWidth = 0.9;
      ctx.stroke();
      rivet(ctx, x, -48.8, 1.2, lightOf(CHROME, 0.2));
      ctx.strokeStyle = BAIL;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, -52.4, 1.6, 0, TAU);
      ctx.stroke();
    }
  },
  foot: [0, 30, 2.5],
  ext: [-42, -90, 42, 3],
};

// ---------------------------------------------------------------------------
// Slipper: a glass slipper with a little glass bow and sparkles.

/** The slipper's vamp: round over the toe parts, from the throat's exact inner face. */
function slipperVamp(c: Cavity): ShapePart {
  const face = rightFace(c, c.y0);
  const [fx, fy] = face[0];
  // round the end of the toe capsule at the throat, then over the toe
  const a0 = Math.atan2(fy + 25, fx - 2);
  let a1 = -Math.PI / 2;
  while (a1 < a0) a1 += TAU;
  const pts: [number, number][] = [[fx, fy]];
  const na = Math.max(2, Math.ceil((a1 - a0) / 0.1));
  for (let i = 0; i <= na; i++) {
    const a = a0 + ((a1 - a0) * i) / na;
    pts.push([2 + 5 * Math.cos(a), -25 + 5 * Math.sin(a)]);
  }
  pts.push(...bezierPts(2, -30, 8, -30.5, 15, -29.6, 22, -28.2, 10).slice(1));
  pts.push(...bezierPts(22, -28.2, 31, -26.6, 40.5, -21.5, 42.8, -14, 14).slice(1));
  pts.push(...bezierPts(42.8, -14, 43.6, -10.5, 43.4, -7.5, 42.4, -4.5, 8).slice(1));
  pts.push([face[face.length - 1][0], -4.5]);
  for (let i = face.length - 1; i >= 1; i--) pts.push([face[i][0], face[i][1]]);
  return shapePart(pts);
}

const slipper: Glass = {
  skip: [2, 3],
  thick: [0, 2, 3],
  extra: (c) => [slipperVamp(c)],
  rim: [-16.5, -24.5, 18.5, 4.5],
  frontOver: (ctx, l) => {
    // a glass bow on the vamp
    const bx = 21;
    const by = -32;
    const wing = (s: number): void => {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.bezierCurveTo(bx + s * 3, by - 5, bx + s * 8, by - 3.6, bx + s * 7.4, by + 0.4);
      ctx.bezierCurveTo(bx + s * 7, by + 3.6, bx + s * 3, by + 2.4, bx, by);
      ctx.closePath();
    };
    for (const s of [-1, 1]) glassShape(ctx, () => wing(s), { x0: bx - 8, y0: by - 5, x1: bx + 8, y1: by + 4 }, l.base, 0.38);
    glassShape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(bx, by, 1.8, 2, 0, 0, TAU);
      },
      { x0: bx - 2, y0: by - 2, x1: bx + 2, y1: by + 2 },
      l.base,
      0.5,
    );
    const L = lsign(ctx);
    sparkle(ctx, bx - L * 9, by - 2, 2.4, 0.9);
    sparkle(ctx, 36 * (L > 0 ? 1 : 1), -16, 1.6, 0.75);
    sparkle(ctx, -35, -15, 1.4, 0.7);
  },
  foot: [1, 40, 2],
  ext: [-44, -42, 46, 3],
};

// ---------------------------------------------------------------------------

const GLASS: Record<ContainerType, Glass> = { teacup, mug, boot, box, shoebox, fruitbowl, sink, pot, basket, saucepan, vase, bucket, slipper, mixingbowl };

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
  const type = p.type as ContainerType;
  const def = GLASS[type];
  if (!def) return;
  const look = lookOf(p);
  const geo = geoOf(type);
  const paint = which === 'back' ? glassBack : glassFront;
  const m = ctx.getTransform();
  const upright = Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6;
  const q = resBucket(Math.abs(m.a) * p.scale);
  const id = `${which}|${type}|${look.v}|${p.flip ? 1 : 0}|${p.scale}|${look.seed}|${q}`;
  let sp = sprites.get(id);
  if (!sp && upright) {
    const now = performance.now();
    const seen = sightings.get(id);
    if (sightings.size > 256) sightings.clear();
    sightings.set(id, now);
    if (seen !== undefined && now - seen < 1500) {
      const [ex0, ey0, ex1, ey1] = def.ext;
      const x0 = p.flip ? -ex1 : ex0;
      const c = document.createElement('canvas');
      c.width = Math.ceil((ex1 - ex0) * q);
      c.height = Math.ceil((ey1 - ey0) * q);
      const g = c.getContext('2d')!;
      g.setTransform(q, 0, 0, q, -x0 * q, -ey0 * q);
      if (p.flip) g.scale(-1, 1);
      paint(g, look, geo);
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
    paint(ctx, look, geo);
  }
  ctx.restore();
}

/** Local extent of a container's painted art (x0, y0, x1, y1), wider than its physics bounds. */
export function containerArtExtent(type: ContainerType): [number, number, number, number] {
  return GLASS[type].ext;
}

export function drawContainerBack(ctx: Ctx, p: Prop): void {
  paintArt(ctx, p, 'back');
}

export function drawContainerFront(ctx: Ctx, p: Prop): void {
  paintArt(ctx, p, 'front');
}

/** Contact shadow under a glass container: a light shade and the light it focuses (world space). */
export function containerShadow(ctx: Ctx, p: Prop): void {
  const def = GLASS[p.type as ContainerType];
  if (!def) return;
  const [cx, hw, ry] = def.foot;
  const s = p.scale;
  const x = p.x + (p.flip ? -cx : cx) * s;
  restShadow(ctx, x, p.y - ry * s * 0.5, hw * s, (ry + 1) * s, 0.2);
  caustic(ctx, x + hw * s * 0.42, p.y + 0.6 * s, hw * s * 0.5, 2.6 * s, 0.3, mix('#FFF3D6', lookOf(p).base, 0.35));
}
