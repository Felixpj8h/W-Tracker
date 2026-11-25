

export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const today = () => dateKey(new Date());

export const vol = (n: number) => Math.round(n).toLocaleString();

export const duration = (seconds?: number | null) => seconds === null || seconds === undefined ? '—' : `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}h ` : ''}${Math.floor(seconds % 3600 / 60)} min`;

export const formatClockTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export const formatRestDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
