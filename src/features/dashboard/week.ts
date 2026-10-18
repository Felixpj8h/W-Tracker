export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const addDays = (key: string, days: number) => { const date = new Date(`${key}T12:00:00`); date.setDate(date.getDate() + days); return dateKey(date); };
export const startOfWeek = (key: string) => { const date = new Date(`${key}T12:00:00`); return addDays(key, -((date.getDay() + 6) % 7)); };
export const weekLabel = (key: string, days = 7) => {
    const format = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return `${format(key)} – ${format(addDays(key, days - 1))}`;
};

export const compactWeekLabel = (key: string) => {
    const start = new Date(`${key}T12:00:00`), end = new Date(`${addDays(key, 6)}T12:00:00`);
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).formatRange(start, end);
};
