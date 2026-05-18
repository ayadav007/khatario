'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ClipboardList,
  History as HistoryIcon,
  Loader2,
  ExternalLink,
  Package,
  Receipt,
  RotateCcw,
  ShoppingCart,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { clsx } from 'clsx';
import { DetailPanelShell, DetailPanelTab } from '@/components/layout/DetailPanelShell';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';

interface PurchaseDetailPanelProps {
  purchaseId: string;
  onClose: () => void;
}

type TabId = 'overview' | 'items' | 'transactions' | 'history';

interface PaymentRow {
  id: string;
  amount: number;
  payment_mode: string;
  payment_date: string;
  notes?: string | null;
}

interface HistoryEntry {
  id: string;
  action_type: string;
  description: string;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

function formatINR(n: number | string | null | undefined) {
  const num = Number(n ?? 0);
  return `₹ ${num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function PurchaseDetailPanel({ purchaseId, onClose }: PurchaseDetailPanelProps) {
  const router = useRouter();
  const { business, user } = useAuth();
  const [purchase, setPurchase] = useState<any>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [payLoading, setPayLoading] = useState(false);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchPurchase = useCallback(async () => {
    if (!purchaseId || !user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/purchases/${purchaseId}?user_id=${user.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setPurchase(data.purchase);
      } else {
        setPurchase(null);
      }
    } finally {
      setLoading(false);
    }
  }, [purchaseId, user?.id]);

  const fetchPayments = useCallback(async () => {
    if (!business?.id || !user?.id || !purchaseId) return;
    setPayLoading(true);
    try {
      const q = new URLSearchParams({
        business_id: business.id,
        user_id: user.id,
        reference_type: 'purchase',
        reference_id: purchaseId,
      });
      const res = await fetch(`/api/payments?${q.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPayments(data.payments || []);
      } else {
        setPayments([]);
      }
    } finally {
      setPayLoading(false);
    }
  }, [business?.id, user?.id, purchaseId]);

  const fetchHistory = useCallback(async () => {
    if (!user?.id || !purchaseId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/purchases/${purchaseId}/history?user_id=${user.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      } else {
        setHistory([]);
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [purchaseId, user?.id]);

  useEffect(() => {
    setActiveTab('overview');
    setHistory(null);
    setPayments([]);
    setPaymentsLoaded(false);
    fetchPurchase();
  }, [purchaseId, fetchPurchase]);

  useEffect(() => {
    if (activeTab === 'transactions' && !paymentsLoaded) {
      fetchPayments().finally(() => setPaymentsLoaded(true));
    }
    if (activeTab === 'history' && history === null) {
      fetchHistory();
    }
  }, [activeTab, history, fetchHistory, fetchPayments, paymentsLoaded]);

  const tabs: DetailPanelTab[] = useMemo(
    () => [
      { id: 'overview', label: 'Overview', icon: ClipboardList },
      { id: 'items', label: 'Items', icon: Package },
      { id: 'transactions', label: 'Payments', icon: Receipt },
      { id: 'history', label: 'History', icon: HistoryIcon },
    ],
    []
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-card">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!purchase) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-card p-8">
        <p className="text-text-secondary mb-4">Purchase not found</p>
        <button onClick={onClose} className="text-primary-600 hover:underline text-sm">
          Close
        </button>
      </div>
    );
  }

  const grand = Number(purchase.grand_total) || 0;
  const paid = Number(purchase.paid_amount) || 0;
  const balance = grand - paid;
  const lineItems = Array.isArray(purchase.items) ? purchase.items : [];

  const moreActions: NonNullable<React.ComponentProps<typeof DetailPanelShell>['moreActions']> = [
    ...(purchase.status === 'final'
      ? [
          {
            label: 'Create return',
            icon: RotateCcw,
            onClick: () =>
              router.push(
                `/purchase-returns/new?purchase_id=${purchaseId}&supplier_id=${purchase.supplier_id || ''}`
              ),
          },
        ]
      : []),
    {
      label: 'Open full page',
      icon: ExternalLink,
      onClick: () => router.push(`/purchases/${purchaseId}`),
    },
  ];

  return (
    <DetailPanelShell
      title={purchase.bill_number || 'Purchase'}
      subtitle={
        <div className="flex items-center gap-2 flex-wrap">
          {purchase.supplier_name && <span>{purchase.supplier_name}</span>}
          {purchase.bill_date && (
            <>
              {purchase.supplier_name && <span>•</span>}
              <span>{format(new Date(purchase.bill_date), 'dd MMM yyyy')}</span>
            </>
          )}
        </div>
      }
      avatar={
        <div className="w-10 h-10 rounded-lg bg-slate-100 text-primary-700 flex items-center justify-center">
          <ShoppingCart className="w-5 h-5" />
        </div>
      }
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as TabId)}
      onClose={onClose}
      onEdit={() => router.push(`/purchases/new?edit=${purchaseId}`)}
      moreActions={moreActions}
    >
      {activeTab === 'overview' && (
        <div className="p-4 md:p-6 space-y-6">
          <section className="flex flex-wrap gap-2">
            <StatusBadge status={purchase.status} />
            <StatusBadge status={purchase.payment_status || 'unpaid'} />
          </section>

          {purchase.status === 'final' && (
            <section>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  router.push(
                    `/purchase-returns/new?purchase_id=${purchaseId}&supplier_id=${purchase.supplier_id || ''}`
                  )
                }
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                Create purchase return
              </Button>
            </section>
          )}

          <section className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-text-secondary text-xs">Grand Total</div>
              <div className="font-semibold text-lg text-text-primary">{formatINR(grand)}</div>
            </div>
            <div>
              <div className="text-text-secondary text-xs">Balance</div>
              <div className={clsx('font-semibold text-lg', balance > 0 ? 'text-red-700' : 'text-emerald-700')}>
                {formatINR(balance)}
              </div>
            </div>
            <div>
              <div className="text-text-secondary text-xs">Paid</div>
              <div className="font-medium text-text-primary">{formatINR(paid)}</div>
            </div>
            <div>
              <div className="text-text-secondary text-xs">Line items</div>
              <div className="font-medium text-text-primary">{lineItems.length}</div>
            </div>
          </section>
        </div>
      )}

      {activeTab === 'items' && (
        <div className="p-4 md:p-6">
          {lineItems.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <Package className="w-10 h-10 mx-auto text-text-muted mb-3" />
              <p>No line items on this bill.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="border-b border-border text-text-secondary bg-gray-50 dark:bg-gray-900/40">
                  <tr>
                    <th className="text-left py-2 px-2 font-medium">Item</th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">Qty</th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">Unit price</th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">Tax %</th>
                    <th className="text-right py-2 px-2 font-medium whitespace-nowrap">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((item: any, index: number) => (
                    <tr key={item.id ?? index} className="border-b border-border">
                      <td className="py-2 px-2 align-top">
                        <div className="font-medium text-text-primary">{item.item_name || '—'}</div>
                        {item.hsn_sac ? (
                          <div className="text-xs text-text-muted mt-0.5">HSN: {item.hsn_sac}</div>
                        ) : null}
                      </td>
                      <td className="py-2 px-2 text-right text-text-primary whitespace-nowrap">
                        {Number(item.quantity ?? 0).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2 px-2 text-right text-text-primary whitespace-nowrap">
                        {formatINR(item.unit_price)}
                      </td>
                      <td className="py-2 px-2 text-right text-text-secondary whitespace-nowrap">
                        {Number(item.tax_rate ?? 0).toFixed(2)}%
                      </td>
                      <td className="py-2 px-2 text-right font-semibold text-text-primary whitespace-nowrap">
                        {formatINR(item.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'transactions' && (
        <div className="p-4 md:p-6">
          {payLoading && payments.length === 0 ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
            </div>
          ) : payments.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <Receipt className="w-10 h-10 mx-auto text-text-muted mb-3" />
              <p>No payments recorded for this bill.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-text-secondary">
                  <tr>
                    <th className="text-left py-2 px-2 font-medium">Date</th>
                    <th className="text-left py-2 px-2 font-medium">Mode</th>
                    <th className="text-right py-2 px-2 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-border">
                      <td className="py-2 px-2">
                        {p.payment_date ? format(new Date(p.payment_date), 'dd MMM yyyy') : '-'}
                      </td>
                      <td className="py-2 px-2 capitalize">{p.payment_mode}</td>
                      <td className="py-2 px-2 text-right font-semibold text-emerald-700">
                        {formatINR(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="p-4 md:p-6">
          {historyLoading && history === null ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
            </div>
          ) : history && history.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <HistoryIcon className="w-10 h-10 mx-auto text-text-muted mb-3" />
              <p>No activity recorded yet.</p>
            </div>
          ) : (
            <ol className="relative border-l-2 border-border ml-2 space-y-4">
              {history?.map((h) => (
                <li key={h.id} className="pl-4 relative">
                  <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-surface bg-primary-500" />
                  <div className="text-sm text-text-primary font-medium">{h.description}</div>
                  <div className="text-xs text-text-secondary mt-0.5">
                    {h.user_name || h.user_email || 'System'} •{' '}
                    {format(new Date(h.created_at), 'dd MMM yyyy, HH:mm')}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </DetailPanelShell>
  );
}
