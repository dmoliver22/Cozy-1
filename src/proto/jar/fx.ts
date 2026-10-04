// Little painted effects in world space: hearts, sparkles, a soft ring when
// two cats melt together, "+N" labels, puffs where a cat lands, and the
// starburst when two voids vanish. Visual only (driven by draw time).

import { PALETTE, lightOf, pill, rgba, shadowOf, type Ctx } from '../../render/paint';
import { sparkle } from '../../render/propKit';

type Kind = 'heart' | 'spark' | 'ring' | 'label' | 'puff' | 'ray' | 'note' | 'star';

interface Fx {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  size: number;
  color: string;
  text?: string;
  /** Delay before it shows. */
  wait: number;
  rot: number;
}

const TAU = Math.PI * 2;

export class Effects {
  private list: Fx[] = [];

  clear(): void {
    this.list = [];
  }

  get count(): number {
    return this.list.length;
  }

  add(kind: Kind, x: number, y: number, o: Partial<Fx> = {}): void {
    if (this.list.length > 220) this.list.shift();
    this.list.push({
      kind,
      x,
      y,
      vx: o.vx ?? 0,
      vy: o.vy ?? -20,
      t: 0,
      life: o.life ?? 1.2,
      size: o.size ?? 8,
      color: o.color ?? PALETTE.rose,
      text: o.text,
      wait: o.wait ?? 0,
      rot: o.rot ?? 0,
    });
  }

  hearts(x: number, y: number, n: number, color: string = PALETTE.rose, spread = 14): void {
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0 : k / (n - 1) - 0.5;
      this.add('heart', x + u * spread * 2, y - Math.abs(u) * 6, { vx: u * 46, vy: -42 - (k % 2) * 14, life: 1.25 + (k % 3) * 0.15, size: 6.5 + (k % 2) * 2.2, color, wait: k * 0.03 });
    }
  }

  sparkles(x: number, y: number, n: number, r: number): void {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + 0.4;
      const sp = 50 + (k % 3) * 22;
      this.add('spark', x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, life: 0.55 + (k % 2) * 0.2, size: 3.2 + (k % 3) * 1.2 });
    }
  }

  ring(x: number, y: number, r: number, color = '#FFF6E2'): void {
    this.add('ring', x, y, { vx: 0, vy: 0, life: 0.42, size: r, color });
  }

  label(x: number, y: number, text: string, color: string, size = 14): void {
    // stack above fresh labels nearby, so a chain reaction stays readable
    for (let k = 0; k < 6; k++) {
      const hit = this.list.some((e) => e.kind === 'label' && e.t < 0.9 && Math.abs(e.x - x) < 46 && Math.abs(e.y - y) < size + 5);
      if (!hit) break;
      y -= size + 7;
    }
    this.add('label', x, y, { vy: -22, life: 1.5, text, color, size });
  }

  puff(x: number, y: number, n: number, w: number): void {
    for (let k = 0; k < n; k++) {
      const s = n === 1 ? 0 : (k / (n - 1)) * 2 - 1;
      this.add('puff', x + s * w * 0.5, y, { vx: s * 40, vy: -10 - Math.abs(s) * 8, life: 0.45, size: 3.5 + (k % 2) * 1.5 });
    }
  }

  note(x: number, y: number, text: string): void {
    this.add('note', x, y, { vy: -32, vx: 6, life: 0.9, size: 15, color: PALETTE.ink, text });
  }

  /** Two voids vanish: rays, a big ring, stars and a shower of hearts. */
  starburst(x: number, y: number): void {
    for (let k = 0; k < 14; k++) this.add('ray', x, y, { vx: 0, vy: 0, life: 0.9, size: 150 + (k % 3) * 40, rot: (k / 14) * TAU, color: '#FFE7A8' });
    this.ring(x, y, 120, '#FFE7A8');
    this.ring(x, y, 70, '#FFFFFF');
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * TAU;
      const sp = 120 + (k % 4) * 40;
      this.add('star', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 1.3, size: 5 + (k % 3) * 2, color: k % 2 ? PALETTE.gold : '#FFF3CF', rot: a });
    }
    this.hearts(x, y - 20, 7, PALETTE.rose, 40);
    this.sparkles(x, y, 12, 60);
  }

  draw(ctx: Ctx, dt: number): void {
    const keep: Fx[] = [];
    for (const e of this.list) {
      if (e.wait > 0) {
        e.wait -= dt;
        keep.push(e);
        continue;
      }
      e.t += dt;
      if (e.t >= e.life) continue;
      keep.push(e);
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      const k = e.t / e.life;
      ctx.save();
      switch (e.kind) {
        case 'heart': {
          e.vy += 30 * dt;
          ctx.globalAlpha = fade(k, 0.12);
          heart(ctx, e.x, e.y, e.size * (0.85 + 0.25 * Math.sin(e.t * 7)), e.color);
          break;
        }
        case 'spark': {
          e.vx *= 1 - 3 * dt;
          e.vy *= 1 - 3 * dt;
          ctx.globalAlpha = fade(k, 0.1);
          sparkle(ctx, e.x, e.y, e.size * (1 - k * 0.4), 0.95);
          break;
        }
        case 'star': {
          e.vy += 260 * dt;
          e.vx *= 1 - 1.2 * dt;
          ctx.globalAlpha = fade(k, 0.05);
          star(ctx, e.x, e.y, e.size, e.rot + e.t * 3, e.color);
          break;
        }
        case 'ring': {
          // a soft bloom of warm light that opens out and fades
          const r = e.size * (0.5 + 0.7 * easeOut(k));
          const g = ctx.createRadialGradient(e.x, e.y, r * 0.55, e.x, e.y, r);
          g.addColorStop(0, rgba(e.color, 0));
          g.addColorStop(0.72, rgba(e.color, 0.55 * (1 - k)));
          g.addColorStop(1, rgba(e.color, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(e.x, e.y, r, 0, TAU);
          ctx.fill();
          break;
        }
        case 'ray': {
          const a = fade(k, 0.08) * 0.45;
          const len = e.size * (0.4 + 0.6 * easeOut(k));
          const g = ctx.createLinearGradient(e.x, e.y, e.x + Math.cos(e.rot) * len, e.y + Math.sin(e.rot) * len);
          g.addColorStop(0, rgba(e.color, a));
          g.addColorStop(1, rgba(e.color, 0));
          ctx.fillStyle = g;
          const w = 0.12;
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.lineTo(e.x + Math.cos(e.rot - w) * len, e.y + Math.sin(e.rot - w) * len);
          ctx.lineTo(e.x + Math.cos(e.rot + w) * len, e.y + Math.sin(e.rot + w) * len);
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'label': {
          const pop = k < 0.1 ? 0.5 + (k / 0.1) * 0.65 : k < 0.18 ? 1.15 - ((k - 0.1) / 0.08) * 0.15 : 1;
          ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
          ctx.translate(e.x, e.y);
          ctx.scale(pop, pop);
          pill(ctx, e.text ?? '', 0, 0, { font: `800 ${e.size}px "Baloo 2", system-ui`, fg: '#FFFDF8', bg: e.color, pad: 8 });
          break;
        }
        case 'puff': {
          const pr = e.size * (1 + k * 1.6);
          ctx.globalAlpha = (1 - k) * 0.85;
          const pg = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, pr);
          pg.addColorStop(0, 'rgba(255,253,247,0.9)');
          pg.addColorStop(0.6, 'rgba(255,253,247,0.5)');
          pg.addColorStop(1, 'rgba(255,253,247,0)');
          ctx.fillStyle = pg;
          ctx.beginPath();
          ctx.arc(e.x, e.y, pr, 0, TAU);
          ctx.fill();
          break;
        }
        case 'note': {
          ctx.globalAlpha = fade(k, 0.15);
          ctx.fillStyle = e.color;
          ctx.font = `800 ${e.size}px "Baloo 2", system-ui`;
          ctx.textAlign = 'center';
          ctx.fillText(e.text ?? '?', e.x + Math.sin(e.t * 4) * 3, e.y);
          break;
        }
      }
      ctx.restore();
    }
    this.list = keep;
  }
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const fade = (k: number, inn: number): number => (k < inn ? k / inn : 1 - (k - inn) / (1 - inn));

function heart(ctx: Ctx, x: number, y: number, s: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
  const g = ctx.createLinearGradient(x - s, y - s, x + s, y + s);
  g.addColorStop(0, lightOf(color, 0.4));
  g.addColorStop(1, shadowOf(color, 0.3));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = rgba(shadowOf(color, 0.6), 0.5);
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.ellipse(x - s * 0.45, y - s * 0.38, s * 0.22, s * 0.14, -0.6, 0, TAU);
  ctx.fill();
}

function star(ctx: Ctx, x: number, y: number, r: number, rot: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const rr = k % 2 ? r * 0.45 : r;
    const a = (k / 10) * TAU - Math.PI / 2;
    if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = rgba(shadowOf(color.startsWith('#') ? color : '#F2C14E', 0.5), 0.6);
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.restore();
}
