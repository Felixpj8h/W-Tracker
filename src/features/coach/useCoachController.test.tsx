// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { coachJson, streamMessage } from './api';
import { useCoachController } from './useCoachController';

vi.mock('./api', () => ({ coachJson: vi.fn(), streamMessage: vi.fn() }));

afterEach(cleanup);

const chat = { id: 1, title: 'Training', status: 'idle', created_at: '', updated_at: '' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(coachJson).mockImplementation(async path => path === '/conversations' ? [chat] : {
    ...chat, messages: [], proposals: [],
  });
});

it('does not accept a rejected send or retry a previous message', async () => {
  vi.mocked(streamMessage).mockRejectedValueOnce(Error('Coach is not configured'));
  const { result } = renderHook(() => useCoachController(() => undefined));
  const accepted = vi.fn();
  await act(async () => expect(await result.current.send('New question', 1, undefined, accepted)).toBe(false));
  expect(accepted).not.toHaveBeenCalled();
  expect(result.current.errors[1]).toBe('Coach is not configured');
  expect(result.current.optimistic[1]).toBe('');
  expect(streamMessage).toHaveBeenCalledTimes(1);
});

it('keeps the question and partial response if the saved chat cannot be loaded', async () => {
  vi.mocked(streamMessage).mockImplementationOnce(async (_id, _message, _signal, event) => {
    event({ type: 'message.started' });
    event({ type: 'text.delta', text: 'Partial reply' });
  });
  vi.mocked(coachJson).mockImplementation(async path => {
    if (path === '/conversations/1') throw Error('Offline');
    return [chat];
  });
  const { result } = renderHook(() => useCoachController(() => undefined));
  const accepted = vi.fn();
  await act(async () => expect(await result.current.send('New question', 1, undefined, accepted)).toBe(true));
  expect(accepted).toHaveBeenCalledTimes(1);
  expect(result.current.optimistic[1]).toBe('New question');
  expect(result.current.drafts[1]).toBe('Partial reply');
  expect(result.current.detailErrors[1]).toContain('refresh');
});

it('restores the Stop control after cancellation fails', async () => {
  let end!: () => void;
  vi.mocked(streamMessage).mockImplementationOnce(() => new Promise<void>(resolve => { end = resolve; }));
  vi.mocked(coachJson).mockRejectedValueOnce(Error('Offline'));
  const { result } = renderHook(() => useCoachController(() => undefined));
  let sending!: Promise<boolean>;
  await act(async () => { sending = result.current.send('New question', 1); });
  expect(result.current.streaming[1]).toBe(true);
  await act(async () => result.current.cancel(1));
  expect(result.current.activity[1]).not.toBe('stopping');
  expect(result.current.streaming[1]).toBe(true);
  await act(async () => { end(); await sending; });
});
