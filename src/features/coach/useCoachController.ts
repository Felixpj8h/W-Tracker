import { useCallback, useEffect, useRef, useState } from 'react';
import { coachJson, streamMessage } from './api';
import type { CoachMessageInput, Conversation, ConversationDetail, Proposal } from './types';

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
  const [detailErrors, setDetailErrors] = useState<Record<number, string>>({});
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [outdated, setOutdated] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const controllers = useRef(new Map<number, AbortController>());
  const active = useRef(new Set<number>());
  const detailRequests = useRef(new Map<number, number>());
  const listRequest = useRef(0);
  const onAppliedRef = useRef(onApplied);
  useEffect(() => { onAppliedRef.current = onApplied; }, [onApplied]);

  const refreshList = useCallback(async () => {
    const request = ++listRequest.current;
    const rows = await coachJson<Conversation[]>('/conversations');
    if (request === listRequest.current) {
      setConversations(rows);
      setSelectedId(current => current ?? rows[0]?.id ?? null);
    }
    return rows;
  }, []);
  const load = useCallback(async () => {
    if (loaded) return;
    setLoading(true);
    try { await refreshList(); setErrors(current => ({ ...current, 0: '' })); setLoaded(true); } catch (error) { setErrors(current => ({ ...current, 0: (error as Error).message })); }
    finally { setLoading(false); }
  }, [loaded, refreshList]);
  const refresh = useCallback(async (id: number) => {
    const request = (detailRequests.current.get(id) ?? 0) + 1;
    detailRequests.current.set(id, request);
    try {
      const detail = await coachJson<ConversationDetail>(`/conversations/${id}`);
      if (request === detailRequests.current.get(id)) {
        setDetails(current => ({ ...current, [id]: detail }));
        setDetailErrors(current => ({ ...current, [id]: '' }));
        if (!active.current.has(id)) {
          setOptimistic(current => ({ ...current, [id]: '' }));
          setDrafts(current => ({ ...current, [id]: '' }));
        }
      }
      return detail;
    } catch {
      if (request === detailRequests.current.get(id)) setDetailErrors(current => ({ ...current, [id]: 'Could not load this conversation. Try refreshing it.' }));
      return null;
    }
  }, []);
  const select = useCallback(async (id: number) => {
    setSelectedId(id);
  }, []);
  const create = useCallback(async () => {
    const item = await coachJson<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({ title: 'New conversation' }) });
    listRequest.current += 1;
    setConversations(current => [item, ...current]); setSelectedId(item.id);
    setDetails(current => ({ ...current, [item.id]: { ...item, messages: [], proposals: [] } }));
    return item.id;
  }, []);
  const remove = useCallback(async (id: number) => {
    if (active.current.has(id) || !window.confirm('Delete this conversation and its messages?')) return;
    await coachJson(`/conversations/${id}`, { method: 'DELETE' });
    detailRequests.current.set(id, (detailRequests.current.get(id) ?? 0) + 1);
    setDetails(current => { const next = { ...current }; delete next[id]; return next; });
    const rows = await refreshList(); setSelectedId(current => current === id ? rows[0]?.id ?? null : current);
  }, [refreshList]);
  const send = useCallback(async (input: string | CoachMessageInput, id?: number | null, retryMessageId?: number, onAccepted?: () => void) => {
    const message = typeof input === 'string' ? { content: input } : input;
    const trimmed = message.content.trim(); if (!trimmed || trimmed.length > 4000) return false;
    let target = id ?? selectedId;
    if (target && active.current.has(target)) return false;
    if (!target) target = await create();
    if (active.current.has(target)) return false;
    const key = target;
    active.current.add(key); const controller = new AbortController(); controllers.current.set(key, controller);
    setStreaming(current => ({ ...current, [key]: true }));
    setErrors(current => ({ ...current, [key]: '' })); setDrafts(current => ({ ...current, [key]: '' }));
    setOptimistic(current => ({ ...current, [key]: retryMessageId ? '' : trimmed })); setActivity(current => ({ ...current, [key]: '' }));
    setProposalNotice(current => ({ ...current, [key]: '' }));
    let accepted = false;
    const accept = () => {
      if (accepted) return;
      accepted = true;
      onAccepted?.();
    };
    try {
      await streamMessage(key, { ...message, content: trimmed }, controller.signal, event => {
        if (event.type === 'message.started') accept();
        if (event.type === 'text.delta') { setDrafts(current => ({ ...current, [key]: (current[key] ?? '') + (event.text ?? '') })); setActivity(current => ({ ...current, [key]: 'writing_response' })); }
        if (event.type === 'tool.started') setActivity(current => ({ ...current, [key]: event.name ?? 'reviewing_results' }));
        if (event.type === 'tool.completed') setActivity(current => ({ ...current, [key]: 'reviewing_results' }));
        if (event.type === 'proposal.created') { setProposalNotice(current => ({ ...current, [key]: event.summary ?? 'Plan change proposed' })); setActivity(current => ({ ...current, [key]: 'proposal_ready' })); }
        if (event.type === 'message.completed') setActivity(current => ({ ...current, [key]: 'saving_response' }));
        if (event.type === 'error') setErrors(current => ({ ...current, [key]: event.message ?? 'The coach could not finish this response.' }));
      }, retryMessageId);
      accept();
    } catch (error) {
      setErrors(current => ({ ...current, [key]: (error as Error).message }));
    } finally {
      const detail = accepted ? await refresh(key) : null;
      void refreshList().catch(() => undefined);
      active.current.delete(key); controllers.current.delete(key);
      setStreaming(current => ({ ...current, [key]: false }));
      if ((detail && detail.status !== 'generating') || !accepted) {
        setOptimistic(current => ({ ...current, [key]: '' }));
        setDrafts(current => ({ ...current, [key]: '' }));
      }
      setActivity(current => ({ ...current, [key]: '' }));
      setProposalNotice(current => ({ ...current, [key]: '' }));
    }
    return accepted;
  }, [create, refresh, refreshList, selectedId]);
  const cancel = useCallback(async (id: number) => {
    if (!active.current.has(id)) return;
    setActivity(current => ({ ...current, [id]: 'stopping' }));
    try {
      await coachJson(`/conversations/${id}/cancel`, { method: 'POST' });
    } catch (error) {
      setActivity(current => current[id] === 'stopping' ? { ...current, [id]: '' } : current);
      setErrors(current => ({ ...current, [id]: (error as Error).message }));
    }
  }, []);
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
  return { conversations, selectedId, details, drafts, optimistic, activity, proposalNotice, streaming, errors, detailErrors, pending, outdated, loading, loaded, load, refresh, select, create, remove, send, cancel, resolve };
}
export type CoachController = ReturnType<typeof useCoachController>;
