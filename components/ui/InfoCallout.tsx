'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

export type InfoCalloutTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const TONE_CLASS: Record<InfoCalloutTone, { box: string; icon: string }> = {
  info: {
    box: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800/60 dark:bg-blue-950/30 dark:text-blue-100',
    icon: 'text-blue-600 dark:text-blue-300',
  },
  success: {
    box: 'border-green-200 bg-green-50 text-green-900 dark:border-green-800/60 dark:bg-green-950/30 dark:text-green-100',
    icon: 'text-green-600 dark:text-green-300',
  },
  warning: {
    box: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100',
    icon: 'text-amber-600 dark:text-amber-300',
  },
  danger: {
    box: 'border-red-200 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-100',
    icon: 'text-red-600 dark:text-red-300',
  },
  neutral: {
    box: 'border-border bg-gray-50 text-text-primary dark:bg-slate-800/50',
    icon: 'text-text-secondary',
  },
};

type InfoCalloutProps = {
  tone?: InfoCalloutTone;
  icon?: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/** Tinted note inside a settings page: what a setting does, a warning, a success message. */
export function InfoCallout({ tone = 'info', icon: Icon, title, children, className }: InfoCalloutProps) {
  const t = TONE_CLASS[tone];
  return (
    <div className={clsx('flex items-start gap-3 rounded-lg border p-4 text-sm', t.box, className)}>
      {Icon ? <Icon className={clsx('mt-0.5 h-5 w-5 shrink-0', t.icon)} aria-hidden /> : null}
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="leading-relaxed opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
