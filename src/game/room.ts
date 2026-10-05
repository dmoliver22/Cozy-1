// Room definitions: furniture + containers + decor + cats, all from the shared
// prop library. Hand-made rooms and generated daily rooms use the same format.

import type { BreedId } from '../physics/breeds';
import { BREEDS } from '../physics/breeds';
import { SoftBody } from '../physics/softbody';
import { World } from '../physics/world';
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

/** One scripted nudge, used by the solver and by hints. */
export interface PlanStep {
  cat: number;
  container: number;
  /** Grab point offset from the cat centroid at grab time. */
  gx: number;
  gy: number;
  /** Drag target (world). */
  tx: number;
  ty: number;
  /** Frames to drag before letting go. */
  hold: number;
  /** Optional waypoint (world): slide off an edge first, then go to the target. */
  wx?: number;
  wy?: number;
  /** 'drag' or 'boop' (tap). */
  kind: 'drag' | 'boop';
  /** Frames per leg of the drag, and how near the opening's middle to let go (share of its width). */
  move?: number;
  tol?: number;
}

export interface RoomDef {
  id: string;
  name: string;
  theme: ThemeId;
  furniture: FurniturePlacement[];
  containers: ContainerPlacement[];
  cats: CatPlacement[];
  decor: DecorPlacement[];
  /** Nudges the solver needed (fewer is fine, more is fine too). */
  par?: number;
  plan?: PlanStep[];
  /** First-run guided room. */
  tutorial?: boolean;
  /** Lighting: sunny afternoon (default) or lamp-lit night. */
  mood?: 'day' | 'night';
  /** Daily rooms: which generator variant passed the solver. */
  variant?: number;
  subtitle?: string;
}

export interface BuiltRoom {
  world: World;
  props: Prop[];
  containers: Prop[];
  furniture: Prop[];
  bodies: SoftBody[];
}

/** Build physics for a room. Cats are dropped onto their surfaces and settled. */
export function buildRoom(def: RoomDef, settleFrames = 75): BuiltRoom {
  resetPropUids();
  const world = new World();
  for (const s of roomShell()) world.addStatic(s);
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
