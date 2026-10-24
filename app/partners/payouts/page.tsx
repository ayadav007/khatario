'use client';

import { useEffect, useState } from 'react';
import { PartnerShell } from '@/components/partners/PartnerShell';

type Payout = {
  id: string;
  gross_amount: number;
  tds_amount: number;
  net_amount: number;
  tds_section: string | null;
  tds_rate_percent: number | null;
  status: string;
  payment_reference: string | null;
  paid_at: string | null;
  created_at: string;
};

export default function PartnerPayoutsPage() {
  const [name, setName] = useState('');
  const [rows, setRows] = useState<Payout[]>([]);

  useEffect(() => {
    (async () => {
      const [meRes, payRes] = await Promise.all([
        fetch('/api/partners/me', { credentials: 'include' }),
        fetch('/api/partners/payouts', { credentials: 'include' }),
      ]);
      if (!meRes.ok) {
        window.location.href = '/partners/login';
        return;
      }
      const me = await meRes.json();
      const data = await payRes.json();
      setName(me.partner?.name || '');
      setRows(data.payouts || []);
    })();
  }, []);

  const fmt = (n: number) =>
    `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

  return (
    <PartnerShell partnerName={name}>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">Payouts</h1>
      <p className="mb-6 text-sm text-slate-600">
        When Khatario pays you, TDS (if applicable) is deducted from gross commission and shown
        here. Keep PAN updated under Payout profile.
      </p>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Gross</th>
              <th className="px-4 py-3">TDS</th>
              <th className="px-4 py-3">Net paid</th>
              <th className="px-4 py-3">Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No payouts yet
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    {new Date(r.paid_at || r.created_at).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-4 py-3">{fmt(r.gross_amount)}</td>
                  <td className="px-4 py-3">
                    {fmt(r.tds_amount)}
                    {r.tds_section ? (
                      <span className="ml-1 text-xs text-slate-500">
                        ({r.tds_section}
                        {r.tds_rate_percent != null ? ` ${r.tds_rate_percent}%` : ''})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-semibold text-emerald-700">{fmt(r.net_amount)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.payment_reference || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PartnerShell>
  );
}
