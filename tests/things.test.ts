import { describe, expect, it } from 'vitest';
import { FLOOR_Y, WORLD_W } from '../src/game/props';
import { Session } from '../src/game/session';
import { THING, THINGS, fittingBoxes, houseRoom, settleMoved, snapThing, spotOf, thingPos, thingProblem, thingProp, type ThingId } from '../src/house/homeRoom';
import { ALL_CATS } from '../src/house/house';
import { BASEMENT_DY, FLOORS, floorAt, houseShell, type ExtraFloor, type FloorId } from '../src/house/layout';
import { perchBox } from '../src/house/perches';

// The house's own things (its furniture, the vase and the glass tub): a long
// press picks one up, and it goes wherever there's room for it.

const ALL_OPEN: FloorId[] = ['roof', 'attic', 'living', 'basement'];
const everywhere = { open: ['roof', 'attic', 'basement'] as ExtraFloor[] };

/** What's in the way of a thing: the tubes and the chimney, and the house's other things where they are. */
function takenBut(id: ThingId, moved: Record<string, { x: number; y: number }> = {}) {
  const out = fittingBoxes(everywhere, 'all');
  for (const t of THINGS) {
    if (t.id === id) continue;
    const p = thingPos(t, moved);
    out.push(thingProp(t, p.x, p.y, -1));
  }
  return out;
}

const settle = (s: Session, frames = 240): void => {
  for (let f = 0; f < frames; f++) s.step();
};

describe("the house's things", () => {
  it('each can be put back just where it always was', () => {
    for (const t of THINGS) {
      if (t.stays) continue;
      const p = thingPos(t);
      expect(snapThing(t, p.x, p.y), t.id).toEqual(p);
      expect(thingProblem(t, p.x, p.y, ALL_OPEN, takenBut(t.id)), t.id).toBeNull();
    }
  });

  it('the sill and the cat steps stay where they are, and say why', () => {
    for (const id of ['sill', 'topStep', 'loftStep'] as ThingId[]) expect(THING[id].stays).toBeTruthy();
    // (moving them in a save does nothing)
    expect(thingPos(THING.sill, { sill: { x: 200, y: 300 } })).toEqual(thingPos(THING.sill));
  });

  it('jars and standing furniture stand on the floor of whichever storey they are dragged to; shelves go anywhere up a wall', () => {
    const vase = THING.vase;
    expect(snapThing(vase, 250, 300)).toEqual({ x: 250, y: FLOORS.living.floorY });
    expect(snapThing(vase, 250, FLOORS.basement.floorY - 200)).toEqual({ x: 250, y: FLOORS.basement.floorY });
    expect(snapThing(vase, 250, FLOORS.attic.floorY - 300)).toEqual({ x: 250, y: FLOORS.attic.floorY });
    const bookcase = THING.bookcase;
    const tall = FLOOR_Y - 420;
    expect(snapThing(bookcase, 200, 100)).toEqual({ x: 200, y: FLOORS.living.floorY - tall });
    // a shelf stays where it's put, up against a wall when it's nearly there
    const shelf = THING.shelf;
    expect(snapThing(shelf, 200, -260)).toEqual({ x: 200, y: -260 });
    expect(snapThing(shelf, 72, -260)).toEqual({ x: 64, y: -260 });
    expect(snapThing(shelf, WORLD_W, 100)).toEqual({ x: WORLD_W - 64, y: 100 });
    // (never out through a wall)
    const tub = snapThing(THING.basket, -50, 500);
    expect(thingProp(THING.basket, tub.x, tub.y, -1).x0).toBeGreaterThanOrEqual(-0.5);
  });

  it('go on an open floor indoors, clear of the tubes, the other things and the floor (a shelf)', () => {
    const vase = THING.vase;
    const taken = takenBut('vase');
    // not in the tub, nor in the funnel; where the tub was is free once it's moved
    expect(thingProblem(vase, 320, FLOOR_Y, ALL_OPEN, taken)).toBe('blocked');
    expect(thingProblem(vase, FUNNEL_X, FLOOR_Y, ALL_OPEN, taken)).toBe('blocked');
    const tubMoved = takenBut('vase', { basket: { x: 200, y: FLOORS.basement.floorY } });
    expect(thingProblem(vase, 320, FLOOR_Y, ALL_OPEN, tubMoved)).toBeNull();
    // a floor that isn't open, and the roof (that's outdoors)
    expect(thingProblem(vase, 200, FLOORS.basement.floorY, ['living'], taken)).toBe('locked');
    expect(thingProblem(vase, 200, FLOORS.roof.floorY, ALL_OPEN, taken)).toBe('sky');
    // a shelf too near the floor, and one in the attic's rafters
    const shelf = THING.shelf;
    expect(thingProblem(shelf, 200, FLOOR_Y - 40, ALL_OPEN, takenBut('shelf'))).toBe('outside');
    expect(thingProblem(shelf, 200, -300, ALL_OPEN, takenBut('shelf'))).toBeNull();
    expect(thingProblem(shelf, 64, FLOORS.attic.ceilY + 40, ALL_OPEN, takenBut('shelf'))).toBe('blocked');
    // the bookcase can't go over the chute's landing in the basement
    const b = snapThing(THING.bookcase, 60, FLOORS.basement.floorY - 50);
    expect(thingProblem(THING.bookcase, b.x, b.y, ALL_OPEN, takenBut('bookcase'))).toBe('blocked');
  });

  it('a moved thing is built where it was put, on its new floor; the cats who like it like it there', () => {
    const moved = { vase: { x: 160, y: FLOORS.basement.floorY }, basket: { x: 300, y: FLOORS.basement.floorY }, bookcase: { x: 120, y: FLOOR_Y - 140 } };
    const room = houseRoom({ open: ['basement'], residents: ['void', 'chonk'], where: {}, moved });
    const vase = room.containers.find((c) => c.id === 'vase')!;
    expect([vase.x, vase.y]).toEqual([160, FLOORS.basement.floorY]);
    const bookcase = room.furniture.find((f) => f.id === 'bookcase')!;
    expect([bookcase.x0, bookcase.x1, bookcase.y, bookcase.dy]).toEqual([75, 165, 420, undefined]);
    // Inkwell's poured into the vase and Biscuit curls up in the tub, wherever they are
    expect(spotOf({ moved }, 'void').y).toBeGreaterThan(BASEMENT_DY);
    const s = new Session(room, { shell: houseShell });
    settle(s);
    const seats = Object.fromEntries(s.cats.map((c) => [c.breed, c.seat ? s.containers[c.seat.container].id : null]));
    expect(seats).toEqual({ void: 'vase', chonk: 'basket' });
    for (const c of s.cats) expect(floorAt(c.body.cy)).toBe('basement');
    // (and every prop has a uid of its own: its colliders are found by it)
    expect(new Set(s.props.map((p) => p.uid)).size).toBe(s.props.length);
  });

  it('a save with things where they cannot be puts them back (and anything moved to where those were)', () => {
    const shelf = { x: 190, y: -100 };
    const h = { open: ['attic'] as ExtraFloor[], moved: { crate: { x: 300, y: 486 }, shelf, sill: { x: 200, y: 0 }, nonsense: { x: 1, y: 2 }, vase: { x: 200, y: FLOORS.basement.floorY } } };
    settleMoved(h);
    // the crate was in the tub, the sill doesn't move, the basement's shut
    expect(h.moved).toEqual({ shelf });
    // the tub and the vase swapped round: fine
    const swap = { open: [] as ExtraFloor[], moved: { basket: { x: 164, y: FLOOR_Y }, vase: { x: 322, y: FLOOR_Y } } };
    settleMoved(swap);
    expect(Object.keys(swap.moved)).toEqual(['basket', 'vase']);
    // the vase where the tub was, and the tub in the funnel: back home it goes, and then the vase is in its way
    const chain = { open: [] as ExtraFloor[], moved: { vase: { x: 322, y: FLOOR_Y }, basket: { x: 58, y: FLOOR_Y } } };
    settleMoved(chain);
    expect(chain.moved).toEqual({});
  });

  it('a spot on something moved moves with it', () => {
    const at = thingPos(THING.shelf);
    const moved = { shelf: { x: at.x - 100, y: -200 } };
    expect(spotOf({ moved }, 'tabby')).toEqual({ x: 290 - 100, y: -200 });
    expect(spotOf({ moved }, 'persian')).toEqual({ x: 345 - 100, y: -200 });
    // (nothing of the kitten's moved: the sill stays)
    expect(spotOf({ moved }, 'kitten')).toEqual({ x: 102, y: 212 });
  });
});

const FUNNEL_X = 58;

describe('taking a thing out of the room, and putting it back', () => {
  const home = () => new Session(houseRoom({ open: [], residents: ALL_CATS, where: {} }), { shell: houseShell });

  it('a cat in the vase is in nothing once the vase is picked up, and the others keep their places', () => {
    const s = home();
    settle(s);
    const vase = s.containers.find((p) => p.id === 'vase')!;
    const tub = s.containers.find((p) => p.id === 'basket')!;
    const ink = s.cats.find((c) => c.breed === 'void')!;
    const biscuit = s.cats.find((c) => c.breed === 'chonk')!;
    expect(ink.seat && s.containers[ink.seat.container]).toBe(vase);
    expect(biscuit.seat && s.containers[biscuit.seat.container]).toBe(tub);
    s.removeProp(vase);
    expect(s.containers).toEqual([tub]);
    expect(s.props.includes(vase)).toBe(false);
    for (const sh of vase.shapes) expect(s.world.statics.includes(sh)).toBe(false);
    expect(ink.seat).toBeNull();
    expect(s.drainEvents().some((e) => e.t === 'unseat' && e.cat === ink)).toBe(true);
    // Biscuit's still in the tub (it's first in the list now)
    expect(biscuit.seat && s.containers[biscuit.seat.container]).toBe(tub);
    for (const c of s.cats) expect(c.overlaps.length).toBe(1);
    settle(s, 60);
    expect(biscuit.seat && s.containers[biscuit.seat.container]).toBe(tub);
    // and back it goes
    s.addProp(vase);
    for (const c of s.cats) expect(c.overlaps.length).toBe(2);
    for (const sh of vase.shapes) expect(s.world.statics.includes(sh)).toBe(true);
  });

  it('a cat on a shelf that is picked up falls, and lands on what is under it', () => {
    const s = new Session(houseRoom({ open: [], residents: ['tabby'], where: {} }), { shell: houseShell });
    settle(s);
    const shelf = s.furniture.find((p) => p.id === 'shelf')!;
    const tabby = s.cats.find((c) => c.breed === 'tabby')!;
    tabby.body.computeCentroid();
    const was = tabby.body.cy;
    expect(was).toBeLessThan(shelf.y);
    s.removeProp(shelf);
    settle(s, 180);
    tabby.body.computeCentroid();
    expect(tabby.body.cy).toBeGreaterThan(shelf.y + 40);
    expect(tabby.body.cy).toBeLessThan(FLOOR_Y);
  });

  it('a thing put down where a perch would be is in its way, and a perch in a thing\'s', () => {
    const moved = { shelf: { x: 190, y: -100 } };
    const shelf = thingProp(THING.shelf, 190, -100, -1);
    const b = perchBox('shelf', 190, -110);
    expect(b.x0 < shelf.x1 && b.x1 > shelf.x0 && b.y0 < shelf.y1 && b.y1 > shelf.y0).toBe(true);
    expect(thingProblem(THING.shelf, 190, -100, ALL_OPEN, [b])).toBe('blocked');
    expect(thingProblem(THING.shelf, 190, -100, ALL_OPEN, takenBut('shelf', moved))).toBeNull();
  });
});
