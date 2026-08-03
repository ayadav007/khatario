'use client';

import type { OfferApprovalRow } from '@/lib/hr/recruitment/offer-approval';
import { CheckCircle2, Circle, XCircle } from 'lucide-react';

export function OfferApprovalTimeline({ approvals }: { approvals: OfferApprovalRow[] }) {
  if (approvals.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-text-primary">Internal approvals</p>
      <ul className="space-y-2">
        {approvals.map((a) => {
          const label = a.level_label || `Level ${a.approval_level}`;
          const Icon =
            a.status === 'approved'
              ? CheckCircle2
              : a.status === 'rejected'
                ? XCircle
                : Circle;
          const iconClass =
            a.status === 'approved'
              ? 'text-green-600'
              : a.status === 'rejected'
                ? 'text-red-600'
                : 'text-amber-600';

          return (
            <li
              key={a.id}
              className="flex items-start gap-2 rounded-lg border border-border bg-gray-50 px-3 py-2 text-sm"
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} />
              <div>
                <p className="font-medium text-text-primary">
                  {label} — {a.approver_name}
                </p>
                <p className="text-text-secondary capitalize">{a.status.replace(/_/g, ' ')}</p>
                {a.comments ? (
                  <p className="mt-1 text-text-muted">{a.comments}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
