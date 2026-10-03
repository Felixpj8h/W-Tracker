import type { Dash } from './types';
import type { Workout } from '../workout/types';
import type { CalendarMonth } from '../calendar/types';
import { useRef, useState, useEffect } from 'react';
import { DashboardPanels } from './DashboardPanels';

export function Dashboard({ dash, history, historyLoaded = false, calendar, firstName = 'Athlete', log, openCalendar = () => undefined, openHistory = () => undefined, openWorkout = () => undefined, targetPage = 0, onPageChange = () => undefined, saveWeight }: { dash: Dash | null; history: Workout[]; historyLoaded?: boolean; calendar?: CalendarMonth; firstName?: string; log: () => void; openCalendar?: () => void; openHistory?: () => void; openWorkout?: (workout: Workout) => void; targetPage?: number; onPageChange?: (page: number) => void; saveWeight: (n: number, recordedOn?: string) => Promise<void> }) {
    const dashboardRef = useRef<HTMLDivElement>(null);
    const [visiblePage, setVisiblePage] = useState(targetPage);
    useEffect(() => {
        const workspace = dashboardRef.current?.closest('main');
        workspace?.classList.add('dashboard-workspace');
        workspace?.style.setProperty('--dashboard-inline-gutter', '28px');
        return () => { workspace?.classList.remove('dashboard-workspace'); workspace?.style.removeProperty('--dashboard-inline-gutter'); };
    }, []);
    useEffect(() => { const shell = dashboardRef.current; if (shell && window.matchMedia('(max-width: 760px)').matches) { shell.style.scrollBehavior = 'auto'; shell.scrollLeft = shell.clientWidth * targetPage; setVisiblePage(targetPage); requestAnimationFrame(() => shell.style.removeProperty('scroll-behavior')); } }, [targetPage]);
    return <><div className="dashboard-shell" ref={dashboardRef} onScroll={event => { const shell = event.currentTarget; const next = Math.max(0, Math.min(2, Math.round(shell.scrollLeft / Math.max(1, shell.clientWidth)))); if (next !== visiblePage) { setVisiblePage(next); onPageChange(next); } }}><DashboardPanels dash={dash} history={history} historyLoaded={historyLoaded} calendar={calendar} firstName={firstName} log={log} openCalendar={openCalendar} openHistory={openHistory} openWorkout={openWorkout} saveWeight={saveWeight}/></div><div className="dashboard-page-indicator" aria-label={`Dashboard page ${visiblePage + 1} of 3`}>{[0, 1, 2].map(index => <button type="button" aria-label={`Go to ${['Overview', 'Progress', 'Activity'][index]}`} aria-current={visiblePage === index ? 'page' : undefined} key={index} onClick={() => { const shell = dashboardRef.current; shell?.scrollTo({ left: shell.clientWidth * index, behavior: 'smooth' }); }}>{visiblePage === index ? '●' : '○'}</button>)}</div></>;
}
