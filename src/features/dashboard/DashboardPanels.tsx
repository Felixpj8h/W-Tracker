import type { Dash } from './types';
import type { Workout } from '../workout/types';
import type { CalendarMonth } from '../calendar/types';
import { useState } from 'react';
import { today, vol, duration } from '../../shared/lib/format';
import { PageHeader } from '../../shared/ui/PageHeader';
import { DashboardIcon } from './DashboardIcon';
import { DashboardGreeting } from './DashboardGreeting';
import { Stat } from './Stat';
import { BodyweightCard } from './BodyweightCard';

export function DashboardPanels({ dash, history, historyLoaded: _historyLoaded, calendar, firstName, log, openCalendar, openHistory, openWorkout, saveWeight }: {
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
        <PageHeader action={<div className="dashboard-head-actions"><button className="primary dashboard-log" onClick={log}>＋ Log workout</button><button className="today-control" type="button"><DashboardIcon name="calendar"/><span><b>Today</b><small>{now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</small></span><DashboardIcon name="chevron"/></button></div>}><h1>Good afternoon, {firstName}</h1><DashboardGreeting dash={dash} history={history} historyLoaded={_historyLoaded} calendar={calendar} firstName={firstName}/></PageHeader>
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
