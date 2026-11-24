import type { ReactNode } from 'react';
import { HealthIcon } from '../health/HealthWidgets';
import type { HealthDay, HealthOverview } from '../health/types';
import type { HealthSnapshotState } from './useHealthSnapshot';
import './health-snapshot.css';

type DayField = Exclude<keyof HealthDay, 'date'>;

const count = (value: number | null | undefined) => value == null ? '—' : Math.round(value).toLocaleString();
const hours = (value: number | null | undefined) => {
    if (value == null) return '—';
    const minutes = Math.round(value);
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
const weekday = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
const readings = (days: HealthDay[], field: DayField) => days.flatMap(day => day[field] == null ? [] : [day[field]]);
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const describe = (days: HealthDay[], field: DayField, format: (value: number) => string) =>
    days.map(day => `${weekday(day.date)} ${day[field] == null ? 'no reading' : format(day[field])}`).join(', ');

function Tile({ metric, label, value, unit, visual, note }: {
    metric: 'steps' | 'sleep' | 'activity';
    label: string;
    value: string;
    unit?: string;
    visual: ReactNode;
    note: string;
}) {
    return <div className={`health-snapshot-tile health-snapshot-${metric}`} role="group" aria-label={label}>
        <span className="health-snapshot-label"><HealthIcon name={metric}/><span>{label}</span></span>
        <strong>{value}{unit && value !== '—' && <small>{unit}</small>}</strong>
        <div className="health-snapshot-visual">{visual}</div>
        <small className="health-snapshot-note">{note}</small>
    </div>;
}

/** One bar per day for the last seven days. */
function DayBars({ days, field, label, format }: { days: HealthDay[]; field: DayField; label: string; format: (value: number) => string }) {
    if (!days.some(day => day[field] != null)) return null;
    const max = Math.max(1, ...readings(days, field));
    return <span className="health-snapshot-bars" role="img" aria-label={`${label}: ${describe(days, field, format)}`}>
        {days.map(day => {
            const value = day[field];
            return <i key={day.date} data-empty={value == null || undefined} style={{ height: value == null ? undefined : `${Math.max(10, value / max * 100)}%` }}/>;
        })}
    </span>;
}

/** HRV across the last seven days. Lines join neighbouring days only, so a missing day leaves a gap. */
function Sparkline({ days }: { days: HealthDay[] }) {
    const values = readings(days, 'hrv');
    if (values.length < 2) return <span className="health-snapshot-spark" aria-hidden="true"/>;
    const min = Math.min(...values), range = Math.max(Math.max(...values) - min, 6);
    const points = days.map((day, index) => day.hrv == null ? null : { x: (index + .5) / days.length * 100, y: 84 - (day.hrv - min) / range * 68, date: day.date });
    return <span className="health-snapshot-spark" role="img" aria-label={`HRV by day: ${describe(days, 'hrv', value => `${count(value)} ms`)}`}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {points.map((point, index) => {
                const previous = points[index - 1];
                return point && previous && <line key={point.date} x1={previous.x} y1={previous.y} x2={point.x} y2={point.y} vectorEffect="non-scaling-stroke"/>;
            })}
        </svg>
        {points.map(point => point && <i key={point.date} style={{ left: `${point.x}%`, top: `${point.y}%` }}/>)}
    </span>;
}

function Vital({ label, value, unit }: { label: string; value: number | null; unit: string }) {
    return <div className="health-snapshot-vital">
        <small>{label}</small>
        <strong>{count(value)}{value != null && <small>{unit}</small>}</strong>
    </div>;
}

/** Averages over the seven days of the latest sync, the same days the Health page charts. */
function SnapshotBody({ overview }: { overview: HealthOverview }) {
    const days = overview.data?.days ?? [];
    const { activity: activityAccess, sleep: sleepAccess, recovery: recoveryAccess } = overview.permissions;
    const goal = overview.step_goal;

    const stepValues = readings(days, 'steps');
    const steps = average(stepValues);
    const stepPercent = steps == null || !goal ? null : Math.round(steps / goal * 100);
    const goalDays = stepValues.filter(value => value >= goal).length;

    const sleepValues = readings(days, 'sleep_minutes');
    const activityValues = readings(days, 'active_minutes');

    return <>
        <div className="health-snapshot-tiles">
            <Tile metric="steps" label="Avg steps" value={activityAccess ? count(steps) : '—'}
                visual={activityAccess && steps != null && <span className="health-snapshot-meter" data-below-goal={stepPercent != null && stepPercent < 100 || undefined}
                    role="img" aria-label={`Average is ${stepPercent}% of the ${count(goal)} daily step goal`}>
                    <i style={{ width: `${Math.min(100, stepPercent ?? 0)}%` }}/>
                </span>}
                note={!activityAccess ? 'No access' : steps == null ? 'No readings' : `${goalDays}/${stepValues.length} days at goal`}/>
            <Tile metric="sleep" label="Avg sleep" value={sleepAccess ? hours(average(sleepValues)) : '—'}
                visual={sleepAccess && <DayBars days={days} field="sleep_minutes" label="Sleep by night" format={hours}/>}
                note={!sleepAccess ? 'No access' : sleepValues.length ? `Avg of ${sleepValues.length} ${sleepValues.length === 1 ? 'night' : 'nights'}` : 'No readings'}/>
            <Tile metric="activity" label="Avg activity" value={activityAccess ? count(average(activityValues)) : '—'} unit="min"
                visual={activityAccess && <DayBars days={days} field="active_minutes" label="Active minutes by day" format={value => `${count(value)} min`}/>}
                note={!activityAccess ? 'No access' : activityValues.length ? `${hours(activityValues.reduce((sum, value) => sum + value, 0))} total` : 'No readings'}/>
        </div>
        <div className="health-snapshot-recovery" role="group" aria-label="Recovery">
            <span className="health-snapshot-label"><HealthIcon name="recovery"/><span>Recovery</span></span>
            {recoveryAccess ? <>
                <Vital label="HRV avg" value={average(readings(days, 'hrv'))} unit="ms"/>
                <Sparkline days={days}/>
                <Vital label="Resting HR avg" value={average(readings(days, 'resting_hr'))} unit="bpm"/>
            </> : <small className="health-snapshot-note">Grant recovery access in Health</small>}
        </div>
    </>;
}

export function HealthSnapshot({ health, openHealth }: { health: HealthSnapshotState; openHealth: () => void }) {
    const { overview, loading, error, retry } = health;
    const ready = Boolean(overview?.connected && overview.data);
    return <article className="health-snapshot">
        <div className="section-heading"><h2>Health snapshot</h2>{ready && <span>Last 7 days</span>}</div>
        {ready ? <SnapshotBody overview={overview!}/>
            : loading ? <div className="lower-empty" role="status">Loading health…</div>
            : error ? <div className="lower-empty">Could not load health data. <button type="button" onClick={retry}>Retry</button></div>
            : overview?.connected ? <div className="lower-empty">No health data synced yet. <button type="button" onClick={openHealth}>Open Health</button></div>
            : <div className="lower-empty health-snapshot-connect"><span>Connect Google Health to see steps, sleep and recovery here.</span><button type="button" onClick={openHealth}>Connect in Health</button></div>}
    </article>;
}
