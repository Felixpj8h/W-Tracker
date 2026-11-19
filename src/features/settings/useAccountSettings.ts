import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api/client';

export type AIOutputLength = 'brief' | 'normal' | 'comprehensive';
export type AccountSettings = { ai_output_length: AIOutputLength };
export type SettingsLoadState = 'idle' | 'loading' | 'loaded' | 'failed';

export const AI_OUTPUT_LENGTHS: { value: AIOutputLength; label: string }[] = [
    { value: 'brief', label: 'Brief' },
    { value: 'normal', label: 'Normal' },
    { value: 'comprehensive', label: 'Comprehensive' },
];

const isOutputLength = (value: unknown): value is AIOutputLength => AI_OUTPUT_LENGTHS.some(option => option.value === value);

export type AccountSettingsController = {
    aiOutputLength: AIOutputLength | null;
    loadState: SettingsLoadState;
    saveError: string | null;
    load: () => Promise<void>;
    setAIOutputLength: (value: AIOutputLength) => void;
};

/**
 * Account settings that persist on the server. Changes save immediately and
 * are written one at a time: rapid selections collapse into the latest value,
 * so the server never ends up holding an older choice than the screen shows.
 * A failed write reverts to the last value the server confirmed unless the
 * user has already picked something newer, which is then written instead.
 */
export function useAccountSettings(active: boolean): AccountSettingsController {
    const [aiOutputLength, setValue] = useState<AIOutputLength | null>(null);
    const [loadState, setLoadState] = useState<SettingsLoadState>('idle');
    const [saveError, setSaveError] = useState<string | null>(null);
    const confirmed = useRef<AIOutputLength | null>(null);
    const desired = useRef<AIOutputLength | null>(null);
    const writing = useRef(false);
    const loading = useRef(false);

    const fetchSettings = useCallback(() => {
        // Selection is disabled until the first load succeeds, so a load never
        // races a pending write.
        if (loading.current || confirmed.current !== null) return;
        loading.current = true;
        return api<AccountSettings>('/settings').then(result => {
            if (!isOutputLength(result?.ai_output_length)) throw Error('Unexpected settings response');
            confirmed.current = desired.current = result.ai_output_length;
            setValue(result.ai_output_length);
            setLoadState('loaded');
        }).catch(() => {
            setLoadState('failed');
        }).finally(() => {
            loading.current = false;
        });
    }, []);

    // The first fetch starts when Settings opens; `idle` reads as loading.
    useEffect(() => { if (active && loadState === 'idle') void fetchSettings(); }, [active, loadState, fetchSettings]);

    const load = useCallback(async () => { setLoadState('loading'); await fetchSettings(); }, [fetchSettings]);

    const flush = useCallback(async () => {
        if (writing.current) return;
        writing.current = true;
        let previousWriteUnconfirmed = false;
        try {
            while (desired.current !== null && (previousWriteUnconfirmed || desired.current !== confirmed.current)) {
                const target = desired.current;
                try {
                    await api<AccountSettings>('/settings', { method: 'PUT', body: JSON.stringify({ ai_output_length: target }) });
                    confirmed.current = target;
                    previousWriteUnconfirmed = false;
                } catch {
                    if (desired.current !== target) {
                        // The server may have saved a request whose response was lost.
                        previousWriteUnconfirmed = true;
                        continue;
                    }
                    desired.current = confirmed.current;
                    setValue(confirmed.current);
                    setSaveError('Could not confirm your AI response length was saved. Try selecting it again.');
                    break;
                }
            }
        } finally {
            writing.current = false;
        }
    }, []);

    const setAIOutputLength = useCallback((value: AIOutputLength) => {
        if (confirmed.current === null || desired.current === value) return;
        setSaveError(null);
        desired.current = value;
        setValue(value);
        void flush();
    }, [flush]);

    return { aiOutputLength, loadState, saveError, load, setAIOutputLength };
}
