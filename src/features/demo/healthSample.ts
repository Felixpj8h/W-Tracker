import type { HealthOverview } from '../health/types';
import { addDays } from '../dashboard/week/weekDates';

/**
 * Fixed sample readings for the public demo's Health snapshot.
 *
 * The demo publishes the owner's training, but health readings (sleep, heart rate variability, resting heart
 * rate) are more sensitive and are never published. These numbers are made up, built in the browser, and
 * shown as "Sample data". Nothing here reads the owner's Google Health connection or calls the server.
 */
const SAMPLE = {
    steps: [7420, 9180, 6350, 10240, 8710, 5930, 8460],
    active_minutes: [34, 52, 21, 61, 45, 18, 40],
    sleep_minutes: [436, 462, 401, 478, 449, 415, 457],
    hrv: [48, 52, 45, 55, 50, 46, 51],
    resting_hr: [56, 55, 58, 54, 55, 57, 55],
};

/** Seven days ending on `today` (YYYY-MM-DD), so the sample always reads as the last seven days. */
export function sampleHealthOverview(today: string): HealthOverview {
    return {
        configured: true,
        connected: true,
        account_email: null,
        permissions: { activity: true, sleep: true, recovery: true },
        step_goal: 8000,
        step_totals: null,
        fetched_at: null,
        data: {
            days: SAMPLE.steps.map((steps, index) => ({
                date: addDays(today, index - 6),
                steps,
                active_minutes: SAMPLE.active_minutes[index],
                sleep_minutes: SAMPLE.sleep_minutes[index],
                hrv: SAMPLE.hrv[index],
                resting_hr: SAMPLE.resting_hr[index],
            })),
            sleep: null,
            workouts: [],
            warnings: {},
        },
    };
}
