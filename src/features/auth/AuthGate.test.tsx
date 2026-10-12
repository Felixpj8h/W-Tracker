// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
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
});
