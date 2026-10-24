'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

/** Annotated settings row, same layout as Business profile: explanation left, card right. */
export function SectionCard({
  id,
  title,
  description,
  appliesImmediately,
  actions,
  children,
  className,
}: {
  id: string;
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Section saves on its own actions rather than through the page save bar. */
  appliesImmediately?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      data-agent-section={id}
      className={clsx(
        'scroll-mt-28 grid grid-cols-1 gap-3 border-t border-border pt-6 first:border-t-0 first:pt-0 dark:border-border-dark lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-10',
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        {description && <p className="mt-1 text-sm leading-relaxed text-text-secondary">{description}</p>}
        {appliesImmediately && (
          <span className="mt-2 inline-block rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
            Has its own Save button
          </span>
        )}
      </div>
      <div className="card min-w-0 p-4 md:p-5">
        {actions && <div className="mb-4 flex flex-wrap items-center justify-end gap-2">{actions}</div>}
        {children}
      </div>
    </section>
  );
}

export function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-1.5">
      <label className="block text-sm font-medium text-text-primary">{children}</label>
      {hint && <p className="mt-0.5 text-xs text-text-secondary">{hint}</p>}
    </div>
  );
}

export function CharCount({ value, max }: { value: string; max: number }) {
  return (
    <p className={clsx('mt-1 text-right text-xs', value.length > max ? 'text-error' : 'text-text-muted')}>
      {value.length} / {max}
    </p>
  );
}
