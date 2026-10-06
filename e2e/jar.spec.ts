import { expect, test } from '@playwright/test';

// Cat Jar smoke tests: the page boots to its start card; through the
// window.__jar test handle dropped cats land in the jar and two of the same
// melt into one of the next tier; real taps boop and never drop (a sideways
// drag drops); and the view follows the pile up the tall jar.

interface JarHandle {
  loop: { paused: boolean };
  state: { phase: string; score: number; boops: number; over: boolean; waiting: number; cats: { id: number; tier: number; x: number; y: number }[] };
  game: { drops: number; boops: number; holdBase: number; holdX: number; holdY(t: number): number; waiting: { tier: number } | null; reload(): void };
  view: { camY: number; toScreen(x: number, y: number): { x: number; y: number } };
  restart(mode: 'play' | 'daily', seed?: number): void;
  queue(tiers: number[]): void;
  drop(x?: number): boolean;
  place(tier: number, x: number, y: number): number;
  step(n?: number): void;
  render(dt?: number): void;
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

test('dropped cats land in the jar, and two kittens melt into a tabby', async ({ page }) => {
  await page.goto('/jar.html');
  await page.waitForFunction(() => (window as unknown as { __jar?: unknown }).__jar);
  const after = await page.evaluate(() => {
    const j = (window as unknown as { __jar: JarHandle }).__jar;
    j.loop.paused = true;
    j.restart('play', 1);
    j.queue([2, 0, 0, 3]);
    // a Persian off to the side, then two kittens on the same spot
    j.drop(110);
    j.step(90);
    j.drop(220);
    j.step(90);
    const one = j.state.cats.map((c) => c.tier).sort();
    j.drop(220);
    // (twins melt once they've snuggled up a moment; a kitten may hop about first)
    j.step(300);
    return { one, two: j.state.cats.map((c) => c.tier).sort(), score: j.state.score, ys: j.state.cats.map((c) => c.y) };
  });
  expect(after.one).toEqual([0, 2]);
  expect(after.two).toEqual([1, 2]);
  expect(after.score).toBe(10);
  // everything is resting inside the jar, well below the rim
  for (const y of after.ys) expect(y).toBeGreaterThan(300);
});

test('a tap boops the nearest cat and never drops one; a sideways drag drops', async ({ page }) => {
  await page.goto('/jar.html');
  await page.waitForFunction(() => (window as unknown as { __jar?: unknown }).__jar);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // one kitten resting on the floor, the physics held still
  const at = await page.evaluate(() => {
    const j = (window as unknown as { __jar: JarHandle }).__jar;
    j.loop.paused = true;
    j.restart('play', 3);
    j.queue([0, 0, 0, 0]);
    j.drop(190);
    j.step(120);
    j.game.reload();
    j.render();
    const c = j.state.cats[0];
    return { cat: j.view.toScreen(c.x, c.y), boops: j.state.boops, drops: j.game.drops };
  });
  const state = () => page.evaluate(() => ({ boops: (window as unknown as { __jar: JarHandle }).__jar.state.boops, drops: (window as unknown as { __jar: JarHandle }).__jar.game.drops }));
  // a slow press a little off the cat: a boop, not a drop
  await page.mouse.move(at.cat.x + 34, at.cat.y);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.up();
  expect(await state()).toEqual({ boops: at.boops - 1, drops: at.drops });
  // a tap on empty wall: nothing
  await page.mouse.click(12, 300);
  expect(await state()).toEqual({ boops: at.boops - 1, drops: at.drops });
  // a sideways drag and release: the waiting cat drops
  await page.mouse.move(150, 300);
  await page.mouse.down();
  await page.mouse.move(260, 304, { steps: 6 });
  await page.mouse.up();
  expect(await state()).toEqual({ boops: at.boops - 1, drops: at.drops + 1 });
});

test('the view follows the pile up the tall jar, and a swipe looks around', async ({ page }) => {
  await page.goto('/jar.html');
  await page.waitForFunction(() => (window as unknown as { __jar?: unknown }).__jar);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // (the loop held still: render(dt) moves the camera, so the timing is exact)
  const r = await page.evaluate(() => {
    const j = (window as unknown as { __jar: JarHandle }).__jar;
    j.loop.paused = true;
    j.restart('play', 4);
    const low = j.view.camY;
    // as if the pile had grown up to the rim: the next cat's line rises, the view follows
    j.game.holdBase = -600;
    for (let k = 0; k < 60; k++) j.render(0.05);
    return { low, high: j.view.camY };
  });
  expect(r.high).toBeLessThan(r.low - 100);
  // swipe up: the view goes down the jar...
  await page.mouse.move(195, 650);
  await page.mouse.down();
  await page.mouse.move(197, 250, { steps: 10 });
  await page.mouse.up();
  const looked = await page.evaluate(() => {
    const j = (window as unknown as { __jar: JarHandle }).__jar;
    j.render(0.05);
    return j.view.camY;
  });
  expect(looked).toBeGreaterThan(r.high + 100);
  // ...stays a moment, then drifts back to the pile
  const later = await page.evaluate(() => {
    const j = (window as unknown as { __jar: JarHandle }).__jar;
    for (let k = 0; k < 20; k++) j.render(0.05);
    const held = j.view.camY;
    for (let k = 0; k < 80; k++) j.render(0.05);
    return { held, back: j.view.camY };
  });
  expect(later.held).toBeGreaterThan(r.high + 100);
  expect(Math.abs(later.back - r.high)).toBeLessThan(3);
});
