import type { Page } from '@playwright/test';

/**
 * Open the app on a house saved like this (null: nothing saved, a first
 * visit; past the first-time tour unless `tour`, when it opens on that, and
 * with the tips seen unless `tips`). It's in place before the app starts: saved once the page is up and
 * then reloaded, the app's own first save (a new house's welcome comes 600ms
 * in) could land on top of it, and the house be someone else's.
 */
export async function openHouse(page: Page, save: Record<string, unknown> | null, more: Record<string, unknown> = {}, opts: { tour?: boolean; tips?: boolean } = {}): Promise<void> {
  // (and anything else saved: the Playground, say)
  const all: Record<string, string> = Object.fromEntries(Object.entries(more).map(([k, v]) => [k, JSON.stringify(v)]));
  if (save) all['cozy-house:v1'] = JSON.stringify(save);
  // (the first-time tour's been seen, unless it's what's being tried)
  if (!opts.tour) all['cozy-tour:v1'] = 'done';
  // (and the one-line tips, unless they're what's being tried)
  if (!opts.tips) all['cozy-tips:v1'] = 'all';
  if (Object.keys(all).length) {
    await page.addInitScript((kv) => {
      // (once: a reload keeps whatever the test has done since)
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    }, all);
  }
  await page.goto('/');
  const kind = opts.tour ? 'playground' : 'home';
  await page.waitForFunction((k) => (window as unknown as { __app?: { kind: string } }).__app?.kind === k, kind);
}
