// Room definitions: furniture + containers + decor + cats, all from the shared
// prop library (the house is one: see house/homeRoom.ts).

import type { BreedId } from '../physics/breeds';
import { BREEDS } from '../physics/breeds';
import { SoftBody } from '../physics/softbody';
import { World } from '../physics/world';
import type { StaticShape } from '../physics/shapes';
import { nearestRoom, roomFor, type Ring } from './spawn';
import {
  buildContainer,
  buildFurniture,
  resetPropUids,
  roomShell,
  type ContainerPlacement,
  type FurniturePlacement,
  type Prop,
} from './props';

export type ThemeId = 'kitchen' | 'bathroom' | 'living' | 'laundry' | 'study' | 'sunroom' | 'pantry' | 'bedroom' | 'studio';

export type DecorType =
  | 'window'
  | 'plant'
  | 'picture'
  | 'clock'
  | 'pendant'
  | 'rug'
  | 'backsplash'
  | 'books'
  | 'jars'
  | 'towel'
  | 'mirror'
  | 'garland'
  | 'radiator'
  | 'teapot'
  | 'fruit'
  | 'yarn';

export interface DecorPlacement {
  type: DecorType;
  x: number;
  y: number;
  w?: number;
  h?: number;
  variant?: number;
  /** A window's view: from up high, or at the level of the ground outside (the basement's). */
  outlook?: 'high' | 'ground';
}

export interface CatPlacement {
  breed: BreedId;
  /** Centre x. */
  x: number;
  /** Top of the surface the cat starts on. */
  y: number;
  name: string;
}

export interface RoomDef {
  id: string;
  name: string;
  theme: ThemeId;
  furniture: FurniturePlacement[];
  containers: ContainerPlacement[];
  cats: CatPlacement[];
  decor: DecorPlacement[];
  /** Lighting: sunny afternoon (default) or lamp-lit night. */
  mood?: 'day' | 'night';
}

export interface BuiltRoom {
  world: World;
  props: Prop[];
  containers: Prop[];
  furniture: Prop[];
  bodies: SoftBody[];
}

/**
 * May a cat be put at (x, y) (the middle of its ring, radius r) instead of
 * where it was (`from`: a point in it, or just above what it sat on)?
 */
export type SpawnOk = (x: number, y: number, r: number, from: { x: number; y: number }) => boolean;

/** Where containers' uids start (furniture's count up from 1). */
const CONTAINER_UIDS = 1000;

/**
 * Build physics for a room (inside `shell`, the room's walls, floor and
 * ceiling). Cats are dropped onto their surfaces and settled. With `spawnOk`,
 * a cat whose place isn't clear (something's there now, or another cat) is
 * put in the nearest place that is, and that `spawnOk` allows.
 */
export function buildRoom(def: RoomDef, settleFrames = 75, shell: () => StaticShape[] = roomShell, spawnOk?: SpawnOk, unmerge = false): BuiltRoom {
  resetPropUids();
  const world = new World();
  world.unmerge = unmerge;
  for (const s of shell()) world.addStatic(s);
  // (every prop's uid its own: its colliders carry it. A container's is the
  // same whatever else the room has, and its glass is painted from it.)
  const furniture = def.furniture.map((f) => buildFurniture(f));
  const containers = def.containers.map((c, k) => buildContainer(c, CONTAINER_UIDS + k));
  const props = [...furniture, ...containers];
  for (const p of props) for (const s of p.shapes) world.addStatic(s);
  // (with spawnOk, the lowest first: a cat that was on top of another makes room, not the one under it)
  const at: Ring[] = def.cats.map((c) => {
    const r = BREEDS[c.breed].physics.radius;
    return { x: c.x, y: c.y - r * 0.92 - 3, r };
  });
  if (spawnOk) {
    const placed: Ring[] = [];
    for (const k of def.cats.map((_, k) => k).sort((a, b) => def.cats[b].y - def.cats[a].y)) {
      const c = def.cats[k];
      const a = at[k];
      if (!roomFor(world.statics, placed, a.x, a.y, a.r)) {
        const p = nearestRoom(world.statics, placed, a.x, a.y, a.r, (px, py) => spawnOk(px, py, a.r, { x: c.x, y: c.y - 1 }));
        if (p) {
          a.x = p.x;
          a.y = p.y;
        }
      }
      placed.push(a);
    }
  }
  const bodies = def.cats.map((c, k) => world.addBody(new SoftBody(c.breed, at[k].x, at[k].y)));
  for (let i = 0; i < settleFrames; i++) {
    for (const b of bodies) b.loafiness = Math.min(1, i / 40);
    world.step();
  }
  world.drainImpacts();
  world.frame = 0;
  return { world, props, containers, furniture, bodies };
}
