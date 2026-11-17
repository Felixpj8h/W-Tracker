// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Health, healthToday, recoveryPrompt } from './Health';
import type { HealthOverview } from './types';
import { api } from '../../shared/api/client';
import { Sidebar } from '../../app/Sidebar';
import { MobileNavigation } from '../../app/MobileNavigation';

vi.mock('../../shared/api/client', () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); window.history.replaceState(null, '', '/'); });
const overview = (): HealthOverview => ({ configured: true, connected: true, account_email: 'me@example.com', permissions: { activity: true, sleep: true, recovery: true }, step_goal: 8000, fetched_at: Date.now() / 1000, data: { days: [{ date: healthToday(), steps: null, active_minutes: null, sleep_minutes: 440, hrv: 56, resting_hr: 53 }], sleep: { date: healthToday(), start: null, end: null, minutes: 440, stages: [] }, workouts: [], warnings: {} } });

describe('Health page', () => {
  it('shows setup and keeps connection disabled without credentials', async () => {
    vi.mocked(api).mockResolvedValue({ ...overview(), connected: false, configured: false, data: null });
    render(<Health askCoach={vi.fn()} />);
    await screen.findByText('Connection not configured yet.');
    expect((screen.getByRole('button', { name: 'Connect Google Health' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('preserves unavailable readings and does not manufacture sleep stages', async () => {
    vi.mocked(api).mockResolvedValue(overview());
    render(<Health askCoach={vi.fn()} />);
    await screen.findByText('No steps recorded for today yet.');
    expect(screen.getByText('Sleep stages are not available for this session.')).toBeTruthy();
    expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(0);
    expect(screen.queryByText('0% of your 8,000 step goal')).toBeNull();
  });
  it('only shares a dated summary when the user requests recovery advice', async () => {
    const data = overview(), ask = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api).mockResolvedValue(data);
    render(<Health askCoach={ask} />);
    await screen.findByText('Listen to your baseline');
    expect(ask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Ask coach about recovery/ }));
    await waitFor(() => expect(ask).toHaveBeenCalledWith(recoveryPrompt(data)));
    expect(ask.mock.calls[0][0]).toContain('do not create, change or apply');
    expect(ask.mock.calls[0][0]).not.toContain('me@example.com');
  });
  it('retains cached readings and displays sync failures', async () => {
    vi.mocked(api).mockResolvedValueOnce({ ...overview(), fetched_at: 1 }).mockRejectedValueOnce(new Error('Reconnect Google Health to renew access.'));
    render(<Health askCoach={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('Reconnect');
    expect(screen.getByText('Listen to your baseline')).toBeTruthy();
    expect(screen.getByText('Showing previously fetched data. Sync for a more recent view.')).toBeTruthy();
  });
  it('offers Health in desktop and mobile navigation without exposing it in the demo', () => {
    const setPage = vi.fn();
    const { unmount } = render(<Sidebar page="dashboard" setPage={setPage} dark setDark={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Health' }));
    expect(setPage).toHaveBeenCalledWith('health'); unmount();
    render(<MobileNavigation page="dashboard" setPage={setPage} dashboardPage={0} setDashboardPage={vi.fn()} dark setDark={vi.fn()} logWorkout={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More pages' }));
    fireEvent.click(screen.getByRole('button', { name: /Health/ }));
    expect(setPage).toHaveBeenCalledWith('health'); cleanup();
    render(<Sidebar readOnly page="dashboard" setPage={setPage} dark setDark={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Health' })).toBeNull();
  });
});
