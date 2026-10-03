import type { Workout } from '../workout/types';
import { useState, useRef, useEffect } from 'react';
import { api } from '../../shared/api/client';
import { PageHeader } from '../../shared/ui/PageHeader';
import { HistoryAnalysis } from './HistoryAnalysis';
import { duration } from '../../shared/lib/format';
import { DashboardIcon } from '../dashboard/DashboardIcon';

export function History({ data, edit, refresh, note, repeat }: { data: Workout[]; edit: (x: Workout) => void; refresh: () => Promise<void>; note: (s: string) => void; repeat?: (x: Workout) => Promise<void> }) {
    const [selectedId, setSelectedId] = useState<number | null>(null), [detailOpen, setDetailOpen] = useState(false), [query, setQuery] = useState(''), [month, setMonth] = useState('all'), [view, setView] = useState<'sessions' | 'analysis'>('sessions'), [optimisticallyDeleted, setOptimisticallyDeleted] = useState<Set<number>>(() => new Set());
    const lastSelectedId = useRef<number | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [showSetDetails, setShowSetDetails] = useState(false);
    const [noteOpen, setNoteOpen] = useState(false);
    const [noteDraft, setNoteDraft] = useState('');
    const [noteSaving, setNoteSaving] = useState(false);
    useEffect(() => { const update = (event: Event) => { const { id, deleted } = (event as CustomEvent<{ id: number; deleted: boolean }>).detail; setOptimisticallyDeleted(current => { const next = new Set(current); if (deleted) next.add(id); else next.delete(id); return next; }); if (deleted) setSelectedId(current => { if (current === id) setDetailOpen(false); return current === id ? null : current; }); }; window.addEventListener('optimistic-workout-delete', update); return () => window.removeEventListener('optimistic-workout-delete', update); }, []);
    useEffect(() => { document.body.classList.toggle('history-session-open', detailOpen); return () => document.body.classList.remove('history-session-open'); }, [detailOpen]);
    useEffect(() => { if (selectedId === null && detailOpen && lastSelectedId.current !== null) { setDetailOpen(false); setSelectedId(lastSelectedId.current); } }, [selectedId, detailOpen]);
    const completed = data.filter(workout => workout.completed && !optimisticallyDeleted.has(workout.id ?? -1));
    const months = [...new Set(completed.map(workout => workout.performed_on.slice(0, 7)))];
    const filtered = completed.filter(workout => (month === 'all' || workout.performed_on.startsWith(month)) && `${workout.name} ${workout.exercises.map(item => item.name).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
    const selected = filtered.find(workout => workout.id === selectedId) ?? filtered[0] ?? null;
    const groups = filtered.reduce<Record<string, Workout[]>>((all, workout) => { const key = workout.performed_on.slice(0, 7); (all[key] ??= []).push(workout); return all; }, {});
    const volume = (workout: Workout) => workout.exercises.reduce((total, item) => total + (item.sets ?? []).reduce((sets, set) => sets + set.weight * set.reps, 0), 0);
    const formatMonth = (key: string) => new Date(`${key}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const select = (workout: Workout) => { lastSelectedId.current = workout.id ?? null; setSelectedId(workout.id ?? null); setDetailOpen(true); setMenuOpen(false); setShowSetDetails(false); };
    const formatDate = (value: string, options: Intl.DateTimeFormatOptions) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, options);
    const deleteSelected = async (workout: Workout) => {
        if (!window.confirm(`Delete “${workout.name}”? This cannot be undone.`)) return;
        setMenuOpen(false);
        await api(`/workouts/${workout.id}`, { method: 'DELETE' });
        setSelectedId(null);
        setDetailOpen(false);
        await refresh();
        note('Workout deleted');
    };
    const saveSelectedNote = async () => {
        if (!selected) return;
        setNoteSaving(true);
        try {
            await api(`/workouts/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ ...selected, note: noteDraft.trim() }) });
            await refresh();
            setNoteOpen(false);
            note('Note saved');
        } catch {
            note('Could not save note');
        } finally { setNoteSaving(false); }
    };
    return <>
        <PageHeader><h1 className="history-page-title">Workout history</h1></PageHeader>
        <div className="history-tabs" role="tablist" aria-label="History view">
            <button type="button" role="tab" aria-selected={view === 'sessions'} className={view === 'sessions' ? 'active' : ''} onClick={() => setView('sessions')}>Sessions</button>
            <button type="button" role="tab" aria-selected={view === 'analysis'} className={view === 'analysis' ? 'active' : ''} onClick={() => setView('analysis')}>Analysis</button>
        </div>
        {view === 'analysis' ? <HistoryAnalysis completed={completed}/> : <>
            <section className="history-toolbar" aria-label="Filter sessions">
                <label className="history-search"><span className="visually-hidden">Search workouts or exercises</span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search workouts or exercises"/></label>
                <label className="history-period"><span className="visually-hidden">Time period</span><select value={month} onChange={event => setMonth(event.target.value)}><option value="all">All time</option>{months.map(key => <option key={key} value={key}>{formatMonth(key)}</option>)}</select></label>
                <p>{filtered.length} {filtered.length === 1 ? 'session' : 'sessions'}</p>
            </section>
            {completed.length ? <section className="history-layout" aria-label="Workout sessions">
                <nav className="history-list" aria-label="Completed workouts">
                    {filtered.length ? Object.entries(groups).map(([key, workouts]) => <div className="history-group" key={key}>
                        <p>{formatMonth(key)}</p>
                        {workouts.map(workout => <button type="button" className={`history-row-main ${selected?.id === workout.id ? 'active' : ''}`} aria-current={selected?.id === workout.id ? 'true' : undefined} onClick={() => select(workout)} key={workout.id}>
                            <time dateTime={workout.performed_on}><small>{formatDate(workout.performed_on, { month: 'short' })}</small><strong>{formatDate(workout.performed_on, { day: 'numeric' })}</strong></time>
                            <span><b>{workout.name}</b><small>{workout.exercises.length} exercises · {volume(workout).toLocaleString()} kg · {duration(workout.duration_seconds)}</small></span>
                            <i aria-hidden="true">›</i>
                        </button>)}
                    </div>) : <div className="history-no-results">No sessions match those filters.</div>}
                </nav>
                {selected && <article className="history-session" aria-label={`${selected.name} details`}>
                    <button className="history-session-close" type="button" aria-label="Close workout details" onClick={() => setDetailOpen(false)}>×</button>
                    <header className="history-session-head">
                        <div><h2>{selected.name}</h2><p>{formatDate(selected.performed_on, { month: 'short', day: 'numeric', year: 'numeric' })}</p></div>
                        <div className="history-actions"><button type="button" className="history-edit" onClick={() => edit(selected)}>Edit session</button><div className="history-menu-wrap"><button type="button" className="history-menu-trigger" aria-label="More session actions" aria-expanded={menuOpen} onClick={() => setMenuOpen(current => !current)}>⋯</button>{menuOpen && <div className="history-menu"><button type="button" onClick={() => void deleteSelected(selected)}>Delete session</button></div>}</div></div>
                    </header>
                    <div className="history-session-stats"><span><DashboardIcon name="session"/>{selected.exercises.length} exercises</span><span><DashboardIcon name="scale"/>{volume(selected).toLocaleString()} kg</span><span><DashboardIcon name="clock"/>{duration(selected.duration_seconds)}</span></div>
                    {selected.note && <p className="history-session-note">{selected.note}</p>}
                    <div className="history-section-title"><h3>Exercises</h3><div className="history-utilities"><button type="button" onClick={() => setShowSetDetails(current => !current)} aria-pressed={showSetDetails}>☷ <span>{showSetDetails ? 'Hide details' : 'View details'}</span></button>{repeat && <button type="button" onClick={() => void repeat(selected)}>↻ <span>Log again</span></button>}<button type="button" onClick={() => { setNoteDraft(selected.note ?? ''); setNoteOpen(true); }}>▤ <span>{selected.note ? 'Edit note' : 'Add note'}</span></button></div></div>
                    <div className="history-exercises">
                        {selected.exercises.map((item, i) => <div className="history-exercise" key={`${item.name}-${i}`}><span className="history-exercise-index">{i + 1}</span><div><b>{item.name}</b><small>{(item.sets ?? []).map(set => `${set.weight} kg × ${set.reps}`).join(' · ') || 'No completed sets'}</small>{showSetDetails && <div className="history-set-details">{(item.sets ?? []).map((set, index) => <span key={index}>Set {index + 1}: {set.weight} kg × {set.reps}{set.exertion ? ` · RPE ${set.exertion}` : ''}</span>)}{item.note && <p>{item.note}</p>}</div>}</div></div>)}
                    </div>
                </article>}
            </section> : <div className="empty">No completed workouts yet.</div>}
        </>}
        {noteOpen && selected && <div className="back history-note-overlay"><form className="history-note-panel" role="dialog" aria-modal="true" aria-label="Workout note" onSubmit={event => { event.preventDefault(); void saveSelectedNote(); }}><header><h2>Workout note</h2><button type="button" aria-label="Close note" onClick={() => setNoteOpen(false)}>×</button></header><p>{selected.name} · {formatDate(selected.performed_on, { month: 'short', day: 'numeric', year: 'numeric' })}</p><textarea autoFocus maxLength={1000} value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="How did this workout go?"/><footer><button type="button" onClick={() => setNoteOpen(false)}>Cancel</button><button className="primary" disabled={noteSaving}>{noteSaving ? 'Saving…' : 'Save note'}</button></footer></form></div>}
    </>;
}
