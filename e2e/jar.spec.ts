import { expect, test } from '@playwright/test';

// Cat Jar smoke tests: the page boots to its start card, and through the
// window.__jar test handle dropped cats land in the jar and two of the same
// melt into one of the next tier.

interface JarHandle {
  loop: { paused: boolean };
  state: { phase: string; score: number; over: boolean; cats: { tier: number; x: number; y: number }[] };
  restart(mode: 'play' | 'daily', seed?: number): void;
  queue(tiers: number[]): void;
  drop(x?: number): boolean;
  step(n?: number): void;
}

test('Cat Jar opens on its start card and Play starts a game', async ({ page }) => {
  await page.goto('/jar.html');
  await expect(page.getByRole('heading', { name: 'Cat Jar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Daily jar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cat Jar' })).toBeHidden();
  await expect(page.locator('#score')).toHaveText('0');
  const phase = await page.evaluate(() => (window as unknown as { __jar: JarHandle }).__jar.state.phase);
  expect(phase).toBe('play');
});

test('dropped cats land in the jar, and two kittens melt into a sphynx', async ({ page }) => {
  await page.goto('/jar.html');
  await page.waitForFunction(() => (window as unknown as { __jar?: unknown }).__jar);
  const after = await page.evaluate(() => {
    const j = (window as unknown as { __jar: JarHandle }).__jar;
    j.loop.paused = true;
    j.restart('play', 1);
    j.queue([2, 0, 0, 3]);
    // a tabby off to the side, then two kittens on the same spot
    j.drop(110);
    j.step(90);
    j.drop(220);
    j.step(90);
    const one = j.state.cats.map((c) => c.tier).sort();
    j.drop(220);
    j.step(150);
    return { one, two: j.state.cats.map((c) => c.tier).sort(), score: j.state.score, ys: j.state.cats.map((c) => c.y) };
  });
  expect(after.one).toEqual([0, 2]);
  expect(after.two).toEqual([1, 2]);
  expect(after.score).toBe(10);
  // everything is resting inside the jar, well below the rim
  for (const y of after.ys) expect(y).toBeGreaterThan(300);
});
