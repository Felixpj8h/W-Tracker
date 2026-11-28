import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api/client';
import { healthToday } from '../../health/Health';
import type { HealthOverview } from '../../health/types';

/** Same freshness rule as the Health page: resync after five minutes, or when the last sync was on another day. */
const STALE_MS = 5 * 60_000;

export function isHealthStale(overview: HealthOverview, now = new Date()) {
    if (!overview.fetched_at) return true;
    const synced = new Date(overview.fetched_at * 1000);
    return now.getTime() - synced.getTime() > STALE_MS || healthToday(synced) !== healthToday(now);
}

export type HealthSnapshotState = { overview: HealthOverview | null; loading: boolean; error: boolean; retry: () => void };

/**
 * Loads the saved Google Health snapshot for the dashboard, then syncs in the background when it is stale.
 * A failed sync keeps the saved snapshot on screen; only a failed load shows an error.
 */
export function useHealthSnapshot(enabled: boolean): HealthSnapshotState {
    const [overview, setOverview] = useState<HealthOverview | null>(null);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => {
        setLoading(true);
        setError(false);
        setAttempt(value => value + 1);
    }, []);

    useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        let loadedAt = 0, running = false, loaded = false;
        const load = async () => {
            if (running) return;
            running = true;
            loadedAt = Date.now();
            try {
                let result: HealthOverview;
                try {
                    result = await api<HealthOverview>('/health/overview', { signal: controller.signal });
                } catch {
                    // After a resume, keep the snapshot already on screen instead of replacing it with an error.
                    if (!controller.signal.aborted && !loaded) setError(true);
                    return;
                }
                if (controller.signal.aborted) return;
                loaded = true;
                setOverview(result);
                setError(false);
                setLoading(false);
                if (!result?.connected || !isHealthStale(result)) return;
                try {
                    const synced = await api<HealthOverview>('/health/sync', {
                        method: 'POST', body: JSON.stringify({ today: healthToday() }), signal: controller.signal,
                    }, { trackWrite: false });
                    if (!controller.signal.aborted) setOverview(synced);
                } catch {
                    // Keep the saved snapshot. The Health page shows sync errors and permission problems.
                }
            } finally {
                running = false;
                if (!controller.signal.aborted) setLoading(false);
            }
        };
        // Installed apps resume instead of reloading, so refresh when the app returns after the data went stale.
        const resume = () => { if (document.visibilityState === 'visible' && Date.now() - loadedAt > STALE_MS) void load(); };
        void load();
        document.addEventListener('visibilitychange', resume);
        return () => {
            controller.abort();
            document.removeEventListener('visibilitychange', resume);
        };
    }, [enabled, attempt]);

    return { overview, loading, error, retry };
}
