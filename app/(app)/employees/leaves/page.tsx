'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Calendar, Plus, CheckCircle, XCircle, Clock, AlertCircle, Loader2, Filter } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { LeaveRequest } from '@/types/database';
import { format } from 'date-fns';
import Link from 'next/link';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useToastContext } from '@/contexts/ToastContext';
import { DeleteAction } from '@/components/common/DeleteAction';

interface LeaveRequestWithDetails extends LeaveRequest {
  leave_name: string;
  leave_code: string;
  employee_code: string;
  employee_name: string;
  approver_code?: string;
  approver_name?: string;
}

export default function LeavesPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  
  // Authorization guard: Check if user can read leave requests
  // Uses tri-state model: 'loading' | 'allowed' | 'denied'
  const { status: authStatus } = useAuthorizationGuard({
    resource: 'leave_requests',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });
  
  const [requests, setRequests] = useState<LeaveRequestWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'>('all');
  const [startDate, setStartDate] = useState(format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (business?.id) {
      fetchRequests();
    }
  }, [business?.id, statusFilter, startDate, endDate]);

  const fetchRequests = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        ...(statusFilter !== 'all' && { status: statusFilter }),
        start_date: startDate,
        end_date: endDate,
      });

      const res = await fetch(`/api/employees/leave-requests?${params}`);
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests || []);
      }
    } catch (error) {
      console.error('Error fetching leave requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (requestId: string, action: 'approve' | 'reject' | 'cancel', rejectionReason?: string) => {
    if (!business?.id) return;

    setProcessingId(requestId);
    try {
      const res = await fetch(`/api/employees/leave-requests/${requestId}?business_id=${business.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          approved_by: business.id, // TODO: Use actual logged-in user ID
          rejection_reason: rejectionReason,
        }),
      });

      if (res.ok) {
        await fetchRequests();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to update leave request');
      }
    } catch (error) {
      console.error('Error updating leave request:', error);
      toast.error('Failed to update leave request. Please try again.');
    } finally {
      setProcessingId(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4" />;
      case 'approved':
        return <CheckCircle className="w-4 h-4" />;
      case 'rejected':
        return <XCircle className="w-4 h-4" />;
      case 'cancelled':
        return <AlertCircle className="w-4 h-4" />;
      default:
        return null;
    }
  };

  // Show loading while checking authorization (tri-state: 'loading')
  if (authStatus === 'loading') {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  // Show access denied only if check completed and denied (tri-state: 'denied')
  if (authStatus === 'denied') {
    return (
      <AccessDenied module="leave_requests" action="read" />
    );
  }

  // authStatus === 'allowed' - render page content

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Leave Management</h1>
            <p className="text-sm text-text-secondary mt-1">View and manage employee leave requests</p>
          </div>
          <div className="flex gap-2">
            <Link href="/employees/leaves/new">
              <Button variant="secondary">
                <Plus className="w-4 h-4 mr-2" />
                Request Leave
              </Button>
            </Link>
            <Link href="/employees/leaves/calendar">
              <Button>
                <Calendar className="w-4 h-4 mr-2" />
                Calendar View
              </Button>
            </Link>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Input
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="input"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button onClick={fetchRequests} className="w-full">
                <Filter className="w-4 h-4 mr-2" />
                Filter
              </Button>
            </div>
          </div>
        </Card>

        {/* Leave Requests List */}
        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : requests.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-text-secondary">No leave requests found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Employee</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Leave Type</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Date Range</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Days</th>
                    <th className="text-left py-3 px-4 font-semibold text-text-primary">Status</th>
                    <th className="text-center py-3 px-4 font-semibold text-text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr
                      key={req.id}
                      className="border-b border-border hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <div>
                          <div className="font-medium text-text-primary">{req.employee_name}</div>
                          <div className="text-sm text-text-secondary font-mono">
                            {req.employee_code}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div>
                          <span className="font-medium">{req.leave_name}</span>
                          <div className="text-xs text-text-secondary font-mono">
                            {req.leave_code}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div>
                          {format(new Date(req.start_date), 'dd MMM yyyy')} - {format(new Date(req.end_date), 'dd MMM yyyy')}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="font-medium">{req.total_days} days</span>
                      </td>
                      <td className="py-4 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${getStatusColor(req.status)}`}>
                          {getStatusIcon(req.status)}
                          {req.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center justify-center gap-2">
                          {req.status === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleAction(req.id, 'approve')}
                                disabled={processingId === req.id}
                              >
                                {processingId === req.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  'Approve'
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  const reason = prompt('Enter rejection reason:');
                                  if (reason) {
                                    handleAction(req.id, 'reject', reason);
                                  }
                                }}
                                disabled={processingId === req.id}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {(req.status === 'pending' || req.status === 'approved') && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleAction(req.id, 'cancel')}
                              disabled={processingId === req.id}
                            >
                              Cancel
                            </Button>
                          )}
                          <DeleteAction
                            entityName="leave request"
                            variant="delete"
                            disabled={req.status !== 'pending'}
                            disabledTooltip="Only pending items can be deleted"
                            deleteFn={async () => {
                              if (!business?.id || !user?.id) throw new Error('Missing business/user context');
                              const res = await fetch(
                                `/api/employees/leave-requests/${req.id}?business_id=${business.id}&user_id=${user.id}`,
                                { method: 'DELETE' }
                              );
                              const data = await res.json().catch(() => ({}));
                              if (!res.ok) throw new Error(data?.error || 'Failed to delete leave request');
                            }}
                            onSuccess={fetchRequests}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    
  );
}

