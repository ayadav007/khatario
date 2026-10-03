'use client';

import { useState } from 'react';
import { inputCls, State, Table, useJson } from './shared';

type MetricsRow = {
  campaign: string;
  ad_id: string | null;
  leads: number;
  qualified: number;
  demo: number;
  demo_read: number;
  trial: number;
  activated: number;
  converted: number;
  lost: number;
  revenue: number;
};

function pct(n: number, d: number) {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : '—';
}

const STAGES: Array<{ key: keyof MetricsRow; label: string }> = [
  { key: 'leads', label: 'Enquiries' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'demo', label: 'Demo sent' },
  { key: 'trial', label: 'Trial created' },
  { key: 'activated', label: 'First invoice' },
  { key: 'converted', label: 'Paid' },
];

export function MetricsTab() {
  const [days, setDays] = useState(30);
  const { data, error, loading } = useJson<{ totals: MetricsRow; rows: MetricsRow[] }>(`/api/admin/sales-flow/metrics?days=${days}`);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-gray-700">
        Leads created in the last
        <select className={`${inputCls} w-32`} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 14, 30, 90, 180, 365].map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </div>
      {!data ? (
        <State loading={loading} error={error} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {STAGES.map((s, i) => {
              const v = data.totals[s.key] as number;
              const prev = i === 0 ? null : (data.totals[STAGES[i - 1].key] as number);
              return (
                <div key={s.key} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{v}</p>
                  {prev != null ? <p className="text-xs text-gray-500">{pct(v, prev)} of previous</p> : <p className="text-xs text-gray-500">&nbsp;</p>}
                </div>
              );
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Enquiry to first invoice</p>
              <p className="mt-1 text-2xl font-bold text-primary-700">{pct(data.totals.activated, data.totals.leads)}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Demo seen (read receipt)</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{pct(data.totals.demo_read, data.totals.demo)}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">Revenue from converted leads</p>
              <p className="mt-1 text-2xl font-bold text-green-700">₹{Math.round(data.totals.revenue).toLocaleString('en-IN')}</p>
            </div>
          </div>
          <Table head={['Campaign', 'Ad', 'Enquiries', 'Qualified', 'Demo', 'Trial', 'First invoice', 'Paid', 'Lost', 'Revenue']} empty={data.rows.length === 0}>
            {data.rows.map((r) => (
              <tr key={`${r.campaign}-${r.ad_id}`}>
                <td className="px-4 py-3 font-medium text-gray-900">{r.campaign}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{r.ad_id || '—'}</td>
                <td className="px-4 py-3">{r.leads}</td>
                <td className="px-4 py-3">
                  {r.qualified} <span className="text-xs text-gray-400">{pct(r.qualified, r.leads)}</span>
                </td>
                <td className="px-4 py-3">
                  {r.demo} <span className="text-xs text-gray-400">{pct(r.demo, r.leads)}</span>
                </td>
                <td className="px-4 py-3">
                  {r.trial} <span className="text-xs text-gray-400">{pct(r.trial, r.leads)}</span>
                </td>
                <td className="px-4 py-3">
                  {r.activated} <span className="text-xs text-gray-400">{pct(r.activated, r.leads)}</span>
                </td>
                <td className="px-4 py-3">
                  {r.converted} <span className="text-xs text-gray-400">{pct(r.converted, r.leads)}</span>
                </td>
                <td className="px-4 py-3">{r.lost}</td>
                <td className="px-4 py-3">₹{Math.round(r.revenue).toLocaleString('en-IN')}</td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-gray-500">
            Spend and cost per lead come from Meta Ads Manager; divide spend by the enquiries or trials here for cost per stage.
          </p>
        </>
      )}
    </div>
  );
}
