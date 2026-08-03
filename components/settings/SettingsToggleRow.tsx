'use client';

import type { ReactNode } from 'react';
import { clsx } from 'clsx';

type SettingsToggleRowProps = {
  title: string;
  description: ReactNode;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  id?: string;
  className?: string;
};

/** Standard toggle row inside settings cards (Business Profile feature flags, etc.). */
export function SettingsToggleRow({
  title,
  description,
  checked,
  onToggle,
  disabled = false,
  id,
  className,
}: SettingsToggleRowProps) {
  return (
    <div
      className={clsx(
        'flex items-center justify-between gap-4 rounded-lg border border-border bg-gray-50 p-4 dark:bg-slate-800/50',
        className
      )}
      id={id}
    >
      <div className="min-w-0 flex-1">
        <h4 className="type-label mb-1 text-text-primary">{title}</h4>
        <div className="type-body-sm text-text-secondary">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id ? `${id}-label` : undefined}
        onClick={onToggle}
        disabled={disabled}
        className={clsx(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
          checked ? 'bg-primary-600' : 'bg-gray-200 dark:bg-slate-600',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <span
          className={clsx(
            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
            checked ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </button>
    </div>
  );
}
