import { useState } from 'react';
import { TARGET_WEIGHT_RANGE, WEIGHT_GOALS, type AccountSettingsController } from './useAccountSettings';

const GOAL_HINTS = {
    none: 'Weight changes on the dashboard are shown without judging them.',
    target: 'Moving toward your target weight is shown as progress on the dashboard.',
    lose: 'Weight going down is shown as progress on the dashboard.',
    maintain: 'Staying within 1 kg a month is shown as progress on the dashboard.',
    gain: 'Weight going up is shown as progress on the dashboard.',
};

export function WeightGoalSettings({ settings }: { settings: AccountSettingsController }) {
    const { weightGoal, targetWeight, loadState } = settings;
    const ready = loadState === 'loaded' && settings.settings !== null;
    const [draft, setDraft] = useState(targetWeight?.toString() ?? '');
    const [draftError, setDraftError] = useState<string | null>(null);
    // Follow the saved value when it changes, for example after a failed save reverts it.
    const [shownTarget, setShownTarget] = useState(targetWeight);
    if (shownTarget !== targetWeight) {
        setShownTarget(targetWeight);
        setDraft(targetWeight?.toString() ?? '');
        setDraftError(null);
    }

    const commitTarget = () => {
        const text = draft.trim().replace(',', '.');
        if (!text) { setDraftError(null); settings.setTargetWeight(null); return; }
        const value = Math.round(Number(text) * 10) / 10;
        if (!Number.isFinite(value) || value < TARGET_WEIGHT_RANGE.min || value > TARGET_WEIGHT_RANGE.max) {
            setDraftError(`Enter a weight between ${TARGET_WEIGHT_RANGE.min} and ${TARGET_WEIGHT_RANGE.max} kg.`);
            return;
        }
        setDraftError(null);
        setDraft(value.toString());
        settings.setTargetWeight(value);
    };

    return <>
        <div className="settings-row">
            <div><h2 id="settings-weight-goal">Weight goal</h2><p>{GOAL_HINTS[weightGoal ?? (targetWeight !== null ? 'target' : 'none')]}</p></div>
            <div className="metric-toggle settings-segmented" role="radiogroup" aria-labelledby="settings-weight-goal" aria-busy={!ready && loadState !== 'failed'}>
                {WEIGHT_GOALS.map(option => <label key={option.label} className={ready && weightGoal === option.value ? 'active' : ''}><input type="radio" name="weight-goal" value={option.value ?? 'none'} checked={ready && weightGoal === option.value} disabled={!ready} onChange={() => settings.setWeightGoal(option.value)}/>{option.label}</label>)}
            </div>
        </div>
        <div className="settings-row settings-target-weight">
            <div><h2><label htmlFor="settings-target-weight-input">Target weight</label></h2><p>Optional. Shown as a line on the bodyweight chart, with how far you have left.{weightGoal ? '' : ' Without a goal, the direction toward it counts as progress.'}</p></div>
            <form className="settings-target-field" onSubmit={event => { event.preventDefault(); commitTarget(); }}>
                <input id="settings-target-weight-input" inputMode="decimal" placeholder="e.g. 80" value={draft} disabled={!ready} aria-invalid={draftError ? true : undefined} aria-describedby={draftError ? 'settings-target-weight-error' : undefined} onChange={event => setDraft(event.target.value)} onBlur={commitTarget}/>
                <span aria-hidden="true">kg</span>
                {targetWeight !== null && <button type="button" disabled={!ready} onMouseDown={event => event.preventDefault()} onClick={() => { setDraft(''); setDraftError(null); settings.setTargetWeight(null); }}>Clear</button>}
            </form>
        </div>
        {draftError && <p className="settings-status settings-error" id="settings-target-weight-error" role="alert">{draftError}</p>}
    </>;
}
