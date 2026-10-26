'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, CheckCircle, Lock, Save, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';

const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const less = (n: number) => (n > 0 ? `−${qty(n)}` : '0');
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const REASONS_SHORT: Array<{ value: string; label: string }> = [
  { value: 'STOCK_TAKE', label: 'Unexplained' },
  { value: 'DAMAGE', label: 'Damaged' },
  { value: 'THEFT', label: 'Theft' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'PROCESS_LOSS', label: 'Normal process loss' },
  { value: 'TRANSIT_LOSS', label: 'Lost in transit' },
  { value: 'OWN_CONSUMPTION', label: 'Own use' },
  { value: 'FREE_SAMPLE', label: 'Given as sample' },
  { value: 'CUSTODY_LOSS', label: 'Lost while with a party' },
];

const PURPOSE: Record<string, string> = {
  repair: 'Repair', job_work: 'Job work', approval: 'Approval', consignment: 'Consignment',
  exhibition: 'Exhibition', demo: 'Demo', other: 'Other',
};

type Line = {
  item_id: string;
  item_name: string;
  item_code: string | null;
  unit: string | null;
  stock_class: string;
  book_qty: number;
  with_third_party_qty: number;
  in_transit_qty: number;
  expected_qty: number;
  physical_qty: number | null;
  third_party_qty: number;
  difference: number | null;
  difference_value: number | null;
  recount_required: boolean;
  recounted: boolean;
  first_count_qty: number | null;
  reason_code: string | null;
  reason_notes: string | null;
  needs_reason: boolean;
};

function Step({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'good' }) {
  const cls = tone === 'bad' ? 'border-red-300 bg-red-50' : tone === 'good' ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white';
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-xs text-gray-600">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

export default function StockCountPage() {
  const { id } = useParams() as { id: string };
  const toast = useToastContext();
  const [data, setData] = useState<any>(null);
  const [entries, setEntries] = useState<Record<string, { physical: string; others: string }>>({});
  const [reasons, setReasons] = useState<Record<string, { code: string; notes: string }>>({});
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/stock-counts/${id}`);
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error || 'Could not load the count');
      return;
    }
    setData(json);
    setEntries({});
    setReasons(
      Object.fromEntries(
        (json.lines as Line[]).filter((l) => l.difference).map((l) => [l.item_id, { code: l.reason_code || 'STOCK_TAKE', notes: l.reason_notes || '' }])
      )
    );
  }

  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: string, extra: Record<string, unknown> = {}, ok?: string) {
    setBusy(action);
    try {
      const res = await fetch(`/api/stock-counts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Could not update the count');
        return null;
      }
      if (ok) toast.success(ok);
      await load();
      return json;
    } finally {
      setBusy(null);
    }
  }

  const lines: Line[] = data?.lines || [];
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? lines.filter((l) => l.item_name.toLowerCase().includes(q) || (l.item_code || '').toLowerCase().includes(q)) : lines;
  }, [lines, search]);

  if (!data) {
    return <div className="flex items-center justify-center min-h-[300px] text-gray-500">Loading...</div>;
  }

  const c = data.count;
  const s = data.summary;
  const counting = c.status === 'counting';
  const review = c.status === 'review';

  async function saveCounts() {
    const list = Object.entries(entries)
      .filter(([, e]) => e.physical !== '')
      .map(([item_id, e]) => ({ item_id, physical_qty: Number(e.physical), third_party_qty: Number(e.others) || 0 }));
    if (!list.length) {
      toast.error('Enter at least one counted quantity');
      return;
    }
    const res = await act('count', { entries: list });
    if (res?.recount?.length) toast.error(`${res.recount.length} item(s) are well off the book figure. Count them again.`);
    else if (res) toast.success('Counts saved');
  }

  async function finish() {
    const uncounted = lines.filter((l) => l.physical_qty === null).length;
    let fill: 'book' | 'zero' | undefined;
    if (uncounted > 0) {
      const asBook = window.confirm(
        `${uncounted} item(s) have not been counted.\n\nOK: take them as matching the books.\nCancel: go back and count them.`
      );
      if (!asBook) return;
      fill = 'book';
    }
    await act('submit', { fill_uncounted: fill }, 'Counting closed; review the differences');
  }

  async function saveReasons() {
    const list = Object.entries(reasons).map(([item_id, r]) => ({ item_id, reason_code: r.code, reason_notes: r.notes || null }));
    await act('reasons', { reasons: list }, 'Reasons saved');
  }

  const diffs = lines.filter((l) => l.difference);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Stock count ${c.count_number}`}
        subtitle={`${c.warehouse_name || c.branch_name || ''} · ${c.count_date} · ${c.status}${c.freeze_stock && (counting || review) ? ' · stock frozen' : ''}`}
        actions={
          <div className="flex gap-2">
            {counting && (
              <>
                <Button onClick={saveCounts} isLoading={busy === 'count'} disabled={!!busy}>
                  <Save className="w-4 h-4 mr-2" />
                  Save counts
                </Button>
                <Button variant="secondary" onClick={finish} isLoading={busy === 'submit'} disabled={!!busy}>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Finish counting
                </Button>
              </>
            )}
            {review && (
              <Button
                onClick={() => window.confirm('Post every difference as a stock adjustment and lock this count?') && act('post', {}, 'Count posted')}
                isLoading={busy === 'post'}
                disabled={!!busy}
              >
                <Lock className="w-4 h-4 mr-2" />
                Approve and post
              </Button>
            )}
            {(counting || review) && (
              <Button
                variant="secondary"
                onClick={() => window.confirm('Cancel this count? Nothing is posted and the godown is unfrozen.') && act('cancel', {}, 'Count cancelled')}
                disabled={!!busy}
              >
                <XCircle className="w-4 h-4 mr-2 text-red-500" />
                Cancel count
              </Button>
            )}
          </div>
        }
      />

      {c.warehouse_id && c.gst_place_type === 'not_registered' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          This godown is marked as not on the GST registration. Stock kept at an undeclared place can be seized (s.35); add it as an
          additional place of business.
        </div>
      )}

      {counting && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
            <p className="text-sm text-gray-600">
              Count what is on the shelf and belongs to us. Goods held here for others (customer goods in for repair) go in the second
              column.{data.blind ? ' Book quantities are hidden until counting is finished.' : ''}
            </p>
            <div className="w-full md:w-64">
              <Input placeholder="Search item or code" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">Unit</th>
                  <th className="px-4 py-2">Counted (ours)</th>
                  <th className="px-4 py-2">Others&apos; goods here</th>
                  <th className="px-4 py-2">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map((l) => {
                  const e = entries[l.item_id];
                  return (
                    <tr key={l.item_id} className={l.recount_required && !l.recounted ? 'bg-amber-50' : ''}>
                      <td className="px-4 py-2">
                        <div className="font-medium text-gray-900">{l.item_name}</div>
                        {l.item_code && <div className="text-xs text-gray-500">{l.item_code}</div>}
                      </td>
                      <td className="px-4 py-2">{l.unit || '-'}</td>
                      <td className="px-4 py-2 w-36">
                        <Input
                          type="number"
                          min={0}
                          value={e?.physical ?? (l.recount_required && !l.recounted ? '' : l.physical_qty ?? '')}
                          onChange={(ev) => setEntries((p) => ({ ...p, [l.item_id]: { physical: ev.target.value, others: p[l.item_id]?.others ?? String(l.third_party_qty || '') } }))}
                        />
                      </td>
                      <td className="px-4 py-2 w-36">
                        <Input
                          type="number"
                          min={0}
                          value={e?.others ?? (l.third_party_qty || '')}
                          onChange={(ev) =>
                            setEntries((p) => ({
                              ...p,
                              [l.item_id]: { physical: p[l.item_id]?.physical ?? (l.physical_qty === null ? '' : String(l.physical_qty)), others: ev.target.value },
                            }))
                          }
                        />
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {l.recount_required && !l.recounted ? (
                          <span className="inline-flex items-center gap-1 text-amber-800">
                            <AlertTriangle className="w-3.5 h-3.5" /> Count again
                          </span>
                        ) : l.physical_qty !== null ? (
                          <span className="text-green-700">{l.recounted ? 'Recounted' : 'Counted'}</span>
                        ) : (
                          <span className="text-gray-400">Not counted</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!counting && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Step label="Book stock" value={qty(s.book_qty)} />
            <Step label="With third parties" value={less(s.with_third_party_qty)} />
            <Step label="In transit" value={less(s.in_transit_qty)} />
            <Step label="Expected in godown" value={qty(s.expected_qty)} />
            <Step label="Counted" value={qty(s.physical_qty)} />
            <Step
              label="Unexplained"
              value={`${s.unexplained_qty > 0 ? '+' : ''}${qty(s.unexplained_qty)}`}
              tone={Math.abs(s.unexplained_qty) > 0.0005 ? 'bad' : 'good'}
            />
          </div>
          <p className="text-sm text-gray-600">
            Shortage {inr(s.shortage_value)}, excess {inr(s.excess_value)} at cost.
            {s.unproven > 0 && ` ${s.unproven} line(s) out of the godown rest on an expired e-way bill.`}
            {s.overdue_returns > 0 && ` ${s.overdue_returns} challan line(s) are past their return date.`}
            {s.held_qty > 0 && ` Expected includes ${qty(s.held_qty)} held (quarantine, QC, damaged, returns).`}
            {(s.third_party_goods_in_godown > 0 || s.others_goods_registered > 0) &&
              ` Others' goods: ${qty(s.third_party_goods_in_godown)} found, ${qty(s.others_goods_registered)} on the register${
                Math.abs(s.third_party_goods_in_godown - s.others_goods_registered) > 0.0005 ? ' — check the difference' : ''
              }.`}
          </p>

          <section className="bg-white rounded-xl border border-gray-200">
            <div className="flex items-center justify-between p-4">
              <h2 className="font-semibold text-gray-900">Differences ({diffs.length})</h2>
              {review && diffs.length > 0 && (
                <Button size="sm" variant="secondary" onClick={saveReasons} isLoading={busy === 'reasons'} disabled={!!busy}>
                  Save reasons
                </Button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2 text-right">Book</th>
                    <th className="px-4 py-2 text-right">Elsewhere</th>
                    <th className="px-4 py-2 text-right">Expected</th>
                    <th className="px-4 py-2 text-right">Counted</th>
                    <th className="px-4 py-2 text-right">Difference</th>
                    <th className="px-4 py-2 text-right">Value</th>
                    <th className="px-4 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {diffs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                        The count matches the books.
                      </td>
                    </tr>
                  )}
                  {diffs.map((l) => {
                    const r = reasons[l.item_id] || { code: l.reason_code || 'STOCK_TAKE', notes: l.reason_notes || '' };
                    const shortage = (l.difference || 0) < 0;
                    return (
                      <tr key={l.item_id} className={l.needs_reason ? 'bg-red-50' : ''}>
                        <td className="px-4 py-2">
                          <div className="font-medium text-gray-900">{l.item_name}</div>
                          {l.first_count_qty !== null && l.recounted && (
                            <div className="text-xs text-gray-500">First count {qty(l.first_count_qty)}</div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">{qty(l.book_qty)}</td>
                        <td className="px-4 py-2 text-right">{qty(l.with_third_party_qty + l.in_transit_qty)}</td>
                        <td className="px-4 py-2 text-right">{qty(l.expected_qty)}</td>
                        <td className="px-4 py-2 text-right">{qty(l.physical_qty ?? 0)}</td>
                        <td className={`px-4 py-2 text-right font-medium ${shortage ? 'text-red-700' : 'text-green-700'}`}>
                          {(l.difference || 0) > 0 ? '+' : ''}
                          {qty(l.difference || 0)}
                        </td>
                        <td className="px-4 py-2 text-right">{inr(l.difference_value || 0)}</td>
                        <td className="px-4 py-2 min-w-[220px]">
                          {review ? (
                            <div className="space-y-1">
                              <select
                                className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
                                value={r.code}
                                onChange={(e) => setReasons((p) => ({ ...p, [l.item_id]: { ...r, code: e.target.value } }))}
                              >
                                {(shortage ? REASONS_SHORT : REASONS_SHORT.slice(0, 1)).map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {shortage || o.value !== 'STOCK_TAKE' ? o.label : 'Excess found'}
                                  </option>
                                ))}
                              </select>
                              <Input
                                placeholder={l.needs_reason ? 'Note required for a large difference' : 'Note'}
                                value={r.notes}
                                onChange={(e) => setReasons((p) => ({ ...p, [l.item_id]: { ...r, notes: e.target.value } }))}
                              />
                            </div>
                          ) : (
                            <span>
                              {REASONS_SHORT.find((o) => o.value === l.reason_code)?.label || 'Unexplained'}
                              {l.reason_notes ? `: ${l.reason_notes}` : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-gray-200">
            <h2 className="font-semibold text-gray-900 p-4">Held by others ({data.with_third_party.length})</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2">Held by</th>
                    <th className="px-4 py-2">Why</th>
                    <th className="px-4 py-2">Challan</th>
                    <th className="px-4 py-2">E-way bill</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2">Days out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.with_third_party.map((r: any) => (
                    <tr key={`${r.challan_id}-${r.item_id}`}>
                      <td className="px-4 py-2">{r.item_name}</td>
                      <td className="px-4 py-2">{r.party_name || '-'}</td>
                      <td className="px-4 py-2">{PURPOSE[r.purpose] || r.purpose}</td>
                      <td className="px-4 py-2">
                        <Link className="text-primary-700" href={`/delivery-challans/${r.challan_id}`}>
                          {r.challan_number}
                        </Link>
                      </td>
                      <td className={`px-4 py-2 ${r.eway_bill_status === 'expired' ? 'text-red-700' : ''}`}>
                        {r.eway_bill_number ? `${r.eway_bill_number} (${r.eway_bill_status})` : '-'}
                      </td>
                      <td className="px-4 py-2 text-right">{qty(r.qty)}</td>
                      <td className={`px-4 py-2 ${r.overdue ? 'text-red-700' : ''}`}>
                        {r.days_out}
                        {r.overdue ? ' (overdue)' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {data.in_transit.length > 0 && (
            <section className="bg-white rounded-xl border border-gray-200">
              <h2 className="font-semibold text-gray-900 p-4">In transit ({data.in_transit.length})</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left text-gray-600">
                    <tr>
                      <th className="px-4 py-2">Item</th>
                      <th className="px-4 py-2">Transfer</th>
                      <th className="px-4 py-2">To</th>
                      <th className="px-4 py-2">E-way bill</th>
                      <th className="px-4 py-2 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.in_transit.map((r: any) => (
                      <tr key={`${r.transfer_id}-${r.item_id}`}>
                        <td className="px-4 py-2">{r.item_name}</td>
                        <td className="px-4 py-2">
                          <Link className="text-primary-700" href={`/stock-transfers/${r.transfer_id}`}>
                            {r.transfer_number}
                          </Link>
                        </td>
                        <td className="px-4 py-2">{r.to_warehouse_name}</td>
                        <td className={`px-4 py-2 ${r.eway_bill_status === 'expired' ? 'text-red-700' : ''}`}>
                          {r.eway_bill_number ? `${r.eway_bill_number} (${r.eway_bill_status})` : '-'}
                        </td>
                        <td className="px-4 py-2 text-right">{qty(r.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <h2 className="font-semibold text-gray-900 p-4">Billed, on the way from suppliers</h2>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-2">Supplier</th>
                  <th className="px-4 py-2">Bill</th>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">E-way bill</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2">Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(data.inward_transit || []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                      Nothing is on the way from a supplier.
                    </td>
                  </tr>
                )}
                {(data.inward_transit || []).map((r: any) => (
                  <tr key={`${r.purchase_id}-${r.item_id}`}>
                    <td className="px-4 py-2">{r.supplier_name || '-'}</td>
                    <td className="px-4 py-2">
                      <Link className="text-primary-700" href={`/purchases/${r.purchase_id}`}>
                        {r.bill_number || 'Bill'}
                      </Link>
                      <div className="text-xs text-gray-500">{r.bill_date}</div>
                    </td>
                    <td className="px-4 py-2">{r.item_name}</td>
                    <td className={`px-4 py-2 ${r.eway_bill_status === 'expired' ? 'text-red-700' : ''}`}>
                      {r.eway_bill_number ? `${r.eway_bill_number} (${r.eway_bill_status})` : '-'}
                    </td>
                    <td className="px-4 py-2 text-right">{qty(r.qty)}</td>
                    <td className="px-4 py-2">{r.days_in_transit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="bg-white rounded-xl border border-gray-200">
            <h2 className="font-semibold text-gray-900 p-4">By class of inventory (CARO 2020, 3(ii)(a))</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-4 py-2">Class</th>
                    <th className="px-4 py-2 text-right">Book value in godown</th>
                    <th className="px-4 py-2 text-right">Shortage</th>
                    <th className="px-4 py-2 text-right">Excess</th>
                    <th className="px-4 py-2 text-right">Net difference</th>
                    <th className="px-4 py-2">Report</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.classes.map((k: any) => (
                    <tr key={k.stock_class}>
                      <td className="px-4 py-2 capitalize">{k.stock_class.replace('_', ' ')}</td>
                      <td className="px-4 py-2 text-right">{inr(k.book_value)}</td>
                      <td className="px-4 py-2 text-right">{inr(k.shortage_value)}</td>
                      <td className="px-4 py-2 text-right">{inr(k.excess_value)}</td>
                      <td className="px-4 py-2 text-right">
                        {inr(k.net_value)} ({k.discrepancy_pct}%)
                      </td>
                      <td className={`px-4 py-2 ${k.caro_flag ? 'text-red-700 font-medium' : 'text-gray-600'}`}>
                        {k.caro_flag ? '10% or more: auditor reports it' : 'Below 10%'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
