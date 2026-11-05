import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useOutsideDismiss } from './useOutsideDismiss';

export function DismissibleDetails({ children, className, closeOnAction = false }: { children: ReactNode; className?: string; closeOnAction?: boolean }) {
    const [open, setOpen] = useState(false);
    const root = useOutsideDismiss<HTMLDetailsElement>(open, () => setOpen(false));
    useEffect(() => {
        if (!open) return;
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setOpen(false);
            root.current?.querySelector('summary')?.focus({ preventScroll: true });
        };
        document.addEventListener('keydown', escape);
        return () => document.removeEventListener('keydown', escape);
    }, [open, root]);
    return <details className={className} ref={root} open={open} onClick={event => {
        const target = event.target as HTMLElement;
        if (target.closest('summary') === root.current?.querySelector('summary')) {
            event.preventDefault();
            setOpen(value => !value);
        } else if (closeOnAction && target.closest('button:not(:disabled)')) {
            setOpen(false);
        }
    }}>{children}</details>;
}
