'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Search, Plus, Loader2, Edit, Eye, Filter, X, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Customer } from '@/types/database';
import { Toast, ToastType } from '@/components/ui/Toast';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useEntityList } from '@/hooks/useEntityList';
import {
  customerBalanceHint,
  isPartyBalanceSettled,
  PARTY_BALANCE_COLUMN_HEADER,
  supplierBalanceHint,
} from '@/lib/party-balance-ui';
import { SupplierDetailPanel } from '@/components/suppliers/SupplierDetailPanel';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { MobileListRow } from '@/components/layout/MobileList';
import { SplitPaneLayout } from '@/components/layout/SplitPaneLayout';
import { CustomerDetailPanel } from '@/components/customers/CustomerDetailPanel';
import { clsx } from 'clsx';
import { SubscriptionUsageBanner } from '@/components/subscription/SubscriptionUsageBanner';

const PAGE_SIZE = 50;
const SUPPLIER_LIST_PARAMS = { limit: 500 };

type PartyKind = 'customers' | 'suppliers';

type PartySupplier = {
  id: string;
  name: string;
  phone?: string | null;
  current_balance?: number | string | null;
  opening_balance?: number | string | null;
  is_active?: boolean;
};

function partyBalance(value: number | string | null | undefined, fallback?: number | string | null) {
  return Number(value ?? fallback ?? 0);
}

function PartyKindTabs({
  value,
  onChange,
}: {
  value: PartyKind;
  onChange: (next: PartyKind) => void;
}) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="tablist" aria-label="Party type">
      {([
        ['customers', 'Customers'],
        ['suppliers', 'Suppliers'],
      ] as const).map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={clsx(
            'h-9 rounded-lg text-sm font-semibold',
            value === id ? 'bg-surface text-primary-700 shadow-sm' : 'text-text-secondary'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function CustomersPage() {
  const { business, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const partyTab: PartyKind = searchParams.get('tab') === 'suppliers' ? 'suppliers' : 'customers';
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'with-balance' | 'zero-balance'>('all');
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [page, setPage] = useState(1);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  const setPartyTab = (next: PartyKind) => {
    if (next === partyTab) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'suppliers') params.set('tab', 'suppliers');
    else params.delete('tab');
    const query = params.toString();
    router.replace(query ? `/customers?${query}` : '/customers', { scroll: false });
    setPage(1);
    setSelectedCustomerId(null);
    setSelectedSupplierId(null);
  };

  const { data: allCustomers, loading } = useEntityList<Customer>({
    apiUrl: '/api/customers',
    businessId: business?.id ?? null,
    userId: user?.id ?? null,
    responseKey: 'customers',
  });

  const { data: allSuppliers, loading: suppliersLoading } = useEntityList<PartySupplier>({
    apiUrl: '/api/suppliers',
    businessId: business?.id ?? null,
    userId: user?.id ?? null,
    queryParams: SUPPLIER_LIST_PARAMS,
    responseKey: 'suppliers',
  });

  const filteredCustomers = useMemo(() => {
    let list = allCustomers.filter((c) => c.is_active !== false);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.company_name && c.company_name.toLowerCase().includes(q)) ||
          (c.phone && String(c.phone).includes(q))
      );
    }
    const balanceFilter = (c: Customer) => {
      const balance = Number(c.current_balance ?? c.opening_balance ?? 0);
      return (
        filter === 'all' ||
        (filter === 'with-balance' && !isPartyBalanceSettled(balance)) ||
        (filter === 'zero-balance' && isPartyBalanceSettled(balance))
      );
    };
    return list.filter(balanceFilter);
  }, [allCustomers, search, filter]);

  const filteredSuppliers = useMemo(() => {
    let list = allSuppliers.filter((s) => s.is_active !== false);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          (s.name && s.name.toLowerCase().includes(q)) ||
          (s.phone && String(s.phone).includes(q))
      );
    }
    return list.filter((s) => {
      const balance = partyBalance(s.current_balance, s.opening_balance);
      return (
        filter === 'all' ||
        (filter === 'with-balance' && !isPartyBalanceSettled(balance)) ||
        (filter === 'zero-balance' && isPartyBalanceSettled(balance))
      );
    });
  }, [allSuppliers, search, filter]);

  const paginatedCustomers = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredCustomers.slice(start, start + PAGE_SIZE);
  }, [filteredCustomers, page]);

  const paginatedSuppliers = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredSuppliers.slice(start, start + PAGE_SIZE);
  }, [filteredSuppliers, page]);

  const listLoading = partyTab === 'suppliers' ? suppliersLoading : loading;
  const filteredCount = partyTab === 'suppliers' ? filteredSuppliers.length : filteredCustomers.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'customers',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  useEffect(() => {
    if (selectedCustomerId && !allCustomers.some((c) => c.id === selectedCustomerId)) {
      setSelectedCustomerId(null);
    }
  }, [allCustomers, selectedCustomerId]);

  if (authStatus === 'loading') {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (authStatus === 'denied') {
    return <AccessDenied module="customers" action="view" />;
  }

  const handleSendReminder = async (customerId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!business?.id) return;

    setSendingReminder(customerId);
    try {
      const res = await fetch(`/api/customers/${customerId}/send-reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        const sent = Number(data.sent) || 0;
        const failed = Number(data.failed) || 0;

        if (sent > 0) {
          setToast({ message: `Reminders sent! ${sent} invoice(s) notified.`, type: 'success' });
        } else if (failed > 0) {
          const firstErr =
            Array.isArray(data.errors) && data.errors.length > 0 ? String(data.errors[0]) : '';
          setToast({
            message: firstErr || 'Could not send WhatsApp reminders. Check connection and settings.',
            type: 'error',
          });
        } else {
          setToast({
            message:
              typeof data.message === 'string'
                ? data.message
                : 'No outstanding invoices to send reminders for.',
            type: 'info',
          });
        }
      } else {
        setToast({ message: data.error || 'Failed to send reminders', type: 'error' });
      }
    } catch (error) {
      console.error('Error sending reminder:', error);
      setToast({ message: 'Failed to send reminders. Please try again.', type: 'error' });
    } finally {
      setSendingReminder(null);
    }
  };

  const isDetailOpen = partyTab === 'suppliers' ? selectedSupplierId !== null : selectedCustomerId !== null;

  const toolbar = (
    <>
      <PartyKindTabs value={partyTab} onChange={setPartyTab} />
      {/* Filters - Desktop */}
      <Card padding="md" className="hidden md:block mb-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search name / phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`chip ${filter === 'all' ? 'bg-primary-500 text-white border-primary-500' : ''}`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('with-balance')}
              className={`chip ${filter === 'with-balance' ? 'bg-primary-500 text-white border-primary-500' : ''}`}
            >
              With Balance
            </button>
            <button
              onClick={() => setFilter('zero-balance')}
              className={`chip ${filter === 'zero-balance' ? 'bg-primary-500 text-white border-primary-500' : ''}`}
            >
              Zero Balance
            </button>
          </div>
        </div>
      </Card>

      {/* Mobile Search */}
      <div className="md:hidden relative mb-3">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Name or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-10 w-full h-10 rounded-xl"
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
          placeholder={partyTab === 'suppliers' ? 'Search suppliers' : 'Search customers'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-9 h-9 text-sm w-full"
        />
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {listLoading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-primary-500" />
          </div>
        ) : partyTab === 'suppliers' ? (
          paginatedSuppliers.length === 0 ? (
            <div className="p-8 text-center text-sm text-text-secondary">No suppliers</div>
          ) : (
            paginatedSuppliers.map((supplier) => {
              const balance = partyBalance(supplier.current_balance, supplier.opening_balance);
              const isSelected = supplier.id === selectedSupplierId;
              return (
                <button
                  key={supplier.id}
                  type="button"
                  onClick={() => setSelectedSupplierId(supplier.id)}
                  className={clsx(
                    'w-full text-left p-3 flex items-center gap-3 border-l-[3px] transition-all duration-150 ease-out',
                    isSelected
                      ? 'bg-slate-50 dark:bg-slate-700 border-primary-500 text-text-primary dark:text-white hover:bg-slate-100 dark:hover:bg-slate-600'
                      : 'border-transparent hover:bg-slate-50/95 dark:hover:bg-slate-700/75 hover:border-l-primary-400 dark:hover:border-l-sky-400'
                  )}
                >
                  <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800/40 text-primary-700 dark:text-primary-300 flex items-center justify-center font-bold text-sm shrink-0">
                    {supplier.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-text-primary truncate">{supplier.name}</div>
                    <div className="text-xs text-text-secondary truncate">{supplier.phone || '—'}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={clsx(
                        'text-sm font-semibold',
                        balance > 0
                          ? 'text-amber-600 dark:text-amber-400'
                          : balance < 0
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-text-muted'
                      )}
                    >
                      ₹{Math.abs(balance).toLocaleString('en-IN')}
                    </div>
                    <div className="text-xs text-text-muted">{supplierBalanceHint(balance)}</div>
                  </div>
                </button>
              );
            })
          )
        ) : paginatedCustomers.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-secondary">No customers</div>
        ) : (
          paginatedCustomers.map((customer) => {
            const balance = Number(customer.current_balance ?? customer.opening_balance ?? 0);
            const isSelected = customer.id === selectedCustomerId;
            return (
              <button
                key={customer.id}
                type="button"
                onClick={() => setSelectedCustomerId(customer.id)}
                className={clsx(
                  'w-full text-left p-3 flex items-center gap-3 border-l-[3px] transition-all duration-150 ease-out',
                  isSelected
                    ? 'bg-slate-50 dark:bg-slate-700 border-primary-500 text-text-primary dark:text-white hover:bg-slate-100 dark:hover:bg-slate-600'
                    : 'border-transparent hover:bg-slate-50/95 dark:hover:bg-slate-700/75 hover:border-l-primary-400 dark:hover:border-l-sky-400'
                )}
              >
                <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800/40 text-primary-700 dark:text-primary-300 flex items-center justify-center font-bold text-sm shrink-0">
                  {customer.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm text-text-primary truncate">{customer.name}</div>
                  <div className="text-xs text-text-secondary truncate">
                    {customer.phone || customer.company_name || '—'}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div
                    className={clsx(
                      'text-sm font-semibold',
                      balance > 0
                        ? 'text-amber-600 dark:text-amber-400'
                        : balance < 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-text-muted'
                    )}
                  >
                    ₹{Math.abs(balance).toLocaleString('en-IN')}
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
      {listLoading ? (
        <div className="p-8 flex justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <Card padding="none" className="overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr className="table-header border-b border-border">
                  <th className="table-cell text-left py-4 px-6">Name</th>
                  <th className="table-cell text-left py-4 px-6">Phone</th>
                  <th className="table-cell text-right py-4 px-6">{PARTY_BALANCE_COLUMN_HEADER}</th>
                  <th className="table-cell text-left py-4 px-6">Last Transaction</th>
                  <th className="table-cell text-center py-4 px-6">Actions</th>
                </tr>
              </thead>
              <tbody>
                {partyTab === 'suppliers' ? (
                  paginatedSuppliers.length > 0 ? (
                    paginatedSuppliers.map((supplier) => {
                      const balance = partyBalance(supplier.current_balance, supplier.opening_balance);
                      return (
                        <tr
                          key={supplier.id}
                          className="cursor-pointer border-b border-border last:border-0 transition-colors duration-150 ease-out hover:bg-slate-50 hover:shadow-[inset_3px_0_0_0_rgb(191_219_254)] dark:hover:bg-slate-700/60 dark:hover:shadow-[inset_3px_0_0_0_rgba(56,189,248,0.45)]"
                          onClick={() => setSelectedSupplierId(supplier.id)}
                        >
                          <td className="table-cell text-left py-4 px-6 font-semibold text-text-primary">{supplier.name}</td>
                          <td className="table-cell text-left py-4 px-6 text-text-secondary">{supplier.phone || '-'}</td>
                          <td className="table-cell text-right py-4 px-6 font-bold">
                            {balance > 0 ? (
                              <Chip variant="warning">₹ {balance.toLocaleString('en-IN')}</Chip>
                            ) : balance < 0 ? (
                              <Chip variant="success">₹ {balance.toLocaleString('en-IN')}</Chip>
                            ) : (
                              <span className="text-text-secondary font-normal">₹ 0</span>
                            )}
                          </td>
                          <td className="table-cell text-left py-4 px-6 text-text-muted">{supplierBalanceHint(balance)}</td>
                          <td className="table-cell text-center py-4 px-6">
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                title="View"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedSupplierId(supplier.id);
                                }}
                              >
                                <Eye className="w-4 h-4" />
                              </Button>
                              <Link href={`/suppliers/new?edit=${supplier.id}`} onClick={(e) => e.stopPropagation()}>
                                <Button variant="ghost" size="sm" title="Edit">
                                  <Edit className="w-4 h-4" />
                                </Button>
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-text-secondary">
                        No suppliers found.
                      </td>
                    </tr>
                  )
                ) : paginatedCustomers.length > 0 ? (
                  paginatedCustomers.map((customer) => {
                    const balance = Number(customer.current_balance ?? customer.opening_balance ?? 0);
                    return (
                      <tr
                        key={customer.id}
                        className="cursor-pointer border-b border-border last:border-0 transition-colors duration-150 ease-out hover:bg-slate-50 hover:shadow-[inset_3px_0_0_0_rgb(191_219_254)] dark:hover:bg-slate-700/60 dark:hover:shadow-[inset_3px_0_0_0_rgba(56,189,248,0.45)]"
                        onClick={() => setSelectedCustomerId(customer.id)}
                      >
                        <td className="table-cell text-left py-4 px-6 font-semibold text-text-primary">{customer.name}</td>
                        <td className="table-cell text-left py-4 px-6 text-text-secondary">{customer.phone || '-'}</td>
                        <td className="table-cell text-right py-4 px-6 font-bold">
                          {balance > 0 ? (
                            <Chip variant="warning">₹ {balance.toLocaleString('en-IN')}</Chip>
                          ) : balance < 0 ? (
                            <Chip variant="success">₹ {balance.toLocaleString('en-IN')}</Chip>
                          ) : (
                            <span className="text-text-secondary font-normal">₹ 0</span>
                          )}
                        </td>
                        <td className="table-cell text-left py-4 px-6 text-text-muted">-</td>
                        <td className="table-cell text-center py-4 px-6">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="View"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCustomerId(customer.id);
                              }}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {balance > 0 && customer.phone && (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Send WhatsApp Reminder"
                                onClick={(e) => handleSendReminder(customer.id, e)}
                                disabled={sendingReminder === customer.id}
                              >
                                {sendingReminder === customer.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <MessageCircle className="w-4 h-4 text-green-600" />
                                )}
                              </Button>
                            )}
                            <Link href={`/customers/${customer.id}/edit`} onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="sm" title="Edit">
                                <Edit className="w-4 h-4" />
                              </Button>
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-text-secondary">
                      No customers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </Card>

          <div className="-mx-page-x divide-y divide-border border-y border-border bg-surface md:hidden">
            {partyTab === 'suppliers' ? (
              paginatedSuppliers.length > 0 ? (
                paginatedSuppliers.map((supplier) => {
                  const balance = partyBalance(supplier.current_balance, supplier.opening_balance);
                  return (
                    <MobileListRow
                      key={supplier.id}
                      label={supplier.name}
                      hint={supplier.phone || undefined}
                      onClick={() => setSelectedSupplierId(supplier.id)}
                      trailing={
                        <span className="text-right">
                          <span
                            className={clsx(
                              'block text-sm font-semibold tabular-nums',
                              balance > 0
                                ? 'text-amber-700'
                                : balance < 0
                                  ? 'text-emerald-700'
                                  : 'text-text-muted',
                            )}
                          >
                            ₹{Math.abs(balance).toLocaleString('en-IN')}
                          </span>
                          <span className="block text-xs text-text-muted">{supplierBalanceHint(balance)}</span>
                        </span>
                      }
                    />
                  );
                })
              ) : (
                <div className="px-4 py-10 text-center text-sm text-text-secondary">No suppliers found.</div>
              )
            ) : paginatedCustomers.length > 0 ? (
              paginatedCustomers.map((customer) => {
                const balance = Number(customer.current_balance ?? customer.opening_balance ?? 0);
                return (
                  <MobileListRow
                    key={customer.id}
                    label={customer.name}
                    hint={customer.phone || undefined}
                    onClick={() => setSelectedCustomerId(customer.id)}
                    trailing={
                      <span className="text-right">
                        <span
                          className={clsx(
                            'block text-sm font-semibold tabular-nums',
                            balance > 0
                              ? 'text-amber-700'
                              : balance < 0
                                ? 'text-emerald-700'
                                : 'text-text-muted',
                          )}
                        >
                          ₹{Math.abs(balance).toLocaleString('en-IN')}
                        </span>
                        <span className="block text-xs text-text-muted">{customerBalanceHint(balance)}</span>
                      </span>
                    }
                    actions={
                      balance > 0 && customer.phone ? (
                        <button
                          type="button"
                          onClick={(e) => handleSendReminder(customer.id, e)}
                          disabled={sendingReminder === customer.id}
                          className="inline-flex h-9 w-9 items-center justify-center text-emerald-700 disabled:opacity-50"
                          aria-label={`Remind ${customer.name}`}
                        >
                          {sendingReminder === customer.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MessageCircle className="h-4 w-4" />
                          )}
                        </button>
                      ) : null
                    }
                  />
                );
              })
            ) : (
              <div className="px-4 py-10 text-center text-sm text-text-secondary">No customers found.</div>
            )}
          </div>
        </>
      )}

      {totalPages > 1 && (
        <div className="flex justify-between items-center p-3 md:p-4 mt-2 md:mt-0 rounded-xl md:rounded-none border border-border md:border-0 md:border-t bg-surface md:bg-transparent">
          <p className="text-sm text-text-secondary">
            Page {page} of {totalPages} ({filteredCount} {partyTab === 'suppliers' ? 'suppliers' : 'customers'})
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
    </>
  );

  return (
    <>
      <div className="space-y-3 md:space-y-6 h-full flex flex-col">
        <ListPageHeader
          title="Parties"
          description="Customers you sell to and suppliers you buy from"
          actions={
            <>
              <button
                type="button"
                onClick={() => setShowMobileFilters(true)}
                className="p-2 bg-surface border border-border rounded-lg md:hidden text-text-secondary"
                aria-label="Filters"
              >
                <Filter className="w-5 h-5" />
              </button>
              <Link href={partyTab === 'suppliers' ? '/suppliers/new' : '/customers/new'}>
                <Button className="h-10 px-4">
                  <Plus className="w-4 h-4 md:mr-2" />
                  <span className="hidden md:inline">{partyTab === 'suppliers' ? 'Add Supplier' : 'Add Customer'}</span>
                </Button>
              </Link>
            </>
          }
        />

        <SubscriptionUsageBanner
          businessId={business?.id}
          variant="inline"
          highlightLimit="customers"
        />

        {/* Mobile Filter Bottom Sheet */}
        {showMobileFilters && (
          <div className="fixed inset-0 z-[100] md:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowMobileFilters(false)} />
            <div className="absolute bottom-0 left-0 right-0 bg-surface border-t border-border rounded-t-2xl shadow-xl p-6 animate-slide-up">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-text-primary">Filters</h3>
                <button onClick={() => setShowMobileFilters(false)} className="p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full">
                  <X className="w-5 h-5 text-text-muted" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">Balance Status</label>
                  <div className="flex flex-col gap-2">
                    {[
                      { id: 'all', label: partyTab === 'suppliers' ? 'All Suppliers' : 'All Customers' },
                      { id: 'with-balance', label: 'With Balance' },
                      { id: 'zero-balance', label: 'Zero Balance' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        onClick={() => {
                          setFilter(f.id as any);
                          setShowMobileFilters(false);
                        }}
                        className={`px-4 py-3 rounded-xl text-left text-sm font-medium border transition-colors ${
                          filter === f.id
                            ? 'bg-slate-50 dark:bg-primary-900/35 border-primary-500 text-primary-700 dark:text-primary-300'
                            : 'bg-background/50 dark:bg-slate-900/30 border-border text-text-secondary'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <Button className="w-full mt-8 h-12 rounded-xl" onClick={() => setShowMobileFilters(false)}>
                Apply Filters
              </Button>
            </div>
          </div>
        )}

        <SplitPaneLayout
          isDetailOpen={isDetailOpen}
          onCloseDetail={() => {
            setSelectedCustomerId(null);
            setSelectedSupplierId(null);
          }}
          toolbarSlot={toolbar}
          listSlot={isDetailOpen ? compactList : fullList}
          detailSlot={
            partyTab === 'suppliers' && selectedSupplierId ? (
              <SupplierDetailPanel
                supplierId={selectedSupplierId}
                onClose={() => setSelectedSupplierId(null)}
              />
            ) : selectedCustomerId ? (
              <CustomerDetailPanel
                customerId={selectedCustomerId}
                onClose={() => setSelectedCustomerId(null)}
                onSendReminder={(c) => handleSendReminder(c.id)}
                sendingReminder={sendingReminder === selectedCustomerId}
              />
            ) : null
          }
        />
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
