import { useId } from 'react';
import type { ReactNode } from 'react';
import { useInView } from '../../shared/ui/useInView';
import type { HealthInterval, HealthWorkout, TimedSleep } from './types';

const minutesPerDay = 24 * 60;
const minute = 60_000;
const categories = ['sleep', 'walking', 'workout', 'untracked'] as const;
type Category = (typeof categories)[number];
const labels: Record<Category, string> = { sleep: 'Sleep', walking: 'Walking', workout: 'Workout', untracked: 'Untracked' };
const clockTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const calendarDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const asleepStages = new Set(['ASLEEP', 'LIGHT', 'DEEP', 'REM']);

export function yesterdayKey(today: string) {
  return new Date(Date.parse(today) - minutesPerDay * minute).toISOString().slice(0, 10);
}

function elapsedLabel(value: number) {
  const minutes = Math.round(value);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function buildTimeline(sleep: TimedSleep[], workouts: HealthWorkout[], start: number, end: number) {
  const events = [0, (end - start) / minute].map(time => ({ time, change: 0, category: 'untracked' as Category }));
  function add(interval: HealthInterval, category: Category) {
    const from = Math.max(0, (Date.parse(interval.start ?? '') - start) / minute);
    const to = (Math.min(end, Date.parse(interval.end ?? '')) - start) / minute;
    if (!(from < to)) return;
    events.push({ time: from, change: 1, category }, { time: to, change: -1, category });
  }
  for (const session of sleep) {
    if (session.stages?.length) {
      for (const stage of session.stages) {
        if (asleepStages.has(stage.type)) add(stage, 'sleep');
      }
    } else {
      const span = (Date.parse(session.end ?? '') - Date.parse(session.start ?? '')) / minute;
      if (span > 0 && session.minutes === Math.round(span)) add(session, 'sleep');
    }
  }
  workouts.forEach(interval => add(interval, /^WALK(?:ING)?(?:_|$)/i.test(interval.type) ? 'walking' : 'workout'));
  events.sort((a, b) => a.time - b.time);

  const active = { sleep: 0, walking: 0, workout: 0, untracked: 0 };
  const segments: { from: number; to: number; category: Category }[] = [];
  let from = 0;
  for (const { time, change, category } of events) {
    if (time > from) {
      const current = active.workout ? 'workout' : active.walking ? 'walking' : active.sleep ? 'sleep' : 'untracked';
      const previous = segments.at(-1);
      if (previous?.category === current) previous.to = time;
      else segments.push({ from, to: time, category: current });
    }
    active[category] += change;
    from = time;
  }
  return segments;
}

function clockSpans(start: Date, end: Date) {
  const length = (end.getTime() - start.getTime()) / minute;
  const initialOffset = start.getTimezoneOffset();
  const shift = initialOffset - new Date(end.getTime() - 1).getTimezoneOffset();
  if (shift === 0) return [{ from: 0, to: length, shift: 0 }];

  // Leave skipped wall-clock time blank and draw the repeated hour in the same place.
  let low = 0;
  let high = length;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (new Date(start.getTime() + middle * minute).getTimezoneOffset() === initialOffset) low = middle;
    else high = middle;
  }
  return [{ from: 0, to: high, shift: 0 }, { from: high, to: length, shift }];
}

export function ActivityClock({ today, sleep, workouts, mobile, summary }: {
  today: string;
  sleep: TimedSleep[];
  workouts: HealthWorkout[];
  mobile: boolean;
  summary?: ReactNode;
}) {
  const maskId = useId();
  const [ref, visible] = useInView<SVGSVGElement>();
  const end = new Date(`${today}T00:00:00`);
  const start = new Date(`${yesterdayKey(today)}T00:00:00`);
  const yesterday = calendarDate.format(start);
  const segments = buildTimeline(sleep, workouts, start.getTime(), end.getTime());
  const totals = { sleep: 0, walking: 0, workout: 0, untracked: 0 };
  for (const { from, to, category } of segments) totals[category] += to - from;
  const recorded = categories.filter(category => category !== 'untracked' && totals[category] > 0);
  const tracked = segments.filter(segment => segment.category !== 'untracked');
  const timeAt = (elapsed: number) => {
    const time = start.getTime() + elapsed * minute;
    return time === end.getTime() ? '24:00' : clockTime.format(time);
  };
  const description = tracked.map(({ from, to, category }) => `${labels[category]} ${timeAt(from)} to ${timeAt(to)}`).join(', ');
  const spans = clockSpans(start, end);
  const arcs = tracked.flatMap(segment => spans.flatMap(span => {
    const from = Math.max(segment.from, span.from);
    const to = Math.min(segment.to, span.to);
    return from < to ? [{ ...segment, offset: from + span.shift, length: to - from, key: from }] : [];
  }));

  return <div className="health-activity-clock">
    <svg ref={ref} data-reveal={visible} viewBox={mobile ? '-12 0 252 190' : '0 0 228 190'} role="img" aria-label={`Activity yesterday, ${yesterday}. ${description || 'No timed sessions recorded.'}`}>
      <defs>
        <mask id={maskId}>
          <path className="health-clock-sweep" d="M114 158 A62 62 0 1 1 114 34 A62 62 0 1 1 114 158" pathLength="1"
            strokeDasharray="1" fill="none" stroke="white" strokeWidth="17" />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <circle cx="114" cy="96" r="62" className="health-clock-untracked" />
        {arcs.map(({ offset, length, key, category }) =>
          <circle key={key} cx="114" cy="96" r="62" pathLength={minutesPerDay} className={`health-clock-${category}`}
            strokeDasharray={`${length} ${minutesPerDay}`} strokeDashoffset={-offset} transform="rotate(90 114 96)">
            <title>{labels[category]} · {elapsedLabel(length)}</title>
          </circle>)}
      </g>
      <g className="health-clock-axis" textAnchor="middle" aria-hidden="true">
        <path d="M114 20v5 M114 167v5 M38 96h5 M185 96h5" />
        <text x="114" y="15">12:00</text>
        <text x="196" y="99" textAnchor="start">18:00</text>
        <text x="114" y="183">24:00</text>
        <text x="32" y="99" textAnchor="end">06:00</text>
        <text className="health-clock-title" x="114" y="95">Yesterday</text>
        <text x="114" y="110">{yesterday}</text>
      </g>
    </svg>
    <div className="health-clock-details">
      {summary}
      {recorded.length ? <dl aria-label="Time by activity">
        {[...recorded, 'untracked' as const].map(category => <div key={category}>
          <dt><i className={`health-clock-${category}`} />{labels[category]}</dt><dd>{elapsedLabel(totals[category])}</dd>
        </div>)}
      </dl> : <p className="health-muted">No timed sessions recorded yesterday.</p>}
    </div>
  </div>;
}
