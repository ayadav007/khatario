'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  User,
  ClipboardList,
  History as HistoryIcon,
  Loader2,
  ExternalLink,
  Phone,
  Mail,
  MapPin,
  Receipt,
  FileText,
  Plus,
} from 'lucide-react';
import { clsx } from 'clsx';
import { DetailPanelShell, DetailPanelTab } from '@/components/layout/DetailPanelShell';
import { CollapsibleTransactionSection } from '@/components/layout/CollapsibleTransactionSection';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';

interface SupplierDetailPanelProps {
  supplierId: string;
  onClose: () => void;
}

type TabId = 'overview' | 'transactions' | 'history';

interface PurchaseRow {
  id: string;
  bill_number: string | null;
  bill_date: string;
  grand_total: number;
  paid_amount: number;
  status: string;
}

interface PaymentRow {
  id: string;
  amount: number;
  payment_mode: string;
  payment_date: string;
  notes: string | null;
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

export function SupplierDetailPanel({ supplierId, onClose }: SupplierDetailPanelProps) {
  const router = useRouter();
  const { user } = useAuth();
  const [supplier, setSupplier] = useState<any>(null);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [totalPayable, setTotalPayable] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchSupplier = useCallback(async () => {
    if (!supplierId || !user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/suppliers/${supplierId}?user_id=${user.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setSupplier(data.supplier);
        setPurchases(data.purchases || []);
        setPayments(data.payments || []);
        setTotalPayable(Number(data.totalPayable) || 0);
      } else {
        setSupplier(null);
      }
    } finally {
      setLoading(false);
    }
  }, [supplierId, user?.id]);

  const fetchHistory = useCallback(async () => {
    if (!user?.id || !supplierId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/suppliers/${supplierId}/history?user_id=${user.id}`, {
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
  }, [supplierId, user?.id]);

  useEffect(() => {
    setActiveTab('overview');
    setHistory(null);
    fetchSupplier();
  }, [supplierId, fetchSupplier]);

  useEffect(() => {
    if (activeTab === 'history' && history === null) {
      fetchHistory();
    }
  }, [activeTab, history, fetchHistory]);

  const tabs: DetailPanelTab[] = useMemo(
    () => [
      { id: 'overview', label: 'Overview', icon: ClipboardList },
      { id: 'transactions', label: 'Transactions', icon: Receipt },
      { id: 'history', label: 'History', icon: HistoryIcon },
    ],
    []
  );

  const defaultOpenPurchases = purchases.length > 0;
  const defaultOpenPayments = !defaultOpenPurchases && payments.length > 0;

  const newLinkClass =
    'inline-flex items-center gap-0.5 text-xs font-semibold text-primary-600 dark:text-sky-400 hover:underline';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-card">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-card p-8">
        <p className="text-text-secondary mb-4">Supplier not found</p>
        <button onClick={onClose} className="text-primary-600 hover:underline text-sm">
          Close
        </button>
      </div>
    );
  }

  const avatar = (
    <div className="w-10 h-10 rounded-full bg-slate-100 text-primary-700 flex items-center justify-center font-bold text-sm">
      {supplier.name?.charAt(0).toUpperCase() || <User className="w-5 h-5" />}
    </div>
  );

  const moreActions: NonNullable<React.ComponentProps<typeof DetailPanelShell>['moreActions']> = [
    {
      label: 'Open full page',
      icon: ExternalLink,
      onClick: () => router.push(`/suppliers/${supplierId}`),
    },
  ];

  return (
    <DetailPanelShell
      title={supplier.name}
      subtitle={
        <div className="flex items-center gap-2 flex-wrap">
          {supplier.phone && <span>{supplier.phone}</span>}
          {supplier.phone && supplier.gstin && <span>•</span>}
          {supplier.gstin && <span className="font-mono text-xs">{supplier.gstin}</span>}
        </div>
      }
      avatar={avatar}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as TabId)}
      onClose={onClose}
      onEdit={() => router.push(`/suppliers/new?edit=${supplierId}`)}
      moreActions={moreActions}
    >
      {activeTab === 'overview' && (
        <div className="p-4 md:p-6 space-y-6">
          <section
            className={clsx(
              'p-4 rounded-lg border',
              totalPayable > 0
                ? 'bg-orange-50 border-orange-200'
                : 'bg-gray-50 border-border text-text-secondary'
            )}
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Total payable (unpaid bills)
            </div>
            <div
              className={clsx(
                'text-2xl font-bold mt-1',
                totalPayable > 0 ? 'text-orange-800' : 'text-text-muted'
              )}
            >
              {formatINR(totalPayable)}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-text-primary mb-3">Primary Details</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <FieldRow label="Name" value={supplier.name} />
              {supplier.phone && (
                <FieldRow
                  label="Phone"
                  value={
                    <a href={`tel:${supplier.phone}`} className="text-primary-600 hover:underline inline-flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {supplier.phone}
                    </a>
                  }
                />
              )}
              {supplier.email && (
                <FieldRow
                  label="Email"
                  value={
                    <a
                      href={`mailto:${supplier.email}`}
                      className="text-primary-600 hover:underline inline-flex items-center gap-1 break-all"
                    >
                      <Mail className="w-3 h-3 shrink-0" />
                      {supplier.email}
                    </a>
                  }
                />
              )}
              {supplier.gstin && (
                <FieldRow label="GSTIN" value={<span className="font-mono">{supplier.gstin}</span>} />
              )}
              <FieldRow
                label="Opening Balance"
                value={`${formatINR(supplier.opening_balance)} (${supplier.opening_balance_type})`}
              />
            </div>
          </section>

          {(supplier.address || supplier.city || supplier.state) && (
            <section>
              <h3 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                Address
              </h3>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">
                {supplier.address || '-'}
                {(supplier.city || supplier.state || supplier.pincode) && (
                  <>
                    {'\n'}
                    {[supplier.city, supplier.state, supplier.pincode].filter(Boolean).join(', ')}
                  </>
                )}
              </p>
            </section>
          )}

          {supplier.notes && (
            <section>
              <h3 className="text-sm font-semibold text-text-primary mb-2">Notes</h3>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{supplier.notes}</p>
            </section>
          )}
        </div>
      )}

      {activeTab === 'transactions' && (
        <div className="p-4 md:p-6 space-y-3">
          {purchases.length === 0 && payments.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <FileText className="w-10 h-10 mx-auto text-text-muted mb-3" />
              <p>No purchases or payments yet.</p>
            </div>
          ) : (
            <>
              <CollapsibleTransactionSection
                key={`${supplierId}-purchases`}
                title="Purchases"
                count={purchases.length}
                defaultOpen={defaultOpenPurchases}
                headerRight={
                  <Link href="/purchases/new" className={newLinkClass} prefetch={false}>
                    <Plus className="w-3.5 h-3.5" />
                    New
                  </Link>
                }
              >
                {purchases.length === 0 ? (
                  <p className="text-sm text-text-secondary px-3 py-4">No purchase bills for this supplier.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-gray-50/80 dark:bg-slate-800/50 text-[10px] uppercase tracking-wide text-text-muted">
                        <tr>
                          <th className="text-left py-2 px-3 font-semibold">Date</th>
                          <th className="text-left py-2 px-3 font-semibold">Bill #</th>
                          <th className="text-right py-2 px-3 font-semibold">Amount</th>
                          <th className="text-right py-2 px-3 font-semibold">Balance due</th>
                          <th className="text-center py-2 px-3 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {purchases.map((p) => {
                          const balance = Math.max(
                            0,
                            Number(p.grand_total || 0) - Number(p.paid_amount || 0)
                          );
                          return (
                            <tr
                              key={p.id}
                              className="border-b border-border last:border-0 hover:bg-slate-50/30 cursor-pointer"
                              onClick={() => router.push(`/purchases/${p.id}`)}
                            >
                              <td className="py-2 px-3 text-text-secondary whitespace-nowrap">
                                {p.bill_date ? format(new Date(p.bill_date), 'dd MMM yyyy') : '—'}
                              </td>
                              <td className="py-2 px-3 font-medium text-primary-600 dark:text-sky-400">
                                {p.bill_number || '—'}
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-text-primary">
                                {formatINR(p.grand_total)}
                              </td>
                              <td className="py-2 px-3 text-right text-text-secondary">{formatINR(balance)}</td>
                              <td className="py-2 px-3 text-center">
                                <StatusBadge status={p.status} showIcon={false} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CollapsibleTransactionSection>

              <CollapsibleTransactionSection
                key={`${supplierId}-payments`}
                title="Vendor payments"
                count={payments.length}
                defaultOpen={defaultOpenPayments}
                headerRight={
                  <Link href="/payments/out" className={newLinkClass} prefetch={false}>
                    <Plus className="w-3.5 h-3.5" />
                    New
                  </Link>
                }
              >
                {payments.length === 0 ? (
                  <p className="text-sm text-text-secondary px-3 py-4">No payments recorded.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-gray-50/80 dark:bg-slate-800/50 text-[10px] uppercase tracking-wide text-text-muted">
                        <tr>
                          <th className="text-left py-2 px-3 font-semibold">Date</th>
                          <th className="text-left py-2 px-3 font-semibold">Reference</th>
                          <th className="text-left py-2 px-3 font-semibold">Mode</th>
                          <th className="text-right py-2 px-3 font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p) => (
                          <tr key={p.id} className="border-b border-border last:border-0">
                            <td className="py-2 px-3 text-text-secondary whitespace-nowrap">
                              {p.payment_date ? format(new Date(p.payment_date), 'dd MMM yyyy') : '—'}
                            </td>
                            <td className="py-2 px-3 font-medium text-text-primary">
                              PAY-{p.id.slice(0, 8)}
                            </td>
                            <td className="py-2 px-3 text-text-secondary capitalize">
                              {p.payment_mode || '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                              {formatINR(p.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CollapsibleTransactionSection>
            </>
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
                  <span
                    className={clsx(
                      'absolute -left-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-surface dark:border-surface-dark',
                      'bg-gray-400'
                    )}
                  />
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

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <div className="text-text-secondary text-xs md:text-sm">{label}</div>
      <div className="text-text-primary font-medium break-words">{value}</div>
    </>
  );
}
