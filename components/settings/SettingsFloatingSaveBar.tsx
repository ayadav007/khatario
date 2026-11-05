'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { WIDE_PAGE_CONTENT_CLASS } from '@/lib/page-layout';

export type SettingsFloatingSaveBarProps = {
  children: React.ReactNode;
  className?: string;
  /** Optional data-tour anchor (e.g. business profile save). */
  tourAnchor?: string;
  align?: 'end' | 'between';
};

type Edges = { left: number; right: number };

/**
 * Lines the bar up with the page's <main> column, so on desktop it starts after the
 * sidebar and stops before the Schedule panel instead of running under both.
 * Sticky positioning would not work here: the app shell's `overflow-x-hidden`
 * wrappers become the scroll container for sticky children.
 */
function useMainColumnEdges(anchor: React.RefObject<HTMLElement>): Edges | null {
  const [edges, setEdges] = useState<Edges | null>(null);

  useLayoutEffect(() => {
    const main = anchor.current?.closest('main');
    if (!main) return;
    const measure = () => {
      const rect = main.getBoundingClientRect();
      const next = {
        left: Math.max(0, Math.round(rect.left)),
        right: Math.max(0, Math.round(window.innerWidth - rect.right)),
      };
      setEdges((prev) => (prev && prev.left === next.left && prev.right === next.right ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [anchor]);

  return edges;
}

/**
 * Fixed save/action bar for settings forms. Sits above the mobile bottom nav (bottom-16)
 * and at the bottom of the main column on desktop.
 */
export function SettingsFloatingSaveBar({
  children,
  className,
  tourAnchor,
  align = 'end',
}: SettingsFloatingSaveBarProps) {
  const spacerRef = useRef<HTMLDivElement>(null);
  const edges = useMainColumnEdges(spacerRef);

  return (
    <>
      <div ref={spacerRef} className="h-14 shrink-0 lg:h-[52px]" aria-hidden />
      <div
        data-tour={tourAnchor}
        style={edges ? { left: edges.left, right: edges.right } : undefined}
        className={clsx(
          'floating-action-button fixed inset-x-0 z-40',
          'bottom-16 lg:bottom-0',
          'border-t border-border bg-background/95 backdrop-blur-sm',
          'shadow-[0_-4px_12px_rgba(0,0,0,0.06)]',
          'lg:pb-[max(8px,env(safe-area-inset-bottom))]',
          className,
        )}
      >
        <div
          className={clsx(
            WIDE_PAGE_CONTENT_CLASS,
            'mx-auto flex flex-wrap items-center gap-2 px-4 py-1.5 sm:gap-3 sm:px-6 sm:py-2',
            align === 'end' && 'justify-end',
            align === 'between' && 'justify-between',
          )}
        >
          {children}
        </div>
      </div>
    </>
  );
}
