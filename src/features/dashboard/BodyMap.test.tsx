// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BodyMap } from './BodyMap';
import { DashboardPanels } from './DashboardPanels';

const muscles = [
    { id: 1, name: 'Chest', volume: 896, intensity: .5, is_front: true, image_url: 'https://wger.de/chest.svg' },
    { id: 2, name: 'Lats', volume: 1800, intensity: 1, is_front: false, image_url: 'https://wger.de/lats.svg' },
];
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockMap() {
    const fetchMock = vi.fn(async (url: string, _options?: RequestInit) => ({ ok: true, json: async () => url.includes('/calendar') ? { plan: null, days: [] } : { muscles } }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('Dashboard muscle heatmap', () => {
    it('switches between volume, sets, and the real front/back muscle map', async () => {
        const fetchMock = mockMap();
        render(<DashboardPanels dash={null} history={[]} historyLoaded firstName="Athlete" log={vi.fn()} openCalendar={vi.fn()} openHistory={vi.fn()} openWorkout={vi.fn()} saveWeight={async () => undefined}/>);
        const controls = within(screen.getByRole('group', { name: 'Muscle metric' }));
        expect(controls.getByRole('button', { name: 'Volume' }).getAttribute('aria-pressed')).toBe('true');
        expect(fetchMock.mock.calls.some(([url]) => url.includes('/body-map'))).toBe(false);
        fireEvent.click(controls.getByRole('button', { name: 'Heatmap' }));
        expect(await screen.findByRole('img', { name: /Front muscle heatmap: Chest, 896 kg/ })).toBeTruthy();
        expect(screen.getByRole('img', { name: /Back muscle heatmap: Lats, 1,800 kg/ })).toBeTruthy();
        expect(fetchMock.mock.calls.some(([url]) => /\/dashboard\/body-map\?selected_week=/.test(url))).toBe(true);
        fireEvent.click(controls.getByRole('button', { name: 'Sets' }));
        expect(screen.getByText('Sets by muscle')).toBeTruthy();
        expect(screen.queryByRole('img', { name: /muscle heatmap/ })).toBeNull();
        fireEvent.click(controls.getByRole('button', { name: 'Volume' }));
        expect(screen.getByText('Volume by muscle group')).toBeTruthy();
    });

    it('uses only the public read-only route in the demo', async () => {
        const fetchMock = mockMap();
        render(<BodyMap readOnly/>);
        await screen.findByRole('img', { name: /Front muscle heatmap/ });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toMatch(/\/demo\/dashboard\/body-map$/);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'omit' });
        expect(screen.queryByRole('button', { name: /test/i })).toBeNull();
    });

    it('shows a neutral map for a week without training', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ muscles: [] }) }));
        render(<BodyMap/>);
        expect(await screen.findAllByRole('img', { name: /No muscles trained in the selected week/ })).toHaveLength(2);
    });

    it('recovers from an unavailable map on retry', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ok: true, json: async () => ({ muscles }) }));
        render(<BodyMap/>);
        fireEvent.click(await screen.findByRole('button', { name: 'Retry heatmap' }));
        expect(await screen.findByRole('img', { name: /Back muscle heatmap: Lats/ })).toBeTruthy();
    });
});

it('replaces current-week muscle values with the selected historical week and ignores late responses', async () => {
    let resolveCurrent!: (response: {ok: boolean; json: () => Promise<unknown>}) => void;
    const current = new Promise<{ok: boolean; json: () => Promise<unknown>}>(resolve => { resolveCurrent = resolve; });
    const previousMuscles = [{...muscles[0],volume:2500,intensity:1}];
    const fetchMock = vi.fn(async (url: string) => url.includes('selected_week=2026-10-19') ? current : {ok:true,json:async () => ({muscles:previousMuscles})});
    vi.stubGlobal('fetch',fetchMock);
    const view = render(<BodyMap selectedWeek="2026-10-19"/>);
    view.rerender(<BodyMap selectedWeek="2026-10-12"/>);
    await screen.findByRole('img',{name:/Front muscle heatmap: Chest, 2,500 kg/});
    expect(fetchMock.mock.calls.some(([url]) => url.includes('selected_week=2026-10-12&through_today=false'))).toBe(true);
    await act(async () => resolveCurrent({ok:true,json:async () => ({muscles})}));
    expect(screen.getByRole('img',{name:/Front muscle heatmap: Chest, 2,500 kg/})).toBeTruthy();
    expect(screen.queryByRole('img',{name:/Lats, 1,800 kg/})).toBeNull();
});
