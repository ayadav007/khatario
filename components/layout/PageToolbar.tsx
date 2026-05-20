'use client';

import React from 'react';
import { clsx } from 'clsx';

type PageToolbarProps = {
  children: React.ReactNode;
  className?: string;
};

/** Horizontal filter / chip row — shared styling across list modules. */
export function PageToolbar({ children, className }: PageToolbarProps) {
  return (
    <div
      className={clsx(
        'flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none -mx-0.5',
        className
      )}
    >
      {children}
    </div>
  );
}

type PageToolbarChipProps = {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
};

export function PageToolbarChip({
  active,
  onClick,
  children,
  className,
  type = 'button',
  disabled,
}: PageToolbarChipProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors touch-manipulation',
        active
          ? 'border-primary-600 bg-primary-600 text-white'
          : 'border-border bg-surface text-text-secondary hover:bg-slate-50 dark:hover:bg-slate-800',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {children}
    </button>
  );
}
