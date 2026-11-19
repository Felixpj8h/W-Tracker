// Shared by vite.config.ts (build-time CSS transform) and the browser runtime.

/** Desktop viewport, in CSS pixels, that the layout's proportions are tuned for. */
export const DESIGN_VIEWPORT = { width: 1440, height: 810 } as const;

const MAX_ZOOM = 3;

/**
 * Uniform zoom that makes a large viewport show the same proportions as
 * DESIGN_VIEWPORT. The zoomed layout is never narrower or shorter than the
 * design viewport, so every desktop breakpoint still matches. Never shrinks.
 */
export function viewportZoom(width: number, height: number): number {
  const zoom = Math.min(width / DESIGN_VIEWPORT.width, height / DESIGN_VIEWPORT.height, MAX_ZOOM);
  if (!Number.isFinite(zoom) || zoom <= 1) return 1;
  return Math.floor(zoom * 1000) / 1000;
}

const VIEWPORT_UNIT = /(?<![\w#.-])(-?(?:\d+(?:\.\d+)?|\.\d+))([dsl]?v(?:h|w|min|max))(?![\w-])(?!\s*\/\s*var\(--app-zoom)/g;

/**
 * Divide CSS viewport units by --app-zoom. CSS zoom also multiplies viewport
 * units, so without this 100dvh would overflow a zoomed page.
 */
export function scaleViewportUnits(css: string): string {
  return css.replace(VIEWPORT_UNIT, (_match, value: string, unit: string) => `calc(${value}${unit} / var(--app-zoom, 1))`);
}
