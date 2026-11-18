import { useId, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useHealthSwipe } from './useHealthSwipe';

export function HealthTabs({ id, labels, name, selected, onSelect, className = '' }: {
  id: string;
  labels: readonly string[];
  name: string;
  selected: number;
  onSelect: (index: number) => void;
  className?: string;
}) {
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const destinations: Record<string, number> = {
      ArrowLeft: (index - 1 + labels.length) % labels.length,
      ArrowRight: (index + 1) % labels.length,
      Home: 0,
      End: labels.length - 1,
    };
    const next = destinations[event.key];
    if (typeof next !== 'number') return;
    event.preventDefault();
    onSelect(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  }

  return <div className={`health-tabs metric-toggle ${className}`} role="tablist" aria-label={name}>
    {labels.map((label, index) => <button
      type="button"
      key={label}
      id={`${id}-tab-${index}`}
      role="tab"
      className={selected === index ? 'active' : undefined}
      aria-controls={`${id}-panel-${index}`}
      aria-selected={selected === index}
      tabIndex={selected === index ? 0 : -1}
      onClick={() => onSelect(index)}
      onKeyDown={event => navigate(event, index)}
    >{label}</button>)}
  </div>;
}

export function HealthPager({ name, heading, headline, panes, swipePanes = true }: {
  name: string;
  heading: ReactNode;
  headline?: ReactNode;
  panes: { label: string; content: ReactNode }[];
  swipePanes?: boolean;
}) {
  const id = useId();
  const [selectedIndex, setSelected] = useState(0);
  const hasTabs = panes.length > 1;
  const selected = selectedIndex < panes.length ? selectedIndex : 0;
  const swipe = useHealthSwipe(direction => {
    const next = selected + direction;
    if (next < 0 || next >= panes.length) return false;
    setSelected(next);
    return true;
  });

  return <div className="health-pager">
    <div className="health-pager-heading">
      {heading}
      {hasTabs && <HealthTabs id={id} labels={panes.map(pane => pane.label)} name={name} selected={selected} onSelect={setSelected} />}
    </div>
    {headline}
    <div className="health-pager-window" {...(swipePanes && hasTabs ? swipe : {})}>
      <div className="health-pager-track" style={{ transform: `translateX(${-selected * 100}%)` }}>
        {panes.map(({ label, content }, index) => <div
          key={label}
          className="health-pane"
          id={`${id}-panel-${index}`}
          role={hasTabs ? 'tabpanel' : undefined}
          aria-labelledby={hasTabs ? `${id}-tab-${index}` : undefined}
          aria-hidden={index !== selected || undefined}
          inert={index !== selected}
        >{content}</div>)}
      </div>
    </div>
  </div>;
}
