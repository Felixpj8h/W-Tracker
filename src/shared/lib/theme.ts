import { useEffect } from 'react';

/** Visible page background (`--bg-main` in base.css); keep in sync with theme-init.js, index.css and the manifest. */
export const THEME_BACKGROUND = { dark: '#111a14', light: '#f3f5f0' } as const;

/**
 * Keep the document itself in step with the in-app theme. iOS home-screen apps
 * draw the status bar and overscroll areas from <html>/<body> and the
 * theme-color meta tag, not from the `.app` element.
 */
export function applyDocumentTheme(dark: boolean) {
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.colorScheme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? THEME_BACKGROUND.dark : THEME_BACKGROUND.light);
}

export function useDocumentTheme(dark: boolean) {
    useEffect(() => applyDocumentTheme(dark), [dark]);
}
