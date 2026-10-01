import type { Message, Proposal } from './types';

export function proposalMessageId(proposal: Proposal, messages: Message[]): number | null {
  if (typeof proposal.message_id === 'number') return proposal.message_id;
  const created = Date.parse(proposal.created_at);
  return messages.find(message => message.role === 'assistant' && Date.parse(message.created_at) >= created)?.id ?? null;
}

export function proposalsForMessage(proposals: Proposal[], messages: Message[], messageId: number): Proposal[] {
  return proposals.filter(proposal => proposalMessageId(proposal, messages) === messageId);
}
