export type Conversation = { id: number; title: string; status: string; created_at: string; updated_at: string };
export type Message = { id: number; role: 'user' | 'assistant'; content: string; status: string; created_at: string };
export type Proposal = { id: number; message_id?: number | null; operation: string; payload: Record<string, unknown>; summary: string; reasoning?: string | null; status: string; target_routine_id: number | null; created_at: string };
export type ConversationDetail = Conversation & { messages: Message[]; proposals: Proposal[] };
export type CoachEvent = { type: string; text?: string; name?: string; message?: string; proposal_id?: number; summary?: string; reasoning?: string; operation?: string };
