'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Loader2,
  Download,
  Package,
  CheckCircle,
  XCircle,
  FileSpreadsheet,
  History,
  Scale,
  CalendarRange,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';
import Link from 'next/link';

type ValuationMethod = 'fifo' | 'weighted_avg' | 'last_purchase';

interface ClosingStockSnapshot {
  item_id: string;
  item_name: string;
  quantity: number;
  unit_cost: number;
  total_value: number;
  valuation_method: string;
  last_purchase_date?: string | null;
}

interface ClosingStockSummary {
  financial_year_id: string;
  financial_year: string;
  total_items: number;
  total_quantity: number;
  total_value: number;
  snapshot_date: string;
  is_finalized?: boolean;
  valuation_method?: string;
  snapshot_header_id?: string | null;
  is_locked?: boolean;
}

interface HistoryRow {
  id: string;
  financial_year: string;
  snapshot_date: string;
  total_value: number;
  is_locked: boolean;
  valuation_method: string;
  total_items: number;
  total_quantity: number;
}

interface ComparisonRow {
  item_id: string;
  item_name: string;
  previous_quantity: number;
  current_quantity: number;
  quantity_delta: number;
  previous_value: number;
  current_value: number;
  value_delta: number;
}

interface AuditRow {
  id: string;
  item_id: string;
  item_name: string;
  system_qty: number;
  physical_qty: number;
  difference: number;
}

interface FinancialYearRow {
  id: string;
  year_code: string;
  start_date: string;
  end_date: string;
}

interface FinancialYearNotFoundPayload {
  code: 'FINANCIAL_YEAR_NOT_FOUND';
  error: string;
  requested_year_code: string;
  registered_year_codes: string[];
  help: { what: string; why: string; how_to_fix: string };
}

interface InventoryLockInfo {
  cutoff_date: string | null;
}

function formatInr(n: number) {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const FINANCIAL_YEARS_SETTINGS_HREF = '/settings/financial-years';

function FinancialYearSettingsButton({ className = '' }: { className?: string }) {
  return (
    <Link
      href={FINANCIAL_YEARS_SETTINGS_HREF}
      className={`button-primary px-3 py-2 text-sm md:px-4 md:py-2.5 font-medium rounded-button ${className}`}
    >
      <CalendarRange className="w-4 h-4 shrink-0" aria-hidden />
      Open financial year settings
    </Link>
  );
}

export default function ClosingStockPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [summary, setSummary] = useState<ClosingStockSummary | null>(null);
  const [snapshots, setSnapshots] = useState<ClosingStockSnapshot[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [comparisonRows, setComparisonRows] = useState<ComparisonRow[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditRow[]>([]);
  const [pagination, setPagination] = useState<{
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  } | null>(null);

  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingAudit, setSavingAudit] = useState(false);
  const [financialYear, setFinancialYear] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    if (m >= 3) return `${y}-${y + 1}`;
    return `${y - 1}-${y}`;
  });
  const [snapshotDate, setSnapshotDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [valuationMethod, setValuationMethod] = useState<ValuationMethod>('weighted_avg');
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [itemSort, setItemSort] = useState<'name' | 'qty' | 'value'>('name');
  const [itemPage, setItemPage] = useState(1);
  const [physicalByItem, setPhysicalByItem] = useState<Record<string, number>>({});
  const [showAudit, setShowAudit] = useState(false);
  const [registeredFinancialYears, setRegisteredFinancialYears] = useState<FinancialYearRow[]>([]);
  const [financialYearsLoading, setFinancialYearsLoading] = useState(false);
  const [financialYearHelp, setFinancialYearHelp] = useState<FinancialYearNotFoundPayload | null>(null);
  const [inventoryLock, setInventoryLock] = useState<InventoryLockInfo | null>(null);

  const isFinalized = summary?.is_finalized || false;
  const hasSnapshotData = Boolean(summary);
  const fyCodeMismatch =
    registeredFinancialYears.length > 0 &&
    !registeredFinancialYears.some((y) => y.year_code === financialYear.trim());

  const load = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        financial_year: financialYear,
        user_id: user.id,
        page: String(itemPage),
        limit: '25',
        sort: itemSort,
      });
      if (itemSearch.trim()) params.set('search', itemSearch.trim());
      if (selectedSnapshotId) params.set('snapshot_id', selectedSnapshotId);

      const res = await fetch(`/api/reports/stock/closing-stock?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to load closing stock');
        return;
      }
      setSummary(data.summary);
      setSnapshots(data.snapshots || []);
      setHistory(data.history || []);
      setInventoryLock(data.inventory_lock ?? null);
      setComparisonRows(data.comparison?.rows || []);
      setPagination(data.pagination || null);
      const audits = data.auditEntries || [];
      setAuditEntries(audits);
      setPhysicalByItem((prev) => {
        const next = { ...prev };
        if (audits.length > 0) {
          for (const a of audits) next[a.item_id] = a.physical_qty;
        } else {
          for (const s of data.snapshots || []) {
            if (next[s.item_id] === undefined) next[s.item_id] = s.quantity;
          }
        }
        return next;
      });
    } catch (e) {
      console.error(e);
      toast.error('Failed to load closing stock');
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, financialYear, itemPage, itemSearch, itemSort, selectedSnapshotId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!business?.id) {
      setRegisteredFinancialYears([]);
      return;
    }
    let cancelled = false;
    setFinancialYearsLoading(true);
    fetch(`/api/financial-years?business_id=${business.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setRegisteredFinancialYears(d.years || []);
      })
      .catch(() => {
        if (!cancelled) setRegisteredFinancialYears([]);
      })
      .finally(() => {
        if (!cancelled) setFinancialYearsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [business?.id]);

  const createSnapshot = async () => {
    if (!business?.id || !user?.id) return;
    setFinancialYearHelp(null);
    setCreating(true);
    try {
      const res = await fetch('/api/reports/stock/closing-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          financial_year: financialYear,
          snapshot_date: snapshotDate,
          valuation_method: valuationMethod,
          user_id: user.id,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSummary(data.summary);
        setSnapshots(data.snapshots || []);
        setComparisonRows(data.comparison?.rows || []);
        setPagination(data.pagination || null);
        if (data.history) setHistory(data.history);
        if (data.inventory_lock) setInventoryLock(data.inventory_lock);
        if (data.auditEntries) setAuditEntries(data.auditEntries);
        if (data.summary?.snapshot_header_id) {
          setSelectedSnapshotId(data.summary.snapshot_header_id);
        } else {
          setSelectedSnapshotId(null);
        }
        toast.success('Closing stock snapshot created.');
        await load();
      } else if (data?.code === 'FINANCIAL_YEAR_NOT_FOUND') {
        setFinancialYearHelp(data as FinancialYearNotFoundPayload);
        toast.error(data.error || 'Financial year not set up for this business');
      } else {
        toast.error(data.error || 'Failed to create snapshot');
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to create snapshot');
    } finally {
      setCreating(false);
    }
  };

  const finalizeSnapshot = async () => {
    if (!business?.id || !summary || !user?.id) return;
    if (!confirm('Finalize this financial year closing in the summary record? This marks books as reviewed.')) return;
    try {
      const res = await fetch(`/api/reports/stock/closing-stock/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          financial_year_id: summary.financial_year_id,
          user_id: user.id,
        }),
      });
      if (res.ok) {
        toast.success('Closing stock finalized');
        await load();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to finalize');
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to finalize');
    }
  };

  const exportCsv = async () => {
    if (!business?.id || !user?.id) return;
    const params = new URLSearchParams({
      business_id: business.id,
      financial_year: financialYear,
      user_id: user.id,
      format: 'csv',
    });
    if (selectedSnapshotId) params.set('snapshot_id', selectedSnapshotId);
    const res = await fetch(`/api/reports/stock/closing-stock?${params.toString()}`);
    if (!res.ok) {
      toast.error('Export failed');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `closing-stock-${financialYear}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const saveAudit = async () => {
    const sid = summary?.snapshot_header_id;
    if (!business?.id || !user?.id || !sid) return;
    setSavingAudit(true);
    try {
      const res = await fetch('/api/reports/stock/closing-stock/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          user_id: user.id,
          snapshot_id: sid,
          overrides: physicalByItem,
        }),
      });
      if (res.ok) {
        toast.success('Physical counts saved');
        load();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Save failed');
      }
    } catch (e) {
      console.error(e);
      toast.error('Save failed');
    } finally {
      setSavingAudit(false);
    }
  };

  const viewHistoryRow = (row: HistoryRow) => {
    setFinancialYear(row.financial_year);
    setSelectedSnapshotId(row.id.startsWith('legacy-') ? null : row.id);
    setItemPage(1);
  };

  const clearHistorySelection = () => {
    setSelectedSnapshotId(null);
    setItemPage(1);
  };

  const methodLabel = (m?: string) => {
    if (m === 'fifo') return 'FIFO (purchase layers)';
    if (m === 'weighted_avg') return 'Weighted average (purchases)';
    if (m === 'last_purchase') return 'Last purchase price';
    return m || '—';
  };

  if (!business?.id || !user?.id) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Closing Stock Management</h1>
          <p className="text-sm text-text-secondary mt-1">
            Lock inventory value for financial reporting, audit, and period control.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={!summary || loading}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Download className="w-4 h-4 mr-2" />
            Print
          </Button>
        </div>
      </div>

      {financialYearHelp && (
        <Card className="border-amber-300 bg-amber-50/90 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-amber-950">Set up a financial year first</h2>
              <p className="text-sm text-amber-950/90 mt-1 max-w-xl">
                Closing stock is saved under your business accounting period. Add the year you need in settings, then
                come back and create the snapshot again.
              </p>
            </div>
            <FinancialYearSettingsButton className="shrink-0 self-start" />
          </div>
          {financialYearHelp.registered_year_codes.length > 0 && (
            <p className="text-sm text-amber-950">
              <span className="font-medium">Years already on file: </span>
              {financialYearHelp.registered_year_codes.join(', ')} — pick the matching label in the field above, or add a
              new year in settings.
            </p>
          )}
          <details className="text-sm text-amber-950/85">
            <summary className="cursor-pointer font-medium text-amber-950">Why this matters</summary>
            <ul className="mt-2 space-y-1 list-disc pl-5">
              <li>{financialYearHelp.help.what}</li>
              <li>{financialYearHelp.help.why}</li>
              <li>{financialYearHelp.help.how_to_fix}</li>
            </ul>
          </details>
        </Card>
      )}

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Financial Year</label>
            <Input
              type="text"
              value={financialYear}
              list="closing-stock-registered-fy"
              onChange={(e) => {
                setFinancialYear(e.target.value);
                setSelectedSnapshotId(null);
                setFinancialYearHelp(null);
              }}
              placeholder="e.g. 2024-2025"
            />
            <datalist id="closing-stock-registered-fy">
              {registeredFinancialYears.map((y) => (
                <option key={y.id} value={y.year_code} label={`${y.start_date} → ${y.end_date}`} />
              ))}
            </datalist>
            <p className="text-xs text-text-secondary mt-1.5 leading-relaxed">
              Choose the same <strong>year label</strong> you added under Settings → Financial years (often April–March in
              India).
            </p>
            {financialYearsLoading ? (
              <p className="text-xs text-text-secondary mt-1">Loading your financial years…</p>
            ) : registeredFinancialYears.length === 0 ? (
              <div className="mt-3 rounded-lg border border-amber-300/80 bg-amber-950/5 dark:bg-amber-500/10 p-3 space-y-3">
                <p className="text-sm text-amber-950 dark:text-amber-100 font-medium">
                  No financial year is set up for this business yet.
                </p>
                <p className="text-xs text-text-secondary dark:text-amber-100/80">
                  Add your accounting period in settings, then return here to create a closing snapshot.
                </p>
                <FinancialYearSettingsButton />
              </div>
            ) : fyCodeMismatch ? (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-amber-800 dark:text-amber-200">
                  This label is not in your list yet. Pick a suggestion from the field or add the year in settings.
                </p>
                <FinancialYearSettingsButton />
              </div>
            ) : null}
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Snapshot date (as on)</label>
            <Input type="date" value={snapshotDate} onChange={(e) => setSnapshotDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Valuation method</label>
            <select
              className="input w-full"
              value={valuationMethod}
              onChange={(e) => setValuationMethod(e.target.value as ValuationMethod)}
            >
              <option value="weighted_avg">Weighted average</option>
              <option value="fifo">FIFO (purchase layers)</option>
              <option value="last_purchase">Last purchase price</option>
            </select>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <Button onClick={createSnapshot} disabled={creating} className="flex-1 min-w-[140px]">
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Package className="w-4 h-4 mr-2" />
                  Create snapshot
                </>
              )}
            </Button>
          </div>
        </div>
        <p className="text-xs text-text-secondary mt-3">
          Quantities are rolled back to the snapshot date using stock movements. Purchases and sales on or before the
          latest locked closing date are blocked (409) until adjusted.
        </p>
      </Card>

      {!hasSnapshotData && !loading && (
        <div className="rounded-xl border border-dashed border-border bg-slate-50/80 dark:bg-slate-900/40 px-4 py-5 text-center">
          <p className="text-sm text-text-secondary mb-3">
            No closing stock snapshot for <span className="font-semibold text-text-primary">{financialYear}</span> yet.
            Set the date and method above, then create a snapshot to see values and line items.
          </p>
          <Button onClick={createSnapshot} disabled={creating}>
            {creating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Package className="w-4 h-4 mr-2" />
                Create snapshot
              </>
            )}
          </Button>
        </div>
      )}

      {inventoryLock?.cutoff_date && (
        <Card className="border-primary-200 bg-slate-100/90 dark:bg-slate-800/40 dark:border-primary-800">
          <div className="flex flex-col sm:flex-row sm:items-start gap-3">
            <Lock className="w-5 h-5 text-primary-700 dark:text-primary-300 shrink-0 mt-0.5" aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold text-primary-900 dark:text-primary-100">
                Inventory locked through{' '}
                {format(new Date(inventoryLock.cutoff_date + 'T12:00:00'), 'dd MMM yyyy')}
              </p>
              <p className="text-sm text-primary-900/85 dark:text-primary-200/90 mt-2 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden />
                <span>
                  Backdated purchases, sales, or other stock transactions on or before this date may be blocked until
                  stock is adjusted. Plan new entries for dates after the lock.
                </span>
              </p>
            </div>
          </div>
        </Card>
      )}

      {selectedSnapshotId && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-text-secondary">Viewing saved snapshot.</span>
          <Button variant="secondary" size="sm" onClick={clearHistorySelection}>
            Show latest for year
          </Button>
        </div>
      )}

      {summary && (
        <Card className={isFinalized ? 'bg-green-50/80 border-green-200' : 'bg-amber-50/50 border-amber-200'}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {isFinalized ? (
                <CheckCircle className="w-6 h-6 text-green-600" />
              ) : (
                <XCircle className="w-6 h-6 text-amber-600" />
              )}
              <div>
                <p className={`font-semibold ${isFinalized ? 'text-green-900' : 'text-amber-900'}`}>
                  {isFinalized ? 'Finalized (summary)' : 'Draft summary'} · FY {summary.financial_year}
                </p>
                <p className="text-sm text-text-secondary">
                  As on {format(new Date(summary.snapshot_date), 'dd MMM yyyy')} ·{' '}
                  {summary.is_locked !== false ? 'Locked snapshot' : 'Unlocked'}
                </p>
              </div>
            </div>
            {!isFinalized && (
              <Button onClick={finalizeSnapshot} variant="secondary" size="sm">
                <CheckCircle className="w-4 h-4 mr-2" />
                Finalize year
              </Button>
            )}
          </div>
        </Card>
      )}

      {summary && (
        <section className="space-y-3" aria-labelledby="closing-stock-summary-heading">
          <div className="flex items-center justify-between gap-2">
            <h2 id="closing-stock-summary-heading" className="text-lg font-semibold text-text-primary">
              Summary
            </h2>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-text-secondary shrink-0" aria-label="Updating" />}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card padding="md" className="border border-border">
            <p className="text-sm text-text-secondary mb-1">Total stock value</p>
            <p className="text-2xl font-bold text-text-primary">{formatInr(Number(summary.total_value))}</p>
          </Card>
          <Card padding="md" className="border border-border">
            <p className="text-sm text-text-secondary mb-1">Items</p>
            <p className="text-2xl font-bold text-text-primary">{summary.total_items}</p>
          </Card>
          <Card padding="md" className="border border-border">
            <p className="text-sm text-text-secondary mb-1">Total quantity</p>
            <p className="text-2xl font-bold text-text-primary">
              {Number(summary.total_quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 })}
            </p>
          </Card>
          <Card padding="md" className="border border-border">
            <p className="text-sm text-text-secondary mb-1">Valuation method</p>
            <p className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Scale className="w-4 h-4" />
              {methodLabel(summary.valuation_method)}
            </p>
          </Card>
        </div>
        </section>
      )}

      {comparisonRows.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold text-text-primary mb-3">Comparison vs previous snapshot</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2">Item</th>
                  <th className="text-right py-2 px-2">Prev qty</th>
                  <th className="text-right py-2 px-2">Current qty</th>
                  <th className="text-right py-2 px-2">Δ Qty</th>
                  <th className="text-right py-2 px-2">Δ Value</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((r) => (
                  <tr key={r.item_id} className="border-b border-border">
                    <td className="py-2 px-2">{r.item_name}</td>
                    <td className="text-right py-2 px-2">{r.previous_quantity.toLocaleString('en-IN')}</td>
                    <td className="text-right py-2 px-2">{r.current_quantity.toLocaleString('en-IN')}</td>
                    <td
                      className={`text-right py-2 px-2 font-medium ${
                        r.quantity_delta < 0 ? 'text-red-600' : r.quantity_delta > 0 ? 'text-emerald-600' : ''
                      }`}
                    >
                      {r.quantity_delta > 0 ? '+' : ''}
                      {r.quantity_delta.toLocaleString('en-IN')}
                    </td>
                    <td
                      className={`text-right py-2 px-2 ${
                        r.value_delta < 0 ? 'text-red-600' : r.value_delta > 0 ? 'text-emerald-600' : ''
                      }`}
                    >
                      {r.value_delta > 0 ? '+' : ''}
                      {formatInr(r.value_delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {summary && (
        <section className="space-y-3" aria-labelledby="closing-stock-items-heading">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 id="closing-stock-items-heading" className="text-lg font-semibold text-text-primary">
              Snapshot items
            </h2>
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                placeholder="Search by item name…"
                value={itemSearch}
                onChange={(e) => {
                  setItemSearch(e.target.value);
                  setItemPage(1);
                }}
                className="w-52"
              />
              <select
                className="input text-sm min-w-[10rem]"
                value={itemSort}
                onChange={(e) => {
                  setItemSort(e.target.value as 'name' | 'qty' | 'value');
                  setItemPage(1);
                }}
                aria-label="Sort items"
              >
                <option value="name">Sort: Item name</option>
                <option value="qty">Sort: Quantity</option>
                <option value="value">Sort: Total value</option>
              </select>
            </div>
          </div>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2">Item name</th>
                    <th className="text-right py-2 px-2">Quantity</th>
                    <th className="text-right py-2 px-2">Valuation price</th>
                    <th className="text-right py-2 px-2">Total value</th>
                    <th className="text-left py-2 px-2">Last purchase date</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && snapshots.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-text-secondary">
                        <Loader2 className="w-6 h-6 animate-spin inline text-primary-500" />
                      </td>
                    </tr>
                  ) : snapshots.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-text-secondary text-sm">
                        No line items for this snapshot (zero stock or no goods items on the as-on date).
                      </td>
                    </tr>
                  ) : (
                    snapshots.map((s) => (
                      <tr
                        key={s.item_id}
                        className="border-b border-border hover:bg-gray-50 dark:hover:bg-slate-800/40"
                      >
                        <td className="py-2 px-2 font-medium">{s.item_name}</td>
                        <td className="text-right py-2 px-2">
                          {s.quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                        </td>
                        <td className="text-right py-2 px-2">{formatInr(s.unit_cost)}</td>
                        <td className="text-right py-2 px-2 font-semibold">{formatInr(s.total_value)}</td>
                        <td className="py-2 px-2 text-text-secondary">{s.last_purchase_date || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {pagination && pagination.totalPages > 1 && (
              <div className="flex justify-between items-center mt-4 text-sm">
                <span className="text-text-secondary">
                  Page {pagination.page} of {pagination.totalPages} ({pagination.total} items)
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pagination.page <= 1 || loading}
                    onClick={() => setItemPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pagination.page >= pagination.totalPages || loading}
                    onClick={() => setItemPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </section>
      )}

      {summary?.snapshot_header_id && snapshots.length > 0 && (
        <Card>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                Physical stock count (audit)
              </h2>
              <p className="text-xs text-text-secondary">
                Enter physical quantities; difference highlights over/short. Save persists audit lines.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setShowAudit((v) => !v)}>
              {showAudit ? 'Hide' : 'Show'}
            </Button>
          </div>
          {showAudit && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2">Item</th>
                      <th className="text-right py-2 px-2">System qty</th>
                      <th className="text-right py-2 px-2">Physical qty</th>
                      <th className="text-right py-2 px-2">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((s) => {
                      const phys = physicalByItem[s.item_id] ?? s.quantity;
                      const diff = phys - s.quantity;
                      return (
                        <tr key={s.item_id} className="border-b border-border">
                          <td className="py-2 px-2">{s.item_name}</td>
                          <td className="text-right py-2 px-2">
                            {s.quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                          </td>
                          <td className="text-right py-2 px-2">
                            <Input
                              type="number"
                              className="w-28 text-right ml-auto"
                              value={phys}
                              step="0.001"
                              onChange={(e) =>
                                setPhysicalByItem((m) => ({
                                  ...m,
                                  [s.item_id]: parseFloat(e.target.value) || 0,
                                }))
                              }
                            />
                          </td>
                          <td
                            className={`text-right py-2 px-2 font-medium ${
                              diff < 0 ? 'text-red-600' : diff > 0 ? 'text-emerald-600' : 'text-text-secondary'
                            }`}
                          >
                            {diff > 0 ? '+' : ''}
                            {diff.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex justify-end">
                <Button onClick={saveAudit} disabled={savingAudit}>
                  {savingAudit ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save physical counts'}
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      <section className="space-y-3" aria-labelledby="closing-stock-history-heading">
        <h2 id="closing-stock-history-heading" className="text-lg font-semibold text-text-primary flex items-center gap-2">
          <History className="w-5 h-5" aria-hidden />
          History
        </h2>
        <Card>
          {history.length === 0 ? (
            <p className="text-sm text-text-secondary py-4">
              {hasSnapshotData
                ? 'No other snapshots are listed yet. New runs will appear here when you use versioned snapshots.'
                : 'Create a snapshot for any financial year to see it listed here.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-2">Snapshot date</th>
                    <th className="text-left py-2 px-2">Financial year</th>
                    <th className="text-right py-2 px-2">Total value</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-right py-2 px-2">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => {
                    const statusLabel = !h.is_locked
                      ? 'Open'
                      : h.id.startsWith('legacy-')
                        ? 'Finalized'
                        : 'Locked';
                    let dateDisplay = h.snapshot_date;
                    try {
                      dateDisplay = format(new Date(h.snapshot_date + 'T12:00:00'), 'dd MMM yyyy');
                    } catch {
                      /* keep raw */
                    }
                    return (
                      <tr key={h.id} className="border-b border-border">
                        <td className="py-2 px-2">{dateDisplay}</td>
                        <td className="py-2 px-2">{h.financial_year}</td>
                        <td className="text-right py-2 px-2">{formatInr(Number(h.total_value))}</td>
                        <td className="py-2 px-2">{statusLabel}</td>
                        <td className="text-right py-2 px-2">
                          <Button variant="secondary" size="sm" onClick={() => viewHistoryRow(h)}>
                            View
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
