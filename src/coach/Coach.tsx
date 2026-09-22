import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CoachController } from './useCoachController';
import type { Proposal } from './types';
import { exerciseChange, exerciseId, exerciseRemoved, prescriptionChanged } from './proposal';
import { proposalsForMessage } from './timeline';
import './coach.css';

type Folder = { id: number; name: string; routines: { id: number; name: string; folder_id?: number | null; exercises: { exercise_id?: number; exercise?: { id: number; name: string }; planned_sets?: number; target_reps_min?: number; target_reps_max?: number; target_weight?: number; rest_seconds?: number }[] }[] };
type WeeklyPlan = { name: string; days: { weekday: number; routine_id: number; routine_name: string }[] } | null;
type Props = { coach: CoachController; folders: Folder[]; plan: WeeklyPlan };
const prompts = ['Review my current training volume.', 'Why has my bench press stalled?', 'Suggest improvements to my weekly plan.'];
const label = (operation: string) => operation.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
const dateLabel = (date: string) => new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function ProposalCard({ proposal, coach, id, folders, plan }: { proposal: Proposal; coach: CoachController; id: number; folders: Folder[]; plan: WeeklyPlan }) {
  const [catalogue, setCatalogue] = useState<Record<number, string>>({});
  const data = proposal.payload as Record<string, unknown>;
  const programRoutines = Array.isArray(data.routines) ? data.routines as Record<string, unknown>[] : [];
  const exercises = Array.isArray(data.exercises) ? data.exercises as Record<string, unknown>[] : programRoutines.flatMap(routine => Array.isArray(routine.exercises) ? routine.exercises as Record<string, unknown>[] : []);
  const known = new Map<number, string>();
  folders.forEach(folder => folder.routines.forEach(routine => routine.exercises.forEach(item => { if (item.exercise?.id) known.set(item.exercise.id, item.exercise.name); })));
  useEffect(() => {
    const unresolved = exercises.some(item => typeof item.exercise_id === 'number' && !known.has(item.exercise_id) && !catalogue[item.exercise_id]);
    if (!unresolved) return;
    let alive = true;
    void fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/exercises`).then(response => response.json()).then((items: { id: number; name: string }[]) => {
      if (alive) setCatalogue(Object.fromEntries(items.map(item => [item.id, item.name])));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [proposal.id, folders]);
  const status = coach.outdated[proposal.id] ? 'outdated' : proposal.status;
  const target = folders.flatMap(folder => folder.routines).find(routine => routine.id === proposal.target_routine_id);
  const describe = (item: Record<string, unknown>) => {
    const id = exerciseId(item);
    const reps = item.target_reps_min === item.target_reps_max ? item.target_reps_min : `${item.target_reps_min ?? '—'}–${item.target_reps_max ?? '—'}`;
    const nested = item.exercise as { name?: string } | undefined;
    const name = nested?.name ?? (id === null ? 'Unknown exercise' : known.get(id) ?? catalogue[id] ?? `Exercise #${id}`);
    return `${name} · ${item.planned_sets ?? '—'} sets × ${reps} reps${item.target_weight ? ` · ${item.target_weight} kg` : ''} · ${item.rest_seconds ?? 90}s rest`;
  };
  const proposedFolderId = data.folder_id === null && data._folder_id_explicit !== true && target ? target.folder_id : data.folder_id;
  return <article className={`coach-proposal ${proposal.operation === 'delete_routine' ? 'danger' : ''}`}>
    <div className="coach-proposal-head"><b>{label(proposal.operation)}</b><span>{status}</span></div>
    <p>{proposal.summary}</p>
    {proposal.reasoning && <div className="coach-proposal-reasoning"><strong>Why this change</strong><p>{proposal.reasoning}</p></div>}
    {proposal.operation === 'delete_routine' && <p><b>{target?.name ?? `Routine #${proposal.target_routine_id}`}</b> · {target?.exercises.length ?? 'Unknown'} exercises will be removed.</p>}
    {(proposal.operation === 'create_routine' || proposal.operation === 'update_routine') && <div className="coach-proposal-detail">
      {proposal.operation === 'update_routine' && target && <div><strong>Current · {target.name}</strong><ol>{target.exercises.map((item, index) => <li key={index}>{describe(item as Record<string, unknown>)}{exerciseRemoved(item, exercises) && <em> · Removed</em>}</li>)}</ol></div>}
      <div><strong>{proposal.operation === 'update_routine' ? 'Proposed' : 'New'} · {String(data.name ?? 'Routine')}</strong><small>Folder: {folders.find(folder => folder.id === proposedFolderId)?.name ?? 'None'}</small><ol>{exercises.map((item, index) => <li key={index}>{describe(item)}{target && exerciseChange(target.exercises, exercises, index) === 'added' && <em> · Added</em>}{target && exerciseChange(target.exercises, exercises, index) === 'moved' && <em> · Moved</em>}{target && prescriptionChanged(target.exercises, item) && <em> · Changed</em>}</li>)}</ol></div>
    </div>}
    {proposal.operation === 'update_weekly_plan' && <div className="coach-proposal-detail"><div><strong>Current · {plan?.name ?? 'No plan'}</strong>{[0,1,2,3,4,5,6].map(day => <p key={day}>{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day]}: {plan?.days.find(item => item.weekday === day)?.routine_name ?? 'Rest'}</p>)}</div><div><strong>Proposed · {String(data.name ?? 'Weekly plan')}</strong>{[0,1,2,3,4,5,6].map(day => { const entry = Array.isArray(data.days) ? (data.days as Record<string, unknown>[]).find(item => item.weekday === day) : undefined; return <p key={day}>{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day]}: {entry ? folders.flatMap(folder => folder.routines).find(routine => routine.id === entry.routine_id)?.name ?? `Routine #${entry.routine_id}` : 'Rest'}</p>; })}</div></div>}
    {proposal.operation === 'create_training_program' && (() => {
      const routines = Array.isArray(data.routines) ? data.routines as Record<string, unknown>[] : [];
      const weekly = data.weekly_plan as Record<string, unknown> | undefined;
      const days = Array.isArray(weekly?.days) ? weekly.days as Record<string, unknown>[] : [];
      const dates = Array.isArray(data.dates) ? data.dates as Record<string, unknown>[] : [];
      const routineName = (index: unknown) => String(routines[Number(index)]?.name ?? 'Unknown workout');
      return <div className="coach-proposal-detail"><div><strong>New folder · {String(data.folder_name ?? '')}</strong>{routines.map((routine, index) => <div key={index}><p><b>{String(routine.name ?? 'Workout')}</b></p><ol>{(Array.isArray(routine.exercises) ? routine.exercises as Record<string, unknown>[] : []).map((item, exerciseIndex) => <li key={exerciseIndex}>{describe(item)}</li>)}</ol></div>)}</div><div><strong>Calendar placement</strong>{weekly && <><p>Recurring · {String(weekly.name ?? 'Weekly plan')} from {String(weekly.starts_on ?? '')}</p>{days.map((day, index) => <p key={index}>{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][Number(day.weekday)]}: {routineName(day.routine_index)}</p>)}</>}{dates.map((entry, index) => <p key={index}>{String(entry.date)}: {routineName(entry.routine_index)}</p>)}{!weekly && !dates.length && <p>No calendar dates selected.</p>}</div></div>;
    })()}
    {status === 'outdated' && <small>This plan changed. Ask the coach for a fresh proposal.</small>}
    {status === 'pending' && <div className="coach-proposal-actions"><button disabled={coach.pending[proposal.id]} onClick={() => void coach.resolve(id, proposal, 'reject')}>Reject</button><button className="primary" disabled={coach.pending[proposal.id]} onClick={() => void coach.resolve(id, proposal, 'confirm')}>{coach.pending[proposal.id] ? 'Saving…' : 'Confirm change'}</button></div>}
  </article>;
}

export function Coach({ coach, folders, plan }: Props) {
  const [drawer, setDrawer] = useState(false);
  const [input, setInput] = useState('');
  const [nearBottom, setNearBottom] = useState(true);
  const timeline = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const id = coach.selectedId;
  const detail = id ? coach.details[id] : null;
  const messages = detail?.messages ?? [];
  const proposals = detail?.proposals ?? [];
  useEffect(() => { void coach.load(); }, [coach.load]);
  useEffect(() => { if (id && !detail) void coach.refresh(id); }, [id, detail, coach.refresh]);
  useEffect(() => { if (nearBottom && timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight; }, [id, messages.length, id && coach.drafts[id], nearBottom]);
  const submit = async (value = input) => {
    const text = value.trim(); if (!text || text.length > 4000 || (id && coach.streaming[id])) return;
    setInput('');
    try { await coach.send(text, id); composer.current?.focus(); } catch (error) { setInput(text); window.alert((error as Error).message); }
  };
  const list = <div className="coach-list"><div className="coach-list-head"><span>CONVERSATIONS</span><button onClick={() => { void coach.create().then(() => setDrawer(false)); }}>＋ New chat</button></div>{coach.loading ? <div className="coach-skeleton">Loading conversations…</div> : coach.conversations.length ? coach.conversations.map(item => <div className={`coach-thread ${id === item.id ? 'active' : ''}`} key={item.id}><button className="coach-thread-select" onClick={() => { void coach.select(item.id); setDrawer(false); }}><b>{item.title}</b><small>{dateLabel(item.updated_at)} {coach.streaming[item.id] && <span className="coach-dot" aria-label="Generating"/>}</small></button><button className="coach-delete" aria-label={`Delete ${item.title}`} disabled={Boolean(coach.streaming[item.id]) || item.status === 'generating'} onClick={() => void coach.remove(item.id)}>×</button></div>) : <p className="coach-list-empty">No chats yet. Start a new conversation.</p>}</div>;
  return <section className="coach-page"><aside className="coach-desktop-list">{list}</aside><div className="coach-chat"><header className="coach-header"><button className="coach-drawer-button" aria-label="Open conversations" onClick={() => setDrawer(true)}>☰</button><div><span className="overline">AI TRAINING COACH</span><h1>{detail?.title ?? 'Your training coach'}</h1></div><button className="coach-mobile-new" aria-label="New chat" onClick={() => void coach.create()}>＋</button></header>
    <div className="coach-timeline" ref={timeline} onScroll={event => { const node = event.currentTarget; setNearBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 110); }}>
      {!messages.length && !coach.optimistic[id ?? -1] && <div className="coach-welcome"><span>✦</span><h2>Let's talk training.</h2><p>Ask about your workouts, progress, routines, or weekly plan.</p><div>{prompts.map(prompt => <button key={prompt} onClick={() => { setInput(prompt); composer.current?.focus(); }}>{prompt}</button>)}</div></div>}
      {messages.map((message, index) => <div key={message.id} className={`coach-message ${message.role} ${message.status}`}><div className="coach-bubble">{message.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => /^https?:\/\//i.test(url) ? url : ''} components={{ a: props => <a {...props} target="_blank" rel="noreferrer noopener"/> }}>{message.content}</ReactMarkdown> : message.content}</div>{message.status !== 'completed' && <small>{message.status} {message.role === 'assistant' && (message.status === 'failed' || message.status === 'interrupted') && <button className="coach-retry" onClick={() => { const previous = messages.slice(0, index).reverse().find(item => item.role === 'user'); if (previous && id) void coach.send(previous.content, id); }}>Retry</button>}</small>}{message.role === 'assistant' && proposalsForMessage(proposals, messages, message.id).map(proposal => <ProposalCard key={proposal.id} proposal={proposal} coach={coach} id={id!} folders={folders} plan={plan}/>)}</div>)}
      {id && coach.optimistic[id] && <div className="coach-message user"><div className="coach-bubble">{coach.optimistic[id]}</div></div>}
      {id && (coach.drafts[id] || coach.streaming[id]) && <div className="coach-message assistant" aria-live="polite"><div className="coach-bubble"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => /^https?:\/\//i.test(url) ? url : ''}>{coach.drafts[id] || 'Thinking…'}</ReactMarkdown></div></div>}
      {id && coach.proposalNotice[id] && coach.streaming[id] && <div className="coach-activity" role="status">✦ Preparing proposal details…</div>}
      {id && coach.activity[id] && <div className="coach-activity" role="status">✦ {label(coach.activity[id])}…</div>}
      {coach.errors[id ?? 0] && <div className="coach-error" role="alert">{coach.errors[id ?? 0]}{id && <button onClick={() => { const last = [...messages].reverse().find(message => message.role === 'user'); if (last) void coach.send(last.content, id); }}>Retry</button>}</div>}
    </div>
    {!nearBottom && <button className="coach-jump" onClick={() => { if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight; setNearBottom(true); }}>Jump to latest ↓</button>}
    <form className="coach-composer" onSubmit={event => { event.preventDefault(); void submit(); }}><textarea ref={composer} aria-label="Message your coach" placeholder="Ask about your training…" maxLength={4000} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }}/><div><small>{input.length}/4000</small><button type="submit" className="primary" disabled={!input.trim() || Boolean(id && coach.streaming[id])}>Send ↗</button></div></form></div>
    {drawer && <div className="coach-drawer-wrap"><button className="coach-drawer-backdrop" aria-label="Close conversations" onClick={() => setDrawer(false)}/><aside className="coach-drawer"><button className="coach-drawer-close" onClick={() => setDrawer(false)}>Close ×</button>{list}</aside></div>}
  </section>;
}
