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
  await expect(page.locator('#homeBar .tin')).toHaveCount(3);
  // the cats card: who lives here and what brings the others home
  await page.locator('.home-cats').click();
  await expect(page.getByRole('heading', { name: 'Your cats' })).toBeVisible();
  await expect(page.locator('.hc-row')).toHaveCount(7);
  await expect(page.locator('.hc-row.away')).toHaveCount(5);
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
  await page.evaluate(() => {
    const j = (window as unknown as { __jar: { game: { drops: number }; place(t: number, x: number, y: number): number } }).__jar;
    j.game.drops = 1;
    // two Persians, side by side on the floor: they snuggle up and melt
    j.place(3, 150, 400);
    j.place(3, 226, 400);
  });
  await expect(page.locator('.hh-toast')).toContainText('Juniper the Maine Coon wants to move in!', { timeout: 15000 });
});
