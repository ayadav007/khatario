'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { CalendarClock, ChevronDown, Home, Info, MapPin, Plane } from 'lucide-react';
import { Kbd, SectionLabel } from './Kbd';
import {
  addDays,
  fmtDate,
  nextRecurringDate,
  PAYMENT_TERMS,
  RECURRING_FREQUENCIES,
  type RecurringConfig,
} from '../_lib/mock-data';

type Props = {
  invoiceNo: string;
  setInvoiceNo: (v: string) => void;
  invoiceDate: string;
  setInvoiceDate: (v: string) => void;
  termsDays: number;
  setTermsDays: (v: number) => void;
  placeOfSupply: string;
  sellerState: string;
  sellerFromProfile: boolean;
  isInterState: boolean;
  exportEnabled: boolean;
  exportType: 'lut' | 'igst';
  onToggleExport: (enabled: boolean) => void;
  recurring: RecurringConfig;
  setRecurring: (v: RecurringConfig) => void;
};

const inputCls =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-primary-500 focus:ring-4 focus:ring-primary-100';

export function InvoiceDetailsPanel({
  invoiceNo,
  setInvoiceNo,
  invoiceDate,
  setInvoiceDate,
  termsDays,
  setTermsDays,
  placeOfSupply,
  sellerState,
  sellerFromProfile,
  isInterState,
  exportEnabled,
  exportType,
  onToggleExport,
  recurring,
  setRecurring,
}: Props) {
  const [more, setMore] = useState(false);
  const due = addDays(invoiceDate, termsDays);
  const on = recurring.enabled;

  return (
    <div className="flex min-w-0 flex-col p-4">
      <div className="mb-3 flex h-7 items-center justify-between">
        <SectionLabel>Invoice details</SectionLabel>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
          <CalendarClock className={clsx('h-3.5 w-3.5', on ? 'text-primary-600' : 'text-slate-400')} />
          Recurring
          <button
            type="button"
            role="switch"
            aria-checked={on}
            onClick={() => setRecurring({ ...recurring, enabled: !on })}
            className={clsx('relative h-5 w-9 rounded-full transition', on ? 'bg-primary-600' : 'bg-slate-300')}
          >
            <span
              className={clsx(
                'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                on ? 'left-[18px]' : 'left-0.5'
              )}
            />
          </button>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <div className="col-span-2 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
          {(
            [
              { id: false, label: 'Domestic', icon: Home },
              { id: true, label: 'Export', icon: Plane },
            ] as const
          ).map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => onToggleExport(opt.id)}
              className={clsx(
                'inline-flex h-7 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition',
                exportEnabled === opt.id ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              <opt.icon className="h-3.5 w-3.5" />
              {opt.label}
              {opt.id && <Kbd className="ml-0.5 h-4 min-w-[16px] text-[9px]">Alt E</Kbd>}
            </button>
          ))}
        </div>

        <Field label="Invoice no.">
          <div className="flex h-9 items-center overflow-hidden rounded-lg border border-slate-200 bg-white transition focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-100">
            <span className="flex h-full items-center border-r border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-500">
              {exportEnabled ? 'EXP/26-27/' : 'INV/26-27/'}
            </span>
            <input
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              className="w-full min-w-0 bg-transparent px-2 text-sm font-semibold text-slate-900 outline-none"
            />
          </div>
        </Field>
        <Field label="Invoice date">
          <input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className={inputCls}
          />
        </Field>

        <div className="col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Payment terms</span>
            <span className={clsx('text-xs font-semibold', termsDays ? 'text-amber-600' : 'text-slate-500')}>
              Due {fmtDate(due)}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
            {PAYMENT_TERMS.map((t) => (
              <button
                key={t.days}
                type="button"
                onClick={() => setTermsDays(t.days)}
                className={clsx(
                  'h-7 rounded-md text-xs font-semibold transition',
                  termsDays === t.days ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="text-xs text-slate-500">Place of supply</span>
            <span className="truncate text-xs font-semibold text-slate-800">{placeOfSupply}</span>
            <span
              className={clsx(
                'ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                exportEnabled
                  ? 'bg-amber-50 text-amber-700'
                  : isInterState
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'bg-primary-50 text-primary-700'
              )}
            >
              {exportEnabled ? (exportType === 'lut' ? 'IGST 0% · LUT' : 'IGST paid') : isInterState ? 'IGST' : 'CGST + SGST'}
            </span>
          </div>
          <p className="mt-1 pl-5 text-[11px] leading-snug text-slate-500">
            {exportEnabled ? (
              <>
                Export of goods: supply is outside India, so it is always IGST.{' '}
                {exportType === 'lut'
                  ? 'Under LUT the rate is 0% and no tax is paid.'
                  : 'IGST is charged now and refunded later on export.'}
              </>
            ) : (
              <>
                Your GST state <span className="font-semibold text-slate-700">{sellerState}</span>
                {sellerFromProfile ? ' (from Business profile)' : ' (sample, set state in Business profile)'}
                {isInterState ? ' differs from delivery state, so IGST.' : ' matches delivery state, so CGST + SGST.'}
              </>
            )}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setMore((m) => !m)}
        className="mt-2.5 inline-flex items-center gap-1 self-start text-xs font-semibold text-slate-500 hover:text-primary-700"
      >
        <ChevronDown className={clsx('h-3.5 w-3.5 transition', more && 'rotate-180')} />
        {more ? 'Fewer details' : 'PO no., E-way bill, vehicle, sales person'}
      </button>
      {more && (
        <div className="mt-2 grid grid-cols-2 gap-2.5">
          <Field label="PO no.">
            <input className={inputCls} placeholder="PO-1234" />
          </Field>
          <Field
            label={
              <span className="inline-flex items-center gap-1">
                E-way bill no. <Info className="h-3 w-3 text-slate-400" />
              </span>
            }
          >
            <input className={inputCls} placeholder="12-digit EWB" />
          </Field>
          <Field label="Vehicle no.">
            <input className={inputCls} placeholder="MH 12 AB 1234" />
          </Field>
          <Field label="Sales person">
            <input className={inputCls} placeholder="Select" />
          </Field>
        </div>
      )}

      {on && <RecurringSettings invoiceDate={invoiceDate} value={recurring} onChange={setRecurring} />}
    </div>
  );
}

function RecurringSettings({
  invoiceDate,
  value,
  onChange,
}: {
  invoiceDate: string;
  value: RecurringConfig;
  onChange: (v: RecurringConfig) => void;
}) {
  const freq = RECURRING_FREQUENCIES.find((f) => f.id === value.frequency)!;
  const next = fmtDate(nextRecurringDate(invoiceDate, value.frequency));

  return (
    <div className="mt-3 rounded-xl border border-primary-200 bg-primary-50/50 p-3">
      <div className="grid grid-cols-4 gap-1 rounded-lg bg-white p-1 ring-1 ring-slate-200">
        {RECURRING_FREQUENCIES.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange({ ...value, frequency: f.id })}
            className={clsx(
              'h-7 rounded-md text-xs font-semibold transition',
              value.frequency === f.id ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="mb-1.5 mt-3 text-xs font-semibold text-slate-700">Each new invoice</p>
      <div className="space-y-1.5">
        {(
          [
            {
              id: 'review',
              title: 'Quantities change: create a draft for me',
              hint: 'You get a reminder, update quantities, then send. Best for usage, delivery or monthly supplies.',
            },
            {
              id: 'fixed',
              title: 'Same items and quantities: issue automatically',
              hint: 'Issued and sent on WhatsApp without review. Best for rent, AMC and fixed retainers.',
            },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange({ ...value, quantityMode: opt.id })}
            className={clsx(
              'flex w-full items-start gap-2.5 rounded-lg border bg-white p-2.5 text-left transition',
              value.quantityMode === opt.id ? 'border-primary-500 ring-2 ring-primary-100' : 'border-slate-200 hover:border-slate-300'
            )}
          >
            <span
              className={clsx(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                value.quantityMode === opt.id ? 'border-primary-600 bg-primary-600' : 'border-slate-300'
              )}
            >
              {value.quantityMode === opt.id && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-900">{opt.title}</span>
              <span className="block text-[11px] leading-snug text-slate-500">{opt.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-700">Ends</span>
        <select
          value={value.ends}
          onChange={(e) => onChange({ ...value, ends: e.target.value as RecurringConfig['ends'] })}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-primary-500"
        >
          <option value="never">Never (until I stop it)</option>
          <option value="count">After a number of invoices</option>
        </select>
        {value.ends === 'count' && (
          <input
            value={value.count}
            inputMode="numeric"
            onChange={(e) => onChange({ ...value, count: Math.max(1, Number(e.target.value) || 1) })}
            className="h-8 w-14 rounded-lg border border-slate-200 bg-white px-2 text-center text-xs font-semibold outline-none focus:border-primary-500"
          />
        )}
      </div>

      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-white px-2.5 py-2 text-[11px] leading-snug text-slate-600 ring-1 ring-slate-200">
        <CalendarClock className="mt-px h-3.5 w-3.5 shrink-0 text-primary-600" />
        <span>
          Next invoice on <span className="font-semibold text-slate-900">{next}</span>, then {freq.adverb}
          {value.ends === 'count' ? ` for ${value.count} invoices` : ''}.{' '}
          {value.quantityMode === 'review'
            ? 'It will wait as a draft until you confirm quantities.'
            : 'It will be issued and sent automatically.'}
        </span>
      </p>
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
