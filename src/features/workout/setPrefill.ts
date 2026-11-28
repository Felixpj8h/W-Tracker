import type { ExerciseProgress, Item } from '../exercises/types';

type LoggedSet = NonNullable<Item['sets']>[number];
type PreviousSet = { weight: number; reps: number };

/**
 * Sets a weight and, when it is the first working set, copies it to the later
 * working sets that still follow it: unchecked sets that are empty or still
 * hold the first set's previous weight. A set given its own weight stops following.
 */
export function matchFirstSetWeight(sets: LoggedSet[], index: number, weight: number): LoggedSet[] {
    const previous = sets[index]?.weight;
    const updated = sets.map((set, i) => i === index ? { ...set, weight } : set);
    if (index !== sets.findIndex(set => !set.is_warmup)) return updated;
    return updated.map((set, i) => i > index && !set.is_warmup && !set.completed && (set.weight === previous || set.weight === 0) ? { ...set, weight } : set);
}

/** The latest session with a recorded weight, as the Last time panel shows it. */
export const lastSessionSets = (progress: ExerciseProgress | undefined | null): PreviousSet[] =>
    progress?.sessions.find(session => session.sets.some(set => set.weight > 0))?.sets ?? [];

/**
 * Fills empty, unchecked working sets with last session's weights, matching
 * them set by set and reusing the last set when there are more sets today.
 * Reps are filled only where none are set. Returns null when nothing changes.
 */
export function prefillFromLastSession(sets: LoggedSet[], previous: PreviousSet[]): LoggedSet[] | null {
    if (!previous.length) return null;
    let working = 0, changed = false;
    const next = sets.map(set => {
        if (set.is_warmup) return set;
        const source = previous[Math.min(working, previous.length - 1)];
        working += 1;
        if (set.completed || set.weight !== 0 || source.weight <= 0) return set;
        changed = true;
        return { ...set, weight: source.weight, reps: set.reps || source.reps };
    });
    return changed ? next : null;
}

/** A new set copies the weight and reps of the set above it. */
export function nextSet(sets: LoggedSet[] = []): LoggedSet {
    const last = sets.at(-1);
    return { weight: last?.weight ?? 0, reps: last?.reps ?? 0, completed: false };
}
