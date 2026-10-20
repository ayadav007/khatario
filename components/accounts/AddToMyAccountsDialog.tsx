'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';
import { getApiErrorMessage, safeJsonParse } from '@/lib/api-utils';

type PickerAccount = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_group_name?: string;
};

export function AddToMyAccountsDialog({
  open,
  businessId,
  visibleIds,
  manualIds,
  onClose,
  onSaved,
}: {
  open: boolean;
  businessId: string;
  visibleIds: string[];
  manualIds: string[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToastContext();
  const [accounts, setAccounts] = useState<PickerAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(new Set());
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/accounts?business_id=${businessId}`);
        const data = await safeJsonParse(res);
        if (!cancelled && res.ok) setAccounts(data.accounts || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, businessId]);

  const visible = useMemo(() => new Set(visibleIds), [visibleIds]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((account) => {
      if (!q) return true;
      return `${account.account_code} ${account.account_name} ${account.account_group_name || ''} ${account.account_type}`
        .toLowerCase()
        .includes(q);
    });
  }, [accounts, query]);

  const save = async () => {
    if (selected.size === 0 || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/accounts/my-accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_ids: [...manualIds, ...selected] }),
      });
      const data = await safeJsonParse(res);
      if (!res.ok) {
        toast.error(getApiErrorMessage(data, 'Could not add those accounts'));
        return;
      }
      toast.success(
        selected.size === 1 ? 'Added 1 account to My Accounts' : `Added ${selected.size} accounts to My Accounts`,
      );
      await onSaved();
    } catch {
      toast.error('Could not add those accounts');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-to-my-accounts-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white p-4 shadow-xl dark:bg-surface sm:p-5"
      >
        <h2 id="add-to-my-accounts-title" className="text-lg font-semibold text-text-primary">
          Add accounts
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Choose existing accounts to show in My Accounts. This only changes what you see. It does not create an account or post an entry. Accounts above a chosen one are shown with it.
        </p>
        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
          <Input
            placeholder="Search by name or code"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-10"
            aria-label="Search accounts to add"
          />
        </div>
        <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {loading && (
            <li className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
            </li>
          )}
          {!loading && shown.length === 0 && (
            <li className="py-6 text-sm text-text-secondary">No accounts match that search.</li>
          )}
          {shown.map((account) => {
            const already = visible.has(account.id);
            return (
              <li key={account.id}>
                <label className={`flex min-w-0 items-start gap-2 rounded-md px-2 py-2 ${already ? 'opacity-60' : 'hover:bg-gray-50'}`}>
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={already}
                    checked={already || selected.has(account.id)}
                    onChange={(event) => {
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(account.id);
                        else next.delete(account.id);
                        return next;
                      });
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block break-words font-medium text-text-primary">{account.account_name}</span>
                    <span className="block break-words text-sm text-text-secondary">
                      {account.account_code}
                      {account.account_group_name ? ` · ${account.account_group_name}` : ''} · {account.account_type}
                      {already ? ' · Already shown' : ''}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={selected.size === 0 || saving} onClick={() => void save()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add to My Accounts
          </Button>
        </div>
      </div>
    </div>
  );
}
