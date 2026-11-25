// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';

vi.mock('./DashboardPanels', () => ({ DashboardPanels: ({ onAddWeight }: { onAddWeight?: () => void }) => <section>Dashboard content{onAddWeight && <button type="button" onClick={onAddWeight}>Current weight</button>}</section> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function fixture() {
  const onPageChange = vi.fn();
  const result = render(<Dashboard dash={null} history={[]} log={() => undefined} saveWeight={async () => undefined} onPageChange={onPageChange}/>);
  return { shell: result.container.querySelector('.dashboard-shell')!, onPageChange };
}
const touch = (x: number, y: number) => ({ clientX: x, clientY: y });

describe('Dashboard swipe gestures', () => {
  it('waits for release before advancing exactly one page', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { shell, onPageChange } = fixture();
    fireEvent.touchStart(shell, { touches: [touch(250, 100)] });
    fireEvent.touchMove(shell, { touches: [touch(100, 105)] });
    expect(onPageChange).not.toHaveBeenCalled();
    expect((shell as HTMLElement).style.getPropertyValue('--dashboard-page-offset')).toBe('0%');
    fireEvent.touchEnd(shell, { changedTouches: [touch(50, 105)] });
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(1);
    expect(screen.getByRole('button', { name: 'Go to Progress' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Go to Activity' }));
    expect(onPageChange).toHaveBeenCalledTimes(1);
  });

  it('ignores vertical scrolling, short swipes, and cancelled gestures', () => {
    const { shell, onPageChange } = fixture();
    fireEvent.touchStart(shell, { touches: [touch(250, 100)] });
    fireEvent.touchMove(shell, { touches: [touch(245, 150)] });
    fireEvent.touchEnd(shell, { changedTouches: [touch(100, 160)] });
    fireEvent.touchStart(shell, { touches: [touch(250, 100)] });
    fireEvent.touchEnd(shell, { changedTouches: [touch(225, 100)] });
    fireEvent.touchStart(shell, { touches: [touch(250, 100)] });
    fireEvent.touchCancel(shell);
    fireEvent.touchEnd(shell, { changedTouches: [touch(100, 100)] });
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('keeps the first page in bounds and supports pagination buttons', () => {
    const { shell, onPageChange } = fixture();
    fireEvent.touchStart(shell, { touches: [touch(100, 100)] });
    fireEvent.touchEnd(shell, { changedTouches: [touch(250, 100)] });
    expect(onPageChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Activity' }));
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(2);
  });
});

describe('Current weight shortcut', () => {
  const mobile = (matches: boolean) => vi.spyOn(window, 'matchMedia').mockReturnValue({ matches, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as MediaQueryList);

  it('opens the Progress page on phones', () => {
    window.matchMedia ??= (() => undefined) as unknown as typeof window.matchMedia;
    mobile(true);
    const { onPageChange } = fixture();
    fireEvent.click(screen.getByRole('button', { name: 'Current weight' }));
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('is not offered on desktop or in the read-only demo', () => {
    window.matchMedia ??= (() => undefined) as unknown as typeof window.matchMedia;
    mobile(false);
    fixture();
    expect(screen.queryByRole('button', { name: 'Current weight' })).toBeNull();
    cleanup();
    mobile(true);
    render(<Dashboard dash={null} history={[]} log={() => undefined} saveWeight={async () => undefined} readOnly/>);
    expect(screen.queryByRole('button', { name: 'Current weight' })).toBeNull();
  });
});
