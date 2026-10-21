import type { ReactNode } from 'react';
import { useState } from 'react';
import { useOutsideDismiss } from './useOutsideDismiss';

export function OptionsMenu({ label, children }: { label: string; children: ReactNode }) {
    const [open, setOpen] = useState(false);
    const root = useOutsideDismiss<HTMLDetailsElement>(open, () => setOpen(false));
    return <details className="routine-menu" ref={root} open={open}>
        <summary aria-label={label} onClick={event => { event.preventDefault(); setOpen(value => !value); }}>⋮</summary>
        <div className="routine-menu-panel" onClick={event => {
            if ((event.target as HTMLElement).closest('button')) setOpen(false);
        }}>{children}</div>
    </details>;
}
