// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HistoryAnalysis } from './HistoryAnalysis';

afterEach(cleanup);

const workouts = [
  { id: 1, performed_on: '2026-09-12', exercises: [{ exercise_id: 1, name: 'Back squat', sets: [{ weight: 10, reps: 10 }] }] },
  { id: 2, performed_on: '2026-09-22', exercises: [{ exercise_id: 1, name: 'Back squat', sets: [{ weight: 15, reps: 10 }] }, { exercise_id: 2, name: 'Cable crunch', sets: [{ weight: 3, reps: 10 }] }] },
  { id: 3, performed_on: '2026-09-25', exercises: [{ exercise_id: 2, name: 'Cable crunch', sets: [{ weight: 6, reps: 10 }] }, { exercise_id: 3, name: 'Plank', sets: [{ weight: 0, reps: 1 }] }] },
];

describe('History analysis', () => {
  it('uses actual session volumes and calculates period changes, including a single zero-volume point', async () => {
    const { container } = render(<HistoryAnalysis completed={workouts}/>);
    await waitFor(() => expect(container.querySelectorAll('.analysis-table-row')).toHaveLength(3));
    const rows = [...container.querySelectorAll('.analysis-table-row')].map(row => row.textContent ?? '');
    expect(rows.find(row => row.includes('Back squat'))).toContain('+50.0%');
    expect(rows.find(row => row.includes('Cable crunch'))).toContain('+100.0%');
    expect(rows.find(row => row.includes('Plank'))).toContain('0 kg0 kg—');
    fireEvent.click(screen.getByRole('button', { name: /Back squat.*Sep.*150 kg/i }));
    expect(container.querySelector('.analysis-tooltip')?.textContent).toContain('Cable crunch30 kg');
  });

  it('shows an honest empty period and restores Add after removing an exercise', async () => {
    const { container } = render(<HistoryAnalysis completed={[
      { id: 1, performed_on: '2025-01-01', exercises: [{ exercise_id: 1, name: 'Old exercise', sets: [{ weight: 10, reps: 10 }] }] },
      { id: 2, performed_on: '2026-09-25', exercises: [{ exercise_id: 2, name: 'New exercise', sets: [{ weight: 10, reps: 10 }] }] },
    ]}/>);
    await waitFor(() => expect(container.querySelectorAll('.analysis-chip')).toHaveLength(2));
    fireEvent.click(screen.getByLabelText('Remove New exercise'));
    fireEvent.click(screen.getByText('1M'));
    expect(screen.getByText('No logged data for this period.')).toBeTruthy();
    expect(screen.getByText('＋ Add')).toBeTruthy();
  });
});

it('joins unlinked older workouts to a single known ID across date filters', async () => {
  const { container } = render(<HistoryAnalysis completed={[
    { id: 1, performed_on: '2025-01-01', exercises: [{ name: ' Incline  press ', sets: [{ weight: 10, reps: 10 }] }] },
    { id: 2, performed_on: '2026-09-25', exercises: [{ cached_exercise_id: 7, name: 'Incline press', sets: [{ weight: 20, reps: 10 }] }] },
  ]}/>);
  await waitFor(() => expect(container.querySelectorAll('.analysis-chip')).toHaveLength(1));
  expect(container.querySelectorAll('.analysis-point')).toHaveLength(2);
  expect(container.querySelector('.analysis-table-row')?.textContent).toContain('+100.0%');
  fireEvent.click(screen.getByText('1M'));
  expect(container.querySelectorAll('.analysis-point')).toHaveLength(1);
  fireEvent.click(screen.getByText('All'));
  expect(container.querySelectorAll('.analysis-point')).toHaveLength(2);
});

it('keeps distinct IDs and ambiguous legacy history separate with clear labels', async () => {
  const { container } = render(<HistoryAnalysis completed={[
    { id: 1, performed_on: '2026-09-01', exercises: [{ cached_exercise_id: 7, name: 'Incline press', sets: [{ weight: 10, reps: 10 }] }] },
    { id: 2, performed_on: '2026-09-02', exercises: [{ exercise_id: 8, name: 'Incline press', sets: [{ weight: 20, reps: 10 }] }] },
    { id: 3, performed_on: '2026-09-03', exercises: [{ name: 'Incline press', sets: [{ weight: 30, reps: 10 }] }] },
  ]}/>);
  await waitFor(() => expect(container.querySelectorAll('.analysis-chip')).toHaveLength(3));
  const rows = [...container.querySelectorAll('.analysis-table-row')].map(row => row.textContent);
  expect(rows).toContain('Incline press (Record 7)100 kg100 kg—');
  expect(rows).toContain('Incline press (Record 8)200 kg200 kg—');
  expect(rows).toContain('Incline press (Unlinked history)300 kg300 kg—');
  expect(container.querySelectorAll('.analysis-point')).toHaveLength(3);
  fireEvent.click(screen.getByLabelText('Remove Incline press (Record 8)'));
  fireEvent.click(screen.getByText('＋ Add'));
  expect(screen.getByRole('button', { name: /Incline press \(Record 8\).*1 sessions/ })).toBeTruthy();
});

it('groups legacy-only records without merging different exercise names', async () => {
  const { container } = render(<HistoryAnalysis completed={[
    { id: 1, performed_on: '2026-09-01', exercises: [{ name: ' Incline PRESS ', sets: [{ weight: 10, reps: 10 }] }] },
    { id: 2, performed_on: '2026-09-02', exercises: [{ name: 'Incline press', sets: [{ weight: 20, reps: 10 }] }, { cached_exercise_id: 8, name: 'Flat press', sets: [{ weight: 30, reps: 10 }] }] },
  ]}/>);
  await waitFor(() => expect(container.querySelectorAll('.analysis-chip')).toHaveLength(2));
  expect(container.querySelectorAll('.analysis-point')).toHaveLength(3);
  expect(container.querySelector('.analysis-table-row')?.textContent).toContain('+100.0%');
});
