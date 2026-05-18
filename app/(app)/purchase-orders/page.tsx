'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Filter,
  Loader2,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { SplitPaneLayout } from '@/components/layout/SplitPaneLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PurchaseOrderDetailPanel } from '@/components/purchase-orders/PurchaseOrderDetailPanel';

interface PurchaseOrder {
  id: string;
  supplier_id: string;
  supplier_name: string;
  order_number: string;
  order_date: string;
  expected_delivery_date: string | null;
  status: string;
  grand_total: number;
  converted_purchase_id: string | null;
  notes?: string | null;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'confirmed', label: 'Open' },
  { value: 'partially_fulfilled', label: 'Partially received' },
  { value: 'fulfilled', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

function formatInr(n: number) {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function poStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: 'DRAFT',
    confirmed: 'OPEN',
    partially_fulfilled: 'PARTIALLY RECEIVED',
    fulfilled: 'CLOSED',
    cancelled: 'CANCELLED',
  };
  return map[status] || status.toUpperCase();
}

function poStatusClass(status: string): string {
  const map: Record<string, string> = {
    draft: 'text-gray-700',
    confirmed: 'text-blue-700',
    partially_fulfilled: 'text-amber-700',
    fulfilled: 'text-green-700',
    cancelled: 'text-red-700',
  };
  return map[status] || 'text-gray-700';
}

function billedLabel(order: PurchaseOrder): string {
  if (order.converted_purchase_id) return 'BILLED';
  if (order.status === 'fulfilled') return 'BILLED';
  return 'YET TO BILL';
}

function billedClass(order: PurchaseOrder): string {
  if (order.converted_purchase_id || order.status === 'fulfilled') return 'text-green-700';
  return 'text-gray-600';
}

function PurchaseOrdersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { business } = useAuth();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const fetchPurchaseOrders = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      let url = `/api/purchase-orders?business_id=${business.id}`;
      if (statusFilter) url += `&status=${statusFilter}`;
      const response = await fetch(url, { credentials: 'include' });
      const data = await response.json();
      setPurchaseOrders(data.purchaseOrders || []);
    } catch (error) {
      console.error('Error fetching purchase orders:', error);
    } finally {
      setLoading(false);
    }
  }, [business?.id, statusFilter]);

  useEffect(() => {
    fetchPurchaseOrders();
  }, [fetchPurchaseOrders]);

  useEffect(() => {
    const idFromUrl = searchParams.get('id');
    if (idFromUrl) {
      setSelectedOrderId(idFromUrl);
    }
  }, [searchParams]);

  useEffect(() => {
    if (selectedOrderId && !purchaseOrders.some((o) => o.id === selectedOrderId)) {
      setSelectedOrderId(null);
    }
  }, [purchaseOrders, selectedOrderId]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return purchaseOrders;
    return purchaseOrders.filter(
      (o) =>
        o.order_number?.toLowerCase().includes(q) ||
        o.supplier_name?.toLowerCase().includes(q)
    );
  }, [purchaseOrders, search]);

  const isDetailOpen = selectedOrderId !== null;

  const openOrder = (id: string) => {
    setSelectedOrderId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('id', id);
    window.history.replaceState({}, '', url.pathname + url.search);
  };

  const closeDetail = () => {
    setSelectedOrderId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('id');
    window.history.replaceState({}, '', url.pathname + (url.search || ''));
  };

  const toolbar = (
    <div className="flex flex-col gap-3 md:flex-row md:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search purchase order or vendor"
          className="input w-full pl-9 h-10 text-sm"
        />
      </div>
      <div className="hidden md:block">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input h-10 text-sm w-auto min-w-[160px]"
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value || 'all'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  const compactList = (
    <Card padding="none" className="flex h-full min-h-[420px] flex-col overflow-hidden border border-border bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1 text-sm font-semibold text-gray-900"
        >
          <span className="truncate">All Purchase Orders</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => router.push('/purchase-orders/new')}
            className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-600 text-white hover:bg-primary-700"
            aria-label="New purchase order"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-gray-600 hover:bg-gray-50"
            aria-label="More"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="input h-8 w-full pl-8 text-xs"
          />
        </div>
      </div>
      <div className="flex-1 divide-y divide-border overflow-y-auto">
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <p className="p-6 text-center text-sm text-text-secondary">No purchase orders</p>
        ) : (
          filteredOrders.map((order) => {
            const sel = order.id === selectedOrderId;
            return (
              <button
                key={order.id}
                type="button"
                onClick={() => openOrder(order.id)}
                className={clsx(
                  'w-full px-3 py-3 text-left transition-colors',
                  sel
                    ? 'border-l-[3px] border-primary-500 bg-slate-50'
                    : 'border-l-[3px] border-transparent hover:bg-gray-50'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-gray-900">
                    {order.supplier_name || '—'}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-gray-900">
                    {formatInr(Number(order.grand_total || 0))}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-600">
                  {order.order_number} · {formatDate(order.order_date)}
                </p>
                <p className={clsx('mt-1 text-[10px] font-semibold uppercase', poStatusClass(order.status))}>
                  {poStatusLabel(order.status)}
                </p>
              </button>
            );
          })
        )}
      </div>
    </Card>
  );

  const fullTable = (
    <Card padding="none" className="overflow-hidden border border-border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          className="flex items-center gap-1 text-base font-semibold text-gray-900"
        >
          All Purchase Orders
          <ChevronDown className="h-4 w-4 text-gray-500" />
        </button>
        <div className="flex items-center gap-2">
          <Button onClick={() => router.push('/purchase-orders/new')}>
            <Plus className="mr-1.5 h-4 w-4" />
            New
          </Button>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-gray-600 hover:bg-gray-50"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="p-16 text-center">
          <Package className="mx-auto mb-4 h-12 w-12 text-gray-400" />
          <p className="text-gray-600">No purchase orders found</p>
          <Button className="mt-4" onClick={() => router.push('/purchase-orders/new')}>
            Create purchase order
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-border bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                <th className="w-10 px-3 py-2.5">
                  <input type="checkbox" className="rounded border-gray-300" aria-label="Select all" />
                </th>
                <th className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1">
                    <Filter className="h-3 w-3" />
                    Date
                  </span>
                </th>
                <th className="px-3 py-2.5">Purchase order#</th>
                <th className="px-3 py-2.5">Reference#</th>
                <th className="px-3 py-2.5">Vendor name</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Billed status</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
                <th className="px-3 py-2.5">Delivery date</th>
                <th className="w-10 px-3 py-2.5">
                  <Search className="h-3.5 w-3.5 text-gray-400" />
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr
                  key={order.id}
                  onClick={() => openOrder(order.id)}
                  className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                >
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="rounded border-gray-300" aria-label={`Select ${order.order_number}`} />
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700">{formatDate(order.order_date)}</td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className="text-sm font-medium text-primary-600 hover:text-primary-700 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        openOrder(order.id);
                      }}
                    >
                      {order.order_number}
                    </button>
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-3 text-sm text-gray-600">
                    {order.notes?.slice(0, 40) || '—'}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-900">{order.supplier_name || '—'}</td>
                  <td className="px-3 py-3">
                    <span className={clsx('text-xs font-semibold uppercase', poStatusClass(order.status))}>
                      {poStatusLabel(order.status)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={clsx('text-xs font-semibold uppercase', billedClass(order))}>
                      {billedLabel(order)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right text-sm font-medium text-gray-900">
                    {formatInr(Number(order.grand_total || 0))}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-600">
                    {formatDate(order.expected_delivery_date)}
                  </td>
                  <td className="px-3 py-3" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col space-y-3 md:space-y-4">
      <ListPageHeader
        title="Purchase Orders"
        description="Manage supplier orders before receiving goods"
        actions={
          <>
            <button
              type="button"
              onClick={() => setShowMobileFilters(true)}
              className="rounded-lg border border-border bg-white p-2 text-text-secondary md:hidden"
              aria-label="Filters"
            >
              <Filter className="h-5 w-5" />
            </button>
            {!isDetailOpen && (
              <Button onClick={() => router.push('/purchase-orders/new')} className="md:hidden">
                <Plus className="h-5 w-5" />
              </Button>
            )}
            {!isDetailOpen && (
              <Button
                onClick={() => router.push('/purchase-orders/new')}
                className="hidden md:inline-flex"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                New
              </Button>
            )}
          </>
        }
      />

      {showMobileFilters && (
        <div className="fixed inset-0 z-[100] md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMobileFilters(false)} />
          <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Filters</h3>
              <button type="button" onClick={() => setShowMobileFilters(false)} className="rounded-full p-2 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setShowMobileFilters(false);
              }}
              className="input w-full"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <SplitPaneLayout
        className="min-h-[calc(100vh-10rem)] flex-1"
        isDetailOpen={isDetailOpen}
        onCloseDetail={closeDetail}
        toolbarSlot={!isDetailOpen ? toolbar : undefined}
        listSlot={isDetailOpen ? compactList : fullTable}
        detailSlot={
          selectedOrderId ? (
            <PurchaseOrderDetailPanel
              orderId={selectedOrderId}
              onClose={closeDetail}
              onConverted={fetchPurchaseOrders}
            />
          ) : null
        }
      />
    </div>
  );
}

export default function PurchaseOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      }
    >
      <PurchaseOrdersPageContent />
    </Suspense>
  );
}
