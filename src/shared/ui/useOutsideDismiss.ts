import { useEffect, useRef } from 'react';

// Listen in capture phase so controls that stop propagation still dismiss a menu.
export function useOutsideDismiss<T extends HTMLElement>(open: boolean, dismiss: (event: PointerEvent) => void) {
    const root = useRef<T>(null);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (event.button === 0 && event.target instanceof Node && root.current && !root.current.contains(event.target)) dismiss(event);
        };
        document.addEventListener('pointerdown', outside, true);
        return () => document.removeEventListener('pointerdown', outside, true);
    }, [open, dismiss]);
    return root;
}
