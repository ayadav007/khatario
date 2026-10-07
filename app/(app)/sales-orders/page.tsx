'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, FileText, Calendar, User, CheckCircle, XCircle, Clock, Package, ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useToastContext } from '@/contexts/ToastContext';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { PageToolbar, PageToolbarChip } from '@/components/layout/PageToolbar';
import { BulkConvertSalesOrdersModal } from '@/components/sales-orders/BulkConvertSalesOrdersModal';
import { ConvertSalesOrderModal } from '@/components/sales-orders/ConvertSalesOrderModal';
import { StatusBadge } from '@/components/ui/StatusBadge';

interface SalesOrder {
  id: string;
  customer_id: string;
  customer_name: string;
  order_number: string;
  order_date: string;
  expected_delivery_date: string | null;
  status: string;
  grand_total: number;
  converted_invoice_id: string | null;
  payment_status?: string | null;
  total_paid?: string | number | null;
  payment_remaining?: string | number | null;
  linked_invoice_count?: number | null;
  latest_invoice_id?: string | null;
  latest_invoice_number?: string | null;
}

export default function SalesOrdersPage() {
  const router = useRouter();
  const { business } = useAuth();
  const toast = useToastContext();
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [convertOrder, setConvertOrder] = useState<SalesOrder | null>(null);

  useEffect(() => {
    if (business?.id) {
      fetchSalesOrders();
    }
  }, [business, statusFilter]);

  async function fetchSalesOrders() {
    try {
      let url = `/api/sales-orders?business_id=${business!.id}`;
      if (statusFilter) url += `&status=${statusFilter}`;

      const response = await fetch(url);
      const data = await response.json();
      setSalesOrders(data.salesOrders || []);
    } catch (error) {
      console.error('Error fetching sales orders:', error);
    } finally {
      setLoading(false);
    }
  }

  const formatInr = (n: number) =>
    `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const parseNum = (v: string | number | null | undefined) => {
    if (v == null) return 0;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : 0;
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { color: string; icon: any; label: string }> = {
      draft: { color: 'bg-gray-100 text-gray-800', icon: Clock, label: 'Draft' },
      confirmed: { color: 'bg-slate-100 text-primary-800', icon: CheckCircle, label: 'Open' },
      partially_fulfilled: { color: 'bg-yellow-100 text-yellow-800', icon: Package, label: 'Partial Open' },
      fulfilled: { color: 'bg-green-100 text-green-800', icon: CheckCircle, label: 'Completed' },
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

  const canConvert = (status: string) =>
    !['fulfilled', 'cancelled', 'rejected'].includes(String(status || '').toLowerCase());

  return (
    
      <div className="space-y-3 md:space-y-6">
        <ListPageHeader
          title="Sales Orders"
          description="Manage customer orders before invoicing"
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                className="flex items-center space-x-2 px-3 py-2 border border-border bg-surface text-text-primary rounded-lg hover:bg-slate-50 transition h-10 text-sm"
              >
                <ArrowRight className="w-4 h-4" />
                <span className="hidden sm:inline">Bulk Convert</span>
                <span className="sm:hidden">Bulk</span>
              </button>
              <button
                type="button"
                onClick={() => router.push('/sales-orders/new')}
                className="hidden md:flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition h-10"
              >
                <Plus className="w-5 h-5" />
                <span>New Sales Order</span>
              </button>
            </div>
          }
        />

        <PageToolbar>
          {(
            [
              ['', 'All'],
              ['draft', 'Draft'],
              ['confirmed', 'Open'],
              ['partially_fulfilled', 'Partial Open'],
              ['fulfilled', 'Completed'],
              ['cancelled', 'Cancelled'],
            ] as const
          ).map(([status, label]) => (
            <PageToolbarChip
              key={status}
              active={statusFilter === status}
              onClick={() => setStatusFilter(status)}
            >
              {label}
            </PageToolbarChip>
          ))}
        </PageToolbar>

        {/* Info Banner — desktop only; saves mobile vertical space */}
        <div className="hidden md:block bg-slate-50 border border-border rounded-lg p-4 dark:bg-slate-900/40">
          <div className="flex items-start space-x-3">
            <Package className="w-5 h-5 text-primary-600 mt-0.5 dark:text-primary-400" />
            <div>
              <p className="text-sm font-medium text-primary-900 dark:text-primary-100">About Sales Orders</p>
              <p className="text-sm text-primary-700 dark:text-primary-300 mt-1">
                Create sales orders to track customer orders. Convert them to invoices when ready to fulfill.
              </p>
            </div>
          </div>
        </div>

        {/* Sales Orders List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {loading ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : salesOrders.length === 0 ? (
            <div className="p-12 text-center">
              <Package className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No sales orders found</p>
              <button
                onClick={() => router.push('/sales-orders/new')}
                className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
              >
                Create Your First Sales Order
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Order #</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Customer</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Order Date</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Expected Delivery</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Amount</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Payment</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700">Remaining</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {salesOrders.map((order) => (
                    <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <FileText className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-900">
                            {order.order_number}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <User className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-700">{order.customer_name}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2 text-sm text-gray-600">
                          <Calendar className="w-4 h-4" />
                          <span>{new Date(order.order_date).toLocaleDateString()}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm text-gray-600">
                          {order.expected_delivery_date ? new Date(order.expected_delivery_date).toLocaleDateString() : '-'}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm font-semibold text-gray-900">
                          {formatInr(parseNum(order.grand_total))}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <StatusBadge
                          status={order.payment_status || 'unpaid'}
                          showIcon={false}
                        />
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span
                          className={
                            parseNum(order.payment_remaining) > 0.005
                              ? 'text-sm font-medium text-amber-800'
                              : 'text-sm text-gray-600'
                          }
                        >
                          {formatInr(parseNum(order.payment_remaining))}
                        </span>
                      </td>
                      <td className="py-4 px-4">{getStatusBadge(order.status)}</td>
                      <td className="py-4 px-4">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {canConvert(order.status) && (
                            <button
                              onClick={() => setConvertOrder(order)}
                              className="text-sm text-primary-600 hover:underline flex items-center gap-1"
                            >
                              <ArrowRight className="w-4 h-4" />
                              Convert
                            </button>
                          )}
                          {(order.linked_invoice_count ?? 0) > 0 && order.latest_invoice_id && (
                            <button
                              onClick={() => router.push(`/invoices/${order.latest_invoice_id}`)}
                              className="text-sm text-green-600 hover:underline"
                            >
                              {(order.linked_invoice_count ?? 0) > 1
                                ? `${order.linked_invoice_count} invoices`
                                : order.latest_invoice_number || 'View Invoice'}
                            </button>
                          )}
                          {!order.linked_invoice_count && order.converted_invoice_id && (
                            <button
                              onClick={() => router.push(`/invoices/${order.converted_invoice_id}`)}
                              className="text-sm text-green-600 hover:underline"
                            >
                              View Invoice
                            </button>
                          )}
                          <button
                            onClick={() => router.push(`/sales-orders/${order.id}`)}
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

        <BulkConvertSalesOrdersModal
          open={bulkOpen}
          businessId={business?.id || ''}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false);
            toast.success('Selected sales orders converted to invoices');
            fetchSalesOrders();
          }}
        />

        {convertOrder && (
          <ConvertSalesOrderModal
            open={!!convertOrder}
            orderId={convertOrder.id}
            orderNumber={convertOrder.order_number}
            onClose={() => setConvertOrder(null)}
            onSuccess={({ invoiceNumber, partial }) => {
              setConvertOrder(null);
              toast.success(
                partial
                  ? `Partial invoice created${invoiceNumber ? `: ${invoiceNumber}` : ''} (order still open)`
                  : `Invoice created${invoiceNumber ? `: ${invoiceNumber}` : ''}`,
              );
              fetchSalesOrders();
            }}
          />
        )}
      </div>
    
  );
}

