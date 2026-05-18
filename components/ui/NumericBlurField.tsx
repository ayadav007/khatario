'use client';

import React, { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { round2, roundRetailQty, roundExclusiveUnitPrice } from '@/lib/numeric-precision';

export type NumericBlurMode = 'money' | 'qty' | 'rate' | 'percent';

export function blurNumericDisplay(value: number, mode: NumericBlurMode): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (mode === 'money' || mode === 'percent') {
    if (abs < 1e-12) return '';
    return String(round2(value));
  }
  if (mode === 'qty') {
    if (value <= 0) return '';
    return String(roundRetailQty(value));
  }
  if (abs < 1e-12) return '';
  return String(roundExclusiveUnitPrice(value));
}

export function parseNumericBlur(raw: string, mode: NumericBlurMode, emptyFallback: number): number {
  const t = raw.trim().replace(/,/g, '');
  if (
    t === '' ||
    t === '-' ||
    t === '+' ||
    t === '.' ||
    t === '-.' ||
    t === '+.'
  ) {
    return emptyFallback;
  }
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return emptyFallback;
  switch (mode) {
    case 'money':
      return round2(n);
    case 'qty':
      return roundRetailQty(n);
    case 'rate':
      return roundExclusiveUnitPrice(n);
    case 'percent':
      return round2(n);
    default:
      return emptyFallback;
  }
}

export interface NumericBlurFieldProps {
  label: string;
  id?: string;
  value: number;
  mode: NumericBlurMode;
  onCommit: (n: number) => void;
  emptyFallback?: number;
  variant?: 'underline' | 'boxed';
  /** Tighter label + input (e.g. mobile purchase line cards). Ignored when variant is boxed. */
  compact?: boolean;
  className?: string;
  inputClassName?: string;
  nativeInputProps?: Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    | 'value'
    | 'defaultValue'
    | 'onChange'
    | 'onBlur'
    | 'onFocus'
    | 'type'
    | 'inputMode'
    | 'autoComplete'
  > &
    Record<string, string | number | undefined>;
}

export function NumericBlurField({
  label,
  id,
  value,
  mode,
  onCommit,
  emptyFallback,
  variant = 'underline',
  compact = false,
  className,
  inputClassName,
  nativeInputProps,
}: NumericBlurFieldProps) {
  const { className: nativeInputClassName, ...nativeRest } = nativeInputProps ?? {};
  const fb = emptyFallback !== undefined ? emptyFallback : mode === 'qty' ? 1 : 0;
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(() => blurNumericDisplay(value, mode));

  useEffect(() => {
    if (!focused) setText(blurNumericDisplay(value, mode));
  }, [value, focused, mode]);

  const commit = () => {
    let n = parseNumericBlur(text, mode, fb);
    if (mode === 'qty') n = Math.max(1, n);
    onCommit(n);
  };

  const underlineLabel = compact
    ? 'text-[10px] font-semibold uppercase tracking-wide text-text-secondary'
    : 'text-[11px] font-semibold uppercase tracking-wide text-text-secondary';
  const boxedLabel = 'block text-sm font-medium text-text-primary mb-1.5';

  const underlineInput = compact
    ? 'focus-primary w-full min-w-0 border-0 border-b border-border bg-transparent pb-1.5 text-[14px] font-medium text-text-primary shadow-none outline-none placeholder:text-text-muted ring-0 focus-visible:border-border'
    : 'focus-primary w-full border-0 border-b border-border bg-transparent pb-2 text-[15px] font-medium text-text-primary shadow-none outline-none placeholder:text-text-muted ring-0 focus-visible:border-border';

  return (
    <div
      className={clsx(
        variant === 'boxed' ? 'w-full' : compact ? 'space-y-0.5' : 'space-y-1',
        className,
      )}
    >
      <label htmlFor={id} className={variant === 'boxed' ? boxedLabel : underlineLabel}>
        {label}
      </label>
      <input
        {...nativeRest}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        className={clsx(
          variant === 'boxed' ? 'input' : underlineInput,
          nativeInputClassName,
          inputClassName,
        )}
      />
    </div>
  );
}
