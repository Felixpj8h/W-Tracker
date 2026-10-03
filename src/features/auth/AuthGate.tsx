import type { UserProfile } from './profile';
import { useState, useRef, useCallback, useEffect } from 'react';
import { setGoogleIdToken, authHeaders } from './auth';
import { API } from '../../shared/api/client';
import { profileFromSession } from './profile';

export function AuthGate({ children }: { children: (user: UserProfile) => React.ReactNode }) {
    const [token, setToken] = useState('');
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [googleReady, setGoogleReady] = useState(false);
    const [checking, setChecking] = useState(false);
    const [authError, setAuthError] = useState('');
    const [restoring, setRestoring] = useState(true);
    const googleButton = useRef<HTMLDivElement>(null);
    const signOut = useCallback(() => {
        window.google?.accounts.id.disableAutoSelect();
        setGoogleIdToken('');
        setToken('');
        setProfile(null);
        setChecking(false);
        void fetch(`${API}/session/logout`, { method: 'POST', credentials: 'include' });
    }, []);

    useEffect(() => {
        let cancelled = false;
        void fetch(`${API}/session`, { credentials: 'include' }).then(async response => {
            if (!response.ok) return;
            const body = await response.json() as { email?: string; name?: string; given_name?: string };
            if (!cancelled && body.email) {
                setProfile(profileFromSession(body));
                setToken('session');
            }
        }).catch(() => undefined).finally(() => { if (!cancelled) setRestoring(false); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        window.addEventListener('google-auth-expired', signOut);
        window.addEventListener('google-sign-out', signOut);
        return () => {
            window.removeEventListener('google-auth-expired', signOut);
            window.removeEventListener('google-sign-out', signOut);
        };
    }, [signOut]);

    useEffect(() => {
        if (token || restoring) return;
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
                    setChecking(true);
                    setAuthError('');
                    setGoogleIdToken(response.credential);
                    try {
                        const validation = await fetch(`${API}/session`, { credentials: 'include', headers: authHeaders() });
                        const body = await validation.json().catch(() => null) as { detail?: string; email?: string; name?: string; given_name?: string } | null;
                        if (!validation.ok) throw new Error(body?.detail ?? 'This Google account cannot access the workout tracker.');
                        const authenticatedProfile = profileFromSession(body ?? {});
                        if (!authenticatedProfile.email) throw new Error('Google did not return an email address for this account.');
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
    }, [token, restoring]);

    useEffect(() => {
        if (token || restoring || !googleReady || checking || !window.google || !googleButton.current) return;
        googleButton.current.replaceChildren();
        window.google.accounts.id.renderButton(googleButton.current, {
            type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with',
            shape: 'rectangular', logo_alignment: 'left', width: Math.min(360, Math.max(280, googleButton.current.clientWidth || 360)),
        });
    }, [checking, googleReady, restoring, token]);

    if (token && profile) return children(profile);
    return <main className="auth-shell"><section className="auth-card" aria-labelledby="auth-title"><div className="auth-brand">W</div><p className="overline">WORKOUT TRACKER</p><h1 id="auth-title">Your training,<br/><em>kept personal.</em></h1><p>Sign in with your Google account to open your workout workspace.</p><div className="google-login" ref={googleButton}>{restoring ? 'Restoring your session…' : checking ? 'Checking your account…' : !googleReady && !authError ? 'Loading Google sign-in…' : null}</div>{authError && <p className="auth-error" role="alert">{authError}</p>}</section></main>;
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
