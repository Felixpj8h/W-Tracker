import type { Dash } from './types';
import { ProfileAvatar } from '../../shared/ui/ProfileAvatar';
import { JernLogo } from '../../shared/ui/JernLogo';
import type { Workout } from '../workout/types';
import type { CalendarMonth } from '../calendar/types';
import { useState } from 'react';
import { today, vol, duration } from '../../shared/lib/format';
import { PageHeader } from '../../shared/ui/PageHeader';
import { DashboardGreeting } from './DashboardGreeting';
import { Stat } from './Stat';
import { BodyweightCard } from './BodyweightCard';
import { effectiveWeightGoal, weightChangeTone } from './weightGoal';
import type { WeightGoal } from '../settings/useAccountSettings';
import { BodyMap } from './BodyMap';
import { WeekSelector } from './WeekSelector';
import { useWeekData } from './useWeekData';
import { addDays, dateKey, startOfWeek } from './week';

const muscleDisplayName = (name: string) => /pectoralis|^chest$/i.test(name) ? 'Chest' : name;

export function DashboardPanels({ dash, history, historyLoaded, calendar, firstName, profilePicture, log, openCalendar, openHistory, openWorkout, saveWeight, readOnly = false, weightGoal = null, targetWeight = null }: {
    dash: Dash | null;
    history: Workout[];
    historyLoaded: boolean;
    calendar?: CalendarMonth;
    firstName: string;
    profilePicture?: string;
    log: () => void;
    openCalendar: () => void;
    openHistory: () => void;
    openWorkout: (workout: Workout) => void;
    saveWeight: (n: number, recordedOn?: string) => Promise<void>;
    readOnly?: boolean;
    weightGoal?: WeightGoal | null;
    targetWeight?: number | null;
}) {
    const [muscleMetric, setMuscleMetric] = useState<'volume' | 'sets' | 'heatmap'>('volume');
    const todayDate = today();
    const currentWeek = startOfWeek(todayDate);
    const [selectedWeek, setSelectedWeek] = useState(currentWeek);
    const [comparison, setComparison] = useState<'previous' | 'average' | 'custom'>('previous');
    const [compareWeek, setCompareWeek] = useState(addDays(currentWeek, -7));
    const [throughToday, setThroughToday] = useState(false);
    const weekData = useWeekData(dash, calendar, selectedWeek, currentWeek, comparison, compareWeek, throughToday, readOnly);
    const selectedDash = weekData.data;
    const selectedCalendar = weekData.calendar;
    const daysCompared = throughToday && selectedWeek === currentWeek ? ((new Date().getDay() + 6) % 7) + 1 : 7;
    const volumeGroups = selectedDash?.volume_by_muscle_group ?? [];
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
    const apiMuscleSets = selectedDash?.sets_by_muscle ?? [];
    const muscleSets = (selectedDash?.sets_by_muscle ? apiMuscleSets : selectedWeek === currentWeek && comparison === 'previous' && !throughToday ? derivedMuscleSets : [])
        .filter(muscle => muscle.current_week_sets > 0 || muscle.last_week_sets > 0)
        .map(muscle => ({ ...muscle, name: muscleDisplayName(muscle.name) }))
        .reduce<{ name: string; current_week_sets: number; last_week_sets: number }[]>((groups, muscle) => {
            const existing = groups.find(group => group.name === muscle.name);
            if (existing) { existing.current_week_sets += muscle.current_week_sets; existing.last_week_sets += muscle.last_week_sets; }
            else groups.push({ name: muscle.name, current_week_sets: muscle.current_week_sets, last_week_sets: muscle.last_week_sets });
            return groups;
        }, []);
    const completedByDate = (workouts: Workout[]) => workouts.filter(workout => workout.completed).sort((a, b) => b.performed_on.localeCompare(a.performed_on));
    const completedHistory = completedByDate(history);
    const completed = readOnly ? completedByDate(weekData.workouts) : completedHistory;
    const now = new Date(), weekStart = new Date(`${selectedWeek}T00:00:00`);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + daysCompared);
    const thisWeek = completed.filter(workout => { const date = new Date(`${workout.performed_on}T12:00:00`); return date >= weekStart && date < weekEnd; });
    const previousWeekStart = new Date(weekStart); previousWeekStart.setDate(previousWeekStart.getDate() - 7);
    const previousWeekSessions = selectedDash?.previous_sessions ?? completed.filter(workout => { const date = new Date(`${workout.performed_on}T12:00:00`); return date >= previousWeekStart && date < weekStart; }).length;
    const sessionCount = selectedDash?.current_sessions ?? thisWeek.length;
    const lastSevenDays = selectedWeek === currentWeek && sessionCount === 0 ? selectedDash?.last_seven_days : null;
    const recentRows = muscleMetric === 'volume'
        ? lastSevenDays?.volume_by_muscle_group?.map(group => ({ name: group.name, current: group.volume, previous: null }))
        : lastSevenDays?.sets_by_muscle?.map(muscle => ({ name: muscleDisplayName(muscle.name), current: muscle.sets, previous: null }));
    const weeklyRows = muscleMetric === 'volume'
        ? volumeGroups.map(group => ({ name: group.name, current: group.current_week_volume, previous: group.last_week_volume }))
        : muscleSets.map(muscle => ({ name: muscle.name, current: muscle.current_week_sets, previous: muscle.last_week_sets }));
    const rows = recentRows ?? weeklyRows;
    const max = Math.max(1, ...rows.flatMap(row => [row.current, row.previous ?? 0]));
    const sessionChange = sessionCount - previousWeekSessions;
    const previousVolume = selectedDash?.total_previous_volume ?? 0, currentVolume = selectedDash?.total_current_volume ?? 0;
    const volumeChange = previousVolume ? Math.round((currentVolume - previousVolume) / previousVolume * 100) : null;
    const monthWeights = (dash?.weight_series ?? []).filter(entry => { const date = new Date(`${entry.recorded_on}T12:00:00`); return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear(); });
    const weightChange = monthWeights.length > 1 ? monthWeights.at(-1)!.weight - monthWeights[0].weight : null;
    const localToday = dateKey(now);
    const lastWorkout = completedHistory.find(workout => workout.performed_on <= localToday);
    const lastWorkoutDays = lastWorkout ? (Date.parse(localToday) - Date.parse(lastWorkout.performed_on)) / 86_400_000 : null;
    const lastWorkoutLabel = lastWorkoutDays === null ? '—' : lastWorkoutDays === 0 ? 'Today' : lastWorkoutDays === 1 ? 'Yesterday' : `${lastWorkoutDays} days ago`;
    const workoutVolume = (workout: Workout) => workout.exercises.reduce((sum, exercise) => sum + (exercise.sets ?? []).reduce((setSum, set) => setSum + set.weight * set.reps, 0), 0);
    const workoutSets = (workout: Workout) => workout.exercises.reduce((sum, exercise) => sum + (exercise.sets?.length ?? 0), 0);
    const dateParts = (date: string) => { const value = new Date(`${date}T12:00:00`); return { month: value.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(), day: value.toLocaleDateString(undefined, { day: '2-digit' }) }; };
    const weekDays = Array.from({ length: 7 }, (_, index) => { const date = new Date(weekStart); date.setDate(date.getDate() + index); const key = dateKey(date); const plan = selectedCalendar?.days.find(day => day.date === key); const workout = completed.find(entry => entry.performed_on === key); return { date, key, plan, workout }; });
    const plannedSessions = weekDays.filter(day => Boolean(day.plan?.routine_id)).length;
    const completedPlanned = weekDays.filter(day => day.plan?.routine_id && day.workout).length;
    const upcoming = (calendar?.days ?? []).filter(day => day.date >= todayDate && day.status !== 'completed').slice(0, 4);
    const nextWorkout = (calendar?.days ?? []).find(day => day.date >= todayDate && day.status !== 'completed' && Boolean(day.routine_name ?? day.workout_name));
    const relativeDay = (date: string) => date === todayDate ? 'Today' : new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
    return <>
        <section className="dashboard-overview-page">
        <div className="mobile-dashboard-topbar"><JernLogo variant="mobile" /><span><small>Today</small><time>{now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></span><ProfileAvatar firstName={firstName} picture={profilePicture}/></div>
        <PageHeader action={<div className="dashboard-head-actions"><button className="primary dashboard-log" disabled={readOnly} onClick={log}>＋ Log workout</button><WeekSelector week={selectedWeek} currentWeek={currentWeek} comparison={comparison} compareWeek={compareWeek} throughToday={throughToday} onWeek={setSelectedWeek} onComparison={setComparison} onCompareWeek={setCompareWeek} onThroughToday={setThroughToday}/></div>}><h1>Good afternoon, {firstName}</h1><DashboardGreeting dash={dash} history={history} historyLoaded={historyLoaded} calendar={calendar} firstName={firstName}/></PageHeader>
        <div className="dashboard-period-context" aria-live="polite">{weekData.error ? <>{weekData.error} <button onClick={weekData.retry}>Retry</button></> : weekData.loading ? "Loading selected week…" : null}</div>
        <section className="dashboard-metrics" aria-label="Training summary">
            {<Stat icon="scale" label="Current weight" value={dash?.latest_weight ? `${dash.latest_weight.weight.toFixed(1)} kg` : '—'} sub={weightChange === null ? 'Add another entry for a trend' : Math.abs(weightChange) < 0.05 ? 'No change this month' : `${weightChange > 0 ? '↑' : '↓'} ${Math.abs(weightChange).toFixed(1)} kg this month`} tone={weightChangeTone(effectiveWeightGoal(weightGoal, targetWeight, dash?.latest_weight?.weight ?? null), weightChange)}/>}
            {lastSevenDays ? <>
                <Stat icon="volume" label="Volume last 7 days" value={`${vol(lastSevenDays.volume)} kg`}/>
                <Stat icon="session" label="Sessions last 7 days" value={String(lastSevenDays.sessions)}/>
            </> : <>
                <Stat icon="volume" label={selectedWeek === currentWeek ? "Weekly volume" : "Selected week volume"} value={weekData.loading ? "—" : `${vol(currentVolume)} kg`} sub={volumeChange === null ? 'No comparison yet' : volumeChange === 0 ? 'Same as comparison' : `${volumeChange > 0 ? '↑' : '↓'} ${Math.abs(volumeChange)}% vs comparison`}/>
                <Stat icon="session" label={selectedWeek === currentWeek ? "Sessions this week" : "Sessions in selected week"} value={weekData.loading ? "—" : String(sessionCount)} sub={previousWeekSessions || sessionCount ? (sessionChange === 0 ? 'Same as comparison' : `${sessionChange > 0 ? '↑' : '↓'} ${Number(Math.abs(sessionChange).toFixed(2))} vs comparison`) : 'No sessions logged yet'}/>
            </>}
            <Stat icon="clock" label="Last workout" value={lastWorkoutLabel} sub={lastWorkout ? lastWorkout.duration_seconds ? `${workoutSets(lastWorkout)} sets · ${duration(lastWorkout.duration_seconds)}` : `${workoutSets(lastWorkout)} sets` : historyLoaded ? 'Log your first workout' : undefined}/>
        </section>
        <section className="mobile-dashboard-home" aria-label={selectedWeek === currentWeek ? "This week" : "Selected week"}>
            <div className="mobile-card-heading"><h2>{selectedWeek === currentWeek ? "This week" : "Selected week"}</h2><button type="button" onClick={openCalendar}>Calendar →</button></div>
            <div className="mobile-week-days">{weekDays.map(({ date, key, workout }) => <span key={key} className={workout ? 'complete' : key === nextWorkout?.date ? 'next' : ''}><small>{date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)}</small><i>{workout ? '✓' : ''}</i></span>)}</div>
        </section>
        </section>
        <section className="dashboard-analytics">
            <BodyweightCard dash={dash} saveWeight={saveWeight} readOnly={readOnly} weightGoal={weightGoal} targetWeight={targetWeight}/>
            <article className={`dashboard-volume ${muscleMetric === 'sets' ? 'sets-mode' : muscleMetric === 'heatmap' ? 'heatmap-mode' : ''}`}>
                <div className="muscle-card-head">
                    <div>
                        <h2>{muscleMetric === 'heatmap' ? 'Muscle activity' : muscleMetric === 'volume' ? 'Volume by muscle group' : 'Sets by muscle'}</h2>
                        {muscleMetric !== 'heatmap' && recentRows && <p className="muscle-period">Last 7 days</p>}
                    </div>
                    <div className="metric-toggle" role="group" aria-label="Muscle metric">
                        <button className={muscleMetric === 'volume' ? 'active' : ''} aria-pressed={muscleMetric === 'volume'} onClick={() => setMuscleMetric('volume')}>Volume</button>
                        <button className={muscleMetric === 'sets' ? 'active' : ''} aria-pressed={muscleMetric === 'sets'} onClick={() => setMuscleMetric('sets')}>Sets</button>
                        <button className={muscleMetric === 'heatmap' ? 'active' : ''} aria-pressed={muscleMetric === 'heatmap'} onClick={() => setMuscleMetric('heatmap')}>Heatmap</button>
                    </div>
                </div>
                {muscleMetric === 'heatmap' ? <BodyMap readOnly={readOnly} selectedWeek={selectedWeek} throughToday={throughToday && selectedWeek === currentWeek}/>
                    : rows.length ? <div className="muscle-rows" tabIndex={muscleMetric === 'sets' ? 0 : undefined} role={muscleMetric === 'sets' ? 'region' : undefined} aria-label={muscleMetric === 'sets' ? 'Sets by muscle' : undefined}>
                        {(muscleMetric === 'volume' ? rows.slice(0, 7) : rows).map(row => {
                            const change = row.previous ? Math.round((row.current - row.previous) / row.previous * 100) : null;
                            return <div className="muscle-row" key={`${muscleMetric}-${row.name}`}>
                                <b>{row.name}</b>
                                <div><i style={{ width: `${row.current / max * 100}%` }}/></div>
                                <span>{muscleMetric === 'volume' ? `${vol(row.current)} kg` : `${Number(row.current.toFixed(2))} sets`}</span>
                                {row.previous !== null && <small className={change !== null && change < 0 ? 'negative' : ''}>{change === null ? '—' : `${change >= 0 ? '+' : ''}${change}%`}</small>}
                            </div>;
                        })}
                    </div> : <div className="dashboard-empty">
                        <b>{weekData.loading ? "Loading selected week…" : weekData.error ? "Week unavailable" : "No workouts logged in this period"}</b>
                        <span>{readOnly ? "No training volume available." : "Log a workout to start tracking volume by muscle group."}</span>
                        {!readOnly && <button onClick={log}>Log workout</button>}
                    </div>}
            </article>
        </section>
        <section className="dashboard-lower"><h1 className="mobile-swipe-title">Activity</h1>
            <article className="recent-workouts"><div className="section-heading"><h2>Workouts in selected week</h2>{completed.length ? <button type="button" onClick={openHistory}>View all →</button> : null}</div>{thisWeek.length ? thisWeek.slice(0, 3).map(workout => { const date = dateParts(workout.performed_on); return <button type="button" className="recent-row" onClick={() => openWorkout(workout)} key={workout.id ?? `${workout.performed_on}-${workout.name}`}><time><small>{date.month}</small><strong>{date.day}</strong></time><span className="recent-row-copy"><b>{workout.name}</b><small>{[...new Set(workout.exercises.map(exercise => (exercise.primary_muscle ?? exercise.muscle_group ?? '').replace(/^Primary:\s*/i, '').split(' · ')[0]).filter(Boolean))].slice(0, 3).join(' · ') || 'Workout session'}</small></span><span>{workoutSets(workout)} sets · {duration(workout.duration_seconds)} · {vol(workoutVolume(workout))} kg</span><i aria-hidden="true">›</i></button>; }) : <div className="lower-empty">{readOnly && weekData.error ? <>Could not load workouts. <button onClick={weekData.retry}>Retry workouts</button></> : 'No completed workouts in this period.'}</div>}</article>
            <article className="week-overview"><div className="section-heading"><h2>{selectedWeek === currentWeek ? "This week" : "Selected week"}</h2><span>{plannedSessions ? `${completedPlanned} of ${plannedSessions} workouts completed` : `${sessionCount} sessions`}</span></div>{weekDays.map(({ date, key, plan, workout }) => <div className="week-row" key={key}><span>{date.toLocaleDateString(undefined, { weekday: 'short' })}</span><b>{workout?.name ?? plan?.routine_name ?? plan?.workout_name ?? 'Rest'}</b>{(workout || plan?.status === 'completed') && <i aria-label="Completed">✓</i>}</div>)}</article>
            <article className="upcoming-workouts"><div className="section-heading"><h2>Upcoming</h2><button type="button" onClick={openCalendar}>View calendar →</button></div>{upcoming.length ? upcoming.map(day => <div className="upcoming-row" key={day.date}><time>{relativeDay(day.date)}</time><i className="upcoming-status" aria-hidden="true"/><b>{day.routine_name ?? day.workout_name ?? 'Rest day'}</b><i aria-hidden="true">⋮</i></div>) : <div className="lower-empty">No upcoming sessions planned.</div>}</article>
        </section>
    </>;
}
