'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { usePlanFeature } from '@/hooks/usePlanFeature';
import { GenerateEwayBillDialog } from '@/components/eway-bills/GenerateEwayBillDialog';
import { ActiveEwayBillLine, useDocumentEwayBills } from '@/components/eway-bills/useDocumentEwayBills';

type Props = {
  invoiceId: string;
  initialNumber?: string | null;
  initialDate?: string | null;
  onSaved?: () => void;
  /** Invoice total, for the generate dialog and the 50,000 rupee hint. */
  goodsValue?: number;
  /** Only a final invoice can have an e-way bill generated for it. */
  isFinal?: boolean;
};

export const EWAY_LIMIT_HINT = 'Goods are worth more than ₹50,000, so an e-way bill is needed before they move.';

export function EwayBillField({ invoiceId, initialNumber, initialDate, onSaved, goodsValue = 0, isFinal = false }: Props) {
  const ewayAllowed = usePlanFeature('eway_bill');
  const [number, setNumber] = useState(initialNumber || '');
  const [date, setDate] = useState(initialDate ? String(initialDate).slice(0, 10) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const docBills = useDocumentEwayBills('invoice', invoiceId, ewayAllowed && isFinal);
  if (!ewayAllowed) return null;

  // A final invoice with no e-way bill yet is offered Generate; typing a number in by hand sits behind a link.
  const canGenerate = isFinal && docBills.canGenerate;
  // For a final invoice, wait for the register before showing anything, so the button does not flicker.
  const showManual = isFinal ? docBills.settled && (!canGenerate || manualOpen) : true;

  const save = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/eway`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          eway_bill_number: number.trim(),
          eway_bill_date: date || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not save the e-way bill number');
        return;
      }
      setSaved(true);
      onSaved?.();
    } catch {
      setError('Could not save the e-way bill number');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">E-way bill</p>
      {isFinal && docBills.onRecord ? <ActiveEwayBillLine bill={docBills.onRecord} /> : null}
      {canGenerate ? (
        <>
          {goodsValue > 50000 ? <p className="text-xs text-amber-700">{EWAY_LIMIT_HINT}</p> : null}
          <Button type="button" variant="primary" className="w-full" onClick={() => setGenerateOpen(true)}>
            Generate e-way bill
          </Button>
          {!manualOpen ? (
            <button type="button" className="text-xs text-primary-700 underline" onClick={() => setManualOpen(true)}>
              Generated it on the portal? Enter the number
            </button>
          ) : null}
        </>
      ) : null}
      {generateOpen ? (
        <GenerateEwayBillDialog
          sourceType="invoice"
          sourceId={invoiceId}
          goodsValue={goodsValue}
          onDone={() => {
            void docBills.refresh();
            onSaved?.();
          }}
          onClose={() => setGenerateOpen(false)}
        />
      ) : null}
      {showManual ? (
        <>
        <p className="text-xs text-text-secondary">
          Paste the 12-digit number from the GST portal. The bill can be saved without it. Print picks it up after you save.
        </p>
        <input
          inputMode="numeric"
          maxLength={12}
          value={number}
          onChange={(e) => {
            setNumber(e.target.value.replace(/\D/g, '').slice(0, 12));
            setSaved(false);
          }}
          placeholder="12-digit e-way bill number"
          className="input w-full text-sm"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setSaved(false);
          }}
          className="input w-full text-sm"
        />
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        {saved ? <p className="text-xs text-green-700">Saved. Print the bill to see the number.</p> : null}
        <Button type="button" variant="secondary" className="w-full" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save e-way bill'}
        </Button>
        </>
      ) : null}
    </div>
  );
}

export function InvoicePlanExtras({
  invoiceId,
  ewayNumber,
  ewayDate,
  onSaved,
  goodsValue,
  isFinal,
}: {
  invoiceId: string;
  ewayNumber?: string | null;
  ewayDate?: string | null;
  onSaved?: () => void;
  goodsValue?: number;
  isFinal?: boolean;
}) {
  const eway = usePlanFeature('eway_bill');
  const einvoice = usePlanFeature('e_invoice');
  if (!eway && !einvoice) return null;
  return (
    <>
      {eway ? (
        <EwayBillField
          invoiceId={invoiceId}
          initialNumber={ewayNumber}
          initialDate={ewayDate}
          onSaved={onSaved}
          goodsValue={goodsValue}
          isFinal={isFinal}
        />
      ) : null}
      <EInvoicePlanNote />
    </>
  );
}

/** Shown on the invoice only when the plan includes e-invoice. Khatario does not generate the IRN. */
export function EInvoicePlanNote() {
  const allowed = usePlanFeature('e_invoice');
  if (!allowed) return null;
  return (
    <p className="mt-3 text-xs text-text-secondary">
      E-invoice is on for this plan. Generate the IRN and QR on the government e-invoice portal, then print them on this bill. Khatario does not create the IRN.
    </p>
  );
}
