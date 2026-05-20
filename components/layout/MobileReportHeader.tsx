'use client';

import React from 'react';
import { clsx } from 'clsx';

type MobileReportHeaderProps = {
  /** Visible on md+ only; mobile title lives in TopBar */
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
};

/**
 * Report / read-only pages: one visible title on desktop; mobile uses TopBar + actions row.
 */
export function MobileReportHeader({ title, subtitle, actions, className }: MobileReportHeaderProps) {
  return (
    <div className={clsx('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        <h1 className="list-page-h1">{title}</h1>
        {subtitle ? (
          <p className="text-sm text-text-secondary mt-1 hidden md:block">{subtitle}</p>
        ) : null}
        {subtitle ? (
          <p className="text-xs text-text-muted mt-0.5 md:hidden">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 no-print shrink-0">{actions}</div>
      ) : null}
    </div>
  );
}
