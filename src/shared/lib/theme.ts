import { useLayoutEffect, useState } from 'react';

export const THEMES = [
    { id: 'default', name: 'Default', dark: null },
    { id: 'pastel-pink', name: 'Pastel Pink', dark: false },
    { id: 'carbon-black', name: 'Carbon Black', dark: true },
    { id: 'batman', name: 'Batman', dark: true },
    { id: 'arcade', name: 'Arcade', dark: true },
    { id: 'midnight-blue', name: 'Midnight Blue', dark: true },
    { id: 'iron-copper', name: 'Iron & Copper', dark: true },
    { id: 'blackberry', name: 'Blackberry', dark: true },
    { id: 'chalk-ink', name: 'Chalk & Ink', dark: false },
    { id: 'nuclear', name: 'Nuclear', dark: true },
] as const;

type ThemeId = (typeof THEMES)[number]['id'];
const MODE_KEY = 'workout-theme';
const PALETTE_KEY = 'workout-palette';

function readPreference(key: string) {
    try { return localStorage.getItem(key); } catch { return null; }
}

function savePreference(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* Apply for this session if storage is unavailable. */ }
}

export function useDefaultAppearance() {
    const [dark, setDark] = useState(() => readPreference(MODE_KEY) !== 'light');
    const selectMode = (value: boolean) => {
        setDark(value);
        savePreference(MODE_KEY, value ? 'dark' : 'light');
    };
    return { dark, selectMode };
}

export function useDocumentTheme(dark: boolean, id: ThemeId = 'default') {
    useLayoutEffect(() => {
        const root = document.documentElement;
        root.dataset.theme = dark ? 'dark' : 'light';
        if (id === 'default') delete root.dataset.palette;
        else root.dataset.palette = id;
        root.style.colorScheme = root.dataset.theme;

        // The browser chrome and overscroll use the same page color as the app.
        const color = getComputedStyle(root).getPropertyValue('--document-background').trim();
        if (color) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    }, [dark, id]);
}

export function useApplicationTheme() {
    const [id, setId] = useState<ThemeId>(() => {
        const saved = readPreference(PALETTE_KEY);
        return THEMES.find(theme => theme.id === saved)?.id ?? 'default';
    });
    const { dark: defaultDark, selectMode } = useDefaultAppearance();
    const dark = THEMES.find(theme => theme.id === id)?.dark ?? defaultDark;
    useDocumentTheme(dark, id);

    return {
        id,
        dark,
        defaultDark,
        selectTheme: (value: ThemeId) => {
            setId(value);
            savePreference(PALETTE_KEY, value);
        },
        selectDefaultMode: (value: boolean) => {
            if (id === 'default') selectMode(value);
        },
    };
}

export type ApplicationTheme = ReturnType<typeof useApplicationTheme>;
