'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Loader2, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { useToastContext } from '@/contexts/ToastContext';

type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export default function CreditApprovalsPage() {
  const router = useRouter();
  const { user, business } = useAuth();
  const toast = useToastContext();
  const [activeTab, setActiveTab] = useState<ApprovalStatus>('pending');
  const [approvals, setApprovals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (business?.id && user?.id) {
      fetchApprovals();
    }
  }, [business?.id, user?.id, activeTab]);

  async function fetchApprovals() {
    if (!business?.id || !user?.id) return;
    
    setLoading(true);
    try {
      // For now, fetch pending and filter client-side
      // In future, API can support status filter
      const res = await fetch(`/api/credit-approvals/pending?business_id=${business.id}&user_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        // Filter by active tab (for now, only pending is available via API)
        // TODO: Add approved/rejected endpoints or extend existing endpoint
        setApprovals(data.approvals || []);
      }
    } catch (error) {
      console.error('Error fetching approvals:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(approvalId: string) {
    if (!business?.id || !user?.id) return;
    if (!confirm('Approve this credit limit override?')) return;

    setProcessing(approvalId);
    try {
      const res = await fetch('/api/credit-approvals/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: approvalId,
          approved_by: user.id,
          business_id: business.id,
        }),
      });

      if (res.ok) {
        toast.success('Approval granted successfully!');
        await fetchApprovals();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to approve');
      }
    } catch (error) {
      console.error('Error approving:', error);
      toast.error('Failed to approve');
    } finally {
      setProcessing(null);
    }
  }

  async function handleReject(approval: any) {
    if (!business?.id || !user?.id) return;
    if (!rejectReason.trim()) {
      toast.error('Please provide a rejection reason');
      return;
    }

    setProcessing(approval.id);
    try {
      const res = await fetch('/api/credit-approvals/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_id: approval.id,
          rejected_by: user.id,
          business_id: business.id,
          rejection_reason: rejectReason,
        }),
      });

      if (res.ok) {
        toast.success('Approval rejected');
        setShowRejectModal(null);
        setRejectReason('');
        await fetchApprovals();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to reject');
      }
    } catch (error) {
      console.error('Error rejecting:', error);
      toast.error('Failed to reject');
    } finally {
      setProcessing(null);
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'rejected':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle className="w-4 h-4" />;
      case 'rejected':
        return <XCircle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  return (
    <>
    <div className="max-w-7xl mx-auto space-y-6">
        <Breadcrumbs />
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Credit Approvals</h1>
            <p className="text-sm text-gray-600 mt-1">Manage credit limit override requests</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('pending')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'pending'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Pending
            </button>
            <button
              onClick={() => setActiveTab('approved')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'approved'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Approved
            </button>
            <button
              onClick={() => setActiveTab('rejected')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'rejected'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Rejected
            </button>
          </nav>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : approvals.length === 0 ? (
          <Card padding="md">
            <div className="text-center py-12">
              <AlertTriangle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No {activeTab} approvals found</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {approvals.map((approval) => (
              <Card key={approval.id} padding="md">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold text-gray-900">
                        {approval.entity_name} - {approval.reference_type === 'invoice' ? 'Invoice' : 'Purchase'} {approval.reference_number}
                      </h3>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium border flex items-center gap-1 ${getStatusBadge(approval.status)}`}>
                        {getStatusIcon(approval.status)}
                        {approval.status.toUpperCase()}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                      <div>
                        <span className="text-gray-600">Party:</span>
                        <span className="ml-2 font-medium">{approval.entity_name}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Reference:</span>
                        <span className="ml-2 font-medium">
                          {approval.reference_type === 'invoice' ? 'Invoice' : 'Purchase'} {approval.reference_number}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Amount:</span>
                        <span className="ml-2 font-medium">
                          ₹{Number(approval.reference_amount || 0).toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Requested by:</span>
                        <span className="ml-2 font-medium">{approval.requested_by_name || 'N/A'}</span>
                      </div>
                    </div>

                    {approval.reason && (
                      <div className="mt-2 p-3 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-700">
                          <strong>Reason:</strong> {approval.reason}
                        </p>
                      </div>
                    )}

                    {approval.approved_by_name && (
                      <div className="mt-2 text-xs text-gray-500">
                        {approval.status === 'approved' ? 'Approved' : 'Rejected'} by {approval.approved_by_name} on{' '}
                        {approval.approved_at ? new Date(approval.approved_at).toLocaleString() : 'N/A'}
                      </div>
                    )}
                  </div>

                  {approval.status === 'pending' && (
                    <div className="flex gap-2 ml-4">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleApprove(approval.id)}
                        disabled={processing === approval.id}
                        isLoading={processing === approval.id}
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowRejectModal(approval)}
                        disabled={processing === approval.id}
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Reject Credit Approval</h3>
            <p className="text-sm text-gray-600 mb-4">
              Please provide a reason for rejecting this credit approval request.
            </p>
            <textarea
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={4}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter rejection reason..."
            />
            <div className="flex gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowRejectModal(null);
                  setRejectReason('');
                }}
                className="flex-1"
                disabled={processing === showRejectModal.id}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => handleReject(showRejectModal)}
                className="flex-1"
                disabled={processing === showRejectModal.id || !rejectReason.trim()}
                isLoading={processing === showRejectModal.id}
              >
                Reject
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
