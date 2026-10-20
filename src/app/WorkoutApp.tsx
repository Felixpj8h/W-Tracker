import type { UserProfile } from '../features/auth/profile';
import { useState, useRef, useCallback, useEffect } from 'react';
import type { Workout } from '../features/workout/types';
import { storedWorkout, ACTIVE_WORKOUT_KEY, optimisticWorkoutFromRoutine } from '../features/workout/session';
import type { Page } from './types';
import type { Dash, SavedWeight } from '../features/dashboard/types';
import type { Folder, Routine } from '../features/routines/types';
import type { CalendarMonth } from '../features/calendar/types';
import { withOptimisticWeights, withSavedWeight } from '../features/dashboard/weights';
import { api } from '../shared/api/client';
import { useCoachController } from '../features/coach/useCoachController';
import { today } from '../shared/lib/format';
import { SavingIndicator } from '../shared/ui/SavingIndicator';
import { Sidebar } from './Sidebar';
import { MobileNavigation } from './MobileNavigation';
import { Dashboard } from '../features/dashboard/Dashboard';
import { Coach } from '../features/coach/Coach';
import { Routines } from '../features/routines/Routines';
import { hasWorkoutLink } from '../features/routines/sharing';
import { Calendar } from '../features/calendar/Calendar';
import { WorkoutLogger } from '../features/workout/WorkoutLogger';
import { History } from '../features/history/History';

export function WorkoutApp({ user }: { user: UserProfile }) {
    const [initialWorkout] = useState<Workout | null>(storedWorkout);
    const [page, setPage] = useState<Page>(() => hasWorkoutLink() ? 'routines' : initialWorkout ? 'workout' : 'dashboard'), [dash, setDash] = useState<Dash | null>(null), [folders, setFolders] = useState<Folder[]>([]), [history, setHistory] = useState<Workout[]>([]), [historyLoaded, setHistoryLoaded] = useState(false), [active, setActive] = useState<Workout[]>([]), [calendarMonths, setCalendarMonths] = useState<Record<string, CalendarMonth>>({}), [loadErrors, setLoadErrors] = useState<Partial<Record<'dashboard' | 'folders' | 'history' | 'active' | 'calendar', string>>>({}), [workout, setWorkout] = useState<Workout | null>(initialWorkout), [editing, setEditing] = useState(false), [dark, setDark] = useState(() => localStorage.getItem('workout-theme') !== 'light');
    useEffect(() => {
        const openLink = () => { if (hasWorkoutLink()) setPage('routines'); };
        window.addEventListener('hashchange', openLink);
        return () => window.removeEventListener('hashchange', openLink);
    }, []);
    const optimisticWeights = useRef(new Map<string, number>());
    const pendingWorkoutStart = useRef<Promise<Workout> | null>(null);
    const cancelledWorkoutIds = useRef(new Set<number>());
    const calendarMonthsRef = useRef<Record<string, CalendarMonth>>({});
    const setLoadError = (key: keyof typeof loadErrors, failed: boolean) => setLoadErrors(current => { const next = { ...current }; if (failed) next[key] = `Could not load ${key}`; else delete next[key]; return next; });
    const loadDashboard = async () => { try { setDash(withOptimisticWeights(await api<Dash>('/dashboard'), optimisticWeights.current)); setLoadError('dashboard', false); } catch { setLoadError('dashboard', true); } };
    const loadFolders = async () => { try { setFolders(await api<Folder[]>('/folders')); setLoadError('folders', false); } catch { setLoadError('folders', true); } };
    const loadHistory = async () => { try { setHistory(await api<Workout[]>('/workouts')); setHistoryLoaded(true); setLoadError('history', false); } catch { setHistoryLoaded(true); setLoadError('history', true); } };
    const loadActive = async () => { try { setActive((await api<Workout[]>('/workouts/active')).filter(item => !item.id || !cancelledWorkoutIds.current.has(item.id))); setLoadError('active', false); } catch { setLoadError('active', true); } };
    const loadCalendar = useCallback(async (year: number, month: number, force = false) => { const key = `${year}-${String(month).padStart(2, '0')}`; if (!force && calendarMonthsRef.current[key]) return calendarMonthsRef.current[key]; try { const result = await api<CalendarMonth>(`/calendar?year=${year}&month=${month}`); calendarMonthsRef.current = { ...calendarMonthsRef.current, [key]: result }; setCalendarMonths(calendarMonthsRef.current); setLoadErrors(current => { const next = { ...current }; delete next.calendar; return next; }); return result; } catch { setLoadErrors(current => ({ ...current, calendar: 'Could not load calendar' })); return undefined; } }, []);

    const [dashboardPage, setDashboardPage] = useState(0);
    const coach = useCoachController(async operation => {
        if (operation === 'update_weekly_plan' || operation === 'create_training_program') {
            calendarMonthsRef.current = {};
            setCalendarMonths({});
            const date = new Date(); await loadCalendar(date.getFullYear(), date.getMonth() + 1, true);
            if (operation === 'create_training_program') await loadFolders();
        } else await loadFolders();
    });
    const now = new Date(), currentCalendarKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const refreshWorkoutData = async (calendarDate: string | Date = now) => { const date = typeof calendarDate === 'string' ? new Date(`${calendarDate}T12:00:00`) : calendarDate; await Promise.allSettled([loadDashboard(), loadHistory(), loadActive(), loadCalendar(date.getFullYear(), date.getMonth() + 1, true)]); };
    useEffect(() => { const initialDate = new Date(); void loadDashboard(); void loadFolders(); void loadHistory(); void loadActive(); void loadCalendar(initialDate.getFullYear(), initialDate.getMonth() + 1); }, [loadCalendar]); useEffect(() => localStorage.setItem('workout-theme', dark ? 'dark' : 'light'), [dark]);
    useEffect(() => { if (workout?.id && !workout.completed && !editing) localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(workout)); }, [workout, editing]);
    const start = async (routine: Routine) => { const optimistic = optimisticWorkoutFromRoutine(routine); setWorkout(optimistic); setEditing(false); setPage('workout'); const request = api<Workout>(`/routines/${routine.id}/start${routine.scheduled_on ? `?day=${routine.scheduled_on}` : ''}`, { method: 'POST' }); pendingWorkoutStart.current = request; try { const draft = await request; setWorkout(current => current ? { ...current, id: draft.id, started_at: draft.started_at, exercises: current.exercises.map((item, index) => ({ ...item, cached_exercise_id: draft.exercises[index]?.cached_exercise_id ?? item.exercise_id })) } : current); } catch { setWorkout(null); setPage('routines'); } finally { if (pendingWorkoutStart.current === request) pendingWorkoutStart.current = null; } };
    const resumableWorkout = workout && !workout.completed && !editing ? workout : active.find(entry => !entry.completed);
    const resumeWorkout = (entry: Workout) => { setWorkout(entry); setEditing(false); setPage('workout'); };
    const logFromDashboard = () => {
        if (resumableWorkout) { resumeWorkout(resumableWorkout); return; }
        setWorkout(null);
        setEditing(false);
        setPage('workout');
    };
    const pauseWorkout = async (entry: Workout) => {
        const started = entry.id ? null : await pendingWorkoutStart.current;
        const persisted = started ? { ...entry, id: started.id, started_at: started.started_at } : entry;
        if (!persisted.id) throw new Error('The session has not started yet');
        localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(persisted));
        await api(`/workouts/${persisted.id}`, { method: 'PATCH', body: JSON.stringify(persisted) });
        setActive(current => [persisted, ...current.filter(item => item.id !== persisted.id)]);
        setWorkout(persisted);
        setEditing(false);
        setPage('dashboard');
    };
    const finish = async (entry: Workout) => { const wasEditing = editing; setActive(current => current.filter(item => item.id !== entry.id)); setWorkout(null); setEditing(false); setPage(wasEditing ? 'history' : 'dashboard'); void (async () => { const started = entry.id ? null : await pendingWorkoutStart.current; const persistedEntry = started ? { ...entry, id: started.id } : entry; await api(`/workouts/${persistedEntry.id}`, { method: wasEditing ? 'PATCH' : 'PUT', body: JSON.stringify(persistedEntry) }); if (!wasEditing) localStorage.removeItem(ACTIVE_WORKOUT_KEY); await refreshWorkoutData(persistedEntry.performed_on); })().catch(() => { if (!wasEditing) localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(entry)); }); };
    const cancelWorkout = async (entry: Workout) => {
        if (!window.confirm(`Cancel “${entry.name}”? All progress in this workout will be permanently deleted.`)) return;
        const started = entry.id ? null : await pendingWorkoutStart.current;
        const persisted = started ? { ...entry, id: started.id } : entry;
        if (!persisted.id) throw new Error('The session has not started yet');
        await api(`/workouts/${persisted.id}`, { method: 'DELETE' });
        cancelledWorkoutIds.current.add(persisted.id);
        localStorage.removeItem(ACTIVE_WORKOUT_KEY);
        localStorage.removeItem(`workout-position:${persisted.id}`);
        setActive(current => current.filter(item => item.id !== persisted.id));
        setWorkout(null);
        setEditing(false);
        setPage('dashboard');
        await refreshWorkoutData(persisted.performed_on);
    };
    const repeatWorkout = async (previous: Workout) => {
        const matchingRoutine = folders.flatMap(folder => folder.routines).find(item => item.id === previous.routine_id);
        if (matchingRoutine) { await start(matchingRoutine); return; }
        const draft = await api<Workout>('/workouts/draft', { method: 'POST', body: JSON.stringify({ name: previous.name, performed_on: today() }) });
        const copied = await api<Workout>(`/workouts/${draft.id}`, { method: 'PATCH', body: JSON.stringify({ name: previous.name, performed_on: today(), exercises: previous.exercises.map(exercise => ({ ...exercise, sets: (exercise.sets ?? []).map(set => ({ ...set, completed: false })) })) }) });
        setWorkout(copied);
        setEditing(false);
        setPage('workout');
    };
    const pageError = page === 'coach' ? undefined : page === 'dashboard' ? loadErrors.dashboard : page === 'routines' ? loadErrors.folders : page === 'history' ? loadErrors.history : page === 'calendar' ? loadErrors.calendar : loadErrors.active || loadErrors.folders;
    return <div className={`app ${dark ? 'dark' : ''}`}><SavingIndicator/><Sidebar page={page} setPage={setPage} dark={dark} setDark={setDark} coachActive={Object.values(coach.streaming).some(Boolean)} user={user} hasActiveSession={page !== 'workout' && Boolean(resumableWorkout)} resumeSession={() => { if (resumableWorkout) resumeWorkout(resumableWorkout); }}/><main className="workspace">{pageError && <div className="error">{pageError}. Check that the tracker server is running.</div>}{page === 'dashboard' && <Dashboard dash={dash} history={history} historyLoaded={historyLoaded} calendar={calendarMonths[currentCalendarKey]} firstName={user.firstName} log={() => void logFromDashboard()} openCalendar={() => setPage('calendar')} openHistory={() => setPage('history')} openWorkout={entry => { setEditing(Boolean(entry.completed)); setWorkout(entry); setPage('workout'); }} targetPage={dashboardPage} onPageChange={setDashboardPage} saveWeight={async (weight, recordedOn) => {
        const date = recordedOn ?? today();
        const previousWeight = dash?.weight_series.find(entry => entry.recorded_on === date)?.weight;
        optimisticWeights.current.set(date, weight);
        setDash(current => withSavedWeight(current, { recorded_on: date, weight }));
        try {
            const saved = await api<SavedWeight>('/bodyweight', { method: 'POST', body: JSON.stringify({ recorded_on: date, weight }) });
            optimisticWeights.current.set(saved.recorded_on, saved.weight);
            setDash(current => withSavedWeight(current, saved));
        } catch (error) {
            if (optimisticWeights.current.get(date) === weight) {
                optimisticWeights.current.delete(date);
                setDash(current => previousWeight === undefined
                    ? current && { ...current, weight_series: current.weight_series.filter(entry => entry.recorded_on !== date), latest_weight: current.weight_series.filter(entry => entry.recorded_on !== date).at(-1) ?? null }
                    : withSavedWeight(current, { recorded_on: date, weight: previousWeight }));
            }
            throw error;
        }
    }}/>} {page === 'coach' && <Coach coach={coach} folders={folders} plan={calendarMonths[currentCalendarKey]?.plan ?? null}/>} {page === 'routines' && <Routines folders={folders} refresh={loadFolders} start={start} note={() => undefined}/>} {page === 'calendar' && <Calendar folders={folders} history={history} months={calendarMonths} loadMonth={loadCalendar} onWorkoutSaved={date => refreshWorkoutData(date)} start={start} repeatWorkout={repeatWorkout}/>} {page === 'workout' && <WorkoutLogger workout={workout} folders={folders} active={active} start={start} startAdHoc={async () => { const draft = await api<Workout>('/workouts/draft', { method: 'POST', body: JSON.stringify({ name: 'Workout', performed_on: today() }) }); setWorkout(draft); setEditing(false); }} setWorkout={setWorkout} editing={editing} finish={finish} saveEdit={finish} cancel={cancelWorkout} pause={pauseWorkout}/>} {page === 'history' && <History data={history} edit={entry => { setEditing(Boolean(entry.completed)); setWorkout(entry); setPage('workout'); }} refresh={loadHistory} note={() => undefined} repeat={repeatWorkout}/>}</main><MobileNavigation page={page} setPage={setPage} dashboardPage={dashboardPage} setDashboardPage={setDashboardPage} dark={dark} setDark={setDark} logWorkout={() => void logFromDashboard()} hasActiveSession={page !== 'workout' && Boolean(resumableWorkout)}/></div>;
}
