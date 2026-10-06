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
  // the games are on the bar along the bottom (and only there)
  for (const name of ['If It Fits', 'Cat Jar', 'Cat Drop']) await expect(page.locator('#homeBar .tin', { hasText: name })).toBeVisible();
  await expect(page.locator('#homeBar .tin')).toHaveCount(4);
  await expect(page.locator('.home-label:not(.home-sign)')).toHaveCount(0);
  // the cats card: who lives here and what brings the others home
  await page.locator('.home-cats').click();
  await expect(page.getByRole('heading', { name: 'Your cats' })).toBeVisible();
  await expect(page.locator('.hc-row')).toHaveCount(6);
  await expect(page.locator('.hc-row.away')).toHaveCount(4);
  await expect(page.getByText('Finish a room in If It Fits')).toBeVisible();
});

test('Cat Jar and Cat Drop open from home and come back', async ({ page }) => {
  await house(page, ['kitten', 'tabby']);
  await page.locator('#homeBar [data-game=jar]').click();
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

test('finishing a room brings Duchess home, in at the window', async ({ page }) => {
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
  home: {
    house: { treats: number; open: string[]; perches: { kind: string; x: number; y: number; stored?: boolean }[] };
    placing: { x: number; y: number } | null;
    gift: { x: number; y: number } | null;
    goTo(f: string): void;
  };
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

test('the house scrolls: up the living room\'s tall wall to the roof garden, and down to the basement', async ({ page }) => {
  await house(page, ['kitten', 'tabby']);
  const start = (await hh(page)).cam;
  await expect(page.locator('.floor-up')).toContainText('Up high');
  await expect(page.locator('.floor-down')).toContainText('Basement');
  // drag the wall up: the view goes down the house
  await page.mouse.move(200, 560);
  await page.mouse.down();
  await page.mouse.move(200, 260, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  expect((await hh(page)).cam).toBeGreaterThan(start + 200);
  await expect(page.locator('.home-sign', { hasText: 'Basement' })).toBeVisible();
  // and the pill takes you back up, then on up the wall, and up to the roof
  await page.locator('.floor-up').click();
  await page.waitForTimeout(1500);
  expect(Math.abs((await hh(page)).cam - start)).toBeLessThan(2);
  await page.locator('.floor-up').click();
  await page.waitForTimeout(1500);
  expect((await hh(page)).cam).toBeLessThan(start - 500);
  await expect(page.locator('.floor-up')).toContainText('Roof garden');
  await expect(page.locator('.floor-down')).toContainText('Living room');
  await page.locator('.floor-up').click();
  await page.waitForTimeout(1500);
  await expect(page.locator('.home-sign', { hasText: 'Roof garden' })).toBeVisible();
});

test('the tubes are there before their floors are open, capped: a tap on one offers to open it', async ({ page }) => {
  await house(page, ['kitten', 'tabby']);
  // the funnel's lid, in the living room floor
  const lid = await page.evaluate(() => (window as unknown as { __app: HouseHandle }).__app.renderer.worldToScreen(58, 478));
  await page.mouse.click(lid.x, lid.y);
  await expect(page.getByRole('heading', { name: 'Shop' })).toBeVisible();
  await expect(page.locator('[data-floor=basement]')).toBeVisible();
});

test('carry a cat to the top of the screen and the view goes up the wall with it', async ({ page }) => {
  await house(page, ['kitten', 'tabby']);
  await page.waitForTimeout(800);
  const start = (await hh(page)).cam;
  const from = await page.evaluate(() => {
    const a = (window as unknown as { __app: HouseHandle }).__app;
    const c = a.session.cats.find((k) => k.breed === 'kitten')!;
    c.body.computeCentroid();
    return a.renderer.worldToScreen(c.body.cx, c.body.cy - 6);
  });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, 100, { steps: 12 });
  await page.waitForTimeout(1800);
  const up = await page.evaluate(() => {
    const a = (window as unknown as { __app: HouseHandle }).__app;
    const c = a.session.cats.find((k) => k.breed === 'kitten')!;
    c.body.computeCentroid();
    return { cam: a.renderer.cam.y, cy: c.body.cy };
  });
  await page.mouse.up();
  expect(up.cam).toBeLessThan(start - 300);
  expect(up.cy).toBeLessThan(-150);
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
  // up the tall wall: a perch bought while looking up there goes up there
  await page.locator('.floor-up').click();
  await page.waitForTimeout(1500);
  await page.locator('#homeBar [data-act=shop]').click();
  await page.locator('[data-perch=shelf]').click();
  await expect(page.locator('.place-bar')).toBeVisible();
  await page.getByRole('button', { name: 'Put it here' }).click();
  const high = (await hh(page)).perches;
  expect(high).toHaveLength(2);
  expect(high[1].y).toBeLessThan(-100);
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
    .toBeLessThan(-700);
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

/** A house with these cats, no present waiting, and maybe someone hurt. */
async function livelyHouse(page: Page, residents: string[], treats: number, hurt: Record<string, { need: number; fed: number }> = {}): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ([r, t, h]) => {
      // (today's present already opened)
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      localStorage.setItem(
        'cozy-house:v1',
        JSON.stringify({ v: 4, residents: r, arriving: [], welcomed: true, stats: {}, treats: t, earned: t, open: [], perches: [], nextPerch: 1, where: {}, run: null, gift: today, hurt: h, toy: null, scraped: true }),
      );
    },
    [residents, treats, hurt] as const,
  );
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __app?: { kind: string } }).__app?.kind === 'home');
  await page.waitForTimeout(800);
}

interface LifeHandle {
  renderer: { worldToScreen(x: number, y: number): { x: number; y: number } };
  session: { cats: { breed: string; body: { cx: number; cy: number; computeCentroid(): void } }[] };
  home: {
    hopIn: number;
    house: { treats: number; hurt: Record<string, unknown> };
    antics: {
      toy: { cx: number; cy: number; computeCentroid(): void };
      fights: { x: number; y: number }[];
      startFight(a: unknown, b: unknown): void;
      startStalk(c: unknown, t: { kind: 'toy' }, chain: number): void;
    };
  };
}

const onApp = <T,>(page: Page, fn: (a: LifeHandle) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__app)`) as Promise<T>;

test('a cat hurt in a scrap is made better with fish, a tap at a time', async ({ page }) => {
  await livelyHouse(page, ['kitten', 'tabby'], 10, { tabby: { need: 3, fed: 0 } });
  await onApp(page, (a) => (a.home.hopIn = 9999));
  for (let k = 0; k < 3; k++) {
    const p = await onApp(page, (a) => {
      const c = a.session.cats.find((x) => x.breed === 'tabby')!;
      c.body.computeCentroid();
      return a.renderer.worldToScreen(c.body.cx, c.body.cy);
    });
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
  }
  await expect.poll(() => onApp(page, (a) => JSON.stringify(a.home.house.hurt))).toBe('{}');
  expect(await onApp(page, (a) => a.home.house.treats)).toBe(7);
  await expect(page.locator('.hh-toast')).toContainText("Mochi's all better!");
});

test('two cats scrap in a cloud of dust, and a tap on the cloud breaks it up', async ({ page }) => {
  await livelyHouse(page, ['kitten', 'tabby'], 10);
  const at = await onApp(page, (a) => {
    a.home.hopIn = 9999;
    const [p, m] = a.session.cats;
    a.home.antics.startFight(p, m);
    const f = a.home.antics.fights[0];
    return a.renderer.worldToScreen(f.x, f.y);
  });
  await page.waitForTimeout(500);
  expect(await onApp(page, (a) => a.home.antics.fights.length)).toBe(1);
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => onApp(page, (a) => a.home.antics.fights.length)).toBe(0);
  await page.waitForTimeout(600);
  expect(await onApp(page, (a) => JSON.stringify(a.home.house.hurt))).toBe('{}');
});

test('the ball of yarn: a tap bats it, and a playful cat pounces on it', async ({ page }) => {
  await livelyHouse(page, ['kitten', 'tabby'], 10);
  const toy = () =>
    onApp(page, (a) => {
      const t = a.home.antics.toy;
      t.computeCentroid();
      return { x: t.cx, y: t.cy };
    });
  const t0 = await toy();
  const s = await onApp(page, (a) => {
    a.home.hopIn = 9999;
    const t = a.home.antics.toy;
    t.computeCentroid();
    return a.renderer.worldToScreen(t.cx - 3, t.cy);
  });
  await page.mouse.click(s.x, s.y);
  await expect.poll(async () => {
    const t = await toy();
    return Math.hypot(t.x - t0.x, t.y - t0.y);
  }).toBeGreaterThan(8);
  await page.waitForTimeout(1500);
  const t1 = await toy();
  // Pip goes after it: crouch, wiggle, pounce
  await onApp(page, (a) => a.home.antics.startStalk(a.session.cats.find((c) => c.breed === 'kitten'), { kind: 'toy' }, 0));
  await expect
    .poll(
      async () => {
        const t = await toy();
        return Math.hypot(t.x - t1.x, t.y - t1.y);
      },
      { timeout: 6000 },
    )
    .toBeGreaterThan(8);
});
