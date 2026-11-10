'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ReceivableAccountPicker } from '@/components/customers/ReceivableAccountPicker';

type BulkOutcome = {
  customer_id: string;
  ok: boolean;
  transferred_amount?: number;
  error?: string;
};

/**
 * Sets the receivable account of the chosen customers. A customer who already owes money gets a
 * transfer entry dated today; the result lists how many moved and why any did not.
 */
export function BulkReceivableAccountDialog({
  open,
  customers,
  onClose,
  onDone,
}: {
  open: boolean;
  /** The chosen customers; names are shown for the ones that could not be moved. */
  customers: Array<{ id: string; name: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  // undefined until an account is picked: nothing is moved on a default.
  const [accountId, setAccountId] = useState<string | null | undefined>(undefined);
  const [accountLabel, setAccountLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ moved: number; failures: Array<{ name: string; reason: string }> } | null>(null);

  useEffect(() => {
    if (!open) return;
    setAccountId(undefined);
    setAccountLabel('');
    setError(null);
    setOutcome(null);
  }, [open]);

  if (!open) return null;

  const save = async () => {
    if (accountId === undefined) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/customers/receivable-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_ids: customers.map((c) => c.id), receivable_account_id: accountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'Could not change the receivable account.');
        return;
      }
      const results: BulkOutcome[] = Array.isArray(data?.results) ? data.results : [];
      const nameOf = new Map(customers.map((c) => [c.id, c.name]));
      setOutcome({
        moved: results.filter((r) => r.ok).length,
        failures: results
          .filter((r) => !r.ok)
          .map((r) => ({ name: nameOf.get(r.customer_id) ?? 'Customer', reason: r.error || 'Could not be changed' })),
      });
      onDone();
    } catch {
      setError('Could not change the receivable account. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-receivable-account-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white p-4 shadow-xl dark:bg-surface sm:p-5"
      >
        <h2 id="bulk-receivable-account-title" className="text-lg font-semibold text-text-primary">
          Set receivable account
        </h2>

        {outcome ? (
          <div className="mt-3 space-y-3 overflow-y-auto text-sm text-text-primary">
            <p>
              {outcome.moved} {outcome.moved === 1 ? 'customer is' : 'customers are'} now recorded in {accountLabel}.
            </p>
            {outcome.failures.length > 0 && (
              <div>
                <p className="font-medium">
                  {outcome.failures.length} could not be changed:
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-text-secondary">
                  {outcome.failures.map((f, index) => (
                    <li key={`${f.name}-${index}`}>
                      {f.name}: {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-text-secondary">
              {customers.length} {customers.length === 1 ? 'customer' : 'customers'} selected. What each one owes today
              is transferred to the new account with an entry dated today. Earlier entries are not changed.
            </p>
            <ReceivableAccountPicker
              value={accountId}
              disabled={saving}
              helpText={null}
              placeholder="Choose the account to move them to"
              onChange={(id, option) => {
                setAccountId(id);
                setAccountLabel(option?.label ?? 'Accounts Receivable');
              }}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        )}

        <div className="mt-4 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {outcome ? 'Close' : 'Cancel'}
          </Button>
          {!outcome && (
            <Button
              type="button"
              disabled={saving || customers.length === 0 || accountId === undefined}
              onClick={() => void save()}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
