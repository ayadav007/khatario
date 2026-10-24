'use client';

import { useEffect, useState } from 'react';
import { PartnerShell } from '@/components/partners/PartnerShell';

type Deal = {
  id: string;
  contact_name: string;
  contact_phone: string | null;
  company_name: string | null;
  stage: string;
  business_id: string | null;
  business_name: string | null;
};

const STAGES = [
  'lead',
  'contacted',
  'demo_booked',
  'demo_done',
  'trial',
  'proposal',
  'won',
  'lost',
];

export default function PartnerDealsPage() {
  const [name, setName] = useState('');
  const [deals, setDeals] = useState<Deal[]>([]);
  const [form, setForm] = useState({
    contact_name: '',
    contact_phone: '',
    company_name: '',
  });
  const [claimPhone, setClaimPhone] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function reload() {
    const [meRes, dealsRes] = await Promise.all([
      fetch('/api/partners/me', { credentials: 'include' }),
      fetch('/api/partners/deals', { credentials: 'include' }),
    ]);
    if (!meRes.ok) {
      window.location.href = '/partners/login';
      return;
    }
    const me = await meRes.json();
    const data = await dealsRes.json();
    setName(me.partner?.name || '');
    setDeals(data.deals || []);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function createDeal(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    const res = await fetch('/api/partners/deals', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to create deal');
      return;
    }
    setForm({ contact_name: '', contact_phone: '', company_name: '' });
    setMessage('Deal created');
    await reload();
  }

  async function updateStage(id: string, stage: string) {
    await fetch(`/api/partners/deals/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    });
    await reload();
  }

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    const res = await fetch('/api/partners/claim', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: claimPhone }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Claim failed');
      return;
    }
    setClaimPhone('');
    setMessage(
      data.created
        ? 'Business claimed — commission will apply when they pay.'
        : 'Already attributed to you.',
    );
    await reload();
  }

  return (
    <PartnerShell partnerName={name}>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">Deals & pipeline</h1>
      <p className="mb-6 text-sm text-slate-600">
        Track demos and closes. Commission still only creates when payment settles.
      </p>

      {message ? <p className="mb-3 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <form onSubmit={createDeal} className="rounded-xl border bg-white p-4 space-y-3">
          <h2 className="font-semibold">Add lead</h2>
          <input
            className="w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="Contact name *"
            value={form.contact_name}
            onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
            required
          />
          <input
            className="w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="Phone"
            value={form.contact_phone}
            onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
          />
          <input
            className="w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="Company"
            value={form.company_name}
            onChange={(e) => setForm({ ...form, company_name: e.target.value })}
          />
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
          >
            Add deal
          </button>
        </form>

        <form onSubmit={claim} className="rounded-xl border bg-white p-4 space-y-3">
          <h2 className="font-semibold">Claim trial business</h2>
          <p className="text-xs text-slate-500">
            If they signed up without your link, claim by primary admin phone before they pay.
          </p>
          <input
            className="w-full rounded-lg border px-3 py-2 text-sm"
            placeholder="Customer phone"
            value={claimPhone}
            onChange={(e) => setClaimPhone(e.target.value)}
            required
          />
          <button
            type="submit"
            className="rounded-lg border border-emerald-600 px-3 py-2 text-sm font-medium text-emerald-700"
          >
            Claim for commission
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Linked business</th>
            </tr>
          </thead>
          <tbody>
            {deals.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  No deals yet
                </td>
              </tr>
            ) : (
              deals.map((d) => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium">{d.contact_name}</div>
                    <div className="text-xs text-slate-500">{d.contact_phone}</div>
                  </td>
                  <td className="px-4 py-3">{d.company_name || '—'}</td>
                  <td className="px-4 py-3">
                    <select
                      className="rounded border px-2 py-1 text-sm"
                      value={d.stage}
                      onChange={(e) => updateStage(d.id, e.target.value)}
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">{d.business_name || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PartnerShell>
  );
}
