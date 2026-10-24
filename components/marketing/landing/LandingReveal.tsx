'use client';

import { clsx } from 'clsx';
import type { CSSProperties, ElementType, ReactNode } from 'react';
import { useInViewOnce } from '@/hooks/useInViewOnce';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { useMarketingEditing } from '@/components/marketing/builder/MarketingEditingContext';

type LandingRevealProps = {
  children: ReactNode;
  className?: string;
  /** Stagger delay in ms */
  delay?: number;
  as?: ElementType;
  style?: CSSProperties;
  id?: string;
};

export function LandingReveal({
  children,
  className,
  delay = 0,
  as: Tag = 'div',
  style,
  id,
}: LandingRevealProps) {
  const { ref, inView } = useInViewOnce();
  const prefersReduced = usePrefersReducedMotion();
  const editing = useMarketingEditing();
  const reduced = prefersReduced || editing;

  return (
    <Tag
      ref={ref}
      id={id}
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
