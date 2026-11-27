'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  creditWarning,
  formatRupees,
  formatSignedRupees,
  freeMonthsNote,
  needsCreditConfirm,
  periodSentence,
  previewLines,
  type CheckoutPreview,
} from '@/lib/subscription/renewal-view';

export type CheckoutPreviewState = {
  preview: CheckoutPreview | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
  creditConfirmed: boolean;
  setCreditConfirmed: (v: boolean) => void;
  /** True while the customer must not pay yet: no price loaded, or lost credit not yet accepted. */
  blocked: boolean;
};

/**
 * Asks the server what this purchase would charge (GET /api/subscriptions/checkout/preview). The
 * server picks the business from the session; nothing is created and no gateway is called.
 */
export function useCheckoutPreview(params: {
  enabled: boolean;
  planId: string | null;
  billingCycle: string;
  couponCode?: string;
}): CheckoutPreviewState {
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [creditConfirmed, setCreditConfirmed] = useState(false);
  const { enabled, planId, billingCycle, couponCode } = params;

  useEffect(() => {
    if (!enabled || !planId) {
      setPreview(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCreditConfirmed(false);
    const qs = new URLSearchParams({ plan_id: planId, billing_cycle: billingCycle });
    if (couponCode?.trim()) qs.set('coupon_code', couponCode.trim());
    fetch(`/api/subscriptions/checkout/preview?${qs.toString()}`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setPreview(null);
          setError(data.error || 'We could not load the price. Please try again.');
        } else {
          setPreview(data as CheckoutPreview);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview(null);
          setError('We could not load the price. Please try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, planId, billingCycle, couponCode, attempt]);

  return {
    preview,
    loading,
    error,
    retry: () => setAttempt((n) => n + 1),
    creditConfirmed,
    setCreditConfirmed,
    blocked: enabled && (loading || !preview || (needsCreditConfirm(preview) && !creditConfirmed)),
  };
}

export function CheckoutPreviewBox({ state }: { state: CheckoutPreviewState }) {
  const { preview, loading, error } = state;
  return (
    <div className="mb-4 rounded-xl border border-border bg-surface p-4 dark:bg-slate-900/60" aria-live="polite">
      <p className="type-label mb-2 text-text-secondary">What you pay</p>
      {loading ? (
        <div className="flex items-center gap-2 text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking the price...
        </div>
      ) : error ? (
        <div className="text-sm text-red-600">
          {error}{' '}
          <button type="button" className="font-semibold underline" onClick={state.retry}>
            Try again
          </button>
        </div>
      ) : preview ? (
        <>
          <dl className="space-y-1.5 text-sm">
            {previewLines(preview).map((line) => (
              <div
                key={line.key}
                className={`flex items-start justify-between gap-3 ${
                  line.emphasis ? 'border-t border-border pt-2 text-base font-bold text-text-primary' : 'text-text-secondary'
                }`}
              >
                <dt>{line.label}</dt>
                <dd className="shrink-0 font-medium">{formatSignedRupees(line.amount)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-text-secondary">{periodSentence(preview)}</p>
          {freeMonthsNote(preview) ? <p className="mt-1 text-sm text-text-secondary">{freeMonthsNote(preview)}</p> : null}
          {needsCreditConfirm(preview) ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Some of your credit will be lost
              </div>
              {creditWarning(preview)}
              <label className="mt-2 flex items-start gap-2 font-medium">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={state.creditConfirmed}
                  onChange={(e) => state.setCreditConfirmed(e.target.checked)}
                />
                <span>I understand that {formatRupees(preview.credit_unused)} of credit is not carried forward or refunded.</span>
              </label>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
