import { describe, expect, it } from 'vitest';
import { cozyScore } from '../src/game/fit';
import { Session } from '../src/game/session';
import type { RoomDef } from '../src/game/room';

const one = (breed: RoomDef['cats'][0]['breed'], type: RoomDef['containers'][0]['type']): RoomDef => ({
  id: 't',
  name: 'Test',
  theme: 'kitchen',
  furniture: [],
  containers: [{ type, x: 190, y: 560 }],
  cats: [{ breed, x: 190, y: 400, name: 'Test' }],
  decor: [],
});

describe('if it fits, I sits', () => {
  it('a snug fit scores high, and a loaf poking out is forgiven', () => {
    expect(cozyScore(1, 0.4).label).toBe('Snug!');
    expect(cozyScore(0.3, 1).label).toBe('Roomy');
    expect(cozyScore(1, 0.05).score).toBeLessThan(cozyScore(1, 0.4).score);
  });

  it('a chonk dropped on a teacup glorps in and sits snugly', () => {
    const s = new Session(one('chonk', 'teacup'), { settleFrames: 0 });
    for (let f = 0; f < 400; f++) s.step();
    expect(s.cats[0].seat).not.toBeNull();
    expect(s.cats[0].seat!.cozy.score).toBeGreaterThanOrEqual(92);
  });

  it('a kitten in a huge basket counts as seated but roomy', () => {
    const s = new Session(one('kitten', 'basket'), { settleFrames: 0 });
    for (let f = 0; f < 400; f++) s.step();
    expect(s.cats[0].seat?.cozy.label).toBe('Roomy');
  });

  it('a cat lifted out of a box is up and out of it, and settles back in when let go over it', () => {
    const s = new Session(one('tabby', 'box'), { settleFrames: 0 });
    for (let f = 0; f < 300; f++) s.step();
    const cat = s.cats[0];
    expect(cat.seat).not.toBeNull();
    cat.body.computeCentroid();
    s.beginGrab(cat, cat.body.cx, cat.body.cy);
    expect(cat.seat).toBeNull();
    for (let f = 0; f < 60; f++) {
      s.moveGrab(190, 300, 0, 0);
      s.step();
    }
    s.endGrab();
    for (let f = 0; f < 400; f++) s.step();
    expect(cat.seat).not.toBeNull();
  });
});
