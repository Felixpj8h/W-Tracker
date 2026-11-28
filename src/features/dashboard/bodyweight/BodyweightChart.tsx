import { useOutsideDismiss } from '../../../shared/ui/useOutsideDismiss';
import { useState, useRef, useEffect } from 'react';

export function BodyweightChart({ values, leadIn, domainStart, domainEnd, saveWeight, readOnly = false, target = null }: {
    readOnly?: boolean;
    /** Last entry before domainStart; the line is interpolated from it so it reaches the left edge. */
    leadIn?: { weight: number; recorded_on: string };
    /** Target weight drawn as a dashed line when it is close enough to the data to fit. */
    target?: number | null;
    values: {
        weight: number;
        recorded_on?: string;
    }[];
    domainStart: number;
    domainEnd: number;
    saveWeight: (weight: number, recordedOn?: string) => Promise<void>;
}) {
    const displayValues = values;
    const [hovered, setHovered] = useState<number | null>(null), [editingDate, setEditing] = useState<string | null>(null), [draft, setDraft] = useState('');
    const editing = editingDate == null ? -1 : displayValues.findIndex(entry => entry.recorded_on === editingDate);
    const [selected, setSelected] = useState<number | null>(null);
    const [adding, setAdding] = useState<{ date: string; x: number; y: number } | null>(null);
    const [newWeight, setNewWeight] = useState('');
    const [addError, setAddError] = useState('');
    const [savingNew, setSavingNew] = useState(false);
    const [savingEdit, setSavingEdit] = useState(false);
    const [editError, setEditError] = useState('');
    const popoverRoot = useOutsideDismiss<HTMLDivElement>(editing >= 0 || adding !== null || selected !== null, () => {
        if (savingNew || savingEdit) return;
        setEditing(null); setHovered(null); setSelected(null); setAdding(null);
    });
    const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; suppressClick: boolean } | null>(null);
    const isMobile = () => window.matchMedia?.('(max-width: 760px)').matches ?? window.innerWidth <= 760;
    const cancelPress = () => {
        if (press.current?.timer) clearTimeout(press.current.timer);
        if (press.current) press.current.timer = null;
    };
    useEffect(() => () => { if (press.current?.timer) clearTimeout(press.current.timer); }, []);
    const editPoint = (index: number) => {
        const entry = displayValues[index];
        if (savingEdit || !entry?.recorded_on) return;
        setAdding(null); setSelected(null); setEditing(entry.recorded_on); setHovered(index);
        setDraft(String(entry.weight)); setEditError('');
    };
    // Adjacent entries can share hit areas. Select by distance to their plotted centers.
    const pointerIndex = (event: React.MouseEvent<HTMLButtonElement>, fallback: number) => {
        const points = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.weight-point-circle') ?? [];
        let nearest = fallback;
        let distance = Infinity;
        points.forEach((button, index) => {
            const rect = button.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const squared = (event.clientX - (rect.left + rect.width / 2)) ** 2 + (event.clientY - (rect.top + rect.height / 2)) ** 2;
            if (squared < distance) { nearest = index; distance = squared; }
        });
        return nearest;
    };
    const timeOf = (date?: string) => date ? new Date(`${date}T12:00:00`).getTime() : NaN;
    const firstShown = displayValues[0];
    const edgeWeight = leadIn && firstShown?.recorded_on && timeOf(firstShown.recorded_on) > domainStart
        ? leadIn.weight + (firstShown.weight - leadIn.weight) * (domainStart - timeOf(leadIn.recorded_on)) / (timeOf(firstShown.recorded_on) - timeOf(leadIn.recorded_on))
        : null;
    const scaleWeights = [...displayValues.map(x => x.weight), ...(edgeWeight === null ? [] : [edgeWeight])];
    const dataLow = Math.min(...scaleWeights), dataHigh = Math.max(...scaleWeights);
    // Stretch the scale to show the target only when that keeps the trend readable.
    const showTarget = target !== null && displayValues.length > 0 && target >= dataLow - Math.max(5, dataHigh - dataLow) && target <= dataHigh + Math.max(5, dataHigh - dataLow);
    const rawLow = showTarget ? Math.min(dataLow, target) : dataLow, rawHigh = showTarget ? Math.max(dataHigh, target) : dataHigh, rawSpread = rawHigh - rawLow;
    const center = Math.round((rawLow + rawHigh) / 2), low = rawSpread < 4 ? center - 4 : Math.floor(rawLow - rawSpread * .12), high = rawSpread < 4 ? center + 4 : Math.ceil(rawHigh + rawSpread * .12), spread = high - low || 1;
    const formatDate = (value?: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const firstTime = domainStart, lastTime = domainEnd;
    const point = (index: number) => { const timestamp = displayValues[index].recorded_on ? new Date(`${displayValues[index].recorded_on}T12:00:00`).getTime() : index; return { x: firstTime === lastTime ? 50 : 2 + (timestamp - firstTime) / (lastTime - firstTime) * 96, y: 88 - ((displayValues[index].weight - low) / spread) * 72 }; };
    const positions = [...(edgeWeight === null ? [] : [{ x: 2, y: 88 - ((edgeWeight - low) / spread) * 72 }]), ...displayValues.map((_, index) => point(index))];
    const curve = positions.length ? positions.slice(1).reduce((path, current, index) => { const previous = positions[index], distance = (current.x - previous.x) / 3; return `${path} C ${previous.x + distance},${previous.y} ${current.x - distance},${current.y} ${current.x},${current.y}`; }, `M ${positions[0].x},${positions[0].y}`) : '';
    const area = curve ? `${curve} L ${positions.at(-1)!.x},100 L ${positions[0].x},100 Z` : '';
    const candidate = editing >= 0 ? editing : selected ?? hovered;
    const shown = candidate !== null && displayValues[candidate] ? candidate : null;
    const gridTicks = [0, 1, 2, 3, 4];
    const yTickValues = gridTicks.map(index => high - spread * index / 4);
    const dateTicks = gridTicks.map(index => new Date(firstTime + (lastTime - firstTime) * index / 4));
    const formatTickDate = (value: Date) => value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const saveEditedPoint = async () => {
        if (readOnly || savingEdit || !editingDate) return;
        const weight = Number(draft.replace(',', '.'));
        if (!(weight > 0 && weight <= 500)) { setEditError('Enter a weight between 0 and 500 kg.'); return; }
        setSavingEdit(true);
        setEditError('');
        try {
            await saveWeight(weight, editingDate);
            setEditing(null);
            setHovered(null);
        } catch { setEditError('Could not save this weight. Try again.'); }
        finally { setSavingEdit(false); }
    };
    const chooseEmptyDay = (clientX: number, clientY: number, rect: DOMRect) => {
        if (readOnly || firstTime === lastTime || rect.width === 0) return;
        const fraction = Math.min(1, Math.max(0, ((clientX - rect.left) / rect.width * 100 - 2) / 96));
        const day = new Date(firstTime + (lastTime - firstTime) * fraction);
        const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        if (displayValues.some(entry => entry.recorded_on === date)) return;
        setHovered(null);
        setEditing(null);
        setSelected(null);
        setNewWeight('');
        setAddError('');
        setAdding({ date, x: 2 + fraction * 96, y: Math.min(88, Math.max(16, (clientY - rect.top) / rect.height * 100)) });
    };
    const saveNewPoint = async () => {
        if (readOnly || !adding) return;
        const weight = Number(newWeight);
        if (!(weight > 0 && weight <= 500)) { setAddError('Enter a weight between 0 and 500 kg.'); return; }
        setSavingNew(true);
        setAddError('');
        try { await saveWeight(weight, adding.date); setAdding(null); }
        catch { setAddError('Could not save this weight. Try again.'); }
        finally { setSavingNew(false); }
    };
    return <div className={`chart ${displayValues.length ? '' : 'chart-empty'}`} onPointerLeave={() => { if (editing < 0) setHovered(null); }}>{displayValues.length ? <><svg viewBox="0 0 100 100" preserveAspectRatio="none" onClick={event => chooseEmptyDay(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())}><title>{readOnly ? 'Bodyweight over time' : 'Click an unlogged day to add a bodyweight entry'}</title><defs><linearGradient id="weight-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".28"/><stop offset="1" stopColor="var(--accent)" stopOpacity="0"/></linearGradient></defs><g className="weight-grid">{gridTicks.map(index => <line key={`y-${index}`} x1="2" x2="98" y1={16 + index * 18} y2={16 + index * 18}/>) }{gridTicks.map(index => <line key={`x-${index}`} x1={2 + index * 24} x2={2 + index * 24} y1="16" y2="88"/>)}</g>{showTarget && <line className="weight-target" x1="2" x2="98" y1={88 - ((target - low) / spread) * 72} y2={88 - ((target - low) / spread) * 72}/>}<path className="weight-area" d={area}/><path className="weight-curve" d={curve}/></svg>{displayValues.map((entry, index) => { const position = point(index); const distance = hovered === null ? null : Math.abs(index - hovered); return <button type="button" className={`weight-point-circle ${distance !== null && distance <= 2 ? `proximity-${distance}` : ''} ${index === displayValues.length - 1 ? 'latest' : ''}`} key={`${entry.recorded_on}-${index}`} style={{ left: `calc(var(--chart-axis-width) + (100% - var(--chart-axis-width) - var(--chart-right-gutter, 0px)) * ${position.x / 100})`, top: `${position.y}%` }} onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(pointerIndex(event, index)); }} onFocus={() => setHovered(index)} onBlur={() => { if (editing < 0) setHovered(null); }}
        onPointerDown={event => {
            cancelPress(); press.current = null;
            if (!isMobile() || event.button !== 0) return;
            const gesture = { timer: null as ReturnType<typeof setTimeout> | null, x: event.clientX, y: event.clientY, suppressClick: false };
            press.current = gesture;
            const target = pointerIndex(event, index);
            if (!readOnly) gesture.timer = setTimeout(() => {
                gesture.timer = null; gesture.suppressClick = true; editPoint(target);
            }, 500);
        }}
        onPointerMove={event => {
            if (event.pointerType !== 'touch' && !isMobile()) setHovered(pointerIndex(event, index));
            const gesture = press.current;
            if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10) {
                cancelPress(); gesture.suppressClick = true;
            }
        }}
        onPointerUp={cancelPress}
        onPointerCancel={() => { cancelPress(); if (press.current) press.current.suppressClick = true; }}
        onPointerLeave={cancelPress}
        onContextMenu={event => { if (isMobile()) event.preventDefault(); }}
        onClick={event => {
            if (press.current?.suppressClick) { press.current = null; return; }
            press.current = null;
            if (savingEdit || savingNew) return;
            const target = event.detail === 0 ? index : pointerIndex(event, index);
            if (readOnly || (isMobile() && event.detail !== 0)) {
                setAdding(null); setEditing(null); setHovered(null); setSelected(target); return;
            }
            editPoint(target);
        }} aria-label={`${formatDate(entry.recorded_on)}, ${entry.weight} kilograms.${readOnly ? '' : isMobile() ? ' Tap to view. Long press to edit.' : ' Click to edit.'}`}/>; })}{shown !== null && <div ref={popoverRoot} className={`weight-point-popover ${shown === 0 ? 'at-start' : shown === displayValues.length - 1 ? 'at-end' : ''}`} style={{ left: `calc(var(--chart-axis-width) + (100% - var(--chart-axis-width) - var(--chart-right-gutter, 0px)) * ${point(shown).x / 100})`, top: `${point(shown).y}%` }}>{editing === shown ? <form onSubmit={event => { event.preventDefault(); void saveEditedPoint(); }}><label>{formatDate(displayValues[shown].recorded_on)}<span><input autoFocus value={draft} inputMode="decimal" onChange={event => setDraft(event.target.value)}/> kg</span></label><div><button type="button" disabled={savingEdit} onClick={() => { setEditing(null); setHovered(null); }}>Cancel</button><button disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save'}</button></div>{editError && <small role="alert">{editError}</small>}</form> : <><b>{displayValues[shown].weight.toFixed(1)} kg</b><small>{formatDate(displayValues[shown].recorded_on)}</small></>}</div>}{adding && <div ref={popoverRoot} className={`weight-point-popover weight-new-point ${adding.x < 15 ? 'at-start' : adding.x > 85 ? 'at-end' : ''} ${adding.y < 40 ? 'below' : ''}`} style={{ left: `calc(var(--chart-axis-width) + (100% - var(--chart-axis-width) - var(--chart-right-gutter, 0px)) * ${adding.x / 100})`, top: `${adding.y}%` }}><form onSubmit={event => { event.preventDefault(); void saveNewPoint(); }} onKeyDown={event => { if (event.key === 'Escape') setAdding(null); }}><label>{formatDate(adding.date)}<span><input autoFocus aria-label={`Bodyweight for ${formatDate(adding.date)}`} value={newWeight} onChange={event => setNewWeight(event.target.value)} inputMode="decimal"/> kg</span></label><div><button type="button" onClick={() => setAdding(null)}>Cancel</button><button disabled={savingNew}>{savingNew ? 'Saving…' : 'Save'}</button></div>{addError && <small className="weight-new-error" role="alert">{addError}</small>}</form></div>}{showTarget && <span className="weight-target-label" aria-hidden="true" style={{ top: `${88 - ((target - low) / spread) * 72}%` }}>Goal {target.toFixed(1)} kg</span>}<div className="chart-axis">{yTickValues.map((value, index) => <span key={index}>{value.toFixed(0)}</span>)}</div><div className="chart-dates">{dateTicks.map((date, index) => <span key={index}>{formatTickDate(date)}</span>)}</div></> : <span>Log bodyweight to unlock your trend.</span>}</div>;
}
