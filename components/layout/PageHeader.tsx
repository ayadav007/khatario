'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export type PageHeaderProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: LucideIcon;
  /** Heading level. Page titles use h1. */
  as?: 'h1' | 'h2';
  id?: string;
  tourAnchor?: string;
  className?: string;
  actionsClassName?: string;
};

/**
 * Page title, subtitle, and actions.
 * Below md: title and subtitle stack above a wrapping action row.
 * More than two actions collapse the rest into a More menu.
 * From md: title block and actions sit on one row.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  icon: Icon,
  as: Tag = 'h1',
  id,
  tourAnchor,
  className,
  actionsClassName,
}: PageHeaderProps) {
  return (
    <div
      id={id}
      data-tour={tourAnchor}
      className={clsx(
        'flex w-full min-w-0 max-w-full flex-col gap-3 md:flex-row md:items-start md:justify-between',
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {Icon ? (
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-slate-800">
            <Icon className="h-5 w-5 text-text-secondary" aria-hidden />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <Tag className="text-2xl font-semibold text-text-primary">{title}</Tag>
          {subtitle ? (
            <p className="mt-1 line-clamp-2 text-sm text-text-secondary">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actions != null ? (
        <HeaderActions className={actionsClassName}>{actions}</HeaderActions>
      ) : null}
    </div>
  );
}

function unwrapActionRow(children: React.ReactNode): React.ReactNode[] {
  const items = React.Children.toArray(children).filter((child) => child != null && child !== false);
  if (items.length !== 1 || !React.isValidElement(items[0]) || items[0].type !== 'div') return items;
  const className = String((items[0].props as { className?: string }).className || '');
  if (!/\bflex\b/.test(className) || !/\bgap-/.test(className)) return items;
  return unwrapActionRow((items[0].props as { children?: React.ReactNode }).children);
}

function HeaderActions({ children, className }: { children: React.ReactNode; className?: string }) {
  const items = unwrapActionRow(children);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  const visible = items.length > 2 ? items.slice(0, 2) : items;
  const overflow = items.length > 2 ? items.slice(2) : [];

  return (
    <div className={clsx('flex min-w-0 max-w-full flex-wrap items-center gap-2 md:shrink-0 md:justify-end', className)}>
      {visible}
      {overflow.length > 0 ? (
        <div ref={rootRef} className="relative">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={open}
            aria-haspopup="menu"
            aria-controls={menuId}
            onClick={() => setOpen((current) => !current)}
          >
            More
          </Button>
          {open ? (
            <div
              id={menuId}
              role="menu"
              className="absolute right-0 z-30 mt-1 flex w-max max-w-full min-w-[10rem] flex-col gap-2 rounded-lg border border-border bg-surface p-2 shadow-medium"
            >
              {overflow}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
