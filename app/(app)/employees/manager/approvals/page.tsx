'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useCallback } from 'react';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
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
import { useToastContext } from '@/contexts/ToastContext';

export default function ManagerApprovalsPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [leaves, setLeaves] = useState<PendingLeave[]>([]);
  const [expenses, setExpenses] = useState<PendingExpense[]>([]);
  const [leaveChain, setLeaveChain] = useState<PendingLeaveChain[]>([]);
  const [otChain, setOtChain] = useState<PendingOtChain[]>([]);
  const [overtime, setOvertime] = useState<PendingOvertime[]>([]);
  const [regularizations, setRegularizations] = useState<PendingRegularization[]>([]);
  const [exits, setExits] = useState<PendingExit[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user.id,
      });
      const res = await fetch(`/api/employees/manager/pending-approvals?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLeaves(data.leaves || []);
        setExpenses(data.expenses || []);
        setExits(data.exits || []);
        setLeaveChain(data.leave_chain || []);
        setOtChain(data.ot_chain || []);
        setOvertime(data.overtime || []);
        setRegularizations(data.regularizations || []);
      } else if (res.status === 403) {
        setLeaves([]);
        setExpenses([]);
        setExits([]);
        setLeaveChain([]);
        setOtChain([]);
        setOvertime([]);
        setRegularizations([]);
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const handleLeaveAction = async (id: string, action: 'approve' | 'reject') => {
    if (!business?.id || !user?.id) return;
    setProcessingId(id);
    try {
      const params = new URLSearchParams({ business_id: business.id });
      const res = await fetch(`/api/employees/leave-requests/${id}?${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          updated_by_user_id: user.id,
          approved_by: user.id,
        }),
      });
      if (res.ok) {
        toast.success(action === 'approve' ? 'Leave approved' : 'Leave rejected');
        fetchPending();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Action failed');
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleExpenseAction = async (id: string, action: 'approve' | 'reject') => {
    if (!business?.id || !user?.id) return;
    setProcessingId(id);
    try {
      const params = new URLSearchParams({ business_id: business.id });
      const res = await fetch(`/api/employees/expenses/${id}?${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          updated_by_user_id: user.id,
          approved_by: user.id,
        }),
      });
      if (res.ok) {
        toast.success(action === 'approve' ? 'Expense approved' : 'Expense rejected');
        fetchPending();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Action failed');
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleLeaveChainAction = async (
    leaveRequestId: string,
    action: 'approve' | 'hold' | 'grant_exception',
    extra?: { hold_reason?: string },
  ) => {
    if (!business?.id || !user?.id) return;
    setProcessingId(leaveRequestId);
    try {
      const params = new URLSearchParams({ business_id: business.id, user_id: user.id });
      const res = await fetch(`/api/employees/manager/leave-approvals/${leaveRequestId}?${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) {
        toast.success(action === 'approve' ? 'Leave step approved' : 'Updated');
        fetchPending();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Action failed');
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleExitAction = async (
    exitId: string,
    action: 'approve' | 'hold' | 'grant_exception',
    extra?: { hold_reason?: string },
  ) => {
    if (!business?.id || !user?.id) return;
    setProcessingId(exitId);
    try {
      const params = new URLSearchParams({ business_id: business.id, user_id: user.id });
      const res = await fetch(`/api/employees/manager/exit-approvals/${exitId}?${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) {
        const labels = {
          approve: 'Resignation step approved',
          hold: 'Marked as pending',
          grant_exception: 'Exception granted',
        };
        toast.success(labels[action]);
        fetchPending();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Action failed');
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleOtChainAction = async (
    overtimeRequestId: string,
    action: 'approve' | 'hold',
    extra?: { hold_reason?: string },
  ) => {
    if (!business?.id || !user?.id) return;
    setProcessingId(overtimeRequestId);
    try {
      const params = new URLSearchParams({ business_id: business.id, user_id: user.id });
      const res = await fetch(`/api/employees/manager/ot-approvals/${overtimeRequestId}?${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) {
        toast.success(action === 'approve' ? 'Overtime step approved' : 'Updated');
        fetchPending();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Action failed');
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleRegularizationAction = async (id: string, action: 'approve' | 'reject') => {
    if (!business?.id || !user?.id) return;
    setProcessingId(id);
    try {
      const params = new URLSearchParams({ business_id: business.id });
      const res = await fetch(`/api/employees/manager/attendance-regularization/${id}?${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        toast.success(action === 'approve' ? 'Regularization approved' : 'Regularization rejected');
        fetchPending();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Action failed');
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleOvertimeAction = async (id: string, action: 'approve' | 'reject') => {
    if (!business?.id || !user?.id) return;
    setProcessingId(id);
    try {
      const params = new URLSearchParams({ business_id: business.id });
      const res = await fetch(`/api/employees/overtime-requests/${id}?${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          updated_by_user_id: user.id,
          rejection_reason: action === 'reject' ? 'Rejected by manager' : undefined,
        }),
      });
      if (res.ok) {
        toast.success(action === 'approve' ? 'Overtime approved' : 'Overtime rejected');
        fetchPending();
      } else {
        const err = await res.json();
        toast.error(err.error || 'Action failed');
      }
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div>
      <ListPageHeader
        title="Pending approvals"
        description="Resignations, leave, overtime, and expense requests awaiting your action"
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      ) : (
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
          exitDetailHref={(exitId) => `/hr/exits?exit=${exitId}`}
        />
      )}
    </div>
  );
}
