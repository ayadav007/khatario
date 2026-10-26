'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Upload } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

const STATUS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  expired: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-700',
  rejected: 'bg-gray-100 text-gray-700',
  closed: 'bg-slate-100 text-primary-800',
};
const SOURCE_URL: Record<string, string> = {
  invoice: '/invoices',
  delivery_challan: '/delivery-challans',
  purchase: '/purchases',
  stock_transfer: '/stock-transfers',
};

/**
 * E-way bills recorded against documents, with validity, and an import of the e-way bills
 * suppliers generated for goods coming to us. Unmatched ones are goods with no bill booked.
 */
export default function EwayBillsPage() {
  const toast = useToastContext();
  const [bills, setBills] = useState<any[]>([]);
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch('/api/eway-bills');
    const data = await res.json();
    if (!res.ok) return toast.error(data.error || 'Could not load e-way bills');
    setBills(data.eway_bills || []);
  }
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function runImport() {
    setBusy(true);
    try {
      const res = await fetch('/api/eway-bills/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || 'Could not import');
      setResult(data);
      toast.success(`${data.matched.length} matched, ${data.unmatched.length} with no bill`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="E-way bills" subtitle="Recorded e-way bills with their validity, and inward e-way bills from the portal" />

      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold text-gray-900">Import inward e-way bills</h2>
        <p className="text-sm text-gray-600">
          Download the list of e-way bills generated against your GSTIN from the portal as CSV, then upload or paste it here. Each is matched to
          a purchase bill by supplier GSTIN and bill number; those with no bill are listed below.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-primary-700 cursor-pointer">
            <Upload className="w-4 h-4" />
            Choose CSV file
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setCsv(await f.text());
              }}
            />
          </label>
          {csv && <span className="text-xs text-gray-500">{csv.split(/\r?\n/).length - 1} rows read</span>}
        </div>
        <textarea
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs font-mono h-28"
          placeholder="…or paste the CSV here (first row is the header)"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        <div className="flex justify-end">
          <Button onClick={runImport} isLoading={busy} disabled={busy || !csv.trim()}>
            Import
          </Button>
        </div>
        {result && (
          <div className="space-y-2 text-sm">
            <p>
              {result.matched.length} recorded on their bills, {result.already.length} already recorded, {result.unmatched.length} with no
              matching bill, {result.invalid.length} unreadable.
            </p>
            {result.unmatched.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="font-medium text-amber-900 mb-1">Goods sent to you with no bill booked</div>
                <table className="min-w-full text-xs">
                  <thead className="text-left text-amber-900">
                    <tr>
                      <th className="py-1 pr-3">E-way bill</th>
                      <th className="py-1 pr-3">Supplier</th>
                      <th className="py-1 pr-3">Doc</th>
                      <th className="py-1 pr-3">Date</th>
                      <th className="py-1 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.unmatched.map((u: any) => (
                      <tr key={u.ewb_number}>
                        <td className="py-1 pr-3">{u.ewb_number}</td>
                        <td className="py-1 pr-3">{u.supplier_name || u.from_gstin || '-'}</td>
                        <td className="py-1 pr-3">{u.doc_number || '-'}</td>
                        <td className="py-1 pr-3">{u.doc_date || '-'}</td>
                        <td className="py-1 text-right">{Number(u.value).toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {result.invalid.length > 0 && (
              <ul className="text-xs text-red-700">
                {result.invalid.slice(0, 20).map((x: any) => (
                  <li key={x.line}>
                    Row {x.line}: {x.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2">E-way bill</th>
              <th className="px-3 py-2">Direction</th>
              <th className="px-3 py-2">Document</th>
              <th className="px-3 py-2">Generated</th>
              <th className="px-3 py-2">Valid until</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bills.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                  No e-way bills recorded yet.
                </td>
              </tr>
            )}
            {bills.map((b) => (
              <tr key={b.id}>
                <td className="px-3 py-2 font-medium">{b.ewb_number}</td>
                <td className="px-3 py-2 capitalize">{b.direction}</td>
                <td className="px-3 py-2">
                  {b.source_id && SOURCE_URL[b.source_type] ? (
                    <Link className="text-primary-700" href={`${SOURCE_URL[b.source_type]}/${b.source_id}`}>
                      {b.source_number || b.source_type.replace('_', ' ')}
                    </Link>
                  ) : (
                    b.source_type.replace('_', ' ')
                  )}
                </td>
                <td className="px-3 py-2">{new Date(b.generated_at).toLocaleString('en-IN')}</td>
                <td className="px-3 py-2">
                  {b.valid_until ? new Date(b.valid_until).toLocaleString('en-IN') : '-'}
                  {b.status === 'active' && b.hours_to_expiry !== null && b.hours_to_expiry < 24 && (
                    <div className="text-xs text-amber-700">{b.hours_to_expiry} hours left</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{Number(b.goods_value).toLocaleString('en-IN')}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS[b.status] || ''}`}>{b.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
