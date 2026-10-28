'use client';

import React from 'react';
import { clsx } from 'clsx';
import { ChevronDown, Lock } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';

/** A row of mutually exclusive options (density, orientation, zoom). */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  size = 'md',
  'aria-label': ariaLabel,
}: {
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  'aria-label'?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={clsx(
        'inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-slate-700 dark:bg-slate-800',
        disabled && 'opacity-50',
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={clsx(
              'rounded-md font-medium transition-colors disabled:cursor-not-allowed',
              size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-[13px]',
              on
                ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200 dark:bg-slate-700 dark:text-white dark:ring-slate-600'
                : 'text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A labelled switch on one line, the designer's basic control. */
export function SwitchRow({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-[13px] text-gray-800 dark:text-slate-200">{label}</div>
        {hint && <div className="text-xs text-gray-500 dark:text-slate-400">{hint}</div>}
      </div>
      <Switch size="sm" checked={checked} onChange={onChange} aria-label={label} />
    </div>
  );
}

/** A labelled control row: label on the left, control on the right. */
export function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[13px] text-gray-800 dark:text-slate-200">{label}</span>
      {children}
    </div>
  );
}

export function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-3 text-xs font-medium text-gray-500 first:mt-0 dark:text-slate-400">{children}</div>
  );
}

/** One collapsible section of the left rail, with a summary when closed. */
export function DesignerSectionPanel({
  id,
  title,
  summary,
  open,
  onToggle,
  locked,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  /** Paid section on a free plan: shows a lock next to the title. */
  locked?: boolean;
  children: React.ReactNode;
}) {
  const bodyId = `designer-section-${id}`;
  return (
    <section id={`designer-panel-${id}`} className="scroll-mt-2 border-b border-gray-200 dark:border-slate-700">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2 px-5 py-3.5 text-left hover:bg-gray-50 dark:hover:bg-slate-800/60"
      >
        <span className="flex-1 text-sm font-medium text-gray-900 dark:text-white">{title}</span>
        {locked && <Lock className="h-3.5 w-3.5 text-gray-400" aria-label="Paid plan" />}
        {!open && summary && <span className="truncate text-xs text-gray-500 dark:text-slate-400">{summary}</span>}
        <ChevronDown
          aria-hidden
          className={clsx('h-4 w-4 shrink-0 text-gray-400 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div id={bodyId} className="px-5 pb-5">
          {children}
        </div>
      )}
    </section>
  );
}

/** Shown in place of a paid control on a free plan. */
export function UpgradeNote({ what, onUpgrade }: { what: string; onUpgrade: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 dark:border-slate-600">
      <span className="text-xs text-gray-600 dark:text-slate-300">{what} is on paid plans.</span>
      <button type="button" onClick={onUpgrade} className="text-xs font-medium text-primary-600 hover:underline dark:text-primary-300">
        Upgrade
      </button>
    </div>
  );
}

/** Colour well plus hex text, for the "Custom colours" disclosure. */
export function HexColourInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <ControlRow label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour`}
          className="h-7 w-7 cursor-pointer rounded-md border border-gray-200 bg-transparent p-0.5 dark:border-slate-600"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} hex code`}
          className="w-24 rounded-md border border-gray-200 bg-white px-2 py-1 font-mono text-xs text-gray-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        />
      </div>
    </ControlRow>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  maxLength,
  rows = 3,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength: number;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block py-1.5">
      <span className="mb-1 flex justify-between text-[13px] text-gray-800 dark:text-slate-200">
        {label}
        <span className={clsx('text-xs', value.length > maxLength * 0.9 ? 'text-amber-600' : 'text-gray-400')}>
          {value.length}/{maxLength}
        </span>
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
      />
    </label>
  );
}
