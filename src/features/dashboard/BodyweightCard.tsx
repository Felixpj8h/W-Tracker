import type { Dash } from './types';
import { useState } from 'react';
import { BodyweightChart } from './BodyweightChart';

export function BodyweightCard({ dash, saveWeight }: { dash: Dash | null; saveWeight: (n: number, recordedOn?: string) => Promise<void> }) {
    const [weight, setWeight] = useState('');
    const [addingWeight, setAddingWeight] = useState(false);
    const [range, setRange] = useState<'1M' | '3M' | '6M' | '1Y' | 'All'>('All');
    const entries = dash?.weight_series ?? [];
    const rangeDays = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, All: Infinity }[range];
    const latestDate = entries.at(-1)?.recorded_on ? new Date(`${entries.at(-1)!.recorded_on}T12:00:00`) : new Date();
    const domainEnd = latestDate.getTime();
    const domainStart = rangeDays === Infinity
        ? (entries[0]?.recorded_on ? new Date(`${entries[0].recorded_on}T12:00:00`).getTime() : domainEnd)
        : domainEnd - rangeDays * 86400000;
    const visibleEntries = entries.filter(entry => { const timestamp = new Date(`${entry.recorded_on}T12:00:00`).getTime(); return timestamp >= domainStart && timestamp <= domainEnd; });
    const latest = dash?.latest_weight;
    const formatDate = (date?: string) => date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    return <article className="dashboard-weight"><div className="dashboard-section-head"><div><h2>Bodyweight</h2><p>Your tracked weight over time.</p></div><div className="dashboard-weight-actions"><div className="weight-ranges" role="group" aria-label="Bodyweight timeframe">{(['1M', '3M', '6M', '1Y', 'All'] as const).map(option => <button type="button" className={range === option ? 'active' : ''} onClick={() => setRange(option)} key={option}>{option}</button>)}</div><button className="mobile-add-weight" type="button" onClick={() => setAddingWeight(value => !value)}>＋ Add</button><form className={addingWeight ? 'adding' : ''} onSubmit={event => { event.preventDefault(); if (+weight) void saveWeight(+weight).then(() => { setWeight(''); setAddingWeight(false); }); }}><input aria-label="Bodyweight in kilograms" value={weight} onChange={event => setWeight(event.target.value)} placeholder="kg" inputMode="decimal"/><button>Save</button></form></div></div>{visibleEntries.length === 1 && latest ? <div className="first-weight"><strong>{latest.weight.toFixed(1)} kg</strong><b>First tracked entry</b><span>{formatDate(latest.recorded_on)}</span></div> : <BodyweightChart values={visibleEntries} domainStart={domainStart} domainEnd={domainEnd} saveWeight={saveWeight}/>}</article>;
}
