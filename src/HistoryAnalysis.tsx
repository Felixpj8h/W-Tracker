import { useEffect, useRef, useState } from 'react';
import './history-analysis.css';

type LoggedWorkout = {
  id?: number;
  performed_on: string;
  exercises: {
    exercise_id?: number;
    cached_exercise_id?: number;
    name: string;
    sets?: { weight: number; reps: number }[];
  }[];
};

type Series = { key: string; name: string; color: string; points: { id: string; date: string; value: number }[] };
type Range = '1M' | '3M' | '6M' | '1Y' | 'All';
const seriesColors = ['#9aca9f', '#80b9df', '#e5b781'];
const rangeDays: Record<Range, number> = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, All: Infinity };
const dayTime = (date: string) => new Date(`${date}T12:00:00`).getTime();
const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const longDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const exerciseKey = (exercise: LoggedWorkout['exercises'][number]) => String(exercise.exercise_id ?? exercise.cached_exercise_id ?? exercise.name.trim().toLocaleLowerCase());
const volume = (sets: LoggedWorkout['exercises'][number]['sets']) => (sets ?? []).reduce((total, set) => total + set.weight * set.reps, 0);
const formatVolume = (value: number) => `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;

function niceStep(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value || 1));
  const normalized = value / magnitude;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 4 ? 4 : normalized <= 5 ? 5 : 10) * magnitude;
}

export function HistoryAnalysis({ completed }: { completed: LoggedWorkout[] }) {
  const [range, setRange] = useState<Range>('All');
  const [selected, setSelected] = useState<{ key: string; color: string }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [hovered, setHovered] = useState<{ date: string; id: string; key: string; value: number } | null>(null);
  const initialized = useRef(false);
  const ordered = [...completed].sort((a, b) => a.performed_on.localeCompare(b.performed_on) || (a.id ?? 0) - (b.id ?? 0));
  const exerciseCounts = new Map<string, { name: string; count: number }>();
  for (const workout of ordered) for (const exercise of workout.exercises) {
    const key = exerciseKey(exercise);
    const current = exerciseCounts.get(key);
    exerciseCounts.set(key, { name: exercise.name, count: (current?.count ?? 0) + 1 });
  }
  const options = [...exerciseCounts].map(([key, item]) => ({ key, ...item })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  useEffect(() => {
    if (!initialized.current && options.length) {
      initialized.current = true;
      setSelected(options.slice(0, 3).map((option, index) => ({ key: option.key, color: seriesColors[index] })));
    }
  }, [options]);

  const latestTime = dayTime(ordered.at(-1)?.performed_on ?? new Date().toISOString().slice(0, 10));
  const firstTime = dayTime(ordered[0]?.performed_on ?? new Date().toISOString().slice(0, 10));
  const startTime = range === 'All' ? firstTime : latestTime - (rangeDays[range] - 1) * 86400000;
  const series: Series[] = selected.map(item => ({
    ...item,
    name: exerciseCounts.get(item.key)?.name ?? 'Exercise',
    points: ordered.flatMap((workout, index) => {
      if (dayTime(workout.performed_on) < startTime) return [];
      const matching = workout.exercises.filter(exercise => exerciseKey(exercise) === item.key);
      return matching.length ? [{ id: String(workout.id ?? index), date: workout.performed_on, value: matching.reduce((total, exercise) => total + volume(exercise.sets), 0) }] : [];
    }),
  }));
  const allPoints = series.flatMap(item => item.points);
  const values = allPoints.map(point => point.value);
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;
  const step = niceStep(Math.max((maxValue - minValue) / 6, maxValue / 24, 1));
  const lowerBound = Math.floor(minValue / step) * step;
  const upperBound = Math.ceil(maxValue / step) * step;
  const axisMin = Math.max(0, lowerBound === minValue ? lowerBound - step : lowerBound);
  const axisMax = upperBound === maxValue ? upperBound + step : upperBound;
  const axisSpan = axisMax - axisMin || 1;
  const yTicks = Array.from({ length: Math.round(axisSpan / step) + 1 }, (_, index) => axisMin + index * step);
  const plotX = (date: string) => startTime === latestTime ? 50 : 2 + (dayTime(date) - startTime) / (latestTime - startTime) * 96;
  const plotY = (value: number) => 90 - (value - axisMin) / axisSpan * 78;
  const xTicks = Array.from({ length: 5 }, (_, index) => new Date(startTime + (latestTime - startTime) * index / 4).toISOString().slice(0, 10));
  const hoveredRows = hovered ? series.flatMap(item => item.points.filter(point => point.date === hovered.date).map(point => ({ ...point, name: item.name, color: item.color }))) : [];
  const addExercise = (key: string) => {
    setSelected(current => {
      if (current.length >= 3 || current.some(item => item.key === key)) return current;
      const color = seriesColors.find(candidate => !current.some(item => item.color === candidate)) ?? seriesColors[0];
      return [...current, { key, color }];
    });
    setPickerOpen(false);
    setSearch('');
  };

  return <section className="history-analysis" aria-label="Exercise analysis">
    <div className="analysis-toolbar">
      <h2>Exercise volume</h2>
      <div className="weight-ranges" role="group" aria-label="Exercise analysis timeframe">{(['1M', '3M', '6M', '1Y', 'All'] as const).map(option => <button type="button" className={range === option ? 'active' : ''} aria-pressed={range === option} onClick={() => { setRange(option); setHovered(null); }} key={option}>{option}</button>)}</div>
      <select aria-label="Analysis metric" value="volume" onChange={() => undefined}><option value="volume">Volume</option></select>
    </div>
    <div className="analysis-compare">
      <span>Compare exercises</span>
      <div className="analysis-chips">{selected.map(item => <div className="analysis-chip" key={item.key}><i style={{ backgroundColor: item.color }}/><span>{exerciseCounts.get(item.key)?.name ?? 'Exercise'}</span><button type="button" aria-label={`Remove ${exerciseCounts.get(item.key)?.name ?? 'exercise'}`} onClick={() => { setSelected(current => current.filter(value => value.key !== item.key)); setHovered(null); }}>×</button></div>)}
        {selected.length < 3 && <div className="analysis-add-wrap"><button type="button" className="analysis-add" aria-expanded={pickerOpen} onClick={() => setPickerOpen(value => !value)}>＋ Add</button>{pickerOpen && <div className="analysis-options"><input autoFocus aria-label="Search exercises" placeholder="Search exercises" value={search} onChange={event => setSearch(event.target.value)}/><div>{options.filter(option => !selected.some(item => item.key === option.key) && option.name.toLowerCase().includes(search.toLowerCase())).map(option => <button type="button" key={option.key} onClick={() => addExercise(option.key)}>{option.name}<small>{option.count} sessions</small></button>)}</div></div>}</div>}
      </div>
      <small>{selected.length} / 3 selected</small>
    </div>
    {selected.length === 0 ? <div className="analysis-empty">Select up to 3 exercises to compare.</div> : allPoints.length === 0 ? <div className="analysis-empty">No logged data for this period.</div> : <>
      <div className="analysis-chart" aria-label="Exercise volume by workout" onPointerLeave={() => setHovered(null)}>
        <div className="analysis-y-axis">{yTicks.map(value => <span key={value} style={{ top: `${plotY(value)}%` }}>{formatVolume(value)}</span>)}</div>
        <div className="analysis-plot">
          <svg viewBox="0 0 1000 320" preserveAspectRatio="none" aria-hidden="true">
            <g className="weight-grid">{yTicks.map(value => <line key={value} x1="20" x2="980" y1={plotY(value) * 3.2} y2={plotY(value) * 3.2}/>)}{xTicks.map((date, index) => <line key={index} x1={plotX(date) * 10} x2={plotX(date) * 10} y1="32" y2="288"/>)}</g>
            {series.map(item => <polyline key={item.key} points={item.points.map(point => `${plotX(point.date) * 10},${plotY(point.value) * 3.2}`).join(' ')} style={{ stroke: item.color }}/>) }
            {hovered && <line className="analysis-guide" x1={plotX(hovered.date) * 10} x2={plotX(hovered.date) * 10} y1="32" y2="288"/>}
          </svg>
          {series.flatMap(item => item.points.map(point => <button type="button" key={`${item.key}-${point.id}`} className={`analysis-point ${hovered?.key === item.key && hovered.id === point.id ? 'active' : ''}`} style={{ left: `${plotX(point.date)}%`, top: `${plotY(point.value)}%`, color: item.color }} aria-label={`${item.name}, ${longDate(point.date)}, ${formatVolume(point.value)}`} onPointerEnter={() => setHovered({ date: point.date, id: point.id, key: item.key, value: point.value })} onFocus={() => setHovered({ date: point.date, id: point.id, key: item.key, value: point.value })} onBlur={() => setHovered(null)} onClick={() => setHovered({ date: point.date, id: point.id, key: item.key, value: point.value })}/>))}
          {hovered && <div className={`analysis-tooltip ${plotX(hovered.date) > 70 ? 'align-right' : ''} ${plotY(hovered.value) < 30 ? 'below' : ''}`} style={{ left: `${plotX(hovered.date)}%`, top: `${plotY(hovered.value)}%` }}><span>{longDate(hovered.date)}</span>{hoveredRows.map((row, index) => <div key={`${row.name}-${row.id}-${index}`}><i style={{ backgroundColor: row.color }}/><span>{row.name}</span><b>{formatVolume(row.value)}</b></div>)}</div>}
        </div>
        <div className="analysis-x-axis">{xTicks.map((date, index) => <span key={index}>{shortDate(date)}</span>)}</div>
      </div>
      <div className="analysis-change">
        <div className="analysis-table-head"><h3>Change over period</h3><span>First value</span><span>Last value</span><span>Change</span></div>
        {series.map(item => { const first = item.points[0], last = item.points.at(-1); const change = first && last && item.points.length > 1 && first.value !== 0 ? (last.value - first.value) / first.value * 100 : null; return <div className="analysis-table-row" key={item.key}><span className="analysis-table-name"><i style={{ backgroundColor: item.color }}/>{item.name}</span><span>{first ? formatVolume(first.value) : '—'}</span><span>{last ? formatVolume(last.value) : '—'}</span><span className={change === null ? '' : change > 0 ? 'positive' : change < 0 ? 'negative' : ''}>{change === null ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`}</span></div>; })}
      </div>
    </>}
  </section>;
}
