// "If it fits, I sits": measuring how much of a container a cat fills and how
// snug that is (a cat settles into a container that holds it).

import type { SoftBody } from '../physics/softbody';
import { smoothstep } from '../util/math';
import type { Prop } from './props';

export interface Overlap {
  /** Interior samples covered by the cat. */
  covered: number;
  /** Fraction of the container interior filled (0..1). */
  fill: number;
  /** Fraction of the cat's own area that is inside the container (0..1). */
  inside: number;
}

const bb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/** Measure overlap of a cat with a container's cavity. */
export function measureOverlap(body: SoftBody, prop: Prop, out: Overlap): Overlap {
  out.covered = 0;
  out.fill = 0;
  out.inside = 0;
  const samples = prop.samples;
  if (!samples || samples.length === 0) return out;
  body.bounds(bb);
  const interior = prop.interior!;
  let iMinX = Infinity;
  let iMaxX = -Infinity;
  let iMinY = Infinity;
  let iMaxY = -Infinity;
  for (const p of interior) {
    if (p.x < iMinX) iMinX = p.x;
    if (p.x > iMaxX) iMaxX = p.x;
    if (p.y < iMinY) iMinY = p.y;
    if (p.y > iMaxY) iMaxY = p.y;
  }
  if (bb.maxX < iMinX || bb.minX > iMaxX || bb.maxY < iMinY || bb.minY > iMaxY) return out;
  const { x, y, n } = body;
  let covered = 0;
  const total = samples.length / 2;
  for (let s = 0; s < samples.length; s += 2) {
    const px = samples[s];
    const py = samples[s + 1];
    if (px < bb.minX || px > bb.maxX || py < bb.minY || py > bb.maxY) continue;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = y[i];
      const yj = y[j];
      if (yi > py !== yj > py) {
        const xc = x[j] + ((py - yj) * (x[i] - x[j])) / (yi - yj);
        if (px < xc) inside = !inside;
      }
    }
    if (inside) covered++;
  }
  out.covered = covered;
  out.fill = covered / total;
  // Cells near the walls are excluded from sampling, so scale inside-area by
  // the ratio of true capacity to sampled area.
  const sampledArea = total * prop.cellArea;
  const insideArea = covered * prop.cellArea * (prop.capacity / Math.max(1, sampledArea));
  out.inside = Math.min(1, insideArea / body.area0);
  return out;
}

export type CozyLabel = 'Snug!' | 'Cozy' | 'Comfy' | 'Roomy' | 'Overflowing';

export interface CozyResult {
  score: number;
  label: CozyLabel;
  /** Spill = fraction of cat outside the container. */
  spill: number;
  fill: number;
}

/**
 * Snugness: a full container scores high; a little overflow (ears and a loaf
 * poking out) is perfect; a cat wearing a thimble as a hat scores lower.
 */
export function cozyScore(fill: number, inside: number): CozyResult {
  const spill = 1 - inside;
  const fs = smoothstep(0.3, 0.86, fill);
  const ss = spill <= 0.68 ? 1 : Math.max(0.55, 1 - (spill - 0.68) * 1.6);
  const score = Math.round(100 * (0.2 + 0.8 * fs) * ss);
  let label: CozyLabel;
  if (score >= 92) label = 'Snug!';
  else if (score >= 78) label = 'Cozy';
  else if (score >= 60) label = 'Comfy';
  else label = fill < 0.6 ? 'Roomy' : 'Overflowing';
  return { score, label, spill, fill };
}
