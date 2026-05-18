'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useMemo } from 'react';
import { Plus, Search, User, Phone, Mail, MapPin, Filter, X, Eye, Edit, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useEntityQuery } from '@/hooks/useEntityQuery';
import { useToastContext } from '@/contexts/ToastContext';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { SplitPaneLayout } from '@/components/layout/SplitPaneLayout';
import { SupplierDetailPanel } from '@/components/suppliers/SupplierDetailPanel';
import { Card } from '@/components/ui/Card';
import { clsx } from 'clsx';
import { DeleteAction } from '@/components/common/DeleteAction';

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  opening_balance: number;
  opening_balance_type: string;
  linked_business_id?: string | null;
  allow_low_stock_access?: boolean;
}

const PAGE_SIZE = 50;

export default function SuppliersPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [search, setSearch] = useState('');
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [balanceFilter, setBalanceFilter] = useState<'all' | 'with-balance' | 'zero-balance'>('all');
  const [page, setPage] = useState(1);
  const [updatingAccess, setUpdatingAccess] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  const { data: allSuppliers, loading, refetch } = useEntityQuery<Supplier>({
    businessId: business?.id ?? null,
    apiUrl: '/api/suppliers',
    responseKey: 'suppliers',
  });

  const filteredSuppliers = useMemo(() => {
    let list = allSuppliers.filter((s) => (s as any).is_active !== false);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          (s.name && s.name.toLowerCase().includes(q)) ||
          (s.phone && String(s.phone).toLowerCase().includes(q)) ||
          (s.email && String(s.email).toLowerCase().includes(q))
      );
    }
    if (balanceFilter !== 'all') {
      const hasBalance = (s: Supplier) => s.opening_balance !== 0;
      list = list.filter((s) =>
        balanceFilter === 'with-balance' ? hasBalance(s) : !hasBalance(s)
      );
    }
    return list;
  }, [allSuppliers, search, balanceFilter]);

  const paginatedSuppliers = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredSuppliers.slice(start, start + PAGE_SIZE);
  }, [filteredSuppliers, page]);

  const totalPages = Math.max(1, Math.ceil(filteredSuppliers.length / PAGE_SIZE));

  useEffect(() => {
    if (business?.id && navigator.onLine) refetch();
  }, [business?.id, refetch]);

  useEffect(() => {
    if (selectedSupplierId && !allSuppliers.some((s) => s.id === selectedSupplierId)) {
      setSelectedSupplierId(null);
    }
  }, [allSuppliers, selectedSupplierId]);

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'purchases',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

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
      <AccessDenied module="suppliers" action="view" />
    );
  }

  const isDetailOpen = selectedSupplierId !== null;

  const toolbar = (
    <>
      <Card padding="md" className="hidden md:block mb-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, or email"
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 h-10"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {['all', 'with-balance', 'zero-balance'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setBalanceFilter(f as 'all' | 'with-balance' | 'zero-balance')}
                className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  balanceFilter === f
                    ? 'bg-primary-600 border-primary-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {f.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </button>
            ))}
          </div>
        </div>
      </Card>
      <div className="md:hidden relative mb-3">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search suppliers"
          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl h-12"
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
          placeholder="Search"
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
        ) : paginatedSuppliers.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-secondary">No suppliers</div>
        ) : (
          paginatedSuppliers.map((supplier) => {
            const isSelected = supplier.id === selectedSupplierId;
            return (
              <button
                key={supplier.id}
                type="button"
                onClick={() => setSelectedSupplierId(supplier.id)}
                className={clsx(
                  'w-full text-left p-3 flex items-center gap-3 transition-colors',
                  isSelected
                    ? 'bg-slate-50 dark:bg-primary-900/20 border-l-[3px] border-primary-500'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800 border-l-[3px] border-transparent'
                )}
              >
                <div className="w-9 h-9 rounded-full bg-slate-100 text-primary-700 flex items-center justify-center font-bold text-sm shrink-0">
                  {supplier.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm text-text-primary truncate">{supplier.name}</div>
                  <div className="text-xs text-text-secondary truncate">
                    {supplier.phone || supplier.email || '—'}
                  </div>
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
            className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-40"
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
            className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-40"
          >
            Next ›
          </button>
        </div>
      )}
    </Card>
  );

  const fullList = (
    <>
      {/* Search Bar — full width when no split toolbar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 md:hidden">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or phone"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg h-12 md:h-10"
          />
        </div>
      </div>

      {/* Desktop Filter Chips — full list only */}
      <div className="hidden md:flex gap-2 mb-4">
        {['all', 'with-balance', 'zero-balance'].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setBalanceFilter(f as 'all' | 'with-balance' | 'zero-balance')}
            className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              balanceFilter === f
                ? 'bg-primary-600 border-primary-600 text-white'
                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            {f.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      ) : filteredSuppliers.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <User className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">
            {search ? 'No suppliers found matching your search' : 'No suppliers yet'}
          </p>
          {!search && (
            <button
              type="button"
              onClick={() => router.push('/suppliers/new')}
              className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
            >
              Add Your First Supplier
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="table w-full">
              <thead>
                <tr className="table-header border-b border-border">
                  <th className="table-cell text-left py-4 px-6">Name</th>
                  <th className="table-cell text-left py-4 px-6">Phone</th>
                  <th className="table-cell text-left py-4 px-6">GSTIN</th>
                  <th className="table-cell text-right py-4 px-6">Opening</th>
                  <th className="table-cell text-center py-4 px-6">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedSuppliers.map((supplier) => (
                  <tr
                    key={supplier.id}
                    className="hover:bg-slate-50 cursor-pointer transition-colors border-b border-border last:border-0"
                    onClick={() => setSelectedSupplierId(supplier.id)}
                  >
                    <td className="table-cell text-left py-4 px-6 font-semibold text-text-primary">
                      {supplier.name}
                    </td>
                    <td className="table-cell text-left py-4 px-6 text-text-secondary">
                      {supplier.phone || '—'}
                    </td>
                    <td className="table-cell text-left py-4 px-6 text-xs font-mono text-text-secondary">
                      {supplier.gstin || '—'}
                    </td>
                    <td className="table-cell text-right py-4 px-6 text-sm">
                      ₹{Math.abs(supplier.opening_balance || 0).toLocaleString('en-IN')}
                    </td>
                    <td className="table-cell text-center py-4 px-6" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedSupplierId(supplier.id)}
                          className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
                          title="View"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => router.push(`/suppliers/new?edit=${supplier.id}`)}
                          className="p-2 hover:bg-gray-100 rounded-lg text-gray-500"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <DeleteAction
                          entityName="Supplier"
                          variant="delete"
                          successMessage="Supplier deleted successfully"
                          deleteFn={async () => {
                            if (!business?.id || !user?.id) throw new Error('Missing business/user context');
                            const res = await fetch(
                              `/api/suppliers/${supplier.id}?business_id=${business.id}&user_id=${user.id}`,
                              { method: 'DELETE' }
                            );
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) throw new Error(data?.error || 'Failed to delete supplier');
                          }}
                          onSuccess={async () => {
                            await refetch();
                            if (selectedSupplierId === supplier.id) setSelectedSupplierId(null);
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden grid grid-cols-1 gap-4">
            {paginatedSuppliers.map((supplier) => (
              <div
                key={supplier.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedSupplierId(supplier.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setSelectedSupplierId(supplier.id);
                }}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 hover:shadow-md transition"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center space-x-3">
                    <div className="bg-slate-50 p-3 rounded-xl text-primary-600">
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">{supplier.name}</h3>
                      {supplier.gstin ? (
                        <p className="text-[10px] uppercase font-bold text-primary-600 bg-slate-50 px-1.5 py-0.5 rounded mt-1 inline-block">
                          GSTIN: {supplier.gstin}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                    <DeleteAction
                      entityName="Supplier"
                      variant="delete"
                      successMessage="Supplier deleted successfully"
                      deleteFn={async () => {
                        if (!business?.id || !user?.id) throw new Error('Missing business/user context');
                        const res = await fetch(
                          `/api/suppliers/${supplier.id}?business_id=${business.id}&user_id=${user.id}`,
                          { method: 'DELETE' }
                        );
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) throw new Error(data?.error || 'Failed to delete supplier');
                      }}
                      onSuccess={async () => {
                        await refetch();
                        if (selectedSupplierId === supplier.id) setSelectedSupplierId(null);
                      }}
                    />
                  </div>
                </div>
                {supplier.phone && (
                  <div className="flex items-center space-x-2 text-sm text-gray-600 mb-1">
                    <Phone className="w-4 h-4 text-gray-400" />
                    <span>{supplier.phone}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {totalPages > 1 && filteredSuppliers.length > 0 && (
        <div className="flex justify-between items-center p-4 border-t border-gray-200 bg-white rounded-b-xl">
          <p className="text-sm text-gray-600">
            Page {page} of {totalPages} ({filteredSuppliers.length} suppliers)
          </p>
          <div className="flex space-x-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-3 md:space-y-6 h-full flex flex-col">
      <ListPageHeader
        title="Suppliers"
        description="Manage your suppliers and vendors"
        actions={
          <>
            <button
              type="button"
              onClick={() => setShowMobileFilters(true)}
              className="p-2 bg-white border border-gray-200 rounded-lg md:hidden text-text-secondary"
              aria-label="Filters"
            >
              <Filter className="w-5 h-5" />
            </button>
            <Link href="/suppliers/new">
              <button
                type="button"
                className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition h-10"
              >
                <Plus className="w-5 h-5" />
                <span className="hidden md:inline">Add Supplier</span>
              </button>
            </Link>
          </>
        }
      />

      {showMobileFilters && (
        <div className="fixed inset-0 z-[100] md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowMobileFilters(false)} />
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-xl p-6 animate-slide-up">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-gray-900">Filters</h3>
              <button type="button" onClick={() => setShowMobileFilters(false)} className="p-2 hover:bg-gray-100 rounded-full">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Balance Status</label>
                <div className="flex flex-col gap-2">
                  {[
                    { id: 'all', label: 'All Suppliers' },
                    { id: 'with-balance', label: 'With Balance' },
                    { id: 'zero-balance', label: 'Zero Balance' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        setBalanceFilter(f.id as 'all' | 'with-balance' | 'zero-balance');
                        setShowMobileFilters(false);
                      }}
                      className={`px-4 py-3 rounded-xl text-left text-sm font-medium border transition-colors ${
                        balanceFilter === f.id
                          ? 'bg-slate-50 border-primary-500 text-primary-700'
                          : 'bg-white border-gray-200 text-gray-600'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="w-full mt-8 h-12 bg-primary-600 text-white font-bold rounded-xl"
              onClick={() => setShowMobileFilters(false)}
            >
              Apply Filters
            </button>
          </div>
        </div>
      )}

      <SplitPaneLayout
        isDetailOpen={isDetailOpen}
        onCloseDetail={() => setSelectedSupplierId(null)}
        toolbarSlot={toolbar}
        listSlot={isDetailOpen ? compactList : fullList}
        detailSlot={
          selectedSupplierId ? (
            <SupplierDetailPanel supplierId={selectedSupplierId} onClose={() => setSelectedSupplierId(null)} />
          ) : null
        }
      />
    </div>
  );
}

