'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { clsx } from 'clsx';
import {
  PHONE_DIAL_CODE_OPTIONS,
  splitStoredPhoneForInput,
  toWhatsAppStyleDigits,
} from '@/lib/utils/phone';

export type IntlPhoneInputProps = {
  label?: string;
  /** Full international digits only (e.g. 917769870606), no + */
  value: string;
  onChange: (fullDigits: string) => void;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Placeholder for the national number field */
  nationalPlaceholder?: string;
  /** Fired when focus leaves the country selector and national field (both). */
  onBlur?: () => void;
};

/**
 * Country code dropdown + national number. Persists as concatenated digits (WhatsApp-style).
 */
export function IntlPhoneInput({
  label = 'Phone',
  value,
  onChange,
  error,
  helperText,
  disabled,
  required,
  className,
  nationalPlaceholder = 'Mobile number',
  onBlur,
}: IntlPhoneInputProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [{ dialCode, nationalNumber }, setParts] = useState(() => splitStoredPhoneForInput(value));

  useEffect(() => {
    setParts(splitStoredPhoneForInput(value));
  }, [value]);

  const emit = (dial: string, national: string) => {
    const full = toWhatsAppStyleDigits(dial, national);
    onChange(full);
  };

  const handleDialChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    setParts((p) => ({ ...p, dialCode: next }));
    emit(next, nationalNumber);
  };

  const handleNationalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const d = dialCode.replace(/\D/g, '');
    const maxNational = Math.max(0, 15 - d.length);
    const raw = e.target.value.replace(/\D/g, '').slice(0, maxNational);
    setParts((p) => ({ ...p, nationalNumber: raw }));
    emit(dialCode, raw);
  };

  const emitControlBlur = () => {
    if (!onBlur) return;
    requestAnimationFrame(() => {
      const el = document.activeElement;
      if (el && rootRef.current?.contains(el)) return;
      onBlur();
    });
  };

  return (
    <div ref={rootRef} className={clsx('w-full', className)}>
      {label ? (
        <div className="mb-1.5 flex items-center gap-1.5">
          <label className="block text-sm font-medium text-text-primary">
            {label}
            {required ? ' *' : ''}
          </label>
          <span
            className="inline-flex text-text-muted"
            title="Saved as full international number without + or spaces (e.g. 917769870606), same format WhatsApp uses."
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
          </span>
        </div>
      ) : null}
      <div
        className={clsx(
          'flex overflow-hidden rounded-md border bg-surface transition-shadow',
          error ? 'border-error ring-1 ring-error' : 'border-border',
          !disabled && 'focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500/30',
          disabled && 'opacity-60'
        )}
      >
        <select
          value={dialCode}
          onChange={handleDialChange}
          onBlur={emitControlBlur}
          disabled={disabled}
          className="w-[5.75rem] flex-shrink-0 border-0 border-r border-border bg-surface py-2 pl-2 pr-1 text-sm text-text-primary focus:outline-none disabled:cursor-not-allowed sm:w-[6.25rem]"
          aria-label="Country calling code"
        >
          {PHONE_DIAL_CODE_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              +{o.code}
            </option>
          ))}
        </select>
        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={nationalNumber}
          onChange={handleNationalChange}
          onBlur={emitControlBlur}
          disabled={disabled}
          placeholder={nationalPlaceholder}
          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none disabled:cursor-not-allowed"
        />
      </div>
      {error ? <p className="mt-1.5 text-sm text-error">{error}</p> : null}
      {!error && helperText ? (
        <p className="mt-1.5 text-sm text-text-secondary">{helperText}</p>
      ) : null}
    </div>
  );
}
