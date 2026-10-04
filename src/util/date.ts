// The daily room flips at local midnight ("a new room every morning").

const EPOCH = Date.UTC(2026, 9, 1); // Room #1 = 1 Oct 2026

export function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDateKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

/** Room number shown in the share card (#1 on launch day). */
export function roomNumber(key: string): number {
  const { y, m, d } = parseDateKey(key);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86_400_000) + 1;
}

export function previousDateKey(key: string): string {
  const { y, m, d } = parseDateKey(key);
  const t = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

export function nextDateKey(key: string): string {
  const { y, m, d } = parseDateKey(key);
  const t = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** 0 = Sunday ... 6 = Saturday, computed from the key (timezone-proof). */
export function weekdayOf(key: string): number {
  const { y, m, d } = parseDateKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function prettyDate(key: string): string {
  const { y, m, d } = parseDateKey(key);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  void y;
  return `${months[m - 1]} ${d}`;
}

/** Milliseconds until the next local midnight. */
export function msUntilTomorrow(now = new Date()): number {
  const t = new Date(now);
  t.setHours(24, 0, 0, 0);
  return t.getTime() - now.getTime();
}
