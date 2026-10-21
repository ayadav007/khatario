'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

type Option = { id: string; account_code: string; account_name: string; kind: string };

/**
 * Cash, bank or clearing account for a payment. Hidden for on-account modes.
 * The list comes from the server so the form cannot offer the rest of the chart.
 */
export function SettlementAccountField({
  mode,
  value,
  onChange,
  disabled,
}: {
  mode: string;
  value: string;
  onChange: (accountId: string) => void;
  disabled?: boolean;
}) {
  const { business, user } = useAuth();
  const [options, setOptions] = useState<Option[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [required, setRequired] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    let cancelled = false;
    const params = new URLSearchParams({
      business_id: business.id,
      user_id: user.id,
      payment_mode: mode || 'cash',
    });
    void fetch(`/api/accounting/settlement-accounts?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.mode_class === 'on_account' || data.mode_class === 'transfer') {
          setHidden(true);
          setOptions([]);
          onChange('');
          return;
        }
        setHidden(false);
        const next = Array.isArray(data.accounts) ? (data.accounts as Option[]) : [];
        setOptions(next);
        setRequired(!!data.selection_required);
        setHint(typeof data.error === 'string' ? data.error : null);
        const stillValid = value && next.some((a) => a.id === value);
        if (!stillValid && data.default_account_id) onChange(data.default_account_id);
        if (!stillValid && !data.default_account_id) onChange('');
      })
      .catch(() => {
        if (!cancelled) setHint('Could not load cash and bank accounts.');
      });
    return () => {
      cancelled = true;
    };
    // Reload when the mode changes. `value` is read once per mode so a user choice is kept.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, user?.id, mode]);

  if (hidden) return null;

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        Cash / bank account {required ? <span className="text-red-500">*</span> : null}
      </label>
      <select
        className="w-full rounded-md border border-gray-300 px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required && options.length > 1}
        disabled={disabled || options.length === 0}
      >
        <option value="">{options.length === 0 ? 'No account available' : 'Select account…'}</option>
        {options.map((account) => (
          <option key={account.id} value={account.id}>
            {account.account_code} — {account.account_name}
          </option>
        ))}
      </select>
      {hint ? <p className="mt-1 text-xs text-amber-800">{hint}</p> : null}
    </div>
  );
}
