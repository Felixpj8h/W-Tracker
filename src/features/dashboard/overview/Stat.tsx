import { DashboardIcon } from './DashboardIcon';
import { AnimatedValue } from '../../../shared/ui/AnimatedValue';

export function Stat({ icon, label, value, sub, tone: toneOverride, action }: {
    icon?: 'scale' | 'volume' | 'session' | 'clock';
    label: string;
    value: string;
    sub?: string;
    /** Overrides the tone guessed from the arrow in `sub`. */
    tone?: 'positive' | 'negative' | '';
    /** Makes the whole tile a button that runs this action. */
    action?: { label: string; onClick: () => void };
}) { const tone = toneOverride ?? (sub?.includes('↓') || sub?.includes('fewer') ? 'negative' : sub?.includes('↑') || sub?.includes('more') || sub?.trim().startsWith('+') ? 'positive' : ''); return <article className={action ? 'stat-action' : undefined}>{action && <button type="button" className="stat-action-button" aria-label={action.label} onClick={action.onClick}/>}{icon && <DashboardIcon name={icon}/>}<div><span>{label}</span><strong><AnimatedValue value={value}/></strong>{sub && <small className={tone}>{sub}</small>}</div></article>; }
