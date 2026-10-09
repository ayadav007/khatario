'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export type LinkableInvoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  grand_total: number;
  balance_amount: number;
};

export type PaymentLink = {
  id: string;
  number: string;
  date: string;
  total: number;
  balance: number;
  amount: number;
};

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

type Props = {
  open: boolean;
  customerName: string;
  received: number;
  initialLinks: PaymentLink[];
  loadInvoices: (search: string) => Promise<LinkableInvoice[]>;
  onClose: () => void;
  onDone: (received: number, links: PaymentLink[]) => void;
};

export function LinkPaymentDialog({
  open,
  customerName,
  received: receivedInitial,
  initialLinks,
  loadInvoices,
  onClose,
  onDone,
}: Props) {
  const [receivedText, setReceivedText] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<LinkableInvoice[]>([]);
  const [links, setLinks] = useState<Record<string, PaymentLink>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReceivedText(receivedInitial > 0 ? String(receivedInitial) : '');
    setSearch('');
    setDebounced('');
    const next: Record<string, PaymentLink> = {};
    for (const link of initialLinks) next[link.id] = link;
    setLinks(next);
  }, [open, receivedInitial, initialLinks]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadInvoices(debounced)
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load open invoices');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debounced, loadInvoices]);

  const received = r2(Number(receivedText) || 0);
  const linkedTotal = r2(Object.values(links).reduce((sum, link) => sum + r2(link.amount), 0));
  const unused = r2(received - linkedTotal);
  const overAllocated = unused < -0.001;
  const lineOverBalance = Object.values(links).some((link) => r2(link.amount) - r2(link.balance) > 0.001);

  const visible = useMemo(() => rows, [rows]);

  if (!open) return null;

  const setLinkAmount = (invoice: LinkableInvoice, amount: number) => {
    const balance = r2(invoice.balance_amount);
    const nextAmount = r2(Math.max(0, amount));
    setLinks((prev) => ({
      ...prev,
      [invoice.id]: {
        id: invoice.id,
        number: invoice.invoice_number,
        date: invoice.invoice_date,
        total: r2(invoice.grand_total),
        balance,
        amount: nextAmount,
      },
    }));
  };

  const toggle = (invoice: LinkableInvoice) => {
    setLinks((prev) => {
      if (prev[invoice.id]) {
        const next = { ...prev };
        delete next[invoice.id];
        return next;
      }
      const used = Object.values(prev).reduce((sum, link) => sum + r2(link.amount), 0);
      const room = r2(Math.max(0, received - used));
      const balance = r2(invoice.balance_amount);
      return {
        ...prev,
        [invoice.id]: {
          id: invoice.id,
          number: invoice.invoice_number,
          date: invoice.invoice_date,
          total: r2(invoice.grand_total),
          balance,
          amount: r2(Math.min(balance, room)),
        },
      };
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-t-xl bg-white shadow-xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Link payment to invoices</h2>
            <p className="mt-1 text-sm text-gray-500">
              Party <span className="font-medium text-gray-800">{customerName}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-primary-700">Received</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={receivedText}
              onChange={(event) => setReceivedText(event.target.value)}
              className="w-36 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-800"
            onClick={() => setLinks({})}
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </div>

          <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
            <select
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              defaultValue="all"
              aria-label="Transaction type"
            >
              <option value="all">All transactions</option>
              <option value="sale">Sale</option>
            </select>
            <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search invoice number"
              className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm"
              aria-label="Search invoices"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-gray-500">{error}</p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">No open invoices for this customer.</p>
          ) : (
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="w-10 px-2 py-2" />
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Invoice no.</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2 text-right">Balance</th>
                  <th className="px-2 py-2 text-right">Linked amount</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((invoice) => {
                  const link = links[invoice.id];
                  const checked = Boolean(link);
                  return (
                    <tr key={invoice.id} className={checked ? 'bg-primary-50' : 'border-t border-gray-100'}>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(invoice)}
                          aria-label={`Link ${invoice.invoice_number}`}
                        />
                      </td>
                      <td className="px-2 py-2">{invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString('en-IN') : '—'}</td>
                      <td className="px-2 py-2">Sale</td>
                      <td className="px-2 py-2 font-medium">{invoice.invoice_number}</td>
                      <td className="px-2 py-2 text-right">{r2(invoice.grand_total).toLocaleString('en-IN')}</td>
                      <td className="px-2 py-2 text-right">{r2(invoice.balance_amount).toLocaleString('en-IN')}</td>
                      <td className="px-2 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={!checked}
                          value={checked ? link.amount : ''}
                          onChange={(event) => setLinkAmount(invoice, Number(event.target.value))}
                          className="w-28 rounded border border-gray-300 px-2 py-1 text-right disabled:bg-gray-50"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 px-4 py-3">
          <p className={`mr-auto text-sm ${overAllocated || lineOverBalance ? 'text-red-600' : 'text-gray-600'}`}>
            Unused amount: ₹{unused.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            {lineOverBalance ? ' · A linked amount is above the invoice balance' : ''}
          </p>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={overAllocated || lineOverBalance || received < 0}
            onClick={() =>
              onDone(
                received,
                Object.values(links).filter((link) => r2(link.amount) > 0)
              )
            }
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
