'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

type Account = { id: string; account_code: string; account_name: string };

export function ExpenseCategoryModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (category: { id: string; name: string; itc_blocked?: boolean }) => void;
}) {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setAccountId('');
    if (!business?.id || !user?.id) return;
    const params = new URLSearchParams({
      business_id: business.id,
      user_id: user.id,
      account_type: 'expense',
      is_active: 'true',
      pl_section: 'operating_expense',
      limit: '500',
      page: '1',
    });
    void fetch(`/api/accounts?${params.toString()}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { accounts: [] }))
      .then((data) => {
        const list: Account[] = data.accounts || [];
        setAccounts(list);
        const preferred = list.find((account) => account.account_code === '5201') || list[0];
        if (preferred) setAccountId(preferred.id);
      })
      .catch(() => setAccounts([]));
  }, [open, business?.id, user?.id]);

  if (!open) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!business?.id || !name.trim() || !accountId) {
      toast.error('Category name and an expense account are required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/expense-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, name: name.trim(), account_id: accountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.category?.id) {
        toast.error(data.error || 'Could not add the category');
        return;
      }
      onCreated({ id: data.category.id, name: data.category.name || name.trim(), itc_blocked: data.category.itc_blocked });
      toast.success('Category added');
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={(event) => void save(event)} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Add category</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>
        <div className="space-y-3">
          <Input label="Category name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Expense account</span>
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
              required
            >
              <option value="">Select an account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.account_code} — {account.account_name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-gray-500">This is the ledger the category posts to.</span>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" isLoading={saving}>
            Save category
          </Button>
        </div>
      </form>
    </div>
  );
}
