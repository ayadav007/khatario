'use client';

import { Loader2, MapPin } from 'lucide-react';
import { Field, fmtDate, inputCls, SectionLabel } from '@/components/invoices/composer/ui';

type Props = {
  orderNumber: string;
  setOrderNumber: (v: string) => void;
  orderDate: string;
  setOrderDate: (v: string) => void;
  expectedDeliveryDate: string;
  setExpectedDeliveryDate: (v: string) => void;
  placeOfSupply: string;
  setPlaceOfSupply: (v: string) => void;
  states: readonly string[];
  sellerState: string;
  isIntraState: boolean;
  seriesLoading: boolean;
  readOnly: boolean;
};

export function OrderDetailsPanel(p: Props) {
  return (
    <div className="flex min-w-0 flex-col p-4">
      <div className="mb-3 flex h-7 items-center">
        <SectionLabel>Order details</SectionLabel>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Field label="Order no." className="col-span-2">
          {p.readOnly ? (
            <div className="flex h-9 items-center rounded-lg border border-border bg-slate-50 px-2.5 dark:bg-slate-800/50">
              <span className="truncate text-sm font-bold tabular-nums text-text-primary">
                {p.orderNumber || '—'}
              </span>
            </div>
          ) : p.seriesLoading && !p.orderNumber ? (
            <div className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-slate-50 px-2.5 text-xs text-text-muted dark:bg-slate-800/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : (
            <input
              value={p.orderNumber}
              onChange={(e) => p.setOrderNumber(e.target.value)}
              className={inputCls}
              placeholder="SO-001"
            />
          )}
        </Field>

        <Field label="Order date">
          <input
            type="date"
            value={p.orderDate}
            onChange={(e) => p.setOrderDate(e.target.value)}
            disabled={p.readOnly}
            className={inputCls}
          />
          {p.orderDate ? (
            <span className="mt-1 block text-[11px] text-text-muted">{fmtDate(p.orderDate)}</span>
          ) : null}
        </Field>

        <Field label="Expected delivery">
          <input
            type="date"
            value={p.expectedDeliveryDate}
            onChange={(e) => p.setExpectedDeliveryDate(e.target.value)}
            disabled={p.readOnly}
            className={inputCls}
          />
        </Field>

        <Field label="Place of supply" className="col-span-2">
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <select
              value={p.placeOfSupply}
              onChange={(e) => p.setPlaceOfSupply(e.target.value)}
              disabled={p.readOnly}
              className={`${inputCls} pl-8`}
            >
              <option value="">Select state</option>
              {p.states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <span className="mt-1 block text-[11px] text-text-muted">
            Seller: {p.sellerState || '—'} · {p.isIntraState ? 'CGST + SGST' : 'IGST'}
          </span>
        </Field>
      </div>
    </div>
  );
}
