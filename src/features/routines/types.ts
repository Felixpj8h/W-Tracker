import type { Item } from '../exercises/types';

export type Routine = {
    scheduled_on?: string;
    id: number;
    name: string;
    folder_id?: number;
    exercises: Item[];
};

export type Folder = {
    id: number;
    name: string;
    routines: Routine[];
};
