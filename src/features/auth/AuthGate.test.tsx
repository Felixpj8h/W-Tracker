// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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
    await act(async () => window.dispatchEvent(new Event('google-sign-out')));
    const retry = await screen.findByRole('button', { name: 'Retry sign out' });
    expect(screen.queryByText('Private workspace')).toBeNull();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry sign out' })).toBeNull());
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/session/logout'))).toHaveLength(2);
  });
});
