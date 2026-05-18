'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  Loader2,
  RefreshCw,
  FileSpreadsheet,
  TrendingUp,
  TrendingDown,
  Plus,
  Minus,
  SlidersHorizontal,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

const REORDER_PAGE_SIZE = 25;

interface StockSummaryRow {
  total_items: number;
  total_stock_qty: number;
  stock_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
}

interface StockHealth {
  healthy_stock_count: number;
  low_stock_count: number;
  critical_stock_count: number;
  dead_stock_count: number;
}

interface ValueAnalysis {
  total_purchase_value: number;
  total_selling_value: number;
  potential_profit: number;
}

interface ReorderRow {
  id: string;
  name: string;
  current_stock: number;
  unit: string;
  avg_daily_sales: number;
  days_left: number | null;
  suggested_order_qty: number;
}

interface AgingBuckets {
  bucket_0_30: number;
  bucket_30_60: number;
  bucket_60_plus: number;
}

interface VelocityItem {
  id: string;
  name: string;
  quantity_sold_30d: number;
}

interface RecentActivityRow {
  item_name: string;
  type: 'purchase' | 'sale' | 'adjustment';
  quantity: number;
  timestamp: string;
}

interface LowStockItem {
  id: string;
  name: string;
  current_stock: number;
  min_stock: number;
  unit: string;
  selling_price: number;
}

interface HighValueItem {
  id: string;
  name: string;
  current_stock: number;
  unit: string;
  purchase_price: number;
  selling_price: number;
  stock_value: number;
}

interface ReorderPagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

function formatInr(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? parseFloat(n) : Number(n ?? 0);
  if (Number.isNaN(v)) return '₹0.00';
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatQty(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? parseFloat(n) : Number(n ?? 0);
  if (Number.isNaN(v)) return '0';
  return v.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function reorderRowClass(daysLeft: number | null): string {
  if (daysLeft == null || Number.isNaN(daysLeft)) return '';
  if (daysLeft < 3) return 'bg-red-50/80 dark:bg-red-950/25';
  if (daysLeft < 7) return 'bg-amber-50/80 dark:bg-amber-950/20';
  return '';
}

function SectionDetails({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group border border-border rounded-lg bg-white dark:bg-slate-900/40 overflow-hidden"
    >
      <summary className="cursor-pointer list-none flex items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-text-primary hover:bg-gray-50 dark:hover:bg-slate-800/50 select-none">
        <span>{title}</span>
        <ChevronRight className="w-4 h-4 shrink-0 transition-transform group-open:rotate-90 text-text-secondary" />
      </summary>
      <div className="px-4 pb-4 pt-0 border-t border-border">{children}</div>
    </details>
  );
}

export default function StockSummaryReportPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<StockSummaryRow | null>(null);
  const [stockHealth, setStockHealth] = useState<StockHealth | null>(null);
  const [valueAnalysis, setValueAnalysis] = useState<ValueAnalysis | null>(null);
  const [reorderSuggestions, setReorderSuggestions] = useState<ReorderRow[]>([]);
  const [reorderPagination, setReorderPagination] = useState<ReorderPagination | null>(null);
  const [agingBuckets, setAgingBuckets] = useState<AgingBuckets | null>(null);
  const [velocity, setVelocity] = useState<{ fastMoving: VelocityItem[]; slowMoving: VelocityItem[] } | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivityRow[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [highValueItems, setHighValueItems] = useState<HighValueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reorderOffset, setReorderOffset] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!business?.id || !user?.id) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      business_id: business.id,
      user_id: user.id,
      reorder_limit: String(REORDER_PAGE_SIZE),
      reorder_offset: String(reorderOffset),
    });

    (async () => {
      try {
        const res = await fetch(`/api/reports/stock-summary?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          const msg =
            res.status === 403
              ? data.error || 'You do not have permission to view this report.'
              : data.error || 'Failed to load stock summary.';
          setError(msg);
          setSummary(null);
          setStockHealth(null);
          setValueAnalysis(null);
          setReorderSuggestions([]);
          setReorderPagination(null);
          setAgingBuckets(null);
          setVelocity(null);
          setRecentActivity([]);
          setLowStockItems([]);
          setHighValueItems([]);
          if (res.status !== 403) toast.error(msg);
          return;
        }

        setSummary(data.summary);
        setStockHealth(data.stockHealth ?? null);
        setValueAnalysis(data.valueAnalysis ?? null);
        setReorderSuggestions(data.reorderSuggestions ?? []);
        setReorderPagination(data.reorderPagination ?? null);
        setAgingBuckets(data.agingBuckets ?? null);
        setVelocity(data.velocity ?? null);
        setRecentActivity(data.recentActivity ?? []);
        setLowStockItems(data.lowStockItems ?? []);
        setHighValueItems(data.highValueItems ?? []);
      } catch (e) {
        if (cancelled) return;
        console.error('Stock summary fetch error:', e);
        setError('Failed to load stock summary.');
        toast.error('Failed to load stock summary.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [business?.id, user?.id, reorderOffset, reloadNonce]);

  const refresh = () => {
    setReorderOffset(0);
    setReloadNonce((n) => n + 1);
  };

  const agingTotal = useMemo(() => {
    if (!agingBuckets) return 0;
    return agingBuckets.bucket_0_30 + agingBuckets.bucket_30_60 + agingBuckets.bucket_60_plus;
  }, [agingBuckets]);

  const exportCsv = () => {
    if (!summary || !valueAnalysis || !stockHealth) return;

    const lines: string[] = [];
    lines.push('Inventory Intelligence — Stock Summary (live export)');
    lines.push('');
    lines.push('KPI (top row)');
    lines.push(`Total stock value (purchase),${valueAnalysis.total_purchase_value}`);
    lines.push(`Potential profit (at list price),${valueAnalysis.potential_profit}`);
    lines.push(`Items to reorder (velocity rule),${reorderPagination?.total ?? reorderSuggestions.length}`);
    lines.push(`Dead stock SKUs (qty on hand no sales 30d),${stockHealth.dead_stock_count}`);
    lines.push('');
    lines.push('Legacy summary');
    lines.push(`Total items,${summary.total_items}`);
    lines.push(`Total quantity,${summary.total_stock_qty}`);
    lines.push(`Stock value (at purchase),${summary.stock_value}`);
    lines.push(`Low stock count (<= min),${summary.low_stock_count}`);
    lines.push(`Out of stock count,${summary.out_of_stock_count}`);
    lines.push('');
    lines.push('Stock health');
    lines.push(`Healthy,${stockHealth.healthy_stock_count}`);
    lines.push(`Low (between 50% and 100% of min),${stockHealth.low_stock_count}`);
    lines.push(`Critical (<= 50% of min),${stockHealth.critical_stock_count}`);
    lines.push(`Dead (on-hand no sales 30d),${stockHealth.dead_stock_count}`);
    lines.push('');
    lines.push('Value analysis');
    lines.push(`Total purchase value,${valueAnalysis.total_purchase_value}`);
    lines.push(`Total selling value,${valueAnalysis.total_selling_value}`);
    lines.push(`Potential profit,${valueAnalysis.potential_profit}`);
    lines.push('');
    if (agingBuckets) {
      lines.push('Stock aging (SKUs with stock by last inbound date)');
      lines.push(`0-30 days,${agingBuckets.bucket_0_30}`);
      lines.push(`30-60 days,${agingBuckets.bucket_30_60}`);
      lines.push(`60+ days,${agingBuckets.bucket_60_plus}`);
      lines.push('');
    }
    lines.push(
      `Reorder suggestions (page offset ${reorderPagination?.offset ?? 0}; total ${reorderPagination?.total ?? reorderSuggestions.length})`
    );
    lines.push('Item,Current stock,Unit,Avg daily sales,Days left,Suggested order qty');
    for (const row of reorderSuggestions) {
      lines.push(
        [
          `"${row.name.replace(/"/g, '""')}"`,
          row.current_stock,
          row.unit,
          row.avg_daily_sales,
          row.days_left ?? '',
          row.suggested_order_qty,
        ].join(',')
      );
    }
    lines.push('');
    lines.push('Fast moving (30d qty)');
    lines.push('Name,Qty');
    for (const row of velocity?.fastMoving ?? []) {
      lines.push([`"${row.name.replace(/"/g, '""')}"`, row.quantity_sold_30d].join(','));
    }
    lines.push('');
    lines.push('Slow moving (30d qty, non-zero)');
    lines.push('Name,Qty');
    for (const row of velocity?.slowMoving ?? []) {
      lines.push([`"${row.name.replace(/"/g, '""')}"`, row.quantity_sold_30d].join(','));
    }
    lines.push('');
    lines.push('Recent activity');
    lines.push('Item,Type,Quantity,Timestamp');
    for (const row of recentActivity) {
      lines.push(
        [`"${row.item_name.replace(/"/g, '""')}"`, row.type, row.quantity, row.timestamp].join(',')
      );
    }
    lines.push('');
    lines.push('Low stock items (<= min)');
    lines.push('Name,Current stock,Min stock,Unit,Selling price');
    for (const row of lowStockItems) {
      lines.push(
        [`"${row.name.replace(/"/g, '""')}"`, row.current_stock, row.min_stock, row.unit, row.selling_price].join(',')
      );
    }
    lines.push('');
    lines.push('High value items (top 10 at cost)');
    lines.push('Name,Quantity,Unit,Purchase price,Stock value');
    for (const row of highValueItems) {
      lines.push(
        [`"${row.name.replace(/"/g, '""')}"`, row.current_stock, row.unit, row.purchase_price, row.stock_value].join(
          ','
        )
      );
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-intelligence-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const activityIcon = (type: RecentActivityRow['type']) => {
    switch (type) {
      case 'purchase':
        return <Plus className="w-4 h-4 text-emerald-600" aria-hidden />;
      case 'sale':
        return <Minus className="w-4 h-4 text-primary-600" aria-hidden />;
      default:
        return <SlidersHorizontal className="w-4 h-4 text-amber-600" aria-hidden />;
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Inventory Intelligence</h1>
          <p className="text-sm text-text-secondary mt-1 max-w-2xl">
            Stock summary with velocity-based reorder signals, health buckets, aging, and recent movement — built for
            quick decisions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={refresh} disabled={loading || !business?.id}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading…
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </>
            )}
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={!summary || !valueAnalysis || !stockHealth}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {loading && !summary ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      ) : summary && valueAnalysis && stockHealth ? (
        <>
          {/* Top decision KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card padding="md" className="border border-border">
              <div className="text-text-secondary text-sm mb-1">Total stock value</div>
              <p className="text-2xl font-bold text-text-primary">{formatInr(valueAnalysis.total_purchase_value)}</p>
              <p className="text-xs text-text-secondary mt-1">At purchase cost (on-hand × purchase price)</p>
            </Card>
            <Card padding="md" className="border border-border">
              <div className="text-text-secondary text-sm mb-1">Potential profit</div>
              <p className="text-2xl font-bold text-text-primary">{formatInr(valueAnalysis.potential_profit)}</p>
              <p className="text-xs text-text-secondary mt-1">If sold at list: selling − purchase on current qty</p>
            </Card>
            <Card padding="md" className="border border-border">
              <div className="text-text-secondary text-sm mb-1">Items to reorder</div>
              <p className="text-2xl font-bold text-text-primary">
                {(reorderPagination?.total ?? reorderSuggestions.length).toLocaleString('en-IN')}
              </p>
              <p className="text-xs text-text-secondary mt-1">&lt; 7 days of cover at recent daily sales</p>
            </Card>
            <Card padding="md" className="border border-border">
              <div className="text-text-secondary text-sm mb-1">Dead stock SKUs</div>
              <p className="text-2xl font-bold text-text-primary">
                {stockHealth.dead_stock_count.toLocaleString('en-IN')}
              </p>
              <p className="text-xs text-text-secondary mt-1">Quantity on hand, no sales in last 30 days</p>
            </Card>
          </div>

          {/* Legacy totals — compact */}
          <div className="flex flex-wrap gap-3 text-sm text-text-secondary border border-dashed border-border rounded-lg px-4 py-3">
            <span>
              <span className="font-medium text-text-primary">{Number(summary.total_items).toLocaleString('en-IN')}</span>{' '}
              active items
            </span>
            <span className="text-border">|</span>
            <span>
              Total qty{' '}
              <span className="font-medium text-text-primary">{formatQty(summary.total_stock_qty)}</span>
            </span>
            <span className="text-border">|</span>
            <span>
              Out of stock{' '}
              <span className="font-medium text-text-primary">
                {Number(summary.out_of_stock_count).toLocaleString('en-IN')}
              </span>
            </span>
            <span className="text-border">|</span>
            <span>
              Low (≤ min){' '}
              <span className="font-medium text-text-primary">
                {Number(summary.low_stock_count).toLocaleString('en-IN')}
              </span>
            </span>
            <span className="text-border">|</span>
            <span>
              List value{' '}
              <span className="font-medium text-text-primary">{formatInr(valueAnalysis.total_selling_value)}</span>
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Stock health */}
            <Card padding="md" className="border border-border">
              <h2 className="text-sm font-semibold text-text-primary mb-3">Stock health</h2>
              <p className="text-xs text-text-secondary mb-4">Level vs minimum reorder, plus stagnant on-hand SKUs.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2">
                  <div className="text-xs text-emerald-800 dark:text-emerald-300">Healthy</div>
                  <div className="text-lg font-bold text-text-primary">
                    {stockHealth.healthy_stock_count.toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2">
                  <div className="text-xs text-amber-800 dark:text-amber-300">Low</div>
                  <div className="text-lg font-bold text-text-primary">
                    {stockHealth.low_stock_count.toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 px-3 py-2">
                  <div className="text-xs text-red-800 dark:text-red-300">Critical</div>
                  <div className="text-lg font-bold text-text-primary">
                    {stockHealth.critical_stock_count.toLocaleString('en-IN')}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/40 px-3 py-2">
                  <div className="text-xs text-text-secondary">Dead</div>
                  <div className="text-lg font-bold text-text-primary">
                    {stockHealth.dead_stock_count.toLocaleString('en-IN')}
                  </div>
                </div>
              </div>
            </Card>

            {/* Aging */}
            <Card padding="md" className="border border-border">
              <h2 className="text-sm font-semibold text-text-primary mb-1">Stock aging</h2>
              <p className="text-xs text-text-secondary mb-4">
                SKUs with on-hand quantity, by last inbound (final purchase or stock-in movement).
              </p>
              {agingBuckets && agingTotal > 0 ? (
                <div className="space-y-3">
                  {(
                    [
                      { key: '0–30 d', n: agingBuckets.bucket_0_30, className: 'bg-emerald-500/90' },
                      { key: '30–60 d', n: agingBuckets.bucket_30_60, className: 'bg-amber-500/90' },
                      { key: '60+ d', n: agingBuckets.bucket_60_plus, className: 'bg-slate-500/90' },
                    ] as const
                  ).map((b) => (
                    <div key={b.key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary">{b.key}</span>
                        <span className="font-medium text-text-primary">
                          {b.n.toLocaleString('en-IN')} SKUs ({Math.round((b.n / agingTotal) * 100)}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 dark:bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${b.className}`}
                          style={{ width: `${Math.max(4, (b.n / agingTotal) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-secondary">No stocked SKUs to age, or no inbound history yet.</p>
              )}
            </Card>
          </div>

          {/* Reorder table */}
          <Card padding="md" className="border border-border">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Reorder suggestions</h2>
                <p className="text-sm text-text-secondary">
                  Under 7 days of stock at recent pace. Suggested order covers ~14 days of sales minus on-hand.
                </p>
              </div>
              {reorderPagination && reorderPagination.total > 0 && (
                <p className="text-xs text-text-secondary">
                  Showing {reorderPagination.offset + 1}–
                  {reorderPagination.offset + reorderSuggestions.length} of {reorderPagination.total}
                </p>
              )}
            </div>
            {reorderSuggestions.length === 0 ? (
              <p className="text-sm text-text-secondary py-4">No items match the reorder rule right now.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 border-b border-border">
                      <tr>
                        <th className="text-left py-3 px-3 font-semibold text-text-primary">Item</th>
                        <th className="text-right py-3 px-3 font-semibold text-text-primary">Current</th>
                        <th className="text-right py-3 px-3 font-semibold text-text-primary">Avg daily sales</th>
                        <th className="text-right py-3 px-3 font-semibold text-text-primary">Days left</th>
                        <th className="text-right py-3 px-3 font-semibold text-text-primary">Suggested qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reorderSuggestions.map((row) => (
                        <tr
                          key={row.id}
                          className={`border-b border-border ${reorderRowClass(row.days_left)} hover:opacity-95`}
                        >
                          <td className="py-3 px-3">
                            <Link href={`/items/${row.id}`} className="text-primary-600 hover:underline font-medium">
                              {row.name}
                            </Link>
                            <div className="text-xs text-text-secondary">{row.unit}</div>
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums">{formatQty(row.current_stock)}</td>
                          <td className="py-3 px-3 text-right tabular-nums">{formatQty(row.avg_daily_sales)}</td>
                          <td className="py-3 px-3 text-right tabular-nums font-medium">
                            {row.days_left != null ? formatQty(row.days_left) : '—'}
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums font-semibold">
                            {formatQty(row.suggested_order_qty)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {reorderPagination && reorderPagination.total > REORDER_PAGE_SIZE && (
                  <div className="flex justify-end gap-2 mt-4">
                    <Button
                      variant="secondary"
                      disabled={reorderOffset <= 0 || loading}
                      onClick={() => setReorderOffset((o) => Math.max(0, o - REORDER_PAGE_SIZE))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!reorderPagination.hasMore || loading}
                      onClick={() => setReorderOffset((o) => o + REORDER_PAGE_SIZE)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Velocity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card padding="md" className="border border-border">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
                <h2 className="text-lg font-semibold text-text-primary">Fast moving</h2>
              </div>
              <p className="text-xs text-text-secondary mb-3">Top 5 by quantity sold (final invoices, 30 days).</p>
              {(velocity?.fastMoving?.length ?? 0) === 0 ? (
                <p className="text-sm text-text-secondary">No sales in this window.</p>
              ) : (
                <ul className="space-y-2">
                  {(velocity?.fastMoving ?? []).map((row) => (
                    <li
                      key={row.id}
                      className="flex justify-between gap-2 text-sm border-b border-border pb-2 last:border-0"
                    >
                      <Link href={`/items/${row.id}`} className="text-primary-600 hover:underline truncate">
                        {row.name}
                      </Link>
                      <span className="tabular-nums font-medium shrink-0">{formatQty(row.quantity_sold_30d)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card padding="md" className="border border-border">
              <div className="flex items-center gap-2 mb-3">
                <TrendingDown className="w-5 h-5 text-amber-600" />
                <h2 className="text-lg font-semibold text-text-primary">Slow moving</h2>
              </div>
              <p className="text-xs text-text-secondary mb-3">Bottom 5 among SKUs with non-zero sales (30 days).</p>
              {(velocity?.slowMoving?.length ?? 0) === 0 ? (
                <p className="text-sm text-text-secondary">Not enough variety of sold SKUs to rank.</p>
              ) : (
                <ul className="space-y-2">
                  {(velocity?.slowMoving ?? []).map((row) => (
                    <li
                      key={row.id}
                      className="flex justify-between gap-2 text-sm border-b border-border pb-2 last:border-0"
                    >
                      <Link href={`/items/${row.id}`} className="text-primary-600 hover:underline truncate">
                        {row.name}
                      </Link>
                      <span className="tabular-nums font-medium shrink-0">{formatQty(row.quantity_sold_30d)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <SectionDetails title="Recent activity" defaultOpen={false}>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-text-secondary py-2">No recent purchases, sales, or quantity adjustments.</p>
            ) : (
              <ul className="divide-y divide-border">
                {recentActivity.map((row, i) => (
                  <li key={`${row.timestamp}-${i}`} className="flex items-start gap-3 py-3 text-sm">
                    <div className="mt-0.5">{activityIcon(row.type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-text-primary truncate">{row.item_name}</div>
                      <div className="text-text-secondary text-xs capitalize">
                        {row.type} ·{' '}
                        {row.type === 'sale'
                          ? '−'
                          : row.type === 'purchase'
                            ? '+'
                            : row.quantity >= 0
                              ? '+'
                              : '−'}
                        {formatQty(Math.abs(row.quantity))} ·{' '}
                        {new Date(row.timestamp).toLocaleString('en-IN', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionDetails>

          <SectionDetails title="Highest inventory value (top 10 at cost)" defaultOpen>
            {highValueItems.length === 0 ? (
              <p className="text-sm text-text-secondary py-4">No items to show.</p>
            ) : (
              <div className="overflow-x-auto pt-2">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800/50 border-b border-border">
                    <tr>
                      <th className="text-left py-3 px-3 font-semibold text-text-primary">Item</th>
                      <th className="text-right py-3 px-3 font-semibold text-text-primary">Quantity</th>
                      <th className="text-left py-3 px-3 font-semibold text-text-primary">Unit</th>
                      <th className="text-right py-3 px-3 font-semibold text-text-primary">Purchase price</th>
                      <th className="text-right py-3 px-3 font-semibold text-text-primary">Stock value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {highValueItems.map((row) => (
                      <tr key={row.id} className="border-b border-border hover:bg-gray-50 dark:hover:bg-slate-800/30">
                        <td className="py-3 px-3">
                          <Link href={`/items/${row.id}`} className="text-primary-600 hover:underline font-medium">
                            {row.name}
                          </Link>
                        </td>
                        <td className="py-3 px-3 text-right">{formatQty(row.current_stock)}</td>
                        <td className="py-3 px-3 text-text-secondary">{row.unit || '—'}</td>
                        <td className="py-3 px-3 text-right">{formatInr(row.purchase_price)}</td>
                        <td className="py-3 px-3 text-right font-semibold">{formatInr(row.stock_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionDetails>

          <SectionDetails title="Items at or below minimum (up to 20)" defaultOpen={false}>
            {lowStockItems.length === 0 ? (
              <p className="text-sm text-text-secondary py-4">No low-stock items right now.</p>
            ) : (
              <div className="overflow-x-auto pt-2">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800/50 border-b border-border">
                    <tr>
                      <th className="text-left py-3 px-3 font-semibold text-text-primary">Item</th>
                      <th className="text-right py-3 px-3 font-semibold text-text-primary">Current</th>
                      <th className="text-right py-3 px-3 font-semibold text-text-primary">Minimum</th>
                      <th className="text-left py-3 px-3 font-semibold text-text-primary">Unit</th>
                      <th className="text-right py-3 px-3 font-semibold text-text-primary">Selling price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockItems.map((row) => (
                      <tr key={row.id} className="border-b border-border hover:bg-gray-50 dark:hover:bg-slate-800/30">
                        <td className="py-3 px-3">
                          <Link href={`/items/${row.id}`} className="text-primary-600 hover:underline font-medium">
                            {row.name}
                          </Link>
                        </td>
                        <td className="py-3 px-3 text-right">{formatQty(row.current_stock)}</td>
                        <td className="py-3 px-3 text-right">{formatQty(row.min_stock)}</td>
                        <td className="py-3 px-3 text-text-secondary">{row.unit || '—'}</td>
                        <td className="py-3 px-3 text-right">{formatInr(row.selling_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionDetails>
        </>
      ) : !error ? (
        <Card padding="md" className="border border-border text-center py-12 text-text-secondary">
          Sign in and select a business to view stock summary.
        </Card>
      ) : null}
    </div>
  );
}
