

export type Dash = {
    latest_weight: {
        recorded_on: string;
        weight: number;
    } | null;
    weight_series: {
        recorded_on: string;
        weight: number;
    }[];
    total_current_volume: number;
    total_previous_volume: number;
    volume_by_muscle_group: {
        name: string;
        current_week_volume: number;
        last_week_volume: number;
        current_week_sets?: number;
        last_week_sets?: number;
    }[];
    sets_by_muscle?: {
        name: string;
        current_week_sets: number;
        last_week_sets: number;
    }[];
};

export type SavedWeight = { recorded_on: string; weight: number; saved: true };

export type WeightEntry = Pick<SavedWeight, 'recorded_on' | 'weight'>;

export type BodyMapMuscle = { id: number; name: string; volume: number; intensity: number; is_front: boolean; image_url: string; role?: 'primary' | 'secondary' | 'tertiary' };
