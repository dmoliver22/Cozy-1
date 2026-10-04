// Painted furniture: shelves, counters, stools, tables, fridges, cabinets,
// bookcases, crates, sills and ramps. Furniture lives in the cached back layer.

import type { FurnitureType, Prop } from '../game/props';
import { FLOOR_Y } from '../game/props';
import { PALETTE, hash01, roundRect, shade, softShadow, tint, type Ctx } from './paint';

const WOOD = PALETTE.oak;

function plank(ctx: Ctx, x: number, y: number, w: number, h: number, color: string, seed: number): void {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.fillStyle = tint(color, 0.3);
  ctx.fillRect(x + 3, y + 1.5, w - 6, 2.5);
  ctx.fillStyle = shade(color, 0.12);
  ctx.fillRect(x + 3, y + h - 3, w - 6, 2);
  ctx.strokeStyle = shade(color, 0.12);
  ctx.lineWidth = 1;
  for (let k = 0; k < Math.floor(w / 40); k++) {
    const gx = x + 10 + hash01(seed, k) * (w - 20);
    ctx.beginPath();
    ctx.moveTo(gx, y + 5);
    ctx.quadraticCurveTo(gx + 8, y + h * 0.5, gx + 16, y + h - 4);
    ctx.stroke();
  }
  ctx.strokeStyle = shade(color, 0.32);
  ctx.lineWidth = 1.6;
  roundRect(ctx, x, y, w, h, 4);
  ctx.stroke();
}

export function drawFurniture(ctx: Ctx, p: Prop, theme: { accent: string; cabinet: string }): void {
  const t = p.type as FurnitureType;
  ctx.save();
  const x0 = p.x0;
  const x1 = p.x1;
  const y = p.y;
  const seed = p.uid * 7;
  // floor shadow
  if (t !== 'shelf' && t !== 'sill' && t !== 'ramp') softShadow(ctx, (x0 + x1) / 2, FLOOR_Y + 2, (x1 - x0) * 0.55, 7, 0.22);
  switch (t) {
    case 'shelf': {
      // brackets
      ctx.fillStyle = shade(WOOD, 0.25);
      for (const bx of [x0 + 18, x1 - 18]) {
        if (bx < 4 || bx > 356) continue;
        ctx.beginPath();
        ctx.moveTo(bx - 4, y + 10);
        ctx.lineTo(bx + 4, y + 10);
        ctx.lineTo(bx + 4, y + 30);
        ctx.quadraticCurveTo(bx - 2, y + 18, bx - 4, y + 10);
        ctx.fill();
      }
      softShadow(ctx, (x0 + x1) / 2, y + 22, (x1 - x0) * 0.5, 6, 0.12);
      plank(ctx, x0, y, x1 - x0, 12, WOOD, seed);
      break;
    }
    case 'sill': {
      plank(ctx, x0, y, x1 - x0, 10, '#F6F0E6', seed);
      break;
    }
    case 'counter': {
      const cab = theme.cabinet;
      ctx.fillStyle = cab;
      ctx.fillRect(x0, y + 12, x1 - x0, FLOOR_Y - y - 12);
      // doors
      const doors = Math.max(1, Math.round((x1 - x0) / 62));
      const dw = (x1 - x0 - 8) / doors;
      for (let k = 0; k < doors; k++) {
        const dx = x0 + 4 + k * dw;
        ctx.fillStyle = tint(cab, 0.12);
        roundRect(ctx, dx + 3, y + 30, dw - 6, FLOOR_Y - y - 52, 5);
        ctx.fill();
        ctx.strokeStyle = shade(cab, 0.2);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = shade(cab, 0.45);
        ctx.beginPath();
        ctx.arc(dx + (k % 2 === 0 ? dw - 12 : 12), y + 44, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // drawer strip
      ctx.fillStyle = shade(cab, 0.08);
      ctx.fillRect(x0 + 2, y + 15, x1 - x0 - 4, 11);
      ctx.fillStyle = shade(cab, 0.3);
      ctx.fillRect(x0, FLOOR_Y - 14, x1 - x0, 14);
      ctx.strokeStyle = shade(cab, 0.3);
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x0, y + 12, x1 - x0, FLOOR_Y - y - 12);
      plank(ctx, x0 - 6, y, x1 - x0 + 12, 14, '#E9D5B8', seed);
      break;
    }
    case 'table': {
      ctx.fillStyle = shade(WOOD, 0.1);
      for (const [lx, dir] of [
        [x0 + 14, -1],
        [x1 - 14, 1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(lx - 5, y + 10);
        ctx.lineTo(lx + 5, y + 10);
        ctx.lineTo(lx + 2 + dir * 3, FLOOR_Y);
        ctx.lineTo(lx - 3 + dir * 3, FLOOR_Y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = shade(WOOD, 0.2);
      ctx.fillRect(x0 + 16, y + 10, x1 - x0 - 32, 8);
      plank(ctx, x0, y, x1 - x0, 12, WOOD, seed);
      break;
    }
    case 'stool': {
      const col = theme.accent;
      ctx.strokeStyle = shade(WOOD, 0.15);
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0 + 9, y + 10);
      ctx.lineTo(x0 + 4, FLOOR_Y - 2);
      ctx.moveTo(x1 - 9, y + 10);
      ctx.lineTo(x1 - 4, FLOOR_Y - 2);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x0 + 8, (y + FLOOR_Y) / 2 + 10);
      ctx.lineTo(x1 - 8, (y + FLOOR_Y) / 2 + 10);
      ctx.stroke();
      ctx.fillStyle = col;
      roundRect(ctx, x0, y, x1 - x0, 12, 6);
      ctx.fill();
      ctx.strokeStyle = shade(col, 0.3);
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.fillStyle = tint(col, 0.35);
      ctx.fillRect(x0 + 6, y + 2, x1 - x0 - 12, 2.5);
      break;
    }
    case 'fridge': {
      const col = '#CFE6DD';
      roundRect(ctx, x0, y, x1 - x0, FLOOR_Y - y, [14, 14, 4, 4]);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.strokeStyle = shade(col, 0.3);
      ctx.lineWidth = 1.8;
      ctx.stroke();
      const split = y + (FLOOR_Y - y) * 0.34;
      ctx.beginPath();
      ctx.moveTo(x0 + 2, split);
      ctx.lineTo(x1 - 2, split);
      ctx.stroke();
      ctx.fillStyle = '#E8EEF2';
      ctx.strokeStyle = '#9AA6B2';
      for (const [hy, hh] of [
        [y + 20, (split - y) * 0.55],
        [split + 16, 70],
      ]) {
        roundRect(ctx, x0 + 10, hy, 7, hh, 3.5);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      roundRect(ctx, x1 - 16, y + 12, 6, FLOOR_Y - y - 40, 3);
      ctx.fill();
      // little magnets
      ctx.fillStyle = PALETTE.ginger;
      ctx.beginPath();
      ctx.arc(x0 + (x1 - x0) * 0.6, split + 30, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.teacup;
      ctx.fillRect(x0 + (x1 - x0) * 0.45, split + 46, 14, 18);
      break;
    }
    case 'cabinet': {
      const col = theme.cabinet;
      plank(ctx, x0 - 3, y, x1 - x0 + 6, 10, shade(col, 0.05), seed);
      ctx.fillStyle = col;
      ctx.fillRect(x0, y + 10, x1 - x0, FLOOR_Y - y - 22);
      ctx.strokeStyle = shade(col, 0.3);
      ctx.lineWidth = 1.6;
      ctx.strokeRect(x0, y + 10, x1 - x0, FLOOR_Y - y - 22);
      const rows = Math.max(2, Math.round((FLOOR_Y - y - 22) / 40));
      const rh = (FLOOR_Y - y - 26) / rows;
      for (let k = 0; k < rows; k++) {
        const ry = y + 13 + k * rh;
        ctx.fillStyle = tint(col, 0.1);
        roundRect(ctx, x0 + 5, ry, x1 - x0 - 10, rh - 5, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = shade(col, 0.45);
        roundRect(ctx, (x0 + x1) / 2 - 8, ry + rh / 2 - 4, 16, 4, 2);
        ctx.fill();
      }
      ctx.fillStyle = shade(col, 0.3);
      ctx.fillRect(x0 + 4, FLOOR_Y - 12, 6, 12);
      ctx.fillRect(x1 - 10, FLOOR_Y - 12, 6, 12);
      break;
    }
    case 'bookcase': {
      const col = shade(WOOD, 0.25);
      ctx.fillStyle = col;
      ctx.fillRect(x0, y, x1 - x0, FLOOR_Y - y);
      const shelves = Math.max(2, Math.round((FLOOR_Y - y) / 56));
      const sh = (FLOOR_Y - y - 10) / shelves;
      for (let k = 0; k < shelves; k++) {
        const sy = y + 6 + k * sh;
        ctx.fillStyle = shade(col, 0.35);
        ctx.fillRect(x0 + 6, sy, x1 - x0 - 12, sh - 6);
        let bx = x0 + 8;
        let i = 0;
        while (bx < x1 - 14) {
          const bw = 6 + hash01(seed + k, i) * 7;
          const bh = sh - 12 - hash01(seed + k, i + 50) * 14;
          const cols = [PALETTE.teacup, PALETTE.rose, PALETTE.butter, PALETTE.sage, PALETTE.cream, PALETTE.terracotta, PALETTE.lilac];
          ctx.fillStyle = cols[Math.floor(hash01(seed + k, i + 99) * cols.length)];
          ctx.fillRect(bx, sy + sh - 6 - bh, Math.min(bw, x1 - 8 - bx), bh);
          bx += bw + 1;
          i++;
        }
      }
      plank(ctx, x0 - 3, y - 2, x1 - x0 + 6, 10, WOOD, seed);
      break;
    }
    case 'crate': {
      const col = '#D9B98C';
      ctx.fillStyle = col;
      ctx.fillRect(x0, y, x1 - x0, FLOOR_Y - y);
      ctx.strokeStyle = shade(col, 0.3);
      ctx.lineWidth = 1.6;
      const slats = Math.max(2, Math.round((FLOOR_Y - y) / 18));
      for (let k = 1; k < slats; k++) {
        const sy = y + ((FLOOR_Y - y) * k) / slats;
        ctx.beginPath();
        ctx.moveTo(x0, sy);
        ctx.lineTo(x1, sy);
        ctx.stroke();
      }
      ctx.strokeRect(x0, y, x1 - x0, FLOOR_Y - y);
      ctx.fillStyle = shade(col, 0.15);
      ctx.fillRect(x0 + 4, y, 6, FLOOR_Y - y);
      ctx.fillRect(x1 - 10, y, 6, FLOOR_Y - y);
      plank(ctx, x0 - 2, y - 2, x1 - x0 + 4, 9, tint(col, 0.15), seed);
      break;
    }
    case 'ramp': {
      const r = p.ramp!;
      ctx.lineCap = 'round';
      ctx.strokeStyle = shade(WOOD, 0.35);
      ctx.lineWidth = 13.5;
      ctx.beginPath();
      ctx.moveTo(r.ax, r.ay);
      ctx.lineTo(r.bx, r.by);
      ctx.stroke();
      ctx.strokeStyle = WOOD;
      ctx.lineWidth = 10.5;
      ctx.stroke();
      ctx.strokeStyle = tint(WOOD, 0.35);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(r.ax, r.ay - 3.5);
      ctx.lineTo(r.bx, r.by - 3.5);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

