'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Users } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import {
  ManagerApprovalQueue,
  type PendingLeave,
  type PendingExpense,
  type PendingExit,
  type PendingLeaveChain,
  type PendingOtChain,
  type PendingOvertime,
  type PendingRegularization,
} from '@/components/hr/ManagerApprovalQueue';

type TeamMember = {
  id: string;
  employee_code: string;
  name: string;
  designation: string | null;
  attendance_status: string | null;
};

type Props = {
  businessId: string;
  userId: string;
  slug: string;
  mode: 'team' | 'approvals';
};

/** Mobile-first manager team views for employee portal routes. */
export function EmployeePortalTeamSection({ businessId, userId, slug, mode }: Props) {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [leaves, setLeaves] = useState<PendingLeave[]>([]);
  const [expenses, setExpenses] = useState<PendingExpense[]>([]);
  const [exits, setExits] = useState<PendingExit[]>([]);
  const [leaveChain, setLeaveChain] = useState<PendingLeaveChain[]>([]);
  const [otChain, setOtChain] = useState<PendingOtChain[]>([]);
  const [overtime, setOvertime] = useState<PendingOvertime[]>([]);
  const [regularizations, setRegularizations] = useState<PendingRegularization[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const baseParams = new URLSearchParams();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === 'team') {
        const res = await fetch(`/api/employees/manager/team?${baseParams}`, {
          credentials: 'include',
        });
        if (res.status === 403) {
          setError('Team view is only available for managers.');
          return;
        }
        if (res.ok) {
          const data = await res.json();
          setTeam(data.team || []);
        }
      } else {
        const res = await fetch(`/api/employees/manager/pending-approvals?${baseParams}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setLeaves(data.leaves || []);
          setExpenses(data.expenses || []);
          setExits(data.exits || []);
          setLeaveChain(data.leave_chain || []);
          setOtChain(data.ot_chain || []);
          setOvertime(data.overtime || []);
          setRegularizations(data.regularizations || []);
        }
      }
    } catch {
      setError('Failed to load team data');
    } finally {
      setLoading(false);
    }
  }, [businessId, userId, mode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleLeaveAction = async (id: string, action: 'approve' | 'reject') => {
    setProcessingId(id);
    try {
      const params = new URLSearchParams({ business_id: businessId });
      const res = await fetch(`/api/employees/leave-requests/${id}?${params}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, updated_by_user_id: userId, approved_by: userId }),
      });
      if (res.ok) fetchData();
    } finally {
      setProcessingId(null);
    }
  };

  const handleExpenseAction = async (id: string, action: 'approve' | 'reject') => {
    setProcessingId(id);
    try {
      const params = new URLSearchParams({ business_id: businessId });
      const res = await fetch(`/api/employees/expenses/${id}?${params}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, updated_by_user_id: userId, approved_by: userId }),
      });
      if (res.ok) fetchData();
    } finally {
      setProcessingId(null);
    }
  };

  const handleExitAction = async (
    exitId: string,
    action: 'approve' | 'hold' | 'grant_exception',
    extra?: { hold_reason?: string },
  ) => {
    setProcessingId(exitId);
    try {
      const params = new URLSearchParams({ business_id: businessId });
      const res = await fetch(`/api/employees/manager/exit-approvals/${exitId}?${params}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) fetchData();
    } finally {
      setProcessingId(null);
    }
  };

  const handleLeaveChainAction = async (
    leaveRequestId: string,
    action: 'approve' | 'hold' | 'grant_exception',
    extra?: { hold_reason?: string },
  ) => {
    setProcessingId(leaveRequestId);
    try {
      const params = new URLSearchParams({ business_id: businessId });
      const res = await fetch(`/api/employees/manager/leave-approvals/${leaveRequestId}?${params}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) fetchData();
    } finally {
      setProcessingId(null);
    }
  };

  const handleOtChainAction = async (
    overtimeRequestId: string,
    action: 'approve' | 'hold',
    extra?: { hold_reason?: string },
  ) => {
    setProcessingId(overtimeRequestId);
    try {
      const params = new URLSearchParams({ business_id: businessId });
      const res = await fetch(`/api/employees/manager/ot-approvals/${overtimeRequestId}?${params}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) fetchData();
    } finally {
      setProcessingId(null);
    }
  };

  const handleRegularizationAction = async (id: string, action: 'approve' | 'reject') => {
    setProcessingId(id);
    try {
      const params = new URLSearchParams({ business_id: businessId });
      const res = await fetch(`/api/employees/manager/attendance-regularization/${id}?${params}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) fetchData();
    } finally {
      setProcessingId(null);
    }
  };

  const handleOvertimeAction = async (id: string, action: 'approve' | 'reject') => {
    setProcessingId(id);
    try {
      const params = new URLSearchParams({ business_id: businessId });
      const res = await fetch(`/api/employees/overtime-requests/${id}?${params}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          updated_by_user_id: userId,
          rejection_reason: action === 'reject' ? 'Rejected by manager' : undefined,
        }),
      });
      if (res.ok) fetchData();
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm text-text-secondary">{error}</p>
        <Link href={`/${slug}/employees`} className="link-primary mt-2 inline-block text-sm">
          Back to portal
        </Link>
      </div>
    );
  }

  if (mode === 'approvals') {
    return (
      <div className="px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-4">
        <h1 className="mb-4 text-lg font-semibold text-text-primary">Pending approvals</h1>
        <ManagerApprovalQueue
          leaves={leaves}
          expenses={expenses}
          exits={exits}
          leaveChain={leaveChain}
          otChain={otChain}
          overtime={overtime}
          regularizations={regularizations}
          processingId={processingId}
          onLeaveAction={handleLeaveAction}
          onLeaveChainAction={handleLeaveChainAction}
          onOtChainAction={handleOtChainAction}
          onOvertimeAction={handleOvertimeAction}
          onRegularizationAction={handleRegularizationAction}
          onExpenseAction={handleExpenseAction}
          onExitAction={handleExitAction}
        />
      </div>
    );
  }

  return (
    <div className="px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text-primary">My team</h1>
        <Link
          href={`/${slug}/employees/team/approvals`}
          className="text-sm link-primary"
        >
          Approvals
        </Link>
      </div>
      {team.length === 0 ? (
        <p className="text-sm text-text-secondary">No direct reports.</p>
      ) : (
        <div className="space-y-3">
          {team.map((m) => (
            <Card key={m.id} className="flex items-center gap-3 p-4">
              <Users className="h-5 w-5 shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-text-primary">{m.name}</p>
                <p className="text-xs text-text-secondary">{m.employee_code}</p>
              </div>
              <Chip
                variant={
                  m.attendance_status === 'present' ? 'success' : 'default'
                }
              >
                {m.attendance_status || 'absent'}
              </Chip>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
