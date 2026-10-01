import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CoachController } from './useCoachController';
import type { Proposal } from './types';
import { exerciseChange, exerciseId, exerciseRemoved, prescriptionChanged } from './proposal';
import { proposalsForMessage } from './timeline';
import { authHeaders } from '../auth/auth';
import './coach.css';

type Folder = { id: number; name: string; routines: { id: number; name: string; folder_id?: number | null; exercises: { exercise_id?: number; exercise?: { id: number; name: string }; planned_sets?: number; target_reps_min?: number; target_reps_max?: number; target_weight?: number; rest_seconds?: number }[] }[] };
type WeeklyPlan = { name: string; days: { weekday: number; routine_id: number; routine_name: string }[] } | null;
type Props = { coach: CoachController; folders: Folder[]; plan: WeeklyPlan };
const prompts = [
  { label: 'Review training volume', text: 'Review my current training volume.', icon: 'chart' },
  { label: 'Bench press stalled', text: 'Why has my bench press stalled?', icon: 'dumbbell' },
  { label: 'Improve weekly plan', text: 'Suggest improvements to my weekly plan.', icon: 'calendar' },
] as const;
const label = (operation: string) => operation.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
const dateLabel = (date: string) => {
  const days = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));
  if (!Number.isFinite(days)) return '';
  if (days === 0) return 'Today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
function CoachIcon({ name }: { name: 'chat' | 'chart' | 'dumbbell' | 'calendar' | 'arrow' | 'plus' }) {
  const paths = {
    chat: <><path d="M20 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-3.6-.8L4 20l.8-3.9A8.5 8.5 0 1 1 20 11.5Z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01"/></>,
    chart: <><path d="M5 20v-6M10 20V9M15 20V4M20 20v-9"/></>,
    dumbbell: <><path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></>,
    arrow: <path d="M12 20V4m0 0-6 6m6-6 6 6"/>,
    plus: <path d="M12 4v16M4 12h16"/>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
const progressLabel = (activity: string | undefined, hasDraft: boolean, hasProposal: boolean) => {
  if (activity === 'stopping') return 'Stopping response…';
  if (activity === 'saving_response') return 'Finishing response…';
  if (activity === 'writing_response') return 'Writing response…';
  if (activity === 'proposal_ready') return 'Proposal ready. Preparing reply…';
  if (activity === 'reviewing_results') return 'Reviewing what I found…';
  if (activity?.startsWith('propose_')) return 'Preparing a change for your review…';
  if (activity === 'search_exercises') return 'Finding suitable exercises…';
  if (activity === 'list_routines' || activity === 'get_routine' || activity === 'get_weekly_plan') return 'Reviewing your plan…';
  if (activity?.startsWith('get_')) return 'Reviewing your training data…';
  return hasDraft ? 'Writing response…' : hasProposal ? 'Proposal ready. Preparing reply…' : 'Thinking through your training…';
};

export function ProposalCard({ proposal, coach, id, folders, plan }: { proposal: Proposal; coach: CoachController; id: number; folders: Folder[]; plan: WeeklyPlan }) {
  const [catalogue, setCatalogue] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const expandButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeExpanded = () => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => { setExpanded(false); setClosing(false); requestAnimationFrame(() => expandButton.current?.focus()); }, 200);
  };
  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('.coach-proposal-close')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeExpanded(); }
      if (event.key !== 'Tab' || !dialog.current) return;
      const buttons = [...dialog.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!buttons.length) return;
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKeyDown); };
  }, [expanded, closing]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const data = proposal.payload as Record<string, unknown>;
  const programRoutines = Array.isArray(data.routines) ? data.routines as Record<string, unknown>[] : [];
  const exercises = Array.isArray(data.exercises) ? data.exercises as Record<string, unknown>[] : programRoutines.flatMap(routine => Array.isArray(routine.exercises) ? routine.exercises as Record<string, unknown>[] : []);
  const known = new Map<number, string>();
  folders.forEach(folder => folder.routines.forEach(routine => routine.exercises.forEach(item => { if (item.exercise?.id) known.set(item.exercise.id, item.exercise.name); })));
  useEffect(() => {
    const unresolved = exercises.some(item => typeof item.exercise_id === 'number' && !known.has(item.exercise_id) && !catalogue[item.exercise_id]);
    if (!unresolved) return;
    let alive = true;
    void fetch(`${import.meta.env.VITE_API_URL ?? '/api/v1'}/exercises`, { credentials: 'include', headers: authHeaders() }).then(response => response.json()).then((items: { id: number; name: string }[]) => {
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
    const name = nested?.name ?? (id === null ? 'Unknown exercise' : known.get(id) ?? proposal.exercise_names_by_id?.[String(id)] ?? catalogue[id] ?? `Exercise #${id}`);
    return `${name} · ${item.planned_sets ?? '—'} sets × ${reps} reps${item.target_weight ? ` · ${item.target_weight} kg` : ''} · ${item.rest_seconds ?? 90}s rest`;
  };
  const proposedFolderId = data.folder_id === null && data._folder_id_explicit !== true && target ? target.folder_id : data.folder_id;
  const renderCard = (modal: boolean) => <article ref={modal ? dialog : undefined} role={modal ? 'dialog' : undefined} aria-modal={modal ? true : undefined} aria-label={modal ? `${label(proposal.operation)} proposal` : undefined} className={`coach-proposal ${proposal.operation === 'delete_routine' ? 'danger' : ''} ${modal ? 'coach-proposal-expanded' : ''}`}>
    <div className="coach-proposal-head"><b>{label(proposal.operation)}</b><div className="coach-proposal-head-actions"><span>{status}</span>{modal ? <button type="button" className="coach-proposal-close" onClick={closeExpanded} aria-label="Close expanded proposal">×</button> : <button type="button" ref={expandButton} onClick={() => setExpanded(true)} aria-label={`Expand ${label(proposal.operation)} proposal`}>Expand ↗</button>}</div></div>
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
  return <><div style={expanded ? { visibility: 'hidden' } : undefined}>{renderCard(false)}</div>{expanded && typeof document !== 'undefined' && createPortal(<div className={`coach-proposal-overlay ${closing ? 'is-closing' : ''}`}><button type="button" className="coach-proposal-backdrop" aria-label="Close by clicking outside proposal" onClick={closeExpanded}/>{renderCard(true)}</div>, document.querySelector('.app') ?? document.body)}</>;
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
  const hasConversation = messages.length > 0 || Boolean(coach.optimistic[id ?? -1]) || Boolean(id && (coach.drafts[id] || coach.streaming[id]));
  const isWorking = Boolean(id && coach.streaming[id] && !coach.errors[id]);
  const draft = id ? coach.drafts[id] : '';
  const workingLabel = id ? progressLabel(coach.activity[id], Boolean(draft), Boolean(coach.proposalNotice[id])) : '';
  useEffect(() => { void coach.load(); }, [coach.load]);
  useEffect(() => { if (id && !detail) void coach.refresh(id); }, [id, detail, coach.refresh]);
  useEffect(() => { if (nearBottom && timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight; }, [id, messages.length, id && coach.drafts[id], nearBottom]);
  useLayoutEffect(() => {
    const resizeComposer = () => {
      const field = composer.current;
      if (!field) return;
      field.style.height = 'auto';
      field.style.overflowY = 'hidden';
      const style = getComputedStyle(field);
      const lineHeight = Number.parseFloat(style.lineHeight) || 24;
      const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
      const maxHeight = lineHeight * 3 + padding;
      field.style.height = `${Math.min(field.scrollHeight, maxHeight)}px`;
      field.style.overflowY = field.scrollHeight > maxHeight ? 'auto' : 'hidden';
    };
    resizeComposer();
    window.addEventListener('resize', resizeComposer);
    return () => window.removeEventListener('resize', resizeComposer);
  }, [input, hasConversation]);
  const submit = async (value = input) => {
    const text = value.trim(); if (!text || text.length > 4000 || (id && coach.streaming[id])) return;
    setInput('');
    try { await coach.send(text, id); composer.current?.focus(); } catch (error) { setInput(text); window.alert((error as Error).message); }
  };
  const composerForm = <form className="coach-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <textarea ref={composer} rows={1} aria-label="Message your coach" placeholder="Ask your training question..." maxLength={4000} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }}/>
    {id && coach.streaming[id] ? <button type="button" className="coach-send coach-stop" aria-label="Stop response" onClick={() => void coach.cancel(id)} disabled={coach.activity[id] === 'stopping'}>{coach.activity[id] === 'stopping' ? '…' : <span aria-hidden="true">■</span>}<span className="coach-button-label">{coach.activity[id] === 'stopping' ? 'Stopping…' : 'Stop ■'}</span></button> : <button type="submit" className="coach-send" aria-label="Send message" disabled={!input.trim()}><CoachIcon name="arrow"/></button>}
  </form>;
  const list = <div className="coach-list"><div className="coach-list-head"><h2>Coach</h2><button onClick={() => { void coach.create().then(() => setDrawer(false)); }}><CoachIcon name="plus"/> New chat</button></div><div className="coach-list-body"><span className="coach-recent">Recent</span>{coach.loading ? <div className="coach-skeleton">Loading conversations…</div> : coach.conversations.length ? coach.conversations.map(item => <div className={`coach-thread ${id === item.id ? 'active' : ''}`} key={item.id}><button className="coach-thread-select" onClick={() => { void coach.select(item.id); setDrawer(false); }}><CoachIcon name="chat"/><b>{item.title}</b><small>{coach.streaming[item.id] ? 'Working' : dateLabel(item.updated_at)}</small></button><button className="coach-delete" aria-label={`Delete ${item.title}`} disabled={Boolean(coach.streaming[item.id]) || item.status === 'generating'} onClick={() => void coach.remove(item.id)}>×</button></div>) : <p className="coach-list-empty">No chats yet. Start a new conversation.</p>}</div></div>;
  return <section className="coach-page"><aside className="coach-desktop-list">{list}</aside><div className={`coach-chat ${hasConversation ? 'has-conversation' : 'is-empty'}`}><header className="coach-header"><button className="coach-drawer-button" aria-label="Open conversations" onClick={() => setDrawer(true)}>☰</button><h1>{hasConversation ? detail?.title ?? 'Coach' : 'Coach'}</h1><button className="coach-mobile-new" aria-label="New chat" onClick={() => void coach.create()}><CoachIcon name="plus"/></button></header>
    <div className="coach-timeline" ref={timeline} onScroll={event => { const node = event.currentTarget; setNearBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 110); }}>
      {!hasConversation && <div className="coach-welcome"><h2>Training coach</h2><p>Ask anything about your training.</p>{composerForm}<div className="coach-prompts">{prompts.map(prompt => <button key={prompt.label} onClick={() => { setInput(prompt.text); composer.current?.focus(); }}><CoachIcon name={prompt.icon}/>{prompt.label}</button>)}</div></div>}
      {messages.map((message, index) => <div key={message.id} className={`coach-message ${message.role} ${message.status}`}><div className="coach-bubble">{message.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => /^https?:\/\//i.test(url) ? url : ''} components={{ a: props => <a {...props} target="_blank" rel="noreferrer noopener"/> }}>{message.content}</ReactMarkdown> : message.content}</div>{message.status !== 'completed' && <small>{message.status} {message.role === 'assistant' && (message.status === 'failed' || message.status === 'interrupted') && !messages.slice(index + 1).some(item => item.role === 'assistant' || item.role === 'user') && <button className="coach-retry" onClick={() => { const previous = messages.slice(0, index).reverse().find(item => item.role === 'user'); if (previous && id && previous.id === [...messages].reverse().find(item => item.role === 'user')?.id) void coach.send(previous.content, id, previous.id); }}>Retry</button>}</small>}{message.role === 'assistant' && proposalsForMessage(proposals, messages, message.id).map(proposal => <ProposalCard key={proposal.id} proposal={proposal} coach={coach} id={id!} folders={folders} plan={plan}/>)}</div>)}
      {id && coach.optimistic[id] && <div className="coach-message user"><div className="coach-bubble">{coach.optimistic[id]}</div></div>}
      {id && (draft || isWorking) && <div className="coach-message assistant coach-streaming-message">{draft && <div className="coach-bubble"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url => /^https?:\/\//i.test(url) ? url : ''}>{draft}</ReactMarkdown></div>}{isWorking && <div className="coach-progress" role="status" aria-live="polite"><span className="coach-progress-mark" aria-hidden="true"><i/><i/><i/></span><span>{workingLabel}</span></div>}</div>}
      {coach.errors[id ?? 0] && <div className="coach-error" role="alert">{coach.errors[id ?? 0]}{id && <button onClick={() => { const last = [...messages].reverse().find(message => message.role === 'user'); if (last) void coach.send(last.content, id, last.id); }}>Retry</button>}</div>}
    </div>
    {!nearBottom && (messages.length > 0 || Boolean(draft) || isWorking) && <button className="coach-jump" onClick={() => { if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight; setNearBottom(true); }}>Jump to latest ↓</button>}
    {hasConversation && composerForm}</div>
    {drawer && <div className="coach-drawer-wrap"><button className="coach-drawer-backdrop" aria-label="Close conversations" onClick={() => setDrawer(false)}/><aside className="coach-drawer" aria-label="Conversations"><div className="coach-drawer-top"><strong>Chats</strong><button className="coach-drawer-close" aria-label="Close conversations" onClick={() => setDrawer(false)}>×</button></div>{list}</aside></div>}
  </section>;
}


