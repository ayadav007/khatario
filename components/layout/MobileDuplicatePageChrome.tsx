'use client';

import React from 'react';
import { ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import { hideMobileDuplicatePageChrome } from '@/lib/mobile-page-chrome';

type MobileDuplicatePageChromeProps = {
  title: React.ReactNode;
  /** Shown under the title on desktop; hidden on mobile when TopBar carries context. */
  description?: React.ReactNode;
  onBack?: () => void;
  trailing?: React.ReactNode;
  className?: string;
};

/**
 * Page-level mobile header (back + h1). Hidden below md — TopBar shows route context.
 * Desktop always shows the h1 (and optional description).
 */
export function MobileDuplicatePageChrome({
  title,
  description,
  onBack,
  trailing,
  className,
}: MobileDuplicatePageChromeProps) {
  const hideOnMobile = hideMobileDuplicatePageChrome();

  return (
    <div
      className={clsx(
        hideOnMobile ? 'hidden md:flex' : 'flex',
        description ? 'flex-col gap-1' : 'flex-row items-center justify-between gap-2',
        'w-full',
        className
      )}
    >
      <div
        className={clsx(
          'flex min-w-0 flex-1 items-center gap-2',
          description && 'w-full justify-between'
        )}
      >
        {!hideOnMobile && onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-full p-2 hover:bg-gray-100 md:hidden dark:hover:bg-slate-800"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : null}
        <h1
          className={clsx(
            'my-0 py-0 leading-tight text-text-primary',
            hideOnMobile ? 'list-page-h1' : 'text-xl font-bold md:text-2xl'
          )}
        >
          {title}
        </h1>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {description ? (
        <p className="text-sm text-text-secondary">{description}</p>
      ) : null}
    </div>
  );
}
