'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { Card } from '@/components/ui/Card';

export function SectionCard({
  id,
  icon: Icon,
  title,
  description,
  appliesImmediately,
  actions,
  children,
  className,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Section saves on its own actions rather than through the page save bar. */
  appliesImmediately?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} data-agent-section={id} className={clsx('scroll-mt-28', className)}>
      <Card padding="lg">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
                {appliesImmediately && (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                    Changes apply immediately
                  </span>
                )}
              </div>
              {description && <p className="mt-0.5 text-sm text-text-secondary">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {children}
      </Card>
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
