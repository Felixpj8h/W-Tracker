import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from '../../app/Sidebar';
import { MobileNavigation } from '../../app/MobileNavigation';
import type { Page } from '../../app/types';
import { Dashboard } from '../dashboard/Dashboard';
import { History } from '../history/History';
import { Routines } from '../routines/Routines';
import { Calendar } from '../calendar/Calendar';
import { WorkoutDetails } from '../calendar/WorkoutDetails';
import type { Dash } from '../dashboard/types';
import type { Folder } from '../routines/types';
import type { Workout } from '../workout/types';
import type { CalendarMonth } from '../calendar/types';
import { demoApi } from './api';
import './demo.css';

const refuseWrite = async () => { throw new Error('The demo is read only.'); };
const profile = { email: '', name: 'Felix', firstName: 'Felix' };
const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

export function DemoApp({ exit }: { exit: () => void }) {
  const [page, setPage] = useState<Page>('dashboard');
  const [dark, setDark] = useState(() => localStorage.getItem('workout-theme') !== 'light');
  const [dashboardPage, setDashboardPage] = useState(0);
  const [dash, setDash] = useState<Dash | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [history, setHistory] = useState<Workout[]>([]);
  const [months, setMonths] = useState<Record<string, CalendarMonth>>({});
  const [workout, setWorkout] = useState<Workout>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const now = new Date();
  const currentMonth = monthKey(now.getFullYear(), now.getMonth() + 1);
  const refresh = async () => { setRetry(value => value + 1); };
  const loadMonth = useCallback(async (year: number, month: number) => {
    try {
      const data = await demoApi<CalendarMonth>(`/calendar?year=${year}&month=${month}`);
      setMonths(current => ({ ...current, [monthKey(year, month)]: data }));
      return data;
    } catch (failure) {
      setError((failure as Error).message);
      return undefined;
    }
  }, []);

  useEffect(() => { localStorage.setItem('workout-theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => {
    const controller = new AbortController();
    const date = new Date();
    setLoading(true); setError(''); setWorkout(undefined);
    void Promise.all([
      demoApi<Dash>('/dashboard', { signal: controller.signal }),
      demoApi<Folder[]>('/folders', { signal: controller.signal }),
      demoApi<Workout[]>('/workouts', { signal: controller.signal }),
      demoApi<CalendarMonth>(`/calendar?year=${date.getFullYear()}&month=${date.getMonth() + 1}`, { signal: controller.signal }),
    ]).then(([summary, groups, workouts, calendar]) => {
      if (controller.signal.aborted) return;
      setDash(summary);
      setFolders(groups); setHistory(workouts);
      setMonths({ [monthKey(date.getFullYear(), date.getMonth() + 1)]: calendar });
    }).catch(failure => {
      if (!controller.signal.aborted) { setError((failure as Error).message); setDash(null); setFolders([]); setHistory([]); setMonths({}); }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, retry]);

  const navigate = (next: Page) => { if (next === 'workout' || next === 'coach') return; setWorkout(undefined); setPage(next); };
  return <div className={`app demo-app ${dark ? 'dark' : ''}`}>
    <Sidebar readOnly page={page} setPage={navigate} dark={dark} setDark={setDark} user={profile} exitDemo={exit}/>
    <main className="workspace">
      {error ? <div className="error" role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Retry demo</button></div> : loading ? <p role="status">Loading live training data…</p> : <>
        {page === 'dashboard' && <Dashboard readOnly dash={dash} history={history} historyLoaded calendar={months[currentMonth]} firstName="Felix" log={() => undefined} saveWeight={refuseWrite} openCalendar={() => navigate('calendar')} openHistory={() => navigate('history')} openWorkout={setWorkout} targetPage={dashboardPage} onPageChange={setDashboardPage}/>}
        {page === 'routines' && <Routines readOnly folders={folders} refresh={refresh} start={() => undefined} note={() => undefined}/>}
        {page === 'calendar' && <Calendar readOnly folders={folders} history={history} months={months} loadMonth={loadMonth} onWorkoutSaved={refuseWrite} start={refuseWrite} repeatWorkout={refuseWrite}/>}
        {page === 'history' && <History readOnly data={history} edit={() => undefined} refresh={refresh} repeat={refuseWrite} note={() => undefined}/>}
      </>}
    </main>
    <MobileNavigation readOnly exitDemo={exit} page={page} setPage={navigate} dashboardPage={dashboardPage} setDashboardPage={setDashboardPage} dark={dark} setDark={setDark} logWorkout={() => undefined}/>
    {!error && !loading && workout && <WorkoutDetails readOnly workout={workout} close={() => setWorkout(undefined)}/>}
  </div>;
}
