import { useState, useEffect } from 'react';
import type { BackendWriteState } from '../api/client';
import { pendingBackendWrites, backendWriteFailed } from '../api/client';

export function SavingIndicator() {
    const [state, setState] = useState<BackendWriteState>({ pending: pendingBackendWrites, failed: backendWriteFailed });
    useEffect(() => { const update = (event: Event) => setState((event as CustomEvent<BackendWriteState>).detail); window.addEventListener('backend-write-state', update); return () => window.removeEventListener('backend-write-state', update); }, []);
    const visible = state.pending > 0 || state.failed;
    return <div className={`backend-saving ${visible ? 'visible' : ''} ${state.failed ? 'failed' : ''}`} role="status" aria-live="polite" aria-label={state.failed ? 'Changes not saved' : state.pending ? 'Saving changes' : undefined}><i aria-hidden="true"/><span>{state.failed ? 'Not saved' : 'Saving'}</span></div>;
}
