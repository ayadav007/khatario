'use client';

import React from 'react';
import { clsx } from 'clsx';
import { WIDE_PAGE_CONTENT_CLASS } from '@/lib/page-layout';

export type SettingsFloatingSaveBarProps = {
  children: React.ReactNode;
  className?: string;
  /** Optional data-tour anchor (e.g. business profile save). */
  tourAnchor?: string;
  align?: 'end' | 'between';
};

/**
 * Fixed save/action bar for settings forms. Sits above the mobile bottom nav (bottom-16)
 * and flush to the viewport on desktop.
 */
export function SettingsFloatingSaveBar({
  children,
  className,
  tourAnchor,
  align = 'end',
}: SettingsFloatingSaveBarProps) {
  return (
    <>
      <div className="h-14 shrink-0 lg:h-[52px]" aria-hidden />
      <div
        data-tour={tourAnchor}
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
