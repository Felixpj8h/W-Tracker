import { describe, expect, it } from 'vitest';
import { exerciseChange, exerciseId, exerciseRemoved, prescriptionChanged } from './proposal';

describe('routine proposal comparison', () => {
  const current = [{ exercise: { id: 176, name: 'Incline Bench Press' } }, { exercise: { id: 9, name: 'Lateral raise' } }];
  const proposed = [{ exercise_id: 176 }, { exercise_id: 9 }];

  it('matches nested folder exercises with proposal exercise IDs', () => {
    expect(exerciseId(current[0])).toBe(176);
    expect(exerciseRemoved(current[0], proposed)).toBe(false);
    expect(exerciseChange(current, proposed, 0)).toBeNull();
    expect(exerciseChange(current, proposed, 1)).toBeNull();
  });

  it('detects actual additions, removals and moves', () => {
    expect(exerciseChange(current, [{ exercise_id: 9 }, { exercise_id: 42 }], 0)).toBe('moved');
    expect(exerciseChange(current, [{ exercise_id: 9 }, { exercise_id: 42 }], 1)).toBe('added');
    expect(exerciseRemoved(current[0], [{ exercise_id: 9 }, { exercise_id: 42 }])).toBe(true);
  });

  it('flags a changed set prescription on the same exercise', () => {
    expect(prescriptionChanged([{ exercise: { id: 9, name: 'Lateral raise' }, planned_sets: 3 }], { exercise_id: 9, planned_sets: 5 })).toBe(true);
  });
});
