// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App';
import { demoApi } from './api';
import { setGoogleIdToken } from '../auth/auth';

const workout = { id: 1, name: 'Public workout', completed: true, performed_on: '2026-10-13', duration_seconds: 300,
  exercises: [{ name: 'Bench', cached_exercise_id: 1, sets: [{ weight: 60, reps: 8 }] }] };
const routine = { id: 1, name: 'Public routine', exercises: [{ exercise: { id: 1, name: 'Bench' }, planned_sets: 3, target_reps: 8, rest_seconds: 90 }] };
const dash = { latest_weight: { recorded_on: '2026-10-13', weight: 80 }, weight_series: [{ recorded_on: '2026-10-12', weight: 79.5 }, { recorded_on: '2026-10-13', weight: 80 }], total_current_volume: 480, total_previous_volume: 400, volume_by_muscle_group: [{ name: 'Chest', current_week_volume: 480, last_week_volume: 400 }], sets_by_muscle: [] };
const responseFor = (url: string) => {
  if (url.includes('/dashboard/body-map')) return { muscles: [] };
  if (url.includes('/dashboard')) return dash;
  if (url.includes('/folders')) return [{ id: 1, name: 'Public folder', routines: [routine] }];
  if (url.includes('/workouts')) return [workout];
  if (url.includes('/calendar')) return { plan: null, days: [{ date: '2026-10-13', routine_id: 1, routine_name: 'Public routine', status: 'completed', workout_name: 'Public workout' }] };
  throw new Error(`Unexpected request: ${url}`);
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  window.history.replaceState(null, '', '/demo#workout=untrusted');
  localStorage.setItem('workout-active-session', 'PRIVATE_DRAFT_SENTINEL');
  setGoogleIdToken('PRIVATE_TOKEN');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => responseFor(url) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setGoogleIdToken(''); localStorage.clear(); window.history.replaceState(null, '', '/'); });

const clickPage = async (page: string) => {
  fireEvent.click(screen.getAllByRole('button', { name: page })[0]);
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
};

describe('Public demo workspace', () => {
  it('uses only credential-free public GETs and keeps every page read only', async () => {
    const before = localStorage.getItem('workout-active-session');
    render(<App/>);
    await screen.findByText('Live demo · Read only');
    await screen.findByText('Weekly volume');
    for (const page of ['Routines', 'Calendar', 'History', 'Dashboard']) {
      await clickPage(page);
      for (const button of screen.queryAllByRole('button', { name: /^(Log workout|＋ Log workout|Coach|Edit session|Add note|Import from link|Create folder|Start|Plan week)$/ })) {
        expect((button as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(button);
      }
      expect(screen.queryByText('Test full map')).toBeNull();
    }
    expect(localStorage.getItem('workout-active-session')).toBe(before);
    for (const [url, options] of vi.mocked(fetch).mock.calls) {
      expect(String(url)).toContain('/api/v1/demo/');
      expect(options?.method).toBe('GET');
      expect(options?.credentials).toBe('omit');
      expect(new Headers(options?.headers).has('Authorization')).toBe(false);
    }
  });

  it('opens routine details, completed history and analysis without editors', async () => {
    render(<App/>);
    await screen.findByText('Weekly volume');
    await clickPage('Routines');
    fireEvent.click(screen.getByRole('button', { name: /Public routine/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('dialog').querySelector('.rest-builder-list')).toBeTruthy();
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    await clickPage('History');
    expect(screen.getAllByText('Public workout').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Analysis' }));
    expect(screen.queryByRole('button', { name: 'Edit session' })).toBeNull();
  });

  it('keeps the normal dashboard, calendar and mobile navigation layouts', async () => {
    render(<App/>);
    await screen.findByText('Weekly volume');
    expect(screen.getByText('Current weight')).toBeTruthy();
    expect(screen.getByText('Bodyweight')).toBeTruthy();
    expect(screen.getByRole('button', { name: /80 kilograms/ })).toBeTruthy();
    expect(screen.queryByText('Private data')).toBeNull();
    expect(document.querySelector('.dashboard-weight')).toBeTruthy();
    expect(document.querySelector('.demo-banner')).toBeNull();
    expect(document.querySelector('.demo-body-map')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More pages' }));
    const more = screen.getByRole('dialog', { name: 'More' });
    expect(within(more).getByRole('button', { name: 'Exit demo' })).toBeTruthy();
    fireEvent.click(within(more).getByRole('button', { name: /Calendar/ }));
    await screen.findByRole('button', { name: 'Plan week' });
    expect(document.querySelector('.training-calendar')).toBeTruthy();
    expect(document.querySelector('.training-detail')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Plan week' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'View workout' }));
    const details = screen.getByRole('dialog', { name: 'Workout details' });
    expect((within(details).getByRole('button', { name: 'Edit workout' }) as HTMLButtonElement).disabled).toBe(true);
    expect(vi.mocked(fetch).mock.calls.every(([url, options]) => String(url).includes('/demo/') && options?.method === 'GET')).toBe(true);
  });

  it('exits to login without restoring or deleting an authenticated session', async () => {
    render(<App/>);
    await screen.findByText('Weekly volume');
    const count = vi.mocked(fetch).mock.calls.length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Exit demo' })[0]);
    expect(window.location.pathname).toBe('/');
    expect(await screen.findByRole('button', { name: 'Explore demo' })).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls).toHaveLength(count);
    fireEvent.click(screen.getByRole('button', { name: 'Explore demo' }));
    expect(window.location.pathname).toBe('/demo');
    await screen.findByText('Weekly volume');
  });

  it('fails closed when the demo is unavailable and retries only public endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    render(<App/>);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Public workout')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry demo' }));
    await screen.findByRole('alert');
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes('/demo/'))).toBe(true);
  });

  it('rejects mutations before network calls, regardless of supplied credentials', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      await expect(demoApi('/workouts/1', { method, headers: { Authorization: 'Bearer forged' } })).rejects.toThrow('read only');
    }
    expect(fetch).not.toHaveBeenCalled();
    await expect(demoApi('/../workouts')).rejects.toThrow('Invalid demo path');
    await act(async () => { await demoApi('/workouts', { headers: { Authorization: 'Bearer forged' }, credentials: 'include' }); });
    const options = vi.mocked(fetch).mock.calls[0][1];
    expect(options?.credentials).toBe('omit');
    expect(new Headers(options?.headers).has('Authorization')).toBe(false);
  });
});
