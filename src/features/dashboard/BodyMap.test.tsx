// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BodyMap } from './BodyMap';
import { DashboardPanels } from './DashboardPanels';

const muscles = [
    { id: 1, name: 'Chest', volume: 896, intensity: .5, is_front: true, image_url: 'https://wger.de/chest.svg' },
    { id: 2, name: 'Lats', volume: 1800, intensity: 1, is_front: false, image_url: 'https://wger.de/lats.svg' },
];
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockMap() {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ muscles }) });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

describe('Dashboard muscle heatmap', () => {
    it('switches between volume, sets, and the real front/back muscle map', async () => {
        const fetchMock = mockMap();
        render(<DashboardPanels dash={null} history={[]} historyLoaded firstName="Athlete" log={vi.fn()} openCalendar={vi.fn()} openHistory={vi.fn()} openWorkout={vi.fn()} saveWeight={async () => undefined}/>);
        const controls = within(screen.getByRole('group', { name: 'Muscle metric' }));
        expect(controls.getByRole('button', { name: 'Volume' }).getAttribute('aria-pressed')).toBe('true');
        expect(fetchMock).not.toHaveBeenCalled();
        fireEvent.click(controls.getByRole('button', { name: 'Heatmap' }));
        expect(await screen.findByRole('img', { name: /Front muscle heatmap: Chest, 896 kg/ })).toBeTruthy();
        expect(screen.getByRole('img', { name: /Back muscle heatmap: Lats, 1,800 kg/ })).toBeTruthy();
        expect(fetchMock.mock.calls[0][0]).toMatch(/\/dashboard\/body-map$/);
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
        expect(await screen.findByText('Complete a workout to light up your map.')).toBeTruthy();
        expect(screen.getAllByRole('img', { name: /No muscles trained this week/ })).toHaveLength(2);
    });

    it('recovers from an unavailable map on retry', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ok: true, json: async () => ({ muscles }) }));
        render(<BodyMap/>);
        fireEvent.click(await screen.findByRole('button', { name: 'Retry heatmap' }));
        expect(await screen.findByRole('img', { name: /Back muscle heatmap: Lats/ })).toBeTruthy();
    });
});
