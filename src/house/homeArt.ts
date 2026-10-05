// The home room's own art, painted into the renderer's cached back layer:
// the ceiling with the attic hatch over the cat steps (Cat Drop: a cat starts
// up in the attic and drops down through the house) and, on the shelf, a
// little jar of cats (Cat Jar), made like the big one: the same glass, twine
// and paw-print tag, with a pile of real soft-body cats asleep inside.

import { WORLD_W } from '../game/props';
import type { BreedId } from '../physics/breeds';
import { capsule, roundedBox } from '../physics/shapes';
import { SoftBody } from '../physics/softbody';
import { World } from '../physics/world';
import { TINT as JAR_TINT, twineAndTag } from '../proto/jar/art';
import { CatView, drawCat } from '../render/catArt';
import { plank } from '../render/furnitureArt';
import { glint, hash01, lightOf, mix, rgba, roundRect, shadowOf, softShadow, type Ctx } from '../render/paint';
import {
  K,
  caustic,
  cavityAt,
  cavityPath,
  glassSolid,
  glassStreak,
  glassWall,
  restShadow,
  rimLip,
  scanCavity,
  sparkle,
  type Cavity,
  type Part,
  type Rim,
} from '../render/propKit';
import type { Theme } from '../render/roomArt';
import { castShadow, inkLine, paintTex } from '../render/roomKit';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// The ceiling and the attic hatch

/** Where the back wall meets the ceiling (world y). */
export const CEIL_Y = 0;
/** The ceiling's underside, seen from below: how far up the screen its front edge is. */
const BAND = 20;
/** The cut edge of the ceiling (the dollhouse is open at the front). */
const SLAB = 11;
/** The attic hatch: its back edge, over the top cat step. */
export const HATCH = { x0: 300, x1: 352 };
/** The hatch's door hangs down the wall from its back edge. */
const DOOR_H = 30;
/** Vanishing point the ceiling recedes to (the floor uses the same idea). */
const VPX = WORLD_W / 2;

/** Where a point on the back edge of the ceiling is at its front edge. */
const frontX = (x: number): number => x + (x - VPX) * 0.09;

const ATTIC = '#4A3F55';
const ATTIC_LIT = '#E9B477';
const CUT = '#E9DCCB';
const CUT_LINE = '#B9A58E';

/** The ceiling across the top of the room, with the attic hatch open in it. */
export function paintCeiling(ctx: Ctx, r: { x0: number; y0: number; x1: number; y1: number }, theme: Theme, seed: number): void {
  const x0 = Math.max(r.x0, -10);
  const x1 = Math.min(r.x1, WORLD_W + 10);
  const front = CEIL_Y - BAND;
  const top = front - SLAB;
  ctx.save();
  // the attic above, glimpsed past the cut edge: dim boards, warm by the hatch
  if (r.y0 < top) {
    ctx.fillStyle = ATTIC;
    ctx.fillRect(x0, r.y0, x1 - x0, top - r.y0);
    ctx.fillStyle = rgba(shadowOf(ATTIC, 0.4), 0.5);
    for (let x = Math.floor(x0 / 26) * 26; x < x1; x += 26) ctx.fillRect(x, r.y0, 1, top - r.y0);
    const hx = (HATCH.x0 + HATCH.x1) / 2;
    const g = ctx.createRadialGradient(hx, top, 0, hx, top, 90);
    g.addColorStop(0, rgba(ATTIC_LIT, 0.45));
    g.addColorStop(1, rgba(ATTIC_LIT, 0));
    ctx.fillStyle = g;
    ctx.fillRect(hx - 90, r.y0, 180, top - r.y0);
  }
  // the cut edge, like the dollhouse's side walls
  ctx.fillStyle = CUT;
  ctx.fillRect(x0, top, x1 - x0, SLAB);
  ctx.fillStyle = CUT_LINE;
  ctx.fillRect(x0, top, x1 - x0, 2);
  ctx.fillStyle = rgba(shadowOf(CUT, 0.4), 0.5);
  ctx.fillRect(x0, front - 1.2, x1 - x0, 1.2);
  // the ceiling's underside: plaster, lit from the window side, darker in the corner
  const ceil = mix(theme.trim, theme.wall, 0.35);
  const band = (): void => {
    ctx.beginPath();
    ctx.moveTo(frontX(x0 - 40), front);
    ctx.lineTo(frontX(x1 + 40), front);
    ctx.lineTo(x1 + 40, CEIL_Y);
    ctx.lineTo(x0 - 40, CEIL_Y);
    ctx.closePath();
  };
  ctx.fillStyle = ceil;
  band();
  ctx.fill();
  const lg = ctx.createLinearGradient(0, front, 0, CEIL_Y);
  lg.addColorStop(0, rgba(lightOf(ceil, 0.5), 0.5));
  lg.addColorStop(1, rgba(shadowOf(ceil, 0.35), 0.45));
  ctx.fillStyle = lg;
  band();
  ctx.fill();
  paintTex(ctx, band, 'plaster', 0.12, 0.5, 0.5, seed % 97, 0);
  // the hatch: the attic seen through the hole, its timber sides, warm lamplight
  hatchHole(ctx, front);
  // crown moulding where the wall meets the ceiling (the hatch cuts through it)
  moulding(ctx, x0, x1, theme.trim, seed);
  hatchDoor(ctx, seed);
  ctx.restore();
}

function hatchHole(ctx: Ctx, front: number): void {
  const { x0, x1 } = HATCH;
  const hole = (): void => {
    ctx.beginPath();
    ctx.moveTo(x0, CEIL_Y + 0.5);
    ctx.lineTo(x1, CEIL_Y + 0.5);
    ctx.lineTo(frontX(x1), front + 0.5);
    ctx.lineTo(frontX(x0), front + 0.5);
    ctx.closePath();
  };
  ctx.save();
  hole();
  ctx.clip();
  const cx = (x0 + x1) / 2;
  const g = ctx.createRadialGradient(cx - 4, front - 6, 2, cx, front, 46);
  g.addColorStop(0, '#FFE2B0');
  g.addColorStop(0.35, ATTIC_LIT);
  g.addColorStop(1, ATTIC);
  ctx.fillStyle = g;
  ctx.fillRect(x0 - 10, front - 4, x1 - x0 + 30, BAND + 8);
  // a rafter crossing the hole, up in the attic
  ctx.fillStyle = rgba(shadowOf(ATTIC, 0.3), 0.75);
  ctx.beginPath();
  ctx.moveTo(x0 - 4, front + 9);
  ctx.lineTo(x1 + 8, front + 3);
  ctx.lineTo(x1 + 8, front + 7);
  ctx.lineTo(x0 - 4, front + 13);
  ctx.closePath();
  ctx.fill();
  // the hole's sides: the lit one facing the window, the other in shade
  ctx.fillStyle = rgba('#D9B48A', 0.95);
  ctx.beginPath();
  ctx.moveTo(x1, CEIL_Y + 0.5);
  ctx.lineTo(frontX(x1), front + 0.5);
  ctx.lineTo(frontX(x1) - 3.2, front + 0.5);
  ctx.lineTo(x1 - 3.2, CEIL_Y + 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba('#8E6E58', 0.9);
  ctx.beginPath();
  ctx.moveTo(x0, CEIL_Y + 0.5);
  ctx.lineTo(frontX(x0), front + 0.5);
  ctx.lineTo(frontX(x0) + 2.4, front + 0.5);
  ctx.lineTo(x0 + 2.4, CEIL_Y + 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = rgba('#6E5646', 0.7);
  ctx.lineWidth = 0.9;
  hole();
  ctx.stroke();
}

function moulding(ctx: Ctx, x0: number, x1: number, trim: string, seed: number): void {
  const y = CEIL_Y;
  const h = 7;
  const runs: [number, number][] = [
    [x0, HATCH.x0],
    [HATCH.x1, x1],
  ];
  castShadow(ctx, () => {
    ctx.beginPath();
    for (const [a, b] of runs) ctx.rect(a, y, b - a, h);
  }, 1.5, 3.5, 3.5, 0.24);
  for (const [a, b] of runs) {
    const path = (): void => roundRect(ctx, a, y - 1, b - a, h + 1, [0, 0, 2.5, 2.5]);
    ctx.fillStyle = trim;
    path();
    ctx.fill();
    paintTex(ctx, path, 'wood', 0.12, 0.45, 0.2, a + hash01(seed, 3) * 80, y);
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

/** The hatch's door, swung down against the wall, with a ring pull and a cord. */
function hatchDoor(ctx: Ctx, seed: number): void {
  const x = HATCH.x0 + 3;
  const w = HATCH.x1 - HATCH.x0 - 6;
  const y = CEIL_Y + 1;
  const wood = '#C99A6E';
  castShadow(ctx, () => {
    ctx.beginPath();
    ctx.rect(x, y, w, DOOR_H);
  }, 2.5, 4, 4, 0.3);
  // warm light from the attic spills onto the door and the wall below it
  const spill = ctx.createRadialGradient(x + w / 2, y, 4, x + w / 2, y + 30, 70);
  spill.addColorStop(0, rgba('#FFD9A0', 0.32));
  spill.addColorStop(1, rgba('#FFD9A0', 0));
  ctx.fillStyle = spill;
  ctx.fillRect(x - 60, y, w + 120, 100);
  plank(ctx, x, y, w, DOOR_H, wood, seed + 5, 2.5, 0, 0.5);
  // tongue-and-groove boards, and the hinges along the top
  ctx.fillStyle = rgba(shadowOf(wood, 0.6), 0.45);
  for (let k = 1; k < 4; k++) ctx.fillRect(x + (w * k) / 4 - 0.4, y + 2, 0.9, DOOR_H - 4);
  ctx.fillStyle = rgba(lightOf(wood, 0.6), 0.4);
  for (let k = 1; k < 4; k++) ctx.fillRect(x + (w * k) / 4 + 0.6, y + 2, 0.7, DOOR_H - 4);
  for (const hx of [x + 7, x + w - 13]) {
    roundRect(ctx, hx, y + 1.5, 6, 3.4, 1);
    ctx.fillStyle = '#7C6E6A';
    ctx.fill();
  }
  // the ring pull and a cord with a wooden bead, to reach up and pull it down
  const rx = x + w / 2;
  const ry = y + DOOR_H - 5;
  ctx.strokeStyle = '#B8935A';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(rx, ry + 2.6, 2.8, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = '#EED7A4';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(rx, ry + 2.6, 2.8, Math.PI * 1.1, Math.PI * 1.6);
  ctx.stroke();
  ctx.strokeStyle = '#8C7B6C';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(rx, ry + 5.4);
  ctx.quadraticCurveTo(rx + 1.5, ry + 16, rx + 0.6, ry + 26);
  ctx.stroke();
  const by = ry + 29;
  softShadow(ctx, rx + 2, by + 2, 3, 2, 0.18);
  ctx.fillStyle = '#B07C52';
  ctx.beginPath();
  ctx.ellipse(rx + 0.6, by, 2.7, 3.3, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba('#F3D2A4', 0.8);
  ctx.beginPath();
  ctx.ellipse(rx - 0.4, by - 1.2, 0.9, 1.2, -0.4, 0, TAU);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// The little jar of cats

/** The little jar in its own units (like the big jar's): foot at y = 0, centred on x = 0. */
const MJ = { inL: -76, inR: 76, wall: 5, rimY: -166, floorY: -16, corner: 26, footY: 0 };
const WALL_L = MJ.inL - MJ.wall;
const WALL_R = MJ.inR + MJ.wall;
const cap = (ax: number, ay: number, bx: number, by: number, r: number): Part => ({ k: 'cap', ax, ay, bx, by, r });

function cornerParts(cx: number, cy: number, a0: number, a1: number, segs: number): Part[] {
  const R = MJ.corner + MJ.wall;
  const out: Part[] = [];
  for (let k = 0; k < segs; k++) {
    const t0 = a0 + ((a1 - a0) * k) / segs;
    const t1 = a0 + ((a1 - a0) * (k + 1)) / segs;
    out.push(cap(cx + R * Math.cos(t0), cy + R * Math.sin(t0), cx + R * Math.cos(t1), cy + R * Math.sin(t1), MJ.wall));
  }
  return out;
}

const GLASS: Part[] = [
  cap(WALL_L, MJ.rimY, WALL_L, MJ.floorY - MJ.corner, MJ.wall),
  cap(WALL_R, MJ.rimY, WALL_R, MJ.floorY - MJ.corner, MJ.wall),
  ...cornerParts(MJ.inL + MJ.corner, MJ.floorY - MJ.corner, Math.PI, Math.PI / 2, 4),
  ...cornerParts(MJ.inR - MJ.corner, MJ.floorY - MJ.corner, 0, Math.PI / 2, 4),
  cap(MJ.inL + MJ.corner, MJ.floorY + MJ.wall, MJ.inR - MJ.corner, MJ.floorY + MJ.wall, MJ.wall),
];
const FOOT: Part = { k: 'box', x0: MJ.inL + MJ.corner * 0.45, y0: MJ.floorY + MJ.wall * 0.6, x1: MJ.inR - MJ.corner * 0.45, y1: MJ.footY, r: 6 };
const PARTS: Part[] = [...GLASS, FOOT];
const RIM: Rim = { cx: 0, y: MJ.rimY, rxm: (WALL_R - WALL_L) / 2, r: MJ.wall + 0.6 };
let cav: Cavity | null = null;
const cavity = (): Cavity => (cav ??= scanCavity(PARTS, 0, MJ.rimY, MJ.floorY - MJ.rimY + 20));

/** Half the jar's width and its height, in its own units (for layout). */
export const MINI_JAR = { halfW: WALL_R + MJ.wall, h: -MJ.rimY + 8 };

interface JarCat {
  body: SoftBody;
  view: CatView;
  happy: boolean;
}

let pile: JarCat[] | null = null;

/** A heap of cats settled in the jar, simulated once (the Cat Jar's chain, small to big). */
function jarCats(): JarCat[] {
  if (pile) return pile;
  const world = new World();
  const o = { material: 'glass' as const, friction: 0.3, container: true };
  for (const p of PARTS) {
    if (p.k === 'cap') world.addStatic(capsule(p.ax, p.ay, p.bx, p.by, p.r, o));
    else world.addStatic(roundedBox(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0, p.r, o));
  }
  // walls on up past the rim while they settle
  world.addStatic(capsule(WALL_L, MJ.rimY - 400, WALL_L, MJ.rimY, MJ.wall, o));
  world.addStatic(capsule(WALL_R, MJ.rimY - 400, WALL_R, MJ.rimY, MJ.wall, o));
  const drops: [BreedId, number, number, boolean][] = [
    ['persian', -34, -60, false],
    ['tabby', 40, -130, false],
    ['sphynx', -22, -210, false],
    ['kitten', 44, -280, true],
    ['kitten', -44, -340, false],
  ];
  const out: JarCat[] = [];
  for (const [breed, x, y, happy] of drops) {
    const body = world.addBody(new SoftBody(breed, x, y));
    const view = new CatView(body.n, out.length * 3 + 1);
    view.blinkAt = 1e9;
    out.push({ body, view, happy });
  }
  for (let i = 0; i < 420; i++) {
    for (const c of out) c.body.loafiness = Math.min(1, Math.max(0, (i - 120) / 120));
    world.step();
  }
  for (const c of out) c.body.computeCentroid();
  pile = out;
  return out;
}

/**
 * The little jar of cats standing on a surface at (x, y), drawn `s` times
 * its own size. `cssPerUnit` is the screen's scale (for the cats' detail).
 */
export function paintJarOfCats(ctx: Ctx, x: number, y: number, s: number, cssPerUnit: number): void {
  const c = cavity();
  const hw = (FOOT.k === 'box' ? FOOT.x1 - FOOT.x0 : 120) / 2;
  restShadow(ctx, x + 3 * s, y - 0.5, (hw + 8) * s, 3, 0.24);
  softShadow(ctx, x + 14 * s, y + 0.5, hw * 0.9 * s, 2, 0.1);
  caustic(ctx, x + hw * 0.45 * s, y + 0.8, hw * 0.55 * s, 2.2, 0.32, mix('#FFF3D6', JAR_TINT, 0.3));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // back: the far wall, the light on the floor, the far half of the rim
  const ri = RIM.rxm - RIM.r;
  ctx.save();
  ctx.globalAlpha = 0.72;
  glassWall(
    ctx,
    'homejar',
    c,
    JAR_TINT,
    true,
    () => {
      ctx.beginPath();
      cavityPath(ctx, c);
      ctx.ellipse(RIM.cx, RIM.y, ri, ri * K, 0, 0, TAU);
    },
    RIM.y - ri * K,
  );
  ctx.restore();
  const fl = cavityAt(c, c.floorY - 0.6);
  caustic(ctx, fl.cx + fl.hw * 0.32, c.floorY, fl.hw * 0.42, Math.max(1, fl.hw * K) * 0.5, 0.45, mix('#FFF4DA', JAR_TINT, 0.25));
  rimLip(ctx, RIM, JAR_TINT, 'far');
  // the cats, asleep in a heap (the kitten on top is awake and pleased)
  for (const jc of jarCats()) {
    drawCat(ctx, jc.body, jc.view, {
      expression: jc.happy ? 'happy' : 'sleepy',
      look: 0,
      rim: null,
      seated: false,
      resting: true,
      purr: 0,
      grabbed: false,
      glow: 0,
    }, cssPerUnit * s);
  }
  // front: the near wall's veil, the glass edge-on, the near rim, streaks, the tag
  ctx.save();
  const ro = RIM.rxm + RIM.r;
  ctx.beginPath();
  ctx.moveTo(RIM.cx - ro, RIM.y);
  ctx.ellipse(RIM.cx, RIM.y, ro, ro * K, 0, Math.PI, 0, true);
  ctx.lineTo(RIM.cx + ro, MJ.footY + 20);
  ctx.lineTo(RIM.cx - ro, MJ.footY + 20);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = 0.85;
  glassWall(ctx, 'homejar', c, JAR_TINT, false, () => {
    ctx.beginPath();
    cavityPath(ctx, c);
  });
  ctx.restore();
  glassSolid(ctx, PARTS, [FOOT], JAR_TINT, { body: 0.32, thick: 0.4 });
  rimLip(ctx, RIM, JAR_TINT, 'near');
  const top = c.y0 + 8;
  const len = c.floorY - c.y0;
  glassStreak(ctx, c, 0.8, top + 4, top + len * 0.78, 4, 0.6);
  glassStreak(ctx, c, 0.62, top + len * 0.1, top + len * 0.45, 2, 0.4);
  glassStreak(ctx, c, -0.84, top + len * 0.3, top + len * 0.86, 2.2, 0.2);
  const tp = cavityAt(c, top + 4);
  glint(ctx, tp.cx - tp.hw * 0.8, top + 4, 2.2, 0.9);
  sparkle(ctx, tp.cx - tp.hw * 0.78, c.floorY - 30, 5, 0.7);
  twineAndTag(ctx, RIM, c, MJ.wall);
  ctx.restore();
}
