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
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 border-b border-border bg-surface/95 backdrop-blur-md lg:top-0">
        <div className="px-4 pb-2 pt-3 md:px-6 md:pt-5">
          <h2 className="text-base font-semibold text-text-primary md:text-lg">Recent transactions</h2>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search number or party"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-text-primary outline-none ring-primary-500 focus:ring-2"
              aria-label="Search transactions"
            />
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {RECENT_TX_FILTERS.map((item) => {
              const active = item === filter;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setFilter(item)}
                  className={
                    active
                      ? 'shrink-0 rounded-full bg-primary-600 px-3 py-1 text-xs font-semibold text-white'
                      : 'shrink-0 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-text-secondary'
                  }
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
          {rows.map((tx) => (
            <Link
              key={`${tx.kind}-${tx.id}`}
              href={transactionHref(tx)}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-100/90 dark:hover:bg-slate-800/70 md:px-6"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-primary-600 dark:text-primary-400">
                    {KIND_LABEL[tx.kind] || tx.kind}
                    {tx.doc_number ? ` · ${tx.doc_number}` : ''}
                  </p>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-text-primary">
                    ₹ {Number(tx.amount || 0).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-text-secondary">
                  <span className="truncate">{tx.party}</span>
                  <span className="shrink-0 text-text-muted">·</span>
                  <span className="shrink-0 text-text-muted">
                    {tx.doc_date ? format(new Date(tx.doc_date), 'dd MMM yyyy') : '—'}
                  </span>
                  <StatusBadge status={tx.status || 'final'} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="flex justify-center py-3 pb-8">
        {loadingMore ? <Loader2 className="h-5 w-5 animate-spin text-primary-500" /> : null}
      </div>
    </Card>
  );
}
