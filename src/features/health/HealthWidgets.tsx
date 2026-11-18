import { useId, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { AnimatedValue } from '../../shared/ui/AnimatedValue';
import { useInView } from '../../shared/ui/useInView';
import { HealthPager, HealthTabs } from './HealthPager';
import { HealthReadingList } from './HealthReadingList';
import { ActivityClock, yesterdayKey } from './ActivityClock';
import { useHealthSwipe } from './useHealthSwipe';
import type { HealthDay, HealthOverview, Sleep } from './types';

const count = (value: number | null | undefined) => value == null ? '—' : Math.round(value).toLocaleString();
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const timeLabel = (date: string) => new Date(date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const weekdayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
const duration = (value: number | null | undefined) => {
  if (value == null) return '—';
  const minutes = Math.round(value);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
const stageDuration = (value: number) => value < 60 ? `${Math.round(value)}m` : duration(value);
const stageColors: Record<string, string> = { DEEP: '#8072d6', LIGHT: '#aaa0e8', REM: '#78b7d6', AWAKE: '#e9b174', ASLEEP: '#aaa0e8', RESTLESS: '#c9bd99' };
const labels = ['Overview', 'Steps', 'Activity', 'Sleep', 'Recovery'] as const;
const mobileQuery = '(max-width: 760px), (max-height: 540px) and (pointer: coarse)';
const getMobile = () => window.matchMedia?.(mobileQuery).matches ?? false;

function subscribeMobile(onChange: () => void) {
  const query = window.matchMedia?.(mobileQuery);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

type Metric = 'steps' | 'activity' | 'sleep' | 'recovery';
type TrendField = Exclude<keyof HealthDay, 'date'>;
type RecoveryField = 'hrv' | 'resting_hr';
const recoveryMetrics = {
  hrv: { label: 'HRV', unit: 'ms' },
  resting_hr: { label: 'Resting heart rate', unit: 'bpm' },
} as const;

export function HealthIcon({ name }: { name: Metric | 'sync' | 'connection' | 'coach' }) {
  const paths = {
    coach: <path d="M12 2c0 6-4 10-10 10 6 0 10 4 10 10 0-6 4-10 10-10-6 0-10-4-10-10Z" />,
    steps: <><path d="M3 18h6v-5h6V8h6"/><path d="M17 4h4v4"/></>,
    activity: <path d="M2 12h5l3-7 4 14 3-7h5"/>,
    sleep: <path d="M20.5 14A8.8 8.8 0 0 1 10 3.5 8.8 8.8 0 1 0 20.5 14Z"/>,
    recovery: <path d="M20.3 5.7a4.8 4.8 0 0 0-6.8 0L12 7.2l-1.5-1.5a4.8 4.8 0 0 0-6.8 6.8L12 21l8.3-8.5a4.8 4.8 0 0 0 0-6.8Z"/>,
    sync: <><path d="M20 4v5h-5M4 20v-5h5"/><path d="M4.8 9a8 8 0 0 1 13.1-3L20 9M4 15l2.1 3a8 8 0 0 0 13.1-3"/></>,
    connection: <><path d="m10 14 4-4"/><path d="m8 16-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m2 8a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-1 1"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

const isShorterSleep = (minutes: number | null, average: number | null) =>
  minutes != null && average != null && Math.round(minutes) < Math.round(average) || undefined;

function Trend({ days, field, label, format = count, isBelowTarget, goal }: {
  days: HealthDay[];
  field: TrendField;
  label: string;
  format?: (value: number | null) => string;
  isBelowTarget?: (value: number) => boolean;
  goal?: number;
}) {
  const [ref, visible] = useInView<HTMLDivElement>();
  if (!days.some(day => day[field] != null)) return <p className="health-muted">No readings in the last seven days.</p>;
  const max = Math.max(1, (goal ?? 0) * 1.12, ...days.map(day => day[field] ?? 0));
  return <div className="health-trend" ref={ref} data-reveal={visible} role="img" aria-label={`${label}${goal == null ? '' : `, goal ${count(goal)}`}: ${days.map(day => `${dateLabel(day.date)} ${format(day[field])}`).join(', ')}`}>
    {days.map((day, index) => <div className={index === days.length - 1 ? 'health-trend-latest' : undefined} key={day.date}
      style={{ '--health-bar-delay': `${index * 35}ms` } as React.CSSProperties}
      data-below-target={day[field] != null && isBelowTarget?.(day[field]) || undefined} title={`${dateLabel(day.date)}: ${format(day[field])}`}>
      <span>{format(day[field])}</span>
      <div className="health-trend-track"><i style={{ height: `${day[field] == null ? 0 : Math.max(2, day[field] / max * 100)}%` }} /></div>
      <small>{weekdayLabel(day.date)}</small>
    </div>)}
    {goal != null && <aside className="health-trend-goal" aria-hidden="true">
      <div className="health-trend-goal-line" style={{ bottom: `${goal / max * 100}%` }}>
        <b>Goal · {count(goal)}</b>
      </div>
    </aside>}
  </div>;
}

function SleepTimeline({ sleep }: { sleep: Sleep }) {
  const [ref, visible] = useInView<HTMLDivElement>();
  if (!sleep.start || !sleep.end || !sleep.stages.length) return <p className="health-muted">Sleep stages are not available for this session.</p>;
  const start = Date.parse(sleep.start);
  const span = Date.parse(sleep.end) - start;
  if (!(span > 0)) return null;
  const totals = new Map<string, number>();
  const segments = sleep.stages.flatMap(stage => {
    const from = Math.max(start, Date.parse(stage.start));
    const to = Math.min(start + span, Date.parse(stage.end));
    if (!(to > from)) return [];
    totals.set(stage.type, (totals.get(stage.type) ?? 0) + (to - from) / 60000);
    return [{ stage, left: (from - start) / span * 100, width: (to - from) / span * 100 }];
  });
  if (!segments.length) return <p className="health-muted">Sleep stages are not available for this session.</p>;

  return <div className="health-timeline">
    <div className="health-stage-track" ref={ref} data-reveal={visible} aria-label="Sleep stage timeline" role="img">
      <div className="health-stage-series">
        {segments.map(({ stage, left, width }, index) => <i key={index} title={`${stage.type}: ${timeLabel(stage.start)}-${timeLabel(stage.end)}`} style={{ left: `${left}%`, width: `${width}%`, background: stageColors[stage.type] ?? 'var(--muted)' }} />)}
      </div>
    </div>
    <div className="health-sleep-times"><span>{timeLabel(sleep.start)}</span><span>{timeLabel(sleep.end)}</span></div>
    <div className="health-stage-key">
      {Array.from(totals, ([type, minutes]) => <div key={type}>
        <span><i style={{ background: stageColors[type] ?? 'var(--muted)' }} />{type.toLowerCase().replaceAll('_', ' ')}</span>
        <strong>{stageDuration(minutes)}</strong>
      </div>)}
    </div>
  </div>;
}

function SleepWeek({ days, average, latest }: { days: HealthDay[]; average: number; latest?: Sleep | null }) {
  const [ref, visible] = useInView<HTMLUListElement>();
  const roundedAverage = Math.round(average);
  const longestNight = Math.max(1, ...days.map(day => day.sleep_minutes ?? 0));
  const change = latest?.minutes == null ? null : Math.round(latest.minutes) - roundedAverage;
  const comparison = (minutes: number) => `${stageDuration(Math.abs(minutes))} ${minutes < 0 ? 'shorter' : 'longer'} than your 7-day average`;

  return <section className="health-sleep-week">
    <header><h3>Last 7 days</h3><small>{duration(average)} average</small></header>
    <ul aria-label="Sleep durations for the last seven days" className="health-sleep-days" ref={ref} data-reveal={visible}
      style={{ '--health-night-count': days.length } as React.CSSProperties}>
      {days.map(day => {
        const minutes = day.sleep_minutes;
        const difference = minutes == null ? null : Math.round(minutes) - roundedAverage;
        return <li key={day.date} data-shorter={isShorterSleep(minutes, average)}
          data-latest={day.date === latest?.date || undefined}
          title={`${dateLabel(day.date)}: ${minutes == null ? 'No reading' : duration(minutes)}`}>
          <time dateTime={day.date}>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</time>
          <strong>{duration(minutes)}</strong>
          <span className="health-sleep-duration-track" aria-hidden="true">
            {minutes != null && <i style={{ width: `${minutes / longestNight * 100}%` }} />}
          </span>
          {difference != null && difference !== 0 && <span className="health-visually-hidden">{comparison(difference)}</span>}
        </li>;
      })}
    </ul>
    {change != null && change !== 0 && <p className="health-sleep-comparison">Latest night was {comparison(change)}.</p>}
  </section>;
}

function MetricCard({ metric, label, date, headerAside, headline, panes, swipePanes }: {
  metric: Metric;
  label: string;
  date?: string;
  headerAside?: ReactNode;
  headline?: ReactNode;
  panes: { label: string; content: ReactNode }[];
  swipePanes?: boolean;
}) {
  return <article className={`health-widget health-${metric}`}>
    <HealthPager
      name={`${label} views`}
      heading={<header className="health-widget-header"><h2>{label}</h2>{date && <small>{date}</small>}{headerAside}</header>}
      headline={headline}
      panes={panes}
      swipePanes={swipePanes}
    />
  </article>;
}

function priorAverage(days: HealthDay[], field: RecoveryField, latest?: HealthDay) {
  const prior = days.filter(day => day[field] != null && day.date !== latest?.date);
  return prior.length < 3 ? null : prior.reduce((sum, day) => sum + (day[field] ?? 0), 0) / prior.length;
}

function RecoveryTrend({ days, field, baseline }: { days: HealthDay[]; field: RecoveryField; baseline: number | null }) {
  const [ref, visible] = useInView<HTMLDivElement>();
  const { label, unit } = recoveryMetrics[field];
  const values = days.flatMap(day => day[field] == null ? [] : [day[field]]);
  if (!values.length) return <p className="health-muted">No {label.toLowerCase()} readings in the last seven days.</p>;

  const min = Math.min(...values, baseline ?? Infinity);
  const max = Math.max(...values, baseline ?? -Infinity);
  const center = (min + max) / 2;
  const range = Math.max(max - min, 10);
  const y = (value: number) => 50 - (value - center) / range * 52;
  const points = days.map((day, index) => {
    const value = day[field];
    return value == null ? null : { x: (index + .5) / days.length * 100, y: y(value), value };
  });
  const description = days.map(day => `${dateLabel(day.date)} ${day[field] == null ? 'no reading' : `${count(day[field])} ${unit}`}`).join(', ');

  return <div className="health-recovery-trend" role="img"
    aria-label={`${label} trend: ${description}${baseline == null ? '' : `. Baseline ${count(baseline)} ${unit}`}`}>
    <div className="health-recovery-legend" aria-hidden="true">
      <span>Last 7 days{baseline == null && ` · ${unit}`}</span>
      {baseline != null && <span className="health-recovery-reference" title="Average of earlier readings">Baseline · {count(baseline)} {unit}</span>}
    </div>
    <div className="health-recovery-plot" ref={ref} data-reveal={visible} aria-hidden="true">
      <div className="health-recovery-series">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          {baseline != null && <line className="health-recovery-reference" x1="0" x2="100" y1={y(baseline)} y2={y(baseline)} vectorEffect="non-scaling-stroke" />}
          {points.map((point, index) => {
            const previous = points[index - 1];
            return point && previous && <line key={days[index].date} x1={previous.x} y1={previous.y} x2={point.x} y2={point.y} vectorEffect="non-scaling-stroke" />;
          })}
        </svg>
        {points.map((point, index) => point && <i key={days[index].date} className="health-recovery-dot"
          style={{ left: `${point.x}%`, top: `${point.y}%` }} />)}
      </div>
      {points.map((point, index) => point && <span className="health-recovery-point" key={days[index].date}
        data-label-below={baseline != null && point.value < baseline || undefined}
        data-latest={index === days.length - 1 || undefined}
        style={{ left: `${point.x}%`, top: `${point.y}%` }} title={`${dateLabel(days[index].date)}: ${count(point.value)} ${unit}`}>
        <span>{count(point.value)}</span>
      </span>)}
    </div>
    <div className="health-recovery-days" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
      {days.map(day => <span key={day.date}>{weekdayLabel(day.date)}</span>)}
    </div>
  </div>;
}

export function HealthWidgets({ overview, today, goal, setGoal, saveGoal, busy }: {
  overview: HealthOverview;
  today: string;
  goal: number;
  setGoal: (value: number) => void;
  saveGoal: () => void;
  busy: boolean;
}) {
  const id = useId();
  const mobile = useSyncExternalStore(subscribeMobile, getMobile);
  const [progressRef, progressVisible] = useInView<HTMLDivElement>();
  const [selected, setSelected] = useState(0);
  const [recoverySelection, setRecoverySelection] = useState<RecoveryField | null>(null);
  const swipe = useHealthSwipe(direction => {
    const next = selected + direction;
    if (!mobile || next < 0 || next >= labels.length) return false;
    setSelected(next);
    return true;
  });
  const days = overview.data?.days ?? [];
  const current = days.find(day => day.date === today);
  const workouts = overview.data?.workouts ?? [];
  const sleep = overview.data?.sleep;
  const sleepIntervals = overview.data?.sleep_intervals;
  const timedSleep = sleepIntervals?.every(session => Array.isArray(session.stages)) ? sleepIntervals : sleep ? [sleep] : [];
  const latestHrv = days.findLast(day => day.hrv != null);
  const latestHr = days.findLast(day => day.resting_hr != null);
  const stepPercent = current?.steps == null ? null : Math.round(current.steps / overview.step_goal * 100);
  const isBelowStepGoal = (steps: number) => steps < overview.step_goal;
  const recordedSteps = days.flatMap(day => day.steps == null ? [] : [day.steps]);
  const averageSteps = recordedSteps.length ? recordedSteps.reduce((sum, steps) => sum + steps, 0) / recordedSteps.length : null;
  const goalDays = recordedSteps.filter(steps => steps >= overview.step_goal).length;
  const hrvAverage = priorAverage(days, 'hrv', latestHrv);
  const hrAverage = priorAverage(days, 'resting_hr', latestHr);
  const recoveryField = recoverySelection ?? (latestHrv || !latestHr ? 'hrv' : 'resting_hr');
  const recoveryVitals = [
    { field: 'hrv', latest: latestHrv, average: hrvAverage },
    { field: 'resting_hr', latest: latestHr, average: hrAverage },
  ] as const;
  const recordedActivity = days.flatMap(day => day.active_minutes == null ? [] : [day.active_minutes]);
  const activeTotal = recordedActivity.reduce((sum, minutes) => sum + minutes, 0);
  const recordedSleep = days.flatMap(day => day.sleep_minutes == null ? [] : [day.sleep_minutes]);
  const averageSleep = recordedSleep.length ? recordedSleep.reduce((sum, minutes) => sum + minutes, 0) / recordedSleep.length : null;
  const summary = [
    { metric: 'steps', label: 'Steps', value: current?.steps, unit: '', note: stepPercent == null ? 'No reading today' : `${stepPercent}% of daily goal` },
    { metric: 'activity', label: 'Activity', value: current?.active_minutes, unit: current?.active_minutes != null ? 'min' : '', note: 'Active minutes today' },
    { metric: 'sleep', label: 'Sleep', value: sleep?.minutes, unit: '', note: sleep ? `Woke ${dateLabel(sleep.date)}` : 'No session' },
    { metric: 'recovery', label: 'Recovery', value: latestHrv?.hrv, unit: latestHrv ? 'ms HRV' : '', note: latestHr ? `Resting HR ${count(latestHr.resting_hr)} bpm` : 'Resting HR unavailable' },
  ] as const;
  const weeklySummary = [
    ['Average steps', averageSteps == null ? null : count(averageSteps)],
    ['Days at step goal', recordedSteps.length ? `${goalDays} of ${recordedSteps.length}` : null],
    ['Total active time', recordedActivity.length ? duration(activeTotal) : null],
    ['Average sleep', averageSleep == null ? null : duration(averageSleep)],
    ['Recorded workouts', workouts.length ? count(workouts.length) : null],
  ];
  const goalForm = <form className="health-goal" onSubmit={event => { event.preventDefault(); saveGoal(); }}>
    <label>Daily step goal<input type="number" required min="1000" max="100000" step="100" value={goal || ''} onChange={event => setGoal(Number(event.target.value))} /></label>
    <button className="secondary" disabled={busy}>Save goal</button>
  </form>;
  const stepsToday = <div className="health-progress" ref={progressRef} data-reveal={progressVisible}>
    <progress max={overview.step_goal} value={current?.steps ?? 0} aria-label="Daily step goal progress"
      data-below-target={current?.steps != null && isBelowStepGoal(current.steps) || undefined} />
    <p className="health-muted">{stepPercent == null
      ? overview.permissions.activity ? 'No steps recorded for today yet.' : 'Grant activity access to see your steps.'
      : <><strong>{stepPercent}%</strong> of {count(overview.step_goal)} step goal</>}</p>
    {!mobile && recordedSteps.length > 0 && <dl className="health-step-insights">
      <div><dt>7-day average</dt><dd>{count(averageSteps)} <small>steps</small></dd></div>
      <div><dt>Days at goal</dt><dd>{goalDays} <small>of {recordedSteps.length} tracked</small></dd></div>
    </dl>}
  </div>;
  const stepsTrend = <Trend days={days} field="steps" label="Daily steps" isBelowTarget={isBelowStepGoal} goal={overview.step_goal} />;
  const activityTrend = overview.permissions.activity
    ? <Trend days={days} field="active_minutes" label="Active minutes" />
    : <p className="health-muted">Grant activity access to see your active minutes.</p>;
  const activityToday = <div className="health-value">
    {mobile ? count(current?.active_minutes) : <AnimatedValue value={current?.active_minutes} once />} <span>active min today</span>
  </div>;
  const yesterdayMinutes = overview.permissions.activity && <div className="health-value health-activity-yesterday">
    {count(days.find(day => day.date === yesterdayKey(today))?.active_minutes)} <span>active min yesterday</span>
  </div>;
  const activityYesterday = <>
    {mobile && yesterdayMinutes}
    {overview.permissions.activity || overview.permissions.sleep
      ? <ActivityClock today={today} sleep={overview.permissions.sleep ? timedSleep : []}
          workouts={overview.permissions.activity ? workouts : []} mobile={mobile}
          summary={mobile ? undefined : yesterdayMinutes} />
      : <p className="health-muted">Grant activity or sleep access to see yesterday's timeline.</p>}
  </>;
  const cards = {
    Overview: <div className="health-overview-page">
      <div className="health-overview">
        {summary.map(({ metric, label, value, unit, note }) => <article className="health-summary" aria-label={label} key={metric}>
          <div className="health-summary-heading"><span className="health-icon"><HealthIcon name={metric} /></span><span>{label}</span></div>
          <strong><AnimatedValue value={value} format={metric === 'sleep' ? duration : undefined} />{unit && <span>{unit}</span>}</strong>
          <small>{note}</small>
        </article>)}
      </div>
      {weeklySummary.some(([, value]) => value != null) && <section className="health-overview-week">
        <h2>Last 7 days</h2>
        <dl>{weeklySummary.map(([label, value]) => value == null ? null : <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </section>}
    </div>,
    Steps: <MetricCard metric="steps" label="Steps" date={dateLabel(today)}
      headline={<div className="health-value"><AnimatedValue value={current?.steps} /> <span>steps today</span></div>}
      panes={mobile ? [{ label: 'Steps', content: <div className="health-mobile-stack">
        {stepsToday}
        <section className="health-mobile-chart"><h3>Last 7 days</h3>{stepsTrend}</section>
        {goalForm}
      </div> }] : [
        { label: 'Today', content: <div className="health-step-today">{stepsToday}</div> },
        { label: '7 days', content: stepsTrend },
        { label: 'Goal', content: goalForm },
      ]}
    />,
    Activity: <MetricCard metric="activity" label="Activity" headerAside={mobile ? activityToday : undefined}
      panes={mobile ? [{ label: 'Activity', content: <div className="health-mobile-stack">
        <section className="health-mobile-chart"><h3>Last 7 days</h3>{activityTrend}</section>
        <section className="health-mobile-chart">{activityYesterday}</section>
      </div> }] : [
        { label: '7 days', content: <div className="health-activity-pane">{activityToday}{activityTrend}</div> },
        { label: 'Yesterday', content: <div className="health-activity-pane">{activityYesterday}</div> },
      ]}
    />,
    Sleep: <MetricCard metric="sleep" label="Sleep" date={sleep ? `Woke ${dateLabel(sleep.date)}` : undefined} swipePanes={!mobile}
      headline={<div className="health-value"><AnimatedValue value={sleep?.minutes} format={duration} /> <span>asleep</span></div>}
      panes={[
        { label: 'Stages', content: <div className="health-sleep-content">
          {sleep ? <SleepTimeline sleep={sleep} /> : <p className="health-muted">{overview.permissions.sleep ? 'No sleep session synced yet.' : 'Grant sleep access to see your nights here.'}</p>}
          {mobile && averageSleep != null && <SleepWeek days={days} average={averageSleep} latest={sleep} />}
        </div> },
        ...(!mobile ? [{ label: '7 days', content: <div className="health-sleep-trend">
          <Trend days={days} field="sleep_minutes" label="Sleep duration by wake date" format={duration}
            isBelowTarget={minutes => Boolean(isShorterSleep(minutes, averageSleep))} />
        </div> }] : []),
        ...(sleep?.stages.length ? [{ label: 'Intervals', content: <HealthReadingList mobile={mobile} className="health-intervals" label="Sleep stage intervals"
          items={sleep.stages.map((stage, index) => <li key={index}><span><i style={{ background: stageColors[stage.type] ?? 'var(--muted)' }} />{stage.type.toLowerCase()}</span><time>{timeLabel(stage.start)}-{timeLabel(stage.end)}</time></li>)} /> }] : []),
      ]}
    />,
    Recovery: <MetricCard metric="recovery" label="Recovery"
      headline={<div className="health-vitals">
        {recoveryVitals.map(({ field, latest }) => {
          const { label, unit } = recoveryMetrics[field];
          const reading = <>
            <span title={field === 'hrv' ? 'Heart rate variability' : undefined}>{label}</span>
            <strong><AnimatedValue value={latest?.[field]} /> <small>{unit}</small></strong>
            <small>{latest ? dateLabel(latest.date) : 'No reading'}</small>
          </>;
          return mobile ? <div key={field}>{reading}</div> : <button key={field} type="button" aria-pressed={recoveryField === field}
            onClick={() => setRecoverySelection(field)}>{reading}</button>;
        })}
      </div>}
      panes={[{ label: 'Last 7 days', content: !overview.permissions.recovery
        ? <p className="health-muted">Grant health metrics access to see your recovery readings.</p>
        : mobile ? <div className="health-mobile-stack">
          {recoveryVitals.map(({ field, average }) => <section className="health-mobile-chart" key={field}>
            <h3>{recoveryMetrics[field].label}</h3>
            <RecoveryTrend days={days} field={field} baseline={average} />
          </section>)}
        </div> : <RecoveryTrend key={recoveryField} days={days} field={recoveryField} baseline={recoveryField === 'hrv' ? hrvAverage : hrAverage} /> }]}
    />,
  };

  return <div className="health-deck" {...(mobile ? swipe : {})}>
    {mobile && <HealthTabs id={id} labels={labels} name="Health widgets" selected={selected} onSelect={setSelected} className="health-mobile-tabs" />}
    <div className="health-deck-window">
      <div className="health-grid" style={{ '--health-slide': `${-selected * 100}%` } as React.CSSProperties}>
        {labels.map((label, index) => index === 0 && !mobile ? null : <div
          className={`health-slide health-slide-${label.toLowerCase()}`}
          key={label}
          id={`${id}-panel-${index}`}
          role={mobile ? 'tabpanel' : undefined}
          aria-labelledby={mobile ? `${id}-tab-${index}` : undefined}
          aria-hidden={mobile && index !== selected || undefined}
          inert={mobile && index !== selected}
        >{cards[label]}</div>)}
      </div>
    </div>
  </div>;
}
