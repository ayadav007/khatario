'use client';

import React from 'react';
import Link from 'next/link';
import { Kanban } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import type { PipelineSummary } from '@/lib/whatsapp/pipeline';
import { formatDealValue, STAGE_DOT } from '@/components/whatsapp/pipeline/stageStyle';

export function PipelinePerformance({ data }: { data: PipelineSummary | null }) {
  const header = (
    <div className="mb-4 flex items-center justify-between">
      <h3 className="text-lg font-semibold text-gray-900">Pipeline</h3>
      <Link href="/whatsapp/pipeline" className="text-sm font-medium text-primary-600 hover:underline">
        Open board →
      </Link>
    </div>
  );

  const onBoard = data ? data.stages.reduce((n, s) => n + s.count, 0) : 0;
  if (!data || onBoard === 0) {
    return (
      <Card padding="md">
        {header}
        <div className="py-8 text-center text-gray-500">
          <Kanban className="mx-auto mb-2 h-12 w-12 text-gray-300" />
          <p>No chats on the pipeline yet. Set a stage from a chat&apos;s contact panel.</p>
        </div>
      </Card>
    );
  }

  const open = data.stages.filter((s) => s.kind === 'open');
  const openValue = open.reduce((n, s) => n + s.total_value, 0);
  const maxCount = Math.max(1, ...data.stages.map((s) => s.count));

  return (
    <Card padding="md">
      {header}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open deals" value={String(open.reduce((n, s) => n + s.count, 0))} sub={formatDealValue(openValue)} />
        <Stat label={`Won (${data.days} days)`} value={String(data.won.count)} sub={formatDealValue(data.won.value)} />
        <Stat label={`Lost (${data.days} days)`} value={String(data.lost)} />
        <Stat label="Win rate" value={data.win_rate === null ? '—' : `${Math.round(data.win_rate * 100)}%`} sub="of deals closed" />
      </div>

      <ul className="mt-5 space-y-2">
        {data.stages.map((s) => (
          <li key={s.id} className="flex items-center gap-3 text-sm">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STAGE_DOT[s.color]}`} />
            <span className="w-28 shrink-0 truncate text-gray-700">{s.name}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
              <span className={`block h-full ${STAGE_DOT[s.color]}`} style={{ width: `${(s.count / maxCount) * 100}%` }} />
            </span>
            <span className="w-10 text-right tabular-nums text-gray-900">{s.count}</span>
            <span className="w-24 text-right tabular-nums text-gray-500">{formatDealValue(s.total_value)}</span>
          </li>
        ))}
      </ul>

      {data.by_agent.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-2 py-2 text-left font-medium text-gray-700">Agent</th>
                <th className="px-2 py-2 text-right font-medium text-gray-700">Open</th>
                <th className="px-2 py-2 text-right font-medium text-gray-700">In play</th>
                <th className="px-2 py-2 text-right font-medium text-gray-700">Won</th>
                <th className="px-2 py-2 text-right font-medium text-gray-700">Won value</th>
              </tr>
            </thead>
            <tbody>
              {data.by_agent.map((a) => (
                <tr key={a.agent_id} className="border-b border-gray-100">
                  <td className="px-2 py-2 text-gray-900">{a.agent_name}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{a.open}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatDealValue(a.open_value)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{a.won}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatDealValue(a.won_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.lost_reasons.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Top lost reasons</p>
          <div className="flex flex-wrap gap-2">
            {data.lost_reasons.map((r) => (
              <span key={r.reason} className="rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-700">
                {r.reason} · {r.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}
