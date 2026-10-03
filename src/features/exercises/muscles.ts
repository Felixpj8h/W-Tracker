

export const cleanMuscleLabel = (value?: string | null, secondary: string[] = []) => {
    const primary = (value ?? '').replace(/^(?:Primary:\s*)+/i, '').split(' · ')[0].trim() || 'Unmapped';
    const uniqueSecondary = [...new Set(secondary.map(name => name.replace(/^Secondary:\s*/i, '').trim()).filter(name => name && name !== primary))];
    return `Primary: ${primary}${uniqueSecondary.length ? ` · Secondary: ${uniqueSecondary.join(', ')}` : ''}`;
};
