import type { Folder, Routine } from '../routines/types';
import type { Workout } from '../workout/types';
import type { CalendarMonth, LoadCalendarMonth } from './types';
import { useState } from 'react';
import { api } from '../../shared/api/client';
import { TrainingCalendar } from './TrainingCalendar';
import { WorkoutDetails } from './WorkoutDetails';
import { WorkoutLogger } from '../workout/WorkoutLogger';

export function Calendar({ folders, history, months, loadMonth, onWorkoutSaved, start, repeatWorkout, readOnly = false }: { readOnly?: boolean; folders: Folder[]; history: Workout[]; months: Record<string, CalendarMonth>; loadMonth: LoadCalendarMonth; onWorkoutSaved: (date: string) => Promise<void>; start: (routine: Routine) => Promise<void>; repeatWorkout: (workout: Workout) => Promise<void> }) {
    const [editWorkout, setEditWorkout] = useState<Workout | null>(null);
    const [viewWorkout, setViewWorkout] = useState<Workout | null>(null);
    const [noteWorkout, setNoteWorkout] = useState<Workout | null>(null);
    const [noteDraft, setNoteDraft] = useState('');
    const [noteSaving, setNoteSaving] = useState(false);
    const dismissNote = () => {
        if (!noteSaving && (noteDraft === (noteWorkout?.note ?? '') || window.confirm('Discard unsaved note changes?'))) setNoteWorkout(null);
    };
    const saveNote = async () => { if (readOnly || !noteWorkout?.id) return; setNoteSaving(true); try { await api(`/workouts/${noteWorkout.id}`, { method: 'PATCH', body: JSON.stringify({ ...noteWorkout, note: noteDraft }) }); await onWorkoutSaved(noteWorkout.performed_on); setNoteWorkout(null); } finally { setNoteSaving(false); } };
    return <><TrainingCalendar onWorkoutMoved={onWorkoutSaved} readOnly={readOnly} folders={folders} history={history} months={months} loadMonth={loadMonth} start={start} repeatWorkout={repeatWorkout} viewWorkout={setViewWorkout} editWorkout={setEditWorkout} addNote={workout => { setNoteWorkout(workout); setNoteDraft(workout.note ?? ''); }}/>{viewWorkout && <WorkoutDetails workout={viewWorkout} readOnly={readOnly} close={() => setViewWorkout(null)} edit={workout => { setEditWorkout(workout); setViewWorkout(null); }}/>}{noteWorkout && <div className="back calendar-note-overlay" onPointerDown={event => { if (event.button === 0 && event.target === event.currentTarget) dismissNote(); }}><form className="calendar-note-panel" role="dialog" aria-modal="true" aria-label="Workout note" onSubmit={event => { event.preventDefault(); void saveNote(); }}><header><h2>Workout note</h2><button type="button" aria-label="Close note" onClick={dismissNote}>×</button></header><p>{noteWorkout.name} · {noteWorkout.performed_on}</p><textarea autoFocus maxLength={1000} value={noteDraft} onChange={event => setNoteDraft(event.target.value)} placeholder="How did this workout go?"/><footer><button type="button" onClick={dismissNote}>Cancel</button><button className="primary" disabled={noteSaving}>{noteSaving ? 'Saving…' : 'Save note'}</button></footer></form></div>}{editWorkout && <div className="back calendar-editor" onPointerDown={event => { if (event.button === 0 && event.target === event.currentTarget) setEditWorkout(null); }}><div className="calendar-editor-panel"><WorkoutLogger workout={editWorkout} folders={folders} active={[]} start={start} startAdHoc={async () => undefined} setWorkout={setEditWorkout} editing finish={async () => undefined} saveEdit={async workout => { await api(`/workouts/${workout.id}`, { method: 'PATCH', body: JSON.stringify(workout) }); setEditWorkout(null); await onWorkoutSaved(workout.performed_on); }}/><button className="calendar-editor-close" onClick={() => setEditWorkout(null)}>×</button></div></div>}</>;
}
