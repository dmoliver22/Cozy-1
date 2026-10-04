// Spoiler-free share card: cat faces only, no layout, no answers.

import type { RoomResult } from './session';

export function shareText(opts: { result: RoomResult; roomName: string; number?: number; url?: string; streak?: number }): string {
  const { result, roomName, number, url, streak } = opts;
  const head = number ? `If It Fits #${number} · ${roomName}` : `If It Fits · ${roomName}`;
  const paws = result.par ? `🐾 ${result.paws}/${result.par}` : `🐾 ${result.paws}`;
  const lines = [head, result.faces, `${paws} · cozy ${result.cozy}`];
  if (streak && streak > 1) lines.push(`☀️ ${streak} mornings in a row`);
  if (url) lines.push(url);
  return lines.join('\n');
}

/** Share via the system sheet when available, otherwise copy to clipboard. */
export async function shareOrCopy(text: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      await navigator.share({ text });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return 'failed';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    // Older browsers: hidden textarea fallback
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok ? 'copied' : 'failed';
    } catch {
      return 'failed';
    }
  }
}
