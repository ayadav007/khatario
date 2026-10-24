'use client';

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';

export const inputCls =
  'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-text-primary outline-none transition placeholder:text-text-muted hover:border-slate-300 focus:border-primary-500 focus:ring-4 focus:ring-primary-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-text-muted dark:focus:ring-primary-900/40 dark:disabled:bg-slate-800/60';

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={clsx(
        'inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-slate-300 bg-white px-1 font-mono text-[10px] font-semibold leading-none text-slate-500 shadow-[0_1px_0_rgba(15,23,42,0.08)] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
        className
      )}
    >
      {children}
    </kbd>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{children}</span>;
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx('block min-w-0', className)}>
      <span className="mb-1 block text-xs font-medium text-text-secondary">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-text-muted">{hint}</span> : null}
    </label>
  );
}

export function HeaderButton({
  icon: Icon,
  label,
  kbd,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  kbd?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-surface px-2 text-xs font-medium text-text-secondary transition hover:border-primary-300 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {kbd && <Kbd className="h-4 min-w-[16px] text-[9px]">{kbd}</Kbd>}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-5 w-9 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600'
      )}
    >
      <span
        className={clsx(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
          checked ? 'left-[18px]' : 'left-0.5'
        )}
      />
    </button>
  );
}

/**
 * Text input for numbers that keeps the typed string while focused, so values like "12." or "0.0"
 * are not reformatted mid-typing.
 */
export function NumberInput({
  value,
  onValue,
  className,
  disabled,
  placeholder,
  inputRef,
  blankZero,
  ...rest
}: {
  value: number;
  onValue: (n: number) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  blankZero?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const format = (n: number) => (blankZero && !n ? '' : formatNumber(n));
  const [text, setText] = useState(() => format(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        setText(format(value));
        rest.onBlur?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.]/g, '');
        setText(raw);
        const n = Number(raw);
        onValue(Number.isFinite(n) ? n : 0);
      }}
      className={className}
    />
  );
}

function formatNumber(n: number) {
  if (!Number.isFinite(n) || n === 0) return n === 0 ? '0' : '';
  return String(Math.round(n * 10000) / 10000);
}

export const inr = (n: number, digits = 2) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const fx = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0);
  } catch {
    return `${currency} ${Number(n || 0).toFixed(2)}`;
  }
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

export const isTypingTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

export const fmtDate = (iso: string) => {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const addDaysIso = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const daysBetween = (fromIso: string, toIso: string) => {
  const a = new Date(`${fromIso}T12:00:00`).getTime();
  const b = new Date(`${toIso}T12:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
};

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28, 40];

export const PAYMENT_MODES: { id: string; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'Card' },
  { id: 'bank', label: 'Bank' },
  { id: 'cheque', label: 'Cheque' },
];

export const PAYMENT_TERMS = [
  { days: 0, label: 'Due now' },
  { days: 15, label: '15 days' },
  { days: 30, label: '30 days' },
  { days: 45, label: '45 days' },
];
