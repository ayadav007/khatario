'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ShoppingBag, Loader2, Phone, MapPin, Clock, ChevronRight,
  ScanLine, Printer, Banknote, Truck, Camera,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { BarcodeScanner } from '@/components/ui/BarcodeScanner';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { printStorePackingSlip } from '@/lib/store/print-packing-slip';
import clsx from 'clsx';

interface StoreOrderItem {
  id: string;
  item_name: string;
  variant_name: string | null;
  quantity: number;
  packed_qty: number;
  unit: string;
  unit_price: number;
  line_total: number;
  barcode: string | null;
  code: string | null;
}

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
  payment_status?: string;
  awb?: string | null;
  tracking_url?: string | null;
  invoice_id?: string | null;
  dispatch_mode?: string | null;
  courier_scanned_at?: string | null;
  cash_collected_at?: string | null;
  cancelled_reason: string | null;
  created_at: string;
  branch_name: string | null;
  line_count?: number;
  packed_lines?: number;
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
  const { business } = useAuth();
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [queryText, setQueryText] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<StoreOrder | null>(null);
  const [items, setItems] = useState<StoreOrderItem[]>([]);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [showPlaybook, setShowPlaybook] = useState(false);
  const [showDispatch, setShowDispatch] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [scanHint, setScanHint] = useState('Scan gun ready: item → packing slip → courier AWB');
  const lastPackedId = useRef<string | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        page: String(page),
      });
      if (statusFilter) params.set('status', statusFilter);
      if (queryText.trim()) params.set('q', queryText.trim());

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
  }, [business?.id, page, statusFilter, queryText]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const openOrder = useCallback(async (order: StoreOrder) => {
    if (!business?.id) return;
    setSelectedOrder(order);
    lastPackedId.current = order.id;
    const res = await fetch(
      `/api/settings/online-store/orders?business_id=${business.id}&order_id=${order.id}`,
      { credentials: 'include' },
    );
    if (!res.ok) return;
    const data = await res.json();
    setSelectedOrder(data.order);
    setItems(data.items ?? []);
  }, [business?.id]);

  const patchOrder = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!business?.id) return null;
      setUpdatingStatus(true);
      try {
        const res = await fetch('/api/settings/online-store/orders', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ business_id: business.id, ...payload }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error || 'Could not update order');
          return null;
        }
        if (data.order) {
          setSelectedOrder(data.order);
          setItems(data.items ?? []);
          lastPackedId.current = data.order.id;
        }
        void fetchOrders();
        return data;
      } finally {
        setUpdatingStatus(false);
      }
    },
    [business?.id, fetchOrders],
  );

  const applyScanResult = useCallback((data: Record<string, unknown>) => {
    if (data.order) {
      setSelectedOrder(data.order as StoreOrder);
      setItems((data.items as StoreOrderItem[]) ?? []);
      lastPackedId.current = (data.order as StoreOrder).id;
    }
    if (data.kind === 'packed') {
      const name = String(data.item_name ?? 'Item');
      toast.success(data.fully_packed ? `${name} packed. Order complete — print slip, then scan courier AWB.` : `Packed ${name}`);
      setScanHint(
        data.fully_packed
          ? 'Print packing slip, then scan the courier partner barcode (AWB)'
          : 'Keep scanning jewellery barcodes',
      );
    } else if (data.kind === 'awb') {
      toast.success('Courier AWB attached');
      setScanHint('Scan the next jewellery barcode (FIFO packs the oldest matching order)');
    } else if (data.kind === 'select_order') {
      toast.success('Order opened');
      setScanHint('Scan item barcodes to pack this order');
    }
    void fetchOrders();
  }, [fetchOrders]);

  const handleBarcode = useCallback(async (barcode: string) => {
    if (!business?.id) return;
    const res = await fetch('/api/settings/online-store/orders', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: business.id,
        action: 'scan',
        barcode,
        order_id: selectedOrder?.id ?? lastPackedId.current,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || 'Unknown barcode');
      return;
    }
    applyScanResult(data);
  }, [applyScanResult, business?.id, selectedOrder?.id]);

  useBarcodeScanner({
    onScan: (code) => { void handleBarcode(code); },
    enabled: Boolean(business?.id) && !showCamera,
    minLength: 3,
    maxLength: 48,
  });

  const updateOrderStatus = useCallback(
    async (orderId: string, status: string, dispatch_mode?: string) => {
      if (status === 'ready' && !dispatch_mode) {
        setShowDispatch(true);
        return;
      }
      const data = await patchOrder({ order_id: orderId, status, dispatch_mode });
      if (data?.success) {
        setShowDispatch(false);
        if (status === 'ready' && dispatch_mode === 'shiprocket') {
          toast.success('Marked ready. Courier booking attempted.');
        }
      }
    },
    [patchOrder],
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
      description="Pack by scan, print the slip, then scan the courier AWB before handover."
      icon={ShoppingBag}
    >
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <ScanLine className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-medium">{scanHint}</p>
              <p className="mt-1 text-xs text-amber-800/80">
                100 jewellery orders: scan each piece (oldest matching order packs first), print packing slip, scan Delhivery/Bluedart/Shiprocket sticker onto that packet.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="flex-shrink-0 text-xs font-medium underline"
            onClick={() => setShowPlaybook((v) => !v)}
          >
            {showPlaybook ? 'Hide steps' : 'Full playbook'}
          </button>
        </div>
        {showPlaybook ? (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-amber-950">
            <li>WhatsApp hits the shop phone when an order lands. Confirm paid or COD.</li>
            <li>Scan the jewellery barcode (or SKU). Khatario packs the oldest unfilled order with that SKU.</li>
            <li>When the order is fully packed, print packing slip (order QR) and tax invoice.</li>
            <li>Choose dispatch: customer pickup, own rider, or Shiprocket.</li>
            <li>When the courier hands you the AWB sticker, scan it onto the open order — that is the delivery-partner barcode.</li>
            <li>COD: tap Cash collected when the rider or customer pays. Then mark Delivered.</li>
          </ol>
        ) : null}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={queryText}
          onChange={(e) => { setQueryText(e.target.value); setPage(1); }}
          placeholder="Search order, phone, AWB"
          className="min-w-[180px] flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <Button type="button" size="sm" variant="secondary" onClick={() => setShowCamera(true)}>
          <Camera className="mr-1 h-3.5 w-3.5" />
          Camera
        </Button>
      </div>

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
              onClick={() => void openOrder(order)}
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
                    {order.awb ? (
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800">
                        AWB
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-gray-700">{order.customer_name}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(order.created_at)}
                    </span>
                    <span>
                      Packed {order.packed_lines ?? 0}/{order.line_count ?? 0}
                    </span>
                    {order.delivery_mode === 'pickup' ? (
                      <span>Self pickup</span>
                    ) : null}
                    {order.payment_status === 'cod' ? <span>COD</span> : null}
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

              {items.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-1">Items to pack</p>
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {items.map((line) => {
                      const done = line.packed_qty >= line.quantity;
                      return (
                        <li key={line.id} className="flex items-center justify-between px-3 py-2 text-sm">
                          <span className={done ? 'text-gray-400 line-through' : 'text-gray-800'}>
                            {line.item_name}
                            {line.variant_name ? ` · ${line.variant_name}` : ''}
                            <span className="ml-1 text-xs text-gray-400">
                              {line.barcode || line.code || 'no barcode'}
                            </span>
                          </span>
                          <span className={done ? 'text-green-700 text-xs font-medium' : 'text-gray-500 text-xs'}>
                            {line.packed_qty}/{line.quantity} {line.unit}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  type="button"
                  onClick={() => void printStorePackingSlip(selectedOrder, items)}
                >
                  <Printer className="mr-1 h-3.5 w-3.5" />
                  Packing slip
                </Button>
                {selectedOrder.invoice_id ? (
                  <a
                    href={`/invoices/${selectedOrder.invoice_id}`}
                    className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium"
                  >
                    Invoice / thermal print
                  </a>
                ) : null}
                {selectedOrder.payment_status === 'cod' && !selectedOrder.cash_collected_at ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    type="button"
                    disabled={updatingStatus}
                    onClick={() => void patchOrder({ action: 'collect_cash', order_id: selectedOrder.id })}
                  >
                    <Banknote className="mr-1 h-3.5 w-3.5" />
                    Cash collected
                  </Button>
                ) : null}
              </div>

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

              {(STATUS_FLOW[selectedOrder.status] ?? []).length > 0 ? (
                <div className="flex gap-2 pt-2">
                  {(STATUS_FLOW[selectedOrder.status] ?? []).map((nextStatus) => (
                    <Button
                      key={nextStatus}
                      size="sm"
                      variant={nextStatus === 'cancelled' ? 'ghost' : 'default'}
                      disabled={updatingStatus}
                      onClick={() =>
                        void updateOrderStatus(selectedOrder.id, nextStatus)
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

              {selectedOrder.payment_status ? (
                <p className="mt-2 text-xs text-gray-500">
                  Payment: {selectedOrder.payment_status}
                  {selectedOrder.cash_collected_at ? ' · cash in' : ''}
                </p>
              ) : null}
              {selectedOrder.awb || selectedOrder.tracking_url ? (
                <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">
                  {selectedOrder.awb ? <p>AWB: {selectedOrder.awb}</p> : null}
                  {selectedOrder.courier_scanned_at ? (
                    <p className="text-xs text-gray-500">Courier barcode scanned</p>
                  ) : null}
                  {selectedOrder.tracking_url ? (
                    <a
                      className="text-blue-600 hover:underline"
                      href={selectedOrder.tracking_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Track shipment
                    </a>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-gray-400">
                  No courier AWB yet. After the partner prints the sticker, scan it with the gun.
                </p>
              )}

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

      {showDispatch && selectedOrder ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowDispatch(false)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h4 className="flex items-center gap-2 font-semibold text-gray-900">
              <Truck className="h-4 w-4" />
              How is this going out?
            </h4>
            <p className="mt-1 text-xs text-gray-500">
              Shiprocket only books if you pick courier. Own rider / pickup skips booking — still scan the partner AWB if they collect from the shop.
            </p>
            <div className="mt-4 space-y-2">
              {selectedOrder.delivery_mode === 'pickup' ? (
                <Button
                  className="w-full"
                  type="button"
                  disabled={updatingStatus}
                  onClick={() => void updateOrderStatus(selectedOrder.id, 'ready', 'pickup')}
                >
                  Customer pickup
                </Button>
              ) : null}
              <Button
                className="w-full"
                type="button"
                variant="secondary"
                disabled={updatingStatus}
                onClick={() => void updateOrderStatus(selectedOrder.id, 'ready', 'self')}
              >
                Own rider / shop handover
              </Button>
              <Button
                className="w-full"
                type="button"
                disabled={updatingStatus}
                onClick={() => void updateOrderStatus(selectedOrder.id, 'ready', 'shiprocket')}
              >
                Book Shiprocket
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {showCamera ? (
        <BarcodeScanner
          onScan={(code) => {
            setShowCamera(false);
            void handleBarcode(code);
          }}
          onClose={() => setShowCamera(false)}
        />
      ) : null}
    </SettingsPageShell>
  );
}
