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

test('bath time catches the cat, its foam fills the screen, and the run ends in the bath', async ({ page }) => {
  await boot(page);
  const end = await page.evaluate(() => {
    const d = (
      window as unknown as {
        __drop: {
          pause(on: boolean): void;
          restart(seed?: number): DropState;
          bathTo(gap: number): void;
          step(n: number): DropState;
          state: DropState;
          ending: { stage: string; cover: number; inBath: boolean; card: boolean };
        };
      }
    ).__drop;
    d.pause(true);
    d.restart(99);
    const phases = new Set<string>();
    const stages = new Set<string>();
    let maxCover = 0;
    for (let i = 0; i < 900 && !d.ending.card; i++) {
      if (d.state.phase === 'play') d.bathTo(30);
      d.step(1);
      phases.add(d.state.phase);
      stages.add(d.ending.stage);
      maxCover = Math.max(maxCover, d.ending.cover);
    }
    return { ...d.state, caught: phases.has('soak'), maxCover, filled: stages.has('fill'), bath: stages.has('bath'), inBath: d.ending.inBath, card: d.ending.card };
  });
  // the foam filled the whole screen, then the bath came into view and the cat landed in it
  expect(end.caught).toBe(true);
  expect(end.filled).toBe(true);
  expect(end.maxCover).toBeGreaterThan(0.98);
  expect(end.bath).toBe(true);
  expect(end.inBath).toBe(true);
  expect(end.over).toBe(true);
  expect(end.card).toBe(true);
  await expect(page.locator('#dOver')).toHaveClass(/show/);
  await expect(page.getByRole('heading', { name: 'Bath time!' })).toBeVisible();
  await page.getByRole('button', { name: 'Again' }).click();
  await expect(page.locator('#dOver')).not.toHaveClass(/show/);
  const again = await state(page);
  expect(again.phase).toBe('play');
  expect(again.depth).toBe(0);
});
