import { describe, expect, it } from 'vitest';
import { proposalsForMessage } from './timeline';
import type { Message, Proposal } from './types';

describe('proposal placement', () => {
  it('keeps each proposal with the assistant message that created it', () => {
    const messages: Message[] = [
      { id: 1, role: 'user', content: 'First', status: 'completed', created_at: '2026-09-22T12:00:00' },
      { id: 2, role: 'assistant', content: 'First reply', status: 'completed', created_at: '2026-09-22T12:01:00' },
      { id: 3, role: 'user', content: 'Second', status: 'completed', created_at: '2026-09-22T12:02:00' },
      { id: 4, role: 'assistant', content: 'Second reply', status: 'completed', created_at: '2026-09-22T12:03:00' },
    ];
    const base = { operation: 'update_routine', payload: {}, summary: 'Change', status: 'pending', target_routine_id: 1 };
    const proposals: Proposal[] = [
      { ...base, id: 10, message_id: 2, created_at: '2026-09-22T12:00:30' },
      { ...base, id: 11, message_id: 4, created_at: '2026-09-22T12:02:30' },
    ];
    expect(proposalsForMessage(proposals, messages, 2).map(proposal => proposal.id)).toEqual([10]);
    expect(proposalsForMessage(proposals, messages, 4).map(proposal => proposal.id)).toEqual([11]);
  });
});
