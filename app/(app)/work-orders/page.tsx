'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, FileText, Calendar, User, CheckCircle, XCircle, Clock, Wrench, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';

interface WorkOrder {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  work_order_number: string;
  work_order_date: string;
  scheduled_start_date: string | null;
  scheduled_end_date: string | null;
  status: string;
  priority: string;
  work_description: string;
  assigned_to: string | null;
  total_cost: number;
  converted_invoice_id: string | null;
}

export default function WorkOrdersPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  
  // Check authorization before rendering
  // Uses tri-state model: 'loading' | 'allowed' | 'denied'
  const { status: authStatus, reason } = useAuthorizationGuard({
    resource: 'work_orders',
    action: 'read',
    skipCheck: !user?.id || !business?.id
  });

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    if (business?.id) {
      fetchWorkOrders();
    }
  }, [business, statusFilter]);

  async function fetchWorkOrders() {
    try {
      let url = `/api/work-orders?business_id=${business!.id}&user_id=${user!.id}`;
      if (statusFilter) url += `&status=${statusFilter}`;

      const response = await fetch(url);
      const data = await response.json();
      setWorkOrders(data.workOrders || []);
    } catch (error) {
      console.error('Error fetching work orders:', error);
    } finally {
      setLoading(false);
    }
  }

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { color: string; icon: any; label: string }> = {
      draft: { color: 'bg-gray-100 text-gray-800', icon: Clock, label: 'Draft' },
      scheduled: { color: 'bg-slate-100 text-primary-800', icon: Calendar, label: 'Scheduled' },
      in_progress: { color: 'bg-yellow-100 text-yellow-800', icon: Wrench, label: 'In Progress' },
      completed: { color: 'bg-green-100 text-green-800', icon: CheckCircle, label: 'Completed' },
      cancelled: { color: 'bg-red-100 text-red-800', icon: XCircle, label: 'Cancelled' },
    };
    const badge = badges[status] || badges.draft;
    const Icon = badge.icon;
    return (
      <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium ${badge.color}`}>
        <Icon className="w-4 h-4" />
        <span>{badge.label}</span>
      </div>
    );
  };

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      low: 'bg-gray-100 text-gray-800',
      medium: 'bg-slate-100 text-primary-800',
      high: 'bg-orange-100 text-orange-800',
      urgent: 'bg-red-100 text-red-800',
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${colors[priority] || colors.medium}`}>
        {priority.charAt(0).toUpperCase() + priority.slice(1)}
      </span>
    );
  };

  // Show loading state while checking authorization (tri-state: 'loading')
  if (authStatus === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  // Show access denied only if check completed and denied (tri-state: 'denied')
  if (authStatus === 'denied') {
    return (
      <AccessDenied
        module="work_orders"
        action="read"
        details={reason}
        code="WORK_ORDER_READ_DENIED"
      />
    );
  }

  // authStatus === 'allowed' - render page content

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Work Orders</h1>
            <p className="text-gray-600 text-sm mt-1">Track services and jobs performed for customers</p>
          </div>
          <button
            onClick={() => router.push('/work-orders/new')}
            className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            <Plus className="w-5 h-5" />
            <span>New Work Order</span>
          </button>
        </div>

        {/* Filters */}
        <div className="flex space-x-2 overflow-x-auto">
          {['', 'draft', 'scheduled', 'in_progress', 'completed', 'cancelled'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                statusFilter === status
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {status === '' ? 'All' : status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </button>
          ))}
        </div>

        {/* Info Banner */}
        <div className="bg-slate-50 border border-primary-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <Wrench className="w-5 h-5 text-primary-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-primary-900">About Work Orders</p>
              <p className="text-sm text-primary-700 mt-1">
                Work orders help you track services, jobs, and maintenance work. Convert them to invoices when the work is completed.
              </p>
            </div>
          </div>
        </div>

        {/* Work Orders List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {loading ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : workOrders.length === 0 ? (
            <div className="p-12 text-center">
              <Wrench className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No work orders found</p>
              <button
                onClick={() => router.push('/work-orders/new')}
                className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
              >
                Create Your First Work Order
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Work Order #</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Customer</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Date</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Description</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Assigned To</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Priority</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Cost</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {workOrders.map((wo) => (
                    <tr key={wo.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <FileText className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-900">
                            {wo.work_order_number}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {wo.customer_name ? (
                          <div className="flex items-center space-x-2">
                            <User className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-700">{wo.customer_name}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2 text-sm text-gray-600">
                          <Calendar className="w-4 h-4" />
                          <span>{new Date(wo.work_order_date).toLocaleDateString()}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm text-gray-700 line-clamp-1" title={wo.work_description}>
                          {wo.work_description.substring(0, 50)}{wo.work_description.length > 50 ? '...' : ''}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm text-gray-600">{wo.assigned_to || '-'}</span>
                      </td>
                      <td className="py-4 px-4">{getPriorityBadge(wo.priority)}</td>
                      <td className="py-4 px-4">
                        <span className="text-sm font-semibold text-gray-900">
                          ₹{wo.total_cost.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-4 px-4">{getStatusBadge(wo.status)}</td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          {wo.converted_invoice_id && (
                            <button
                              onClick={() => router.push(`/invoices/${wo.converted_invoice_id}`)}
                              className="text-sm text-green-600 hover:underline"
                            >
                              Invoice
                            </button>
                          )}
                          <button
                            onClick={() => router.push(`/work-orders/${wo.id}`)}
                            className="text-sm text-gray-600 hover:underline"
                          >
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    
  );
}

