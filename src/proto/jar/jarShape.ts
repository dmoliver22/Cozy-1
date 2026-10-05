// The jar's glass as parts (rounded boxes and capsules), shared by the physics
// and the painting so a squished cat presses right against the inner face of
// the glass: straight walls, round inner bottom corners (a chain of capsules),
// a bottom pane and a thick foot. Invisible walls continue the jar's sides up
// past the rim, so a booped cat can't hop out over it.

import { capsule, roundedBox, type StaticShape } from '../../physics/shapes';
import type { Part } from '../../render/propKit';
import { JAR } from './config';

const cap = (ax: number, ay: number, bx: number, by: number, r: number): Part => ({ k: 'cap', ax, ay, bx, by, r });
const box = (x0: number, y0: number, x1: number, y1: number, r: number): Part => ({ k: 'box', x0, y0, x1, y1, r });

/** Centres of the wall capsules. */
export const WALL_L = JAR.inL - JAR.wall;
export const WALL_R = JAR.inR + JAR.wall;

/** Capsules along a round inner corner, from angle a0 to a1 (y down). */
function corner(cx: number, cy: number, a0: number, a1: number, segs: number): Part[] {
  const R = JAR.corner + JAR.wall;
  const out: Part[] = [];
  for (let k = 0; k < segs; k++) {
    const t0 = a0 + ((a1 - a0) * k) / segs;
    const t1 = a0 + ((a1 - a0) * (k + 1)) / segs;
    out.push(cap(cx + R * Math.cos(t0), cy + R * Math.sin(t0), cx + R * Math.cos(t1), cy + R * Math.sin(t1), JAR.wall));
  }
  return out;
}

const { inL, inR, wall, rimY, floorY, corner: rc, footY } = JAR;

/** Glass the cats touch: walls, corners and the bottom pane. */
export const GLASS_PARTS: Part[] = [
  cap(WALL_L, rimY, WALL_L, floorY - rc, wall),
  cap(WALL_R, rimY, WALL_R, floorY - rc, wall),
  ...corner(inL + rc, floorY - rc, Math.PI, Math.PI / 2, 4),
  ...corner(inR - rc, floorY - rc, 0, Math.PI / 2, 4),
  cap(inL + rc, floorY + wall, inR - rc, floorY + wall, wall),
];

/** The thick foot under the bottom pane (denser, greener glass). */
export const FOOT_PART: Part = box(inL + rc * 0.45, floorY + wall * 0.6, inR - rc * 0.45, footY, 7);

export const ALL_PARTS: Part[] = [...GLASS_PARTS, FOOT_PART];

/**
 * Friction of the glass: the floor holds the bottom of the pile still, but
 * the straight walls are slippery, or two big cats squeezed side by side can
 * wedge between them and hang there like a bridge over the cats below.
 */
const FLOOR_FRICTION = 0.35;
export const WALL_FRICTION = 0.05;

function toShape(p: Part): StaticShape {
  const upright = p.k === 'cap' && p.ax === p.bx;
  const o = { material: 'glass' as const, friction: upright ? WALL_FRICTION : FLOOR_FRICTION, container: true };
  return p.k === 'cap' ? capsule(p.ax, p.ay, p.bx, p.by, p.r, o) : roundedBox(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0, p.r, o);
}

export interface JarStatics {
  shapes: StaticShape[];
  /** Ids of shapes nobody sees (the walls above the rim, the counter): no clinks. */
  silent: Set<number>;
}

/** Colliders for a fresh world. */
export function buildStatics(): JarStatics {
  const shapes = ALL_PARTS.map(toShape);
  const silent = new Set<number>();
  const quiet = (s: StaticShape): void => {
    shapes.push(s);
    silent.add(s.id);
  };
  // the jar's sides carry on (invisibly) above the rim
  quiet(capsule(WALL_L, rimY, WALL_L, rimY - 900, wall, { material: 'glass', friction: WALL_FRICTION }));
  quiet(capsule(WALL_R, rimY, WALL_R, rimY - 900, wall, { material: 'glass', friction: WALL_FRICTION }));
  // a counter top and room walls, just in case
  quiet(roundedBox(-400, footY, 1180, 300, 4, { material: 'wood' }));
  quiet(roundedBox(-600, rimY - 1000, 400, 2400, 4, { material: 'wall' }));
  quiet(roundedBox(580, rimY - 1000, 400, 2400, 4, { material: 'wall' }));
  return { shapes, silent };
}
