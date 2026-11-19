import { accountKey } from '../auth/auth';
import type { Workout } from './types';
import type { Exercise, Item } from '../exercises/types';
import { cleanMuscleLabel } from '../exercises/muscles';
import type { Routine } from '../routines/types';
import { today } from '../../shared/lib/format';

export const ACTIVE_WORKOUT_KEY = 'workout-active-session';

const normalizedName = (name: string) => name.trim().toLowerCase();

const recentSubstituteKey = (exercise: Item) => {
    const id = exercise.exercise_id ?? exercise.cached_exercise_id;
    const identity = id ? `id:${id}` : `name:${encodeURIComponent(normalizedName(exercise.name))}`;
    return accountKey(`workout-last-substitute:${identity}`);
};

export const isSameExercise = (item: Item, exercise: Exercise) => {
    const id = item.exercise_id ?? item.cached_exercise_id;
    return id ? id === exercise.id : normalizedName(item.name) === normalizedName(exercise.name);
};

export function lastSubstituteFor(exercise: Item): Exercise | null {
    try {
        const match = JSON.parse(localStorage.getItem(recentSubstituteKey(exercise)) ?? 'null') as Exercise | null;
        return match && Number.isInteger(match.id) && typeof match.name === 'string' && !isSameExercise(exercise, match) ? match : null;
    } catch { return null; }
}

export function rememberSubstituteFor(exercise: Item, substitute: Exercise) {
    try {
        localStorage.setItem(recentSubstituteKey(exercise), JSON.stringify(substitute));
    } catch { /* The picker still works when browser storage is unavailable. */ }
}

export const storedWorkout = (): Workout | null => {
    try {
        localStorage.removeItem(ACTIVE_WORKOUT_KEY);
        const value = localStorage.getItem(accountKey(ACTIVE_WORKOUT_KEY));
        if (!value) return null;
        const parsed = JSON.parse(value) as Workout;
        return parsed && !parsed.completed && parsed.id && Array.isArray(parsed.exercises)
            ? { ...parsed, exercises: parsed.exercises.map(item => ({ ...item, primary_muscle: cleanMuscleLabel(item.primary_muscle, item.secondary_muscles) })) }
            : null;
    } catch {
        localStorage.removeItem(accountKey(ACTIVE_WORKOUT_KEY));
        return null;
    }
};

export const optimisticWorkoutFromRoutine = (routine: Routine): Workout => ({
    name: routine.name,
    performed_on: routine.scheduled_on ?? today(),
    started_at: new Date().toISOString(),
    completed: false,
    exercises: routine.exercises.map(item => ({
        ...item,
        exercise_id: item.exercise_id ?? item.exercise?.id,
        name: item.exercise?.name ?? item.name,
        primary_muscle: item.exercise?.primary_muscle ?? item.primary_muscle,
        secondary_muscles: item.exercise?.secondary_muscles ?? item.secondary_muscles,
        muscle_group: item.exercise?.muscle_group ?? item.muscle_group,
        rest_seconds: item.rest_seconds ?? 90,
        sets: Array.from({ length: item.planned_sets ?? 3 }, () => ({ weight: item.target_weight ?? 0, reps: item.target_reps_min ?? item.target_reps ?? 0 })),
    })),
});
