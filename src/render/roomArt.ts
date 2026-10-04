// Walls, floors, windows full of afternoon sun, and the little decor bits.

import type { DecorPlacement, ThemeId } from '../game/room';
import { FLOOR_Y, WORLD_W } from '../game/props';
import { PALETTE, hash01, roundRect, shade, softShadow, tint, type Ctx } from './paint';

export interface Theme {
  wall: string;
  wallLow: string;
  trim: string;
  floor: string;
  accent: string;
  cabinet: string;
  pattern: 'plain' | 'stripes' | 'dots' | 'tiles' | 'leaves';
}

export const THEMES: Record<ThemeId, Theme> = {
  kitchen: { wall: '#F6EBDC', wallLow: '#F1E2CD', trim: '#FBF6EE', floor: PALETTE.oak, accent: PALETTE.teacup, cabinet: '#BFDCCB', pattern: 'plain' },
  bathroom: { wall: '#EEF3EC', wallLow: PALETTE.mint, trim: '#FFFFFF', floor: '#D9CFC2', accent: PALETTE.rose, cabinet: '#F3E6D6', pattern: 'tiles' },
  living: { wall: '#F4E1CF', wallLow: '#E9CDB4', trim: '#FBF3E8', floor: PALETTE.oak, accent: PALETTE.ginger, cabinet: '#E2C6A6', pattern: 'stripes' },
  laundry: { wall: '#E3ECF2', wallLow: '#CFDDE8', trim: '#FAFCFD', floor: '#CDB89C', accent: PALETTE.butter, cabinet: '#F4EADB', pattern: 'dots' },
  study: { wall: '#EFDCD6', wallLow: '#E2C4BA', trim: '#FAF1EC', floor: '#B8916A', accent: PALETTE.sage, cabinet: '#D7B99B', pattern: 'stripes' },
  sunroom: { wall: '#FBF0D2', wallLow: '#F2E0B0', trim: '#FFFBF0', floor: '#D4B48D', accent: PALETTE.sage, cabinet: '#EAD9B8', pattern: 'leaves' },
  pantry: { wall: '#E6EDDC', wallLow: '#D4E0C4', trim: '#F9FBF4', floor: PALETTE.oak, accent: PALETTE.terracotta, cabinet: '#F0E2C8', pattern: 'plain' },
  bedroom: { wall: '#EAE2F0', wallLow: '#DCD0E8', trim: '#FBF8FD', floor: '#C9A27A', accent: PALETTE.lilac, cabinet: '#E8D9C6', pattern: 'dots' },
  studio: { wall: '#F7EEE2', wallLow: '#EFE0CC', trim: '#FFFFFF', floor: '#D3B38E', accent: PALETTE.ginger, cabinet: '#E8D6BE', pattern: 'plain' },
};

const WAIN_Y = FLOOR_Y - 46;

/** Wall + floor + skirting, painted across the visible world rect. */
export function drawShell(ctx: Ctx, theme: Theme, vx0: number, vy0: number, vx1: number, vy1: number, seed: number): void {
  // wall
  ctx.fillStyle = theme.wall;
  ctx.fillRect(vx0, vy0, vx1 - vx0, FLOOR_Y - vy0);
  // gouache wash strokes
  ctx.save();
  for (let k = 0; k < 26; k++) {
    const x = vx0 + hash01(seed, k) * (vx1 - vx0);
    const y = vy0 + hash01(seed, k + 100) * (FLOOR_Y - vy0);
    const w = 80 + hash01(seed, k + 200) * 140;
    ctx.fillStyle = k % 2 ? tint(theme.wall, 0.35) : shade(theme.wall, 0.035);
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(x, y, w, 18 + hash01(seed, k + 300) * 22, (hash01(seed, k + 400) - 0.5) * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // wall pattern
  ctx.save();
  ctx.beginPath();
  ctx.rect(vx0, vy0, vx1 - vx0, WAIN_Y - vy0);
  ctx.clip();
  switch (theme.pattern) {
    case 'stripes':
      ctx.fillStyle = shade(theme.wall, 0.05);
      for (let x = Math.floor(vx0 / 36) * 36; x < vx1; x += 36) ctx.fillRect(x, vy0, 14, WAIN_Y - vy0);
      break;
    case 'dots':
      ctx.fillStyle = shade(theme.wall, 0.07);
      for (let y = Math.floor(vy0 / 30) * 30; y < WAIN_Y; y += 30)
        for (let x = Math.floor(vx0 / 30) * 30 + ((y / 30) % 2 ? 15 : 0); x < vx1; x += 30) {
          ctx.beginPath();
          ctx.arc(x, y, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      break;
    case 'leaves':
      ctx.strokeStyle = shade(theme.wall, 0.09);
      ctx.lineWidth = 2;
      for (let y = Math.floor(vy0 / 48) * 48; y < WAIN_Y; y += 48)
        for (let x = Math.floor(vx0 / 48) * 48 + ((y / 48) % 2 ? 24 : 0); x < vx1; x += 48) {
          ctx.beginPath();
          ctx.moveTo(x, y + 8);
          ctx.quadraticCurveTo(x - 7, y, x, y - 8);
          ctx.quadraticCurveTo(x + 7, y, x, y + 8);
          ctx.stroke();
        }
      break;
    case 'tiles':
      // upper wall plain; tiles below handled in the wainscot
      break;
    default:
      break;
  }
  ctx.restore();
  // wainscot / tiles
  if (theme.pattern === 'tiles') {
    ctx.fillStyle = theme.wallLow;
    ctx.fillRect(vx0, FLOOR_Y - 190, vx1 - vx0, 190);
    tileGrid(ctx, vx0, FLOOR_Y - 190, vx1, FLOOR_Y, 22, theme.wallLow);
    ctx.fillStyle = theme.trim;
    ctx.fillRect(vx0, FLOOR_Y - 194, vx1 - vx0, 6);
  } else {
    ctx.fillStyle = theme.wallLow;
    ctx.fillRect(vx0, WAIN_Y, vx1 - vx0, FLOOR_Y - WAIN_Y);
    ctx.fillStyle = theme.trim;
    ctx.fillRect(vx0, WAIN_Y - 4, vx1 - vx0, 6);
    ctx.fillStyle = shade(theme.wallLow, 0.1);
    for (let x = Math.floor(vx0 / 40) * 40; x < vx1; x += 40) ctx.fillRect(x, WAIN_Y + 6, 2, FLOOR_Y - WAIN_Y - 6);
  }
  // skirting board
  ctx.fillStyle = theme.trim;
  ctx.fillRect(vx0, FLOOR_Y - 10, vx1 - vx0, 10);
  ctx.fillStyle = shade(theme.trim, 0.12);
  ctx.fillRect(vx0, FLOOR_Y - 2, vx1 - vx0, 2);
  // floor (seen slightly from above, dollhouse style)
  const fy = FLOOR_Y;
  ctx.fillStyle = theme.floor;
  ctx.fillRect(vx0, fy, vx1 - vx0, vy1 - fy);
  ctx.strokeStyle = shade(theme.floor, 0.14);
  ctx.lineWidth = 1.2;
  for (let k = 1; k < 8; k++) {
    const y = fy + k * k * 3.2;
    if (y > vy1) break;
    ctx.beginPath();
    ctx.moveTo(vx0, y);
    ctx.lineTo(vx1, y);
    ctx.stroke();
    // board joints
    for (let j = 0; j < 9; j++) {
      const x = vx0 + ((j + hash01(seed + k, j) * 0.8) * (vx1 - vx0)) / 6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (x - WORLD_W / 2) * 0.05, fy + (k + 1) * (k + 1) * 3.2);
      ctx.stroke();
    }
  }
  const g = ctx.createLinearGradient(0, fy, 0, fy + 30);
  g.addColorStop(0, 'rgba(62,58,79,0.18)');
  g.addColorStop(1, 'rgba(62,58,79,0)');
  ctx.fillStyle = g;
  ctx.fillRect(vx0, fy, vx1 - vx0, 30);
  // top shadow under the ceiling
  const g2 = ctx.createLinearGradient(0, vy0, 0, vy0 + 70);
  g2.addColorStop(0, 'rgba(62,58,79,0.10)');
  g2.addColorStop(1, 'rgba(62,58,79,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(vx0, vy0, vx1 - vx0, 70);
}

function tileGrid(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, size: number, base: string): void {
  ctx.save();
  for (let y = y0; y < y1; y += size) {
    for (let x = Math.floor(x0 / size) * size; x < x1; x += size) {
      ctx.fillStyle = hash01(Math.round(x), Math.round(y)) > 0.85 ? tint(base, 0.25) : base;
      roundRect(ctx, x + 1, y + 1, size - 2, size - 2, 2.5);
      ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5;
  for (let y = y0; y <= y1; y += size) {
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
  ctx.restore();
}

/** Sunbeams from windows, drawn over the back layer. */
export function drawSunbeams(ctx: Ctx, decor: DecorPlacement[]): void {
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  for (const d of decor) {
    if (d.type !== 'window') continue;
    const w = d.w ?? 110;
    const h = d.h ?? 130;
    const x0 = d.x - w / 2;
    const y0 = d.y;
    const drop = FLOOR_Y + 30 - (y0 + h);
    const skew = drop * 0.55;
    const g = ctx.createLinearGradient(0, y0, 0, FLOOR_Y + 30);
    g.addColorStop(0, 'rgba(255,236,190,0.9)');
    g.addColorStop(1, 'rgba(255,236,190,0.15)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 + 6, y0 + h);
    ctx.lineTo(x0 + w - 6, y0 + h);
    ctx.lineTo(x0 + w - 6 + skew, FLOOR_Y + 30);
    ctx.lineTo(x0 + 6 + skew, FLOOR_Y + 30);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawDecor(ctx: Ctx, d: DecorPlacement, theme: Theme, seed: number): void {
  ctx.save();
  switch (d.type) {
    case 'window': {
      const w = d.w ?? 110;
      const h = d.h ?? 130;
      const x = d.x - w / 2;
      const y = d.y;
      // frame
      ctx.fillStyle = theme.trim;
      roundRect(ctx, x - 8, y - 8, w + 16, h + 16, 10);
      ctx.fill();
      ctx.strokeStyle = shade(theme.trim, 0.18);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // sky
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, '#BFDDF2');
      g.addColorStop(0.7, '#F6E7C8');
      g.addColorStop(1, '#F9D9A9');
      ctx.fillStyle = g;
      roundRect(ctx, x, y, w, h, 6);
      ctx.fill();
      // sun + soft clouds + far hills
      ctx.save();
      roundRect(ctx, x, y, w, h, 6);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,240,200,0.95)';
      ctx.beginPath();
      ctx.arc(x + w * 0.72, y + h * 0.55, w * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let k = 0; k < 3; k++) {
        const cx = x + w * (0.15 + hash01(seed, k) * 0.6);
        const cy = y + h * (0.15 + hash01(seed, k + 9) * 0.25);
        ctx.beginPath();
        ctx.ellipse(cx, cy, 16, 6, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 10, cy - 3, 10, 6, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#A9C3A0';
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.quadraticCurveTo(x + w * 0.3, y + h * 0.72, x + w * 0.6, y + h * 0.86);
      ctx.quadraticCurveTo(x + w * 0.85, y + h * 0.76, x + w, y + h * 0.84);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // mullions
      ctx.fillStyle = theme.trim;
      ctx.fillRect(x + w / 2 - 3, y, 6, h);
      ctx.fillRect(x, y + h / 2 - 3, w, 6);
      // curtains
      if ((d.variant ?? 0) % 2 === 0) {
        ctx.fillStyle = theme.accent;
        ctx.globalAlpha = 0.85;
        for (const s of [-1, 1]) {
          const cx = s < 0 ? x - 12 : x + w + 12;
          ctx.beginPath();
          ctx.moveTo(cx - s * 2, y - 14);
          ctx.lineTo(cx + s * 22, y - 14);
          ctx.quadraticCurveTo(cx + s * 4, y + h * 0.45, cx + s * 16, y + h + 14);
          ctx.lineTo(cx - s * 6, y + h + 14);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = shade(theme.trim, 0.3);
        ctx.fillRect(x - 24, y - 17, w + 48, 4);
      }
      break;
    }
    case 'plant': {
      const x = d.x;
      const y = d.y;
      const s = (d.w ?? 40) / 40;
      softShadow(ctx, x, y, 16 * s, 3, 0.2);
      // leaves
      const leaves = 7;
      for (let k = 0; k < leaves; k++) {
        const a = -Math.PI / 2 + (k - (leaves - 1) / 2) * 0.32 + (hash01(seed, k) - 0.5) * 0.2;
        const L = (28 + hash01(seed, k + 5) * 20) * s;
        const ex = x + Math.cos(a) * L;
        const ey = y - 22 * s + Math.sin(a) * L;
        ctx.fillStyle = k % 2 ? '#86AE84' : '#9BC197';
        ctx.beginPath();
        ctx.moveTo(x, y - 20 * s);
        ctx.quadraticCurveTo(x + Math.cos(a - 0.5) * L * 0.6, y - 20 * s + Math.sin(a - 0.5) * L * 0.6, ex, ey);
        ctx.quadraticCurveTo(x + Math.cos(a + 0.5) * L * 0.6, y - 20 * s + Math.sin(a + 0.5) * L * 0.6, x, y - 20 * s);
        ctx.fill();
      }
      ctx.fillStyle = PALETTE.terracotta;
      ctx.beginPath();
      ctx.moveTo(x - 15 * s, y - 24 * s);
      ctx.lineTo(x + 15 * s, y - 24 * s);
      ctx.lineTo(x + 11 * s, y);
      ctx.lineTo(x - 11 * s, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = tint(PALETTE.terracotta, 0.2);
      ctx.fillRect(x - 16 * s, y - 26 * s, 32 * s, 6 * s);
      break;
    }
    case 'picture': {
      const w = d.w ?? 50;
      const h = d.h ?? 40;
      const x = d.x - w / 2;
      const y = d.y;
      ctx.strokeStyle = shade(theme.wall, 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(d.x, y - 14);
      ctx.lineTo(x + 6, y);
      ctx.moveTo(d.x, y - 14);
      ctx.lineTo(x + w - 6, y);
      ctx.stroke();
      ctx.fillStyle = shade(PALETTE.oak, 0.2);
      roundRect(ctx, x - 4, y - 4, w + 8, h + 8, 3);
      ctx.fill();
      ctx.fillStyle = '#FBF6EC';
      ctx.fillRect(x, y, w, h);
      const v = (d.variant ?? 0) % 3;
      if (v === 0) {
        // a little cat-loaf portrait
        ctx.fillStyle = PALETTE.ginger;
        ctx.beginPath();
        ctx.ellipse(d.x, y + h * 0.7, w * 0.28, h * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(d.x - w * 0.2, y + h * 0.55);
        ctx.lineTo(d.x - w * 0.14, y + h * 0.36);
        ctx.lineTo(d.x - w * 0.06, y + h * 0.52);
        ctx.moveTo(d.x + w * 0.2, y + h * 0.55);
        ctx.lineTo(d.x + w * 0.14, y + h * 0.36);
        ctx.lineTo(d.x + w * 0.06, y + h * 0.52);
        ctx.fill();
      } else if (v === 1) {
        ctx.fillStyle = PALETTE.sky;
        ctx.fillRect(x, y, w, h * 0.6);
        ctx.fillStyle = PALETTE.sage;
        ctx.beginPath();
        ctx.moveTo(x, y + h);
        ctx.lineTo(x + w * 0.4, y + h * 0.35);
        ctx.lineTo(x + w, y + h);
        ctx.fill();
      } else {
        ctx.fillStyle = PALETTE.rose;
        ctx.beginPath();
        ctx.arc(d.x, y + h / 2, Math.min(w, h) * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.butter;
        ctx.beginPath();
        ctx.arc(d.x, y + h / 2, Math.min(w, h) * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'clock': {
      const r = d.w ?? 18;
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(d.x, d.y, r + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFBF3';
      ctx.beginPath();
      ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = PALETTE.ink;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + r * 0.45, d.y + r * 0.2);
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - r * 0.1, d.y - r * 0.7);
      ctx.stroke();
      break;
    }
    case 'pendant': {
      const y1 = d.y;
      ctx.strokeStyle = shade(theme.wall, 0.4);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(d.x, -20);
      ctx.lineTo(d.x, y1 - 18);
      ctx.stroke();
      const glow = ctx.createRadialGradient(d.x, y1, 0, d.x, y1, 70);
      glow.addColorStop(0, 'rgba(255,226,160,0.45)');
      glow.addColorStop(1, 'rgba(255,226,160,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(d.x, y1, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.moveTo(d.x - 6, y1 - 18);
      ctx.lineTo(d.x + 6, y1 - 18);
      ctx.lineTo(d.x + 22, y1);
      ctx.lineTo(d.x - 22, y1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFF3C9';
      ctx.beginPath();
      ctx.ellipse(d.x, y1 + 1, 9, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'rug': {
      const w = d.w ?? 160;
      ctx.fillStyle = theme.accent;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.ellipse(d.x, d.y + 12, w / 2, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = tint(theme.accent, 0.5);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.ellipse(d.x, d.y + 12, w / 2 - 7, 6.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'backsplash': {
      const w = d.w ?? 120;
      const h = d.h ?? 80;
      tileGrid(ctx, d.x, d.y, d.x + w, d.y + h, 18, PALETTE.mint);
      ctx.strokeStyle = shade(PALETTE.mint, 0.15);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(d.x, d.y, w, h);
      break;
    }
    case 'books': {
      let x = d.x;
      const cols = [PALETTE.teacup, PALETTE.rose, PALETTE.butter, PALETTE.sage, PALETTE.lilac];
      for (let k = 0; k < (d.w ?? 5); k++) {
        const bw = 7 + hash01(seed, k) * 5;
        const bh = 22 + hash01(seed, k + 3) * 12;
        ctx.fillStyle = cols[k % cols.length];
        ctx.fillRect(x, d.y - bh, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(x + 1.5, d.y - bh + 4, bw - 3, 2);
        x += bw + 1;
      }
      break;
    }
    case 'jars': {
      for (let k = 0; k < (d.w ?? 3); k++) {
        const x = d.x + k * 18;
        const h = 18 + hash01(seed, k) * 10;
        ctx.fillStyle = 'rgba(207,227,242,0.8)';
        roundRect(ctx, x - 7, d.y - h, 14, h, 4);
        ctx.fill();
        ctx.fillStyle = [PALETTE.butter, PALETTE.terracotta, PALETTE.sage][k % 3];
        roundRect(ctx, x - 6, d.y - h * 0.6, 12, h * 0.6 - 1, 3);
        ctx.fill();
        ctx.fillStyle = PALETTE.rose;
        ctx.fillRect(x - 8, d.y - h - 3, 16, 4);
      }
      break;
    }
    case 'towel': {
      ctx.fillStyle = shade(PALETTE.oak, 0.2);
      ctx.fillRect(d.x - 30, d.y - 3, 60, 4);
      ctx.fillStyle = theme.accent;
      roundRect(ctx, d.x - 22, d.y, 44, 52, 4);
      ctx.fill();
      ctx.fillStyle = tint(theme.accent, 0.5);
      ctx.fillRect(d.x - 22, d.y + 38, 44, 5);
      break;
    }
    case 'mirror': {
      const w = d.w ?? 70;
      const h = d.h ?? 90;
      ctx.fillStyle = PALETTE.gold;
      roundRect(ctx, d.x - w / 2 - 5, d.y - 5, w + 10, h + 10, w / 2 + 5);
      ctx.fill();
      const g = ctx.createLinearGradient(d.x - w / 2, d.y, d.x + w / 2, d.y + h);
      g.addColorStop(0, '#E4EFF6');
      g.addColorStop(1, '#C7DAE6');
      ctx.fillStyle = g;
      roundRect(ctx, d.x - w / 2, d.y, w, h, w / 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(d.x - w * 0.2, d.y + h * 0.25);
      ctx.lineTo(d.x - w * 0.05, d.y + h * 0.12);
      ctx.stroke();
      break;
    }
    case 'garland': {
      const w = d.w ?? 200;
      const cols = [PALETTE.rose, PALETTE.butter, PALETTE.teacup, PALETTE.sage];
      ctx.strokeStyle = shade(theme.wall, 0.35);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(d.x - w / 2, d.y);
      ctx.quadraticCurveTo(d.x, d.y + 26, d.x + w / 2, d.y);
      ctx.stroke();
      const n = Math.floor(w / 26);
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const x = d.x - w / 2 + w * t;
        const y = d.y + 52 * t * (1 - t);
        ctx.fillStyle = cols[k % cols.length];
        ctx.beginPath();
        ctx.moveTo(x - 7, y);
        ctx.lineTo(x + 7, y);
        ctx.lineTo(x, y + 13);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'radiator': {
      const w = d.w ?? 80;
      ctx.fillStyle = '#F2EFEA';
      for (let x = d.x - w / 2; x < d.x + w / 2; x += 11) {
        roundRect(ctx, x, d.y - 54, 9, 50, 4);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(62,58,79,0.1)';
      ctx.fillRect(d.x - w / 2, d.y - 16, w, 3);
      break;
    }
    case 'teapot': {
      const x = d.x;
      const y = d.y;
      ctx.fillStyle = PALETTE.teacup;
      ctx.beginPath();
      ctx.ellipse(x, y - 13, 16, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = PALETTE.teacup;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x + 14, y - 14);
      ctx.quadraticCurveTo(x + 26, y - 16, x + 26, y - 26);
      ctx.moveTo(x - 14, y - 18);
      ctx.quadraticCurveTo(x - 26, y - 14, x - 14, y - 6);
      ctx.stroke();
      ctx.fillStyle = tint(PALETTE.teacup, 0.4);
      ctx.beginPath();
      ctx.arc(x, y - 27, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'fruit': {
      const cols = [PALETTE.ginger, PALETTE.rose, PALETTE.butter];
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = cols[k];
        ctx.beginPath();
        ctx.arc(d.x + (k - 1) * 11, d.y - 6 - (k === 1 ? 6 : 0), 6.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'yarn': {
      ctx.fillStyle = PALETTE.rose;
      ctx.beginPath();
      ctx.arc(d.x, d.y - 9, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shade(PALETTE.rose, 0.2);
      ctx.lineWidth = 1.2;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(d.x, d.y - 9, 9, -0.6 + k, 1.2 + k);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(d.x + 7, d.y - 4);
      ctx.quadraticCurveTo(d.x + 18, d.y + 2, d.x + 28, d.y - 1);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}
