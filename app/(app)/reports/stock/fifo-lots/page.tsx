'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

interface LotIssue {
  kind: string;
  doc_id: string;
  doc_number: string | null;
  party: string | null;
  date: string;
  qty: number;
}

interface LotRow {
  kind: string;
  doc_id: string;
  doc_number: string | null;
  party: string | null;
  date: string | null;
  qty: number;
  remaining: number;
  unit_cost: number;
  total: number;
  issued_to: LotIssue[];
}

interface ItemReport {
  item_id: string;
  item_name: string;
  open_qty: number;
  open_value: number;
  unmatched: Array<LotIssue & { unit_cost: number }>;
  lots: LotRow[];
}

interface Report {
  method: string;
  recost_from: string | null;
  as_on_date: string | null;
  items: ItemReport[];
  totals: { open_value: number; ledger_inventory: number | null; difference: number | null };
}

interface RecostLine {
  voucherType: string;
  voucherId: string;
  reference: string | null;
  date: string;
  posted: number;
  expected: number;
  delta: number;
}

interface RecostResult {
  from_date: string | null;
  report: {
    checked: number;
    changed: RecostLine[];
    skippedLocked: RecostLine[];
    skippedNoAccount: RecostLine[];
    dryRun: boolean;
  };
}

const KIND_LABEL: Record<string, string> = {
  opening: 'Opening Stock',
  purchase: 'Bill',
  credit_note: 'Credit Note',
  adjustment_in: 'Stock Adjustment',
  invoice: 'Invoice',
  purchase_return: 'Vendor Credit',
  adjustment_out: 'Stock Adjustment',
  stock_adjustment: 'Stock Adjustment',
  inter_branch_receipt: 'Branch Receipt',
};

const money = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const docLabel = (kind: string, num: string | null) => `${KIND_LABEL[kind] ?? kind}${num ? ` ${num}` : ''}`;

export default function FifoLotTrackingPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [asOnDate, setAsOnDate] = useState(new Date().toISOString().split('T')[0]);
  const [itemId, setItemId] = useState('');
  const [items, setItems] = useState<Array<{ id: string; name: string; item_type?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [recosting, setRecosting] = useState(false);
  const [recost, setRecost] = useState<RecostResult | null>(null);

  useEffect(() => {
    if (!business?.id) return;
    fetch(`/api/items?business_id=${business.id}&item_type=goods&limit=1000&user_id=${user?.id ?? ''}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setItems((d.items || []).filter((i: any) => !i.is_bundle)))
      .catch(() => setItems([]));
  }, [business?.id, user?.id]);

  const loadReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ as_on_date: asOnDate });
      if (itemId) params.set('item_id', itemId);
      const res = await fetch(`/api/reports/stock/fifo-lots?${params}`, { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to load FIFO lots');
        return;
      }
      setReport(data.report);
      setExpanded(new Set(data.report.items.length === 1 ? [data.report.items[0].item_id] : []));
    } catch {
      toast.error('Failed to load FIFO lots');
    } finally {
      setLoading(false);
    }
  };

  const runRecost = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm('Post FIFO cost corrections to the ledger for the vouchers listed in the preview?')) return;
    setRecosting(true);
    try {
      const res = await fetch('/api/inventory/fifo-recost', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun, item_ids: itemId ? [itemId] : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'FIFO recalculation failed');
        return;
      }
      setRecost(data);
      if (!dryRun) {
        toast.success(`Posted ${data.report.changed.length} cost correction(s)`);
        await loadReport();
      }
    } catch {
      toast.error('FIFO recalculation failed');
    } finally {
      setRecosting(false);
    }
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isFifo = report?.method === 'fifo';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">FIFO Cost Lot Tracking</h1>
        <p className="text-sm text-text-secondary mt-1">
          Each purchase, opening stock and returned quantity forms a cost lot. Sales consume the oldest lot first.
        </p>
      </div>

      <Card padding="md">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">As On Date</label>
            <Input type="date" value={asOnDate} onChange={(e) => setAsOnDate(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-text-secondary mb-1">Item</label>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="input">
              <option value="">All goods items</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={loadReport} disabled={loading} className="w-full">
              {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading...</> : 'Show Lots'}
            </Button>
          </div>
        </div>
      </Card>

      {report && (
        <Card padding="md">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1 text-sm">
              <p className="text-text-secondary">
                Valuation method: <span className="font-semibold text-text-primary">{report.method.toUpperCase()}</span>
                {report.recost_from && <> • Automatic cost correction from {report.recost_from}</>}
              </p>
              {!isFifo && (
                <p className="text-amber-700">
                  This business does not use FIFO, so these lots are for reference only and are not used for cost of goods sold.
                </p>
              )}
              <p className="text-text-secondary">
                Open lot value: <span className="font-semibold text-text-primary">{money(report.totals.open_value)}</span>
                {report.totals.ledger_inventory !== null && (
                  <>
                    {' '}• Inventory account (1104): <span className="font-semibold text-text-primary">{money(report.totals.ledger_inventory)}</span>
                    {' '}• Difference:{' '}
                    <span className={Math.abs(report.totals.difference ?? 0) >= 0.01 ? 'font-semibold text-red-600' : 'font-semibold text-green-700'}>
                      {money(report.totals.difference ?? 0)}
                    </span>
                  </>
                )}
              </p>
            </div>
            {isFifo && (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => runRecost(true)} disabled={recosting}>
                  {recosting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Preview cost corrections
                </Button>
                {recost?.report.dryRun && recost.report.changed.length > 0 && (
                  <Button onClick={() => runRecost(false)} disabled={recosting}>Post corrections</Button>
                )}
              </div>
            )}
          </div>

          {recost && <RecostPanel result={recost} />}
        </Card>
      )}

      {report && report.items.length === 0 && (
        <Card padding="md"><p className="text-sm text-text-secondary">No stock movements found.</p></Card>
      )}

      {report?.items.map((item) => (
        <Card key={item.item_id} padding="md">
          <button type="button" onClick={() => toggle(item.item_id)} className="w-full flex items-center justify-between text-left">
            <span className="flex items-center gap-2 font-semibold text-text-primary">
              {expanded.has(item.item_id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              {item.item_name}
            </span>
            <span className="text-sm text-text-secondary">
              Stock {qty(item.open_qty)} • Value {money(item.open_value)} • {item.lots.length} lot(s)
            </span>
          </button>

          {expanded.has(item.item_id) && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-border">
                  <tr>
                    <th className="text-left py-2 px-3 font-semibold">Lot (inward)</th>
                    <th className="text-left py-2 px-3 font-semibold">Date</th>
                    <th className="text-right py-2 px-3 font-semibold">Qty In</th>
                    <th className="text-right py-2 px-3 font-semibold">Unit Cost</th>
                    <th className="text-right py-2 px-3 font-semibold">Remaining</th>
                    <th className="text-left py-2 px-3 font-semibold">Consumed by</th>
                  </tr>
                </thead>
                <tbody>
                  {item.lots.map((lot, idx) => (
                    <tr key={`${lot.kind}:${lot.doc_id}:${idx}`} className="border-b border-border align-top">
                      <td className="py-2 px-3">
                        <div className="text-text-primary">{docLabel(lot.kind, lot.doc_number)}</div>
                        {lot.party && <div className="text-xs text-text-secondary">{lot.party}</div>}
                      </td>
                      <td className="py-2 px-3 text-text-secondary">{lot.date ?? '-'}</td>
                      <td className="py-2 px-3 text-right">{qty(lot.qty)}</td>
                      <td className="py-2 px-3 text-right">{money(lot.unit_cost)}</td>
                      <td className="py-2 px-3 text-right">{qty(lot.remaining)}</td>
                      <td className="py-2 px-3">
                        {lot.issued_to.length === 0 ? (
                          <span className="text-text-secondary">-</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {lot.issued_to.map((u, i) => (
                              <li key={i} className="text-text-primary">
                                {docLabel(u.kind, u.doc_number)} • {u.date} • {qty(u.qty)}
                                {u.party && <span className="text-text-secondary"> • {u.party}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {item.unmatched.length > 0 && (
                <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                  <p className="font-medium text-amber-800">Sold without stock (waiting for the next purchase lot)</p>
                  <ul className="mt-1 space-y-0.5 text-amber-900">
                    {item.unmatched.map((u, i) => (
                      <li key={i}>
                        {docLabel(u.kind, u.doc_number)} • {u.date} • {qty(u.qty)} at provisional cost {money(u.unit_cost)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function RecostPanel({ result }: { result: RecostResult }) {
  const { report } = result;
  const section = (title: string, rows: RecostLine[]) =>
    rows.length === 0 ? null : (
      <div className="mt-3">
        <p className="text-sm font-medium text-text-primary">{title} ({rows.length})</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm mt-1">
            <thead className="bg-gray-50 border-b border-border">
              <tr>
                <th className="text-left py-1.5 px-3 font-semibold">Voucher</th>
                <th className="text-left py-1.5 px-3 font-semibold">Date</th>
                <th className="text-right py-1.5 px-3 font-semibold">Posted cost</th>
                <th className="text-right py-1.5 px-3 font-semibold">FIFO cost</th>
                <th className="text-right py-1.5 px-3 font-semibold">Change</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.voucherType}:${r.voucherId}`} className="border-b border-border">
                  <td className="py-1.5 px-3">{docLabel(r.voucherType, r.reference)}</td>
                  <td className="py-1.5 px-3 text-text-secondary">{r.date}</td>
                  <td className="py-1.5 px-3 text-right">{money(r.posted)}</td>
                  <td className="py-1.5 px-3 text-right">{money(r.expected)}</td>
                  <td className="py-1.5 px-3 text-right">{money(r.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="text-sm text-text-secondary">
        {report.dryRun ? 'Preview' : 'Posted'}: checked {report.checked} voucher(s)
        {result.from_date ? ` dated on or after ${result.from_date}` : ''}.
        {report.changed.length === 0 && ' No cost corrections needed.'}
      </p>
      {section(report.dryRun ? 'Will be corrected' : 'Corrected', report.changed)}
      {section('Skipped: period locked', report.skippedLocked)}
      {section('Skipped: inventory or counter account missing', report.skippedNoAccount)}
    </div>
  );
}
