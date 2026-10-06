// Tiny painted SVG cat faces for the progress row, share card and results.

import { BREEDS, type BreedId, type BreedLook } from '../physics/breeds';
import { lightOf, lineOf, shadowOf } from '../render/paint';

/** `look` paints it in a coat of its own (with `key` naming that coat, for its gradients). */
export function faceSVG(breed: BreedId, opts: { mood?: 'happy' | 'open' | 'sleepy'; size?: number; look?: BreedLook; key?: string } = {}): string {
  const l = opts.look ?? BREEDS[breed].look;
  const mood = opts.mood ?? 'open';
  const size = opts.size ?? 26;
  const dark = l.persona === 'void';
  const eye = l.eye;
  const lid = dark ? eye : '#3A2F3F';
  // gradient ids are per breed (or coat): identical definitions, so repeats are harmless
  const id = `cf-${opts.key ?? breed}`;
  const eyes =
    mood === 'happy'
      ? `<path d="M8.4 15.3q1.8-2.2 3.6 0M16 15.3q1.8-2.2 3.6 0" stroke="${lid}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
      : mood === 'sleepy'
        ? `<path d="M8.5 14.8q1.7 1.1 3.4 0M16.1 14.8q1.7 1.1 3.4 0" stroke="${lid}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
        : `<circle cx="10.2" cy="14.6" r="1.75" fill="${eye}"/><circle cx="17.8" cy="14.6" r="1.75" fill="${eye}"/>` +
          (dark ? `<ellipse cx="10.2" cy="14.7" rx=".7" ry="1.3" fill="#2A2438"/><ellipse cx="17.8" cy="14.7" rx=".7" ry="1.3" fill="#2A2438"/>` : '') +
          `<circle cx="10.85" cy="13.95" r=".62" fill="#fff"/><circle cx="18.45" cy="13.95" r=".62" fill="#fff"/>`;
  const earTuft = l.earTufts ? `<path d="M5.5 3.2l-.6-2.4M22.5 3.2l.6-2.4" stroke="${l.accent}" stroke-width="1.2" stroke-linecap="round"/>` : '';
  const stripes =
    l.pattern === 'tabby' || l.pattern === 'mane' || l.pattern === 'belly'
      ? `<path d="M12.6 8.2v2.2M14 7.8v2.4M15.4 8.2v2.2" stroke="${l.accent}" stroke-width="1.2" stroke-linecap="round" opacity=".6"/>`
      : '';
  const blaze =
    l.pattern === 'patches'
      ? `<path d="M5.2 9.2q2.6-3.3 6.2-1.2q-.8 2.6-3.6 3.4q-1.9-.4-2.6-2.2Z" fill="${l.accent}" opacity=".5"/><path d="M13.4 9.6q.6-.5 1.2 0l2.6 8.6h-6.4Z" fill="${l.light}" opacity=".95"/>`
      : '';
  const muzzle =
    l.pattern === 'none' || l.pattern === 'wrinkles'
      ? ''
      : `<ellipse cx="12.6" cy="19.4" rx="2.6" ry="2" fill="${l.light}" opacity=".9"/><ellipse cx="15.4" cy="19.4" rx="2.6" ry="2" fill="${l.light}" opacity=".9"/>`;
  return `<svg class="face-svg" width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true">
  <defs>
    <radialGradient id="${id}" cx="40%" cy="34%" r="72%">
      <stop offset="0" stop-color="${lightOf(l.body, dark ? 0.3 : 0.5)}"/>
      <stop offset=".55" stop-color="${l.body}"/>
      <stop offset="1" stop-color="${shadowOf(l.body, dark ? 0.35 : 0.4)}"/>
    </radialGradient>
    <linearGradient id="${id}-e" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="${shadowOf(l.innerEar, 0.3)}"/>
      <stop offset="1" stop-color="${l.innerEar}"/>
    </linearGradient>
  </defs>
  <path d="M4.2 11.5 4.6 3.2l6.1 4.1a12 12 0 0 1 6.6 0l6.1-4.1.4 8.3A10.4 10.4 0 0 1 25 16.3C25 21.7 20.1 25 14 25S3 21.7 3 16.3a10.4 10.4 0 0 1 1.2-4.8Z" fill="url(#${id})" stroke="${dark ? '#1E1B29' : lineOf(l.body)}" stroke-opacity="${l.pattern === 'fluff' ? 0.65 : 0.85}" stroke-width="1.15" stroke-linejoin="round"/>
  <path d="M5.9 5.4l.25 3.9 2.8-1.95Z M22.1 5.4l-.25 3.9-2.8-1.95Z" fill="url(#${id}-e)"/>
  ${earTuft}${stripes}${blaze}${muzzle}
  <ellipse cx="8.2" cy="18.3" rx="2.2" ry="1.3" fill="${l.cheek}" opacity=".5"/><ellipse cx="19.8" cy="18.3" rx="2.2" ry="1.3" fill="${l.cheek}" opacity=".5"/>
  ${eyes}
  <path d="M12.7 17.5q1.3-.7 2.6 0q-.2 1-1.3 1.6q-1.1-.6-1.3-1.6Z" fill="${l.nose}"/>
  <ellipse cx="13.5" cy="17.6" rx=".45" ry=".25" fill="#fff" opacity=".6"/>
  <path d="M14 19.1q-.4 1.3-1.8.9M14 19.1q.4 1.3 1.8.9" stroke="${dark ? '#9D90C2' : shadowOf(l.nose, 0.7)}" stroke-width=".85" fill="none" stroke-linecap="round" opacity=".8"/>
</svg>`;
}
