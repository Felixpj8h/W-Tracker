// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkoutTransfer } from './WorkoutTransfer';
import { createWorkoutLink } from './sharing';
import { api } from '../../shared/api/client';

vi.mock('../../shared/api/client', () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); window.history.replaceState(null, '', '/'); });
const routine = { id: 7, name: 'Push', exercises: [{ name: 'Bench press', planned_sets: 3, target_reps: 8 }] };
const link = createWorkoutLink(routine, 'https://tracker.example');

describe('workout transfer', () => {
    it('previews a pasted link before importing a copy into the chosen folder', async () => {
        const imported = vi.fn();
        vi.mocked(api).mockResolvedValue({ ...routine, folder_id: 4 });
        render(<WorkoutTransfer folders={[{ id: 4, name: 'Upper', routines: [] }]} close={vi.fn()} imported={imported}/>);
        fireEvent.change(screen.getByLabelText('Workout link'), { target: { value: link } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview workout' }));
        expect(screen.getByText('Bench press')).toBeTruthy();
        expect(api).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Import workout' }));
        await waitFor(() => expect(imported).toHaveBeenCalled());
        expect(api).toHaveBeenCalledWith('/routines/import', expect.objectContaining({ method: 'POST' }));
        const body = JSON.parse(vi.mocked(api).mock.calls[0][1]!.body as string);
        expect(body.folder_id).toBe(4);
        expect(body.exercises[0]).toMatchObject({ name: 'Bench press', target_reps_min: 8 });
        expect(body.id).toBeUndefined();
    });

    it('opens a shared link preview without saving automatically and creates a new folder', async () => {
        vi.mocked(api).mockResolvedValue({ ...routine, folder_id: 5 });
        render(<WorkoutTransfer initialLink={link} folders={[]} close={vi.fn()} imported={vi.fn()}/>);
        expect(screen.getByText('Bench press')).toBeTruthy();
        expect(api).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Import workout' }));
        await waitFor(() => expect(api).toHaveBeenCalled());
        expect(JSON.parse(vi.mocked(api).mock.calls[0][1]!.body as string).folder_name).toBe('Imported workouts');
    });

    it('shows invalid links and failed imports without closing the preview', async () => {
        const close = vi.fn();
        vi.mocked(api).mockRejectedValue(new Error('offline'));
        render(<WorkoutTransfer initialLink={link} folders={[]} close={close} imported={vi.fn()}/>);
        fireEvent.click(screen.getByRole('button', { name: 'Import workout' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not import'));
        expect(close).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Workout link'), { target: { value: 'https://tracker.example/#workout=bad' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview workout' }));
        expect(screen.getByRole('alert').textContent).toContain('invalid or unsupported');
        expect(screen.queryByRole('button', { name: 'Import workout' })).toBeNull();
    });

    it('falls back to selecting the link when clipboard access fails', async () => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
        render(<WorkoutTransfer routine={routine} folders={[]} close={vi.fn()} imported={vi.fn()}/>);
        fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Copy the selected link'));
        const input = screen.getByRole('textbox') as HTMLInputElement;
        expect(input.selectionEnd).toBe(input.value.length);
    });
});
