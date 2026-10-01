export type RoutineExerciseRef = { exercise_id?: number | null; exercise?: { id: number; name: string } | null };

export function exerciseId(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as RoutineExerciseRef;
  const id = item.exercise_id ?? item.exercise?.id;
  return typeof id === 'number' && Number.isFinite(id) ? id : null;
}

export function exerciseChange(current: RoutineExerciseRef[], proposed: RoutineExerciseRef[], index: number): 'added' | 'moved' | null {
  const id = exerciseId(proposed[index]);
  if (id === null) return null;
  const oldIndex = current.findIndex(item => exerciseId(item) === id);
  return oldIndex < 0 ? 'added' : oldIndex !== index ? 'moved' : null;
}

export function exerciseRemoved(current: RoutineExerciseRef, proposed: RoutineExerciseRef[]): boolean {
  const id = exerciseId(current);
  return id !== null && !proposed.some(item => exerciseId(item) === id);
}

export function prescriptionChanged(current: unknown[], proposed: Record<string, unknown>): boolean {
  const id = exerciseId(proposed);
  const match = current.find(item => exerciseId(item) === id);
  if (!match || typeof match !== 'object') return false;
  const previous = match as Record<string, unknown>;
  return ['planned_sets', 'target_reps_min', 'target_reps_max', 'target_weight', 'rest_seconds']
    .some(field => (previous[field] ?? null) !== (proposed[field] ?? null));
}
