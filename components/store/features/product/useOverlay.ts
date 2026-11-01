'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { createScrollLock } from './product-logic';

const bodyLock = createScrollLock(
  () => document.body.style.overflow,
  (overflow) => {
    document.body.style.overflow = overflow;
  },
);

/**
 * Full-screen overlay plumbing: locks body scroll, closes on Escape (before an outer
 * modal's own Escape handler sees it), moves focus in and back out again.
 */
export function useOverlay(open: boolean, onClose: () => void, focusRef: RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    bodyLock.lock();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    const id = window.requestAnimationFrame(() => focusRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener('keydown', onKey, true);
      bodyLock.unlock();
      previous?.focus?.();
    };
  }, [open, focusRef]);
}

/** True after mount, so portals only render on the client. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
