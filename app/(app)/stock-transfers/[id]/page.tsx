'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Package, CheckCircle, Clock, XCircle, AlertCircle, Truck, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';

interface TransferItem {
  id: string;
  item_id: string;
  item_name?: string;
  qty: number;
  quantity_requested: number;
  quantity_dispatched: number;
  received_qty: number | null;
  unit: string;
  notes: string | null;
}

interface Transfer {
  id: string;
  transfer_number: string;
  transfer_date: string;
  from_location_id: string;
  to_location_id: string;
  from_warehouse_name: string;
  to_warehouse_name: string;
  status: 'draft' | 'pending_approval' | 'pending' | 'in_transit' | 'completed' | 'cancelled';
  notes: string | null;
  created_at: string;
  created_by: string;
  created_by_name: string;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  items?: TransferItem[];
}

const statusConfig = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-800', icon: Package },
  pending_approval: { label: 'Pending Approval', color: 'bg-yellow-100 text-yellow-800', icon: Clock },
  pending: { label: 'Pending Dispatch', color: 'bg-slate-100 text-primary-800', icon: Clock },
  in_transit: { label: 'In Transit', color: 'bg-purple-100 text-purple-800', icon: Truck },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800', icon: XCircle },
};

export default function ViewTransferPage() {
  const router = useRouter();
  const params = useParams();
  const transferId = params.id as string;
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { canModify } = usePermissions();
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (business?.id && user?.id && transferId) {
      fetchTransfer();
    }
  }, [business, user, transferId]);

  async function fetchTransfer() {
    if (!business?.id || !user?.id || !transferId) return;

    try {
      const response = await fetch(`/api/stock-transfers?business_id=${business.id}&user_id=${user.id}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch transfer');
      }
      
      const data = await response.json();
      const foundTransfer = (data.transfers || []).find((t: Transfer) => t.id === transferId);
      
      if (!foundTransfer) {
        toast.error('Transfer not found');
        router.push('/stock-transfers');
        return;
      }

      // Fetch transfer items
      const itemsResponse = await fetch(`/api/stock-transfers/${transferId}/items?business_id=${business.id}&user_id=${user.id}`);
      if (itemsResponse.ok) {
        const itemsData = await itemsResponse.json();
        foundTransfer.items = itemsData.items || [];
      }

      setTransfer(foundTransfer);
    } catch (error) {
      console.error('Error fetching transfer:', error);
      toast.error('Failed to load transfer details');
    } finally {
      setLoading(false);
    }
  }

  const handleApprove = async () => {
    if (!user?.id || !business?.id) return;

    setActionLoading('approve');
    try {
      const response = await fetch(`/api/stock-transfers/${transferId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approved_by: user.id,
          business_id: business.id,
        }),
      });

      if (!response.ok) {
        const errorData = await safeJsonParse(response);
        throw new Error(getApiErrorMessage(errorData, 'Failed to approve transfer'));
      }

      await fetchTransfer();
      toast.success('Transfer approved successfully');
    } catch (error: any) {
      console.error('Error approving transfer:', error);
      toast.error(error.message || 'Failed to approve transfer');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDispatch = async () => {
    if (!user?.id || !business?.id) return;

    if (!confirm('Are you sure you want to dispatch this transfer? Stock will be deducted from the source warehouse.')) {
      return;
    }

    setActionLoading('dispatch');
    try {
      const response = await fetch(`/api/stock-transfers/${transferId}/dispatch`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispatched_by: user.id,
          business_id: business.id,
        }),
      });

      if (!response.ok) {
        const errorData = await safeJsonParse(response);
        throw new Error(getApiErrorMessage(errorData, 'Failed to dispatch transfer'));
      }

      await fetchTransfer();
      toast.success('Transfer dispatched successfully');
    } catch (error: any) {
      console.error('Error dispatching transfer:', error);
      toast.error(error.message || 'Failed to dispatch transfer');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async () => {
    if (!user?.id || !business?.id) return;

    if (!confirm('Are you sure you want to cancel this transfer?')) {
      return;
    }

    setActionLoading('cancel');
    try {
      const response = await fetch(`/api/stock-transfers/${transferId}/cancel`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cancelled_by: user.id,
          business_id: business.id,
          cancellation_reason: 'Cancelled by user',
        }),
      });

      if (!response.ok) {
        const errorData = await safeJsonParse(response);
        throw new Error(getApiErrorMessage(errorData, 'Failed to cancel transfer'));
      }

      await fetchTransfer();
      toast.success('Transfer cancelled successfully');
    } catch (error: any) {
      console.error('Error cancelling transfer:', error);
      toast.error(error.message || 'Failed to cancel transfer');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!transfer) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Transfer Not Found</h2>
          <Link href="/stock-transfers" className="text-primary-600 hover:text-primary-700">
            Back to Transfers
          </Link>
        </div>
      </div>
    );
  }

  const statusInfo = statusConfig[transfer.status] || statusConfig.draft;
  const StatusIcon = statusInfo.icon;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            href="/stock-transfers"
            className="p-2 hover:bg-gray-100 rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Transfer {transfer.transfer_number}</h1>
            <p className="text-gray-600 text-sm mt-1">
              Created on {new Date(transfer.created_at).toLocaleDateString()} by {transfer.created_by_name}
            </p>
          </div>
        </div>
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${statusInfo.color}`}>
          <StatusIcon className="w-4 h-4 mr-1" />
          {statusInfo.label}
        </span>
      </div>

      {/* Transfer Details */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
        <h2 className="text-lg font-semibold text-gray-900">Transfer Details</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-500">Transfer Number</label>
            <p className="text-gray-900 font-medium">{transfer.transfer_number}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">Transfer Date</label>
            <p className="text-gray-900">{new Date(transfer.transfer_date).toLocaleDateString()}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">From Warehouse</label>
            <p className="text-gray-900">{transfer.from_warehouse_name || 'N/A'}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-500">To Warehouse</label>
            <p className="text-gray-900">{transfer.to_warehouse_name || 'N/A'}</p>
          </div>
          {transfer.approved_by && (
            <>
              <div>
                <label className="text-sm font-medium text-gray-500">Approved By</label>
                <p className="text-gray-900">{transfer.approved_by_name || 'N/A'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Approved At</label>
                <p className="text-gray-900">
                  {transfer.approved_at ? new Date(transfer.approved_at).toLocaleString() : 'N/A'}
                </p>
              </div>
            </>
          )}
          {transfer.notes && (
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-500">Notes</label>
              <p className="text-gray-900 whitespace-pre-wrap">{transfer.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Items */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Items</h2>
        
        {transfer.items && transfer.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Requested</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dispatched</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Received</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transfer.items.map((item, index) => (
                  <tr key={item.id || index}>
                    <td className="px-4 py-3 text-sm text-gray-900">{item.item_name || 'N/A'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.quantity_requested || item.qty}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.quantity_dispatched || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.received_qty ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.unit || 'PCS'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-600">No items in this transfer</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end space-x-3">
        {(transfer.status === 'draft' || transfer.status === 'pending_approval') && canModify('warehouse_transfer') && (
          <>
            <Button
              onClick={handleApprove}
              disabled={actionLoading === 'approve'}
              variant="outline"
            >
              {actionLoading === 'approve' ? 'Approving...' : 'Approve'}
            </Button>
            <Button
              onClick={handleCancel}
              disabled={actionLoading === 'cancel'}
              variant="outline"
              className="text-red-600 hover:text-red-700"
            >
              {actionLoading === 'cancel' ? 'Cancelling...' : 'Cancel'}
            </Button>
          </>
        )}
        {transfer.status === 'pending' && canModify('warehouse_transfer') && (
          <>
            <Button
              onClick={handleDispatch}
              disabled={actionLoading === 'dispatch'}
            >
              {actionLoading === 'dispatch' ? 'Dispatching...' : 'Dispatch'}
            </Button>
            <Button
              onClick={handleCancel}
              disabled={actionLoading === 'cancel'}
              variant="outline"
              className="text-red-600 hover:text-red-700"
            >
              {actionLoading === 'cancel' ? 'Cancelling...' : 'Cancel'}
            </Button>
          </>
        )}
        {transfer.status === 'in_transit' && canModify('warehouse_transfer') && (
          <Button
            onClick={() => router.push(`/stock-transfers/${transferId}/receive`)}
          >
            Receive
          </Button>
        )}
      </div>
    </div>
  );
}
