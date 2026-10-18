// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkoutLogger } from './WorkoutLogger';
import { api } from '../../shared/api/client';
import type { Workout } from './types';

vi.mock('../../shared/api/client', () => ({ api: vi.fn().mockResolvedValue({}), API: '/api/v1' }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

const original: Workout = { id: 42, name: 'Upper', completed: true, performed_on: '2026-10-18', exercises: [] };
const props = { folders: [], active: [], start: vi.fn(), startAdHoc: vi.fn(), setWorkout: vi.fn(), editing: true, finish: vi.fn(), saveEdit: vi.fn() };

it('debounces edits to completed workouts and preserves completion', async () => {
    vi.useFakeTimers();
    const view = render(<WorkoutLogger {...props} workout={original}/>);
    view.rerender(<WorkoutLogger {...props} workout={{ ...original, name: 'Upper updated' }}/>);
    await act(() => vi.advanceTimersByTimeAsync(200));
    const latest = { ...original, name: 'Upper final' };
    view.rerender(<WorkoutLogger {...props} workout={latest}/>);
    await act(() => vi.advanceTimersByTimeAsync(399));
    expect(vi.mocked(api).mock.calls.filter(([, options]) => options?.method === 'PATCH')).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(api).toHaveBeenCalledWith('/workouts/42', { method: 'PATCH', body: JSON.stringify(latest) });
    expect(props.saveEdit).not.toHaveBeenCalled();
});

it('saves a pending completed-workout edit when leaving before the delay', () => {
    vi.useFakeTimers();
    const view = render(<WorkoutLogger {...props} workout={original}/>);
    const latest = { ...original, note: 'Updated note' };
    view.rerender(<WorkoutLogger {...props} workout={latest}/>);
    view.unmount();
    expect(api).toHaveBeenCalledWith('/workouts/42', { method: 'PATCH', body: JSON.stringify(latest) });
});

it('looks past zero-weight and empty sessions for the latest recorded weight', async () => {
    const session = (performed_on: string, weight: number) => ({ workout_id: 1, performed_on, workout_name: 'Other routine', sets: [{ weight, reps: 8 }], volume: weight * 8, best_weight: weight, estimated_1rm: weight });
    vi.mocked(api).mockResolvedValueOnce({ 7: {
        sessions: [session('2026-10-17', 0), { ...session('2026-10-16', 0), sets: [] }, session('2026-10-15', 65), session('2026-10-12', 60)],
        personal_best_weight: 65, personal_best_1rm: 82,
    } });
    render(<WorkoutLogger {...props} workout={{ ...original, exercises: [{ cached_exercise_id: 7, name: 'Bench press', sets: [] }] }}/>);
    expect(await screen.findByText('LAST TIME · 2026-10-15')).toBeTruthy();
    expect(screen.getByText('65 kg × 8')).toBeTruthy();
    expect(screen.queryByText('LAST TIME · 2026-10-17')).toBeNull();
});

it('hides Last time when no session has a recorded weight', async () => {
    vi.mocked(api).mockResolvedValueOnce({ 7: {
        sessions: [{ performed_on: '2026-10-17', sets: [{ weight: 0, reps: 8 }] }],
        personal_best_weight: 0, personal_best_1rm: 0,
    } });
    await act(async () => {
        render(<WorkoutLogger {...props} workout={{ ...original, exercises: [{ cached_exercise_id: 7, name: 'Bench press', sets: [] }] }}/>);
    });
    expect(screen.queryByText(/LAST TIME/)).toBeNull();
});
