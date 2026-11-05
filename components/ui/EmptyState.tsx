'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

type EmptyStateProps = {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  /** Usually one primary <Button>. */
  action?: ReactNode;
  className?: string;
};

/** Shown when a list has no rows yet: icon, one line saying what is missing, and how to add the first one. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={clsx('flex flex-col items-center px-4 py-10 text-center', className)}>
      {Icon ? (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-slate-800">
          <Icon className="h-6 w-6 text-text-muted" aria-hidden />
        </div>
      ) : null}
      <p className="text-base font-semibold text-text-primary">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-text-secondary">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
