// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RoutineEditor } from './RoutineEditor';
import type { Routine } from './types';
import { api } from '../../shared/api/client';

vi.mock('../../shared/api/client', () => ({ api: vi.fn().mockResolvedValue({}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const routine: Routine = { id: 7, name: 'Upper', folder_id: 2, exercises: [
    { exercise_id: 1, name: 'Bench', planned_sets: 3, target_reps_min: 6, target_reps_max: 8, rest_seconds: 120, target_weight: 40 },
    { exercise_id: 2, name: 'Row', planned_sets: 4, target_reps_min: 8, target_reps_max: 12, rest_seconds: 90, target_weight: 35 },
    { exercise_id: 3, name: 'Curl', planned_sets: 2, target_reps_min: 10, target_reps_max: 15, rest_seconds: 60 },
] };
const props = { folders: [{ id: 2, name: 'Strength', routines: [] }], close: vi.fn(), done: vi.fn().mockResolvedValue(undefined) };

it.each(['.desktop-rest-builder', '[aria-label="Sets and reps"]', '[aria-label="Rest times"]'])(
    'reorders from %s and saves the new order with every exercise target intact', async selector => {
        const { container } = render(<RoutineEditor {...props} routine={routine}/>);
        const list = within(container.querySelector<HTMLElement>(selector)!);
        expect(list.getByRole('button', { name: 'Move Bench up' })).toBeDisabled();
        expect(list.getByRole('button', { name: 'Move Curl down' })).toBeDisabled();
        fireEvent.click(list.getByRole('button', { name: 'Move Row up' }));
        fireEvent.click(list.getByRole('button', { name: 'Move Bench down' }));
        for (const view of ['.desktop-rest-builder', '[aria-label="Sets and reps"]', '[aria-label="Rest times"]']) {
            expect([...container.querySelectorAll(`${view} b`)].map(item => item.textContent)).toEqual(['Row', 'Curl', 'Bench']);
        }
        fireEvent.submit(screen.getByRole('dialog', { name: 'Routine editor' }));
        await waitFor(() => expect(props.done).toHaveBeenCalledOnce());
        expect(api).toHaveBeenCalledWith('/routines/7', { method: 'PUT', body: JSON.stringify({
            name: routine.name, folder_id: 2, exercises: [routine.exercises[1], routine.exercises[2], routine.exercises[0]].map(({ name: _name, ...targets }) => targets),
        }) });
        expect(routine.exercises.map(item => item.name)).toEqual(['Bench', 'Row', 'Curl']);
    },
);

it('saves reordering of a planned workout only to its calendar occurrence', async () => {
    const { container } = render(<RoutineEditor {...props} routine={{ ...routine, scheduled_on: '2026-11-06' }}/>);
    fireEvent.click(within(container.querySelector<HTMLElement>('.desktop-rest-builder')!).getByRole('button', { name: 'Move Row up' }));
    fireEvent.submit(screen.getByRole('dialog'));
    await waitFor(() => expect(props.done).toHaveBeenCalledOnce());
    expect(vi.mocked(api).mock.calls[0][0]).toBe('/calendar/2026-11-06/routine/7');
    expect(JSON.parse(vi.mocked(api).mock.calls[0][1]!.body as string).exercises.map((item: {exercise_id: number}) => item.exercise_id)).toEqual([2, 1, 3]);
});

it('hides order controls for read-only routines and a single exercise', () => {
    const view = render(<RoutineEditor {...props} routine={routine} readOnly/>);
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
    view.rerender(<RoutineEditor {...props} routine={routine}/>);
    expect(screen.getAllByRole('button', { name: 'Move Row up' })).toHaveLength(3);
    view.unmount();
    render(<RoutineEditor {...props} routine={{ ...routine, exercises: routine.exercises.slice(0, 1) }}/>);
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
});
