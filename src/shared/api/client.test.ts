// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0; });
});
afterEach(() => vi.unstubAllGlobals());

it.each([
    { status: 403, detail: 'Invalid request origin.', expected: 'HTTP 403: Invalid request origin.' },
    { status: 404, detail: 'Workout not found', expected: 'HTTP 404: Workout not found' },
    { status: 422, detail: [{loc:['body','exercises',0,'sets',0,'weight'],msg:'Must be nonnegative'}], expected:'HTTP 422: exercises.0.sets.0.weight: Must be nonnegative' },
])('exposes the reason for a rejected write ($status)', async ({status,detail,expected}) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({detail}), {status})));
    const client = await import('./client');
    await expect(client.api('/workouts/42', {method:'PUT'})).rejects.toThrow(expected);
    expect(client.backendWriteFailed).toBe(true);
});

it('keeps background refreshes that use POST out of the saving indicator', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:'Provider unavailable'}), {status:502})));
    const client = await import('./client');
    const announce = vi.fn();
    window.addEventListener('backend-write-state', announce);
    await expect(client.api('/health/sync', {method:'POST'}, {trackWrite:false})).rejects.toThrow('HTTP 502: Provider unavailable');
    window.removeEventListener('backend-write-state', announce);
    expect(announce).not.toHaveBeenCalled();
    expect(client.pendingBackendWrites).toBe(0);
    expect(client.backendWriteFailed).toBe(false);
});
