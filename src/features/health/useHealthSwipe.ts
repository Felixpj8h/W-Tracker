import { useRef } from 'react';
import type { PointerEvent } from 'react';

export function useHealthSwipe(move: (direction: number) => boolean) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      start.current = null;
      if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest('button, input, select, textarea, a, label')) return;
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerCancel() {
      start.current = null;
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const gesture = start.current;
      start.current = null;
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (Math.abs(dx) >= 42 && Math.abs(dx) > Math.abs(dy) * 1.5 && move(dx < 0 ? 1 : -1)) {
        event.stopPropagation();
      }
    },
  };
}
