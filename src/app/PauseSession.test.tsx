// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkoutApp } from './WorkoutApp';
import { api } from '../shared/api/client';
import { ACTIVE_WORKOUT_KEY } from '../features/workout/session';

vi.mock('../shared/api/client', () => ({ api: vi.fn(), API: '/api/v1', pendingBackendWrites: 0, backendWriteFailed: false }));
vi.mock('../features/coach/useCoachController', () => ({ useCoachController: () => ({ streaming: {} }) }));
vi.mock('../features/dashboard/Dashboard', () => ({ Dashboard: () => <p>Dashboard content</p> }));
vi.mock('../features/routines/Routines', () => ({ Routines: () => <p>Routines content</p> }));

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

it('saves a paused session, allows navigation, and resumes the exact saved workout', async () => {
    const workout = { id: 42, name: 'Fullbody', performed_on: '2026-10-18', completed: false, exercises: [{ cached_exercise_id: 7, name: 'Bench press', sets: [{ weight: 22.5, reps: 8 }] }] };
    localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(workout));
    vi.mocked(api).mockImplementation(async path => {
        if (path === '/workouts/active') return [workout];
        if (path.startsWith('/calendar')) return { plan: null, days: [] };
        if (path === '/dashboard') return { weight_series: [], latest_weight: null };
        if (path === '/folders' || path === '/workouts') return [];
        return {};
    });
    render(<WorkoutApp user={{ name: 'Athlete', firstName: 'Athlete', email: 'athlete@example.com' }}/>);
    fireEvent.change(screen.getByLabelText('Bench press set 1 weight in kg'), { target: { value: '25.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pause session' }));
    await screen.findByText('Dashboard content');
    const save = vi.mocked(api).mock.calls.find(([path, options]) => path === '/workouts/42' && options?.method === 'PATCH');
    expect(save).toBeTruthy();
    expect(JSON.parse(save![1]!.body as string)).toMatchObject({ id: 42, completed: false, exercises: [{ cached_exercise_id: 7, sets: [{ weight: 25.5, reps: 8 }] }] });
    expect(vi.mocked(api).mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
    expect(JSON.parse(localStorage.getItem(ACTIVE_WORKOUT_KEY)!).completed).toBe(false);
    fireEvent.click(screen.getAllByRole('button', { name: 'Routines' })[0]);
    await screen.findByText('Routines content');
    expect(document.querySelector('.resume-session')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect((screen.getByLabelText('Bench press set 1 weight in kg') as HTMLInputElement).value).toBe('25.5'));
    expect(screen.getByRole('button', { name: 'Finish workout ✓' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume session' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Log workout' })).toHaveLength(2);
});
