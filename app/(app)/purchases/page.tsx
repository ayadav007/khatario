'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Plus, ShoppingCart, Calendar, DollarSign, User, Tag, Eye, Edit, RotateCcw, Filter, Search, CreditCard, X, Trash2, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useRouter } from 'next/navigation';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { GSTStatusIndicator } from '@/components/ui/GSTStatusIndicator';
import { PurchasePaymentModal } from '@/components/modals/PurchasePaymentModal';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { FeatureRouteGuard } from '@/components/guards/FeatureRouteGuard';
import { FeatureKeys } from '@/lib/featureKeys';
import { useToastContext } from '@/contexts/ToastContext';
import { buildApiUrl } from '@/lib/api-helpers';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { SplitPaneLayout } from '@/components/layout/SplitPaneLayout';
import { PurchaseDetailPanel } from '@/components/purchases/PurchaseDetailPanel';
import { Card } from '@/components/ui/Card';
import { clsx } from 'clsx';

interface Purchase {
  id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  bill_number: string | null;
  bill_date: string;
  status: string;
  payment_status: string;
  grand_total: number;
  paid_amount: number;
  itc_eligible: boolean;
  itc_availed: boolean;
  reconciliation_status?: string | null;
  reconciliation_decision?: string | null;
  created_at: string;
}

function PurchasesPageContent() {
  const router = useRouter();
  const { business, user } = useAuth();
  const { currentBranchId, isLoading: branchLoading } = useBranch();
  const toast = useToastContext();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'final' | 'paid' | 'unpaid' | 'cancelled'>('all');
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [paymentModalPurchase, setPaymentModalPurchase] = useState<Purchase | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [deletingPurchaseId, setDeletingPurchaseId] = useState<string | null>(null);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);

  // Authorization guard: Check if user can read purchases
  // Uses tri-state model: 'loading' | 'allowed' | 'denied'
  const { status: authStatus } = useAuthorizationGuard({
    resource: 'purchases',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  // Read URL params for aging filters and date filters
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlStatus = params.get('status');
      const dateFrom = params.get('date_from');
      const dateTo = params.get('date_to');
      
      if (urlStatus) {
        setStatusFilter(urlStatus as any);
      }
      
      // If date filters are in URL, trigger a refetch
      if (dateFrom || dateTo) {
        fetchPurchases();
      }
    }
  }, []);

  useEffect(() => {
    if (business?.id && user?.id) {
      fetchPurchases();
    }
  }, [business, user]);

  async function fetchPurchases() {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const query: Record<string, string | number> = {
        business_id: business.id,
        page: pagination.page,
        limit: pagination.limit,
      };
      if (search.trim()) query.search = search.trim();
      if (statusFilter !== 'all') query.status = statusFilter;

      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const agingMin = urlParams.get('aging_days_min');
        const agingMax = urlParams.get('aging_days_max');
        const dateFrom = urlParams.get('date_from');
        const dateTo = urlParams.get('date_to');
        if (agingMin) query.aging_days_min = agingMin;
        if (agingMax) query.aging_days_max = agingMax;
        if (dateFrom) query.date_from = dateFrom;
        if (dateTo) query.date_to = dateTo;
      }

      // Do not pass branch_id from localStorage: new purchases use resolveBranchId / user-branches
      // default, which can differ from the header branch selector — filtering by one branch would hide rows.
      const path = buildApiUrl('/api/purchases', query, { excludeBranchId: true });
      const response = await fetch(path, { cache: 'no-store' });
      const data = await response.json();
      setPurchases(data.purchases || []);
      if (data.pagination) {
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error fetching purchases:', error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Wait for branch context to be ready before fetching
    if (business?.id && !branchLoading) {
      fetchPurchases();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, search, statusFilter, pagination.page, currentBranchId, branchLoading]);

  useEffect(() => {
    if (business?.id) {
      // Reset to page 1 when search or filter changes
      setPagination(prev => ({ ...prev, page: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, search, statusFilter]);

  useEffect(() => {
    if (selectedPurchaseId && !purchases.some((p) => p.id === selectedPurchaseId)) {
      setSelectedPurchaseId(null);
    }
  }, [purchases, selectedPurchaseId]);

  // Show loading while checking authorization (tri-state: 'loading')
  if (authStatus === 'loading') {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  // Show access denied only if check completed and denied (tri-state: 'denied')
  if (authStatus === 'denied') {
    return (
      <AccessDenied module="purchases" action="view" />
    );
  }

  // authStatus === 'allowed' - render page content

  // If aging filters are applied via URL, API already filtered, so just use purchases as-is
  // Otherwise, apply client-side status filtering
  const filteredPurchases = (() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const hasAgingFilter = urlParams.get('aging_days_min') || urlParams.get('aging_days_max');
      if (hasAgingFilter) {
        // API already filtered by aging, just return purchases
        return purchases;
      }
    }
    
    // Apply client-side status filtering
    return purchases.filter((purchase) => {
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'draft' && purchase.status === 'draft') ||
        (statusFilter === 'final' && purchase.status === 'final') ||
        (statusFilter === 'cancelled' && purchase.status === 'cancelled') ||
        (statusFilter === 'paid' && purchase.payment_status === 'paid') ||
        (statusFilter === 'unpaid' &&
          (purchase.payment_status === 'unpaid' || purchase.payment_status === 'partially_paid'));
      return matchesStatus;
    });
  })();

  const totalPurchases = filteredPurchases.reduce((sum, p) => sum + parseFloat(p.grand_total.toString()), 0);
  const totalPaid = filteredPurchases.reduce((sum, p) => sum + parseFloat(p.paid_amount.toString()), 0);
  const totalDue = totalPurchases - totalPaid;

  async function handleDeletePurchase(purchaseId: string) {
    if (!confirm('Are you sure you want to delete this purchase? This action cannot be undone.')) {
      return;
    }

    setDeletingPurchaseId(purchaseId);
    try {
      const response = await fetch(`/api/purchases/${purchaseId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        let errorMessage = 'Failed to delete purchase';
        try {
          const data = await response.json();
          errorMessage = data.error || data.details || errorMessage;
        } catch (e) {
          // If response is not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        toast.error(errorMessage);
        return;
      }

      // Try to parse JSON response
      try {
        const data = await response.json();
        // Success - refresh purchases list
        fetchPurchases();
      } catch (e) {
        // If no JSON response, still refresh (success)
        fetchPurchases();
      }
    } catch (error) {
      console.error('Error deleting purchase:', error);
      toast.error('Failed to delete purchase. Please try again.');
    } finally {
      setDeletingPurchaseId(null);
    }
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-700',
      final: 'bg-green-100 text-green-700',
      paid: 'bg-slate-100 text-primary-700',
      cancelled: 'bg-red-100 text-red-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  const isDetailOpen = selectedPurchaseId !== null;

  const toolbar = (
    <>
      <div className="flex flex-col md:flex-row gap-4 items-center">
        <div className="flex-1 w-full relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Bill number or supplier"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 h-12 md:h-10"
          />
        </div>
        <div className="hidden md:flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="input w-auto h-10 text-sm"
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
    </>
  );

  const compactList = (
    <Card padding="none" className="overflow-hidden h-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-200">
      <div className="p-3 border-b border-border relative">
        <Search className="absolute left-5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search purchases"
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
        ) : filteredPurchases.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-secondary">No purchases</div>
        ) : (
          filteredPurchases.map((purchase) => {
            const sel = purchase.id === selectedPurchaseId;
            return (
              <button
                key={purchase.id}
                type="button"
                onClick={() => setSelectedPurchaseId(purchase.id)}
                className={clsx(
                  'w-full text-left p-3 flex flex-col gap-1 transition-colors',
                  sel
                    ? 'bg-slate-50 border-l-[3px] border-primary-500'
                    : 'hover:bg-gray-50 border-l-[3px] border-transparent'
                )}
              >
                <div className="font-semibold text-sm text-gray-900 truncate">
                  {purchase.bill_number || '—'}
                </div>
                <div className="text-xs text-gray-600 truncate">{purchase.supplier_name || '—'}</div>
                <div className="text-xs font-medium text-gray-900">
                  ₹{parseFloat(purchase.grand_total.toString()).toLocaleString('en-IN')}
                </div>
              </button>
            );
          })
        )}
      </div>
      {pagination.totalPages > 1 && (
        <div className="p-2 border-t border-border flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => setPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
            disabled={pagination.page === 1}
            className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-40"
          >
            ‹ Prev
          </button>
          <span className="text-text-secondary">
            {pagination.page} / {pagination.totalPages}
          </span>
          <button
            type="button"
            onClick={() =>
              setPagination((prev) => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))
            }
            disabled={pagination.page === pagination.totalPages}
            className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-40"
          >
            Next ›
          </button>
        </div>
      )}
    </Card>
  );

  return (
    
      <div className="space-y-3 md:space-y-6">
        <ListPageHeader
          title="Purchases"
          description="Track supplier bills and inventory purchases"
          actions={
            <>
              <button
                type="button"
                onClick={() => router.push('/purchases/requests')}
                className="hidden md:inline-flex items-center space-x-2 px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <span>Requests</span>
              </button>
              <button
                type="button"
                onClick={() => setShowMobileFilters(true)}
                className="p-2 bg-white border border-gray-200 rounded-lg md:hidden text-text-secondary"
                aria-label="Filters"
              >
                <Filter className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => router.push('/purchases/new')}
                className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition h-10"
              >
                <Plus className="w-5 h-5" />
                <span className="hidden md:inline">New Purchase</span>
              </button>
            </>
          }
        />

        {/* Mobile Filter Bottom Sheet */}
        {showMobileFilters && (
          <div className="fixed inset-0 z-[100] md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowMobileFilters(false)} />
            <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl p-6 animate-slide-up">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-gray-900">Filters</h3>
                <button onClick={() => setShowMobileFilters(false)} className="p-2 hover:bg-gray-100 rounded-full">
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
                        onClick={() => {
                          setStatusFilter(status as any);
                          setShowMobileFilters(false);
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
              
              <Button 
                className="w-full mt-8 h-12 rounded-xl" 
                onClick={() => setShowMobileFilters(false)}
              >
                Apply Filters
              </Button>
            </div>
          </div>
        )}

        <SplitPaneLayout
          isDetailOpen={isDetailOpen}
          onCloseDetail={() => setSelectedPurchaseId(null)}
          toolbarSlot={toolbar}
          listSlot={
            isDetailOpen ? (
              compactList
            ) : (
              <>
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-purple-50 to-slate-50 rounded-xl p-6 border border-purple-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-purple-600 mb-1">Total Purchases</p>
                <p className="text-3xl font-bold text-gray-900">₹{totalPurchases.toLocaleString()}</p>
              </div>
              <div className="bg-purple-100 p-3 rounded-lg">
                <ShoppingCart className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-6 border border-green-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-green-600 mb-1">Total Paid</p>
                <p className="text-3xl font-bold text-gray-900">₹{totalPaid.toLocaleString()}</p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <DollarSign className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-orange-50 to-red-50 rounded-xl p-6 border border-orange-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-orange-600 mb-1">Total Due</p>
                <p className="text-3xl font-bold text-gray-900">₹{totalDue.toLocaleString()}</p>
              </div>
              <div className="bg-orange-100 p-3 rounded-lg">
                <DollarSign className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl p-6 border border-gray-200 flex items-center justify-center">
          <button
            onClick={() => router.push('/items/categories')}
            className="flex items-center space-x-2 text-primary-600 hover:text-primary-700 font-medium"
          >
            <Tag className="w-5 h-5" />
            <span>Manage Categories</span>
          </button>
        </div>

        {/* Purchases List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {loading ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : filteredPurchases.length === 0 ? (
            <div className="p-12 text-center">
              <ShoppingCart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No purchases found matching your criteria.</p>
            </div>
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="md:hidden space-y-3 p-4">
                {filteredPurchases.map((purchase) => {
                  const balance = parseFloat(purchase.grand_total.toString()) - parseFloat(purchase.paid_amount.toString());
                  return (
                    <div 
                      key={purchase.id} 
                      className="bg-white rounded-xl border border-gray-200 p-4 active:bg-gray-50 transition-colors shadow-sm"
                      onClick={() => setSelectedPurchaseId(purchase.id)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-bold text-gray-900">{purchase.bill_number || 'No Bill No.'}</p>
                          <p className="text-sm text-gray-600 font-medium">{purchase.supplier_name || 'Unknown Supplier'}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <StatusBadge status={purchase.status} />
                          <StatusBadge status={purchase.payment_status || 'unpaid'} />
                          {purchase.status === 'final' && (
                            <>
                              <GSTStatusIndicator 
                                status={purchase.itc_availed ? 'included' : 'pending'} 
                                returnType="GSTR-3B" 
                              />
                              {purchase.reconciliation_status === 'MATCHED' && (
                                <div className="text-[10px] bg-success-50 text-success-700 px-2 py-0.5 rounded-full font-medium">
                                  ✓ Matched in 2B
                                </div>
                              )}
                              {purchase.reconciliation_status === 'MISSING_IN_2B' && (
                                <div className="text-[10px] bg-error-50 text-error-700 px-2 py-0.5 rounded-full font-medium">
                                  ⚠️ Missing in 2B
                                </div>
                              )}
                              {purchase.reconciliation_decision === 'ITC_NOT_ELIGIBLE' && (
                                <div className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                                  Ineligible ITC
                                </div>
                              )}
                              {!purchase.reconciliation_decision && purchase.reconciliation_status && purchase.reconciliation_status !== 'MATCHED' && (
                                <div className="text-[10px] bg-warning-100 text-warning-700 px-2 py-0.5 rounded-full font-bold animate-pulse">
                                  Requires Decision
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-center mt-3">
                        <p className="text-xs text-gray-500 font-medium">{new Date(purchase.bill_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                        <p className="text-lg font-bold text-gray-900">₹{parseFloat(purchase.grand_total.toString()).toLocaleString('en-IN')}</p>
                      </div>
                      <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-50">
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setSelectedPurchaseId(purchase.id); }}>
                          <Eye className="w-4 h-4 mr-1" /> View
                        </Button>
                        {purchase.status === 'final' && (
                          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/purchase-returns/new?purchase_id=${purchase.id}&supplier_id=${purchase.supplier_id || ''}`); }}>
                            <RotateCcw className="w-4 h-4 mr-1" /> Return
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            handleDeletePurchase(purchase.id);
                          }}
                          disabled={deletingPurchaseId === purchase.id}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          {deletingPurchaseId === purchase.id ? (
                            <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin mr-1" />
                          ) : (
                            <Trash2 className="w-4 h-4 mr-1" />
                          )}
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table View */}
              <div className="overflow-x-auto hidden md:block">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Bill No.</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Date</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Supplier</th>
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700">Amount</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700">Paid</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700">Balance</th>
                      <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPurchases.map((purchase) => {
                      const balance = parseFloat(purchase.grand_total.toString()) - parseFloat(purchase.paid_amount.toString());

                      return (
                        <tr
                          key={purchase.id}
                          className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                          onClick={() => setSelectedPurchaseId(purchase.id)}
                        >
                          <td className="py-4 px-4">
                            <span className="text-sm font-medium text-gray-900">
                              {purchase.bill_number || '-'}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center space-x-2 text-sm text-gray-600">
                              <Calendar className="w-4 h-4" />
                              <span>{new Date(purchase.bill_date).toLocaleDateString()}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center space-x-2">
                              <User className="w-4 h-4 text-gray-400" />
                              <span className="text-sm text-gray-900">
                                {purchase.supplier_name || 'Unknown Supplier'}
                              </span>
                            </div>
                          </td>
                        <td className="py-4 px-4">
                          <div className="flex flex-col gap-1.5 items-start">
                            <StatusBadge status={purchase.status} />
                            <StatusBadge status={purchase.payment_status || 'unpaid'} />
                            {purchase.status === 'final' && (
                              <>
                                <GSTStatusIndicator 
                                  status={purchase.itc_availed ? 'included' : 'pending'} 
                                  returnType="GSTR-3B" 
                                />
                                {purchase.reconciliation_status === 'MATCHED' && (
                                  <div className="text-[10px] bg-success-50 text-success-700 px-2 py-0.5 rounded-full font-medium">
                                    ✓ Matched in 2B
                                  </div>
                                )}
                                {purchase.reconciliation_status === 'MISSING_IN_2B' && (
                                  <div className="text-[10px] bg-error-50 text-error-700 px-2 py-0.5 rounded-full font-medium">
                                    ⚠️ Missing in 2B
                                  </div>
                                )}
                                {purchase.reconciliation_decision === 'ITC_NOT_ELIGIBLE' && (
                                  <div className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                                    Ineligible ITC
                                  </div>
                                )}
                                {!purchase.reconciliation_decision && purchase.reconciliation_status && purchase.reconciliation_status !== 'MATCHED' && (
                                  <div className="text-[10px] bg-warning-100 text-warning-700 px-2 py-0.5 rounded-full font-bold">
                                    Requires Decision
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                          <td className="py-4 px-4 text-right">
                            <span className="text-sm font-semibold text-gray-900">
                              ₹{parseFloat(purchase.grand_total.toString()).toLocaleString()}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-right">
                            <span className="text-sm text-green-600">
                              ₹{parseFloat(purchase.paid_amount.toString()).toLocaleString()}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-right">
                            <span className={`text-sm font-semibold ${balance > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                              ₹{balance.toLocaleString()}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
                                title="View Details"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedPurchaseId(purchase.id);
                                }}
                              >
                                <Eye className="w-4 h-4" />
                              </button>

                              {purchase.status === 'draft' && (
                                <button
                                  className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
                                  title="Edit Purchase"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(`/purchases/new?edit=${purchase.id}`);
                                  }}
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                              )}

                              {purchase.status === 'final' && purchase.payment_status !== 'paid' && (
                                <button
                                  className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
                                  title="Record Payment"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPaymentModalPurchase(purchase);
                                  }}
                                >
                                  <CreditCard className="w-4 h-4" />
                                </button>
                              )}

                              {purchase.status === 'final' && (
                                <button
                                  className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-600 hover:text-gray-900 transition-colors"
                                  title="Create Return"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(`/purchase-returns/new?purchase_id=${purchase.id}&supplier_id=${purchase.supplier_id || ''}`);
                                  }}
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </button>
                              )}

                              <button
                                className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-red-50 text-gray-600 hover:text-red-600 transition-colors disabled:opacity-50"
                                title="Delete Purchase"
                                disabled={deletingPurchaseId === purchase.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeletePurchase(purchase.id);
                                }}
                              >
                                {deletingPurchaseId === purchase.id ? (
                                  <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Pagination Controls */}
          {pagination.totalPages > 1 && (
            <div className="flex justify-between items-center p-4 border-t border-gray-200">
              <p className="text-sm text-gray-600">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} purchases)
              </p>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                  disabled={pagination.page === 1}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                  disabled={pagination.page === pagination.totalPages}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
              </>
            )
          }
          detailSlot={
            selectedPurchaseId ? (
              <PurchaseDetailPanel
                purchaseId={selectedPurchaseId}
                onClose={() => setSelectedPurchaseId(null)}
              />
            ) : null
          }
        />

        {/* Payment Modal */}
        {paymentModalPurchase && (
          <PurchasePaymentModal
            purchaseId={paymentModalPurchase.id}
            billNumber={paymentModalPurchase.bill_number || paymentModalPurchase.id.substring(0, 8)}
            grandTotal={Number(paymentModalPurchase.grand_total || 0)}
            paidAmount={Number(paymentModalPurchase.paid_amount || 0)}
            balanceAmount={Number(paymentModalPurchase.grand_total || 0) - Number(paymentModalPurchase.paid_amount || 0)}
            onSuccess={() => {
              fetchPurchases(); // Refresh purchases list
              setPaymentModalPurchase(null);
            }}
            onClose={() => setPaymentModalPurchase(null)}
          />
        )}
      </div>
  );
}

export default function PurchasesPage() {
  return (
    <FeatureRouteGuard featureKey={FeatureKeys.PURCHASE_MANAGEMENT}>
      <PurchasesPageContent />
    </FeatureRouteGuard>
  );
}
