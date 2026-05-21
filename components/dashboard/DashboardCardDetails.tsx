'use client';

import React from 'react';
import { X, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { format } from 'date-fns';
import { Chip } from '@/components/ui/Chip';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

interface Invoice {
  id: string;
  invoice_number: string;
  customer_name?: string;
  invoice_date: string;
  grand_total: number;
  paid_amount: number;
  balance_amount: number;
  payment_status: string;
  status: string;
}

interface Purchase {
  id: string;
  bill_number: string | null;
  supplier_name?: string;
  bill_date: string;
  grand_total: number;
  paid_amount: number;
  status: string;
}

interface CollectionPayment {
  id: string;
  customer_name?: string | null;
  payment_date: string;
  amount: number;
  payment_mode: string;
  reference_type: string | null;
  reference_id: string | null;
  invoice_number?: string | null;
  invoice_id?: string | null;
  notes?: string | null;
}

interface DashboardCardDetailsProps {
  type: 'sales' | 'purchases' | 'receivables' | 'payables' | 'collection';
  title: string;
  data: Invoice[] | Purchase[] | CollectionPayment[];
  loading?: boolean;
  onClose: () => void;
}

function formatStatusLabel(status: string) {
  return status.replace(/_/g, ' ');
}

function invoiceChipVariant(invoice: Invoice): 'success' | 'warning' | 'default' | 'secondary' {
  if (invoice.payment_status === 'paid') return 'success';
  if (invoice.payment_status === 'partially_paid') return 'warning';
  if (invoice.status === 'final') return 'default';
  return 'secondary';
}

function purchaseChipVariant(purchase: Purchase): 'success' | 'secondary' | 'default' {
  if (purchase.status === 'final') return 'success';
  if (purchase.status === 'draft') return 'secondary';
  return 'default';
}

function paymentAmount(amount: number) {
  return Math.abs(Number(amount || 0));
}

function formatPaymentMode(mode: string) {
  if (!mode) return '—';
  return mode.replace(/_/g, ' ');
}

function collectionRowHref(payment: CollectionPayment) {
  if (payment.invoice_id) return `/invoices/${payment.invoice_id}`;
  return '/payments/in';
}

function collectionRowLabel(payment: CollectionPayment) {
  if (payment.invoice_number) return payment.invoice_number;
  return payment.customer_name || 'Payment received';
}

export function DashboardCardDetails({ type, title, data, loading = false, onClose }: DashboardCardDetailsProps) {
  const isCollection = type === 'collection';
  const isInvoiceType = type === 'sales' || type === 'receivables';

  const total = data.reduce((sum: number, item: any) => {
    if (isCollection) return sum + paymentAmount(item.amount);
    return sum + Number(item.grand_total || 0);
  }, 0);

  const renderMobileList = () => (
    <div className="divide-y divide-border md:hidden">
      {data.map((item: any) => {
        if (isCollection) {
          const payment = item as CollectionPayment;
          const amount = paymentAmount(payment.amount);
          const href = collectionRowHref(payment);

          return (
            <Link
              key={payment.id}
              href={href}
              onClick={onClose}
              className="flex items-center gap-2.5 px-3 py-2.5 transition-colors active:bg-slate-100/90 dark:active:bg-slate-800/70"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold text-primary-600 dark:text-primary-400">
                    {collectionRowLabel(payment)}
                  </p>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-green-600">
                    +₹{amount.toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-secondary">
                  <span className="truncate">{payment.customer_name || 'Cash sale'}</span>
                  <span className="shrink-0 text-text-muted">·</span>
                  <span className="shrink-0 whitespace-nowrap">
                    {format(new Date(payment.payment_date), 'dd MMM yyyy')}
                  </span>
                  <span className="shrink-0 text-text-muted">·</span>
                  <span className="shrink-0 capitalize">{formatPaymentMode(payment.payment_mode)}</span>
                </div>
              </div>
            </Link>
          );
        }

        if (isInvoiceType) {
          const invoice = item as Invoice;
          const balance =
            Number(invoice.balance_amount || invoice.grand_total) - Number(invoice.paid_amount || 0);
          const href = `/invoices/${invoice.id}`;

          return (
            <Link
              key={invoice.id}
              href={href}
              onClick={onClose}
              className="flex items-center gap-2.5 px-3 py-2.5 transition-colors active:bg-slate-100/90 dark:active:bg-slate-800/70"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-semibold text-primary-600 dark:text-primary-400">
                    {invoice.invoice_number}
                  </p>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-text-primary">
                    ₹{Number(invoice.grand_total).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-secondary">
                  <span className="truncate">{invoice.customer_name || 'Cash Sale'}</span>
                  <span className="shrink-0 text-text-muted">·</span>
                  <span className="shrink-0 whitespace-nowrap">
                    {format(new Date(invoice.invoice_date), 'dd MMM yyyy')}
                  </span>
                  {type === 'receivables' && balance > 0 ? (
                    <>
                      <span className="shrink-0 text-text-muted">·</span>
                      <span className="shrink-0 font-medium text-warning">
                        Due ₹{balance.toLocaleString('en-IN')}
                      </span>
                    </>
                  ) : (
                    <Chip variant={invoiceChipVariant(invoice)} className="!py-0 !text-[10px]">
                      {formatStatusLabel(invoice.payment_status || invoice.status)}
                    </Chip>
                  )}
                </div>
              </div>
            </Link>
          );
        }

        const purchase = item as Purchase;
        const balance = Number(purchase.grand_total) - Number(purchase.paid_amount || 0);
        const href = `/purchases/new?edit=${purchase.id}`;

        return (
          <Link
            key={purchase.id}
            href={href}
            onClick={onClose}
            className="flex items-center gap-2.5 px-3 py-2.5 transition-colors active:bg-slate-100/90 dark:active:bg-slate-800/70"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-semibold text-primary-600 dark:text-primary-400">
                  {purchase.bill_number || purchase.id.slice(0, 8)}
                </p>
                <p className="shrink-0 text-sm font-bold tabular-nums text-text-primary">
                  ₹{Number(purchase.grand_total).toLocaleString('en-IN')}
                </p>
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-secondary">
                <span className="truncate">{purchase.supplier_name || 'N/A'}</span>
                <span className="shrink-0 text-text-muted">·</span>
                <span className="shrink-0 whitespace-nowrap">
                  {format(new Date(purchase.bill_date), 'dd MMM yyyy')}
                </span>
                {type === 'payables' && balance > 0 ? (
                  <>
                    <span className="shrink-0 text-text-muted">·</span>
                    <span className="shrink-0 font-medium text-error">
                      Due ₹{balance.toLocaleString('en-IN')}
                    </span>
                  </>
                ) : (
                  <Chip variant={purchaseChipVariant(purchase)} className="!py-0 !text-[10px]">
                    {purchase.status}
                  </Chip>
                )}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );

  const renderDesktopTable = () => (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border">
            {isCollection ? (
              <>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Date</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Mode</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Invoice #</th>
                <th className="px-4 py-3 text-right font-medium text-text-secondary">Amount</th>
              </>
            ) : isInvoiceType ? (
              <>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Invoice #</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Date</th>
                <th className="px-4 py-3 text-right font-medium text-text-secondary">Amount</th>
                {type === 'receivables' && (
                  <>
                    <th className="px-4 py-3 text-right font-medium text-text-secondary">Paid</th>
                    <th className="px-4 py-3 text-right font-medium text-text-secondary">Balance</th>
                  </>
                )}
                <th className="px-4 py-3 text-center font-medium text-text-secondary">Status</th>
              </>
            ) : (
              <>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Bill #</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Supplier</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Date</th>
                <th className="px-4 py-3 text-right font-medium text-text-secondary">Amount</th>
                {type === 'payables' && (
                  <>
                    <th className="px-4 py-3 text-right font-medium text-text-secondary">Paid</th>
                    <th className="px-4 py-3 text-right font-medium text-text-secondary">Balance</th>
                  </>
                )}
                <th className="px-4 py-3 text-center font-medium text-text-secondary">Status</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {data.map((item: any) => {
            if (isCollection) {
              const payment = item as CollectionPayment;
              const amount = paymentAmount(payment.amount);
              const href = collectionRowHref(payment);

              return (
                <tr
                  key={payment.id}
                  className="border-b border-border hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
                >
                  <td className="px-4 py-3 text-sm text-text-primary">
                    {payment.customer_name || 'Cash sale'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-text-secondary">
                    {format(new Date(payment.payment_date), 'dd MMM yyyy')}
                  </td>
                  <td className="px-4 py-3 text-sm capitalize text-text-secondary">
                    {formatPaymentMode(payment.payment_mode)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {payment.invoice_id && payment.invoice_number ? (
                      <Link
                        href={href}
                        className="font-medium text-primary-600 hover:underline dark:text-primary-400"
                        onClick={onClose}
                      >
                        {payment.invoice_number}
                      </Link>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-green-600">
                    +₹{amount.toLocaleString('en-IN')}
                  </td>
                </tr>
              );
            }

            if (isInvoiceType) {
              const invoice = item as Invoice;
              const balance =
                Number(invoice.balance_amount || invoice.grand_total) - Number(invoice.paid_amount || 0);

              return (
                <tr
                  key={invoice.id}
                  className="border-b border-border hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="font-medium text-primary-600 hover:underline dark:text-primary-400"
                      onClick={onClose}
                    >
                      {invoice.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-text-primary">
                    {invoice.customer_name || 'Cash Sale'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-text-secondary">
                    {format(new Date(invoice.invoice_date), 'dd MMM yyyy')}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-text-primary">
                    ₹{Number(invoice.grand_total).toLocaleString('en-IN')}
                  </td>
                  {type === 'receivables' && (
                    <>
                      <td className="px-4 py-3 text-right text-sm tabular-nums text-text-secondary">
                        ₹{Number(invoice.paid_amount || 0).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-warning">
                        ₹{balance.toLocaleString('en-IN')}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-3 text-center">
                    <Chip variant={invoiceChipVariant(invoice)}>
                      {formatStatusLabel(invoice.payment_status || invoice.status)}
                    </Chip>
                  </td>
                </tr>
              );
            }

            const purchase = item as Purchase;
            const balance = Number(purchase.grand_total) - Number(purchase.paid_amount || 0);

            return (
              <tr
                key={purchase.id}
                className="border-b border-border hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/purchases/new?edit=${purchase.id}`}
                    className="font-medium text-primary-600 hover:underline dark:text-primary-400"
                    onClick={onClose}
                  >
                    {purchase.bill_number || purchase.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-text-primary">{purchase.supplier_name || 'N/A'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-text-secondary">
                  {format(new Date(purchase.bill_date), 'dd MMM yyyy')}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums text-text-primary">
                  ₹{Number(purchase.grand_total).toLocaleString('en-IN')}
                </td>
                {type === 'payables' && (
                  <>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-text-secondary">
                      ₹{Number(purchase.paid_amount || 0).toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-error">
                      ₹{balance.toLocaleString('en-IN')}
                    </td>
                  </>
                )}
                <td className="px-4 py-3 text-center">
                  <Chip variant={purchaseChipVariant(purchase)}>{purchase.status}</Chip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <Card className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl sm:rounded-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 md:px-6 md:py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-text-primary md:text-xl">{title}</h2>
            <p className="mt-0.5 text-xs text-text-secondary md:text-sm">
              Total: ₹{total.toLocaleString('en-IN')} • {data.length}{' '}
              {data.length === 1 ? 'item' : 'items'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto md:p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
            </div>
          ) : data.length === 0 ? (
            <div className="py-12 text-center text-sm text-text-secondary">
              <p>No {title.toLowerCase()} found</p>
            </div>
          ) : (
            <>
              {renderMobileList()}
              {renderDesktopTable()}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3 md:gap-3 md:px-6 md:py-4">
          <Button variant="ghost" size="sm" onClick={onClose} className="md:h-10 md:px-4 md:text-sm">
            Close
          </Button>
          {isInvoiceType && (
            <Link href="/invoices" onClick={onClose}>
              <Button size="sm" className="md:h-10 md:px-4 md:text-sm">
                View All Invoices
              </Button>
            </Link>
          )}
          {(type === 'purchases' || type === 'payables') && (
            <Link href="/purchases" onClick={onClose}>
              <Button size="sm" className="md:h-10 md:px-4 md:text-sm">
                View All Purchases
              </Button>
            </Link>
          )}
          {type === 'collection' && (
            <Link href="/payments/in" onClick={onClose}>
              <Button size="sm" className="md:h-10 md:px-4 md:text-sm">
                View All Payments
              </Button>
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
