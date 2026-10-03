import type { Routine } from '../routines/types';

export type CalendarDay = { routine_override?: Routine | null; date: string; routine_id: number | null; routine_name: string | null; status: 'completed' | 'upcoming' | 'missed' | 'empty'; workout_name: string | null };

export type WeeklyPlan = { name: string; starts_on: string; days: { weekday: number; routine_id: number; routine_name: string }[] };

export type CalendarMonth = { plan: WeeklyPlan | null; days: CalendarDay[] };

export type LoadCalendarMonth = (year: number, month: number, force?: boolean) => Promise<CalendarMonth | undefined>;
