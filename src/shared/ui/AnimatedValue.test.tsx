// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AnimatedValue } from './AnimatedValue';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([false, true])('counts up on entry with once=%s', once => {
  let show: (visible: boolean) => void = () => {};
  vi.stubGlobal('IntersectionObserver', class {
    constructor(notify: (entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void) {
      show = visible => notify([{ isIntersecting: visible, intersectionRatio: Number(visible) }]);
    }
    observe() {}
    disconnect() {}
  });
  let tick: FrameRequestCallback = () => {};
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => { tick = frame; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(performance, 'now').mockReturnValue(0);

  const { container } = render(<AnimatedValue value={108} once={once} />);
  const current = () => container.querySelector('.animated-value-current')?.textContent;
  act(() => show(true));
  expect(current()).toBe('0');
  act(() => tick(425));
  expect(current()).toBe('95');
  expect(container.querySelector('.animated-value-target')?.textContent).toBe('108');
  act(() => tick(850));
  expect(container.textContent).toBe('108');

  act(() => show(false));
  act(() => show(true));
  expect(current()).toBe(once ? undefined : '0');
});
