import { expect, test, type Page } from '@playwright/test';
import { openHouse } from './seed';

// The first visit, and making your own cat.

interface Handle {
  kind: string;
  session: { cats: { name: string; breed: string; body: { p: { radius: number } } }[] };
}

const cats = (page: Page): Promise<{ name: string; breed: string; r: number }[]> =>
  page.evaluate(() => (window as unknown as { __app: Handle }).__app.session.cats.map((c) => ({ name: c.name, breed: c.breed, r: c.body.p.radius })));

const saved = (page: Page): Promise<{ cat: Record<string, unknown> | null; residents: string[]; catAsked: boolean }> =>
  page.evaluate(() => JSON.parse(localStorage.getItem('cozy-house:v1') ?? 'null'));

async function firstVisit(page: Page): Promise<void> {
  await openHouse(page, null);
}

test('first visit, after the tour: home, with two games along the bottom and a cat of your own to make', async ({ page }) => {
  await firstVisit(page);
  await expect(page.getByRole('heading', { name: 'Welcome home!' })).toBeVisible();
  // the two who live here: name them (they go by their kinds till you do)
  await expect(page.locator('#hcName-kitten')).toHaveAttribute('placeholder', 'Kitten');
  await page.locator('#hcName-kitten').fill('Pip');
  await expect(page.getByRole('button', { name: 'Make my cat' })).toBeVisible();
  await expect(page.locator('#homeBar [data-game]')).toHaveCount(2);
  for (const name of ['Cat Jar', 'Cat Drop']) await expect(page.locator('#homeBar .tin', { hasText: name })).toBeVisible();
  await expect(page.getByText('If It Fits')).toHaveCount(0);
  await page.getByRole('button', { name: 'Later' }).click();
  expect((await cats(page)).map((c) => c.breed)).toEqual(['kitten', 'tabby']);
  expect((await cats(page)).map((c) => c.name)).toEqual(['Pip', 'Tabby']);
  // (and it's there in the cats card for later)
  await page.locator('.home-cats').click();
  await expect(page.locator('.hc-make')).toBeVisible();
});

test('make your own cat: pick its looks and how squishy it is, and it moves in', async ({ page }) => {
  await firstVisit(page);
  await page.getByRole('button', { name: 'Make my cat' }).click();
  await expect(page.locator('.card.maker')).toBeVisible();
  await page.locator('[data-coat=black]').click();
  await page.locator('[data-pattern=tuxedo]').click();
  await page.locator('[data-eyes=green]').click();
  await page.locator('[data-personality=sleepy]').click();
  await page.locator('[data-slide=size]').fill('100');
  await page.locator('[data-slide=squish]').fill('100');
  await expect(page.locator('[data-flow]')).toHaveText('pours like a puddle');
  await page.locator('[data-slide=squish]').fill('0');
  await expect(page.locator('[data-flow]')).toHaveText('firm as a loaf');
  await page.locator('#mkName').fill('Pebble');
  await page.getByRole('button', { name: 'Bring Pebble home' }).click();
  // in at the window, and a card once it's landed
  await expect(page.getByRole('heading', { name: 'Pebble moved in!' })).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Welcome home, Pebble' }).click();
  const here = await cats(page);
  expect(here.map((c) => c.breed)).toEqual(['kitten', 'tabby', 'mine']);
  expect(here[2]).toEqual({ name: 'Pebble', breed: 'mine', r: 40 });
  await expect(page.locator('#roomSub')).toHaveText('3 cats live here');
  const h = await saved(page);
  expect(h.residents).toContain('mine');
  expect(h.cat).toMatchObject({ name: 'Pebble', coat: 'black', pattern: 'tuxedo', eyes: 'green', size: 1, squish: 0, personality: 'sleepy' });
  // restyle it: the house again, with your cat in its new coat, where it was
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __app?: { kind: string } }).__app?.kind === 'home');
  await page.locator('.home-cats').click();
  await page.getByRole('button', { name: 'Restyle' }).click();
  await expect(page.getByRole('heading', { name: 'Restyle Pebble' })).toBeVisible();
  await page.locator('[data-coat=ginger]').click();
  await page.locator('[data-slide=size]').fill('0');
  await page.getByRole('button', { name: 'Save Pebble' }).click();
  await expect(page.locator('.card.maker')).toHaveCount(0);
  expect((await saved(page)).cat).toMatchObject({ name: 'Pebble', coat: 'ginger', size: 0 });
  expect((await cats(page)).find((c) => c.breed === 'mine')?.r).toBe(22);
});

test('your cat plays Cat Drop: first in the picker, and picked', async ({ page }) => {
  await firstVisit(page);
  await page.getByRole('button', { name: 'Make my cat' }).click();
  await page.locator('#mkName').fill('Noodle');
  await page.getByRole('button', { name: 'Bring Noodle home' }).click();
  await expect(page.getByRole('heading', { name: 'Noodle moved in!' })).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: 'Welcome home, Noodle' }).click();
  await page.locator('#homeBar [data-game=drop]').click();
  await expect(page.getByRole('heading', { name: 'Cat Drop' })).toBeVisible();
  const first = page.locator('#dStart .breed').first();
  await expect(first).toHaveAttribute('data-breed', 'mine');
  await expect(first).toHaveAttribute('aria-checked', 'true');
  await expect(first).toContainText('Noodle');
});

test('a house from before the cat maker is offered it, once', async ({ page }) => {
  await openHouse(page, { v: 5, residents: ['kitten', 'tabby', 'persian'], arriving: [], welcomed: true, stats: {}, gift: '2099-01-01' });
  await expect(page.getByRole('heading', { name: 'Make your own cat!' })).toBeVisible({ timeout: 6000 });
  await page.getByRole('button', { name: 'Maybe later' }).click();
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __app?: { kind: string } }).__app?.kind === 'home');
  await page.waitForTimeout(2500);
  await expect(page.getByRole('heading', { name: 'Make your own cat!' })).toHaveCount(0);
  expect((await saved(page)).catAsked).toBe(true);
});
