'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ClipboardList,
  History as HistoryIcon,
  Loader2,
  ExternalLink,
  Link2,
  IndianRupee,
} from 'lucide-react';
import { clsx } from 'clsx';
import { DetailPanelShell, DetailPanelTab } from '@/components/layout/DetailPanelShell';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';

interface PaymentDetailPanelProps {
  paymentId: string;
  onClose: () => void;
  /** receivable = Payment In, payable = Payment Out */
  paymentKind: 'receivable' | 'payable';
}

type TabId = 'overview' | 'linked' | 'history';

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

export function PaymentDetailPanel({ paymentId, onClose, paymentKind }: PaymentDetailPanelProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [payment, setPayment] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const fetchPayment = useCallback(async () => {
    if (!paymentId || !user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/payments/${paymentId}?user_id=${user.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setPayment(data.payment);
      } else {
        setPayment(null);
      }
    } finally {
      setLoading(false);
    }
  }, [paymentId, user?.id]);

  const fetchHistory = useCallback(async () => {
    if (!user?.id || !paymentId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/payments/${paymentId}/history?user_id=${user.id}`, {
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
  }, [paymentId, user?.id]);

  useEffect(() => {
    setActiveTab('overview');
    setHistory(null);
    fetchPayment();
  }, [paymentId, fetchPayment]);

  useEffect(() => {
    if (activeTab === 'history' && history === null) {
      fetchHistory();
    }
  }, [activeTab, history, fetchHistory]);

  const tabs: DetailPanelTab[] = useMemo(
    () => [
      { id: 'overview', label: 'Overview', icon: ClipboardList },
      { id: 'linked', label: 'Linked document', icon: Link2 },
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

  if (!payment) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-card p-8">
        <p className="text-text-secondary mb-4">Payment not found</p>
        <button onClick={onClose} className="text-primary-600 hover:underline text-sm">
          Close
        </button>
      </div>
    );
  }

  const partyName =
    paymentKind === 'receivable'
      ? payment.customer_name || 'Cash sale'
      : payment.supplier_name || '—';

  const openLinked = () => {
    if (payment.reference_type === 'invoice' && payment.reference_id) {
      router.push(`/invoices/${payment.reference_id}`);
    } else if (payment.reference_type === 'purchase' && payment.reference_id) {
      router.push(`/purchases/${payment.reference_id}`);
    }
  };

  const moreActions: NonNullable<React.ComponentProps<typeof DetailPanelShell>['moreActions']> = [];
  if (payment.reference_type && payment.reference_id) {
    moreActions.push({
      label: 'Open linked document',
      icon: ExternalLink,
      onClick: openLinked,
    });
  }

  const amountColor =
    paymentKind === 'receivable' ? 'text-emerald-600' : 'text-orange-700';

  return (
    <DetailPanelShell
      title={formatINR(payment.amount)}
      subtitle={
        <div className="flex items-center gap-2 flex-wrap">
          <span>{partyName}</span>
          {payment.payment_date && (
            <>
              <span>•</span>
              <span>{format(new Date(payment.payment_date), 'dd MMM yyyy')}</span>
            </>
          )}
        </div>
      }
      avatar={
        <div
          className={clsx(
            'w-10 h-10 rounded-full flex items-center justify-center',
            paymentKind === 'receivable' ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800'
          )}
        >
          <IndianRupee className="w-5 h-5" />
        </div>
      }
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as TabId)}
      onClose={onClose}
      moreActions={moreActions.length ? moreActions : undefined}
    >
      {activeTab === 'overview' && (
        <div className="p-4 md:p-6 space-y-4 text-sm">
          <div className={clsx('text-2xl font-bold', amountColor)}>
            {paymentKind === 'receivable' ? '+' : '−'}
            {formatINR(payment.amount)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-text-secondary text-xs">Mode</div>
              <div className="font-medium capitalize">{payment.payment_mode || '—'}</div>
            </div>
            <div>
              <div className="text-text-secondary text-xs">Type</div>
              <div className="font-medium">{paymentKind === 'receivable' ? 'Payment In' : 'Payment Out'}</div>
            </div>
          </div>
          {payment.notes && (
            <div>
              <div className="text-text-secondary text-xs mb-1">Notes</div>
              <p className="text-text-primary whitespace-pre-wrap">{payment.notes}</p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'linked' && (
        <div className="p-4 md:p-6 space-y-4 text-sm">
          {payment.reference_type && payment.reference_id ? (
            <>
              <p className="text-text-secondary">
                This payment is allocated to a{' '}
                <span className="font-medium text-text-primary">
                  {payment.reference_type === 'invoice' ? 'invoice' : 'purchase bill'}
                </span>
                .
              </p>
              <button
                type="button"
                onClick={openLinked}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-50 text-primary-700 border border-primary-200 hover:bg-slate-100"
              >
                <ExternalLink className="w-4 h-4" />
                Open document
              </button>
            </>
          ) : (
            <p className="text-text-secondary">No invoice or purchase linked (on-account payment).</p>
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
