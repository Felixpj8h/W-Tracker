// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../shared/api/client';
import { healthToday } from '../../health/Health';
import type { HealthDay, HealthOverview } from '../../health/types';
import { HealthSnapshot } from './HealthSnapshot';
import { useHealthSnapshot } from './useHealthSnapshot';
import { DashboardPanels } from '../DashboardPanels';

vi.mock('../../../shared/api/client', () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const dayKey = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return healthToday(date); };
const today = healthToday();
// Oldest first, ending today, as the sync returns them.
const days: HealthDay[] = [
    { date: dayKey(-6), steps: 9000, active_minutes: 30, sleep_minutes: 420, hrv: 40, resting_hr: 60 },
    { date: dayKey(-5), steps: 11000, active_minutes: 50, sleep_minutes: 480, hrv: 44, resting_hr: 58 },
    { date: dayKey(-4), steps: null, active_minutes: null, sleep_minutes: null, hrv: null, resting_hr: null },
    { date: dayKey(-3), steps: 7000, active_minutes: 20, sleep_minutes: 400, hrv: 38, resting_hr: 62 },
    { date: dayKey(-2), steps: 10000, active_minutes: 60, sleep_minutes: 450, hrv: 46, resting_hr: 57 },
    { date: dayKey(-1), steps: 8000, active_minutes: 40, sleep_minutes: 430, hrv: 42, resting_hr: 59 },
    { date: today, steps: 4686, active_minutes: 25, sleep_minutes: 458, hrv: null, resting_hr: 61 },
];
const overview = (patch: Partial<HealthOverview> = {}): HealthOverview => ({
    configured: true, connected: true, account_email: null,
    permissions: { activity: true, sleep: true, recovery: true },
    step_goal: 10000, step_totals: null, fetched_at: Date.now() / 1000,
    data: { days, workouts: [], warnings: {}, sleep: { date: today, start: `${today}T00:00:00Z`, end: `${today}T07:38:00Z`, minutes: 458,
        stages: [{ start: `${today}T00:00:00Z`, end: `${today}T03:00:00Z`, type: 'LIGHT' }, { start: `${today}T03:00:00Z`, end: `${today}T07:38:00Z`, type: 'DEEP' }] } },
    ...patch,
});

function Harness({ openHealth = () => undefined }: { openHealth?: () => void }) {
    return <HealthSnapshot health={useHealthSnapshot(true)} openHealth={openHealth}/>;
}
const tile = (name: string) => within(screen.getByRole('group', { name }));

describe('Dashboard health snapshot', () => {
    it('shows seven-day averages for the synced days, labelled as the last 7 days', async () => {
        vi.mocked(api).mockResolvedValue(overview());
        render(<Harness/>);
        const heading = await screen.findByRole('heading', { name: 'Health snapshot' });
        expect(heading.parentElement?.textContent).toContain('Last 7 days');
        expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
        // Days without a reading are left out of averages, not counted as zero.
        expect(tile('Avg steps').getByText('8,281')).toBeTruthy();
        expect(tile('Avg steps').getByText('2/6 days at goal')).toBeTruthy();
        expect(tile('Avg steps').getByRole('img', { name: 'Average is 83% of the 10,000 daily step goal' })).toBeTruthy();
        expect(tile('Avg sleep').getByText('7h 20m')).toBeTruthy();
        expect(tile('Avg sleep').getByText('Avg of 6 nights')).toBeTruthy();
        expect(tile('Avg activity').getByText('38')).toBeTruthy();
        expect(tile('Avg activity').getByText('3h 45m total')).toBeTruthy();
        const recovery = tile('Recovery');
        expect(recovery.getByText('HRV avg')).toBeTruthy();
        expect(recovery.getByText('42')).toBeTruthy();
        expect(recovery.getByText('Resting HR avg')).toBeTruthy();
        expect(recovery.getByText('60')).toBeTruthy();
        expect(api).toHaveBeenCalledTimes(1);
    });

    it('syncs a stale snapshot in the background without the saving indicator, and keeps it if the sync fails', async () => {
        vi.mocked(api).mockResolvedValueOnce(overview({ fetched_at: 1 })).mockResolvedValueOnce(overview({ data: { ...overview().data!, days: days.map(day => day.date === today ? { ...day, steps: 7000 } : day) } }));
        render(<Harness/>);
        await screen.findByText('8,667');
        expect(api).toHaveBeenLastCalledWith('/health/sync', expect.objectContaining({ method: 'POST', body: JSON.stringify({ today }) }), { trackWrite: false });
        cleanup();

        vi.mocked(api).mockReset().mockResolvedValueOnce(overview({ fetched_at: 1 })).mockRejectedValueOnce(new Error('HTTP 502: Google Health unavailable'));
        render(<Harness/>);
        await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
        expect(tile('Avg steps').getByText('8,281')).toBeTruthy();
        expect(screen.queryByText(/Could not load/)).toBeNull();
    });

    it('does not sync when Google Health is not connected, and links to the Health page', async () => {
        const openHealth = vi.fn();
        vi.mocked(api).mockResolvedValue(overview({ connected: false, data: null, fetched_at: null }));
        render(<Harness openHealth={openHealth}/>);
        fireEvent.click(await screen.findByRole('button', { name: 'Connect in Health' }));
        expect(openHealth).toHaveBeenCalledOnce();
        expect(api).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Last 7 days')).toBeNull();
    });

    it('shows missing permissions and readings as unavailable instead of zero', async () => {
        vi.mocked(api).mockResolvedValue(overview({
            permissions: { activity: false, sleep: true, recovery: false },
            data: { days: days.map(day => ({ ...day, sleep_minutes: null })), sleep: null, workouts: [], warnings: {} },
        }));
        render(<Harness/>);
        await screen.findByRole('heading', { name: 'Health snapshot' });
        expect(tile('Avg steps').getByText('No access')).toBeTruthy();
        expect(tile('Avg steps').getByText('—')).toBeTruthy();
        expect(tile('Avg sleep').getByText('No readings')).toBeTruthy();
        expect(tile('Avg sleep').getByText('—')).toBeTruthy();
        expect(tile('Recovery').getByText('Grant recovery access in Health')).toBeTruthy();
    });

    it('offers a retry when the snapshot cannot load', async () => {
        vi.mocked(api).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(overview());
        render(<Harness/>);
        fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
        await screen.findByText('8,281');
    });

    it('shows labelled sample readings in the public demo without loading health data', async () => {
        render(<DashboardPanels readOnly dash={null} history={[]} historyLoaded firstName="Athlete" log={vi.fn()} openCalendar={vi.fn()} saveWeight={async () => undefined}/>);
        const heading = screen.getByRole('heading', { name: 'Health snapshot' });
        expect(heading.parentElement?.textContent).toContain('Sample data · Last 7 days');
        expect(screen.queryByRole('heading', { name: 'Workouts in selected week' })).toBeNull();
        expect(tile('Avg steps').getByText('8,041')).toBeTruthy();
        expect(tile('Avg steps').getByText('4/7 days at goal')).toBeTruthy();
        expect(tile('Avg sleep').getByText('7h 23m')).toBeTruthy();
        expect(tile('Avg activity').getByText('39')).toBeTruthy();
        expect(tile('Avg activity').getByText('4h 31m total')).toBeTruthy();
        expect(tile('Recovery').getByText('50')).toBeTruthy();
        expect(tile('Recovery').getByText('56')).toBeTruthy();
        // No link to the Health page, which the demo does not have.
        expect(screen.queryByRole('button', { name: /Health/ })).toBeNull();
        // The live loader stays off. DemoApp.test checks that no request at all mentions health.
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(api).not.toHaveBeenCalled();
    });
});
