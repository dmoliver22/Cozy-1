import { expect, test, type Page } from '@playwright/test';

// The house: the home room with your cats, the three games reached from it
// (and back), and cats moving in as you play.

interface AppHandle {
  kind: string;
  session: { cats: { name: string; breed: string }[] };
  autoplay(): number;
}

const app = (page: Page): Promise<AppHandle> => page.evaluate(() => (window as unknown as { __app: AppHandle }).__app);

/** A house that's been welcomed, with these cats (and maybe some on the way). */
async function house(page: Page, residents: string[], arriving: string[] = []): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ([r, a]) => localStorage.setItem('cozy-house:v1', JSON.stringify({ v: 1, residents: r, arriving: a, welcomed: true, stats: {} })),
    [residents, arriving],
  );
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __app?: { kind: string } }).__app?.kind === 'home');
}

test('home: your cats, and a way into each game', async ({ page }) => {
  await house(page, ['kitten', 'tabby']);
  await expect(page.locator('#roomName')).toHaveText('Home');
  await expect(page.locator('#roomSub')).toHaveText('2 cats live here');
  const names = await page.evaluate(() => (window as unknown as { __app: AppHandle }).__app.session.cats.map((c) => c.name));
  expect(names).toEqual(['Pip', 'Mochi']);
  for (const name of ['If It Fits', 'Cat Jar', 'Cat Drop']) await expect(page.locator('.home-label', { hasText: name })).toBeVisible();
  await expect(page.locator('#homeBar .tin')).toHaveCount(4);
  // the cats card: who lives here and what brings the others home
  await page.locator('.home-cats').click();
  await expect(page.getByRole('heading', { name: 'Your cats' })).toBeVisible();
  await expect(page.locator('.hc-row')).toHaveCount(6);
  await expect(page.locator('.hc-row.away')).toHaveCount(4);
  await expect(page.getByText('Finish a room in If It Fits')).toBeVisible();
});

test('Cat Jar and Cat Drop open from home and come back', async ({ page }) => {
  await house(page, ['kitten', 'tabby']);
  await page.locator('.home-label', { hasText: 'Cat Jar' }).click();
  await expect(page.getByRole('heading', { name: 'Cat Jar' })).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.locator('#jarHome').click();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#roomName')).toHaveText('Home');
  await expect(page.locator('style[data-styles=jar]')).toHaveCount(0);

  await page.locator('#homeBar [data-game=drop]').click();
  await expect(page.getByRole('heading', { name: 'Cat Drop' })).toBeVisible();
  await page.locator('#dStart [data-home]').click();
  await expect(page.locator('#roomName')).toHaveText('Home');
  expect((await app(page)).kind).toBe('home');
});

test('finishing a room brings Duchess home through the attic hatch', async ({ page }) => {
  await house(page, ['kitten', 'tabby']);
  await page.locator('#homeBar [data-game=fits]').click();
  await expect(page.locator('#roomName')).toHaveText('Sunny Kitchen');
  const seated = await page.evaluate(() => (window as unknown as { __app: AppHandle }).__app.autoplay());
  expect(seated).toBe(3);
  await expect(page.locator('.hh-toast')).toContainText('Duchess the Persian wants to move in!', { timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Fits & sits!' })).toBeVisible({ timeout: 15000 });
  await page.locator('[data-act=home]').click();
  await expect(page.getByRole('heading', { name: 'Duchess moved in!' })).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Welcome home, Duchess' }).click();
  await expect(page.locator('#roomSub')).toHaveText('3 cats live here');
  const names = await page.evaluate(() => (window as unknown as { __app: AppHandle }).__app.session.cats.map((c) => c.name));
  expect(names).toContain('Duchess');
});

test('making a Maine Coon in Cat Jar says Juniper wants to move in, right away', async ({ page }) => {
  await house(page, ['kitten', 'tabby', 'persian']);
  await page.locator('#homeBar [data-game=jar]').click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { __jar?: unknown }).__jar);
  type J = { game: { drops: number }; state: { cats: { x: number }[] }; place(t: number, x: number, y: number): number };
  // two Persians side by side on the floor: they snuggle up and melt (the
  // second put down beside the first once it's spread out on the floor)
  await page.evaluate(() => {
    const j = (window as unknown as { __jar: J }).__jar;
    j.game.drops = 1;
    j.place(2, 150, 410);
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const j = (window as unknown as { __jar: J }).__jar;
    j.place(2, j.state.cats[0].x + 74, 410);
  });
  await expect(page.locator('.hh-toast')).toContainText('Juniper the Maine Coon wants to move in!', { timeout: 15000 });
});

interface HouseHandle {
  renderer: { cam: { y: number }; worldToScreen(x: number, y: number): { x: number; y: number } };
  session: { cats: { name: string; breed: string; body: { cx: number; cy: number; computeCentroid(): void } }[] };
  home: { house: { treats: number; open: string[]; perches: { kind: string; x: number; y: number; stored?: boolean }[] }; placing: { x: number; y: number } | null; gift: { x: number; y: number } | null; goTo(f: string): void };
}

/** A house with treats to spend. */
async function richHouse(page: Page, residents: string[], treats: number, open: string[] = []): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ([r, t, o]) =>
      localStorage.setItem(
        'cozy-house:v1',
        JSON.stringify({ v: 2, residents: r, arriving: [], welcomed: true, stats: {}, treats: t, earned: t, open: o, perches: [], nextPerch: 1, where: {}, run: null, gift: '' }),
      ),
    [residents, treats, open] as const,
  );
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __app?: { kind: string } }).__app?.kind === 'home');
}

const hh = (page: Page): Promise<{ cam: number; treats: number; open: string[]; perches: { kind: string; x: number; y: number; stored?: boolean }[] }> =>
  page.evaluate(() => {
    const a = (window as unknown as { __app: HouseHandle }).__app;
    return { cam: a.renderer.cam.y, treats: a.home.house.treats, open: a.home.house.open, perches: a.home.house.perches };
  });

test('the house scrolls: up to the roof garden and down to the basement', async ({ page }) => {
  await house(page, ['kitten', 'tabby']);
  const start = (await hh(page)).cam;
  await expect(page.locator('.floor-up')).toContainText('Roof garden');
  await expect(page.locator('.floor-down')).toContainText('Basement');
  // drag the wall up: the view goes down the house
  await page.mouse.move(200, 560);
  await page.mouse.down();
  await page.mouse.move(200, 260, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  expect((await hh(page)).cam).toBeGreaterThan(start + 200);
  await expect(page.locator('.home-sign', { hasText: 'Basement' })).toBeVisible();
  // and the pill takes you back up
  await page.locator('.floor-up').click();
  await page.waitForTimeout(1500);
  expect(Math.abs((await hh(page)).cam - start)).toBeLessThan(2);
});

test('the shop: buy a wall shelf, put it on the wall, and it stays there', async ({ page }) => {
  await richHouse(page, ['kitten', 'tabby'], 50);
  await page.locator('#homeBar [data-act=shop]').click();
  await expect(page.getByRole('heading', { name: 'Shop' })).toBeVisible();
  await page.locator('[data-perch=shelf]').click();
  await expect(page.locator('.place-bar')).toBeVisible();
  // drag it onto the left wall
  const at = await page.evaluate(() => {
    const a = (window as unknown as { __app: HouseHandle }).__app;
    const p = a.home.placing!;
    return { from: a.renderer.worldToScreen(p.x, p.y + 4), to: a.renderer.worldToScreen(64, 300) };
  });
  await page.mouse.move(at.from.x, at.from.y);
  await page.mouse.down();
  await page.mouse.move(at.to.x, at.to.y, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Put it here' }).click();
  await expect(page.locator('.place-bar')).toBeHidden();
  const after = await hh(page);
  expect(after.treats).toBe(35);
  expect(after.perches).toHaveLength(1);
  expect(Math.abs(after.perches[0].x - 64)).toBeLessThan(4);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __app?: { kind: string } }).__app?.kind === 'home');
  expect((await hh(page)).perches).toEqual(after.perches);
});

test('open the roof garden, and whoosh a cat up to it through the suction tube', async ({ page }) => {
  await richHouse(page, ['kitten', 'tabby', 'mainecoon'], 200);
  await page.locator('#homeBar [data-act=shop]').click();
  await page.locator('[data-floor=roof]').click();
  await page.waitForTimeout(600);
  expect((await hh(page)).open).toEqual(['roof']);
  await page.evaluate(() => (window as unknown as { __app: HouseHandle }).__app.home.goTo('living'));
  await page.waitForTimeout(1500);
  // carry Juniper (on the top cat step) under the hood and let go
  const at = await page.evaluate(() => {
    const a = (window as unknown as { __app: HouseHandle }).__app;
    const c = a.session.cats.find((k) => k.breed === 'mainecoon')!;
    c.body.computeCentroid();
    return { from: a.renderer.worldToScreen(c.body.cx, c.body.cy - 10), to: a.renderer.worldToScreen(344, 80) };
  });
  await page.mouse.move(at.from.x, at.from.y);
  await page.mouse.down();
  await page.mouse.move(at.to.x, at.to.y, { steps: 12 });
  await page.waitForTimeout(400);
  await page.mouse.up();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const a = (window as unknown as { __app: HouseHandle }).__app;
          const c = a.session.cats.find((k) => k.breed === 'mainecoon')!;
          c.body.computeCentroid();
          return c.body.cy;
        }),
      { timeout: 8000 },
    )
    .toBeLessThan(-183);
});

test('the cats leave a present once a day: treats', async ({ page }) => {
  await house(page, ['kitten', 'tabby']);
  const before = (await hh(page)).treats;
  const g = await page.evaluate(() => {
    const a = (window as unknown as { __app: HouseHandle }).__app;
    const gift = a.home.gift!;
    return a.renderer.worldToScreen(gift.x, gift.y - 12);
  });
  await page.mouse.click(g.x, g.y);
  await expect.poll(async () => (await hh(page)).treats).toBe(before + 10);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __app?: { kind: string } }).__app?.kind === 'home');
  expect(await page.evaluate(() => (window as unknown as { __app: HouseHandle }).__app.home.gift)).toBeNull();
});
