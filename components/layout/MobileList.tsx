'use client';

import Link from 'next/link';
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

const rowClass =
  'flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-50 dark:active:bg-slate-800/60';

export function MobileListSection({
  title,
  children,
  id,
  open = true,
  onToggle,
}: {
  title: string;
  children: ReactNode;
  id?: string;
  /** When set, the heading collapses the rows. Omitted headings stay open. */
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <section id={id} className="scroll-mt-4">
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-h-11 w-full items-center justify-between gap-3 bg-slate-50 px-4 py-2 text-left dark:bg-slate-900/40"
        >
          <span className="text-xs font-medium text-text-secondary">{title}</span>
          <ChevronDown className={clsx('h-4 w-4 shrink-0 text-text-muted transition-transform', open ? 'rotate-0' : '-rotate-90')} />
        </button>
      ) : (
        <h2 className="px-4 pb-1 pt-4 text-xs font-medium text-text-secondary">{title}</h2>
      )}
      {open ? <div className="divide-y divide-border border-y border-border bg-surface">{children}</div> : null}
    </section>
  );
}

type MobileListRowProps = {
  label: string;
  hint?: string;
  icon?: LucideIcon;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Extra controls rendered beside the row, not inside the link or main button. */
  actions?: ReactNode;
  locked?: boolean;
  href?: string;
  onClick?: () => void;
  className?: string;
};

export function MobileListRow({
  label,
  hint,
  icon: Icon,
  leading,
  trailing,
  actions,
  locked,
  href,
  onClick,
  className,
}: MobileListRowProps) {
  const inner = (
    <>
      {leading ?? (Icon ? <Icon className="h-5 w-5 shrink-0 text-primary-600" strokeWidth={1.75} /> : null)}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-text-primary">{label}</span>
          {locked ? <Lock className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-label="Locked" /> : null}
        </span>
        {hint ? <span className="mt-0.5 block truncate text-xs text-text-muted">{hint}</span> : null}
      </span>
      {trailing}
      {actions ? null : <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />}
    </>
  );

  const control = href ? (
    <Link href={href} className={clsx(rowClass, 'min-w-0 flex-1', className)}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={clsx(rowClass, 'min-w-0 flex-1', className)}>
      {inner}
    </button>
  );

  if (!actions) return control;

  const chevron = href ? (
    <Link href={href} tabIndex={-1} aria-hidden className="flex items-center pr-4 text-text-muted">
      <ChevronRight className="h-4 w-4" />
    </Link>
  ) : (
    <button type="button" tabIndex={-1} aria-hidden onClick={onClick} className="flex items-center pr-4 text-text-muted">
      <ChevronRight className="h-4 w-4" />
    </button>
  );

  return (
    <div className="flex items-stretch bg-surface">
      {control}
      <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
      {chevron}
    </div>
  );
}
