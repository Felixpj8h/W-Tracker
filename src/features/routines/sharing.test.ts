import { describe, expect, it } from 'vitest';
import { createWorkoutLink, parseWorkoutLink, createFolderLink, parseSharedLink } from './sharing';
import type { Routine } from './types';

const routine: Routine = { id: 123, folder_id: 45, name: 'Øvre kropp 💪', exercises: [{
    exercise: { id: 999, name: 'Développé couché', equipment: 'Barbell', primary_muscle: 'Primary: Chest · Secondary: Triceps' },
    name: 'Développé couché', planned_sets: 4, target_reps_min: 6, target_reps_max: 10, rest_seconds: 120, target_weight: 60,
}] };

describe('portable workout links', () => {
    it('shares a complete folder with Unicode names and independent workout copies', () => {
        const link = createFolderLink({ id: 45, name: 'Trening 💪', routines: [routine, { ...routine, id: 2, name: 'Leg day' }] }, 'https://tracker.example/?token=private');
        const payload = parseSharedLink(link);
        expect(payload).toMatchObject({ kind: 'folder', name: 'Trening 💪', routines: [{ name: routine.name }, { name: 'Leg day' }] });
        expect(JSON.stringify(payload)).not.toContain('folder_id');
        expect(JSON.stringify(payload)).not.toContain('999');
        expect(new URL(link).search).toBe('');
    });
    it('preserves single-workout links and rejects invalid nested exercises', () => {
        expect(parseSharedLink(createWorkoutLink(routine, 'https://tracker.example'))).toEqual(parseWorkoutLink(createWorkoutLink(routine, 'https://tracker.example')));
        expect(() => createFolderLink({ id: 1, name: 'Bad', routines: [{ ...routine, exercises: [{ name: 'Squat', planned_sets: -1 }] }] }, 'https://tracker.example')).toThrow();
    });
    it('round trips Unicode and targets without private IDs or URL parameters', () => {
        const link = createWorkoutLink(routine, 'https://tracker.example/?token=private#old');
        expect(new URL(link).search).toBe('');
        expect(parseWorkoutLink(link)).toEqual({ version: 1, name: routine.name, exercises: [{
            name: 'Développé couché', equipment: 'Barbell', primary_muscle: 'Chest', planned_sets: 4,
            target_reps_min: 6, target_reps_max: 10, rest_seconds: 120, target_weight: 60,
        }] });
        expect(JSON.stringify(parseWorkoutLink(link))).not.toContain('999');
    });

    it('handles legacy reps, nullable weight, empty days, and zero rest', () => {
        expect(parseWorkoutLink(createWorkoutLink({ ...routine, exercises: [] }, 'https://tracker.example')).exercises).toEqual([]);
        const link = createWorkoutLink({ ...routine, exercises: [{ name: 'Squat', target_reps: 5, rest_seconds: 0 }] }, 'https://tracker.example');
        expect(parseWorkoutLink(link).exercises[0]).toMatchObject({ planned_sets: 3, target_reps_min: 5, target_reps_max: 5, rest_seconds: 0 });
    });

    it.each(['not a URL', 'https://tracker.example/', 'https://tracker.example/#workout=bad!', `https://tracker.example/#workout=${'a'.repeat(40001)}`, 'javascript:alert(1)#workout=e30'])('rejects malformed links: %.60s', link => {
        expect(() => parseWorkoutLink(link)).toThrow('invalid or unsupported');
    });

    it('rejects unsupported versions and invalid exercise targets', () => {
        const payload = parseWorkoutLink(createWorkoutLink(routine, 'https://tracker.example'));
        const encode = (value: unknown) => `https://tracker.example/#workout=${btoa(Array.from(new TextEncoder().encode(JSON.stringify(value)), byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
        expect(() => parseWorkoutLink(encode({ ...payload, version: 2 }))).toThrow();
        expect(() => parseWorkoutLink(encode({ ...payload, exercises: [{ ...payload.exercises[0], planned_sets: -1 }] }))).toThrow();
        expect(() => parseWorkoutLink(encode({ ...payload, exercises: [{ ...payload.exercises[0], target_reps_max: 2 }] }))).toThrow();
    });
});
