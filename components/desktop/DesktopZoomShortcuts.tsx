'use client';

import { useEffect } from 'react';
import { getDesktopZoom, isKhatarioDesktop, nextDesktopZoom, setDesktopZoom } from '@/lib/desktop/platform';

const ACTIONS: Record<string, 'in' | 'out' | 'reset'> = { '=': 'in', '+': 'in', '-': 'out', _: 'out', '0': 'reset' };

/** Ctrl +, Ctrl − and Ctrl 0 change the screen size in Khatario for Windows. Does nothing in a browser. */
export function DesktopZoomShortcuts() {
  useEffect(() => {
    if (!isKhatarioDesktop()) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const action = ACTIONS[e.key];
      if (!action) return;
      e.preventDefault();
      getDesktopZoom()
        .then((current) => (current === null ? null : setDesktopZoom(nextDesktopZoom(current, action))))
        .catch(() => {});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
