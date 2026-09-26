'use client';

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

function formatCountdown(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}s`;
}

function displayPhone(phone: string) {
  const d = phone.replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return phone;
  return `+91 ${d}`;
}

export function PublicWhatsAppOtp({
  purpose,
  phone,
  verified,
  onVerified,
  autoSend = false,
  onCancel,
}: {
  purpose: 'signup' | 'demo_booking';
  phone: string;
  verified: boolean;
  onVerified: (ok: boolean) => void;
  autoSend?: boolean;
  onCancel?: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array(OTP_LENGTH).fill(''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [debugOtp, setDebugOtp] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const autoSentKey = useRef('');
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const code = digits.join('');

  useEffect(() => {
    setDigits(Array(OTP_LENGTH).fill(''));
    setError('');
    setDebugOtp('');
    setResendIn(0);
    autoSentKey.current = '';
    onVerified(false);
    // Reset when the number changes; parent should pass a stable setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, purpose]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setInterval(() => {
      setResendIn((n) => (n <= 1 ? 0 : n - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendIn]);

  const send = useCallback(async () => {
    setBusy(true);
    setError('');
    setDebugOtp('');
    try {
      const res = await fetch('/api/public/platform-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', purpose, phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send code');
      setResendIn(RESEND_SECONDS);
      if (data.debugOtp) setDebugOtp(String(data.debugOtp));
      window.setTimeout(() => inputsRef.current[0]?.focus(), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code');
    } finally {
      setBusy(false);
    }
  }, [purpose, phone]);

  useEffect(() => {
    if (!autoSend || verified) return;
    const ten = phone.replace(/\D/g, '').slice(-10);
    if (ten.length !== 10) return;
    const key = `${purpose}:${ten}`;
    if (autoSentKey.current === key) return;
    autoSentKey.current = key;
    void send();
  }, [autoSend, phone, purpose, send, verified]);

  const verify = async (value = code) => {
    if (value.length !== OTP_LENGTH || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/public/platform-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', purpose, phone, code: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid code');
      onVerified(true);
    } catch (err) {
      onVerified(false);
      setError(err instanceof Error ? err.message : 'Invalid code');
      setDigits(Array(OTP_LENGTH).fill(''));
      window.setTimeout(() => inputsRef.current[0]?.focus(), 50);
    } finally {
      setBusy(false);
    }
  };

  const applyDigits = (next: string[]) => {
    const clipped = next.slice(0, OTP_LENGTH);
    while (clipped.length < OTP_LENGTH) clipped.push('');
    setDigits(clipped);
  };

  const onBoxChange = (index: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    if (!cleaned) {
      applyDigits(digits.map((d, i) => (i === index ? '' : d)));
      return;
    }
    if (cleaned.length > 1) {
      const chars = cleaned.slice(0, OTP_LENGTH).split('');
      const next = [...digits];
      chars.forEach((ch, offset) => {
        if (index + offset < OTP_LENGTH) next[index + offset] = ch;
      });
      applyDigits(next);
      const focusAt = Math.min(index + chars.length, OTP_LENGTH - 1);
      inputsRef.current[focusAt]?.focus();
      return;
    }
    const next = [...digits];
    next[index] = cleaned;
    applyDigits(next);
    if (index < OTP_LENGTH - 1) inputsRef.current[index + 1]?.focus();
  };

  const onBoxKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      e.preventDefault();
      const next = [...digits];
      next[index - 1] = '';
      applyDigits(next);
      inputsRef.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      inputsRef.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
      e.preventDefault();
      inputsRef.current[index + 1]?.focus();
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void verify();
    }
  };

  const onBoxPaste = (index: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pasted) return;
    const next = [...digits];
    pasted.split('').forEach((ch, offset) => {
      if (index + offset < OTP_LENGTH) next[index + offset] = ch;
    });
    applyDigits(next);
    inputsRef.current[Math.min(index + pasted.length, OTP_LENGTH - 1)]?.focus();
  };

  const ten = phone.replace(/\D/g, '').slice(-10);
  if (ten.length !== 10) {
    return (
      <p className="mt-2 text-sm text-slate-500">Enter a 10-digit mobile number to receive a WhatsApp code.</p>
    );
  }

  if (verified) {
    return (
      <p className="text-center text-sm font-semibold text-green-700 dark:text-green-400">
        Number verified.
      </p>
    );
  }

  const canResend = !busy && resendIn === 0;

  return (
    <div className="mx-auto w-full max-w-[420px] rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-lg dark:border-slate-700 dark:bg-slate-900 sm:px-8 sm:py-10">
      <h3 className="text-center text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
        OTP verification
      </h3>
      <p className="mt-3 text-center text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        Please enter the OTP (One-Time Password) sent to your registered mobile number{' '}
        <span className="font-medium text-slate-700 dark:text-slate-200">{displayPhone(phone)}</span> to
        complete your verification.
      </p>

      <div className="mt-8 flex justify-center gap-2 sm:gap-3">
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={OTP_LENGTH}
            aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
            value={digit}
            disabled={busy}
            onChange={(e) => onBoxChange(i, e.target.value)}
            onKeyDown={(e) => onBoxKeyDown(i, e)}
            onPaste={(e) => onBoxPaste(i, e)}
            onFocus={(e) => e.target.select()}
            className="h-12 w-10 rounded-lg border border-slate-200 bg-white text-center text-lg font-semibold text-slate-900 shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-white sm:h-14 sm:w-12"
          />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span>
          Remaining time:{' '}
          <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
            {formatCountdown(resendIn)}
          </span>
        </span>
        <span>
          Didn&apos;t get the code?{' '}
          <button
            type="button"
            disabled={!canResend}
            onClick={() => void send()}
            className="font-semibold text-primary-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline dark:text-primary-400"
          >
            Resend
          </button>
        </span>
      </div>

      {error ? (
        <p className="mt-3 text-center text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {debugOtp ? (
        <p className="mt-2 text-center text-[11px] text-amber-700 dark:text-amber-400">
          Staging code: {debugOtp}
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy || code.length !== OTP_LENGTH}
        onClick={() => void verify()}
        className="mt-8 w-full rounded-full bg-primary-600 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Please wait…' : 'Verify'}
      </button>
      {onCancel ? (
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="mt-3 w-full rounded-full border border-primary-600 bg-white py-3 text-sm font-semibold text-primary-600 transition hover:bg-primary-50 disabled:opacity-50 dark:border-primary-400 dark:bg-transparent dark:text-primary-400 dark:hover:bg-primary-950/40"
        >
          Cancel
        </button>
      ) : null}

      <p className="mt-6 text-center text-xs text-slate-400">
        Wondering how we use this code for verification?{' '}
        <Link href="/privacy" className="font-medium text-primary-600 hover:underline dark:text-primary-400">
          Know here
        </Link>
      </p>
    </div>
  );
}
