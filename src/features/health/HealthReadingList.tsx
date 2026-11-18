import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ReadingListProps = { label: string; className: string; items: ReactNode[] };

function PagedReadingList({ label, className, items }: ReadingListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [pageSize, setPageSize] = useState(1);
  const [firstItem, setFirstItem] = useState(0);
  const pageCount = Math.ceil(items.length / pageSize);
  const currentPage = Math.min(Math.floor(firstItem / pageSize), pageCount - 1);
  const start = currentPage * pageSize;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const rowHeight = list.firstElementChild?.getBoundingClientRect().height;
      if (rowHeight) setPageSize(Math.max(1, Math.floor(list.clientHeight / rowHeight)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  return <div className="health-paged-list">
    <ul ref={listRef} className={className} aria-label={label}>{items.slice(start, start + pageSize)}</ul>
    <div className="health-list-controls" hidden={pageCount <= 1}>
      <button type="button" className="secondary" disabled={currentPage === 0} onClick={() => setFirstItem(start - pageSize)}>Previous</button>
      <span aria-live="polite">{currentPage + 1} of {pageCount}</span>
      <button type="button" className="secondary" disabled={currentPage === pageCount - 1} onClick={() => setFirstItem(start + pageSize)}>Next</button>
    </div>
  </div>;
}

export function HealthReadingList({ mobile, label, className, items }: ReadingListProps & { mobile: boolean }) {
  return mobile
    ? <PagedReadingList label={label} className={className} items={items} />
    : <ul className={`${className} health-scroll`} tabIndex={0} aria-label={label}>{items}</ul>;
}
