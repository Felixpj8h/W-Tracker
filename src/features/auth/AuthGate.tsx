import type { UserProfile } from './profile';
import { JernLogo } from '../../shared/ui/JernLogo';
import { useState, useRef, useCallback, useEffect } from 'react';
import { setGoogleIdToken, authHeaders, activateAccount, invalidateAccount, broadcastAccountChange } from './auth';
import { API } from '../../shared/api/client';
import { profileFromSession } from './profile';

export function AuthGate({ children, onExploreDemo, skipRestore = false }: { children: (user: UserProfile) => React.ReactNode; onExploreDemo?: () => void; skipRestore?: boolean }) {
    const localDevelopment = import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
    const [token, setToken] = useState('');
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [googleReady, setGoogleReady] = useState(false);
    const [checking, setChecking] = useState(false);
    const [logoutPending, setLogoutPending] = useState(false);
    const [logoutFailed, setLogoutFailed] = useState(false);
    const [authError, setAuthError] = useState('');
    const [restoring, setRestoring] = useState(!skipRestore);
    const [restoreAttempt, setRestoreAttempt] = useState(0);
    const googleButton = useRef<HTMLDivElement>(null);
    const authEpoch = useRef(0);
    const signOut = useCallback(() => {
        authEpoch.current += 1;
        invalidateAccount();
        broadcastAccountChange();
        window.google?.accounts.id.disableAutoSelect();
        setGoogleIdToken('');
        setToken('');
        setProfile(null);
        setChecking(false);
        setLogoutPending(true); setLogoutFailed(false);
        void fetch(`${API}/session/logout`, { method: 'POST', credentials: 'include' })
            .then(response => { if (!response.ok) throw Error('Sign out was rejected'); })
            .catch(() => setLogoutFailed(true))
            .finally(() => setLogoutPending(false));
    }, []);

    useEffect(() => {
        const changed = (event: StorageEvent) => {
            if (event.key !== 'workout-account-event') return;
            if (event.newValue !== localStorage.getItem('workout-account-event')) return;
            authEpoch.current += 1;
            invalidateAccount();
            setToken(''); setProfile(null);
            setAuthError('Your account changed in another tab. Reload to sign in.');
        };
        window.addEventListener('storage', changed);
        return () => window.removeEventListener('storage', changed);
    }, []);
    useEffect(() => {
        if (skipRestore) return;
        let cancelled = false;
        const epoch = authEpoch.current;
        const controller = new AbortController();
        setRestoring(true);
        setAuthError('');
        const timeout = window.setTimeout(() => {
            cancelled = true;
            controller.abort();
            setRestoring(false);
            setAuthError('The Jern server took too long to respond. Retry your connection.');
        }, 10000);
        void fetch(`${API}/session`, { credentials: 'include', signal: controller.signal }).then(async response => {
            if (cancelled || epoch !== authEpoch.current) return;
            if (!response.ok) {
                if (localDevelopment) setAuthError(response.status === 401 || response.status === 503
                    ? 'The backend still requires Google login. Restart it with APP_ENV=development.'
                    : `The local backend returned HTTP ${response.status}. Check its terminal output.`);
                else if (response.status !== 401) setAuthError('Cannot restore your session. Retry your connection.');
                return;
            }
            const body = await response.json() as { email?: string; name?: string; given_name?: string; picture?: string };
            if (!cancelled && epoch === authEpoch.current && body.email) {
                activateAccount(body.email);
                setProfile(profileFromSession(body));
                setToken('session');
            }
        }).catch(() => { if (!cancelled) setAuthError(localDevelopment ? 'Cannot reach the local backend. Start it on port 8000, then retry.' : 'Cannot reach the Jern server. Retry your connection.'); }).finally(() => { window.clearTimeout(timeout); if (!cancelled) setRestoring(false); });
        return () => { cancelled = true; window.clearTimeout(timeout); controller.abort(); };
    }, [restoreAttempt, localDevelopment, skipRestore]);

    useEffect(() => {
        window.addEventListener('google-auth-expired', signOut);
        window.addEventListener('google-sign-out', signOut);
        return () => {
            window.removeEventListener('google-auth-expired', signOut);
            window.removeEventListener('google-sign-out', signOut);
        };
    }, [signOut]);

    useEffect(() => {
        if (token || restoring || localDevelopment || logoutPending || logoutFailed) return;
        if (!GOOGLE_CLIENT_ID) {
            setAuthError('Google sign-in is not configured. Add VITE_GOOGLE_CLIENT_ID to your environment.');
            return;
        }
        const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
        const script = existing ?? document.createElement('script');
        const initialize = () => {
            if (!window.google) return;
            window.google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: async response => {
                    const epoch = authEpoch.current;
                    setChecking(true);
                    setAuthError('');
                    setGoogleIdToken(response.credential);
                    try {
                        const validation = await fetch(`${API}/session`, { credentials: 'include', headers: authHeaders() });
                        const body = await validation.json().catch(() => null) as { detail?: string; email?: string; name?: string; given_name?: string; picture?: string } | null;
                        if (!validation.ok) throw new Error(body?.detail ?? 'This Google account cannot access Jern.');
                        if (epoch !== authEpoch.current) return;
                        const authenticatedProfile = profileFromSession(body ?? {});
                        if (!authenticatedProfile.email) throw new Error('Google did not return an email address for this account.');
                        activateAccount(authenticatedProfile.email);
                        broadcastAccountChange();
                        setProfile(authenticatedProfile);
                        setGoogleIdToken('');
                        setToken('session');
                    } catch (error) {
                        setGoogleIdToken('');
                        setAuthError(error instanceof Error ? error.message : 'Google sign-in failed.');
                    } finally {
                        setChecking(false);
                    }
                },
            });
            setGoogleReady(true);
        };
        script.addEventListener('load', initialize);
        script.addEventListener('error', () => setAuthError('Could not load Google sign-in. Check your connection.'));
        if (!existing) {
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            document.head.appendChild(script);
        } else initialize();
        return () => script.removeEventListener('load', initialize);
    }, [token, restoring, logoutPending, logoutFailed]);

    useEffect(() => {
        if (token || restoring || !googleReady || checking || !window.google || !googleButton.current) return;
        googleButton.current.replaceChildren();
        window.google.accounts.id.renderButton(googleButton.current, {
            type: 'standard', theme: 'outline', size: 'large', text: 'continue_with',
            shape: 'rectangular', logo_alignment: 'left', width: Math.min(360, Math.max(280, googleButton.current.clientWidth || 360)),
        });
    }, [checking, googleReady, restoring, token]);

    const demoButton = onExploreDemo && <button type="button" className="auth-demo" onClick={onExploreDemo}>Explore demo</button>;
    if (logoutPending || logoutFailed) return <main className="auth-shell"><section className="auth-card"><h1>Sign out</h1><p role="status">{logoutPending ? 'Signing out…' : 'Your server sign-out could not be confirmed. Retry when connected.'}</p>{logoutFailed && <button onClick={signOut}>Retry sign out</button>}</section></main>;
    if (token && profile) return children(profile);
    if (localDevelopment) return <main className="auth-shell"><section className="auth-card"><JernLogo variant="auth" /><h1>Local workspace</h1><p>{restoring ? 'Connecting to the local backend…' : authError || 'The backend did not return a local user. Restart it in development mode.'}</p>{!restoring && <button type="button" className="primary" onClick={() => window.location.reload()}>Retry connection</button>}{demoButton}</section></main>;
    return (
        <main className="auth-shell">
            <section className="auth-card" aria-labelledby="auth-title">
                <h1 id="auth-title"><JernLogo variant="auth" /></h1>
                <p>Sign in to your workspace.</p>
                <div className="google-login" ref={googleButton} style={{ height: 48, maxHeight: 48, overflow: 'hidden', minWidth: 0 }}>
                    {restoring ? 'Restoring your session…' : checking ? 'Checking your account…' : !googleReady && !authError ? 'Loading Google sign-in…' : null}
                </div>
                {authError && <>
                    <p className="auth-error" role="alert">{authError}</p>
                    {!restoring && !checking && <button type="button" className="primary" onClick={() => setRestoreAttempt(value => value + 1)}>Retry connection</button>}
                </>}
                {demoButton}
            </section>
        </main>
    );
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
