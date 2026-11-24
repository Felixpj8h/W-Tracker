import type { WeightGoal } from '../settings/useAccountSettings';

export type GoalTone = 'positive' | 'negative' | '';

/** Monthly change within this many kg counts as holding steady for a maintain goal. */
export const MAINTAIN_TOLERANCE_KG = 1;
const NO_CHANGE_KG = 0.05;

/** Whether a weight change moves toward the goal. Without a goal nothing is judged. */
export function weightChangeTone(goal: WeightGoal | null, change: number | null): GoalTone {
    if (!goal || change === null) return '';
    if (goal === 'maintain') return Math.abs(change) <= MAINTAIN_TOLERANCE_KG ? 'positive' : 'negative';
    if (Math.abs(change) < NO_CHANGE_KG) return '';
    return (goal === 'lose') === (change < 0) ? 'positive' : 'negative';
}

/**
 * The goal used for judging progress. Without a chosen goal, a target weight
 * implies one: losing toward a lower target, gaining toward a higher one, and
 * maintaining once within the tolerance of it.
 */
export function effectiveWeightGoal(goal: WeightGoal | null, target: number | null, latest: number | null): WeightGoal | null {
    if (goal || target === null || latest === null) return goal;
    if (target < latest - MAINTAIN_TOLERANCE_KG) return 'lose';
    if (target > latest + MAINTAIN_TOLERANCE_KG) return 'gain';
    return 'maintain';
}

const GOAL_NAMES: Record<WeightGoal, string> = { lose: 'Lose weight', maintain: 'Maintain weight', gain: 'Gain weight' };

/** One-line summary of the goal and, with a target, how far is left. */
export function weightGoalSummary(goal: WeightGoal | null, target: number | null, latest: number | null): { text: string; tone: GoalTone } | null {
    if (target === null) return goal && { text: `Goal: ${GOAL_NAMES[goal].toLowerCase()}`, tone: '' };
    const label = `Goal: ${target.toFixed(1)} kg`;
    if (latest === null) return { text: label, tone: '' };
    const remaining = target - latest;
    if (!goal) {
        const close = Math.abs(remaining) <= MAINTAIN_TOLERANCE_KG;
        return close ? { text: `${label} · On target`, tone: 'positive' } : { text: `${label} · ${Math.abs(remaining).toFixed(1)} kg to go`, tone: '' };
    }
    const reached = goal === 'lose' ? remaining >= 0 : goal === 'gain' ? remaining <= 0 : Math.abs(remaining) <= MAINTAIN_TOLERANCE_KG;
    if (reached) return { text: `${label} · ${goal === 'maintain' ? 'On target' : 'Reached'}`, tone: 'positive' };
    return { text: `${label} · ${Math.abs(remaining).toFixed(1)} kg to go`, tone: '' };
}
