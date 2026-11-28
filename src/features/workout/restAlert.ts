type AudioContextConstructor = typeof AudioContext;

let context: AudioContext | null = null;

/**
 * Browsers only let a page start audio from a tap, so the beep's audio
 * context is created or resumed when the rest timer starts.
 */
export function primeRestAlert() {
    try {
        const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
        if (!Context) return;
        context ??= new Context();
        if (context.state === 'suspended') void context.resume().catch(() => undefined);
    } catch { /* Vibration still works without audio. */ }
}

/** Two short beeps and a vibration. iPhones do not support vibration from the web. */
export function playRestAlert() {
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* Not supported. */ }
    if (!context || context.state !== 'running') return;
    try {
        const start = context.currentTime;
        for (const offset of [0, 0.28]) {
            const tone = context.createOscillator(), gain = context.createGain();
            tone.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, start + offset);
            gain.gain.exponentialRampToValueAtTime(0.35, start + offset + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.2);
            tone.connect(gain).connect(context.destination);
            tone.start(start + offset);
            tone.stop(start + offset + 0.22);
        }
    } catch { /* The vibration has already been requested. */ }
}
