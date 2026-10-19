import { useEffect, useRef, useState } from 'react';
import type { Workout } from './types';
import type { Exercise, ExerciseProgress } from '../exercises/types';
import { formatClockTime, formatRestDuration } from '../../shared/lib/format';
import { WeightInput } from './WeightInput';
import './workout-session.css';
type Props = {
 workout: Workout; editing: boolean; onChange: (workout: Workout) => void; open: number; onOpen: (index: number) => void; onRemoveExercise: () => void; previous: ExerciseProgress | null;
 onFinish: () => void; onPause?: () => void; onCancel?: () => void; pausing: boolean; error: string;
 restRemaining: number; onRest: (seconds: number) => void; onSkipRest: () => void;
 searchOpen: boolean; substituteIndex: number | null; onOpenSearch: (index: number | null) => void; onCloseSearch: () => void;
 query: string; onQuery: (query: string) => void; results: Exercise[]; onChoose: (exercise: Exercise) => void; searchLoading: boolean; searchError: string;
};
const muscle = (value?: string | null) => (value ?? '').replace(/^(?:(?:Primary|Secondary):\s*)+/i, '').split(' · ')[0].trim();
const progress = (item: Workout['exercises'][number]) => {
 const total = item.sets?.length ?? 0, checked = item.sets?.filter(set => set.completed).length ?? 0;
 return { total, checked, label: total > 0 && checked === total ? 'Completed' : checked ? 'In progress' : 'Not started' };
};
export function WorkoutSessionView(p: Props) {
 const {workout, editing, onChange, open, onOpen, onRemoveExercise, previous, onFinish, onPause, onCancel, pausing, error, restRemaining, onRest, onSkipRest, searchOpen, substituteIndex, onOpenSearch, onCloseSearch, query, onQuery, results, onChoose, searchLoading, searchError} = p;
 const [overview, setOverview] = useState(false);
 const [review, setReview] = useState(false);
 const dialog = useRef<HTMLElement>(null), heading = useRef<HTMLDivElement>(null);
 const addExerciseButton = useRef<HTMLButtonElement>(null);
 const closeSearchRef = useRef(onCloseSearch);
 useEffect(() => { closeSearchRef.current = onCloseSearch; }, [onCloseSearch]);
 const modalOpen = overview || searchOpen;
 useEffect(() => {
  if (!modalOpen) return;
  const trigger = document.activeElement as HTMLElement;
  const panel = dialog.current;
  (panel?.querySelector<HTMLElement>('input') ?? panel?.querySelector<HTMLElement>('button'))?.focus();
  const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
  const key = (event: KeyboardEvent) => {
   if (event.key === 'Escape') { setOverview(false); closeSearchRef.current(); }
   if (event.key !== 'Tab') return;
   const items = panel?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea');
   const first = items?.[0], last = items?.[items.length - 1];
   if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
   else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  document.addEventListener('keydown', key);
  return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); trigger?.focus({preventScroll: true}); };
 }, [modalOpen, searchOpen]);
 const navigate = (index: number) => { onOpen(index); requestAnimationFrame(() => heading.current?.scrollIntoView?.({block:'start'})); };
 const update = (index: number, patch: Partial<Workout['exercises'][number]>) => onChange({...workout, exercises: workout.exercises.map((item, i) => i === index ? {...item, ...patch} : item)});
 const item = workout.exercises[open];
 const lastSession = previous?.sessions.find(session => session.sets.some(set => set.weight > 0));
 const lastSets = lastSession?.sets ?? [];
 const lastTime = lastSets.length && lastSets.every(set => set.weight === lastSets[0].weight) ? `${lastSets[0].weight} kg × ${lastSets.map(set => set.reps).join(', ')}` : lastSets.map(set => `${set.weight} kg × ${set.reps}`).join(' · ');
 const completed = workout.exercises.filter(x => progress(x).label === 'Completed').length;
 const checked = workout.exercises.reduce((sum,x) => sum + progress(x).checked,0), total = workout.exercises.reduce((sum,x) => sum + progress(x).total,0);
 const checkedSets = workout.exercises.flatMap(exercise => exercise.sets ?? []).filter(set => set.completed);
 const totalReps = checkedSets.reduce((sum, set) => sum + set.reps, 0);
 const totalVolume = checkedSets.reduce((sum, set) => sum + set.weight * set.reps, 0);
 const formatStat = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
 return <section className="workout-session" onFocusCapture={event => { const target = event.target as HTMLElement; if(target.matches('input,textarea')) target.scrollIntoView?.({block:'nearest'}); }}>
  <header className="session-header"><p className="session-eyebrow">{editing ? 'EDIT WORKOUT' : 'ACTIVE WORKOUT'}</p><div className="session-title-row"><input aria-label="Workout name" className="session-title" value={workout.name} onChange={e => onChange({...workout,name:e.target.value})}/><div className="session-header-actions">{!editing && onPause && <button type="button" className="session-pause" aria-label="Pause session" disabled={pausing} onClick={onPause}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/></svg></button>}<button type="button" className="session-finish" aria-label={editing ? 'Save changes' : 'Finish workout ✓'} disabled={pausing} onClick={onFinish}>{editing ? 'Save' : 'Finish'}</button>{!editing && onCancel && <details className="session-menu"><summary aria-label="Workout actions">⋮</summary><div><button type="button" className="session-danger" disabled={pausing} onClick={onCancel}>Cancel workout</button></div></details>}</div></div><p className="session-meta">{pausing ? 'Saving session…' : editing ? workout.performed_on : `Started ${workout.started_at ? formatClockTime(workout.started_at) : 'now'} · Auto-saves`}</p></header>
  {error && <p role="alert" className="error">{error}</p>}
  {item ? <div className="session-navigation"><button type="button" className="session-selector" aria-haspopup="dialog" aria-expanded={overview} onClick={() => { setReview(false); setOverview(true); }}><span>Exercise {open + 1} of {workout.exercises.length}</span><b>{item.name}</b><span aria-hidden="true">⌄</span></button><div className="session-segments" aria-label="Exercise navigation">{workout.exercises.map((x,i) => {const state=progress(x); return <button type="button" key={i} aria-current={open === i ? 'step' : undefined} aria-label={`Exercise ${i+1}: ${x.name}, ${state.label}, ${state.checked} of ${state.total} sets`} onClick={() => navigate(i)}><span><i style={{width:`${state.total ? state.checked/state.total*100 : 0}%`}}/></span></button>;})}</div><div className="session-progress"><span>{completed} of {workout.exercises.length} exercises</span><span role="progressbar" aria-label="Workout progress" aria-valuemin={0} aria-valuemax={workout.exercises.length} aria-valuenow={workout.exercises.reduce((sum,x) => {const state=progress(x); return sum+(state.total ? state.checked/state.total : 0);},0)} aria-valuetext={`${checked} of ${total} sets completed`}>{checked} of {total} sets checked</span></div></div> : <p>No exercises yet. Add an exercise to get started.</p>}
  {restRemaining > 0 && <div className="session-rest" role="timer"><span>Rest <b>{formatRestDuration(restRemaining)}</b></span><button type="button" onClick={onSkipRest}>Skip</button></div>}
  {item && <article className="session-exercise expanded"><div className="session-exercise-heading" ref={heading}><button type="button" className="session-exercise-toggle" aria-expanded="true" onClick={() => { setReview(false); setOverview(true); }}><span className={`session-exercise-number ${progress(item).label === 'Completed' ? 'done' : ''}`}>{String(open+1).padStart(2,'0')}</span><span className="session-exercise-copy"><b>{item.name}</b><small>{[muscle(item.primary_muscle),...(item.secondary_muscles ?? []).slice(0,1).map(muscle)].filter(Boolean).join(' · ') || 'Exercise'}</small></span></button><details className="session-menu exercise-menu"><summary aria-label={`${item.name} actions`}>⋮</summary><div>{item.sets?.length ? item.sets.map((_,j) => <button type="button" key={j} className="session-danger" onClick={event => {update(open,{sets:item.sets?.filter((_,i) => i !== j)}); event.currentTarget.closest('details')?.removeAttribute('open');}}>Remove set {j+1}</button>) : <span>No sets to remove</span>}<button type="button" className="session-danger session-remove-exercise" onClick={event => {
    event.currentTarget.closest('details')?.removeAttribute('open');
    onRemoveExercise();
    requestAnimationFrame(() => {
     const target = heading.current?.querySelector<HTMLButtonElement>('button') ?? addExerciseButton.current;
     target?.focus({preventScroll:true});
     target?.scrollIntoView?.({block:'nearest'});
    });
   }}>Remove exercise</button></div></details></div>
  <div className="session-exercise-body">
  <div className="session-performance-row">
   {lastSession ? <details className="session-previous"><summary>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7.4M3 5v6h6"/><path d="M12 7v5l3 2"/></svg>
    <span className="session-last-copy"><span>Last time</span><b>{lastTime}</b></span>
   </summary><div><span>{lastSession.performed_on}</span><span>Best: {previous?.personal_best_weight} kg · est. 1RM {previous?.personal_best_1rm.toFixed(1)} kg</span></div></details> : <span className="session-history-empty">No previous sets</span>}
   {!editing && <button type="button" className="session-substitute" onClick={() => onOpenSearch(open)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/></svg>Substitute</button>}
  </div>
  <div className="session-set-labels" aria-hidden="true"><span>SET</span><span>KG</span><span>REPS</span><span>RPE</span><span>✓</span></div>
  {!item.sets?.length && <p className="session-meta">No sets yet. Add a set to track this exercise.</p>}
  {item.sets?.map((set,j) => { const changeSet = (patch: Partial<typeof set>) => update(open,{sets:item.sets?.map((entry,i) => i === j ? {...entry,...patch} : entry)}); return <div className={`session-set-row ${set.completed ? 'completed' : ''}`} key={j}><span>{j+1}</span><WeightInput value={set.weight} label={`${item.name} set ${j+1} weight in kg`} onChange={weight => changeSet({weight})}/><input aria-label={`${item.name} set ${j+1} reps`} inputMode="numeric" pattern="[0-9]*" value={set.reps || ''} placeholder="0" onChange={e => {if(/^\d*$/.test(e.target.value)) changeSet({reps:Number(e.target.value)});}}/><WeightInput value={set.exertion ?? 0} max={10} placeholder="—" label={`${item.name} set ${j+1} RPE`} onChange={exertion => changeSet({exertion})}/><label className="session-set-completion"><input type="checkbox" className="session-set-check" aria-label={`Complete ${item.name} set ${j+1}`} checked={Boolean(set.completed)} onChange={e => changeSet({completed:e.target.checked})}/></label></div>;})}
  <div className="session-exercise-actions"><button type="button" onClick={() => update(open,{sets:[...(item.sets ?? []),{weight:0,reps:0,completed:false}]})}>＋ Add set</button>{(item.rest_seconds ?? 90)>0 && <button type="button" className="session-rest-button" onClick={() => onRest(item.rest_seconds ?? 90)}>◷ Rest {formatRestDuration(item.rest_seconds ?? 90)}</button>}</div><details className="session-note"><summary>{item.note ? 'Edit note' : 'Add note'}</summary><textarea aria-label={`${item.name} note`} placeholder="How did this exercise feel?" value={item.note ?? ''} onChange={e => update(open,{note:e.target.value})}/></details></div></article>}
  {item && <nav className="session-step-controls" aria-label="Navigate exercises"><div><button type="button" disabled={open===0} onClick={() => navigate(open-1)}>‹ Previous</button><button type="button" className={progress(item).label === 'Completed' ? 'ready' : ''} onClick={() => { if (open === workout.exercises.length-1) { setReview(true); setOverview(true); } else navigate(open+1); }}>{open === workout.exercises.length-1 ? 'Review workout' : 'Next exercise ›'}</button></div></nav>}
  <button ref={addExerciseButton} type="button" className="session-add-exercise" onClick={() => onOpenSearch(null)}>＋ Add exercise</button>
  {modalOpen && <div className="session-search-overlay"><button type="button" className="session-search-backdrop" aria-label={overview ? (review ? 'Dismiss workout review' : 'Dismiss exercise overview') : 'Close add exercise panel'} onClick={() => {setOverview(false);onCloseSearch();}}/><section ref={dialog} role="dialog" aria-modal="true" aria-label={overview ? (review ? 'Workout review' : 'Exercise overview') : substituteIndex===null ? 'Add exercise' : 'Replace exercise'} className="session-search-panel"><header><div><h2>{overview ? (review ? 'Workout review' : 'Exercise overview') : substituteIndex===null ? 'Add exercise' : 'Replace exercise'}</h2>{!overview && substituteIndex!==null && <p>Replace {workout.exercises[substituteIndex]?.name}</p>}</div><button type="button" aria-label={overview ? (review ? 'Close workout review' : 'Close exercise overview') : substituteIndex===null ? 'Close exercise search' : 'Cancel substitution'} onClick={() => {setOverview(false);onCloseSearch();}}>×</button></header>
  {overview ? <>{review && <section className="session-review-stats" aria-label="Workout statistics">
   <h3>{workout.name}</h3>
   <dl>
    <div><dt>Exercises completed</dt><dd>{completed} / {workout.exercises.length}</dd></div>
    <div><dt>Sets completed</dt><dd>{checked} / {total}</dd></div>
    <div><dt>Total reps</dt><dd>{formatStat(totalReps)}</dd></div>
    <div><dt>Volume lifted</dt><dd>{formatStat(totalVolume)} <small>kg</small></dd></div>
   </dl>
   <p>Reps and volume include checked sets only.</p>
  </section>}<div className="session-overview-list">{workout.exercises.map((x,i) => {const state=progress(x);return <button type="button" key={i} aria-current={open===i ? 'step' : undefined} onClick={() => {setOverview(false);navigate(i);}}><span className="session-exercise-number">{String(i+1).padStart(2,'0')}</span><span><b>{x.name}</b><small>{state.checked} of {state.total} sets checked · {state.label}</small>{open===i && <small className="session-selected-label">Selected</small>}</span>{state.label === 'Completed' && <svg className="session-overview-check" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>}</button>;})}</div>{review && <button type="button" className="session-review-finish" disabled={pausing} onClick={onFinish}>{editing ? 'Save changes' : 'Finish workout'}</button>}</> : <><input type="search" aria-label={substituteIndex===null ? 'Search exercises' : 'Search replacement exercise'} value={query} onChange={e => onQuery(e.target.value)} placeholder="Search exercises…"/><div className="session-search-results">{searchLoading ? <p role="status">Searching…</p> : searchError ? <p role="alert">{searchError}</p> : results.length ? results.map(exercise => <button type="button" key={exercise.id} onClick={() => onChoose(exercise)}><span><b>{exercise.name}</b><small>{[muscle(exercise.primary_muscle),exercise.equipment].filter(Boolean).join(' · ')}</small></span><span>{substituteIndex===null ? '＋' : 'Replace'}</span></button>) : <p>{query.trim().length<2 ? 'Type at least two letters to find an exercise.' : 'No exercises found. Try another name.'}</p>}</div></>}
  </section></div>}
 </section>;
}
