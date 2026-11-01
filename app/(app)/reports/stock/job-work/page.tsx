'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import { downloadCsv, financialYearOf } from '@/lib/reports/csv-download';

const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** ITC-04 periods: half-yearly (turnover over ₹5 crore) or the whole year. */
function periods() {
  const fy = financialYearOf();
  const y = Number(fy.from.slice(0, 4));
  const list = [];
  for (const start of [y, y - 1]) {
    list.push({ key: `${start}-H1`, label: `Apr–Sep ${start}`, from: `${start}-04-01`, to: `${start}-09-30` });
    list.push({ key: `${start}-H2`, label: `Oct ${start}–Mar ${start + 1}`, from: `${start}-10-01`, to: `${start + 1}-03-31` });
    list.push({ key: `${start}-FY`, label: `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`, from: `${start}-04-01`, to: `${start + 1}-03-31` });
  }
  return list;
}

/** Goods sent to and received from job workers (ITC-04), and what is still out with its deadline. */
export default function JobWorkPage() {
  const toast = useToastContext();
  const options = periods();
  const today = new Date().toISOString().slice(0, 10);
  const current = options.find((o) => !o.key.endsWith('FY') && o.from <= today && today <= o.to) || options[0];
  const [period, setPeriod] = useState(current.key);
  const [data, setData] = useState<any>(null);
  const p = options.find((o) => o.key === period) || options[0];

  useEffect(() => {
    setData(null);
    fetch(`/api/reports/stock/job-work?from=${p.from}&to=${p.to}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || 'Could not load the register');
        setData(json);
      })
      .catch((e) => toast.error(e.message));
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  function exportSent() {
    downloadCsv(
      `itc04-sent-${p.from}-${p.to}.csv`,
      ['Job worker GSTIN', 'Job worker', 'State', 'Challan number', 'Challan date', 'Goods', 'Description', 'HSN', 'UQC', 'Quantity', 'Taxable value', 'Tax rate', 'IGST', 'CGST', 'SGST'],
      data.sent.map((r: any) => [r.job_worker_gstin, r.job_worker, r.job_worker_state, r.challan_number, r.challan_date, r.job_work_goods, r.item_name, r.hsn_sac, r.uqc, r.qty, r.taxable_value, r.tax_rate, r.igst, r.cgst, r.sgst])
    );
  }

  function exportReceived() {
    downloadCsv(
      `itc04-received-${p.from}-${p.to}.csv`,
      ['Job worker GSTIN', 'Job worker', 'Original challan', 'Original challan date', 'Received on', 'Description', 'HSN', 'UQC', 'Quantity received', 'Quantity lost'],
      data.received.map((r: any) => [r.job_worker_gstin, r.job_worker, r.challan_number, r.challan_date, r.return_date, r.item_name, r.hsn_sac, r.uqc, r.qty_returned, r.qty_lost])
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Job work (ITC-04)" subtitle="Goods sent to job workers, received back, and still out with the s.143 deadline" />
      <select className="border border-gray-300 rounded-md px-3 py-2 text-sm" value={period} onChange={(e) => setPeriod(e.target.value)}>
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>

      {!data && <div className="text-gray-500">Loading...</div>}
      {data && (
        <>
          <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <h2 className="font-semibold text-gray-900 p-4">Still out ({data.open.length})</h2>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">Job worker</th>
                  <th className="px-3 py-2 text-left">Challan</th>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Out</th>
                  <th className="px-3 py-2 text-left">Must be back by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.open.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                      Nothing is with a job worker.
                    </td>
                  </tr>
                )}
                {data.open.map((r: any, i: number) => (
                  <tr key={i} className={r.deemed_supply ? 'bg-red-50' : r.days_left <= 30 ? 'bg-amber-50' : ''}>
                    <td className="px-3 py-2">{r.job_worker || '-'}</td>
                    <td className="px-3 py-2">
                      <Link className="text-primary-700" href={`/delivery-challans/${r.challan_id}`}>
                        {r.challan_number}
                      </Link>
                      <div className="text-xs text-gray-500">{r.challan_date}</div>
                    </td>
                    <td className="px-3 py-2">{r.item_name}</td>
                    <td className="px-3 py-2 text-right">{qty(r.qty_open)}</td>
                    <td className="px-3 py-2">
                      {r.deadline}
                      <div className={`text-xs ${r.deemed_supply ? 'text-red-700' : 'text-gray-500'}`}>
                        {r.deemed_supply
                          ? 'Past the deadline: treated as supplied on the challan date; pay GST with interest'
                          : `${r.days_left} days left`}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <div className="flex items-center justify-between p-4">
              <h2 className="font-semibold text-gray-900">Sent to job workers ({data.sent.length})</h2>
              <Button size="sm" variant="secondary" onClick={exportSent} disabled={!data.sent.length}>
                <Download className="w-4 h-4 mr-2" />
                CSV
              </Button>
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">Job worker</th>
                  <th className="px-3 py-2 text-left">Challan</th>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-left">HSN</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Taxable value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.sent.map((r: any, i: number) => (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      {r.job_worker || '-'}
                      <div className="text-xs text-gray-500">{r.job_worker_gstin || 'No GSTIN'}</div>
                    </td>
                    <td className="px-3 py-2">
                      {r.challan_number}
                      <div className="text-xs text-gray-500">{r.challan_date}</div>
                    </td>
                    <td className="px-3 py-2">{r.item_name}</td>
                    <td className="px-3 py-2">{r.hsn_sac || '-'}</td>
                    <td className="px-3 py-2 text-right">
                      {qty(r.qty)} {r.uqc}
                    </td>
                    <td className="px-3 py-2 text-right">{r.taxable_value.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <div className="flex items-center justify-between p-4">
              <h2 className="font-semibold text-gray-900">Received back ({data.received.length})</h2>
              <Button size="sm" variant="secondary" onClick={exportReceived} disabled={!data.received.length}>
                <Download className="w-4 h-4 mr-2" />
                CSV
              </Button>
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">Job worker</th>
                  <th className="px-3 py-2 text-left">Original challan</th>
                  <th className="px-3 py-2 text-left">Received on</th>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Received</th>
                  <th className="px-3 py-2 text-right">Lost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.received.map((r: any, i: number) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{r.job_worker || '-'}</td>
                    <td className="px-3 py-2">
                      {r.challan_number}
                      <div className="text-xs text-gray-500">{r.challan_date}</div>
                    </td>
                    <td className="px-3 py-2">{r.return_date}</td>
                    <td className="px-3 py-2">{r.item_name}</td>
                    <td className="px-3 py-2 text-right">{qty(r.qty_returned)}</td>
                    <td className="px-3 py-2 text-right">{qty(r.qty_lost)}</td>
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
