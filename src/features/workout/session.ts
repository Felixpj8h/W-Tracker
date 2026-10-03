import type { Workout } from './types';
import { cleanMuscleLabel } from '../exercises/muscles';
import type { Routine } from '../routines/types';
import { today } from '../../shared/lib/format';

export const ACTIVE_WORKOUT_KEY = 'workout-active-session';

export const storedWorkout = (): Workout | null => {
    try {
        const value = localStorage.getItem(ACTIVE_WORKOUT_KEY);
        if (!value) return null;
        const parsed = JSON.parse(value) as Workout;
        return parsed && !parsed.completed && parsed.id && Array.isArray(parsed.exercises)
            ? { ...parsed, exercises: parsed.exercises.map(item => ({ ...item, primary_muscle: cleanMuscleLabel(item.primary_muscle, item.secondary_muscles) })) }
            : null;
    } catch {
        localStorage.removeItem(ACTIVE_WORKOUT_KEY);
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
