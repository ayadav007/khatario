'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users as UsersIcon, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { useToastContext } from '@/contexts/ToastContext';

type SeatUser = { id: string; name: string; phone: string | null; role_name: string | null; is_owner: boolean; chosen: boolean; paused: boolean; will_pause: boolean };
type BranchRow = { id: string; name: string; is_default: boolean; chosen: boolean; read_only: boolean; will_be_read_only: boolean };
type Payload = {
  seats: { allowed: number | null; used: number; over_limit: boolean; enforce_on: string | null; enforced: boolean; users: SeatUser[] };
  branches: { allowed: number | null; used: number; over_limit: boolean; enforce_on: string | null; enforced: boolean; branches: BranchRow[] };
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'a date to be set';

/** Owner screen: choose which users keep a seat and which branches stay writable when the plan has fewer than you use. */
export default function OverLimitAccessPage() {
  const toast = useToastContext();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keepUsers, setKeepUsers] = useState<Set<string>>(new Set());
  const [keepBranches, setKeepBranches] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/settings/over-limit-access', { credentials: 'include' });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || 'Could not load this page.');
        return;
      }
      const payload = body as Payload;
      setData(payload);
      setKeepUsers(new Set(payload.seats.users.filter((u) => !u.paused && !u.will_pause).map((u) => u.id)));
      setKeepBranches(new Set(payload.branches.branches.filter((b) => !b.read_only && !b.will_be_read_only).map((b) => b.id)));
    } catch {
      setError('Could not load this page. Please try again.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const seatCap = data?.seats.allowed ?? null;
  const branchCap = data?.branches.allowed ?? null;
  const usersOver = useMemo(() => seatCap !== null && keepUsers.size > seatCap, [keepUsers, seatCap]);
  const branchesOver = useMemo(() => branchCap !== null && keepBranches.size > branchCap, [keepBranches, branchCap]);

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/over-limit-access', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_user_ids: [...keepUsers], keep_branch_ids: [...keepBranches] }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || 'Could not save.');
        return;
      }
      toast.success('Saved. Everyone you chose keeps access; nobody was deleted.');
      await load();
    } catch {
      toast.error('Could not save. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPageShell
      title="Who keeps access"
      description="Your plan has fewer user seats or branches than you use. Choose who keeps access. Nothing is deleted: paused people keep their records, and an upgrade restores everyone at once."
      icon={UsersIcon}
    >
      {error ? (
        <Card padding="lg"><p className="type-body-secondary" role="alert">{error}</p></Card>
      ) : !data ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary-500" /></div>
      ) : (
        <div className="space-y-6">
          <Card padding="lg">
            <h2 className="text-base font-semibold">Users</h2>
            <p className="type-body-secondary mt-1">
              {seatCap === null
                ? 'Your plan has no seat limit.'
                : `Your plan has ${seatCap} seat${seatCap === 1 ? '' : 's'} and ${data.seats.used} people use one. You (the owner) always keep access.`}
            </p>
            <ul className="mt-3 space-y-2">
              {data.seats.users.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <label className="flex min-w-0 flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={u.is_owner || keepUsers.has(u.id)}
                      disabled={u.is_owner}
                      onChange={() => toggle(keepUsers, u.id, setKeepUsers)}
                      aria-label={`Keep access for ${u.name}`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{u.name}{u.is_owner ? ' (owner)' : ''}</span>
                      <span className="block truncate text-xs text-text-muted">{[u.role_name, u.phone].filter(Boolean).join(' · ')}</span>
                    </span>
                  </label>
                  {u.paused ? <span className="text-xs font-medium text-amber-600">Paused</span> : null}
                  {u.will_pause ? <span className="text-xs font-medium text-amber-600">Will be paused on {fmtDate(data.seats.enforce_on)}</span> : null}
                </li>
              ))}
            </ul>
            {usersOver ? <p className="mt-2 text-sm text-red-600" role="alert">Choose at most {seatCap} including you.</p> : null}
          </Card>

          <Card padding="lg">
            <h2 className="text-base font-semibold">Branches</h2>
            <p className="type-body-secondary mt-1">
              {branchCap === null
                ? 'Your plan has no branch limit.'
                : `Your plan allows ${branchCap} active branch${branchCap === 1 ? '' : 'es'} and you have ${data.branches.used}. Other branches become read-only: you can view their records but not add or change any. The default branch always stays writable.`}
            </p>
            <ul className="mt-3 space-y-2">
              {data.branches.branches.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <label className="flex min-w-0 flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={b.is_default || keepBranches.has(b.id)}
                      disabled={b.is_default}
                      onChange={() => toggle(keepBranches, b.id, setKeepBranches)}
                      aria-label={`Keep ${b.name} writable`}
                    />
                    <span className="truncate text-sm font-medium">{b.name}{b.is_default ? ' (default)' : ''}</span>
                  </label>
                  {b.read_only ? <span className="text-xs font-medium text-amber-600">Read-only</span> : null}
                  {b.will_be_read_only ? <span className="text-xs font-medium text-amber-600">Will be read-only on {fmtDate(data.branches.enforce_on)}</span> : null}
                </li>
              ))}
            </ul>
            {branchesOver ? <p className="mt-2 text-sm text-red-600" role="alert">Choose at most {branchCap} including the default branch.</p> : null}
          </Card>

          <div>
            <Button onClick={save} disabled={saving || usersOver || branchesOver}>
              {saving ? 'Saving…' : 'Save choice'}
            </Button>
          </div>
        </div>
      )}
    </SettingsPageShell>
  );
}
