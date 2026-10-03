import { useState, useRef, useEffect } from 'react';

export function BodyweightChart({ values, domainStart, domainEnd, saveWeight }: {
    values: {
        weight: number;
        recorded_on?: string;
    }[];
    domainStart: number;
    domainEnd: number;
    saveWeight: (weight: number, recordedOn?: string) => Promise<void>;
}) {
    const [displayValues, setDisplayValues] = useState(values);
    const [hovered, setHovered] = useState<number | null>(null), [editing, setEditing] = useState<number | null>(null), [draft, setDraft] = useState('');
    const [adding, setAdding] = useState<{ date: string; x: number; y: number } | null>(null);
    const [newWeight, setNewWeight] = useState('');
    const [addError, setAddError] = useState('');
    const [savingNew, setSavingNew] = useState(false);
    const optimisticWeights = useRef(new Map<string, number>());
    useEffect(() => setDisplayValues(values.map(entry => {
        if (!entry.recorded_on) return entry;
        const optimisticWeight = optimisticWeights.current.get(entry.recorded_on);
        if (optimisticWeight === undefined) return entry;
        return entry.weight === optimisticWeight ? entry : { ...entry, weight: optimisticWeight };
    })), [values]);
    const rawLow = Math.min(...displayValues.map(x => x.weight)), rawHigh = Math.max(...displayValues.map(x => x.weight)), rawSpread = rawHigh - rawLow;
    const center = Math.round((rawLow + rawHigh) / 2), low = rawSpread < 4 ? center - 4 : Math.floor(rawLow - rawSpread * .12), high = rawSpread < 4 ? center + 4 : Math.ceil(rawHigh + rawSpread * .12), spread = high - low || 1;
    const formatDate = (value?: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const firstTime = domainStart, lastTime = domainEnd;
    const point = (index: number) => { const timestamp = displayValues[index].recorded_on ? new Date(`${displayValues[index].recorded_on}T12:00:00`).getTime() : index; return { x: displayValues.length < 2 || firstTime === lastTime ? 50 : 2 + (timestamp - firstTime) / (lastTime - firstTime) * 96, y: 88 - ((displayValues[index].weight - low) / spread) * 72 }; };
    const positions = displayValues.map((_, index) => point(index));
    const curve = positions.length ? positions.slice(1).reduce((path, current, index) => { const previous = positions[index], distance = (current.x - previous.x) / 3; return `${path} C ${previous.x + distance},${previous.y} ${current.x - distance},${current.y} ${current.x},${current.y}`; }, `M ${positions[0].x},${positions[0].y}`) : '';
    const area = curve ? `${curve} L ${positions.at(-1)!.x},100 L ${positions[0].x},100 Z` : '';
    const shown = editing ?? hovered;
    const gridTicks = [0, 1, 2, 3, 4];
    const yTickValues = gridTicks.map(index => high - spread * index / 4);
    const dateTicks = gridTicks.map(index => new Date(firstTime + (lastTime - firstTime) * index / 4));
    const formatTickDate = (value: Date) => value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const saveEditedPoint = async (index: number) => {
        const nextWeight = Number(draft), recordedOn = displayValues[index]?.recorded_on;
        if (!(nextWeight > 0) || !recordedOn) return;
        const previousWeight = displayValues[index].weight;
        optimisticWeights.current.set(recordedOn, nextWeight);
        setDisplayValues(current => current.map(entry => entry.recorded_on === recordedOn ? { ...entry, weight: nextWeight } : entry));
        setEditing(null);
        setHovered(null);
        try {
            await saveWeight(nextWeight, recordedOn);
        } catch {
            optimisticWeights.current.delete(recordedOn);
            setDisplayValues(current => current.map(entry => entry.recorded_on === recordedOn ? { ...entry, weight: previousWeight } : entry));
        }
    };
    const chooseEmptyDay = (clientX: number, clientY: number, rect: DOMRect) => {
        if (firstTime === lastTime || rect.width === 0) return;
        const fraction = Math.min(1, Math.max(0, ((clientX - rect.left) / rect.width * 100 - 2) / 96));
        const day = new Date(firstTime + (lastTime - firstTime) * fraction);
        const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        if (displayValues.some(entry => entry.recorded_on === date)) return;
        setHovered(null);
        setEditing(null);
        setNewWeight('');
        setAddError('');
        setAdding({ date, x: 2 + fraction * 96, y: Math.min(88, Math.max(16, (clientY - rect.top) / rect.height * 100)) });
    };
    const saveNewPoint = async () => {
        if (!adding) return;
        const weight = Number(newWeight);
        if (!(weight > 0 && weight <= 500)) { setAddError('Enter a weight between 0 and 500 kg.'); return; }
        setSavingNew(true);
        setAddError('');
        try { await saveWeight(weight, adding.date); setAdding(null); }
        catch { setAddError('Could not save this weight. Try again.'); }
        finally { setSavingNew(false); }
    };
    return <div className={`chart ${displayValues.length ? '' : 'chart-empty'}`} onPointerLeave={() => { if (editing === null) setHovered(null); }}>{displayValues.length ? <><svg viewBox="0 0 100 100" preserveAspectRatio="none" onClick={event => chooseEmptyDay(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())}><title>Click an unlogged day to add a bodyweight entry</title><defs><linearGradient id="weight-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".28"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs><g className="weight-grid">{gridTicks.map(index => <line key={`y-${index}`} x1="2" x2="98" y1={16 + index * 18} y2={16 + index * 18}/>) }{gridTicks.map(index => <line key={`x-${index}`} x1={2 + index * 24} x2={2 + index * 24} y1="16" y2="88"/>)}</g><path className="weight-area" d={area}/><path className="weight-curve" d={curve}/></svg>{displayValues.map((entry, index) => { const position = point(index); const distance = hovered === null ? null : Math.abs(index - hovered); return <button type="button" className={`weight-point-circle ${distance !== null && distance <= 2 ? `proximity-${distance}` : ''} ${index === displayValues.length - 1 ? 'latest' : ''}`} key={`${entry.recorded_on}-${index}`} style={{ left: `calc(var(--chart-axis-width) + (100% - var(--chart-axis-width) - var(--chart-right-gutter, 0px)) * ${position.x / 100})`, top: `${position.y}%` }} onPointerEnter={() => setHovered(index)} onFocus={() => setHovered(index)} onBlur={() => { if (editing === null) setHovered(null); }} onClick={() => { setAdding(null); setEditing(index); setHovered(index); setDraft(String(entry.weight)); }} aria-label={`${formatDate(entry.recorded_on)}, ${entry.weight} kilograms. Click to edit.`}/>; })}{shown !== null && <div className={`weight-point-popover ${shown === 0 ? 'at-start' : shown === displayValues.length - 1 ? 'at-end' : ''}`} style={{ left: `calc(var(--chart-axis-width) + (100% - var(--chart-axis-width) - var(--chart-right-gutter, 0px)) * ${point(shown).x / 100})`, top: `${point(shown).y}%` }}>{editing === shown ? <form onSubmit={event => { event.preventDefault(); void saveEditedPoint(shown); }}><label>{formatDate(displayValues[shown].recorded_on)}<span><input autoFocus value={draft} inputMode="decimal" onChange={event => setDraft(event.target.value)}/> kg</span></label><div><button type="button" onClick={() => { setEditing(null); setHovered(null); }}>Cancel</button><button>Save</button></div></form> : <><b>{displayValues[shown].weight.toFixed(1)} kg</b><small>{formatDate(displayValues[shown].recorded_on)}</small></>}</div>}{adding && <div className={`weight-point-popover weight-new-point ${adding.x < 15 ? 'at-start' : adding.x > 85 ? 'at-end' : ''} ${adding.y < 40 ? 'below' : ''}`} style={{ left: `calc(var(--chart-axis-width) + (100% - var(--chart-axis-width) - var(--chart-right-gutter, 0px)) * ${adding.x / 100})`, top: `${adding.y}%` }}><form onSubmit={event => { event.preventDefault(); void saveNewPoint(); }} onKeyDown={event => { if (event.key === 'Escape') setAdding(null); }}><label>{formatDate(adding.date)}<span><input autoFocus aria-label={`Bodyweight for ${formatDate(adding.date)}`} value={newWeight} onChange={event => setNewWeight(event.target.value)} inputMode="decimal"/> kg</span></label><div><button type="button" onClick={() => setAdding(null)}>Cancel</button><button disabled={savingNew}>{savingNew ? 'Saving…' : 'Save'}</button></div>{addError && <small className="weight-new-error" role="alert">{addError}</small>}</form></div>}<div className="chart-axis">{yTickValues.map((value, index) => <span key={index}>{value.toFixed(0)}</span>)}</div><div className="chart-dates">{dateTicks.map((date, index) => <span key={index}>{formatTickDate(date)}</span>)}</div></> : <span>Log bodyweight to unlock your trend.</span>}</div>;
}
