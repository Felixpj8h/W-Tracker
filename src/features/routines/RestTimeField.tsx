import { useState } from 'react';

const REST_PRESETS = [0, 60, 90, 120, 180, 240, 300];

export function RestTimeField({ seconds, name, onChange }: { seconds: number; name: string; onChange: (seconds: number) => void }) {
    const [custom, setCustom] = useState(!REST_PRESETS.includes(seconds));
    const minutes = Math.floor(seconds / 60), remainingSeconds = seconds % 60;
    const updatePart = (nextMinutes: number, nextSeconds: number) => onChange(Math.min(1800, Math.max(0, nextMinutes * 60 + nextSeconds)));
    const numericPart = (value: string, max: number) => { const normalized = value.replace(/^0+(?=\d)/, ''); return Math.min(max, Math.max(0, normalized === '' ? 0 : Number(normalized))); };
    return <div className="rest-time-field"><select aria-label={`${name} rest time`} value={custom ? 'other' : seconds} onChange={event => { if (event.target.value === 'other') { setCustom(true); return; } setCustom(false); onChange(Number(event.target.value)); }}><option value="0">No timer</option><option value="60">1 min</option><option value="90">1 min 30 sec</option><option value="120">2 min</option><option value="180">3 min</option><option value="240">4 min</option><option value="300">5 min</option><option value="other">Other…</option></select>{custom && <div className="custom-rest-time"><label><input aria-label={`${name} custom rest minutes`} type="number" inputMode="numeric" min="0" max="30" value={minutes || ''} placeholder="0" onFocus={event => event.currentTarget.select()} onChange={event => updatePart(numericPart(event.target.value, 30), remainingSeconds)}/><span>min</span></label><label><input aria-label={`${name} custom rest seconds`} type="number" inputMode="numeric" min="0" max="59" value={remainingSeconds || ''} placeholder="0" onFocus={event => event.currentTarget.select()} onChange={event => updatePart(minutes, numericPart(event.target.value, 59))}/><span>sec</span></label></div>}</div>;
}
