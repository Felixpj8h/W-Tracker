import type { Workout } from './types';
import type { Folder, Routine } from '../routines/types';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { Exercise, ExerciseProgress } from '../exercises/types';
import { api, API } from '../../shared/api/client';
import { ACTIVE_WORKOUT_KEY } from './session';
import { WorkoutSessionView } from './WorkoutSessionView';
import { authHeaders } from '../auth/auth';
import { routineMuscles } from '../routines/routineMuscles';
import { PageHeader } from '../../shared/ui/PageHeader';

export function WorkoutLogger({ workout, folders, active, start, startAdHoc, setWorkout, editing, finish, saveEdit, cancel, pause }: { workout: Workout | null; folders: Folder[]; active: Workout[]; start: (r: Routine) => void; startAdHoc: () => Promise<void>; setWorkout: (x: Workout) => void; editing: boolean; finish: (x: Workout) => Promise<void>; saveEdit: (x: Workout) => Promise<void>; cancel?: (x: Workout) => Promise<void>; pause?: (x: Workout) => Promise<void> }) {
    const [q, setQ] = useState(''), [results, setResults] = useState<Exercise[]>([]), [open, setOpen] = useState(0), [progressByExercise, setProgressByExercise] = useState<Record<number, ExerciseProgress>>({}), [restUntil, setRestUntil] = useState<number | null>(null), [now, setNow] = useState(Date.now), [extraExerciseOpen, setExtraExerciseOpen] = useState(false);
    const [substituteIndex, setSubstituteIndex] = useState<number | null>(null);
    const [pausing, setPausing] = useState(false);
    const [pauseError, setPauseError] = useState('');
    const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState('');
    const closeSearch = useCallback(() => { setSubstituteIndex(null); setQ(''); setResults([]); setExtraExerciseOpen(false); }, []);
    const latestWorkout = useRef(workout);
    const pendingEdit = useRef<Workout | null>(null);
    const cancelling = useRef(false);
    useEffect(() => { latestWorkout.current = workout; }, [workout]);
    useEffect(() => { if (!restUntil) return; const tick = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(tick); }, [restUntil]);
    useEffect(() => { if (restUntil && now >= restUntil) setRestUntil(null); }, [now, restUntil]);
    useEffect(() => {
        const controller = new AbortController();
        if (q.trim().length < 2) { setResults([]); setSearchLoading(false); return; }
        setSearchLoading(true); setSearchError('');
        const timer = setTimeout(() => {
            void api<Exercise[]>(`/exercises?q=${encodeURIComponent(q.trim())}`, { signal: controller.signal })
                .then(data => { if (!controller.signal.aborted) setResults(data); })
                .catch(() => { if (!controller.signal.aborted) { setResults([]); setSearchError('Could not search exercises. Please try again.'); } })
                .finally(() => { if (!controller.signal.aborted) setSearchLoading(false); });
        }, 250);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [q]);
    const positionKey = workout ? `workout-position:${workout.id ?? workout.started_at ?? workout.performed_on + workout.name}` : null;
    const restoringPosition = useRef(false);
    const positionRef = useRef({ index: 0, scroll: 0, identity: '' });
    const exerciseIdentity = (item: Workout['exercises'][number] | undefined) => item ? `${item.exercise_id ?? item.cached_exercise_id ?? ''}:${item.name}` : '';
    useEffect(() => {
        if (!positionKey) return;
        let saved = { index: 0, scroll: 0, identity: '' };
        try { const data = JSON.parse(localStorage.getItem(positionKey) ?? 'null'); if (data && Number.isFinite(data.index) && Number.isFinite(data.scroll)) saved = data; } catch { /* Storage is optional. */ }
        const matching = workout?.exercises.findIndex(item => exerciseIdentity(item) === saved.identity) ?? -1;
        saved.index = matching >= 0 ? matching : Math.max(0, Math.min(saved.index, (workout?.exercises.length ?? 1) - 1));
        restoringPosition.current = true;
        positionRef.current = saved;
        setOpen(saved.index);
        const frame = requestAnimationFrame(() => window.scrollTo?.({ top: saved.scroll, behavior: 'instant' }));
        const persist = () => { try { localStorage.setItem(positionKey, JSON.stringify(positionRef.current)); } catch { /* Keep logging if storage is unavailable. */ } };
        const scroll = () => { positionRef.current.scroll = window.scrollY; persist(); };
        window.addEventListener('scroll', scroll, { passive: true });
        window.addEventListener('pagehide', persist);
        return () => { cancelAnimationFrame(frame); persist(); window.removeEventListener('scroll', scroll); window.removeEventListener('pagehide', persist); };
    // Restore only when changing workouts; ordinary edits must retain the viewport.
    }, [positionKey]);
    const boundedIndex = workout?.exercises.length ? Math.max(0, Math.min(open, workout.exercises.length - 1)) : 0;
    const retainedIndex = workout?.exercises.findIndex(item => exerciseIdentity(item) === positionRef.current.identity) ?? -1;
    const selectedIndex = open === positionRef.current.index && retainedIndex >= 0 && exerciseIdentity(workout?.exercises[boundedIndex]) !== positionRef.current.identity ? retainedIndex : boundedIndex;
    const selectExercise = (index: number) => {
        const clamped = Math.max(0, Math.min(index, (workout?.exercises.length ?? 1) - 1));
        setOpen(clamped);
        positionRef.current = { ...positionRef.current, index: clamped, identity: exerciseIdentity(workout?.exercises[clamped]) };
        if (positionKey) try { localStorage.setItem(positionKey, JSON.stringify(positionRef.current)); } catch { /* Storage is optional. */ }
    };
    useEffect(() => {
        if (!workout || !positionKey) return;
        if (restoringPosition.current) { restoringPosition.current = false; return; }
        if (open !== selectedIndex) setOpen(selectedIndex);
        positionRef.current.index = selectedIndex;
        positionRef.current.identity = exerciseIdentity(workout.exercises[selectedIndex]);
        try { localStorage.setItem(positionKey, JSON.stringify(positionRef.current)); } catch { /* Storage is optional. */ }
    }, [workout, selectedIndex, positionKey, open]);
    const openItem = workout?.exercises[selectedIndex];
    const progressExerciseIds = workout?.exercises.map(item => item.exercise_id ?? item.cached_exercise_id).filter((id): id is number => Boolean(id)).join(',') ?? '';
    useEffect(() => {
        if (!workout?.id) { setProgressByExercise({}); return; }
        const controller = new AbortController();
        const workoutId = workout.id;
        const exerciseIds = [...new Set(progressExerciseIds.split(',').map(Number).filter(Boolean))];
        void (async () => {
            const progress = await api<Record<number, ExerciseProgress>>(`/workouts/${workoutId}/exercise-progress`, { signal: controller.signal }).catch(() => ({} as Record<number, ExerciseProgress>));
            // New and substituted exercises may not be in the saved workout yet.
            await Promise.all(exerciseIds.filter(id => !progress[id]).map(async id => {
                try {
                    const history = await api<ExerciseProgress>(`/exercises/${id}/progress?exclude_workout_id=${workoutId}`, { signal: controller.signal });
                    if (Array.isArray(history.sessions)) progress[id] = history;
                } catch { /* History is optional; keep the workout editable. */ }
            }));
            if (!controller.signal.aborted) setProgressByExercise(progress);
        })();
        return () => controller.abort();
    }, [workout?.id, progressExerciseIds]);
    const openExerciseId = openItem?.exercise_id ?? openItem?.cached_exercise_id;
    const namedHistory = Object.values(progressByExercise).filter(progress => progress.exercise?.name.trim().toLowerCase() === openItem?.name.trim().toLowerCase());
    const previous = (openExerciseId ? progressByExercise[openExerciseId] : namedHistory.length === 1 ? namedHistory[0] : null) ?? null;
    useEffect(() => { if (!workout?.id || cancelling.current) return; if (editing) pendingEdit.current = workout; const t = setTimeout(() => { if (cancelling.current) return; pendingEdit.current = null; void api(`/workouts/${workout.id}`, { method: 'PATCH', body: JSON.stringify(workout) }).catch(() => undefined); }, 400); return () => clearTimeout(t); }, [workout, editing, pausing]);
    useEffect(() => () => {
        const pending = pendingEdit.current;
        if (pending?.id) void api(`/workouts/${pending.id}`, { method: 'PATCH', body: JSON.stringify(pending) }).catch(() => undefined);
    }, []);
    useEffect(() => {
        const saveBeforeSuspend = () => {
            const current = latestWorkout.current;
            if (!current?.id || cancelling.current) return;
            if (!editing && !current.completed) localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(current));
            void fetch(`${API}/workouts/${current.id}`, { method: 'PATCH', credentials: 'include', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(current), keepalive: true }).catch(() => undefined);
        };
        const onVisibilityChange = () => { if (document.visibilityState === 'hidden') saveBeforeSuspend(); };
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pagehide', saveBeforeSuspend);
        return () => { document.removeEventListener('visibilitychange', onVisibilityChange); window.removeEventListener('pagehide', saveBeforeSuspend); };
    }, [editing]);
    if (!workout) {
        const selectedFolder = folders.find(folder => folder.id === selectedFolderId) ?? folders[0];
        const muscleSummary = routineMuscles;
        return <div className="workout-chooser"><PageHeader action={<button className="chooser-empty-action" onClick={() => void startAdHoc()}>Start empty <span aria-hidden="true">＋</span></button>}><h1>Choose workout</h1><p>Select a routine to begin.</p></PageHeader>{active.length > 0 && <section className="active-sessions"><p className="overline">READY TO RESUME</p>{active.map(x => <button key={x.id} onClick={() => { setWorkout(x); }}><span><b>{x.name}</b><small>Started {x.started_at ? new Date(x.started_at).toLocaleString() : 'earlier'}</small></span><strong>Resume →</strong></button>)}</section>}{folders.length > 0 && <><div className={`chooser-tabs tabs-${Math.min(folders.length, 4)}`} role="tablist" aria-label="Workout routines">{folders.map(folder => <button type="button" role="tab" aria-selected={folder.id === selectedFolder?.id} key={folder.id} className={folder.id === selectedFolder?.id ? 'selected' : ''} onClick={() => setSelectedFolderId(folder.id)}><strong>{folder.name}</strong><small>{folder.routines.length} workout {folder.routines.length === 1 ? 'day' : 'days'}</small></button>)}</div><section className="chooser-selected" aria-labelledby="selected-routine-name"><div className="chooser-selected-heading"><h2 id="selected-routine-name">{selectedFolder.name}</h2><p>{selectedFolder.routines.length} workout {selectedFolder.routines.length === 1 ? 'day' : 'days'}</p></div><div className="chooser-days">{selectedFolder.routines.map((routine, index) => <button type="button" className="chooser-day" onClick={() => start(routine)} key={routine.id}><span className="chooser-day-number">Day {index + 1}</span><span className="chooser-day-copy"><strong>{routine.name}</strong><small>{routine.exercises.length} {routine.exercises.length === 1 ? 'exercise' : 'exercises'}{muscleSummary(routine) ? ` · ${muscleSummary(routine)}` : ''}</small></span><span className="chooser-start">Start <span aria-hidden="true">→</span></span></button>)}{selectedFolder.routines.length === 0 && <p className="chooser-empty">No workout days in this routine yet.</p>}</div></section></>}{folders.length === 0 && <div className="empty">No routine required — use “Start empty” to add exercises as you go.</div>}</div>;
    }
    const addExercise = (exercise: Exercise) => {
        const replaced = substituteIndex === null ? null : workout.exercises[substituteIndex];
        const next = { exercise_id: exercise.id, name: exercise.name, primary_muscle: exercise.primary_muscle, secondary_muscles: exercise.secondary_muscles, muscle_group: exercise.muscle_group,
            rest_seconds: replaced?.rest_seconds ?? 90,
            sets: replaced ? (replaced.sets?.length ? replaced.sets.map(set => ({ weight: 0, reps: set.reps })) : [{ weight: 0, reps: 0 }]) : [{ weight: 0, reps: 0 }] };
        setWorkout({ ...workout, exercises: substituteIndex === null ? [...workout.exercises, next] : workout.exercises.map((item, index) => index === substituteIndex ? next : item) });
        selectExercise(substituteIndex ?? workout.exercises.length);
        setOpen(substituteIndex ?? workout.exercises.length);
        if (substituteIndex !== null) setRestUntil(null);
        setSubstituteIndex(null); setQ(''); setResults([]); setExtraExerciseOpen(false);
    };
    const removeExercise = () => {
        const exercises = workout.exercises.filter((_, index) => index !== selectedIndex);
        const nextIndex = Math.max(0, Math.min(selectedIndex, exercises.length - 1));
        positionRef.current = { ...positionRef.current, index: nextIndex, identity: exerciseIdentity(exercises[nextIndex]) };
        setOpen(nextIndex);
        setRestUntil(null);
        setWorkout({ ...workout, exercises });
    };
    const pauseSession = async () => {
        if (!pause || pausing) return;
        setPausing(true); setPauseError('');
        try { await pause(workout); } catch { setPauseError('Could not save your session. Please try pausing again.'); } finally { setPausing(false); }
    };
    const cancelSession = async () => {
        if (!cancel || pausing) return;
        cancelling.current = true;
        setPausing(true); setPauseError('');
        try { await cancel(workout); }
        catch { setPauseError('Could not cancel your workout. It is still active. Please try cancelling again.'); }
        finally { cancelling.current = false; setPausing(false); }
    };
    const remaining = restUntil ? Math.max(0, Math.ceil((restUntil - now) / 1000)) : 0;
    return <WorkoutSessionView workout={workout} editing={editing} onChange={setWorkout} open={selectedIndex} onOpen={selectExercise} onRemoveExercise={removeExercise} previous={previous}
        onFinish={() => void (editing ? saveEdit(workout) : finish(workout))} onPause={!editing && pause ? () => void pauseSession() : undefined}
        onCancel={!editing && cancel ? () => void cancelSession() : undefined} pausing={pausing} error={pauseError}
        restRemaining={remaining} onRest={seconds => setRestUntil(Date.now() + seconds * 1000)} onSkipRest={() => setRestUntil(null)}
        searchOpen={extraExerciseOpen} substituteIndex={substituteIndex} onOpenSearch={index => { setSubstituteIndex(index); setQ(''); setResults([]); setSearchError(''); setExtraExerciseOpen(true); }}
        onCloseSearch={closeSearch} query={q} onQuery={setQ} results={results} onChoose={addExercise} searchLoading={searchLoading} searchError={searchError}/>;
}