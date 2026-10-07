'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

export default function AdminPartnerDetailPage() {
  const params = useParams();
  const id = String(params.id || '');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [claimBusinessId, setClaimBusinessId] = useState('');
  const [form, setForm] = useState({
    commission_type: 'percentage',
    commission_value: '20',
    commission_basis: 'first_payment',
    hold_days: '',
    pan: '',
    status: 'active',
    referral_code: '',
  });

  async function load() {
    const res = await fetch(`/api/admin/partners/${id}`, platformAdminFetchInit);
    if (!res.ok) {
      setError('Failed to load partner');
      return;
    }
    const json = await res.json();
    setData(json);
    const p = json.partner;
    setForm({
      commission_type: p.commission_type,
      commission_value: String(p.commission_value),
      commission_basis: p.commission_basis,
      hold_days: p.hold_days == null ? '' : String(p.hold_days),
      pan: p.pan || '',
      status: p.status,
      referral_code: p.referral_code,
    });
  }

  useEffect(() => {
    if (id) void load();
  }, [id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    const res = await fetch(`/api/admin/partners/${id}`, {
      ...platformAdminFetchInit,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        commission_value: Number(form.commission_value),
        hold_days: form.hold_days === '' ? null : Number(form.hold_days),
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || 'Save failed');
      return;
    }
    setMessage('Saved');
    await load();
  }

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    const res = await fetch(`/api/admin/partners/${id}`, {
      ...platformAdminFetchInit,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim_business', business_id: claimBusinessId }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || 'Claim failed');
      return;
    }
    setMessage('Business attributed to partner');
    setClaimBusinessId('');
    await load();
  }

  if (!data?.partner) {
    return <div className="p-8 text-sm text-gray-600">{error || 'Loading…'}</div>;
  }

  const p = data.partner;

  return (
    <div className="p-4 sm:p-8">
      <Link href="/admin/partners" className="text-sm text-primary-700 hover:underline">
        ← Partners
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-gray-900">{p.name}</h1>
      <p className="text-sm text-gray-600">
        {p.email} · {p.partner_type} · code <code>{p.referral_code}</code>
      </p>
      {data.signupUrl ? (
        <p className="mt-2 break-all text-xs text-gray-500">{data.signupUrl}</p>
      ) : null}

      {message ? <p className="mt-3 text-sm text-green-700">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <form onSubmit={save} className="mt-6 grid max-w-2xl gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
        <label className="text-sm">
          Status
          <select
            className="mt-1 w-full rounded border px-3 py-2"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
          >
            <option value="active">active</option>
            <option value="pending">pending</option>
            <option value="suspended">suspended</option>
          </select>
        </label>
        <label className="text-sm">
          Referral code
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={form.referral_code}
            onChange={(e) => setForm({ ...form, referral_code: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="text-sm">
          Commission type
          <select
            className="mt-1 w-full rounded border px-3 py-2"
            value={form.commission_type}
            onChange={(e) => setForm({ ...form, commission_type: e.target.value })}
          >
            <option value="percentage">percentage</option>
            <option value="fixed">fixed</option>
          </select>
        </label>
        <label className="text-sm">
          Commission value
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={form.commission_value}
            onChange={(e) => setForm({ ...form, commission_value: e.target.value })}
          />
        </label>
        <label className="text-sm">
          Basis
          <select
            className="mt-1 w-full rounded border px-3 py-2"
            value={form.commission_basis}
            onChange={(e) => setForm({ ...form, commission_basis: e.target.value })}
          >
            <option value="first_payment">first_payment</option>
            <option value="recurring">recurring</option>
          </select>
        </label>
        <label className="text-sm">
          Hold days
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={form.hold_days}
            onChange={(e) => setForm({ ...form, hold_days: e.target.value })}
          />
        </label>
        <label className="text-sm sm:col-span-2">
          PAN
          <input
            className="mt-1 w-full rounded border px-3 py-2"
            value={form.pan}
            onChange={(e) => setForm({ ...form, pan: e.target.value })}
          />
        </label>
        <button type="submit" className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white">
          Save
        </button>
      </form>

      <form onSubmit={claim} className="mt-6 max-w-2xl rounded-xl border bg-white p-4 space-y-3">
        <h2 className="font-semibold">Admin claim business</h2>
        <input
          className="w-full rounded border px-3 py-2 text-sm"
          placeholder="Business UUID"
          value={claimBusinessId}
          onChange={(e) => setClaimBusinessId(e.target.value)}
          required
        />
        <button type="submit" className="rounded-lg border px-3 py-2 text-sm">
          Attribute to this partner
        </button>
      </form>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 font-semibold">Attributions</h2>
          <ul className="space-y-2 text-sm">
            {(data.attributions || []).map((a: any) => (
              <li key={a.business_id}>
                {a.business_name || a.business_id} · {a.source}
              </li>
            ))}
            {!data.attributions?.length ? (
              <li className="text-gray-500">None yet</li>
            ) : null}
          </ul>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <h2 className="mb-2 font-semibold">Recent commissions</h2>
          <ul className="space-y-2 text-sm">
            {(data.commissions || []).map((c: any) => (
              <li key={c.id}>
                ₹{Number(c.commission_amount).toLocaleString('en-IN')} · {c.status}
              </li>
            ))}
            {!data.commissions?.length ? (
              <li className="text-gray-500">None yet</li>
            ) : null}
          </ul>
        </div>
      </div>
    </div>
  );
}
