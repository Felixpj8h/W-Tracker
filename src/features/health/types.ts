export type HealthDay = { date: string; steps: number | null; active_minutes: number | null; sleep_minutes: number | null; hrv: number | null; resting_hr: number | null };
export type Sleep = { date: string; start: string | null; end: string | null; minutes: number | null; stages: { start: string; end: string; type: string }[] };
export type HealthInterval = { start?: string | null; end?: string | null };
export type HealthWorkout = HealthInterval & { date: string; type: string; minutes: number };
export type TimedSleep = Pick<Sleep, 'start' | 'end' | 'stages' | 'minutes'>;
export type HealthOverview = {
  configured: boolean; connected: boolean; account_email: string | null;
  permissions: { activity: boolean; sleep: boolean; recovery: boolean };
  step_goal: number; fetched_at: number | null;
  data: { days: HealthDay[]; sleep: Sleep | null; sleep_intervals?: TimedSleep[]; workouts: HealthWorkout[]; warnings: Record<string, string> } | null;
};
