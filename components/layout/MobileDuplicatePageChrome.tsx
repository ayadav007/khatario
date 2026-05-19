'use client';

import React from 'react';
import { ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import { hideMobileDuplicatePageChrome } from '@/lib/mobile-page-chrome';

type MobileDuplicatePageChromeProps = {
  title: React.ReactNode;
  onBack?: () => void;
  trailing?: React.ReactNode;
  className?: string;
};

/**
 * Page-level mobile header (back + h1). Hidden in production below md — TopBar shows context.
 * Desktop always shows the h1.
 */
export function MobileDuplicatePageChrome({
  title,
  onBack,
  trailing,
  className,
}: MobileDuplicatePageChromeProps) {
  const hideOnMobile = hideMobileDuplicatePageChrome();

  return (
    <div className={clsx('flex items-center justify-between gap-2', className)}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
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
            'my-0 py-0 text-xl font-bold leading-tight text-text-primary md:text-2xl',
            hideOnMobile && 'hidden md:block'
          )}
        >
          {title}
        </h1>
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
