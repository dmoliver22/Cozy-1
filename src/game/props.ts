// The shared prop library: every container and piece of furniture a room can be
// built from. Geometry only (no drawing) so the daily solver can run headless.

import { capsule, makeConvex, roundedBox, type Material, type StaticShape } from '../physics/shapes';
import { pointInPolyPts, polygonAreaPts, segmentT, type Vec2 } from '../util/math';

export type ContainerType =
  | 'teacup'
  | 'mug'
  | 'boot'
  | 'box'
  | 'shoebox'
  | 'fruitbowl'
  | 'sink'
  | 'pot'
  | 'basket'
  | 'saucepan'
  | 'vase'
  | 'bucket'
  | 'slipper'
  | 'mixingbowl';

export type FurnitureType = 'shelf' | 'counter' | 'table' | 'stool' | 'fridge' | 'cabinet' | 'sill' | 'ramp' | 'bookcase' | 'crate';

export const WORLD_W = 360;
export const FLOOR_Y = 560;

type Part =
  | { k: 'box'; x0: number; y0: number; x1: number; y1: number; r: number }
  | { k: 'cap'; ax: number; ay: number; bx: number; by: number; r: number };

interface ContainerSpec {
  name: string;
  material: Material;
  parts: Part[];
  /** Cavity polygon (local, origin = bottom centre, up is -y). */
  interior: Vec2[];
  /** Rim opening x-range and rim top y (local). */
  opening: [number, number, number];
  /** Visual extent (local) for layout. */
  bounds: [number, number, number, number]; // x0, y0(top), x1, y1(bottom=0)
  /** Typical palette index for art. */
  friction?: number;
}

const box = (x0: number, y0: number, x1: number, y1: number, r: number): Part => ({ k: 'box', x0, y0, x1, y1, r });
const cap = (ax: number, ay: number, bx: number, by: number, r: number): Part => ({ k: 'cap', ax, ay, bx, by, r });
const P = (x: number, y: number): Vec2 => ({ x, y });

export const CONTAINERS: Record<ContainerType, ContainerSpec> = {
  teacup: {
    name: 'teacup',
    material: 'ceramic',
    parts: [
      box(-44, -5, 44, 0, 2.5),
      box(-19, -10, 19, -4, 2),
      box(-25, -16, 25, -8, 4),
      cap(-35, -56, -24, -13, 4.5),
      cap(35, -56, 24, -13, 4.5),
      cap(38, -46, 45, -28, 4.5),
    ],
    interior: [P(-30, -56), P(30, -56), P(20, -17), P(-20, -17)],
    opening: [-30, 30, -60],
    bounds: [-46, -61, 50, 0],
  },
  mug: {
    name: 'mug',
    material: 'ceramic',
    parts: [box(-28, -9, 28, 0, 4), cap(-27, -64, -27, -6, 4), cap(27, -64, 27, -6, 4), cap(33, -54, 41, -24, 5)],
    interior: [P(-23, -64), P(23, -64), P(23, -9), P(-23, -9)],
    opening: [-23, 23, -68],
    bounds: [-32, -69, 47, 0],
  },
  boot: {
    name: 'rain boot',
    material: 'rubber',
    parts: [
      box(-23, -7, 45, 0, 3.5),
      cap(-19, -68, -19, -5, 4),
      cap(19, -68, 19, -30, 4),
      // the toe is stuffed with a sock: solid, so the cavity is just the shaft
      box(15, -30, 45, -4, 6),
    ],
    interior: [P(-15, -68), P(15, -68), P(15, -7), P(-15, -7)],
    opening: [-15, 15, -72],
    bounds: [-24, -73, 46, 0],
  },
  box: {
    name: 'cardboard box',
    material: 'cardboard',
    parts: [
      box(-48, -6, 48, 0, 3),
      cap(-46, -64, -46, -4, 3.5),
      cap(46, -64, 46, -4, 3.5),
      cap(-47, -66, -64, -84, 2.5),
      cap(47, -66, 64, -84, 2.5),
    ],
    interior: [P(-42.5, -64), P(42.5, -64), P(42.5, -6), P(-42.5, -6)],
    opening: [-42, 42, -68],
    bounds: [-67, -87, 67, 0],
  },
  shoebox: {
    name: 'shoebox',
    material: 'cardboard',
    parts: [box(-42, -6, 42, 0, 3), cap(-40, -40, -40, -4, 3.5), cap(40, -40, 40, -4, 3.5)],
    interior: [P(-36.5, -40), P(36.5, -40), P(36.5, -6), P(-36.5, -6)],
    opening: [-36, 36, -44],
    bounds: [-44, -45, 44, 0],
  },
  fruitbowl: {
    name: 'fruit bowl',
    material: 'ceramic',
    parts: [
      box(-20, -7, 20, 0, 3),
      cap(-26, -11, 26, -11, 5),
      cap(-26, -11, -45, -22, 5),
      cap(-45, -22, -57, -44, 5),
      cap(26, -11, 45, -22, 5),
      cap(45, -22, 57, -44, 5),
    ],
    interior: [P(-52, -44), P(52, -44), P(41, -25), P(24, -16), P(-24, -16), P(-41, -25)],
    opening: [-52, 52, -49],
    bounds: [-62, -49, 62, 0],
  },
  sink: {
    name: 'sink',
    material: 'ceramic',
    parts: [
      box(-24, -8, 24, 0, 3),
      box(-15, -86, 15, -6, 4),
      cap(-30, -90, 30, -90, 6),
      cap(-30, -90, -56, -104, 6),
      cap(-56, -104, -70, -138, 6),
      cap(30, -90, 56, -104, 6),
      cap(56, -104, 70, -138, 6),
    ],
    interior: [P(-64, -138), P(64, -138), P(50, -108), P(28, -97), P(-28, -97), P(-50, -108)],
    opening: [-64, 64, -144],
    bounds: [-76, -146, 76, 0],
  },
  pot: {
    name: 'flower pot',
    material: 'terracotta',
    parts: [box(-22, -8, 22, 0, 3), cap(-31, -58, -22, -5, 5.5), cap(31, -58, 22, -5, 5.5)],
    interior: [P(-25.5, -58), P(25.5, -58), P(16.5, -8), P(-16.5, -8)],
    opening: [-25, 25, -63],
    bounds: [-37, -64, 37, 0],
  },
  basket: {
    name: 'laundry basket',
    material: 'wicker',
    parts: [box(-50, -7, 50, 0, 3), cap(-56, -72, -49, -5, 5), cap(56, -72, 49, -5, 5)],
    interior: [P(-51, -72), P(51, -72), P(44, -7), P(-44, -7)],
    opening: [-51, 51, -77],
    bounds: [-61, -78, 61, 0],
  },
  saucepan: {
    name: 'saucepan',
    material: 'metal',
    parts: [box(-44, -7, 44, 0, 3.5), cap(-43, -44, -43, -5, 4.5), cap(43, -44, 43, -5, 4.5), cap(49, -38, 98, -46, 4)],
    interior: [P(-38.5, -44), P(38.5, -44), P(38.5, -7), P(-38.5, -7)],
    opening: [-38, 38, -49],
    bounds: [-48, -51, 102, 0],
  },
  vase: {
    name: 'vase',
    material: 'ceramic',
    parts: [
      box(-26, -8, 26, 0, 4),
      cap(-31, -56, -28, -8, 5),
      cap(-31, -56, -17, -80, 5),
      cap(-17, -80, -19, -96, 5),
      cap(31, -56, 28, -8, 5),
      cap(31, -56, 17, -80, 5),
      cap(17, -80, 19, -96, 5),
    ],
    interior: [P(-14, -96), P(14, -96), P(12, -80), P(26, -56), P(23, -9), P(-23, -9), P(-26, -56), P(-12, -80)],
    opening: [-14, 14, -101],
    bounds: [-36, -101, 36, 0],
  },
  bucket: {
    name: 'bucket',
    material: 'metal',
    parts: [box(-26, -6, 26, 0, 3), cap(-34, -60, -27, -4, 3.5), cap(34, -60, 27, -4, 3.5)],
    interior: [P(-30.5, -60), P(30.5, -60), P(23.5, -6), P(-23.5, -6)],
    opening: [-30, 30, -64],
    bounds: [-38, -64, 38, 0],
  },
  slipper: {
    name: 'slipper',
    material: 'fabric',
    parts: [box(-38, -6, 40, 0, 3), cap(-35, -24, -35, -5, 4), cap(2, -25, 34, -17, 5), box(2, -22, 40, -4, 5)],
    interior: [P(-31, -24), P(-2, -24), P(-2, -6), P(-31, -6)],
    opening: [-31, -2, -28],
    bounds: [-39, -30, 43, 0],
  },
  mixingbowl: {
    name: 'mixing bowl',
    material: 'ceramic',
    parts: [
      box(-18, -6, 18, 0, 3),
      cap(-24, -10, 24, -10, 5),
      cap(-24, -10, -42, -24, 5),
      cap(-42, -24, -48, -50, 5),
      cap(24, -10, 42, -24, 5),
      cap(42, -24, 48, -50, 5),
    ],
    interior: [P(-43, -50), P(43, -50), P(37, -26), P(22, -15), P(-22, -15), P(-37, -26)],
    opening: [-43, 43, -55],
    bounds: [-53, -55, 53, 0],
  },
};

export const CONTAINER_TYPES = Object.keys(CONTAINERS) as ContainerType[];

export interface Surface {
  x0: number;
  x1: number;
  y: number;
  /** Prop that owns the surface (-1 = floor). */
  propId: number;
}

export interface ContainerPlacement {
  type: ContainerType;
  /** Bottom centre on a surface. */
  x: number;
  y: number;
  flip?: boolean;
  scale?: number;
  /** Colour variant index for the art. */
  tint?: number;
}

export interface FurniturePlacement {
  type: FurnitureType;
  x0: number;
  x1: number;
  /** Top surface y. For ramps: y at x0. */
  y: number;
  /** Ramps only: y at x1. */
  y1?: number;
  variant?: number;
}

export interface Prop {
  uid: number;
  kind: 'container' | 'furniture';
  type: ContainerType | FurnitureType;
  name: string;
  material: Material;
  x: number;
  y: number;
  flip: boolean;
  scale: number;
  tint: number;
  variant: number;
  /** World-space bounding box of the art. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  shapes: StaticShape[];
  /** Container cavity (world space). */
  interior: Vec2[] | null;
  /** Interior sample points (x,y pairs) for measuring how full it is. */
  samples: Float64Array | null;
  cellArea: number;
  capacity: number;
  opening: { x0: number; x1: number; y: number } | null;
  surfaces: Surface[];
  /** Ramp end points / furniture extras for art. */
  ramp?: { ax: number; ay: number; bx: number; by: number };
}

let nextPropUid = 1;
export function resetPropUids(): void {
  nextPropUid = 1;
}

const SAMPLE_STEP = 4;
const SAMPLE_MARGIN = 3;

function distToPoly(px: number, py: number, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const t = segmentT(px, py, a.x, a.y, b.x, b.y);
    const dx = a.x + (b.x - a.x) * t - px;
    const dy = a.y + (b.y - a.y) * t - py;
    best = Math.min(best, Math.sqrt(dx * dx + dy * dy));
  }
  return best;
}

function toWorld(p: Vec2, x: number, y: number, s: number, flip: boolean): Vec2 {
  return { x: x + (flip ? -p.x : p.x) * s, y: y + p.y * s };
}

export function buildContainer(c: ContainerPlacement): Prop {
  const spec = CONTAINERS[c.type];
  const s = c.scale ?? 1;
  const flip = !!c.flip;
  const uid = nextPropUid++;
  const shapes: StaticShape[] = [];
  const opts = { material: spec.material, propId: uid, container: true, friction: spec.friction ?? 0.5 };
  for (const part of spec.parts) {
    if (part.k === 'box') {
      const a = toWorld(P(part.x0, part.y0), c.x, c.y, s, flip);
      const b = toWorld(P(part.x1, part.y1), c.x, c.y, s, flip);
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y);
      const y1 = Math.max(a.y, b.y);
      shapes.push(roundedBox(x0, y0, x1 - x0, y1 - y0, part.r * s, opts));
    } else {
      const a = toWorld(P(part.ax, part.ay), c.x, c.y, s, flip);
      const b = toWorld(P(part.bx, part.by), c.x, c.y, s, flip);
      shapes.push(capsule(a.x, a.y, b.x, b.y, part.r * s, opts));
    }
  }
  const interior = spec.interior.map((p) => toWorld(p, c.x, c.y, s, flip));
  const [ox0, ox1, oy] = spec.opening;
  const oa = toWorld(P(ox0, oy), c.x, c.y, s, flip);
  const ob = toWorld(P(ox1, oy), c.x, c.y, s, flip);
  const [bx0, by0, bx1] = spec.bounds;
  const ba = toWorld(P(bx0, by0), c.x, c.y, s, flip);
  const bb = toWorld(P(bx1, 0), c.x, c.y, s, flip);
  const { samples, cellArea } = sampleInterior(interior);
  return {
    uid,
    kind: 'container',
    type: c.type,
    name: spec.name,
    material: spec.material,
    x: c.x,
    y: c.y,
    flip,
    scale: s,
    tint: c.tint ?? 0,
    variant: 0,
    x0: Math.min(ba.x, bb.x),
    x1: Math.max(ba.x, bb.x),
    y0: ba.y,
    y1: c.y,
    shapes,
    interior,
    samples,
    cellArea,
    capacity: Math.abs(polygonAreaPts(interior)),
    opening: { x0: Math.min(oa.x, ob.x), x1: Math.max(oa.x, ob.x), y: oa.y },
    surfaces: [],
  };
}

function sampleInterior(poly: Vec2[]): { samples: Float64Array; cellArea: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const pts: number[] = [];
  for (let y = minY + SAMPLE_STEP / 2; y < maxY; y += SAMPLE_STEP) {
    for (let x = minX + SAMPLE_STEP / 2; x < maxX; x += SAMPLE_STEP) {
      // Skip the thin band along the walls that a cat's skin can never reach.
      if (pointInPolyPts(x, y, poly) && distToPoly(x, y, poly) > SAMPLE_MARGIN) pts.push(x, y);
    }
  }
  return { samples: Float64Array.from(pts), cellArea: SAMPLE_STEP * SAMPLE_STEP };
}

export function buildFurniture(f: FurniturePlacement): Prop {
  const uid = nextPropUid++;
  const shapes: StaticShape[] = [];
  const surfaces: Surface[] = [];
  const { x0, x1, y } = f;
  const material: Material = f.type === 'fridge' ? 'metal' : 'wood';
  const o = { material, propId: uid, friction: 0.6 };
  let top = y;
  let bottom = FLOOR_Y;
  let ax0 = x0;
  let ax1 = x1;
  let ramp: Prop['ramp'];
  switch (f.type) {
    case 'shelf':
    case 'sill':
      shapes.push(roundedBox(x0, y, x1 - x0, f.type === 'sill' ? 10 : 12, 4, o));
      surfaces.push({ x0, x1, y, propId: uid });
      bottom = y + 26;
      break;
    case 'counter':
      shapes.push(roundedBox(x0 - 6, y, x1 - x0 + 12, 14, 4, o));
      shapes.push(roundedBox(x0, y + 12, x1 - x0, FLOOR_Y - y - 12, 3, o));
      surfaces.push({ x0: x0 - 6, x1: x1 + 6, y, propId: uid });
      ax0 = x0 - 6;
      ax1 = x1 + 6;
      break;
    case 'table':
      shapes.push(roundedBox(x0, y, x1 - x0, 12, 5, o));
      shapes.push(capsule(x0 + 14, y + 10, x0 + 12, FLOOR_Y - 3, 4, o));
      shapes.push(capsule(x1 - 14, y + 10, x1 - 12, FLOOR_Y - 3, 4, o));
      surfaces.push({ x0, x1, y, propId: uid });
      break;
    case 'stool': {
      shapes.push(roundedBox(x0, y, x1 - x0, 12, 6, o));
      shapes.push(capsule(x0 + 8, y + 10, x0 + 4, FLOOR_Y - 3, 3.5, o));
      shapes.push(capsule(x1 - 8, y + 10, x1 - 4, FLOOR_Y - 3, 3.5, o));
      surfaces.push({ x0, x1, y, propId: uid });
      break;
    }
    case 'fridge':
    case 'cabinet':
    case 'bookcase':
      shapes.push(roundedBox(x0, y, x1 - x0, FLOOR_Y - y + 4, f.type === 'fridge' ? 10 : 4, o));
      surfaces.push({ x0, x1, y, propId: uid });
      break;
    case 'crate':
      shapes.push(roundedBox(x0, y, x1 - x0, FLOOR_Y - y + 2, 4, o));
      surfaces.push({ x0, x1, y, propId: uid });
      break;
    case 'ramp': {
      const y1 = f.y1 ?? y;
      shapes.push(capsule(x0, y, x1, y1, 6, { ...o, friction: 0.15 }));
      top = Math.min(y, y1) - 6;
      bottom = Math.max(y, y1) + 6;
      ramp = { ax: x0, ay: y, bx: x1, by: y1 };
      break;
    }
  }
  return {
    uid,
    kind: 'furniture',
    type: f.type,
    name: f.type,
    material,
    x: (x0 + x1) / 2,
    y,
    flip: false,
    scale: 1,
    tint: 0,
    variant: f.variant ?? 0,
    x0: ax0,
    y0: top,
    x1: ax1,
    y1: bottom,
    shapes,
    interior: null,
    samples: null,
    cellArea: 0,
    capacity: 0,
    opening: null,
    surfaces,
    ramp,
  };
}

/** The room shell: floor, walls and a high ceiling. */
export function roomShell(): StaticShape[] {
  const o = { material: 'wall' as Material, friction: 0.6 };
  return [
    roundedBox(-200, FLOOR_Y, WORLD_W + 400, 200, 4, o),
    roundedBox(-200, -600, 200, FLOOR_Y + 800, 4, o),
    roundedBox(WORLD_W, -600, 200, FLOOR_Y + 800, 4, o),
    roundedBox(-200, -800, WORLD_W + 400, 200, 4, o),
  ];
}

/** Helper for tests and tools: a convex hull-less polygon collider. */
export function polygonCollider(pts: Vec2[], material: Material = 'wood'): StaticShape {
  return makeConvex(pts, { material });
}

/** Visual top of a container (rim top) in world space. */
export function rimTop(p: Prop): number {
  return p.opening ? p.opening.y : p.y0;
}
