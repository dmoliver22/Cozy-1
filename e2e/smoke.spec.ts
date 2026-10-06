import { expect, test } from '@playwright/test';

test('first visit: home, then If It Fits opens the guided kitchen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome home!' })).toBeVisible();
  await page.getByRole('button', { name: "Let's play" }).click();
  await page.locator('#homeBar [data-game=fits]').click();
  await expect(page.locator('#roomName')).toHaveText('Sunny Kitchen');
  await expect(page.locator('.face')).toHaveCount(3);
  await expect(page.locator('.coach')).toContainText('teacup');
});

test('dragging the chonk pours him into the teacup', async ({ page }) => {
  await page.goto('/?room=1');
  await page.waitForFunction(() => (window as unknown as { __app?: unknown }).__app);
  const pts = await page.evaluate(() => {
    const app = (window as unknown as { __app: any }).__app;
    const cat = app.session.cats[0];
    cat.body.computeCentroid();
    const from = app.renderer.worldToScreen(cat.body.cx + 14, cat.body.cy - 4);
    const to = app.renderer.worldToScreen(166, 323);
    return { from, to };
  });
  await page.mouse.move(pts.from.x, pts.from.y);
  await page.mouse.down();
  for (let i = 1; i <= 25; i++) {
    await page.mouse.move(pts.from.x + ((pts.to.x - pts.from.x) * i) / 25, pts.from.y + ((pts.to.y - pts.from.y) * i) / 25);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(500);
  await page.mouse.up();
  await expect(page.locator('#pawCount')).toHaveText('1');
  await expect(page.locator('.face.on')).toHaveCount(1, { timeout: 8000 });
});

test('finishing a room shows Fits & sits with a share button', async ({ page }) => {
  await page.goto('/?room=1');
  await page.waitForFunction(() => (window as unknown as { __app?: unknown }).__app);
  const seated = await page.evaluate(() => (window as unknown as { __app: any }).__app.autoplay());
  expect(seated).toBe(3);
  await expect(page.getByRole('heading', { name: 'Fits & sits!' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Share' })).toBeVisible();
});

test('the sandbox lets you add a cat and take a photo', async ({ page }) => {
  await page.goto('/?sandbox');
  await page.locator('#sbCatsBtn').click();
  await page.getByRole('button', { name: 'Add a Tabby' }).click();
  await page.locator('#sbPhotoBtn').click();
  await expect(page.getByRole('img', { name: 'A photo of your cats' })).toBeVisible();
});
