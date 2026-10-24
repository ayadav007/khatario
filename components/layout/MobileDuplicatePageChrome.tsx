'use client';

import React from 'react';
import { ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import { hideMobileDuplicatePageChrome } from '@/lib/mobile-page-chrome';
import { PageHeader } from '@/components/layout/PageHeader';

type MobileDuplicatePageChromeProps = {
  title: React.ReactNode;
  /** Shown under the title. */
  description?: React.ReactNode;
  onBack?: () => void;
  trailing?: React.ReactNode;
  className?: string;
};

/**
 * Composer and detail pages. The mobile TopBar already shows the route title,
 * so this header is desktop-only while that flag is on. Layout matches PageHeader.
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
    <div className={clsx(hideOnMobile && 'hidden md:block', 'w-full min-w-0', className)}>
      <PageHeader
        title={
          <>
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="mr-2 inline-flex min-h-10 min-w-10 items-center justify-center rounded-full align-middle hover:bg-gray-100 md:hidden dark:hover:bg-slate-800"
                aria-label="Go back"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            ) : null}
            {title}
          </>
        }
        subtitle={description}
        actions={trailing}
      />
    </div>
  );
}
