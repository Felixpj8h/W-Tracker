// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';
import { accountKey } from './auth';
import { ACTIVE_WORKOUT_KEY } from '../workout/session';

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Session restoration', () => {
  it('exits a stalled request and offers a retry', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'athlete@example.com', name: 'Athlete' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthGate>{user => <div>Workspace for {user.email}</div>}</AuthGate>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(screen.queryByText(/Connecting to the local backend/)).toBeNull();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    // Local development uses a reload for retries; deployed builds retry in place.
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeTruthy();
  });

  it('opens the workspace after a valid session response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: 'athlete@example.com', name: 'Athlete' }) }));
    render(<AuthGate>{user => <div>Workspace for {user.email}</div>}</AuthGate>);
    expect(await screen.findByText('Workspace for athlete@example.com')).toBeTruthy();
  });

  it('shows a retry after connection failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<AuthGate>{() => <div>Workspace</div>}</AuthGate>);
    expect(await screen.findByRole('button', { name: 'Retry connection' })).toBeTruthy();
  });

  it('keeps the workspace closed and offers retry when server logout fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ email: 'athlete@example.com', name: 'Athlete' }) })
      .mockRejectedValueOnce(new TypeError('Offline'))
      .mockResolvedValue({ ok: true, json: async () => ({ saved: true }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<AuthGate>{() => <div>Private workspace</div>}</AuthGate>);
    await screen.findByText('Private workspace');
    const localDraft = JSON.stringify({ id: 42, name: 'Unsynced workout', exercises: [] });
    const key = accountKey(ACTIVE_WORKOUT_KEY);
    localStorage.setItem(key, localDraft);
    await act(async () => window.dispatchEvent(new Event('google-sign-out')));
    const retry = await screen.findByRole('button', { name: 'Retry sign out' });
    expect(screen.queryByText('Private workspace')).toBeNull();
    expect(localStorage.getItem(key)).toBe(localDraft);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry sign out' })).toBeNull());
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/session/logout'))).toHaveLength(2);
    expect(localStorage.getItem(key)).toBe(localDraft);
  });
});

it('loads a fresh Google sign-in script when retrying a failed script request', async () => {
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
  vi.resetModules();
  const { AuthGate: GoogleAuthGate } = await import('./AuthGate');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
  const script = () => document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
  render(<GoogleAuthGate>{() => <div>Workspace</div>}</GoogleAuthGate>);
  await waitFor(() => expect(script()).toBeTruthy());
  const failedScript = script()!;
  fireEvent.error(failedScript);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not load Google sign-in. Check your connection.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
  await waitFor(() => expect(script()).toBeTruthy());
  expect(script()).not.toBe(failedScript);
  script()?.remove();
});
