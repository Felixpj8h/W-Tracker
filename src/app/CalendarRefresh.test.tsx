// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../shared/api/client';
import { WorkoutApp } from './WorkoutApp';

vi.mock('../shared/api/client', () => ({ api: vi.fn(), API: '/api/v1', pendingBackendWrites: 0, backendWriteFailed: false }));
vi.mock('../features/dashboard/Dashboard', () => ({ Dashboard: () => null }));

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.useRealTimers();
    vi.resetAllMocks();
    Reflect.deleteProperty(document, 'elementFromPoint');
});

it.each([
    { target: '2026-11-02', months: [11] },
    { target: '2026-10-31', months: [10, 11] },
])('refreshes each affected calendar month once after moving a workout to $target', async ({ target, months }) => {
    vi.setSystemTime(new Date(2026, 10, 19, 12));
    const source = '2026-11-01';
    let workoutDate = source;
    vi.mocked(api).mockImplementation(async path => {
        if (path === '/calendar/move') {
            workoutDate = target;
            return { saved: true };
        }
        if (path.startsWith('/calendar?')) {
            const month = Number(workoutDate.slice(5, 7));
            return { plan: null, days: path.endsWith(`&month=${month}`) ? [{
                date: workoutDate, routine_id: 1, routine_name: 'Upper', status: 'upcoming', workout_name: null,
            }] : [] };
        }
        if (path === '/dashboard') return { weight_series: [], latest_weight: null };
        return [];
    });
    const { container } = render(<WorkoutApp user={{ email: 'athlete@example.com', name: 'Athlete', firstName: 'Athlete' }}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    const workout = (await screen.findByText('Upper', { selector: '.training-event-full' })).parentElement!;
    const destination = container.querySelector(`[data-date="${target}"]`);
    expect(destination).not.toBeNull();
    Object.defineProperty(workout, 'setPointerCapture', { value: vi.fn() });
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => destination });
    vi.mocked(api).mockClear();

    const pointer = { isPrimary: true, button: 0, pointerType: 'mouse', pointerId: 1 };
    fireEvent.pointerDown(workout, { ...pointer, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(workout, { ...pointer, clientX: 30, clientY: 30 });
    fireEvent.pointerUp(workout, { ...pointer, clientX: 30, clientY: 30 });

    await screen.findByText('Workout moved.');
    expect(container.querySelector(`[data-date="${target}"].selected .training-event-full`)?.textContent).toBe('Upper');
    expect(vi.mocked(api).mock.calls.map(([path]) => path).sort()).toEqual([
        '/calendar/move', '/dashboard', '/workouts', '/workouts/active',
        ...months.map(month => `/calendar?year=2026&month=${month}`),
    ].sort());
});
