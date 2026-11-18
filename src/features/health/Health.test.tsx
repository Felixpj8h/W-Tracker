// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Health, healthToday } from './Health';
import type { HealthOverview } from './types';
import { api } from '../../shared/api/client';
import { Sidebar } from '../../app/Sidebar';
import { MobileNavigation } from '../../app/MobileNavigation';

vi.mock('../../shared/api/client', () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
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
  it('retains cached readings and displays sync failures', async () => {
    vi.mocked(api).mockResolvedValueOnce({ ...overview(), fetched_at: 1 }).mockRejectedValueOnce(new Error('Reconnect Google Health to renew access.'));
    render(<Health askCoach={vi.fn()} />);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('Reconnect');
    expect(screen.getByRole('heading', { name: 'Recovery' })).toBeTruthy();
    expect(screen.getByText(/Last sync/)).toBeTruthy();
  });
  it('switches the desktop baseline chart between recovery metrics', async () => {
    const data = overview();
    const today = data.data!.days[0];
    const earlierReadings = [[50, 60], [52, 62], [null, null], [54, 64]] as const;
    data.data!.days.unshift(...earlierReadings.map(([hrv, resting_hr], index) => {
      const date = new Date(`${today.date}T12:00:00`);
      date.setDate(date.getDate() - (earlierReadings.length - index));
      return { ...today, date: healthToday(date), hrv, resting_hr };
    }));
    vi.mocked(api).mockResolvedValue(data);
    render(<Health askCoach={vi.fn()} />);

    const hrv = await screen.findByRole('button', { name: /^HRV/ });
    expect(screen.getAllByRole('button', { name: 'Ask coach' })).toHaveLength(1);
    expect(hrv.getAttribute('aria-pressed')).toBe('true');
    const hrvTrend = screen.getByRole('img', { name: /^HRV trend/ });
    expect(hrvTrend.getAttribute('aria-label')).toContain('no reading');
    expect(hrvTrend.textContent).toContain('Baseline · 52 ms');
    expect(hrvTrend.querySelectorAll('svg line')).toHaveLength(3);

    const restingHr = screen.getByRole('button', { name: /^Resting heart rate/ });
    fireEvent.click(restingHr);
    expect(restingHr.getAttribute('aria-pressed')).toBe('true');
    expect(hrv.getAttribute('aria-pressed')).toBe('false');
    const heartRateTrend = screen.getByRole('img', { name: /^Resting heart rate trend/ });
    expect(heartRateTrend.textContent).toContain('Baseline · 62 bpm');
    expect(screen.queryByRole('img', { name: /^HRV trend/ })).toBeNull();
  });
  it('shares only the selected health topic after confirmation', async () => {
    const data = overview();
    data.data!.days[0].steps = 7200;
    vi.mocked(api).mockResolvedValue(data);
    const askCoach = vi.fn().mockResolvedValue(undefined);
    render(<Health askCoach={askCoach} />);

    const open = await screen.findByRole('button', { name: 'Ask coach' });
    const modal = document.querySelector<HTMLDialogElement>('dialog[aria-labelledby="health-coach-title"]')!;
    Object.assign(modal, {
      showModal: () => { modal.open = true; },
      close: () => { modal.open = false; },
    });
    fireEvent.click(open);
    const dialog = within(screen.getByRole('dialog', { name: 'Ask coach' }));
    expect(dialog.getAllByRole('radio')).toHaveLength(4);
    expect((dialog.getByRole('radio', { name: /Activity/ }) as HTMLInputElement).disabled).toBe(true);
    const send = dialog.getByRole('button', { name: 'Send to coach' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(dialog.getByRole('radio', { name: 'Sleep' }));
    expect(askCoach).not.toHaveBeenCalled();
    vi.spyOn(modal, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 300, 400));
    fireEvent.pointerDown(modal, { clientX: 120, clientY: 120 });
    fireEvent.click(modal, { clientX: 120, clientY: 120 });
    expect(modal.open).toBe(true);
    fireEvent.pointerDown(modal, { clientX: 50, clientY: 50 });
    fireEvent.click(modal, { clientX: 50, clientY: 50 });
    expect(modal.open).toBe(false);
    fireEvent.click(open);
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(askCoach).not.toHaveBeenCalled();

    fireEvent.click(open);
    expect(send.disabled).toBe(true);
    fireEvent.click(dialog.getByRole('radio', { name: 'Steps' }));
    const question = 'Am I getting close to my goal?\nSuggest a realistic next step.';
    fireEvent.change(dialog.getByRole('textbox', { name: /Your question/ }), { target: { value: question } });
    fireEvent.click(send);
    expect(askCoach).toHaveBeenCalledTimes(1);
    const sent = askCoach.mock.calls[0][0] as string;
    expect(sent.startsWith(`${question}\n\n`)).toBe(true);
    expect(JSON.parse(sent.split('\n').at(-1)!)).toEqual({
      daily_step_goal: 8000, days: [{ date: healthToday(), steps: 7200 }],
    });
    await waitFor(() => expect(modal.open).toBe(false));
  });
  it('opens on the mobile summary and supports swipes and direct detail tabs', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const data = overview();
    const previousDay = new Date();
    previousDay.setDate(previousDay.getDate() - 1);
    data.data!.days[0].active_minutes = 105;
    data.data!.days[0].steps = 3000;
    data.data?.days.unshift({ date: healthToday(previousDay), steps: 9000, active_minutes: 82, sleep_minutes: 510, hrv: null, resting_hr: null });
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const yesterday = new Date(`${healthToday(previousDay)}T00:00:00`);
    const dayHours = (midnight.getTime() - yesterday.getTime()) / 3600000;
    const hoursAgo = (hours: number) => new Date(midnight.getTime() - hours * 3600000).toISOString();
    data.data!.sleep = { date: healthToday(), start: hoursAgo(2), end: hoursAgo(-6), minutes: 440,
      stages: [{ start: hoursAgo(2), end: hoursAgo(-6), type: 'LIGHT' }] };
    data.data!.sleep_intervals = [{ start: hoursAgo(dayHours + 1), end: hoursAgo(dayHours - 1), minutes: 108, stages: [
      { start: hoursAgo(dayHours + 1), end: hoursAgo(dayHours - .8), type: 'LIGHT' },
      { start: hoursAgo(dayHours - .8), end: hoursAgo(dayHours - 1), type: 'AWAKE' },
    ] }];
    data.data?.workouts.push(
      { date: healthToday(), type: 'WALKING', minutes: 60, start: hoursAgo(3), end: hoursAgo(2) },
      { date: healthToday(), type: 'CYCLING', minutes: 45, start: hoursAgo(2.5), end: hoursAgo(1.75) },
      { date: healthToday(), type: 'RUNNING', minutes: 60, start: hoursAgo(-1), end: hoursAgo(-2) },
    );
    vi.mocked(api).mockResolvedValue(data);
    render(<Health askCoach={vi.fn()} />);

    const tabs = await screen.findByRole('tablist', { name: 'Health widgets' });
    const swipe = (target: Element, dx = -100, dy = 2) => {
      const pointer = { isPrimary: true, pointerId: 1 };
      fireEvent.pointerDown(target, { ...pointer, button: 0, clientX: 200, clientY: 40 });
      fireEvent.pointerUp(target, { ...pointer, clientX: 200 + dx, clientY: 40 + dy });
    };
    const summary = screen.getByRole('tabpanel', { name: 'Overview' });
    expect(within(summary).getAllByRole('article').map(metric => metric.getAttribute('aria-label'))).toEqual(['Steps', 'Activity', 'Sleep', 'Recovery']);
    swipe(summary);
    expect(within(tabs).getByRole('tab', { name: 'Steps', selected: true })).toBeTruthy();
    const steps = screen.getByRole('tabpanel', { name: 'Steps' });
    expect(within(steps).getByRole('spinbutton', { name: 'Daily step goal' })).toBeTruthy();
    expect(within(steps).queryByRole('tablist')).toBeNull();
    expect(within(steps).getByRole('progressbar').hasAttribute('data-below-target')).toBe(true);
    const stepChart = within(steps).getByRole('img', { name: /^Daily steps/ });
    expect(stepChart.querySelectorAll('[data-below-target]')).toHaveLength(1);
    swipe(stepChart, -10, 100);
    expect(within(tabs).getByRole('tab', { name: 'Steps', selected: true })).toBeTruthy();

    swipe(stepChart);
    const activity = screen.getByRole('tabpanel', { name: 'Activity' });
    expect(within(activity).queryByRole('tablist')).toBeNull();
    expect(within(activity).getByText('active min today').parentElement?.textContent).toBe('105 active min today');
    expect(within(activity).getByRole('img', { name: /^Active minutes/ })).toBeTruthy();
    expect(within(activity).getByText('active min yesterday').parentElement?.textContent).toBe('82 active min yesterday');
    const chart = within(activity).getByRole('img', { name: /^Activity yesterday/ });
    expect(chart.querySelectorAll('circle')).toHaveLength(4);
    expect(Array.from(activity.querySelectorAll('dd'), value => value.textContent)).toEqual(['48m', '30m', '45m', `${dayHours - 3}h 57m`]);

    swipe(chart.querySelector('circle')!);
    const sleep = screen.getByRole('tabpanel', { name: 'Sleep' });
    expect(within(sleep).queryByRole('tab', { name: '7 days' })).toBeNull();
    const sleepWeek = within(sleep).getByRole('list', { name: 'Sleep durations for the last seven days' });
    expect(sleepWeek.textContent).toContain('35m shorter than your 7-day average');

    expect(within(sleep).getByRole('tab', { name: 'Intervals' })).toBeTruthy();
    swipe(within(sleep).getByRole('img', { name: 'Sleep stage timeline' }));
    const recovery = screen.getByRole('tabpanel', { name: 'Recovery' });
    expect(within(recovery).queryByRole('tablist')).toBeNull();
    const hrvChart = within(recovery).getByRole('img', { name: /^HRV trend.*56 ms/ });
    expect(within(recovery).getByRole('img', { name: /^Resting heart rate trend.*53 bpm/ })).toBeTruthy();
    swipe(hrvChart, 100);
    expect(within(tabs).getByRole('tab', { name: 'Sleep', selected: true })).toBeTruthy();
  });
  it('advances the fixed activity clock and syncs at local midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 18, 23, 59, 59));
    const data = overview();
    vi.mocked(api).mockResolvedValue(data);
    await act(async () => { render(<Health askCoach={vi.fn()} />); });
    fireEvent.click(screen.getByRole('tab', { name: 'Yesterday' }));
    const chart = screen.getByRole('img', { name: /^Activity yesterday/ });
    const date = (day: number) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(2026, 10, day));
    expect(chart.getAttribute('aria-label')).toContain(date(17));
    expect(Array.from(chart.querySelectorAll('text'), node => node.textContent).slice(0, 4)).toEqual(['12:00', '18:00', '24:00', '06:00']);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(chart.getAttribute('aria-label')).toContain(date(18));
    expect(api).toHaveBeenLastCalledWith('/health/sync', { method: 'POST', body: '{"today":"2026-11-19"}' });
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
