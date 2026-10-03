import type { Dash, WeightEntry } from './types';

export const withSavedWeight = (current: Dash | null, entry: WeightEntry): Dash | null => {
    if (!current) return current;
    const weightSeries = [...current.weight_series.filter(item => item.recorded_on !== entry.recorded_on), { recorded_on: entry.recorded_on, weight: entry.weight }]
        .sort((a, b) => a.recorded_on.localeCompare(b.recorded_on));
    return { ...current, weight_series: weightSeries, latest_weight: weightSeries.at(-1) ?? null };
};

export const withOptimisticWeights = (dashboard: Dash, weights: Map<string, number>): Dash => {
    let result: Dash | null = dashboard;
    weights.forEach((weight, recorded_on) => { result = withSavedWeight(result, { recorded_on, weight }); });
    return result ?? dashboard;
};
