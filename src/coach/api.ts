import type { CoachEvent } from './types';

export const base = import.meta.env.VITE_API_URL ?? '/api/v1';

export async function coachJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}/ai${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(typeof body.detail === 'string' ? body.detail : `Request failed (${response.status})`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

export function createSseParser(onEvent: (event: CoachEvent) => void) {
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let data: string[] = [];
  const dispatch = () => {
    if (data.length) {
      try { const payload = JSON.parse(data.join('\n')); if (payload && typeof payload === 'object') onEvent({ ...payload, type: eventName || payload.type || 'message' }); } catch { /* skip malformed event */ }
    }
    eventName = ''; data = [];
  };
  const lines = (flush = false) => {
    let index: number;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1);
      if (!line) dispatch(); else if (line.startsWith('event:')) eventName = line.slice(6).trim(); else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (flush) { if (buffer) { const line = buffer.replace(/\r$/, ''); if (line.startsWith('data:')) data.push(line.slice(5).trimStart()); } dispatch(); buffer = ''; }
  };
  return { push(chunk: Uint8Array) { buffer += decoder.decode(chunk, { stream: true }); lines(); }, finish() { buffer += decoder.decode(); lines(true); } };
}

export async function streamMessage(id: number, content: string, signal: AbortSignal, onEvent: (event: CoachEvent) => void) {
  const response = await fetch(`${base}/ai/conversations/${id}/messages`, { method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ content }), signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : `Coach request failed (${response.status})`);
  }
  if (!response.body) throw new Error('Streaming is unavailable in this browser.');
  const parser = createSseParser(onEvent);
  const reader = response.body.getReader();
  try { while (true) { const { value, done } = await reader.read(); if (done) break; parser.push(value); } parser.finish(); }
  finally { reader.releaseLock(); }
}
