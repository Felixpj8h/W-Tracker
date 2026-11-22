const KEYBOARD_MIN_HEIGHT = 120;

function isAppleTouchDevice(): boolean {
  // iPadOS reports a Mac user agent, so recognise it by its touch points.
  return /iP(hone|od|ad)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

// iOS zooms the whole page when a field under 16px is focused, and a Home Screen
// app has no way to zoom back out. maximum-scale=1 stops that automatic zoom
// while iOS keeps pinch-zoom available. Android ignores focus zoom but would
// honour the limit for pinch-zoom, so only iOS gets it.
export function preventIosFocusZoom(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta || !isAppleTouchDevice() || /maximum-scale/.test(meta.content)) return;
  meta.content = `${meta.content}, maximum-scale=1`;
}

// iOS applies :active press styles only when the page listens for touches.
export function enableTouchPressStates(): void {
  document.addEventListener('touchstart', () => {}, { passive: true });
}
const TEXT_FIELD = 'textarea, input:is([type="text"], [type="search"], [type="email"], [type="password"], [type="number"], [type="tel"], [type="url"], :not([type]))';

// Mobile browsers can resize or pan the visual viewport while fixed elements
// still use the layout viewport. Expose those bounds only while typing.
export function startMobileViewport(): void {
  const viewport = window.visualViewport;
  if (!viewport) return;

  const mobile = window.matchMedia('(max-width: 760px)');
  const root = document.documentElement;
  let frame = 0;
  let previousWidth = 0;
  let restingHeight = 0;
  let keyboardOpen = false;

  const clearKeyboard = () => {
    if (!keyboardOpen) return;
    keyboardOpen = false;
    root.removeAttribute('data-mobile-keyboard');
    root.style.removeProperty('--mobile-visible-top');
    root.style.removeProperty('--mobile-visible-height');
  };

  const update = () => {
    frame = 0;
    if (!mobile.matches || Math.abs(viewport.scale - 1) > 0.01) {
      clearKeyboard();
      return;
    }

    // A rotation or width change invalidates the old full-height measurement.
    if (Math.abs(viewport.width - previousWidth) > 1) {
      previousWidth = viewport.width;
      restingHeight = 0;
    }
    const field = document.activeElement;
    const typing = field?.matches(TEXT_FIELD) && !field.matches(':read-only, [inputmode="none"]');
    const height = viewport.height;
    const contracted = Math.max(restingHeight, root.clientHeight) - height >= KEYBOARD_MIN_HEIGHT;
    if (!contracted || (!typing && !keyboardOpen)) {
      restingHeight = height;
      clearKeyboard();
      return;
    }

    // Keep using the visible bounds through the keyboard's closing animation.
    keyboardOpen = true;
    root.style.setProperty('--mobile-visible-top', `${Math.max(0, viewport.offsetTop)}px`);
    root.style.setProperty('--mobile-visible-height', `${height}px`);
    root.setAttribute('data-mobile-keyboard', '');
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  update();
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  document.addEventListener('visibilitychange', schedule);
}
