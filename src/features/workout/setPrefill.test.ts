import { expect, it } from 'vitest';
import { lastSessionSets, matchFirstSetWeight, nextSet, prefillFromLastSession } from './setPrefill';
import type { ExerciseProgress } from '../exercises/types';

it('copies the first working set weight to sets that still follow it', () => {
    const sets = [
        { weight: 20, reps: 10, is_warmup: true },
        { weight: 0, reps: 8 },
        { weight: 0, reps: 8 },
        { weight: 70, reps: 8 },
        { weight: 0, reps: 8, completed: true },
    ];
    const typed = matchFirstSetWeight(sets, 1, 6);
    expect(typed.map(set => set.weight)).toEqual([20, 6, 6, 70, 0]);
    const next = matchFirstSetWeight(typed, 1, 60);
    expect(next.map(set => set.weight)).toEqual([20, 60, 60, 70, 0]);
});

it('changes only the edited set when it is not the first working set', () => {
    const sets = [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }, { weight: 60, reps: 8 }];
    expect(matchFirstSetWeight(sets, 1, 62.5).map(set => set.weight)).toEqual([60, 62.5, 60]);
});

it('fills empty working sets from last session set by set', () => {
    const sets = [
        { weight: 0, reps: 0, is_warmup: true },
        { weight: 0, reps: 8 },
        { weight: 0, reps: 0 },
        { weight: 50, reps: 8 },
        { weight: 0, reps: 8 },
    ];
    const filled = prefillFromLastSession(sets, [{ weight: 60, reps: 10 }, { weight: 62.5, reps: 9 }, { weight: 65, reps: 6 }]);
    expect(filled).toEqual([
        { weight: 0, reps: 0, is_warmup: true },
        { weight: 60, reps: 8 },
        { weight: 62.5, reps: 9 },
        { weight: 50, reps: 8 },
        { weight: 65, reps: 8 },
    ]);
    expect(prefillFromLastSession([{ weight: 0, reps: 8, completed: true }], [{ weight: 60, reps: 8 }])).toBeNull();
    expect(prefillFromLastSession([{ weight: 0, reps: 8 }], [])).toBeNull();
});

it('uses the latest session with a recorded weight', () => {
    const session = (weight: number) => ({ workout_id: 1, performed_on: '2026-11-01', workout_name: 'Push', sets: [{ weight, reps: 8 }], volume: 0, best_weight: weight, estimated_1rm: 0 });
    const progress = { sessions: [session(0), session(70), session(65)] } as ExerciseProgress;
    expect(lastSessionSets(progress)).toEqual([{ weight: 70, reps: 8 }]);
    expect(lastSessionSets(undefined)).toEqual([]);
});

it('starts a new set from the set above it', () => {
    expect(nextSet([{ weight: 60, reps: 8, exertion: 8, completed: true }])).toEqual({ weight: 60, reps: 8, completed: false });
    expect(nextSet([])).toEqual({ weight: 0, reps: 0, completed: false });
});
