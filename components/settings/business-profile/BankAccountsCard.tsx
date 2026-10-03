'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';

type BankAccount = {
  id: string;
  account_name: string;
  account_number: string;
  bank_name: string;
  ifsc_code?: string | null;
  branch_name?: string | null;
  account_type?: string | null;
  is_active?: boolean;
  notes?: string | null;
};

const EMPTY_FORM = {
  account_name: '',
  account_number: '',
  bank_name: '',
  ifsc_code: '',
  branch_name: '',
  account_type: 'current',
  is_active: true,
  notes: '',
};

function maskAccount(n: string): string {
  const s = String(n || '').replace(/\s/g, '');
  return s.length > 4 ? `XXXX ${s.slice(-4)}` : s;
}

export function BankAccountsCard({ businessId, userId }: { businessId?: string | null; userId?: string | null }) {
  const toast = useToastContext();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/bank-accounts?business_id=${businessId}&user_id=${userId ?? ''}`);
      const data = await res.json();
      if (res.ok) setAccounts(data.accounts || []);
    } catch (error) {
      console.error('[Bank Accounts] Error fetching bank accounts:', error);
    } finally {
      setLoading(false);
    }
  }, [businessId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (a: BankAccount) => {
    setEditing(a);
    setForm({
      account_name: a.account_name || '',
      account_number: a.account_number || '',
      bank_name: a.bank_name || '',
      ifsc_code: a.ifsc_code || '',
      branch_name: a.branch_name || '',
      account_type: a.account_type || 'current',
      is_active: a.is_active !== false,
      notes: a.notes || '',
    });
    setFormOpen(true);
  };

  const close = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    if (!form.account_name || !form.account_number || !form.bank_name) {
      toast.warning('Account name, account number and bank name are required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/bank-accounts', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editing ? { id: editing.id, business_id: businessId, ...form } : { business_id: businessId, ...form }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`Failed to ${editing ? 'update' : 'add'} bank account: ${data.error || 'Unknown error'}`);
        return;
      }
      toast.success(`Bank account ${editing ? 'updated' : 'added'}`);
      close();
      await load();
    } catch (error) {
      console.error('Error saving bank account:', error);
      toast.error('Failed to save bank account');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!businessId) return;
    if (!confirm('Delete this bank account?')) return;
    try {
      const res = await fetch(`/api/bank-accounts?id=${id}&business_id=${businessId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Bank account deleted');
        void load();
      } else {
        const data = await res.json();
        toast.error(`Failed to delete bank account: ${data.error}`);
      }
    } catch (error) {
      console.error('Error deleting bank account:', error);
      toast.error('Failed to delete bank account');
    }
  };

  const firstActiveId = accounts.find((a) => a.is_active !== false)?.id;

  return (
    <div className="card overflow-hidden" data-tour="bp-banks">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2.5 dark:border-border-dark md:px-5">
        <h4 className="text-sm font-semibold text-text-primary">Bank accounts</h4>
        {!formOpen && (
          <Button type="button" size="sm" variant="ghost" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add account
          </Button>
        )}
      </div>

      <div className="px-4 py-4 md:px-5">
        {formOpen ? (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Account name *"
                value={form.account_name}
                onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                placeholder="e.g. Main account"
                required
              />
              <Input
                label="Bank name *"
                value={form.bank_name}
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                placeholder="e.g. HDFC Bank"
                required
              />
              <Input
                label="Account number *"
                value={form.account_number}
                onChange={(e) => setForm({ ...form, account_number: e.target.value })}
                required
              />
              <Input
                label="IFSC code"
                value={form.ifsc_code}
                onChange={(e) => setForm({ ...form, ifsc_code: e.target.value.toUpperCase() })}
                placeholder="HDFC0001234"
                maxLength={11}
              />
              <Input
                label="Branch"
                value={form.branch_name}
                onChange={(e) => setForm({ ...form, branch_name: e.target.value })}
              />
              <div>
                <label className="type-label mb-1.5 block">Account type</label>
                <select
                  value={form.account_type}
                  onChange={(e) => setForm({ ...form, account_type: e.target.value })}
                  className="input"
                >
                  <option value="current">Current</option>
                  <option value="savings">Savings</option>
                  <option value="cc">Cash credit</option>
                  <option value="od">Overdraft</option>
                </select>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-border text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-text-secondary">Active (can appear on invoices)</span>
            </label>
            <div className="flex justify-end gap-2 border-t border-border pt-4 dark:border-border-dark">
              <Button type="button" variant="secondary" size="sm" onClick={close} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" size="sm" isLoading={saving} disabled={saving}>
                {editing ? 'Save' : 'Add account'}
              </Button>
            </div>
          </form>
        ) : loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary-500" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex items-center gap-3 py-2">
            <Building2 className="h-8 w-8 shrink-0 text-text-muted" />
            <div>
              <p className="text-sm text-text-primary">No bank account yet</p>
              <p className="text-xs text-text-secondary">Add one so customers know where to pay from the invoice.</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-border dark:divide-border-dark">
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{a.bank_name}</span>
                    <span className="text-sm text-text-secondary">{maskAccount(a.account_number)}</span>
                    {a.id === firstActiveId ? (
                      <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                        On invoices
                      </span>
                    ) : a.is_active === false ? (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-text-secondary dark:bg-slate-700">
                        Inactive
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-text-secondary">
                    {[a.account_name, a.ifsc_code, a.branch_name].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(a)}
                    className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-slate-50 hover:text-primary-600 dark:hover:bg-slate-800"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(a.id)}
                    className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
