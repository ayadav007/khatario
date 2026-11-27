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
        const paused = d.seats?.users?.filter((u: { paused: boolean }) => u.paused).length ?? 0;
        const readOnly = d.branches?.branches?.filter((b: { read_only: boolean }) => b.read_only).length ?? 0;
        if (paused === 0 && readOnly === 0) return;
        const parts: string[] = [];
        if (paused) parts.push(`${paused} user${paused === 1 ? ' is' : 's are'} paused`);
        if (readOnly) parts.push(`${readOnly} branch${readOnly === 1 ? ' is' : 'es are'} read-only`);
        setText(`${parts.join(' and ')} because your plan is smaller than what you use.`);
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
