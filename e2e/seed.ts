import type { Page } from '@playwright/test';

/**
 * Open the app on a house saved like this (null: nothing saved, a first
 * visit). It's in place before the app starts: saved once the page is up and
 * then reloaded, the app's own first save (a new house's welcome comes 600ms
 * in) could land on top of it, and the house be someone else's.
 */
export async function openHouse(page: Page, save: Record<string, unknown> | null): Promise<void> {
  if (save) {
    await page.addInitScript((s) => {
      // (once: a reload keeps whatever the test has done since)
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', '1');
      localStorage.setItem('cozy-house:v1', s);
    }, JSON.stringify(save));
  }
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __app?: { kind: string } }).__app?.kind === 'home');
}
