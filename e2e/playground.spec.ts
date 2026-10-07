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
    placing: { k: string; lifted: boolean; piece?: { x: number; y: number; aim?: number }; tube?: { pts: [number, number][]; bends?: [number, number][] } } | null;
    follow: { breed: string } | null;
    save: { pieces: { id: number; kind: string; x: number; y: number }[]; tubes: { id: number; pts: [number, number][]; bends?: [number, number][] }[] };
    tubes: { transits: { cat: { breed: string } }[] };
    works: { inCannon(cat: unknown): number | null };
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

/** Draw with a finger through these world points (the finger down at the first, up at the last). */
async function drawPath(page: Page, pts: { x: number; y: number }[]): Promise<void> {
  const a = await screen(page, pts[0].x, pts[0].y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    const b = await screen(page, p.x, p.y);
    await page.mouse.move(b.x, b.y, { steps: 12 });
  }
  await page.mouse.up();
}

const lengthOf = (pts: [number, number][]): number => pts.slice(1).reduce((L, p, i) => L + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

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
  // a tube, drawn with a finger: round a bend and back
  await page.locator('[data-pg=build]').click();
  await page.locator('[data-piece=tube]').click();
  await expect(page.locator('.play-place .place-hint')).toHaveText('Draw your tube: drag a finger through the sky');
  await expect(page.getByRole('button', { name: 'Put it here' })).toBeDisabled();
  // (well inside the screen: a finger at its edge takes the view along, the tube drawn on as it goes)
  const c = await sky(page, (a) => a.renderer.cam);
  const at = (dx: number, dy: number): { x: number; y: number } => ({ x: c.x + dx, y: c.y + dy });
  await drawPath(page, [at(40, -20), at(100, -60), at(90, -150), at(10, -190)]);
  await expect(page.locator('.play-place .place-hint')).toHaveText(/^Drag an end to draw on/);
  const drawn = await sky(page, (a) => a.playground.placing!.tube!.pts);
  expect(Math.hypot(drawn[0][0] - at(40, -20).x, drawn[0][1] - at(40, -20).y)).toBeLessThan(8);
  expect(Math.hypot(drawn[drawn.length - 1][0] - at(10, -190).x, drawn[drawn.length - 1][1] - at(10, -190).y)).toBeLessThan(8);
  // (it bends: well out to the right of the line between its ends)
  expect(Math.max(...drawn.map((q) => q[0]))).toBeGreaterThan(c.x + 70);
  // drawn on from its end: longer
  await drawPath(page, [at(10, -190), at(-50, -210), at(-100, -180)]);
  const longer = await sky(page, (a) => a.playground.placing!.tube!.pts);
  expect(lengthOf(longer)).toBeGreaterThan(lengthOf(drawn) + 100);
  expect(longer[0]).toEqual(drawn[0]);
  await page.getByRole('button', { name: 'Put it here' }).click();
  const tubes = await sky(page, (a) => a.playground.save.tubes);
  expect(tubes.length).toBe(1);
  expect(lengthOf(tubes[0].pts)).toBeCloseTo(lengthOf(longer), 0);
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

test('tap anything built to change it: a tube drawn on, a shelf taken away and put back; a pipe goes in straight runs, and a run slides', async ({ page }) => {
  // a tube (saved straight, from before tubes bent) and a shelf, built before
  await upToTheSky(page, ['kitten'], { v: 1, pieces: [{ id: 3, kind: 'shelf', x: -90, y: -230 }], tubes: [{ id: 1, ax: 10, ay: -150, bx: 90, by: -230 }], nextId: 4, cats: ['kitten'] });
  await page.getByRole('button', { name: 'Up we go!' }).click();
  await page.waitForFunction(() => (window as unknown as { __app: SkyHandle }).__app.kind === 'playground');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const p = (window as unknown as { __app: { playground: { cam: { x: number; y: number; zoom: number } } } }).__app.playground;
    p.cam = { x: 0, y: -180, zoom: 1 };
  });
  await page.waitForTimeout(200);
  const tap = async (x: number, y: number): Promise<void> => {
    const q = await screen(page, x, y);
    await page.mouse.click(q.x, q.y);
  };
  const bar = page.locator('.play-place');
  // a tap on the tube: it's picked, to change (still where it was)
  await tap(50, -190);
  await expect(bar.getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Remove' })).toBeVisible();
  await expect(bar.locator('[data-style=twisty]')).toHaveAttribute('aria-pressed', 'true');
  expect(await sky(page, (a) => [a.playground.placing!.lifted, a.playground.save.tubes.length])).toEqual([false, 1]);
  // drawn on from its end, and done
  const before = await sky(page, (a) => a.playground.placing!.tube!.pts);
  await drawPath(page, [
    { x: 90, y: -230 },
    { x: 80, y: -280 },
    { x: 40, y: -320 },
  ]);
  await bar.getByRole('button', { name: 'Done' }).click();
  const after = await sky(page, (a) => a.playground.save.tubes);
  expect(after).toHaveLength(1);
  expect(lengthOf(after[0].pts)).toBeGreaterThan(lengthOf(before) + 60);
  // a tap on the shelf, Remove: it's gone; Undo, it's back
  await tap(-90, -226);
  await bar.getByRole('button', { name: 'Remove' }).click();
  expect(await sky(page, (a) => a.playground.save.pieces.length)).toBe(0);
  await page.locator('.pg-undo').getByRole('button', { name: 'Undo' }).click();
  expect(await sky(page, (a) => a.playground.save.pieces.map((q) => [q.id, q.x, q.y]))).toEqual([[3, -90, -230]]);
  // a pipe, somewhere clear: drawn along and up, it goes in two straight runs with an elbow
  await page.evaluate(() => {
    const p = (window as unknown as { __app: { playground: { cam: { x: number; y: number; zoom: number } } } }).__app.playground;
    p.cam = { x: 0, y: -700, zoom: 1 };
  });
  await page.waitForTimeout(200);
  await page.locator('[data-pg=build]').click();
  await page.locator('[data-piece=pipe]').click();
  await expect(bar.locator('.place-hint')).toHaveText('Draw your pipe: drag a finger through the sky, and it goes straight');
  await drawPath(page, [
    { x: -100, y: -640 },
    { x: 43, y: -637 },
    { x: 46, y: -770 },
  ]);
  const bends = (await sky(page, (a) => a.playground.placing!.tube!.bends))!;
  expect(bends).toHaveLength(3);
  expect(bends[0][1]).toBe(bends[1][1]);
  expect(bends[1][0]).toBe(bends[2][0]);
  expect(bends[2][1]).toBeLessThan(bends[1][1] - 60);
  await bar.getByRole('button', { name: 'Put it here' }).click();
  // tapped and its upright run slid along: the run before it stretches to meet it
  const x0 = bends[1][0];
  await tap(x0, -730);
  await expect(bar.locator('[data-style=pipe]')).toHaveAttribute('aria-pressed', 'true');
  await drawPath(page, [
    { x: x0, y: -735 },
    { x: x0 + 42, y: -735 },
  ]);
  await bar.getByRole('button', { name: 'Done' }).click();
  const pipe = (await sky(page, (a) => a.playground.save.tubes.find((t) => t.bends)))!;
  expect(pipe.bends![1][0]).toBe(x0 + 40);
  expect(pipe.bends![2][0]).toBe(x0 + 40);
  expect(pipe.bends![0]).toEqual(bends[0]);
  // next time, still a pipe
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __app?: { kind: string } }).__app?.kind === 'home');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cozy-playground:v1')!).tubes.filter((t: { bends?: unknown }) => t.bends).length)).toBe(1);
});

test('toys: a cannon built, aimed by its arrow, and a cat let go at its mouth is fired out of it; it is there next time', async ({ page }) => {
  await upToTheSky(page, ['kitten']);
  await page.getByRole('button', { name: 'Up we go!' }).click();
  await page.waitForFunction(() => (window as unknown as { __app: SkyHandle }).__app.kind === 'playground');
  await page.waitForTimeout(400);
  await page.locator('[data-pg=build]').click();
  await page.locator('[data-piece=cannon]').click();
  const bar = page.locator('.play-place');
  await expect(bar.locator('.place-hint')).toHaveText('Drag the cat cannon where you’d like it, and its arrow to aim it');
  const c = (await sky(page, (a) => a.playground.placing!.piece!))!;
  expect(c.aim).toBe(-50);
  // its arrow dragged round to point straight up
  const r = Math.hypot(Math.cos((-50 * Math.PI) / 180), Math.sin((-50 * Math.PI) / 180)) * (56 + 40);
  await drag(page, { x: c.x + Math.cos((-50 * Math.PI) / 180) * r, y: c.y + Math.sin((-50 * Math.PI) / 180) * r }, { x: c.x, y: c.y - 120 });
  expect(await sky(page, (a) => a.playground.placing!.piece!.aim)).toBe(-90);
  await bar.getByRole('button', { name: 'Put it here' }).click();
  const placed = (await sky(page, (a) => a.playground.save.pieces.find((q) => q.kind === 'cannon')))!;
  // Pip carried round it, up to its mouth (straight up from it) and let go: in, and a moment later, out of the top, flying up
  const pip = await where(page, 'kitten');
  await drawPath(page, [pip, { x: placed.x - 110, y: pip.y - 30 }, { x: placed.x - 110, y: placed.y - 110 }, { x: placed.x, y: placed.y - 56 - 14 }]);
  await page.waitForFunction(() => {
    const a = (window as unknown as { __app: SkyHandle }).__app;
    return a.playground.works.inCannon(a.session.cats[0]) !== null;
  });
  await page.waitForFunction(
    () => {
      const a = (window as unknown as { __app: SkyHandle }).__app;
      return a.playground.works.inCannon(a.session.cats[0]) === null;
    },
    null,
    { timeout: 3000 },
  );
  const out = await where(page, 'kitten');
  await page.waitForTimeout(150);
  const up = await where(page, 'kitten');
  expect(up.y).toBeLessThan(out.y - 60);
  expect(Math.abs(up.x - placed.x)).toBeLessThan(60);
  // next time, it's there, aimed as it was
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __app?: { kind: string } }).__app?.kind === 'home');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cozy-playground:v1')!).pieces.map((q: { kind: string; aim: number }) => [q.kind, q.aim]))).toEqual([['cannon', -90]]);
});

test('a cat carried to a tube and let go goes in, whoosh, and out of the other end', async ({ page }) => {
  // (a tube off the cloud's end, rising to the right: saved straight, from before tubes bent)
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
