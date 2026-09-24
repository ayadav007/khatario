'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { sanitizeStoreTheme } from '@/lib/store/store-theme';
import type { StoreBusinessContext } from '@/lib/store/resolve-store';
import { storePhoneDigits } from '@/lib/store/store-phone';
import clsx from 'clsx';

export type StoreCustomerProfile = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
};

interface StorePhoneAuthProps {
  store: StoreBusinessContext;
  mode?: 'sheet' | 'page';
  open?: boolean;
  initialPhone?: string;
  initialName?: string;
  onVerified: (customer: StoreCustomerProfile) => void;
  onClose?: () => void;
}

export function StorePhoneAuth({
  store,
  mode = 'sheet',
  open = true,
  initialPhone = '',
  initialName = '',
  onVerified,
  onClose,
}: StorePhoneAuthProps) {
  const accent = sanitizeStoreTheme(store.store_theme).accent;
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState(storePhoneDigits(initialPhone));
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugOtp, setDebugOtp] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    setPhone(storePhoneDigits(initialPhone));
  }, [initialPhone]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const requestCode = useCallback(async () => {
    const mobile = storePhoneDigits(phone);
    if (mobile.length !== 10) {
      setError('Enter a 10-digit mobile number');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/store/${encodeURIComponent(store.store_subdomain)}/otp`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', phone: mobile }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not send code');
        return;
      }
      setDebugOtp(typeof data.debug_otp === 'string' ? data.debug_otp : null);
      setDigits(['', '', '', '', '', '']);
      setStep('code');
      setResendIn(30);
      setTimeout(() => inputs.current[0]?.focus(), 50);
    } finally {
      setBusy(false);
    }
  }, [phone, store.store_subdomain]);

  const verifyCode = useCallback(
    async (code: string) => {
      const mobile = storePhoneDigits(phone);
      if (code.length !== 6) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/public/store/${encodeURIComponent(store.store_subdomain)}/otp`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'verify',
            phone: mobile,
            code,
            name: initialName || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'Invalid or expired code');
          return;
        }
        onVerified(data.customer);
      } finally {
        setBusy(false);
      }
    },
    [initialName, onVerified, phone, store.store_subdomain],
  );

  const onDigit = (index: number, value: string) => {
    const v = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = v;
    setDigits(next);
    if (v && index < 5) inputs.current[index + 1]?.focus();
    const joined = next.join('');
    if (joined.length === 6) void verifyCode(joined);
  };

  const form = (
    <div className="space-y-4">
      {step === 'phone' ? (
        <>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Verify your number</h2>
            <p className="mt-1 text-sm text-gray-500">
              We send a code on WhatsApp so {store.name} can reach you about the order.
            </p>
          </div>
          <div className="flex overflow-hidden rounded-xl border border-gray-200">
            <span className="flex items-center bg-gray-50 px-3 text-sm font-medium text-gray-600">+91</span>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile"
              className="min-w-0 flex-1 px-3 py-3 text-base outline-none"
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Enter 6-digit code</h2>
            <p className="mt-1 text-sm text-gray-500">
              Sent to +91 {storePhoneDigits(phone)}.{' '}
              <button
                type="button"
                className="font-medium text-gray-900 underline"
                onClick={() => {
                  setStep('phone');
                  setError(null);
                }}
              >
                Change
              </button>
            </p>
          </div>
          <div className="flex justify-between gap-2">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                maxLength={1}
                value={d}
                onChange={(e) => onDigit(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !digits[i] && i > 0) {
                    inputs.current[i - 1]?.focus();
                  }
                }}
                className="h-12 w-10 rounded-lg border border-gray-200 text-center text-lg font-semibold focus:border-gray-400 focus:outline-none"
              />
            ))}
          </div>
          {debugOtp ? (
            <p className="text-xs text-amber-700">Dev code: {debugOtp}</p>
          ) : null}
          <button
            type="button"
            disabled={resendIn > 0 || busy}
            onClick={() => void requestCode()}
            className="text-sm text-gray-500 disabled:opacity-50"
          >
            {resendIn > 0 ? `Resend in 0:${String(resendIn).padStart(2, '0')}` : 'Resend code'}
          </button>
        </>
      )}
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {step === 'phone' ? (
        <button
          type="button"
          disabled={busy || storePhoneDigits(phone).length !== 10}
          onClick={() => void requestCode()}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white disabled:bg-gray-300"
          style={storePhoneDigits(phone).length === 10 ? { backgroundColor: accent } : undefined}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Send code
        </button>
      ) : (
        <button
          type="button"
          disabled={busy || digits.join('').length !== 6}
          onClick={() => void verifyCode(digits.join(''))}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white disabled:bg-gray-300"
          style={digits.join('').length === 6 ? { backgroundColor: accent } : undefined}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Verify
        </button>
      )}
    </div>
  );

  if (mode === 'page') {
    if (!open) return null;
    return <div className="mx-auto max-w-sm">{form}</div>;
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-2xl">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className={clsx('mb-3 flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100')}
            aria-label="Close"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : null}
        {form}
      </div>
    </div>
  );
}
