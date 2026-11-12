import { activateAccount, accountKey } from '../features/auth/auth';
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkoutApp } from './WorkoutApp';
import { api } from '../shared/api/client';
import { ACTIVE_WORKOUT_KEY } from '../features/workout/session';

vi.mock('../shared/api/client', () => ({ api: vi.fn(), API: '/api/v1', pendingBackendWrites: 0, backendWriteFailed: false }));
vi.mock('../features/coach/useCoachController', () => ({ useCoachController: () => ({ streaming: {} }) }));
vi.mock('../features/dashboard/Dashboard', () => ({ Dashboard: ({ log }: { log: () => void }) => <><p>Dashboard content</p><button onClick={log}>Dashboard log workout</button></> }));
vi.mock('../features/routines/Routines', () => ({ Routines: () => <p>Routines content</p> }));

beforeEach(() => activateAccount('athlete@example.com'));

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); vi.restoreAllMocks(); });

it('saves a paused session, allows navigation, and resumes the exact saved workout', async () => {
    const workout = { id: 42, name: 'Fullbody', performed_on: '2026-10-18', completed: false, exercises: [{ cached_exercise_id: 7, name: 'Bench press', sets: [{ weight: 22.5, reps: 8 }] }] };
    localStorage.setItem(accountKey(ACTIVE_WORKOUT_KEY), JSON.stringify(workout));
    vi.mocked(api).mockImplementation(async path => {
        if (path === '/workouts/active') return [workout];
        if (path.startsWith('/calendar')) return { plan: null, days: [] };
        if (path === '/dashboard') return { weight_series: [], latest_weight: null };
        if (path === '/folders' || path === '/workouts') return [];
        return {};
    });
    render(<WorkoutApp user={{ name: 'Athlete', firstName: 'Athlete', email: 'athlete@example.com' }}/>);
    fireEvent.change(await screen.findByLabelText('Bench press set 1 weight in kg'), { target: { value: '25.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pause session' }));
    await screen.findByText('Dashboard content');
    const save = vi.mocked(api).mock.calls.find(([path, options]) => path === '/workouts/42' && options?.method === 'PATCH');
    expect(save).toBeTruthy();
    expect(JSON.parse(save![1]!.body as string)).toMatchObject({ id: 42, completed: false, exercises: [{ cached_exercise_id: 7, sets: [{ weight: 25.5, reps: 8 }] }] });
    expect(vi.mocked(api).mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
    expect(JSON.parse(localStorage.getItem(accountKey(ACTIVE_WORKOUT_KEY))!).completed).toBe(false);
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

const cancellationWorkout = { id: 42, name: 'Fullbody', performed_on: '2026-10-20', completed: false, exercises: [{ cached_exercise_id: 7, name: 'Bench press', sets: [{ weight: 22.5, reps: 8 }] }] };
const athlete = { name: 'Athlete', firstName: 'Athlete', email: 'athlete@example.com' };

it('retains an acknowledged revision when later edits update the cached draft', async () => {
    const draft = { ...cancellationWorkout, revision: 1 };
    localStorage.setItem(accountKey(ACTIVE_WORKOUT_KEY), JSON.stringify(draft));
    vi.mocked(api).mockImplementation(async (path, options) => {
        if (path === '/workouts/active') return [draft];
        if (path === '/workouts/42' && options?.method === 'PATCH') return { ...draft, revision: 2 };
        return baseResponse(path);
    });
    render(<WorkoutApp user={athlete}/>);
    const name = await screen.findByRole('textbox', { name: 'Workout name' });
    fireEvent.change(name, { target: { value: 'Acknowledged edit' } });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(accountKey(ACTIVE_WORKOUT_KEY))!).revision).toBe(2));
    fireEvent.change(name, { target: { value: 'New unsynced edit' } });
    expect(JSON.parse(localStorage.getItem(accountKey(ACTIVE_WORKOUT_KEY))!)).toMatchObject({ name: 'New unsynced edit', revision: 2 });
});

it('keeps acknowledged revisions when navigating away and reopening the logger', async () => {
    const draft = { ...cancellationWorkout, revision: 1 };
    let serverRevision = 1;
    localStorage.setItem(accountKey(ACTIVE_WORKOUT_KEY), JSON.stringify(draft));
    vi.mocked(api).mockImplementation(async (path, options) => {
        if (path === '/workouts/active') return [draft];
        if (path === '/workouts/42' && options?.method === 'PATCH') {
            const payload = JSON.parse(options.body as string);
            if (payload.revision !== serverRevision) throw Error('HTTP 409: This workout changed.');
            return { ...payload, revision: ++serverRevision };
        }
        return baseResponse(path);
    });
    render(<WorkoutApp user={athlete}/>);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Workout name' }), { target: { value: 'First save' } });
    await waitFor(() => expect(serverRevision).toBe(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Dashboard' })[0]);
    await screen.findByText('Dashboard content');
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Workout name' }), { target: { value: 'After returning' } });
    await waitFor(() => expect(serverRevision).toBe(3));
    expect(screen.queryByRole('alert')).toBeNull();
});

it('preserves local input at its original revision when the owned server draft changed', async () => {
    const draft = { ...cancellationWorkout, revision: 1, name: 'Unsynced local input' };
    localStorage.setItem(accountKey(ACTIVE_WORKOUT_KEY), JSON.stringify(draft));
    vi.mocked(api).mockImplementation(async (path, options) => {
        if (path === '/workouts/active') return [{ ...draft, name: 'New server version', revision: 2 }];
        if (path === '/workouts/42' && options?.method === 'PATCH') throw Error('HTTP 409: This workout changed.');
        return baseResponse(path);
    });
    render(<WorkoutApp user={athlete}/>);
    const name = await screen.findByRole('textbox', { name: 'Workout name' });
    expect((name as HTMLInputElement).value).toBe('Unsynced local input');
    expect((await screen.findByRole('alert')).textContent).toContain('409');
    expect(screen.getByRole('button', { name: 'Reload saved workout' })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(accountKey(ACTIVE_WORKOUT_KEY))!).revision).toBe(1);
});

function baseResponse(path: string) {
    if (path.startsWith('/calendar')) return { plan: null, days: [] };
    if (path === '/dashboard') return { weight_series: [], latest_weight: null };
    if (path === '/workouts/active') return [cancellationWorkout];
    if (path === '/folders' || path === '/workouts') return [];
    return {};
}
function clickCancelWorkout() {
    fireEvent.click(screen.getByLabelText('Workout actions'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel workout' }));
}
it('deletes a cancelled workout and does not restore it after reopening the app', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    localStorage.setItem(accountKey(ACTIVE_WORKOUT_KEY), JSON.stringify(cancellationWorkout));
    let deleted = false;
    vi.mocked(api).mockImplementation(async (path, options) => {
        if (options?.method === 'DELETE') { deleted = true; return { deleted: true }; }
        if (path === '/workouts/active') return deleted ? [] : [cancellationWorkout];
        return baseResponse(path);
    });
    const view = render(<WorkoutApp user={athlete}/>);
    await screen.findByLabelText('Workout actions');
    clickCancelWorkout();
    await screen.findByText('Dashboard content');
    expect(api).toHaveBeenCalledWith('/workouts/42', { method: 'DELETE' });
    expect(localStorage.getItem(accountKey(ACTIVE_WORKOUT_KEY))).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard log workout' }));
    await screen.findByRole('heading', { name: 'Choose workout' });
    expect(screen.queryByText('READY TO RESUME')).toBeNull();
    view.unmount();
    render(<WorkoutApp user={athlete}/>);
    expect(screen.getByText('Dashboard content')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
});
it('waits for a new workout ID before cancelling it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let resolveStart!: (value: typeof cancellationWorkout) => void;
    const started = new Promise<typeof cancellationWorkout>(resolve => { resolveStart = resolve; });
    vi.mocked(api).mockImplementation(async (path, options) => {
        if (path === '/folders') return [{ id: 1, name: 'Training', routines: [{ id: 2, name: 'Fullbody', exercises: [{ exercise_id: 7, name: 'Bench press', planned_sets: 1 }] }] }];
        if (path === '/routines/2/start') return started;
        if (path === '/workouts/active') return [];
        if (options?.method === 'DELETE') return { deleted: true };
        return baseResponse(path);
    });
    render(<WorkoutApp user={athlete}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard log workout' }));
    fireEvent.click(await screen.findByRole('button', { name: /Fullbody/ }));
    await screen.findByLabelText('Workout actions');
    clickCancelWorkout();
    expect(screen.getByRole('button', { name: 'Cancel workout' }).hasAttribute('disabled')).toBe(true);
    expect(vi.mocked(api).mock.calls.some(([,options]) => options?.method === 'DELETE')).toBe(false);
    await act(async () => resolveStart(cancellationWorkout));
    await screen.findByText('Dashboard content');
    expect(api).toHaveBeenCalledWith('/workouts/42', { method: 'DELETE' });
    expect(localStorage.getItem(accountKey(ACTIVE_WORKOUT_KEY))).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
});
it('keeps a failed cancellation open with retry instead of silently pausing', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    localStorage.setItem(accountKey(ACTIVE_WORKOUT_KEY), JSON.stringify(cancellationWorkout));
    let fail = true;
    vi.mocked(api).mockImplementation(async (path, options) => {
        if (options?.method === 'DELETE' && fail) throw new Error('Offline');
        return baseResponse(path);
    });
    render(<WorkoutApp user={athlete}/>);
    await screen.findByLabelText('Workout actions');
    clickCancelWorkout();
    expect((await screen.findByRole('alert')).textContent).toContain('Please try cancelling again');
    expect(screen.queryByText('Dashboard content')).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause session' }).hasAttribute('disabled')).toBe(false);
    expect(JSON.parse(localStorage.getItem(accountKey(ACTIVE_WORKOUT_KEY))!).id).toBe(42);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel workout' }));
    await screen.findByText('Dashboard content');
    expect(localStorage.getItem(accountKey(ACTIVE_WORKOUT_KEY))).toBeNull();
});
it('ignores an active-session response that arrives after cancellation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    localStorage.setItem(accountKey(ACTIVE_WORKOUT_KEY), JSON.stringify(cancellationWorkout));
    let resolveActive!: (value: typeof cancellationWorkout[]) => void;
    const staleActive = new Promise<typeof cancellationWorkout[]>(resolve => { resolveActive = resolve; });
    let requests = 0;
    vi.mocked(api).mockImplementation(async path => {
        if (path === '/workouts/active' && requests++ === 1) return staleActive;
        return baseResponse(path);
    });
    render(<WorkoutApp user={athlete}/>);
    await screen.findByLabelText('Workout actions');
    clickCancelWorkout();
    await screen.findByText('Dashboard content');
    await act(async () => resolveActive([cancellationWorkout]));
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume session' })).toBeNull();
});
it('leaves the workout active when cancellation confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    localStorage.setItem(accountKey(ACTIVE_WORKOUT_KEY), JSON.stringify(cancellationWorkout));
    vi.mocked(api).mockImplementation(async path => baseResponse(path));
    render(<WorkoutApp user={athlete}/>);
    await screen.findByLabelText('Workout actions');
    await act(async () => clickCancelWorkout());
    expect(screen.getByRole('button', { name: 'Pause session' }).hasAttribute('disabled')).toBe(false);
    expect(vi.mocked(api).mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
    expect(localStorage.getItem(accountKey(ACTIVE_WORKOUT_KEY))).not.toBeNull();
});

it('retains the active editor and explains a rejected finish instead of silently restoring it later', async () => {
    localStorage.setItem(accountKey(ACTIVE_WORKOUT_KEY), JSON.stringify(cancellationWorkout));
    let reject = true;
    vi.mocked(api).mockImplementation(async (path, options) => {
        if (options?.method === 'PUT' && reject) throw new Error('HTTP 403: Invalid request origin.');
        if (path === '/workouts/active') return reject ? [cancellationWorkout] : [];
        return baseResponse(path);
    });
    render(<WorkoutApp user={athlete}/>);
    fireEvent.click(await screen.findByRole('button', {name:'Finish workout ✓'}));
    expect((await screen.findByRole('alert')).textContent).toContain('HTTP 403: Invalid request origin.');
    expect(screen.queryByText('Dashboard content')).toBeNull();
    expect(localStorage.getItem(accountKey(ACTIVE_WORKOUT_KEY))).not.toBeNull();
    reject = false;
    fireEvent.click(await screen.findByRole('button', {name:'Finish workout ✓'}));
    await screen.findByText('Dashboard content');
    expect(localStorage.getItem(accountKey(ACTIVE_WORKOUT_KEY))).toBeNull();
    expect(screen.queryByRole('button', {name:'Resume'})).toBeNull();
});
it('does not restore a cached active workout that is already completed on the server', async () => {
    localStorage.setItem(accountKey(ACTIVE_WORKOUT_KEY), JSON.stringify(cancellationWorkout));
    vi.mocked(api).mockImplementation(async path => path === '/workouts' ? [{...cancellationWorkout,completed:true}] : path === '/workouts/active' ? [] : baseResponse(path));
    render(<WorkoutApp user={athlete}/>);
    await screen.findByRole('heading', {name:'Choose workout'});
    expect(localStorage.getItem(accountKey(ACTIVE_WORKOUT_KEY))).toBeNull();
    expect(screen.queryByRole('button', {name:'Pause session'})).toBeNull();
});
