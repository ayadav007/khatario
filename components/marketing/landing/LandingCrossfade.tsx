'use client';

import { clsx } from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';

export const LANDING_CROSSFADE_OUT_MS = 220;
export const LANDING_CROSSFADE_IN_MS = 320;

type LandingCrossfadeProps<T extends string> = {
  contentKey: T;
  children: (key: T) => ReactNode;
  className?: string;
};

/** Fade + slide when `contentKey` changes (e.g. Billing → HR on landing). */
export function LandingCrossfade<T extends string>({
  contentKey,
  children,
  className,
}: LandingCrossfadeProps<T>) {
  const reduced = usePrefersReducedMotion();
  const [displayKey, setDisplayKey] = useState(contentKey);
  const [phase, setPhase] = useState<'idle' | 'exit' | 'enter'>('idle');
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    if (contentKey === displayKey) return;

    const clearTimers = () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };

    if (reduced) {
      setDisplayKey(contentKey);
      setPhase('idle');
      return;
    }

    clearTimers();
    setPhase('exit');

    timersRef.current.push(
      window.setTimeout(() => {
        setDisplayKey(contentKey);
        setPhase('enter');
        timersRef.current.push(
          window.setTimeout(() => setPhase('idle'), LANDING_CROSSFADE_IN_MS),
        );
      }, LANDING_CROSSFADE_OUT_MS),
    );

    return clearTimers;
  }, [contentKey, displayKey, reduced]);

  return (
    <div
      className={clsx(
        className,
        phase === 'exit' && 'landing-crossfade-out',
        phase === 'enter' && 'landing-crossfade-in',
      )}
      aria-live="polite"
    >
      {children(displayKey as T)}
    </div>
  );
}
