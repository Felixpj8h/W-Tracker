// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkoutLogger } from './WorkoutLogger';
import { api } from '../../shared/api/client';
import type { Workout } from './types';
import { useState } from 'react';

vi.mock('../../shared/api/client', () => ({ api: vi.fn().mockResolvedValue({}), API: '/api/v1' }));
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.clearAllMocks(); });

const original: Workout = { id: 42, name: 'Upper', completed: true, performed_on: '2026-10-18', exercises: [] };
const props = { folders: [], active: [], start: vi.fn(), startAdHoc: vi.fn(), setWorkout: vi.fn(), editing: true, finish: vi.fn(), saveEdit: vi.fn() };

it('pauses an active session with the latest workout without finishing it', async () => {
    const pause = vi.fn().mockResolvedValue(undefined);
    const activeWorkout = { ...original, completed: false, note: 'Latest changes' };
    render(<WorkoutLogger {...props} workout={activeWorkout} editing={false} pause={pause}/>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pause session' })));
    expect(pause).toHaveBeenCalledExactlyOnceWith(activeWorkout);
    expect(props.finish).not.toHaveBeenCalled();
});

it('keeps the editor open and offers retry if pausing fails', async () => {
    const pause = vi.fn().mockRejectedValue(new Error('Offline'));
    render(<WorkoutLogger {...props} workout={{ ...original, completed: false }} editing={false} pause={pause}/>);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pause session' })));
    expect(screen.getByRole('alert').textContent).toContain('Please try pausing again');
    expect((screen.getByRole('button', { name: 'Pause session' }) as HTMLButtonElement).disabled).toBe(false);
});

it('does not offer pause when editing a completed session', () => {
    render(<WorkoutLogger {...props} workout={original} pause={vi.fn()}/>);
    expect(screen.queryByRole('button', { name: 'Pause session' })).toBeNull();
});

it('tracks set completion, saves it, and restores progress on remount', async () => {
    const changed = vi.fn();
    const initial: Workout = { ...original, completed: false, exercises: [{ name: 'Squat', sets: [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }] }] };
    function Harness({ initialWorkout }: { initialWorkout: Workout }) {
        const [workout, update] = useState(initialWorkout);
        return <WorkoutLogger {...props} editing={false} workout={workout} setWorkout={next => { changed(next); update(next); }}/>;
    }
    const view = render(<Harness initialWorkout={initial}/>);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Squat set 1' }));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0.5');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Squat set 2' }));
    expect(screen.getByText('1 of 1 exercises')).toBeTruthy();
    const saved = changed.mock.lastCall![0] as Workout;
    view.unmount();
    render(<Harness initialWorkout={saved}/>);
    expect((screen.getByRole('checkbox', { name: 'Complete Squat set 1' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Squat set 1' }));
    expect(screen.getByText('0 of 1 exercises')).toBeTruthy();
});

it('keeps set removal in the exercise menu and updates progress after removal', () => {
    function Harness() {
        const [workout, update] = useState<Workout>({ ...original, completed: false, exercises: [{ name: 'Squat', sets: [{ weight: 60, reps: 8, completed: true }, { weight: 60, reps: 8 }] }] });
        return <WorkoutLogger {...props} workout={workout} setWorkout={update} editing={false}/>;
    }
    render(<Harness/>);
    fireEvent.click(screen.getByLabelText('Squat actions'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove set 2' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByText('1 of 1 exercises')).toBeTruthy();
});

it('opens exercise search from the full-width Add exercise button', () => {
    render(<WorkoutLogger {...props} workout={{ ...original, completed: false }} editing={false}/>);
    fireEvent.click(screen.getByRole('button', { name: '＋ Add exercise' }));
    expect(screen.getByRole('dialog', { name: 'Add exercise' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search exercises' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
});

it('replaces an exercise in place and loads the replacement history', async () => {
    const changed = vi.fn();
    const replacement = { id: 8, name: 'Cable row', primary_muscle: 'Lats', equipment: 'Cable' };
    vi.mocked(api).mockImplementation(async path => {
        if (path.startsWith('/exercises?q=')) return [replacement];
        if (path.startsWith('/exercises/8/progress')) return { sessions: [{ performed_on: '2026-10-12', sets: [{ weight: 35, reps: 8 }] }], personal_best_weight: 35, personal_best_1rm: 44 };
        return {};
    });
    function Harness() {
        const [workout, update] = useState<Workout>({ ...original, completed: false, exercises: [{ cached_exercise_id: 7, name: 'Bench press', rest_seconds: 120, sets: [{ weight: 65, reps: 8, exertion: 9 }, { weight: 60, reps: 10 }] }] });
        return <WorkoutLogger {...props} editing={false} workout={workout} setWorkout={next => { changed(next); update(next); }}/>;
    }
    render(<Harness/>);
    fireEvent.click(screen.getByRole('button', { name: /Substitute/ }));
    fireEvent.change(screen.getByLabelText('Search replacement exercise'), { target: { value: 'row' } });
    fireEvent.click(await screen.findByRole('button', { name: /Cable row.*Replace/ }));
    const saved = changed.mock.lastCall![0] as Workout;
    expect(saved.exercises).toHaveLength(1);
    expect(saved.exercises[0]).toMatchObject({ exercise_id: 8, name: 'Cable row', rest_seconds: 120, sets: [{ weight: 0, reps: 8 }, { weight: 0, reps: 10 }] });
    expect(saved.exercises[0].cached_exercise_id).toBeUndefined();
    expect(saved.exercises[0].sets?.[0].exertion).toBeUndefined();
    expect(await screen.findByText('35 kg × 8')).toBeTruthy();
});

it('cancels substitution without changing the exercise', () => {
    render(<WorkoutLogger {...props} editing={false} workout={{ ...original, completed: false, exercises: [{ exercise_id: 7, name: 'Bench press', sets: [] }] }}/>);
    fireEvent.click(screen.getByRole('button', { name: /Substitute/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel substitution' }));
    expect(props.setWorkout).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Exercise 1 of 1.*Bench press/ })).toBeTruthy();
});

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
    expect(await screen.findByText('65 kg × 8')).toBeTruthy();
    fireEvent.click(screen.getByText('Last time'));
    expect(screen.getByText('2026-10-15')).toBeTruthy();
    expect(screen.queryByText('2026-10-17')).toBeNull();
});

it('hides Last time when no session has a recorded weight', async () => {
    vi.mocked(api).mockResolvedValueOnce({ 7: {
        sessions: [{ performed_on: '2026-10-17', sets: [{ weight: 0, reps: 8 }] }],
        personal_best_weight: 0, personal_best_1rm: 0,
    } });
    await act(async () => {
        render(<WorkoutLogger {...props} workout={{ ...original, exercises: [{ cached_exercise_id: 7, name: 'Bench press', sets: [] }] }}/>);
    });
    expect(screen.queryByText('Last time')).toBeNull();
});

const navigationWorkout: Workout = { ...original, completed: false, exercises: [
    { name: 'Squat', sets: [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }] },
    { name: 'Bench', sets: [{ weight: 40, reps: 8 }] },
    { name: 'Row', sets: [] },
] };
function NavigationHarness() {
    const [workout, update] = useState(navigationWorkout);
    return <WorkoutLogger {...props} workout={workout} setWorkout={update} editing={false}/>;
}
it('navigates boundaries without completing or automatically advancing and reviews explicitly', () => {
    render(<NavigationHarness/>);
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Squat set 1' }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0.5');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Squat set 2' }));
    expect(screen.getByText('Exercise 1 of 3')).toBeTruthy();
    expect(screen.getByRole('button', {name: /Next exercise/})).toHaveClass('ready');
    fireEvent.click(screen.getByRole('button', {name: /Next exercise/}));
    expect(screen.queryByLabelText('Complete Squat set 1')).toBeNull();
    expect(screen.getByText('Exercise 2 of 3')).toBeTruthy();
    expect(screen.getByRole('button', {name: /Next exercise/})).not.toHaveClass('ready');
    fireEvent.click(screen.getByRole('button', {name: /Next exercise/}));
    fireEvent.click(screen.getByRole('button', {name: 'Review workout'}));
    expect(screen.getByRole('dialog', {name: 'Workout review'})).toBeTruthy();
    expect(props.finish).not.toHaveBeenCalled();
});
it('jumps by segments and overview while keeping selection distinct from completion', () => {
    render(<NavigationHarness/>);
    fireEvent.click(screen.getByRole('button', {name: /Exercise 3: Row/}));
    fireEvent.click(screen.getByRole('button', {name: /Exercise 3 of 3/}));
    expect(screen.getByRole('button', {name: /03\s*Row.*Not started.*Selected/})).toHaveAttribute('aria-current','step');
    fireEvent.click(screen.getByRole('button', {name: /02\s*Bench.*Not started/}));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Exercise 2 of 3')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow','0');
});
it('traps overview focus, dismisses with Escape and restores the selector', () => {
    render(<NavigationHarness/>);
    const selector = screen.getByRole('button', {name: /Exercise 1 of 3/});
    selector.focus(); fireEvent.click(selector);
    const close = screen.getByRole('button', {name:'Close exercise overview'});
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close,{key:'Tab',shiftKey:true});
    expect(document.activeElement).toBe(screen.getByRole('button', {name:/03\s*Row/}));
    fireEvent.keyDown(document,{key:'Escape'});
    expect(document.activeElement).toBe(selector);
});
it('restores selected exercise and saved scroll after remount and isolates workouts', async () => {
    const scrollTo = vi.spyOn(window,'scrollTo').mockImplementation(() => {});
    const first = render(<NavigationHarness/>);
    fireEvent.click(screen.getByRole('button', {name:/Exercise 2: Bench/}));
    Object.defineProperty(window,'scrollY',{value:320,configurable:true});
    fireEvent.scroll(window);
    first.unmount();
    const second = render(<NavigationHarness/>);
    expect(screen.getByText('Exercise 2 of 3')).toBeTruthy();
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(scrollTo).toHaveBeenCalledWith({top:320,behavior:'instant'});
    second.unmount();
    render(<WorkoutLogger {...props} workout={{...navigationWorkout,id:99}} editing={false}/>);
    expect(screen.getByText('Exercise 1 of 3')).toBeTruthy();
    scrollTo.mockRestore();
    Object.defineProperty(window,'scrollY',{value:0,configurable:true});
});


it('retains the selected exercise when earlier exercises are removed and clamps after its removal', () => {
    const view = render(<WorkoutLogger {...props} workout={navigationWorkout} editing={false}/>);
    fireEvent.click(screen.getByRole('button', {name:/Exercise 2: Bench/}));
    view.rerender(<WorkoutLogger {...props} workout={{...navigationWorkout, exercises:navigationWorkout.exercises.slice(1)}} editing={false}/>);
    expect(screen.getByText('Exercise 1 of 2')).toBeTruthy();
    expect(screen.getByLabelText('Complete Bench set 1')).toBeTruthy();
    view.rerender(<WorkoutLogger {...props} workout={{...navigationWorkout,exercises:[]}} editing={false}/>);
    expect(screen.queryByRole('button',{name:/Next exercise/})).toBeNull();
    expect(screen.getByText(/No exercises yet/)).toBeTruthy();
});
it('keeps a setless exercise incomplete, including after adding and removing its only set', () => {
    render(<NavigationHarness/>);
    fireEvent.click(screen.getByRole('button',{name:/Exercise 3: Row/}));
    expect(screen.getByRole('button',{name:'Review workout'})).not.toHaveClass('ready');
    fireEvent.click(screen.getByRole('button',{name:/Add set/}));
    fireEvent.click(screen.getByLabelText('Complete Row set 1'));
    expect(screen.getByRole('button',{name:'Review workout'})).toHaveClass('ready');
    fireEvent.click(screen.getByLabelText('Row actions'));
    fireEvent.click(screen.getByRole('button',{name:'Remove set 1'}));
    expect(screen.getByRole('button',{name:'Review workout'})).not.toHaveClass('ready');
    expect(screen.getByRole('button',{name:/Exercise 3: Row, Not started, 0 of 0/})).toBeTruthy();
});

it('reviews workout stats from checked sets only and finishes explicitly', () => {
    const finish = vi.fn();
    const workout: Workout = { ...navigationWorkout, exercises: [
        { name: 'Squat', sets: [{ weight: 42.5, reps: 8, completed: true }, { weight: 100, reps: 20, completed: false }] },
        { name: 'Bench', sets: [{ weight: 20.25, reps: 5, completed: true }] },
        { name: 'Row', sets: [] },
    ] };
    render(<WorkoutLogger {...props} workout={workout} editing={false} finish={finish}/>);
    fireEvent.click(screen.getByRole('button', {name:/Exercise 3: Row/}));
    const trigger = screen.getByRole('button', {name:'Review workout'});
    trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByRole('dialog', {name:'Workout review'})).toBeTruthy();
    const stat = (label: string) => screen.getByText(label).parentElement!.querySelector('dd')!;
    expect(stat('Exercises completed')).toHaveTextContent('1 / 3');
    expect(stat('Sets completed')).toHaveTextContent('2 / 3');
    expect(stat('Total reps')).toHaveTextContent('13');
    expect(stat('Volume lifted')).toHaveTextContent('441.25 kg');
    expect(finish).not.toHaveBeenCalled();
    fireEvent.keyDown(document, {key:'Escape'});
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', {name:'Finish workout'}));
    expect(finish).toHaveBeenCalledExactlyOnceWith(workout);
});
it('keeps statistics out of the exercise selector overview', () => {
    render(<NavigationHarness/>);
    fireEvent.click(screen.getByRole('button', {name:/Exercise 1 of 3/}));
    expect(screen.getByRole('dialog',{name:'Exercise overview'})).toBeTruthy();
    expect(screen.queryByRole('region',{name:'Workout statistics'})).toBeNull();
});


it.each([
    { index: 0, removed: 'Squat', next: 'Bench', position: 'Exercise 1 of 2' },
    { index: 1, removed: 'Bench', next: 'Row', position: 'Exercise 2 of 2' },
    { index: 2, removed: 'Row', next: 'Bench', position: 'Exercise 2 of 2' },
])('removes $removed from the active workout and selects $next', async ({index, removed, next, position}) => {
    render(<NavigationHarness/>);
    fireEvent.click(screen.getByRole('button', {name:new RegExp(`Exercise ${index + 1}: ${removed}`)}));
    fireEvent.click(screen.getByLabelText(`${removed} actions`));
    fireEvent.click(screen.getByRole('button', {name:'Remove exercise'}));
    expect(screen.getByText(position)).toBeTruthy();
    expect(screen.queryByRole('button', {name:new RegExp(`Exercise [0-9]+: ${removed}`)})).toBeNull();
    expect(screen.getByRole('button', {name:new RegExp(`Exercise [0-9]+: ${next}`)})).toHaveAttribute('aria-current','step');
    expect(navigationWorkout.exercises).toHaveLength(3);
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(document.activeElement).toHaveClass('session-exercise-toggle');
});
it('removes the only exercise, stops its timer and autosaves an empty workout', async () => {
    vi.useFakeTimers();
    function Harness() {
        const [workout, update] = useState<Workout>({...navigationWorkout, exercises:[navigationWorkout.exercises[0]]});
        return <WorkoutLogger {...props} workout={workout} editing={false} setWorkout={update}/>;
    }
    render(<Harness/>);
    fireEvent.click(screen.getByRole('button', {name:/Rest 1:30/}));
    expect(screen.getByRole('timer')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Squat actions'));
    fireEvent.click(screen.getByRole('button', {name:'Remove exercise'}));
    expect(screen.getByText(/No exercises yet/)).toBeTruthy();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('button', {name:'＋ Add exercise'})).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(document.activeElement).toBe(screen.getByRole('button', {name:'＋ Add exercise'}));
    expect(api).toHaveBeenCalledWith('/workouts/42', {method:'PATCH', body:JSON.stringify({...navigationWorkout,exercises:[]})});
});

it('shows cross-routine last weight for an older workout without exercise ID links', async () => {
    vi.mocked(api).mockImplementation(async path => path.endsWith('/exercise-progress') ? {7: {
        exercise:{id:7,name:'Bench press',equipment:'Barbell'},
        sessions:[{workout_id:3,workout_name:'Different routine',performed_on:'2026-10-12',sets:[{weight:42.5,reps:8}]}],
        personal_best_weight:42.5,personal_best_1rm:54,
    }} : {});
    render(<WorkoutLogger {...props} editing={false} workout={{...original,completed:false,exercises:[{name:'  Bench press  ',sets:[]}]}}/>);
    expect(await screen.findByText('42.5 kg × 8')).toBeTruthy();
    expect(screen.getByText('Last time')).toBeTruthy();
});

it('suspends autosave and pagehide saves while cancellation is pending', async () => {
    vi.useFakeTimers();
    let resolveCancel!: () => void;
    const cancel = vi.fn(() => new Promise<void>(resolve => { resolveCancel = resolve; }));
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue({} as Response);
    render(<WorkoutLogger {...props} editing={false} workout={{...original,completed:false}} cancel={cancel}/>);
    fireEvent.click(screen.getByLabelText('Workout actions'));
    fireEvent.click(screen.getByRole('button', {name:'Cancel workout'}));
    fireEvent(window, new Event('pagehide'));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.mocked(api).mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
    await act(async () => resolveCancel());
    fetchSpy.mockRestore();
});

it('waits for in-flight autosave before finishing and suppresses further saves', async () => {
    vi.useFakeTimers();
    let resolveSave!: () => void;
    const saved = new Promise<void>(resolve => { resolveSave = resolve; });
    vi.mocked(api).mockImplementation(async (_path, options) => options?.method === 'PATCH' ? saved : {});
    const finish = vi.fn().mockResolvedValue(undefined);
    render(<WorkoutLogger {...props} editing={false} workout={{...original,completed:false}} finish={finish}/>);
    await act(() => vi.advanceTimersByTimeAsync(400));
    fireEvent.click(screen.getByRole('button', {name:'Finish workout ✓'}));
    expect(finish).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(vi.mocked(api).mock.calls.filter(([,options]) => options?.method === 'PATCH')).toHaveLength(1);
    await act(async () => resolveSave());
    expect(finish).toHaveBeenCalledOnce();
});

it('switches progress segments in place while Next still scrolls to the exercise heading', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable:true, value:scrollIntoView });
    try {
        render(<NavigationHarness/>);
        fireEvent.click(screen.getByRole('button', {name:/Exercise 2: Bench/}));
        await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
        expect(screen.getByText('Exercise 2 of 3')).toBeTruthy();
        expect(scrollIntoView).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name:/Next exercise/}));
        await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
        expect(screen.getByText('Exercise 3 of 3')).toBeTruthy();
        expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({block:'start'});
    } finally {
        if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', descriptor);
        else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
});
