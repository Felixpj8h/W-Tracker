import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api/client';

export type AIOutputLength = 'brief' | 'normal' | 'comprehensive';
export type WeightGoal = 'lose' | 'maintain' | 'gain';
export type AccountSettings = { ai_output_length: AIOutputLength; weight_goal: WeightGoal | null; target_weight: number | null };
export type SettingsLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

export const AI_OUTPUT_LENGTHS: { value: AIOutputLength; label: string }[] = [
    { value: 'brief', label: 'Brief' },
    { value: 'normal', label: 'Normal' },
    { value: 'comprehensive', label: 'Comprehensive' },
];

export const WEIGHT_GOALS: { value: WeightGoal | null; label: string }[] = [
    { value: null, label: 'No goal' },
    { value: 'lose', label: 'Lose' },
    { value: 'maintain', label: 'Maintain' },
    { value: 'gain', label: 'Gain' },
];

export const TARGET_WEIGHT_RANGE = { min: 20, max: 400 };

const isOutputLength = (value: unknown): value is AIOutputLength => AI_OUTPUT_LENGTHS.some(option => option.value === value);
const isWeightGoal = (value: unknown): value is WeightGoal => value === 'lose' || value === 'maintain' || value === 'gain';
const FIELDS = ['ai_output_length', 'weight_goal', 'target_weight'] as const;

function parseSettings(result: Partial<AccountSettings> | undefined): AccountSettings {
    if (!isOutputLength(result?.ai_output_length)) throw Error('Unexpected settings response');
    const target = result.target_weight;
    return {
        ai_output_length: result.ai_output_length,
        weight_goal: isWeightGoal(result.weight_goal) ? result.weight_goal : null,
        target_weight: typeof target === 'number' && Number.isFinite(target) ? target : null,
    };
}

const changedFields = (from: AccountSettings, to: AccountSettings) => FIELDS.filter(field => from[field] !== to[field]);

export type AccountSettingsController = {
    settings: AccountSettings | null;
    aiOutputLength: AIOutputLength | null;
    weightGoal: WeightGoal | null;
    targetWeight: number | null;
    loadState: SettingsLoadState;
    saveError: string | null;
    load: () => Promise<void>;
    setAIOutputLength: (value: AIOutputLength) => void;
    setWeightGoal: (value: WeightGoal | null) => void;
    setTargetWeight: (value: number | null) => void;
};

/**
 * Account settings that persist on the server. Changes save immediately and
 * are written one at a time: rapid selections collapse into the latest value,
 * so the server never ends up holding an older choice than the screen shows.
 * Each write sends only the fields that differ from what the server confirmed.
 * A failed write reverts to the last value the server confirmed unless the
 * user has already picked something newer, which is then written instead.
 */
export function useAccountSettings(active: boolean): AccountSettingsController {
    const [settings, setSettings] = useState<AccountSettings | null>(null);
    const [loadState, setLoadState] = useState<SettingsLoadState>('idle');
    const [saveError, setSaveError] = useState<string | null>(null);
    const confirmed = useRef<AccountSettings | null>(null);
    const desired = useRef<AccountSettings | null>(null);
    const writing = useRef(false);
    const loading = useRef(false);

    const fetchSettings = useCallback(() => {
        // Selection is disabled until the first load succeeds, so a load never
        // races a pending write.
        if (loading.current || confirmed.current !== null) return;
        loading.current = true;
        return api<Partial<AccountSettings>>('/settings').then(result => {
            const loaded = parseSettings(result);
            confirmed.current = desired.current = loaded;
            setSettings(loaded);
            setLoadState('loaded');
        }).catch(() => {
            setLoadState('failed');
        }).finally(() => {
            loading.current = false;
        });
    }, []);

    // The first fetch starts when a screen that needs settings opens; `idle` reads as loading.
    useEffect(() => { if (active && loadState === 'idle') void fetchSettings(); }, [active, loadState, fetchSettings]);

    const load = useCallback(async () => { setLoadState('loading'); await fetchSettings(); }, [fetchSettings]);

    const flush = useCallback(async () => {
        if (writing.current) return;
        writing.current = true;
        // Fields whose latest write may have reached the server without a response.
        let unconfirmed: readonly (typeof FIELDS)[number][] = [];
        try {
            while (desired.current && confirmed.current) {
                const target = desired.current;
                const fields = [...new Set([...unconfirmed, ...changedFields(confirmed.current, target)])];
                if (!fields.length) break;
                try {
                    await api<AccountSettings>('/settings', { method: 'PUT', body: JSON.stringify(Object.fromEntries(fields.map(field => [field, target[field]]))) });
                    confirmed.current = { ...confirmed.current, ...Object.fromEntries(fields.map(field => [field, target[field]])) };
                    unconfirmed = [];
                } catch {
                    if (desired.current !== target) {
                        unconfirmed = fields;
                        continue;
                    }
                    desired.current = confirmed.current;
                    setSettings(confirmed.current);
                    setSaveError(fields.includes('ai_output_length')
                        ? 'Could not confirm your AI response length was saved. Try selecting it again.'
                        : 'Could not confirm your weight goal was saved. Try again.');
                    break;
                }
            }
        } finally {
            writing.current = false;
        }
    }, []);

    const update = useCallback((changes: Partial<AccountSettings>) => {
        const current = desired.current;
        if (confirmed.current === null || current === null) return;
        const next = { ...current, ...changes };
        if (!changedFields(current, next).length) return;
        setSaveError(null);
        desired.current = next;
        setSettings(next);
        void flush();
    }, [flush]);

    const setAIOutputLength = useCallback((value: AIOutputLength) => update({ ai_output_length: value }), [update]);
    const setWeightGoal = useCallback((value: WeightGoal | null) => update({ weight_goal: value }), [update]);
    const setTargetWeight = useCallback((value: number | null) => update({ target_weight: value }), [update]);

    return {
        settings,
        aiOutputLength: settings?.ai_output_length ?? null,
        weightGoal: settings?.weight_goal ?? null,
        targetWeight: settings?.target_weight ?? null,
        loadState, saveError, load, setAIOutputLength, setWeightGoal, setTargetWeight,
    };
}
