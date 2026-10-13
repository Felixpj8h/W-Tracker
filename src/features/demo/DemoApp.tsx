import { useEffect, useState } from 'react';
import { Dashboard } from '../dashboard/Dashboard';
import { AnatomyFallback } from '../dashboard/AnatomyFallback';
import { History } from '../history/History';
import { PageHeader } from '../../shared/ui/PageHeader';
import type { Dash, BodyMapMuscle } from '../dashboard/types';
import type { Folder, Routine } from '../routines/types';
import type { Workout } from '../workout/types';
import type { CalendarMonth, CalendarDay } from '../calendar/types';
import { demoApi } from './api';
import './demo.css';

type DemoPage = 'dashboard' | 'routines' | 'calendar' | 'history';
const pages: [DemoPage, string, string][] = [['dashboard', '▦', 'Dashboard'], ['routines', '▤', 'Routines'], ['calendar', '□', 'Calendar'], ['history', '◷', 'History']];
const refuseWrite = async () => { throw new Error('The demo is read only.'); };

function RoutineDetails({ routine }: { routine: Routine }) {
  return <article className="demo-detail"><h2>{routine.name}</h2>{routine.exercises.map((item, i) => <section key={i}>
    <h3>{item.exercise?.name ?? item.name}</h3><p>{item.planned_sets} sets · {item.target_reps_min ?? item.target_reps ?? '—'}–{item.target_reps_max ?? item.target_reps ?? '—'} reps{item.target_weight != null ? ` · ${item.target_weight} kg` : ''} · {item.rest_seconds} s rest</p>
  </section>)}</article>;
}

function WorkoutDetails({ workout }: { workout: Workout }) {
  return <article className="demo-detail"><h2>{workout.name}</h2><p>{workout.performed_on}</p>{workout.exercises.map((item, i) => <section key={i}>
    <h3>{item.name}</h3><p>{item.sets?.map(set => `${set.weight} kg × ${set.reps}`).join(' · ') || 'No sets logged'}</p>
  </section>)}</article>;
}

function DemoBodyMap({ dash }: { dash: Dash | null }) {
  const [view, setView] = useState<'front' | 'back'>('front');
  const [muscles, setMuscles] = useState<BodyMapMuscle[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void demoApi<{ muscles: BodyMapMuscle[] }>('/dashboard/body-map', { signal: controller.signal })
      .then(data => setMuscles(data.muscles)).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const volumes = dash?.volume_by_muscle_group ?? [];
  const peak = Math.max(1, ...volumes.map(group => group.current_week_volume));
  return <article className="demo-detail demo-body-map"><h2>Muscles trained this week</h2><div className="metric-toggle">
    {(['front', 'back'] as const).map(side => <button key={side} aria-pressed={view === side} onClick={() => setView(side)}>{side === 'front' ? 'Front' : 'Back'}</button>)}
  </div><div className="demo-body-figure">{muscles.length ? <><img src={`/body-${view}.svg`} alt=""/>{muscles.filter(m => m.is_front === (view === 'front')).map(m => <img key={m.id} src={m.image_url} alt={m.name} style={{ opacity: .24 + m.intensity * .76 }}/>)}</>
    : <AnatomyFallback view={view} showRegions intensity={group => .15 + .85 * (volumes.find(v => v.name.toLowerCase() === group)?.current_week_volume ?? 0) / peak}/>}</div></article>;
}

export function DemoApp({ exit }: { exit: () => void }) {
  const [page, setPage] = useState<DemoPage>('dashboard');
  const [dark, setDark] = useState(() => localStorage.getItem('workout-theme') !== 'light');
  const [dashboardPage, setDashboardPage] = useState(0);
  const [dash, setDash] = useState<Dash | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [history, setHistory] = useState<Workout[]>([]);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [calendar, setCalendar] = useState<CalendarMonth>();
  const [selectedDay, setSelectedDay] = useState<CalendarDay>();
  const [routine, setRoutine] = useState<Routine>();
  const [workout, setWorkout] = useState<Workout>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => { localStorage.setItem('workout-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setCalendar(undefined); setSelectedDay(undefined);
    const queryMonth = page === 'calendar' ? month : new Date();
    void Promise.all([
      demoApi<Omit<Dash, 'latest_weight' | 'weight_series'>>('/dashboard', { signal: controller.signal }),
      demoApi<Folder[]>('/folders', { signal: controller.signal }),
      demoApi<Workout[]>('/workouts', { signal: controller.signal }),
      demoApi<CalendarMonth>(`/calendar?year=${queryMonth.getFullYear()}&month=${queryMonth.getMonth() + 1}`, { signal: controller.signal }),
    ]).then(([summary, groups, workouts, dates]) => {
      if (controller.signal.aborted) return;
      setDash({ ...summary, latest_weight: null, weight_series: [] }); setFolders(groups); setHistory(workouts); setCalendar(dates);
    }).catch(e => {
      if (!controller.signal.aborted) { setError((e as Error).message); setDash(null); setFolders([]); setHistory([]); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, month, retry]);

  const navigate = (next: DemoPage) => { setRoutine(undefined); setWorkout(undefined); setPage(next); };
  const selectedWorkout = selectedDay ? history.find(w => w.performed_on === selectedDay.date) : undefined;
  const selectedRoutine = selectedDay?.routine_override ?? folders.flatMap(f => f.routines).find(r => r.id === selectedDay?.routine_id);
  return <div className={`app demo-app ${dark ? 'dark' : ''}`}>
    <aside className="sidebar"><div className="brand"><b>W</b><span>workout<br/>tracker</span></div><div className="person"><i>F</i><div><b>Felix’s training</b><small>Public demo</small></div></div>
      <nav className="side-nav">{pages.map(([id, icon, label]) => <button key={id} className={`side-link ${page === id ? 'active' : ''}`} onClick={() => navigate(id)}><i>{icon}</i><span>{label}</span></button>)}</nav>
      <footer><label className="switch"><input type="checkbox" checked={dark} onChange={e => setDark(e.target.checked)}/><span/>Dark mode</label><button onClick={exit}>Exit demo</button></footer></aside>
    <main className="workspace"><div className="demo-banner"><span><b>Live demo · Read only</b><small>Public training data. Changes and personal fields are unavailable.</small></span><div className="demo-banner-actions"><button aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`} onClick={() => setDark(value => !value)}>{dark ? '☼' : '☾'}</button><button onClick={exit}>Exit demo</button></div></div>
      {error ? <div className="error" role="alert">{error} <button onClick={() => setRetry(n => n + 1)}>Retry demo</button></div> : loading ? <p role="status">Loading live training data…</p> : <>
        {page === 'dashboard' && <><Dashboard readOnly dash={dash} history={history} historyLoaded calendar={calendar} firstName="Felix" log={() => undefined} saveWeight={refuseWrite} openCalendar={() => navigate('calendar')} openHistory={() => navigate('history')} openWorkout={setWorkout} targetPage={dashboardPage} onPageChange={setDashboardPage}/><DemoBodyMap dash={dash}/></>}
        {page === 'history' && <History readOnly data={history} edit={() => undefined} refresh={async () => setRetry(n => n + 1)} note={() => undefined}/>}
        {page === 'routines' && <><PageHeader><h1>Routines</h1></PageHeader><div className="demo-folders">{folders.map(folder => <section className="demo-detail" key={folder.id}><h2>{folder.name}</h2>{folder.routines.map(r => <button className="demo-routine" key={r.id} onClick={() => setRoutine(r)}><b>{r.name}</b><span>{r.exercises.length} exercises · View details →</span></button>)}</section>)}{!folders.length && <p>No routines available.</p>}</div></>}
        {page === 'calendar' && <><PageHeader><h1>Training calendar</h1></PageHeader><div className="demo-month"><button aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} disabled={month.getFullYear() === 2000 && month.getMonth() === 0}>←</button><h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><button aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} disabled={month.getFullYear() === 2100 && month.getMonth() === 11}>→</button></div>
          <div className="demo-calendar">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <b key={d}>{d}</b>)}{Array.from({ length: (month.getDay() + 6) % 7 }, (_, i) => <span key={`empty-${i}`}/>)}{calendar?.days.map(day => <button key={day.date} aria-label={`${day.date}: ${day.workout_name ?? day.routine_name ?? 'Rest'}`} aria-pressed={selectedDay?.date === day.date} className={day.status} onClick={() => setSelectedDay(day)}><b>{Number(day.date.slice(-2))}</b><span>{day.workout_name ?? day.routine_name ?? 'Rest'}</span></button>)}</div>
          {selectedDay && (selectedWorkout ? <WorkoutDetails workout={selectedWorkout}/> : selectedRoutine ? <RoutineDetails routine={selectedRoutine}/> : <p>No workout planned for {selectedDay.date}.</p>)}</>}
      </>}
    </main><nav className="mobile demo-mobile" aria-label="Demo pages">{pages.map(([id, icon, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><span aria-hidden="true">{icon}</span><small>{label}</small></button>)}</nav>
    {!error && !loading && (routine || workout) && <div className="back"><section className="demo-dialog" role="dialog" aria-modal="true" aria-label="Training details"><button className="demo-close" aria-label="Close details" onClick={() => { setRoutine(undefined); setWorkout(undefined); }}>×</button>{routine ? <RoutineDetails routine={routine}/> : workout && <WorkoutDetails workout={workout}/>}</section></div>}
  </div>;
}
