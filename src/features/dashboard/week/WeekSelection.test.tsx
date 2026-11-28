// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardPanels } from '../DashboardPanels';
import { addDays, compactRangeLabel, startOfWeek } from './weekDates';
import { clearBodyMapCache } from '../muscles/bodyMapData';
import { today } from '../../../shared/lib/format';
import type { Dash } from '../types';
import type { Workout } from '../../workout/types';

vi.mock('../../../shared/ui/AnimatedValue', () => ({ AnimatedValue: ({ value }: { value: string }) => <span>{value}</span> }));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const current = startOfWeek(today());
const previous = addDays(current, -7);
const dash: Dash = { latest_weight: { weight: 80, recorded_on: today() }, weight_series: [], total_current_volume: 100, total_previous_volume: 50, current_sessions: 1, previous_sessions: 0,
    volume_by_muscle_group: [{ name: 'Chest', current_week_volume: 100, last_week_volume: 50 }],
    sets_by_muscle: [{ name: 'Chest', current_week_sets: 2, last_week_sets: 1 }] };
const rollingStats = {
    sessions: 2,
    volume: 350,
    volume_by_muscle_group: [{ name: 'Chest', volume: 350 }],
    sets_by_muscle: [{ name: 'Pectoralis major', sets: 5 }],
};

function setup({
    profilePicture,
    summary = dash,
    history = [{ id: 1, name: 'Past workout', routine_id: 1, performed_on: previous, completed: true, exercises: [] }],
}: { profilePicture?: string; summary?: Dash; history?: Workout[] } = {}) {
    const fetchMock = vi.fn(async (url: string) => {
        let data: unknown;
        if (url.includes('/body-map')) data = { muscles: [] };
        else if (url.includes('/calendar')) {
            const params = new URL(url, 'http://localhost').searchParams;
            const year = Number(params.get('year')), month = Number(params.get('month'));
            data = { plan: null, days: Array.from({ length: new Date(year, month, 0).getDate() }, (_, day) => ({ date: `${year}-${String(month).padStart(2, '0')}-${String(day + 1).padStart(2, '0')}`, routine_id: 1, routine_name: 'Scheduled', status: 'upcoming' })) };
        } else data = { ...dash, total_current_volume: 250, current_sessions: 1 };
        return { ok: true, json: async () => data };
    });
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<DashboardPanels dash={summary} history={history} historyLoaded firstName="Athlete" profilePicture={profilePicture} log={vi.fn()} openCalendar={vi.fn()} saveWeight={async () => undefined}/>);
    fireEvent.click(screen.getByRole('button', { name: /^(This week|Last 7 days)/ }));
    return { fetchMock, view };
}

it('shows the Google photo in the mobile header and falls back on an image error', async () => {
    const picture = 'https://lh3.googleusercontent.com/profile-photo';
    const { view } = setup({ profilePicture: picture });
    const avatar = view.container.querySelector('.mobile-dashboard-topbar .profile-avatar')!;
    const image = avatar.querySelector('img')!;
    expect(image.getAttribute('src')).toBe(picture);
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(image);
    expect(avatar.querySelector('img')).toBeNull();
    expect(avatar.textContent).toBe('A');
    await waitFor(() => expect(fetch).toHaveBeenCalled());
});

it('browses weeks, updates stats and heatmap, and returns to the current week', async () => {
    const { fetchMock, view } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await waitFor(() => expect(screen.getByText('250 kg')).toBeTruthy());
    expect(fetchMock.mock.calls.some(([url]) => url.includes(`selected_week=${previous}`))).toBe(true);
    await screen.findByText('1 of 7 workouts completed');
    expect(within(view.container.querySelector('.week-overview')!).getByText('Past workout')).toBeTruthy();
    expect(screen.getByText('80.0 kg')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Heatmap' }));
    await screen.findAllByRole('img', { name: /No muscles trained/ });
    expect(fetchMock.mock.calls.some(([url]) => url.includes(`/body-map?selected_week=${previous}`))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Back to this week' }));
    expect(screen.getByText('Weekly volume')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next week' }) as HTMLButtonElement).disabled).toBe(true);
});

it('shows rolling totals for an empty current week and keeps the latest completed workout across week selections', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 24, 12));
    const { view } = setup({
        summary: { ...dash, current_sessions: 0, total_current_volume: 0, last_seven_days: rollingStats },
        history: [
            { name: 'Earlier workout', performed_on: '2026-11-18', completed: true, exercises: [] },
            { name: 'Unfinished workout', performed_on: '2026-11-24', completed: false, exercises: [] },
            { name: 'Latest workout', performed_on: '2026-11-22', completed: true, exercises: [] },
        ],
    });
    const metrics = within(screen.getByRole('region', { name: 'Training summary' }));
    expect(metrics.getByText('Volume last 7 days').closest('article')?.querySelector('strong')?.textContent).toBe('350 kg');
    expect(metrics.getByText('Sessions last 7 days').closest('article')?.querySelector('strong')?.textContent).toBe('2');
    expect(metrics.getByText('2 days ago')).toBeTruthy();
    const musclePanel = within(screen.getByRole('heading', { name: 'Volume by muscle group' }).closest('article')!);
    expect(musclePanel.getByText('Last 7 days')).toBeTruthy();
    expect(musclePanel.getByText('350 kg')).toBeTruthy();
    expect(musclePanel.queryByText('+100%')).toBeNull();
    fireEvent.click(musclePanel.getByRole('button', { name: 'Sets' }));
    expect(musclePanel.getByText('Last 7 days')).toBeTruthy();
    expect(musclePanel.getByText('Chest').closest('.muscle-row')?.textContent).toContain('5 sets');
    expect(musclePanel.queryByText('+100%')).toBeNull();
    await within(view.container.querySelector('.week-overview')!).findByText('0 of 7 workouts completed');
    // The selector names the period on screen and hides week browsing until Week is chosen.
    expect(screen.getByRole('button', { name: /^Last 7 days/, expanded: true })).toBeTruthy();
    expect(screen.queryByLabelText('Select week')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(metrics.getByText('Weekly volume')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^This week/, expanded: true })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Select week'), { target: { value: '2026-11-09' } });
    await metrics.findByText('250 kg');
    expect(metrics.getByText('Selected week volume')).toBeTruthy();
    expect(metrics.getByText('2 days ago')).toBeTruthy();
    expect(musclePanel.queryByText('Last 7 days')).toBeNull();
    expect(musclePanel.getByText('2 sets')).toBeTruthy();
    expect(musclePanel.getByText('+100%')).toBeTruthy();
    fireEvent.click(musclePanel.getByRole('button', { name: 'Volume' }));
    expect(musclePanel.getByText('100 kg')).toBeTruthy();
});

it('counts yesterday as one calendar day and keeps weekly stats for zero-volume workouts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 24, 12));
    setup({
        summary: { ...dash, total_current_volume: 0, last_seven_days: rollingStats },
        history: [{ name: 'Bodyweight workout', performed_on: '2026-11-23', completed: true, exercises: [] }],
    });
    const metrics = within(screen.getByRole('region', { name: 'Training summary' }));
    expect(metrics.getByText('Weekly volume')).toBeTruthy();
    expect(metrics.getByText('Sessions this week')).toBeTruthy();
    expect(metrics.getByText('Yesterday')).toBeTruthy();
    const musclePanel = within(screen.getByRole('heading', { name: 'Volume by muscle group' }).closest('article')!);
    expect(musclePanel.queryByText('Last 7 days')).toBeNull();
    expect(musclePanel.getByText('100 kg')).toBeTruthy();
    fireEvent.click(musclePanel.getByRole('button', { name: 'Sets' }));
    expect(musclePanel.getByText('2 sets')).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
});

it('sends fair-comparison, average and custom-week choices to the dashboard', async () => {
    const { fetchMock } = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Compare through today only' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('through_today=true'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'average' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('comparison=average'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'custom' } });
    fireEvent.click(screen.getByRole('button', { name: 'Previous comparison week' }));
    expect((screen.getByLabelText('Comparison week') as HTMLInputElement).value).toBe(addDays(current, -14));
    fireEvent.click(screen.getByRole('button', { name: 'Next comparison week' }));
    expect((screen.getByLabelText('Comparison week') as HTMLInputElement).value).toBe(previous);
    fireEvent.change(screen.getByLabelText('Comparison week'), { target: { value: addDays(current, -21) } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes(`compare_week=${addDays(current, -21)}`) && url.includes('comparison=custom'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Select week'), { target: { value: addDays(current, -10) } });
    expect((screen.getByLabelText('Select week') as HTMLInputElement).value).toBe(addDays(current, -14));
});

it('switches between the week and the last seven days, and the heatmap follows', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 24, 12));
    // Earlier tests leave heatmaps in the shared 30-second cache; start empty so each period is requested.
    clearBodyMapCache();
    const { fetchMock } = setup({ summary: { ...dash, last_seven_days: rollingStats } });
    const metrics = within(screen.getByRole('region', { name: 'Training summary' }));
    // A week with workouts shows the week by default.
    expect(metrics.getByText('Weekly volume')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    // Choosing the last seven days returns to the current period and hides week and comparison controls.
    expect(metrics.getByText('Volume last 7 days').closest('article')?.querySelector('strong')?.textContent).toBe('350 kg');
    expect(screen.getByRole('button', { name: `Last 7 days${compactRangeLabel('2026-11-18', '2026-11-24')}`, expanded: true })).toBeTruthy();
    expect(screen.queryByLabelText('Select week')).toBeNull();
    expect(screen.queryByLabelText('Compare with')).toBeNull();
    const musclePanel = within(screen.getByRole('heading', { name: 'Volume by muscle group' }).closest('article')!);
    expect(musclePanel.getByText('Last 7 days')).toBeTruthy();
    fireEvent.click(musclePanel.getByRole('button', { name: 'Heatmap' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes(`/body-map?selected_week=${current}&through_today=false&period=last_seven_days`))).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(metrics.getByText('Weekly volume')).toBeTruthy();
    expect(screen.getByLabelText('Compare with')).toBeTruthy();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes(`/body-map?selected_week=${current}&through_today=false&period=week`))).toBe(true));
});
