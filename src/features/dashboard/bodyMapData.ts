import type { BodyMapMuscle } from './types';
import { api } from '../../shared/api/client';
import { demoApi } from '../demo/api';

export type BodyMapResult = { muscles: BodyMapMuscle[]; showing_last_seven_days?: boolean };
/** Which period the current week's map shows. Without one, the server shows the last seven days when the week is empty. */
export type BodyMapPeriod = 'week' | 'last_seven_days';

/** A result younger than this is reused without asking the server again. */
const FRESH_MS = 30_000;
type Entry = { promise: Promise<BodyMapResult>; result?: BodyMapResult; at: number };
const cache = new Map<string, Entry>();

const queryFor = (selectedWeek?: string, throughToday = false, period?: BodyMapPeriod) =>
    selectedWeek ? `?selected_week=${selectedWeek}&through_today=${throughToday}${period ? `&period=${period}` : ''}` : '';
export const bodyMapKey = (readOnly: boolean, selectedWeek?: string, throughToday = false, period?: BodyMapPeriod) => `${readOnly ? 'demo' : 'account'}${queryFor(selectedWeek, throughToday, period)}`;

function decode(src: string): Promise<void> {
    if (typeof Image === 'undefined') return Promise.resolve();
    const image = new Image();
    image.src = src;
    return typeof image.decode === 'function' ? image.decode().catch(() => undefined) : Promise.resolve();
}

/** Body outlines and every trained muscle's overlay, decoded before the map is shown so they appear together. */
const decodeImages = (result: BodyMapResult) => Promise.all([
    decode('/body-front.svg'), decode('/body-back.svg'),
    ...result.muscles.filter(muscle => muscle.volume > 0).map(muscle => decode(muscle.image_url)),
]);

/** The last loaded map for this view, if any, to show straight away while a newer one loads. */
export function cachedBodyMap(key: string) {
    return cache.get(key)?.result ?? null;
}

/**
 * Loads the map and its images. Calls for the same view share one request, so the dashboard can start
 * loading when the Heatmap control is hovered, focused or touched and the map reuses that work.
 */
export function loadBodyMap(readOnly: boolean, selectedWeek?: string, throughToday = false, { force = false, period }: { force?: boolean; period?: BodyMapPeriod } = {}): Promise<BodyMapResult> {
    const key = bodyMapKey(readOnly, selectedWeek, throughToday, period);
    const existing = cache.get(key);
    if (existing && !force && Date.now() - existing.at < FRESH_MS) return existing.promise;
    const load = readOnly ? demoApi : api;
    const entry: Entry = { promise: Promise.resolve() as unknown as Promise<BodyMapResult>, result: existing?.result, at: Date.now() };
    entry.promise = load<BodyMapResult>(`/dashboard/body-map${queryFor(selectedWeek, throughToday, period)}`).then(async data => {
        await decodeImages(data);
        entry.result = data;
        return data;
    });
    // A failed load is not cached, so the next attempt asks the server again.
    entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
    cache.set(key, entry);
    return entry.promise;
}

/** Tests only. */
export function clearBodyMapCache() {
    cache.clear();
}
