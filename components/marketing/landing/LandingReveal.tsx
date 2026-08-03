'use client';

import { clsx } from 'clsx';
import type { CSSProperties, ElementType, ReactNode } from 'react';
import { useInViewOnce } from '@/hooks/useInViewOnce';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';

type LandingRevealProps = {
  children: ReactNode;
  className?: string;
  /** Stagger delay in ms */
  delay?: number;
  as?: ElementType;
  style?: CSSProperties;
};

export function LandingReveal({
  children,
  className,
  delay = 0,
  as: Tag = 'div',
  style,
}: LandingRevealProps) {
  const { ref, inView } = useInViewOnce();
  const reduced = usePrefersReducedMotion();

  return (
    <Tag
      ref={ref}
      className={clsx(
        className,
        !reduced && (inView ? 'landing-reveal-in' : 'landing-reveal-pending'),
      )}
      style={
        reduced
          ? style
          : {
              ...style,
              animationDelay: `${delay}ms`,
            }
      }
    >
      {children}
    </Tag>
  );
}
