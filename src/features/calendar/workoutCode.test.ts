import { describe, expect, it } from 'vitest';
import { workoutCode, workoutType } from './workoutCode';

describe('workout codes', () => {
    it('maps common split names to short codes', () => {
        expect(workoutCode('Full Body')).toBe('F');
        expect(workoutCode('Upper')).toBe('U');
        expect(workoutCode('Lower body')).toBe('L');
        expect(workoutCode('Push day')).toBe('Ps');
        expect(workoutCode('Pull')).toBe('Pl');
        expect(workoutCode('Leg day')).toBe('Lg');
    });

    it('adds a trailing A/B/C or number variant', () => {
        expect(workoutCode('Full Body C')).toBe('FC');
        expect(workoutCode('Upper A')).toBe('UA');
        expect(workoutCode('Push 2')).toBe('Ps2');
        expect(workoutCode('Comprehensive Full Body Debug Workout')).toBe('F');
    });

    it('falls back to the first letter of unknown names', () => {
        expect(workoutCode('Hyrox prep')).toBe('H');
        expect(workoutType('Hyrox prep')).toEqual({ code: 'H', label: 'Hyrox prep' });
        expect(workoutCode('')).toBe('');
        expect(workoutCode(null)).toBe('');
    });
});
