import { useEffect, useState } from 'react';
import { api } from '../../shared/api/client';
import { demoApi } from '../demo/api';
import type { Dash } from './types';
import type { CalendarMonth } from '../calendar/types';
import { addDays } from './week';

export function useWeekData(dash: Dash | null, calendar: CalendarMonth | undefined, week: string, currentWeek: string, comparison: string, compareWeek: string, throughToday: boolean, readOnly: boolean) {
    const query = new URLSearchParams({ selected_week: week, comparison, compare_week: compareWeek, through_today: String(throughToday && week === currentWeek) }).toString();
    const defaultPeriod = week === currentWeek && comparison === 'previous' && !throughToday;
    const [result, setResult] = useState<{ key: string; data: Dash } | null>(null);
    const [months, setMonths] = useState<{ key: string; data: CalendarMonth } | null>(null);
    const [error, setError] = useState<{ key: string; text: string } | null>(null);
    const [retry, setRetry] = useState(0);
    const end = addDays(week, 6);
    const monthKey = `${week.slice(0, 7)},${end.slice(0, 7)}`;
    const calendarCoversWeek = calendar?.days.some(day => day.date === week) && calendar.days.some(day => day.date === end);
    useEffect(() => {
        const controller = new AbortController();
        const load = readOnly ? demoApi : api;
        const requests: Promise<unknown>[] = [];
        if (!defaultPeriod) requests.push(load<Dash>(`/dashboard?${query}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setResult({ key: query, data }); }));
        if (!calendarCoversWeek) requests.push(Promise.all([...new Set(monthKey.split(','))].map(month => load<CalendarMonth>(`/calendar?year=${month.slice(0, 4)}&month=${Number(month.slice(5))}`, { signal: controller.signal }))).then(data => { if (!controller.signal.aborted) setMonths({ key: monthKey, data: { plan: data[0].plan, days: data.flatMap(month => month.days) } }); }));
        void Promise.all(requests).then(() => { if (!controller.signal.aborted) setError(null); }).catch(() => { if (!controller.signal.aborted) setError({ key: query, text: 'Could not load this week.' }); });
        return () => controller.abort();
    }, [query, defaultPeriod, calendarCoversWeek, monthKey, readOnly, retry, dash]);
    return { data: defaultPeriod ? dash : result?.key === query ? result.data : null, calendar: calendarCoversWeek ? calendar : months?.key === monthKey ? months.data : undefined,
        loading: !defaultPeriod && result?.key !== query, error: error?.key === query ? error.text : '', retry: () => setRetry(value => value + 1) };
}
