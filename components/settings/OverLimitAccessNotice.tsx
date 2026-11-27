'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

/** Owner-only notice on the Users / Branches settings pages when seats or branches exceed the plan. */
export function OverLimitAccessNotice() {
  const { isPrimaryAdmin } = useAuth();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!isPrimaryAdmin) return;
    let cancelled = false;
    fetch('/api/settings/over-limit-access', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const date = (iso: string | null | undefined) =>
          iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'soon';
        const users = (d.seats?.users ?? []) as { paused: boolean; will_pause: boolean }[];
        const branches = (d.branches?.branches ?? []) as { read_only: boolean; will_be_read_only: boolean }[];
        const paused = users.filter((u) => u.paused).length;
        const willPause = users.filter((u) => u.will_pause).length;
        const readOnly = branches.filter((b) => b.read_only).length;
        const willRead = branches.filter((b) => b.will_be_read_only).length;
        const parts: string[] = [];
        if (paused) parts.push(`${paused} user${paused === 1 ? ' is' : 's are'} paused`);
        if (readOnly) parts.push(`${readOnly} branch${readOnly === 1 ? ' is' : 'es are'} read-only`);
        if (willPause) parts.push(`${willPause} user${willPause === 1 ? '' : 's'} will be paused on ${date(d.seats?.enforce_on)}`);
        if (willRead) parts.push(`${willRead} branch${willRead === 1 ? '' : 'es'} will become read-only on ${date(d.branches?.enforce_on)}`);
        if (parts.length === 0) return;
        setText(`${parts.join('; ')}, because your plan is smaller than what you use.`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isPrimaryAdmin]);

  if (!text) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
      {text} Nothing was deleted.{' '}
      <Link href="/settings/over-limit-access" className="font-medium underline">Choose who keeps access</Link>, or upgrade to restore everyone.
    </div>
  );
}
