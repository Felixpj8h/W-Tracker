import { authHeaders } from '../../features/auth/auth';

export const API = import.meta.env.VITE_API_URL ?? '/api/v1';

export let pendingBackendWrites = 0;

export let backendWriteFailed = false;

export type BackendWriteState = { pending: number; failed: boolean };

const announceBackendWrites = () => window.dispatchEvent(new CustomEvent<BackendWriteState>('backend-write-state', { detail: { pending: pendingBackendWrites, failed: backendWriteFailed } }));

const finishBackendWriteAfterPaint = (failed: boolean) => {
    const finish = () => {
        pendingBackendWrites = Math.max(0, pendingBackendWrites - 1);
        if (failed) backendWriteFailed = true;
        announceBackendWrites();
    };
    // Let the caller apply its response to React state, then keep the indicator
    // visible through the browser paint that presents that state to the user.
    if (document.visibilityState === 'hidden') setTimeout(finish, 0);
    else requestAnimationFrame(() => requestAnimationFrame(finish));
};

export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
    const isWrite = Boolean(opts?.method && opts.method.toUpperCase() !== 'GET');
    const optimisticWorkoutDelete = opts?.method?.toUpperCase() === 'DELETE' ? path.match(/^\/workouts\/(\d+)$/)?.[1] : undefined;
    if (isWrite) { if (pendingBackendWrites === 0) backendWriteFailed = false; pendingBackendWrites += 1; announceBackendWrites(); }
    if (optimisticWorkoutDelete) window.dispatchEvent(new CustomEvent('optimistic-workout-delete', { detail: { id: Number(optimisticWorkoutDelete), deleted: true } }));
    let failed = false;
    try {
        const response = await fetch(API + path, { ...opts, credentials: 'include', cache: 'no-store', headers: authHeaders({ 'Content-Type': 'application/json', ...Object.fromEntries(new Headers(opts?.headers)) }) });
        if (response.status === 401) window.dispatchEvent(new Event('google-auth-expired'));
        if (!response.ok) throw Error('Could not reach the tracker server');
        const payload = await response.json();
        // A successful HTTP response is sufficient for older API versions that
        // predate the optional `saved` acknowledgement. Only roll optimistic UI
        // back when the server explicitly reports that persistence failed.
        if (isWrite && payload?.saved === false) throw Error('The tracker server did not confirm that the change was saved');
        return payload as T;
    } catch (error) {
        failed = true;
        if (optimisticWorkoutDelete) window.dispatchEvent(new CustomEvent('optimistic-workout-delete', { detail: { id: Number(optimisticWorkoutDelete), deleted: false } }));
        throw error;
    } finally {
        if (isWrite) finishBackendWriteAfterPaint(failed);
    }
}
