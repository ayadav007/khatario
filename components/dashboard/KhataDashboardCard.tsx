'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { Card } from '@/components/ui/Card';

type Summary = {
  open_khatas: number;
  khata_requests: number;
  owed: number;
  overdue: number;
  due_this_week: number;
  pending_approvals: number;
};

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/** Store khata at a glance. Hidden for businesses that have no khata, request or approval. */
export function KhataDashboardCard() {
  const [s, setS] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/khata/summary', { credentials: 'include' });
        if (!res.ok || cancelled) return;
        setS(await res.json());
      } catch {
        // not critical for the dashboard
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!s || (s.open_khatas === 0 && s.khata_requests === 0 && s.pending_approvals === 0)) return null;

  return (
    <Card padding="sm" className="border border-border md:!p-5">
      <div className="mb-2 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-text-primary md:text-base">Store khata</h3>
        <Link href="/customers?filter=khata" className="ml-auto text-xs text-primary hover:underline">
          {s.open_khatas} open
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <p className="text-caption text-text-secondary md:text-xs">Owed</p>
          <p className="font-semibold">{inr(s.owed)}</p>
        </div>
        <div>
          <p className="text-caption text-text-secondary md:text-xs">Due this week</p>
          <p className="font-semibold">{inr(s.due_this_week)}</p>
        </div>
        <div>
          <p className="text-caption text-text-secondary md:text-xs">Overdue</p>
          <p className={s.overdue > 0 ? 'font-semibold text-red-600' : 'font-semibold'}>{inr(s.overdue)}</p>
        </div>
      </div>
      {s.pending_approvals > 0 || s.khata_requests > 0 ? (
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {s.pending_approvals > 0 ? (
            <Link href="/settings/online-store/orders?khata=pending" className="font-medium text-amber-700 hover:underline">
              {s.pending_approvals} order{s.pending_approvals > 1 ? 's' : ''} to approve
            </Link>
          ) : null}
          {s.khata_requests > 0 ? (
            <Link href="/customers?filter=khata-requests" className="font-medium text-amber-700 hover:underline">
              {s.khata_requests} khata request{s.khata_requests > 1 ? 's' : ''}
            </Link>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
