'use client';

import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';

export function LandingScrollProgress() {
  const reduced = usePrefersReducedMotion();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (reduced) return;

    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      setProgress(scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [reduced]);

  if (reduced) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 bg-slate-200/80"
      aria-hidden
    >
      <div
        className="h-full origin-left bg-primary-600 transition-[width] duration-150 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
