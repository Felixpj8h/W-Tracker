import { useEffect, useRef, useState } from 'react';
import { useInView } from './useInView';

export function AnimatedValue({ value, format, once = false }: {
  value: string | number | null | undefined;
  format?: (value: number) => string;
  once?: boolean;
}) {
  const match = typeof value === 'string' ? value.match(/^([\d,.]+)(.*)$/) : null;
  const target = match ? Number(match[1].replaceAll(',', '')) : typeof value === 'number' ? value : null;
  const suffix = match?.[2] ?? '';
  const decimals = match?.[1].split('.')[1]?.length ?? 0;
  const display = format ?? ((amount: number) => amount.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) + suffix);
  const final = target == null || !Number.isFinite(target) ? String(value ?? '-') : display(target);
  const [ref, visible] = useInView<HTMLSpanElement>();
  const [shown, setShown] = useState<number | null>(null);
  const hasPlayed = useRef(false);

  useEffect(() => {
    setShown(null);
    if (!visible || target == null || !Number.isFinite(target) || (once && hasPlayed.current)) return;
    if (once) hasPlayed.current = true;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (target === 0 || motion?.matches) return;

    setShown(0);
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(time) {
      const progress = Math.min(1, Math.max(0, (time - start) / 850));
      setShown(progress === 1 ? null : target * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(tick);
    });
    const stop = () => {
      if (!motion?.matches) return;
      cancelAnimationFrame(frame);
      setShown(null);
    };
    motion?.addEventListener('change', stop);
    return () => {
      cancelAnimationFrame(frame);
      motion?.removeEventListener('change', stop);
    };
  }, [once, target, visible]);

  return <span className="animated-value" ref={ref}>
    {shown == null ? final : <>
      <span className="animated-value-target">{final}</span>
      <span className="animated-value-current" aria-hidden="true">{display(shown)}</span>
    </>}
  </span>;
}
