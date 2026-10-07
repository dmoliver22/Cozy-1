import { expect, test, type Page } from '@playwright/test';
import { openHouse } from './seed';

// The Playground: your own corner of the sky, up in the clouds. Pick who's
// coming, build with perches and tubes, look about and zoom, follow a cat,
// and the respawn cloud catches anyone who falls.

interface SkyHandle {
  kind: string;
  renderer: { cam: { x: number; y: number; zoom: number }; worldToScreen(x: number, y: number): { x: number; y: number } };
  session: { cats: { breed: string; body: { cx: number; cy: number; computeCentroid(): void; placeAt(x: number, y: number): void } }[]; world: { statics: unknown[] } };
  playground: {
    placing: { k: string; piece?: { x: number; y: number }; tube?: { ax: number; ay: number; bx: number; by: number } } | null;
    follow: { breed: string } | null;
    save: { pieces: { kind: string; x: number; y: number }[]; tubes: { ax: number; ay: number; bx: number; by: number }[] };
    tubes: { transits: { cat: { breed: string } }[] };
  };
}

const sky = <T>(page: Page, f: (a: SkyHandle) => T): Promise<T> => page.evaluate(`(${f.toString()})(window.__app)`) as Promise<T>;
const screen = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([wx, wy]) => (window as unknown as { __app: SkyHandle }).__app.renderer.worldToScreen(wx, wy), [x, y] as const);
const where = (page: Page, breed: string): Promise<{ x: number; y: number }> =>
  page.evaluate((b) => {
    const c = (window as unknown as { __app: SkyHandle }).__app.session.cats.find((q) => q.breed === b)!;
    c.body.computeCentroid();
    return { x: c.body.cx, y: c.body.cy };
  }, breed);

const HOUSE = { v: 7, arriving: [], welcomed: true, catAsked: true, stats: {}, treats: 0, earned: 0, perches: [], nextPerch: 1, where: {}, run: null, gift: '2099-01-01', names: { kitten: 'Pip', tabby: 'Mochi' }, moved: {}, open: [] };

async function upToTheSky(page: Page, residents: string[], playground?: Record<string, unknown>): Promise<void> {
  await openHouse(page, { ...HOUSE, residents }, playground ? { 'cozy-playground:v1': playground } : {});
  await page.locator('#homeBar [data-act=playground]').click();
  await expect(page.getByRole('heading', { name: 'The Playground' })).toBeVisible();
}

/** Drag with a finger from one world point to another. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold = 0): Promise<void> {
  const a = await screen(page, from.x, from.y);
  const b = await screen(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
}

test('pick who comes up to the Playground, build a shelf and another joined on to it, and a tube: they are there next time', async ({ page }) => {
  await upToTheSky(page, ['kitten', 'tabby', 'persian']);
  // your two, picked; the Persian too
  await expect(page.locator('.pg-pick.on')).toHaveCount(2);
  await page.locator('[data-who=persian]').click();
  await page.getByRole('button', { name: 'Up we go!' }).click();
  await page.waitForFunction(() => (window as unknown as { __app: SkyHandle }).__app.kind === 'playground');
  await expect(page.locator('#roomName')).toHaveText('Playground');
  await expect(page.locator('[data-follow]')).toHaveCount(3);
  expect(await sky(page, (a) => a.session.cats.map((c) => c.breed))).toEqual(['kitten', 'tabby', 'persian']);
  // everyone on the respawn cloud
  await page.waitForTimeout(600);
  for (const b of ['kitten', 'tabby', 'persian']) expect(Math.abs((await where(page, b)).y)).toBeLessThan(90);
  // a shelf, up to the left (well inside the screen: dragged to its edge, the view goes along;
  // and higher than a cat hops, or one could be up there by the time the next goes up)
  await page.locator('[data-pg=build]').click();
  await page.locator('[data-piece=shelf]').click();
  const p = (await sky(page, (a) => a.playground.placing!.piece!))!;
  await drag(page, { x: p.x, y: p.y + 6 }, { x: -70, y: -330 });
  await expect(page.locator('.play-place .place-hint')).toHaveText('Drag the wall shelf where you’d like it');
  await page.getByRole('button', { name: 'Put it here' }).click();
  const first = (await sky(page, (a) => a.playground.save.pieces))[0];
  // a cloud shelf dragged up to its end joins on: one long platform
  await page.locator('[data-pg=build]').click();
  await page.locator('[data-piece=cloud]').click();
  const q = (await sky(page, (a) => a.playground.placing!.piece!))!;
  await drag(page, { x: q.x, y: q.y + 6 }, { x: first.x + 33 + 42 + 8, y: first.y + 7 });
  await page.getByRole('button', { name: 'Put it here' }).click();
  const pieces = await sky(page, (a) => a.playground.save.pieces);
  expect(pieces.map((x) => x.kind)).toEqual(['shelf', 'cloud']);
  expect(pieces[1].y).toBe(first.y);
  expect(pieces[1].x).toBe(first.x + 33 + 42);
  // a tube
  await page.locator('[data-pg=build]').click();
  await page.locator('[data-piece=tube]').click();
  await expect(page.locator('.play-place .place-hint')).toHaveText('Drag either end where you like, or the middle to move it');
  await page.getByRole('button', { name: 'Put it here' }).click();
  expect(await sky(page, (a) => a.playground.save.tubes.length)).toBe(1);
  // next time, it's all there
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __app?: { kind: string } }).__app?.kind === 'home');
  await page.locator('#homeBar [data-act=playground]').click();
  // (and who came last time comes again)
  await expect(page.locator('.pg-pick.on')).toHaveCount(3);
  await page.getByRole('button', { name: 'Up we go!' }).click();
  await page.waitForFunction(() => (window as unknown as { __app: SkyHandle }).__app.kind === 'playground');
  expect(await sky(page, (a) => [a.playground.save.pieces.length, a.playground.save.tubes.length])).toEqual([2, 1]);
  // a long press on the shelf picks it up; Remove takes it away
  const s = await screen(page, first.x, first.y + 8);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  expect(await sky(page, (a) => a.playground.save.pieces.map((x) => x.kind))).toEqual(['cloud']);
  // and home again
  await page.locator('[data-pg=home]').click();
  await page.waitForFunction(() => (window as unknown as { __app: SkyHandle }).__app.kind === 'home');
  await expect(page.locator('#roomName')).toHaveText('Home');
});

test('a cat carried to a tube and let go goes in, whoosh, and out of the other end', async ({ page }) => {
  // (a tube off the cloud's end, rising to the right)
  await upToTheSky(page, ['kitten'], { v: 1, pieces: [], tubes: [{ id: 1, ax: 200, ay: -70, bx: 340, by: -250 }], nextId: 2, cats: ['kitten'] });
  await page.getByRole('button', { name: 'Up we go!' }).click();
  await page.waitForFunction(() => (window as unknown as { __app: SkyHandle }).__app.kind === 'playground');
  await page.waitForTimeout(700);
  const pip = await where(page, 'kitten');
  // into the mouth at the bottom of it
  await drag(page, pip, { x: 200 - 18, y: -70 + 20 });
  const riding = (): Promise<unknown> =>
    page.waitForFunction(() => (window as unknown as { __app: SkyHandle }).__app.playground.tubes.transits.some((t) => t.cat.breed === 'kitten'), null, { timeout: 3000 });
  await riding();
  await page.waitForFunction(() => !(window as unknown as { __app: SkyHandle }).__app.playground.tubes.transits.some((t) => t.cat.breed === 'kitten'), null, { timeout: 4000 });
  // out at the top, flying on up and to the right
  const out = await where(page, 'kitten');
  expect(Math.hypot(out.x - 340, out.y + 250)).toBeLessThan(160);
  await page.waitForTimeout(200);
  const on = await where(page, 'kitten');
  expect(on.x).toBeGreaterThan(out.x + 20);
});

test('pinch to zoom, drag the sky to look about, and tap a face to follow that cat', async ({ page }) => {
  await upToTheSky(page, ['kitten', 'tabby']);
  await page.getByRole('button', { name: 'Up we go!' }).click();
  await page.waitForFunction(() => (window as unknown as { __app: SkyHandle }).__app.kind === 'playground');
  await page.waitForTimeout(400);
  const z0 = await sky(page, (a) => a.renderer.cam.zoom);
  // two fingers apart: in closer
  const vp = page.viewportSize()!;
  const cx = vp.width / 2;
  const cy = vp.height * 0.32;
  await page.evaluate(
    ([x, y]) => {
      const c = document.getElementById('game')!;
      const ev = (type: string, id: number, px: number, py: number): void => {
        c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: px, clientY: py, bubbles: true, pointerType: 'touch', isPrimary: id === 11 }));
      };
      ev('pointerdown', 11, x - 30, y);
      ev('pointerdown', 12, x + 30, y);
      for (let k = 1; k <= 10; k++) {
        ev('pointermove', 11, x - 30 - k * 8, y);
        ev('pointermove', 12, x + 30 + k * 8, y);
      }
      ev('pointerup', 11, x - 110, y);
      ev('pointerup', 12, x + 110, y);
    },
    [cx, cy] as const,
  );
  const z1 = await sky(page, (a) => a.renderer.cam.zoom);
  expect(z1).toBeGreaterThan(z0 * 2.2);
  // a wheel out again
  await page.mouse.move(cx, cy);
  for (let k = 0; k < 8; k++) await page.mouse.wheel(0, 160);
  expect(await sky(page, (a) => a.renderer.cam.zoom)).toBeLessThan(z1 * 0.5);
  // a drag on the sky looks about
  const c0 = await sky(page, (a) => a.renderer.cam.x);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 150, cy, { steps: 8 });
  await page.mouse.up();
  expect(await sky(page, (a) => a.renderer.cam.x)).toBeGreaterThan(c0 + 50);
  // Mochi's face: the view goes to Mochi, and keeps up
  await page.locator('[data-follow=tabby]').click();
  await expect(page.locator('#roomSub')).toHaveText('Following Mochi');
  await expect(page.locator('[data-follow=tabby]')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (window as unknown as { __app: SkyHandle }).__app.session.cats.find((c) => c.breed === 'tabby')!.body.placeAt(-60, -1200));
  await page.waitForTimeout(900);
  // (falling fast, it's still on screen)
  const f = await where(page, 'tabby');
  const fc = await sky(page, (a) => a.renderer.cam);
  expect(Math.abs(fc.y - f.y)).toBeLessThan(260);
  await page.waitForTimeout(1500);
  const m = await where(page, 'tabby');
  const cam = await sky(page, (a) => a.renderer.cam);
  expect(Math.hypot(cam.x - m.x, cam.y - m.y)).toBeLessThan(160);
  // its face again: the view stays put
  await page.locator('[data-follow=tabby]').click();
  await expect(page.locator('#roomSub')).toHaveText('Tap a face to follow that cat');
});

test('a cat that falls off everything comes back on the respawn cloud, and Respawn brings everyone back', async ({ page }) => {
  await upToTheSky(page, ['kitten', 'tabby']);
  await page.getByRole('button', { name: 'Up we go!' }).click();
  await page.waitForFunction(() => (window as unknown as { __app: SkyHandle }).__app.kind === 'playground');
  await page.waitForTimeout(600);
  // carried off the side of the cloud and let go: down it goes, into the sea of cloud, and back
  const pip = await where(page, 'kitten');
  await drag(page, pip, { x: -230, y: -40 });
  await page.waitForFunction(
    () => {
      const c = (window as unknown as { __app: SkyHandle }).__app.session.cats.find((q) => q.breed === 'kitten')!;
      c.body.computeCentroid();
      return Math.abs(c.body.cx) < 130 && c.body.cy < 10 && c.body.cy > -120;
    },
    null,
    { timeout: 9000 },
  );
  // off somewhere far: Respawn
  await page.evaluate(() => (window as unknown as { __app: SkyHandle }).__app.session.cats.find((c) => c.breed === 'tabby')!.body.placeAt(900, -900));
  await page.locator('[data-pg=respawn]').click();
  await page.waitForTimeout(800);
  for (const b of ['kitten', 'tabby']) {
    const w = await where(page, b);
    expect(Math.abs(w.x)).toBeLessThan(130);
    expect(Math.abs(w.y)).toBeLessThan(120);
  }
});

test("the roof garden's sky tube: a cat let go under its hood goes up and away, to the Playground", async ({ page }) => {
  await openHouse(page, { ...HOUSE, residents: ['kitten', 'tabby'], open: ['roof'] });
  await page.evaluate(() => (window as unknown as { __app: { home: { goTo(f: string): void } } }).__app.home.goTo('roof'));
  await page.waitForTimeout(1500);
  // Pip on the roof deck, by the hood over the middle of the garden (its mouth at 196, 176 over the deck)
  const deckY = -1277;
  await page.evaluate((y) => (window as unknown as { __app: SkyHandle }).__app.session.cats.find((q) => q.breed === 'kitten')!.body.placeAt(130, y - 26), deckY);
  await page.waitForTimeout(600);
  const pip = await where(page, 'kitten');
  // carried up under it and let go: whoosh
  await drag(page, pip, { x: 196, y: deckY - 120 });
  await page.waitForFunction(() => (window as unknown as { __app: SkyHandle }).__app.kind === 'playground', null, { timeout: 8000 });
  expect(await sky(page, (a) => a.session.cats.map((c) => c.breed))).toEqual(['kitten']);
  await expect(page.locator('#roomSub')).toHaveText('Following Pip');
  // down out of the clouds onto the respawn cloud
  await page.waitForFunction(
    () => {
      const c = (window as unknown as { __app: SkyHandle }).__app.session.cats[0];
      c.body.computeCentroid();
      return Math.abs(c.body.cy) < 60;
    },
    null,
    { timeout: 5000 },
  );
  // and home, it's on the roof garden under the hood
  await page.locator('[data-pg=home]').click();
  await page.waitForFunction(() => (window as unknown as { __app: SkyHandle }).__app.kind === 'home');
  const back = await where(page, 'kitten');
  expect(Math.abs(back.x - 196)).toBeLessThan(90);
  expect(Math.abs(back.y - (deckY - 30))).toBeLessThan(60);
});
