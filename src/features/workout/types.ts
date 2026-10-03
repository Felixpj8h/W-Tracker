import type { Item } from '../exercises/types';

export type Workout = {
    id?: number;
    routine_id?: number | null;
    name: string;
    performed_on: string;
    note?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    duration_seconds?: number | null;
    completed?: boolean;
    exercises: Item[];
};
