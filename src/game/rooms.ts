// Three hand-made rooms. Room 1 is the 5-second clip: a huge ginger cat on the
// counter above a tiny blue teacup.

import type { RoomDef } from './room';

export const HANDMADE: RoomDef[] = [
  {
    id: 'sunny-kitchen',
    name: 'Sunny Kitchen',
    subtitle: 'Room 1',
    theme: 'kitchen',
    tutorial: true,
    furniture: [
      { type: 'counter', x0: 0, x1: 124, y: 360 },
      { type: 'stool', x0: 136, x1: 196, y: 470 },
      { type: 'sill', x0: 150, x1: 262, y: 206 },
      { type: 'table', x0: 262, x1: 360, y: 430 },
      { type: 'shelf', x0: 262, x1: 360, y: 250 },
    ],
    containers: [
      { type: 'teacup', x: 166, y: 470, tint: 0 },
      { type: 'boot', x: 226, y: 560, tint: 0 },
      { type: 'fruitbowl', x: 292, y: 430, tint: 0, scale: 0.85 },
    ],
    cats: [
      { breed: 'chonk', x: 58, y: 360, name: 'Biscuit' },
      { breed: 'kitten', x: 226, y: 206, name: 'Pip' },
      { breed: 'persian', x: 316, y: 250, name: 'Duchess' },
    ],
    decor: [
      { type: 'window', x: 206, y: 62, w: 100, h: 128, variant: 0 },
      { type: 'backsplash', x: 0, y: 270, w: 124, h: 90 },
      { type: 'jars', x: 20, y: 360, w: 2 },
      { type: 'clock', x: 318, y: 120, w: 17 },
      { type: 'picture', x: 62, y: 120, w: 52, h: 42, variant: 0 },
      { type: 'rug', x: 186, y: 560, w: 150 },
    ],
  },
];
