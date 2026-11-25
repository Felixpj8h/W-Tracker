import { useOutsideDismiss } from '../../shared/ui/useOutsideDismiss';
import { loggedSets, tracksCompletion, workingSets } from '../workout/loggedSets';
import type { Workout } from '../workout/types';
import { useState, useRef, useEffect } from 'react';
import { useModalFocus } from '../../shared/ui/useModalFocus';
import { useBackAction } from '../../shared/lib/backNavigation';
import { api } from '../../shared/api/client';
import { PageHeader } from '../../shared/ui/PageHeader';
import { HistoryAnalysis } from './HistoryAnalysis';
import { duration } from '../../shared/lib/format';
import { DashboardIcon } from '../dashboard/DashboardIcon';

export function History({ data, edit, refresh, note, repeat, readOnly = false, pagination }: { pagination?: { q: string; month: string; months: string[]; total: number; volume: number; busy: boolean; more: boolean; filter: (query: string, month: string) => void; loadMore: () => void }; data: Workout[]; edit: (x: Workout) => void; refresh: () => Promise<void>; note: (s: string) => void; repeat?: (x: Workout) => Promise<void>; readOnly?: boolean }) {
    const [selectedId, setSelectedId] = useState<number | null>(null), [detailOpen, setDetailOpen] = useState(false), [query, setQuery] = useState(pagination?.q ?? ''), [month, setMonth] = useState(pagination?.month ?? 'all'), [view, setView] = useState<'sessions' | 'analysis'>('sessions'), [optimisticallyDeleted, setOptimisticallyDeleted] = useState<Set<number>>(() => new Set());
    const filter = useRef(pagination?.filter);
    filter.current = pagination?.filter;
    const initialFilters = useRef(true);
    useEffect(() => {
        if (initialFilters.current) { initialFilters.current = false; return; }
        const timer = setTimeout(() => filter.current?.(query, month), 300);
        return () => clearTimeout(timer);
    }, [query, month]);
    const lastSelectedId = useRef<number | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRoot = useOutsideDismiss<HTMLDivElement>(menuOpen, () => setMenuOpen(false));
    const [showSetDetails, setShowSetDetails] = useState(false);
    const [noteOpen, setNoteOpen] = useState(false);
    const [noteDraft, setNoteDraft] = useState('');
    const [noteSaving, setNoteSaving] = useState(false);
    const [noteError, setNoteError] = useState('');
    const notePanel = useRef<HTMLFormElement>(null);
    useEffect(() => { const update = (event: Event) => { const { id, deleted } = (event as CustomEvent<{ id: number; deleted: boolean }>).detail; setOptimisticallyDeleted(current => { const next = new Set(current); if (deleted) next.add(id); else next.delete(id); return next; }); if (deleted) setSelectedId(current => { if (current === id) setDetailOpen(false); return current === id ? null : current; }); }; window.addEventListener('optimistic-workout-delete', update); return () => window.removeEventListener('optimistic-workout-delete', update); }, []);
    useEffect(() => { document.body.classList.toggle('history-session-open', detailOpen); return () => document.body.classList.remove('history-session-open'); }, [detailOpen]);
    useEffect(() => { if (selectedId === null && detailOpen && lastSelectedId.current !== null) { setDetailOpen(false); setSelectedId(lastSelectedId.current); } }, [selectedId, detailOpen]);
    const completed = data.filter(workout => workout.completed && !optimisticallyDeleted.has(workout.id ?? -1));
    const months = pagination?.months ?? [...new Set(completed.map(workout => workout.performed_on.slice(0, 7)))];
    const filtered = completed.filter(workout => (month === 'all' || workout.performed_on.startsWith(month)) && `${workout.name} ${workout.exercises.map(item => item.name).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
    const selected = filtered.find(workout => workout.id === selectedId) ?? filtered[0] ?? null;
    const groups = filtered.reduce<Record<string, Workout[]>>((all, workout) => { const key = workout.performed_on.slice(0, 7); (all[key] ??= []).push(workout); return all; }, {});
    const volume = (workout: Workout) => {
        const checkedOnly = tracksCompletion(workout);
        return workout.exercises.reduce((total, item) => total + workingSets(item.sets, checkedOnly).reduce((sum, set) => sum + set.weight * set.reps, 0), 0);
    };
    const setCount = (workout: Workout) => {
        const checkedOnly = tracksCompletion(workout);
        return workout.exercises.reduce((total, item) => total + loggedSets(item.sets, checkedOnly).length, 0);
    };
    const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
    const formatMonth = (key: string) => new Date(`${key}-01T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const select = (workout: Workout) => { lastSelectedId.current = workout.id ?? null; setSelectedId(workout.id ?? null); setDetailOpen(true); setMenuOpen(false); setShowSetDetails(false); };
    const formatDate = (value: string, options: Intl.DateTimeFormatOptions) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, options);
    const summary = pagination
        ? `${plural(pagination.total, 'matching session')} · ${pagination.volume.toLocaleString()} kg total volume${view === 'analysis' ? '. Charts show loaded sessions.' : ''}`
        : `${plural(completed.length, 'session')} · ${completed.reduce((total, workout) => total + volume(workout), 0).toLocaleString()} kg lifted`;
    const showSessions = completed.length > 0 || query.trim() !== '' || month !== 'all' || Boolean(pagination);
    const deleteSelected = async (workout: Workout) => {
        if (readOnly || !window.confirm(`Delete “${workout.name}”? This cannot be undone.`)) return;
        setMenuOpen(false);
        await api(`/workouts/${workout.id}`, { method: 'DELETE' });
        setSelectedId(null);
        setDetailOpen(false);
        await refresh();
        note('Workout deleted');
    };
    const openNote = (workout: Workout) => { setMenuOpen(false); setNoteError(''); setNoteDraft(workout.note ?? ''); setNoteOpen(true); };
    const dismissNote = () => {
        if (!noteSaving && (noteDraft === (selected?.note ?? '') || window.confirm('Discard unsaved note changes?'))) setNoteOpen(false);
    };
    useBackAction(detailOpen, () => setDetailOpen(false));
    useBackAction(menuOpen, () => setMenuOpen(false));
    useBackAction(noteOpen, dismissNote);
    useModalFocus(notePanel, noteOpen && Boolean(selected), dismissNote);
    const saveSelectedNote = async () => {
        if (readOnly || !selected) return;
        setNoteSaving(true);
        setNoteError('');
        try {
            await api(`/workouts/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ ...selected, intent: "edit", note: noteDraft.trim() }) });
            await refresh();
            setNoteOpen(false);
            note('Note saved');
        } catch {
            setNoteError('Could not save this note. Your changes are still here.');
        } finally { setNoteSaving(false); }
    };
    const tabs = <div className="history-tabs" role="tablist" aria-label="History view">
        <button type="button" role="tab" aria-selected={view === 'sessions'} className={view === 'sessions' ? 'active' : ''} onClick={() => setView('sessions')}>Sessions</button>
        <button type="button" role="tab" aria-selected={view === 'analysis'} className={view === 'analysis' ? 'active' : ''} onClick={() => setView('analysis')}>Analysis</button>
    </div>;
    return <>
        <PageHeader action={tabs}><h1 className="history-page-title">Workout history</h1><p className="history-summary">{summary}</p></PageHeader>
        {view === 'analysis' ? <HistoryAnalysis completed={completed}/> : showSessions ? <section className="history-layout" aria-label="Workout sessions">
            <div className="history-browse">
                <section className="history-toolbar" aria-label="Filter sessions">
                    <label className="history-search"><span className="visually-hidden">Search workouts or exercises</span><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Workouts or exercises"/></label>
                    <label className="history-period"><span className="visually-hidden">Time period</span><select value={month} onChange={event => setMonth(event.target.value)}><option value="all">All time</option>{months.map(key => <option key={key} value={key}>{formatMonth(key)}</option>)}</select></label>
                </section>
                <nav className="history-list" aria-label="Completed workouts">
                    {filtered.length ? Object.entries(groups).map(([key, workouts]) => <div className="history-group" key={key}>
                        <p><span>{formatMonth(key)}</span><small>{plural(workouts.length, 'session')}</small></p>
                        {workouts.map(workout => <button type="button" className={`history-row-main ${selected?.id === workout.id ? 'active' : ''}`} aria-current={selected?.id === workout.id ? 'true' : undefined} onClick={() => select(workout)} key={workout.id}>
                            <time dateTime={workout.performed_on}><small>{formatDate(workout.performed_on, { month: 'short' })}</small><strong>{formatDate(workout.performed_on, { day: 'numeric' })}</strong></time>
                            <span><b>{workout.name}</b><small>{plural(workout.exercises.length, 'exercise')} · {volume(workout).toLocaleString()} kg · {duration(workout.duration_seconds)}</small></span>
                            <i aria-hidden="true">›</i>
                        </button>)}
                    </div>) : <div className="history-no-results">No sessions match those filters.</div>}
                    {pagination?.more && <button type="button" className="history-load-more" disabled={pagination.busy} onClick={pagination.loadMore}>{pagination.busy ? "Loading…" : "Load more"}</button>}
                </nav>
            </div>
            {selected && <article className="history-session" aria-label={`${selected.name} details`}>
                <button className="history-session-close" type="button" aria-label="Close workout details" onClick={() => setDetailOpen(false)}>×</button>
                <header className="history-session-head">
                    <div><p>{formatDate(selected.performed_on, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p><h2>{selected.name}</h2></div>
                    <div className="history-actions">
                        {repeat && <button disabled={readOnly} type="button" className="history-repeat" onClick={() => void repeat(selected)}><span aria-hidden="true">↻</span> Log again</button>}
                        <button type="button" disabled={readOnly} className="history-edit" onClick={() => edit(selected)}>Edit session</button>
                        <div className="history-menu-wrap" ref={menuRoot}><button type="button" disabled={readOnly} className="history-menu-trigger" aria-label="More session actions" aria-expanded={menuOpen} onClick={() => setMenuOpen(current => !current)}>⋯</button>{menuOpen && <div className="history-menu"><button type="button" onClick={() => openNote(selected)}>{selected.note ? 'Edit note' : 'Add note'}</button><button type="button" className="danger" onClick={() => void deleteSelected(selected)}>Delete session</button></div>}</div>
                    </div>
                </header>
                <dl className="history-session-stats">
                    <div><dt><DashboardIcon name="session"/>Exercises</dt><dd>{selected.exercises.length}</dd></div>
                    <div><dt><DashboardIcon name="volume"/>Sets</dt><dd>{setCount(selected)}</dd></div>
                    <div><dt><DashboardIcon name="scale"/>Volume</dt><dd>{volume(selected).toLocaleString()}<small> kg</small></dd></div>
                    <div><dt><DashboardIcon name="clock"/>Duration</dt><dd>{duration(selected.duration_seconds)}</dd></div>
                </dl>
                {selected.note ? <button type="button" disabled={readOnly} className="history-session-note" aria-label="Edit note" onClick={() => openNote(selected)}><span>Note</span>{selected.note}</button>
                    : !readOnly && <button type="button" className="history-session-note empty" onClick={() => openNote(selected)}>＋ Add note</button>}
                <div className="history-section-title"><h3>Exercises</h3><div className="history-utilities"><button type="button" onClick={() => setShowSetDetails(current => !current)} aria-pressed={showSetDetails}>{showSetDetails ? 'Hide set details' : 'Show set details'}</button></div></div>
                <ol className="history-exercises">
                    {selected.exercises.map((item, i) => <li className="history-exercise" key={`${item.name}-${i}`}>
                        <span className="history-exercise-index">{i + 1}</span>
                        <div><b>{item.name}</b>{!showSetDetails && <small>{loggedSets(item.sets, tracksCompletion(selected)).map(set => `${set.weight} kg × ${set.reps}`).join(' · ') || 'No completed sets'}</small>}{showSetDetails && <div className="history-set-details">{loggedSets(item.sets, tracksCompletion(selected)).map((set, index) => <span key={index}><i>Set {index + 1}</i>{set.weight} kg × {set.reps}{set.exertion ? <em>RPE {set.exertion}</em> : null}</span>)}{item.note && <p>{item.note}</p>}</div>}</div>
                        <span className="history-exercise-total"><b>{workingSets(item.sets, tracksCompletion(selected)).reduce((sum, set) => sum + set.weight * set.reps, 0).toLocaleString()} kg</b><small>{plural((item.sets ?? []).length, 'set')}</small></span>
                    </li>)}
                </ol>
            </article>}
        </section> : <div className="empty">No completed workouts yet.</div>}
        {noteOpen && selected && <div className="back history-note-overlay" onPointerDown={event => { if (event.button === 0 && event.target === event.currentTarget) dismissNote(); }}><form ref={notePanel} tabIndex={-1} className="history-note-panel" role="dialog" aria-modal="true" aria-label="Workout note" onSubmit={event => { event.preventDefault(); void saveSelectedNote(); }}><header><h2>Workout note</h2><button type="button" aria-label="Close note" onClick={dismissNote}>×</button></header><p>{selected.name} · {formatDate(selected.performed_on, { month: 'short', day: 'numeric', year: 'numeric' })}</p><textarea data-initial-focus aria-label="Workout note" maxLength={1000} value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="How did this workout go?"/>{noteError && <p role="alert">{noteError}</p>}<footer><button type="button" onClick={dismissNote}>Cancel</button><button className="primary" disabled={noteSaving}>{noteSaving ? 'Saving…' : 'Save note'}</button></footer></form></div>}
    </>;
}
