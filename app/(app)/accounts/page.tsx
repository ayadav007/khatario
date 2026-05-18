'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Search, ChevronRight, ChevronDown, Loader2, FileText, Edit, Settings, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Account, AccountGroup } from '@/types/database';
import Link from 'next/link';
import { useToastContext } from '@/contexts/ToastContext';
import { DeleteAction } from '@/components/common/DeleteAction';

interface AccountWithGroup extends Account {
  account_group_name: string;
  account_group_code: string;
  children?: AccountWithGroup[];
}

export default function AccountsPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [accounts, setAccounts] = useState<AccountWithGroup[]>([]);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<string>('all');
  const [initializing, setInitializing] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

  useEffect(() => {
    if (business?.id) {
      fetchAccounts();
      fetchGroups();
    }
  }, [business?.id, viewMode, filterType, pagination.page]);

  useEffect(() => {
    if (business?.id) {
      // Reset to page 1 when view mode or filter changes
      setPagination(prev => ({ ...prev, page: 1 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, viewMode, filterType]);

  const fetchAccounts = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user?.id || '', // Required for authorization
        ...(filterType !== 'all' && { account_type: filterType }),
        ...(viewMode === 'tree' && { tree: 'true' }),
        ...(viewMode === 'list' && { 
          page: pagination.page.toString(),
          limit: pagination.limit.toString(),
        }),
      });

      const res = await fetch(`/api/accounts?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
        if (data.pagination) {
          setPagination(data.pagination);
        }
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchGroups = async () => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/accounts/groups?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || []);
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
    }
  };

  const toggleGroup = (groupId: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId);
    } else {
      newExpanded.add(groupId);
    }
    setExpandedGroups(newExpanded);
  };

  const handleInitializeAccounts = async () => {
    if (!business?.id) return;

    if (!confirm('This will create default Chart of Accounts for your business. Continue?')) {
      return;
    }

    setInitializing(true);
    try {
      const res = await fetch('/api/accounts/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success(`Created ${data.accounts_created} accounts and ${data.account_groups_created} account groups.`);
        fetchAccounts();
        fetchGroups();
      } else {
        toast.error(data.error || 'Failed to initialize accounts');
      }
    } catch (error) {
      console.error('Error initializing accounts:', error);
      toast.error('Failed to initialize accounts. Please check the console for details.');
    } finally {
      setInitializing(false);
    }
  };

  const filteredAccounts = accounts.filter(account => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      account.account_name.toLowerCase().includes(searchLower) ||
      account.account_code.toLowerCase().includes(searchLower) ||
      account.account_group_name?.toLowerCase().includes(searchLower)
    );
  });

  const renderTreeView = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      );
    }

    const renderAccount = (account: AccountWithGroup, level: number = 0) => {
      const hasChildren = account.children && account.children.length > 0;
      const isExpanded = expandedGroups.has(account.id);

      return (
        <div key={account.id} className="border-b border-border">
          <div
            className={`flex items-center py-3 px-4 hover:bg-gray-50 ${level > 0 ? 'pl-8' : ''}`}
            style={{ paddingLeft: `${level * 24 + 16}px` }}
          >
            {hasChildren ? (
              <button
                onClick={() => toggleGroup(account.id)}
                className="mr-2 text-text-secondary hover:text-text-primary"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
            ) : (
              <span className="w-6" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-text-secondary">{account.account_code}</span>
                <span className="font-medium">{account.account_name}</span>
                {account.is_system && (
                  <span className="px-2 py-0.5 bg-slate-100 text-primary-800 text-xs rounded">System</span>
                )}
                {!account.is_active && (
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-800 text-xs rounded">Inactive</span>
                )}
              </div>
              <div className="text-sm text-text-secondary mt-1">
                {account.account_group_name} • {account.account_type}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/accounts/${account.id}`}>
                <Button size="sm" variant="ghost">
                  <FileText className="w-4 h-4" />
                </Button>
              </Link>
              {!account.is_system && (
                <>
                  <Link href={`/accounts/${account.id}/edit`}>
                    <Button size="sm" variant="ghost">
                      <Edit className="w-4 h-4" />
                    </Button>
                  </Link>
                  <DeleteAction
                    entityName="account"
                    variant="deactivate"
                    confirmMessage="This account will be deactivated. Existing transactions will remain intact."
                    disabled={!account.is_active}
                    disabledTooltip="Account is already inactive"
                    deleteFn={async () => {
                      if (!business?.id || !user?.id) throw new Error('Missing business/user context');
                      const res = await fetch(
                        `/api/accounts/${account.id}?business_id=${business.id}&user_id=${user.id}`,
                        {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ is_active: false }),
                        }
                      );
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(data?.error || 'Failed to deactivate account');
                    }}
                    onSuccess={async () => {
                      await fetchAccounts();
                    }}
                  />
                </>
              )}
            </div>
          </div>
          {hasChildren && isExpanded && (
            <div>
              {account.children!.map(child => renderAccount(child, level + 1))}
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="space-y-1">
        {filteredAccounts.map(account => renderAccount(account))}
      </div>
    );
  };

  const renderListView = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      );
    }

    if (filteredAccounts.length === 0) {
      return (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-text-secondary">No accounts found</p>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 font-semibold text-text-primary">Code</th>
              <th className="text-left py-3 px-4 font-semibold text-text-primary">Account Name</th>
              <th className="text-left py-3 px-4 font-semibold text-text-primary">Group</th>
              <th className="text-left py-3 px-4 font-semibold text-text-primary">Type</th>
              <th className="text-left py-3 px-4 font-semibold text-text-primary">Nature</th>
              <th className="text-center py-3 px-4 font-semibold text-text-primary">Status</th>
              <th className="text-center py-3 px-4 font-semibold text-text-primary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.map((account) => (
              <tr key={account.id} className="border-b border-border hover:bg-gray-50">
                <td className="py-4 px-4 font-mono text-sm">{account.account_code}</td>
                <td className="py-4 px-4 font-medium">{account.account_name}</td>
                <td className="py-4 px-4 text-sm text-text-secondary">{account.account_group_name}</td>
                <td className="py-4 px-4">
                  <span className="px-2 py-1 rounded-md text-xs bg-gray-100 text-gray-800">
                    {account.account_type}
                  </span>
                </td>
                <td className="py-4 px-4">
                  <span className={`px-2 py-1 rounded-md text-xs ${
                    account.nature === 'debit' ? 'bg-slate-100 text-primary-800' : 'bg-green-100 text-green-800'
                  }`}>
                    {account.nature}
                  </span>
                </td>
                <td className="py-4 px-4 text-center">
                  {account.is_system && (
                    <span className="px-2 py-1 rounded-md text-xs bg-slate-100 text-primary-800">System</span>
                  )}
                  {!account.is_active && (
                    <span className="px-2 py-1 rounded-md text-xs bg-gray-100 text-gray-800">Inactive</span>
                  )}
                  {account.is_active && !account.is_system && (
                    <span className="px-2 py-1 rounded-md text-xs bg-green-100 text-green-800">Active</span>
                  )}
                </td>
                <td className="py-4 px-4">
                  <div className="flex items-center justify-center gap-2">
                    <Link href={`/accounts/${account.id}`}>
                      <Button size="sm" variant="ghost">
                        <FileText className="w-4 h-4" />
                      </Button>
                    </Link>
                    {!account.is_system && (
                      <>
                        <Link href={`/accounts/${account.id}/edit`}>
                          <Button size="sm" variant="ghost">
                            <Edit className="w-4 h-4" />
                          </Button>
                        </Link>
                        <DeleteAction
                          entityName="account"
                          variant="deactivate"
                          confirmMessage="This account will be deactivated. Existing transactions will remain intact."
                          disabled={!account.is_active}
                          disabledTooltip="Account is already inactive"
                          deleteFn={async () => {
                            if (!business?.id || !user?.id) throw new Error('Missing business/user context');
                            const res = await fetch(
                              `/api/accounts/${account.id}?business_id=${business.id}&user_id=${user.id}`,
                              {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ is_active: false }),
                              }
                            );
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) throw new Error(data?.error || 'Failed to deactivate account');
                          }}
                          onSuccess={async () => {
                            await fetchAccounts();
                          }}
                        />
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Chart of Accounts</h1>
            <p className="text-sm text-text-secondary mt-1">Manage your accounting accounts</p>
          </div>
          <div className="flex gap-3">
            <Link href="/settings/account-mappings">
              <Button variant="secondary">
                <Settings className="w-4 h-4 mr-2" />
                Account Mappings
              </Button>
            </Link>
            {accounts.length === 0 && (
              <Button 
                variant="secondary" 
                onClick={handleInitializeAccounts}
                disabled={initializing}
              >
                {initializing ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Initialize Default Accounts
              </Button>
            )}
            <Link href="/accounts/new">
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Account
              </Button>
            </Link>
          </div>
        </div>

        <Card>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-secondary w-4 h-4" />
              <Input
                placeholder="Search accounts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="input"
              >
                <option value="all">All Types</option>
                <option value="asset">Assets</option>
                <option value="liability">Liabilities</option>
                <option value="income">Income</option>
                <option value="expense">Expenses</option>
                <option value="capital">Capital</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                onClick={() => setViewMode('list')}
                size="sm"
              >
                List
              </Button>
              <Button
                variant={viewMode === 'tree' ? 'secondary' : 'ghost'}
                onClick={() => setViewMode('tree')}
                size="sm"
              >
                Tree
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          {viewMode === 'tree' ? renderTreeView() : renderListView()}

          {/* Pagination Controls (only for list view) */}
          {viewMode === 'list' && pagination.totalPages > 1 && (
            <div className="flex justify-between items-center p-4 border-t border-border">
              <p className="text-sm text-text-secondary">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} accounts)
              </p>
              <div className="flex space-x-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                  disabled={pagination.page === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.totalPages, prev.page + 1) }))}
                  disabled={pagination.page === pagination.totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    
  );
}

