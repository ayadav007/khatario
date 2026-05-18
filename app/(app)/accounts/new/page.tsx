'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { FormPageContainer, FormCard, FormSection } from '@/components/ui/FormPageScaffold';
import { Input } from '@/components/ui/Input';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { AccountGroup } from '@/types/database';
import Link from 'next/link';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';

export default function NewAccountPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const [loading, setLoading] = useState(false);
  
  // Check authorization before rendering form
  const { allowed: canCreate, reason } = useAuthorizationGuard({
    resource: 'settings',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    account_code: '',
    account_name: '',
    account_type: '',
    account_group_id: '',
    parent_account_id: '',
    nature: '',
    opening_balance: '0',
    opening_balance_type: 'debit',
    description: '',
    sort_order: '0',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (business?.id) {
      fetchGroups();
      fetchAccounts();
    }
  }, [business?.id]);

  useEffect(() => {
    // Auto-set nature based on account type
    if (formData.account_type) {
      const natureMap: Record<string, string> = {
        asset: 'debit',
        liability: 'credit',
        income: 'credit',
        expense: 'debit',
        capital: 'credit',
      };
      setFormData(prev => ({ ...prev, nature: natureMap[formData.account_type] || '' }));
    }
  }, [formData.account_type]);

  useEffect(() => {
    // Filter parent accounts based on selected account type
    if (formData.account_type && accounts.length > 0) {
      const filtered = accounts.filter(acc => 
        acc.account_type === formData.account_type && acc.id !== formData.parent_account_id
      );
      // Update parent account options
    }
  }, [formData.account_type]);

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

  const fetchAccounts = async () => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/accounts?business_id=${business.id}&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    // Validation
    const newErrors: Record<string, string> = {};
    if (!formData.account_code) newErrors.account_code = 'Account code is required';
    if (!formData.account_name) newErrors.account_name = 'Account name is required';
    if (!formData.account_type) newErrors.account_type = 'Account type is required';
    if (!formData.account_group_id) newErrors.account_group_id = 'Account group is required';
    if (!formData.nature) newErrors.nature = 'Nature is required';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          ...formData,
          created_by: user?.id, // Required for authorization
          opening_balance: parseFloat(formData.opening_balance) || 0,
          sort_order: parseInt(formData.sort_order) || 0,
          parent_account_id: formData.parent_account_id || null,
        }),
      });

      if (res.ok) {
        router.push('/accounts');
        router.refresh();
      } else {
        const errorData = await safeJsonParse(res);
        setErrors({ submit: getApiErrorMessage(errorData, 'Failed to create account') });
      }
    } catch (error) {
      console.error('Error creating account:', error);
      setErrors({ submit: 'An unexpected error occurred' });
    } finally {
      setLoading(false);
    }
  };

  const filteredGroups = formData.account_type
    ? groups.filter(g => g.group_type === formData.account_type)
    : groups;

  const filteredParentAccounts = formData.account_type
    ? accounts.filter(acc => acc.account_type === formData.account_type)
    : [];

  if (!canCreate) {
    return (
      <AccessDenied
        module="settings"
        action="create"
        details={reason}
        code="ACCOUNT_CREATE_DENIED"
      />
    );
  }

  return (
    <FormPageContainer className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/accounts"
          className="p-2 hover:bg-surface rounded-lg transition border border-border"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Create New Account</h1>
          <p className="text-text-secondary text-sm mt-1">
            Add a ledger account with code, classification, and optional opening balance.
          </p>
        </div>
      </div>

      <FormCard>
          <form onSubmit={handleSubmit}>
          <div className="form-page-shell">
            <FormSection title="Identity" description="Unique code and display name for this account.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 gap-y-6">
              <Input
                label="Account Code *"
                value={formData.account_code}
                onChange={(e) => setFormData({ ...formData, account_code: e.target.value })}
                required
                error={errors.account_code}
                placeholder="e.g., 1101, 2101"
                helperText="Unique code for this account (e.g., 1101 for Cash)"
              />
              <Input
                label="Account Name *"
                value={formData.account_name}
                onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                required
                error={errors.account_name}
                placeholder="e.g., Cash, Bank Account"
              />
            </div>
            </FormSection>

            <FormSection title="Classification" description="Type, group, optional parent, and debit/credit nature.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 gap-y-6">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Account Type *
                </label>
                <select
                  value={formData.account_type}
                  onChange={(e) => setFormData({ ...formData, account_type: e.target.value, account_group_id: '' })}
                  className="input w-full"
                  required
                >
                  <option value="">Select Type</option>
                  <option value="asset">Asset</option>
                  <option value="liability">Liability</option>
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                  <option value="capital">Capital</option>
                </select>
                {errors.account_type && (
                  <p className="text-red-600 text-sm mt-1">{errors.account_type}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Account Group *
                </label>
                <select
                  value={formData.account_group_id}
                  onChange={(e) => setFormData({ ...formData, account_group_id: e.target.value })}
                  className="input w-full"
                  required
                  disabled={!formData.account_type}
                >
                  <option value="">Select Group</option>
                  {filteredGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.group_code} - {group.group_name}
                    </option>
                  ))}
                </select>
                {errors.account_group_id && (
                  <p className="text-red-600 text-sm mt-1">{errors.account_group_id}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 gap-y-6">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Parent Account (Optional)
                </label>
                <select
                  value={formData.parent_account_id}
                  onChange={(e) => setFormData({ ...formData, parent_account_id: e.target.value })}
                  className="input w-full"
                  disabled={!formData.account_type || filteredParentAccounts.length === 0}
                >
                  <option value="">None (Top-level account)</option>
                  {filteredParentAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.account_code} - {account.account_name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-text-secondary mt-1">
                  Select a parent account to create a sub-account
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Nature *
                </label>
                <select
                  value={formData.nature}
                  onChange={(e) => setFormData({ ...formData, nature: e.target.value })}
                  className="input w-full"
                  required
                  disabled={!formData.account_type}
                >
                  <option value="">Select Nature</option>
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
                {errors.nature && (
                  <p className="text-red-600 text-sm mt-1">{errors.nature}</p>
                )}
                <p className="text-xs text-text-secondary mt-1">
                  {formData.account_type === 'asset' || formData.account_type === 'expense' 
                    ? 'Assets and Expenses are Debit nature'
                    : 'Liabilities, Income, and Capital are Credit nature'}
                </p>
              </div>
            </div>
            </FormSection>

            <FormSection title="Opening balance" description="Starting amount and whether it is debit or credit.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 gap-y-6">
              <Input
                label="Opening Balance"
                type="number"
                value={formData.opening_balance}
                onChange={(e) => setFormData({ ...formData, opening_balance: e.target.value })}
                min="0"
                step="0.01"
                placeholder="0.00"
              />
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Opening Balance Type
                </label>
                <select
                  value={formData.opening_balance_type}
                  onChange={(e) => setFormData({ ...formData, opening_balance_type: e.target.value })}
                  className="input w-full"
                >
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
              </div>
            </div>
            </FormSection>

            <FormSection title="Description" description="Optional notes shown on reports or account detail.">
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="input w-full"
                rows={3}
                placeholder="Optional description for this account"
              />
            </FormSection>
          </div>

            {errors.submit && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg mt-6">
                <p className="text-red-600 text-sm">{errors.submit}</p>
              </div>
            )}

            <div className="flex justify-end gap-4 pt-4 mt-6 border-t border-border">
              <Link href="/accounts">
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Account
              </Button>
            </div>
          </form>
      </FormCard>
    </FormPageContainer>
  );
}

