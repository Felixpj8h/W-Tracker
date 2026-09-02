import { useEffect, useState } from 'react';
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
    exercises: Item[];
};
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
type Page = 'dashboard' | 'routines' | 'workout' | 'history';
const API = import.meta.env.VITE_API_URL ?? `${window.location.protocol}//${window.location.hostname}:8000/api/v1`;
const today = () => new Date().toISOString().slice(0, 10);
const fieldValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
async function api<T>(path: string, opts?: RequestInit): Promise<T> { const r = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...opts }); if (!r.ok)
    throw Error('Could not reach the tracker server'); return r.json(); }
const vol = (n: number) => Math.round(n).toLocaleString();
const duration = (seconds?: number | null) => seconds === null || seconds === undefined ? '—' : `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}h ` : ''}${Math.floor(seconds % 3600 / 60)} min`;
export default function App() { const [page, setPage] = useState<Page>('dashboard'), [dash, setDash] = useState<Dash | null>(null), [folders, setFolders] = useState<Folder[]>([]), [history, setHistory] = useState<Workout[]>([]), [workout, setWorkout] = useState<Workout | null>(null), [message, setMessage] = useState(''), [error, setError] = useState(''), [dark, setDark] = useState(() => localStorage.getItem('workout-theme') !== 'light'); const load = async () => { try {
    const [d, f, h] = await Promise.all([api<Dash>('/dashboard'), api<Folder[]>('/folders'), api<Workout[]>('/workouts')]);
    setDash(d);
    setFolders(f);
    setHistory(h);
    setError('');
}
catch (e) {
    setError(e instanceof Error ? e.message : 'Load failed');
} }; useEffect(() => { void load(); }, []); useEffect(() => localStorage.setItem('workout-theme', dark ? 'dark' : 'light'), [dark]); const note = (x: string) => { setMessage(x); setTimeout(() => setMessage(''), 2400); }; const withPlan = (x: Workout): Workout => ({ ...x, exercises: x.exercises.map(e => ({ ...e, planned: { exercise_id: e.exercise_id, cached_exercise_id: e.cached_exercise_id, name: e.name, primary_muscle: e.primary_muscle, secondary_muscles: e.secondary_muscles, muscle_group: e.muscle_group } })) }); const start = async (r: Routine) => { try {
    setWorkout(withPlan(await api<Workout>(`/routines/${r.id}/start`, { method: 'POST' })));
}
catch {
    setWorkout(withPlan({ name: r.name, performed_on: today(), started_at: new Date().toISOString(), exercises: r.exercises.map(x => ({ ...x, name: x.exercise?.name ?? x.name, primary_muscle: x.exercise?.primary_muscle ?? x.primary_muscle, secondary_muscles: x.exercise?.secondary_muscles ?? x.secondary_muscles, muscle_group: x.exercise?.muscle_group ?? x.muscle_group, exercise_id: x.exercise_id ?? x.exercise?.id, sets: Array.from({ length: x.planned_sets ?? 3 }, () => ({ weight: x.target_weight ?? 0, reps: x.target_reps ?? 0 })) })) }));
} setPage('workout'); }; const chooseWorkout = () => { setWorkout(null); setPage('workout'); }; return <div className={`app ${dark ? 'dark' : ''}`}><Side page={page} setPage={p => { if (p === 'workout')
    setWorkout(null); setPage(p); }} dark={dark} setDark={setDark}/><main className="workspace">{error && <div className="error">{error} — start the FastAPI server to save data.</div>}{message && <div className="toast">{message}</div>}{page === 'dashboard' && <Dashboard dash={dash} log={chooseWorkout} saveWeight={async (weight) => { await api('/bodyweight', { method: 'POST', body: JSON.stringify({ recorded_on: today(), weight }) }); await load(); note('Bodyweight saved'); }}/>}{page === 'routines' && <Routines folders={folders} refresh={load} start={start} note={note}/>} {page === 'workout' && <Logger workout={workout} folders={folders} start={start} setWorkout={setWorkout} finish={async (x) => { const completed = await api<Workout>(x.id ? `/workouts/${x.id}` : '/workouts', { method: x.id ? 'PUT' : 'POST', body: JSON.stringify(x) }); await load(); note(`Workout finished · ${duration(completed.duration_seconds)}`); setWorkout(null); setPage('dashboard'); }}/>}{page === 'history' && <History data={history}/>}</main><div className="mobile">{(['dashboard', 'routines', 'workout', 'history'] as Page[]).map(x => <button key={x} onClick={() => { if (x === 'workout')
    setWorkout(null); setPage(x); }}>{x === 'dashboard' ? '⌂' : x === 'routines' ? '▤' : x === 'workout' ? '＋' : '◷'}<small>{x}</small></button>)}</div></div>; }
function Side({ page, setPage, dark, setDark }: {
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
    const current = dash?.total_current_volume ?? 0;
    const previous = dash?.total_previous_volume ?? 0;
    const groups = dash?.volume_by_muscle_group ?? [];
    const leadGroup = [...groups].sort((a, b) => b.current_week_volume - a.current_week_volume)[0];
    const facts = [
        `${current.toLocaleString()} kg of training volume logged this week.`,
        previous > 0 ? `Your training volume is ${Math.abs(Math.round((current - previous) / previous * 100))}% ${current >= previous ? 'higher' : 'lower'} than last week.` : 'Your next completed session will unlock a weekly comparison.',
        dash?.latest_weight ? `Your current tracked weight is ${dash.latest_weight.weight.toFixed(1)} kg.` : 'Add a weigh-in to begin tracking your bodyweight trend.',
        leadGroup ? `${leadGroup.name} is your highest-volume muscle group this week.` : 'Log your first workout to see your muscle-group focus.'
    ];
    const factKey = facts.join('|');
    const [text, setText] = useState('');
    useEffect(() => {
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
    }, [factKey]);
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
}) { return <article><span>{label}</span><strong>{value}</strong><small>{sub}</small></article>; }
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
function Editor({ routine, folders, close, done }: {
    routine: Routine;
    folders: Folder[];
    close: () => void;
    done: () => Promise<void>;
}) { const [name, setName] = useState(routine.name), [folder, setFolder] = useState(String(routine.folder_id ?? folders[0]?.id ?? '')), [items, setItems] = useState(routine.exercises), [q, setQ] = useState(''), [results, setResults] = useState<Exercise[]>([]), [dragging, setDragging] = useState<number | null>(null); useEffect(() => { if (q.trim().length < 2) {
    setResults([]);
    return;
} const t = setTimeout(() => void api<Exercise[]>(`/exercises?q=${encodeURIComponent(q.trim())}`).then(setResults).catch(() => setResults([])), 350); return () => clearTimeout(t); }, [q]); const addExercise = (x: Exercise) => { if (!items.some(i => i.exercise_id === x.id))
    setItems([...items, { exercise_id: x.id, exercise: x, name: x.name, planned_sets: 3, target_reps_min: 8, target_reps_max: 12 }]); setQ(''); setResults([]); }; const update = (index: number, field: 'planned_sets' | 'target_reps_min' | 'target_reps_max', value: string) => { if (value !== '' && !/^\d+$/.test(value))
    return; setItems(items.map((item, i) => i === index ? { ...item, [field]: value === '' ? undefined : Number(value) } : item)); }; const move = (to: number) => { if (dragging === null || dragging === to)
    return; const next = [...items], [picked] = next.splice(dragging, 1); next.splice(to, 0, picked); setItems(next); setDragging(null); }; return <div className="back"><form className="modal routine-editor" onSubmit={async (e) => { e.preventDefault(); await api(routine.id ? `/routines/${routine.id}` : '/routines', { method: routine.id ? 'PUT' : 'POST', body: JSON.stringify({ name, folder_id: +folder, exercises: items.map(x => ({ exercise_id: x.exercise_id, planned_sets: x.planned_sets, target_reps_min: x.target_reps_min ?? x.target_reps, target_reps_max: x.target_reps_max ?? x.target_reps })) }) }); await done(); }}><div className="modal-head"><div><p className="overline">WORKOUT DAY BUILDER</p><h2>{routine.id ? 'Edit workout day' : 'New workout day'}</h2></div><button type="button" onClick={close}>×</button></div><div className="builder-basics"><label>DAY NAME<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Upper"/></label><label>FOLDER<select value={folder} onChange={e => setFolder(e.target.value)}>{folders.map(x => <option value={x.id} key={x.id}>{x.name}</option>)}</select></label></div><label className="add-exercise-label">ADD EXERCISE<input value={q} onChange={e => setQ(e.target.value)} placeholder="Search exercises, e.g. bench press"/></label><div className="search">{results.map(x => <button type="button" key={x.id} onClick={() => addExercise(x)}><span><b>{x.name}</b><small>{x.primary_muscle ?? 'Unmapped'} · {x.equipment}</small></span>＋</button>)}{q.trim().length >= 2 && results.length === 0 && <button type="button" className="custom-exercise" onClick={() => void api<Exercise>('/exercises/custom', { method: 'POST', body: JSON.stringify({ name: q.trim() }) }).then(addExercise)}>Add “{q.trim()}” as a custom exercise <b>＋</b></button>}</div><div className="builder-list"><div className="builder-list-head"><span>EXERCISE</span><span>SETS</span><span>REPS</span><span /></div>{items.map((x, i) => <div className="builder-item" draggable onDragStart={() => setDragging(i)} onDragOver={e => e.preventDefault()} onDrop={() => move(i)} key={`${x.exercise_id}-${i}`}><div><b><span className="drag-handle">⠿</span>{x.exercise?.name ?? x.name}</b><small>{x.exercise?.primary_muscle ?? x.primary_muscle ?? 'Unmapped muscle'}</small></div><label><input aria-label="Sets" type="text" inputMode="numeric" value={fieldValue(x.planned_sets)} onChange={e => update(i, 'planned_sets', e.target.value)}/></label><label className="rep-range"><input aria-label="Minimum reps" type="text" inputMode="numeric" value={fieldValue(x.target_reps_min ?? x.target_reps)} onChange={e => update(i, 'target_reps_min', e.target.value)}/>{fieldValue(x.target_reps_max ?? x.target_reps) !== fieldValue(x.target_reps_min ?? x.target_reps) && <><span>–</span><input aria-label="Maximum reps" type="text" inputMode="numeric" value={fieldValue(x.target_reps_max ?? x.target_reps)} onChange={e => update(i, 'target_reps_max', e.target.value)}/></>}</label><button type="button" aria-label={`Remove ${x.name}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button></div>)}</div><p className="builder-tip">Drag an exercise by its handle to rearrange your workout. Set matching reps for a fixed target, or use different values for a range.</p><button className="primary wide">Save workout day →</button></form></div>; }
function Logger({ workout, folders, start, setWorkout, finish }: {
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
function History({ data }: {
    data: Workout[];
}) { return <><Head><p className="overline">COMPLETED TRAINING</p><h1>Workout history.</h1><p>Your finished sessions, kept intact.</p></Head><section className="history">{data.length ? data.map((x, i) => <article key={i}><span>{x.performed_on}</span><h2>{x.name}</h2><p>{x.exercises.length} exercises · {x.exercises.reduce((a, e) => a + (e.sets ?? []).reduce((b, s) => b + s.weight * s.reps, 0), 0).toLocaleString()} kg volume · {duration(x.duration_seconds)}</p></article>) : <div className="empty">No completed workouts yet.</div>}</section></>; }
