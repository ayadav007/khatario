'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, Info, Plane } from 'lucide-react';
import type { ComposerExportState } from './types';
import { Field, fx, inputCls, inr, NumberInput, SectionLabel } from './ui';

const CURRENCIES = [
  { code: 'INR', label: 'INR' },
  { code: 'USD', label: 'USD' },
  { code: 'EUR', label: 'EUR' },
  { code: 'GBP', label: 'GBP' },
  { code: 'AED', label: 'AED' },
  { code: 'SGD', label: 'SGD' },
];

const INCOTERMS = [
  { code: 'EXW', label: 'Ex Works' },
  { code: 'FCA', label: 'Free Carrier' },
  { code: 'FOB', label: 'Free On Board' },
  { code: 'CFR', label: 'Cost and Freight' },
  { code: 'CIF', label: 'Cost, Insurance & Freight' },
  { code: 'DDP', label: 'Delivered Duty Paid' },
];

export function ExportPanel({
  value,
  onChange,
  totalInr,
  readOnly,
  documentType,
}: {
  value: ComposerExportState;
  onChange: (patch: Partial<ComposerExportState>) => void;
  totalInr: number;
  readOnly: boolean;
  documentType: string;
}) {
  const hasShipping =
    !!(value.transportMode || value.incoterms || value.portOfLoading || value.portOfDischarge || value.placeOfDelivery || value.awbNumber || value.blNumber);
  const [more, setMore] = useState(hasShipping);
  const foreign = value.invoiceCurrency !== 'INR';
  const rate = typeof value.exchangeRate === 'number' ? value.exchangeRate : 0;
  const missing = [!value.portCode && 'port code', !value.shippingBillNumber && 'shipping bill no.'].filter(Boolean);
  const nonTaxable = documentType === 'bill_of_supply';

  return (
    <div className="border-b border-border bg-amber-50/30 p-4 dark:bg-amber-950/10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Plane className="h-4 w-4 text-amber-600" />
          <SectionLabel>Export &amp; shipping</SectionLabel>
        </div>
        {missing.length > 0 && !readOnly && (
          <span className="flex items-center gap-1 text-[11px] text-text-secondary">
            <Info className="h-3 w-3" /> Add {missing.join(' and ')} before filing GSTR-1 (can be added later)
          </span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        {!nonTaxable && (
          <div>
            <span className="mb-1 block text-xs font-medium text-text-secondary">Export type</span>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface p-1 ring-1 ring-border">
              {(
                [
                  { id: 'wop', label: 'Under LUT', hint: 'Without payment of IGST (0%)' },
                  { id: 'wp', label: 'IGST paid', hint: 'With payment of IGST, refund later' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={readOnly}
                  onClick={() => onChange({ exportType: t.id })}
                  className={clsx(
                    'flex h-7 items-center justify-center rounded-md text-xs font-semibold transition disabled:cursor-not-allowed',
                    value.exportType === t.id ? 'bg-primary-600 text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'
                  )}
                  title={t.hint}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <Field label="Currency">
          <div className="flex gap-1.5">
            <select
              value={value.invoiceCurrency}
              onChange={(e) => onChange({ invoiceCurrency: e.target.value, ...(e.target.value === 'INR' ? { exchangeRate: '' } : {}) })}
              disabled={readOnly}
              className={clsx(inputCls, 'w-[80px] shrink-0 px-2')}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
            {foreign && (
              <div className="flex h-9 min-w-0 flex-1 items-center rounded-lg border border-border bg-surface transition focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-100">
                <span className="pl-2 text-xs text-text-muted">₹</span>
                <NumberInput
                  value={rate}
                  onValue={(n) => onChange({ exchangeRate: n || '' })}
                  disabled={readOnly}
                  placeholder="83.25"
                  title="Exchange rate: rupees per 1 unit of currency"
                  className="w-full min-w-0 bg-transparent px-1 text-sm font-semibold tabular-nums text-text-primary outline-none"
                />
              </div>
            )}
          </div>
        </Field>

        <Field label="Port code">
          <input
            value={value.portCode}
            onChange={(e) => onChange({ portCode: e.target.value.toUpperCase() })}
            placeholder="INNSA1"
            disabled={readOnly}
            className={clsx(inputCls, 'font-mono uppercase')}
          />
        </Field>
        <Field label="Shipping bill no.">
          <input
            value={value.shippingBillNumber}
            onChange={(e) => onChange({ shippingBillNumber: e.target.value })}
            placeholder="7 digits"
            disabled={readOnly}
            className={inputCls}
          />
        </Field>
        <Field label="Shipping bill date">
          <input
            type="date"
            value={value.shippingBillDate}
            onChange={(e) => onChange({ shippingBillDate: e.target.value })}
            disabled={readOnly}
            className={inputCls}
          />
        </Field>
        <Field label="Buyer tax / VAT ID">
          <input
            value={value.buyerTaxId}
            onChange={(e) => onChange({ buyerTaxId: e.target.value })}
            placeholder="TRN / VAT no."
            disabled={readOnly}
            className={inputCls}
          />
        </Field>
      </div>

      {foreign && rate > 0 && totalInr > 0 && (
        <p className="mt-2 text-[11px] text-text-secondary">
          Invoice value ≈ <span className="font-semibold text-text-primary">{fx(totalInr / rate, value.invoiceCurrency)}</span> ={' '}
          {inr(totalInr)} at ₹{rate} per {value.invoiceCurrency}. Item prices and GST returns stay in rupees.
        </p>
      )}

      <button
        type="button"
        onClick={() => setMore((m) => !m)}
        className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-primary-700"
      >
        <ChevronDown className={clsx('h-3.5 w-3.5 transition', more && 'rotate-180')} />
        {more ? 'Fewer shipping details' : 'Ports, incoterms, transport, AWB / BL'}
      </button>

      {more && (
        <div className="mt-2 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Field label="Transport mode">
            <select
              value={value.transportMode}
              onChange={(e) => onChange({ transportMode: e.target.value })}
              disabled={readOnly}
              className={inputCls}
            >
              <option value="">Select</option>
              <option value="Air">Air</option>
              <option value="Sea">Sea</option>
              <option value="Road">Road</option>
              <option value="Courier">Courier</option>
            </select>
          </Field>
          {(value.transportMode === 'Air' || value.awbNumber) && (
            <Field label="AWB number">
              <input
                value={value.awbNumber}
                onChange={(e) => onChange({ awbNumber: e.target.value })}
                placeholder="Air waybill"
                disabled={readOnly}
                className={inputCls}
              />
            </Field>
          )}
          {(value.transportMode === 'Sea' || value.blNumber) && (
            <Field label="BL number">
              <input
                value={value.blNumber}
                onChange={(e) => onChange({ blNumber: e.target.value })}
                placeholder="Bill of lading"
                disabled={readOnly}
                className={inputCls}
              />
            </Field>
          )}
          <Field label="Incoterms">
            <select
              value={value.incoterms}
              onChange={(e) => onChange({ incoterms: e.target.value })}
              disabled={readOnly}
              className={inputCls}
            >
              <option value="">Select</option>
              {INCOTERMS.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.code} · {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Port of loading">
            <input
              value={value.portOfLoading}
              onChange={(e) => onChange({ portOfLoading: e.target.value })}
              placeholder="Nhava Sheva"
              disabled={readOnly}
              className={inputCls}
            />
          </Field>
          <Field label="Port of discharge">
            <input
              value={value.portOfDischarge}
              onChange={(e) => onChange({ portOfDischarge: e.target.value })}
              placeholder="Jebel Ali"
              disabled={readOnly}
              className={inputCls}
            />
          </Field>
          <Field label="Place of delivery">
            <input
              value={value.placeOfDelivery}
              onChange={(e) => onChange({ placeOfDelivery: e.target.value })}
              placeholder="Final destination"
              disabled={readOnly}
              className={inputCls}
            />
          </Field>
          <Field label="Country of origin">
            <input
              value={value.countryOfOrigin}
              onChange={(e) => onChange({ countryOfOrigin: e.target.value })}
              disabled={readOnly}
              className={inputCls}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
