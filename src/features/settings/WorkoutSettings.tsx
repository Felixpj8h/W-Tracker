import { SET_PREFILLS, setWorkoutPreferences, useWorkoutPreferences } from '../workout/workoutPreferences';

const ON_OFF = [{ value: true, label: 'On' }, { value: false, label: 'Off' }];

/** Live-workout preferences. Saved on this device, like the color theme. */
export function WorkoutSettings() {
    const preferences = useWorkoutPreferences();
    const toggle = (id: string, name: 'autoRest' | 'restAlert', title: string, text: string) => <div className="settings-row">
        <div><h2 id={id}>{title}</h2><p>{text}</p></div>
        <div className="metric-toggle settings-segmented" role="radiogroup" aria-labelledby={id}>
            {ON_OFF.map(option => <label key={option.label} className={preferences[name] === option.value ? 'active' : ''}><input type="radio" name={id} checked={preferences[name] === option.value} onChange={() => setWorkoutPreferences({ [name]: option.value })}/>{option.label}</label>)}
        </div>
    </div>;
    return <>
        <div className="settings-row">
            <div><h2 id="settings-set-prefill">Fill in set weights</h2><p>Off keeps the routine's target weights. First set copies the weight you enter in the first set to the sets below it that you have not changed or checked. Last session fills empty sets with the weights from the last time you did the exercise. Saved on this device.</p></div>
            <div className="metric-toggle settings-segmented" role="radiogroup" aria-labelledby="settings-set-prefill">
                {SET_PREFILLS.map(option => <label key={option.value} className={preferences.setPrefill === option.value ? 'active' : ''}><input type="radio" name="set-prefill" value={option.value} checked={preferences.setPrefill === option.value} onChange={() => setWorkoutPreferences({ setPrefill: option.value })}/>{option.label}</label>)}
            </div>
        </div>
        {toggle('settings-auto-rest', 'autoRest', 'Start rest when a set is checked', "Starts the exercise's rest timer when you check a working set. In a superset it starts once both exercises have finished the round.")}
        {toggle('settings-rest-alert', 'restAlert', 'Rest finished alert', 'Beeps and vibrates when the rest timer ends while Jern is open. iPhones cannot vibrate from a web app and mute the beep in silent mode.')}
    </>;
}
