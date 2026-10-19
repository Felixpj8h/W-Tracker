// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkoutApp } from './WorkoutApp';
import { api } from '../shared/api/client';
import { ACTIVE_WORKOUT_KEY } from '../features/workout/session';

vi.mock('../shared/api/client', () => ({ api: vi.fn(), API: '/api/v1', pendingBackendWrites: 0, backendWriteFailed: false }));
vi.mock('../features/coach/useCoachController', () => ({ useCoachController: () => ({ streaming: {} }) }));
vi.mock('../features/dashboard/Dashboard', () => ({ Dashboard: ({ log }: { log: () => void }) => <><p>Dashboard content</p><button onClick={log}>Dashboard log workout</button></> }));
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

it.each(['dashboard', 'mobile', 'desktop'])('opens the chooser from %s even when today has a planned workout', async entry => {
    const date = new Date();
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const planned = { id: 1, name: 'Planned legs', exercises: [{ exercise_id: 1, name: 'Squat', sets: [{ weight: 60, reps: 8 }] }] };
    const wanted = { id: 2, name: 'Wanted upper', exercises: [{ exercise_id: 2, name: 'Bench', sets: [{ weight: 40, reps: 8 }] }] };
    vi.mocked(api).mockImplementation(async (path, options) => {
        if (path === '/folders') return [{ id: 1, name: 'My routine', routines: [planned, wanted] }];
        if (path.startsWith('/calendar')) return { plan: null, days: [{ date: dateKey, routine_id: planned.id, status: 'planned' }] };
        if (path === '/dashboard') return { weight_series: [], latest_weight: null };
        if (path === '/workouts' || path === '/workouts/active') return [];
        if (path === '/routines/2/start' && options?.method === 'POST') return { id: 43, name: wanted.name, performed_on: dateKey, exercises: wanted.exercises };
        return {};
    });
    render(<WorkoutApp user={{name: 'Athlete', firstName: 'Athlete', email: 'athlete@example.com'}}/>);
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining('/calendar')));
    if (entry === 'dashboard') fireEvent.click(screen.getByRole('button', {name:'Dashboard log workout'}));
    else fireEvent.click(screen.getAllByRole('button', {name:'Log workout'})[entry === 'desktop' ? 0 : 1]);
    await screen.findByRole('heading', {name:'Choose workout'});
    expect(screen.getByRole('button', {name:/Planned legs/})).toBeTruthy();
    expect(screen.getByRole('button', {name:/Wanted upper/})).toBeTruthy();
    expect(vi.mocked(api).mock.calls.some(([path]) => path.includes('/start'))).toBe(false);
    fireEvent.click(screen.getByRole('button', {name:/Wanted upper/}));
    await screen.findByLabelText('Bench set 1 weight in kg');
    expect(api).toHaveBeenCalledWith('/routines/2/start', {method:'POST'});
    expect(vi.mocked(api).mock.calls.some(([path]) => path.startsWith('/routines/1/start'))).toBe(false);
});
