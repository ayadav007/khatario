'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { HrApprovalSettings } from '@/lib/hr/hr-approval-settings';

type UserOption = { id: string; display_name: string };

type ApproverRow = {
  level: number;
  label: string;
  user_id: string;
};

type SubmitOfferApprovalModalProps = {
  open: boolean;
  onClose: () => void;
  businessId: string;
  userId: string;
  candidateId: string;
  onSubmitted: () => void;
  onError: (msg: string) => void;
};

export function SubmitOfferApprovalModal({
  open,
  onClose,
  businessId,
  userId,
  candidateId,
  onSubmitted,
  onError,
}: SubmitOfferApprovalModalProps) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [settings, setSettings] = useState<HrApprovalSettings | null>(null);
  const [rows, setRows] = useState<ApproverRow[]>([
    { level: 1, label: 'Hiring Manager', user_id: '' },
  ]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const qs = () =>
    new URLSearchParams({ business_id: businessId, user_id: userId }).toString();

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const [usersRes, settingsRes] = await Promise.all([
        fetch(`/api/todos/users?${qs()}`),
        fetch(`/api/settings/hr-approval?${qs()}`),
      ]);
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users ?? []);
      }
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setSettings(data.settings);
      }
    } finally {
      setLoading(false);
    }
  }, [open, businessId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!open) return null;

  const maxLevels = settings?.offer_max_levels;
  const minLevels = settings?.offer_min_levels ?? 1;
  const canAdd = maxLevels == null || rows.length < maxLevels;
  const canRemove = rows.length > minLevels;

  const addRow = () => {
    if (!canAdd) return;
    setRows((prev) => [
      ...prev,
      { level: prev.length + 1, label: '', user_id: '' },
    ]);
  };

  const removeRow = (index: number) => {
    if (!canRemove) return;
    setRows((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((r, i) => ({ ...r, level: i + 1 })),
    );
  };

  const updateRow = (index: number, patch: Partial<ApproverRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const submit = async () => {
    if (rows.length < minLevels) {
      onError(`Add at least ${minLevels} approver(s)`);
      return;
    }
    if (rows.some((r) => !r.user_id)) {
      onError('Select an approver for each level');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(
        `/api/hr/recruitment/candidates/${candidateId}/offer?${qs()}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id: businessId,
            user_id: userId,
            action: 'submit_for_approval',
            approvers: rows.map((r) => ({
              level: r.level,
              label: r.label.trim() || undefined,
              user_id: r.user_id,
            })),
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        onError(data.error || 'Failed to submit');
        return;
      }
      onSubmitted();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-text-primary">Submit offer for approval</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <p className="text-sm text-text-secondary">
            Pick approvers for this offer. Each level must approve in order before the next is notified.
            {maxLevels != null ? ` Maximum ${maxLevels} level(s).` : ' Unlimited levels allowed.'}
          </p>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            </div>
          ) : (
            <>
              {rows.map((row, index) => (
                <div key={row.level} className="rounded-lg border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text-primary">Level {row.level}</span>
                    {canRemove && (
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        className="text-text-muted hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <Input
                    label="Step label (optional)"
                    value={row.label}
                    onChange={(e) => updateRow(index, { label: e.target.value })}
                    placeholder="e.g. Finance"
                  />
                  <label className="block text-sm">
                    <span className="text-text-secondary">Approver</span>
                    <select
                      className="mt-1 block w-full rounded-md border border-border px-3 py-2 text-sm"
                      value={row.user_id}
                      onChange={(e) => updateRow(index, { user_id: e.target.value })}
                    >
                      <option value="">Select user</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}

              {canAdd && (
                <Button type="button" variant="secondary" size="sm" onClick={addRow}>
                  <Plus className="mr-1 h-4 w-4" /> Add approval level
                </Button>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={busy || loading}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit for approval'}
          </Button>
        </div>
      </div>
    </div>
  );
}
