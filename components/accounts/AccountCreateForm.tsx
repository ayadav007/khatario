'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AccountGroupPicker } from '@/components/accounts/AccountGroupPicker';
import { OpeningAsOfDate } from '@/components/accounts/OpeningAsOfDate';
import { ParentAccountPicker } from '@/components/accounts/ParentAccountPicker';
import { useAuth } from '@/contexts/AuthContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { isAccountType, natureForAccountType, suggestNextAccountCode } from '@/lib/accounting/account-hierarchy';
import type { Account, AccountGroup } from '@/types/database';

export function AccountCreateForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const { business, user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [openingTypeTouched, setOpeningTypeTouched] = useState(false);
  const [subAccount, setSubAccount] = useState(false);
  const [suggestedCode, setSuggestedCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    account_code: '',
    account_name: '',
    account_type: '',
    account_group_id: '',
    parent_account_id: '',
    opening_balance: '0',
    opening_balance_type: 'debit' as 'debit' | 'credit',
  });

  useEffect(() => {
    if (!business?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [groupRes, accountRes] = await Promise.all([
          fetch(`/api/accounts/groups?business_id=${business.id}`),
          fetch(`/api/accounts?business_id=${business.id}&user_id=${user?.id ?? ''}&limit=1000`),
        ]);
        if (cancelled) return;
        if (groupRes.ok) {
          const data = await groupRes.json();
          setGroups(data.groups || []);
        }
        if (accountRes.ok) {
          const data = await accountRes.json();
          setAccounts(data.accounts || []);
        }
      } catch (error) {
        console.error('Error loading account form', error);
      } finally {
        if (!cancelled) setAccountsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id, user?.id]);

  useEffect(() => {
    if (!accountsLoaded || !isAccountType(formData.account_type)) return;
    const next = suggestNextAccountCode(
      accounts.map((account) => String(account.account_code ?? '')),
      formData.account_type,
    );
    setSuggestedCode(next);
  }, [accountsLoaded, accounts, formData.account_type]);

  const onGroup = (group: AccountGroup | null) => {
    if (!group || !isAccountType(group.group_type)) {
      setFormData((prev) => ({
        ...prev,
        account_group_id: '',
        account_type: '',
        parent_account_id: '',
      }));
      setSubAccount(false);
      return;
    }
    const nature = natureForAccountType(group.group_type) || 'debit';
    setFormData((prev) => ({
      ...prev,
      account_group_id: group.id,
      account_type: group.group_type,
      parent_account_id: prev.account_type === group.group_type ? prev.parent_account_id : '',
      opening_balance_type: openingTypeTouched ? prev.opening_balance_type : nature,
    }));
    if (formData.account_type && formData.account_type !== group.group_type) setSubAccount(false);
    setErrors((prev) => ({ ...prev, account_group_id: '', account_type: '' }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!business?.id || loading) return;
    const newErrors: Record<string, string> = {};
    if (!formData.account_name.trim()) newErrors.account_name = 'Account name is required';
    if (!formData.account_group_id || !isAccountType(formData.account_type)) {
      newErrors.account_group_id = 'Choose an account type';
    }
    const code = formData.account_code.trim() || suggestedCode;
    if (!code) newErrors.account_code = 'The suggested code is not ready yet. Enter a code or wait a moment.';
    if (subAccount && !formData.parent_account_id) newErrors.parent_account_id = 'Choose the parent account';
    const amount = Number(formData.opening_balance);
    if (!Number.isFinite(amount) || amount < 0) {
      newErrors.opening_balance = 'Opening balance must be zero or a positive amount.';
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    const nature = natureForAccountType(formData.account_type);
    setLoading(true);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          created_by: user?.id,
          account_code: code,
          account_name: formData.account_name.trim(),
          account_type: formData.account_type,
          account_group_id: formData.account_group_id,
          nature,
          opening_balance: amount,
          opening_balance_type: formData.opening_balance_type,
          parent_account_id: subAccount ? formData.parent_account_id : null,
          description: null,
          sort_order: 0,
          pl_section: null,
        }),
      });
      if (res.ok) {
        onCreated();
        return;
      }
      const errorData = await safeJsonParse(res);
      setErrors({ submit: getApiErrorMessage(errorData, 'Failed to create account') });
    } catch (error) {
      console.error('Error creating account', error);
      setErrors({ submit: 'An unexpected error occurred' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
      className="space-y-4"
    >
      <AccountGroupPicker groups={groups} value={formData.account_group_id} onChange={onGroup} />
      {errors.account_group_id && <p className="text-sm text-red-600">{errors.account_group_id}</p>}

      <Input
        label="Account name *"
        value={formData.account_name}
        onChange={(event) => setFormData({ ...formData, account_name: event.target.value })}
        required
        error={errors.account_name}
        placeholder="e.g. Electricity expense"
        autoComplete="off"
      />

      <label className="flex items-center gap-2 text-sm text-text-primary">
        <input
          type="checkbox"
          checked={subAccount}
          onChange={(event) => {
            setSubAccount(event.target.checked);
            if (!event.target.checked) setFormData((prev) => ({ ...prev, parent_account_id: '' }));
          }}
        />
        Make this a sub-account
      </label>
      {subAccount && (
        <div>
          <ParentAccountPicker
            accounts={accounts}
            groups={groups}
            accountType={formData.account_type}
            value={formData.parent_account_id}
            onChange={(parent_account_id) => setFormData({ ...formData, parent_account_id })}
          />
          {errors.parent_account_id && <p className="mt-1 text-sm text-red-600">{errors.parent_account_id}</p>}
        </div>
      )}

      <div>
        <Input
          label="Account code"
          value={formData.account_code}
          onChange={(event) => setFormData({ ...formData, account_code: event.target.value })}
          error={errors.account_code}
          placeholder={suggestedCode ? `Suggested ${suggestedCode}` : 'Optional'}
          autoComplete="off"
          helperText={
            suggestedCode
              ? `Suggested code ${suggestedCode}. Leave this blank to use it. The server still rejects a code that is already used.`
              : 'Choose an account type to see the next free code.'
          }
        />
        {suggestedCode && (
          <p className="mt-1 text-xs text-text-secondary" data-testid="suggested-account-code">
            Suggested code {suggestedCode}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Opening balance"
          type="number"
          inputMode="decimal"
          value={formData.opening_balance}
          onChange={(event) => setFormData({ ...formData, opening_balance: event.target.value })}
          min="0"
          step="0.01"
          error={errors.opening_balance}
          helperText="Zero does not post a voucher."
        />
        <div>
          <label htmlFor="opening-type" className="mb-1 block text-sm font-medium text-text-secondary">
            Dr / Cr
          </label>
          <select
            id="opening-type"
            value={formData.opening_balance_type}
            onChange={(event) => {
              setOpeningTypeTouched(true);
              setFormData({
                ...formData,
                opening_balance_type: event.target.value as 'debit' | 'credit',
              });
            }}
            className="input w-full"
          >
            <option value="debit">Dr</option>
            <option value="credit">Cr</option>
          </select>
        </div>
      </div>
      {business?.id && <OpeningAsOfDate businessId={business.id} />}

      {errors.submit && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
          <p className="text-sm text-red-600">{errors.submit}</p>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end dark:border-border-dark">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}
