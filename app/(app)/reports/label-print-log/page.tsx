'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Printer,
  Download,
  Package,
  ShoppingBag,
  User,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';

interface LogLineSnapshot {
  product_name?: string;
  variant_name?: string | null;
  barcode?: string;
  copies?: number;
  price?: number | null;
  mrp?: number | null;
  batch_number?: string | null;
  expiry_date?: string | null;
}

interface LogEntry {
  id: string;
  purpose: string;
  template_id: string | null;
  template_name: string | null;
  purchase_id: string | null;
  bill_number: string | null;
  format: string;
  layout: string | null;
  symbology: string | null;
  line_count: number;
  total_labels: number;
  lines_snapshot: LogLineSnapshot[];
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

function LabelPrintAuditPage() {
  const { business, user } = useAuth();

  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultTo = useMemo(
    () => new Date().toISOString().split('T')[0],
    []
  );

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [purpose, setPurpose] = useState('');
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [totals, setTotals] = useState({ jobs: 0, labels: 0 });
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (business?.id && user?.id) fetchData();
  }, [business?.id, user?.id]);

  async function fetchData() {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user.id,
      });
      if (from) params.set('from', from);
      if (to) params.set('to', `${to}T23:59:59`);
      if (purpose) params.set('purpose', purpose);
      const res = await fetch(
        `/api/reports/label-print-log?${params.toString()}`
      );
      if (res.ok) {
        const json = await res.json();
        setEntries(json.entries || []);
        setTotals({
          jobs: json.total_jobs || 0,
          labels: json.total_labels || 0,
        });
      }
    } catch (err) {
      console.error('fetch audit log failed', err);
    } finally {
      setLoading(false);
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function purposeIcon(p: string) {
    if (p === 'purchase')
      return <ShoppingBag className="w-4 h-4 text-purple-600" />;
    if (p === 'item_create')
      return <Package className="w-4 h-4 text-green-600" />;
    return <Printer className="w-4 h-4 text-primary-600" />;
  }

  function purposeLabel(p: string) {
    if (p === 'purchase') return 'Purchase / GRN';
    if (p === 'item_create') return 'Item Create';
    return 'Standalone';
  }

  function exportCsv() {
    const header = [
      'When',
      'User',
      'Purpose',
      'Template',
      'Bill / Purchase',
      'Format',
      'Layout',
      'Symbology',
      'Lines',
      'Total Labels',
    ];
    const rows = entries.map((e) => [
      new Date(e.created_at).toLocaleString(),
      e.user_name || e.user_email || '',
      purposeLabel(e.purpose),
      e.template_name || '',
      e.bill_number || '',
      e.format,
      e.layout || '',
      e.symbology || '',
      String(e.line_count),
      String(e.total_labels),
    ]);
    const csv = [header, ...rows]
      .map((r) =>
        r
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `label-print-log-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Reports', href: '/reports' },
          { label: 'Label Printing Activity' },
        ]}
      />

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Label Printing Activity
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Audit trail of every barcode label print job run in this business.
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={entries.length === 0}
          className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Purpose</label>
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value="">All</option>
              <option value="standalone">Standalone</option>
              <option value="purchase">Purchase / GRN</option>
              <option value="item_create">Item Create</option>
            </select>
          </div>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700"
          >
            Apply
          </button>
          <div className="ml-auto text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{totals.jobs}</span>{' '}
            jobs &nbsp;&middot;&nbsp;{' '}
            <span className="font-semibold text-gray-900">
              {totals.labels}
            </span>{' '}
            labels
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-16 flex items-center justify-center text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading audit log...
          </div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center text-gray-500">
            <Printer className="w-10 h-10 mx-auto mb-3 text-gray-300" />
            <p className="font-medium text-gray-700">No label print jobs</p>
            <p className="text-sm mt-1">
              Adjust the filters above, or print some labels from Inventory.
            </p>
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="w-8"></th>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Purpose</th>
                <th className="px-4 py-3">Template</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3 text-right">Lines</th>
                <th className="px-4 py-3 text-right">Labels</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const isOpen = !!expanded[e.id];
                return (
                  <>
                    <tr
                      key={e.id}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                      onClick={() => toggleExpanded(e.id)}
                    >
                      <td className="pl-4 text-gray-400">
                        {isOpen ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-900">
                        {new Date(e.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 text-gray-700">
                          <User className="w-4 h-4 text-gray-400" />
                          {e.user_name || e.user_email || 'Unknown'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs">
                          {purposeIcon(e.purpose)}
                          {purposeLabel(e.purpose)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {e.template_name || (
                          <span className="text-gray-400 italic">
                            Default {e.layout || 'A4'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {e.bill_number ? `Bill ${e.bill_number}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {e.line_count}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {e.total_labels}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <td></td>
                        <td colSpan={7} className="px-4 py-3">
                          <div className="text-xs text-gray-500 mb-2">
                            {e.format.toUpperCase()} &middot;{' '}
                            {e.symbology || 'auto'} &middot; {e.layout || '—'}
                          </div>
                          {e.lines_snapshot?.length ? (
                            <div className="max-h-64 overflow-auto border border-gray-200 rounded-lg bg-white">
                              <table className="min-w-full text-xs">
                                <thead className="bg-gray-100">
                                  <tr className="text-left text-gray-500">
                                    <th className="px-3 py-2">Product</th>
                                    <th className="px-3 py-2">Variant</th>
                                    <th className="px-3 py-2">Barcode</th>
                                    <th className="px-3 py-2">Batch</th>
                                    <th className="px-3 py-2">Expiry</th>
                                    <th className="px-3 py-2 text-right">
                                      Copies
                                    </th>
                                    <th className="px-3 py-2 text-right">
                                      MRP
                                    </th>
                                    <th className="px-3 py-2 text-right">
                                      Price
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {e.lines_snapshot.map((l, i) => (
                                    <tr
                                      key={i}
                                      className="border-t border-gray-100"
                                    >
                                      <td className="px-3 py-1.5 text-gray-800">
                                        {l.product_name || '—'}
                                      </td>
                                      <td className="px-3 py-1.5 text-gray-600">
                                        {l.variant_name || '—'}
                                      </td>
                                      <td className="px-3 py-1.5 font-mono text-gray-700">
                                        {l.barcode || '—'}
                                      </td>
                                      <td className="px-3 py-1.5 text-gray-700">
                                        {l.batch_number || '—'}
                                      </td>
                                      <td className="px-3 py-1.5 text-gray-700">
                                        {l.expiry_date
                                          ? new Date(
                                              l.expiry_date
                                            ).toLocaleDateString()
                                          : '—'}
                                      </td>
                                      <td className="px-3 py-1.5 text-right text-gray-900">
                                        {l.copies || 1}
                                      </td>
                                      <td className="px-3 py-1.5 text-right text-gray-700">
                                        {l.mrp != null
                                          ? `₹${Number(l.mrp).toFixed(2)}`
                                          : '—'}
                                      </td>
                                      <td className="px-3 py-1.5 text-right text-gray-700">
                                        {l.price != null
                                          ? `₹${Number(l.price).toFixed(2)}`
                                          : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500 italic">
                              No line detail captured.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default withPageAuth('reports', 'read', LabelPrintAuditPage);
