import { expect, test } from '@playwright/test';
import type { Dash } from '../src/features/dashboard/types';

const dashboard = {
  weight_series: [],
  latest_weight: null,
  total_current_volume: 0,
  total_previous_volume: 0,
  volume_by_muscle_group: [],
} satisfies Dash;

test.beforeEach(async ({ page }) => {
  const responses: Record<string, unknown> = {
    '/api/v1/session': { email: 'athlete@example.com' },
    '/api/v1/session/logout': { ok: true },
    '/api/v1/settings': { ai_output_length: 'normal' },
    '/api/v1/dashboard': dashboard,
    '/api/v1/dashboard/body-map': { muscles: [] },
    '/api/v1/calendar': { days: [], plan: null },
    '/api/v1/folders': [],
    '/api/v1/workouts': [],
    '/api/v1/workouts/active': [],
  };
  await page.route('**/api/v1/**', route => {
    const { pathname } = new URL(route.request().url());
    return Object.hasOwn(responses, pathname)
      ? route.fulfill({ json: responses[pathname] })
      : route.fulfill({ status: 404, json: { detail: `No test response for ${pathname}` } });
  });
  await page.route(/^https:\/\/(accounts\.google\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
});

test('Jern dashboard fits the iPhone viewport', async ({ page }, testInfo) => {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/dashboard'),
    page.goto('/'),
  ]);
  expect(response.ok(), `Dashboard API returned HTTP ${response.status()}`).toBe(true);
  await expect(page).toHaveTitle('Jern');
  await expect(page.getByRole('button', { name: 'Go to Overview' })).toBeVisible();

  await expect.poll(() => page.evaluate(() => {
    const { scrollWidth, clientWidth } = document.documentElement;
    return scrollWidth - clientWidth;
  })).toBeLessThanOrEqual(0);

  const screenshot = testInfo.outputPath('jern-iphone.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('iPhone dashboard', { path: screenshot, contentType: 'image/png' });
});

test('signs out from mobile Settings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'More pages' }).click();
  await page.getByRole('dialog', { name: 'More' }).getByRole('button', { name: /Settings/ }).click();
  const signOut = page.getByRole('main').getByRole('button', { name: 'Sign out', exact: true });
  await expect(signOut).toBeVisible();
  await page.getByRole('tab', { name: 'Themes' }).click();
  await expect(signOut).toBeVisible();

  const mobileViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(signOut).toBeHidden();
  await expect(page.getByRole('complementary').getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.setViewportSize(mobileViewport);

  const [logout] = await Promise.all([
    page.waitForRequest(request => new URL(request.url()).pathname === '/api/v1/session/logout'),
    signOut.tap(),
  ]);
  expect(logout.method()).toBe('POST');
  await expect(page.getByRole('button', { name: 'Explore demo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeHidden();
});
