import { DismissibleDetails } from '../../shared/ui/DismissibleDetails';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Workout } from './types';
import type { Exercise, ExerciseProgress } from '../exercises/types';
import { formatClockTime, formatRestDuration } from '../../shared/lib/format';
import { useScreenWakeLock } from '../../shared/lib/useScreenWakeLock';
import { useBackAction } from '../../shared/lib/backNavigation';
import { WeightInput } from './WeightInput';
import { ExerciseOrderControls } from '../../shared/ui/ExerciseOrderControls';
import './workout-session.css';
type Props = {
 workout: Workout; editing: boolean; onChange: (workout: Workout) => void; open: number; onOpen: (index: number) => void; onRemoveExercise: () => void; onPair: (index: number) => void; previous: ExerciseProgress | null;
 onFinish: () => void; onPause?: () => void; onCancel?: () => void; pausing: boolean; reloading?: boolean; onReloadSaved?: () => void; error: string;
 restRemaining: number; onRest: (seconds: number) => void; onSkipRest: () => void;
 onMoveExercise: (from: number, to: number) => void;
 searchOpen: boolean; substituteIndex: number | null; recentSubstitute: Exercise | null; onRevert: () => void; supersetSearch: boolean; onOpenSearch: (index: number | null, forSuperset?: boolean) => void; onCloseSearch: () => void;
 query: string; onQuery: (query: string) => void; results: Exercise[]; onChoose: (exercise: Exercise) => void; searchLoading: boolean; searchError: string;
};
const muscle = (value?: string | null) => (value ?? '').replace(/^(?:(?:Primary|Secondary):\s*)+/i, '').split(' · ')[0].trim();
const progress = (item: Workout['exercises'][number]) => {
 const total = item.sets?.filter(set => !set.is_warmup).length ?? 0, checked = item.sets?.filter(set => set.completed && !set.is_warmup).length ?? 0;
 return { total, checked, label: total > 0 && checked === total ? 'Completed' : checked ? 'In progress' : 'Not started' };
};
export function WorkoutSessionView(p: Props) {
 const {workout, editing, onChange, open, onOpen, onMoveExercise, onRemoveExercise, onPair, previous, onFinish, onPause, onCancel, pausing, reloading, onReloadSaved, error, restRemaining, onRest, onSkipRest, searchOpen, substituteIndex, recentSubstitute, onRevert, supersetSearch, onOpenSearch, onCloseSearch, query, onQuery, results, onChoose, searchLoading, searchError} = p;
 const [overview, setOverview] = useState(false);
 const [review, setReview] = useState(false);
 // Keep the phone awake between sets while a live workout is on screen.
 useScreenWakeLock(!editing);
 const dialog = useRef<HTMLElement>(null), heading = useRef<HTMLDivElement>(null);
 const exerciseSelector = useRef<HTMLButtonElement>(null);
 const addExerciseButton = useRef<HTMLButtonElement>(null);
 const dialogTrigger = useRef<HTMLButtonElement>(null);
 const closeSearchRef = useRef(onCloseSearch);
 useEffect(() => { closeSearchRef.current = onCloseSearch; }, [onCloseSearch]);
 const modalOpen = overview || searchOpen;
 useBackAction(modalOpen, () => { setOverview(false); onCloseSearch(); });
 useLayoutEffect(() => {
  if (!modalOpen) return;
  const trigger = dialogTrigger.current;
  const panel = dialog.current;
  const overflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const firstAction = panel?.querySelector<HTMLElement>('.session-recent-substitute')
   ?? panel?.querySelector<HTMLElement>('input') ?? panel?.querySelector<HTMLElement>('button');
  firstAction?.focus({ preventScroll: true });
  const key = (event: KeyboardEvent) => {
   if (event.key === 'Escape') { setOverview(false); closeSearchRef.current(); }
   if (event.key !== 'Tab') return;
   const items = panel?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea');
   const first = items?.[0], last = items?.[items.length - 1];
   if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
   else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  document.addEventListener('keydown', key);
  return () => {
   document.body.style.overflow = overflow;
   document.removeEventListener('keydown', key);
   if (trigger?.isConnected) trigger.focus({ preventScroll: true });
  };
 }, [modalOpen, searchOpen]);
 const openExerciseSearch = (trigger: HTMLButtonElement, index: number | null, forSuperset = false) => {
  dialogTrigger.current = trigger;
  // iOS opens the keyboard only if focus happens in the originating tap.
  flushSync(() => onOpenSearch(index, forSuperset));
 };
 const chooseExercise = (exercise: Exercise) => {
  onChoose(exercise);
  if (substituteIndex !== null) return;
  requestAnimationFrame(() => {
   const selector = exerciseSelector.current;
   selector?.focus({ preventScroll: true });
   selector?.scrollIntoView?.({ block: 'nearest' });
  });
 };
 const openOverview = (trigger: HTMLButtonElement, showReview = false) => {
  dialogTrigger.current = trigger;
  setReview(showReview);
  setOverview(true);
 };
 const goToMissing = (index: number) => {
  setOverview(false);
  onOpen(index);
  requestAnimationFrame(() => {
   const row = heading.current?.closest('article')?.querySelector<HTMLElement>('.session-set-row:not(.warmup):not(.completed)');
   if (!row) { heading.current?.scrollIntoView?.({block:'start'}); return; }
   row.scrollIntoView?.({block:'center'});
   row.querySelector<HTMLInputElement>('.session-set-check')?.focus({preventScroll:true});
   row.classList.remove('session-set-missing');
   void row.offsetWidth;
   row.classList.add('session-set-missing');
   row.addEventListener('animationend', () => row.classList.remove('session-set-missing'), {once:true});
  });
 };
 const navigate = (index: number) => { onOpen(index); requestAnimationFrame(() => heading.current?.scrollIntoView?.({block:'start'})); };
 const update = (index: number, patch: Partial<Workout['exercises'][number]>) => onChange({...workout, exercises: workout.exercises.map((item, i) => i === index ? {...item, ...patch} : item)});
 const item = workout.exercises[open];
 const partnerIndex = item?.superset_id ? workout.exercises.findIndex((other, index) => index !== open && other.superset_id === item.superset_id) : -1;
 const lastSession = previous?.sessions.find(session => session.sets.some(set => set.weight > 0));
 const lastSets = lastSession?.sets ?? [];
 const lastTime = lastSets.length && lastSets.every(set => set.weight === lastSets[0].weight) ? `${lastSets[0].weight} kg × ${lastSets.map(set => set.reps).join(', ')}` : lastSets.map(set => `${set.weight} kg × ${set.reps}`).join(' · ');
 const completed = workout.exercises.filter(x => progress(x).label === 'Completed').length;
 const checked = workout.exercises.reduce((sum,x) => sum + progress(x).checked,0), total = workout.exercises.reduce((sum,x) => sum + progress(x).total,0);
 const checkedSets = workout.exercises.flatMap(exercise => exercise.sets ?? []).filter(set => set.completed && !set.is_warmup);
 const totalReps = checkedSets.reduce((sum, set) => sum + set.reps, 0);
 const totalVolume = checkedSets.reduce((sum, set) => sum + set.weight * set.reps, 0);
 const missing = workout.exercises.map((x,i) => ({index:i, name:x.name, ...progress(x)})).filter(x => x.checked < x.total);
 const formatStat = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
 return <section className="workout-session" onFocusCapture={event => {
  const target = event.target;
  if (!window.matchMedia?.('(max-width: 760px)').matches && !dialog.current?.contains(target) && target.matches('input:not([type="checkbox"]), textarea')) {
   target.scrollIntoView?.({ block: 'nearest' });
  }
 }}>
  <header className="session-header"><p className="session-eyebrow">{editing ? 'EDIT WORKOUT' : 'ACTIVE WORKOUT'}</p><div className="session-title-row"><input aria-label="Workout name" className="session-title" value={workout.name} onChange={e => onChange({...workout,name:e.target.value})}/><div className="session-header-actions">{!editing && onPause && <button type="button" className="session-pause" aria-label="Pause session" disabled={pausing} onClick={onPause}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/></svg></button>}<button type="button" className="session-finish" aria-label={editing ? 'Save changes' : 'Finish workout ✓'} disabled={pausing} onClick={onFinish}>{editing ? 'Save' : 'Finish'}</button>{!editing && onCancel && <DismissibleDetails closeOnAction className="session-menu"><summary aria-label="Workout actions">⋮</summary><div><button type="button" className="session-danger" disabled={pausing} onClick={onCancel}>Cancel workout</button></div></DismissibleDetails>}</div></div><p className="session-meta">{reloading ? 'Reloading saved workout…' : pausing ? 'Saving session…' : editing ? workout.performed_on : `Started ${workout.started_at ? formatClockTime(workout.started_at) : 'now'} · Auto-saves`}</p></header>
  {error && <p role="alert" className="error">{error}{error.includes("409") && onReloadSaved && <button type="button" disabled={pausing} onClick={onReloadSaved}>{reloading ? 'Reloading…' : 'Reload saved workout'}</button>}</p>}
  {item ? <div className="session-navigation"><button type="button" className="session-selector" ref={exerciseSelector} aria-haspopup="dialog" aria-expanded={overview} onClick={event => openOverview(event.currentTarget)}><span>Exercise {open + 1} of {workout.exercises.length}</span><b>{item.name}</b><span aria-hidden="true">⌄</span></button><div className="session-segments" aria-label="Exercise navigation">{workout.exercises.map((x,i) => {const state=progress(x); return <button type="button" key={i} aria-current={open === i ? 'step' : undefined} aria-label={`Exercise ${i+1}: ${x.name}, ${state.label}, ${state.checked} of ${state.total} sets`} onClick={() => onOpen(i)}><span><i style={{width:`${state.total ? state.checked/state.total*100 : 0}%`}}/></span></button>;})}</div><div className="session-progress"><span>{completed} of {workout.exercises.length} exercises</span><span role="progressbar" aria-label="Workout progress" aria-valuemin={0} aria-valuemax={workout.exercises.length} aria-valuenow={workout.exercises.reduce((sum,x) => {const state=progress(x); return sum+(state.total ? state.checked/state.total : 0);},0)} aria-valuetext={`${checked} of ${total} sets completed`}>{checked} of {total} sets checked</span></div></div> : <p>No exercises yet. Add an exercise to get started.</p>}
  {restRemaining > 0 && <div className="session-rest" role="timer"><span>Rest <b>{formatRestDuration(restRemaining)}</b></span><button type="button" onClick={onSkipRest}>Skip</button></div>}
  {item && <article className="session-exercise expanded"><div className="session-exercise-heading" ref={heading}><button type="button" className="session-exercise-toggle" aria-expanded="true" onClick={event => openOverview(event.currentTarget)}><span className={`session-exercise-number ${progress(item).label === 'Completed' ? 'done' : ''}`}>{String(open+1).padStart(2,'0')}</span><span className="session-exercise-copy"><b>{item.name}</b><small>{[muscle(item.primary_muscle),...(item.secondary_muscles ?? []).slice(0,1).map(muscle)].filter(Boolean).join(' · ') || 'Exercise'}</small></span></button><DismissibleDetails closeOnAction className="session-menu exercise-menu"><summary aria-label={`${item.name} actions`}>⋮</summary><div>{item.sets?.length ? item.sets.map((_,j) => <button type="button" key={j} className="session-danger" onClick={() => update(open,{sets:item.sets?.filter((_,i) => i !== j)})}>Remove set {j+1}</button>) : <span>No sets to remove</span>}<button type="button" className="session-danger session-remove-exercise" onClick={event => {
    event.currentTarget.closest('details')?.removeAttribute('open');
    onRemoveExercise();
    requestAnimationFrame(() => {
     const target = heading.current?.querySelector<HTMLButtonElement>('button') ?? addExerciseButton.current;
     target?.focus({preventScroll:true});
     target?.scrollIntoView?.({block:'nearest'});
    });
   }}>Remove exercise</button></div></DismissibleDetails></div>
  <div className="session-exercise-body">
  {partnerIndex >= 0 && <div className="session-superset"><span>Superset with <b>{workout.exercises[partnerIndex].name}</b></span><button type="button" onClick={() => navigate(partnerIndex)}>Switch exercise</button><button type="button" onClick={() => onChange({...workout, exercises: workout.exercises.map(exercise => exercise.superset_id === item.superset_id ? {...exercise, superset_id:null} : exercise)})}>Unlink superset</button></div>}
  <div className="session-performance-row">
   {lastSession ? <DismissibleDetails className="session-previous"><summary>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7.4M3 5v6h6"/><path d="M12 7v5l3 2"/></svg>
    <span className="session-last-copy"><span>Last time</span><b>{lastTime}</b></span>
   </summary><div><span>{lastSession.performed_on}</span><span>Best: {previous?.personal_best_weight} kg · est. 1RM {previous?.personal_best_1rm.toFixed(1)} kg</span></div></DismissibleDetails> : <span className="session-history-empty">No previous sets</span>}
   {!editing && <button type="button" className="session-substitute" disabled={pausing} aria-label={item.substituted_from ? `Revert to ${item.substituted_from.name}` : undefined} onClick={item.substituted_from ? onRevert : event => openExerciseSearch(event.currentTarget, open)}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.substituted_from ? "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2" : "M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"}/></svg>
    {item.substituted_from ? 'Revert' : 'Substitute'}
   </button>}
  </div>
  <button type="button" className="session-add-warmup" onClick={() => {const sets = item.sets ?? []; const index = sets.findIndex(set => !set.is_warmup); update(open,{sets:[...sets.slice(0,index < 0 ? sets.length : index),{weight:0,reps:0,completed:false,is_warmup:true},...sets.slice(index < 0 ? sets.length : index)]});}}>＋ Add warm-up set</button>
  <div className="session-set-labels" aria-hidden="true"><span>SET</span><span>KG</span><span>REPS</span><span>RPE</span><span>✓</span></div>
  {!item.sets?.length && <p className="session-meta">No sets yet. Add a set to track this exercise.</p>}
  {item.sets?.map((set,j) => { const changeSet = (patch: Partial<typeof set>) => update(open,{sets:item.sets?.map((entry,i) => i === j ? {...entry,...patch} : entry)}); const number = item.sets!.slice(0,j+1).filter(entry => entry.is_warmup === set.is_warmup).length; const label = `${item.name} ${set.is_warmup ? 'warm-up' : 'set'} ${number}`; return <div className={`session-set-row ${set.completed ? 'completed' : ''} ${set.is_warmup ? 'warmup' : ''}`} key={j}><span>{set.is_warmup ? 'Warm-up' : number}</span><WeightInput value={set.weight} label={`${label} weight in kg`} onChange={weight => changeSet({weight})}/><input aria-label={`${label} reps`} inputMode="numeric" pattern="[0-9]*" value={set.reps || ''} placeholder="0" onChange={e => {if(/^\d*$/.test(e.target.value)) changeSet({reps:Number(e.target.value)});}}/><WeightInput value={set.exertion ?? 0} max={10} placeholder="—" label={`${label} RPE`} onChange={exertion => changeSet({exertion})}/><label className="session-set-completion"><input type="checkbox" className="session-set-check" aria-label={`Complete ${label}`} checked={Boolean(set.completed)} onChange={e => changeSet({completed:e.target.checked})}/></label></div>;})}
  <div className="session-exercise-actions"><button type="button" onClick={() => update(open,{sets:[...(item.sets ?? []),{weight:0,reps:0,completed:false}]})}>＋ Add set</button>{partnerIndex < 0 && <button type="button" onClick={event => openExerciseSearch(event.currentTarget, null, true)}>＋ Add superset</button>}{(item.rest_seconds ?? 90)>0 && <button type="button" className="session-rest-button" onClick={() => onRest(item.rest_seconds ?? 90)}>◷ Rest {formatRestDuration(item.rest_seconds ?? 90)}</button>}</div><DismissibleDetails className="session-note"><summary>{item.note ? 'Edit note' : 'Add note'}</summary><textarea aria-label={`${item.name} note`} placeholder="How did this exercise feel?" value={item.note ?? ''} onChange={e => update(open,{note:e.target.value})}/></DismissibleDetails></div></article>}
  {item && <nav className="session-step-controls" aria-label="Navigate exercises"><div><button type="button" disabled={open===0} onClick={() => navigate(open-1)}>‹ Previous</button><button type="button" className={progress(item).label === 'Completed' ? 'ready' : ''} onClick={event => { if (open === workout.exercises.length-1) openOverview(event.currentTarget, true); else navigate(open+1); }}>{open === workout.exercises.length-1 ? 'Review workout' : 'Next exercise ›'}</button></div></nav>}
  <button ref={addExerciseButton} type="button" className="session-add-exercise" onClick={event => openExerciseSearch(event.currentTarget, null)}>＋ Add exercise</button>
  {modalOpen && <div className="session-search-overlay"><button type="button" className="session-search-backdrop" aria-label={overview ? (review ? 'Dismiss workout review' : 'Dismiss exercise overview') : 'Close add exercise panel'} onClick={() => {setOverview(false);onCloseSearch();}}/><section ref={dialog} role="dialog" aria-modal="true" aria-label={overview ? (review ? 'Workout review' : 'Exercise overview') : supersetSearch ? 'Add superset exercise' : substituteIndex===null ? 'Add exercise' : 'Replace exercise'} className="session-search-panel"><header><div><h2>{overview ? (review ? 'Workout review' : 'Exercise overview') : supersetSearch ? 'Add superset exercise' : substituteIndex===null ? 'Add exercise' : 'Replace exercise'}</h2>{!overview && substituteIndex!==null && <p>Replace {workout.exercises[substituteIndex]?.name}</p>}</div><button type="button" aria-label={overview ? (review ? 'Close workout review' : 'Close exercise overview') : substituteIndex===null ? 'Close exercise search' : 'Cancel substitution'} onClick={() => {setOverview(false);onCloseSearch();}}>×</button></header>
  {overview ? <>{review && <section className="session-review-stats" aria-label="Workout statistics">
   <h3>{workout.name}</h3>
   <dl>
    <div><dt>Exercises completed</dt><dd>{completed} / {workout.exercises.length}</dd></div>
    <div><dt>Sets completed</dt><dd>{checked} / {total}</dd></div>
    <div><dt>Total reps</dt><dd>{formatStat(totalReps)}</dd></div>
    <div><dt>Volume lifted</dt><dd>{formatStat(totalVolume)} <small>kg</small></dd></div>
   </dl>
   <p>Reps and volume include checked sets only.</p>
  </section>}{review && missing.length > 0 && <section className="session-review-missing" aria-label="Unchecked exercises">
   <h3><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>{missing.length === 1 ? '1 exercise has' : `${missing.length} exercises have`} unchecked sets</h3>
   <p>Tap an exercise to jump to the first set without a check mark.</p>
   <ul>{missing.map(x => <li key={x.index}><button type="button" aria-label={`Go to ${x.name}, ${x.total - x.checked} of ${x.total} sets unchecked`} onClick={() => goToMissing(x.index)}><span className="session-exercise-number">{String(x.index+1).padStart(2,'0')}</span><span><b>{x.name}</b><small>{x.total - x.checked} of {x.total} {x.total === 1 ? 'set' : 'sets'} unchecked</small></span><span aria-hidden="true">›</span></button></li>)}</ul>
  </section>}{workout.exercises.length > 1 && <p className="session-order-hint">Use the arrows to change exercise order.</p>}<div className="session-overview-list">{workout.exercises.map((x,i) => {const state=progress(x);return <div className="session-overview-row" key={`${x.exercise_id ?? x.cached_exercise_id ?? x.name}-${workout.exercises.slice(0,i).filter(entry => (entry.exercise_id ?? entry.cached_exercise_id ?? entry.name) === (x.exercise_id ?? x.cached_exercise_id ?? x.name)).length}`}><button type="button" aria-current={open===i ? 'step' : undefined} onClick={() => {setOverview(false);navigate(i);}}><span className="session-exercise-number">{String(i+1).padStart(2,'0')}</span><span><b>{x.name}</b><small>{state.checked} of {state.total} sets checked · {state.label}</small>{open===i && <small className="session-selected-label">Selected</small>}</span>{state.label === 'Completed' && <svg className="session-overview-check" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>}</button>{workout.exercises.length > 1 && <ExerciseOrderControls name={x.name} index={i} count={workout.exercises.length} disabled={pausing} onMove={onMoveExercise}/>}</div>;})}</div>{review && <button type="button" className="session-review-finish" disabled={pausing} onClick={onFinish}>{editing ? 'Save changes' : 'Finish workout'}</button>}</> : <>
   <input type="search" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" aria-label={substituteIndex===null ? 'Search exercises' : 'Search replacement exercise'} value={query} onChange={e => onQuery(e.target.value)} placeholder={supersetSearch ? 'Search an exercise to pair…' : 'Search exercises…'}/>
   <div className="session-search-results">
    {recentSubstitute && <button type="button" className="session-recent-substitute" onClick={() => onChoose(recentSubstitute)}>
     <span><b>{recentSubstitute.name}</b><small>Last substitute</small></span><span>Replace</span>
    </button>}
    {supersetSearch && query.trim() && workout.exercises.map((exercise, index) => index !== open && !exercise.superset_id && exercise.name.toLowerCase().includes(query.trim().toLowerCase()) ? <button type="button" key={`workout-${index}`} aria-label={`Pair with ${exercise.name} in this workout`} onClick={() => {onPair(index); onCloseSearch();}}><span><b>{exercise.name}</b><small>In this workout</small></span><span>Pair</span></button> : null)}
    {searchLoading ? <p role="status">Searching…</p> : searchError ? <p role="alert">{searchError}</p> : results.length ? results.filter(exercise => exercise.id !== recentSubstitute?.id).map(exercise => <button type="button" key={exercise.id} onClick={() => chooseExercise(exercise)}><span><b>{exercise.name}</b><small>{[muscle(exercise.primary_muscle),exercise.equipment].filter(Boolean).join(' · ')}</small></span><span>{substituteIndex===null ? '＋' : 'Replace'}</span></button>) : query.trim().length >= 2 ? <p>No other exercises found.</p> : !recentSubstitute && <p>Type an exercise name to choose it.</p>}
   </div>
  </>}
  </section></div>}
 </section>;
}
