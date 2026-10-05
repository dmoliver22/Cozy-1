import { describe, expect, it } from 'vitest';
import { FLOOR_Y, WORLD_W } from '../src/game/props';
import { Session } from '../src/game/session';
import { homeRoom, portalAt, PORTALS } from '../src/house/homeRoom';
import { ALL_CATS, INKWELL_ROOM, arrive, emptyHouse, loadHouse, moveInFor, nextMoveIn, recordRun, settle } from '../src/house/house';

const jar = (biggest: number, over = true) => ({ game: 'jar' as const, daily: false, score: 1000, biggest, drops: 30, over });
const drop = (depth: number, fish: number, over = true) => ({ game: 'drop' as const, daily: false, score: 500, depth, fish, breed: 'tabby' as const, over });

describe('the house', () => {
  it('starts with Pip and Mochi, and five cats still to meet', () => {
    const h = emptyHouse();
    expect(h.residents).toEqual(['kitten', 'tabby']);
    expect(ALL_CATS).toHaveLength(7);
    expect(new Set(ALL_CATS).size).toBe(7);
    expect(nextMoveIn(h)?.breed).toBe('persian');
    expect(nextMoveIn(h, 'jar')?.breed).toBe('mainecoon');
    expect(nextMoveIn(h, 'drop')?.breed).toBe('sphynx');
  });

  it('a finished If It Fits room brings Duchess home, once', () => {
    const h = emptyHouse();
    expect(recordRun(h, { game: 'fits', room: 'sunny-kitchen' })).toEqual(['persian']);
    expect(h.arriving).toEqual(['persian']);
    expect(recordRun(h, { game: 'fits', room: 'bath-time' })).toEqual([]);
    expect(arrive(h)).toBe('persian');
    expect(h.residents).toContain('persian');
    expect(h.arriving).toEqual([]);
    expect(arrive(h)).toBeNull();
    expect(h.stats.fitsRooms).toBe(2);
    expect(h.stats.fitsDone).toEqual(['sunny-kitchen', 'bath-time']);
  });

  it('Cat Jar and Cat Drop milestones count as soon as they happen, mid-run too', () => {
    const h = emptyHouse();
    expect(recordRun(h, jar(3, false))).toEqual([]);
    expect(recordRun(h, jar(4, false))).toEqual(['mainecoon']);
    expect(h.stats.jarGames).toBe(0);
    recordRun(h, jar(4, true));
    expect(h.stats.jarGames).toBe(1);
    expect(recordRun(h, drop(60, 10, false))).toEqual([]);
    expect(recordRun(h, drop(100, 12, false))).toEqual(['sphynx']);
    expect(recordRun(h, drop(140, 25, true))).toEqual(['chonk']);
    expect(h.stats.dropRuns).toBe(1);
    expect(h.stats.dropDeepest).toBe(140);
    expect(h.stats.dropMostFish).toBe(25);
    expect(h.arriving).toEqual(['mainecoon', 'sphynx', 'chonk']);
  });

  it('Inkwell follows you home from the Midnight Study', () => {
    const h = emptyHouse();
    recordRun(h, { game: 'fits', room: 'sunny-kitchen' });
    expect(h.arriving).not.toContain('void');
    expect(recordRun(h, { game: 'fits', room: INKWELL_ROOM })).toEqual(['void']);
    expect(moveInFor('void')?.room).toBe(INKWELL_ROOM);
  });

  it('a new house counts progress made before it', () => {
    const h = loadHouse({ fitsRooms: 3, fitsDone: ['sunny-kitchen', INKWELL_ROOM], jarBest: 900, dropBest: 300 });
    expect(h.arriving).toEqual(['persian', 'void']);
    expect(h.stats.jarBest).toBe(900);
    // nothing new to settle
    expect(settle(h)).toEqual([]);
  });

  it('when everyone lives here there is nobody left to meet', () => {
    const h = emptyHouse();
    recordRun(h, { game: 'fits', room: INKWELL_ROOM });
    recordRun(h, jar(6));
    recordRun(h, drop(200, 30));
    while (arrive(h));
    expect([...h.residents].sort()).toEqual([...ALL_CATS].sort());
    expect(nextMoveIn(h)).toBeNull();
  });
});

describe('the home room', () => {
  it('everyone fits in their spot and stays in the room', () => {
    const s = new Session(homeRoom(ALL_CATS), { mode: 'sandbox' });
    for (let f = 0; f < 240; f++) s.step();
    for (const c of s.cats) {
      c.body.computeCentroid();
      expect(c.body.cx).toBeGreaterThan(0);
      expect(c.body.cx).toBeLessThan(WORLD_W);
      expect(c.body.cy).toBeLessThan(FLOOR_Y);
      expect(c.body.cy).toBeGreaterThan(0);
    }
    // Duchess in her basket and Inkwell in the box
    const seats = Object.fromEntries(s.cats.map((c) => [c.breed, c.seat ? s.containers[c.seat.container].type : null]));
    expect(seats.persian).toBe('basket');
    expect(seats.void).toBe('box');
    expect(s.complete).toBe(false);
  });

  it('the box, the jar and the hatch lead to the three games', () => {
    expect(PORTALS.map((p) => p.game).sort()).toEqual(['drop', 'fits', 'jar']);
    expect(portalAt(196, 530)?.game).toBe('fits');
    expect(portalAt(300, 300)?.game).toBe('jar');
    expect(portalAt(326, 10)?.game).toBe('drop');
    expect(portalAt(60, 300)).toBeNull();
  });
});
