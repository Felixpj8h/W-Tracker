import { expect, test } from '@playwright/test';

test('Jern dashboard fits the iPhone viewport', async ({ page }, testInfo) => {
  const [dashboard] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/dashboard'),
    page.goto('/'),
  ]);
  expect(dashboard.ok(), `Dashboard API returned HTTP ${dashboard.status()}`).toBe(true);
  await expect(page.getByRole('button', { name: 'Go to Overview' })).toBeVisible();

  await expect.poll(() => page.evaluate(() => {
    const { scrollWidth, clientWidth } = document.documentElement;
    return scrollWidth - clientWidth;
  })).toBeLessThanOrEqual(0);

  const screenshot = testInfo.outputPath('jern-iphone.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('iPhone dashboard', { path: screenshot, contentType: 'image/png' });
});
