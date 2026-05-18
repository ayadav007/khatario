'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';

export interface CollapsibleTransactionSectionProps {
  title: string;
  count: number;
  defaultOpen?: boolean;
  /** Shown on the right of the header row (e.g. + New); clicks do not toggle the section */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function CollapsibleTransactionSection({
  title,
  count,
  defaultOpen = false,
  headerRight,
  children,
  className,
}: CollapsibleTransactionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={clsx(
        'border border-border dark:border-border-dark rounded-lg overflow-hidden bg-surface dark:bg-surface-dark',
        className
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-100/50 dark:hover:bg-slate-800/80 transition-colors"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="w-4 h-4 shrink-0 text-text-muted" aria-hidden />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0 text-text-muted" aria-hidden />
        )}
        <span className="font-semibold text-sm text-text-primary shrink-0">{title}</span>
        <span className="text-xs text-text-secondary tabular-nums ml-auto shrink-0">{count}</span>
        {headerRight ? (
          <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
            {headerRight}
          </span>
        ) : null}
      </button>
      {open ? <div className="border-t border-border dark:border-border-dark">{children}</div> : null}
    </div>
  );
}
