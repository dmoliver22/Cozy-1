// Cat Drop: little painted effects in world space: puffs of fluff on a
// landing, sparkles and a "+12" when a fish is eaten, droplets when a cat
// plops out of a tube, hearts, and dust bunnies sucked up by the vacuum.

import { lightOf, pill, rgba, shadowOf, type Ctx } from '../../render/paint';
import { sparkle } from '../../render/propKit';

type Kind = 'puff' | 'spark' | 'heart' | 'label' | 'drop' | 'fluff' | 'ring';

interface P {
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
  spin: number;
  /** Follows this point (a label riding along with the falling cat). */
  anchor?: () => { x: number; y: number };
}

export class Fx {
  private list: P[] = [];

  clear(): void {
    this.list.length = 0;
  }

  private add(kind: Kind, x: number, y: number, o: Partial<P> = {}): void {
    if (this.list.length > 220) this.list.shift();
    this.list.push({ kind, x, y, vx: o.vx ?? 0, vy: o.vy ?? 0, t: 0, life: o.life ?? 0.8, size: o.size ?? 6, color: o.color ?? '#FFFFFF', text: o.text, spin: o.spin ?? 0 });
  }

  /** Soft puffs fanning out from a landing. */
  puff(x: number, y: number, n = 6, color = 'rgba(255,253,247,0.9)'): void {
    for (let k = 0; k < n; k++) {
      const a = Math.PI + (k / (n - 1)) * Math.PI;
      this.add('puff', x, y, { vx: Math.cos(a) * (50 + (k % 3) * 14), vy: Math.sin(a) * 22 - 10, life: 0.5 + (k % 2) * 0.12, size: 4 + (k % 3) * 1.6, color });
    }
  }

  sparks(x: number, y: number, n = 7, color = '#FFF4C8'): void {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 60 + Math.random() * 70;
      this.add('spark', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, life: 0.5 + Math.random() * 0.3, size: 3 + Math.random() * 3, color });
    }
  }

  label(x: number, y: number, text: string, color: string): void {
    this.add('label', x, y, { vy: -34, life: 1.1, text, color });
  }

  /** A label that rides along above a moving point (the cat's head), rising off it. */
  labelOn(anchor: () => { x: number; y: number }, text: string, color: string, lift = 30): void {
    const a = anchor();
    this.add('label', a.x, a.y - lift, { life: 1.1, text, color, size: lift });
    this.list[this.list.length - 1].anchor = anchor;
  }

  hearts(x: number, y: number, n = 2, color = '#E9A6A0'): void {
    for (let k = 0; k < n; k++) this.add('heart', x + (k - (n - 1) / 2) * 12, y, { vx: (k - (n - 1) / 2) * 14, vy: -46 - k * 8, life: 1.1, size: 5.5 + (k % 2), color });
  }

  ring(x: number, y: number, color: string, size = 30): void {
    this.add('ring', x, y, { life: 0.45, size, color });
  }

  /** Droplets flicked off a cat that plops out of a tube. */
  drops(x: number, y: number, n: number, color: string): void {
    for (let k = 0; k < n; k++) {
      const a = Math.PI / 2 + (k / (n - 1) - 0.5) * 2.2;
      const sp = 80 + (k % 3) * 30;
      this.add('drop', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 60, life: 0.6, size: 2.2 + (k % 2), color });
    }
  }

  /** A dust bunny drawn up toward the vacuum's mouth. */
  fluff(x: number, y: number): void {
    this.add('fluff', x, y, { vx: (Math.random() - 0.5) * 30, vy: -60 - Math.random() * 60, life: 1.6, size: 2.5 + Math.random() * 3, color: '#CFC3B6', spin: Math.random() * 6 });
  }

  update(dt: number, vacY: number | null): void {
    const keep: P[] = [];
    for (const p of this.list) {
      p.t += dt;
      if (p.t >= p.life) continue;
      if (p.anchor) {
        const a = p.anchor();
        p.x = a.x;
        p.y = a.y - p.size - p.t * 36;
        keep.push(p);
        continue;
      }
      if (p.kind === 'fluff' && vacY !== null) {
        // pulled up harder the closer it gets
        const d = Math.max(10, p.y - vacY);
        p.vy -= (90000 / (d + 60)) * dt;
        p.vx += (190 - p.x) * 0.6 * dt;
        if (p.y < vacY + 2) continue;
      } else if (p.kind === 'drop') p.vy += 900 * dt;
      else if (p.kind === 'spark') {
        p.vx *= 1 - 3 * dt;
        p.vy *= 1 - 3 * dt;
      } else if (p.kind === 'puff') {
        p.vx *= 1 - 4 * dt;
        p.vy *= 1 - 4 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      keep.push(p);
    }
    this.list = keep;
  }

  draw(ctx: Ctx): void {
    for (const p of this.list) {
      const k = p.t / p.life;
      const a = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      switch (p.kind) {
        case 'puff': {
          const r = p.size * (1 + k * 1.6);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          g.addColorStop(0, 'rgba(255,253,247,0.9)');
          g.addColorStop(0.6, 'rgba(255,253,247,0.5)');
          g.addColorStop(1, 'rgba(255,253,247,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'spark':
          sparkle(ctx, p.x, p.y, p.size * (1 - k * 0.5), 0.95);
          break;
        case 'heart': {
          const s = p.size * (0.85 + 0.25 * Math.sin(p.t * 7));
          ctx.beginPath();
          ctx.moveTo(p.x, p.y + s * 0.9);
          ctx.bezierCurveTo(p.x - s * 1.4, p.y - s * 0.1, p.x - s * 0.6, p.y - s * 1.1, p.x, p.y - s * 0.35);
          ctx.bezierCurveTo(p.x + s * 0.6, p.y - s * 1.1, p.x + s * 1.4, p.y - s * 0.1, p.x, p.y + s * 0.9);
          const hg = ctx.createLinearGradient(p.x - s, p.y - s, p.x + s, p.y + s);
          hg.addColorStop(0, lightOf(p.color, 0.4));
          hg.addColorStop(1, shadowOf(p.color, 0.3));
          ctx.fillStyle = hg;
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.beginPath();
          ctx.ellipse(p.x - s * 0.45, p.y - s * 0.38, s * 0.22, s * 0.14, -0.6, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'label': {
          const pop = k < 0.1 ? 0.6 + (k / 0.1) * 0.55 : k < 0.18 ? 1.15 - ((k - 0.1) / 0.08) * 0.15 : 1;
          ctx.translate(p.x, p.y);
          ctx.scale(pop, pop);
          pill(ctx, p.text ?? '', 0, 0, { font: '800 14px "Baloo 2", system-ui, sans-serif', fg: '#FFFDF8', bg: p.color, pad: 8 });
          break;
        }
        case 'ring': {
          ctx.strokeStyle = rgba(p.color, 0.8 * (1 - k));
          ctx.lineWidth = 3 * (1 - k) + 0.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.4 + k * 0.9), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'drop': {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.size * 0.8, p.size * 1.15, Math.atan2(p.vy, p.vx) + Math.PI / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.beginPath();
          ctx.arc(p.x - p.size * 0.25, p.y - p.size * 0.3, p.size * 0.3, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'fluff': {
          ctx.translate(p.x, p.y);
          ctx.rotate(p.spin + p.t * 5);
          ctx.fillStyle = p.color;
          for (let i = 0; i < 5; i++) {
            const an = (i / 5) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(Math.cos(an) * p.size * 0.6, Math.sin(an) * p.size * 0.6, p.size * 0.55, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.beginPath();
          ctx.arc(-p.size * 0.3, -p.size * 0.3, p.size * 0.35, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
      ctx.restore();
    }
  }
}
