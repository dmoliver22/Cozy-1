import { expect, test, type Page } from '@playwright/test';
import { openHouse } from './seed';

// The first-time tour: anyone new starts up in the clouds on a little course.
// Boop the kitten, carry it into the cannon, and watch the ride (the cannon,
// a tube, a fan, a bouncy cushion and into a hammock); then home.

interface TourHandle {
  kind: string;
  renderer: { worldToScreen(x: number, y: number): { x: number; y: number } };
  session: { cats: { breed: string; body: { cx: number; cy: number; computeCentroid(): void } }[] };
  playground: {
    tour: { stage: string } | null;
    save: { pieces: unknown[]; tubes: unknown[] };
    toys(): { kind: string; x: number; y: number; aim: number }[];
  };
}

const app = <T>(page: Page, f: (a: TourHandle) => T): Promise<T> => page.evaluate(`(${f.toString()})(window.__app)`) as Promise<T>;

/** Where the tour's cat is on screen. */
const catOnScreen = (page: Page): Promise<{ x: number; y: number }> =>
  app(page, (a) => {
    const c = a.session.cats[0];
    c.body.computeCentroid();
    return a.renderer.worldToScreen(c.body.cx, c.body.cy);
  });

/** Where the cannon's mouth is on screen (just in front of the muzzle, the way it's aimed). */
const mouthOnScreen = (page: Page): Promise<{ x: number; y: number }> =>
  app(page, (a) => {
    const g = a.playground.toys().find((t) => t.kind === 'cannon')!;
    const d = { x: Math.cos((g.aim * Math.PI) / 180), y: Math.sin((g.aim * Math.PI) / 180) };
    return a.renderer.worldToScreen(g.x + d.x * 70, g.y + d.y * 70);
  });

const card = (page: Page) => page.locator('.pg-tour');

test('first time: the tour in the clouds. A boop, the cannon, and the ride to the hammock, then home', async ({ page }) => {
  await openHouse(page, null, {}, { tour: true });
  await expect(card(page)).toContainText('Tap Kitten to give it a boop');
  expect(await app(page, (a) => a.session.cats.map((c) => c.breed))).toEqual(['kitten']);
  // a boop
  const c = await catOnScreen(page);
  await page.mouse.click(c.x, c.y);
  await expect(card(page)).toContainText("carry it into the cannon's mouth");
  // carried round and let go at the cannon's mouth
  const from = await catOnScreen(page);
  const to = await mouthOnScreen(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 120, { steps: 8 });
  await page.mouse.move(to.x, to.y - 10, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => app(page, (a) => a.playground.tour?.stage ?? null)).toBe('ride');
  // pomf, wheee, whoosh, boing... and snug
  const said = new Set<string>();
  await expect
    .poll(
      async () => {
        said.add((await card(page).locator('.pg-tour-line').textContent()) ?? '');
        return app(page, (a) => a.playground.tour?.stage ?? null);
      },
      { timeout: 20000, intervals: [50] },
    )
    .toBe('snug');
  for (const line of ['Pomf!', 'Whoosh!', 'Boing!']) expect([...said]).toContain(line);
  // and home, where everyone's waiting
  await page.waitForFunction(() => (window as unknown as { __app: TourHandle }).__app.kind === 'home', null, { timeout: 10000 });
  await expect(page.getByRole('heading', { name: 'Welcome home!' })).toBeVisible();
  await expect(card(page)).toBeHidden();
  // only the once (and the course was never your own playground)
  expect(await page.evaluate(() => localStorage.getItem('cozy-tour:v1'))).toBe('done');
  expect(await page.evaluate(() => localStorage.getItem('cozy-playground:v1'))).toBeNull();
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __app?: TourHandle }).__app?.kind === 'home');
});

test('the tour can be skipped, straight home; and taken again from the menu, leaving your own playground be', async ({ page }) => {
  const mine = { v: 1, pieces: [{ id: 1, kind: 'shelf', x: 200, y: -80 }], tubes: [], nextId: 2, cats: ['kitten'] };
  await openHouse(page, null, { 'cozy-playground:v1': mine }, { tour: true });
  await expect(card(page)).toContainText('Welcome up to the clouds!');
  await card(page).getByRole('button', { name: 'Skip' }).click();
  await page.waitForFunction(() => (window as unknown as { __app: TourHandle }).__app.kind === 'home');
  await expect(page.getByRole('heading', { name: 'Welcome home!' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cozy-tour:v1'))).toBe('done');
  await page.getByRole('button', { name: 'Later' }).click();
  // again, from the menu
  await page.locator('#menuBtn').click();
  await page.getByRole('button', { name: /The tour again/ }).click();
  await page.waitForFunction(() => (window as unknown as { __app: TourHandle }).__app.kind === 'playground');
  await expect(card(page)).toContainText('Tap Kitten');
  expect(await app(page, (a) => a.playground.save.pieces.length)).toBe(6);
  // (the sky can't be built on, on the tour: the bar's away)
  await expect(page.locator('#playBar')).toBeHidden();
  await page.locator('#menuBtn').click();
  await page.getByRole('button', { name: /Skip to home/ }).click();
  await page.waitForFunction(() => (window as unknown as { __app: TourHandle }).__app.kind === 'home');
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('cozy-playground:v1')))!)).toEqual(mine);
});
