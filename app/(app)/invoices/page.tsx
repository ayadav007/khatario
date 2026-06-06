'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Search, Plus, Share2, Eye, Loader2, CreditCard, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { format } from 'date-fns';
import { ShareInvoiceModal } from '@/components/modals/ShareInvoiceModal';
import { ShareInvoiceFormatSheet } from '@/components/invoices/ShareInvoiceFormatSheet';
import { canUseNativeInvoiceShare } from '@/lib/share-invoice';
import { RecordPaymentModal } from '@/components/modals/RecordPaymentModal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { SyncStatusBadge } from '@/components/ui/SyncStatusBadge';
import { GSTStatusIndicator } from '@/components/ui/GSTStatusIndicator';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { useEntityList } from '@/hooks/useEntityList';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { SplitPaneLayout } from '@/components/layout/SplitPaneLayout';
import { InvoiceDetailPanel } from '@/components/invoices/InvoiceDetailPanel';
import { clsx } from 'clsx';
import { SubscriptionUsageBanner } from '@/components/subscription/SubscriptionUsageBanner';

type InvoiceStatusFilter = 'all' | 'draft' | 'final' | 'paid' | 'unpaid' | 'cancelled';

const INVOICE_STATUS_FILTERS: Array<{ value: InvoiceStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'final', label: 'Final' },
  { value: 'paid', label: 'Paid' },
  { value: 'unpaid', label: 'Unpaid' },
];

function InvoicesPageContent() {
  const searchParams = useSearchParams();
  const { business, user, isPrimaryAdmin } = useAuth();
  const { currentBranchId, isLoading: branchLoading } = useBranch();
  const [shareModalInvoice, setShareModalInvoice] = useState<any>(null);
  const [shareFormatInvoice, setShareFormatInvoice] = useState<any>(null);
  const [paymentModalInvoice, setPaymentModalInvoice] = useState<any>(null);

  const openShareForInvoice = (invoice: {
    id: string;
    invoice_number: string;
    customer_email?: string;
    customer_phone?: string;
  }) => {
    if (canUseNativeInvoiceShare()) {
      setShareFormatInvoice(invoice);
    } else {
      setShareModalInvoice(invoice);
    }
  };

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>(() => {
    const s = searchParams.get('status');
    if (s && ['draft', 'final', 'paid', 'unpaid', 'cancelled'].includes(s)) {
      return s as InvoiceStatusFilter;
    }
    return 'all';
  });
  const [page, setPage] = useState(1);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);

  const formatInr = (value: unknown) => {
    const n = Number(value);
    if (Number.isNaN(n)) return '₹ 0';
    return `₹ ${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;
  };

  /**
   * Pass status to the API when not "all" so drafts/finals/etc. are not missed:
   * without this, only the latest N rows are fetched (by date) and client-side draft filter can show nothing.
   * Only primary admin may use branch_id=ALL in params.
   */
  const invoiceQueryParams = useMemo(() => {
    const p: Record<string, string | number> = { limit: 100 };
    const branch = searchParams.get('branch_id');
    if (isPrimaryAdmin && (branch === 'ALL' || branch === 'all')) {
      p.branch_id = 'ALL';
    }
    if (
      statusFilter !== 'all' &&
      ['draft', 'final', 'paid', 'unpaid', 'cancelled'].includes(statusFilter)
    ) {
      p.status = statusFilter;
    }
    return p;
  }, [searchParams, isPrimaryAdmin, statusFilter]);

  const scopeAllBranches =
    isPrimaryAdmin &&
    (searchParams.get('branch_id') === 'ALL' || searchParams.get('branch_id') === 'all');

  const { data: allInvoices, loading, syncing, error, refresh } = useEntityList<any>({
    apiUrl: '/api/invoices',
    businessId: business?.id ?? null,
    userId: user?.id ?? null,
    queryParams: invoiceQueryParams,
    responseKey: 'invoices',
  });

  // Sync filters from URL (e.g. ?status=draft&branch_id=ALL from dashboard pending actions)
  useEffect(() => {
    const urlStatus = searchParams.get('status');
    if (urlStatus) setStatusFilter(urlStatus as any);
  }, [searchParams]);

  // In-memory filtering (works offline): search, status, aging, date
  const filteredInvoices = useMemo(() => {
    let list = allInvoices.filter((i) => i.status !== 'cancelled' && i.document_type !== 'proforma_invoice');
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (i) =>
          (i.invoice_number && i.invoice_number.toLowerCase().includes(q)) ||
          (i.customer_name && i.customer_name.toLowerCase().includes(q))
      );
    }
    if (statusFilter !== 'all') {
      list = list.filter((invoice) => {
        if (statusFilter === 'draft') return invoice.status === 'draft';
        if (statusFilter === 'final') return invoice.status === 'final';
        if (statusFilter === 'cancelled') return invoice.status === 'cancelled';
        if (statusFilter === 'paid') return invoice.payment_status === 'paid';
        if (statusFilter === 'unpaid') return invoice.payment_status === 'unpaid';
        return true;
      });
    }
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const agingMin = urlParams.get('aging_days_min');
      const agingMax = urlParams.get('aging_days_max');
      const dateFrom = urlParams.get('date_from');
      const dateTo = urlParams.get('date_to');
      if (agingMin || agingMax || dateFrom || dateTo) {
        list = list.filter((inv) => {
          const daysOverdue = inv.days_overdue ?? 0;
          const invDate = inv.invoice_date ? new Date(inv.invoice_date) : null;
          if (agingMin && daysOverdue < parseInt(agingMin, 10)) return false;
          if (agingMax && daysOverdue > parseInt(agingMax, 10)) return false;
          if (dateFrom && invDate && invDate < new Date(dateFrom)) return false;
          if (dateTo && invDate && invDate > new Date(dateTo)) return false;
          return true;
        });
      }
    }
    return list;
  }, [allInvoices, search, statusFilter]);

  const paginatedInvoices = useMemo(() => {
    const start = (page - 1) * 25;
    return filteredInvoices.slice(start, start + 25);
  }, [filteredInvoices, page]);

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / 25));

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    if (selectedInvoiceId && !allInvoices.some((i) => i.id === selectedInvoiceId)) {
      setSelectedInvoiceId(null);
    }
  }, [allInvoices, selectedInvoiceId]);

  // Re-sync when branch changes (list is branch-scoped from storage). Skip when URL forces all branches.
  useEffect(() => {
    if (scopeAllBranches) return;
    if (business?.id && currentBranchId && !syncing) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, currentBranchId, scopeAllBranches]);

  const handlePaymentSuccess = () => {
    refresh();
    setPaymentModalInvoice(null);
  };

  // Authorization guard
  const { status: authStatus } = useAuthorizationGuard({
    resource: 'invoices',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  if (authStatus === 'loading' || (branchLoading && !business?.id)) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (authStatus === 'denied') {
    return <AccessDenied module="invoices" action="view" />;
  }

  const isDetailOpen = selectedInvoiceId !== null;

  const toolbar = (
    <>
      <Card padding="md" className="hidden md:block mb-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search invoice number or customer"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10 w-full"
            />
          </div>
          <div className="flex gap-2">
            <select
              className="input w-auto text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="final">Final</option>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </Card>
      <div className="md:hidden relative mb-3">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Number or customer"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-10 w-full h-12 rounded-xl"
        />
      </div>
    </>
  );

  const compactList = (
    <Card padding="none" className="overflow-hidden h-full flex flex-col">
      <div className="p-3 border-b border-border relative">
        <Search className="absolute left-5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search invoices"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-9 h-9 text-sm w-full"
        />
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
          </div>
        ) : paginatedInvoices.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-secondary">No invoices</div>
        ) : (
          paginatedInvoices.map((invoice) => {
            const sel = invoice.id === selectedInvoiceId;
            return (
              <button
                key={invoice.id}
                type="button"
                onClick={() => setSelectedInvoiceId(invoice.id)}
                className={clsx(
                  'w-full text-left p-3 flex flex-col gap-1 border-l-[3px] transition-all duration-150 ease-out',
                  sel
                    ? 'bg-slate-50 dark:bg-slate-700 border-primary-500 text-text-primary dark:text-white hover:bg-slate-100 dark:hover:bg-slate-600'
                    : 'border-transparent hover:bg-slate-50/95 dark:hover:bg-slate-700/75 hover:border-l-primary-400 dark:hover:border-l-sky-400'
                )}
              >
                <div className="font-semibold text-sm text-text-primary truncate">{invoice.invoice_number}</div>
                <div className="text-xs text-text-secondary truncate">{invoice.customer_name || 'Cash Sale'}</div>
                <div className="text-xs font-medium text-text-primary">
                  {formatInr(invoice.grand_total)}
                </div>
                <div className="text-2xs text-text-muted">
                  Tax {formatInr(invoice.tax_total)}
                </div>
              </button>
            );
          })
        )}
      </div>
      {totalPages > 1 && (
        <div className="p-2 border-t border-border flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 text-text-primary"
          >
            ‹ Prev
          </button>
          <span className="text-text-secondary">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 text-text-primary"
          >
            Next ›
          </button>
        </div>
      )}
    </Card>
  );

  const fullList = (
    <>
        {/* Invoices List */}
        <Card className="overflow-hidden" padding="none">
          {loading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary-500 mx-auto" />
              <p className="mt-4 text-text-secondary">Loading invoices...</p>
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-text-secondary">No invoices found matching your criteria.</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr className="table-header border-b border-border">
                      <th className="table-cell text-left py-4 px-6">Invoice #</th>
                      <th className="table-cell text-left py-4 px-6">Customer</th>
                      <th className="table-cell text-left py-4 px-6">Date</th>
                      <th className="table-cell text-right py-4 px-6">Amount</th>
                      <th
                        className="table-cell text-right py-4 px-6"
                        title="Total tax (e.g. GST) charged on this invoice"
                      >
                        Tax
                      </th>
                      <th className="table-cell text-center py-4 px-6">Status</th>
                      <th className="table-cell text-center py-4 px-6">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedInvoices.map((invoice) => (
                      <tr 
                        key={invoice.id} 
                        className="cursor-pointer border-b border-border last:border-0 transition-colors duration-150 ease-out hover:bg-slate-50 hover:shadow-[inset_3px_0_0_0_rgb(191_219_254)] dark:hover:bg-slate-700/60 dark:hover:shadow-[inset_3px_0_0_0_rgba(56,189,248,0.45)]"
                        onClick={() => setSelectedInvoiceId(invoice.id)}
                      >
                        <td className="table-cell text-left py-4 px-6 font-semibold text-text-primary">{invoice.invoice_number}</td>
                        <td className="table-cell text-left py-4 px-6 text-text-secondary">{invoice.customer_name || 'Cash Sale'}</td>
                        <td className="table-cell text-left py-4 px-6 text-text-muted text-xs">
                          {invoice.invoice_date ? format(new Date(invoice.invoice_date), 'dd MMM yyyy') : '-'}
                        </td>
                        <td className="table-cell text-right py-4 px-6 font-bold text-text-primary">
                          {formatInr(invoice.grand_total)}
                        </td>
                        <td className="table-cell text-right py-4 px-6 text-text-primary tabular-nums">
                          {formatInr(invoice.tax_total)}
                        </td>
                        <td className="table-cell text-center py-4 px-6">
                          <div className="flex flex-col gap-1.5 items-center">
                            <div className="flex flex-row flex-wrap items-center justify-center gap-1.5">
                              <StatusBadge status={invoice.status} />
                              <StatusBadge status={invoice.payment_status || 'unpaid'} />
                              {invoice.sync_status && (
                                <SyncStatusBadge
                                  status={invoice.sync_status as 'pending' | 'synced' | 'failed'}
                                  showLabel={false}
                                />
                              )}
                            </div>
                            {/* Only show GST status for non-proforma invoices */}
                            {invoice.document_type !== 'proforma_invoice' && (
                              <GSTStatusIndicator invoiceId={invoice.id} returnType="GSTR-1" />
                            )}
                          </div>
                        </td>
                        <td className="table-cell text-center py-4 px-6" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white transition-colors"
                              title="View Details"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedInvoiceId(invoice.id);
                              }}
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            
                            {invoice.status === 'final' && invoice.payment_status !== 'paid' && (
                              <button
                                className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white transition-colors"
                                title="Record Payment"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPaymentModalInvoice(invoice);
                                }}
                              >
                                <CreditCard className="w-4 h-4" />
                              </button>
                            )}

                            <button
                              className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white transition-colors"
                              title="Share Invoice"
                              onClick={(e) => {
                                e.stopPropagation();
                                openShareForInvoice(invoice);
                              }}
                            >
                              <Share2 className="w-4 h-4" />
                            </button>

                            {invoice.status === 'final' && (
                              <Link href={`/credit-notes/new?invoice_id=${invoice.id}&customer_id=${invoice.customer_id}`}>
                                <button
                                  className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-slate-50 dark:hover:bg-sky-950/45 text-primary-600 hover:text-primary-700 dark:text-sky-400 dark:hover:text-sky-300 transition-colors"
                                  title="Create Return"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </button>
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-2 p-2">
                {paginatedInvoices.map((invoice) => (
                  <div 
                    key={invoice.id}
                    className="rounded-xl border border-border bg-surface p-3 shadow-sm transition-colors duration-150 ease-out active:bg-slate-50 dark:active:bg-slate-800/90"
                    onClick={() => setSelectedInvoiceId(invoice.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-bold text-text-primary">
                            {invoice.invoice_number}
                          </p>
                          {invoice.sync_status && (
                            <SyncStatusBadge
                              status={invoice.sync_status as 'pending' | 'synced' | 'failed'}
                              showLabel={false}
                            />
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-sm text-text-secondary">
                          {invoice.customer_name || 'Cash Sale'}
                        </p>
                        <p className="mt-1 text-2xs text-text-muted">
                          {invoice.invoice_date ? format(new Date(invoice.invoice_date), 'dd MMM yyyy') : '-'}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="text-lg font-bold leading-tight text-text-primary">
                          {formatInr(invoice.grand_total)}
                        </p>
                        <p className="mt-0.5 text-2xs text-text-secondary tabular-nums" title="Total tax on this invoice">
                          Tax {formatInr(invoice.tax_total)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        <StatusBadge status={invoice.status} className="px-2 py-0 text-2xs" />
                        <StatusBadge status={invoice.payment_status || 'unpaid'} className="px-2 py-0 text-2xs" />
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            openShareForInvoice(invoice);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white text-text-secondary transition-colors active:bg-slate-50"
                          aria-label={`Share ${invoice.invoice_number}`}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                        </button>
                        {invoice.status === 'final' && invoice.payment_status !== 'paid' && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setPaymentModalInvoice(invoice);
                            }}
                            className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border bg-gray-100 px-2.5 text-2xs font-semibold text-gray-900 transition-colors active:bg-gray-200"
                          >
                            <CreditCard className="h-3.5 w-3.5" />
                            Add payment
                          </button>
                        )}
                      </div>
                    </div>

                    {invoice.status === 'final' && invoice.document_type !== 'proforma_invoice' && (
                      <div className="mt-2">
                        <GSTStatusIndicator status="pending" returnType="GSTR-1" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex justify-between items-center p-4 border-t border-border">
              <p className="text-sm text-text-secondary">
                Page {page} of {totalPages} ({filteredInvoices.length} invoices)
              </p>
              <div className="flex space-x-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
    </>
  );

  return (
    <>
      <div className="space-y-3 md:space-y-6 h-full flex flex-col">
        <ListPageHeader
          title="Invoices"
          description="Create and manage your invoices"
          showActionsOnMobile
          actions={
            <>
              <div
                className="flex max-w-[calc(100vw-2rem)] gap-1 overflow-x-auto pb-1 md:hidden"
                aria-label="Invoice status filters"
              >
                {INVOICE_STATUS_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    onClick={() => setStatusFilter(filter.value)}
                    className={clsx(
                      'h-9 shrink-0 rounded-lg border px-3 text-sm font-medium transition-colors',
                      statusFilter === filter.value
                        ? 'border-gray-900 bg-gray-100 text-gray-900'
                        : 'border-border bg-white text-text-secondary active:bg-slate-50'
                    )}
                    aria-pressed={statusFilter === filter.value}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <Link
                href="/invoices/new"
                className="hidden md:inline-flex"
              >
                <Button className="h-10 px-4">
                  <Plus className="w-4 h-4 mr-2" />
                  New Invoice
                </Button>
              </Link>
            </>
          }
        />

        <SubscriptionUsageBanner
          businessId={business?.id}
          variant="inline"
          highlightLimit="invoices"
        />

        <SplitPaneLayout
          isDetailOpen={isDetailOpen}
          onCloseDetail={() => setSelectedInvoiceId(null)}
          toolbarSlot={toolbar}
          listSlot={isDetailOpen ? compactList : fullList}
          detailSlot={
            selectedInvoiceId ? (
              <InvoiceDetailPanel
                invoiceId={selectedInvoiceId}
                onClose={() => setSelectedInvoiceId(null)}
              />
            ) : null
          }
        />
      </div>

      {shareFormatInvoice && (
        <ShareInvoiceFormatSheet
          open
          invoiceId={shareFormatInvoice.id}
          invoiceNumber={shareFormatInvoice.invoice_number}
          businessName={business?.name}
          userId={user?.id}
          businessId={business?.id}
          onClose={() => setShareFormatInvoice(null)}
          onFallbackModal={() => {
            setShareModalInvoice(shareFormatInvoice);
            setShareFormatInvoice(null);
          }}
        />
      )}

      {/* Share Modal (web fallback) */}
      {shareModalInvoice && (
        <ShareInvoiceModal
          invoiceId={shareModalInvoice.id}
          invoiceNumber={shareModalInvoice.invoice_number}
          customerEmail={shareModalInvoice.customer_email}
          customerPhone={shareModalInvoice.customer_phone}
          onClose={() => setShareModalInvoice(null)}
        />
      )}

      {/* Record Payment Modal */}
      {paymentModalInvoice && (
        <RecordPaymentModal
          invoiceId={paymentModalInvoice.id}
          invoiceNumber={paymentModalInvoice.invoice_number}
          grandTotal={Number(paymentModalInvoice.grand_total || 0)}
          paidAmount={Number(paymentModalInvoice.paid_amount || 0)}
          balanceAmount={Number(paymentModalInvoice.balance_amount || paymentModalInvoice.grand_total || 0)}
          onSuccess={handlePaymentSuccess}
          onClose={() => setPaymentModalInvoice(null)}
        />
      )}
    </>
  );
}

function InvoicesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[40vh]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      }
    >
      <InvoicesPageContent />
    </Suspense>
  );
}

export default withPageAuth('invoices', 'read', InvoicesPage);
