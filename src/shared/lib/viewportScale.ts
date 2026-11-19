import { viewportZoom } from './viewportUnits';

/** Standardized CSS zoom scales lengths and viewport units together; older engines (Safari) do not. */
function hasStandardZoom(): boolean {
  if (!('zoom' in document.documentElement.style)) return false;
  const measure = (zoom: string) => {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;top:0;left:0;width:10px;height:100vh;visibility:hidden;pointer-events:none;zoom:${zoom}`;
    document.body.append(probe);
    const rect = probe.getBoundingClientRect();
    probe.remove();
    return rect;
  };
  const plain = measure('1');
  const zoomed = measure('2');
  return plain.height > 0 && Math.abs(zoomed.width - plain.width * 2) < 0.5 && Math.abs(zoomed.height - plain.height * 2) < 1;
}

/** Scale the whole app uniformly on large screens so it keeps the reference proportions. */
export function startViewportScale(): void {
  if (typeof window === 'undefined' || !document.body || !hasStandardZoom()) return;
  const root = document.documentElement;
  let frame = 0;
  const apply = () => {
    frame = 0;
    const zoom = viewportZoom(window.innerWidth, window.innerHeight);
    if (zoom === 1) {
      root.style.removeProperty('zoom');
      root.style.removeProperty('--app-zoom');
      return;
    }
    root.style.setProperty('zoom', String(zoom));
    root.style.setProperty('--app-zoom', String(zoom));
  };
  apply();
  window.addEventListener('resize', () => { if (!frame) frame = requestAnimationFrame(apply); });
}
