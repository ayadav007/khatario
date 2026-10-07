'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PartnerShell } from '@/components/partners/PartnerShell';

type Me = {
  partner: { name: string; referral_code: string; partner_type: string };
  signupUrl: string;
};

export default function PartnerDashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [summary, setSummary] = useState({ pending: 0, approved: 0, paid: 0 });
  const [trialCount, setTrialCount] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meRes, comRes, attrRes] = await Promise.all([
          fetch('/api/partners/me', { credentials: 'include' }),
          fetch('/api/partners/commissions', { credentials: 'include' }),
          fetch('/api/partners/attributions', { credentials: 'include' }),
        ]);
        if (!meRes.ok) {
          window.location.href = '/partners/login';
          return;
        }
        const meData = await meRes.json();
        const comData = await comRes.json();
        const attrData = await attrRes.json();
        if (cancelled) return;
        setMe(meData);
        setSummary(comData.summary || { pending: 0, approved: 0, paid: 0 });
        const attrs = (attrData.attributions || []) as { has_commission: boolean }[];
        setTrialCount(attrs.filter((a) => !a.has_commission).length);
      } catch {
        if (!cancelled) setError('Failed to load dashboard');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fmt = (n: number) =>
    `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  return (
    <PartnerShell partnerName={me?.partner.name}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Trial signups are tracked; commission appears only after the customer pays.
        </p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending commission" value={fmt(summary.pending)} hint="Hold period" />
        <StatCard label="Approved" value={fmt(summary.approved)} hint="Ready for payout" />
        <StatCard label="Paid out" value={fmt(summary.paid)} />
        <StatCard label="Trials (not paid yet)" value={String(trialCount)} />
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Your signup link</h2>
        <p className="mt-1 text-sm text-slate-600">
          Share this Khatario link in Facebook ads. Customers always see khatario.com.
        </p>
        {me ? (
          <code className="mt-3 block break-all rounded-lg bg-slate-50 px-3 py-2 text-sm text-emerald-800">
            {me.signupUrl}
          </code>
        ) : (
          <div className="mt-3 h-10 animate-pulse rounded-lg bg-slate-100" />
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/partners/link"
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Copy & share
          </Link>
          <Link
            href="/partners/deals"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Manage deals
          </Link>
        </div>
      </div>
    </PartnerShell>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}
