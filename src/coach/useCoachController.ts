import { useCallback, useEffect, useRef, useState } from 'react';
import { coachJson, streamMessage } from './api';
import type { Conversation, ConversationDetail, Proposal } from './types';

export function useCoachController(onApplied: (operation: string) => void) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, ConversationDetail>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [optimistic, setOptimistic] = useState<Record<number, string>>({});
  const [activity, setActivity] = useState<Record<number, string>>({});
  const [proposalNotice, setProposalNotice] = useState<Record<number, string>>({});
  const [streaming, setStreaming] = useState<Record<number, boolean>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [outdated, setOutdated] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const controllers = useRef(new Map<number, AbortController>());
  const active = useRef(new Set<number>());
  const onAppliedRef = useRef(onApplied);
  useEffect(() => { onAppliedRef.current = onApplied; }, [onApplied]);

  const refreshList = useCallback(async () => {
    const rows = await coachJson<Conversation[]>('/conversations');
    setConversations(rows);
    setSelectedId(current => current ?? rows[0]?.id ?? null);
    return rows;
  }, []);
  const load = useCallback(async () => {
    if (loaded) return;
    setLoading(true);
    try { await refreshList(); setLoaded(true); } catch (error) { setErrors(current => ({ ...current, 0: (error as Error).message })); }
    finally { setLoading(false); }
  }, [loaded, refreshList]);
  const refresh = useCallback(async (id: number) => {
    const detail = await coachJson<ConversationDetail>(`/conversations/${id}`);
    setDetails(current => ({ ...current, [id]: detail }));
    await refreshList();
    return detail;
  }, [refreshList]);
  const select = useCallback(async (id: number) => {
    setSelectedId(id); if (!details[id]) await refresh(id);
  }, [details, refresh]);
  const create = useCallback(async () => {
    const item = await coachJson<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ title: 'New conversation' }) });
    setConversations(current => [item, ...current]); setSelectedId(item.id);
    setDetails(current => ({ ...current, [item.id]: { ...item, messages: [], proposals: [] } }));
    return item.id;
  }, []);
  const remove = useCallback(async (id: number) => {
    if (active.current.has(id) || !window.confirm('Delete this conversation and its messages?')) return;
    await coachJson(`/conversations/${id}`, { method: 'DELETE' });
    setDetails(current => { const next = { ...current }; delete next[id]; return next; });
    const rows = await refreshList(); setSelectedId(current => current === id ? rows[0]?.id ?? null : current);
  }, [refreshList]);
  const settleTurn = useCallback(async (id: number) => {
    const [detail, rows] = await Promise.all([
      coachJson<ConversationDetail>(`/conversations/${id}`),
      coachJson<Conversation[]>('/conversations'),
    ]);
    // Replace the draft and proposal notice in the same render as the saved turn.
    setDetails(current => ({ ...current, [id]: detail }));
    setConversations(rows);
    setSelectedId(current => current ?? rows[0]?.id ?? null);
    setStreaming(current => ({ ...current, [id]: false }));
    setOptimistic(current => ({ ...current, [id]: '' }));
    setDrafts(current => ({ ...current, [id]: '' }));
    setActivity(current => ({ ...current, [id]: '' }));
    setProposalNotice(current => ({ ...current, [id]: '' }));
  }, []);
  const send = useCallback(async (content: string, id?: number | null) => {
    const trimmed = content.trim(); if (!trimmed || trimmed.length > 4000) return false;
    let target = id ?? selectedId;
    if (target && active.current.has(target)) return false;
    if (!target) target = await create();
    if (active.current.has(target)) return false;
    const key = target;
    active.current.add(key); const controller = new AbortController(); controllers.current.set(key, controller);
    setStreaming(current => ({ ...current, [key]: true }));
    setErrors(current => ({ ...current, [key]: '' })); setDrafts(current => ({ ...current, [key]: '' }));
    setOptimistic(current => ({ ...current, [key]: trimmed })); setActivity(current => ({ ...current, [key]: '' }));
    setProposalNotice(current => ({ ...current, [key]: '' }));
    let settled = false;
    try {
      await streamMessage(key, trimmed, controller.signal, event => {
        if (event.type === 'text.delta') { setDrafts(current => ({ ...current, [key]: (current[key] ?? '') + (event.text ?? '') })); setActivity(current => ({ ...current, [key]: 'writing_response' })); }
        if (event.type === 'tool.started') setActivity(current => ({ ...current, [key]: event.name ?? 'reviewing_results' }));
        if (event.type === 'tool.completed') setActivity(current => ({ ...current, [key]: 'reviewing_results' }));
        if (event.type === 'proposal.created') { setProposalNotice(current => ({ ...current, [key]: event.summary ?? 'Plan change proposed' })); setActivity(current => ({ ...current, [key]: 'proposal_ready' })); }
        if (event.type === 'message.completed') setActivity(current => ({ ...current, [key]: 'saving_response' }));
        if (event.type === 'error') setErrors(current => ({ ...current, [key]: event.message ?? 'The coach could not finish this response.' }));
      });
      await settleTurn(key); settled = true;
    } catch (error) {
      setErrors(current => ({ ...current, [key]: (error as Error).message }));
      try { await settleTurn(key); settled = true; } catch { /* preserve partial draft */ }
    } finally {
      active.current.delete(key); controllers.current.delete(key);
      if (!settled) {
        setStreaming(current => ({ ...current, [key]: false }));
        setOptimistic(current => ({ ...current, [key]: '' }));
        setActivity(current => ({ ...current, [key]: '' }));
        setProposalNotice(current => ({ ...current, [key]: '' }));
      }
    }
    return true;
  }, [create, settleTurn, selectedId]);
  const resolve = useCallback(async (id: number, proposal: Proposal, action: 'confirm' | 'reject') => {
    if (pending[proposal.id]) return;
    setPending(current => ({ ...current, [proposal.id]: true }));
    try {
      await coachJson(`/proposals/${proposal.id}/${action}`, { method: 'POST' });
      if (action === 'confirm') await onAppliedRef.current(proposal.operation);
      await refresh(id);
    } catch (error) {
      if ((error as Error & { status?: number }).status === 409) { setOutdated(current => ({ ...current, [proposal.id]: true })); await onAppliedRef.current(proposal.operation); }
      setErrors(current => ({ ...current, [id]: (error as Error).message }));
    } finally { setPending(current => ({ ...current, [proposal.id]: false })); }
  }, [pending, refresh]);
  useEffect(() => { const current = controllers.current; return () => { current.forEach(controller => controller.abort()); }; }, []);
  return { conversations, selectedId, details, drafts, optimistic, activity, proposalNotice, streaming, errors, pending, outdated, loading, loaded, load, refresh, select, create, remove, send, resolve };
}
export type CoachController = ReturnType<typeof useCoachController>;
