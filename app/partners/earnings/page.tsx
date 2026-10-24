'use client';

import { useEffect, useState } from 'react';
import { PartnerShell } from '@/components/partners/PartnerShell';

type Commission = {
  id: string;
  business_name: string | null;
  sale_amount: number;
  commission_amount: number;
  status: string;
  eligible_at: string;
  created_at: string;
};

export default function PartnerEarningsPage() {
  const [name, setName] = useState('');
  const [rows, setRows] = useState<Commission[]>([]);
  const [summary, setSummary] = useState({ pending: 0, approved: 0, paid: 0 });

  useEffect(() => {
    (async () => {
      const [meRes, comRes] = await Promise.all([
        fetch('/api/partners/me', { credentials: 'include' }),
        fetch('/api/partners/commissions', { credentials: 'include' }),
      ]);
      if (!meRes.ok) {
        window.location.href = '/partners/login';
        return;
      }
      const me = await meRes.json();
      const data = await comRes.json();
      setName(me.partner?.name || '');
      setRows(data.commissions || []);
      setSummary(data.summary || { pending: 0, approved: 0, paid: 0 });
    })();
  }, []);

  const fmt = (n: number) =>
    `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  return (
    <PartnerShell partnerName={name}>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">Earnings</h1>
      <p className="mb-6 text-sm text-slate-600">
        Created automatically when a referred customer&apos;s subscription payment settles.
        Pending stays for the hold window (default 14 days) before approval.
      </p>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-white p-3 text-sm">
          Pending: <strong>{fmt(summary.pending)}</strong>
        </div>
        <div className="rounded-lg border bg-white p-3 text-sm">
          Approved: <strong>{fmt(summary.approved)}</strong>
        </div>
        <div className="rounded-lg border bg-white p-3 text-sm">
          Paid: <strong>{fmt(summary.paid)}</strong>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Sale</th>
              <th className="px-4 py-3">Commission</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Eligible</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No commissions yet. They appear after a paid conversion.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {r.business_name || 'Business'}
                  </td>
                  <td className="px-4 py-3">{fmt(r.sale_amount)}</td>
                  <td className="px-4 py-3 font-semibold text-emerald-700">
                    {fmt(r.commission_amount)}
                  </td>
                  <td className="px-4 py-3 capitalize">{r.status}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {new Date(r.eligible_at).toLocaleDateString('en-IN')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PartnerShell>
  );
}
