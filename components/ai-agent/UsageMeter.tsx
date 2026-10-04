'use client';

import React from 'react';
import { clsx } from 'clsx';
import type { AgentUsage } from '@/lib/ai-agent/types';

function Bar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700">
      <div
        className={clsx('h-full rounded-full transition-all', pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-primary-600')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString('en-IN');

/** One-line usage summary for the current power source, with a thin progress bar. */
export function UsageMeter({
  usage,
  onUpgrade,
  compact,
}: {
  usage: AgentUsage;
  onUpgrade?: () => void;
  compact?: boolean;
}) {
  const k = usage.khatarioAi;
  let label: string;
  let used: number;
  let total: number;
  let showUpgrade = false;

  if (usage.keySource === 'khatario' && k.active && k.monthlyQuota === -1) {
    label = `Khatario AI · ${fmt(usage.repliesThisMonth)} replies this month`;
    used = usage.repliesThisMonth;
    total = 0;
  } else if (usage.keySource === 'khatario' && k.active) {
    label = `Khatario AI · ${fmt(usage.repliesThisMonth)} / ${fmt(k.monthlyQuota)} this month`;
    used = usage.repliesThisMonth;
    total = k.monthlyQuota;
    showUpgrade = used >= total * 0.9;
  } else if (usage.keySource === 'khatario') {
    label = `Free trial · ${fmt(k.trialRemaining)} of ${fmt(k.trialTotal)} test replies left`;
    used = k.trialTotal - k.trialRemaining;
    total = k.trialTotal;
    showUpgrade = true;
  } else {
    label = usage.dailyLimit > 0
      ? `Your API key · ${fmt(usage.repliesToday)} / ${fmt(usage.dailyLimit)} replies today`
      : `Your API key · ${fmt(usage.repliesToday)} replies today`;
    used = usage.repliesToday;
    total = usage.dailyLimit;
  }

  return (
    <div className={clsx('flex min-w-0 items-center gap-3', compact ? 'w-full' : 'w-full sm:w-auto')}>
      <div className="min-w-0 flex-1 sm:w-64 sm:flex-none">
        <p className="truncate text-xs text-text-secondary">{label}</p>
        {total > 0 && <div className="mt-1"><Bar used={used} total={total} /></div>}
      </div>
      {showUpgrade && onUpgrade && (
        <button
          type="button"
          onClick={onUpgrade}
          className="shrink-0 rounded-lg bg-primary-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary-700"
        >
          {k.active ? 'Upgrade' : `Get Khatario AI · ₹${k.price}/mo`}
        </button>
      )}
    </div>
  );
}
