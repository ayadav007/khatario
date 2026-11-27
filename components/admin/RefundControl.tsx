'use client';

import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { formatRupees } from '@/lib/subscription/renewal-view';
import {
  endPlanChoices,
  refundConfirmText,
  validateRefundForm,
  type EndPlanChoice,
} from '@/lib/subscription/refund-view';

export type RefundablePayment = {
  id: string;
  refundable_amount: number;
  sent_through_gateway: boolean;
  plan_end_date: string | null;
};

/**
 * Refund button, form and confirm step for one completed payment. The business comes from the page's
 * business id; the amount limit, gateway wording and plan end date come from the admin billing list.
 * The server's message is shown exactly as it sent it.
 */
export function RefundControl({
  businessId,
  payment,
  onDone,
}: {
  businessId: string;
  payment: RefundablePayment;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'form' | 'confirm' | 'done'>('form');
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [endPlan, setEndPlan] = useState<EndPlanChoice>('period_end');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // One key per opened form: sending the same refund twice (a double click, a retry) is one refund.
  const keyRef = useRef<string>('');

  function start() {
    keyRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `refund-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setAmountText(String(payment.refundable_amount));
    setReason('');
    setEndPlan('period_end');
    setFormError(null);
    setResult(null);
    setStep('form');
    setOpen(true);
  }

  function toConfirm() {
    const v = validateRefundForm({ amountText, reason, max: payment.refundable_amount });
    if (!v.ok) {
      setFormError(v.error);
      return;
    }
    setFormError(null);
    setStep('confirm');
  }

  async function send() {
    const v = validateRefundForm({ amountText, reason, max: payment.refundable_amount });
    if (!v.ok) {
      setFormError(v.error);
      setStep('form');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/businesses/${businessId}/billing/${payment.id}/refund`, {
        ...platformAdminFetchInit,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: v.amount, end_plan: endPlan, notes: reason.trim(), idempotency_key: keyRef.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        const pending = data.refund?.status === 'pending';
        setResult({ ok: true, text: data.refund?.message || (pending ? 'The refund is waiting for the gateway.' : 'The refund was made.') });
        setStep('done');
        onDone();
      } else {
        setResult({ ok: false, text: data.error || 'The refund could not be completed.' });
        setStep('done');
        onDone();
      }
    } catch {
      setResult({ ok: false, text: 'The refund could not be completed. Check the billing list before trying again.' });
      setStep('done');
    } finally {
      setBusy(false);
    }
  }

  const choices = endPlanChoices(payment.plan_end_date);
  const validated = validateRefundForm({ amountText, reason: 'xxx', max: payment.refundable_amount });
  const amountNow = validated.ok ? validated.amount : 0;

  return (
    <>
      <button type="button" onClick={start} className="text-sm font-medium text-red-600 hover:text-red-700">
        Refund
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Refund payment">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 text-gray-900 shadow-xl">
            {step === 'form' ? (
              <div className="space-y-4">
                <h3 className="text-lg font-bold">Refund this payment</h3>
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor={`refund-amount-${payment.id}`}>
                    Amount to refund (₹)
                  </label>
                  <input
                    id={`refund-amount-${payment.id}`}
                    inputMode="decimal"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Up to {formatRupees(payment.refundable_amount)} can still be refunded on this payment.
                  </p>
                </div>
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">What happens to the customer&apos;s plan</legend>
                  <div className="space-y-2">
                    {choices.map((c) => (
                      <label key={c.value} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${endPlan === c.value ? 'border-primary-600 ring-1 ring-primary-600' : 'border-gray-200'}`}>
                        <input type="radio" name={`end-plan-${payment.id}`} className="mt-1" checked={endPlan === c.value} onChange={() => setEndPlan(c.value)} />
                        <span>
                          <span className="block text-sm font-medium">{c.label}</span>
                          <span className="block text-xs text-gray-600">{c.explain}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {amountNow > 0 && amountNow < payment.refundable_amount ? (
                    <p className="mt-2 text-xs text-gray-600">This is only part of the payment, so the plan is normally left as it is. The result message says what happened.</p>
                  ) : null}
                </fieldset>
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor={`refund-reason-${payment.id}`}>
                    Reason (required)
                  </label>
                  <textarea
                    id={`refund-reason-${payment.id}`}
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  />
                </div>
                {formError ? <p role="alert" className="text-sm text-red-600">{formError}</p> : null}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">
                    Close
                  </button>
                  <button type="button" onClick={toConfirm} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
                    Continue
                  </button>
                </div>
              </div>
            ) : null}

            {step === 'confirm' ? (
              <div className="space-y-3">
                <h3 className="text-lg font-bold">Confirm the refund</h3>
                {refundConfirmText({ amount: amountNow, viaGateway: payment.sent_through_gateway, endPlan, planEndDate: payment.plan_end_date }).map((line) => (
                  <p key={line} className="text-sm text-gray-700">{line}</p>
                ))}
                <p className="text-sm text-gray-700"><span className="font-medium">Reason:</span> {reason.trim()}</p>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" disabled={busy} onClick={() => setStep('form')} className="rounded-lg border border-gray-300 px-4 py-2 text-sm disabled:opacity-50">
                    Back
                  </button>
                  <button type="button" disabled={busy} onClick={send} className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Refund {formatRupees(amountNow)} now
                  </button>
                </div>
              </div>
            ) : null}

            {step === 'done' && result ? (
              <div className="space-y-3">
                <h3 className="text-lg font-bold">{result.ok ? 'Refund result' : 'The refund did not go through'}</h3>
                <p role="status" className={`text-sm ${result.ok ? 'text-gray-800' : 'text-red-700'}`}>{result.text}</p>
                <div className="flex justify-end">
                  <button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white">
                    Close
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
