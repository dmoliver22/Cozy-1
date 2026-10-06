// Room definitions: furniture + containers + decor + cats, all from the shared
// prop library (the house is one: see house/homeRoom.ts).

import type { BreedId } from '../physics/breeds';
import { BREEDS } from '../physics/breeds';
import { SoftBody } from '../physics/softbody';
import { World } from '../physics/world';
import type { StaticShape } from '../physics/shapes';
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
 * Build physics for a room (inside `shell`, the room's walls, floor and
 * ceiling). Cats are dropped onto their surfaces and settled.
 */
export function buildRoom(def: RoomDef, settleFrames = 75, shell: () => StaticShape[] = roomShell): BuiltRoom {
  resetPropUids();
  const world = new World();
  for (const s of shell()) world.addStatic(s);
  const furniture = def.furniture.map(buildFurniture);
  const containers = def.containers.map(buildContainer);
  const props = [...furniture, ...containers];
  for (const p of props) for (const s of p.shapes) world.addStatic(s);
  const bodies = def.cats.map((c) => {
    const r = BREEDS[c.breed].physics.radius;
    const b = new SoftBody(c.breed, c.x, c.y - r * 0.92 - 3);
    world.addBody(b);
    return b;
  });
  for (let i = 0; i < settleFrames; i++) {
    for (const b of bodies) b.loafiness = Math.min(1, i / 40);
    world.step();
  }
  world.drainImpacts();
  world.frame = 0;
  return { world, props, containers, furniture, bodies };
}
