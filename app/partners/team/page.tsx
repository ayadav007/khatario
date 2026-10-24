'use client';

import { useEffect, useState } from 'react';
import { PartnerShell } from '@/components/partners/PartnerShell';

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
};

export default function PartnerTeamPage() {
  const [name, setName] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function reload() {
    const [meRes, teamRes] = await Promise.all([
      fetch('/api/partners/me', { credentials: 'include' }),
      fetch('/api/partners/team', { credentials: 'include' }),
    ]);
    if (!meRes.ok) {
      window.location.href = '/partners/login';
      return;
    }
    setName((await meRes.json()).partner?.name || '');
    const data = await teamRes.json();
    setUsers(data.users || []);
    setCanManage(Boolean(data.canManage));
  }

  useEffect(() => {
    void reload();
  }, []);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');
    const res = await fetch('/api/partners/team', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed');
      return;
    }
    setForm({ name: '', email: '', password: '' });
    setMessage('Team member added');
    await reload();
  }

  async function toggle(userId: string, isActive: boolean) {
    await fetch('/api/partners/team', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, is_active: isActive }),
    });
    await reload();
  }

  return (
    <PartnerShell partnerName={name}>
      <h1 className="mb-2 text-2xl font-bold text-slate-900">Team</h1>
      <p className="mb-6 text-sm text-slate-600">
        Agency seats share one referral code and one commission ledger. Only the owner can add or
        deactivate members.
      </p>

      {message ? <p className="mb-2 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}

      {canManage ? (
        <form onSubmit={addMember} className="mb-8 grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-4">
          <input
            className="rounded border px-3 py-2 text-sm"
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            className="rounded border px-3 py-2 text-sm"
            placeholder="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <input
            className="rounded border px-3 py-2 text-sm"
            placeholder="Password (min 8)"
            type="password"
            minLength={8}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <button type="submit" className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white">
            Add member
          </button>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3 capitalize">{u.role}</td>
                <td className="px-4 py-3">{u.is_active ? 'Active' : 'Inactive'}</td>
                <td className="px-4 py-3 text-right">
                  {canManage && u.role !== 'owner' ? (
                    <button
                      type="button"
                      className="text-xs text-amber-700"
                      onClick={() => toggle(u.id, !u.is_active)}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PartnerShell>
  );
}
