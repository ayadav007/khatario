'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { UpgradePrompt } from '@/components/subscription/UpgradePrompt';
import { getFeatureDisplayName } from '@/lib/feature-upgrade-labels';

export type DeletedEntityType = 'invoice' | 'purchase' | 'payment' | 'supplier';

export interface DeletedItemRow {
  id: string;
  type: DeletedEntityType;
  number: string;
  party: string;
  amount: number;
  deleted_at: string;
}

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

function typeLabel(t: DeletedEntityType): string {
  switch (t) {
    case 'invoice':
      return 'Invoice';
    case 'purchase':
      return 'Purchase';
    case 'payment':
      return 'Payment';
    case 'supplier':
      return 'Supplier';
    default:
      return t;
  }
}

export default function DeletedItemsReportPage() {
  const toast = useToastContext();
  const { business, user } = useAuth();
  const [rows, setRows] = useState<DeletedItemRow[]>([]);
  const [canRestore, setCanRestore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<'all' | DeletedEntityType>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const queryString = useMemo(() => {
    if (!business?.id || !user?.id) return '';
    const q = new URLSearchParams({
      business_id: business.id,
      user_id: user.id,
      type: typeFilter,
    });
    if (dateFrom) q.set('date_from', dateFrom);
    if (dateTo) q.set('date_to', dateTo);
    return q.toString();
  }, [business?.id, user?.id, typeFilter, dateFrom, dateTo]);

  const fetchItems = useCallback(async () => {
    if (!business?.id || !user?.id || !queryString) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/deleted-items?${queryString}`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || `Failed to load deleted items (${res.status})`);
        setRows([]);
        setCanRestore(false);
        return;
      }
      setRows(Array.isArray(data.items) ? data.items : []);
      setCanRestore(data.can_restore === true);
    } catch {
      toast.error('Could not load deleted items.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, queryString, toast]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const restoreRow = async (row: DeletedItemRow) => {
    if (!business?.id || !user?.id) return;
    const urls: Record<DeletedEntityType, string> = {
      invoice: '/api/invoices/restore',
      purchase: '/api/purchases/restore',
      payment: '/api/payments/restore',
      supplier: '/api/suppliers/restore',
    };
    setRestoringId(row.id);
    try {
      const res = await fetch(urls[row.type], {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id,
          business_id: business.id,
          user_id: user.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403 && data.code === 'FEATURE_NOT_IN_PLAN') {
          setShowUpgrade(true);
          return;
        }
        toast.error(data.error || 'Restore failed.');
        return;
      }
      toast.success(`Restored ${typeLabel(row.type).toLowerCase()} ${row.number}`);
      await fetchItems();
    } catch {
      toast.error('Restore failed.');
    } finally {
      setRestoringId(null);
    }
  };

  const onRestoreClick = (row: DeletedItemRow) => {
    if (!canRestore) {
      setShowUpgrade(true);
      return;
    }
    void restoreRow(row);
  };

  return (
    <>
      <div className="space-y-6 px-4 py-6 max-w-6xl mx-auto">
        <Breadcrumbs />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
              <Trash2 className="h-7 w-7 text-gray-700" aria-hidden />
              Deleted items
            </h1>
            <p className="text-sm text-text-secondary mt-1">
              Invoices, purchases, payments, and suppliers that were removed from lists (soft-deleted).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-white p-4 dark:bg-slate-900/40">
          <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
            Type
            <select
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary"
              value={typeFilter}
              onChange={(e) =>
                setTypeFilter(e.target.value as 'all' | DeletedEntityType)
              }
            >
              <option value="all">All types</option>
              <option value="invoice">Invoices</option>
              <option value="purchase">Purchases</option>
              <option value="payment">Payments</option>
              <option value="supplier">Suppliers</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
            Deleted from
            <input
              type="date"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
            Deleted until
            <input
              type="date"
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>

        <div className="rounded-xl border border-border bg-white overflow-hidden dark:bg-slate-900/40">
          {loading ? (
            <div className="flex min-h-[240px] items-center justify-center text-text-secondary gap-2">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[280px] px-6 text-center text-text-secondary">
              <Trash2 className="h-12 w-12 text-gray-300 mb-3" aria-hidden />
              <p className="text-text-primary font-medium">Nothing in the bin</p>
              <p className="text-sm mt-1 max-w-md">
                Deleted transactions appear here. Adjust filters or date range to see older
                removals.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary dark:bg-slate-800/60">
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Number</th>
                    <th className="px-4 py-3">Party</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Deleted at</th>
                    <th className="px-4 py-3 w-32">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={`${row.type}-${row.id}`}
                      className="border-b border-border last:border-0 hover:bg-gray-50/80 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-3 text-text-primary">{typeLabel(row.type)}</td>
                      <td className="px-4 py-3 font-mono text-text-primary">{row.number}</td>
                      <td className="px-4 py-3 text-text-primary max-w-[200px] truncate" title={row.party}>
                        {row.party}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                        {INR.format(row.amount)}
                      </td>
                      <td className="px-4 py-3 text-text-secondary whitespace-nowrap">
                        {row.deleted_at
                          ? new Date(row.deleted_at).toLocaleString(undefined, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onRestoreClick(row)}
                          disabled={restoringId === row.id}
                          className={clsx(
                            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition',
                            canRestore
                              ? 'border-border text-text-primary hover:bg-gray-50'
                              : 'border-border text-text-secondary cursor-pointer hover:bg-gray-50',
                            restoringId === row.id && 'opacity-60'
                          )}
                          title={
                            canRestore
                              ? 'Restore this record'
                              : `${getFeatureDisplayName('soft_delete')} requires a higher plan`
                          }
                        >
                          {restoringId === row.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showUpgrade && (
        <UpgradePrompt
          limitType="feature"
          featureKey="soft_delete"
          featureName={getFeatureDisplayName('soft_delete')}
          onClose={() => setShowUpgrade(false)}
        />
      )}
    </>
  );
}
