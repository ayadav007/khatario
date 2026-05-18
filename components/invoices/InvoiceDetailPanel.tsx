'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ClipboardList,
  History as HistoryIcon,
  Loader2,
  ExternalLink,
  Receipt,
  FileText,
} from 'lucide-react';
import { clsx } from 'clsx';
import { DetailPanelShell, DetailPanelTab } from '@/components/layout/DetailPanelShell';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { deriveInvoicePaymentStatus } from '@/lib/invoice-payment-status';

interface InvoiceDetailPanelProps {
  invoiceId: string;
  onClose: () => void;
}

type TabId = 'overview' | 'transactions' | 'history';

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

export function InvoiceDetailPanel({ invoiceId, onClose }: InvoiceDetailPanelProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [invoice, setInvoice] = useState<any>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchInvoice = useCallback(async () => {
    if (!invoiceId || !user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}?user_id=${user.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setInvoice(data.invoice);
        setPayments(data.invoice?.payments || []);
      } else {
        setInvoice(null);
      }
    } finally {
      setLoading(false);
    }
  }, [invoiceId, user?.id]);

  const fetchHistory = useCallback(async () => {
    if (!user?.id || !invoiceId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/history?user_id=${user.id}`, {
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
  }, [invoiceId, user?.id]);

  useEffect(() => {
    setActiveTab('overview');
    setHistory(null);
    fetchInvoice();
  }, [invoiceId, fetchInvoice]);

  useEffect(() => {
    if (activeTab === 'history' && history === null) {
      fetchHistory();
    }
  }, [activeTab, history, fetchHistory]);

  const tabs: DetailPanelTab[] = useMemo(
    () => [
      { id: 'overview', label: 'Overview', icon: ClipboardList },
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

  if (!invoice) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-card p-8">
        <p className="text-text-secondary mb-4">Invoice not found</p>
        <button onClick={onClose} className="text-primary-600 hover:underline text-sm">
          Close
        </button>
      </div>
    );
  }

  const grand = Number(invoice.grand_total) || 0;
  const paid = Number(invoice.paid_amount) || 0;
  const balance = Number(invoice.balance_amount ?? grand - paid) || 0;
  const paymentStatusForBadge =
    invoice.status === 'cancelled'
      ? invoice.payment_status || 'unpaid'
      : deriveInvoicePaymentStatus(invoice.grand_total, invoice.paid_amount, invoice.balance_amount ?? balance);

  const moreActions: NonNullable<React.ComponentProps<typeof DetailPanelShell>['moreActions']> = [
    {
      label: 'Open full page',
      icon: ExternalLink,
      onClick: () => router.push(`/invoices/${invoiceId}`),
    },
  ];

  return (
    <DetailPanelShell
      title={invoice.invoice_number || 'Invoice'}
      subtitle={
        <div className="flex items-center gap-2 flex-wrap">
          {invoice.customer_name && <span>{invoice.customer_name}</span>}
          {invoice.invoice_date && (
            <>
              {invoice.customer_name && <span>•</span>}
              <span>{format(new Date(invoice.invoice_date), 'dd MMM yyyy')}</span>
            </>
          )}
        </div>
      }
      avatar={
        <div className="w-10 h-10 rounded-lg bg-slate-100 text-primary-700 flex items-center justify-center">
          <FileText className="w-5 h-5" />
        </div>
      }
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as TabId)}
      onClose={onClose}
      onEdit={() => router.push(`/invoices/${invoiceId}`)}
      moreActions={moreActions}
    >
      {activeTab === 'overview' && (
        <div className="p-4 md:p-6 space-y-6">
          <section className="flex flex-wrap gap-2">
            <StatusBadge status={invoice.status} />
            <StatusBadge status={paymentStatusForBadge || 'unpaid'} />
          </section>

          <section className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-text-secondary text-xs">Grand Total</div>
              <div className="font-semibold text-lg text-text-primary">{formatINR(grand)}</div>
            </div>
            <div>
              <div className="text-text-secondary text-xs">Balance</div>
              <div className={clsx('font-semibold text-lg', balance > 0 ? 'text-amber-700' : 'text-emerald-700')}>
                {formatINR(balance)}
              </div>
            </div>
            <div>
              <div className="text-text-secondary text-xs">Paid</div>
              <div className="font-medium text-text-primary">{formatINR(paid)}</div>
            </div>
            {invoice.document_type && (
              <div>
                <div className="text-text-secondary text-xs">Document</div>
                <div className="font-medium text-text-primary capitalize">
                  {String(invoice.document_type).replace(/_/g, ' ')}
                </div>
              </div>
            )}
          </section>

          {invoice.customer_phone && (
            <section className="text-sm">
              <span className="text-text-secondary">Phone: </span>
              <span className="text-text-primary">{invoice.customer_phone}</span>
            </section>
          )}
        </div>
      )}

      {activeTab === 'transactions' && (
        <div className="p-4 md:p-6">
          {payments.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <Receipt className="w-10 h-10 mx-auto text-text-muted mb-3" />
              <p>No payments recorded for this invoice.</p>
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
