// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../shared/api/client';
import { useApplicationTheme } from '../../shared/lib/theme';
import { Settings } from './Settings';
import { useAccountSettings } from './useAccountSettings';

vi.mock('../../shared/api/client', () => ({ api: vi.fn() }));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.palette;
    document.documentElement.style.removeProperty('color-scheme');
});

function Harness() {
    const settings = useAccountSettings(true);
    const theme = useApplicationTheme();
    return <Settings settings={settings} theme={theme}/>;
}

const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
const puts = () => vi.mocked(api).mock.calls.filter(([, options]) => options?.method === 'PUT').map(([, options]) => JSON.parse(options!.body as string).ai_output_length);

it('loads the saved length and saves a new choice immediately', async () => {
    vi.mocked(api).mockImplementation(async (_path, options) => options?.method === 'PUT' ? JSON.parse(options.body as string) : { ai_output_length: 'brief' });
    render(<Harness/>);
    await waitFor(() => expect(radio('Brief').checked).toBe(true));
    expect(vi.mocked(api)).toHaveBeenCalledWith('/settings');
    fireEvent.click(radio('Comprehensive'));
    expect(radio('Comprehensive').checked).toBe(true);
    await waitFor(() => expect(puts()).toEqual(['comprehensive']));
    expect(screen.queryByRole('alert')).toBeNull();
});

it('disables choices until loaded and offers a retry when loading fails', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ai_output_length: 'normal' });
    render(<Harness/>);
    expect(radio('Normal').disabled).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(radio('Normal').checked).toBe(true));
    expect(radio('Brief').disabled).toBe(false);
});

it('writes rapid changes one at a time so the latest choice is persisted', async () => {
    const first = deferred<unknown>();
    vi.mocked(api).mockImplementation(async (_path, options) => {
        if (options?.method !== 'PUT') return { ai_output_length: 'normal' };
        const value = JSON.parse(options.body as string);
        return value.ai_output_length === 'brief' ? first.promise : value;
    });
    render(<Harness/>);
    await waitFor(() => expect(radio('Normal').checked).toBe(true));
    fireEvent.click(radio('Brief'));
    fireEvent.click(radio('Comprehensive'));
    fireEvent.click(radio('Normal'));
    fireEvent.click(radio('Comprehensive'));
    expect(puts()).toEqual(['brief']);
    first.resolve({ ai_output_length: 'brief' });
    await waitFor(() => expect(puts()).toEqual(['brief', 'comprehensive']));
    expect(radio('Comprehensive').checked).toBe(true);
});

it('reverts to the confirmed value when a save fails', async () => {
    vi.mocked(api).mockImplementation(async (_path, options) => { if (options?.method === 'PUT') throw new Error('HTTP 500'); return { ai_output_length: 'normal' }; });
    render(<Harness/>);
    await waitFor(() => expect(radio('Normal').checked).toBe(true));
    fireEvent.click(radio('Brief'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Could not confirm'));
    expect(radio('Normal').checked).toBe(true);
});

it.each(['Normal', 'Comprehensive'])('saves a newer %s choice made while a failing save was in flight', async (latest) => {
    const failing = deferred<unknown>();
    vi.mocked(api).mockImplementation(async (_path, options) => {
        if (options?.method !== 'PUT') return { ai_output_length: 'normal' };
        const value = JSON.parse(options.body as string);
        return value.ai_output_length === 'brief' ? failing.promise : value;
    });
    render(<Harness/>);
    await waitFor(() => expect(radio('Normal').checked).toBe(true));
    fireEvent.click(radio('Brief'));
    fireEvent.click(radio(latest));
    failing.reject(new Error('HTTP 500'));
    await waitFor(() => expect(puts()).toEqual(['brief', latest.toLowerCase()]));
    expect(radio(latest).checked).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
});

it('preserves the Default appearance when visiting a fixed theme and after remounting', async () => {
    vi.mocked(api).mockResolvedValue({ ai_output_length: 'normal' });
    const view = render(<Harness/>);
    fireEvent.click(screen.getByRole('tab', { name: 'Themes' }));
    expect(radio('Default').checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');

    fireEvent.click(radio('Batman'));
    expect(document.documentElement.dataset.palette).toBe('batman');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.queryByRole('group', { name: 'Appearance' })).toBeNull();

    view.unmount();
    render(<Harness/>);
    fireEvent.click(screen.getByRole('tab', { name: 'Themes' }));
    expect(radio('Batman').checked).toBe(true);
    fireEvent.click(radio('Default'));
    expect(screen.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.dataset.palette).toBeUndefined();
    expect(document.documentElement.dataset.theme).toBe('light');
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalled());
});

it('applies the fixed appearance of every custom theme', async () => {
    vi.mocked(api).mockResolvedValue({ ai_output_length: 'normal' });
    localStorage.setItem('workout-palette', 'unknown-theme');
    render(<Harness/>);
    fireEvent.click(screen.getByRole('tab', { name: 'Themes' }));
    expect(radio('Default').checked).toBe(true);

    const palettes = [
        ['Pastel Pink', 'pastel-pink', 'light'], ['Carbon Black', 'carbon-black', 'dark'],
        ['Batman', 'batman', 'dark'], ['Arcade', 'arcade', 'dark'], ['Midnight Blue', 'midnight-blue', 'dark'],
        ['Iron & Copper', 'iron-copper', 'dark'], ['Blackberry', 'blackberry', 'dark'], ['Chalk & Ink', 'chalk-ink', 'light'],
    ];
    for (const [name, id, mode] of palettes) {
        fireEvent.click(radio(name));
        expect(radio(name).checked).toBe(true);
        expect(document.documentElement.dataset.palette).toBe(id);
        expect(document.documentElement.dataset.theme).toBe(mode);
        expect(screen.queryByRole('group', { name: 'Appearance' })).toBeNull();
    }
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalled());
});
