import type { Dash } from './types';
import type { WeightGoal } from '../settings/useAccountSettings';
import type { Workout } from '../workout/types';
import type { CalendarMonth } from '../calendar/types';
import { useRef, useState, useEffect, useSyncExternalStore } from 'react';
import { DashboardPanels } from './DashboardPanels';

const mobileDashboard = '(max-width: 760px)';
const isMobile = () => window.matchMedia?.(mobileDashboard).matches ?? false;
function subscribeMobile(notify: () => void) {
    const media = window.matchMedia?.(mobileDashboard);
    media?.addEventListener?.('change', notify);
    return () => media?.removeEventListener?.('change', notify);
}

export function Dashboard({ dash, history, historyLoaded = false, calendar, firstName = 'Athlete', profilePicture, log, openCalendar = () => undefined, openHealth = () => undefined, targetPage = 0, onPageChange = () => undefined, saveWeight, readOnly = false, weightGoal = null, targetWeight = null }: { dash: Dash | null; history: Workout[]; historyLoaded?: boolean; calendar?: CalendarMonth; firstName?: string; profilePicture?: string; log: () => void; openCalendar?: () => void; openHealth?: () => void; targetPage?: number; onPageChange?: (page: number) => void; saveWeight: (n: number, recordedOn?: string) => Promise<void>; readOnly?: boolean; weightGoal?: WeightGoal | null; targetWeight?: number | null }) {
    const dashboardRef = useRef<HTMLDivElement>(null);
    const [visiblePage, setVisiblePage] = useState(targetPage);
    const mobile = useSyncExternalStore(subscribeMobile, isMobile);
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
        }}><DashboardPanels activePanel={mobile ? visiblePage : undefined} dash={dash} history={history} historyLoaded={historyLoaded} calendar={calendar} firstName={firstName} profilePicture={profilePicture} log={log} openCalendar={openCalendar} openHealth={openHealth} saveWeight={saveWeight} readOnly={readOnly} weightGoal={weightGoal} targetWeight={targetWeight} onAddWeight={mobile && !readOnly ? () => goToPage(1) : undefined}/></div><div className="dashboard-page-indicator" aria-label={`Dashboard page ${visiblePage + 1} of 3`}>{[0, 1, 2].map(index => <button type="button" aria-label={`Go to ${['Overview', 'Progress', 'Activity'][index]}`} aria-current={visiblePage === index ? 'page' : undefined} key={index} onClick={() => goToPage(index)}>{visiblePage === index ? '●' : '○'}</button>)}</div></>;
}
