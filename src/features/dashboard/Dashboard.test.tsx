// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';

vi.mock('./DashboardPanels', () => ({ DashboardPanels: () => <section>Dashboard content</section> }));
afterEach(cleanup);

function fixture() {
  const onPageChange = vi.fn();
  const result = render(<Dashboard dash={null} history={[]} log={() => undefined} saveWeight={async () => undefined} onPageChange={onPageChange}/>);
  return { shell: result.container.querySelector('.dashboard-shell')!, onPageChange };
}
const touch = (x: number, y: number) => ({ clientX: x, clientY: y });

describe('Dashboard swipe gestures', () => {
  it('waits for release before advancing exactly one page', () => {
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
