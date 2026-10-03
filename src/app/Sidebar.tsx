import type { Page } from './types';
import type { UserProfile } from '../features/auth/profile';

export function Sidebar({ page, setPage, dark, setDark, user, coachActive = false }: { page: Page; setPage: (page: Page) => void; dark: boolean; setDark: (value: boolean) => void; user?: UserProfile; coachActive?: boolean }) {
    const links: [Page, string, string][] = [['dashboard', '▦', 'Dashboard'], ['routines', '▤', 'Routines'], ['workout', '＋', 'Log workout'], ['coach', '✦', 'Coach'], ['calendar', '□', 'Calendar'], ['history', '◷', 'History']];
    const label = user?.name || user?.firstName || 'My training';
    return <aside className="sidebar"><div className="brand"><b>W</b><span>workout<br />tracker</span></div><div className="person"><i>{(user?.firstName || 'M').charAt(0).toLocaleUpperCase()}</i><div><b>{label}</b><small>Personal workspace</small></div></div><nav className="side-nav">{links.map(([id, icon, linkLabel]) => <button key={id} className={`side-link ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}><i>{icon}</i><span>{linkLabel}</span>{id === "coach" && coachActive && <span className="coach-dot"/>}</button>)}</nav><footer><label className="switch"><input type="checkbox" checked={dark} onChange={event => setDark(event.target.checked)}/><span />Dark mode</label><button className="sign-out" type="button" onClick={() => window.dispatchEvent(new Event('google-sign-out'))}>Sign out</button></footer></aside>;
}
