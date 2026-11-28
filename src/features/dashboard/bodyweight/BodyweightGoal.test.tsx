// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BodyweightCard } from './BodyweightCard';
import type { Dash } from '../types';

afterEach(cleanup);
const weights = [{ recorded_on: '2026-10-01', weight: 84 }, { recorded_on: '2026-10-20', weight: 82.4 }];
const dash = { latest_weight: weights[1], weight_series: weights } as Dash;
const card = (props: Partial<Parameters<typeof BodyweightCard>[0]>) => render(<BodyweightCard dash={dash} saveWeight={async () => undefined} {...props}/>).container;

it('shows the distance to the target and draws it on the chart when it fits', () => {
    const container = card({ weightGoal: 'lose', targetWeight: 80 });
    expect(screen.getByText('Goal: 80.0 kg · 2.4 kg to go')).toBeTruthy();
    expect(container.querySelector('.weight-target')).not.toBeNull();
    expect(screen.getByText('Goal 80.0 kg')).toBeTruthy();
});

it('leaves a distant target off the chart and shows a target set without a goal', () => {
    expect(card({ weightGoal: 'gain', targetWeight: 120 }).querySelector('.weight-target')).toBeNull();
    cleanup();
    const container = card({ weightGoal: null, targetWeight: 80 });
    expect(screen.getByText('Goal: 80.0 kg · 2.4 kg to go')).toBeTruthy();
    expect(container.querySelector('.weight-target')).not.toBeNull();
    cleanup();
    card({ weightGoal: null, targetWeight: null });
    expect(screen.getByText('Your tracked weight over time.')).toBeTruthy();
});

it('opens the Add form and focuses it on each request from the Current weight tile', () => {
    const { container, rerender } = render(<BodyweightCard dash={dash} saveWeight={async () => undefined}/>);
    const form = () => container.querySelector('.dashboard-weight-actions form')!;
    expect(form().classList.contains('adding')).toBe(false);
    rerender(<BodyweightCard dash={dash} saveWeight={async () => undefined} openAddRequest={1}/>);
    expect(form().classList.contains('adding')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Bodyweight in kilograms' }));
});

it('shows the Add form before focusing it, so phones open the keyboard', () => {
    const { container, rerender } = render(<BodyweightCard dash={dash} saveWeight={async () => undefined}/>);
    const formOpen: boolean[] = [];
    const focus = vi.spyOn(HTMLInputElement.prototype, 'focus').mockImplementation(function (this: HTMLInputElement) {
        formOpen.push(Boolean(this.closest('form')?.classList.contains('adding')));
    });
    rerender(<BodyweightCard dash={dash} saveWeight={async () => undefined} openAddRequest={1}/>);
    expect(formOpen).toEqual([true]);
    expect(container.querySelector('.dashboard-weight-actions form')!.classList.contains('adding')).toBe(true);
    focus.mockRestore();
});
