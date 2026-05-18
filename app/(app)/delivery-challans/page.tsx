'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, FileText, Calendar, User, CheckCircle, XCircle, Clock, Truck, Package } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { ListPageHeader } from '@/components/layout/ListPageHeader';

interface DeliveryChallan {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  sales_order_id: string | null;
  sales_order_number: string | null;
  challan_number: string;
  challan_date: string;
  delivery_date: string | null;
  status: string;
  e_way_bill_number: string | null;
  vehicle_number: string | null;
  place_of_delivery: string | null;
}

export default function DeliveryChallansPage() {
  const router = useRouter();
  const { business } = useAuth();
  const [deliveryChallans, setDeliveryChallans] = useState<DeliveryChallan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    if (business?.id) {
      fetchDeliveryChallans();
    }
  }, [business, statusFilter]);

  async function fetchDeliveryChallans() {
    try {
      let url = `/api/delivery-challans?business_id=${business!.id}`;
      if (statusFilter) url += `&status=${statusFilter}`;

      const response = await fetch(url);
      const data = await response.json();
      setDeliveryChallans(data.deliveryChallans || []);
    } catch (error) {
      console.error('Error fetching delivery challans:', error);
    } finally {
      setLoading(false);
    }
  }

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { color: string; icon: any; label: string }> = {
      draft: { color: 'bg-gray-100 text-gray-800', icon: Clock, label: 'Draft' },
      sent: { color: 'bg-slate-100 text-primary-800', icon: Package, label: 'Sent' },
      delivered: { color: 'bg-green-100 text-green-800', icon: CheckCircle, label: 'Delivered' },
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

  return (
    
      <div className="space-y-3 md:space-y-6">
        <ListPageHeader
          title="Delivery Challans"
          description="Shipping documents for goods delivery"
          actions={
            <button
              type="button"
              onClick={() => router.push('/delivery-challans/new')}
              className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition h-10"
            >
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">New Delivery Challan</span>
            </button>
          }
        />

        {/* Filters */}
        <div className="flex space-x-2 overflow-x-auto">
          {['', 'draft', 'sent', 'delivered', 'cancelled'].map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                statusFilter === status
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {status === '' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Info Banner */}
        <div className="bg-slate-50 border border-primary-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <Truck className="w-5 h-5 text-primary-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-primary-900">About Delivery Challans</p>
              <p className="text-sm text-primary-700 mt-1">
                Delivery challans are non-taxable shipping documents used to dispatch goods. They can be linked to invoices or sales orders.
              </p>
            </div>
          </div>
        </div>

        {/* Delivery Challans List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {loading ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : deliveryChallans.length === 0 ? (
            <div className="p-12 text-center">
              <Truck className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No delivery challans found</p>
              <button
                onClick={() => router.push('/delivery-challans/new')}
                className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
              >
                Create Your First Delivery Challan
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Challan #</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Customer</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Challan Date</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Delivery Date</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Linked To</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Vehicle</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveryChallans.map((challan) => (
                    <tr key={challan.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <FileText className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-900">
                            {challan.challan_number}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {challan.customer_name ? (
                          <div className="flex items-center space-x-2">
                            <User className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-700">{challan.customer_name}</span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2 text-sm text-gray-600">
                          <Calendar className="w-4 h-4" />
                          <span>{new Date(challan.challan_date).toLocaleDateString()}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm text-gray-600">
                          {challan.delivery_date ? new Date(challan.delivery_date).toLocaleDateString() : '-'}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex flex-col space-y-1">
                          {challan.invoice_number && (
                            <span className="text-xs text-primary-600">Invoice: {challan.invoice_number}</span>
                          )}
                          {challan.sales_order_number && (
                            <span className="text-xs text-purple-600">Order: {challan.sales_order_number}</span>
                          )}
                          {!challan.invoice_number && !challan.sales_order_number && (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm text-gray-600">
                          {challan.vehicle_number || '-'}
                        </span>
                      </td>
                      <td className="py-4 px-4">{getStatusBadge(challan.status)}</td>
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => router.push(`/delivery-challans/${challan.id}`)}
                            className="text-sm text-gray-600 hover:underline"
                          >
                            View
                          </button>
                          {challan.invoice_id && (
                            <button
                              onClick={() => router.push(`/invoices/${challan.invoice_id}`)}
                              className="text-sm text-primary-600 hover:underline"
                            >
                              Invoice
                            </button>
                          )}
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

