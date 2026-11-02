'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Loader2, Search } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { RECENT_TX_FILTERS, type RecentTxFilter } from '@/lib/dashboard/recent-transactions';

type Transaction = {
  id: string;
  kind: string;
  doc_number: string;
  party: string;
  doc_date: string | null;
  sort_at: string;
  amount: number;
  status: string;
};

const FILTER_LABEL: Record<RecentTxFilter, string> = {
  all: 'All',
  invoice: 'Invoice',
  purchase: 'Purchase',
  payment: 'Payment',
  return: 'Return',
  expense: 'Expense',
};

const KIND_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  purchase: 'Purchase',
  payment_in: 'Payment in',
  payment_out: 'Payment out',
  credit_note: 'Credit note',
  purchase_return: 'Purchase return',
  expense: 'Expense',
};

/** Kinds that bring money in (green); everything else is money out (orange). Fixed colours, not brand. */
const MONEY_IN_KINDS = new Set(['invoice', 'payment_in', 'purchase_return']);

function transactionHref(tx: { id: string; kind: string }): string {
  switch (tx.kind) {
    case 'invoice':
      return `/invoices/${tx.id}`;
    case 'purchase':
      return `/purchases/${tx.id}`;
    case 'payment_in':
      return '/payments/in';
    case 'payment_out':
      return '/payments/out';
    case 'credit_note':
      return `/credit-notes/${tx.id}`;
    case 'purchase_return':
      return `/purchase-returns/${tx.id}`;
    case 'expense':
      return '/expenses';
    default:
      return '/dashboard';
  }
}

export function RecentTransactionsFeed() {
  const [filter, setFilter] = useState<RecentTxFilter>('all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [rows, setRows] = useState<Transaction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef<Transaction[]>([]);
  const generation = useRef(0);
  rowsRef.current = rows;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadPage = useCallback(async (append: boolean, gen: number) => {
    const params = new URLSearchParams({ kind: filter });
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (append) {
      const last = rowsRef.current[rowsRef.current.length - 1];
      if (!last) return;
      params.set('before', new Date(last.sort_at).toISOString());
      params.set('before_id', last.id);
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch(`/api/dashboard/recent-transactions?${params}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({}));
      if (gen !== generation.current) return;
      if (!response.ok) {
        setError(body.error || 'Could not load transactions');
        if (!append) setRows([]);
        setHasMore(false);
        return;
      }
      const next = (body.transactions || []) as Transaction[];
      setRows((prev) => (append ? [...prev, ...next] : next));
      setHasMore(Boolean(body.hasMore));
    } catch {
      if (gen !== generation.current) return;
      setError('Could not load transactions');
      if (!append) setRows([]);
      setHasMore(false);
    } finally {
      if (gen === generation.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [debouncedQuery, filter]);

  useEffect(() => {
    const gen = ++generation.current;
    rowsRef.current = [];
    setRows([]);
    setHasMore(false);
    void loadPage(false, gen);
  }, [filter, debouncedQuery, loadPage]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !loadingMore) {
          void loadPage(true, generation.current);
        }
      },
      { rootMargin: '240px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadPage, loading, loadingMore]);

  return (
    <Card className="overflow-hidden" padding="none">
      <div className="z-20 border-b border-border bg-surface/95 backdrop-blur-md lg:sticky lg:top-0">
        <div className="px-4 pt-3 md:px-6 md:pt-5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 className="text-base font-bold text-text-primary md:text-lg">Recent transactions</h2>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search number or party"
                className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-text-primary outline-none ring-primary-500 focus:ring-2"
                aria-label="Search transactions"
              />
            </div>
          </div>
          <div className="mt-2 flex gap-5 overflow-x-auto" role="tablist" aria-label="Transaction type">
            {RECENT_TX_FILTERS.map((item) => {
              const active = item === filter;
              return (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(item)}
                  className={`shrink-0 border-b-2 px-1 py-2.5 text-xs font-semibold transition-colors md:text-sm ${
                    active
                      ? 'border-accent-500 text-text-primary'
                      : 'border-transparent text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {FILTER_LABEL[item]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
        </div>
      ) : error ? (
        <div className="px-4 py-8 text-center text-sm text-text-secondary">{error}</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-text-secondary">
          {debouncedQuery || filter !== 'all' ? 'No transactions match this search.' : 'No recent transactions yet.'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((tx) => {
            const date = tx.doc_date ? new Date(tx.doc_date) : null;
            const moneyIn = MONEY_IN_KINDS.has(tx.kind);
            return (
              <Link
                key={`${tx.kind}-${tx.id}`}
                href={transactionHref(tx)}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-100/90 dark:hover:bg-slate-800/70 md:gap-4 md:px-6"
              >
                <div
                  className={`w-11 shrink-0 rounded-lg py-1 text-center md:w-12 ${
                    moneyIn ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-background dark:bg-slate-800/60'
                  }`}
                  title={date ? format(date, 'dd MMM yyyy') : undefined}
                >
                  <p className="text-sm font-extrabold leading-tight tabular-nums text-text-primary md:text-base">
                    {date ? format(date, 'dd') : '—'}
                  </p>
                  <p className="text-2xs font-bold uppercase text-text-secondary">
                    {date ? format(date, 'MMM') : ''}
                  </p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-text-primary">
                    <span
                      className={
                        moneyIn ? 'text-emerald-700 dark:text-emerald-300' : 'text-orange-700 dark:text-orange-300'
                      }
                    >
                      {KIND_LABEL[tx.kind] || tx.kind}
                    </span>
                    {tx.doc_number ? ` · ${tx.doc_number}` : ''}
                  </p>
                  <p className="truncate text-xs text-text-secondary">{tx.party}</p>
                </div>
                <div className="hidden shrink-0 sm:block">
                  <StatusBadge status={tx.status || 'final'} />
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-extrabold tabular-nums text-text-primary md:text-base">
                    ₹ {Number(tx.amount || 0).toLocaleString('en-IN')}
                  </p>
                  <div className="sm:hidden">
                    <StatusBadge status={tx.status || 'final'} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div ref={sentinelRef} className="flex justify-center py-3 pb-8">
        {loadingMore ? <Loader2 className="h-5 w-5 animate-spin text-primary-500" /> : null}
      </div>
    </Card>
  );
}
