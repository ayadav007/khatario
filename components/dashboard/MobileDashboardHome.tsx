'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import { MobileListRow } from '@/components/layout/MobileList';

type InvoiceRow = {
  id: string;
  invoice_number?: string;
  customer_name?: string | null;
  invoice_date?: string;
  grand_total?: number | string;
  payment_status?: string | null;
};

type Props = {
  periodLabel: string;
  sales: number;
  purchases: number;
  toCollect: number;
  toPay: number;
  recentInvoices: InvoiceRow[];
  onOpen: (type: 'sales' | 'purchases' | 'receivables' | 'payables') => void;
};

function inr(value: number) {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function Tile({
  label,
  hint,
  value,
  onClick,
  href,
}: {
  label: string;
  hint?: string;
  value?: string;
  onClick?: () => void;
  href?: string;
}) {
  const className =
    'flex min-h-[4.75rem] w-full items-center justify-between gap-2 border-b border-r border-border bg-surface px-4 py-3 text-left active:bg-slate-50 dark:active:bg-slate-800/50';
  const body = (
    <>
      <span className="min-w-0">
        <span className="block truncate text-xs text-text-secondary">{label}</span>
        {value ? (
          <span className="mt-0.5 block truncate text-base font-semibold tabular-nums text-text-primary">
            {value}
          </span>
        ) : null}
        {hint ? <span className="mt-0.5 block truncate text-xs text-text-muted">{hint}</span> : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

export function MobileDashboardHome({
  periodLabel,
  sales,
  purchases,
  toCollect,
  toPay,
  recentInvoices,
  onOpen,
}: Props) {
  return (
    <div className="-mx-page-x lg:hidden">
      <div className="grid grid-cols-2 border-l border-t border-border">
        <Tile label="To collect" value={inr(toCollect)} onClick={() => onOpen('receivables')} />
        <Tile label="To pay" value={inr(toPay)} onClick={() => onOpen('payables')} />
        <Tile label="Sales" hint={periodLabel} value={inr(sales)} onClick={() => onOpen('sales')} />
        <Tile label="Purchases" hint={periodLabel} value={inr(purchases)} onClick={() => onOpen('purchases')} />
        <div className="col-span-2">
          <Tile label="Reports" hint="Sales, purchases, GST" href="/reports" />
        </div>
      </div>

      <h2 className="px-4 pb-1 pt-4 text-xs font-medium text-text-secondary">Recent invoices</h2>
      <div className="divide-y divide-border border-y border-border bg-surface">
        {recentInvoices.length > 0 ? (
          recentInvoices.map((invoice) => {
            const payment = String(invoice.payment_status || '').replace(/_/g, ' ');
            const when = invoice.invoice_date ? format(new Date(invoice.invoice_date), 'dd MMM') : '';
            return (
              <MobileListRow
                key={invoice.id}
                href={`/invoices/${invoice.id}`}
                label={invoice.customer_name || 'Cash Sale'}
                hint={[invoice.invoice_number, when].filter(Boolean).join(' · ')}
                trailing={
                  <span className="text-right">
                    <span className="block text-sm font-semibold tabular-nums text-text-primary">
                      {inr(Number(invoice.grand_total || 0))}
                    </span>
                    {payment ? (
                      <span className="block text-xs capitalize text-text-secondary">{payment}</span>
                    ) : null}
                  </span>
                }
              />
            );
          })
        ) : (
          <p className="px-4 py-6 text-center text-sm text-text-secondary">No recent invoices.</p>
        )}
      </div>
    </div>
  );
}
