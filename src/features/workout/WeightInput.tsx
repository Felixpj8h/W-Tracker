import { useState } from 'react';

export function WeightInput({ value, onChange, label }: { value: number; onChange: (weight: number) => void; label: string }) {
    const [draft, setDraft] = useState<string | null>(null);
    return <input aria-label={label} inputMode="decimal" placeholder="0" value={draft ?? (value || '')}
        onChange={event => {
            const text = event.target.value;
            if (!/^\d*(?:[.,]\d*)?$/.test(text)) return;
            setDraft(text);
            const weight = Number(text.replace(',', '.'));
            if (Number.isFinite(weight)) onChange(weight);
        }}
        onBlur={() => setDraft(null)}/>;
}
