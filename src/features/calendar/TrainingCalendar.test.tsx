// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TrainingCalendar } from './TrainingCalendar';
import { api } from '../../shared/api/client';
vi.mock('../../shared/api/client', () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); });
const key = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
function setup(readOnly = false, status: 'upcoming' | 'missed' | 'completed' = 'upcoming') {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const loadMonth = vi.fn().mockResolvedValue(undefined);
    const moved = vi.fn().mockResolvedValue(undefined);
    render(<TrainingCalendar readOnly={readOnly} folders={[]} history={[]} months={{ [key]: { plan: null, days: [{ date: `${key}-01`, routine_id: 1, routine_name: 'Upper', status, workout_name: status === 'completed' ? 'Upper' : null, workout_id: status === 'completed' ? 42 : null }] } }} loadMonth={loadMonth} onWorkoutMoved={moved} start={vi.fn()} repeatWorkout={vi.fn()} viewWorkout={vi.fn()} editWorkout={vi.fn()} addNote={vi.fn()}/>);
    const event = screen.getByText('Upper', { selector: '.training-event-full' }).parentElement!;
    const target = document.querySelectorAll('.training-day:not(.outside)')[1];
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    return { event, target, dataTransfer, loadMonth, moved };
}
it('saves a dragged occurrence and refreshes the calendar and workout data', async () => {
    vi.mocked(api).mockResolvedValue({ saved: true });
    const { event, target, dataTransfer, loadMonth, moved } = setup();
    fireEvent.dragStart(event, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    expect(target.classList.contains('drop-target')).toBe(true);
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => expect(moved).toHaveBeenCalledWith(`${key}-02`));
    expect(api).toHaveBeenCalledWith('/calendar/move', { method: 'POST', body: JSON.stringify({ source: `${key}-01`, target: `${key}-02` }) });
    expect(loadMonth).toHaveBeenCalledWith(Number(key.slice(0, 4)), Number(key.slice(5)), true);
});
it('shows save errors without selecting the destination', async () => {
    vi.mocked(api).mockRejectedValue(new Error('That day already has a workout.'));
    const { event, target, dataTransfer, moved } = setup();
    fireEvent.dragStart(event, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    await screen.findByText('That day already has a workout.');
    expect(moved).not.toHaveBeenCalled();
});
it('disables dragging in read-only calendars', () => {
    const { event, target, dataTransfer } = setup(true);
    expect(event.draggable).toBe(false);
    fireEvent.dragStart(event, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    expect(api).not.toHaveBeenCalled();
});

it.each(['upcoming', 'missed', 'completed'] as const)('removes a %s occurrence and refreshes data', async status => {
    vi.mocked(api).mockResolvedValue({ saved: true });
    const { event, loadMonth, moved } = setup(false, status);
    fireEvent.click(event);
    fireEvent.click(screen.getByRole('button', { name: /Remove workout/ }));
    await waitFor(() => expect(moved).toHaveBeenCalledWith(key + '-01'));
    expect(api).toHaveBeenCalledWith('/calendar/' + key + '-01' + (status === 'completed' ? '?workout_id=42' : ''), { method: 'DELETE' });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Are you sure'));
    if (status === 'completed') expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('logged sets and workout history'));
    expect(loadMonth).toHaveBeenCalledWith(Number(key.slice(0, 4)), Number(key.slice(5)), true);
});
it('keeps a workout available when removal fails', async () => {
    vi.mocked(api).mockRejectedValue(new Error('Could not remove workout'));
    const { event, moved } = setup();
    fireEvent.click(event);
    fireEvent.click(screen.getByRole('button', { name: /Remove workout/ }));
    await screen.findByText('Could not remove workout');
    expect(moved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Remove workout/ }).hasAttribute('disabled')).toBe(false);
});
it('disables removal in read-only calendars', () => {
    const { event } = setup(true);
    fireEvent.click(event);
    expect(screen.getByRole('button', { name: /Remove workout/ }).hasAttribute('disabled')).toBe(true);
});

it('does not remove a workout when the browser confirmation is cancelled', () => {
    const { event, moved } = setup();
    vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(event);
    fireEvent.click(screen.getByRole('button', { name: /Remove workout/ }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(api).not.toHaveBeenCalled();
    expect(moved).not.toHaveBeenCalled();
});
