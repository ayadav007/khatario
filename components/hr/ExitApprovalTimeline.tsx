'use client';

import type { ExitApprovalRow } from '@/lib/hr/exit-approval';
import { CheckCircle2, Circle, PauseCircle, XCircle } from 'lucide-react';

function approverLabel(row: ExitApprovalRow) {
  if (row.role_type === 'hr') return 'HR team';
  return row.approver_name ?? '—';
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ');
}

export function ExitApprovalTimeline({ approvals }: { approvals: ExitApprovalRow[] }) {
  if (approvals.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-text-primary">Approval chain</p>
      <ul className="space-y-2">
        {approvals.map((a) => {
          const label = a.level_label || `Level ${a.approval_level}`;
          const Icon =
            a.status === 'approved'
              ? CheckCircle2
              : a.status === 'rejected'
                ? XCircle
                : a.status === 'on_hold'
                  ? PauseCircle
                  : Circle;
          const iconClass =
            a.status === 'approved'
              ? 'text-green-600'
              : a.status === 'rejected'
                ? 'text-red-600'
                : a.status === 'on_hold'
                  ? 'text-amber-600'
                  : a.status === 'awaiting'
                    ? 'text-blue-600'
                    : 'text-text-muted';

          return (
            <li
              key={a.id}
              className="flex items-start gap-2 rounded-lg border border-border bg-gray-50 px-3 py-2 text-sm"
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} />
              <div>
                <p className="font-medium text-text-primary">
                  {label} — {approverLabel(a)}
                </p>
                <p className="capitalize text-text-secondary">{statusLabel(a.status)}</p>
                {a.hold_reason ? (
                  <p className="mt-1 text-amber-800">Pending: {a.hold_reason}</p>
                ) : null}
                {a.comments ? <p className="mt-1 text-text-muted">{a.comments}</p> : null}
                {a.exception_granted_at ? (
                  <p className="mt-1 text-xs text-text-muted">Exception granted by department head</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
