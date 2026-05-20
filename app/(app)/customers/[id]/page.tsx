'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ArrowLeft, MessageCircle, FileText, Loader2, Edit, Calendar } from 'lucide-react';
import Link from 'next/link';
import { format, subDays, startOfDay, isBefore } from 'date-fns';
import { clsx } from 'clsx';
import { Customer } from '@/types/database';
import { DocumentList } from '@/components/documents/DocumentList';
import { DocumentUploader } from '@/components/documents/DocumentUploader';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import LeadProfileCard from '@/components/customers/LeadProfileCard';
import { CustomerPortalAccessCard } from '@/components/customers/CustomerPortalAccessCard';
import { useToastContext } from '@/contexts/ToastContext';
import { useMobileHeaderTitleOverride } from '@/contexts/MobileHeaderTitleContext';
import { CustomerLedgerView } from '@/components/customers/CustomerLedgerView';
import { customerBalanceCardTitle } from '@/lib/party-balance-ui';
import {
  csvEscape,
  customerStatementSummary,
  customerVoucherLabel,
  formatStatementDateInput,
  getDefaultCustomerStatementPeriod,
  indianFinancialYearStartIndia,
} from '@/lib/party-statement-print';

interface Transaction {
  type: 'invoice' | 'payment';
  id: string;
  ref_no: string;
  date: string;
  amount: number;
  paid_amount: number;
  balance_amount: number;
  document_type?: string | null;
}

function isProformaInvoice(tx: Transaction): boolean {
  return tx.type === 'invoice' && tx.document_type === 'proforma_invoice';
}

/** API stores payments as negative amounts (reduces receivable). Show users positive "Received" with a label. */
function transactionDisplayAmount(tx: Transaction) {
  const abs = Math.abs(Number(tx.amount));
  if (tx.type === 'invoice') {
    if (isProformaInvoice(tx)) {
      return { rupees: abs, caption: 'Estimate' as const, emphasis: 'default' as const };
    }
    return { rupees: abs, caption: 'Invoiced' as const, emphasis: 'default' as const };
  }
  return { rupees: abs, caption: 'Received' as const, emphasis: 'received' as const };
}

function formatLedgerInr(n: number) {
  return `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

type TxRangePreset = '30' | '90' | '365' | 'fy' | 'all';

const TX_RANGE_LABELS: Record<TxRangePreset, string> = {
  '30': '30 days',
  '90': '90 days',
  '365': '365 days',
  fy: 'This FY',
  all: 'All',
};

function getTxRangeStart(preset: TxRangePreset): Date | null {
  const today = new Date();
  switch (preset) {
    case '30':
      return startOfDay(subDays(today, 30));
    case '90':
      return startOfDay(subDays(today, 90));
    case '365':
      return startOfDay(subDays(today, 365));
    case 'fy':
      return startOfDay(indianFinancialYearStartIndia(today));
    case 'all':
      return null;
    default:
      return null;
  }
}

function transactionInRange(tx: Transaction, preset: TxRangePreset): boolean {
  const start = getTxRangeStart(preset);
  if (!start) return true;
  const d = startOfDay(new Date(tx.date));
  return !isBefore(d, start);
}

/** Invoice: unpaid / partial / paid. Proforma: estimate only (not AR). Payment: received. */
function transactionStatus(tx: Transaction): { label: string; tone: 'success' | 'warning' | 'error' | 'info' } {
  if (tx.type === 'payment') {
    return { label: 'Received', tone: 'success' };
  }
  if (isProformaInvoice(tx)) {
    return { label: 'Estimate', tone: 'info' };
  }
  const bal = Number(tx.balance_amount);
  const paid = Number(tx.paid_amount);
  if (bal <= 0.005) return { label: 'Paid', tone: 'success' };
  if (paid > 0.005) return { label: 'Partial', tone: 'warning' };
  return { label: 'Unpaid', tone: 'error' };
}

function statusToneClass(tone: 'success' | 'warning' | 'error' | 'info') {
  switch (tone) {
    case 'success':
      return 'bg-emerald-100 text-emerald-800';
    case 'warning':
      return 'bg-amber-100 text-amber-900';
    case 'error':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-sky-100 text-sky-900';
  }
}

export default function CustomerDetailPage({ params }: { params: { id: string } }) {
  const { business, user } = useAuth();
  const { currentBranchId, isLoading: branchLoading } = useBranch();
  const toast = useToastContext();
  const [activeTab, setActiveTab] = useState<'summary' | 'transactions' | 'ledger' | 'documents'>('summary');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalReceivable, setTotalReceivable] = useState(0);
  const [leadProfile, setLeadProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingLeadProfile, setLoadingLeadProfile] = useState(false);
  const [showDocumentUploader, setShowDocumentUploader] = useState(false);
  const [exportingStatement, setExportingStatement] = useState(false);
  const [txRangePreset, setTxRangePreset] = useState<TxRangePreset>('365');

  useMobileHeaderTitleOverride(customer?.name);

  const tabLabels: Record<typeof activeTab, string> = {
    summary: 'Overview',
    transactions: 'Transactions',
    ledger: 'Ledger',
    documents: 'History',
  };

  useEffect(() => {
    const fetchCustomerData = async () => {
      if (!user?.id) return;
      
      try {
        const res = await fetch(`/api/customers/${params.id}?user_id=${user.id}`, {
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          setCustomer(data.customer);
          setTransactions(data.transactions);
          setTotalReceivable(data.totalReceivable);
        } else {
          console.error('Failed to fetch customer:', res.status, await res.text());
        }
      } catch (error) {
        console.error('Failed to fetch customer data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCustomerData();
  }, [params.id, user?.id]);

  // Fetch lead profile if customer has phone number
  useEffect(() => {
    const fetchLeadProfile = async () => {
      if (!customer?.phone || !business?.id) return;
      
      setLoadingLeadProfile(true);
      try {
        const res = await fetch(
          `/api/whatsapp/lead-profiles?business_id=${business.id}&phone=${customer.phone}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.profile) {
            setLeadProfile(data.profile);
          }
        }
      } catch (error) {
        console.error('Failed to fetch lead profile:', error);
      } finally {
        setLoadingLeadProfile(false);
      }
    };

    fetchLeadProfile();
  }, [customer?.phone, business?.id]);

  // Ledger fetching is handled inside <CustomerLedgerView />.

  const filteredTransactions = useMemo(
    () => transactions.filter((tx) => transactionInRange(tx, txRangePreset)),
    [transactions, txRangePreset]
  );

  const transactionsPeriodLabel = useMemo(() => {
    if (filteredTransactions.length === 0) return 'No activity in this range';
    const times = filteredTransactions.map((t) => new Date(t.date).getTime());
    const min = new Date(Math.min(...times));
    const max = new Date(Math.max(...times));
    return `${format(min, 'd MMM yyyy')} – ${format(max, 'd MMM yyyy')}`;
  }, [filteredTransactions]);

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  if (!customer) {
    return (
      
        <div className="p-6 text-center">Customer not found</div>
      
    );
  }

  const lastInvoice = transactions.find(t => t.type === 'invoice');

  async function fetchStatementForExport() {
    const { from_date, to_date } = getDefaultCustomerStatementPeriod();
    const sp = new URLSearchParams({
      business_id: business!.id,
      party_id: customer!.id,
      party_type: 'customer',
      user_id: user!.id,
      from_date,
      to_date,
    });
    if (currentBranchId && currentBranchId !== 'ALL') {
      sp.set('branch_id', currentBranchId);
    }
    const res = await fetch(`/api/reports/party/statement?${sp.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      const detail = typeof data?.details === 'string' ? ` — ${data.details}` : '';
      throw new Error(
        (typeof data?.error === 'string' ? data.error : data?.message || 'Could not load statement') + detail
      );
    }
    return { data, from_date, to_date };
  }

  function buildStatementCsv(data: any, partyName: string, bizName: string, from_date: string, to_date: string) {
    const lines: string[] = [];
    lines.push([csvEscape('Business'), csvEscape(bizName)].join(','));
    lines.push([csvEscape('Customer'), csvEscape(partyName)].join(','));
    lines.push([csvEscape('Period'), csvEscape(`${data.from_date} to ${data.to_date}`)].join(','));
    lines.push([csvEscape('Opening balance'), csvEscape(data.opening_balance)].join(','));
    lines.push([csvEscape('Closing balance'), csvEscape(data.closing_balance)].join(','));
    lines.push('');
    lines.push(
      ['Date', 'Voucher', 'Reference', 'Particulars', 'Debit', 'Credit', 'Balance']
        .map((h) => csvEscape(h))
        .join(',')
    );
    const rows = Array.isArray(data.transactions) ? data.transactions : [];
    for (const t of rows) {
      lines.push(
        [
          csvEscape(formatStatementDateInput(t.transaction_date)),
          csvEscape(customerVoucherLabel(t.transaction_type)),
          csvEscape(t.reference_number),
          csvEscape(t.description),
          csvEscape(t.debit ?? ''),
          csvEscape(t.credit ?? ''),
          csvEscape(t.running_balance ?? ''),
        ].join(',')
      );
    }
    return '\uFEFF' + lines.join('\r\n');
  }

  const handleDownloadStatementCsv = async () => {
    if (!business?.id || !user?.id || !customer || branchLoading) return;
    setExportingStatement(true);
    try {
      const { data, from_date, to_date } = await fetchStatementForExport();
      const partyName = data?.party?.name || customer.name;
      const bizName = data?.business?.name || business.name || '';
      const csv = buildStatementCsv(data, partyName, bizName, from_date, to_date);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safe = partyName.replace(/[^\w\-]+/g, '_').slice(0, 48) || 'customer';
      a.href = url;
      a.download = `statement-${safe}-${from_date}_to_${to_date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('CSV downloaded');
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Could not download CSV');
    } finally {
      setExportingStatement(false);
    }
  };

  return (
    
      <div className="space-y-6">
        {/* Breadcrumbs */}
        <Breadcrumbs customLabels={{ [`/customers/${params.id}`]: customer?.name || 'Customer Details' }} />
        
        {/* Customer Header */}
        <Card padding="md">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 mb-6">
            <div className="min-w-0 w-full sm:flex-1">
              <h1 className="list-page-h1 mb-2 break-words">
                {customer.name}
              </h1>
              <p className="text-text-secondary flex items-center gap-2">
                <span>{customer.phone}</span>
              </p>
              <p className="text-text-secondary text-sm mt-1">
                {[customer.address, customer.city, customer.state].filter(Boolean).join(', ')}
              </p>
              {customer.gstin && (
                <p className="text-text-secondary text-sm mt-1">GSTIN: {customer.gstin}</p>
              )}
            </div>
            <div className="flex flex-row flex-wrap items-stretch gap-2 w-full min-w-0 sm:w-auto sm:justify-end sm:shrink-0 sm:max-w-none">
              <Link href={`/customers/${params.id}/edit`} className="min-w-0 flex-1 sm:flex-initial">
                <Button variant="ghost" size="sm" className="w-full justify-center">
                  <Edit className="w-4 h-4 mr-2 shrink-0" />
                  Edit
                </Button>
              </Link>
              <Button
                variant="secondary"
                size="sm"
                className="min-w-0 flex-1 sm:flex-initial justify-center"
                onClick={() => {
                  if (!customer.phone) {
                    toast.warning('Customer phone number not available');
                    return;
                  }
                  const message = `Hello ${customer.name},\n\nThank you for your business!`;
                  const whatsappUrl = `https://wa.me/${customer.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message)}`;
                  window.open(whatsappUrl, '_blank');
                }}
              >
                <MessageCircle className="w-4 h-4 mr-2 shrink-0" />
                WhatsApp
              </Button>
            </div>
          </div>

          {/* Stats — two columns on phone to save vertical space */}
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
            <Card
              padding="md"
              className={clsx(
                'p-4 sm:p-6 min-w-0',
                totalReceivable < -0.005
                  ? 'bg-emerald-50 border border-emerald-100'
                  : 'bg-slate-50'
              )}
            >
              <p className="text-xs sm:text-sm text-text-secondary mb-1 leading-snug">
                {customerBalanceCardTitle(totalReceivable)}
              </p>
              <p
                className={clsx(
                  'text-lg sm:text-2xl font-bold tabular-nums break-all',
                  totalReceivable < -0.005 ? 'text-emerald-900' : 'text-text-primary'
                )}
              >
                ₹ {totalReceivable.toLocaleString('en-IN')}
              </p>
              {totalReceivable < -0.005 && (
                <p className="text-[10px] sm:text-xs text-text-muted mt-1.5 sm:mt-2 leading-snug hidden sm:block">
                  Negative balance means advance or overpayment held as customer credit.
                </p>
              )}
              {totalReceivable > 0.005 && (
                <p className="text-[10px] sm:text-xs text-text-muted mt-1.5 sm:mt-2 leading-snug hidden sm:block">
                  Amount still owed on open sales (net of payments).
                </p>
              )}
            </Card>
            <Card padding="md" className="bg-accent-50 p-4 sm:p-6 min-w-0">
              <p className="text-xs sm:text-sm text-text-secondary mb-1">Last invoice</p>
              <p className="text-lg sm:text-2xl font-bold text-text-primary leading-tight">
                {lastInvoice ? format(new Date(lastInvoice.date), 'dd MMM yyyy') : 'N/A'}
              </p>
            </Card>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            {/* Pass customer_id query param to auto-select on invoice page */}
            <Link href={`/invoices/new?customer_id=${customer.id}`}>
              <Button>Create Invoice</Button>
            </Link>
            <Button variant="secondary">Receive Payment</Button>
            <Link href={`/customers/${customer.id}/statement`} className="inline-flex">
              <Button variant="ghost" type="button" disabled={branchLoading}>
                <FileText className="w-4 h-4 mr-2" />
                View statement
              </Button>
            </Link>
            <Button
              variant="ghost"
              type="button"
              disabled={exportingStatement || branchLoading}
              onClick={handleDownloadStatementCsv}
              className="text-text-secondary"
            >
              CSV
            </Button>
          </div>
        </Card>

        {/* Lead Profile Card */}
        {leadProfile && (
          <LeadProfileCard profile={leadProfile} />
        )}

        {/* Tabs */}
        <Card padding="none">
          <div className="border-b border-border overflow-x-auto">
            <div className="flex min-w-max sm:min-w-0">
              {(['summary', 'transactions', 'ledger', 'documents'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 sm:px-6 py-3 text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                    activeTab === tab
                      ? 'text-primary-500 border-b-2 border-primary-500'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {tabLabels[tab]}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 sm:p-6">
            {activeTab === 'transactions' && (
              <>
                <div className="mb-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(TX_RANGE_LABELS) as TxRangePreset[]).map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setTxRangePreset(key)}
                        className={clsx(
                          'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                          txRangePreset === key
                            ? 'bg-primary-500 border-primary-500 text-white'
                            : 'bg-white border-border text-text-secondary hover:border-primary-300'
                        )}
                      >
                        {TX_RANGE_LABELS[key]}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs text-text-muted">
                    <span>
                      <span className="font-medium text-text-secondary">In range: </span>
                      {transactionsPeriodLabel}
                    </span>
                    <span>
                      {filteredTransactions.length} of {transactions.length} loaded
                    </span>
                  </div>
                </div>

                <div className="md:hidden space-y-3">
                  {filteredTransactions.length > 0 ? (
                    filteredTransactions.map((tx) => {
                      const d = transactionDisplayAmount(tx);
                      const st = transactionStatus(tx);
                      const title =
                        tx.type === 'invoice'
                          ? isProformaInvoice(tx)
                            ? `Proforma invoice · ${tx.ref_no}`
                            : `Sales invoice · ${tx.ref_no}`
                          : `Payment-in · ${tx.ref_no}`;
                      return (
                        <div
                          key={`${tx.type}-${tx.id}`}
                          className="rounded-xl border border-border bg-white shadow-sm p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-text-primary leading-snug">{title}</p>
                              <p className="text-xs text-text-muted mt-1 flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5 shrink-0" />
                                {format(new Date(tx.date), 'd MMM yyyy')}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p
                                className={clsx(
                                  'text-lg font-bold tabular-nums',
                                  d.emphasis === 'received' ? 'text-emerald-700' : 'text-text-primary'
                                )}
                              >
                                ₹ {d.rupees.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                              </p>
                              <span
                                className={clsx(
                                  'inline-block mt-2 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                  statusToneClass(st.tone)
                                )}
                              >
                                {st.label}
                              </span>
                            </div>
                          </div>
                          {tx.type === 'invoice' && !isProformaInvoice(tx) && Number(tx.balance_amount) > 0.005 && (
                            <p className="text-[11px] text-text-muted mt-3 pt-3 border-t border-border">
                              Outstanding on document: ₹{' '}
                              {Number(tx.balance_amount).toLocaleString('en-IN', {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 2,
                              })}
                            </p>
                          )}
                          {tx.type === 'invoice' && isProformaInvoice(tx) && (
                            <p className="text-[11px] text-text-muted mt-3 pt-3 border-t border-border">
                              Estimate only — not included in account balance until issued as a tax invoice.
                            </p>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-text-secondary">
                      {transactions.length === 0
                        ? 'No transactions found.'
                        : 'No transactions in this date range.'}
                    </div>
                  )}
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <table className="table w-full min-w-[720px]">
                    <thead>
                      <tr className="table-header bg-slate-50">
                        <th className="table-cell text-left">Date</th>
                        <th className="table-cell text-left">Details</th>
                        <th className="table-cell text-left">Ref</th>
                        <th className="table-cell text-right">Amount</th>
                        <th className="table-cell text-right">Doc balance</th>
                        <th className="table-cell text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransactions.length > 0 ? (
                        filteredTransactions.map((tx) => {
                          const d = transactionDisplayAmount(tx);
                          const st = transactionStatus(tx);
                          const detailLabel =
                            tx.type === 'invoice'
                              ? isProformaInvoice(tx)
                                ? 'Proforma invoice'
                                : 'Sales invoice'
                              : 'Payment-in';
                          return (
                            <tr key={`${tx.type}-${tx.id}`} className="hover:bg-slate-50 transition-colors">
                              <td className="table-cell text-left whitespace-nowrap">
                                {format(new Date(tx.date), 'dd MMM yyyy')}
                              </td>
                              <td className="table-cell text-left text-sm">{detailLabel}</td>
                              <td className="table-cell text-left font-mono text-sm">{tx.ref_no}</td>
                              <td className="table-cell text-right">
                                <span
                                  className={
                                    d.emphasis === 'received' ? 'text-emerald-700 font-semibold' : 'font-medium'
                                  }
                                >
                                  ₹ {d.rupees.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                </span>
                                <span className="block text-[10px] text-text-muted mt-0.5">{d.caption}</span>
                              </td>
                              <td className="table-cell text-right font-medium text-text-secondary">
                                {tx.type === 'invoice'
                                  ? isProformaInvoice(tx)
                                    ? '—'
                                    : `₹ ${Number(tx.balance_amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
                                  : '—'}
                              </td>
                              <td className="table-cell text-left">
                                <span
                                  className={clsx(
                                    'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                    statusToneClass(st.tone)
                                  )}
                                >
                                  {st.label}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={6} className="text-center py-8 text-text-secondary">
                            {transactions.length === 0
                              ? 'No transactions found.'
                              : 'No transactions in this date range.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {activeTab === 'ledger' && (
              <CustomerLedgerView
                businessId={business!.id}
                userId={user!.id}
                customerId={customer.id}
                branchId={currentBranchId}
              />
            )}
            
            {activeTab === 'summary' && (
               <div className="space-y-4">
                 <div className="text-sm text-text-secondary">
                   <p>Opening Balance: ₹ {Number(customer.opening_balance).toLocaleString('en-IN')}</p>
                   <p>Credit Limit: ₹ {Number(customer.credit_limit).toLocaleString('en-IN')}</p>
                 </div>
                 <CustomerPortalAccessCard
                   customerId={customer.id}
                   customerEmail={customer.email}
                   initialEnabled={Boolean((customer as { portal_enabled?: boolean }).portal_enabled)}
                 />
               </div>
            )}

            {activeTab === 'documents' && customer && business && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-text-primary">KYC Documents</h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowDocumentUploader(!showDocumentUploader)}
                  >
                    {showDocumentUploader ? 'Hide Uploader' : 'Add Document'}
                  </Button>
                </div>
                {showDocumentUploader && (
                  <div className="mb-4">
                    <DocumentUploader
                      entityType="customer"
                      entityId={customer.id}
                      businessId={business.id}
                      onUploadSuccess={() => {
                        setShowDocumentUploader(false);
                      }}
                    />
                  </div>
                )}
                <DocumentList
                  entityType="customer"
                  entityId={customer.id}
                  businessId={business.id}
                />
              </div>
            )}
          </div>
        </Card>
      </div>
    
  );
}
