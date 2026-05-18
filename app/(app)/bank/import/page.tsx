'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import type { BankImportPreview, NormalizedBankRow } from '@/lib/bank/types';
import { Trash2, Upload } from 'lucide-react';

export default function BankImportPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [accounts, setAccounts] = useState<
    { id: string; account_name: string; bank_name: string; account_number: string }[]
  >([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<BankImportPreview | null>(null);
  const [rows, setRows] = useState<NormalizedBankRow[]>([]);
  const [openingBalance, setOpeningBalance] = useState<string>('');
  const [closingBalance, setClosingBalance] = useState<string>('');

  const loadAccounts = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    const res = await fetch(
      `/api/bank-accounts?business_id=${encodeURIComponent(business.id)}&user_id=${encodeURIComponent(user.id)}`
    );
    const j = await res.json();
    if (res.ok && Array.isArray(j.accounts)) {
      setAccounts(j.accounts);
      if (j.accounts.length === 1) setBankAccountId(j.accounts[0].id);
    }
  }, [business?.id, user?.id]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !business?.id || !bankAccountId) {
      toast.error('Choose a bank account and file');
      return;
    }
    setUploading(true);
    setPreview(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('bank_account_id', bankAccountId);
      fd.set('business_id', business.id);
      const res = await fetch('/api/bank/import', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error || 'Upload failed');
        return;
      }
      setPreview(j.preview as BankImportPreview);
      setRows((j.preview as BankImportPreview).rows);
      toast.success('Preview ready — review rows before saving');
    } catch {
      toast.error('Network error');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const updateRow = (tempId: string, patch: Partial<NormalizedBankRow>) => {
    setRows((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, ...patch } : r)));
  };

  const removeRow = (tempId: string) => {
    setRows((prev) => prev.filter((r) => r.tempId !== tempId));
  };

  const confirmSave = async () => {
    if (!business?.id || !user?.id || !bankAccountId || !preview || rows.length === 0) {
      toast.error('Nothing to save');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        business_id: business.id,
        created_by_user_id: user.id,
        bank_account_id: bankAccountId,
        file_name: preview.fileName,
        file_type: preview.fileType,
        source_type: preview.sourceType,
        rows: rows.map((r) => ({
          date: r.date,
          description: r.description,
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
        })),
      };
      if (openingBalance.trim() !== '') body.opening_balance = parseFloat(openingBalance);
      if (closingBalance.trim() !== '') body.closing_balance = parseFloat(closingBalance);

      const res = await fetch('/api/bank/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        toast.error(j.error || 'Save failed');
        return;
      }
      toast.success('Statement saved');
      setPreview(null);
      setRows([]);
      window.location.href = `/bank/reconciliation?bank_statement_id=${encodeURIComponent(j.bank_statement_id)}`;
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  };

  if (!business) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold text-text-primary">Bank statement import</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Upload CSV or PDF, review extracted rows, then confirm to save. Nothing is stored until you confirm.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-border bg-white p-4 shadow-sm">
        <label className="block text-sm">
          <span className="font-medium text-text-secondary">Bank account</span>
          <select
            className="mt-1 block min-w-[220px] rounded-md border border-border px-3 py-2 text-sm"
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
          >
            <option value="">Select…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank_name} — {a.account_name} ({a.account_number})
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
          <Upload className="h-4 w-4" />
          {uploading ? 'Reading…' : 'Upload file'}
          <input type="file" accept=".csv,.pdf" className="hidden" disabled={uploading} onChange={onFile} />
        </label>
        <Link
          href="/bank/reconciliation"
          className="text-sm text-primary-600 hover:underline"
        >
          Open reconciliation →
        </Link>
      </div>

      {preview?.sourceType === 'pdf_scanned' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          This appears to be a scanned statement. Please verify carefully.
        </div>
      )}

      {preview?.warnings?.length ? (
        <ul className="list-inside list-disc rounded-lg border border-border bg-gray-50 px-4 py-3 text-xs text-text-secondary">
          {preview.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      {preview && rows.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium text-text-secondary">Opening balance (optional override)</span>
              <input
                type="number"
                step="0.01"
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="font-medium text-text-secondary">Closing balance (optional override)</span>
              <input
                type="number"
                step="0.01"
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                value={closingBalance}
                onChange={(e) => setClosingBalance(e.target.value)}
              />
            </label>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-gray-50 text-text-secondary">
                <tr>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2 text-right">Debit</th>
                  <th className="px-2 py-2 text-right">Credit</th>
                  <th className="px-2 py-2 text-right">Balance</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.tempId} className="border-t border-border">
                    <td className="px-2 py-1">
                      <input
                        className="w-[7.5rem] rounded border border-border px-1 py-0.5 font-mono"
                        value={r.date}
                        onChange={(e) => updateRow(r.tempId, { date: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        className="w-full min-w-[200px] rounded border border-border px-1 py-0.5"
                        value={r.description}
                        onChange={(e) => updateRow(r.tempId, { description: e.target.value })}
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        step="0.01"
                        className="w-24 rounded border border-border px-1 py-0.5 text-right tabular-nums"
                        value={r.debit}
                        onChange={(e) =>
                          updateRow(r.tempId, { debit: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        step="0.01"
                        className="w-24 rounded border border-border px-1 py-0.5 text-right tabular-nums"
                        value={r.credit}
                        onChange={(e) =>
                          updateRow(r.tempId, { credit: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        step="0.01"
                        className="w-28 rounded border border-border px-1 py-0.5 text-right tabular-nums"
                        value={r.balance ?? ''}
                        onChange={(e) =>
                          updateRow(r.tempId, {
                            balance: e.target.value === '' ? null : parseFloat(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        className="text-red-600 hover:text-red-800"
                        onClick={() => removeRow(r.tempId)}
                        aria-label="Delete row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={confirmSave}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Confirm & save'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
