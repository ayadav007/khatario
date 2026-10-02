'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, ChevronDown, Home, Loader2, MapPin, Plane, Warehouse } from 'lucide-react';
import type { ComposerDocType, ComposerMoreDetails } from './types';
import { addDaysIso, daysBetween, Field, fmtDate, inputCls, Kbd, PAYMENT_TERMS, SectionLabel } from './ui';

type Props = {
  documentType: ComposerDocType;
  numberLabel: string;
  invoicePrefix: string | null;
  invoiceNumber: string | null;
  offlineNumber: string | null;
  seriesLoading: boolean;
  seriesError: string | null;
  invoiceDate: string;
  setInvoiceDate: (v: string) => void;
  isFutureDate: boolean;
  dueDate: string;
  setDueDate: (v: string) => void;
  placeOfSupply: string;
  setPlaceOfSupply: (v: string) => void;
  states: string[];
  sellerState: string;
  sellerStateCode: string;
  posStateCode: string;
  isIntraState: boolean;
  isExport: boolean;
  exportType: 'wp' | 'wop';
  onToggleExport: (enabled: boolean) => void;
  warehouses: Array<{ id: string; name: string; warehouse_code?: string; is_primary?: boolean }>;
  warehousesLoading: boolean;
  selectedWarehouseId: string;
  setSelectedWarehouseId: (v: string) => void;
  readOnly: boolean;
};

export function DetailsPanel(p: Props) {
  const termDays = p.dueDate ? daysBetween(p.invoiceDate, p.dueDate) : null;
  const nonTaxable = p.documentType === 'bill_of_supply';
  const docNo =
    p.offlineNumber || (p.invoicePrefix && p.invoiceNumber ? `${p.invoicePrefix}-${p.invoiceNumber}` : null);

  const taxBadge = nonTaxable
    ? 'No GST'
    : p.isExport
      ? p.exportType === 'wop'
        ? 'IGST 0% · LUT'
        : 'IGST paid'
      : p.isIntraState
        ? 'CGST + SGST'
        : 'IGST';

  return (
    <div className="flex min-w-0 flex-col p-4">
      <div className="mb-3 flex h-7 items-center justify-between">
        <SectionLabel>Invoice details</SectionLabel>
        {p.warehouses.length > 0 && (
          <label className="flex min-w-0 items-center gap-1.5 text-xs text-text-secondary" title="Stock is reduced from this warehouse">
            <Warehouse className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <select
              value={p.selectedWarehouseId}
              onChange={(e) => p.setSelectedWarehouseId(e.target.value)}
              disabled={p.readOnly || p.warehousesLoading}
              className="h-7 max-w-[160px] truncate rounded-md border border-border bg-surface px-1.5 text-xs font-medium text-text-primary outline-none focus:border-primary-500 disabled:opacity-60"
            >
              {p.warehouses.map((wh) => (
                <option key={wh.id} value={wh.id}>
                  {wh.name}
                  {wh.warehouse_code ? ` (${wh.warehouse_code})` : ''}
                  {wh.is_primary ? ' · primary' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {!p.readOnly && (
          <div className="col-span-2 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                { id: false, label: 'Domestic', icon: Home },
                { id: true, label: 'Export', icon: Plane },
              ] as const
            ).map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => p.onToggleExport(opt.id)}
                className={clsx(
                  'inline-flex h-7 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition',
                  p.isExport === opt.id
                    ? 'bg-surface text-primary-700 shadow-sm dark:text-primary-300'
                    : 'text-text-secondary hover:text-text-primary'
                )}
              >
                <opt.icon className="h-3.5 w-3.5" />
                {opt.label}
                {opt.id && <Kbd className="ml-0.5 h-4 min-w-[16px] text-[9px]">Alt E</Kbd>}
              </button>
            ))}
          </div>
        )}

        <Field label={p.numberLabel}>
          <div
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-slate-50 px-2.5 dark:bg-slate-800/50"
            title="Numbers come from your document series settings"
          >
            {docNo ? (
              <span className="truncate text-sm font-bold tabular-nums text-text-primary">{docNo}</span>
            ) : p.seriesLoading ? (
              <span className="flex items-center gap-1.5 text-xs text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </span>
            ) : (
              <span className="truncate text-xs text-amber-700">{p.seriesError || 'Number not ready'}</span>
            )}
          </div>
        </Field>
        <Field
          label="Date"
          hint={p.isFutureDate ? <span className="text-amber-700">Date is in the future</span> : undefined}
        >
          <input
            type="date"
            value={p.invoiceDate}
            onChange={(e) => p.setInvoiceDate(e.target.value)}
            disabled={p.readOnly}
            className={inputCls}
          />
        </Field>

        <div className="col-span-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-text-secondary">Payment terms</span>
            <span className={clsx('truncate text-xs font-semibold', p.dueDate ? 'text-amber-600' : 'text-text-muted')}>
              {!p.dueDate
                ? 'No due date'
                : termDays != null && termDays > 0
                  ? `${termDays} days credit · due ${fmtDate(p.dueDate)}`
                  : `Due ${fmtDate(p.dueDate)}`}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {PAYMENT_TERMS.map((t) => {
              const active = t.days === 0 ? !p.dueDate : termDays === t.days;
              return (
                <button
                  key={t.days}
                  type="button"
                  disabled={p.readOnly}
                  onClick={() => p.setDueDate(t.days === 0 ? '' : addDaysIso(p.invoiceDate, t.days))}
                  title={t.days === 0 ? 'No credit period: payment due on the invoice date' : `Payment due ${t.label} after the invoice date`}
                  className={clsx(
                    'h-7 truncate whitespace-nowrap rounded-md px-1 text-xs font-semibold transition disabled:cursor-not-allowed',
                    active
                      ? 'bg-surface text-primary-700 shadow-sm dark:text-primary-300'
                      : 'text-text-secondary hover:text-text-primary'
                  )}
                >
                  {t.days === 0 ? 'No credit' : t.label}
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Due date" className="col-span-2">
          <input
            type="date"
            value={p.dueDate}
            min={p.invoiceDate}
            onChange={(e) => p.setDueDate(e.target.value)}
            disabled={p.readOnly}
            aria-label="Due date"
            className={inputCls}
          />
        </Field>

        <div className="col-span-2 rounded-lg border border-border bg-slate-50/60 px-2.5 py-2 dark:bg-slate-800/40">
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <span className="shrink-0 text-xs text-text-secondary">Place of supply</span>
            {p.isExport ? (
              <span className="truncate text-xs font-semibold text-text-primary">96 - Other country</span>
            ) : (
              <select
                value={p.placeOfSupply}
                onChange={(e) => p.setPlaceOfSupply(e.target.value)}
                disabled={p.readOnly}
                className="h-6 min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-0.5 text-xs font-semibold text-text-primary outline-none hover:border-border focus:border-primary-500 disabled:opacity-80"
              >
                <option value="">Select state</option>
                {p.states.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            <span
              className={clsx(
                'ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                nonTaxable
                  ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  : p.isExport
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                    : p.isIntraState
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                      : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
              )}
            >
              {taxBadge}
            </span>
          </div>
          <p className="mt-1 pl-5 text-[11px] leading-snug text-text-secondary">
            {nonTaxable ? (
              'Bill of supply: no GST is charged on this document.'
            ) : p.isExport ? (
              <>
                Export: supply is outside India, so it is always IGST.{' '}
                {p.exportType === 'wop'
                  ? 'Under LUT the rate is 0% and no tax is paid.'
                  : 'IGST is charged now and refunded later.'}
              </>
            ) : p.sellerStateCode ? (
              <>
                Your GST state{' '}
                <span className="font-semibold text-text-primary">
                  {p.sellerState || p.sellerStateCode}
                </span>{' '}
                (Business profile){' '}
                {p.isIntraState ? 'matches the place of supply, so CGST + SGST.' : 'differs from the place of supply, so IGST.'}
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <AlertTriangle className="h-3 w-3" /> Set your state in Business profile to get the right GST split.
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export function MoreDetailsPanel({
  value,
  onChange,
  readOnly,
  customFields,
  defaultOpen,
}: {
  value: ComposerMoreDetails;
  onChange: (patch: Partial<ComposerMoreDetails>) => void;
  readOnly: boolean;
  customFields: React.ReactNode | null;
  defaultOpen: boolean;
}) {
  const filled = Object.values(value).filter((v) => String(v || '').trim()).length;
  const [open, setOpen] = useState(defaultOpen || filled > 0);
  const text = (key: keyof ComposerMoreDetails, label: string, placeholder?: string) => (
    <Field label={label}>
      <input
        value={value[key]}
        onChange={(e) => onChange({ [key]: e.target.value })}
        placeholder={placeholder}
        disabled={readOnly}
        className={inputCls}
      />
    </Field>
  );
  const date = (key: keyof ComposerMoreDetails, label: string) => (
    <Field label={label}>
      <input
        type="date"
        value={value[key]}
        onChange={(e) => onChange({ [key]: e.target.value })}
        disabled={readOnly}
        className={inputCls}
      />
    </Field>
  );

  return (
    <div className="border-b border-border px-4 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-primary-700"
      >
        <ChevronDown className={clsx('h-3.5 w-3.5 transition', open && 'rotate-180')} />
        {open ? 'Hide' : 'Show'} PO, E-way bill, dispatch &amp; references
        {filled > 0 && !open && (
          <span className="rounded-full bg-primary-50 px-1.5 text-[10px] font-bold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
            {filled} filled
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2.5 space-y-3 pb-1.5">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            {text('purchaseOrderNumber', 'PO number', 'PO-1234')}
            {date('purchaseOrderDate', 'PO date')}
            {text('ewayBillNumber', 'E-way bill no.', '12-digit EWB')}
            {date('ewayBillDate', 'E-way bill date')}
            {text('referenceNumber', 'Reference no.')}
            {text('deliveryNote', 'Delivery note')}
            {text('paymentTerms', 'Mode / terms of payment')}
            {text('otherReferences', 'Other references')}
            {text('dispatchedThrough', 'Dispatched through', 'Transporter / vehicle')}
            {text('destination', 'Destination')}
            <Field label="Terms of delivery" className="md:col-span-2">
              <input
                value={value.termsOfDelivery}
                onChange={(e) => onChange({ termsOfDelivery: e.target.value })}
                disabled={readOnly}
                className={inputCls}
              />
            </Field>
          </div>
          {customFields && (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs font-semibold text-text-secondary">Custom fields</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{customFields}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
