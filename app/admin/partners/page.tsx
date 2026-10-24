'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgePercent, Plus, RefreshCw } from 'lucide-react';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

type Partner = {
  id: string;
  name: string;
  email: string;
  partner_type: string;
  referral_code: string;
  status: string;
  commission_type: string;
  commission_value: number;
  commission_basis: string;
  hold_days: number | null;
  pan: string | null;
};

type Settings = {
  default_hold_days: number;
  default_commission_value: number;
  default_commission_type: string;
  default_commission_basis: string;
  tds_enabled: boolean;
  tds_section: string;
  tds_rate_percent: number;
  tds_annual_threshold: number;
};

type Tab = 'partners' | 'payouts' | 'kit' | 'reports' | 'settings';

export default function AdminPartnersPage() {
  const [tab, setTab] = useState<Tab>('partners');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [kit, setKit] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [payoutPartnerId, setPayoutPartnerId] = useState('');
  const [approved, setApproved] = useState<any[]>([]);
  const [selectedCommissions, setSelectedCommissions] = useState<string[]>([]);
  const [paymentRef, setPaymentRef] = useState('');
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    referral_code: '',
    partner_type: 'freelancer',
    commission_type: 'percentage',
    commission_value: '20',
    commission_basis: 'first_payment',
    hold_days: '',
    pan: '',
  });
  const [kitForm, setKitForm] = useState({
    title: '',
    description: '',
    kind: 'link',
    url: '',
    body_text: '',
  });

  async function load() {
    setError('');
    const [pRes, sRes, payRes, kitRes, repRes] = await Promise.all([
      fetch('/api/admin/partners', platformAdminFetchInit),
      fetch('/api/admin/partners/settings', platformAdminFetchInit),
      fetch('/api/admin/partners/payouts', platformAdminFetchInit),
      fetch('/api/admin/partners/kit', platformAdminFetchInit),
      fetch('/api/admin/partners/reports', platformAdminFetchInit),
    ]);
    if (!pRes.ok) {
      setError('Failed to load partners');
      return;
    }
    setPartners((await pRes.json()).partners || []);
    if (sRes.ok) setSettings((await sRes.json()).settings);
    if (payRes.ok) setPayouts((await payRes.json()).payouts || []);
    if (kitRes.ok) setKit((await kitRes.json()).items || []);
    if (repRes.ok) setReport(await repRes.json());
  }

  useEffect(() => {
    void load();
  }, []);

  async function loadApproved(partnerId: string) {
    setPayoutPartnerId(partnerId);
    setSelectedCommissions([]);
    const res = await fetch(
      `/api/admin/partners/payouts?partner_id=${encodeURIComponent(partnerId)}`,
      platformAdminFetchInit,
    );
    const data = await res.json();
    setApproved(data.commissions || []);
  }

  async function createPartner(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    const res = await fetch('/api/admin/partners', {
      ...platformAdminFetchInit,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        commission_value: Number(form.commission_value),
        hold_days: form.hold_days === '' ? null : Number(form.hold_days),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Create failed');
      return;
    }
    setShowForm(false);
    setMessage(`Created ${data.partner.name} — code ${data.partner.referral_code}`);
    await load();
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const res = await fetch('/api/admin/partners/settings', {
      ...platformAdminFetchInit,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Settings save failed');
      return;
    }
    setSettings(data.settings);
    setMessage('Program settings saved');
  }

  async function runPayout(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    const res = await fetch('/api/admin/partners/payouts', {
      ...platformAdminFetchInit,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partner_id: payoutPartnerId,
        commission_ids: selectedCommissions,
        payment_reference: paymentRef || null,
        payment_method: 'bank_transfer',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Payout failed');
      return;
    }
    setMessage(
      `Payout done — gross ₹${data.gross}, TDS ₹${data.tds}, net ₹${data.net}`,
    );
    setSelectedCommissions([]);
    setPaymentRef('');
    await load();
    if (payoutPartnerId) await loadApproved(payoutPartnerId);
  }

  async function createKit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/admin/partners/kit', {
      ...platformAdminFetchInit,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kitForm),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Kit create failed');
      return;
    }
    setKitForm({ title: '', description: '', kind: 'link', url: '', body_text: '' });
    setMessage('Sales kit item added');
    await load();
  }

  async function uploadKitFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const title = window.prompt('Title for this file?', file.name);
    if (!title) return;
    const fd = new FormData();
    fd.set('title', title);
    fd.set('kind', 'file');
    fd.set('file', file);
    const res = await fetch('/api/admin/partners/kit', {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Upload failed');
      return;
    }
    setMessage('File uploaded to sales kit');
    await load();
  }

  async function toggleKit(id: string, isActive: boolean) {
    await fetch('/api/admin/partners/kit', {
      ...platformAdminFetchInit,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: isActive }),
    });
    await load();
  }

  async function deleteKit(id: string) {
    if (!confirm('Delete this kit item?')) return;
    await fetch(`/api/admin/partners/kit?id=${encodeURIComponent(id)}`, {
      ...platformAdminFetchInit,
      method: 'DELETE',
    });
    await load();
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/admin/partners/${id}`, {
      ...platformAdminFetchInit,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await load();
  }

  const fmt = (n: number) =>
    `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'partners', label: 'Partners' },
    { id: 'payouts', label: 'Payouts' },
    { id: 'kit', label: 'Sales kit' },
    { id: 'reports', label: 'Reports' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-gray-900 sm:text-3xl">
            <BadgePercent className="h-8 w-8 text-primary-600" />
            Partners
          </h1>
          <p className="mt-2 text-gray-600">
            Full partner program: links, deals, commissions, TDS payouts, sales kit, agency seats.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          {tab === 'partners' ? (
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" />
              Add partner
            </button>
          ) : null}
        </div>
      </div>

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {message ? <p className="mb-3 text-sm text-green-700">{message}</p> : null}
      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

      {tab === 'partners' ? (
        <>
          {showForm ? (
            <form
              onSubmit={createPartner}
              className="mb-8 grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2"
            >
              {(
                [
                  ['name', 'Name *'],
                  ['email', 'Email *'],
                  ['password', 'Password *'],
                  ['referral_code', 'Referral code *'],
                  ['pan', 'PAN (for TDS)'],
                  ['commission_value', 'Commission value'],
                  ['hold_days', 'Hold days (blank = default)'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-sm">
                  {label}
                  <input
                    className="mt-1 w-full rounded border px-3 py-2"
                    type={key === 'password' ? 'password' : key === 'email' ? 'email' : 'text'}
                    value={form[key]}
                    required={['name', 'email', 'password', 'referral_code'].includes(key)}
                    minLength={key === 'password' ? 8 : undefined}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        [key]:
                          key === 'referral_code'
                            ? e.target.value.toUpperCase()
                            : e.target.value,
                      })
                    }
                  />
                </label>
              ))}
              <label className="text-sm">
                Type
                <select
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={form.partner_type}
                  onChange={(e) => setForm({ ...form, partner_type: e.target.value })}
                >
                  <option value="freelancer">Freelancer</option>
                  <option value="agency">Agency</option>
                </select>
              </label>
              <label className="text-sm">
                Basis
                <select
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={form.commission_basis}
                  onChange={(e) => setForm({ ...form, commission_basis: e.target.value })}
                >
                  <option value="first_payment">First paid invoice only</option>
                  <option value="recurring">Every renewal</option>
                </select>
              </label>
              <label className="text-sm">
                Commission type
                <select
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={form.commission_type}
                  onChange={(e) => setForm({ ...form, commission_type: e.target.value })}
                >
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed ₹</option>
                </select>
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white"
                >
                  Create partner
                </button>
              </div>
            </form>
          ) : null}

          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Partner</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Commission</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/partners/${p.id}`}
                        className="font-medium text-primary-700 hover:underline"
                      >
                        {p.name}
                      </Link>
                      <div className="text-xs text-gray-500">
                        {p.email} · {p.partner_type}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono">{p.referral_code}</td>
                    <td className="px-4 py-3">
                      {p.commission_type === 'fixed'
                        ? `₹${p.commission_value}`
                        : `${p.commission_value}%`}{' '}
                      · {p.commission_basis === 'recurring' ? 'recurring' : 'first pay'}
                    </td>
                    <td className="px-4 py-3 capitalize">{p.status}</td>
                    <td className="px-4 py-3 space-x-2">
                      <button
                        type="button"
                        className="text-xs text-primary-700"
                        onClick={() => {
                          setTab('payouts');
                          void loadApproved(p.id);
                        }}
                      >
                        Pay
                      </button>
                      {p.status === 'active' ? (
                        <button
                          type="button"
                          className="text-xs text-amber-700"
                          onClick={() => setStatus(p.id, 'suspended')}
                        >
                          Suspend
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-xs text-green-700"
                          onClick={() => setStatus(p.id, 'active')}
                        >
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {tab === 'payouts' ? (
        <div className="space-y-6">
          <form onSubmit={runPayout} className="rounded-xl border bg-white p-4 space-y-3">
            <h2 className="font-semibold">Create payout (with TDS)</h2>
            <select
              className="w-full max-w-md rounded border px-3 py-2 text-sm"
              value={payoutPartnerId}
              onChange={(e) => void loadApproved(e.target.value)}
              required
            >
              <option value="">Select partner…</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.referral_code})
                </option>
              ))}
            </select>
            {approved.length > 0 ? (
              <div className="max-h-56 overflow-y-auto rounded border">
                {approved.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCommissions.includes(c.id)}
                      onChange={(e) => {
                        setSelectedCommissions((prev) =>
                          e.target.checked
                            ? [...prev, c.id]
                            : prev.filter((id) => id !== c.id),
                        );
                      }}
                    />
                    <span className="flex-1">
                      {c.business_name || c.business_id} — ₹{c.commission_amount}
                    </span>
                  </label>
                ))}
              </div>
            ) : payoutPartnerId ? (
              <p className="text-sm text-gray-500">No approved commissions ready.</p>
            ) : null}
            <input
              className="w-full max-w-md rounded border px-3 py-2 text-sm"
              placeholder="Payment reference (UTR / UPI)"
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
            />
            <button
              type="submit"
              disabled={!selectedCommissions.length}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              Pay selected (deduct TDS)
            </button>
          </form>

          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Partner</th>
                  <th className="px-4 py-3">Gross</th>
                  <th className="px-4 py-3">TDS</th>
                  <th className="px-4 py-3">Net</th>
                  <th className="px-4 py-3">Ref</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      {p.partner_name}
                      <div className="text-xs text-gray-500">{p.referral_code}</div>
                    </td>
                    <td className="px-4 py-3">{fmt(p.gross_amount)}</td>
                    <td className="px-4 py-3">{fmt(p.tds_amount)}</td>
                    <td className="px-4 py-3 font-semibold">{fmt(p.net_amount)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p.payment_reference || '—'}</td>
                    <td className="px-4 py-3">
                      {p.paid_at ? new Date(p.paid_at).toLocaleDateString('en-IN') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'kit' ? (
        <div className="space-y-6">
          <form onSubmit={createKit} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
            <input
              className="rounded border px-3 py-2 text-sm"
              placeholder="Title *"
              value={kitForm.title}
              onChange={(e) => setKitForm({ ...kitForm, title: e.target.value })}
              required
            />
            <select
              className="rounded border px-3 py-2 text-sm"
              value={kitForm.kind}
              onChange={(e) => setKitForm({ ...kitForm, kind: e.target.value })}
            >
              <option value="link">Link</option>
              <option value="text">Text / script</option>
            </select>
            <input
              className="rounded border px-3 py-2 text-sm sm:col-span-2"
              placeholder="Description"
              value={kitForm.description}
              onChange={(e) => setKitForm({ ...kitForm, description: e.target.value })}
            />
            {kitForm.kind === 'link' ? (
              <input
                className="rounded border px-3 py-2 text-sm sm:col-span-2"
                placeholder="URL *"
                value={kitForm.url}
                onChange={(e) => setKitForm({ ...kitForm, url: e.target.value })}
                required
              />
            ) : (
              <textarea
                className="rounded border px-3 py-2 text-sm sm:col-span-2"
                placeholder="Script / copy *"
                rows={4}
                value={kitForm.body_text}
                onChange={(e) => setKitForm({ ...kitForm, body_text: e.target.value })}
                required
              />
            )}
            <button type="submit" className="rounded-lg bg-primary-600 px-3 py-2 text-sm text-white">
              Add item
            </button>
            <label className="inline-flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-sm">
              Upload file
              <input type="file" className="hidden" onChange={uploadKitFile} />
            </label>
          </form>

          <div className="grid gap-3 sm:grid-cols-2">
            {kit.map((item) => (
              <div key={item.id} className="rounded-xl border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">
                  {item.kind} · {item.is_active ? 'active' : 'hidden'}
                </div>
                <div className="font-semibold">{item.title}</div>
                <div className="mt-2 flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-primary-700"
                    onClick={() => toggleKit(item.id, !item.is_active)}
                  >
                    {item.is_active ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    className="text-red-600"
                    onClick={() => deleteKit(item.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'reports' && report ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-5">
            {(
              [
                ['Attributions', report.totals.attributions],
                ['Pending', fmt(report.totals.pending)],
                ['Approved', fmt(report.totals.approved)],
                ['Paid', fmt(report.totals.paid)],
                ['Cancelled', fmt(report.totals.cancelled)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">{label}</div>
                <div className="mt-1 text-xl font-bold">{value}</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Partner</th>
                  <th className="px-4 py-3">Attrs</th>
                  <th className="px-4 py-3">Pending</th>
                  <th className="px-4 py-3">Approved</th>
                  <th className="px-4 py-3">Paid</th>
                </tr>
              </thead>
              <tbody>
                {report.partners.map((p: any) => (
                  <tr key={p.partner_id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      {p.name}
                      <div className="text-xs text-gray-500">{p.referral_code}</div>
                    </td>
                    <td className="px-4 py-3">{p.attributions}</td>
                    <td className="px-4 py-3">{fmt(p.pending_amount)}</td>
                    <td className="px-4 py-3">{fmt(p.approved_amount)}</td>
                    <td className="px-4 py-3">{fmt(p.paid_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'settings' && settings ? (
        <form onSubmit={saveSettings} className="rounded-xl border bg-white p-4">
          <h2 className="mb-3 font-semibold text-gray-900">Program defaults & TDS</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm">
              Hold days
              <input
                type="number"
                className="mt-1 w-full rounded border px-2 py-1.5"
                value={settings.default_hold_days}
                onChange={(e) =>
                  setSettings({ ...settings, default_hold_days: Number(e.target.value) })
                }
              />
            </label>
            <label className="text-sm">
              Default commission
              <input
                type="number"
                className="mt-1 w-full rounded border px-2 py-1.5"
                value={settings.default_commission_value}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    default_commission_value: Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="text-sm">
              TDS rate %
              <input
                type="number"
                step="0.01"
                className="mt-1 w-full rounded border px-2 py-1.5"
                value={settings.tds_rate_percent}
                onChange={(e) =>
                  setSettings({ ...settings, tds_rate_percent: Number(e.target.value) })
                }
              />
            </label>
            <label className="text-sm">
              TDS section
              <input
                className="mt-1 w-full rounded border px-2 py-1.5"
                value={settings.tds_section}
                onChange={(e) => setSettings({ ...settings, tds_section: e.target.value })}
              />
            </label>
            <label className="text-sm">
              Annual threshold ₹
              <input
                type="number"
                className="mt-1 w-full rounded border px-2 py-1.5"
                value={settings.tds_annual_threshold}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    tds_annual_threshold: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.tds_enabled}
              onChange={(e) => setSettings({ ...settings, tds_enabled: e.target.checked })}
            />
            TDS enabled on payouts (no PAN → higher rate applied)
          </label>
          <button type="submit" className="mt-3 rounded-lg border px-3 py-1.5 text-sm font-medium">
            Save settings
          </button>
        </form>
      ) : null}
    </div>
  );
}
