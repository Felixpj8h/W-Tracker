import { useRef, useState, type KeyboardEvent } from 'react';
import { PageHeader } from '../../shared/ui/PageHeader';
import { AI_OUTPUT_LENGTHS, type AccountSettingsController } from './useAccountSettings';
import './settings.css';

type Tab = 'ai' | 'themes';
const TABS: { id: Tab; label: string }[] = [{ id: 'ai', label: 'AI preferences' }, { id: 'themes', label: 'Themes' }];

function SunIcon() {
    return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>;
}

function MoonIcon() {
    return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>;
}

export function Settings({ settings, dark, setDark }: { settings: AccountSettingsController; dark: boolean; setDark: (dark: boolean) => void }) {
    const [tab, setTab] = useState<Tab>('ai');
    const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
    const moveTab = (event: KeyboardEvent<HTMLButtonElement>) => {
        const index = TABS.findIndex(item => item.id === tab);
        const next = event.key === 'ArrowRight' ? TABS[(index + 1) % TABS.length] : event.key === 'ArrowLeft' ? TABS[(index - 1 + TABS.length) % TABS.length] : event.key === 'Home' ? TABS[0] : event.key === 'End' ? TABS[TABS.length - 1] : undefined;
        if (!next) return;
        event.preventDefault();
        setTab(next.id);
        tabRefs.current[next.id]?.focus();
    };
    const { aiOutputLength, loadState, saveError } = settings;
    const aiReady = loadState === 'loaded' && aiOutputLength !== null;
    const aiLoading = loadState === 'idle' || loadState === 'loading';
    return <section className="settings-page">
        <PageHeader><h1>Settings</h1></PageHeader>
        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
            {TABS.map(item => <button key={item.id} ref={node => { tabRefs.current[item.id] = node; }} type="button" role="tab" id={`settings-tab-${item.id}`} aria-controls={`settings-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)} onKeyDown={moveTab}>{item.label}</button>)}
        </div>
        {tab === 'ai' && <div className="settings-panel" role="tabpanel" id="settings-panel-ai" aria-labelledby="settings-tab-ai">
            <div className="settings-row">
                <div><h2 id="settings-ai-length">Response length</h2><p>How much detail Coach includes in its answers.</p></div>
                <div className="metric-toggle settings-segmented" role="radiogroup" aria-labelledby="settings-ai-length" aria-busy={aiLoading}>
                    {AI_OUTPUT_LENGTHS.map(option => <label key={option.value} className={aiOutputLength === option.value ? 'active' : ''}><input type="radio" name="ai-output-length" value={option.value} checked={aiOutputLength === option.value} disabled={!aiReady} onChange={() => settings.setAIOutputLength(option.value)}/>{option.label}</label>)}
                </div>
            </div>
            {aiLoading && <p className="settings-status" role="status">Loading your preferences…</p>}
            {loadState === 'failed' && <p className="settings-status settings-error" role="alert">Could not load your AI preferences. <button type="button" onClick={() => void settings.load()}>Retry</button></p>}
            {saveError && <p className="settings-status settings-error" role="alert">{saveError}</p>}
        </div>}
        {tab === 'themes' && <div className="settings-panel" role="tabpanel" id="settings-panel-themes" aria-labelledby="settings-tab-themes">
            <div className="settings-row">
                <h2 id="settings-theme">Appearance</h2>
                <div className="settings-theme-options" role="group" aria-labelledby="settings-theme">
                    <button type="button" aria-pressed={!dark} className={!dark ? 'active' : ''} onClick={() => setDark(false)}><SunIcon/><span>Light</span></button>
                    <button type="button" aria-pressed={dark} className={dark ? 'active' : ''} onClick={() => setDark(true)}><MoonIcon/><span>Dark</span></button>
                </div>
            </div>
        </div>}
    </section>;
}
