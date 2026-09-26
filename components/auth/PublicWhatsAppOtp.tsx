'use client';

import { useEffect, useState } from 'react';

export function PublicWhatsAppOtp({
  purpose,
  phone,
  verified,
  onVerified,
}: {
  purpose: 'signup' | 'demo_booking';
  phone: string;
  verified: boolean;
  onVerified: (ok: boolean) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  useEffect(() => {
    setCode('');
    setHint('');
    onVerified(false);
    // Reset when the number changes; parent should pass a stable setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, purpose]);

  const send = async () => {
    setBusy(true);
    setHint('');
    try {
      const res = await fetch('/api/public/platform-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', purpose, phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send code');
      setHint(
        data.debugOtp
          ? `Code sent (staging): ${data.debugOtp}`
          : 'We sent a 6-digit code on WhatsApp.',
      );
    } catch (err) {
      setHint(err instanceof Error ? err.message : 'Could not send code');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setHint('');
    try {
      const res = await fetch('/api/public/platform-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', purpose, phone, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid code');
      onVerified(true);
      setHint('Number verified.');
    } catch (err) {
      onVerified(false);
      setHint(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) {
    return <p className="mt-2 text-xs text-slate-500">Enter a 10-digit mobile number to receive a WhatsApp code.</p>;
  }

  if (verified) {
    return <p className="mt-2 text-sm font-medium text-green-700">WhatsApp number verified.</p>;
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800/50">
      <p className="text-xs font-medium text-slate-600 dark:text-slate-300">Verify with WhatsApp OTP</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void send()}
          className="rounded-md border border-primary-600 px-3 py-1.5 text-xs font-semibold text-primary-700 hover:bg-white disabled:opacity-50"
        >
          {busy ? 'Please wait…' : 'Send code'}
        </button>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="6-digit code"
          className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={busy || code.length !== 6}
          onClick={() => void verify()}
          className="rounded-md bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          Verify
        </button>
      </div>
      {hint && <p className="text-xs text-slate-600 dark:text-slate-300">{hint}</p>}
    </div>
  );
}
