'use client';

import React from 'react';
import { clsx } from 'clsx';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label?: React.ReactNode;
  description?: React.ReactNode;
  id?: string;
  className?: string;
  'aria-label'?: string;
}

export function Switch({
  checked,
  onChange,
  disabled,
  size = 'md',
  label,
  description,
  id,
  className,
  'aria-label': ariaLabel,
}: SwitchProps) {
  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
  const knob = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  const shift = size === 'sm' ? 'translate-x-4' : 'translate-x-5';

  const control = (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        track,
        checked ? 'bg-primary-600' : 'bg-gray-300 dark:bg-slate-600',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'inline-block transform rounded-full bg-white shadow transition-transform',
          knob,
          checked ? shift : 'translate-x-0.5',
        )}
      />
    </button>
  );

  if (!label && !description) return <span className={className}>{control}</span>;

  return (
    <div className={clsx('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {label && <div className="text-sm font-medium text-text-primary">{label}</div>}
        {description && <p className="mt-0.5 text-xs text-text-secondary">{description}</p>}
      </div>
      {control}
    </div>
  );
}
