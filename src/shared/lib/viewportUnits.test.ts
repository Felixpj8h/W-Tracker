import { describe, expect, it } from 'vitest';
import { scaleViewportUnits, viewportZoom } from './viewportUnits';

describe('viewportZoom', () => {
  it('keeps the reference size and smaller screens unscaled', () => {
    expect(viewportZoom(1440, 810)).toBe(1);
    expect(viewportZoom(1280, 720)).toBe(1);
    expect(viewportZoom(390, 844)).toBe(1);
    expect(viewportZoom(2560, 700)).toBe(1);
  });

  it('scales by the limiting side so the layout keeps its proportions', () => {
    expect(viewportZoom(2560, 1440)).toBeCloseTo(1.777, 3);
    expect(viewportZoom(2560, 1300)).toBeCloseTo(1.604, 3);
    expect(viewportZoom(1920, 960)).toBeCloseTo(1.185, 3);
    expect(viewportZoom(3440, 1300)).toBeCloseTo(1.604, 3);
  });

  it('caps very large screens', () => {
    expect(viewportZoom(7680, 4320)).toBe(3);
  });
});

describe('scaleViewportUnits', () => {
  it('divides viewport units by the app zoom', () => {
    expect(scaleViewportUnits('height:100dvh;margin:-2vh .5vw;gap:clamp(8px,1.2vw,16px)')).toBe(
      'height:calc(100dvh / var(--app-zoom, 1));margin:calc(-2vh / var(--app-zoom, 1)) calc(.5vw / var(--app-zoom, 1));gap:clamp(8px,calc(1.2vw / var(--app-zoom, 1)),16px)',
    );
    expect(scaleViewportUnits('min-height:100svh;width:calc(100vw - 280px);x:10vmin')).toBe(
      'min-height:calc(100svh / var(--app-zoom, 1));width:calc(calc(100vw / var(--app-zoom, 1)) - 280px);x:calc(10vmin / var(--app-zoom, 1))',
    );
  });

  it('leaves other units, names and already scaled values alone', () => {
    const css = '.h1{width:12px;flex:1 1 0;--gap-2vh:3px;color:#5vh}.a{height:calc(100dvh / var(--app-zoom, 1))}';
    expect(scaleViewportUnits(css)).toBe(css);
  });
});
