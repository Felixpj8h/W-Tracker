import { DashboardIcon } from './DashboardIcon';
import { AnimatedValue } from '../../shared/ui/AnimatedValue';

export function Stat({ icon, label, value, sub }: {
    icon?: 'scale' | 'volume' | 'session' | 'clock';
    label: string;
    value: string;
    sub: string;
}) { const tone = sub.includes('↓') || sub.includes('fewer') ? 'negative' : sub.includes('↑') || sub.includes('more') || sub.trim().startsWith('+') ? 'positive' : ''; return <article>{icon && <DashboardIcon name={icon}/>}<div><span>{label}</span><strong><AnimatedValue value={value}/></strong><small className={tone}>{sub}</small></div></article>; }
