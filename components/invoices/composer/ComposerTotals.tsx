'use client';

import { format } from 'date-fns';
import { clsx } from 'clsx';
import { Check, ListPlus, Plus, X } from 'lucide-react';
import type { ComposerCharge, ComposerPayment, ComposerTotals } from './types';
import { fx, inr, Kbd, NumberInput, PAYMENT_MODES, Switch } from './ui';

type Props = {
  totals: ComposerTotals;
  documentType: string;
  isIntraState: boolean;
  isExport: boolean;
  exportType: 'wp' | 'wop';
  foreign: { currency: string; rate: number } | null;
  amountInWords: string;
  charges: ComposerCharge[];
  setCharges: (c: ComposerCharge[]) => void;
  enableRoundOff: boolean;
  setEnableRoundOff: (v: boolean) => void;
  payments: ComposerPayment[];
  setPayments: (p: ComposerPayment[]) => void;
  onOpenPaymentDetails: () => void;
  totalPaid: number;
  balance: number;
  receivedRef: React.RefObject<HTMLInputElement>;
  readOnly: boolean;
  isEstimate: boolean;
};

const smallInput =
  'h-8 rounded-lg border border-border bg-surface px-2 text-sm tabular-nums text-text-primary outline-none transition focus:border-primary-500 focus:ring-4 focus:ring-primary-100 disabled:opacity-70';

export const newPayment = (amount: number, mode = 'cash'): ComposerPayment => ({
  id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
  amount,
  mode,
  date: format(new Date(), 'yyyy-MM-dd'),
  reference: '',
});

export function TotalsPanel({
  totals,
  documentType,
  isIntraState,
  isExport,
  exportType,
  foreign,
  amountInWords,
  charges,
  setCharges,
  enableRoundOff,
  setEnableRoundOff,
  payments,
  setPayments,
  onOpenPaymentDetails,
  totalPaid,
  balance,
  receivedRef,
  readOnly,
  isEstimate,
}: Props) {
  const nonTaxable = documentType === 'bill_of_supply';
  const grand = totals.grandTotal;
  const fullyPaid = grand > 0 && Math.abs(balance) < 0.005 && totalPaid > 0;
  const single = payments.length <= 1;
  const first = payments[0];

  const setReceived = (amount: number) => {
    if (amount <= 0) {
      setPayments(payments.slice(1));
      return;
    }
    setPayments(first ? [{ ...first, amount }, ...payments.slice(1)] : [newPayment(amount)]);
  };

  const setMode = (mode: string) => {
    if (first) setPayments([{ ...first, mode }, ...payments.slice(1)]);
    else setPayments([newPayment(0, mode)]);
  };

  return (
    <div className="flex min-w-0 flex-col p-4">
      <dl className="space-y-2 text-sm">
        {totals.totalDiscount > 0 && (
          <>
            <Row label="Items total" value={inr(totals.itemSubtotal)} />
            <Row label="Item discounts" value={`−${inr(totals.totalDiscount)}`} valueClass="text-emerald-600" />
          </>
        )}
        <Row label="Taxable amount" value={inr(totals.taxableAmount)} />
        {!nonTaxable &&
          (isExport ? (
            <Row label={exportType === 'wop' ? 'IGST 0% (export under LUT)' : 'IGST (export, refundable)'} value={inr(totals.totalIGST)} />
          ) : isIntraState ? (
            <>
              <Row label="CGST" value={inr(totals.totalCGST)} />
              <Row label="SGST" value={inr(totals.totalSGST)} />
            </>
          ) : (
            <Row label="IGST" value={inr(totals.totalIGST)} />
          ))}

        {charges.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <input
              value={c.purpose}
              onChange={(e) => setCharges(charges.map((x) => (x.id === c.id ? { ...x, purpose: e.target.value } : x)))}
              className={clsx(smallInput, 'min-w-0 flex-1')}
              placeholder="Charge name (e.g. Freight)"
              disabled={readOnly}
            />
            <NumberInput
              value={c.amount}
              onValue={(n) => setCharges(charges.map((x) => (x.id === c.id ? { ...x, amount: n } : x)))}
              className={clsx(smallInput, 'w-24 text-right')}
              placeholder="0"
              disabled={readOnly}
            />
            {!readOnly && <IconX onClick={() => setCharges(charges.filter((x) => x.id !== c.id))} />}
          </div>
        ))}

        {!readOnly && (
          <div className="flex flex-wrap gap-3 pt-0.5">
            <button
              type="button"
              onClick={() => setCharges([...charges, { id: Date.now().toString(), purpose: '', amount: 0 }])}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline dark:text-primary-300"
            >
              <Plus className="h-3.5 w-3.5" /> Additional charges
            </button>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center gap-2 text-text-secondary">
            <Switch checked={enableRoundOff} onChange={setEnableRoundOff} disabled={readOnly} label="Round off" />
            Round off
          </label>
          <span className="tabular-nums text-text-primary">
            {totals.roundOff >= 0 ? '+' : '−'}
            {inr(Math.abs(totals.roundOff))}
          </span>
        </div>
      </dl>

      <div className="mt-3 rounded-xl bg-gradient-to-br from-primary-600 to-primary-800 px-4 py-3 text-white shadow-lg shadow-primary-700/20">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-white/85">Total amount</span>
          <span className="text-[26px] font-extrabold leading-none tabular-nums tracking-tight">{inr(grand)}</span>
        </div>
        {foreign ? (
          <p className="mt-1.5 flex justify-between gap-2 text-[11px] text-white/75">
            <span>
              ₹{foreign.rate} per {foreign.currency}
            </span>
            <span className="font-semibold tabular-nums text-white">≈ {fx(grand / foreign.rate, foreign.currency)}</span>
          </p>
        ) : (
          amountInWords && <p className="mt-1.5 text-[11px] leading-snug text-white/70">{amountInWords}</p>
        )}
      </div>

      {!isEstimate && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
              Amount received {!readOnly && <Kbd>F8</Kbd>}
            </span>
            {!readOnly && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-text-secondary">
                <span
                  className={clsx(
                    'flex h-4 w-4 items-center justify-center rounded border transition',
                    fullyPaid ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-surface'
                  )}
                >
                  {fullyPaid && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={fullyPaid}
                  disabled={grand <= 0}
                  onChange={(e) => setPayments(e.target.checked ? [newPayment(grand, first?.mode || 'cash')] : [])}
                />
                Fully paid <Kbd>F9</Kbd>
              </label>
            )}
          </div>

          {single ? (
            <>
              <div className="flex h-10 items-center overflow-hidden rounded-lg border border-border bg-surface transition focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-100">
                <span className="pl-3 text-sm text-text-muted">₹</span>
                <NumberInput
                  inputRef={receivedRef}
                  blankZero
                  value={first?.amount ?? 0}
                  onValue={setReceived}
                  placeholder="0.00"
                  disabled={readOnly}
                  className="min-w-0 flex-1 bg-transparent px-2 text-sm font-semibold tabular-nums text-text-primary outline-none"
                />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {PAYMENT_MODES.map((m, index) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={readOnly}
                    onClick={() => setMode(m.id)}
                    className={clsx(
                      'h-7 rounded-md px-2.5 text-xs font-semibold transition disabled:cursor-default',
                      (first?.mode || 'cash') === m.id
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    )}
                  >
                    {m.label}
                    {!readOnly && <Kbd className="ml-1 h-4 min-w-[14px] px-0.5 text-[9px]">{index + 1}</Kbd>}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <ul className="space-y-1 rounded-lg border border-border bg-slate-50/60 p-2 text-sm dark:bg-slate-800/40">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span className="text-text-secondary">
                    {PAYMENT_MODES.find((m) => m.id === p.mode)?.label ?? p.mode}
                    {p.reference ? ` · ${p.reference}` : ''}
                  </span>
                  <span className="font-semibold tabular-nums text-text-primary">{inr(Number(p.amount) || 0)}</span>
                </li>
              ))}
            </ul>
          )}

          {!readOnly && (
            <button
              type="button"
              onClick={onOpenPaymentDetails}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline dark:text-primary-300"
            >
              <ListPlus className="h-3.5 w-3.5" /> {single ? 'Split payment, date or reference' : 'Edit payments'}
            </button>
          )}

          {grand > 0 && (
            <div
              className={clsx(
                'mt-3 flex items-center justify-between rounded-lg px-3 py-2.5 text-sm',
                balance > 0.004
                  ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
                  : balance < -0.004
                    ? 'bg-sky-50 text-sky-800 dark:bg-sky-950/30 dark:text-sky-200'
                    : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
              )}
            >
              <span className="font-semibold">
                {balance > 0.004 ? 'Balance due' : balance < -0.004 ? 'Received more than total' : 'Fully paid'}
              </span>
              <span className="font-bold tabular-nums">
                {balance > 0.004 ? inr(balance) : balance < -0.004 ? inr(-balance) : inr(totalPaid)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-text-secondary">{label}</dt>
      <dd className={clsx('font-medium tabular-nums text-text-primary', valueClass)}>{value}</dd>
    </div>
  );
}

function IconX({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded p-1 text-text-muted hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
      aria-label="Remove"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}
