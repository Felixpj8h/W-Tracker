// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Coach, ProposalCard } from './Coach';
import type { CoachController } from './useCoachController';

describe('Coach proposal card', () => {
  it('shows the user-facing explanation separately from the change summary', () => {
    const html = renderToStaticMarkup(<ProposalCard
      proposal={{ id: 1, operation: 'create_routine', payload: { name: 'Upper', exercises: [] }, summary: 'Add Upper routine', reasoning: 'This splits the weekly work across two sessions.', status: 'pending', target_routine_id: null, created_at: '2026-09-22' }}
      coach={{ outdated: {}, pending: {}, resolve: async () => undefined } as unknown as CoachController}
      id={1} folders={[]} plan={null}
    />);
    expect(html).toContain('Add Upper routine');
    expect(html).toContain('Why this change');
    expect(html).toContain('This splits the weekly work across two sessions.');
  });

  it('renders a proposal after its own reply and before the next turn', () => {
    const created_at = '2026-09-22T12:00:00';
    const html = renderToStaticMarkup(<Coach
      coach={{
        selectedId: 1,
        details: { 1: { id: 1, title: 'Coach', status: 'idle', created_at, updated_at: created_at,
          messages: [
            { id: 1, role: 'user', content: 'First question', status: 'completed', created_at },
            { id: 2, role: 'assistant', content: 'First answer', status: 'completed', created_at },
            { id: 3, role: 'user', content: 'Second question', status: 'completed', created_at },
            { id: 4, role: 'assistant', content: 'Second answer', status: 'completed', created_at },
          ],
          proposals: [{ id: 9, message_id: 2, operation: 'create_routine', payload: { name: 'Upper', exercises: [] }, summary: 'First proposal', status: 'rejected', target_routine_id: null, created_at }],
        } },
        conversations: [], loading: false, drafts: {}, optimistic: {}, streaming: {}, proposalNotice: {}, activity: {}, errors: {}, outdated: {}, pending: {},
        load: async () => undefined, refresh: async () => undefined, send: async () => true, create: async () => 1, resolve: async () => undefined,
      } as unknown as CoachController}
      folders={[]} plan={null}
    />);
    expect(html.indexOf('First answer')).toBeLessThan(html.indexOf('First proposal'));
    expect(html.indexOf('First proposal')).toBeLessThan(html.indexOf('Second question'));
    expect(html.indexOf('Second question')).toBeLessThan(html.indexOf('Second answer'));
  });

  it('shows the complete folder, routines, and calendar placement before confirmation', () => {
    const html = renderToStaticMarkup(<ProposalCard
      proposal={{ id: 3, operation: 'create_training_program', summary: 'Build PPL', status: 'pending', target_routine_id: null, created_at: '2026-09-22', payload: {
        folder_name: 'PPL', routines: [{ name: 'Push', exercises: [] }, { name: 'Pull', exercises: [] }, { name: 'Legs', exercises: [] }],
        weekly_plan: { name: 'PPL week', starts_on: '2026-09-28', days: [{ weekday: 0, routine_index: 0 }] },
        dates: [{ date: '2026-09-29', routine_index: 2 }],
      } }}
      coach={{ outdated: {}, pending: {}, resolve: async () => undefined } as unknown as CoachController}
      id={1} folders={[]} plan={null}
    />);
    expect(html).toContain('New folder · PPL');
    expect(html).toContain('Recurring · PPL week');
    expect(html).toContain('Monday: Push');
    expect(html).toContain('2026-09-29: Legs');
  });

  it('opens a readable dialog and closes it with Escape', async () => {
    render(<ProposalCard
      proposal={{ id: 4, operation: 'create_routine', payload: { name: 'Push', exercises: [] }, summary: 'Add Push', status: 'applied', target_routine_id: null, created_at: '2026-09-22' }}
      coach={{ outdated: {}, pending: {}, resolve: async () => undefined } as unknown as CoachController}
      id={1} folders={[]} plan={null}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand Create routine proposal' }));
    expect(screen.getByRole('dialog', { name: 'Create routine proposal' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close expanded proposal' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand Create routine proposal' })));
  });

  it('shows one clear progress state while the coach works', () => {
    const created_at = '2026-09-22T12:00:00';
    const html = renderToStaticMarkup(<Coach
      coach={{
        selectedId: 1,
        details: { 1: { id: 1, title: 'Coach', status: 'generating', created_at, updated_at: created_at, messages: [], proposals: [] } },
        conversations: [], loading: false, drafts: { 1: '' }, optimistic: { 1: 'Build a plan' }, streaming: { 1: true },
        proposalNotice: { 1: 'Plan change proposed' }, activity: { 1: 'proposal_ready' }, errors: {}, outdated: {}, pending: {},
        load: async () => undefined, refresh: async () => undefined, send: async () => true, create: async () => 1, resolve: async () => undefined,
      } as unknown as CoachController}
      folders={[]} plan={null}
    />);
    expect(html).toContain('Proposal ready. Preparing reply…');
    expect((html.match(/role="status"/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain('Preparing proposal details');
  });
});
