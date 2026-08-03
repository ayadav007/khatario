'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loader2, Plus, Plane } from 'lucide-react';
import { clsx } from 'clsx';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';
import { DonutStatWithHex, donutColor } from '@/components/employee-portal/charts/DonutStat';
import { SimpleBarChart, HorizontalBarChart } from '@/components/employee-portal/charts/SimpleBarChart';
import type {
  PortalLeaveBalanceCard,
  PortalLeaveRequestRow,
} from '@/lib/employee-portal/portal-dashboard';

const TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'balances', label: 'Balances' },
  { id: 'stats', label: 'Stats' },
  { id: 'history', label: 'History' },
] as const;

type TabId = (typeof TABS)[number]['id'];

type LeavePayload = {
  balances: PortalLeaveBalanceCard[];
  pending: PortalLeaveRequestRow[];
  past: PortalLeaveRequestRow[];
  requests: PortalLeaveRequestRow[];
  insights: {
    weekly_pattern: Array<{ day: string; count: number }>;
    consumed_by_type: Array<{ name: string; days: number }>;
    monthly_stats: Array<{ month: string; days: number }>;
  };
};

function statusLabel(status: string) {
  if (status === 'partially_approved') return 'Partially approved';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusClass(status: string) {
  if (status === 'approved') return 'bg-green-50 text-green-800';
  if (status === 'rejected') return 'bg-red-50 text-red-800';
  if (status === 'pending' || status === 'partially_approved') return 'bg-amber-50 text-amber-800';
  return 'bg-gray-100 text-text-secondary';
}

export function EmployeePortalLeaveHub() {
  const { slug } = useEmployeePortal();
  const searchParams = useSearchParams();
  const tab = (searchParams.get('tab') as TabId) || 'summary';
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LeavePayload | null>(null);
  const [historyType, setHistoryType] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/public/employee/portal/leave-insights', { credentials: 'include' });
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  const filteredHistory = data.requests.filter((r) => {
    if (historyType && r.leave_name !== historyType) return false;
    if (historyStatus && r.status !== historyStatus) return false;
    return true;
  });

  const leaveTypes = [...new Set(data.requests.map((r) => r.leave_name))];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-900">Leave</h1>
        <Link href={`/${slug}/employees/leaves/new`}>
          <Button size="sm">
            <Plus className="mr-1 h-4 w-4" />
            Apply
          </Button>
        </Link>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border pb-0">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/${slug}/employees/leaves?tab=${t.id}`}
            className={clsx(
              'shrink-0 border-b-2 px-3 py-2 text-sm font-medium',
              tab === t.id
                ? 'border-primary-600 text-text-primary'
                : 'border-transparent text-text-secondary',
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'summary' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-text-primary">Pending requests</h2>
            {data.pending.length === 0 ? (
              <p className="text-sm text-text-muted">No pending leave requests.</p>
            ) : (
              <ul className="space-y-2">
                {data.pending.map((r) => (
                  <LeaveRequestCard key={r.id} request={r} />
                ))}
              </ul>
            )}
          </section>
          {data.past.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-text-primary">Past leave</h2>
              <ul className="space-y-2">
                {data.past.slice(0, 5).map((r) => (
                  <LeaveRequestCard key={r.id} request={r} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {tab === 'balances' && (
        <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.balances.map((b, i) => (
              <Card key={b.leave_type_id} className="overflow-hidden p-0">
                <div className="p-4">
                  <DonutStatWithHex
                    value={b.available}
                    max={b.annual_quota ?? Math.max(b.accrued_so_far, 1)}
                    label={b.leave_name}
                    sublabel={`${b.available} days available`}
                    stroke={donutColor(i)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-px bg-border text-center text-xs">
                  <div className="bg-gray-50 p-2">
                    <p className="text-text-muted">Consumed</p>
                    <p className="font-semibold text-text-primary">{b.consumed}</p>
                  </div>
                  <div className="bg-gray-50 p-2">
                    <p className="text-text-muted">Accrued</p>
                    <p className="font-semibold text-text-primary">{b.accrued_so_far}</p>
                  </div>
                  <div className="bg-gray-50 p-2">
                    <p className="text-text-muted">Available</p>
                    <p className="font-semibold text-text-primary">{b.available}</p>
                  </div>
                  <div className="bg-gray-50 p-2">
                    <p className="text-text-muted">Annual quota</p>
                    <p className="font-semibold text-text-primary">{b.annual_quota ?? '—'}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {tab === 'stats' && (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <SimpleBarChart title="Weekly pattern" items={data.insights.weekly_pattern} />
          <HorizontalBarChart
            title="Consumed leave types"
            items={data.insights.consumed_by_type.map((x) => ({ label: x.name, value: x.days }))}
          />
          <SimpleBarChart title="Monthly stats" items={data.insights.monthly_stats} />
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select
              className="input text-sm"
              value={historyType}
              onChange={(e) => setHistoryType(e.target.value)}
            >
              <option value="">All leave types</option>
              {leaveTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              className="input text-sm"
              value={historyStatus}
              onChange={(e) => setHistoryStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <p className="text-xs text-text-muted">Total: {filteredHistory.length}</p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-3 py-2">Leave dates</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="font-medium text-text-primary">
                        {format(new Date(r.start_date), 'dd MMM yyyy')}
                        {r.start_date !== r.end_date
                          ? ` – ${format(new Date(r.end_date), 'dd MMM yyyy')}`
                          : ''}
                      </div>
                      <div className="text-xs text-text-muted">{r.total_days} day(s)</div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{r.leave_name}</div>
                      <div className="text-xs text-text-muted">
                        Requested {format(new Date(r.created_at), 'dd MMM yyyy')}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${statusClass(r.status)}`}>
                        {statusLabel(r.status)}
                      </span>
                      {r.approver_name ? (
                        <div className="mt-1 text-xs text-text-muted">by {r.approver_name}</div>
                      ) : null}
                    </td>
                    <td className="max-w-[120px] truncate px-3 py-2 text-text-secondary">
                      {r.reason ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function LeaveRequestCard({ request: r }: { request: PortalLeaveRequestRow }) {
  return (
    <Card className="flex gap-3 p-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
        <Plane className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase text-text-muted">
          {r.is_past ? 'Past leave' : 'Upcoming'}
        </p>
        <p className="font-medium text-text-primary">
          {format(new Date(r.start_date), 'MMM dd, yyyy')}
          {r.total_days > 1 ? ` (${r.total_days} days)` : ' (1 day)'}
        </p>
        <p className="text-sm text-text-secondary">{r.leave_name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 ${statusClass(r.status)}`}>
            {statusLabel(r.status)}
          </span>
          {r.approver_name ? <span className="text-text-muted">Approver: {r.approver_name}</span> : null}
        </div>
        {r.reason ? <p className="mt-1 text-xs text-text-muted">Note: {r.reason}</p> : null}
      </div>
    </Card>
  );
}
