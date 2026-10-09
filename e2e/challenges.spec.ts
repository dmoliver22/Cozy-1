import { expect, test, type Page } from '@playwright/test';
import { openHouse } from './seed';

// Challenges up in the clouds (a course, a few pieces of your own, Go), and
// the treats the Playground pays: for each challenge done, and for the first
// time a cat does each thing up there.

interface Handle {
  kind: string;
  renderer: { worldToScreen(x: number, y: number): { x: number; y: number } };
  session: { cats: { breed: string; body: { placeAt(x: number, y: number): void } }[] };
  playground: {
    challenge: { phase: string; ch: { id: string } } | null;
    placing: { piece: { x: number; y: number } } | null;
    save: { pieces: unknown[] };
  };
}

const app = <T>(page: Page, f: (a: Handle) => T): Promise<T> => page.evaluate(`(${f.toString()})(window.__app)`) as Promise<T>;
const treats = (page: Page): Promise<number> => page.evaluate(() => JSON.parse(localStorage.getItem('cozy-house:v1')!).treats);
const phase = (page: Page): Promise<string | null> => app(page, (a) => a.playground.challenge?.phase ?? null);

const HOUSE = { v: 7, arriving: [], welcomed: true, catAsked: true, stats: {}, treats: 0, earned: 0, perches: [], nextPerch: 1, where: {}, run: null, gift: '2099-01-01', names: { kitten: 'Pip', tabby: 'Mochi' }, moved: {}, open: [], residents: ['kitten', 'tabby'] };
const MINE = { v: 1, pieces: [{ id: 1, kind: 'fan', x: 150, y: -60, aim: -90 }], tubes: [], nextId: 2, cats: ['kitten', 'tabby'] };

async function upToTheSky(page: Page): Promise<void> {
  await openHouse(page, HOUSE, { 'cozy-playground:v1': MINE });
  await page.locator('#homeBar [data-act=playground]').click();
  await page.getByRole('button', { name: 'Up we go!' }).click();
  await page.waitForFunction(() => (window as unknown as { __app: Handle }).__app.kind === 'playground');
}

test('a challenge: not quite with nothing put, then a belt under Pip and Go, made it, treats; and back to your own sky as it was', async ({ page }) => {
  await upToTheSky(page);
  await page.locator('[data-pg=challenges]').click();
  // the first is open, the rest wait their turn
  await expect(page.locator('[data-chi="0"]')).toBeEnabled();
  await expect(page.locator('[data-chi="1"]')).toBeDisabled();
  await page.locator('[data-chi="0"]').click();
  await expect(page.locator('#overlay')).toContainText('Get Pip into the cat bed');
  await expect(page.locator('#overlay')).toContainText('1 × conveyor belt');
  await page.getByRole('button', { name: "Let's go" }).click();
  await expect(page.locator('#chBar')).toBeVisible();
  await expect(page.locator('#playBar')).toBeHidden();
  // (the cat's not to be carried: what you put gets it there)
  expect(await app(page, (a) => a.session.cats.map((c) => c.breed))).toEqual(['kitten']);
  // Go with nothing: down it goes
  await page.locator('[data-ch=go]').click();
  await expect.poll(() => phase(page), { timeout: 15000 }).toBe('lost');
  await expect(page.locator('.pg-ch')).toContainText('Not quite!');
  await page.locator('.pg-ch [data-chc=hint]').click();
  await expect(page.locator('.pg-ch')).toContainText('Hint:');
  await page.locator('.pg-ch [data-chc=again]').click();
  await expect.poll(() => phase(page)).toBe('build');
  // a belt, dragged under Pip
  await page.locator('[data-ch=build]').click();
  await page.locator('[data-piece=belt]').click();
  const at = await app(page, (a) => a.playground.placing!.piece);
  const screen = (x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([wx, wy]) => (window as unknown as { __app: Handle }).__app.renderer.worldToScreen(wx, wy), [x, y] as const);
  const from = await screen(at.x, at.y + 8);
  const to = await screen(40, 88);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.locator('.play-place').getByRole('button', { name: 'Put it here' }).click();
  // (the kit's used up)
  await page.locator('[data-ch=build]').click();
  await expect(page.locator('[data-piece=belt]')).toBeDisabled();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.locator('[data-ch=go]').click();
  await expect.poll(() => phase(page), { timeout: 15000 }).toBe('won');
  await expect(page.getByRole('heading', { name: 'Made it!' })).toBeVisible({ timeout: 4000 });
  await expect(page.locator('#overlay')).toContainText('+10 treats');
  expect(await treats(page)).toBe(10);
  expect(await page.evaluate(() => localStorage.getItem('cozy-challenges:v1'))).toBe('["belt"]');
  // next one's open now
  await page.getByRole('button', { name: 'Next challenge' }).click();
  await expect(page.locator('#overlay')).toContainText('Blown away');
  await page.getByRole('button', { name: "Let's go" }).click();
  // and leaving: your own sky, as you left it, with whoever came up
  await page.locator('[data-ch=back]').click();
  await expect.poll(() => app(page, (a) => a.playground.challenge)).toBeNull();
  expect(await app(page, (a) => a.session.cats.map((c) => c.breed))).toEqual(['kitten', 'tabby']);
  expect(await app(page, (a) => a.playground.save.pieces.length)).toBe(1);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('cozy-playground:v1')))!)).toEqual(MINE);
});

test('the first time a cat rides a fan’s wind up in your own sky: treats, once', async ({ page }) => {
  await upToTheSky(page);
  await app(page, (a) => a.session.cats[0].body.placeAt(150, -200));
  await expect(page.locator('.pg-first')).toContainText('First cat on the wind!');
  await expect.poll(() => treats(page)).toBe(5);
  // (not again)
  await app(page, (a) => a.session.cats[1].body.placeAt(150, -200));
  await page.waitForTimeout(1200);
  expect(await treats(page)).toBe(5);
});
