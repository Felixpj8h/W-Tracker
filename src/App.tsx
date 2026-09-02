import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import './App.css';
import './routine.css';
import './logger.css';
import './motion.css';
import './mobile.css';
import './typography.css';
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
type Workout = {
    id?: number;
    name: string;
    performed_on: string;
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
    }[];
};
type Page = 'dashboard' | 'routines' | 'workout' | 'calendar' | 'history';
const API = import.meta.env.VITE_API_URL ?? `${window.location.protocol}//${window.location.hostname}:8000/api/v1`;
const today = () => new Date().toISOString().slice(0, 10);
const fieldValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
async function api<T>(path: string, opts?: RequestInit): Promise<T> { const r = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...opts }); if (!r.ok)
    throw Error('Could not reach the tracker server'); return r.json(); }
const vol = (n: number) => Math.round(n).toLocaleString();
const duration = (seconds?: number | null) => seconds === null || seconds === undefined ? '—' : `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}h ` : ''}${Math.floor(seconds % 3600 / 60)} min`;
export function LegacyApp() { const [page, setPage] = useState<Page>('dashboard'), [dash, setDash] = useState<Dash | null>(null), [folders, setFolders] = useState<Folder[]>([]), [history, setHistory] = useState<Workout[]>([]), [active, setActive] = useState<Workout[]>([]), [workout, setWorkout] = useState<Workout | null>(null), [editingHistory, setEditingHistory] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [dark, setDark] = useState(() => localStorage.getItem('workout-theme') !== 'light'); const load = async () => { try {
    const [d, f, h, a] = await Promise.all([api<Dash>('/dashboard'), api<Folder[]>('/folders'), api<Workout[]>('/workouts'), api<Workout[]>('/workouts/active')]);
    setDash(d);
    setFolders(f);
    setHistory(h);
    setActive(a);
    setError('');
}
catch (e) {
    setError(e instanceof Error ? e.message : 'Load failed');
} }; useEffect(() => { void load(); }, []); useEffect(() => localStorage.setItem('workout-theme', dark ? 'dark' : 'light'), [dark]); const note = (x: string) => { setMessage(x); setTimeout(() => setMessage(''), 2400); }; const withPlan = (x: Workout): Workout => ({ ...x, exercises: x.exercises.map(e => ({ ...e, exercise_id: e.exercise_id ?? e.cached_exercise_id, planned: { exercise_id: e.exercise_id ?? e.cached_exercise_id, cached_exercise_id: e.cached_exercise_id, name: e.name, primary_muscle: e.primary_muscle, secondary_muscles: e.secondary_muscles, muscle_group: e.muscle_group }, rest_seconds: e.rest_seconds ?? 90 })) }); const start = async (r: Routine) => { try {
    setWorkout(withPlan(await api<Workout>(`/routines/${r.id}/start`, { method: 'POST' })));
}
catch {
    setWorkout(withPlan({ name: r.name, performed_on: today(), started_at: new Date().toISOString(), exercises: r.exercises.map(x => ({ ...x, name: x.exercise?.name ?? x.name, primary_muscle: x.exercise?.primary_muscle ?? x.primary_muscle, secondary_muscles: x.exercise?.secondary_muscles ?? x.secondary_muscles, muscle_group: x.exercise?.muscle_group ?? x.muscle_group, exercise_id: x.exercise_id ?? x.exercise?.id, sets: Array.from({ length: x.planned_sets ?? 3 }, () => ({ weight: x.target_weight ?? 0, reps: x.target_reps ?? 0 })) })) }));
} setPage('workout'); }; const chooseWorkout = () => { setEditingHistory(false); setWorkout(null); setPage('workout'); }; const startAdHoc = async () => { const draft = await api<Workout>('/workouts/draft', { method: 'POST', body: JSON.stringify({ name: 'Workout', performed_on: today() }) }); setEditingHistory(false); setWorkout(draft); setPage('workout'); }; const editHistory = (x: Workout) => { setEditingHistory(Boolean(x.completed)); setWorkout(x); setPage('workout'); }; return <div className={`app ${dark ? 'dark' : ''}`}><Side page={page} setPage={p => { if (p === 'workout')
    setWorkout(null); setEditingHistory(false); setPage(p); }} dark={dark} setDark={setDark}/><main className="workspace">{error && <div className="error">{error} — start the FastAPI server to save data.</div>}{message && <div className="toast">{message}</div>}{page === 'dashboard' && <Dashboard dash={dash} log={chooseWorkout} saveWeight={async (weight) => { await api('/bodyweight', { method: 'POST', body: JSON.stringify({ recorded_on: today(), weight }) }); await load(); note('Bodyweight saved'); }}/>}{page === 'routines' && <Routines folders={folders} refresh={load} start={start} note={note}/>} {page === 'workout' && <Logger workout={workout} folders={folders} active={active} start={start} startAdHoc={startAdHoc} setWorkout={setWorkout} editing={editingHistory} finish={async (x) => { const completed = await api<Workout>(`/workouts/${x.id}`, { method: 'PUT', body: JSON.stringify(x) }); await load(); note(`Workout finished · ${duration(completed.duration_seconds)}`); setWorkout(null); setEditingHistory(false); setPage('dashboard'); }} saveEdit={async (x) => { await api(`/workouts/${x.id}`, { method: 'PATCH', body: JSON.stringify(x) }); await load(); note('Workout updated'); setWorkout(null); setEditingHistory(false); setPage('history'); }}/>}{page === 'history' && <History data={history} edit={editHistory} refresh={load} note={note}/>}</main><div className="mobile">{(['dashboard', 'routines', 'workout', 'history'] as Page[]).map(x => <button key={x} onClick={() => { if (x === 'workout')
    setWorkout(null); setPage(x); }}>{x === 'dashboard' ? '⌂' : x === 'routines' ? '▤' : x === 'workout' ? '＋' : '◷'}<small>{x}</small></button>)}</div></div>; }
export default function App() {
    const [page, setPage] = useState<Page>('dashboard'), [dash, setDash] = useState<Dash | null>(null), [folders, setFolders] = useState<Folder[]>([]), [history, setHistory] = useState<Workout[]>([]), [active, setActive] = useState<Workout[]>([]), [workout, setWorkout] = useState<Workout | null>(null), [editing, setEditing] = useState(false), [dark, setDark] = useState(() => localStorage.getItem('workout-theme') !== 'light');
    const load = async () => { const [d, f, h, a] = await Promise.all([api<Dash>('/dashboard'), api<Folder[]>('/folders'), api<Workout[]>('/workouts'), api<Workout[]>('/workouts/active')]); setDash(d); setFolders(f); setHistory(h); setActive(a); };
    useEffect(() => { void load(); }, []); useEffect(() => localStorage.setItem('workout-theme', dark ? 'dark' : 'light'), [dark]);
    const start = async (routine: Routine) => { const draft = await api<Workout>(`/routines/${routine.id}/start`, { method: 'POST' }); setWorkout({ ...draft, exercises: draft.exercises.map(item => ({ ...item, exercise_id: item.cached_exercise_id, rest_seconds: item.rest_seconds ?? 90 })) }); setEditing(false); setPage('workout'); };
    const finish = async (entry: Workout) => { await api(`/workouts/${entry.id}`, { method: editing ? 'PATCH' : 'PUT', body: JSON.stringify(entry) }); await load(); setWorkout(null); setEditing(false); setPage(editing ? 'history' : 'dashboard'); };
    return <div className={`app ${dark ? 'dark' : ''}`}><Side page={page} setPage={setPage} dark={dark} setDark={setDark}/><main className="workspace">{page === 'dashboard' && <Dashboard dash={dash} log={() => setPage('workout')} saveWeight={async weight => { await api('/bodyweight', { method: 'POST', body: JSON.stringify({ recorded_on: today(), weight }) }); await load(); }}/>} {page === 'routines' && <Routines folders={folders} refresh={load} start={start} note={() => undefined}/>} {page === 'calendar' && <Calendar folders={folders} start={start}/>} {page === 'workout' && <Logger workout={workout} folders={folders} active={active} start={start} startAdHoc={async () => undefined} setWorkout={setWorkout} editing={editing} finish={finish} saveEdit={finish}/>} {page === 'history' && <History data={history} edit={entry => { setEditing(Boolean(entry.completed)); setWorkout(entry); setPage('workout'); }} refresh={load} note={() => undefined}/>}</main><div className="mobile">{(['dashboard', 'routines', 'workout', 'calendar', 'history'] as Page[]).map(item => <button key={item} onClick={() => { setWorkout(null); setEditing(false); setPage(item); }}>{item === 'dashboard' ? '⌂' : item === 'routines' ? '▤' : item === 'workout' ? '＋' : item === 'calendar' ? '□' : '◷'}<small>{item}</small></button>)}</div></div>;
}
function Side({ page, setPage, dark, setDark }: { page: Page; setPage: (page: Page) => void; dark: boolean; setDark: (value: boolean) => void }) {
    const links: [Page, string, string][] = [['dashboard', '▦', 'Dashboard'], ['routines', '▤', 'Routines'], ['workout', '＋', 'Log workout'], ['calendar', '□', 'Calendar'], ['history', '◷', 'History']];
    return <aside className="sidebar"><div className="brand"><b>W</b><span>workout<br />tracker</span></div><div className="person"><i>F</i><div><b>My training</b><small>Personal workspace</small></div></div><nav className="side-nav">{links.map(([id, icon, label]) => <button key={id} className={`side-link ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}><i>{icon}</i><span>{label}</span></button>)}</nav><footer><label className="switch"><input type="checkbox" checked={dark} onChange={event => setDark(event.target.checked)}/><span />Dark mode</label><small>Built for the work.</small></footer></aside>;
}
export function LegacySide({ page, setPage, dark, setDark }: {
    page: Page;
    setPage: (p: Page) => void;
    dark: boolean;
    setDark: (x: boolean) => void;
}) { const [loading, setLoading] = useState(false); const addDemo = async () => { setLoading(true); try {
    await api('/demo-data', { method: 'POST' });
    window.location.reload();
}
finally {
    setLoading(false);
} }; return <aside className="sidebar"><div className="brand"><b>W</b><span>workout<br />tracker</span></div><div className="person"><i>F</i><div><b>My training</b><small>Personal workspace</small></div></div><nav className="side-nav">{([['dashboard', '▦', 'Dashboard'], ['routines', '▤', 'Routines'], ['workout', '＋', 'Log workout'], ['history', '◷', 'History']] as const).map(([id, icon, name]) => <button key={id} className={`side-link ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}><i>{icon}</i><span>{name}</span></button>)}</nav><footer><button className="demo-button" onClick={() => void addDemo()} disabled={loading}>{loading ? 'Adding demo data…' : '✦ Load demo data'}</button><label className="switch"><input type="checkbox" checked={dark} onChange={e => setDark(e.target.checked)}/><span />Dark mode</label><small>Built for the work.</small></footer></aside>; }
function Head({ children, action }: {
    children: React.ReactNode;
    action?: React.ReactNode;
}) { return <header className="head"><div>{children}</div>{action}</header>; }
function DashboardGreeting({ dash }: { dash: Dash | null }) {
    const greeting = 'Hello Felix.';
    const [completedWorkouts, setCompletedWorkouts] = useState<Workout[] | null>(null);
    useEffect(() => { void api<Workout[]>('/workouts').then(entries => setCompletedWorkouts(entries.filter(entry => entry.completed))).catch(() => setCompletedWorkouts([])); }, []);
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
    const factKey = facts.join('|');
    const [text, setText] = useState('');
    useEffect(() => {
        if (completedWorkouts === null) return;
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
                setText((message === 0 ? greeting : facts[message - 1]).slice(0, character));
                if (character > 0) timer = setTimeout(tick, 18);
                else {
                    message = message === facts.length ? 1 : message + 1;
                    timer = setTimeout(() => type(message === 0 ? greeting : facts[message - 1]), 260);
                }
            };
            tick();
        };
        setText('');
        timer = setTimeout(() => type(greeting), 280);
        return () => clearTimeout(timer);
    }, [factKey, completedWorkouts]);
    return <p className="dashboard-greeting" aria-live="polite"><span>{text}</span><i aria-hidden="true" /></p>;
}
function Dashboard({ dash, log, saveWeight }: {
    dash: Dash | null;
    log: () => void;
    saveWeight: (n: number) => Promise<void>;
}) { const [weight, setWeight] = useState(''), [panel, setPanel] = useState<'overview' | 'weight' | 'volume'>('overview'); const groups = dash?.volume_by_muscle_group ?? []; const max = Math.max(1, ...groups.flatMap(x => [x.current_week_volume, x.last_week_volume])); return <><Head action={<button className="primary" onClick={log}>Log a workout <b>→</b></button>}><p className="overline">DASHBOARD</p><h1>Training overview</h1></Head><DashboardGreeting dash={dash}/><div className="dash-tabs" role="tablist"><button className={panel === 'overview' ? 'active' : ''} onClick={() => setPanel('overview')}>Overview</button><button className={panel === 'weight' ? 'active' : ''} onClick={() => setPanel('weight')}>Weight</button><button className={panel === 'volume' ? 'active' : ''} onClick={() => setPanel('volume')}>Volume</button></div><div className={`dashboard-panels panel-${panel}`}><section className="stats dashboard-overview"><Stat label="Current weight" value={dash?.latest_weight ? `${dash.latest_weight.weight.toFixed(1)} kg` : '—'} sub={dash?.latest_weight ? 'Latest tracked entry' : 'Add your first entry'}/><Stat label="This week’s volume" value={`${vol(dash?.total_current_volume ?? 0)} kg`} sub={dash?.total_previous_volume ? `${Math.round(((dash.total_current_volume - dash.total_previous_volume) / dash.total_previous_volume) * 100)}% vs last week` : 'No completed sessions yet'}/><Stat label="Last week’s volume" value={`${vol(dash?.total_previous_volume ?? 0)} kg`} sub="Completed load volume"/></section><section className="grid"><article className="card dashboard-weight"><Title n="01" text="Bodyweight"/><div className="weight"><div><strong>{dash?.latest_weight?.weight.toFixed(1) ?? '—'} <small>kg</small></strong><p>Current tracked weight</p></div><form onSubmit={e => { e.preventDefault(); if (+weight)
    void saveWeight(+weight).then(() => setWeight('')); }}><input value={weight} onChange={e => setWeight(e.target.value)} placeholder="kg" inputMode="decimal"/><button>Save</button></form></div><Line values={dash?.weight_series ?? []}/></article><article className="card dashboard-volume"><Title n="02" text="Volume by muscle group"/><div className="legend"><span><i />This week</span><span><i />Last week</span></div>{groups.map(x => <div className="bar" key={x.name}><div><b>{x.name}</b><span>{vol(x.current_week_volume)} kg</span></div><div><i style={{ width: `${x.current_week_volume / max * 100}%` }}/><i style={{ width: `${x.last_week_volume / max * 100}%` }}/></div></div>)}</article></section></div><section className="prompt"><div><p className="overline">READY WHEN YOU ARE</p><h2>Start a session</h2><span>Log a workout now, or begin from one of your routines.</span></div><button className="primary" onClick={log}>Start logging <b>→</b></button></section></>; }
function Stat({ label, value, sub }: {
    label: string;
    value: string;
    sub: string;
}) { return <article><span>{label}</span><strong><AnimatedValue value={value}/></strong><small>{sub}</small></article>; }
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
function Title({ n, text }: {
    text: string;
    n: string;
}) { return <p className="title">{n} · {text}</p>; }
;
function Line({ values }: {
    values: {
        weight: number;
        recorded_on?: string;
    }[];
}) { const low = Math.min(...values.map(x => x.weight)), high = Math.max(...values.map(x => x.weight)), spread = high - low || 1, mid = (low + high) / 2, formatDate = (value?: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''; const pts = values.map((x, i) => `${values.length < 2 ? 50 : i / (values.length - 1) * 100},${82 - ((x.weight - low) / spread) * 58}`).join(' '); return <div className={`chart ${values.length ? '' : 'chart-empty'}`}>{values.length ? <><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={pts}/>{values.map((x, i) => <circle key={i} cx={values.length < 2 ? 50 : i / (values.length - 1) * 100} cy={82 - ((x.weight - low) / spread) * 58} r="1.25"/>)}</svg><div className="chart-axis"><span>{high.toFixed(1)} kg</span><span>{mid.toFixed(1)} kg</span><span>{low.toFixed(1)} kg</span></div><div className="chart-dates"><span>{formatDate(values[0].recorded_on)}</span><span>{formatDate(values.at(-1)?.recorded_on)}</span></div></> : <span>Log bodyweight to unlock your trend.</span>}</div>; }
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
} }; return <><Head action={folders.length ? <button className="primary" onClick={() => setEdit({ id: 0, name: 'New workout day', folder_id: folders[0].id, exercises: [] })}>New workout day <b>＋</b></button> : undefined}><p className="overline">ROUTINE BUILDER</p><h1>Workout routines</h1><p>1. Make a folder. 2. Add your workout days. 3. Build each day exercise by exercise.</p></Head><section className="routine-intro"><div><span>01</span><strong>Create a routine folder</strong><small>Example: Upper / Lower, PPL, or Full body.</small></div><form className="folder" onSubmit={add}><input placeholder="e.g. Push / Pull / Legs" value={folder} onChange={e => setFolder(e.target.value)}/><button>Create folder</button></form></section>{folders.length === 0 && <div className="empty">Your folders will hold named days like Upper, Lower, Push, Pull, Legs, or Full body.</div>}{folders.map(f => <section className="routine-folder" key={f.id}><div className="folder-heading"><div><p className="overline">ROUTINE FOLDER</p><h2>{f.name} <small>· {f.routines.length} workout days</small></h2></div><div className="folder-actions"><button onClick={() => void renameFolder(f)}>Rename</button><button className="danger" onClick={() => void removeFolder(f)}>Delete</button><button className="secondary" onClick={() => setEdit({ id: 0, name: 'New workout day', folder_id: f.id, exercises: [] })}>＋ Add workout day</button></div></div><div className="routine-days">{f.routines.map(r => <article className="routine" key={r.id}><div><p className="day-tag">WORKOUT DAY</p><h3>{r.name}</h3><p>{r.exercises.length ? `${r.exercises.length} exercises · ${r.exercises.map(x => x.exercise?.name).slice(0, 3).join(', ')}${r.exercises.length > 3 ? '…' : ''}` : 'Add exercises to this day'}</p></div><div><button onClick={() => setEdit(r)}>Build day</button><button className="danger" onClick={() => void removeDay(r)}>Delete</button><button className="primary small" onClick={() => start(r)}>Start →</button></div></article>)}{!f.routines.length && <div className="day-empty">No workout days yet. Add Upper, Lower, Push, Pull, Legs, or Full body.</div>}</div></section>)}{edit && <Editor routine={edit} folders={folders} close={() => setEdit(null)} done={async () => { setEdit(null); await refresh(); note('Workout day saved'); }}/>}</>; }
function Editor({ routine, folders, close, done }: { routine: Routine; folders: Folder[]; close: () => void; done: () => Promise<void> }) {
    const [name, setName] = useState(routine.name), [folder, setFolder] = useState(String(routine.folder_id ?? folders[0]?.id ?? '')), [items, setItems] = useState<Item[]>(routine.exercises), [q, setQ] = useState(''), [results, setResults] = useState<Exercise[]>([]);
    useEffect(() => { if (q.trim().length < 2) { setResults([]); return; } const timer = setTimeout(() => void api<Exercise[]>(`/exercises?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([])), 250); return () => clearTimeout(timer); }, [q]);
    const update = (index: number, field: keyof Item, value: number) => setItems(items.map((item, i) => i === index ? { ...item, [field]: value } : item));
    const addExercise = (exercise: Exercise) => { if (!items.some(item => item.exercise_id === exercise.id || item.exercise?.id === exercise.id)) setItems([...items, { exercise_id: exercise.id, exercise, name: exercise.name, planned_sets: 3, target_reps_min: 8, target_reps_max: 12, rest_seconds: 90 }]); setQ(''); setResults([]); };
    const save = async (event: FormEvent) => { event.preventDefault(); await api(routine.id ? `/routines/${routine.id}` : '/routines', { method: routine.id ? 'PUT' : 'POST', body: JSON.stringify({ name, folder_id: Number(folder), exercises: items.map(item => ({ exercise_id: item.exercise_id ?? item.exercise?.id, planned_sets: item.planned_sets ?? 3, target_reps_min: item.target_reps_min ?? item.target_reps ?? 8, target_reps_max: item.target_reps_max ?? item.target_reps ?? 12, rest_seconds: item.rest_seconds ?? 90 })) }) }); await done(); };
    return <div className="back"><form className="modal routine-editor rest-editor" onSubmit={save}><div className="modal-head"><div><p className="overline">WORKOUT DAY BUILDER</p><h2>{routine.id ? 'Edit workout day' : 'New workout day'}</h2></div><button type="button" onClick={close}>×</button></div><div className="builder-basics"><label>DAY NAME<input value={name} onChange={event => setName(event.target.value)}/></label><label>FOLDER<select value={folder} onChange={event => setFolder(event.target.value)}>{folders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label className="add-exercise-label">ADD EXERCISE<input value={q} onChange={event => setQ(event.target.value)} placeholder="Search exercises, e.g. bench press"/></label><div className="search">{results.map(item => <button type="button" key={item.id} onClick={() => addExercise(item)}><span><b>{item.name}</b><small>{item.primary_muscle ?? 'Unmapped'} · {item.equipment}</small></span>＋</button>)}</div><div className="rest-builder-list"><div className="rest-builder-head"><span>EXERCISE</span><span>SETS</span><span>REPS</span><span>REST</span><span /></div>{items.map((item, index) => <div className="rest-builder-row" key={`${item.exercise_id ?? item.exercise?.id}-${index}`}><div><b>{item.exercise?.name ?? item.name}</b><small>{item.exercise?.primary_muscle ?? item.primary_muscle ?? 'Unmapped muscle'}</small></div><input aria-label={`${item.name} sets`} inputMode="numeric" value={item.planned_sets ?? ''} onChange={event => update(index, 'planned_sets', Number(event.target.value))}/><div className="rest-reps"><input aria-label={`${item.name} minimum reps`} inputMode="numeric" value={item.target_reps_min ?? item.target_reps ?? ''} onChange={event => update(index, 'target_reps_min', Number(event.target.value))}/><span>–</span><input aria-label={`${item.name} maximum reps`} inputMode="numeric" value={item.target_reps_max ?? item.target_reps ?? ''} onChange={event => update(index, 'target_reps_max', Number(event.target.value))}/></div><select aria-label={`${item.name} rest time`} value={item.rest_seconds ?? 90} onChange={event => update(index, 'rest_seconds', Number(event.target.value))}><option value="0">No timer</option><option value="60">1 min</option><option value="90">1 min 30 sec</option><option value="120">2 min</option><option value="180">3 min</option><option value="240">4 min</option><option value="300">5 min</option></select><button type="button" aria-label={`Remove ${item.name}`} onClick={() => setItems(items.filter((_, i) => i !== index))}>×</button></div>)}</div><p className="builder-tip">Choose the rest period for each exercise. The workout timer will use it after a set.</p><button className="primary wide">Save workout day →</button></form></div>;
}
export function LegacyEditor({ routine, folders, close, done }: {
    routine: Routine;
    folders: Folder[];
    close: () => void;
    done: () => Promise<void>;
}) { const [name, setName] = useState(routine.name), [folder, setFolder] = useState(String(routine.folder_id ?? folders[0]?.id ?? '')), [items, setItems] = useState(routine.exercises), [q, setQ] = useState(''), [results, setResults] = useState<Exercise[]>([]), [dragging, setDragging] = useState<number | null>(null); useEffect(() => { if (q.trim().length < 2) {
    setResults([]);
    return;
} const t = setTimeout(() => void api<Exercise[]>(`/exercises?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([])), 350); return () => clearTimeout(t); }, [q]); const addExercise = (x: Exercise) => { if (!items.some(i => i.exercise_id === x.id))
    setItems([...items, { exercise_id: x.id, exercise: x, name: x.name, planned_sets: 3, target_reps_min: 8, target_reps_max: 12, rest_seconds: 90 }]); setQ(''); setResults([]); }; const update = (index: number, field: 'planned_sets' | 'target_reps_min' | 'target_reps_max', value: string) => { if (value !== '' && !/^\d+$/.test(value))
    return; setItems(items.map((item, i) => i === index ? { ...item, [field]: value === '' ? undefined : Number(value) } : item)); }; const move = (to: number) => { if (dragging === null || dragging === to)
    return; const next = [...items], [picked] = next.splice(dragging, 1); next.splice(to, 0, picked); setItems(next); setDragging(null); }; return <div className="back"><form className="modal routine-editor" onSubmit={async (e) => { e.preventDefault(); await api(routine.id ? `/routines/${routine.id}` : '/routines', { method: routine.id ? 'PUT' : 'POST', body: JSON.stringify({ name, folder_id: +folder, exercises: items.map(x => ({ exercise_id: x.exercise_id, planned_sets: x.planned_sets, target_reps_min: x.target_reps_min ?? x.target_reps, target_reps_max: x.target_reps_max ?? x.target_reps })) }) }); await done(); }}><div className="modal-head"><div><p className="overline">WORKOUT DAY BUILDER</p><h2>{routine.id ? 'Edit workout day' : 'New workout day'}</h2></div><button type="button" onClick={close}>×</button></div><div className="builder-basics"><label>DAY NAME<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Upper"/></label><label>FOLDER<select value={folder} onChange={e => setFolder(e.target.value)}>{folders.map(x => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label></div><label className="add-exercise-label">ADD EXERCISE<input value={q} onChange={e => setQ(e.target.value)} placeholder="Search exercises, e.g. bench press"/></label><div className="search">{results.map(x => <button type="button" key={x.id} onClick={() => addExercise(x)}><span><b>{x.name}</b><small>{x.primary_muscle ?? 'Unmapped'} · {x.equipment}</small></span>＋</button>)}{q.trim().length >= 2 && results.length === 0 && <button type="button" className="custom-exercise" onClick={() => void api<Exercise>('/exercises/custom', { method: 'POST', body: JSON.stringify({ name: q.trim() }) }).then(addExercise)}>Add “{q.trim()}” as a custom exercise <b>＋</b></button>}</div><div className="builder-list"><div className="builder-list-head"><span>EXERCISE</span><span>SETS</span><span>REPS</span><span /></div>{items.map((x, i) => <div className="builder-item" draggable onDragStart={() => setDragging(i)} onDragOver={e => e.preventDefault()} onDrop={() => move(i)} key={`${x.exercise_id}-${i}`}><div><b><span className="drag-handle">⠿</span>{x.exercise?.name ?? x.name}</b><small>{x.exercise?.primary_muscle ?? x.primary_muscle ?? 'Unmapped muscle'}</small></div><label><input aria-label="Sets" type="text" inputMode="numeric" value={fieldValue(x.planned_sets)} onChange={e => update(i, 'planned_sets', e.target.value)}/></label><label className="rep-range"><input aria-label="Minimum reps" type="text" inputMode="numeric" value={fieldValue(x.target_reps_min ?? x.target_reps)} onChange={e => update(i, 'target_reps_min', e.target.value)}/>{fieldValue(x.target_reps_max ?? x.target_reps) !== fieldValue(x.target_reps_min ?? x.target_reps) && <><span>–</span><input aria-label="Maximum reps" type="text" inputMode="numeric" value={fieldValue(x.target_reps_max ?? x.target_reps)} onChange={e => update(i, 'target_reps_max', e.target.value)}/></>}</label><button type="button" aria-label={`Remove ${x.name}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button></div>)}</div><p className="builder-tip">Drag an exercise by its handle to rearrange your workout. Set matching reps for a fixed target, or use different values for a range.</p><button className="primary wide">Save workout day →</button></form></div>; }
function Logger({ workout, folders, active, start, startAdHoc, setWorkout, editing, finish, saveEdit }: { workout: Workout | null; folders: Folder[]; active: Workout[]; start: (r: Routine) => void; startAdHoc: () => Promise<void>; setWorkout: (x: Workout) => void; editing: boolean; finish: (x: Workout) => Promise<void>; saveEdit: (x: Workout) => Promise<void> }) {
    const [q, setQ] = useState(''), [results, setResults] = useState<Exercise[]>([]), [open, setOpen] = useState(0), [previous, setPrevious] = useState<ExerciseProgress | null>(null), [restUntil, setRestUntil] = useState<number | null>(null), [now, setNow] = useState(Date.now());
    useEffect(() => { if (!restUntil) return; const tick = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(tick); }, [restUntil]);
    useEffect(() => { if (restUntil && now >= restUntil) setRestUntil(null); }, [now, restUntil]);
    useEffect(() => { if (q.trim().length < 2) { setResults([]); return; } const t = setTimeout(() => void api<Exercise[]>(`/exercises?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([])), 250); return () => clearTimeout(t); }, [q]);
    const openItem = workout?.exercises[open];
    useEffect(() => { const id = openItem?.exercise_id ?? openItem?.cached_exercise_id; if (!id) { setPrevious(null); return; } void api<ExerciseProgress>(`/exercises/${id}/progress?exclude_workout_id=${workout?.id ?? ''}`).then(setPrevious).catch(() => setPrevious(null)); }, [openItem?.exercise_id, openItem?.cached_exercise_id, workout?.id]);
    useEffect(() => { if (!workout?.id || editing) return; const t = setTimeout(() => void api(`/workouts/${workout.id}`, { method: 'PATCH', body: JSON.stringify(workout) }), 800); return () => clearTimeout(t); }, [workout, editing]);
    if (!workout) return <><Head action={<button className="primary" onClick={() => void startAdHoc()}>Start empty <b>＋</b></button>}><p className="overline">LOG WORKOUT</p><h1>What are you<br /><em>training today?</em></h1><p>Start from a routine, resume a saved session, or log freely.</p></Head>{active.length > 0 && <section className="active-sessions"><p className="overline">READY TO RESUME</p>{active.map(x => <button key={x.id} onClick={() => { setWorkout(x); setOpen(0); }}><span><b>{x.name}</b><small>Started {x.started_at ? new Date(x.started_at).toLocaleString() : 'earlier'}</small></span><strong>Resume →</strong></button>)}</section>}<section className="routine-picker">{folders.map(f => <div className="picker-folder-group" key={f.id}><b>{f.name}</b>{f.routines.map(r => <button key={r.id} onClick={() => start(r)}><strong>{r.name}</strong><small>{r.exercises.length} exercises · Start workout →</small></button>)}</div>)}</section>{!folders.length && <div className="empty">No routine required — use “Start empty” to add exercises as you go.</div>}</>;
    const change = (i: number, j: number, field: 'weight' | 'reps' | 'exertion', value: number) => setWorkout({ ...workout, exercises: workout.exercises.map((item, a) => a !== i ? item : { ...item, sets: item.sets?.map((set, b) => b !== j ? set : { ...set, [field]: value }) }) });
    const addExercise = (x: Exercise) => { setWorkout({ ...workout, exercises: [...workout.exercises, { exercise_id: x.id, name: x.name, primary_muscle: x.primary_muscle, secondary_muscles: x.secondary_muscles, muscle_group: x.muscle_group, sets: [{ weight: 0, reps: 0 }] }] }); setOpen(workout.exercises.length); setQ(''); setResults([]); };
    const remaining = restUntil ? Math.max(0, Math.ceil((restUntil - now) / 1000)) : 0;
    return <><Head action={<button className="primary" onClick={() => void (editing ? saveEdit(workout) : finish(workout))}>{editing ? 'Save changes' : 'Finish workout ✓'}</button>}><p className="overline">{editing ? 'EDIT COMPLETED SESSION' : `ACTIVE SESSION · started ${workout.started_at ? new Date(workout.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now'}`}</p><input className="session-name" value={workout.name} onChange={e => setWorkout({ ...workout, name: e.target.value })}/></Head>{restUntil && <div className="rest-timer" role="timer"><span>REST</span><b>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</b><button onClick={() => setRestUntil(null)}>Skip</button></div>}<section className="logger">{workout.exercises.map((item, i) => <article className={`log-exercise ${open === i ? 'open' : ''}`} key={`${item.name}-${i}`}><button className="exercise-tab" onClick={() => setOpen(i)}><span><b>{i + 1}</b><strong>{item.name}</strong><small>{item.primary_muscle ?? 'Unmapped muscle'}</small></span><i>{open === i ? '−' : '+'}</i></button>{open === i && <div className="exercise-body">{previous?.sessions[0] && <div className="previous-performance"><span>LAST TIME · {previous.sessions[0].performed_on}</span><b>{previous.sessions[0].sets.map(s => `${s.weight} kg × ${s.reps}`).join(' · ')}</b><small>Best: {previous.personal_best_weight} kg · est. 1RM {previous.personal_best_1rm.toFixed(1)} kg</small></div>}<div className="setlabels"><span>SET</span><span>KG</span><span>REPS</span><span>RPE</span><span /></div>{item.sets?.map((set, j) => <div className="set" key={j}><span>{j + 1}</span><input value={set.weight || ''} inputMode="decimal" onChange={e => change(i, j, 'weight', +e.target.value)} placeholder="0"/><input value={set.reps || ''} inputMode="numeric" onChange={e => change(i, j, 'reps', +e.target.value)} placeholder="0"/><input value={set.exertion ?? ''} inputMode="decimal" onChange={e => change(i, j, 'exertion', +e.target.value)} placeholder="RPE"/><button className="remove-set" onClick={() => setWorkout({ ...workout, exercises: workout.exercises.map((x, a) => a === i ? { ...x, sets: x.sets?.filter((_, b) => b !== j) } : x) })}>×</button></div>)}<div className="logger-actions"><button className="addset" onClick={() => setWorkout({ ...workout, exercises: workout.exercises.map((x, a) => a === i ? { ...x, sets: [...(x.sets ?? []), { weight: 0, reps: 0 }] } : x) })}>＋ Add set</button><button className="rest-button" onClick={() => setRestUntil(Date.now() + 90_000)}>Rest 1:30</button></div><details className="exercise-note" open={Boolean(item.note)}><summary>OPTIONAL NOTE</summary><textarea value={item.note ?? ''} onChange={e => setWorkout({ ...workout, exercises: workout.exercises.map((x, a) => a === i ? { ...x, note: e.target.value } : x) })}/></details></div>}</article>)}<div className="addexercise"><p>ADD AN EXTRA EXERCISE</p><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search for an exercise"/>{results.map(x => <button key={x.id} onClick={() => addExercise(x)}><span>{x.name}<small>{x.primary_muscle} · {x.equipment}</small></span>＋</button>)}</div></section></>;
}
export function LegacyLogger({ workout, folders, start, setWorkout, finish }: {
    workout: Workout | null;
    folders: Folder[];
    start: (r: Routine) => void;
    setWorkout: (x: Workout) => void;
    finish: (x: Workout) => Promise<void>;
}) {
    const [q, setQ] = useState(''), [results, setResults] = useState<Exercise[]>([]), [replacing, setReplacing] = useState<number | null>(null), [open, setOpen] = useState(0), [openFolder, setOpenFolder] = useState<number | null>(null);
    useEffect(() => { if (q.trim().length < 2) {
        setResults([]);
        return;
    } const t = setTimeout(() => void api<Exercise[]>(`/exercises?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([])), 350); return () => clearTimeout(t); }, [q]);
    if (!workout)
        return <><Head><p className="overline">LOG WORKOUT</p><h1>What are you<br /><em>training today?</em></h1><p>Choose a folder, then the workout day you want to start.</p></Head><section className="routine-picker">{folders.map(f => <div className={`picker-folder-group ${openFolder === f.id ? 'open' : ''}`} key={f.id}><button type="button" className="picker-folder-toggle" onClick={() => setOpenFolder(openFolder === f.id ? null : f.id)} aria-expanded={openFolder === f.id}><span><b>{f.name}</b><small>{f.routines.length} workout {f.routines.length === 1 ? 'day' : 'days'}</small></span><i>{openFolder === f.id ? '−' : '+'}</i></button>{openFolder === f.id && <div className="picker-routines">{f.routines.map(r => <button key={r.id} onClick={() => start(r)}><strong>{r.name}</strong><small>{r.exercises.length} exercises · Start workout →</small></button>)}</div>}{openFolder === f.id && !f.routines.length && <p className="picker-empty">No workout days in this folder yet.</p>}</div>)}</section>{!folders.length && <div className="empty">Create a routine folder and a workout day before logging your first session.</div>}</>;
    const update = (i: number, j: number, k: 'weight' | 'reps' | 'exertion', v: number) => setWorkout({ ...workout, exercises: workout.exercises.map((x, a) => a === i ? { ...x, sets: x.sets?.map((s, b) => b === j ? { ...s, [k]: v } : s) } : x) });
    const addOrReplace = (x: Exercise) => { const item: Item = { exercise_id: x.id, name: x.name, primary_muscle: x.primary_muscle, secondary_muscles: x.secondary_muscles, muscle_group: x.muscle_group, sets: replacing === null ? [{ weight: 0, reps: 0 }] : workout.exercises[replacing].sets }; setWorkout({ ...workout, exercises: replacing === null ? [...workout.exercises, item] : workout.exercises.map((old, i) => i === replacing ? { ...item, planned: old.planned, note: old.note } : old) }); if (replacing !== null)
        setOpen(replacing); setReplacing(null); setQ(''); setResults([]); };
    const resetExercise = (i: number) => setWorkout({ ...workout, exercises: workout.exercises.map((x, j) => j === i && x.planned ? { ...x, ...x.planned, sets: x.sets, note: x.note } : x) });
    return <><Head action={<button className="primary" onClick={() => void finish(workout)}>Finish workout ✓</button>}><p className="overline">ACTIVE SESSION · started {workout.started_at ? new Date(workout.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now'}</p><input className="session-name" value={workout.name} onChange={e => setWorkout({ ...workout, name: e.target.value })}/></Head><section className="logger">{workout.exercises.map((x, i) => <article className={`log-exercise ${open === i ? 'open' : ''}`} key={i}><button className="exercise-tab" onClick={() => { if (open !== i) setOpen(i); }}><span><b>{i + 1}</b><strong>{x.name}</strong><small>{x.primary_muscle ?? 'Unmapped muscle'}</small></span><i>{open === i ? '−' : '+'}</i></button>{open === i && <div className="exercise-body"><div className="log-head"><p>Log your sets, then open the next exercise when you are ready.</p><div><button onClick={() => resetExercise(i)}>Reset edits</button><button onClick={() => { setReplacing(i); setQ(''); setResults([]); }}>Substitute</button></div></div><div className="setlabels"><span>SET</span><span>KG</span><span>REPS</span><span>EXERTION</span><span /></div>{x.sets?.map((s, j) => <div className="set" key={j}><span>{j + 1}</span><input value={s.weight || ''} inputMode="decimal" onChange={e => update(i, j, 'weight', +e.target.value)} placeholder="0"/><input value={s.reps || ''} inputMode="numeric" onChange={e => update(i, j, 'reps', +e.target.value)} placeholder="0"/><input value={s.exertion ?? ''} inputMode="decimal" min="0" max="10" onChange={e => update(i, j, 'exertion', +e.target.value)} placeholder="0–10"/><button className="remove-set" aria-label={`Remove set ${j + 1}`} onClick={() => setWorkout({ ...workout, exercises: workout.exercises.map((a, k) => k === i ? { ...a, sets: a.sets?.filter((_, n) => n !== j) } : a) })}>×</button></div>)}<button className="addset" onClick={() => setWorkout({ ...workout, exercises: workout.exercises.map((a, j) => j === i ? { ...a, sets: [...(a.sets ?? []), { weight: 0, reps: 0 }] } : a) })}>＋ Add set</button><button className="next-exercise" onClick={() => setOpen(Math.min(i + 1, workout.exercises.length - 1))}>Next exercise →</button><details className="exercise-note" open={Boolean(x.note)}><summary>OPTIONAL NOTE</summary><textarea value={x.note ?? ''} onChange={e => setWorkout({ ...workout, exercises: workout.exercises.map((a, j) => j === i ? { ...a, note: e.target.value } : a) })} placeholder="How did this exercise feel?"/></details></div>}</article>)}<div className="addexercise"><p>ADD AN EXTRA EXERCISE</p><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search for an exercise"/>{results.map(x => <button key={x.id} onClick={() => addOrReplace(x)}><span>{x.name}<small>{x.primary_muscle} · {x.equipment}</small></span>＋</button>)}</div></section>{replacing !== null && <div className="back"><div className="modal substitute-modal"><div className="modal-head"><div><p className="overline">SUBSTITUTE EXERCISE</p><h2>Choose today’s replacement</h2></div><button onClick={() => { setReplacing(null); setQ(''); setResults([]); }}>×</button></div><p className="substitute-copy">This changes only this workout. Your saved routine stays the same.</p><label className="add-exercise-label">SEARCH EXERCISES<input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. dumbbell bench press"/></label><div className="search substitute-results">{results.map(x => <button key={x.id} onClick={() => addOrReplace(x)}><span><b>{x.name}</b><small>{x.primary_muscle} · {x.equipment}</small></span>→</button>)}</div></div></div>}</>;
}
type CalendarDay = { date: string; routine_id: number | null; routine_name: string | null; status: 'completed' | 'upcoming' | 'missed' | 'empty'; workout_name: string | null };
type WeeklyPlan = { name: string; starts_on: string; days: { weekday: number; routine_id: number; routine_name: string }[] };
function Calendar({ folders, start }: { folders: Folder[]; start: (routine: Routine) => Promise<void> }) {
    const [editWorkout, setEditWorkout] = useState<Workout | null>(null);
    useEffect(() => {
        const markToday = () => {
            const title = document.querySelector('.workspace h1')?.textContent ?? '';
            const now = new Date();
            if (!title.includes(now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))) return;
            document.querySelectorAll<HTMLElement>('.calendar-day').forEach(day => {
                day.classList.toggle('today', day.querySelector('span')?.textContent === String(now.getDate()));
            });
        };
        markToday();
        const observer = new MutationObserver(markToday);
        observer.observe(document.body, { childList: true, subtree: true });
        const openCompleted = (event: MouseEvent) => { const card = (event.target as HTMLElement).closest<HTMLElement>('.calendar-day.completed'); if (!card) return; const title = document.querySelector('.workspace h1')?.textContent ?? ''; const day = card.querySelector('span')?.textContent; const date = new Date(`${title} ${day ?? ''}`); if (Number.isNaN(date.getTime())) return; const recordedOn = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; void api<Workout[]>('/workouts').then(workouts => { const workout = workouts.find(item => item.completed && item.performed_on === recordedOn); if (workout) setEditWorkout(workout); }); };
        document.addEventListener('click', openCompleted);
        return () => { observer.disconnect(); document.removeEventListener('click', openCompleted); };
    }, []);
    return <><LegacyCalendar folders={folders} start={start}/>{editWorkout && <div className="back calendar-editor"><div className="calendar-editor-panel"><Logger workout={editWorkout} folders={folders} active={[]} start={start} startAdHoc={async () => undefined} setWorkout={setEditWorkout} editing finish={async () => undefined} saveEdit={async workout => { await api(`/workouts/${workout.id}`, { method: 'PATCH', body: JSON.stringify(workout) }); setEditWorkout(null); }}/><button className="calendar-editor-close" onClick={() => setEditWorkout(null)}>×</button></div></div>}</>;
}
function LegacyCalendar({ folders, start }: { folders: Folder[]; start: (routine: Routine) => Promise<void> }) {
    const routines = folders.flatMap(folder => folder.routines), [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1)), [plan, setPlan] = useState<WeeklyPlan | null>(null), [days, setDays] = useState<CalendarDay[]>([]), [editing, setEditing] = useState(false), [name, setName] = useState('My training week'), [assignments, setAssignments] = useState<Record<number, string>>({});
    const load = async () => { const result = await api<{ plan: WeeklyPlan | null; days: CalendarDay[] }>(`/calendar?year=${month.getFullYear()}&month=${month.getMonth() + 1}`); setPlan(result.plan); setDays(result.days); if (result.plan) { setName(result.plan.name); setAssignments(Object.fromEntries(result.plan.days.map(item => [item.weekday, String(item.routine_id)]))); } };
    useEffect(() => { void load(); }, [month]);
    const save = async () => { const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); await api('/calendar/plan', { method: 'POST', body: JSON.stringify({ name, starts_on: monday.toISOString().slice(0, 10), days: Object.entries(assignments).filter(([, value]) => value).map(([weekday, routine_id]) => ({ weekday: Number(weekday), routine_id: Number(routine_id) })) }) }); setEditing(false); await load(); };
    const firstOffset = days.length ? (new Date(`${days[0].date}T12:00:00`).getDay() + 6) % 7 : 0;
    return <><Head action={<button className="primary" onClick={() => setEditing(!editing)}>{editing ? 'Close planner' : 'Plan your week'}</button>}><p className="overline">TRAINING CALENDAR</p><h1>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h1><p>Completed sessions are filled; planned training stays outlined until it is done.</p></Head>{editing && <section className="week-planner"><label>WEEK NAME<input value={name} onChange={event => setName(event.target.value)}/></label><div>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, weekday) => <label key={label}><span>{label}</span><select value={assignments[weekday] ?? ''} onChange={event => setAssignments({ ...assignments, [weekday]: event.target.value })}><option value="">Rest day</option>{routines.map(routine => <option key={routine.id} value={routine.id}>{routine.name}</option>)}</select></label>)}</div><button className="primary" onClick={() => void save()}>Save weekly plan →</button></section>}<section className="calendar-controls"><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>← Previous</button><span>{plan ? plan.name : 'No weekly plan yet'}</span><button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>Next →</button></section><section className="month-grid"><div className="calendar-weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div><div className="calendar-days">{Array.from({ length: firstOffset }).map((_, index) => <i key={`blank-${index}`}/>)}{days.map(day => <article key={day.date} className={`calendar-day ${day.status}`}><span>{Number(day.date.slice(-2))}</span>{day.status !== 'empty' && <div><b>{day.status === 'completed' ? day.workout_name : day.routine_name}</b><small>{day.status === 'completed' ? 'Completed ✓' : day.status === 'missed' ? 'Not completed' : 'Planned'}</small>{day.status === 'upcoming' && day.routine_id && <button onClick={() => { const routine = routines.find(item => item.id === day.routine_id); if (routine) void start(routine); }}>Start</button>}</div>}</article>)}</div></section></>;
}
function History({ data, edit, refresh, note }: { data: Workout[]; edit: (x: Workout) => void; refresh: () => Promise<void>; note: (s: string) => void }) {
    const [selected, setSelected] = useState<Workout | null>(null), [exerciseId, setExerciseId] = useState<number | null>(null), [progress, setProgress] = useState<ExerciseProgress | null>(null);
    useEffect(() => { if (!exerciseId) { setProgress(null); return; } void api<ExerciseProgress>(`/exercises/${exerciseId}/progress`).then(setProgress).catch(() => setProgress(null)); }, [exerciseId]);
    const series = [...(progress?.sessions ?? [])].reverse();
    const max = Math.max(1, ...series.map(x => x.estimated_1rm));
    const points = series.map((x, i) => `${series.length < 2 ? 50 : i / (series.length - 1) * 100},${88 - x.estimated_1rm / max * 68}`).join(' ');
    return <><Head><p className="overline">COMPLETED TRAINING</p><h1>Workout history.</h1><p>Review a session, correct it, or inspect your progress exercise by exercise.</p></Head><section className="history">{data.length ? data.map(x => <article key={x.id}><button className="history-main" onClick={() => { setSelected(selected?.id === x.id ? null : x); setExerciseId(null); }}><span>{x.performed_on}</span><h2>{x.name}</h2><p>{x.exercises.length} exercises · {x.exercises.reduce((a, e) => a + (e.sets ?? []).reduce((b, s) => b + s.weight * s.reps, 0), 0).toLocaleString()} kg volume · {duration(x.duration_seconds)}</p></button><div className="history-actions"><button onClick={() => edit(x)}>Edit</button><button className="danger" onClick={() => { if (window.confirm(`Delete “${x.name}”?`)) void api(`/workouts/${x.id}`, { method: 'DELETE' }).then(async () => { await refresh(); note('Workout deleted'); }); }}>Delete</button></div>{selected?.id === x.id && <div className="history-detail"><p className="overline">EXERCISE PROGRESS</p>{x.exercises.map((item, i) => { const id = item.exercise_id ?? item.cached_exercise_id; return <button className={`exercise-progress-link ${exerciseId === id ? 'active' : ''}`} key={`${item.name}-${i}`} disabled={!id} onClick={() => setExerciseId(id ?? null)}><span>{item.name}</span><small>{(item.sets ?? []).map(s => `${s.weight}×${s.reps}`).join(' · ')} →</small></button>; })}{progress && <div className="progress-card"><div><span>{progress.exercise.name}</span><b>Best {progress.personal_best_weight} kg</b><small>Estimated 1RM: {progress.personal_best_1rm.toFixed(1)} kg</small></div>{series.length ? <svg className="progress-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Estimated one rep maximum trend"><polyline points={points}/>{series.map((s, i) => <circle key={s.workout_id} cx={series.length < 2 ? 50 : i / (series.length - 1) * 100} cy={88 - s.estimated_1rm / max * 68} r="2"/>)}</svg> : <p>No completed sets for this exercise yet.</p>}<div className="progress-labels"><span>{series[0]?.performed_on}</span><span>{series.at(-1)?.performed_on}</span></div></div>}</div>}</article>) : <div className="empty">No completed workouts yet.</div>}</section></>;
}
export function LegacyHistory({ data }: {
    data: Workout[];
}) { return <><Head><p className="overline">COMPLETED TRAINING</p><h1>Workout history.</h1><p>Your finished sessions, kept intact.</p></Head><section className="history">{data.length ? data.map((x, i) => <article key={i}><span>{x.performed_on}</span><h2>{x.name}</h2><p>{x.exercises.length} exercises · {x.exercises.reduce((a, e) => a + (e.sets ?? []).reduce((b, s) => b + s.weight * s.reps, 0), 0).toLocaleString()} kg volume · {duration(x.duration_seconds)}</p></article>) : <div className="empty">No completed workouts yet.</div>}</section></>; }
