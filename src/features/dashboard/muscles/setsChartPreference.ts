import { useSyncExternalStore } from 'react';

/** How the dashboard draws Sets by muscle. Stored per device, like the color theme. */
export type SetsChartStyle = 'radar' | 'bars';

export const SETS_CHART_STYLES: { value: SetsChartStyle; label: string }[] = [
    { value: 'radar', label: 'Radar' },
    { value: 'bars', label: 'Bars' },
];

const KEY = 'workout-sets-chart';
const listeners = new Set<() => void>();
// Used when the browser blocks storage (for example some private windows), so the choice still applies this session.
let unsaved: SetsChartStyle | null = null;

function read(): SetsChartStyle {
    if (unsaved) return unsaved;
    try { return localStorage.getItem(KEY) === 'bars' ? 'bars' : 'radar'; } catch { return 'radar'; }
}

export function setSetsChartStyle(value: SetsChartStyle) {
    try { localStorage.setItem(KEY, value); unsaved = null; } catch { unsaved = value; }
    listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    // Another tab changed the choice: re-read it.
    const onStorage = (event: StorageEvent) => { if (event.key === KEY) listener(); };
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

export function useSetsChartStyle() {
    return useSyncExternalStore(subscribe, read, () => 'radar' as const);
}
