import { useEffect, useRef, useState } from 'react';
import type { Page } from './types';
import { useModalFocus } from '../shared/ui/useModalFocus';
import { useBackAction } from '../shared/lib/backNavigation';

export function MobileNavigation({ page, setPage, dashboardPage, setDashboardPage, dark, setDark, logWorkout, readOnly = false, exitDemo, hasActiveSession = false }: { page: Page; setPage: (page: Page) => void; dashboardPage: number; setDashboardPage: (page: number) => void; dark: boolean; setDark: (dark: boolean) => void; logWorkout: () => void; readOnly?: boolean; exitDemo?: () => void; hasActiveSession?: boolean }) {
    const [moreOpen, setMoreOpen] = useState(false);
    const [moreClosing, setMoreClosing] = useState(false);
    const closeTimer = useRef<number | undefined>(undefined);
    useEffect(() => () => window.clearTimeout(closeTimer.current), []);
    // Slide the sheet back down before unmounting it (skipped when reduced motion is requested).
    const closeMore = () => {
        if (!moreOpen || moreClosing) return;
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setMoreOpen(false); return; }
        setMoreClosing(true);
        closeTimer.current = window.setTimeout(() => { setMoreOpen(false); setMoreClosing(false); }, 150);
    };
    const sheet = useRef<HTMLDivElement>(null);
    useBackAction(moreOpen && !moreClosing, () => closeMore());
    useModalFocus(sheet, moreOpen, closeMore);
    const openMore = () => { window.clearTimeout(closeTimer.current); setMoreClosing(false); setMoreOpen(true); };
    return <><div className="mobile"><button className={page === 'dashboard' && dashboardPage === 0 ? 'active' : ''} onClick={() => { setMoreOpen(false); setDashboardPage(0); setPage('dashboard'); }}><span aria-hidden="true">⌂</span><small>Dashboard</small></button><button className={page === 'routines' ? 'active' : ''} onClick={() => { setMoreOpen(false); setPage('routines'); }}><span aria-hidden="true">▤</span><small>Routines</small></button><button disabled={readOnly} className={page === 'workout' ? 'active mobile-log' : 'mobile-log'} onClick={() => { setMoreOpen(false); logWorkout(); }}><span aria-hidden="true">{hasActiveSession ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" focusable="false"><path d="M8 4.5 20 12 8 19.5Z"/></svg> : '＋'}</span><small>{hasActiveSession ? 'Resume' : 'Log workout'}</small></button><button disabled={readOnly} className={page === 'coach' ? 'active' : ''} onClick={() => { setMoreOpen(false); setPage('coach'); }}><span aria-hidden="true">✦</span><small>Coach</small></button><button className={moreOpen || page === 'health' || page === 'calendar' || page === 'history' || page === 'settings' || (page === 'dashboard' && dashboardPage > 0) ? 'active' : ''} aria-label="More pages" aria-expanded={moreOpen && !moreClosing} onClick={() => (moreOpen && !moreClosing ? closeMore() : openMore())}><span aria-hidden="true">⋯</span><small>More</small></button></div>{moreOpen && <div className={`more-wrap${moreClosing ? ' closing' : ''}`}><button className="more-backdrop" aria-label="Close More menu" onClick={closeMore}/><div ref={sheet} tabIndex={-1} className="more-sheet" role="dialog" aria-modal="true" aria-label="More"><button onClick={() => { setDashboardPage(1); setPage('dashboard'); setMoreOpen(false); }}>▥ Progress</button><button onClick={() => { setDashboardPage(2); setPage('dashboard'); setMoreOpen(false); }}>▤ Activity</button><button onClick={() => { setPage('calendar'); setMoreOpen(false); }}>▣ Calendar</button><button onClick={() => { setPage('history'); setMoreOpen(false); }}>◷ History</button>{!readOnly && <button onClick={() => { setPage('health'); setMoreOpen(false); }}>♡ Health</button>}{readOnly ? <label className="switch"><input type="checkbox" checked={dark} onChange={event => setDark(event.target.checked)}/><span/>Dark mode</label> : <button className={page === 'settings' ? 'active' : ''} onClick={() => { setPage('settings'); setMoreOpen(false); }}>⚙ Settings</button>}{readOnly && <button type="button" onClick={exitDemo}>Exit demo</button>}</div></div>}</>;
}
