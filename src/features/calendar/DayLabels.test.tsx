// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DayLabels } from './DayLabels';
import { api } from '../../shared/api/client';
vi.mock('../../shared/api/client', () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('creates a reusable colored label and assigns it to the selected date', async () => {
    vi.mocked(api).mockImplementation(async (path, options) => path === '/calendar/labels' && !options ? [] : { id: 7, name: 'Sick', color: 'rose', saved: true });
    const loadMonth = vi.fn().mockResolvedValue(undefined);
    render(<DayLabels selected="2026-11-10" months={{}} loadMonth={loadMonth} readOnly={false} manageOpen openManage={vi.fn()} closeManage={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('Create a label'), { target: { value: 'Sick' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and apply' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/calendar/2026-11-10/label', { method: 'PUT', body: JSON.stringify({ label_id: 7 }) }));
    expect(loadMonth).toHaveBeenCalledWith(2026, 11, true);
});

it('replaces and clears a date label without changing its workout', async () => {
    vi.mocked(api).mockImplementation(async path => path === '/calendar/labels' ? [{ id: 1, name: 'Sick', color: 'rose' }, { id: 2, name: 'Travel', color: 'sky' }] : { saved: true });
    const loadMonth = vi.fn().mockResolvedValue(undefined);
    render(<DayLabels selected="2026-11-10" label={{ id: 1, name: 'Sick', color: 'rose' }} months={{}} loadMonth={loadMonth} readOnly={false} manageOpen={false} openManage={vi.fn()} closeManage={vi.fn()}/>);
    await screen.findByRole('option', { name: 'Travel' });
    fireEvent.change(screen.getByLabelText('Day label'), { target: { value: '2' } });
    await waitFor(() => expect(api).toHaveBeenCalledWith('/calendar/2026-11-10/label', { method: 'PUT', body: JSON.stringify({ label_id: 2 }) }));
    await waitFor(() => expect(screen.getByLabelText('Day label').hasAttribute('disabled')).toBe(false));
    fireEvent.change(screen.getByLabelText('Day label'), { target: { value: '' } });
    await waitFor(() => expect(api).toHaveBeenCalledWith('/calendar/2026-11-10/label', { method: 'DELETE' }));
});
