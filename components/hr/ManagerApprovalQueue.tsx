'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CheckCircle, XCircle, Loader2, LogOut, PauseCircle } from 'lucide-react';
import {
  REGULARIZATION_REQUEST_TYPE_LABELS,
  type RegularizationRequestType,
} from '@/lib/hr/attendance-regularization-shared';

export type PendingLeave = {
  id: string;
  employee_code: string;
  employee_name: string;
  leave_name: string;
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string | null;
};

export type PendingExpense = {
  id: string;
  employee_code: string;
  employee_name: string;
  amount: number;
  description: string;
  expense_date: string;
};

export type PendingExit = {
  exit_id: string;
  employee_code: string;
  employee_name: string;
  approval_level: number;
  level_label: string | null;
  role_type: string;
  status: string;
  hold_reason: string | null;
  created_at: string;
};

export type PendingLeaveChain = {
  leave_request_id: string;
  employee_code: string;
  employee_name: string;
  leave_name: string;
  start_date: string;
  end_date: string;
  total_days: number;
  approval_level: number;
  level_label: string | null;
  role_type: string;
  status: string;
  hold_reason: string | null;
};

export type PendingOtChain = {
  overtime_request_id: string;
  employee_code: string;
  employee_name: string;
  request_date: string;
  total_hours: number;
  reason: string | null;
  approval_level: number;
  level_label: string | null;
  role_type: string;
  status: string;
  hold_reason: string | null;
};

export type PendingOvertime = {
  id: string;
  employee_code: string;
  employee_name: string;
  request_date: string;
  total_hours: number;
  reason: string | null;
};

export type PendingRegularization = {
  id: string;
  employee_code: string;
  employee_name: string;
  attendance_date: string;
  request_type: string;
  original_check_in: string | null;
  original_check_out: string | null;
  requested_check_in: string | null;
  requested_check_out: string | null;
  reason: string;
};

type Props = {
  leaves: PendingLeave[];
  expenses: PendingExpense[];
  exits?: PendingExit[];
  leaveChain?: PendingLeaveChain[];
  otChain?: PendingOtChain[];
  overtime?: PendingOvertime[];
  regularizations?: PendingRegularization[];
  processingId: string | null;
  onLeaveAction: (id: string, action: 'approve' | 'reject') => void;
  onLeaveChainAction: (
    leaveRequestId: string,
    action: 'approve' | 'hold' | 'grant_exception',
    extra?: { hold_reason?: string },
  ) => void;
  onOtChainAction: (
    overtimeRequestId: string,
    action: 'approve' | 'hold',
    extra?: { hold_reason?: string },
  ) => void;
  onOvertimeAction: (id: string, action: 'approve' | 'reject') => void;
  onRegularizationAction: (id: string, action: 'approve' | 'reject') => void;
  onExpenseAction: (id: string, action: 'approve' | 'reject') => void;
  onExitAction: (
    exitId: string,
    action: 'approve' | 'hold' | 'grant_exception',
    extra?: { hold_reason?: string },
  ) => void;
  /** Admin app link to full exit detail */
  exitDetailHref?: (exitId: string) => string;
};

function formatTs(iso: string | null | undefined): string {
  if (!iso) return '—';
  return format(new Date(iso), 'dd MMM yyyy, h:mm a');
}

function exitStepLabel(row: PendingExit) {
  return row.level_label || `Level ${row.approval_level}`;
}

export function ManagerApprovalQueue({
  leaves,
  expenses,
  exits = [],
  leaveChain = [],
  otChain = [],
  overtime = [],
  regularizations = [],
  processingId,
  onLeaveAction,
  onLeaveChainAction,
  onOtChainAction,
  onOvertimeAction,
  onRegularizationAction,
  onExpenseAction,
  onExitAction,
  exitDetailHref,
}: Props) {
  const [holdReasons, setHoldReasons] = useState<Record<string, string>>({});

  if (
    leaves.length === 0 &&
    expenses.length === 0 &&
    exits.length === 0 &&
    leaveChain.length === 0 &&
    otChain.length === 0 &&
    overtime.length === 0 &&
    regularizations.length === 0
  ) {
    return (
      <p className="py-6 text-center text-sm text-text-secondary">No pending approvals for your team.</p>
    );
  }

  return (
    <div className="space-y-6">
      {regularizations.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Attendance regularization</h3>
          <div className="space-y-3">
            {regularizations.map((r) => {
              const typeLabel =
                REGULARIZATION_REQUEST_TYPE_LABELS[r.request_type as RegularizationRequestType] ??
                r.request_type;
              return (
                <div key={r.id} className="rounded-lg border border-border bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-text-primary">
                        {r.employee_name}{' '}
                        <span className="text-sm font-normal text-text-secondary">
                          ({r.employee_code})
                        </span>
                      </p>
                      <p className="text-sm text-text-secondary">
                        {format(new Date(r.attendance_date), 'dd MMM yyyy')} · {typeLabel}
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        In: {formatTs(r.original_check_in)} → {formatTs(r.requested_check_in)}
                      </p>
                      <p className="text-xs text-text-muted">
                        Out: {formatTs(r.original_check_out)} → {formatTs(r.requested_check_out)}
                      </p>
                      <p className="mt-1 text-sm text-text-secondary">{r.reason}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={processingId === r.id}
                        onClick={() => onRegularizationAction(r.id, 'reject')}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        disabled={processingId === r.id}
                        onClick={() => onRegularizationAction(r.id, 'approve')}
                      >
                        Approve
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {exits.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Resignation approvals</h3>
          <div className="space-y-3">
            {exits.map((ex) => {
              const busy = processingId === ex.exit_id;
              const isException = ex.status === 'exception_needed';
              const isOnHold = ex.status === 'on_hold';
              const holdReason = holdReasons[ex.exit_id] ?? '';

              return (
                <div
                  key={`${ex.exit_id}-${ex.approval_level}-${ex.status}`}
                  className="rounded-lg border border-border bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-text-primary">
                        {ex.employee_name}{' '}
                        <span className="text-sm font-normal text-text-secondary">
                          ({ex.employee_code})
                        </span>
                      </p>
                      <p className="text-sm text-text-secondary">
                        {exitStepLabel(ex)} · Resignation
                      </p>
                      <p className="text-xs text-text-muted">
                        Submitted {format(new Date(ex.created_at), 'dd MMM yyyy')}
                      </p>
                      {ex.hold_reason ? (
                        <p className="mt-1 text-sm text-amber-800">Pending: {ex.hold_reason}</p>
                      ) : null}
                      {isException ? (
                        <p className="mt-1 text-sm text-amber-800">
                          Exception approval needed from department head
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      {exitDetailHref ? (
                        <Link
                          href={exitDetailHref(ex.exit_id)}
                          className="text-xs link-primary"
                        >
                          View exit
                        </Link>
                      ) : null}
                      {isException ? (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => onExitAction(ex.exit_id, 'grant_exception')}
                        >
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                          Grant exception
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => onExitAction(ex.exit_id, 'approve')}
                          >
                            {busy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle className="h-4 w-4" />
                            )}
                            Approve
                          </Button>
                          {!isOnHold && ex.role_type !== 'hr' ? (
                            <>
                              <Input
                                placeholder="Reason if pending"
                                value={holdReason}
                                onChange={(e) =>
                                  setHoldReasons((prev) => ({
                                    ...prev,
                                    [ex.exit_id]: e.target.value,
                                  }))
                                }
                                className="max-w-[180px]"
                              />
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy || !holdReason.trim()}
                                onClick={() =>
                                  onExitAction(ex.exit_id, 'hold', {
                                    hold_reason: holdReason.trim(),
                                  })
                                }
                              >
                                <PauseCircle className="h-4 w-4" />
                                Mark pending
                              </Button>
                            </>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {leaveChain.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Leave approval chain</h3>
          <div className="space-y-3">
            {leaveChain.map((lr) => {
              const busy = processingId === lr.leave_request_id;
              const holdReason = holdReasons[lr.leave_request_id] ?? '';
              return (
                <div
                  key={`${lr.leave_request_id}-${lr.approval_level}`}
                  className="rounded-lg border border-border bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-text-primary">
                        {lr.employee_name}{' '}
                        <span className="text-sm font-normal text-text-secondary">
                          ({lr.employee_code})
                        </span>
                      </p>
                      <p className="text-sm text-text-secondary">
                        {lr.leave_name} · {lr.total_days} day(s) · {lr.level_label || `Level ${lr.approval_level}`}
                      </p>
                      <p className="text-sm text-text-secondary">
                        {format(new Date(lr.start_date), 'dd MMM yyyy')} –{' '}
                        {format(new Date(lr.end_date), 'dd MMM yyyy')}
                      </p>
                      {lr.hold_reason ? (
                        <p className="mt-1 text-sm text-amber-800">On hold: {lr.hold_reason}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => onLeaveChainAction(lr.leave_request_id, 'approve')}
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                        Approve
                      </Button>
                      {lr.role_type !== 'hr' && lr.status !== 'on_hold' ? (
                        <>
                          <Input
                            placeholder="Reason if pending"
                            value={holdReason}
                            onChange={(e) =>
                              setHoldReasons((prev) => ({
                                ...prev,
                                [lr.leave_request_id]: e.target.value,
                              }))
                            }
                            className="max-w-[180px]"
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy || !holdReason.trim()}
                            onClick={() =>
                              onLeaveChainAction(lr.leave_request_id, 'hold', {
                                hold_reason: holdReason.trim(),
                              })
                            }
                          >
                            <PauseCircle className="h-4 w-4" />
                            Mark pending
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {otChain.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Overtime approval chain</h3>
          <div className="space-y-3">
            {otChain.map((ot) => {
              const busy = processingId === ot.overtime_request_id;
              const holdReason = holdReasons[ot.overtime_request_id] ?? '';
              return (
                <div
                  key={`${ot.overtime_request_id}-${ot.approval_level}`}
                  className="rounded-lg border border-border bg-white p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-text-primary">
                        {ot.employee_name}{' '}
                        <span className="text-sm font-normal text-text-secondary">
                          ({ot.employee_code})
                        </span>
                      </p>
                      <p className="text-sm text-text-secondary">
                        {ot.total_hours} hr(s) · {format(new Date(ot.request_date), 'dd MMM yyyy')} ·{' '}
                        {ot.level_label || `Level ${ot.approval_level}`}
                      </p>
                      {ot.reason ? (
                        <p className="mt-1 text-sm text-text-muted">{ot.reason}</p>
                      ) : null}
                      {ot.hold_reason ? (
                        <p className="mt-1 text-sm text-amber-800">On hold: {ot.hold_reason}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => onOtChainAction(ot.overtime_request_id, 'approve')}
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                        Approve
                      </Button>
                      {ot.role_type !== 'hr' && ot.status !== 'on_hold' ? (
                        <>
                          <Input
                            placeholder="Reason if pending"
                            value={holdReason}
                            onChange={(e) =>
                              setHoldReasons((prev) => ({
                                ...prev,
                                [ot.overtime_request_id]: e.target.value,
                              }))
                            }
                            className="max-w-[180px]"
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy || !holdReason.trim()}
                            onClick={() =>
                              onOtChainAction(ot.overtime_request_id, 'hold', {
                                hold_reason: holdReason.trim(),
                              })
                            }
                          >
                            <PauseCircle className="h-4 w-4" />
                            Mark pending
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {overtime.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Overtime requests</h3>
          <div className="space-y-3">
            {overtime.map((ot) => (
              <div key={ot.id} className="rounded-lg border border-border bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-text-primary">
                      {ot.employee_name}{' '}
                      <span className="text-sm font-normal text-text-secondary">
                        ({ot.employee_code})
                      </span>
                    </p>
                    <p className="text-sm text-text-secondary">
                      {ot.total_hours} hr(s) · {format(new Date(ot.request_date), 'dd MMM yyyy')}
                    </p>
                    {ot.reason ? (
                      <p className="mt-1 text-sm text-text-muted">{ot.reason}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={processingId === ot.id}
                      onClick={() => onOvertimeAction(ot.id, 'reject')}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={processingId === ot.id}
                      onClick={() => onOvertimeAction(ot.id, 'approve')}
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {leaves.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Leave requests</h3>
          <div className="space-y-3">
            {leaves.map((lr) => (
              <div
                key={lr.id}
                className="rounded-lg border border-border bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-text-primary">
                      {lr.employee_name}{' '}
                      <span className="text-sm font-normal text-text-secondary">
                        ({lr.employee_code})
                      </span>
                    </p>
                    <p className="text-sm text-text-secondary">
                      {lr.leave_name} · {lr.total_days} day(s)
                    </p>
                    <p className="text-sm text-text-secondary">
                      {format(new Date(lr.start_date), 'dd MMM yyyy')} –{' '}
                      {format(new Date(lr.end_date), 'dd MMM yyyy')}
                    </p>
                    {lr.reason ? (
                      <p className="mt-1 text-sm text-text-muted">{lr.reason}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={processingId === lr.id}
                      onClick={() => onLeaveAction(lr.id, 'reject')}
                    >
                      {processingId === lr.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={processingId === lr.id}
                      onClick={() => onLeaveAction(lr.id, 'approve')}
                    >
                      {processingId === lr.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4" />
                      )}
                      Approve
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {expenses.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Expense claims</h3>
          <div className="space-y-3">
            {expenses.map((exp) => (
              <div
                key={exp.id}
                className="rounded-lg border border-border bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-text-primary">
                      {exp.employee_name}{' '}
                      <span className="text-sm font-normal text-text-secondary">
                        ({exp.employee_code})
                      </span>
                    </p>
                    <p className="text-lg font-semibold text-gray-900">
                      ₹{exp.amount.toLocaleString('en-IN')}
                    </p>
                    <p className="text-sm text-text-secondary">{exp.description}</p>
                    <p className="text-xs text-text-muted">
                      {format(new Date(exp.expense_date), 'dd MMM yyyy')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={processingId === exp.id}
                      onClick={() => onExpenseAction(exp.id, 'reject')}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={processingId === exp.id}
                      onClick={() => onExpenseAction(exp.id, 'approve')}
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
