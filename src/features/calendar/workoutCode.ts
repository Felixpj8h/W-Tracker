/** Short calendar codes for workout types, derived from the routine or workout name. */
export type WorkoutType = { code: string; label: string };

const TYPES: { pattern: RegExp; code: string; label: string }[] = [
    { pattern: /\b(full[\s-]*body|total[\s-]*body|fullbody)\b/i, code: 'F', label: 'Full body' },
    { pattern: /\bupper\b/i, code: 'U', label: 'Upper' },
    { pattern: /\blower\b/i, code: 'L', label: 'Lower' },
    { pattern: /\bpush\b/i, code: 'Ps', label: 'Push' },
    { pattern: /\bpull\b/i, code: 'Pl', label: 'Pull' },
    { pattern: /\b(legs?|leg day)\b/i, code: 'Lg', label: 'Legs' },
    { pattern: /\b(chest)\b/i, code: 'C', label: 'Chest' },
    { pattern: /\b(back)\b/i, code: 'B', label: 'Back' },
    { pattern: /\b(shoulders?|delts?)\b/i, code: 'S', label: 'Shoulders' },
    { pattern: /\b(arms?|biceps?|triceps?)\b/i, code: 'A', label: 'Arms' },
    { pattern: /\b(core|abs)\b/i, code: 'Co', label: 'Core' },
    { pattern: /\b(cardio|conditioning|hiit|run|running|cycling|bike)\b/i, code: 'Ca', label: 'Cardio' },
    { pattern: /\b(mobility|stretch(ing)?|yoga|recovery)\b/i, code: 'M', label: 'Mobility' },
];

/** The workout's type (code and readable label), without any A/B/C variant. */
export function workoutType(name: string | null | undefined): WorkoutType | null {
    const text = (name ?? '').trim();
    if (!text) return null;
    const match = TYPES.find(type => type.pattern.test(text));
    if (match) return { code: match.code, label: match.label };
    const first = text.match(/[\p{L}\p{N}]/u)?.[0];
    return first ? { code: first.toLocaleUpperCase(), label: text.split(' · ')[0] } : null;
}

/** Calendar code: the type code plus a trailing single-letter or single-digit variant ("Full Body C" → "FC"). */
export function workoutCode(name: string | null | undefined): string {
    const type = workoutType(name);
    if (!type) return '';
    const variant = (name ?? '').split(' · ')[0].trim().match(/(?:^|\s)([A-Za-z]|\d)$/)?.[1];
    return variant && type.code.length < 3 ? `${type.code}${variant.toLocaleUpperCase()}` : type.code;
}
