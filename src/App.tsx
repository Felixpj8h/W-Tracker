import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Coach } from './coach/Coach';
import { useCoachController } from './coach/useCoachController';
import { authHeaders, setGoogleIdToken } from './auth';
import { profileFromSession } from './profile';
import type { UserProfile } from './profile';
import './App.css';
import './routine.css';
import './logger.css';
import './motion.css';
import './mobile.css';
import './typography.css';
import './routine-manager.css';
import './workout-chooser.css';
import './mobile-dashboard.css';
import './bodyweight-chart-add.css';
import './calendar.css';
import './history-page.css';
import { HistoryAnalysis } from './HistoryAnalysis';
type Exercise = {
    id: number;
    name: string;
    equipment: string;
    primary_muscle?: string | null;
    secondary_muscles?: string[];
    muscle_group?: string | null;
};
type Item = {
    exercise_id?: number;
    cached_exercise_id?: number;
    exercise?: Exercise;
    name: string;
    primary_muscle?: string | null;
    secondary_muscles?: string[];
    muscle_group?: string | null;
    planned_sets?: number;
    target_reps?: number;
    target_reps_min?: number;
    target_reps_max?: number;
    target_weight?: number;
    rest_seconds?: number;
    note?: string;
    planned?: {
        exercise_id?: number;
        cached_exercise_id?: number;
        name: string;
        primary_muscle?: string | null;
        secondary_muscles?: string[];
        muscle_group?: string | null;
    };
    sets?: {
        weight: number;
        reps: number;
        exertion?: number;
    }[];
};
type Routine = {
    scheduled_on?: string;
    id: number;
    name: string;
    folder_id?: number;
    exercises: Item[];
};
type Folder = {
    id: number;
    name: string;
    routines: Routine[];
};
const routineMuscles = (routine: Routine) => [...new Set(routine.exercises.flatMap(item => (item.exercise?.primary_muscle ?? item.primary_muscle ?? '').replace(/\b(?:Primary|Secondary|Tertiary):\s*/gi, '').split(/[,·]/).map(value => value.trim()).filter(value => value && !/^unmapped/i.test(value))))].slice(0, 3).join(', ');
type Workout = {
    id?: number;
    routine_id?: number | null;
    name: string;
    performed_on: string;
    note?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    duration_seconds?: number | null;
    completed?: boolean;
    exercises: Item[];
};
type ExerciseProgress = { exercise: Exercise; sessions: { workout_id: number; performed_on: string; workout_name: string; sets: { weight: number; reps: number; exertion?: number }[]; volume: number; best_weight: number; estimated_1rm: number }[]; personal_best_weight: number; personal_best_1rm: number };
type Dash = {
    latest_weight: {
        recorded_on: string;
        weight: number;
    } | null;
    weight_series: {
        recorded_on: string;
        weight: number;
    }[];
    total_current_volume: number;
    total_previous_volume: number;
    volume_by_muscle_group: {
        name: string;
        current_week_volume: number;
        last_week_volume: number;
        current_week_sets?: number;
        last_week_sets?: number;
    }[];
    sets_by_muscle?: {
        name: string;
        current_week_sets: number;
        last_week_sets: number;
    }[];
};
type Page = 'dashboard' | 'routines' | 'workout' | 'coach' | 'calendar' | 'history';
const API = import.meta.env.VITE_API_URL ?? '/api/v1';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const ACTIVE_WORKOUT_KEY = 'workout-active-session';
const today = () => new Date().toISOString().slice(0, 10);
const cleanMuscleLabel = (value?: string | null, secondary: string[] = []) => {
    const primary = (value ?? '').replace(/^(?:Primary:\s*)+/i, '').split(' · ')[0].trim() || 'Unmapped';
    const uniqueSecondary = [...new Set(secondary.map(name => name.replace(/^Secondary:\s*/i, '').trim()).filter(name => name && name !== primary))];
    return `Primary: ${primary}${uniqueSecondary.length ? ` · Secondary: ${uniqueSecondary.join(', ')}` : ''}`;
};
const storedWorkout = (): Workout | null => {
    try {
        const value = localStorage.getItem(ACTIVE_WORKOUT_KEY);
        if (!value) return null;
        const parsed = JSON.parse(value) as Workout;
        return parsed && !parsed.completed && parsed.id && Array.isArray(parsed.exercises)
            ? { ...parsed, exercises: parsed.exercises.map(item => ({ ...item, primary_muscle: cleanMuscleLabel(item.primary_muscle, item.secondary_muscles) })) }
            : null;
    } catch {
        localStorage.removeItem(ACTIVE_WORKOUT_KEY);
        return null;
    }
};
let pendingBackendWrites = 0;
let backendWriteFailed = false;
type BackendWriteState = { pending: number; failed: boolean };
const announceBackendWrites = () => window.dispatchEvent(new CustomEvent<BackendWriteState>('backend-write-state', { detail: { pending: pendingBackendWrites, failed: backendWriteFailed } }));
const finishBackendWriteAfterPaint = (failed: boolean) => {
    const finish = () => {
        pendingBackendWrites = Math.max(0, pendingBackendWrites - 1);
        if (failed) backendWriteFailed = true;
        announceBackendWrites();
    };
    // Let the caller apply its response to React state, then keep the indicator
    // visible through the browser paint that presents that state to the user.
    if (document.visibilityState === 'hidden') setTimeout(finish, 0);
    else requestAnimationFrame(() => requestAnimationFrame(finish));
};
async function api<T>(path: string, opts?: RequestInit): Promise<T> {
    const isWrite = Boolean(opts?.method && opts.method.toUpperCase() !== 'GET');
    const optimisticWorkoutDelete = opts?.method?.toUpperCase() === 'DELETE' ? path.match(/^\/workouts\/(\d+)$/)?.[1] : undefined;
    if (isWrite) { if (pendingBackendWrites === 0) backendWriteFailed = false; pendingBackendWrites += 1; announceBackendWrites(); }
    if (optimisticWorkoutDelete) window.dispatchEvent(new CustomEvent('optimistic-workout-delete', { detail: { id: Number(optimisticWorkoutDelete), deleted: true } }));
    let failed = false;
    try {
        const response = await fetch(API + path, { ...opts, credentials: 'include', cache: 'no-store', headers: authHeaders({ 'Content-Type': 'application/json', ...Object.fromEntries(new Headers(opts?.headers)) }) });
        if (response.status === 401) window.dispatchEvent(new Event('google-auth-expired'));
        if (!response.ok) throw Error('Could not reach the tracker server');
        const payload = await response.json();
        // A successful HTTP response is sufficient for older API versions that
        // predate the optional `saved` acknowledgement. Only roll optimistic UI
        // back when the server explicitly reports that persistence failed.
        if (isWrite && payload?.saved === false) throw Error('The tracker server did not confirm that the change was saved');
        return payload as T;
    } catch (error) {
        failed = true;
        if (optimisticWorkoutDelete) window.dispatchEvent(new CustomEvent('optimistic-workout-delete', { detail: { id: Number(optimisticWorkoutDelete), deleted: false } }));
        throw error;
    } finally {
        if (isWrite) finishBackendWriteAfterPaint(failed);
    }
}
type SavedWeight = { recorded_on: string; weight: number; saved: true };
type WeightEntry = Pick<SavedWeight, 'recorded_on' | 'weight'>;
const withSavedWeight = (current: Dash | null, entry: WeightEntry): Dash | null => {
    if (!current) return current;
    const weightSeries = [...current.weight_series.filter(item => item.recorded_on !== entry.recorded_on), { recorded_on: entry.recorded_on, weight: entry.weight }]
        .sort((a, b) => a.recorded_on.localeCompare(b.recorded_on));
    return { ...current, weight_series: weightSeries, latest_weight: weightSeries.at(-1) ?? null };
};
const withOptimisticWeights = (dashboard: Dash, weights: Map<string, number>): Dash => {
    let result: Dash | null = dashboard;
    weights.forEach((weight, recorded_on) => { result = withSavedWeight(result, { recorded_on, weight }); });
    return result ?? dashboard;
};
const optimisticWorkoutFromRoutine = (routine: Routine): Workout => ({
    name: routine.name,
    performed_on: routine.scheduled_on ?? today(),
    started_at: new Date().toISOString(),
    completed: false,
    exercises: routine.exercises.map(item => ({
        ...item,
        exercise_id: item.exercise_id ?? item.exercise?.id,
        name: item.exercise?.name ?? item.name,
        primary_muscle: item.exercise?.primary_muscle ?? item.primary_muscle,
        secondary_muscles: item.exercise?.secondary_muscles ?? item.secondary_muscles,
        muscle_group: item.exercise?.muscle_group ?? item.muscle_group,
        rest_seconds: item.rest_seconds ?? 90,
        sets: Array.from({ length: item.planned_sets ?? 3 }, () => ({ weight: item.target_weight ?? 0, reps: item.target_reps_min ?? item.target_reps ?? 0 })),
    })),
});
const vol = (n: number) => Math.round(n).toLocaleString();
const duration = (seconds?: number | null) => seconds === null || seconds === undefined ? '—' : `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}h ` : ''}${Math.floor(seconds % 3600 / 60)} min`;
const formatClockTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const formatRestDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
export function WorkoutApp({ user }: { user: UserProfile }) {
    const [initialWorkout] = useState<Workout | null>(storedWorkout);
    const [page, setPage] = useState<Page>(() => initialWorkout ? 'workout' : 'dashboard'), [dash, setDash] = useState<Dash | null>(null), [folders, setFolders] = useState<Folder[]>([]), [history, setHistory] = useState<Workout[]>([]), [historyLoaded, setHistoryLoaded] = useState(false), [active, setActive] = useState<Workout[]>([]), [calendarMonths, setCalendarMonths] = useState<Record<string, CalendarMonth>>({}), [loadErrors, setLoadErrors] = useState<Partial<Record<'dashboard' | 'folders' | 'history' | 'active' | 'calendar', string>>>({}), [workout, setWorkout] = useState<Workout | null>(initialWorkout), [editing, setEditing] = useState(false), [dark, setDark] = useState(() => localStorage.getItem('workout-theme') !== 'light');
    const optimisticWeights = useRef(new Map<string, number>());
    const pendingWorkoutStart = useRef<Promise<Workout> | null>(null);
    const pendingDashboardLog = useRef(false);
    const calendarMonthsRef = useRef<Record<string, CalendarMonth>>({});
    const setLoadError = (key: keyof typeof loadErrors, failed: boolean) => setLoadErrors(current => { const next = { ...current }; if (failed) next[key] = `Could not load ${key}`; else delete next[key]; return next; });
    const loadDashboard = async () => { try { setDash(withOptimisticWeights(await api<Dash>('/dashboard'), optimisticWeights.current)); setLoadError('dashboard', false); } catch { setLoadError('dashboard', true); } };
    const loadFolders = async () => { try { setFolders(await api<Folder[]>('/folders')); setLoadError('folders', false); } catch { setLoadError('folders', true); } };
    const loadHistory = async () => { try { setHistory(await api<Workout[]>('/workouts')); setHistoryLoaded(true); setLoadError('history', false); } catch { setHistoryLoaded(true); setLoadError('history', true); } };
    const loadActive = async () => { try { setActive(await api<Workout[]>('/workouts/active')); setLoadError('active', false); } catch { setLoadError('active', true); } };
    const loadCalendar = useCallback(async (year: number, month: number, force = false) => { const key = `${year}-${String(month).padStart(2, '0')}`; if (!force && calendarMonthsRef.current[key]) return calendarMonthsRef.current[key]; try { const result = await api<CalendarMonth>(`/calendar?year=${year}&month=${month}`); calendarMonthsRef.current = { ...calendarMonthsRef.current, [key]: result }; setCalendarMonths(calendarMonthsRef.current); setLoadErrors(current => { const next = { ...current }; delete next.calendar; return next; }); return result; } catch { setLoadErrors(current => ({ ...current, calendar: 'Could not load calendar' })); return undefined; } }, []);
    const [moreOpen, setMoreOpen] = useState(false);
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
    const logFromDashboard = async () => {
        if (pendingDashboardLog.current) return;
        pendingDashboardLog.current = true;
        try {
            const date = new Date();
            const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const calendar = await loadCalendar(date.getFullYear(), date.getMonth() + 1);
            const scheduled = calendar?.days.find(day => day.date === dateKey);
            if (scheduled?.routine_id && scheduled.status !== 'completed') {
                const availableFolders = folders.length ? folders : await api<Folder[]>('/folders');
                const routine = availableFolders.flatMap(folder => folder.routines).find(item => item.id === scheduled.routine_id);
                if (routine) {
                    const inProgress = active.find(item => !item.completed && item.performed_on === dateKey && item.name === routine.name);
                    if (inProgress) { setWorkout(inProgress); setEditing(false); setPage('workout'); return; }
                    await start(routine);
                    return;
                }
            }
            setWorkout(null);
            setEditing(false);
            setPage('workout');
        } catch {
            setWorkout(null);
            setEditing(false);
            setPage('workout');
        } finally {
            pendingDashboardLog.current = false;
        }
    };
    const finish = async (entry: Workout) => { const wasEditing = editing; setWorkout(null); setEditing(false); setPage(wasEditing ? 'history' : 'dashboard'); void (async () => { const started = entry.id ? null : await pendingWorkoutStart.current; const persistedEntry = started ? { ...entry, id: started.id } : entry; await api(`/workouts/${persistedEntry.id}`, { method: wasEditing ? 'PATCH' : 'PUT', body: JSON.stringify(persistedEntry) }); if (!wasEditing) localStorage.removeItem(ACTIVE_WORKOUT_KEY); await refreshWorkoutData(persistedEntry.performed_on); })().catch(() => { if (!wasEditing) localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(entry)); }); };
    const cancelWorkout = async (entry: Workout) => { if (!window.confirm(`Cancel “${entry.name}”? All progress in this workout will be permanently deleted.`)) return; setActive(current => current.filter(item => item.id !== entry.id)); setWorkout(null); setEditing(false); setPage('dashboard'); if (entry.id) void api(`/workouts/${entry.id}`, { method: 'DELETE' }).then(async () => { localStorage.removeItem(ACTIVE_WORKOUT_KEY); await refreshWorkoutData(entry.performed_on); }).catch(() => { setActive(current => current.some(item => item.id === entry.id) ? current : [...current, entry]); localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(entry)); }); };
    const repeatWorkout = async (previous: Workout) => {
        const matchingRoutine = folders.flatMap(folder => folder.routines).find(item => item.id === previous.routine_id);
        if (matchingRoutine) { await start(matchingRoutine); return; }
        const draft = await api<Workout>('/workouts/draft', { method: 'POST', body: JSON.stringify({ name: previous.name, performed_on: today() }) });
        const copied = await api<Workout>(`/workouts/${draft.id}`, { method: 'PATCH', body: JSON.stringify({ name: previous.name, performed_on: today(), exercises: previous.exercises.map(exercise => ({ ...exercise, sets: (exercise.sets ?? []).map(set => ({ ...set })) })) }) });
        setWorkout(copied);
        setEditing(false);
        setPage('workout');
    };
    const pageError = page === 'coach' ? undefined : page === 'dashboard' ? loadErrors.dashboard : page === 'routines' ? loadErrors.folders : page === 'history' ? loadErrors.history : page === 'calendar' ? loadErrors.calendar : loadErrors.active || loadErrors.folders;
    return <div className={`app ${dark ? 'dark' : ''}`}><SavingIndicator/><Side page={page} setPage={setPage} dark={dark} setDark={setDark} coachActive={Object.values(coach.streaming).some(Boolean)} user={user}/><main className="workspace">{pageError && <div className="error">{pageError}. Check that the tracker server is running.</div>}{page === 'dashboard' && <Dashboard dash={dash} history={history} historyLoaded={historyLoaded} calendar={calendarMonths[currentCalendarKey]} firstName={user.firstName} log={() => void logFromDashboard()} openCalendar={() => setPage('calendar')} openHistory={() => setPage('history')} openWorkout={entry => { setEditing(Boolean(entry.completed)); setWorkout(entry); setPage('workout'); }} targetPage={dashboardPage} onPageChange={setDashboardPage} saveWeight={async (weight, recordedOn) => {
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
    }}/>} {page === 'coach' && <Coach coach={coach} folders={folders} plan={calendarMonths[currentCalendarKey]?.plan ?? null}/>} {page === 'routines' && <Routines folders={folders} refresh={loadFolders} start={start} note={() => undefined}/>} {page === 'calendar' && <Calendar folders={folders} history={history} months={calendarMonths} loadMonth={loadCalendar} onWorkoutSaved={date => refreshWorkoutData(date)} start={start} repeatWorkout={repeatWorkout}/>} {page === 'workout' && <Logger workout={workout} folders={folders} active={active} start={start} startAdHoc={async () => { const draft = await api<Workout>('/workouts/draft', { method: 'POST', body: JSON.stringify({ name: 'Workout', performed_on: today() }) }); setWorkout(draft); setEditing(false); }} setWorkout={setWorkout} editing={editing} finish={finish} saveEdit={finish} cancel={cancelWorkout}/>} {page === 'history' && <History data={history} edit={entry => { setEditing(Boolean(entry.completed)); setWorkout(entry); setPage('workout'); }} refresh={loadHistory} note={() => undefined} repeat={repeatWorkout}/>}</main><div className="mobile"><button className={page === 'dashboard' && dashboardPage === 0 ? 'active' : ''} onClick={() => { setDashboardPage(0); setPage('dashboard'); }}><span aria-hidden="true">⌂</span><small>Dashboard</small></button><button className={page === 'routines' ? 'active' : ''} onClick={() => setPage('routines')}><span aria-hidden="true">▤</span><small>Routines</small></button><button className={page === 'workout' ? 'active mobile-log' : 'mobile-log'} onClick={() => { setMoreOpen(false); void logFromDashboard(); }}><span aria-hidden="true">＋</span><small>Log workout</small></button><button className={page === 'coach' ? 'active' : ''} onClick={() => { setMoreOpen(false); setPage('coach'); }}><span aria-hidden="true">✦</span><small>Coach</small></button><button className={moreOpen || page === 'calendar' || page === 'history' || (page === 'dashboard' && dashboardPage > 0) ? 'active' : ''} aria-label="More pages" aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}><span aria-hidden="true">⋯</span><small>More</small></button></div>{moreOpen && <div className="more-wrap"><button className="more-backdrop" aria-label="Close More menu" onClick={() => setMoreOpen(false)}/><div className="more-sheet" role="dialog" aria-label="More"><button onClick={() => { setDashboardPage(1); setPage('dashboard'); setMoreOpen(false); }}>▥ Progress</button><button onClick={() => { setDashboardPage(2); setPage('dashboard'); setMoreOpen(false); }}>▤ Activity</button><button onClick={() => { setPage('calendar'); setMoreOpen(false); }}>▣ Calendar</button><button onClick={() => { setPage('history'); setMoreOpen(false); }}>◷ History</button><label className="switch"><input type="checkbox" checked={dark} onChange={event => setDark(event.target.checked)}/><span/>Dark mode</label></div></div>}</div>;
}

export default function App() {
    const [token, setToken] = useState('');
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [googleReady, setGoogleReady] = useState(false);
    const [checking, setChecking] = useState(false);
    const [authError, setAuthError] = useState('');
    const [restoring, setRestoring] = useState(true);
    const googleButton = useRef<HTMLDivElement>(null);
    const signOut = useCallback(() => {
        window.google?.accounts.id.disableAutoSelect();
        setGoogleIdToken('');
        setToken('');
        setProfile(null);
        setChecking(false);
        void fetch(`${API}/session/logout`, { method: 'POST', credentials: 'include' });
    }, []);

    useEffect(() => {
        let cancelled = false;
        void fetch(`${API}/session`, { credentials: 'include' }).then(async response => {
            if (!response.ok) return;
            const body = await response.json() as { email?: string; name?: string; given_name?: string };
            if (!cancelled && body.email) {
                setProfile(profileFromSession(body));
                setToken('session');
            }
        }).catch(() => undefined).finally(() => { if (!cancelled) setRestoring(false); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        window.addEventListener('google-auth-expired', signOut);
        window.addEventListener('google-sign-out', signOut);
        return () => {
            window.removeEventListener('google-auth-expired', signOut);
            window.removeEventListener('google-sign-out', signOut);
        };
    }, [signOut]);

    useEffect(() => {
        if (token || restoring) return;
        if (!GOOGLE_CLIENT_ID) {
            setAuthError('Google sign-in is not configured. Add VITE_GOOGLE_CLIENT_ID to your environment.');
            return;
        }
        const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
        const script = existing ?? document.createElement('script');
        const initialize = () => {
            if (!window.google) return;
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: async response => {
                    setChecking(true);
                    setAuthError('');
                    setGoogleIdToken(response.credential);
                    try {
                        const validation = await fetch(`${API}/session`, { credentials: 'include', headers: authHeaders() });
                        const body = await validation.json().catch(() => null) as { detail?: string; email?: string; name?: string; given_name?: string } | null;
                        if (!validation.ok) throw new Error(body?.detail ?? 'This Google account cannot access the workout tracker.');
                        const authenticatedProfile = profileFromSession(body ?? {});
                        if (!authenticatedProfile.email) throw new Error('Google did not return an email address for this account.');
                        setProfile(authenticatedProfile);
                        setGoogleIdToken('');
                        setToken('session');
                    } catch (error) {
                        setGoogleIdToken('');
                        setAuthError(error instanceof Error ? error.message : 'Google sign-in failed.');
                    } finally {
                        setChecking(false);
                    }
                },
            });
            setGoogleReady(true);
        };
        script.addEventListener('load', initialize);
        script.addEventListener('error', () => setAuthError('Could not load Google sign-in. Check your connection.'));
        if (!existing) {
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            document.head.appendChild(script);
        } else initialize();
        return () => script.removeEventListener('load', initialize);
    }, [token, restoring]);

    useEffect(() => {
        if (token || restoring || !googleReady || checking || !window.google || !googleButton.current) return;
        googleButton.current.replaceChildren();
        window.google.accounts.id.renderButton(googleButton.current, {
            type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with',
            shape: 'rectangular', logo_alignment: 'left', width: Math.min(360, Math.max(280, googleButton.current.clientWidth || 360)),
        });
    }, [checking, googleReady, restoring, token]);

    if (token && profile) return <WorkoutApp user={profile}/>;
    return <main className="auth-shell"><section className="auth-card" aria-labelledby="auth-title"><div className="auth-brand">W</div><p className="overline">WORKOUT TRACKER</p><h1 id="auth-title">Your training,<br/><em>kept personal.</em></h1><p>Sign in with your Google account to open your workout workspace.</p><div className="google-login" ref={googleButton}>{restoring ? 'Restoring your session…' : checking ? 'Checking your account…' : !googleReady && !authError ? 'Loading Google sign-in…' : null}</div>{authError && <p className="auth-error" role="alert">{authError}</p>}</section></main>;
}

function Side({ page, setPage, dark, setDark, user, coachActive = false }: { page: Page; setPage: (page: Page) => void; dark: boolean; setDark: (value: boolean) => void; user?: UserProfile; coachActive?: boolean }) {
    const links: [Page, string, string][] = [['dashboard', '▦', 'Dashboard'], ['routines', '▤', 'Routines'], ['workout', '＋', 'Log workout'], ['coach', '✦', 'Coach'], ['calendar', '□', 'Calendar'], ['history', '◷', 'History']];
    const label = user?.name || user?.firstName || 'My training';
    return <aside className="sidebar"><div className="brand"><b>W</b><span>workout<br />tracker</span></div><div className="person"><i>{(user?.firstName || 'M').charAt(0).toLocaleUpperCase()}</i><div><b>{label}</b><small>Personal workspace</small></div></div><nav className="side-nav">{links.map(([id, icon, linkLabel]) => <button key={id} className={`side-link ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}><i>{icon}</i><span>{linkLabel}</span>{id === "coach" && coachActive && <span className="coach-dot"/>}</button>)}</nav><footer><label className="switch"><input type="checkbox" checked={dark} onChange={event => setDark(event.target.checked)}/><span />Dark mode</label><button className="sign-out" type="button" onClick={() => window.dispatchEvent(new Event('google-sign-out'))}>Sign out</button><small>Built for the work.</small></footer></aside>;
}
function SavingIndicator() {
    const [state, setState] = useState<BackendWriteState>({ pending: pendingBackendWrites, failed: backendWriteFailed });
    useEffect(() => { const update = (event: Event) => setState((event as CustomEvent<BackendWriteState>).detail); window.addEventListener('backend-write-state', update); return () => window.removeEventListener('backend-write-state', update); }, []);
    const visible = state.pending > 0 || state.failed;
    return <div className={`backend-saving ${visible ? 'visible' : ''} ${state.failed ? 'failed' : ''}`} role="status" aria-live="polite" aria-label={state.failed ? 'Changes not saved' : state.pending ? 'Saving changes' : undefined}><i aria-hidden="true"/><span>{state.failed ? 'Not saved' : 'Saving'}</span></div>;
}
function Head({ children, action }: {
    children: React.ReactNode;
    action?: React.ReactNode;
}) { return <header className="head"><div>{children}</div>{action}</header>; }
function DashboardIcon({ name }: { name: 'scale' | 'volume' | 'session' | 'clock' | 'calendar' | 'chevron' }) {
    const paths = {
        scale: <><path d="M5 19a8 8 0 1 1 14 0"/><path d="M12 7v3"/><path d="m12 10 3-2"/><path d="M5 19h14"/></>,
        volume: <><path d="M5 20v-6M10 20V9M15 20V4M20 20v-9"/></>,
        session: <><path d="M4 10v4M7 8v8M17 8v8M20 10v4M7 12h10"/></>,
        clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>,
        calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></>,
        chevron: <path d="m9 10 3 3 3-3"/>,
    };
    return <svg className="dashboard-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
export function DashboardGreeting({ dash, history, historyLoaded, calendar, firstName }: { dash: Dash | null; history: Workout[]; historyLoaded: boolean; calendar?: CalendarMonth; firstName: string }) {
    const greeting = `Hello ${firstName}.`;
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const todayPlan = calendar?.days.find(day => day.date === date);
    const completedWorkouts = history.filter(entry => entry.completed);
    const calendarMessage = (() => {
        if (todayPlan === undefined) return greeting;
        if (todayPlan === null) return 'Enjoy the rest day.';
        if (todayPlan.status === 'completed') return `Today’s ${todayPlan.workout_name ?? todayPlan.routine_name ?? 'workout'} is complete. Great work!`;
        return todayPlan.routine_name ? `Ready for today’s ${todayPlan.routine_name} workout?` : 'Enjoy the rest day.';
    })();
    const current = dash?.total_current_volume ?? 0;
    const previous = dash?.total_previous_volume ?? 0;
    const groups = dash?.volume_by_muscle_group ?? [];
    const leadGroup = [...groups].sort((a, b) => b.current_week_volume - a.current_week_volume)[0];
    const loggedExercises = (completedWorkouts ?? []).flatMap(workout => workout.exercises.map(exercise => ({ ...exercise, workoutName: workout.name })));
    const featuredExercise = loggedExercises.length ? loggedExercises[(new Date().getDate() + loggedExercises.length) % loggedExercises.length] : null;
    const featuredReps = featuredExercise?.sets?.reduce((sum, set) => sum + set.reps, 0) ?? 0;
    const facts = [
        `${current.toLocaleString()} kg of training volume logged this week.`,
        previous > 0 ? `Your training volume is ${Math.abs(Math.round((current - previous) / previous * 100))}% ${current >= previous ? 'higher' : 'lower'} than last week.` : 'Your next completed session will unlock a weekly comparison.',
        dash?.latest_weight ? `Your current tracked weight is ${dash.latest_weight.weight.toFixed(1)} kg.` : 'Add a weigh-in to begin tracking your bodyweight trend.',
        leadGroup ? `${leadGroup.name} is your highest-volume muscle group this week.` : 'Log your first workout to see your muscle-group focus.',
        completedWorkouts?.length ? `You have completed ${completedWorkouts.length} workout${completedWorkouts.length === 1 ? '' : 's'} so far.` : 'Finish your first workout to start your completed-session count.',
        featuredExercise ? `${featuredReps} reps logged for ${featuredExercise.name}.` : 'A completed workout will unlock an exercise snapshot here.'
    ];
    const messages = [calendarMessage, ...facts];
    const factKey = messages.join('|');
    const [text, setText] = useState('');
    const backendReady = dash !== null && historyLoaded && calendar !== undefined;
    useEffect(() => {
        if (!backendReady) return;
        let timer: ReturnType<typeof setTimeout>;
        let character = 0;
        let message = 0;
        const type = (value: string) => {
            character = 0;
            const tick = () => {
                character += 1;
                setText(value.slice(0, character));
                if (character < value.length) timer = setTimeout(tick, 34);
                else timer = setTimeout(erase, 2100);
            };
            tick();
        };
        const erase = () => {
            const tick = () => {
                character -= 1;
                setText((message === 0 ? greeting : messages[message - 1]).slice(0, character));
                if (character > 0) timer = setTimeout(tick, 18);
                else {
                    message = message === messages.length ? 1 : message + 1;
                    timer = setTimeout(() => type(message === 0 ? greeting : messages[message - 1]), 260);
                }
            };
            tick();
        };
        setText('');
        timer = setTimeout(() => type(greeting), 280);
        return () => clearTimeout(timer);
    }, [backendReady, factKey, greeting]);
    return <p className="dashboard-greeting" aria-live="polite">{backendReady && <><span>{text}</span><i aria-hidden="true" /></>}</p>;
}
function LegacyDashboard({ dash, history, historyLoaded: _historyLoaded, calendar, firstName, log, openCalendar, openHistory, openWorkout, saveWeight }: {
    dash: Dash | null;
    history: Workout[];
    historyLoaded: boolean;
    calendar?: CalendarMonth;
    firstName: string;
    log: () => void;
    openCalendar: () => void;
    openHistory: () => void;
    openWorkout: (workout: Workout) => void;
    saveWeight: (n: number, recordedOn?: string) => Promise<void>;
}) {
    const [muscleMetric, setMuscleMetric] = useState<'volume' | 'sets'>('volume');
    const volumeGroups = dash?.volume_by_muscle_group ?? [];
    const muscleName = (value: string | null | undefined, exerciseName: string) => {
        const key = (value ?? '').replace(/^(?:Primary:\s*)+/i, '').split(' · ')[0].trim().toLowerCase();
        const name = exerciseName.toLowerCase();
        const exact: Record<string, string> = {
            'chest': 'Chest', 'pectoralis major': 'Chest', 'pectoralis minor': 'Chest',
            'lats': 'Lats', 'latissimus dorsi': 'Lats', 'back': 'Lats', 'trapezius': 'Traps', 'traps': 'Traps',
            'rhomboids': 'Rhomboids', 'lower back': 'Spinal erectors', 'spinal erectors': 'Spinal erectors',
            'anterior deltoid': 'Front delts', 'front delts': 'Front delts', 'lateral deltoid': 'Side delts', 'side delts': 'Side delts',
            'posterior deltoid': 'Rear delts', 'rear delts': 'Rear delts', 'biceps': 'Biceps', 'biceps brachii': 'Biceps',
            'brachialis': 'Biceps', 'triceps': 'Triceps', 'triceps brachii': 'Triceps', 'forearm': 'Forearms', 'forearms': 'Forearms',
            'quadriceps': 'Quads', 'quadriceps femoris': 'Quads', 'quads': 'Quads', 'hamstrings': 'Hamstrings', 'biceps femoris': 'Hamstrings',
            'glutes': 'Glutes', 'gluteus maximus': 'Glutes', 'calves': 'Calves', 'gastrocnemius': 'Calves', 'soleus': 'Calves',
            'adductors': 'Adductors', 'abs': 'Abs', 'abdominals': 'Abs', 'rectus abdominis': 'Abs',
            'obliques': 'Obliques', 'obliquus externus abdominis': 'Obliques'
        };
        if (key === 'shoulders') return name.includes('rear') ? 'Rear delts' : name.includes('lateral') ? 'Side delts' : 'Front delts';
        if (key === 'arms') return /tricep|pressdown|pushdown/.test(name) ? 'Triceps' : /forearm|wrist/.test(name) ? 'Forearms' : 'Biceps';
        if (key === 'legs') return /deadlift|leg curl/.test(name) ? 'Hamstrings' : /hip thrust|glute/.test(name) ? 'Glutes' : name.includes('calf') ? 'Calves' : name.includes('adductor') ? 'Adductors' : 'Quads';
        if (key === 'core') return /oblique|side bend/.test(name) ? 'Obliques' : 'Abs';
        return exact[key] ?? null;
    };
    const derivedMuscleSets = (() => {
        const now = new Date();
        const currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
        const previousStart = new Date(currentStart); previousStart.setDate(previousStart.getDate() - 7);
        const totals = new Map<string, { name: string; current_week_sets: number; last_week_sets: number }>();
        history.filter(workout => workout.completed && new Date(`${workout.performed_on}T12:00:00`) >= previousStart).forEach(workout => {
            const current = new Date(`${workout.performed_on}T12:00:00`) >= currentStart;
            workout.exercises.forEach(exercise => {
                const primary = (exercise.primary_muscle ?? '').replace(/^(?:Primary:\s*)+/i, '').split(' · ')[0];
                const muscles = [primary, ...(exercise.secondary_muscles ?? [])].map(value => muscleName(value, exercise.name)).filter((value): value is string => Boolean(value));
                [...new Set(muscles)].forEach(name => {
                    const total = totals.get(name) ?? { name, current_week_sets: 0, last_week_sets: 0 };
                    total[current ? 'current_week_sets' : 'last_week_sets'] += exercise.sets?.length ?? 0;
                    totals.set(name, total);
                });
            });
        });
        return [...totals.values()];
    })();
    const apiMuscleSets = dash?.sets_by_muscle ?? [];
    const muscleSets = (apiMuscleSets.some(muscle => muscle.current_week_sets > 0 || muscle.last_week_sets > 0) ? apiMuscleSets : derivedMuscleSets)
        .filter(muscle => muscle.current_week_sets > 0 || muscle.last_week_sets > 0)
        .map(muscle => ({ ...muscle, name: /pectoralis|^chest$/i.test(muscle.name) ? 'Chest' : muscle.name }))
        .reduce<{ name: string; current_week_sets: number; last_week_sets: number }[]>((groups, muscle) => {
            const existing = groups.find(group => group.name === muscle.name);
            if (existing) { existing.current_week_sets += muscle.current_week_sets; existing.last_week_sets += muscle.last_week_sets; }
            else groups.push({ name: muscle.name, current_week_sets: muscle.current_week_sets, last_week_sets: muscle.last_week_sets });
            return groups;
        }, []);
    const rows = muscleMetric === 'volume'
        ? volumeGroups.map(group => ({ name: group.name, current: group.current_week_volume, previous: group.last_week_volume }))
        : muscleSets.map(muscle => ({ name: muscle.name, current: muscle.current_week_sets, previous: muscle.last_week_sets }));
    const max = Math.max(1, ...rows.flatMap(row => [row.current, row.previous]));
    const completed = history.filter(workout => workout.completed).sort((a, b) => b.performed_on.localeCompare(a.performed_on));
    const now = new Date(), weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
    const thisWeek = completed.filter(workout => { const date = new Date(`${workout.performed_on}T12:00:00`); return date >= weekStart && date < weekEnd; });
    const previousWeekStart = new Date(weekStart); previousWeekStart.setDate(previousWeekStart.getDate() - 7);
    const previousWeekSessions = completed.filter(workout => { const date = new Date(`${workout.performed_on}T12:00:00`); return date >= previousWeekStart && date < weekStart; }).length;
    const sessionChange = thisWeek.length - previousWeekSessions;
    const previousVolume = dash?.total_previous_volume ?? 0, currentVolume = dash?.total_current_volume ?? 0;
    const volumeChange = previousVolume ? Math.round((currentVolume - previousVolume) / previousVolume * 100) : null;
    const monthWeights = (dash?.weight_series ?? []).filter(entry => { const date = new Date(`${entry.recorded_on}T12:00:00`); return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear(); });
    const weightChange = monthWeights.length > 1 ? monthWeights.at(-1)!.weight - monthWeights[0].weight : null;
    const lastWorkout = completed[0];
    const lastWorkoutDays = lastWorkout ? Math.max(0, Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(`${lastWorkout.performed_on}T12:00:00`).getTime()) / 86400000)) : null;
    const lastWorkoutLabel = lastWorkoutDays === null ? '—' : lastWorkoutDays === 0 ? 'Today' : lastWorkoutDays === 1 ? 'Yesterday' : `${lastWorkoutDays} days ago`;
    const workoutVolume = (workout: Workout) => workout.exercises.reduce((sum, exercise) => sum + (exercise.sets ?? []).reduce((setSum, set) => setSum + set.weight * set.reps, 0), 0);
    const workoutSets = (workout: Workout) => workout.exercises.reduce((sum, exercise) => sum + (exercise.sets?.length ?? 0), 0);
    const dateParts = (date: string) => { const value = new Date(`${date}T12:00:00`); return { month: value.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(), day: value.toLocaleDateString(undefined, { day: '2-digit' }) }; };
    const todayDate = today();
    const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const weekDays = Array.from({ length: 7 }, (_, index) => { const date = new Date(weekStart); date.setDate(date.getDate() + index); const key = localDateKey(date); const plan = calendar?.days.find(day => day.date === key); const workout = completed.find(entry => entry.performed_on === key); return { date, key, plan, workout }; });
    const upcoming = (calendar?.days ?? []).filter(day => day.date >= todayDate && day.status !== 'completed').slice(0, 4);
    const relativeDay = (date: string) => date === todayDate ? 'Today' : new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
    return <>
        <section className="dashboard-overview-page">
        <div className="mobile-dashboard-topbar"><span><b>W</b><em>WORKOUT<br/>TRACKER</em></span><span><small>Today</small><time>{now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></span><i>{firstName.charAt(0).toUpperCase()}</i></div>
        <Head action={<div className="dashboard-head-actions"><button className="primary dashboard-log" onClick={log}>＋ Log workout</button><button className="today-control" type="button"><DashboardIcon name="calendar"/><span><b>Today</b><small>{now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</small></span><DashboardIcon name="chevron"/></button></div>}><h1>Good afternoon, {firstName}</h1><DashboardGreeting dash={dash} history={history} historyLoaded={_historyLoaded} calendar={calendar} firstName={firstName}/></Head>
        <section className="dashboard-metrics" aria-label="Training summary">
            <Stat icon="scale" label="Current weight" value={dash?.latest_weight ? `${dash.latest_weight.weight.toFixed(1)} kg` : '—'} sub={weightChange === null ? 'Add another entry for a trend' : `${weightChange >= 0 ? '+' : ''}${weightChange.toFixed(1)} kg this month ${weightChange >= 0 ? '↑' : '↓'}`}/>
            <Stat icon="volume" label="Weekly volume" value={`${vol(currentVolume)} kg`} sub={volumeChange === null ? 'No comparison yet' : `${volumeChange >= 0 ? '+' : ''}${volumeChange}% vs last week ${volumeChange >= 0 ? '↑' : '↓'}`}/>
            <Stat icon="session" label="Sessions this week" value={String(thisWeek.length)} sub={previousWeekSessions || thisWeek.length ? `${Math.abs(sessionChange)} ${sessionChange >= 0 ? 'more' : 'fewer'} than last week ${sessionChange >= 0 ? '↑' : '↓'}` : 'No sessions logged yet'}/>
            <Stat icon="clock" label="Last workout" value={lastWorkoutLabel} sub={lastWorkout ? `${lastWorkout.name} · ${workoutSets(lastWorkout)} sets` : 'Log your first workout'}/>
        </section>
        <section className="mobile-dashboard-home" aria-label="This week"><div className="mobile-card-heading"><h2>This week</h2><button type="button" onClick={openCalendar}>View all →</button></div><div className="mobile-week-days">{weekDays.map(({ date, key, workout }) => <span key={key} className={workout ? 'complete' : ''}><small>{date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)}</small><i>{workout ? '✓' : ''}</i></span>)}</div></section>
        </section>
        <section className="dashboard-analytics"><h1 className="mobile-swipe-title">Progress</h1>
            <BodyweightCard dash={dash} saveWeight={saveWeight}/>
            <article className={`dashboard-volume ${muscleMetric === 'sets' ? 'sets-mode' : ''}`}><div className="muscle-card-head"><div><h2>{muscleMetric === 'volume' ? 'Volume by muscle group' : 'Sets by muscle'}</h2><p>This week compared with last week.</p></div><div className="metric-toggle" role="group" aria-label="Muscle metric"><button className={muscleMetric === 'volume' ? 'active' : ''} onClick={() => setMuscleMetric('volume')}>Volume</button><button className={muscleMetric === 'sets' ? 'active' : ''} onClick={() => setMuscleMetric('sets')}>Sets</button></div></div>{rows.length ? <div className="muscle-rows" onWheel={event => { if (muscleMetric === 'sets' && Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY; }}>{(muscleMetric === 'volume' ? rows.slice(0, 7) : rows).map(row => { const change = row.previous ? Math.round((row.current - row.previous) / row.previous * 100) : null; return <div className="muscle-row" key={`${muscleMetric}-${row.name}`}><b>{row.name}</b><div><i style={{ width: `${row.current / max * 100}%` }}/></div><span>{muscleMetric === 'volume' ? `${vol(row.current)} kg` : `${row.current} sets`}</span><small className={change !== null && change < 0 ? 'negative' : ''}>{change === null ? '—' : `${change >= 0 ? '+' : ''}${change}%`}</small></div>; })}</div> : <div className="dashboard-empty"><b>No workouts logged this week</b><span>Log a workout to start tracking volume by muscle group.</span><button onClick={log}>Log workout</button></div>}</article>
        </section>
        <section className="dashboard-lower"><h1 className="mobile-swipe-title">Activity</h1>
            <article className="recent-workouts"><div className="section-heading"><h2>Recent workouts</h2>{completed.length ? <button type="button" onClick={openHistory}>View all →</button> : null}</div>{completed.length ? completed.slice(0, 3).map(workout => { const date = dateParts(workout.performed_on); return <button type="button" className="recent-row" onClick={() => openWorkout(workout)} key={workout.id ?? `${workout.performed_on}-${workout.name}`}><time><small>{date.month}</small><strong>{date.day}</strong></time><span className="recent-row-copy"><b>{workout.name}</b><small>{[...new Set(workout.exercises.map(exercise => (exercise.primary_muscle ?? exercise.muscle_group ?? '').replace(/^Primary:\s*/i, '').split(' · ')[0]).filter(Boolean))].slice(0, 3).join(' · ') || 'Workout session'}</small></span><span>{workoutSets(workout)} sets · {duration(workout.duration_seconds)} · {vol(workoutVolume(workout))} kg</span><i aria-hidden="true">›</i></button>; }) : <div className="lower-empty">Your completed workouts will appear here.</div>}</article>
            <article className="week-overview"><div className="section-heading"><h2>This week</h2><span>{thisWeek.length} sessions</span></div>{weekDays.map(({ date, key, plan, workout }) => <div className="week-row" key={key}><span>{date.toLocaleDateString(undefined, { weekday: 'short' })}</span><b>{workout?.name ?? plan?.routine_name ?? plan?.workout_name ?? 'Rest'}</b>{workout && <i aria-label="Completed">✓</i>}</div>)}</article>
            <article className="upcoming-workouts"><div className="section-heading"><h2>Upcoming</h2><button type="button" onClick={openCalendar}>View calendar →</button></div>{upcoming.length ? upcoming.map(day => <div className="upcoming-row" key={day.date}><time>{relativeDay(day.date)}</time><i className="upcoming-status" aria-hidden="true"/><b>{day.routine_name ?? day.workout_name ?? 'Rest day'}</b><i aria-hidden="true">⋮</i></div>) : <div className="lower-empty">No upcoming sessions planned.</div>}</article>
        </section>
    </>;
}
function Dashboard({ dash, history, historyLoaded = false, calendar, firstName = 'Athlete', log, openCalendar = () => undefined, openHistory = () => undefined, openWorkout = () => undefined, targetPage = 0, onPageChange = () => undefined, saveWeight }: { dash: Dash | null; history: Workout[]; historyLoaded?: boolean; calendar?: CalendarMonth; firstName?: string; log: () => void; openCalendar?: () => void; openHistory?: () => void; openWorkout?: (workout: Workout) => void; targetPage?: number; onPageChange?: (page: number) => void; saveWeight: (n: number, recordedOn?: string) => Promise<void> }) {
    const dashboardRef = useRef<HTMLDivElement>(null);
    const [visiblePage, setVisiblePage] = useState(targetPage);
    useEffect(() => {
        const workspace = dashboardRef.current?.closest('main');
        workspace?.classList.add('dashboard-workspace');
        workspace?.style.setProperty('--dashboard-inline-gutter', '28px');
        return () => { workspace?.classList.remove('dashboard-workspace'); workspace?.style.removeProperty('--dashboard-inline-gutter'); };
    }, []);
    useEffect(() => { const shell = dashboardRef.current; if (shell && window.matchMedia('(max-width: 760px)').matches) { shell.style.scrollBehavior = 'auto'; shell.scrollLeft = shell.clientWidth * targetPage; setVisiblePage(targetPage); requestAnimationFrame(() => shell.style.removeProperty('scroll-behavior')); } }, [targetPage]);
    return <><div className="dashboard-shell" ref={dashboardRef} onScroll={event => { const shell = event.currentTarget; const next = Math.max(0, Math.min(2, Math.round(shell.scrollLeft / Math.max(1, shell.clientWidth)))); if (next !== visiblePage) { setVisiblePage(next); onPageChange(next); } }}><LegacyDashboard dash={dash} history={history} historyLoaded={historyLoaded} calendar={calendar} firstName={firstName} log={log} openCalendar={openCalendar} openHistory={openHistory} openWorkout={openWorkout} saveWeight={saveWeight}/></div><div className="dashboard-page-indicator" aria-label={`Dashboard page ${visiblePage + 1} of 3`}>{[0, 1, 2].map(index => <button type="button" aria-label={`Go to ${['Overview', 'Progress', 'Activity'][index]}`} aria-current={visiblePage === index ? 'page' : undefined} key={index} onClick={() => { const shell = dashboardRef.current; shell?.scrollTo({ left: shell.clientWidth * index, behavior: 'smooth' }); }}>{visiblePage === index ? '●' : '○'}</button>)}</div></>;
}
type BodyMapMuscle = { id: number; name: string; volume: number; intensity: number; is_front: boolean; image_url: string; role?: 'primary' | 'secondary' | 'tertiary' };
const WGER_BODY_BASE = {
    front: '/body-front.svg',
    back: '/body-back.svg'
};
export function BodyweightCard({ dash, saveWeight }: { dash: Dash | null; saveWeight: (n: number, recordedOn?: string) => Promise<void> }) {
    const [weight, setWeight] = useState('');
    const [addingWeight, setAddingWeight] = useState(false);
    const [range, setRange] = useState<'1M' | '3M' | '6M' | '1Y' | 'All'>('All');
    const entries = dash?.weight_series ?? [];
    const rangeDays = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, All: Infinity }[range];
    const latestDate = entries.at(-1)?.recorded_on ? new Date(`${entries.at(-1)!.recorded_on}T12:00:00`) : new Date();
    const domainEnd = latestDate.getTime();
    const domainStart = rangeDays === Infinity
        ? (entries[0]?.recorded_on ? new Date(`${entries[0].recorded_on}T12:00:00`).getTime() : domainEnd)
        : domainEnd - rangeDays * 86400000;
    const visibleEntries = entries.filter(entry => { const timestamp = new Date(`${entry.recorded_on}T12:00:00`).getTime(); return timestamp >= domainStart && timestamp <= domainEnd; });
    const latest = dash?.latest_weight;
    const formatDate = (date?: string) => date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    return <article className="dashboard-weight"><div className="dashboard-section-head"><div><h2>Bodyweight</h2><p>Your tracked weight over time.</p></div><div className="dashboard-weight-actions"><div className="weight-ranges" role="group" aria-label="Bodyweight timeframe">{(['1M', '3M', '6M', '1Y', 'All'] as const).map(option => <button type="button" className={range === option ? 'active' : ''} onClick={() => setRange(option)} key={option}>{option}</button>)}</div><button className="mobile-add-weight" type="button" onClick={() => setAddingWeight(value => !value)}>＋ Add</button><form className={addingWeight ? 'adding' : ''} onSubmit={event => { event.preventDefault(); if (+weight) void saveWeight(+weight).then(() => { setWeight(''); setAddingWeight(false); }); }}><input aria-label="Bodyweight in kilograms" value={weight} onChange={event => setWeight(event.target.value)} placeholder="kg" inputMode="decimal"/><button>Save</button></form></div></div>{visibleEntries.length === 1 && latest ? <div className="first-weight"><strong>{latest.weight.toFixed(1)} kg</strong><b>First tracked entry</b><span>{formatDate(latest.recorded_on)}</span></div> : <Line values={visibleEntries} domainStart={domainStart} domainEnd={domainEnd} saveWeight={saveWeight}/>}</article>;
}
export function AnatomyFallback({ intensity, view, showRegions }: { intensity: (group: string) => number; view: 'front' | 'back'; showRegions: boolean }) {
    const base = <><circle className="body-map-base" cx="90" cy="25" r="17"/><path className="body-map-base" d="M83 42H97L101 54 118 61 132 93 127 151 114 149 108 107 111 168Q108 188 104 200L116 298 103 315 92 310 90 222 88 310 77 315 64 298 76 200Q72 188 69 168L72 107 66 149 53 151 48 93 62 61 79 54Z"/></>;
    return view === 'front' ? <svg className={`body-map-fallback ${showRegions ? '' : 'base-only'}`} viewBox="0 0 180 330" aria-label="Front muscle view">{base}<path className="body-region" style={{ opacity: intensity('shoulders') }} d="M62 62Q71 54 80 57L75 84 57 93 52 88ZM118 62Q109 54 100 57L105 84 123 93 128 88Z"/><path className="body-region" style={{ opacity: intensity('chest') }} d="M77 83Q84 77 89 84V111Q80 109 73 117L70 96ZM103 83Q96 77 91 84V111Q100 109 107 117L110 96Z"/><path className="body-region" style={{ opacity: intensity('arms') }} d="M57 95 51 104 54 143 65 141 70 108ZM123 95 129 104 126 143 115 141 110 108Z"/><path className="body-region" style={{ opacity: intensity('core') }} d="M75 119Q90 113 105 119L108 166Q90 177 72 166Z"/><path className="body-region" style={{ opacity: intensity('legs') }} d="M77 181Q83 185 88 184L86 303 77 307 68 296ZM103 181Q97 185 92 184L94 303 103 307 112 296Z"/></svg> : <svg className={`body-map-fallback ${showRegions ? '' : 'base-only'}`} viewBox="0 0 180 330" aria-label="Back muscle view">{base}<path className="body-region body-back" style={{ opacity: intensity('back') }} d="M79 55H101L112 83 105 129 99 154 81 154 75 129 68 83Z"/><path className="body-region" style={{ opacity: intensity('shoulders') }} d="M62 62Q71 54 80 57L75 84 57 93 52 88ZM118 62Q109 54 100 57L105 84 123 93 128 88Z"/><path className="body-region" style={{ opacity: intensity('arms') }} d="M57 95 51 104 54 143 65 141 70 108ZM123 95 129 104 126 143 115 141 110 108Z"/><path className="body-region" style={{ opacity: intensity('core') }} d="M74 154Q90 163 106 154L108 178Q90 190 72 178Z"/><path className="body-region" style={{ opacity: intensity('legs') }} d="M77 186Q83 190 88 189L86 303 77 307 68 296ZM103 186Q97 190 92 189L94 303 103 307 112 296Z"/></svg>;
}
export function BodyMap() {
    const [muscles, setMuscles] = useState<BodyMapMuscle[] | null>(null);
    const [mapUnavailable, setMapUnavailable] = useState(false);
    const [view, setView] = useState<'front' | 'back'>('front');
    const [testMode, setTestMode] = useState(false);
    const [testing, setTesting] = useState(false);
    const loadMap = async () => {
        try {
            const result = await api<{ muscles: BodyMapMuscle[]; test_mode: boolean }>('/dashboard/body-map');
            setMuscles(result.muscles); setTestMode(result.test_mode); setMapUnavailable(false);
        } catch { setMapUnavailable(true); setMuscles([]); }
    };
    useEffect(() => { void loadMap(); }, []);
    const toggleTestMode = async () => {
        setTesting(true);
        try { await api('/dashboard/body-map/test-data', { method: testMode ? 'DELETE' : 'POST' }); await loadMap(); }
        finally { setTesting(false); }
    };
    const trainedMuscles = [...(muscles ?? [])].filter(muscle => muscle.volume > 0).sort((a, b) => b.volume - a.volume);
    const strongest = trainedMuscles.slice(0, 3);
    const visibleMuscles = (muscles ?? []).filter(muscle => muscle.is_front === (view === 'front'));
    return <div className="body-map"><div className="body-map-copy"><span>THIS WEEK</span><b>Muscles trained</b><small>{mapUnavailable ? 'Restart the API to load your muscle overlays.' : muscles === null ? 'Loading your training map…' : trainedMuscles.length ? `${trainedMuscles.length} muscle region${trainedMuscles.length === 1 ? '' : 's'} hit` : 'Complete a workout to light up your map.'}</small><div className="body-map-view-toggle"><button className={view === 'front' ? 'active' : ''} onClick={() => setView('front')}>Front</button><button className={view === 'back' ? 'active' : ''} onClick={() => setView('back')}>Back</button></div><button className={`body-map-test ${testMode ? 'active' : ''}`} onClick={() => void toggleTestMode()} disabled={testing}>{testing ? 'Updating test…' : testMode ? 'Clear map test' : 'Test full map'}</button></div><div className="body-map-figure" aria-label={`${view} muscles trained this week`}><img className="wger-body-base" src={WGER_BODY_BASE[view]} alt=""/>{visibleMuscles.map(muscle => <img className="wger-muscle-layer" key={muscle.id} src={muscle.image_url} alt="" style={{ opacity: .24 + muscle.intensity * .76 }} />)}</div>{strongest.length > 0 && <div className="body-map-list">{strongest.map(muscle => <span key={muscle.id}>{muscle.name}<b>{Math.round(muscle.volume).toLocaleString()} kg</b></span>)}</div>}</div>;
}
function Stat({ icon, label, value, sub }: {
    icon?: 'scale' | 'volume' | 'session' | 'clock';
    label: string;
    value: string;
    sub: string;
}) { const tone = sub.includes('↓') || sub.includes('fewer') ? 'negative' : sub.includes('↑') || sub.includes('more') || sub.trim().startsWith('+') ? 'positive' : ''; return <article>{icon && <DashboardIcon name={icon}/>}<div><span>{label}</span><strong><AnimatedValue value={value}/></strong><small className={tone}>{sub}</small></div></article>; }
function AnimatedValue({ value }: { value: string }) {
    const match = value.match(/^([\d,.]+)(.*)$/), target = match ? Number(match[1].replaceAll(',', '')) : null, suffix = match?.[2] ?? '';
    const decimals = match?.[1].includes('.') ? (match[1].split('.')[1]?.length ?? 0) : 0;
    const ref = useRef<HTMLSpanElement>(null);
    const [run, setRun] = useState(0);
    const [shown, setShown] = useState(0);
    useEffect(() => { const node = ref.current; if (!node || !('IntersectionObserver' in window)) { setRun(1); return; } const observer = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) setRun(current => current + 1); }, { threshold: .8 }); observer.observe(node); return () => observer.disconnect(); }, []);
    useEffect(() => { if (target === null || run === 0) return; setShown(0); let frame = 0; const started = performance.now(); const animate = (time: number) => { const progress = Math.min(1, (time - started) / 850); setShown(target * (1 - Math.pow(1 - progress, 3))); if (progress < 1) frame = requestAnimationFrame(animate); }; frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame); }, [target, run]);
    return target === null ? <span ref={ref}>{value}</span> : <span ref={ref}>{shown.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}
;
export function Title({ n, text }: {
    text: string;
    n: string;
}) { return <p className="title">{n} · {text}</p>; }
;
function Line({ values, domainStart, domainEnd, saveWeight }: {
    values: {
        weight: number;
        recorded_on?: string;
    }[];
    domainStart: number;
    domainEnd: number;
    saveWeight: (weight: number, recordedOn?: string) => Promise<void>;
}) {
    const [displayValues, setDisplayValues] = useState(values);
    const [hovered, setHovered] = useState<number | null>(null), [editing, setEditing] = useState<number | null>(null), [draft, setDraft] = useState('');
    const [adding, setAdding] = useState<{ date: string; x: number; y: number } | null>(null);
    const [newWeight, setNewWeight] = useState('');
    const [addError, setAddError] = useState('');
    const [savingNew, setSavingNew] = useState(false);
    const optimisticWeights = useRef(new Map<string, number>());
    useEffect(() => setDisplayValues(values.map(entry => {
        if (!entry.recorded_on) return entry;
        const optimisticWeight = optimisticWeights.current.get(entry.recorded_on);
        if (optimisticWeight === undefined) return entry;
        return entry.weight === optimisticWeight ? entry : { ...entry, weight: optimisticWeight };
    })), [values]);
    const rawLow = Math.min(...displayValues.map(x => x.weight)), rawHigh = Math.max(...displayValues.map(x => x.weight)), rawSpread = rawHigh - rawLow;
    const center = Math.round((rawLow + rawHigh) / 2), low = rawSpread < 4 ? center - 4 : Math.floor(rawLow - rawSpread * .12), high = rawSpread < 4 ? center + 4 : Math.ceil(rawHigh + rawSpread * .12), spread = high - low || 1;
    const formatDate = (value?: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const firstTime = domainStart, lastTime = domainEnd;
    const point = (index: number) => { const timestamp = displayValues[index].recorded_on ? new Date(`${displayValues[index].recorded_on}T12:00:00`).getTime() : index; return { x: displayValues.length < 2 || firstTime === lastTime ? 50 : 2 + (timestamp - firstTime) / (lastTime - firstTime) * 96, y: 88 - ((displayValues[index].weight - low) / spread) * 72 }; };
    const positions = displayValues.map((_, index) => point(index));
    const curve = positions.length ? positions.slice(1).reduce((path, current, index) => { const previous = positions[index], distance = (current.x - previous.x) / 3; return `${path} C ${previous.x + distance},${previous.y} ${current.x - distance},${current.y} ${current.x},${current.y}`; }, `M ${positions[0].x},${positions[0].y}`) : '';
    const area = curve ? `${curve} L ${positions.at(-1)!.x},100 L ${positions[0].x},100 Z` : '';
    const shown = editing ?? hovered;
    const gridTicks = [0, 1, 2, 3, 4];
    const yTickValues = gridTicks.map(index => high - spread * index / 4);
    const dateTicks = gridTicks.map(index => new Date(firstTime + (lastTime - firstTime) * index / 4));
    const formatTickDate = (value: Date) => value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const saveEditedPoint = async (index: number) => {
        const nextWeight = Number(draft), recordedOn = displayValues[index]?.recorded_on;
        if (!(nextWeight > 0) || !recordedOn) return;
        const previousWeight = displayValues[index].weight;
        optimisticWeights.current.set(recordedOn, nextWeight);
        setDisplayValues(current => current.map(entry => entry.recorded_on === recordedOn ? { ...entry, weight: nextWeight } : entry));
        setEditing(null);
        setHovered(null);
        try {
            await saveWeight(nextWeight, recordedOn);
        } catch {
            optimisticWeights.current.delete(recordedOn);
            setDisplayValues(current => current.map(entry => entry.recorded_on === recordedOn ? { ...entry, weight: previousWeight } : entry));
        }
    };
    const chooseEmptyDay = (clientX: number, clientY: number, rect: DOMRect) => {
        if (firstTime === lastTime || rect.width === 0) return;
        const fraction = Math.min(1, Math.max(0, ((clientX - rect.left) / rect.width * 100 - 2) / 96));
        const day = new Date(firstTime + (lastTime - firstTime) * fraction);
        const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        if (displayValues.some(entry => entry.recorded_on === date)) return;
        setHovered(null);
        setEditing(null);
        setNewWeight('');
        setAddError('');
        setAdding({ date, x: 2 + fraction * 96, y: Math.min(88, Math.max(16, (clientY - rect.top) / rect.height * 100)) });
    };
    const saveNewPoint = async () => {
        if (!adding) return;
        const weight = Number(newWeight);
        if (!(weight > 0 && weight <= 500)) { setAddError('Enter a weight between 0 and 500 kg.'); return; }
        setSavingNew(true);
        setAddError('');
        try { await saveWeight(weight, adding.date); setAdding(null); }
        catch { setAddError('Could not save this weight. Try again.'); }
        finally { setSavingNew(false); }
    };
    return <div className={`chart ${displayValues.length ? '' : 'chart-empty'}`} onPointerLeave={() => { if (editing === null) setHovered(null); }}>{displayValues.length ? <><svg viewBox="0 0 100 100" preserveAspectRatio="none" onClick={event => chooseEmptyDay(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())}><title>Click an unlogged day to add a bodyweight entry</title><defs><linearGradient id="weight-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".28"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs><g className="weight-grid">{gridTicks.map(index => <line key={`y-${index}`} x1="2" x2="98" y1={16 + index * 18} y2={16 + index * 18}/>) }{gridTicks.map(index => <line key={`x-${index}`} x1={2 + index * 24} x2={2 + index * 24} y1="16" y2="88"/>)}</g><path className="weight-area" d={area}/><path className="weight-curve" d={curve}/></svg>{displayValues.map((entry, index) => { const position = point(index); const distance = hovered === null ? null : Math.abs(index - hovered); return <button type="button" className={`weight-point-circle ${distance !== null && distance <= 2 ? `proximity-${distance}` : ''} ${index === displayValues.length - 1 ? 'latest' : ''}`} key={`${entry.recorded_on}-${index}`} style={{ left: `calc(var(--chart-axis-width) + (100% - var(--chart-axis-width) - var(--chart-right-gutter, 0px)) * ${position.x / 100})`, top: `${position.y}%` }} onPointerEnter={() => setHovered(index)} onFocus={() => setHovered(index)} onBlur={() => { if (editing === null) setHovered(null); }} onClick={() => { setAdding(null); setEditing(index); setHovered(index); setDraft(String(entry.weight)); }} aria-label={`${formatDate(entry.recorded_on)}, ${entry.weight} kilograms. Click to edit.`}/>; })}{shown !== null && <div className={`weight-point-popover ${shown === 0 ? 'at-start' : shown === displayValues.length - 1 ? 'at-end' : ''}`} style={{ left: `calc(var(--chart-axis-width) + (100% - var(--chart-axis-width) - var(--chart-right-gutter, 0px)) * ${point(shown).x / 100})`, top: `${point(shown).y}%` }}>{editing === shown ? <form onSubmit={event => { event.preventDefault(); void saveEditedPoint(shown); }}><label>{formatDate(displayValues[shown].recorded_on)}<span><input autoFocus value={draft} inputMode="decimal" onChange={event => setDraft(event.target.value)}/> kg</span></label><div><button type="button" onClick={() => { setEditing(null); setHovered(null); }}>Cancel</button><button>Save</button></div></form> : <><b>{displayValues[shown].weight.toFixed(1)} kg</b><small>{formatDate(displayValues[shown].recorded_on)}</small></>}</div>}{adding && <div className={`weight-point-popover weight-new-point ${adding.x < 15 ? 'at-start' : adding.x > 85 ? 'at-end' : ''} ${adding.y < 40 ? 'below' : ''}`} style={{ left: `calc(var(--chart-axis-width) + (100% - var(--chart-axis-width) - var(--chart-right-gutter, 0px)) * ${adding.x / 100})`, top: `${adding.y}%` }}><form onSubmit={event => { event.preventDefault(); void saveNewPoint(); }} onKeyDown={event => { if (event.key === 'Escape') setAdding(null); }}><label>{formatDate(adding.date)}<span><input autoFocus aria-label={`Bodyweight for ${formatDate(adding.date)}`} value={newWeight} onChange={event => setNewWeight(event.target.value)} inputMode="decimal"/> kg</span></label><div><button type="button" onClick={() => setAdding(null)}>Cancel</button><button disabled={savingNew}>{savingNew ? 'Saving…' : 'Save'}</button></div>{addError && <small className="weight-new-error" role="alert">{addError}</small>}</form></div>}<div className="chart-axis">{yTickValues.map((value, index) => <span key={index}>{value.toFixed(0)}</span>)}</div><div className="chart-dates">{dateTicks.map((date, index) => <span key={index}>{formatTickDate(date)}</span>)}</div></> : <span>Log bodyweight to unlock your trend.</span>}</div>;
}
function Routines({ folders, refresh, start, note }: {
    folders: Folder[];
    refresh: () => Promise<void>;
    start: (r: Routine) => void;
    note: (s: string) => void;
}) { const [edit, setEdit] = useState<Routine | null>(null), [folder, setFolder] = useState(''); const add = async (e: FormEvent) => { e.preventDefault(); if (!folder.trim())
    return; await api('/folders', { method: 'POST', body: JSON.stringify({ name: folder.trim() }) }); setFolder(''); await refresh(); }; const renameFolder = async (f: Folder) => { const name = window.prompt('Folder name', f.name); if (name?.trim()) {
    await api(`/folders/${f.id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
    await refresh();
    note('Folder renamed');
} }; const removeFolder = async (f: Folder) => { if (window.confirm(`Delete “${f.name}” and its ${f.routines.length} workout day(s)?`)) {
    await api(`/folders/${f.id}`, { method: 'DELETE' });
    await refresh();
    note('Folder removed');
} }; const removeDay = async (r: Routine) => { if (window.confirm(`Delete workout day “${r.name}”?`)) {
    await api(`/routines/${r.id}`, { method: 'DELETE' });
    await refresh();
    note('Workout day removed');
} }; const [openFolders, setOpenFolders] = useState<number[] | null>(null);
    const expanded = openFolders ?? (folders[0] ? [folders[0].id] : []);
    const toggleFolder = (id: number) => setOpenFolders(current => { const open = current ?? (folders[0] ? [folders[0].id] : []); return open.includes(id) ? open.filter(value => value !== id) : [...open, id]; });
    const newDay = (folderId: number) => setEdit({ id: 0, name: 'New workout day', folder_id: folderId, exercises: [] });
    const muscles = routineMuscles;
    return <div className="routine-manager"><Head action={folders.length ? <button className="primary" onClick={() => newDay(expanded[0] ?? folders[0].id)}>New workout day <b>＋</b></button> : undefined}><h1>Workout routines</h1></Head><form className="routine-create" onSubmit={add}><label htmlFor="routine-folder-name">New routine folder</label><input id="routine-folder-name" placeholder="e.g. Push / Pull / Legs" value={folder} onChange={event => setFolder(event.target.value)}/><button type="submit">Create folder</button></form>{folders.length === 0 && <div className="empty">Create a folder to organize your workout days.</div>}<div className="routine-folder-list">{folders.map(f => { const isOpen = expanded.includes(f.id); return <section className={`routine-group ${isOpen ? 'open' : ''}`} key={f.id}><div className="routine-group-head"><button type="button" className="routine-folder-toggle" aria-expanded={isOpen} onClick={() => toggleFolder(f.id)}><span className="folder-chevron" aria-hidden="true">{isOpen ? '⌄' : '›'}</span><svg className="folder-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 6.5A2.5 2.5 0 0 1 5 4h4.2l2 2H19a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 19 20H5a2.5 2.5 0 0 1-2.5-2.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg><span className="routine-folder-title">{f.name}</span><small>· {f.routines.length} workout {f.routines.length === 1 ? 'day' : 'days'}</small></button><div className="routine-group-actions">{isOpen && <button type="button" className="routine-add-day" onClick={() => newDay(f.id)}>＋ Add day</button>}<details className="routine-menu"><summary aria-label={`More options for ${f.name}`}>⋮</summary><div className="routine-menu-panel"><button type="button" onClick={() => void renameFolder(f)}>Rename folder</button><button type="button" className="danger" onClick={() => void removeFolder(f)}>Delete folder</button></div></details></div></div>{isOpen && <div className="routine-day-list">{f.routines.map(r => <div className="routine-day-row" key={r.id}><button type="button" className="routine-day-open" onClick={() => setEdit(r)}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.5" y="2.5" width="15" height="19" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg><span><strong>{r.name}</strong><small>{r.exercises.length} {r.exercises.length === 1 ? 'exercise' : 'exercises'}{muscles(r) ? ` · ${muscles(r)}` : ''}</small></span></button><div className="routine-day-actions"><button type="button" className="routine-start" onClick={() => start(r)}>Start</button><details className="routine-menu"><summary aria-label={`More options for ${r.name}`}>⋮</summary><div className="routine-menu-panel"><button type="button" onClick={() => setEdit(r)}>Edit day</button><button type="button" className="danger" onClick={() => void removeDay(r)}>Delete day</button></div></details></div></div>)}{!f.routines.length && <div className="routine-list-empty">No workout days yet. Add your first day to this folder.</div>}</div>}</section>; })}</div>{edit && <Editor routine={edit} folders={folders} close={() => setEdit(null)} done={async () => { setEdit(null); await refresh(); note('Workout day saved'); }}/>}</div>; }
const REST_PRESETS = [0, 60, 90, 120, 180, 240, 300];
function RestTimeField({ seconds, name, onChange }: { seconds: number; name: string; onChange: (seconds: number) => void }) {
    const [custom, setCustom] = useState(!REST_PRESETS.includes(seconds));
    const minutes = Math.floor(seconds / 60), remainingSeconds = seconds % 60;
    const updatePart = (nextMinutes: number, nextSeconds: number) => onChange(Math.min(1800, Math.max(0, nextMinutes * 60 + nextSeconds)));
    const numericPart = (value: string, max: number) => { const normalized = value.replace(/^0+(?=\d)/, ''); return Math.min(max, Math.max(0, normalized === '' ? 0 : Number(normalized))); };
    return <div className="rest-time-field"><select aria-label={`${name} rest time`} value={custom ? 'other' : seconds} onChange={event => { if (event.target.value === 'other') { setCustom(true); return; } setCustom(false); onChange(Number(event.target.value)); }}><option value="0">No timer</option><option value="60">1 min</option><option value="90">1 min 30 sec</option><option value="120">2 min</option><option value="180">3 min</option><option value="240">4 min</option><option value="300">5 min</option><option value="other">Other…</option></select>{custom && <div className="custom-rest-time"><label><input aria-label={`${name} custom rest minutes`} type="number" inputMode="numeric" min="0" max="30" value={minutes || ''} placeholder="0" onFocus={event => event.currentTarget.select()} onChange={event => updatePart(numericPart(event.target.value, 30), remainingSeconds)}/><span>min</span></label><label><input aria-label={`${name} custom rest seconds`} type="number" inputMode="numeric" min="0" max="59" value={remainingSeconds || ''} placeholder="0" onFocus={event => event.currentTarget.select()} onChange={event => updatePart(minutes, numericPart(event.target.value, 59))}/><span>sec</span></label></div>}</div>;
}
function Editor({ routine, folders, close, done }: { routine: Routine; folders: Folder[]; close: () => void; done: () => Promise<void> }) {
    const [name, setName] = useState(routine.name), [folder, setFolder] = useState(String(routine.folder_id ?? folders[0]?.id ?? '')), [items, setItems] = useState<Item[]>(routine.exercises), [q, setQ] = useState(''), [results, setResults] = useState<Exercise[]>([]);
    const [builderPage, setBuilderPage] = useState(0), mobilePages = useRef<HTMLDivElement>(null);
    useEffect(() => { if (q.trim().length < 2) { setResults([]); return; } const timer = setTimeout(() => void api<Exercise[]>(`/exercises?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([])), 250); return () => clearTimeout(timer); }, [q]);
    const update = (index: number, field: keyof Item, value: number) => setItems(items.map((item, i) => i === index ? { ...item, [field]: value } : item));
    const addExercise = (exercise: Exercise) => { if (!items.some(item => item.exercise_id === exercise.id || item.exercise?.id === exercise.id)) setItems([...items, { exercise_id: exercise.id, exercise, name: exercise.name, planned_sets: 3, target_reps_min: 8, target_reps_max: 12, rest_seconds: 90 }]); setQ(''); setResults([]); };
    const save = async (event: FormEvent) => { event.preventDefault(); await api(routine.scheduled_on ? `/calendar/${routine.scheduled_on}/routine/${routine.id}` : routine.id ? `/routines/${routine.id}` : '/routines', { method: routine.id ? 'PUT' : 'POST', body: JSON.stringify({ name, folder_id: Number(folder), exercises: items.map(item => ({ exercise_id: item.exercise_id ?? item.exercise?.id, planned_sets: item.planned_sets ?? 3, target_reps_min: item.target_reps_min ?? item.target_reps ?? 8, target_reps_max: item.target_reps_max ?? item.target_reps ?? 12, rest_seconds: item.rest_seconds ?? 90, target_weight: item.target_weight })) }) }); await done(); };
    const exerciseName = (item: Item) => item.exercise?.name ?? item.name;
    const muscleName = (item: Item) => item.exercise?.primary_muscle ?? item.primary_muscle ?? 'Unmapped muscle';
    const goToPage = (page: number) => { const pages = mobilePages.current; if (pages) pages.scrollTo({ left: page * pages.clientWidth, behavior: 'smooth' }); setBuilderPage(page); };
    return <div className="back"><form className="modal routine-editor rest-editor" onSubmit={save}><div className="modal-head"><div><p className="overline">WORKOUT DAY BUILDER</p><h2>{routine.scheduled_on ? 'Edit planned workout' : routine.id ? 'Edit workout day' : 'New workout day'}</h2>{routine.scheduled_on && <p>{routine.scheduled_on} · Changes apply only to this workout.</p>}</div><button type="button" onClick={close}>×</button></div><div className="builder-basics"><label>DAY NAME<input value={name} onChange={event => setName(event.target.value)}/></label><label>{routine.scheduled_on ? 'DATE' : 'FOLDER'}{routine.scheduled_on ? <input readOnly value={routine.scheduled_on}/> : <select value={folder} onChange={event => setFolder(event.target.value)}>{folders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</label></div><label className="add-exercise-label">ADD EXERCISE<input value={q} onChange={event => setQ(event.target.value)} placeholder="Search exercises, e.g. bench press"/></label><div className="search">{results.map(item => <button type="button" key={item.id} onClick={() => addExercise(item)}><span><b>{item.name}</b><small>{item.primary_muscle ?? 'Unmapped'} · {item.equipment}</small></span>＋</button>)}</div>
        <div className="rest-builder-list desktop-rest-builder"><div className="rest-builder-head"><span>EXERCISE</span><span>SETS</span><span>REPS</span><span>REST</span><span /></div>{items.map((item, index) => <div className="rest-builder-row" key={`${item.exercise_id ?? item.exercise?.id}-${index}`}><div><b>{exerciseName(item)}</b><small>{muscleName(item)}</small></div><input aria-label={`${item.name} sets`} inputMode="numeric" value={item.planned_sets ?? ''} onChange={event => update(index, 'planned_sets', Number(event.target.value))}/><div className="rest-reps"><input aria-label={`${item.name} minimum reps`} inputMode="numeric" value={item.target_reps_min ?? item.target_reps ?? ''} onChange={event => update(index, 'target_reps_min', Number(event.target.value))}/><span>–</span><input aria-label={`${item.name} maximum reps`} inputMode="numeric" value={item.target_reps_max ?? item.target_reps ?? ''} onChange={event => update(index, 'target_reps_max', Number(event.target.value))}/></div><RestTimeField seconds={item.rest_seconds ?? 90} name={item.name} onChange={seconds => update(index, 'rest_seconds', seconds)}/><button type="button" aria-label={`Remove ${item.name}`} onClick={() => setItems(items.filter((_, i) => i !== index))}>×</button></div>)}</div>
        <div className="mobile-rest-builder"><div className="mobile-builder-pages" ref={mobilePages} onScroll={event => { const element = event.currentTarget; setBuilderPage(Math.round(element.scrollLeft / element.clientWidth)); }}>
            <section className="mobile-builder-page" aria-label="Sets and reps"><div className="mobile-builder-head"><span>EXERCISE</span><span>SETS</span><span>REPS</span><span /></div>{items.map((item, index) => <div className="mobile-builder-row mobile-builder-targets" key={`${item.exercise_id ?? item.exercise?.id}-${index}`}><div><b>{exerciseName(item)}</b><small>{muscleName(item)}</small></div><input aria-label={`${item.name} sets`} inputMode="numeric" value={item.planned_sets ?? ''} onChange={event => update(index, 'planned_sets', Number(event.target.value))}/><div className="rest-reps"><input aria-label={`${item.name} minimum reps`} inputMode="numeric" value={item.target_reps_min ?? item.target_reps ?? ''} onChange={event => update(index, 'target_reps_min', Number(event.target.value))}/><span>–</span><input aria-label={`${item.name} maximum reps`} inputMode="numeric" value={item.target_reps_max ?? item.target_reps ?? ''} onChange={event => update(index, 'target_reps_max', Number(event.target.value))}/></div><button type="button" aria-label={`Remove ${item.name}`} onClick={() => setItems(items.filter((_, i) => i !== index))}>×</button></div>)}</section>
            <section className="mobile-builder-page" aria-label="Rest times"><div className="mobile-builder-head mobile-rest-head"><span>EXERCISE</span><span>REST</span></div>{items.map((item, index) => <div className="mobile-builder-row mobile-builder-rest" key={`${item.exercise_id ?? item.exercise?.id}-${index}`}><div><b>{exerciseName(item)}</b><small>{muscleName(item)}</small></div><RestTimeField seconds={item.rest_seconds ?? 90} name={item.name} onChange={seconds => update(index, 'rest_seconds', seconds)}/></div>)}</section>
        </div><div className="mobile-builder-nav" aria-label="Workout builder pages"><button type="button" className={builderPage === 0 ? 'active' : ''} aria-label="Show sets and reps" aria-current={builderPage === 0 ? 'page' : undefined} onClick={() => goToPage(0)}><span />SETS &amp; REPS</button><button type="button" className={builderPage === 1 ? 'active' : ''} aria-label="Show rest times" aria-current={builderPage === 1 ? 'page' : undefined} onClick={() => goToPage(1)}><span />REST</button></div><p className="mobile-swipe-hint">Swipe sideways to switch pages</p><button className="primary wide mobile-builder-save">Save workout day →</button></div>
        <p className="builder-tip">Choose the rest period for each exercise. The workout timer will use it after a set.</p><button className="primary wide desktop-builder-save">Save workout day →</button></form></div>;
}
function Logger({ workout, folders, active, start, startAdHoc, setWorkout, editing, finish, saveEdit, cancel }: { workout: Workout | null; folders: Folder[]; active: Workout[]; start: (r: Routine) => void; startAdHoc: () => Promise<void>; setWorkout: (x: Workout) => void; editing: boolean; finish: (x: Workout) => Promise<void>; saveEdit: (x: Workout) => Promise<void>; cancel?: (x: Workout) => Promise<void> }) {
    const [q, setQ] = useState(''), [results, setResults] = useState<Exercise[]>([]), [open, setOpen] = useState(0), [progressByExercise, setProgressByExercise] = useState<Record<number, ExerciseProgress>>({}), [restUntil, setRestUntil] = useState<number | null>(null), [now, setNow] = useState(Date.now()), [extraExerciseOpen, setExtraExerciseOpen] = useState(false);
    const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
    const extraExerciseTouch = useRef<number | null>(null), extraExerciseDidSwipe = useRef(false);
    const latestWorkout = useRef(workout);
    useEffect(() => { latestWorkout.current = workout; }, [workout]);
    useEffect(() => { if (!restUntil) return; const tick = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(tick); }, [restUntil]);
    useEffect(() => { if (restUntil && now >= restUntil) setRestUntil(null); }, [now, restUntil]);
    useEffect(() => { if (q.trim().length < 2) { setResults([]); return; } const t = setTimeout(() => void api<Exercise[]>(`/exercises?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([])), 250); return () => clearTimeout(t); }, [q]);
    const openItem = workout?.exercises[open];
    const progressExerciseIds = workout?.exercises.map(item => item.exercise_id ?? item.cached_exercise_id).filter((id): id is number => Boolean(id)).join(',') ?? '';
    useEffect(() => { if (!workout?.id) { setProgressByExercise({}); return; } const workoutId = workout.id, exerciseIds = progressExerciseIds.split(',').map(Number).filter(Boolean); void api<Record<number, ExerciseProgress>>(`/workouts/${workoutId}/exercise-progress`).then(setProgressByExercise).catch(() => Promise.all(exerciseIds.map(async exerciseId => [exerciseId, await api<ExerciseProgress>(`/exercises/${exerciseId}/progress?exclude_workout_id=${workoutId}`)] as const)).then(entries => setProgressByExercise(Object.fromEntries(entries))).catch(() => setProgressByExercise({}))); }, [workout?.id, progressExerciseIds]);
    const previous = progressByExercise[openItem?.exercise_id ?? openItem?.cached_exercise_id ?? 0] ?? null;
    useEffect(() => { if (!workout?.id || editing) return; const t = setTimeout(() => void api(`/workouts/${workout.id}`, { method: 'PATCH', body: JSON.stringify(workout) }).catch(() => undefined), 400); return () => clearTimeout(t); }, [workout, editing]);
    useEffect(() => {
        if (editing) return;
        const saveBeforeSuspend = () => {
            const current = latestWorkout.current;
            if (!current?.id || current.completed) return;
            localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(current));
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
        return <div className="workout-chooser"><Head action={<button className="chooser-empty-action" onClick={() => void startAdHoc()}>Start empty <span aria-hidden="true">＋</span></button>}><h1>Choose workout</h1><p>Select a routine to begin.</p></Head>{active.length > 0 && <section className="active-sessions"><p className="overline">READY TO RESUME</p>{active.map(x => <button key={x.id} onClick={() => { setWorkout(x); setOpen(0); }}><span><b>{x.name}</b><small>Started {x.started_at ? new Date(x.started_at).toLocaleString() : 'earlier'}</small></span><strong>Resume →</strong></button>)}</section>}{folders.length > 0 && <><div className={`chooser-tabs tabs-${Math.min(folders.length, 4)}`} role="tablist" aria-label="Workout routines">{folders.map(folder => <button type="button" role="tab" aria-selected={folder.id === selectedFolder?.id} key={folder.id} className={folder.id === selectedFolder?.id ? 'selected' : ''} onClick={() => setSelectedFolderId(folder.id)}><strong>{folder.name}</strong><small>{folder.routines.length} workout {folder.routines.length === 1 ? 'day' : 'days'}</small></button>)}</div><section className="chooser-selected" aria-labelledby="selected-routine-name"><div className="chooser-selected-heading"><h2 id="selected-routine-name">{selectedFolder.name}</h2><p>{selectedFolder.routines.length} workout {selectedFolder.routines.length === 1 ? 'day' : 'days'}</p></div><div className="chooser-days">{selectedFolder.routines.map((routine, index) => <button type="button" className="chooser-day" onClick={() => start(routine)} key={routine.id}><span className="chooser-day-number">Day {index + 1}</span><span className="chooser-day-copy"><strong>{routine.name}</strong><small>{routine.exercises.length} {routine.exercises.length === 1 ? 'exercise' : 'exercises'}{muscleSummary(routine) ? ` · ${muscleSummary(routine)}` : ''}</small></span><span className="chooser-start">Start <span aria-hidden="true">→</span></span></button>)}{selectedFolder.routines.length === 0 && <p className="chooser-empty">No workout days in this routine yet.</p>}</div></section></>}{folders.length === 0 && <div className="empty">No routine required — use “Start empty” to add exercises as you go.</div>}</div>;
    }    const change = (i: number, j: number, field: 'weight' | 'reps' | 'exertion', value: number) => setWorkout({ ...workout, exercises: workout.exercises.map((item, a) => a !== i ? item : { ...item, sets: item.sets?.map((set, b) => b !== j ? set : { ...set, [field]: value }) }) });
    const addExercise = (x: Exercise) => { setWorkout({ ...workout, exercises: [...workout.exercises, { exercise_id: x.id, name: x.name, primary_muscle: x.primary_muscle, secondary_muscles: x.secondary_muscles, muscle_group: x.muscle_group, sets: [{ weight: 0, reps: 0 }] }] }); setOpen(workout.exercises.length); setQ(''); setResults([]); setExtraExerciseOpen(false); };
    const remaining = restUntil ? Math.max(0, Math.ceil((restUntil - now) / 1000)) : 0;
    return <><Head action={<div className="workout-head-actions">{!editing && cancel && <button className="cancel-workout" onClick={() => void cancel(workout)}>Cancel workout</button>}<button className="primary" onClick={() => void (editing ? saveEdit(workout) : finish(workout))}>{editing ? 'Save changes' : 'Finish workout ✓'}</button></div>}><p className="overline">{editing ? 'EDIT COMPLETED SESSION' : `ACTIVE SESSION · started ${workout.started_at ? formatClockTime(workout.started_at) : 'now'}`}</p><input className="session-name" value={workout.name} onChange={e => setWorkout({ ...workout, name: e.target.value })}/></Head>{restUntil && <div className="rest-timer" role="timer"><span>REST</span><b>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</b><button onClick={() => setRestUntil(null)}>Skip</button></div>}<section className="logger">{workout.exercises.map((item, i) => <article className={`log-exercise ${open === i ? 'open' : ''}`} key={`${item.name}-${i}`}><button className="exercise-tab" onClick={() => setOpen(i)}><span><b>{i + 1}</b><strong>{item.name}</strong><small>{item.primary_muscle ?? 'Unmapped muscle'}</small></span><i>{open === i ? '−' : '+'}</i></button>{open === i && <div className="exercise-body">{previous?.sessions[0] && <div className="previous-performance"><span>LAST TIME · {previous.sessions[0].performed_on}</span><b>{previous.sessions[0].sets.map(s => `${s.weight} kg × ${s.reps}`).join(' · ')}</b><small>Best: {previous.personal_best_weight} kg · est. 1RM {previous.personal_best_1rm.toFixed(1)} kg</small></div>}<div className="setlabels"><span>SET</span><span>KG</span><span>REPS</span><span>RPE</span><span /></div>{item.sets?.map((set, j) => <div className="set" key={j}><span>{j + 1}</span><input value={set.weight || ''} inputMode="decimal" onChange={e => change(i, j, 'weight', +e.target.value)} placeholder="0"/><input value={set.reps || ''} inputMode="numeric" onChange={e => change(i, j, 'reps', +e.target.value)} placeholder="0"/><input value={set.exertion ?? ''} inputMode="decimal" onChange={e => change(i, j, 'exertion', +e.target.value)} placeholder="RPE"/><button className="remove-set" onClick={() => setWorkout({ ...workout, exercises: workout.exercises.map((x, a) => a === i ? { ...x, sets: x.sets?.filter((_, b) => b !== j) } : x) })}>×</button></div>)}<div className="logger-actions"><button className="addset" onClick={() => setWorkout({ ...workout, exercises: workout.exercises.map((x, a) => a === i ? { ...x, sets: [...(x.sets ?? []), { weight: 0, reps: 0 }] } : x) })}>＋ Add set</button>{(item.rest_seconds ?? 90) > 0 && <button className="rest-button" onClick={() => setRestUntil(Date.now() + (item.rest_seconds ?? 90) * 1000)}>Rest {formatRestDuration(item.rest_seconds ?? 90)}</button>}</div><details className="exercise-note" open={Boolean(item.note)}><summary>OPTIONAL NOTE</summary><textarea value={item.note ?? ''} onChange={e => setWorkout({ ...workout, exercises: workout.exercises.map((x, a) => a === i ? { ...x, note: e.target.value } : x) })}/></details></div>}</article>)}<div className={`mobile-add-sheet ${extraExerciseOpen ? 'open' : ''}`}><button type="button" className="mobile-add-handle" aria-label={extraExerciseOpen ? 'Hide add exercise panel' : 'Swipe up to add another exercise'} aria-expanded={extraExerciseOpen} onClick={() => { if (!extraExerciseDidSwipe.current) setExtraExerciseOpen(value => !value); }} onTouchStart={event => { extraExerciseTouch.current = event.touches[0]?.clientY ?? null; extraExerciseDidSwipe.current = false; }} onTouchMove={event => { const startY = extraExerciseTouch.current, currentY = event.touches[0]?.clientY; if (startY !== null && currentY !== undefined && Math.abs(startY - currentY) > 10) extraExerciseDidSwipe.current = true; }} onTouchEnd={event => { const startY = extraExerciseTouch.current, endY = event.changedTouches[0]?.clientY; if (startY !== null && endY !== undefined && Math.abs(startY - endY) > 35) setExtraExerciseOpen(endY < startY); extraExerciseTouch.current = null; window.setTimeout(() => { extraExerciseDidSwipe.current = false; }, 350); }}><span /><b>{extraExerciseOpen ? 'Swipe down to close' : 'Swipe up to add exercise'}</b></button><div className="addexercise"><p>ADD AN EXTRA EXERCISE</p><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search for an exercise"/>{results.map(x => <button key={x.id} onClick={() => addExercise(x)}><span>{x.name}<small>{x.primary_muscle} · {x.equipment}</small></span>＋</button>)}</div></div></section>{extraExerciseOpen && <button type="button" className="mobile-add-backdrop" aria-label="Close add exercise panel" onClick={() => setExtraExerciseOpen(false)} />}</>;
}
type CalendarDay = { routine_override?: Routine | null; date: string; routine_id: number | null; routine_name: string | null; status: 'completed' | 'upcoming' | 'missed' | 'empty'; workout_name: string | null };
type WeeklyPlan = { name: string; starts_on: string; days: { weekday: number; routine_id: number; routine_name: string }[] };
type CalendarMonth = { plan: WeeklyPlan | null; days: CalendarDay[] };
type LoadCalendarMonth = (year: number, month: number, force?: boolean) => Promise<CalendarMonth | undefined>;
function Calendar({ folders, history, months, loadMonth, onWorkoutSaved, start, repeatWorkout }: { folders: Folder[]; history: Workout[]; months: Record<string, CalendarMonth>; loadMonth: LoadCalendarMonth; onWorkoutSaved: (date: string) => Promise<void>; start: (routine: Routine) => Promise<void>; repeatWorkout: (workout: Workout) => Promise<void> }) {
    const [editWorkout, setEditWorkout] = useState<Workout | null>(null);
    const [viewWorkout, setViewWorkout] = useState<Workout | null>(null);
    const [noteWorkout, setNoteWorkout] = useState<Workout | null>(null);
    const [noteDraft, setNoteDraft] = useState('');
    const [noteSaving, setNoteSaving] = useState(false);
    const saveNote = async () => { if (!noteWorkout?.id) return; setNoteSaving(true); try { await api(`/workouts/${noteWorkout.id}`, { method: 'PATCH', body: JSON.stringify({ ...noteWorkout, note: noteDraft }) }); await onWorkoutSaved(noteWorkout.performed_on); setNoteWorkout(null); } finally { setNoteSaving(false); } };
    return <><TrainingCalendar folders={folders} history={history} months={months} loadMonth={loadMonth} start={start} repeatWorkout={repeatWorkout} viewWorkout={setViewWorkout} editWorkout={setEditWorkout} addNote={workout => { setNoteWorkout(workout); setNoteDraft(workout.note ?? ''); }}/>{viewWorkout && <div className="back calendar-view-overlay"><article className="calendar-view-panel" role="dialog" aria-modal="true" aria-label="Workout details"><header><div><small>{viewWorkout.performed_on} · COMPLETED</small><h2>{viewWorkout.name}</h2><p>{viewWorkout.exercises.reduce((total, exercise) => total + (exercise.sets?.length ?? 0), 0)} sets · {duration(viewWorkout.duration_seconds)}</p></div><button aria-label="Close workout details" onClick={() => setViewWorkout(null)}>×</button></header>{viewWorkout.note && <p className="calendar-view-note">{viewWorkout.note}</p>}<div className="calendar-view-exercises">{viewWorkout.exercises.map((exercise, index) => <section key={`${exercise.name}-${index}`}><h3>{exercise.name}</h3><p>{(exercise.sets ?? []).map(set => `${set.weight} kg × ${set.reps}`).join(' · ') || 'No sets logged'}</p>{exercise.note && <small>{exercise.note}</small>}</section>)}</div><footer><button onClick={() => { setEditWorkout(viewWorkout); setViewWorkout(null); }}>Edit workout</button></footer></article></div>}{noteWorkout && <div className="back calendar-note-overlay"><form className="calendar-note-panel" role="dialog" aria-modal="true" aria-label="Workout note" onSubmit={event => { event.preventDefault(); void saveNote(); }}><header><h2>Workout note</h2><button type="button" aria-label="Close note" onClick={() => setNoteWorkout(null)}>×</button></header><p>{noteWorkout.name} · {noteWorkout.performed_on}</p><textarea autoFocus maxLength={1000} value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="How did this workout go?"/><footer><button type="button" onClick={() => setNoteWorkout(null)}>Cancel</button><button className="primary" disabled={noteSaving}>{noteSaving ? 'Saving…' : 'Save note'}</button></footer></form></div>}{editWorkout && <div className="back calendar-editor"><div className="calendar-editor-panel"><Logger workout={editWorkout} folders={folders} active={[]} start={start} startAdHoc={async () => undefined} setWorkout={setEditWorkout} editing finish={async () => undefined} saveEdit={async workout => { await api(`/workouts/${workout.id}`, { method: 'PATCH', body: JSON.stringify(workout) }); setEditWorkout(null); await onWorkoutSaved(workout.performed_on); }}/><button className="calendar-editor-close" onClick={() => setEditWorkout(null)}>×</button></div></div>}</>;
}
function TrainingCalendar({ folders, history, months, loadMonth, start, repeatWorkout, viewWorkout, editWorkout, addNote }: { folders: Folder[]; history: Workout[]; months: Record<string, CalendarMonth>; loadMonth: LoadCalendarMonth; start: (routine: Routine) => Promise<void>; repeatWorkout: (workout: Workout) => Promise<void>; viewWorkout: (workout: Workout) => void; editWorkout: (workout: Workout) => void; addNote: (workout: Workout) => void }) {
    const routines = folders.flatMap(folder => folder.routines);
    const [plannedEdit, setPlannedEdit] = useState<Routine | null>(null);
    const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const [selected, setSelected] = useState(today());
    const [editing, setEditing] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [chosenRoutine, setChosenRoutine] = useState('');
    const [name, setName] = useState('My training week');
    const [assignments, setAssignments] = useState<Record<number, string>>({});
    const monthNumber = month.getMonth() + 1;
    const monthKey = `${month.getFullYear()}-${String(monthNumber).padStart(2, '0')}`;
    const data = months[monthKey];
    const plan = data?.plan ?? null;
    const days = data?.days ?? [];
    useEffect(() => { void loadMonth(month.getFullYear(), monthNumber); }, [month, monthNumber, loadMonth]);
    useEffect(() => { if (plan) { setName(plan.name); setAssignments(Object.fromEntries(plan.days.map(item => [item.weekday, String(item.routine_id)]))); } }, [plan]);
    const changeMonth = (offset: number) => { const next = new Date(month.getFullYear(), month.getMonth() + offset, 1); setMonth(next); setSelected(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`); };
    const save = async () => { const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); const payload = { name, starts_on: monday.toISOString().slice(0, 10), days: Object.entries(assignments).filter(([, value]) => value).map(([weekday, routine_id]) => ({ weekday: Number(weekday), routine_id: Number(routine_id) })) }; try { await api('/calendar/plan', { method: 'POST', body: JSON.stringify(payload) }); await loadMonth(month.getFullYear(), monthNumber, true); setEditing(false); } catch { setEditing(true); } };
    const selectedDay = days.find(day => day.date === selected);
    const workout = history.find(item => item.completed && item.performed_on === selected);
    const template = selectedDay?.routine_override ?? routines.find(item => item.id === selectedDay?.routine_id) ?? routines.find(item => String(item.id) === chosenRoutine);
    const routine = template ? { ...template, scheduled_on: selected } : undefined;
    const eventName = selectedDay?.status === 'completed' ? selectedDay.workout_name : selectedDay?.routine_name;
    const date = new Date(`${selected}T12:00:00`);
    const firstOffset = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
    const dateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    const daysByDate = new Map(days.map(day => [day.date, day]));
    const selectedRoutine = routines.find(item => String(item.id) === chosenRoutine);
    const cells: { date: string; day?: CalendarDay; outside: boolean }[] = [];
    for (let index = 0; index < firstOffset; index++) { const d = new Date(month.getFullYear(), month.getMonth(), index - firstOffset + 1); cells.push({ date: dateKey(d), outside: true }); }
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) { const key = dateKey(new Date(month.getFullYear(), month.getMonth(), dayNumber)); cells.push({ date: key, day: daysByDate.get(key), outside: false }); }
    while (cells.length % 7) { const d = new Date(month.getFullYear(), month.getMonth(), cells.length - firstOffset + 1); cells.push({ date: dateKey(d), outside: true }); }
    const primary = () => { if (workout) viewWorkout(workout); else if (routine) void start(routine); else setEditing(true); };
    return <section className="training-calendar">
        {plannedEdit && <Editor routine={plannedEdit} folders={folders} close={() => setPlannedEdit(null)} done={async () => { await loadMonth(month.getFullYear(), monthNumber, true); setPlannedEdit(null); }}/>}
        <header className="training-calendar-header"><h1>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h1><div className="training-calendar-tools"><button className="calendar-icon-button previous" aria-label="Previous month" onClick={() => changeMonth(-1)}>‹</button><button className="calendar-icon-button next" aria-label="Next month" onClick={() => changeMonth(1)}>›</button><select aria-label="Routine" value={chosenRoutine} onChange={event => setChosenRoutine(event.target.value)}><option value="">{plan?.name.replace(/\\s+Program$/i, '') ?? 'Choose a routine'}</option>{routines.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="calendar-plan-button" onClick={() => setEditing(value => !value)}>{editing ? 'Close plan' : 'Plan week'}</button><div className="calendar-menu-wrap"><button className="calendar-icon-button calendar-menu-button" aria-label="Calendar options" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>⋯</button>{menuOpen && <div className="calendar-menu"><button onClick={() => { setSelected(today()); setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); setMenuOpen(false); }}>Go to today</button><button onClick={() => { setEditing(true); setMenuOpen(false); }}>Edit weekly plan</button></div>}</div></div></header>
        {editing && <section className="week-planner"><label>WEEK NAME<input value={name} onChange={event => setName(event.target.value)}/></label><div>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, weekday) => <label key={label}><span>{label}</span><select value={assignments[weekday] ?? ''} onChange={event => setAssignments({ ...assignments, [weekday]: event.target.value })}><option value="">Rest day</option>{routines.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>)}</div><button className="primary" onClick={() => void save()}>Save weekly plan →</button></section>}
        <div className="training-calendar-layout"><div className="training-month"><div className="training-weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(label => <span key={label}>{label}</span>)}</div><div className="training-days">{cells.map(cell => { const day = cell.day; const label = day?.status === 'completed' ? day.workout_name : day?.routine_name; const shortLabel = label ? (/full body/i.test(label) ? 'Full' : label.split(' · ')[0].split(' ')[0]) : ''; const loggedWorkout = history.find(item => item.completed && item.performed_on === cell.date); const dayNote = loggedWorkout?.note; const eventRoutineId = day?.status === 'completed' ? loggedWorkout?.routine_id : day?.routine_id; const matchesFilter = !chosenRoutine || !label || (eventRoutineId != null ? String(eventRoutineId) === chosenRoutine : label.trim().toLocaleLowerCase() === selectedRoutine?.name.trim().toLocaleLowerCase()); return <button key={cell.date} type="button" className={`training-day ${day?.status ?? 'empty'} ${cell.outside ? 'outside' : ''} ${cell.date === selected ? 'selected' : ''} ${cell.date === today() ? 'today' : ''} ${matchesFilter ? '' : 'filtered-out'}`} onClick={() => { setSelected(cell.date); if (cell.outside) setMonth(new Date(`${cell.date}T12:00:00`)); }}><span className="training-date">{Number(cell.date.slice(-2))}</span>{dayNote && <span className="training-note-indicator" tabIndex={0} aria-label={`Workout note: ${dayNote}`}>✎<span className="training-note-tooltip" role="tooltip">{dayNote}</span></span>}{label && <span className="training-event"><b className="training-event-full">{label}</b><b className="training-event-short">{shortLabel}</b><small>{day?.status === 'completed' ? 'Completed' : day?.status === 'missed' ? 'Missed' : 'Planned'}</small><i aria-hidden="true">{day?.status === 'completed' ? '✓' : '●'}</i></span>}</button>; })}</div></div>
        <aside className="training-detail"><div className="training-detail-head"><h2><span className="training-detail-desktop-date">{date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span><span className="training-detail-mobile-date">{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></h2><p>{date.toLocaleDateString(undefined, { weekday: 'long' })}</p></div>{eventName ? <div className="training-detail-workout"><span className="training-detail-icon" aria-hidden="true">{workout ? '✓' : '▤'}</span><div><h3>{eventName}{workout?.note && <span className="training-detail-note-indicator" tabIndex={0} aria-label={`Workout note: ${workout.note}`}>✎<span className="training-note-tooltip" role="tooltip">{workout.note}</span></span>}</h3><p>{workout ? `${workout.exercises.reduce((total, exercise) => total + (exercise.sets?.length ?? 0), 0)} sets · ${duration(workout.duration_seconds)}` : selectedDay?.status === 'missed' ? 'Missed workout' : 'Planned workout'}</p></div></div> : <p className="training-detail-empty">No workout planned.</p>}<button className="training-detail-primary" onClick={primary}>{workout ? 'View workout' : routine ? 'Start workout' : 'Add workout'}</button><div className="training-detail-actions">{workout && <><button onClick={() => void repeatWorkout(workout)}>↻ <span>Log again</span>›</button><button onClick={() => editWorkout(workout)}>✎ <span>Edit workout</span>›</button><button onClick={() => addNote(workout)}>▤ <span>{workout.note ? 'Edit note' : 'Add note'}</span>›</button></>}{!workout && routine && <button onClick={() => setPlannedEdit(routine)}>▤ <span>Open planned workout</span>›</button>}</div></aside></div>
    </section>;
}
function History({ data, edit, refresh, note, repeat }: { data: Workout[]; edit: (x: Workout) => void; refresh: () => Promise<void>; note: (s: string) => void; repeat?: (x: Workout) => Promise<void> }) {
    const [selectedId, setSelectedId] = useState<number | null>(null), [detailOpen, setDetailOpen] = useState(false), [query, setQuery] = useState(''), [month, setMonth] = useState('all'), [view, setView] = useState<'sessions' | 'analysis'>('sessions'), [optimisticallyDeleted, setOptimisticallyDeleted] = useState<Set<number>>(() => new Set());
    const lastSelectedId = useRef<number | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [showSetDetails, setShowSetDetails] = useState(false);
    const [noteOpen, setNoteOpen] = useState(false);
    const [noteDraft, setNoteDraft] = useState('');
    const [noteSaving, setNoteSaving] = useState(false);
    useEffect(() => { const update = (event: Event) => { const { id, deleted } = (event as CustomEvent<{ id: number; deleted: boolean }>).detail; setOptimisticallyDeleted(current => { const next = new Set(current); if (deleted) next.add(id); else next.delete(id); return next; }); if (deleted) setSelectedId(current => { if (current === id) setDetailOpen(false); return current === id ? null : current; }); }; window.addEventListener('optimistic-workout-delete', update); return () => window.removeEventListener('optimistic-workout-delete', update); }, []);
    useEffect(() => { document.body.classList.toggle('history-session-open', detailOpen); return () => document.body.classList.remove('history-session-open'); }, [detailOpen]);
    useEffect(() => { if (selectedId === null && detailOpen && lastSelectedId.current !== null) { setDetailOpen(false); setSelectedId(lastSelectedId.current); } }, [selectedId, detailOpen]);
    const completed = data.filter(workout => workout.completed && !optimisticallyDeleted.has(workout.id ?? -1));
    const months = [...new Set(completed.map(workout => workout.performed_on.slice(0, 7)))];
    const filtered = completed.filter(workout => (month === 'all' || workout.performed_on.startsWith(month)) && `${workout.name} ${workout.exercises.map(item => item.name).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
    const selected = filtered.find(workout => workout.id === selectedId) ?? filtered[0] ?? null;
    const groups = filtered.reduce<Record<string, Workout[]>>((all, workout) => { const key = workout.performed_on.slice(0, 7); (all[key] ??= []).push(workout); return all; }, {});
    const volume = (workout: Workout) => workout.exercises.reduce((total, item) => total + (item.sets ?? []).reduce((sets, set) => sets + set.weight * set.reps, 0), 0);
    const formatMonth = (key: string) => new Date(`${key}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const select = (workout: Workout) => { lastSelectedId.current = workout.id ?? null; setSelectedId(workout.id ?? null); setDetailOpen(true); setMenuOpen(false); setShowSetDetails(false); };
    const formatDate = (value: string, options: Intl.DateTimeFormatOptions) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, options);
    const deleteSelected = async (workout: Workout) => {
        if (!window.confirm(`Delete “${workout.name}”? This cannot be undone.`)) return;
        setMenuOpen(false);
        await api(`/workouts/${workout.id}`, { method: 'DELETE' });
        setSelectedId(null);
        setDetailOpen(false);
        await refresh();
        note('Workout deleted');
    };
    const saveSelectedNote = async () => {
        if (!selected) return;
        setNoteSaving(true);
        try {
            await api(`/workouts/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ ...selected, note: noteDraft.trim() }) });
            await refresh();
            setNoteOpen(false);
            note('Note saved');
        } catch {
            note('Could not save note');
        } finally { setNoteSaving(false); }
    };
    return <>
        <Head><h1 className="history-page-title">Workout history</h1></Head>
        <div className="history-tabs" role="tablist" aria-label="History view">
            <button type="button" role="tab" aria-selected={view === 'sessions'} className={view === 'sessions' ? 'active' : ''} onClick={() => setView('sessions')}>Sessions</button>
            <button type="button" role="tab" aria-selected={view === 'analysis'} className={view === 'analysis' ? 'active' : ''} onClick={() => setView('analysis')}>Analysis</button>
        </div>
        {view === 'analysis' ? <HistoryAnalysis completed={completed}/> : <>
            <section className="history-toolbar" aria-label="Filter sessions">
                <label className="history-search"><span className="visually-hidden">Search workouts or exercises</span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search workouts or exercises"/></label>
                <label className="history-period"><span className="visually-hidden">Time period</span><select value={month} onChange={event => setMonth(event.target.value)}><option value="all">All time</option>{months.map(key => <option key={key} value={key}>{formatMonth(key)}</option>)}</select></label>
                <p>{filtered.length} {filtered.length === 1 ? 'session' : 'sessions'}</p>
            </section>
            {completed.length ? <section className="history-layout" aria-label="Workout sessions">
                <nav className="history-list" aria-label="Completed workouts">
                    {filtered.length ? Object.entries(groups).map(([key, workouts]) => <div className="history-group" key={key}>
                        <p>{formatMonth(key)}</p>
                        {workouts.map(workout => <button type="button" className={`history-row-main ${selected?.id === workout.id ? 'active' : ''}`} aria-current={selected?.id === workout.id ? 'true' : undefined} onClick={() => select(workout)} key={workout.id}>
                            <time dateTime={workout.performed_on}><small>{formatDate(workout.performed_on, { month: 'short' })}</small><strong>{formatDate(workout.performed_on, { day: 'numeric' })}</strong></time>
                            <span><b>{workout.name}</b><small>{workout.exercises.length} exercises · {volume(workout).toLocaleString()} kg · {duration(workout.duration_seconds)}</small></span>
                            <i aria-hidden="true">›</i>
                        </button>)}
                    </div>) : <div className="history-no-results">No sessions match those filters.</div>}
                </nav>
                {selected && <article className="history-session" aria-label={`${selected.name} details`}>
                    <button className="history-session-close" type="button" aria-label="Close workout details" onClick={() => setDetailOpen(false)}>×</button>
                    <header className="history-session-head">
                        <div><h2>{selected.name}</h2><p>{formatDate(selected.performed_on, { month: 'short', day: 'numeric', year: 'numeric' })}</p></div>
                        <div className="history-actions"><button type="button" className="history-edit" onClick={() => edit(selected)}>Edit session</button><div className="history-menu-wrap"><button type="button" className="history-menu-trigger" aria-label="More session actions" aria-expanded={menuOpen} onClick={() => setMenuOpen(current => !current)}>⋯</button>{menuOpen && <div className="history-menu"><button type="button" onClick={() => void deleteSelected(selected)}>Delete session</button></div>}</div></div>
                    </header>
                    <div className="history-session-stats"><span><DashboardIcon name="session"/>{selected.exercises.length} exercises</span><span><DashboardIcon name="scale"/>{volume(selected).toLocaleString()} kg</span><span><DashboardIcon name="clock"/>{duration(selected.duration_seconds)}</span></div>
                    {selected.note && <p className="history-session-note">{selected.note}</p>}
                    <div className="history-section-title"><h3>Exercises</h3><div className="history-utilities"><button type="button" onClick={() => setShowSetDetails(current => !current)} aria-pressed={showSetDetails}>☷ <span>{showSetDetails ? 'Hide details' : 'View details'}</span></button>{repeat && <button type="button" onClick={() => void repeat(selected)}>↻ <span>Log again</span></button>}<button type="button" onClick={() => { setNoteDraft(selected.note ?? ''); setNoteOpen(true); }}>▤ <span>{selected.note ? 'Edit note' : 'Add note'}</span></button></div></div>
                    <div className="history-exercises">
                        {selected.exercises.map((item, i) => <div className="history-exercise" key={`${item.name}-${i}`}><span className="history-exercise-index">{i + 1}</span><div><b>{item.name}</b><small>{(item.sets ?? []).map(set => `${set.weight} kg × ${set.reps}`).join(' · ') || 'No completed sets'}</small>{showSetDetails && <div className="history-set-details">{(item.sets ?? []).map((set, index) => <span key={index}>Set {index + 1}: {set.weight} kg × {set.reps}{set.exertion ? ` · RPE ${set.exertion}` : ''}</span>)}{item.note && <p>{item.note}</p>}</div>}</div></div>)}
                    </div>
                </article>}
            </section> : <div className="empty">No completed workouts yet.</div>}
        </>}
        {noteOpen && selected && <div className="back history-note-overlay"><form className="history-note-panel" role="dialog" aria-modal="true" aria-label="Workout note" onSubmit={event => { event.preventDefault(); void saveSelectedNote(); }}><header><h2>Workout note</h2><button type="button" aria-label="Close note" onClick={() => setNoteOpen(false)}>×</button></header><p>{selected.name} · {formatDate(selected.performed_on, { month: 'short', day: 'numeric', year: 'numeric' })}</p><textarea autoFocus maxLength={1000} value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="How did this workout go?"/><footer><button type="button" onClick={() => setNoteOpen(false)}>Cancel</button><button className="primary" disabled={noteSaving}>{noteSaving ? 'Saving…' : 'Save note'}</button></footer></form></div>}
    </>;
}
