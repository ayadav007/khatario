'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';
import { downloadCsv } from '@/lib/reports/csv-download';

const inr = (n: number) => `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const CLASS: Record<string, string> = { trading: 'Stock in trade', raw_material: 'Raw material', wip: 'Work in progress', finished_goods: 'Finished goods' };

/** Stock statement for a cash-credit or overdraft limit, with an indicative drawing power. */
export default function BankStockStatementPage() {
  const toast = useToastContext();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [stockMargin, setStockMargin] = useState('25');
  const [debtorMargin, setDebtorMargin] = useState('25');
  const [debtorAge, setDebtorAge] = useState('90');
  const [data, setData] = useState<any>(null);

  async function load() {
    setData(null);
    const qs = new URLSearchParams({ as_of: asOf, stock_margin: stockMargin, debtor_margin: debtorMargin, debtor_age: debtorAge });
    const res = await fetch(`/api/reports/stock/bank-statement?${qs}`);
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error || 'Could not build the statement');
      return;
    }
    setData(json);
  }

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function exportCsv() {
    downloadCsv(
      `stock-statement-${asOf}.csv`,
      ['Item', 'Class', 'Qty', 'Unit cost', 'Value', 'Last purchase', 'Age', 'Slow moving'],
      data.stock.lines.map((l: any) => [l.item_name, CLASS[l.stock_class] || l.stock_class, l.qty, l.unit_cost, l.value, l.last_inward, l.age_bucket, l.slow_moving ? 'yes' : ''])
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock statement for the bank"
        subtitle="Owned stock, debtors and creditors as on a date, with an indicative drawing power"
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={!data}>
            <Download className="w-4 h-4 mr-2" />
            CSV
          </Button>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-gray-700">
          As on
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <label className="text-sm text-gray-700 w-32">
          Stock margin %
          <Input type="number" min={0} max={100} value={stockMargin} onChange={(e) => setStockMargin(e.target.value)} />
        </label>
        <label className="text-sm text-gray-700 w-32">
          Debtor margin %
          <Input type="number" min={0} max={100} value={debtorMargin} onChange={(e) => setDebtorMargin(e.target.value)} />
        </label>
        <label className="text-sm text-gray-700">
          Debtors up to
          <select className="mt-1 block border border-gray-300 rounded-md px-3 py-2 text-sm" value={debtorAge} onChange={(e) => setDebtorAge(e.target.value)}>
            <option value="30">30 days past due</option>
            <option value="60">60 days past due</option>
            <option value="90">90 days past due</option>
          </select>
        </label>
        <Button onClick={load}>Show</Button>
      </div>

      {!data && <div className="text-gray-500">Loading...</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ['Stock', inr(data.stock.total_value)],
              ['Less creditors', inr(data.creditors.total)],
              ['Paid stock', inr(data.paid_stock)],
              ['Eligible debtors', inr(data.eligible_debtors)],
              ['Drawing power', inr(data.drawing_power)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-xs text-gray-600">{k}</div>
                <div className="text-lg font-semibold text-gray-900">{v}</div>
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-600">
            Drawing power = paid stock × (1 − stock margin) + eligible debtors × (1 − debtor margin). Your sanction letter decides the
            margins and what counts; this is a working figure. Slow-moving stock (no sale in 90 days): {inr(data.stock.slow_moving_value)}.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <section className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900 mb-2">Stock by class</h2>
              {data.stock.by_class.map((c: any) => (
                <div key={c.stock_class} className="flex justify-between text-sm py-1">
                  <span>{CLASS[c.stock_class] || c.stock_class}</span>
                  <span>{inr(c.value)}</span>
                </div>
              ))}
            </section>
            <section className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900 mb-2">Stock by age (since last purchase)</h2>
              {data.stock.by_age.map((a: any) => (
                <div key={a.bucket} className="flex justify-between text-sm py-1">
                  <span>{a.bucket === 'no purchase' ? 'Opening stock, never bought since' : `${a.bucket} days`}</span>
                  <span>{inr(a.value)}</span>
                </div>
              ))}
            </section>
            <section className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="font-semibold text-gray-900 mb-2">Debtors and creditors</h2>
              {[
                ['Not due', 'not_due'],
                ['0-30 days', 'age_0_30'],
                ['31-60 days', 'age_30_60'],
                ['61-90 days', 'age_60_90'],
                ['Over 90 days', 'age_90_plus'],
              ].map(([label, key]) => (
                <div key={key} className="flex justify-between text-sm py-1">
                  <span>{label}</span>
                  <span>
                    {inr(data.debtors[key])} / {inr(data.creditors[key])}
                  </span>
                </div>
              ))}
              <div className="flex justify-between text-sm py-1 font-medium border-t border-gray-100 mt-1">
                <span>Total</span>
                <span>
                  {inr(data.debtors.total)} / {inr(data.creditors.total)}
                </span>
              </div>
            </section>
          </div>

          <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-left">Class</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-left">Last purchase</th>
                  <th className="px-3 py-2 text-left">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.stock.lines.map((l: any) => (
                  <tr key={l.item_id}>
                    <td className="px-3 py-2">
                      {l.item_name}
                      {l.slow_moving && <span className="ml-2 text-xs text-amber-700">slow moving</span>}
                    </td>
                    <td className="px-3 py-2">{CLASS[l.stock_class] || l.stock_class}</td>
                    <td className="px-3 py-2 text-right">{qty(l.qty)}</td>
                    <td className="px-3 py-2 text-right">{inr(l.value)}</td>
                    <td className="px-3 py-2">{l.last_inward || '-'}</td>
                    <td className="px-3 py-2">{l.age_bucket}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
