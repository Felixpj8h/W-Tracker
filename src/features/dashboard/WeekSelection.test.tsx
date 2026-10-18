// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DashboardPanels } from './DashboardPanels';
import { addDays, startOfWeek } from './week';
import { today } from '../../shared/lib/format';
import type { Dash } from './types';

vi.mock('../../shared/ui/AnimatedValue', () => ({ AnimatedValue: ({ value }: { value: string }) => <span>{value}</span> }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const current = startOfWeek(today());
const previous = addDays(current, -7);
const dash: Dash = { latest_weight: { weight: 80, recorded_on: today() }, weight_series: [], total_current_volume: 100, total_previous_volume: 50, current_sessions: 1, previous_sessions: 0,
    volume_by_muscle_group: [{ name: 'Chest', current_week_volume: 100, last_week_volume: 50 }], sets_by_muscle: [] };

function setup() {
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
    const view = render(<DashboardPanels dash={dash} history={[{ id: 1, name: 'Past workout', routine_id: 1, performed_on: previous, completed: true, exercises: [] }]} historyLoaded firstName="Athlete" log={vi.fn()} openCalendar={vi.fn()} openHistory={vi.fn()} openWorkout={vi.fn()} saveWeight={async () => undefined}/>);
    fireEvent.click(screen.getByRole('button', { name: /This week/ }));
    return { fetchMock, view };
}

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
