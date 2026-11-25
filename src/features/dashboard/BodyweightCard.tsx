import { useOutsideDismiss } from '../../shared/ui/useOutsideDismiss';
import type { Dash } from './types';
import { useState, type FormEvent } from 'react';
import { BodyweightChart } from './BodyweightChart';
import { weightGoalSummary } from './weightGoal';
import type { WeightGoal } from '../settings/useAccountSettings';

export function BodyweightCard({ dash, saveWeight, readOnly = false, weightGoal = null, targetWeight = null }: { dash: Dash | null; saveWeight: (n: number, recordedOn?: string) => Promise<void>; readOnly?: boolean; weightGoal?: WeightGoal | null; targetWeight?: number | null }) {
    const [weight, setWeight] = useState('');
    const [savingWeight, setSavingWeight] = useState(false);
    const [weightError, setWeightError] = useState('');
    const [addingWeight, setAddingWeight] = useState(false);
    const addRoot = useOutsideDismiss<HTMLDivElement>(addingWeight, () => { if (!savingWeight) setAddingWeight(false); });
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
    const goal = weightGoalSummary(weightGoal, targetWeight, latest?.weight ?? null);
    const submitWeight = async (event: FormEvent) => {
        event.preventDefault();
        if (readOnly || savingWeight) return;
        const value = Number(weight.replace(',', '.'));
        if (!(value > 0 && value <= 500)) { setWeightError('Enter a weight between 0 and 500 kg.'); return; }
        setWeightError('');
        setSavingWeight(true);
        try { await saveWeight(value); setWeight(''); setAddingWeight(false); }
        catch { setWeightError('Could not save this weight. Try again.'); }
        finally { setSavingWeight(false); }
    };
    const formatDate = (date?: string) => date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    return <article className="dashboard-weight"><div className="dashboard-section-head"><div><h2>Bodyweight</h2><p className={goal ? `dashboard-weight-goal ${goal.tone}` : undefined}>{goal ? goal.text : 'Your tracked weight over time.'}</p></div><div className="dashboard-weight-actions" ref={addRoot}><div className="weight-ranges" role="group" aria-label="Bodyweight timeframe">{(['1M', '3M', '6M', '1Y', 'All'] as const).map(option => <button type="button" className={range === option ? 'active' : ''} onClick={() => setRange(option)} key={option}>{option}</button>)}</div><button className="mobile-add-weight" type="button" disabled={readOnly} onClick={() => setAddingWeight(value => !value)}>＋ Add</button><form className={addingWeight ? 'adding' : ''} onSubmit={event => void submitWeight(event)}><input disabled={readOnly} aria-label="Bodyweight in kilograms" value={weight} onChange={event => setWeight(event.target.value)} placeholder="kg" inputMode="decimal"/><button disabled={readOnly || savingWeight}>Save</button></form></div></div>{weightError && <p role="alert">{weightError}</p>}{entries.length === 1 && latest ? <div className="first-weight"><strong>{latest.weight.toFixed(1)} kg</strong><b>First tracked entry</b><span>{formatDate(latest.recorded_on)}</span></div> : <BodyweightChart readOnly={readOnly} values={visibleEntries} domainStart={domainStart} domainEnd={domainEnd} saveWeight={saveWeight} target={targetWeight}/>}</article>;
}
