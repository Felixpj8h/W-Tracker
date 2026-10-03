import type { Routine } from './types';

export const routineMuscles = (routine: Routine) => [...new Set(routine.exercises.flatMap(item => (item.exercise?.primary_muscle ?? item.primary_muscle ?? '').replace(/\b(?:Primary|Secondary|Tertiary):\s*/gi, '').split(/[,·]/).map(value => value.trim()).filter(value => value && !/^unmapped/i.test(value))))].slice(0, 3).join(', ');
