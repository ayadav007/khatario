'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, LogOut, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmployeeSearchSelect } from '@/components/hr/EmployeeSearchSelect';
import { ExitApprovalTimeline } from '@/components/hr/ExitApprovalTimeline';
import type { ExitApprovalRow } from '@/lib/hr/exit-approval';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

type ExitRow = {
  id: string;
  employee_name: string;
  employee_code: string;
  exit_type: string;
  status: string;
  fnf_status: string;
};

type ExitDetail = {
  exit: Record<string, unknown>;
  tasks: Array<{ id: string; title: string; category: string; status: string }>;
  approvals: ExitApprovalRow[];
  permissions?: { can_hr_reject: boolean; can_act_on_step: boolean };
};

export default function HrExitsPage() {
  const toast = useToastContext();
  const { business } = useAuth();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [exits, setExits] = useState<ExitRow[]>([]);
  const [selected, setSelected] = useState<ExitDetail | null>(null);
  const [exitReasons, setExitReasons] = useState<string[]>([]);
  const [holdReason, setHoldReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [form, setForm] = useState({
    employee_id: '',
    exit_type: 'resignation' as 'resignation' | 'termination',
    reason: '',
  });

  useEffect(() => {
    if (!business?.id) return;
    void fetch(`/api/settings/hr-exit?business_id=${business.id}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setExitReasons(data?.settings?.exit_reasons ?? []));
  }, [business?.id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/exits', { credentials: 'include' });
      if (res.ok) setExits((await res.json()).exits ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const openExit = useCallback(async (id: string) => {
    const res = await fetch(`/api/hr/exits/${id}`, { credentials: 'include' });
    if (res.ok) setSelected(await res.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const exitId = searchParams?.get('exit');
    if (exitId) void openExit(exitId);
  }, [searchParams, openExit]);

  async function initiate(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/hr/exits', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || 'Failed');
      return;
    }
    toast.success('Exit initiated');
    setForm({ employee_id: '', exit_type: 'resignation', reason: '' });
    void load();
    if (data.id) void openExit(data.id);
  }

  async function runApprovalAction(
    action: 'approve' | 'hold' | 'reject' | 'grant_exception',
    extra?: { hold_reason?: string },
  ) {
    if (!selected) return;
    setActionBusy(true);
    try {
      const res = await fetch(`/api/hr/exits/${selected.exit.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Action failed');
        return;
      }
      toast.success('Updated');
      setHoldReason('');
      void openExit(String(selected.exit.id));
      void load();
    } finally {
      setActionBusy(false);
    }
  }

  async function completeTask(taskId: string) {
    if (!selected) return;
    await fetch(`/api/hr/exits/${selected.exit.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_task', task_id: taskId, status: 'completed' }),
    });
    void openExit(String(selected.exit.id));
  }

  const exitStatus = String(selected?.exit.status ?? '');
  const isResignation = String(selected?.exit.exit_type ?? '') === 'resignation';
  const awaitingApproval = ['pending_approval', 'approval_on_hold'].includes(exitStatus);
  const activeStep = selected?.approvals.find((a) => ['awaiting', 'on_hold'].includes(a.status));
  const canActOnStep = selected?.permissions?.can_act_on_step ?? false;
  const canHrReject = selected?.permissions?.can_hr_reject ?? false;
  const showException =
    exitStatus === 'approval_on_hold' &&
    selected?.approvals.some((a) => a.status === 'on_hold');

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Employee exits</h1>
          <p className="text-sm text-text-secondary">
            Resignation approvals, termination, checklists, and F&amp;F settlement
          </p>
        </div>
        <Link href="/settings/hr-exit">
          <Button variant="secondary">Exit settings</Button>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">Initiate exit</h2>
          <p className="text-xs text-text-secondary">
            Terminations go straight to notice period (HR only). Resignations follow your approval
            chain from Exit settings.
          </p>
          <form onSubmit={initiate} className="space-y-3">
            <EmployeeSearchSelect
              value={form.employee_id}
              onChange={(employee_id) => setForm({ ...form, employee_id })}
              required
            />
            <select
              className="input w-full"
              value={form.exit_type}
              onChange={(e) =>
                setForm({
                  ...form,
                  exit_type: e.target.value as 'resignation' | 'termination',
                })
              }
            >
              <option value="resignation">Resignation</option>
              <option value="termination">Termination (HR only)</option>
            </select>
            <select
              className="input w-full"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            >
              <option value="">Reason (optional)</option>
              {exitReasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <Button type="submit">
              <LogOut className="mr-2 h-4 w-4" />
              Start exit
            </Button>
          </form>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 font-semibold">Active exits</h2>
          <ul className="divide-y divide-border">
            {exits.map((ex) => (
              <li key={ex.id}>
                <button
                  type="button"
                  onClick={() => void openExit(ex.id)}
                  className="flex w-full items-center justify-between py-2 text-left text-sm hover:bg-gray-50"
                >
                  <span>
                    {ex.employee_name} ({ex.employee_code})
                  </span>
                  <span className="text-xs capitalize text-text-muted">{ex.status.replace(/_/g, ' ')}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {selected && (
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {String(selected.exit.employee_name)} — {String(selected.exit.exit_type)}
            </h2>
            <span className="text-sm capitalize text-text-secondary">
              {exitStatus.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-sm text-text-secondary">
            Notice: {String(selected.exit.notice_period_days ?? '—')} days · F&amp;F:{' '}
            {String(selected.exit.fnf_status)}
          </p>

          {isResignation && selected.approvals.length > 0 ? (
            <ExitApprovalTimeline approvals={selected.approvals} />
          ) : null}

          {isResignation && awaitingApproval && (canActOnStep || canHrReject) ? (
            <div className="space-y-3 rounded-lg border border-border bg-gray-50 p-3">
              {canActOnStep && activeStep ? (
                <>
                  <p className="text-sm font-medium text-text-primary">
                    Current step: {activeStep.level_label ?? `Level ${activeStep.approval_level}`}
                  </p>
                  {activeStep.status === 'on_hold' && activeStep.hold_reason ? (
                    <p className="text-sm text-amber-800">On hold: {activeStep.hold_reason}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={actionBusy}
                      onClick={() => void runApprovalAction('approve')}
                    >
                      Approve
                    </Button>
                    {activeStep.role_type !== 'hr' && activeStep.status === 'awaiting' ? (
                      <>
                        <Input
                          placeholder="Reason if marking pending"
                          value={holdReason}
                          onChange={(e) => setHoldReason(e.target.value)}
                          className="max-w-xs"
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={actionBusy || !holdReason.trim()}
                          onClick={() =>
                            void runApprovalAction('hold', { hold_reason: holdReason.trim() })
                          }
                        >
                          Mark pending
                        </Button>
                      </>
                    ) : null}
                    {showException ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={actionBusy}
                        onClick={() => void runApprovalAction('grant_exception')}
                      >
                        Grant exception (dept head)
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : null}
              {canHrReject ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={actionBusy}
                  onClick={() => void runApprovalAction('reject')}
                >
                  Reject resignation (HR only)
                </Button>
              ) : null}
            </div>
          ) : null}

          <ul className="space-y-2">
            {selected.tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span>
                  <span className="text-xs uppercase text-text-muted">{t.category}</span>
                  <br />
                  {t.title}
                </span>
                {t.status !== 'completed' ? (
                  <Button size="sm" variant="secondary" onClick={() => void completeTask(t.id)}>
                    <CheckCircle2 className="mr-1 h-4 w-4" />
                    Done
                  </Button>
                ) : (
                  <span className="text-xs text-green-700">Completed</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
