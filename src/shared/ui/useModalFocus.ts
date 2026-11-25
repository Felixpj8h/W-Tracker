import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

const openDialogs: HTMLElement[] = [];
const controls = 'a[href], button, input, select, textarea, summary, [tabindex]';

export function useModalFocus(ref: RefObject<HTMLElement | null>, open: boolean, dismiss: () => void) {
    const close = useRef(dismiss);
    useLayoutEffect(() => { close.current = dismiss; });

    useEffect(() => {
        const panel = ref.current;
        if (!open || !panel) return;
        const previous = document.activeElement;
        openDialogs.push(panel);
        const isTop = () => openDialogs.at(-1) === panel;
        const tabbable = () => [...panel.querySelectorAll<HTMLElement>(controls)].filter(element =>
            element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') &&
            element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden',
        );
        const focus = (element: HTMLElement) => element.focus({ preventScroll: true });
        focus(panel.querySelector<HTMLElement>('[data-initial-focus]') ?? tabbable()[0] ?? panel);

        const keepFocus = (event: FocusEvent) => {
            if (isTop() && event.target instanceof Node && !panel.contains(event.target)) focus(tabbable()[0] ?? panel);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (!isTop() || event.defaultPrevented) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                close.current();
            } else if (event.key === 'Tab') {
                const items = tabbable();
                const active = document.activeElement;
                const edge = event.shiftKey ? items[0] : items.at(-1);
                if (!items.length || active === edge || !items.includes(active as HTMLElement)) {
                    event.preventDefault();
                    focus((event.shiftKey ? items.at(-1) : items[0]) ?? panel);
                }
            }
        };
        const viewport = window.visualViewport;
        let frame = 0;
        const revealField = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const field = document.activeElement;
                if (!isTop() || !viewport || !document.documentElement.hasAttribute('data-mobile-keyboard') ||
                    !(field instanceof HTMLElement) || !panel.contains(field) || !field.matches('input, textarea, select')) return;
                const bounds = panel.getBoundingClientRect();
                const input = field.getBoundingClientRect();
                const top = Math.max(bounds.top, viewport.offsetTop) + 8;
                const bottom = Math.min(bounds.bottom, viewport.offsetTop + viewport.height) - 8;
                if (input.bottom > bottom) panel.scrollTop += input.bottom - bottom;
                else if (input.top < top) panel.scrollTop -= top - input.top;
            });
        };
        document.addEventListener('focusin', keepFocus);
        panel.addEventListener('focusin', revealField);
        document.addEventListener('keydown', onKeyDown);
        viewport?.addEventListener('resize', revealField);
        viewport?.addEventListener('scroll', revealField);
        return () => {
            openDialogs.splice(openDialogs.indexOf(panel), 1);
            document.removeEventListener('focusin', keepFocus);
            panel.removeEventListener('focusin', revealField);
            document.removeEventListener('keydown', onKeyDown);
            viewport?.removeEventListener('resize', revealField);
            viewport?.removeEventListener('scroll', revealField);
            cancelAnimationFrame(frame);
            if (previous instanceof HTMLElement && previous.isConnected) focus(previous);
        };
    }, [open, ref]);
}
