// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { activateAccount, accountKey, invalidateAccount, sessionGeneration, sessionIsCurrent } from '../auth/auth';
import { ACTIVE_WORKOUT_KEY, storedWorkout } from './session';

const draft = { id: 71, revision: 1, name: 'Private A workout', completed: false, exercises: [] };

afterEach(() => { localStorage.clear(); activateAccount('reset@example.test'); });

it('discards a legacy draft whose owner cannot be established', () => {
    localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify(draft));
    activateAccount('a@example.test');
    expect(storedWorkout()).toBeNull();
    expect(localStorage.getItem(ACTIVE_WORKOUT_KEY)).toBeNull();
});

it('never restores another account draft and invalidates old save callbacks', () => {
    activateAccount('a@example.test');
    localStorage.setItem(accountKey(ACTIVE_WORKOUT_KEY), JSON.stringify(draft));
    localStorage.setItem(accountKey('workout-position:71'), '{"index":1}');
    expect(storedWorkout()?.name).toBe(draft.name);
    const beforeLogout = sessionGeneration();
    invalidateAccount();
    expect(sessionIsCurrent(beforeLogout)).toBe(false);
    activateAccount('b@example.test');
    expect(storedWorkout()).toBeNull();
    expect(Object.keys(localStorage).filter(key => key.startsWith('workout-'))).toEqual([]);
});

it('a delayed logout from another tab cannot erase the new account cache', () => {
    activateAccount('b@example.test');
    const bKey = accountKey(ACTIVE_WORKOUT_KEY);
    localStorage.setItem(bKey, JSON.stringify({ ...draft, name: 'B draft' }));
    activateAccount('a@example.test');
    invalidateAccount();
    expect(localStorage.getItem(bKey)).toContain('B draft');
});
