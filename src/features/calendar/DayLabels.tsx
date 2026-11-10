import { useEffect, useState } from 'react';
import { api } from '../../shared/api/client';
import type { CalendarLabel, CalendarMonth, LoadCalendarMonth } from './types';

const colors: CalendarLabel['color'][] = ['rose', 'amber', 'sky', 'violet', 'mint', 'slate'];

export function DayLabels({ selected, label, months, loadMonth, readOnly, manageOpen, openManage, closeManage }: { selected: string; label?: CalendarLabel | null; months: Record<string, CalendarMonth>; loadMonth: LoadCalendarMonth; readOnly: boolean; manageOpen: boolean; openManage: () => void; closeManage: () => void }) {
    const [labels, setLabels] = useState<CalendarLabel[]>([]);
    const [name, setName] = useState('');
    const [color, setColor] = useState<CalendarLabel['color']>('rose');
    const [editingId, setEditingId] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { if (!readOnly) void Promise.resolve(api<CalendarLabel[]>('/calendar/labels')).then(items => setLabels(Array.isArray(items) ? items : [])).catch(() => setError('Could not load labels.')); }, [readOnly]);
    const refreshDate = async () => { await loadMonth(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)), true); };
    const refreshMonths = async () => { await Promise.all(Object.keys(months).map(key => loadMonth(Number(key.slice(0, 4)), Number(key.slice(5)), true))); };
    const choose = async (id: number | null) => {
        if (readOnly || busy) return;
        setBusy(true); setError('');
        try {
            await api(`/calendar/${selected}/label`, id == null ? { method: 'DELETE' } : { method: 'PUT', body: JSON.stringify({ label_id: id }) });
            await refreshDate();
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save label.'); }
        finally { setBusy(false); }
    };
    const save = async () => {
        const trimmed = name.trim();
        if (!trimmed || busy) { if (!trimmed) setError('Enter a label name.'); return; }
        setBusy(true); setError('');
        try {
            const saved = await api<CalendarLabel>(editingId == null ? '/calendar/labels' : `/calendar/labels/${editingId}`, { method: editingId == null ? 'POST' : 'PATCH', body: JSON.stringify({ name: trimmed, color }) });
            setLabels(current => editingId == null ? [...current, saved].sort((a, b) => a.name.localeCompare(b.name)) : current.map(item => item.id === saved.id ? saved : item).sort((a, b) => a.name.localeCompare(b.name)));
            if (editingId == null) {
                await api(`/calendar/${selected}/label`, { method: 'PUT', body: JSON.stringify({ label_id: saved.id }) });
                await refreshDate();
                closeManage();
            } else await refreshMonths();
            setName(''); setColor('rose'); setEditingId(null);
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save label.'); }
        finally { setBusy(false); }
    };
    const remove = async (item: CalendarLabel) => {
        if (busy || !window.confirm(`Delete the “${item.name}” label from every date?`)) return;
        setBusy(true); setError('');
        try {
            await api(`/calendar/labels/${item.id}`, { method: 'DELETE' });
            setLabels(current => current.filter(entry => entry.id !== item.id));
            if (editingId === item.id) { setEditingId(null); setName(''); setColor('rose'); }
            await refreshMonths();
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete label.'); }
        finally { setBusy(false); }
    };
    if (readOnly) return label ? <div className="calendar-label-control"><span>Day label</span><span className={`calendar-label-chip color-${label.color}`}>{label.name}</span></div> : null;
    return <>
        <div className="calendar-label-control"><label htmlFor="calendar-day-label">Day label</label><div><select id="calendar-day-label" aria-label="Day label" value={label?.id ?? ''} disabled={busy} onChange={event => void choose(event.target.value ? Number(event.target.value) : null)}><option value="">No label</option>{labels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" disabled={busy} onClick={() => { setEditingId(null); setName(''); setColor('rose'); openManage(); }}>New label</button></div></div>
        {manageOpen && <div className="back calendar-label-overlay" onPointerDown={event => { if (event.target === event.currentTarget && !busy) closeManage(); }}><section className="calendar-label-panel" role="dialog" aria-modal="true" aria-label="Manage day labels"><header><h2>Day labels</h2><button type="button" aria-label="Close labels" onClick={closeManage}>×</button></header><div className="calendar-label-list">{labels.map(item => <div key={item.id}><span className={`calendar-label-chip color-${item.color}`}>{item.name}</span><button type="button" onClick={() => { setEditingId(item.id); setName(item.name); setColor(item.color); }}>Edit</button><button type="button" onClick={() => void remove(item)}>Delete</button></div>)}</div><div className="calendar-label-form"><label htmlFor="calendar-label-name">{editingId == null ? 'Create a label' : 'Edit label'}</label><input id="calendar-label-name" maxLength={40} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Sick"/><div className="calendar-label-colors" role="group" aria-label="Label color">{colors.map(item => <button key={item} type="button" className={`color-${item} ${color === item ? 'active' : ''}`} aria-label={`${item} color`} aria-pressed={color === item} onClick={() => setColor(item)}>{item}</button>)}</div><div className="calendar-label-form-actions">{editingId != null && <button type="button" onClick={() => { setEditingId(null); setName(''); setColor('rose'); }}>Cancel edit</button>}<button className="primary" type="button" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? 'Saving…' : editingId == null ? 'Create and apply' : 'Save changes'}</button></div></div>{error && <p role="alert" className="calendar-label-error">{error}</p>}</section></div>}
        {!manageOpen && error && <p role="alert" className="calendar-label-error">{error}</p>}
    </>;
}
