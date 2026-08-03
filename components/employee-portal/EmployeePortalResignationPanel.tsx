'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, LogOut, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ExitApprovalTimeline } from '@/components/hr/ExitApprovalTimeline';
import type { ExitApprovalRow } from '@/lib/hr/exit-approval';
import { useToastContext } from '@/contexts/ToastContext';

type ResignationView = {
  can_submit: boolean;
  exit_reasons: string[];
  active_exit: {
    id: string;
    status: string;
    reason: string | null;
    notice_period_days: number | null;
    last_working_date: string | null;
    resignation_submitted_at: string | null;
  } | null;
};

function statusLabel(status: string) {
  return status.replace(/_/g, ' ');
}

export function EmployeePortalResignationPanel() {
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<ResignationView | null>(null);
  const [reason, setReason] = useState('');
  const [preferredLwd, setPreferredLwd] = useState('');
  const [notes, setNotes] = useState('');
  const [approvals, setApprovals] = useState<ExitApprovalRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/public/employee/portal/resignation', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setView(data);
        setApprovals(data.approvals ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) {
      toast.error('Please select a reason');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/public/employee/portal/resignation', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          preferred_last_working_date: preferredLwd || undefined,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not submit');
        return;
      }
      toast.success('Resignation submitted for HR approval');
      setReason('');
      setNotes('');
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function withdraw() {
    if (!window.confirm('Withdraw your resignation request?')) return;
    setSaving(true);
    try {
      const res = await fetch('/api/public/employee/portal/resignation', {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not withdraw');
        return;
      }
      toast.success('Resignation withdrawn');
      void load();
    } finally {
      setSaving(false);
    }
  }

  if (loading || !view) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (view.active_exit) {
    const ex = view.active_exit;
    return (
      <Card className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <LogOut className="mt-0.5 h-5 w-5 text-text-secondary" />
          <div>
            <h2 className="font-semibold text-text-primary">Your resignation</h2>
            <p className="mt-1 text-sm capitalize text-text-secondary">Status: {statusLabel(ex.status)}</p>
          </div>
        </div>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-text-muted">Reason</dt>
            <dd className="font-medium">{ex.reason ?? '—'}</dd>
          </div>
          {ex.notice_period_days != null ? (
            <div>
              <dt className="text-text-muted">Notice period</dt>
              <dd className="font-medium">{ex.notice_period_days} days</dd>
            </div>
          ) : null}
          {ex.last_working_date ? (
            <div>
              <dt className="text-text-muted">Last working day</dt>
              <dd className="font-medium">{ex.last_working_date}</dd>
            </div>
          ) : null}
          {ex.resignation_submitted_at ? (
            <div>
              <dt className="text-text-muted">Submitted</dt>
              <dd className="font-medium">{ex.resignation_submitted_at.slice(0, 10)}</dd>
            </div>
          ) : null}
        </dl>
        {approvals.length > 0 ? <ExitApprovalTimeline approvals={approvals} /> : null}
        {ex.status === 'pending_approval' && (
          <Button variant="secondary" onClick={() => void withdraw()} disabled={saving}>
            Withdraw resignation
          </Button>
        )}
        {ex.status === 'approval_on_hold' && (
          <p className="text-sm text-amber-800">
            A department approver marked your request as pending. HR or the department head will
            resolve it before the next step.
          </p>
        )}
        {ex.status === 'in_notice' && (
          <p className="text-sm text-text-secondary">
            HR has approved your resignation. Complete exit tasks assigned by your manager.
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <p>
          Submitting resignation sends your request to HR for approval. You can withdraw while it is
          still pending.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Reason for leaving *</label>
          <select className="input w-full" value={reason} onChange={(e) => setReason(e.target.value)} required>
            <option value="">Select reason</option>
            {view.exit_reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Preferred last working day (optional)</label>
          <Input type="date" value={preferredLwd} onChange={(e) => setPreferredLwd(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Additional notes (optional)</label>
          <textarea
            className="input min-h-[80px] w-full"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything HR should know"
          />
        </div>
        <Button type="submit" disabled={saving || !view.can_submit}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
          Submit resignation
        </Button>
      </form>
    </Card>
  );
}
