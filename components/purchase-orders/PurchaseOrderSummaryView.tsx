'use client';

import React from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';

export interface PurchaseOrderLineItem {
  id?: string;
  item_name?: string;
  description?: string | null;
  qty?: number | string;
  unit?: string | null;
  unit_price?: number | string;
  line_total?: number | string;
  fulfilled_qty?: number | string;
}

export interface PurchaseOrderSummaryProps {
  order: Record<string, unknown>;
  items: PurchaseOrderLineItem[];
}

function formatInr(n: number | string | null | undefined) {
  const num = Number(n ?? 0);
  return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: 'Draft',
    confirmed: 'Open',
    partially_fulfilled: 'Partially received',
    fulfilled: 'Closed',
    cancelled: 'Cancelled',
  };
  return labels[status] || status;
}

function receiveStatusLabel(status: string): string {
  if (status === 'fulfilled') return 'Received';
  if (status === 'partially_fulfilled') return 'Partially received';
  if (status === 'cancelled') return '—';
  if (status === 'confirmed') return 'Yet to be received';
  return 'Draft';
}

function billedStatusLabel(convertedPurchaseId: string | null | undefined, status: string): string {
  if (convertedPurchaseId) return 'Billed';
  if (status === 'fulfilled') return 'Billed';
  return 'Yet to bill';
}

function lineItemStatus(item: PurchaseOrderLineItem, orderBilled: boolean): string {
  const qty = Number(item.qty ?? 0);
  const fulfilled = Number(item.fulfilled_qty ?? 0);
  if (orderBilled && qty > 0) {
    return `${qty} billed`;
  }
  if (fulfilled >= qty && qty > 0) {
    return `${fulfilled} received`;
  }
  if (fulfilled > 0) {
    return `${fulfilled} of ${qty} received`;
  }
  return qty > 0 ? `${qty} pending` : '—';
}

function AddressBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <div className="mt-1 text-sm text-gray-900 whitespace-pre-line">{children}</div>
    </div>
  );
}

export function PurchaseOrderSummaryView({ order, items }: PurchaseOrderSummaryProps) {
  const status = String(order.status ?? 'draft');
  const convertedId = order.converted_purchase_id as string | null | undefined;
  const supplierId = order.supplier_id as string | undefined;
  const supplierName = String(order.party_name ?? order.supplier_name ?? '—');
  const orderBilled = Boolean(convertedId) || status === 'fulfilled';

  const vendorAddress =
    (order.billing_address as string)?.trim() ||
    (order.party_address as string)?.trim() ||
    '—';
  const deliveryAddress = (order.shipping_address as string)?.trim() || '—';

  const totalQty = items.reduce((sum, row) => sum + Number(row.qty ?? 0), 0);
  const subtotal = Number(order.subtotal ?? 0);
  const discount = Number(order.discount_total ?? 0);
  const grandTotal = Number(order.grand_total ?? 0);

  const statusSteps = [
    {
      key: 'order',
      label: 'Order',
      value: statusLabel(status),
      valueClass:
        status === 'fulfilled'
          ? 'text-green-700'
          : status === 'cancelled'
            ? 'text-red-700'
            : 'text-gray-900',
    },
    {
      key: 'receive',
      label: 'Receive',
      value: receiveStatusLabel(status),
      valueClass: 'text-gray-700',
    },
    {
      key: 'bill',
      label: 'Bill',
      value: billedStatusLabel(convertedId, status),
      valueClass: orderBilled ? 'text-green-700' : 'text-gray-700',
    },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 rounded-lg border border-border bg-white p-6 shadow-sm">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-text-secondary">
          Purchase order
        </h3>
        <p className="mt-1 text-lg font-bold text-gray-900">
          Purchase order# {String(order.order_number ?? '—')}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,200px)_1fr]">
        <div className="border-l-2 border-amber-400 pl-4 space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Status</p>
          {statusSteps.map((step) => (
            <div key={step.key}>
              <p className="text-xs text-text-secondary">{step.label}</p>
              <p className={clsx('text-sm font-semibold', step.valueClass)}>{step.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <AddressBlock label="Vendor address">
            {supplierId ? (
              <Link href={`/suppliers/${supplierId}`} className="link-primary font-medium">
                {supplierName}
              </Link>
            ) : (
              <span className="font-medium">{supplierName}</span>
            )}
            {vendorAddress !== '—' && <p className="mt-2 text-text-secondary">{vendorAddress}</p>}
            {order.party_gstin ? (
              <p className="mt-1 text-xs text-text-secondary">GSTIN: {String(order.party_gstin)}</p>
            ) : null}
          </AddressBlock>
          <AddressBlock label="Delivery address">{deliveryAddress}</AddressBlock>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 text-sm">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            Order date
          </p>
          <p className="mt-1 font-medium text-gray-900">{formatDate(order.order_date as string)}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            Expected delivery
          </p>
          <p className="mt-1 font-medium text-gray-900">
            {formatDate(order.expected_delivery_date as string)}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            Payment terms
          </p>
          <p className="mt-1 font-medium text-gray-900">
            {(order.terms as string)?.trim() || '—'}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600">
              <th className="px-4 py-2.5">Items &amp; description</th>
              <th className="px-4 py-2.5 text-right">Ordered</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Rate</th>
              <th className="px-4 py-2.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-text-secondary">
                  No line items
                </td>
              </tr>
            ) : (
              items.map((row, idx) => {
                const qty = Number(row.qty ?? 0);
                const unit = row.unit?.trim() || 'pcs';
                return (
                  <tr key={row.id ?? idx} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-gray-900">{row.item_name || '—'}</p>
                      {row.description ? (
                        <p className="mt-0.5 text-xs text-text-secondary">{row.description}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 whitespace-nowrap">
                      {qty} {unit}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {lineItemStatus(row, orderBilled)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 whitespace-nowrap">
                      {formatInr(row.unit_price)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 whitespace-nowrap">
                      {formatInr(row.line_total)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <div className="w-full max-w-xs space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-text-secondary">Sub total</span>
            <span className="font-medium text-gray-900">{formatInr(subtotal)}</span>
          </div>
          <p className="text-right text-xs text-text-secondary">Total quantity: {totalQty}</p>
          {discount > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-text-secondary">Discount</span>
              <span className="text-gray-900">{formatInr(discount)}</span>
            </div>
          )}
          {Number(order.tax_total ?? 0) > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-text-secondary">Tax</span>
              <span className="text-gray-900">{formatInr(order.tax_total as number)}</span>
            </div>
          )}
          {Number(order.round_off ?? 0) !== 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-text-secondary">Round off</span>
              <span className="text-gray-900">{formatInr(order.round_off as number)}</span>
            </div>
          )}
          <div className="flex justify-between gap-4 border-t border-border pt-2">
            <span className="font-semibold text-gray-900">Total</span>
            <span className="text-lg font-bold text-gray-900">{formatInr(grandTotal)}</span>
          </div>
        </div>
      </div>

      {order.notes ? (
        <div className="rounded-lg border border-border bg-gray-50 p-4 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">Notes</p>
          <p className="mt-1 text-gray-900 whitespace-pre-line">{String(order.notes)}</p>
        </div>
      ) : null}
    </div>
  );
}
