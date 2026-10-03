import type { Folder, Routine } from './types';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../shared/api/client';
import { routineMuscles } from './routineMuscles';
import { PageHeader } from '../../shared/ui/PageHeader';
import { RoutineEditor } from './RoutineEditor';

export function Routines({ folders, refresh, start, note }: {
    folders: Folder[];
    refresh: () => Promise<void>;
    start: (r: Routine) => void;
    note: (s: string) => void;
}) { const [edit, setEdit] = useState<Routine | null>(null), [folder, setFolder] = useState(''); const add = async (e: FormEvent) => { e.preventDefault(); if (!folder.trim())
    return; await api('/folders', { method: 'POST', body: JSON.stringify({ name: folder.trim() }) }); setFolder(''); await refresh(); }; const renameFolder = async (f: Folder) => { const name = window.prompt('Folder name', f.name); if (name?.trim()) {
    await api(`/folders/${f.id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
    await refresh();
    note('Folder renamed');
} }; const removeFolder = async (f: Folder) => { if (window.confirm(`Delete “${f.name}” and its ${f.routines.length} workout day(s)?`)) {
    await api(`/folders/${f.id}`, { method: 'DELETE' });
    await refresh();
    note('Folder removed');
} }; const removeDay = async (r: Routine) => { if (window.confirm(`Delete workout day “${r.name}”?`)) {
    await api(`/routines/${r.id}`, { method: 'DELETE' });
    await refresh();
    note('Workout day removed');
} }; const [openFolders, setOpenFolders] = useState<number[] | null>(null);
    const expanded = openFolders ?? (folders[0] ? [folders[0].id] : []);
    const toggleFolder = (id: number) => setOpenFolders(current => { const open = current ?? (folders[0] ? [folders[0].id] : []); return open.includes(id) ? open.filter(value => value !== id) : [...open, id]; });
    const newDay = (folderId: number) => setEdit({ id: 0, name: 'New workout day', folder_id: folderId, exercises: [] });
    const muscles = routineMuscles;
    return <div className="routine-manager"><PageHeader action={folders.length ? <button className="primary" onClick={() => newDay(expanded[0] ?? folders[0].id)}>New workout day <b>＋</b></button> : undefined}><h1>Workout routines</h1></PageHeader><form className="routine-create" onSubmit={add}><label htmlFor="routine-folder-name">New routine folder</label><input id="routine-folder-name" placeholder="e.g. Push / Pull / Legs" value={folder} onChange={event => setFolder(event.target.value)}/><button type="submit">Create folder</button></form>{folders.length === 0 && <div className="empty">Create a folder to organize your workout days.</div>}<div className="routine-folder-list">{folders.map(f => { const isOpen = expanded.includes(f.id); return <section className={`routine-group ${isOpen ? 'open' : ''}`} key={f.id}><div className="routine-group-head"><button type="button" className="routine-folder-toggle" aria-expanded={isOpen} onClick={() => toggleFolder(f.id)}><span className="folder-chevron" aria-hidden="true">{isOpen ? '⌄' : '›'}</span><svg className="folder-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 6.5A2.5 2.5 0 0 1 5 4h4.2l2 2H19a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 19 20H5a2.5 2.5 0 0 1-2.5-2.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg><span className="routine-folder-title">{f.name}</span><small>· {f.routines.length} workout {f.routines.length === 1 ? 'day' : 'days'}</small></button><div className="routine-group-actions">{isOpen && <button type="button" className="routine-add-day" onClick={() => newDay(f.id)}>＋ Add day</button>}<details className="routine-menu"><summary aria-label={`More options for ${f.name}`}>⋮</summary><div className="routine-menu-panel"><button type="button" onClick={() => void renameFolder(f)}>Rename folder</button><button type="button" className="danger" onClick={() => void removeFolder(f)}>Delete folder</button></div></details></div></div>{isOpen && <div className="routine-day-list">{f.routines.map(r => <div className="routine-day-row" key={r.id}><button type="button" className="routine-day-open" onClick={() => setEdit(r)}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.5" y="2.5" width="15" height="19" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg><span><strong>{r.name}</strong><small>{r.exercises.length} {r.exercises.length === 1 ? 'exercise' : 'exercises'}{muscles(r) ? ` · ${muscles(r)}` : ''}</small></span></button><div className="routine-day-actions"><button type="button" className="routine-start" onClick={() => start(r)}>Start</button><details className="routine-menu"><summary aria-label={`More options for ${r.name}`}>⋮</summary><div className="routine-menu-panel"><button type="button" onClick={() => setEdit(r)}>Edit day</button><button type="button" className="danger" onClick={() => void removeDay(r)}>Delete day</button></div></details></div></div>)}{!f.routines.length && <div className="routine-list-empty">No workout days yet. Add your first day to this folder.</div>}</div>}</section>; })}</div>{edit && <RoutineEditor routine={edit} folders={folders} close={() => setEdit(null)} done={async () => { setEdit(null); await refresh(); note('Workout day saved'); }}/>}</div>; }
