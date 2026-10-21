// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BodyweightChart } from './BodyweightChart';

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', MouseEvent);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(readOnly = false) {
    const save = vi.fn();
    const { container } = render(<BodyweightChart readOnly={readOnly} values={[{ weight: 80, recorded_on: '2026-10-20' }, { weight: 81, recorded_on: '2026-10-21' }]} domainStart={1792454400000} domainEnd={1792540800000} saveWeight={save}/>);
    const point = container.querySelector('.weight-point-circle')!;
    return { container, point, save };
}
it('shows the tapped weight until an outside press without editing', () => {
    const { container, point, save } = setup();
    fireEvent.pointerDown(point, { button: 0 });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.pointerUp(point, { button: 0 });
    fireEvent.click(point, { detail: 1 });
    fireEvent.pointerLeave(container.querySelector('.chart')!);
    expect(screen.getByText('80.0 kg')).toBeTruthy();
    expect(container.querySelector('form')).toBeNull();
    fireEvent.pointerDown(document.body, { button: 0 });
    expect(container.querySelector('.weight-point-popover')).toBeNull();
    expect(save).not.toHaveBeenCalled();
});
it('opens editing after a long press and keeps it open after release', () => {
    const { container, point } = setup();
    fireEvent.pointerDown(point, { button: 0, clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(500));
    expect(container.querySelector('input')?.value).toBe('80');
    fireEvent.pointerUp(point, { button: 0 });
    fireEvent.click(point, { detail: 1 });
    expect(container.querySelector('form')).toBeTruthy();
});
it.each(['move', 'cancel', 'leave'])('cancels the long press on %s', action => {
    const { container, point } = setup();
    fireEvent.pointerDown(point, { button: 0, clientX: 10, clientY: 10 });
    if (action === 'move') fireEvent.pointerMove(point, { clientX: 30, clientY: 10 });
    if (action === 'cancel') fireEvent.pointerCancel(point);
    if (action === 'leave') fireEvent.pointerLeave(point);
    act(() => vi.advanceTimersByTime(600));
    expect(container.querySelector('form')).toBeNull();
});
it('never edits a read-only weight on long press', () => {
    const { container, point } = setup(true);
    fireEvent.pointerDown(point, { button: 0 });
    act(() => vi.advanceTimersByTime(600));
    fireEvent.pointerUp(point, { button: 0 });
    fireEvent.click(point, { detail: 1 });
    expect(screen.getByText('80.0 kg')).toBeTruthy();
    expect(container.querySelector('form')).toBeNull();
});
it('preserves desktop click-to-edit and keyboard activation', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    const { container, point } = setup();
    fireEvent.click(point, { detail: 1 });
    expect(container.querySelector('form')).toBeTruthy();
});
