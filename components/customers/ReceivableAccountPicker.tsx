'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  buildReceivableAccountOptions,
  type ReceivableAccountLike,
  type ReceivableAccountOption,
} from '@/lib/customers/receivable-account-options';

type ReceivableAccountsState = {
  loading: boolean;
  controlAccountId: string | null;
  accounts: ReceivableAccountLike[];
};

/**
 * Accounts Receivable and the accounts under it (Domestic Debtors, Foreign Debtors, ...).
 * Empty until the business creates an account under Accounts Receivable in the chart of accounts.
 */
export function useReceivableAccounts(): ReceivableAccountsState & { hasCategories: boolean } {
  const [state, setState] = useState<ReceivableAccountsState>({ loading: true, controlAccountId: null, accounts: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/customers/receivable-accounts', { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        if (cancelled) return;
        setState({
          loading: false,
          controlAccountId: data?.control_account_id ?? null,
          accounts: Array.isArray(data?.accounts) ? data.accounts : [],
        });
      } catch {
        if (!cancelled) setState({ loading: false, controlAccountId: null, accounts: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasCategories = !!state.controlAccountId && state.accounts.some((a) => a.id !== state.controlAccountId && a.is_active);
  return { ...state, hasCategories };
}

const NOT_CHOSEN = '__not_chosen__';

const indent = (option: ReceivableAccountOption) => '   '.repeat(Math.max(option.depth - 1, 0)) + (option.depth > 0 ? '– ' : '');

/**
 * Chooses the ledger account a customer's sales are recorded in. `value` null means Accounts
 * Receivable itself; undefined means nothing is chosen yet, shown as `placeholder`.
 * Renders nothing when the business has no account under Accounts Receivable.
 */
export function ReceivableAccountPicker({
  value,
  onChange,
  disabled,
  label = 'Receivable account',
  helpText = 'Sales to this customer are recorded in this account.',
  placeholder,
}: {
  value: string | null | undefined;
  /** Shown, and not selectable, while `value` is undefined. */
  placeholder?: string;
  onChange: (accountId: string | null, option: ReceivableAccountOption | null) => void;
  disabled?: boolean;
  label?: string;
  helpText?: string | null;
}) {
  const id = useId();
  const { loading, controlAccountId, accounts, hasCategories } = useReceivableAccounts();
  const options = useMemo(
    () => buildReceivableAccountOptions(accounts, controlAccountId, value),
    [accounts, controlAccountId, value],
  );

  if (loading || !hasCategories) return null;

  return (
    <div className="w-full min-w-0">
      <label htmlFor={id} className="block text-sm font-medium text-text-secondary mb-1">
        {label}
      </label>
      <select
        id={id}
        className="input w-full"
        disabled={disabled}
        value={value === undefined ? NOT_CHOSEN : value ?? ''}
        onChange={(event) => {
          const picked = options.find((o) => (o.isControl ? '' : o.id) === event.target.value) ?? null;
          onChange(picked && !picked.isControl ? picked.id : null, picked);
        }}
      >
        {value === undefined && (
          <option value={NOT_CHOSEN} disabled>
            {placeholder ?? 'Choose an account'}
          </option>
        )}
        {options.map((option) => (
          <option key={option.id} value={option.isControl ? '' : option.id}>
            {indent(option)}
            {option.label}
            {option.isControl ? ' (default)' : ''}
            {option.inactive ? ' (inactive)' : ''}
          </option>
        ))}
      </select>
      {helpText && <p className="text-xs text-text-secondary mt-1">{helpText}</p>}
    </div>
  );
}

/**
 * Filter by receivable account for lists and reports. '' = all. The control account's own entry
 * keeps the customers with no account of their own. Renders nothing without category accounts.
 * Pass `source` when the page already loaded the accounts with `useReceivableAccounts`.
 */
export function ReceivableAccountFilter({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (accountId: string) => void;
  className?: string;
}) {
  const source = useReceivableAccounts();
  return <ReceivableAccountFilterSelect value={value} onChange={onChange} className={className} source={source} />;
}

export function ReceivableAccountFilterSelect({
  value,
  onChange,
  className = 'input w-full sm:w-64',
  source,
}: {
  value: string;
  onChange: (accountId: string) => void;
  className?: string;
  source: ReturnType<typeof useReceivableAccounts>;
}) {
  const { loading, controlAccountId, accounts, hasCategories } = source;
  const options = useMemo(() => buildReceivableAccountOptions(accounts, controlAccountId), [accounts, controlAccountId]);

  if (loading || !hasCategories) return null;

  return (
    <select
      aria-label="Receivable account"
      className={className}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">All receivable accounts</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {indent(option)}
          {option.label}
          {option.isControl ? ' (no category)' : ''}
        </option>
      ))}
    </select>
  );
}
