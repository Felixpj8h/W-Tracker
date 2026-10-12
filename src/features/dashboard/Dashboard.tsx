import type { Dash } from './types';
import type { Workout } from '../workout/types';
import type { CalendarMonth } from '../calendar/types';
import { useRef, useState, useEffect } from 'react';
import { DashboardPanels } from './DashboardPanels';

export function Dashboard({ dash, history, historyLoaded = false, calendar, firstName = 'Athlete', log, openCalendar = () => undefined, openHistory = () => undefined, openWorkout = () => undefined, targetPage = 0, onPageChange = () => undefined, saveWeight }: { dash: Dash | null; history: Workout[]; historyLoaded?: boolean; calendar?: CalendarMonth; firstName?: string; log: () => void; openCalendar?: () => void; openHistory?: () => void; openWorkout?: (workout: Workout) => void; targetPage?: number; onPageChange?: (page: number) => void; saveWeight: (n: number, recordedOn?: string) => Promise<void> }) {
    const dashboardRef = useRef<HTMLDivElement>(null);
    const [visiblePage, setVisiblePage] = useState(targetPage);
    const gesture = useRef<{ x: number; y: number; vertical: boolean } | null>(null);
    const animationUntil = useRef(0);
    const goToPage = (page: number) => {
        const next = Math.max(0, Math.min(2, page));
        if (next === visiblePage || performance.now() < animationUntil.current) return;
        animationUntil.current = performance.now() + 360;
        setVisiblePage(next);
        onPageChange(next);
    };
    useEffect(() => {
        const workspace = dashboardRef.current?.closest('main');
        workspace?.classList.add('dashboard-workspace');
        workspace?.style.setProperty('--dashboard-inline-gutter', '28px');
        return () => { workspace?.classList.remove('dashboard-workspace'); workspace?.style.removeProperty('--dashboard-inline-gutter'); };
    }, []);
    useEffect(() => { setVisiblePage(Math.max(0, Math.min(2, targetPage))); }, [targetPage]);
    return <><div className="dashboard-shell" ref={dashboardRef} style={{ '--dashboard-page-offset': `${-visiblePage * 100}%` } as React.CSSProperties}
        onTouchStart={event => {
            const target = event.target as HTMLElement;
            if (event.touches.length !== 1 || target.closest('input, textarea, select, [role="slider"]') || performance.now() < animationUntil.current) { gesture.current = null; return; }
            const touch = event.touches[0];
            gesture.current = { x: touch.clientX, y: touch.clientY, vertical: false };
        }}
        onTouchMove={event => {
            const start = gesture.current, touch = event.touches[0];
            if (event.touches.length !== 1) { gesture.current = null; return; }
            if (start && touch && Math.abs(touch.clientY - start.y) > 12 && Math.abs(touch.clientY - start.y) > Math.abs(touch.clientX - start.x)) start.vertical = true;
        }}
        onTouchCancel={() => { gesture.current = null; }}
        onTouchEnd={event => {
            const start = gesture.current, touch = event.changedTouches[0];
            gesture.current = null;
            if (!start || !touch || start.vertical) return;
            const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
            if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.5) goToPage(visiblePage + (dx < 0 ? 1 : -1));
        }}><DashboardPanels dash={dash} history={history} historyLoaded={historyLoaded} calendar={calendar} firstName={firstName} log={log} openCalendar={openCalendar} openHistory={openHistory} openWorkout={openWorkout} saveWeight={saveWeight}/></div><div className="dashboard-page-indicator" aria-label={`Dashboard page ${visiblePage + 1} of 3`}>{[0, 1, 2].map(index => <button type="button" aria-label={`Go to ${['Overview', 'Progress', 'Activity'][index]}`} aria-current={visiblePage === index ? 'page' : undefined} key={index} onClick={() => goToPage(index)}>{visiblePage === index ? '●' : '○'}</button>)}</div></>;
}
