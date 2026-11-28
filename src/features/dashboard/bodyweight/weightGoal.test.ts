import { expect, it } from 'vitest';
import { effectiveWeightGoal, weightChangeTone, weightGoalSummary } from './weightGoal';

it('judges weight changes by the goal', () => {
    expect(weightChangeTone(null, -2)).toBe('');
    expect(weightChangeTone('lose', -1.2)).toBe('positive');
    expect(weightChangeTone('lose', 0.8)).toBe('negative');
    expect(weightChangeTone('gain', 0.8)).toBe('positive');
    expect(weightChangeTone('gain', -0.8)).toBe('negative');
    expect(weightChangeTone('lose', 0.01)).toBe('');
    expect(weightChangeTone('maintain', -0.9)).toBe('positive');
    expect(weightChangeTone('maintain', 1.5)).toBe('negative');
    expect(weightChangeTone('lose', null)).toBe('');
});

it('infers the goal from a target weight when none is chosen', () => {
    expect(effectiveWeightGoal('gain', 70, 80)).toBe('gain');
    expect(effectiveWeightGoal(null, null, 80)).toBeNull();
    expect(effectiveWeightGoal(null, 75, 80)).toBe('lose');
    expect(effectiveWeightGoal(null, 85, 80)).toBe('gain');
    expect(effectiveWeightGoal(null, 80.5, 80)).toBe('maintain');
    expect(effectiveWeightGoal(null, 75, null)).toBeNull();
});

it('summarises the distance to a target weight', () => {
    expect(weightGoalSummary(null, null, 85)).toBeNull();
    expect(weightGoalSummary(null, 80, 85)).toEqual({ text: 'Goal: 80.0 kg · 5.0 kg to go', tone: '' });
    expect(weightGoalSummary(null, 80, 80.4)).toEqual({ text: 'Goal: 80.0 kg · On target', tone: 'positive' });
    expect(weightGoalSummary('gain', null, 70)).toEqual({ text: 'Goal: gain weight', tone: '' });
    expect(weightGoalSummary('lose', 80, 83.45)).toEqual({ text: 'Goal: 80.0 kg · 3.5 kg to go', tone: '' });
    expect(weightGoalSummary('lose', 80, 79.5)).toEqual({ text: 'Goal: 80.0 kg · Reached', tone: 'positive' });
    expect(weightGoalSummary('gain', 90, 85)).toEqual({ text: 'Goal: 90.0 kg · 5.0 kg to go', tone: '' });
    expect(weightGoalSummary('maintain', 80, 80.6)).toEqual({ text: 'Goal: 80.0 kg · On target', tone: 'positive' });
    expect(weightGoalSummary('lose', 80, null)).toEqual({ text: 'Goal: 80.0 kg', tone: '' });
});
