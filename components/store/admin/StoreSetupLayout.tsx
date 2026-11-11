'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Building blocks for the Store setup tab: a titled group card, rows with the label and hint on
 * the left and the control on the right, an on/off switch, and an input with a unit inside it.
 */
export function SetupGroup({
  icon: Icon,
  title,
  meta,
  action,
  children,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white" data-testid={testId}>
      <header className="flex items-center gap-2.5 border-b border-gray-100 px-5 py-3.5">
        <Icon className="h-4 w-4 flex-shrink-0 text-gray-500" aria-hidden />
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {meta ? <div className="ml-auto text-xs text-gray-500">{meta}</div> : null}
        {action ? <div className={clsx(!meta && 'ml-auto')}>{action}</div> : null}
      </header>
      <div className="divide-y divide-gray-100">{children}</div>
    </section>
  );
}

export function SetupRow({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="grid gap-2 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_240px] sm:items-center sm:gap-6">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-900">
          {label}
        </label>
        {hint ? <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{hint}</p> : null}
      </div>
      <div className="flex min-w-0 items-center sm:justify-end">{children}</div>
    </div>
  );
}

/** A full-width block inside a group, for content that doesn't fit the label/control row. */
export function SetupBlock({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <div className={clsx('px-5 py-4', muted && 'bg-gray-50')}>{children}</div>;
}

export function SetupSwitch({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={clsx(
        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        on ? 'bg-green-500' : 'bg-gray-200',
      )}
    >
      <span
        className={clsx(
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

/** Number or text input with a unit (₹, days, %) drawn inside the box, before or after the value. */
export function AffixInput({
  id,
  value,
  onChange,
  prefix,
  suffix,
  type = 'number',
  min,
  max,
  placeholder,
  className,
}: {
  id?: string;
  value: string | number;
  onChange: (value: string) => void;
  prefix?: string;
  suffix?: string;
  type?: 'number' | 'text';
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'flex h-10 w-full items-stretch overflow-hidden rounded-lg border border-gray-200 bg-white focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500',
        className,
      )}
    >
      {prefix ? (
        <span className="flex items-center border-r border-gray-200 bg-gray-50 px-3 text-sm text-gray-500">{prefix}</span>
      ) : null}
      <input
        id={id}
        type={type}
        min={min}
        max={max}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-gray-900 focus:outline-none focus:ring-0"
      />
      {suffix ? (
        <span className="flex items-center border-l border-gray-200 bg-gray-50 px-3 text-sm text-gray-500">{suffix}</span>
      ) : null}
    </div>
  );
}

export const setupSelectClass =
  'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
