'use client';

import { useEffect, useRef, useState } from 'react';
import { useInViewOnce } from '@/hooks/useInViewOnce';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';

type LandingCountUpProps = {
  value: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  durationMs?: number;
  className?: string;
};

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function LandingCountUp({
  value,
  suffix = '',
  prefix = '',
  decimals = 0,
  durationMs = 1400,
  className,
}: LandingCountUpProps) {
  const { ref, inView } = useInViewOnce({ threshold: 0.35 });
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : 0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!inView || startedRef.current) return;
    startedRef.current = true;

    if (reduced) {
      setDisplay(value);
      return;
    }

    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const next = value * easeOutCubic(progress);
      setDisplay(next);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduced, value, durationMs]);

  const formatted =
    decimals > 0
      ? display.toFixed(decimals)
      : Math.round(display).toLocaleString('en-IN');

  return (
    <span ref={ref} className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
