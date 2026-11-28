import { useSyncExternalStore } from 'react';

/**
 * How empty sets get a weight during a live workout.
 * - off: sets keep the routine's target weight, or stay empty.
 * - first: typing a weight in the first working set copies it to the later sets that still follow it.
 * - last: empty working sets take the weights from the last session of that exercise.
 */
export type SetPrefill = 'off' | 'first' | 'last';
export type WorkoutPreferences = { setPrefill: SetPrefill; autoRest: boolean; restAlert: boolean };

export const SET_PREFILLS: { value: SetPrefill; label: string }[] = [
    { value: 'off', label: 'Off' },
    { value: 'first', label: 'First set' },
    { value: 'last', label: 'Last session' },
];

export const DEFAULT_WORKOUT_PREFERENCES: WorkoutPreferences = { setPrefill: 'last', autoRest: true, restAlert: true };

const KEY = 'workout-preferences';
const listeners = new Set<() => void>();
// Used when the browser blocks storage, so a choice still applies this session.
let unsaved: WorkoutPreferences | null = null;
// useSyncExternalStore needs the same object until the stored value changes.
let cached: { raw: string | null; value: WorkoutPreferences } | null = null;

function parse(raw: string | null): WorkoutPreferences {
    try {
        const stored = JSON.parse(raw ?? 'null') as Partial<WorkoutPreferences> | null;
        return {
            setPrefill: SET_PREFILLS.some(option => option.value === stored?.setPrefill) ? stored!.setPrefill! : DEFAULT_WORKOUT_PREFERENCES.setPrefill,
            autoRest: typeof stored?.autoRest === 'boolean' ? stored.autoRest : DEFAULT_WORKOUT_PREFERENCES.autoRest,
            restAlert: typeof stored?.restAlert === 'boolean' ? stored.restAlert : DEFAULT_WORKOUT_PREFERENCES.restAlert,
        };
    } catch { return DEFAULT_WORKOUT_PREFERENCES; }
}

export function readWorkoutPreferences(): WorkoutPreferences {
    if (unsaved) return unsaved;
    let raw: string | null = null;
    try { raw = localStorage.getItem(KEY); } catch { /* Fall back to the defaults. */ }
    if (cached?.raw !== raw) cached = { raw, value: parse(raw) };
    return cached.value;
}

export function setWorkoutPreferences(changes: Partial<WorkoutPreferences>) {
    const next = { ...readWorkoutPreferences(), ...changes };
    try { localStorage.setItem(KEY, JSON.stringify(next)); unsaved = null; } catch { unsaved = next; }
    listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => { if (event.key === KEY) listener(); };
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

export function useWorkoutPreferences() {
    return useSyncExternalStore(subscribe, readWorkoutPreferences, () => DEFAULT_WORKOUT_PREFERENCES);
}
