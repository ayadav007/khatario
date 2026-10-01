'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FormPageContainer, FormCard, FormSection } from '@/components/ui/FormPageScaffold';
import { Input } from '@/components/ui/Input';
import { AccessDenied } from '@/components/common/AccessDenied';
import { PlSectionSelect } from '@/components/accounts/PlSectionSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { effectivePlSection, plSectionFromGroup, type PlSection } from '@/lib/accounting/pl-sections';
import type { Account, AccountGroup } from '@/types/database';

type AccountRow = Account & { account_group_code?: string | null; account_group_type?: string | null };

interface FormState {
  account_code: string;
  account_name: string;
  account_group_id: string;
  parent_account_id: string;
  pl_section: PlSection | '';
  opening_balance: string;
  opening_balance_type: 'debit' | 'credit';
  description: string;
  is_active: boolean;
}

function toForm(a: AccountRow, groups: AccountGroup[]): FormState {
  const group = groups.find((g) => g.id === a.account_group_id);
  const groupCode = group?.group_code ?? a.account_group_code;
  const groupType = group?.group_type ?? a.account_group_type;
  const fromGroup = plSectionFromGroup(a.account_type, groupCode, groupType);
  const effective = effectivePlSection({ ...a, group_code: groupCode, group_type: groupType });
  return {
    account_code: a.account_code,
    account_name: a.account_name,
    account_group_id: a.account_group_id,
    parent_account_id: a.parent_account_id ?? '',
    pl_section: effective && effective !== fromGroup ? effective : '',
    opening_balance: String(Number(a.opening_balance || 0)),
    opening_balance_type: a.opening_balance_type || 'debit',
    description: a.description ?? '',
    is_active: a.is_active,
  };
}

export default function EditAccountPage() {
  const params = useParams();
  const router = useRouter();
  const accountId = params.id as string;
  const { business, user } = useAuth();
  const { allowed: canUpdate, reason } = useAuthorizationGuard({
    resource: 'settings',
    action: 'update',
    skipCheck: !user?.id || !business?.id,
  });

  const [account, setAccount] = useState<AccountRow | null>(null);
  const [groups, setGroups] = useState<AccountGroup[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [initial, setInitial] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!business?.id || !accountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [accRes, groupRes, listRes] = await Promise.all([
          fetch(`/api/accounts/${accountId}?business_id=${business.id}`),
          fetch(`/api/accounts/groups?business_id=${business.id}`),
          fetch(`/api/accounts?business_id=${business.id}&user_id=${user?.id ?? ''}&limit=1000`),
        ]);
        if (!accRes.ok) {
          router.push('/accounts');
          return;
        }
        const acc = (await accRes.json()).account as AccountRow;
        const grp: AccountGroup[] = groupRes.ok ? (await groupRes.json()).groups || [] : [];
        const list: Account[] = listRes.ok ? (await listRes.json()).accounts || [] : [];
        if (cancelled) return;
        const f = toForm(acc, grp);
        setAccount(acc);
        setGroups(grp);
        setAccounts(list);
        setForm(f);
        setInitial(f);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id, accountId, user?.id, router]);

  if (!canUpdate) {
    return <AccessDenied module="settings" action="update" details={reason} code="ACCOUNT_UPDATE_DENIED" />;
  }

  if (loading || !account || !form || !initial) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  const isSystem = !!account.is_system;
  const isPl = account.account_type === 'income' || account.account_type === 'expense';
  const typeGroups = groups.filter((g) => g.group_type === account.account_type);
  const selectedGroup = groups.find((g) => g.id === form.account_group_id);
  const defaultPlSection = plSectionFromGroup(account.account_type, selectedGroup?.group_code, selectedGroup?.group_type);
  const parentOptions = accounts.filter((a) => a.account_type === account.account_type && a.id !== account.id);
  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });

  const buildChanges = (): Record<string, unknown> => {
    const changes: Record<string, unknown> = {};
    if (form.description !== initial.description) changes.description = form.description || null;
    if (form.is_active !== initial.is_active) changes.is_active = form.is_active;
    if (isSystem) return changes;
    if (form.account_code !== initial.account_code) changes.account_code = form.account_code.trim();
    if (form.account_name !== initial.account_name) changes.account_name = form.account_name.trim();
    if (form.account_group_id !== initial.account_group_id) changes.account_group_id = form.account_group_id;
    if (form.parent_account_id !== initial.parent_account_id) changes.parent_account_id = form.parent_account_id || null;
    const groupChanged = form.account_group_id !== initial.account_group_id;
    if (isPl && (form.pl_section !== initial.pl_section || groupChanged)) {
      const next = form.pl_section || defaultPlSection;
      if (next) changes.pl_section = next;
    }
    if (form.opening_balance !== initial.opening_balance || form.opening_balance_type !== initial.opening_balance_type) {
      changes.opening_balance = parseFloat(form.opening_balance) || 0;
      changes.opening_balance_type = form.opening_balance_type;
    }
    return changes;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id || !user?.id) return;
    if (!form.account_code.trim() || !form.account_name.trim()) {
      setError('Account code and name are required.');
      return;
    }
    const changes = buildChanges();
    if (Object.keys(changes).length === 0) {
      router.push(`/accounts/${accountId}`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}?business_id=${business.id}&user_id=${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      if (!res.ok) {
        setError(getApiErrorMessage(await safeJsonParse(res), 'Failed to update account'));
        return;
      }
      router.push(`/accounts/${accountId}`);
      router.refresh();
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPageContainer className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/accounts/${accountId}`} className="p-2 hover:bg-surface rounded-lg transition border border-border">
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Edit Account</h1>
          <p className="text-text-secondary text-sm mt-1">
            {account.account_code} · {account.account_type}
            {isSystem && ' · System account: only the description and status can be changed.'}
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
                  value={form.account_code}
                  onChange={(e) => set({ account_code: e.target.value })}
                  disabled={isSystem}
                  helperText={isSystem ? undefined : 'Can only be changed while the account has no transactions.'}
                  required
                />
                <Input
                  label="Account Name *"
                  value={form.account_name}
                  onChange={(e) => set({ account_name: e.target.value })}
                  disabled={isSystem}
                  required
                />
              </div>
            </FormSection>

            <FormSection title="Classification" description="Group, optional parent, and where it shows in Profit & Loss.">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 gap-y-6">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Account Group *</label>
                  <select
                    value={form.account_group_id}
                    onChange={(e) => set({ account_group_id: e.target.value, pl_section: '' })}
                    className="input w-full"
                    disabled={isSystem}
                  >
                    {typeGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.group_code} - {g.group_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Parent Account (Optional)</label>
                  <select
                    value={form.parent_account_id}
                    onChange={(e) => set({ parent_account_id: e.target.value })}
                    className="input w-full"
                    disabled={isSystem}
                  >
                    <option value="">None (Top-level account)</option>
                    {parentOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.account_code} - {a.account_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {isPl && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 gap-y-6 mt-6">
                  <PlSectionSelect
                    accountType={account.account_type}
                    value={form.pl_section}
                    defaultSection={defaultPlSection}
                    onChange={(pl_section) => set({ pl_section })}
                    disabled={isSystem}
                    disabledReason="System accounts keep their standard Profit & Loss section."
                  />
                </div>
              )}
            </FormSection>

            {!isSystem && (
              <FormSection title="Opening balance" description="Starting amount and whether it is debit or credit.">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 gap-y-6">
                  <Input
                    label="Opening Balance"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.opening_balance}
                    onChange={(e) => set({ opening_balance: e.target.value })}
                  />
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">Opening Balance Type</label>
                    <select
                      value={form.opening_balance_type}
                      onChange={(e) => set({ opening_balance_type: e.target.value as 'debit' | 'credit' })}
                      className="input w-full"
                    >
                      <option value="debit">Debit</option>
                      <option value="credit">Credit</option>
                    </select>
                  </div>
                </div>
              </FormSection>
            )}

            <FormSection title="Description and status">
              <label className="block text-sm font-medium text-text-secondary mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                className="input w-full"
                rows={3}
              />
              <label className="mt-4 inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
                Active
              </label>
              {!form.is_active && (
                <p className="text-xs text-text-secondary mt-1">
                  Inactive accounts can't be picked for new entries. Their past amounts still appear in reports.
                </p>
              )}
            </FormSection>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg mt-6">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-4 pt-4 mt-6 border-t border-border">
            <Link href={`/accounts/${accountId}`}>
              <Button type="button" variant="outline">Cancel</Button>
            </Link>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </form>
      </FormCard>
    </FormPageContainer>
  );
}
