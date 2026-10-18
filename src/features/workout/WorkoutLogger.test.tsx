// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
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
