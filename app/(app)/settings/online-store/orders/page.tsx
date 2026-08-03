'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ShoppingBag, Loader2, Phone, MapPin, Clock, ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import clsx from 'clsx';

interface StoreOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  customer_address: string | null;
  customer_pincode: string | null;
  delivery_mode: 'delivery' | 'pickup';
  status: string;
  notes: string | null;
  subtotal: number;
  grand_total: number;
  delivery_charge: number;
  cancelled_reason: string | null;
  created_at: string;
  branch_name: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  ready: 'Ready',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-blue-100 text-blue-800',
  ready: 'bg-green-100 text-green-800',
  delivered: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_FLOW: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export default function StoreOrdersPage() {
  const { business, user } = useAuth();
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<StoreOrder | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const fetchOrders = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        page: String(page),
      });
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(
        `/api/settings/online-store/orders?${params}`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders);
        setTotal(data.total);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [business?.id, page, statusFilter]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const updateOrderStatus = useCallback(
    async (orderId: string, status: string) => {
      if (!business?.id) return;
      setUpdatingStatus(true);
      try {
        const res = await fetch('/api/settings/online-store/orders', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id: business.id,
            order_id: orderId,
            status,
          }),
        });
        if (res.ok) {
          void fetchOrders();
          if (selectedOrder?.id === orderId) {
            setSelectedOrder({ ...selectedOrder, status });
          }
        }
      } catch {
        // silent
      } finally {
        setUpdatingStatus(false);
      }
    },
    [business?.id, fetchOrders, selectedOrder],
  );

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <SettingsPageShell
      title="Store Orders"
      description="View and manage orders placed through your online store."
      icon={ShoppingBag}
    >
      {/* Status filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
        <button
          onClick={() => { setStatusFilter(null); setPage(1); }}
          className={clsx(
            'flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
            !statusFilter
              ? 'bg-gray-900 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
          )}
        >
          All
        </button>
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setStatusFilter(key); setPage(1); }}
            className={clsx(
              'flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
              statusFilter === key
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : orders.length === 0 ? (
        <div className="py-12 text-center">
          <ShoppingBag className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No orders yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <Card
              key={order.id}
              className="cursor-pointer p-4 hover:bg-gray-50 transition-colors"
              onClick={() => setSelectedOrder(order)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">
                      {order.order_number}
                    </span>
                    <span
                      className={clsx(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        STATUS_COLORS[order.status] ?? 'bg-gray-100 text-gray-700',
                      )}
                    >
                      {STATUS_LABELS[order.status] ?? order.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-700">{order.customer_name}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(order.created_at)}
                    </span>
                    {order.delivery_mode === 'pickup' ? (
                      <span>Self pickup</span>
                    ) : null}
                    {order.branch_name ? (
                      <span>{order.branch_name}</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-gray-900">
                    &#x20B9;{order.grand_total.toLocaleString('en-IN')}
                  </span>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                </div>
              </div>
            </Card>
          ))}

          {/* Pagination */}
          {total > 20 ? (
            <div className="flex justify-center gap-2 pt-4">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span className="flex items-center px-3 text-sm text-gray-500">
                Page {page} of {Math.ceil(total / 20)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page * 20 >= total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {/* Order detail modal */}
      {selectedOrder ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSelectedOrder(null)}
          />
          <div className="relative w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  {selectedOrder.order_number}
                </h3>
                <span
                  className={clsx(
                    'mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                    STATUS_COLORS[selectedOrder.status],
                  )}
                >
                  {STATUS_LABELS[selectedOrder.status]}
                </span>
              </div>
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-gray-400 mb-1">Customer</p>
                <p className="text-sm font-medium text-gray-900">
                  {selectedOrder.customer_name}
                </p>
                <a
                  href={`tel:${selectedOrder.customer_phone}`}
                  className="flex items-center gap-1 text-sm text-blue-600 hover:underline mt-0.5"
                >
                  <Phone className="h-3 w-3" />
                  {selectedOrder.customer_phone}
                </a>
                {selectedOrder.customer_email ? (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {selectedOrder.customer_email}
                  </p>
                ) : null}
              </div>

              {selectedOrder.delivery_mode === 'delivery' && selectedOrder.customer_address ? (
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-1">Delivery Address</p>
                  <div className="flex items-start gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-gray-700">
                        {selectedOrder.customer_address}
                      </p>
                      {selectedOrder.customer_pincode ? (
                        <p className="text-xs text-gray-400">
                          PIN: {selectedOrder.customer_pincode}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-1">Delivery</p>
                  <p className="text-sm text-gray-700">Self Pickup</p>
                </div>
              )}

              {selectedOrder.notes ? (
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-1">Notes</p>
                  <p className="text-sm text-gray-600">{selectedOrder.notes}</p>
                </div>
              ) : null}

              <div className="border-t border-gray-100 pt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="text-gray-900">
                    &#x20B9;{selectedOrder.subtotal.toLocaleString('en-IN')}
                  </span>
                </div>
                {selectedOrder.delivery_charge > 0 ? (
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-gray-500">Delivery</span>
                    <span className="text-gray-900">
                      &#x20B9;{selectedOrder.delivery_charge.toLocaleString('en-IN')}
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between text-sm font-bold mt-2 pt-2 border-t border-gray-100">
                  <span className="text-gray-900">Total</span>
                  <span className="text-gray-900">
                    &#x20B9;{selectedOrder.grand_total.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              {/* Status actions */}
              {(STATUS_FLOW[selectedOrder.status] ?? []).length > 0 ? (
                <div className="flex gap-2 pt-2">
                  {(STATUS_FLOW[selectedOrder.status] ?? []).map((nextStatus) => (
                    <Button
                      key={nextStatus}
                      size="sm"
                      variant={nextStatus === 'cancelled' ? 'ghost' : 'default'}
                      disabled={updatingStatus}
                      onClick={() =>
                        updateOrderStatus(selectedOrder.id, nextStatus)
                      }
                      className={
                        nextStatus === 'cancelled'
                          ? 'text-red-600 hover:text-red-700'
                          : ''
                      }
                    >
                      {updatingStatus ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      {STATUS_LABELS[nextStatus]}
                    </Button>
                  ))}
                </div>
              ) : null}

              {selectedOrder.cancelled_reason ? (
                <p className="text-xs text-red-600">
                  Cancelled: {selectedOrder.cancelled_reason}
                </p>
              ) : null}

              {/* WhatsApp shortcut */}
              <a
                href={`https://wa.me/${selectedOrder.customer_phone.replace(/\D/g, '')}?text=${encodeURIComponent(
                  `Hi ${selectedOrder.customer_name}, regarding your order ${selectedOrder.order_number}...`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 py-2.5 text-sm font-medium text-green-700 hover:bg-green-100"
              >
                Message on WhatsApp
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </SettingsPageShell>
  );
}
