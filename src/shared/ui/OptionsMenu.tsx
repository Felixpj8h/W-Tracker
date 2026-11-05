import type { ReactNode } from 'react';
import { DismissibleDetails } from './DismissibleDetails';

export function OptionsMenu({ label, children }: { label: string; children: ReactNode }) {
    return <DismissibleDetails className="routine-menu" closeOnAction>
        <summary aria-label={label}>⋮</summary>
        <div className="routine-menu-panel">{children}</div>
    </DismissibleDetails>;
}
