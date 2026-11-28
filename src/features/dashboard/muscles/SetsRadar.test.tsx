// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetsRadar } from './SetsRadar';
import { DashboardPanels } from '../DashboardPanels';
import { setSetsChartStyle } from './setsChartPreference';

const rows = [
    { name: 'Quads', current: 9, previous: 6 },
    { name: 'Chest', current: 12, previous: 10 },
    { name: 'Lats', current: 4, previous: 8 },
    { name: 'Biceps', current: 1, previous: null },
];

describe('SetsRadar', () => {
    afterEach(cleanup);

    it('lists every muscle with its sets and change in an accessible table', () => {
        render(<SetsRadar rows={rows} currentLabel="This week" comparisonLabel="Previous week"/>);
        const table = screen.getByRole('table', { name: 'Sets by muscle' });
        expect(within(table).getByRole('columnheader', { name: 'Previous week' })).toBeTruthy();
        expect(within(table).getByRole('row', { name: /Chest/ }).textContent).toContain('12 sets');
        expect(within(table).getByRole('row', { name: /Chest/ }).textContent).toContain('+20%');
        expect(within(table).getByRole('row', { name: /Lats/ }).textContent).toContain('-50%');
        expect(within(table).getByRole('row', { name: /Biceps/ }).textContent).toContain('1 set');
        // Spokes follow a fixed anatomical order, not the order the rows arrive in.
        expect(within(table).getAllByRole('rowheader').map(cell => cell.textContent)).toEqual(['Chest', 'Lats', 'Biceps', 'Quads']);
    });

    it('steps through muscles with the arrow keys and shows their numbers above the chart', () => {
        const { container } = render(<SetsRadar rows={rows} currentLabel="This week" comparisonLabel="Previous week"/>);
        const plot = screen.getByRole('group', { name: /Sets by muscle radar chart/ });
        fireEvent.keyDown(plot, { key: 'ArrowRight' });
        expect(container.querySelector('.sets-radar-legend')?.textContent).toBe('Chest12 sets10 sets+20%');
        fireEvent.keyDown(plot, { key: 'ArrowLeft' });
        expect(container.querySelector('.sets-radar-legend')?.textContent).toContain('Quads');
        fireEvent.keyDown(plot, { key: 'Escape' });
        expect(container.querySelector('.sets-radar-legend')?.textContent).toBe('This week26 setsPrevious week24 sets');
    });

    it('drops the comparison outline and legend for a rolling seven-day view', () => {
        const { container } = render(<SetsRadar rows={rows.map(row => ({ ...row, previous: null }))} currentLabel="Last 7 days" comparisonLabel={null}/>);
        expect(container.querySelector('.previous-area')).toBeNull();
        expect(container.querySelector('.sets-radar-legend')?.textContent).toBe('26 sets total');
        expect(container.querySelector('.current-area')).toBeTruthy();
    });
});

describe('Sets by muscle chart setting', () => {
    afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

    it('shows the radar by default and the legacy bars when chosen', () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ plan: null, days: [] }) })));
        const dash = { latest_weight: null, weight_series: [], total_current_volume: 0, total_previous_volume: 0, volume_by_muscle_group: [],
            sets_by_muscle: rows.map(row => ({ name: row.name, current_week_sets: row.current, last_week_sets: row.previous ?? 0 })) };
        const view = render(<DashboardPanels dash={dash} history={[]} historyLoaded firstName="Athlete" log={vi.fn()} openCalendar={vi.fn()} saveWeight={async () => undefined}/>);
        fireEvent.click(within(screen.getByRole('group', { name: 'Muscle metric' })).getByRole('button', { name: 'Sets' }));
        expect(view.container.querySelector('.sets-radar')).toBeTruthy();
        act(() => setSetsChartStyle('bars'));
        expect(view.container.querySelector('.sets-radar')).toBeNull();
        expect(screen.getByText('Chest').closest('.muscle-row')?.textContent).toContain('12 sets');
    });
});
