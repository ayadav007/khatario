'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useToastContext } from '@/contexts/ToastContext';

interface CountRow {
  id: string;
  count_number: string;
  count_date: string;
  status: 'counting' | 'review' | 'posted' | 'cancelled';
  warehouse_name: string | null;
  branch_name: string | null;
  lines: number;
  counted: number;
  freeze_stock: boolean;
}

const STATUS: Record<CountRow['status'], { label: string; cls: string }> = {
  counting: { label: 'Counting', cls: 'bg-amber-100 text-amber-800' },
  review: { label: 'In review', cls: 'bg-slate-100 text-primary-800' },
  posted: { label: 'Posted', cls: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-100 text-red-800' },
};

export default function StockCountsPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const { currentBranchId } = useBranch();
  const toast = useToastContext();
  const [counts, setCounts] = useState<CountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ warehouse_id: '', count_date: new Date().toISOString().slice(0, 10), blind: true, freeze_stock: true });
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!business?.id) return;
    load();
    fetch(`/api/warehouses?business_id=${business.id}&user_id=${user?.id}`)
      .then((r) => (r.ok ? r.json() : { warehouses: [] }))
      .then((d) => setWarehouses((d.warehouses || []).filter((w: any) => w.is_active !== false)))
      .catch(() => setWarehouses([]));
  }, [business?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/stock-counts');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not load stock counts');
        return;
      }
      setCounts(data.counts || []);
    } finally {
      setLoading(false);
    }
  }

  async function open() {
    if (warehouses.length > 0 && !form.warehouse_id) {
      toast.error('Choose the godown to count');
      return;
    }
    setOpening(true);
    try {
      const res = await fetch('/api/stock-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          warehouse_id: form.warehouse_id || null,
          branch_id: warehouses.length === 0 && currentBranchId && currentBranchId !== 'ALL' ? currentBranchId : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not open the count');
        return;
      }
      router.push(`/stock-counts/${data.id}`);
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock counts"
        subtitle="Count a godown, explain the difference, and post it"
        actions={
          <Button onClick={() => setShowNew((v) => !v)}>
            <Plus className="w-4 h-4 mr-2" />
            New count
          </Button>
        }
      />

      {showNew && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {warehouses.length > 0 && (
              <label className="text-sm text-gray-700">
                Godown
                <select
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  value={form.warehouse_id}
                  onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
                >
                  <option value="">Select godown</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm text-gray-700">
              Count date
              <Input type="date" value={form.count_date} onChange={(e) => setForm({ ...form, count_date: e.target.value })} />
            </label>
          </div>
          <div className="flex flex-col gap-2 text-sm text-gray-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.freeze_stock} onChange={(e) => setForm({ ...form, freeze_stock: e.target.checked })} />
              Freeze this godown while counting (no sales, purchases, transfers or adjustments touch it)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.blind} onChange={(e) => setForm({ ...form, blind: e.target.checked })} />
              Blind count (counters do not see the book quantity)
            </label>
          </div>
          <div className="flex justify-end">
            <Button onClick={open} isLoading={opening} disabled={opening}>
              <ClipboardCheck className="w-4 h-4 mr-2" />
              Open count
            </Button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Count</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Godown</th>
              <th className="px-4 py-3">Counted</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && counts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  No stock counts yet.
                </td>
              </tr>
            )}
            {counts.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-primary-700">
                  <Link href={`/stock-counts/${c.id}`}>{c.count_number}</Link>
                </td>
                <td className="px-4 py-3">{c.count_date}</td>
                <td className="px-4 py-3">{c.warehouse_name || c.branch_name || '-'}</td>
                <td className="px-4 py-3">
                  {c.counted} of {c.lines}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS[c.status].cls}`}>
                    {STATUS[c.status].label}
                    {c.freeze_stock && (c.status === 'counting' || c.status === 'review') ? ', stock frozen' : ''}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
