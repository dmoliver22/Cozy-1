// The sandbox photo room: pour any cat into anything, then take a picture.

import { BREED_ORDER, BREEDS, CAT_NAMES, type BreedId } from './physics/breeds';
import { CONTAINERS, FLOOR_Y, WORLD_W, type ContainerType, type Prop } from './game/props';
import type { RoomDef } from './game/room';
import type { Session } from './game/session';
import { ROOM_BOTTOM, ROOM_TOP, type Renderer } from './render/renderer';
import { containerArtExtent, containerShadow, drawContainerBack, drawContainerFront } from './render/propArt';
import { PALETTE } from './render/paint';
import { prettyDate, localDateKey } from './util/date';

export const SANDBOX_ROOM: RoomDef = {
  id: 'sandbox',
  name: 'Photo Room',
  subtitle: 'Sandbox · pour anything into anything',
  theme: 'studio',
  furniture: [
    { type: 'shelf', x0: 0, x1: 120, y: 300 },
    { type: 'shelf', x0: 262, x1: 380, y: 250 },
    { type: 'stool', x0: 160, x1: 222, y: 470 },
  ],
  containers: [
    { type: 'teacup', x: 191, y: 470, tint: 0 },
    { type: 'box', x: 310, y: FLOOR_Y, tint: 0 },
    { type: 'boot', x: 60, y: FLOOR_Y, tint: 1 },
  ],
  cats: [
    { breed: 'chonk', x: 60, y: 300, name: 'Biscuit' },
    { breed: 'kitten', x: 320, y: 250, name: 'Pip' },
  ],
  decor: [
    { type: 'window', x: 190, y: 60, w: 112, h: 136, variant: 0 },
    { type: 'garland', x: 190, y: 12, w: 330 },
    { type: 'picture', x: 60, y: 150, w: 54, h: 44, variant: 1 },
    { type: 'plant', x: 360, y: 250, w: 26 },
    { type: 'rug', x: 190, y: FLOOR_Y, w: 190 },
  ],
};

export const SANDBOX_THINGS: ContainerType[] = ['teacup', 'mug', 'boot', 'box', 'shoebox', 'fruitbowl', 'mixingbowl', 'saucepan', 'pot', 'vase', 'bucket', 'basket', 'slipper', 'sink'];

const MAX_CATS = 8;
const MAX_THINGS = 9;

export class Sandbox {
  private dragging: { k: number; dx: number; dy: number; uid: number } | null = null;
  private nameIdx = 0;

  constructor(
    private session: Session,
    private renderer: Renderer,
  ) {}

  canAddCat(): boolean {
    return this.session.cats.length < MAX_CATS;
  }

  canAddThing(): boolean {
    return this.session.containers.length < MAX_THINGS;
  }

  addCat(breed: BreedId): void {
    if (!this.canAddCat()) {
      // Make room: the oldest cat wanders off.
      this.session.removeCat(this.session.cats[0]);
    }
    const r = BREEDS[breed].physics.radius;
    const x = 70 + Math.random() * (WORLD_W - 140);
    const name = CAT_NAMES[(this.nameIdx++ * 7 + 3) % CAT_NAMES.length];
    this.session.addCat(breed, x, ROOM_TOP + r + 30, name);
  }

  addThing(type: ContainerType): void {
    if (!this.canAddThing()) this.session.removeContainer(0);
    const spec = CONTAINERS[type];
    const w = spec.bounds[2] - spec.bounds[0];
    // find the widest free stretch of floor
    const taken = this.session.props
      .filter((p) => p.y1 >= FLOOR_Y - 2 || p.kind === 'furniture')
      .map((p) => [p.x0 - 4, p.x1 + 4] as const)
      .sort((a, b) => a[0] - b[0]);
    let best = { x: WORLD_W / 2, gap: -1 };
    let cursor = 0;
    for (const [a, b] of [...taken, [WORLD_W, WORLD_W] as const]) {
      const gap = a - cursor;
      if (gap > best.gap) best = { x: (cursor + a) / 2, gap };
      cursor = Math.max(cursor, b);
    }
    const x = Math.min(WORLD_W - w / 2 - 2, Math.max(w / 2 + 2, best.x));
    this.session.addContainer({ type, x, y: FLOOR_Y, tint: Math.floor(Math.random() * 4) });
    this.renderer.invalidate();
  }

  tidy(): void {
    while (this.session.cats.length) this.session.removeCat(this.session.cats[0]);
    while (this.session.containers.length) this.session.removeContainer(0);
    this.renderer.invalidate();
  }

  /** Try to start dragging a container under the pointer. */
  pickThing(wx: number, wy: number): boolean {
    for (let k = this.session.containers.length - 1; k >= 0; k--) {
      const p = this.session.containers[k];
      if (wx >= p.x0 - 6 && wx <= p.x1 + 6 && wy >= p.y0 - 8 && wy <= p.y1 + 4) {
        this.dragging = { k, dx: wx - p.x, dy: wy - p.y, uid: p.uid };
        this.renderer.liveProps.add(p.uid);
        return true;
      }
    }
    return false;
  }

  get draggingThing(): boolean {
    return this.dragging !== null;
  }

  moveThing(wx: number, wy: number): void {
    const d = this.dragging;
    if (!d) return;
    const p = this.session.containers[d.k];
    const halfL = p.x - p.x0;
    const halfR = p.x1 - p.x;
    const x = Math.min(WORLD_W - halfR, Math.max(halfL, wx - d.dx));
    const y = Math.min(FLOOR_Y, wy - d.dy);
    this.session.moveContainer(d.k, x, y);
  }

  dropThing(): void {
    const d = this.dragging;
    if (!d) return;
    this.dragging = null;
    const p = this.session.containers[d.k];
    // Settle onto the first surface below.
    let y = FLOOR_Y;
    for (const f of this.session.furniture) {
      for (const s of f.surfaces) {
        if (p.x >= s.x0 + 6 && p.x <= s.x1 - 6 && s.y >= p.y - 2 && s.y < y) y = s.y;
      }
    }
    this.session.moveContainer(d.k, p.x, y);
    this.renderer.liveProps.delete(d.uid);
    this.renderer.invalidate();
  }

  /** Render a polaroid of the room. */
  photo(): HTMLCanvasElement {
    const r = this.renderer;
    const tl = r.worldToScreen(-4, ROOM_TOP + 4);
    const br = r.worldToScreen(WORLD_W + 4, Math.min(ROOM_BOTTOM - 10, FLOOR_Y + 40));
    const dpr = r.dpr;
    const sx = Math.max(0, tl.x * dpr);
    const sy = Math.max(0, tl.y * dpr);
    const sw = Math.min(r.canvas.width - sx, (br.x - tl.x) * dpr);
    const sh = Math.min(r.canvas.height - sy, (br.y - tl.y) * dpr);
    const W = 1080;
    const pad = 54;
    const imgW = W - pad * 2;
    const imgH = Math.round((imgW * sh) / sw);
    const H = pad + imgH + 190;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#FFFDF8';
    g.fillRect(0, 0, W, H);
    g.drawImage(r.canvas, sx, sy, sw, sh, pad, pad, imgW, imgH);
    g.strokeStyle = 'rgba(62,58,79,0.15)';
    g.lineWidth = 2;
    g.strokeRect(pad, pad, imgW, imgH);
    g.fillStyle = PALETTE.ink;
    g.textAlign = 'center';
    g.font = '800 64px "Baloo 2", system-ui';
    g.fillText('If it fits, I sits.', W / 2, pad + imgH + 92);
    const names = this.session.cats
      .filter((cat) => cat.seat)
      .map((cat) => `${cat.name} the ${BREEDS[cat.breed].name}`)
      .slice(0, 3);
    g.font = '700 32px "Nunito", system-ui';
    g.fillStyle = '#7A7390';
    g.fillText(names.length ? names.join(' · ') : 'If It Fits · Photo Room', W / 2, pad + imgH + 142);
    g.font = '700 26px "Nunito", system-ui';
    g.fillText(prettyDate(localDateKey()), W / 2, pad + imgH + 176);
    return c;
  }
}

/** Small preview images of containers for the picker. */
export function thingPreview(type: ContainerType, w: number, h: number): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = w * dpr;
  c.height = h * dpr;
  const g = c.getContext('2d')!;
  const spec = CONTAINERS[type];
  // fit the painted art (flaps, handles and taps reach past the physics bounds)
  const [bx0, by0, bx1, by1] = containerArtExtent(type);
  const bw = bx1 - bx0;
  const bh = by1 - by0;
  const s = Math.min((w - 8) / bw, (h - 8) / bh);
  g.setTransform(dpr * s, 0, 0, dpr * s, dpr * (w / 2 - ((bx0 + bx1) / 2) * s), dpr * (h - 4 - by1 * s));
  const fake = { type, x: 0, y: 0, flip: false, scale: 1, tint: 0, uid: 1, material: spec.material } as unknown as Prop;
  containerShadow(g, fake);
  drawContainerBack(g, fake);
  drawContainerFront(g, fake);
  return c;
}

export const SANDBOX_BREEDS = BREED_ORDER;
