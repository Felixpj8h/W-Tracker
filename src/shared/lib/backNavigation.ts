import { useEffect, useLayoutEffect, useRef } from 'react';

/*
 * Jern switches pages and opens sheets without changing the URL, so the browser
 * history has nothing to go back to. In an installed Android app the system Back
 * gesture then closes the app from anywhere.
 *
 * While anything can be backed out of, one extra history entry (the guard, same
 * URL) sits on top of the page. Back removes the guard; the most recent action
 * runs (close the top sheet, otherwise return to the Dashboard) and the guard is
 * restored if something is still open. On the Dashboard with nothing open there
 * is no guard, so Back leaves the app as usual.
 */

type Action = { id: number; layer: number; run: () => void };
export type BackLayer = 'page' | 'overlay';

const STATE_KEY = 'jernBack';
const actions: Action[] = [];
let nextId = 1;
let guardId = 0;
let removingGuard = false;
let syncQueued = false;
let started = false;

const stateGuard = () => {
  const state = window.history.state as Record<string, unknown> | null;
  return state && typeof state === 'object' && typeof state[STATE_KEY] === 'number' ? state[STATE_KEY] as number : 0;
};
const onGuard = () => guardId !== 0 && stateGuard() === guardId;
const topAction = () => actions.reduce<Action | undefined>((top, action) => !top || action.layer > top.layer || (action.layer === top.layer && action.id > top.id) ? action : top, undefined);

function sync() {
  syncQueued = false;
  if (removingGuard) return;
  if (actions.length && !guardId) {
    guardId = nextId++;
    window.history.pushState({ [STATE_KEY]: guardId }, '');
  } else if (!actions.length && guardId) {
    const current = onGuard();
    guardId = 0;
    // Only step back over the guard while it is the current entry; otherwise
    // another navigation (such as leaving the demo) already moved past it.
    if (current) {
      removingGuard = true;
      window.history.back();
    }
  }
}

// Effects of one React commit register and unregister together; settle once.
function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(sync);
}

function onPopState() {
  if (removingGuard) {
    removingGuard = false;
    queueSync();
    return;
  }
  // Ignore entries that are not ours, and arriving back on our own guard.
  if (!guardId || onGuard()) return;
  guardId = 0;
  topAction()?.run();
  // Restore the guard once React has applied the change, if anything is still open.
  window.setTimeout(queueSync, 0);
}

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  // After a reload the guard entry may still be current: adopt it.
  const existing = stateGuard();
  if (existing) {
    guardId = existing;
    nextId = existing + 1;
  }
  window.addEventListener('popstate', onPopState);
  queueSync();
}

export function replacePageAfterBackGuard(path: string) {
  const replace = () => window.history.replaceState(null, '', path);
  if (!onGuard()) { replace(); return; }
  guardId = 0;
  removingGuard = true;
  // The guard duplicates the current URL. Replace its underlying entry so
  // the browser cannot return to that page when the user presses Back.
  window.addEventListener('popstate', replace, { capture: true, once: true });
  window.history.back();
}

/**
 * While `active`, the system Back gesture (or browser Back button) calls `onBack`
 * instead of leaving the app. Overlays are handled before page navigation, and
 * the most recently opened overlay first.
 */
export function useBackAction(active: boolean, onBack: () => void, layer: BackLayer = 'overlay') {
  const handler = useRef(onBack);
  useLayoutEffect(() => { handler.current = onBack; });
  useEffect(() => {
    start();
    if (!active) return;
    const action: Action = { id: nextId++, layer: layer === 'page' ? 0 : 1, run: () => handler.current() };
    actions.push(action);
    queueSync();
    return () => {
      actions.splice(actions.indexOf(action), 1);
      queueSync();
    };
  }, [active, layer]);
}
