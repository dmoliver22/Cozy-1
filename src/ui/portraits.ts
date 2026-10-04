// Little resting-cat portraits for the collection and the sandbox picker.

import { BREEDS, type BreedId } from '../physics/breeds';
import { SoftBody } from '../physics/softbody';
import { World } from '../physics/world';
import { roundedBox } from '../physics/shapes';
import { CatView, drawCat } from '../render/catArt';

const cache = new Map<string, HTMLCanvasElement>();

/** A settled loaf of the given breed drawn into a canvas (CSS size w x h). */
export function catPortrait(breed: BreedId, w: number, h: number, opts: { silhouette?: boolean; happy?: boolean } = {}): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const key = `${breed}:${w}x${h}@${dpr}:${opts.silhouette ? 's' : ''}${opts.happy ? 'h' : ''}`;
  const hit = cache.get(key);
  if (hit) return cloneCanvas(hit);
  const world = new World();
  world.addStatic(roundedBox(-200, 0, 400, 50, 3));
  const r = BREEDS[breed].physics.radius;
  const body = world.addBody(new SoftBody(breed, 0, -r - 2));
  for (let i = 0; i < 70; i++) {
    body.loafiness = Math.min(1, i / 30);
    world.step();
  }
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext('2d')!;
  const view = new CatView(body.n, 3);
  view.side = 1;
  view.blinkAt = 1e9;
  const s = Math.min((w * 0.62) / (r * 2.6), (h * 0.72) / (r * 2.2));
  ctx.setTransform(dpr * s, 0, 0, dpr * s, (dpr * w) / 2, dpr * (h - 6));
  // soft floor shadow
  ctx.fillStyle = 'rgba(62,58,79,0.12)';
  ctx.beginPath();
  ctx.ellipse(0, 2, r * 1.4, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  drawCat(ctx, body, view, {
    expression: opts.happy ? 'happy' : BREEDS[breed].look.persona === 'sleepy' ? 'sleepy' : 'open',
    look: 0,
    rimY: null,
    purr: 0,
    grabbed: false,
    glow: 0,
    silhouette: opts.silhouette,
  });
  cache.set(key, c);
  return cloneCanvas(c);
}

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
}
