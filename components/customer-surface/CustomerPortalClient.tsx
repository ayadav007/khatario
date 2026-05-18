'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import type { PublicBusinessSurface } from '@/lib/customer-surface/types';
import { CustomerSurfaceShell } from './CustomerSurfaceShell';

type PortalInvoice = {
  id: string;
  invoice_number: string;
  invoice_date: string | null;
  grand_total: number;
  balance_amount: number;
  payment_status: string;
  public_url: string;
  public_token: string;
};

interface CustomerPortalClientProps {
  slug: string;
  initialBusiness: PublicBusinessSurface;
}

export function CustomerPortalClient({
  slug,
  initialBusiness,
}: CustomerPortalClientProps) {
  const [business] = useState(initialBusiness);
  const [step, setStep] = useState<'email' | 'otp' | 'list'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [outstanding, setOutstanding] = useState(0);
  const [customerName, setCustomerName] = useState<string | null>(null);

  const loadInvoices = useCallback(async () => {
    const res = await fetch('/api/public/portal/session/invoices', { credentials: 'include' });
    if (res.status === 401) {
      setStep('email');
      return;
    }
    if (!res.ok) {
      setError('Could not load invoices.');
      return;
    }
    const json = await res.json();
    setInvoices(json.invoices ?? []);
    setOutstanding(Number(json.outstanding_total ?? 0));
    setCustomerName(json.customer?.name ?? null);
    setStep('list');
  }, []);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/public/portal/${encodeURIComponent(slug)}/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to send code');
        return;
      }
      setMessage(json.message || 'Check your email for a sign-in code.');
      setStep('otp');
    } catch {
      setError('Failed to send code');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/portal/${encodeURIComponent(slug)}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, otp }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Invalid code');
        return;
      }
      setCustomerName(json.customer?.name ?? null);
      await loadInvoices();
    } catch {
      setError('Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch('/api/public/portal/session/logout', { method: 'POST', credentials: 'include' });
    setStep('email');
    setInvoices([]);
    setOtp('');
  }

  function formatInr(n: number) {
    return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  return (
    <CustomerSurfaceShell business={business}>
      {step === 'list' ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-semibold text-text-primary">
                {customerName ? `Hello, ${customerName}` : 'Your bills'}
              </h1>
              <p className="text-sm text-text-secondary">
                Outstanding:{' '}
                <span className="font-semibold text-gray-900">{formatInr(outstanding)}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="text-sm text-text-secondary hover:text-text-primary"
            >
              Sign out
            </button>
          </div>

          {invoices.length === 0 ? (
            <p className="rounded-lg border border-border bg-white p-6 text-center text-sm text-text-secondary">
              No bills to show yet.
            </p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-white">
              {invoices.map((inv) => (
                <li key={inv.id}>
                  <Link
                    href={`/i/${inv.public_token}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50"
                  >
                    <div>
                      <p className="font-medium text-text-primary">{inv.invoice_number}</p>
                      <p className="text-xs text-text-secondary">
                        {inv.invoice_date
                          ? new Date(inv.invoice_date).toLocaleDateString('en-IN')
                          : '—'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">{formatInr(inv.balance_amount)}</p>
                      <p className="text-xs capitalize text-text-muted">{inv.payment_status}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section className="rounded-lg border border-border bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-text-primary">Customer portal</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Sign in with the email your supplier has on file.
          </p>

          {step === 'email' ? (
            <form onSubmit={requestOtp} className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-text-primary" htmlFor="portal-email">
                Email
              </label>
              <input
                id="portal-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="focus-primary w-full rounded-md border border-border px-3 py-2 text-sm"
              />
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              {message ? <p className="text-sm text-green-700">{message}</p> : null}
              <button
                type="submit"
                disabled={busy}
                className="btn-primary w-full rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {busy ? 'Sending…' : 'Send sign-in code'}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} className="mt-4 space-y-3">
              <p className="text-sm text-text-secondary">Code sent to {email}</p>
              <label className="block text-sm font-medium text-text-primary" htmlFor="portal-otp">
                6-digit code
              </label>
              <input
                id="portal-otp"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="focus-primary w-full rounded-md border border-border px-3 py-2 text-sm tracking-widest"
              />
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <button
                type="submit"
                disabled={busy}
                className="btn-primary w-full rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {busy ? 'Verifying…' : 'Sign in'}
              </button>
              <button
                type="button"
                className="w-full text-sm text-text-secondary hover:text-text-primary"
                onClick={() => {
                  setStep('email');
                  setOtp('');
                  setError(null);
                }}
              >
                Use a different email
              </button>
            </form>
          )}
        </section>
      )}
    </CustomerSurfaceShell>
  );
}
