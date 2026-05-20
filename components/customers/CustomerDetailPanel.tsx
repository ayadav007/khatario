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
  FileText,
  MessageCircle,
  Mail,
  Phone,
  MapPin,
  Receipt,
  Plus,
} from 'lucide-react';
import { clsx } from 'clsx';
import { DetailPanelShell, DetailPanelTab } from '@/components/layout/DetailPanelShell';
import { CollapsibleTransactionSection } from '@/components/layout/CollapsibleTransactionSection';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import {
  customerBalanceHint,
  isPartyBalanceSettled,
  PARTY_BALANCE_COLUMN_HEADER,
} from '@/lib/party-balance-ui';
import { CustomerPortalAccessCard } from '@/components/customers/CustomerPortalAccessCard';
import { CustomerLedgerView } from '@/components/customers/CustomerLedgerView';

interface CustomerDetailPanelProps {
  customerId: string;
  onClose: () => void;
  onSendReminder?: (customer: any) => void;
  sendingReminder?: boolean;
}

type TabId = 'overview' | 'transactions' | 'ledger' | 'history';

interface Transaction {
  type: 'invoice' | 'payment';
  id: string;
  ref_no: string;
  date: string;
  amount: number;
  paid_amount: number;
  balance_amount: number;
  document_type?: string | null;
  status?: string | null;
  payment_status?: string | null;
  estimate_status?: string | null;
  payment_mode?: string | null;
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

export function CustomerDetailPanel({
  customerId,
  onClose,
  onSendReminder,
  sendingReminder,
}: CustomerDetailPanelProps) {
  const router = useRouter();
  const { business, user } = useAuth();
  const [customer, setCustomer] = useState<any>(null);
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [totalReceivable, setTotalReceivable] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchCustomer = useCallback(async () => {
    if (!customerId || !user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/customers/${customerId}?user_id=${user.id}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setCustomer(data.customer);
        setTransactions(data.transactions || []);
        setTotalReceivable(Number(data.totalReceivable) || 0);
      } else {
        setCustomer(null);
      }
    } finally {
      setLoading(false);
    }
  }, [customerId, user?.id]);

  const fetchHistory = useCallback(async () => {
    if (!user?.id || !customerId) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `/api/customers/${customerId}/history?user_id=${user.id}`,
        { credentials: 'include' }
      );
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      } else {
        setHistory([]);
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [customerId, user?.id]);

  useEffect(() => {
    setActiveTab('overview');
    setTransactions(null);
    setHistory(null);
    fetchCustomer();
  }, [customerId, fetchCustomer]);

  useEffect(() => {
    if (activeTab === 'history' && history === null) {
      fetchHistory();
    }
  }, [activeTab, history, fetchHistory]);

  const tabs: DetailPanelTab[] = useMemo(
    () => [
      { id: 'overview', label: 'Overview', icon: ClipboardList },
      { id: 'transactions', label: 'Transactions', icon: Receipt },
      { id: 'ledger', label: 'Ledger', icon: FileText },
      { id: 'history', label: 'History', icon: HistoryIcon },
    ],
    []
  );

  const { invoiceRows, estimateRows, paymentRows } = useMemo(() => {
    const list = transactions ?? [];
    return {
      invoiceRows: list.filter(
        (t) => t.type === 'invoice' && t.document_type !== 'proforma_invoice'
      ),
      estimateRows: list.filter(
        (t) => t.type === 'invoice' && t.document_type === 'proforma_invoice'
      ),
      paymentRows: list.filter((t) => t.type === 'payment'),
    };
  }, [transactions]);

  const defaultOpenInvoices = invoiceRows.length > 0;
  const defaultOpenEstimates = !defaultOpenInvoices && estimateRows.length > 0;
  const defaultOpenPayments =
    !defaultOpenInvoices && !defaultOpenEstimates && paymentRows.length > 0;

  const newLinkClass =
    'inline-flex items-center gap-0.5 text-xs font-semibold text-primary-600 dark:text-sky-400 hover:underline';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-card">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-surface dark:bg-surface-dark border border-border dark:border-border-dark rounded-card p-8">
        <p className="text-text-secondary mb-4">Customer not found</p>
        <button onClick={onClose} className="text-primary-600 dark:text-sky-400 hover:underline text-sm dark:hover:text-sky-300">
          Close
        </button>
      </div>
    );
  }

  const balance = Number(customer.current_balance ?? customer.opening_balance ?? 0);
  const isSettled = isPartyBalanceSettled(balance);

  const avatar = (
    <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800/50 text-primary-700 dark:text-primary-200 flex items-center justify-center font-bold text-sm">
      {customer.name?.charAt(0).toUpperCase() || <User className="w-5 h-5" />}
    </div>
  );

  const moreActions: NonNullable<React.ComponentProps<typeof DetailPanelShell>['moreActions']> = [];
  moreActions.push({
    label: 'Open full page',
    icon: ExternalLink,
    onClick: () => router.push(`/customers/${customerId}`),
  });
  moreActions.push({
    label: 'View statement',
    icon: FileText,
    onClick: () => router.push(`/customers/${customerId}/statement`),
  });
  if (onSendReminder && balance > 0 && customer.phone) {
    moreActions.push({
      label: sendingReminder ? 'Sending...' : 'Send WhatsApp reminder',
      icon: MessageCircle,
      onClick: () => onSendReminder(customer),
    });
  }

  return (
    <DetailPanelShell
      title={customer.name}
      subtitle={
        <div className="flex items-center gap-2 flex-wrap">
          {customer.company_name && <span>{customer.company_name}</span>}
          {customer.company_name && customer.phone && <span>•</span>}
          {customer.phone && <span>{customer.phone}</span>}
        </div>
      }
      avatar={avatar}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as TabId)}
      onClose={onClose}
      onEdit={() => router.push(`/customers/${customerId}/edit`)}
      moreActions={moreActions}
    >
      {activeTab === 'overview' && (
        <div className="p-4 md:p-6 space-y-6">
          {/* Balance summary */}
          <section
            className={clsx(
              'p-4 rounded-lg border',
              isSettled
                ? 'bg-slate-100 dark:bg-slate-800/90 border-slate-200 dark:border-slate-600'
                : balance > 0
                ? 'bg-amber-50 dark:bg-amber-950/35 border-amber-200 dark:border-amber-800'
                : 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-800'
            )}
          >
            <div
              className={clsx(
                'text-xs font-semibold uppercase tracking-wide',
                isSettled ? 'text-slate-600 dark:text-slate-300' : 'text-text-secondary'
              )}
            >
              {PARTY_BALANCE_COLUMN_HEADER}
            </div>
            <div
              className={clsx(
                'text-2xl font-bold mt-1',
                balance > 0
                  ? 'text-amber-700 dark:text-amber-300'
                  : balance < 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : isSettled
                  ? 'text-slate-900 dark:text-slate-100'
                  : 'text-text-muted'
              )}
            >
              {formatINR(balance)}
            </div>
            <div
              className={clsx(
                'text-xs mt-1',
                isSettled ? 'text-slate-600 dark:text-slate-400' : 'text-text-secondary'
              )}
            >
              {customerBalanceHint(balance)}
            </div>
            {totalReceivable !== 0 && !isSettled && (
              <div className="text-xs text-text-secondary mt-1">
                Total receivable: {formatINR(totalReceivable)}
              </div>
            )}
          </section>

          {/* Primary details */}
          <section>
            <h3 className="text-sm font-semibold text-text-primary mb-3">Primary Details</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <FieldRow label="Name" value={customer.name} />
              {customer.company_name && (
                <FieldRow label="Company" value={customer.company_name} />
              )}
              {customer.phone && (
                <FieldRow
                  label="Phone"
                  value={
                    <a
                      href={`tel:${customer.phone}`}
                      className="text-primary-600 dark:text-sky-400 hover:text-primary-700 dark:hover:text-sky-300 hover:underline inline-flex items-center gap-1"
                    >
                      <Phone className="w-3 h-3" />
                      {customer.phone}
                    </a>
                  }
                />
              )}
              {customer.email && (
                <FieldRow
                  label="Email"
                  value={
                    <a
                      href={`mailto:${customer.email}`}
                      className="text-primary-600 dark:text-sky-400 hover:text-primary-700 dark:hover:text-sky-300 hover:underline inline-flex items-center gap-1 break-all"
                    >
                      <Mail className="w-3 h-3 shrink-0" />
                      {customer.email}
                    </a>
                  }
                />
              )}
              {customer.gstin && <FieldRow label="GSTIN" value={<span className="font-mono">{customer.gstin}</span>} />}
              {customer.credit_limit > 0 && (
                <FieldRow label="Credit Limit" value={formatINR(customer.credit_limit)} />
              )}
              <FieldRow
                label="Opening Balance"
                value={`${formatINR(customer.opening_balance)} (${customer.opening_balance_type})`}
              />
            </div>
          </section>

          <CustomerPortalAccessCard
            customerId={customer.id}
            customerEmail={customer.email}
            initialEnabled={Boolean(customer.portal_enabled)}
          />

          {/* Address */}
          {(customer.billing_address || customer.address || customer.city || customer.state) && (
            <section>
              <h3 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                Billing Address
              </h3>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">
                {customer.billing_address || customer.address || '-'}
                {(customer.city || customer.state || customer.pincode) && (
                  <>
                    {'\n'}
                    {[customer.city, customer.state, customer.pincode].filter(Boolean).join(', ')}
                  </>
                )}
              </p>
            </section>
          )}

          {/* Shipping address if different */}
          {customer.shipping_address && customer.shipping_address !== customer.billing_address && (
            <section>
              <h3 className="text-sm font-semibold text-text-primary mb-2 flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                Shipping Address
              </h3>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">
                {customer.shipping_address}
                {(customer.shipping_city || customer.shipping_state || customer.shipping_pincode) && (
                  <>
                    {'\n'}
                    {[customer.shipping_city, customer.shipping_state, customer.shipping_pincode]
                      .filter(Boolean)
                      .join(', ')}
                  </>
                )}
              </p>
            </section>
          )}

          {/* Notes */}
          {customer.notes && (
            <section>
              <h3 className="text-sm font-semibold text-text-primary mb-2">Notes</h3>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{customer.notes}</p>
            </section>
          )}

          {/* Tags */}
          {Array.isArray(customer.tags) && customer.tags.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-text-primary mb-2">Tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {customer.tags.map((tag: string) => (
                  <span
                    key={tag}
                    className="text-xs bg-slate-50 dark:bg-primary-900/45 text-primary-700 dark:text-primary-200 border border-primary-200 dark:border-primary-700 px-2 py-0.5 rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {activeTab === 'transactions' && (
        <div className="p-4 md:p-6 space-y-3">
          {transactions && transactions.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <FileText className="w-10 h-10 mx-auto text-text-muted mb-3" />
              <p>No transactions yet.</p>
            </div>
          ) : (
            <>
              <CollapsibleTransactionSection
                key={`${customerId}-invoices`}
                title="Invoices"
                count={invoiceRows.length}
                defaultOpen={defaultOpenInvoices}
                headerRight={
                  <Link href={`/invoices/new?customer_id=${customerId}`} className={newLinkClass} prefetch={false}>
                    <Plus className="w-3.5 h-3.5" />
                    New
                  </Link>
                }
              >
                {invoiceRows.length === 0 ? (
                  <p className="text-sm text-text-secondary px-3 py-4">No invoices for this customer.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-gray-50/80 dark:bg-slate-800/50 text-[10px] uppercase tracking-wide text-text-muted">
                        <tr>
                          <th className="text-left py-2 px-3 font-semibold">Date</th>
                          <th className="text-left py-2 px-3 font-semibold">Invoice #</th>
                          <th className="text-right py-2 px-3 font-semibold">Amount</th>
                          <th className="text-right py-2 px-3 font-semibold">Balance due</th>
                          <th className="text-center py-2 px-3 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoiceRows.map((tx) => (
                          <tr
                            key={tx.id}
                            className="border-b border-border last:border-0 hover:bg-slate-50/30 dark:hover:bg-slate-800/70 cursor-pointer"
                            onClick={() => router.push(`/invoices/${tx.id}`)}
                          >
                            <td className="py-2 px-3 text-text-secondary whitespace-nowrap">
                              {tx.date ? format(new Date(tx.date), 'dd MMM yyyy') : '—'}
                            </td>
                            <td className="py-2 px-3 font-medium text-primary-600 dark:text-sky-400">
                              {tx.ref_no}
                            </td>
                            <td className="py-2 px-3 text-right font-semibold text-text-primary">
                              {formatINR(tx.amount)}
                            </td>
                            <td className="py-2 px-3 text-right text-text-secondary">
                              {formatINR(tx.balance_amount)}
                            </td>
                            <td className="py-2 px-3 text-center">
                              <StatusBadge
                                status={
                                  tx.status === 'cancelled'
                                    ? 'cancelled'
                                    : tx.status === 'draft'
                                      ? 'draft'
                                      : tx.payment_status || 'unpaid'
                                }
                                showIcon={false}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CollapsibleTransactionSection>

              <CollapsibleTransactionSection
                key={`${customerId}-estimates`}
                title="Quotes & estimates"
                count={estimateRows.length}
                defaultOpen={defaultOpenEstimates}
                headerRight={
                  <Link
                    href={`/invoices/new?type=proforma_invoice&customer_id=${customerId}`}
                    className={newLinkClass}
                    prefetch={false}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New
                  </Link>
                }
              >
                {estimateRows.length === 0 ? (
                  <p className="text-sm text-text-secondary px-3 py-4">No estimates for this customer.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-gray-50/80 dark:bg-slate-800/50 text-[10px] uppercase tracking-wide text-text-muted">
                        <tr>
                          <th className="text-left py-2 px-3 font-semibold">Date</th>
                          <th className="text-left py-2 px-3 font-semibold">Number</th>
                          <th className="text-right py-2 px-3 font-semibold">Amount</th>
                          <th className="text-right py-2 px-3 font-semibold">Balance</th>
                          <th className="text-center py-2 px-3 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estimateRows.map((tx) => (
                          <tr
                            key={tx.id}
                            className="border-b border-border last:border-0 hover:bg-slate-50/30 dark:hover:bg-slate-800/70 cursor-pointer"
                            onClick={() => router.push(`/invoices/${tx.id}`)}
                          >
                            <td className="py-2 px-3 text-text-secondary whitespace-nowrap">
                              {tx.date ? format(new Date(tx.date), 'dd MMM yyyy') : '—'}
                            </td>
                            <td className="py-2 px-3 font-medium text-primary-600 dark:text-sky-400">
                              {tx.ref_no}
                            </td>
                            <td className="py-2 px-3 text-right font-semibold text-text-primary">
                              {formatINR(tx.amount)}
                            </td>
                            <td className="py-2 px-3 text-right text-text-secondary">
                              {formatINR(tx.balance_amount)}
                            </td>
                            <td className="py-2 px-3 text-center">
                              {tx.estimate_status ? (
                                <StatusBadge status={tx.estimate_status} showIcon={false} />
                              ) : (
                                <StatusBadge status={tx.status || 'draft'} showIcon={false} />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CollapsibleTransactionSection>

              <CollapsibleTransactionSection
                key={`${customerId}-payments`}
                title="Customer payments"
                count={paymentRows.length}
                defaultOpen={defaultOpenPayments}
                headerRight={
                  <Link href="/payments/in" className={newLinkClass} prefetch={false}>
                    <Plus className="w-3.5 h-3.5" />
                    New
                  </Link>
                }
              >
                {paymentRows.length === 0 ? (
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
                        {paymentRows.map((tx) => (
                          <tr key={tx.id} className="border-b border-border last:border-0">
                            <td className="py-2 px-3 text-text-secondary whitespace-nowrap">
                              {tx.date ? format(new Date(tx.date), 'dd MMM yyyy') : '—'}
                            </td>
                            <td className="py-2 px-3 font-medium text-text-primary">{tx.ref_no}</td>
                            <td className="py-2 px-3 text-text-secondary capitalize">
                              {tx.payment_mode || '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-semibold text-emerald-700 dark:text-emerald-400">
                              {formatINR(Math.abs(Number(tx.amount)))}
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
                      actionDotColor(h.action_type)
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

      {activeTab === 'ledger' && business?.id && user?.id ? (
        <div className="p-4 md:p-6">
          <CustomerLedgerView
            businessId={business.id}
            userId={user.id}
            customerId={customerId}
          />
        </div>
      ) : null}
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

function actionDotColor(action: string): string {
  switch (action) {
    case 'create':
      return 'bg-green-500';
    case 'update':
      return 'bg-primary-500';
    case 'delete':
      return 'bg-red-500';
    case 'approve':
      return 'bg-emerald-500';
    case 'reject':
      return 'bg-orange-500';
    default:
      return 'bg-gray-400';
  }
}
