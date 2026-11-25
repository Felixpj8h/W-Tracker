type LoggedSet = { completed?: boolean; is_warmup?: boolean };
type LoggedWorkout = { tracks_set_completion?: boolean; exercises: { sets?: LoggedSet[] }[] };

export const tracksCompletion = (workout: LoggedWorkout) =>
    Boolean(workout.tracks_set_completion || workout.exercises.some(exercise => exercise.sets?.some(set => set.completed)));

export function loggedSets<T extends LoggedSet>(sets: T[] = [], checkedOnly: boolean) {
    return checkedOnly ? sets.filter(set => set.completed) : sets;
}

export function workingSets<T extends LoggedSet>(sets: T[] = [], checkedOnly: boolean) {
    return loggedSets(sets, checkedOnly).filter(set => !set.is_warmup);
}
