'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, Truck, Package, CheckCircle, Clock, XCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { UpgradePrompt } from '@/components/subscription/UpgradePrompt';
import { usePermissions } from '@/hooks/usePermissions';
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

export default function StockTransfersPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { hasFeature, loading: featuresLoading } = useFeatureRegistry();
  const { canView, canAdd, canModify } = usePermissions();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Check if multi_warehouse feature is enabled
  const hasWarehouseAccess = hasFeature('multi_warehouse') || hasFeature('settings_multi_warehouse');

  useEffect(() => {
    if (business?.id && hasWarehouseAccess && canView('warehouse_transfer')) {
      fetchTransfers();
    } else if (business?.id && !hasWarehouseAccess) {
      setLoading(false);
    }
  }, [business, hasWarehouseAccess, canView]);

  async function fetchTransfers() {
    if (!hasWarehouseAccess || !business?.id || !user?.id) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/stock-transfers?business_id=${business.id}&user_id=${user.id}`);
      
      if (!response.ok) {
        const errorData = await safeJsonParse(response);
        if (
          response.status === 403 &&
          (errorData?.code === 'FEATURE_NOT_IN_PLAN' || errorData?.code === 'FEATURE_NOT_AVAILABLE')
        ) {
          setShowUpgradePrompt(true);
          return;
        }
        throw new Error(getApiErrorMessage(errorData, 'Failed to fetch transfers'));
      }
      
      const data = await response.json();
      setTransfers(data.transfers || []);
    } catch (error) {
      console.error('Error fetching transfers:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleApprove = async (transferId: string) => {
    if (!user?.id || !business?.id) return;

    setActionLoading(transferId);
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

      await fetchTransfers();
      toast.success('Transfer approved successfully');
    } catch (error: any) {
      console.error('Error approving transfer:', error);
      toast.error(error.message || 'Failed to approve transfer');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDispatch = async (transferId: string) => {
    if (!user?.id || !business?.id) return;

    if (!confirm('Are you sure you want to dispatch this transfer? Stock will be deducted from the source warehouse.')) {
      return;
    }

    setActionLoading(transferId);
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

      await fetchTransfers();
      toast.success('Transfer dispatched successfully');
    } catch (error: any) {
      console.error('Error dispatching transfer:', error);
      toast.error(error.message || 'Failed to dispatch transfer');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (transferId: string) => {
    if (!user?.id || !business?.id) return;

    if (!confirm('Are you sure you want to cancel this transfer?')) {
      return;
    }

    setActionLoading(transferId);
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

      await fetchTransfers();
      toast.success('Transfer cancelled successfully');
    } catch (error: any) {
      console.error('Error cancelling transfer:', error);
      toast.error(error.message || 'Failed to cancel transfer');
    } finally {
      setActionLoading(null);
    }
  };

  // Show loading state while checking features
  if (featuresLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-gray-600 mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  // Show upgrade prompt if warehouse feature is not available
  if (!hasWarehouseAccess) {
    return (
      <>
        <UpgradePrompt
          limitType="feature"
          featureName="Stock Transfers"
          featureKey="settings_multi_warehouse"
          onClose={() => router.push('/settings')}
          onPurchaseSuccess={async () => {
            window.location.reload();
          }}
        />
      </>
    );
  }

  // Check permissions
  if (!canView('warehouse_transfer')) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-600">You do not have permission to view stock transfers.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Transfers</h1>
          <p className="text-gray-600 text-sm mt-1">Transfer inventory between warehouses</p>
        </div>
        {canAdd('warehouse_transfer') && (
          <button
            onClick={() => router.push('/stock-transfers/new')}
            className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            <Plus className="w-5 h-5" />
            <span>New Transfer</span>
          </button>
        )}
      </div>

      {/* Transfers Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : transfers.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-xl shadow-sm border border-gray-200">
            <Truck className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No stock transfers found</p>
            {canAdd('warehouse_transfer') && (
              <button
                onClick={() => router.push('/stock-transfers/new')}
                className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
              >
                Create Your First Transfer
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Transfer #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    From
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    To
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transfers.map((transfer) => {
                  const statusInfo = statusConfig[transfer.status] || statusConfig.draft;
                  const StatusIcon = statusInfo.icon;

                  return (
                    <tr key={transfer.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {transfer.transfer_number}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {new Date(transfer.transfer_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {transfer.from_warehouse_name || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {transfer.to_warehouse_name || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {transfer.created_by_name || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => router.push(`/stock-transfers/${transfer.id}`)}
                            className="text-primary-600 hover:text-primary-700"
                          >
                            View
                          </button>
                          {transfer.status === 'draft' || transfer.status === 'pending_approval' ? (
                            <>
                              {canModify('warehouse_transfer') && (
                                <button
                                  onClick={() => handleApprove(transfer.id)}
                                  disabled={actionLoading === transfer.id}
                                  className="text-green-600 hover:text-green-700 disabled:opacity-50"
                                >
                                  {actionLoading === transfer.id ? 'Approving...' : 'Approve'}
                                </button>
                              )}
                              {canModify('warehouse_transfer') && (
                                <button
                                  onClick={() => handleCancel(transfer.id)}
                                  disabled={actionLoading === transfer.id}
                                  className="text-red-600 hover:text-red-700 disabled:opacity-50"
                                >
                                  {actionLoading === transfer.id ? 'Cancelling...' : 'Cancel'}
                                </button>
                              )}
                            </>
                          ) : transfer.status === 'pending' ? (
                            <>
                              {canModify('warehouse_transfer') && (
                                <button
                                  onClick={() => handleDispatch(transfer.id)}
                                  disabled={actionLoading === transfer.id}
                                  className="text-purple-600 hover:text-purple-700 disabled:opacity-50"
                                >
                                  {actionLoading === transfer.id ? 'Dispatching...' : 'Dispatch'}
                                </button>
                              )}
                              {canModify('warehouse_transfer') && (
                                <button
                                  onClick={() => handleCancel(transfer.id)}
                                  disabled={actionLoading === transfer.id}
                                  className="text-red-600 hover:text-red-700 disabled:opacity-50"
                                >
                                  {actionLoading === transfer.id ? 'Cancelling...' : 'Cancel'}
                                </button>
                              )}
                            </>
                          ) : transfer.status === 'in_transit' ? (
                            <>
                              {canModify('warehouse_transfer') && (
                                <button
                                  onClick={() => router.push(`/stock-transfers/${transfer.id}/receive`)}
                                  className="text-green-600 hover:text-green-700"
                                >
                                  Receive
                                </button>
                              )}
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upgrade Prompt Modal */}
      {showUpgradePrompt && (
        <UpgradePrompt
          limitType="feature"
          featureName="Stock Transfers"
          featureKey="settings_multi_warehouse"
          onClose={() => setShowUpgradePrompt(false)}
          onPurchaseSuccess={async () => {
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
