'use client';

import { clsx } from 'clsx';
import { Check, Plus, Split, X } from 'lucide-react';
import { Kbd } from './Kbd';
import { amountInWords, fx, inr, PAYMENT_MODES, type PaymentMode } from '../_lib/mock-data';

export type Totals = {
  gross: number;
  itemDiscount: number;
  taxable: number;
  tax: number;
  qty: number;
  charges: number;
  extraDiscount: number;
  roundOff: number;
  total: number;
};

export type Charge = { id: string; label: string; amount: number };
export type Payment = { id: string; amount: string; mode: PaymentMode };

type Props = {
  totals: Totals;
  isInterState: boolean;
  exportInfo: { type: 'lut' | 'igst'; currency: string; rate: number } | null;
  charges: Charge[];
  setCharges: (c: Charge[]) => void;
  discount: { value: number; type: 'pct' | 'amt' } | null;
  setDiscount: (d: { value: number; type: 'pct' | 'amt' } | null) => void;
  autoRound: boolean;
  setAutoRound: (v: boolean) => void;
  payments: Payment[];
  setPayments: (p: Payment[]) => void;
  fullyPaid: boolean;
  setFullyPaid: (v: boolean) => void;
  received: number;
  balance: number;
  receivedRef: React.RefObject<HTMLInputElement>;
};

const smallInput =
  'h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm tabular-nums outline-none transition focus:border-primary-500 focus:ring-4 focus:ring-primary-100';

export function TotalsPanel({
  totals,
  isInterState,
  exportInfo,
  charges,
  setCharges,
  discount,
  setDiscount,
  autoRound,
  setAutoRound,
  payments,
  setPayments,
  fullyPaid,
  setFullyPaid,
  received,
  balance,
  receivedRef,
}: Props) {
  const foreign = !!exportInfo && exportInfo.currency !== 'INR' && exportInfo.rate > 0;
  const updatePayment = (id: string, patch: Partial<Payment>) =>
    setPayments(payments.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  return (
    <div className="flex min-w-0 flex-col p-4">
      <dl className="space-y-2 text-sm">
        <Row label="Taxable amount" value={inr(totals.taxable)} />
        {totals.itemDiscount > 0 && (
          <Row label="Item discounts (included)" value={`−${inr(totals.itemDiscount)}`} valueClass="text-emerald-600" muted />
        )}
        {exportInfo ? (
          <Row
            label={exportInfo.type === 'lut' ? 'IGST 0% (export under LUT)' : 'IGST (export, refundable)'}
            value={inr(totals.tax)}
          />
        ) : isInterState ? (
          <Row label="IGST" value={inr(totals.tax)} />
        ) : (
          <>
            <Row label="CGST" value={inr(totals.tax / 2)} />
            <Row label="SGST" value={inr(totals.tax / 2)} />
          </>
        )}

        {charges.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <input
              value={c.label}
              onChange={(e) => setCharges(charges.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))}
              className={clsx(smallInput, 'min-w-0 flex-1')}
              placeholder="Charge name"
            />
            <input
              value={c.amount || ''}
              onChange={(e) =>
                setCharges(charges.map((x) => (x.id === c.id ? { ...x, amount: Number(e.target.value) || 0 } : x)))
              }
              className={clsx(smallInput, 'w-24 text-right')}
              placeholder="0"
              autoFocus
            />
            <IconX onClick={() => setCharges(charges.filter((x) => x.id !== c.id))} />
          </div>
        ))}

        {discount && (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-slate-600">Extra discount</span>
            <div className="flex overflow-hidden rounded-lg border border-slate-200">
              {(['pct', 'amt'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDiscount({ ...discount, type: t })}
                  className={clsx(
                    'h-8 w-8 text-xs font-bold',
                    discount.type === t ? 'bg-primary-600 text-white' : 'bg-white text-slate-500'
                  )}
                >
                  {t === 'pct' ? '%' : '₹'}
                </button>
              ))}
            </div>
            <input
              value={discount.value || ''}
              onChange={(e) => setDiscount({ ...discount, value: Number(e.target.value) || 0 })}
              className={clsx(smallInput, 'w-20 text-right')}
              placeholder="0"
              autoFocus
            />
            <span className="w-20 text-right text-sm tabular-nums text-emerald-600">−{inr(totals.extraDiscount)}</span>
            <IconX onClick={() => setDiscount(null)} />
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-0.5">
          <LinkButton
            onClick={() => setCharges([...charges, { id: `ch${Date.now()}`, label: 'Freight', amount: 0 }])}
          >
            Additional charges
          </LinkButton>
          {!discount && <LinkButton onClick={() => setDiscount({ value: 0, type: 'pct' })}>Discount</LinkButton>}
        </div>

        <div className="flex items-center justify-between pt-1">
          <label className="flex cursor-pointer items-center gap-2 text-slate-600">
            <button
              type="button"
              role="switch"
              aria-checked={autoRound}
              onClick={() => setAutoRound(!autoRound)}
              className={clsx('relative h-5 w-9 rounded-full transition', autoRound ? 'bg-primary-600' : 'bg-slate-300')}
            >
              <span
                className={clsx(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                  autoRound ? 'left-[18px]' : 'left-0.5'
                )}
              />
            </button>
            Auto round off
          </label>
          <span className="tabular-nums text-slate-700">
            {totals.roundOff >= 0 ? '+' : ''}
            {inr(totals.roundOff)}
          </span>
        </div>
      </dl>

      <div className="mt-3 rounded-xl bg-gradient-to-br from-primary-600 to-primary-800 px-4 py-3 text-white shadow-lg shadow-primary-700/20">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-white/85">
            Total amount{foreign ? ` (${exportInfo!.currency})` : ''}
          </span>
          <span className="text-[26px] font-extrabold leading-none tabular-nums tracking-tight">
            {foreign ? fx(totals.total / exportInfo!.rate, exportInfo!.currency) : inr(totals.total)}
          </span>
        </div>
        {foreign ? (
          <p className="mt-1.5 flex justify-between text-[11px] text-white/75">
            <span>
              ₹{exportInfo!.rate} per {exportInfo!.currency}
            </span>
            <span className="font-semibold tabular-nums text-white">{inr(totals.total)}</span>
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] leading-snug text-white/70">{amountInWords(totals.total)}</p>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            Amount received <Kbd>F8</Kbd>
          </span>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600">
            <span
              className={clsx(
                'flex h-4 w-4 items-center justify-center rounded border transition',
                fullyPaid ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'
              )}
            >
              {fullyPaid && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <input
              type="checkbox"
              className="sr-only"
              checked={fullyPaid}
              onChange={(e) => setFullyPaid(e.target.checked)}
            />
            Fully paid <Kbd>F9</Kbd>
          </label>
        </div>

        <div className="space-y-2">
          {payments.map((p, idx) => (
            <div key={p.id}>
              <div className="flex h-10 items-center overflow-hidden rounded-lg border border-slate-200 bg-white transition focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-100">
                <span className="pl-3 text-sm text-slate-400">₹</span>
                <input
                  ref={idx === 0 ? receivedRef : undefined}
                  value={fullyPaid && payments.length === 1 ? totals.total.toFixed(2) : p.amount}
                  onChange={(e) => {
                    if (fullyPaid) setFullyPaid(false);
                    updatePayment(p.id, { amount: e.target.value });
                  }}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="min-w-0 flex-1 bg-transparent px-2 text-sm font-semibold tabular-nums outline-none"
                />
                {payments.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setPayments(payments.filter((x) => x.id !== p.id))}
                    className="px-2 text-slate-400 hover:text-rose-600"
                    aria-label="Remove payment"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {PAYMENT_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => updatePayment(p.id, { mode: m })}
                    className={clsx(
                      'h-7 rounded-md px-2.5 text-xs font-semibold transition',
                      p.mode === m
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            setFullyPaid(false);
            setPayments([...payments, { id: `p${Date.now()}`, amount: '', mode: 'UPI' }]);
          }}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline"
        >
          <Split className="h-3.5 w-3.5" /> Split payment
        </button>

        {totals.total > 0 && (
          <div
            className={clsx(
              'mt-3 flex items-center justify-between rounded-lg px-3 py-2.5 text-sm',
              balance > 0.004
                ? 'bg-amber-50 text-amber-800'
                : balance < -0.004
                  ? 'bg-sky-50 text-sky-800'
                  : 'bg-emerald-50 text-emerald-800'
            )}
          >
            <span className="font-semibold">
              {balance > 0.004 ? 'Balance due' : balance < -0.004 ? 'Return change' : 'Fully paid'}
            </span>
            <span className="font-bold tabular-nums">
              {balance > 0.004 ? inr(balance) : balance < -0.004 ? inr(-balance) : inr(received)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueClass,
  muted,
}: {
  label: string;
  value: string;
  valueClass?: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={muted ? 'text-xs text-slate-400' : 'text-slate-600'}>{label}</dt>
      <dd className={clsx('tabular-nums', muted ? 'text-xs' : 'font-medium text-slate-900', valueClass)}>{value}</dd>
    </div>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline"
    >
      <Plus className="h-3.5 w-3.5" /> {children}
    </button>
  );
}

function IconX({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
      aria-label="Remove"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}
