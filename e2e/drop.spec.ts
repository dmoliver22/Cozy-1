import { expect, test, type Page } from '@playwright/test';

// Cat Drop (drop.html): driven through its test handle, window.__drop, with
// the real-time loop paused so every run is deterministic.

interface DropState {
  phase: string;
  depth: number;
  fish: number;
  score: number;
  radius: number;
  bathGap: number;
  over: boolean;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/drop.html');
  await page.waitForFunction(() => (window as unknown as { __drop?: unknown }).__drop);
}

const state = (page: Page): Promise<DropState> => page.evaluate(() => (window as unknown as { __drop: { state: DropState } }).__drop.state);

test('Cat Drop boots to its start card and the cat falls once it plays', async ({ page }) => {
  await boot(page);
  // (cards fade in and out: an opacity-0 card still counts as "visible", so check its state)
  await expect(page.locator('#dStart')).toHaveClass(/show/);
  await expect(page.getByRole('heading', { name: 'Cat Drop' })).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('#dStart')).not.toHaveClass(/show/);
  const before = await state(page);
  expect(before.phase).toBe('play');
  const after = await page.evaluate(() => {
    const d = (window as unknown as { __drop: { pause(on: boolean): void; step(n: number): DropState } }).__drop;
    d.pause(true);
    return d.step(240);
  });
  expect(after.depth).toBeGreaterThan(before.depth + 5);
  expect(after.over).toBe(false);
});

test('eating a fish makes the cat chonkier and scores', async ({ page }) => {
  await boot(page);
  const res = await page.evaluate(() => {
    const d = (window as unknown as { __drop: { pause(on: boolean): void; restart(seed?: number): DropState; feed(): void; step(n: number): DropState; state: DropState } }).__drop;
    d.pause(true);
    const s0 = d.restart(1234);
    d.feed();
    for (let i = 0; i < 120 && d.state.fish === s0.fish; i++) d.step(1);
    return { s0, s1: d.state };
  });
  expect(res.s1.fish).toBe(res.s0.fish + 1);
  expect(res.s1.radius).toBeGreaterThan(res.s0.radius);
  expect(res.s1.score).toBeGreaterThan(res.s0.score);
});

test('bath time catches the cat, soaks it, and the run ends', async ({ page }) => {
  await boot(page);
  const end = await page.evaluate(() => {
    const d = (window as unknown as { __drop: { pause(on: boolean): void; restart(seed?: number): DropState; bathTo(gap: number): void; step(n: number): DropState; state: DropState } }).__drop;
    d.pause(true);
    d.restart(99);
    const phases = new Set<string>();
    for (let i = 0; i < 600 && !d.state.over; i++) {
      if (d.state.phase === 'play') d.bathTo(30);
      d.step(1);
      phases.add(d.state.phase);
    }
    return { ...d.state, soaked: phases.has('soak') };
  });
  expect(end.soaked).toBe(true);
  expect(end.over).toBe(true);
  await expect(page.locator('#dOver')).toHaveClass(/show/, { timeout: 5000 });
  await expect(page.getByRole('heading', { name: 'Bath time!' })).toBeVisible();
  await page.getByRole('button', { name: 'Again' }).click();
  await expect(page.locator('#dOver')).not.toHaveClass(/show/);
  const again = await state(page);
  expect(again.phase).toBe('play');
  expect(again.depth).toBe(0);
});
