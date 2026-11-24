import { DashboardIcon } from './DashboardIcon';
import { AnimatedValue } from '../../shared/ui/AnimatedValue';

export function Stat({ icon, label, value, sub, tone: toneOverride }: {
    icon?: 'scale' | 'volume' | 'session' | 'clock';
    label: string;
    value: string;
    sub?: string;
    /** Overrides the tone guessed from the arrow in `sub`. */
    tone?: 'positive' | 'negative' | '';
}) { const tone = toneOverride ?? (sub?.includes('↓') || sub?.includes('fewer') ? 'negative' : sub?.includes('↑') || sub?.includes('more') || sub?.trim().startsWith('+') ? 'positive' : ''); return <article>{icon && <DashboardIcon name={icon}/>}<div><span>{label}</span><strong><AnimatedValue value={value}/></strong>{sub && <small className={tone}>{sub}</small>}</div></article>; }
