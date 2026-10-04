import { describe, expect, it } from 'vitest';
import { cozyScore, shareFace } from '../src/game/fit';
import { Session } from '../src/game/session';
import type { RoomDef } from '../src/game/room';
import { shareText } from '../src/game/share';

const one = (breed: RoomDef['cats'][0]['breed'], type: RoomDef['containers'][0]['type']): RoomDef => ({
  id: 't',
  name: 'Test',
  theme: 'kitchen',
  furniture: [],
  containers: [{ type, x: 190, y: 560 }],
  cats: [{ breed, x: 190, y: 400, name: 'Test' }],
  decor: [],
});

describe('cozy scoring', () => {
  it('rewards full containers and forgives a loaf poking out', () => {
    expect(cozyScore(1, 0.4).label).toBe('Snug!');
    expect(cozyScore(0.3, 1).label).toBe('Roomy');
    expect(cozyScore(1, 0.05).score).toBeLessThan(cozyScore(1, 0.4).score);
    expect(shareFace(100)).toBe('😻');
  });

  it('a chonk dropped on a teacup glorps in and sits snugly', () => {
    const s = new Session(one('chonk', 'teacup'), { settleFrames: 0 });
    for (let f = 0; f < 400; f++) s.step();
    expect(s.cats[0].seat).not.toBeNull();
    expect(s.cats[0].seat!.cozy.score).toBeGreaterThanOrEqual(92);
    expect(s.complete).toBe(true);
  });

  it('a kitten in a huge basket counts as seated but roomy', () => {
    const s = new Session(one('kitten', 'basket'), { settleFrames: 0 });
    for (let f = 0; f < 400; f++) s.step();
    expect(s.cats[0].seat?.cozy.label).toBe('Roomy');
  });

  it('undo rewinds a nudge and refunds the paw', () => {
    const s = new Session(one('tabby', 'box'), { settleFrames: 0 });
    for (let f = 0; f < 60; f++) s.step();
    const cat = s.cats[0];
    const before = Array.from(cat.body.x);
    s.beginGrab(cat, cat.body.cx, cat.body.cy);
    for (let f = 0; f < 30; f++) {
      s.moveGrab(60, 300, 0, 0);
      s.step();
    }
    s.endGrab();
    expect(s.paws).toBe(1);
    expect(s.undo()).toBe(true);
    expect(s.paws).toBe(0);
    expect(Array.from(cat.body.x)).toEqual(before);
  });

  it('share text is spoiler-free', () => {
    const text = shareText({
      result: { cats: [], cozy: 94, paws: 3, par: 3, faces: '😻😺😻' },
      roomName: 'Sunny Kitchen',
      number: 4,
    });
    expect(text).toContain('If It Fits #4');
    expect(text).toContain('😻😺😻');
    expect(text).toContain('🐾 3/3');
    expect(text).not.toMatch(/teacup|boot|bowl/);
  });
});
