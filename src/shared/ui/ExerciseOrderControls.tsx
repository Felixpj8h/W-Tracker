import './exercise-order-controls.css';

export function ExerciseOrderControls({ name, index, count, disabled = false, onMove }: {
    name: string; index: number; count: number; disabled?: boolean; onMove: (from: number, to: number) => void;
}) {
    return <div className="exercise-order-controls" role="group" aria-label={`Reorder ${name}`}>
        <button type="button" disabled={disabled || index === 0} aria-label={`Move ${name} up`} title="Move up" onClick={() => onMove(index, index - 1)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>
        </button>
        <button type="button" disabled={disabled || index === count - 1} aria-label={`Move ${name} down`} title="Move down" onClick={() => onMove(index, index + 1)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14m-6-6 6 6 6-6"/></svg>
        </button>
    </div>;
}
