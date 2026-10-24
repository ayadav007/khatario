'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';

interface TeamUser {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  is_primary_admin: boolean;
  seat_type: 'billing' | 'connect';
  display_role: string;
}

interface SeatUsage {
  current: number;
  limit: number;
  allowed: boolean;
}

const EMPTY_FORM = { name: '', phone: '', email: '', password: '' };

async function readError(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string }).error || fallback;
}

export function ConnectTeamCard() {
  const toast = useToastContext();
  const [agents, setAgents] = useState<TeamUser[]>([]);
  const [seats, setSeats] = useState<SeatUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const [usersRes, seatsRes] = await Promise.all([
        fetch('/api/settings/users'),
        fetch('/api/subscriptions/check-limit?limit_type=connect_agents'),
      ]);
      if (!usersRes.ok) throw new Error(await readError(usersRes, 'Failed to load agents'));
      const { users } = (await usersRes.json()) as { users: TeamUser[] };
      setAgents(users.filter((u) => u.seat_type === 'connect'));
      if (seatsRes.ok) setSeats((await seatsRes.json()) as SeatUsage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchUser = async (user: TeamUser, body: Record<string, unknown>, success: string) => {
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/settings/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not update agent'));
      toast.success(success);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update agent');
    } finally {
      setBusyId(null);
    }
  };

  const createAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/settings/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || undefined,
          password: form.password,
          seat_type: 'connect',
        }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not add agent'));
      toast.success(`${form.name.trim()} can now log in and chat with customers`);
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add agent');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <Loader2 className="h-5 w-5 animate-spin text-text-muted" />;
  }

  const full = seats ? !seats.allowed : false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          {seats ? (
            <>
              <span className="font-semibold text-text-primary">
                {seats.current} of {seats.limit}
              </span>{' '}
              agent seats used
            </>
          ) : (
            `${agents.filter((a) => a.is_active).length} active agents`
          )}
        </p>
        {!showForm ? (
          <Button size="sm" onClick={() => setShowForm(true)} disabled={full}>
            <UserPlus className="mr-1.5 h-4 w-4" aria-hidden />
            Add agent
          </Button>
        ) : null}
      </div>

      {full ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          All agent seats are in use. Deactivate an agent or upgrade Connect to add more.
        </p>
      ) : null}

      {showForm ? (
        <form onSubmit={createAgent} className="space-y-3 rounded-lg border border-border p-3 dark:border-border-dark">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              label="Phone (used to log in)"
              required
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <Input
              label="Email (optional)"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Input
              label="Password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <p className="text-xs text-text-secondary">
            Agents can chat with customers and view customers, items, invoices and orders. They cannot create or change
            them, and cannot see purchases or accounts.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setForm(EMPTY_FORM);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={creating}>
              {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              Add agent
            </Button>
          </div>
        </form>
      ) : null}

      {agents.length === 0 ? (
        <p className="text-sm text-text-secondary">No agents yet. Add your first agent to share the inbox.</p>
      ) : (
        <ul className="divide-y divide-border dark:divide-border-dark">
          {agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text-primary">
                  {a.name}
                  {!a.is_active ? (
                    <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-text-secondary dark:bg-gray-800">
                      Inactive
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  {[a.phone, a.email, a.display_role].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId === a.id || (!a.is_active && full)}
                  onClick={() =>
                    patchUser(
                      a,
                      { is_active: !a.is_active },
                      a.is_active ? `${a.name} deactivated` : `${a.name} reactivated`,
                    )
                  }
                >
                  {a.is_active ? 'Deactivate' : 'Reactivate'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId === a.id}
                  onClick={() => patchUser(a, { seat_type: 'billing' }, `${a.name} moved to Billing users`)}
                >
                  Move to Billing
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
