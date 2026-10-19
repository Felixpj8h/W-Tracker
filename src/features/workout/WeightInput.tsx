import { useState } from 'react';

export function WeightInput({ value, onChange, label, max, placeholder = '0' }: { value: number; onChange: (weight: number) => void; label: string; max?: number; placeholder?: string }) {
    const [draft, setDraft] = useState<string | null>(null);
    return <input aria-label={label} inputMode="decimal" placeholder={placeholder} value={draft ?? (value || '')}
        onChange={event => {
            const text = event.target.value;
            if (!/^\d*(?:[.,]\d*)?$/.test(text)) return;
            const weight = Number(text.replace(',', '.'));
            if (max !== undefined && weight > max) return;
            setDraft(text);
            if (Number.isFinite(weight)) onChange(weight);
        }}
        onBlur={() => setDraft(null)}/>;
}
