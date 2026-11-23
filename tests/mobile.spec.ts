import { expect, test, type Page } from '@playwright/test';
import type { Dash } from '../src/features/dashboard/types';
import type { Workout } from '../src/features/workout/types';

const dashboard = {
  weight_series: [],
  latest_weight: null,
  total_current_volume: 0,
  total_previous_volume: 0,
  volume_by_muscle_group: [],
} satisfies Dash;

const workout = {
  id: 42,
  revision: 1,
  name: 'Leg day',
  performed_on: '2026-11-22',
  exercises: [{ exercise_id: 1, name: 'Squat', sets: Array.from({ length: 12 }, () => ({ weight: 60, reps: 8 })) }],
} satisfies Workout;

// Desktop WebKit can emulate a phone viewport, but it has no iOS keyboard.
// Simulate the visual viewport shrinking and panning without a layout resize.
async function setVisualViewport(page: Page, height: number, offsetTop = 0, scale = 1) {
  await page.evaluate(({ height, offsetTop, scale }) => {
    const viewport = window.visualViewport!;
    const scroll = viewport.offsetTop !== offsetTop;
    Object.defineProperties(viewport, {
      height: { configurable: true, value: height },
      offsetTop: { configurable: true, value: offsetTop },
      scale: { configurable: true, value: scale },
    });
    viewport.dispatchEvent(new Event(scroll ? 'scroll' : 'resize'));
    return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }, { height, offsetTop, scale });
}

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
    '/api/v1/ai/conversations': [],
  };
  await page.route('**/api/v1/**', route => {
    const { pathname } = new URL(route.request().url());
    return Object.hasOwn(responses, pathname)
      ? route.fulfill({ json: responses[pathname] })
      : route.fulfill({ status: 404, json: { detail: `No test response for ${pathname}` } });
  });
  await page.route(/^https:\/\/(accounts\.google\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
});

test('keeps substitution search and its results above the phone keyboard', async ({ page }) => {
  const replacements = Array.from({ length: 10 }, (_, index) => ({
    id: index + 2,
    name: `Leg press variation ${index + 1}`,
    equipment: 'Machine',
  }));
  await page.route('**/api/v1/workouts/active', route => route.fulfill({ json: [workout] }));
  await page.route('**/api/v1/workouts/42', route => route.fulfill({ json: { ...workout, revision: 2 } }));
  await page.route('**/api/v1/exercises?*', route => route.fulfill({ json: replacements }));
  await page.goto('/');
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-area-top', '44px'));
  await page.getByRole('button', { name: 'Resume', exact: true }).tap();

  const substitute = page.getByRole('button', { name: 'Substitute', exact: true });
  await expect(substitute).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 120));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(120);
  await substitute.tap();
  const dialog = page.getByRole('dialog', { name: 'Replace exercise' });
  const search = dialog.getByRole('searchbox');
  await expect(search).toBeFocused();
  const layoutHeight = await page.evaluate(() => window.visualViewport!.height);
  await setVisualViewport(page, 310);
  await expect.poll(async () => (await dialog.boundingBox())!.y + (await dialog.boundingBox())!.height).toBeLessThanOrEqual(311);
  await setVisualViewport(page, 310, 64);
  await expect.poll(async () => {
    const box = (await dialog.boundingBox())!;
    return box.y + box.height;
  }).toBeCloseTo(374, 0);

  await search.fill('leg press');
  const close = dialog.getByRole('button', { name: 'Cancel substitution' });
  const lastResult = dialog.getByRole('button', { name: /variation 10/ });
  await lastResult.scrollIntoViewIfNeeded();
  await expect(close).toBeInViewport();
  await expect(search).toBeInViewport();
  await expect.poll(async () => (await search.boundingBox())!.y).toBeGreaterThanOrEqual(64);
  await expect.poll(async () => (await dialog.boundingBox())!.y).toBeCloseTo(76, 0);
  await expect.poll(async () => {
    const box = (await lastResult.boundingBox())!;
    return box.y + box.height;
  }).toBeLessThanOrEqual(374);
  await lastResult.tap();
  await setVisualViewport(page, layoutHeight);
  await expect(dialog).toBeHidden();
  const revert = page.getByRole('button', { name: 'Revert to Squat' });
  await expect(revert).toBeVisible();
  await expect(page.getByRole('button', { name: /Exercise 1 of 1.*Leg press variation 10/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More pages' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(120);

  await revert.tap();
  await substitute.tap();
  await expect(dialog.getByRole('button', { name: /Last substitute/ })).toBeFocused();
  await close.tap();
  await expect(substitute).toBeFocused();
});

test('keeps the workout note and Save reachable with the keyboard open', async ({ page }) => {
  await page.route('**/api/v1/workouts', route => route.fulfill({ json: [{ ...workout, completed: true }] }));
  await page.route('**/api/v1/workouts/42', route => route.fulfill({ json: { ...workout, completed: true } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'More pages' }).tap();
  await page.getByRole('dialog', { name: 'More' }).getByRole('button', { name: /History/ }).tap();
  await page.getByRole('button', { name: /Leg day/ }).tap();
  await page.getByRole('button', { name: /Add note/ }).tap();
  const note = page.getByRole('dialog', { name: 'Workout note' });
  await note.getByRole('textbox').tap();
  await note.getByRole('textbox').fill('Squats felt good.');
  const layoutHeight = await page.evaluate(() => window.visualViewport!.height);
  await setVisualViewport(page, 330, 35);
  const save = note.getByRole('button', { name: 'Save note' });
  await expect.poll(async () => {
    const box = (await note.boundingBox())!;
    return box.y + box.height;
  }).toBeLessThanOrEqual(365);
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  const [saved] = await Promise.all([
    page.waitForRequest(request => request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/v1/workouts/42'),
    save.tap(),
  ]);
  expect(saved.postDataJSON()).toMatchObject({ note: 'Squats felt good.' });
  await setVisualViewport(page, layoutHeight);
  await expect(note).toBeHidden();
});

test('keeps the Coach composer and Send button within the keyboard viewport', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Coach', exact: true }).tap();
  const composer = page.getByRole('textbox', { name: 'Message your coach' });
  await composer.tap();
  await composer.fill('How long should I rest between sets?');
  const layoutHeight = await page.evaluate(() => window.visualViewport!.height);
  await setVisualViewport(page, layoutHeight - 64);
  await expect(page.getByRole('button', { name: 'More pages' })).toBeVisible();
  await setVisualViewport(page, 325, 40);
  const send = page.getByRole('button', { name: 'Send message' });
  await expect.poll(async () => {
    const box = (await send.boundingBox())!;
    return box.y + box.height;
  }).toBeLessThanOrEqual(365);
  await expect(send).toBeEnabled();
  await expect(page.getByRole('button', { name: 'More pages' })).toBeHidden();

  await setVisualViewport(page, layoutHeight);
  await expect(page.getByRole('button', { name: 'More pages' })).toBeVisible();
  await expect(composer).toHaveValue('How long should I rest between sets?');
  await setVisualViewport(page, 300, 35, 2);
  await expect(page.getByRole('button', { name: 'More pages' })).toBeVisible();
});

test('Jern dashboard fits the phone viewport', async ({ page }, testInfo) => {
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

  const screenshot = testInfo.outputPath('jern-dashboard.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach(`${testInfo.project.name} dashboard`, { path: screenshot, contentType: 'image/png' });
});

test('keeps the dashboard and More actions reachable on a short display', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 375 });
  await page.goto('/');
  const calendar = page.getByRole('button', { name: 'Calendar →', exact: true });
  await calendar.scrollIntoViewIfNeeded();
  const more = page.getByRole('button', { name: 'More pages' });
  await expect.poll(async () => {
    const action = (await calendar.boundingBox())!;
    return action.y + action.height - (await more.boundingBox())!.y;
  }).toBeLessThanOrEqual(0);

  await more.tap();
  const menu = page.getByRole('dialog', { name: 'More' });
  const progress = menu.getByRole('button', { name: /Progress/ });
  await expect(progress).toBeInViewport();
  const settings = menu.getByRole('button', { name: /Settings/ });
  await settings.tap();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('advertises a full-screen Home Screen launch', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Jern');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute('href');
  const response = await request.get(manifestUrl!);
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['fullscreen'],
  });
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

test('stops iOS from zooming into small fields without limiting Android pinch-zoom', async ({ page }) => {
  await page.goto('/');
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  const ios = /iPhone|iPad/.test(await page.evaluate(() => navigator.userAgent));
  if (ios) expect(viewport).toContain('maximum-scale=1');
  else expect(viewport).not.toContain('maximum-scale');
  expect(viewport).not.toContain('user-scalable');
});

test('responds to taps like an installed app', async ({ page }) => {
  await page.goto('/');
  const more = page.getByRole('button', { name: 'More pages' });
  await expect(more).toBeVisible();
  const style = await more.evaluate(element => {
    const computed = getComputedStyle(element);
    return {
      touch: matchMedia('(hover: none) and (pointer: coarse)').matches,
      highlight: computed.getPropertyValue('-webkit-tap-highlight-color'),
      touchAction: computed.touchAction,
      userSelect: computed.getPropertyValue('-webkit-user-select') || computed.userSelect,
    };
  });
  // Desktop WebKit omits this iOS-only property; Chromium reports it.
  if (style.highlight) expect(style.highlight).toBe('rgba(0, 0, 0, 0)');
  expect(style.touch).toBe(true);
  expect(style.touchAction).toBe('manipulation');
  expect(style.userSelect).toBe('none');
});

test('keeps the screen awake only while a live workout is open', async ({ page }) => {
  await page.addInitScript(() => {
    const log: string[] = [];
    const locks: { released: boolean }[] = [];
    Object.assign(window, { wakeLockLog: log, wakeLocks: locks });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async (type: string) => {
          log.push(`request:${type}`);
          const lock = { released: false, release: async () => { lock.released = true; log.push('release'); } };
          locks.push(lock);
          return lock;
        },
      },
    });
  });
  await page.route('**/api/v1/workouts/active', route => route.fulfill({ json: [workout] }));
  await page.route('**/api/v1/workouts/42', route => route.fulfill({ json: { ...workout, revision: 2 } }));
  await page.goto('/');
  // React's development double-mount may request and release once more; count what is held.
  const wakeLocks = () => page.evaluate(() => {
    const { wakeLockLog, wakeLocks } = window as unknown as { wakeLockLog: string[]; wakeLocks: { released: boolean }[] };
    return { requests: wakeLockLog.filter(entry => entry === 'request:screen').length, held: wakeLocks.filter(lock => !lock.released).length };
  });
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect(await wakeLocks()).toEqual({ requests: 0, held: 0 });

  await page.getByRole('button', { name: 'Resume', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Substitute', exact: true })).toBeVisible();
  await expect.poll(async () => (await wakeLocks()).held).toBe(1);
  const before = (await wakeLocks()).requests;

  // The system drops the lock while the app is in the background.
  await page.evaluate(() => {
    for (const lock of (window as unknown as { wakeLocks: { released: boolean }[] }).wakeLocks) lock.released = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(wakeLocks).toEqual({ requests: before + 1, held: 1 });

  await page.getByRole('button', { name: 'Dashboard', exact: true }).tap();
  await expect.poll(async () => (await wakeLocks()).held).toBe(0);
});

test('refreshes the overview when the app returns after a break', async ({ page }) => {
  const dashboardRequests: number[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/dashboard') dashboardRequests.push(Date.now()); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Go to Overview' })).toBeVisible();
  // Development mode may load twice on start; wait for start-up loading to settle.
  await page.waitForLoadState('networkidle');
  const initial = dashboardRequests.length;
  const setVisibility = (state: 'hidden' | 'visible', awayMinutes = 0) => page.evaluate(({ state, awayMinutes }) => {
    if (awayMinutes) {
      const now = Date.now.bind(Date);
      Date.now = () => now() + awayMinutes * 60_000;
    }
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  }, { state, awayMinutes });

  await setVisibility('hidden');
  await setVisibility('visible', 1);
  await page.waitForTimeout(300);
  expect(dashboardRequests).toHaveLength(initial);

  await setVisibility('hidden');
  await setVisibility('visible', 6);
  await expect.poll(() => dashboardRequests.length).toBe(initial + 1);
});

// Android's system Back gesture is a history traversal; history.back() performs the same one.
const pressBack = (page: Page) => page.evaluate(() => window.history.back());

test('Back closes the More sheet, returns to the Dashboard, then leaves the app', async ({ page }) => {
  await page.goto('about:blank');
  await page.goto('/');
  const dashboard = page.getByRole('button', { name: 'Dashboard', exact: true });
  await expect(dashboard).toHaveClass(/active/);

  await page.getByRole('button', { name: 'Routines', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Routines', exact: true })).toHaveClass(/active/);
  await page.getByRole('button', { name: 'More pages' }).tap();
  const menu = page.getByRole('dialog', { name: 'More' });
  await expect(menu).toBeVisible();

  await pressBack(page);
  await expect(menu).toBeHidden();
  await expect(page.getByRole('button', { name: 'Routines', exact: true })).toHaveClass(/active/);

  await pressBack(page);
  await expect(dashboard).toHaveClass(/active/);

  // Switching tabs and returning by tap must not leave an extra Back step behind.
  await page.getByRole('button', { name: 'Coach', exact: true }).tap();
  await dashboard.tap();
  await expect(dashboard).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => (window.history.state as { jernBack?: number } | null)?.jernBack ?? 0)).toBe(0);

  await pressBack(page);
  await expect(page).toHaveURL('about:blank');
});

test('Back closes the workout search before leaving the workout', async ({ page }) => {
  await page.route('**/api/v1/workouts/active', route => route.fulfill({ json: [workout] }));
  await page.route('**/api/v1/workouts/42', route => route.fulfill({ json: { ...workout, revision: 2 } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Resume', exact: true }).tap();
  await page.getByRole('button', { name: 'Substitute', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Replace exercise' });
  await expect(dialog).toBeVisible();

  await pressBack(page);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Substitute', exact: true })).toBeVisible();

  await pressBack(page);
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
});

test('Back closes the History workout details, then returns to the Dashboard', async ({ page }) => {
  await page.route('**/api/v1/workouts', route => route.fulfill({ json: [{ ...workout, completed: true }] }));
  await page.goto('/');
  await page.getByRole('button', { name: 'More pages' }).tap();
  await page.getByRole('dialog', { name: 'More' }).getByRole('button', { name: /History/ }).tap();
  await page.getByRole('button', { name: /Leg day/ }).tap();
  const close = page.getByRole('button', { name: 'Close workout details' });
  await expect(close).toBeVisible();

  await pressBack(page);
  await expect(close).toBeHidden();
  await expect(page.getByRole('button', { name: /Leg day/ })).toBeVisible();

  await pressBack(page);
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toHaveClass(/active/);
});
