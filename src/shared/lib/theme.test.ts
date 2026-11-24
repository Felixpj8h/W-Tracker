import { expect, it } from 'vitest';
import palettes from '../../../public/theme-palettes.css?raw';
import { THEMES } from './theme';

// Swatches and app colors read these variables; a theme without them renders washed out.
it('defines every palette variable the app needs for each custom theme', () => {
    for (const theme of THEMES) {
        if (theme.id === 'default') continue;
        const block = palettes.match(new RegExp(`\\[data-palette="${theme.id}"\\]\\s*\\{([^}]*)\\}`))?.[1];
        expect(block, theme.id).toBeDefined();
        for (const variable of ['mode', 'background', 'sidebar', 'surface', 'accent', 'ink']) {
            expect(block, `${theme.id} --palette-${variable}`).toMatch(new RegExp(`--palette-${variable}:`));
        }
        expect(block).toContain(`--palette-mode: ${theme.dark ? 'dark' : 'light'};`);
    }
});
