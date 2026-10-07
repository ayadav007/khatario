'use client';

import { useEffect, useState } from 'react';
import { PartnerShell } from '@/components/partners/PartnerShell';

export default function PartnerProfilePage() {
  const [name, setName] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [form, setForm] = useState({
    phone: '',
    pan: '',
    gstin: '',
    bank_account_name: '',
    bank_account_number: '',
    bank_ifsc: '',
    upi_id: '',
  });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const [meRes, profRes] = await Promise.all([
        fetch('/api/partners/me', { credentials: 'include' }),
        fetch('/api/partners/profile', { credentials: 'include' }),
      ]);
      if (!meRes.ok) {
        window.location.href = '/partners/login';
        return;
      }
      setName((await meRes.json()).partner?.name || '');
      const data = await profRes.json();
      setCanEdit(Boolean(data.canEdit));
      const p = data.partner || {};
      setForm({
        phone: p.phone || '',
        pan: p.pan || '',
        gstin: p.gstin || '',
        bank_account_name: p.bank_account_name || '',
        bank_account_number: p.bank_account_number || '',
        bank_ifsc: p.bank_ifsc || '',
        upi_id: p.upi_id || '',
      });
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    const res = await fetch('/api/partners/profile', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Save failed');
      return;
    }
    setMessage('Profile saved');
  }

  return (
    <PartnerShell partnerName={name}>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">Payout profile</h1>
      <p className="mb-6 text-sm text-slate-600">
        PAN is used for TDS. Without PAN, a higher TDS rate may apply when payouts are processed.
      </p>

      {message ? <p className="mb-2 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}

      <form
        onSubmit={save}
        className="grid max-w-xl gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2"
      >
        {(
          [
            ['phone', 'Phone'],
            ['pan', 'PAN'],
            ['gstin', 'GSTIN'],
            ['bank_account_name', 'Account name'],
            ['bank_account_number', 'Account number'],
            ['bank_ifsc', 'IFSC'],
            ['upi_id', 'UPI ID'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-sm sm:col-span-1">
            {label}
            <input
              className="mt-1 w-full rounded border px-3 py-2"
              value={form[key]}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          </label>
        ))}
        {canEdit ? (
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white">
              Save
            </button>
          </div>
        ) : (
          <p className="sm:col-span-2 text-sm text-slate-500">Only the owner can edit this.</p>
        )}
      </form>
    </PartnerShell>
  );
}
