export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const addDays = (key: string, days: number) => { const date = new Date(`${key}T12:00:00`); date.setDate(date.getDate() + days); return dateKey(date); };
export const startOfWeek = (key: string) => { const date = new Date(`${key}T12:00:00`); return addDays(key, -((date.getDay() + 6) % 7)); };
export const weekLabel = (key: string, days = 7) => {
    const format = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return `${format(key)} – ${format(addDays(key, days - 1))}`;
};

/** A short date range, such as "Nov 18 – 24, 2026". */
export const compactRangeLabel = (first: string, last: string) =>
    new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).formatRange(new Date(`${first}T12:00:00`), new Date(`${last}T12:00:00`));

export const compactWeekLabel = (key: string) => compactRangeLabel(key, addDays(key, 6));
