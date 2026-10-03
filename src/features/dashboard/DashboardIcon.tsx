

export function DashboardIcon({ name }: { name: 'scale' | 'volume' | 'session' | 'clock' | 'calendar' | 'chevron' }) {
    const paths = {
        scale: <><path d="M5 19a8 8 0 1 1 14 0"/><path d="M12 7v3"/><path d="m12 10 3-2"/><path d="M5 19h14"/></>,
        volume: <><path d="M5 20v-6M10 20V9M15 20V4M20 20v-9"/></>,
        session: <><path d="M4 10v4M7 8v8M17 8v8M20 10v4M7 12h10"/></>,
        clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>,
        calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></>,
        chevron: <path d="m9 10 3 3 3-3"/>,
    };
    return <svg className="dashboard-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
