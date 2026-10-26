'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';
import { downloadCsv, financialYearOf } from '@/lib/reports/csv-download';

const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** Form 3CD clause 35(a): quantity details of goods traded, per item, for a year. */
export default function QuantitativeDetailsPage() {
  const toast = useToastContext();
  const fy = financialYearOf();
  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [rows, setRows] = useState<any[] | null>(null);

  async function load() {
    setRows(null);
    const res = await fetch(`/api/reports/stock/quantitative?from=${from}&to=${to}`);
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || 'Could not load the report');
      setRows([]);
      return;
    }
    setRows(data.rows);
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clause 35(b): manufacturers also report raw material consumed and goods produced.
  const hasMfg = (rows || []).some((r) => r.consumed || r.produced);
  const cols = hasMfg ? 13 : 11;

  function exportCsv() {
    downloadCsv(
      `3cd-clause-35-${from}-to-${to}.csv`,
      ['Item', 'Code', 'Unit', 'Opening', 'Purchases', 'Purchase returns', 'Consumed', 'Produced', 'Sales', 'Sales returns', 'Shortage', 'Excess', 'Other', 'Closing'],
      (rows || []).map((r) => [
        r.item_name, r.item_code, r.unit, r.opening, r.purchases, r.purchase_returns, r.consumed, r.produced, r.sales, r.sales_returns,
        r.shortage, r.excess, r.other, r.closing,
      ])
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quantity details (Form 3CD, clause 35)"
        subtitle="Opening, purchases, sales, closing and shortage or excess for each item, in its unit"
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={!rows?.length}>
            <Download className="w-4 h-4 mr-2" />
            CSV
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-gray-700">
          From
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm text-gray-700">
          To
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button onClick={load}>Show</Button>
      </div>
      <p className="text-sm text-gray-600">
        Closing includes goods in transit and goods out with job workers or on approval: they are still owned. Shortage and excess come
        from stock adjustments, including stock counts.
      </p>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Unit</th>
              <th className="px-3 py-2 text-right">Opening</th>
              <th className="px-3 py-2 text-right">Purchases</th>
              <th className="px-3 py-2 text-right">Purchase returns</th>
              {hasMfg && <th className="px-3 py-2 text-right">Consumed</th>}
              {hasMfg && <th className="px-3 py-2 text-right">Produced</th>}
              <th className="px-3 py-2 text-right">Sales</th>
              <th className="px-3 py-2 text-right">Sales returns</th>
              <th className="px-3 py-2 text-right">Shortage</th>
              <th className="px-3 py-2 text-right">Excess</th>
              <th className="px-3 py-2 text-right">Other</th>
              <th className="px-3 py-2 text-right">Closing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows === null && (
              <tr>
                <td colSpan={cols} className="px-3 py-6 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={cols} className="px-3 py-6 text-center text-gray-500">
                  No stock moved in this period.
                </td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.item_id}>
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">{r.item_name}</div>
                  {r.item_code && <div className="text-xs text-gray-500">{r.item_code}</div>}
                </td>
                <td className="px-3 py-2">{r.unit}</td>
                <td className="px-3 py-2 text-right">{qty(r.opening)}</td>
                <td className="px-3 py-2 text-right">{qty(r.purchases)}</td>
                <td className="px-3 py-2 text-right">{qty(r.purchase_returns)}</td>
                {hasMfg && <td className="px-3 py-2 text-right">{qty(r.consumed)}</td>}
                {hasMfg && <td className="px-3 py-2 text-right">{qty(r.produced)}</td>}
                <td className="px-3 py-2 text-right">{qty(r.sales)}</td>
                <td className="px-3 py-2 text-right">{qty(r.sales_returns)}</td>
                <td className={`px-3 py-2 text-right ${r.shortage ? 'text-red-700' : ''}`}>{qty(r.shortage)}</td>
                <td className="px-3 py-2 text-right">{qty(r.excess)}</td>
                <td className="px-3 py-2 text-right">{qty(r.other)}</td>
                <td className="px-3 py-2 text-right font-medium">{qty(r.closing)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
