// Tiny SVG cat faces for the progress row, share card and results.

import { BREEDS, type BreedId } from '../physics/breeds';

export function faceSVG(breed: BreedId, opts: { mood?: 'happy' | 'open' | 'sleepy'; size?: number } = {}): string {
  const l = BREEDS[breed].look;
  const mood = opts.mood ?? 'open';
  const size = opts.size ?? 26;
  const eye = l.eye;
  const eyes =
    mood === 'happy'
      ? `<path d="M8.6 15.4q1.6-2 3.2 0M16.2 15.4q1.6-2 3.2 0" stroke="${eye}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
      : mood === 'sleepy'
        ? `<path d="M8.6 14.8q1.6 1 3.2 0M16.2 14.8q1.6 1 3.2 0" stroke="${eye}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`
        : `<circle cx="10.2" cy="14.6" r="1.6" fill="${eye}"/><circle cx="17.8" cy="14.6" r="1.6" fill="${eye}"/>`;
  const earTuft = l.earTufts ? `<path d="M5.5 3.2l-.6-2.4M22.5 3.2l.6-2.4" stroke="${l.accent}" stroke-width="1.2" stroke-linecap="round"/>` : '';
  const stripes =
    l.pattern === 'tabby'
      ? `<path d="M12.6 8.2v2.2M14 7.8v2.4M15.4 8.2v2.2" stroke="${l.accent}" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>`
      : '';
  const muzzle = l.pattern === 'none' ? '' : `<ellipse cx="14" cy="19.2" rx="4.4" ry="2.6" fill="${l.light}" opacity=".85"/>`;
  return `<svg class="face-svg" width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true">
  <path d="M4.2 11.5 4.6 3.2l6.1 4.1a12 12 0 0 1 6.6 0l6.1-4.1.4 8.3A10.4 10.4 0 0 1 25 16.3C25 21.7 20.1 25 14 25S3 21.7 3 16.3a10.4 10.4 0 0 1 1.2-4.8Z" fill="${l.body}" stroke="${l.shade}" stroke-width="1.3" stroke-linejoin="round"/>
  <path d="M6 5.6l.2 3.6 2.6-1.8ZM22 5.6l-.2 3.6-2.6-1.8Z" fill="${l.innerEar}"/>
  ${earTuft}${stripes}${muzzle}
  <ellipse cx="8.4" cy="18.4" rx="2" ry="1.2" fill="${l.cheek}" opacity=".55"/><ellipse cx="19.6" cy="18.4" rx="2" ry="1.2" fill="${l.cheek}" opacity=".55"/>
  ${eyes}
  <path d="M13 17.6h2l-1 1.2Z" fill="${l.nose}"/>
  <path d="M14 18.8q-.4 1.4-1.8 1M14 18.8q.4 1.4 1.8 1" stroke="${eye}" stroke-width=".9" fill="none" stroke-linecap="round" opacity=".7"/>
</svg>`;
}
