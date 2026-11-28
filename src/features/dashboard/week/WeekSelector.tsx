import { useEffect, useRef, useState } from 'react';
import { addDays, startOfWeek, compactRangeLabel, compactWeekLabel } from './weekDates';
import { DashboardIcon } from '../overview/DashboardIcon';
import { useBackAction } from '../../../shared/lib/backNavigation';
import './week-selector.css';

export type DashboardPeriod = 'week' | 'last_seven_days';

/** `period` is what the dashboard shows now. The last seven days end today and have no comparison, so
 *  choosing them hides the week and comparison controls. */
export function WeekSelector({ week, currentWeek, today, period, comparison, compareWeek, throughToday, onWeek, onPeriod, onComparison, onCompareWeek, onThroughToday }: {
    week: string; currentWeek: string; today: string; period: DashboardPeriod; comparison: string; compareWeek: string; throughToday: boolean;
    onWeek: (week: string) => void; onPeriod: (period: DashboardPeriod) => void; onComparison: (value: 'previous' | 'average' | 'custom') => void; onCompareWeek: (week: string) => void; onThroughToday: (value: boolean) => void;
}) {
    const recent = period === 'last_seven_days';
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const close = () => { trigger.current?.focus(); setOpen(false); };
    useBackAction(open, close);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && root.current?.contains(document.activeElement)) close(); };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', escape);
        return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
    }, [open]);
    return <div className="week-selector" ref={root}>
        <button ref={trigger} className="today-control" type="button" aria-expanded={open} onClick={() => setOpen(!open)}><DashboardIcon name="calendar"/><span><b>{recent ? 'Last 7 days' : week === currentWeek ? 'This week' : 'Selected week'}</b><small>{recent ? compactRangeLabel(addDays(today, -6), today) : compactWeekLabel(week)}</small></span><DashboardIcon name="chevron"/></button>
        {open && <div className="week-selector-panel" role="group" aria-label="Week selection">
            <div className="week-period" role="group" aria-label="Show">
                <button type="button" aria-pressed={!recent} onClick={() => onPeriod('week')}>Week</button>
                <button type="button" aria-pressed={recent} onClick={() => onPeriod('last_seven_days')}>Last 7 days</button>
            </div>
            {recent ? <p className="week-period-note">Today and the six days before it. Comparisons apply to calendar weeks.</p> : <>
            <div className="week-browse"><button type="button" aria-label="Previous week" onClick={() => onWeek(addDays(week, -7))}>‹</button><label>Week of<input aria-label="Select week" type="date" max={addDays(currentWeek, 6)} value={week} onChange={event => { if (event.target.value && startOfWeek(event.target.value) <= currentWeek) onWeek(startOfWeek(event.target.value)); }}/></label><button type="button" aria-label="Next week" disabled={week >= currentWeek} onClick={() => onWeek(addDays(week, 7))}>›</button></div>
            <button type="button" onClick={() => onWeek(currentWeek)}>Back to this week</button>
            <label>Compare with<select value={comparison} onChange={event => onComparison(event.target.value as 'previous' | 'average' | 'custom')}><option value="previous">Previous week</option><option value="average">Previous four-week average</option><option value="custom">Specific week</option></select></label>
            {comparison === 'custom' && <div className="week-browse"><button type="button" aria-label="Previous comparison week" onClick={() => onCompareWeek(addDays(compareWeek, -7))}>‹</button><label>Comparison week<input type="date" max={addDays(currentWeek, 6)} value={compareWeek} onChange={event => { if (event.target.value && startOfWeek(event.target.value) <= currentWeek) onCompareWeek(startOfWeek(event.target.value)); }}/></label><button type="button" aria-label="Next comparison week" disabled={compareWeek >= currentWeek} onClick={() => onCompareWeek(addDays(compareWeek, 7))}>›</button></div>}
            {week === currentWeek && <label className="week-fair"><input type="checkbox" checked={throughToday} onChange={event => onThroughToday(event.target.checked)}/>Compare through today only</label>}
            </>}
        </div>}
    </div>;
}

