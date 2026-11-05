// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { OptionsMenu } from './OptionsMenu';
import { DismissibleDetails } from './DismissibleDetails';
import { RoutineEditor } from '../../features/routines/RoutineEditor';
import { WorkoutTransfer } from '../../features/routines/WorkoutTransfer';
import { BodyweightChart } from '../../features/dashboard/BodyweightChart';

vi.mock('../api/client', () => ({ api: vi.fn() }));
beforeAll(() => { if (!window.PointerEvent) window.PointerEvent = MouseEvent as typeof PointerEvent; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('keeps options open for inside presses and closes them outside, including touch', () => {
    const { container } = render(<OptionsMenu label="Options"><button>Action</button></OptionsMenu>);
    const menu = container.querySelector('details')!;
    fireEvent.click(container.querySelector('summary')!);
    fireEvent.pointerDown(screen.getByText('Action'), { button: 0 });
    expect(menu.open).toBe(true);
    fireEvent.pointerDown(document.body, { button: 0, pointerType: 'touch' });
    expect(menu.open).toBe(false);
    fireEvent.click(container.querySelector('summary')!);
    fireEvent.click(screen.getByText('Action'));
    expect(menu.open).toBe(false);
});

it('closes the previous menu when opening another and supports Escape with focus return', () => {
    const { container } = render(<><OptionsMenu label="Workout actions"><button>Cancel workout</button></OptionsMenu><OptionsMenu label="Exercise actions"><button>Remove set</button></OptionsMenu></>);
    const [workout, exercise] = Array.from(container.querySelectorAll('details'));
    const first = screen.getByLabelText('Workout actions');
    const second = screen.getByLabelText('Exercise actions');
    fireEvent.click(first);
    fireEvent.pointerDown(second, { button: 0 });
    fireEvent.click(second);
    expect(workout.open).toBe(false);
    expect(exercise.open).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(exercise.open).toBe(false);
    expect(document.activeElement).toBe(second);
});

it('keeps note input interactions open and preserves the note after outside dismissal', () => {
    const { container } = render(<DismissibleDetails><summary>Add note</summary><textarea aria-label="Exercise note" defaultValue=""/></DismissibleDetails>);
    const menu = container.querySelector('details')!;
    fireEvent.click(screen.getByText('Add note'));
    const note = screen.getByLabelText('Exercise note') as HTMLTextAreaElement;
    fireEvent.pointerDown(note, { button: 0 });
    fireEvent.change(note, { target: { value: 'Keep this note' } });
    expect(menu.open).toBe(true);
    fireEvent.pointerDown(document.body, { button: 0 });
    expect(menu.open).toBe(false);
    fireEvent.click(screen.getByText('Add note'));
    expect(note.value).toBe('Keep this note');
});

it('dismisses a clean editor on the backdrop but protects unsaved changes', () => {
    const close = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<RoutineEditor routine={{ id: 1, name: 'Push', exercises: [] }} folders={[]} close={close} done={vi.fn()}/>);
    const dialog = screen.getByRole('dialog');
    fireEvent.pointerDown(dialog, { button: 0 });
    expect(close).not.toHaveBeenCalled();
    fireEvent.pointerDown(dialog.parentElement!, { button: 0 });
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByDisplayValue('Push'), { target: { value: 'Pull' } });
    fireEvent.pointerDown(dialog.parentElement!, { button: 0 });
    expect(confirm).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(true);
    fireEvent.pointerDown(dialog.parentElement!, { button: 0 });
    expect(close).toHaveBeenCalledTimes(2);
});

it('closes transfer on its backdrop, while inside interaction keeps it open', () => {
    const close = vi.fn();
    render(<WorkoutTransfer folders={[]} close={close} imported={vi.fn()}/>);
    const dialog = screen.getByRole('dialog');
    fireEvent.pointerDown(dialog, { button: 0 });
    expect(close).not.toHaveBeenCalled();
    fireEvent.pointerDown(dialog.parentElement!, { button: 0 });
    expect(close).toHaveBeenCalledTimes(1);
});

it('closes an edited chart point outside without saving, while input interaction keeps it open', () => {
    const save = vi.fn();
    const { container } = render(<BodyweightChart values={[{ weight: 80, recorded_on: '2026-10-20' }, { weight: 81, recorded_on: '2026-10-21' }]} domainStart={1792454400000} domainEnd={1792540800000} saveWeight={save}/>);
    fireEvent.click(container.querySelector('.weight-point-circle')!);
    const input = container.querySelector('.weight-point-popover input')!;
    fireEvent.pointerDown(input, { button: 0 });
    expect(container.querySelector('.weight-point-popover form')).toBeTruthy();
    fireEvent.pointerDown(document.body, { button: 0 });
    expect(container.querySelector('.weight-point-popover form')).toBeNull();
    expect(save).not.toHaveBeenCalled();
});

