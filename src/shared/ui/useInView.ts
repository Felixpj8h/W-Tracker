import { useEffect, useState } from 'react';

export function useInView<T extends Element>() {
  const [element, setElement] = useState<T | null>(null);
  const [visible, setVisible] = useState(false);
  const supported = typeof IntersectionObserver !== 'undefined';

  useEffect(() => {
    if (!element || !supported) return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting && entry.intersectionRatio >= .5);
    }, { threshold: .5 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, supported]);

  return [setElement, supported ? visible : undefined] as const;
}
