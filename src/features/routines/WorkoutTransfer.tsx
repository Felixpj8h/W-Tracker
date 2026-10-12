import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../shared/api/client';
import type { Folder, Routine } from './types';
import { clearWorkoutLink, createWorkoutLink, createFolderLink, parseSharedLink } from './sharing';
import type { SharedWorkout, SharedFolder } from './sharing';

export function WorkoutTransfer({ routine, sharedFolder, initialLink = '', folders, close, imported }: {
    routine?: Routine;
    sharedFolder?: Folder;
    initialLink?: string;
    folders: Folder[];
    close: () => void;
    imported: (routine: Pick<Routine, 'name' | 'folder_id'>) => Promise<void>;
}) {
    const [initial] = useState(() => {
        try { return { link: sharedFolder ? createFolderLink(sharedFolder) : routine ? createWorkoutLink(routine) : initialLink, preview: !routine && initialLink ? parseSharedLink(initialLink) : null, error: '' }; }
        catch (err) { return { link: initialLink, preview: null, error: (err as Error).message }; }
    });
    const [link, setLink] = useState(initial.link);
    const [preview, setPreview] = useState<SharedWorkout | SharedFolder | null>(initial.preview);
    const [destination, setDestination] = useState(initial.preview && 'routines' in initial.preview ? 'new' : String(folders[0]?.id ?? 'new'));
    const [newFolder, setNewFolder] = useState(initial.preview && 'routines' in initial.preview ? initial.preview.name : 'Imported workouts');
    const [error, setError] = useState(initial.error);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const linkInput = useRef<HTMLInputElement>(null);
    const dialog = useRef<HTMLElement>(null);
    const dismiss = () => { if (!busy) { if (initialLink) clearWorkoutLink(); close(); } };

    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        linkInput.current?.focus();
        return () => previous?.focus();
    }, []);

    const readLink = (event: FormEvent) => {
        event.preventDefault();
        setError('');
        try { const value = parseSharedLink(link); setPreview(value); if ('routines' in value) { setDestination('new'); setNewFolder(value.name); } } catch (err) { setError((err as Error).message); }
    };
    const copy = async () => {
        try { await navigator.clipboard.writeText(link); setCopied(true); setError(''); }
        catch { linkInput.current?.focus(); linkInput.current?.select(); setError('Copy the selected link to share this workout.'); }
    };
    const save = async (event: FormEvent) => {
        event.preventDefault();
        if (!preview || busy) return;
        setBusy(true); setError('');
        try {
            const saved = await api<Pick<Routine, 'name' | 'folder_id'>>('routines' in preview ? '/folders/import' : '/routines/import', { method: 'POST', body: JSON.stringify({
                ...preview, folder_id: destination === 'new' ? undefined : Number(destination),
                folder_name: destination === 'new' ? newFolder.trim() : undefined,
            }) });
            if (initialLink) clearWorkoutLink();
            await imported(saved);
        } catch { setError('Could not import the workout. Check your connection and try again.'); }
        finally { setBusy(false); }
    };

    return <div className="back" onKeyDown={event => {
        if (event.key === 'Escape') dismiss();
        if (event.key === 'Tab') {
            const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
            if (!controls?.length) return;
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    }}>
        <section ref={dialog} className="modal workout-transfer" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
            <div className="modal-head"><h2 id="transfer-title">{sharedFolder ? 'Share routine folder' : routine ? 'Share workout' : 'Import workout or folder'}</h2><button type="button" aria-label="Close workout dialog" disabled={busy} onClick={dismiss}>×</button></div>
            {routine || sharedFolder ? <>
                <p>Share a copy of <strong>{sharedFolder?.name ?? routine?.name}</strong>. Anyone with access to the tracker can import this copy.</p>
                <label>Share link<input ref={linkInput} value={link} readOnly onFocus={event => event.target.select()}/></label>
                <p className="transfer-hint">This is a snapshot. Later edits won’t change the shared copy.</p>
                <button type="button" className="primary wide" disabled={!link} onClick={() => void copy()}>{copied ? 'Link copied ✓' : 'Copy link'}</button>
                {copied && <p role="status">Link copied. Ready to share.</p>}
            </> : <>
                <form onSubmit={readLink} className="transfer-link-form"><label htmlFor="import-workout-link">Workout link</label><input id="import-workout-link" ref={linkInput} type="url" required placeholder="Paste a shared workout link" value={link} disabled={busy} onChange={event => { setLink(event.target.value); setPreview(null); setError(''); }}/><button type="submit" disabled={busy}>Preview workout</button></form>
                {preview && <form onSubmit={save}>
                    <div className="transfer-preview"><h3>{preview.name}</h3>{'routines' in preview ? <><p>{preview.routines.length} workout days</p>{preview.routines.map((day, index) => <div key={index}><h4>{day.name}</h4><ol>{day.exercises.map((item, i) => <li key={i}>{item.name} · {item.planned_sets} sets · {item.target_reps_min}–{item.target_reps_max} reps · {item.rest_seconds}s rest{item.target_weight !== undefined ? ` · ${item.target_weight} kg` : ''}</li>)}</ol></div>)}</> : <><p>{preview.exercises.length} {preview.exercises.length === 1 ? 'exercise' : 'exercises'}</p><ol>{preview.exercises.map((item, index) => <li key={index}><strong>{item.name}</strong><small>{item.planned_sets} sets · {item.target_reps_min === item.target_reps_max ? item.target_reps_min : `${item.target_reps_min}–${item.target_reps_max}`} reps · {item.rest_seconds}s rest{item.target_weight !== undefined ? ` · ${item.target_weight} kg` : ''}</small></li>)}</ol></>}</div>
                    {!('routines' in preview) && <label>Save to folder<select value={destination} disabled={busy} onChange={event => setDestination(event.target.value)}>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}<option value="new">Create a new folder</option></select></label>}
                    {destination === 'new' && <label>New folder name<input required maxLength={100} value={newFolder} disabled={busy} onChange={event => setNewFolder(event.target.value)}/></label>}
                    <p className="transfer-hint">Import creates your own copy, ready to edit or start.</p>
                    <button className="primary wide" disabled={busy || (destination === 'new' && !newFolder.trim())}>{busy ? 'Importing…' : 'routines' in preview ? 'Import folder and workouts' : 'Import workout'}</button>
                </form>}
            </>}
            {error && <p className="error" role="alert">{error}</p>}
        </section>
    </div>;
}
