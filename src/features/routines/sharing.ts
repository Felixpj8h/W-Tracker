import type { Folder, Routine } from './types';

export const WORKOUT_LINK_KEY = 'workout';
const MAX_PAYLOAD_LENGTH = 40000;
const invalidLink = () => new Error('This workout link is invalid or unsupported. Ask for a new link.');

export type SharedExercise = {
    name: string;
    equipment: string;
    primary_muscle?: string;
    planned_sets: number;
    target_reps_min: number;
    target_reps_max: number;
    rest_seconds: number;
    target_weight?: number;
};
export type SharedWorkout = { version: 1; name: string; exercises: SharedExercise[] };
export type SharedFolder = { version: 1; kind: 'folder'; name: string; routines: SharedWorkout[] };

export function createFolderLink(folder: Folder, base = window.location.href): string {
    const payload: SharedFolder = { version: 1, kind: 'folder', name: folder.name,
        routines: folder.routines.map(routine => parseWorkoutLink(createWorkoutLink(routine, base))) };
    const url = new URL(base);
    url.search = '';
    url.hash = new URLSearchParams({ [WORKOUT_LINK_KEY]: encodePayload(payload) }).toString();
    parseSharedLink(url.href);
    return url.href;
}

function encodePayload(payload: unknown): string {
    return btoa(Array.from(new TextEncoder().encode(JSON.stringify(payload)), byte => String.fromCharCode(byte)).join(''))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function parseSharedLink(link: string): SharedWorkout | SharedFolder {
    try {
        const url = new URL(link.trim());
        if (!['http:', 'https:'].includes(url.protocol)) throw invalidLink();
        const encoded = new URLSearchParams(url.hash.slice(1)).get(WORKOUT_LINK_KEY);
        if (!encoded || encoded.length > MAX_PAYLOAD_LENGTH || !/^[\w-]+$/.test(encoded)) throw invalidLink();
        const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (value?.kind !== 'folder') return parseWorkoutLink(link);
        if (value.version !== 1 || !validText(value.name, 100) || !Array.isArray(value.routines) || value.routines.length > 30) throw invalidLink();
        const routines = value.routines.map((routine: unknown) => {
            const nested = new URL(url);
            nested.hash = new URLSearchParams({ [WORKOUT_LINK_KEY]: encodePayload(routine) }).toString();
            return parseWorkoutLink(nested.href);
        });
        return { version: 1, kind: 'folder', name: value.name.trim(), routines };
    } catch { throw invalidLink(); }
}

function validText(value: unknown, max: number): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function validInteger(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function parseWorkoutLink(link: string): SharedWorkout {
    try {
        const url = new URL(link.trim());
        if (!['http:', 'https:'].includes(url.protocol)) throw invalidLink();
        const encoded = new URLSearchParams(url.hash.slice(1)).get(WORKOUT_LINK_KEY);
        if (!encoded || encoded.length > MAX_PAYLOAD_LENGTH || !/^[\w-]+$/.test(encoded)) throw invalidLink();
        const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!value || value.version !== 1 || !validText(value.name, 120) || !Array.isArray(value.exercises) || value.exercises.length > 50) throw invalidLink();
        const exercises = value.exercises.map((item: SharedExercise) => {
            if (!item || !validText(item.name, 180) || !validText(item.equipment, 100)
                || (item.primary_muscle !== undefined && !validText(item.primary_muscle, 80))
                || !validInteger(item.planned_sets, 1, 20) || !validInteger(item.target_reps_min, 1, 100)
                || !validInteger(item.target_reps_max, item.target_reps_min, 100) || !validInteger(item.rest_seconds, 0, 1800)
                || (item.target_weight !== undefined && (typeof item.target_weight !== 'number' || !Number.isFinite(item.target_weight) || item.target_weight < 0))) throw invalidLink();
            // Explicitly copy only workout fields, never account data or source IDs.
            return { name: item.name.trim(), equipment: item.equipment.trim(), primary_muscle: item.primary_muscle,
                planned_sets: item.planned_sets, target_reps_min: item.target_reps_min, target_reps_max: item.target_reps_max,
                rest_seconds: item.rest_seconds, target_weight: item.target_weight };
        });
        return { version: 1, name: value.name.trim(), exercises };
    } catch { throw invalidLink(); }
}

export function createWorkoutLink(routine: Routine, base = window.location.href): string {
    const payload: SharedWorkout = { version: 1, name: routine.name, exercises: routine.exercises.map(item => {
        const muscle = item.exercise?.primary_muscle ?? item.primary_muscle;
        return {
            name: item.exercise?.name ?? item.name,
            equipment: item.exercise?.equipment ?? 'Other',
            primary_muscle: muscle?.replace(/^Primary: /, '').split(' · Secondary:')[0] || undefined,
            planned_sets: item.planned_sets ?? 3,
            target_reps_min: item.target_reps_min ?? item.target_reps ?? 8,
            target_reps_max: item.target_reps_max ?? item.target_reps ?? 12,
            rest_seconds: item.rest_seconds ?? 90,
            target_weight: item.target_weight ?? undefined,
        };
    }) };
    const encoded = btoa(Array.from(new TextEncoder().encode(JSON.stringify(payload)), byte => String.fromCharCode(byte)).join(''))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (encoded.length > MAX_PAYLOAD_LENGTH) throw new Error('This workout is too large to share with a link.');
    const url = new URL(base);
    url.search = '';
    url.hash = new URLSearchParams({ [WORKOUT_LINK_KEY]: encoded }).toString();
    parseWorkoutLink(url.href);
    return url.href;
}

export function hasWorkoutLink(): boolean {
    return new URLSearchParams(window.location.hash.slice(1)).has(WORKOUT_LINK_KEY);
}

export function clearWorkoutLink() {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    hash.delete(WORKOUT_LINK_KEY);
    url.hash = hash.toString();
    window.history.replaceState(window.history.state, '', url.href);
}
