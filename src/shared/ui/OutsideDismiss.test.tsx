// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { OptionsMenu } from './OptionsMenu';
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

