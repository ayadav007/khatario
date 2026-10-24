'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, Info, Plane } from 'lucide-react';
import { SectionLabel } from './Kbd';
import { CURRENCIES, fx, inr, INCOTERMS, type ExportConfig } from '../_lib/mock-data';

const inputCls =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-primary-500 focus:ring-4 focus:ring-primary-100';

type Props = {
  value: ExportConfig;
  onChange: (v: ExportConfig) => void;
  totalInr: number;
};

export function ExportPanel({ value, onChange, totalInr }: Props) {
  const [more, setMore] = useState(false);
  const set = <K extends keyof ExportConfig>(key: K, v: ExportConfig[K]) => onChange({ ...value, [key]: v });
  const foreign = value.currency !== 'INR';
  const missing = [!value.portCode && 'port code', !value.shippingBillNo && 'shipping bill no.'].filter(Boolean);

  return (
    <div className="border-b border-slate-200 bg-amber-50/30 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Plane className="h-4 w-4 text-amber-600" />
          <SectionLabel>Export &amp; shipping</SectionLabel>
        </div>
        {missing.length > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <Info className="h-3 w-3" /> Add {missing.join(' and ')} before filing GSTR-1 (can be added later)
          </span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-500">Export type</span>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-white p-1 ring-1 ring-slate-200">
            {(
              [
                { id: 'lut', label: 'Under LUT', hint: 'IGST 0%' },
                { id: 'igst', label: 'IGST paid', hint: 'Refund later' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => set('type', t.id)}
                className={clsx(
                  'flex h-7 items-center justify-center gap-1 rounded-md text-xs font-semibold transition',
                  value.type === t.id ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
                title={t.hint}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <Field label="Currency">
          <div className="flex gap-1.5">
            <select
              value={value.currency}
              onChange={(e) => {
                const c = CURRENCIES.find((x) => x.code === e.target.value)!;
                onChange({ ...value, currency: c.code, rate: c.rate });
              }}
              className={clsx(inputCls, 'w-[88px] shrink-0 px-2')}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
            {foreign && (
              <div className="flex h-9 min-w-0 flex-1 items-center rounded-lg border border-slate-200 bg-white transition focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-100">
                <span className="pl-2 text-xs text-slate-400">₹</span>
                <input
                  value={value.rate || ''}
                  inputMode="decimal"
                  onChange={(e) => set('rate', Number(e.target.value) || 0)}
                  className="w-full min-w-0 bg-transparent px-1 text-sm font-semibold tabular-nums outline-none"
                  title="Exchange rate: rupees per 1 unit of currency"
                />
              </div>
            )}
          </div>
        </Field>

        <Field label="Port code">
          <input
            value={value.portCode}
            onChange={(e) => set('portCode', e.target.value.toUpperCase())}
            placeholder="INNSA1"
            className={clsx(inputCls, 'font-mono uppercase')}
          />
        </Field>
        <Field label="Shipping bill no.">
          <input
            value={value.shippingBillNo}
            onChange={(e) => set('shippingBillNo', e.target.value)}
            placeholder="7 digits"
            className={inputCls}
          />
        </Field>
        <Field label="Shipping bill date">
          <input
            type="date"
            value={value.shippingBillDate}
            onChange={(e) => set('shippingBillDate', e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      {foreign && value.rate > 0 && totalInr > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">
          Invoice value <span className="font-semibold text-slate-800">{fx(totalInr / value.rate, value.currency)}</span>{' '}
          = {inr(totalInr)} at ₹{value.rate} per {value.currency}. GST returns use the rupee value.
        </p>
      )}

      <button
        type="button"
        onClick={() => setMore((m) => !m)}
        className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-primary-700"
      >
        <ChevronDown className={clsx('h-3.5 w-3.5 transition', more && 'rotate-180')} />
        {more ? 'Fewer shipping details' : 'Ports, incoterms, transport, AWB / BL'}
      </button>

      {more && (
        <div className="mt-2 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Field label="Transport mode">
            <select
              value={value.transportMode}
              onChange={(e) => set('transportMode', e.target.value as ExportConfig['transportMode'])}
              className={inputCls}
            >
              <option value="">Select</option>
              <option>Air</option>
              <option>Sea</option>
              <option>Road</option>
              <option>Courier</option>
            </select>
          </Field>
          {value.transportMode === 'Air' && (
            <Field label="AWB number">
              <input value={value.awbNo} onChange={(e) => set('awbNo', e.target.value)} placeholder="Air waybill" className={inputCls} />
            </Field>
          )}
          {value.transportMode === 'Sea' && (
            <Field label="BL number">
              <input value={value.blNo} onChange={(e) => set('blNo', e.target.value)} placeholder="Bill of lading" className={inputCls} />
            </Field>
          )}
          <Field label="Incoterms">
            <select value={value.incoterms} onChange={(e) => set('incoterms', e.target.value)} className={inputCls}>
              <option value="">Select</option>
              {INCOTERMS.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.code} · {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Port of loading">
            <input value={value.portOfLoading} onChange={(e) => set('portOfLoading', e.target.value)} placeholder="Nhava Sheva" className={inputCls} />
          </Field>
          <Field label="Port of discharge">
            <input value={value.portOfDischarge} onChange={(e) => set('portOfDischarge', e.target.value)} placeholder="Jebel Ali" className={inputCls} />
          </Field>
          <Field label="Place of delivery">
            <input value={value.placeOfDelivery} onChange={(e) => set('placeOfDelivery', e.target.value)} placeholder="Final destination" className={inputCls} />
          </Field>
          <Field label="Country of origin">
            <input value={value.countryOfOrigin} onChange={(e) => set('countryOfOrigin', e.target.value)} className={inputCls} />
          </Field>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
