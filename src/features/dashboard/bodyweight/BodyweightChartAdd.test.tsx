// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BodyweightCard } from './BodyweightCard';

afterEach(cleanup);

type Dashboard = NonNullable<Parameters<typeof BodyweightCard>[0]['dash']>;

function WeightFixture() {
  const [dash, setDash] = useState({
    weight_series: [{ recorded_on: '2026-09-12', weight: 80 }, { recorded_on: '2026-09-25', weight: 83 }],
    latest_weight: { recorded_on: '2026-09-25', weight: 83 },
  } as Dashboard);
  return <BodyweightCard dash={dash} saveWeight={async (weight, recordedOn) => {
    setDash(current => {
      const weight_series = [...current.weight_series, { recorded_on: recordedOn!, weight }].sort((a, b) => a.recorded_on.localeCompare(b.recorded_on));
      return { ...current, weight_series, latest_weight: weight_series.at(-1) ?? null };
    });
  }}/>
}

describe('Bodyweight chart day entry', () => {
  it('shows published weights but never opens editors in read-only mode', () => {
    const saveWeight = vi.fn();
    const dash = { weight_series: [{ recorded_on: '2026-09-12', weight: 80 }, { recorded_on: '2026-09-25', weight: 83 }],
      latest_weight: { recorded_on: '2026-09-25', weight: 83 } } as Dashboard;
    const { container } = render(<BodyweightCard readOnly dash={dash} saveWeight={saveWeight}/>);
    const point = screen.getByRole('button', { name: /25.*2026.*83 kilograms/i });
    fireEvent.focus(point);
    expect(screen.getByText('83.0 kg')).toBeTruthy();
    fireEvent.click(point);
    const chart = container.querySelector('.chart svg')!;
    Object.defineProperty(chart, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 100 }) });
    fireEvent.click(chart, { clientX: 500, clientY: 50 });
    expect(container.querySelector('.weight-point-popover form')).toBeNull();
    expect(container.querySelector('.weight-new-point')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveWeight).not.toHaveBeenCalled();
  });

  it('opens a small entry for a clicked unlogged day and plots the saved weight', async () => {
    const { container } = render(<WeightFixture/>);
    const chart = container.querySelector('.dashboard-weight .chart svg')!;
    Object.defineProperty(chart, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 1000, height: 100 }) });
    fireEvent.click(chart, { clientX: 500, clientY: 50 });
    const input = screen.getByLabelText(/Bodyweight for .*19.*2026/i);
    fireEvent.change(input, { target: { value: '82.4' } });
    fireEvent.click(container.querySelector('.weight-new-point button:last-child')!);
    await waitFor(() => expect(screen.getByRole('button', { name: /19.*2026.*82.4 kilograms/i })).toBeTruthy());
    expect(container.querySelector('.weight-new-point')).toBeNull();
  });

  it('keeps existing points on their edit interaction', () => {
    const { container } = render(<WeightFixture/>);
    fireEvent.click(screen.getByRole('button', { name: /25.*2026.*83 kilograms/i }));
    expect(container.querySelector('.weight-point-popover form')).toBeTruthy();
    expect(container.querySelector('.weight-new-point')).toBeNull();
  });
});
