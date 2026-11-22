import { useEffect } from 'react';

/** Keep the screen on while `enabled`, re-acquiring the lock when the app returns to the foreground. */
export function useScreenWakeLock(enabled: boolean): void {
  useEffect(() => {
    const wakeLock = typeof navigator === 'undefined' ? undefined : navigator.wakeLock;
    if (!enabled || !wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let requesting = false;
    let stopped = false;

    const request = async () => {
      // The system releases the lock whenever the app is hidden.
      if (stopped || requesting || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      requesting = true;
      try {
        const lock = await wakeLock.request('screen');
        if (stopped) void lock.release().catch(() => undefined);
        else sentinel = lock;
      } catch {
        // Denied (for example in Low Power Mode): the screen sleeps as usual.
      } finally {
        requesting = false;
      }
    };
    const onVisibilityChange = () => { void request(); };

    void request();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void sentinel?.release().catch(() => undefined);
    };
  }, [enabled]);
}
