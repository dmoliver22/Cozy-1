// Three hand-made rooms. Room 1 is the 5-second clip: a huge ginger cat on the
// counter above a tiny blue teacup.

import type { RoomDef } from './room';

export const HANDMADE: RoomDef[] = [
  {
    id: 'sunny-kitchen',
    name: 'Sunny Kitchen',
    subtitle: 'Room 1',
    theme: 'kitchen',
    par: 3,
    // Found by the solver (scripts/plans.ts); used for hints.
    plan: [
      { cat: 0, container: 0, gx: 15, gy: -4, tx: 166, ty: 322, hold: 40, kind: 'drag', move: 38, tol: 0.3 },
      { cat: 2, container: 2, gx: -11, gy: -3, tx: 306, ty: 321, hold: 40, kind: 'drag', wx: 243, wy: 321, move: 22, tol: 0.3 },
      { cat: 1, container: 1, gx: 8, gy: -2, tx: 250, ty: 184, hold: 40, kind: 'drag', move: 28, tol: 0.3 },
    ],
    tutorial: true,
    furniture: [
      { type: 'counter', x0: 0, x1: 124, y: 360 },
      { type: 'stool', x0: 136, x1: 196, y: 470 },
      { type: 'sill', x0: 146, x1: 236, y: 206 },
      { type: 'table', x0: 270, x1: 380, y: 430 },
      { type: 'shelf', x0: 272, x1: 380, y: 250 },
    ],
    containers: [
      { type: 'teacup', x: 166, y: 470, tint: 0 },
      { type: 'boot', x: 250, y: 560, tint: 0, flip: true },
      { type: 'fruitbowl', x: 306, y: 430, tint: 0, scale: 0.9 },
    ],
    cats: [
      { breed: 'chonk', x: 58, y: 360, name: 'Biscuit' },
      { breed: 'kitten', x: 188, y: 206, name: 'Pip' },
      { breed: 'persian', x: 334, y: 250, name: 'Duchess' },
    ],
    decor: [
      { type: 'window', x: 191, y: 62, w: 92, h: 128, variant: 0 },
      { type: 'backsplash', x: 0, y: 270, w: 124, h: 90 },
      { type: 'jars', x: 20, y: 360, w: 2 },
      { type: 'clock', x: 334, y: 120, w: 17 },
      { type: 'picture', x: 62, y: 120, w: 52, h: 42, variant: 0 },
      { type: 'rug', x: 186, y: 560, w: 150 },
    ],
  },
  {
    id: 'bath-time',
    name: 'Bath Time',
    subtitle: 'Room 2',
    theme: 'bathroom',
    par: 3,
    // Found by the solver (scripts/plans.ts); used for hints.
    plan: [
      { cat: 0, container: 0, gx: 13, gy: -4, tx: 140, ty: 319, hold: 50, kind: 'drag', move: 36, tol: 0.25 },
      { cat: 2, container: 2, gx: -10, gy: -3, tx: 306, ty: 377, hold: 40, kind: 'drag', wx: 263, wy: 377, move: 23, tol: 0.3 },
      { cat: 1, container: 1, gx: -8, gy: -2, tx: 172, ty: 110, hold: 60, kind: 'drag', move: 43, tol: 0.15 },
    ],
    furniture: [
      { type: 'cabinet', x0: 0, x1: 106, y: 352 },
      { type: 'sill', x0: 126, x1: 226, y: 212 },
      { type: 'shelf', x0: 236, x1: 306, y: 132 },
      { type: 'shelf', x0: 288, x1: 380, y: 248 },
    ],
    containers: [
      { type: 'bucket', x: 153, y: 560, scale: 1.08, tint: 0 },
      { type: 'teacup', x: 172, y: 212, tint: 1 },
      { type: 'sink', x: 306, y: 560, scale: 0.95 },
    ],
    cats: [
      { breed: 'mainecoon', x: 53, y: 352, name: 'Juniper' },
      { breed: 'kitten', x: 268, y: 132, name: 'Pip' },
      { breed: 'sphynx', x: 340, y: 248, name: 'Noodle' },
    ],
    decor: [
      { type: 'window', x: 176, y: 78, w: 92, h: 124, variant: 1 },
      { type: 'towel', x: 56, y: 150 },
      { type: 'mirror', x: 306, y: 300, w: 46, h: 70 },
      { type: 'rug', x: 200, y: 560, w: 140 },
    ],
  },
  {
    id: 'midnight-study',
    name: 'Midnight Study',
    mood: 'night',
    subtitle: 'Room 3',
    theme: 'study',
    par: 3,
    // Found by the solver (scripts/plans.ts); used for hints.
    plan: [
      { cat: 0, container: 0, gx: 15, gy: -4, tx: 173, ty: 285, hold: 50, kind: 'drag', move: 40, tol: 0.25 },
      { cat: 2, container: 2, gx: -11, gy: -3, tx: 312, ty: 326, hold: 20, kind: 'drag', wx: 255, wy: 326, move: 20, tol: 0.45 },
      { cat: 1, container: 1, gx: -10, gy: -3, tx: 195, ty: 78, hold: 60, kind: 'drag', move: 42, tol: 0.15 },
    ],
    furniture: [
      { type: 'bookcase', x0: 0, x1: 118, y: 322 },
      { type: 'sill', x0: 146, x1: 244, y: 232 },
      { type: 'shelf', x0: 252, x1: 322, y: 118 },
      { type: 'shelf', x0: 284, x1: 380, y: 262 },
      { type: 'table', x0: 268, x1: 380, y: 446 },
    ],
    containers: [
      { type: 'box', x: 190, y: 560, tint: 0 },
      { type: 'vase', x: 195, y: 232, tint: 2 },
      { type: 'mixingbowl', x: 312, y: 446, tint: 1 },
    ],
    cats: [
      { breed: 'chonk', x: 59, y: 322, name: 'Biscuit' },
      { breed: 'void', x: 286, y: 118, name: 'Inkwell' },
      { breed: 'persian', x: 334, y: 262, name: 'Duchess' },
    ],
    decor: [
      { type: 'window', x: 195, y: 88, w: 96, h: 128, variant: 3 },
      { type: 'pendant', x: 330, y: 40 },
      { type: 'picture', x: 60, y: 160, w: 50, h: 40, variant: 2 },
      { type: 'books', x: 300, y: 262, w: 0 },
      { type: 'rug', x: 190, y: 560, w: 160 },
    ],
  },
];
