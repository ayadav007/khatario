'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Search, Plus, Share2, Eye, Loader2, CreditCard, RotateCcw, Filter, X } from 'lucide-react';
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
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'draft' | 'final' | 'paid' | 'unpaid' | 'cancelled'
  >(() => {
    const s = searchParams.get('status');
    if (s && ['draft', 'final', 'paid', 'unpaid', 'cancelled'].includes(s)) {
      return s as 'draft' | 'final' | 'paid' | 'unpaid' | 'cancelled';
    }
    return 'all';
  });
  const [showMobileFilters, setShowMobileSearch] = useState(false);
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
                <div className="text-[10px] text-text-muted">
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
              <div className="md:hidden divide-y divide-border">
                {paginatedInvoices.map((invoice) => (
                  <div 
                    key={invoice.id}
                    className="p-4 bg-surface transition-colors duration-150 ease-out hover:bg-slate-100/80 dark:hover:bg-slate-800/85 active:bg-slate-50 dark:active:bg-slate-800/90"
                    onClick={() => setSelectedInvoiceId(invoice.id)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-bold text-text-primary">{invoice.invoice_number}</p>
                        <p className="text-sm text-text-secondary">{invoice.customer_name || 'Cash Sale'}</p>
                      </div>
                      <div className="flex flex-row flex-wrap items-center justify-end gap-1 max-w-[min(100%,14rem)]">
                        <StatusBadge status={invoice.status} />
                        <StatusBadge status={invoice.payment_status || 'unpaid'} />
                        {invoice.sync_status && (
                          <SyncStatusBadge status={invoice.sync_status as 'pending' | 'synced' | 'failed'} showLabel={false} />
                        )}
                      </div>
                    </div>
                    
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <p className="text-[10px] text-text-muted">
                          {invoice.invoice_date ? format(new Date(invoice.invoice_date), 'dd MMM yyyy') : '-'}
                        </p>
                        {invoice.status === 'final' && invoice.document_type !== 'proforma_invoice' && (
                          <GSTStatusIndicator status="pending" returnType="GSTR-1" className="mt-1" />
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-text-primary">
                          {formatInr(invoice.grand_total)}
                        </p>
                        <p className="text-xs text-text-secondary tabular-nums" title="Total tax on this invoice">
                          Tax {formatInr(invoice.tax_total)}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 border-t border-border pt-3">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedInvoiceId(invoice.id);
                        }}
                        className="flex items-center justify-center gap-1 py-2 px-1 text-[10px] font-semibold text-text-secondary hover:bg-slate-100/90 dark:hover:bg-slate-800 rounded-lg border border-border transition-colors"
                      >
                        <Eye className="w-3 h-3" />
                        View
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          openShareForInvoice(invoice);
                        }}
                        className="flex items-center justify-center gap-1 py-2 px-1 text-[10px] font-semibold text-text-secondary hover:bg-slate-100/90 dark:hover:bg-slate-800 rounded-lg border border-border transition-colors"
                      >
                        <Share2 className="w-3 h-3" />
                        Share
                      </button>
                      {invoice.status === 'final' && invoice.payment_status !== 'paid' && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setPaymentModalInvoice(invoice);
                          }}
                          className="flex items-center justify-center gap-1 py-2 px-1 text-[10px] font-semibold text-primary-600 dark:text-primary-300 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-primary-900/50 rounded-lg border border-primary-100 dark:border-primary-800 transition-colors"
                        >
                          <CreditCard className="w-3 h-3" />
                          Pay
                        </button>
                      )}
                    </div>
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
              <button
                onClick={() => setShowMobileSearch(true)}
                className="p-2 bg-white border border-border rounded-lg md:hidden text-text-secondary"
                type="button"
                aria-label="Filters"
              >
                <Filter className="w-5 h-5" />
              </button>
              <Link href="/invoices/new" className="hidden md:inline-flex">
                <Button className="h-10 px-4">
                  <Plus className="w-4 h-4 mr-2" />
                  New Invoice
                </Button>
              </Link>
            </>
          }
        />

        {showMobileFilters && (
          <div className="fixed inset-0 z-[100] md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowMobileSearch(false)} />
            <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl p-6 animate-slide-up">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-gray-900">Filters</h3>
                <button type="button" onClick={() => setShowMobileSearch(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['all', 'draft', 'final', 'paid', 'unpaid', 'cancelled'].map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => {
                          setStatusFilter(status as any);
                          setShowMobileSearch(false);
                        }}
                        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          statusFilter === status
                            ? 'bg-slate-50 border-primary-500 text-primary-700'
                            : 'bg-white border-gray-200 text-gray-600'
                        }`}
                      >
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <Button className="w-full mt-8 h-12" onClick={() => setShowMobileSearch(false)}>
                Apply Filters
              </Button>
            </div>
          </div>
        )}

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
