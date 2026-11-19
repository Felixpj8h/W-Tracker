// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TrainingCalendar } from './TrainingCalendar';
import { api } from '../../shared/api/client';
vi.mock('../../shared/api/client', () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); Reflect.deleteProperty(document, 'elementFromPoint'); });
const key = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
function setup(readOnly = false, status: 'upcoming' | 'missed' | 'completed' = 'upcoming') {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const loadMonth = vi.fn().mockResolvedValue(undefined);
    const moved = vi.fn().mockResolvedValue(undefined);
    render(<TrainingCalendar readOnly={readOnly} folders={[]} history={[]} months={{ [key]: { plan: null, days: [{ date: `${key}-01`, routine_id: 1, routine_name: 'Upper', status, workout_name: status === 'completed' ? 'Upper' : null, workout_id: status === 'completed' ? 42 : null }] } }} loadMonth={loadMonth} onWorkoutMoved={moved} start={vi.fn()} repeatWorkout={vi.fn()} viewWorkout={vi.fn()} editWorkout={vi.fn()} addNote={vi.fn()}/>);
    const event = screen.getByText('Upper', { selector: '.training-event-full' }).parentElement!;
    const target = document.querySelectorAll('.training-day:not(.outside)')[1];
    const capture = vi.fn();
    Object.defineProperty(event, 'setPointerCapture', { value: capture });
    return { event, target, capture, loadMonth, moved };
}

const pointer = (pointerType = 'mouse') => ({ isPrimary: true, button: 0, pointerType, pointerId: 1 });
function dragOver(event: HTMLElement, target: Element | null, pointerType = 'mouse') {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target) });
    fireEvent.pointerDown(event, { ...pointer(pointerType), clientX: 10, clientY: 10 });
    fireEvent.pointerMove(event, { ...pointer(pointerType), clientX: 30, clientY: 30 });
}

it.each(['mouse', 'touch'])('moves a workout using %s and refreshes the calendar and workout data', async pointerType => {
    vi.mocked(api).mockResolvedValue({ saved: true });
    const { event, target, capture, loadMonth, moved } = setup();
    dragOver(event, target, pointerType);
    expect(capture).toHaveBeenCalledWith(1);
    expect(target.classList.contains('drop-target')).toBe(true);
    fireEvent.pointerUp(event, { ...pointer(pointerType), clientX: 30, clientY: 30 });
    fireEvent.click(event, { detail: 1 });
    await waitFor(() => expect(moved).toHaveBeenCalledWith(`${key}-02`));
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === '/calendar/move')).toEqual([
        ['/calendar/move', { method: 'POST', body: JSON.stringify({ source: `${key}-01`, target: `${key}-02` }) }],
    ]);
    expect(loadMonth).toHaveBeenCalledWith(Number(key.slice(0, 4)), Number(key.slice(5)), true);
});
it('clears a cancelled drag without saving and still allows taps to select a workout', () => {
    const { event, target } = setup();
    dragOver(event, target, 'touch');
    fireEvent.pointerCancel(event, pointer('touch'));
    fireEvent.pointerUp(event, pointer('touch'));
    expect(target.classList.contains('drop-target')).toBe(false);
    expect(vi.mocked(api).mock.calls.some(([path]) => path === '/calendar/move')).toBe(false);
    fireEvent.click(target);
    expect(target.classList.contains('selected')).toBe(true);
    fireEvent.pointerDown(event, pointer('touch'));
    fireEvent.pointerUp(event, pointer('touch'));
    expect(event.closest('.training-day')?.classList.contains('selected')).toBe(true);
});
it('does not move a workout when released on an occupied day', () => {
    const { event, target } = setup();
    dragOver(event, target);
    target.setAttribute('data-occupied', 'true');
    fireEvent.pointerUp(event, { ...pointer(), clientX: 30, clientY: 30 });
    expect(vi.mocked(api).mock.calls.some(([path]) => path === '/calendar/move')).toBe(false);
    fireEvent.pointerDown(target, pointer());
    fireEvent.pointerUp(target, pointer());
    fireEvent.click(target, { detail: 1 });
    expect(target.classList.contains('selected')).toBe(true);
});
it('shows save errors without selecting the destination', async () => {
    vi.mocked(api).mockRejectedValue(new Error('That day already has a workout.'));
    const { event, target, moved } = setup();
    dragOver(event, target);
    fireEvent.pointerUp(event, { ...pointer(), clientX: 30, clientY: 30 });
    await screen.findByText('That day already has a workout.');
    expect(moved).not.toHaveBeenCalled();
    expect(target.classList.contains('selected')).toBe(false);
});
it('disables dragging in read-only calendars', () => {
    const { event, target, capture } = setup(true);
    expect(event.hasAttribute('data-movable')).toBe(false);
    dragOver(event, target);
    fireEvent.pointerUp(event, { ...pointer(), clientX: 30, clientY: 30 });
    expect(capture).not.toHaveBeenCalled();
    expect(vi.mocked(api).mock.calls.filter(([path]) => path !== '/calendar/labels')).toHaveLength(0);
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
    expect(vi.mocked(api).mock.calls.filter(([path]) => path !== '/calendar/labels')).toHaveLength(0);
    expect(moved).not.toHaveBeenCalled();
});

it('shows a day label alongside its workout in a read-only calendar', () => {
    const loadMonth = vi.fn().mockResolvedValue(undefined);
    render(<TrainingCalendar readOnly folders={[]} history={[]} months={{ [key]: { plan: null, days: [{ date: `${key}-01`, routine_id: 1, routine_name: 'Upper', status: 'upcoming', workout_name: null, label: { id: 2, name: 'Sick', color: 'rose' } }] } }} loadMonth={loadMonth} start={vi.fn()} repeatWorkout={vi.fn()} viewWorkout={vi.fn()} editWorkout={vi.fn()} addNote={vi.fn()}/>);
    const day = screen.getByText('Upper', { selector: '.training-event-full' }).closest('.training-day')!;
    expect(day.querySelector('.calendar-grid-label')?.textContent).toBe('Sick');
    expect(day.querySelector('.calendar-grid-label')?.classList.contains('color-rose')).toBe(true);
    fireEvent.click(day);
    expect(screen.getByText('Sick', { selector: '.calendar-label-control .calendar-label-chip' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New label' })).toBeNull();
});
