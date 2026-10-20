'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { descendantIds, parentSelectionPath } from '@/lib/accounting/account-hierarchy';
import type { Account, AccountGroup } from '@/types/database';

type ParentOption = Account & { account_group_name?: string };

export function ParentAccountPicker({
  accounts,
  groups,
  accountType,
  value,
  excludeAccountId,
  onChange,
  disabled,
}: {
  accounts: ParentOption[];
  groups: AccountGroup[];
  accountType: string;
  value: string;
  excludeAccountId?: string;
  onChange: (accountId: string) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const excluded = useMemo(() => {
    if (!excludeAccountId) return new Set<string>();
    const ids = descendantIds(
      accounts.map((a) => ({ id: a.id, parent_account_id: a.parent_account_id ?? null })),
      excludeAccountId,
    );
    ids.add(excludeAccountId);
    return ids;
  }, [accounts, excludeAccountId]);

  const options = useMemo(
    () =>
      accounts
        .filter((a) => a.account_type === accountType && !excluded.has(a.id))
        .sort((a, b) => a.account_code.localeCompare(b.account_code, undefined, { numeric: true })),
    [accounts, accountType, excluded],
  );

  const selected = options.find((a) => a.id === value) || accounts.find((a) => a.id === value);
  const path = selected
    ? parentSelectionPath({ accountId: selected.id, accounts, groups })
    : '';

  useEffect(() => {
    if (!open) setQuery(selected ? `${selected.account_code} — ${selected.account_name}` : '');
  }, [selected, open]);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = options.filter((a) => {
    if (!open || !q || (selected && query === `${selected.account_code} — ${selected.account_name}`)) return true;
    const label = `${a.account_code} ${a.account_name} ${a.account_group_name ?? ''}`.toLowerCase();
    return label.includes(q);
  });

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative w-full min-w-0">
      <label htmlFor={`${listId}-input`} className="block text-sm font-medium text-text-secondary mb-1">
        Parent account
      </label>
      <input
        id={`${listId}-input`}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className="input w-full"
        disabled={disabled || !accountType}
        placeholder={accountType ? 'Search by code or name' : 'Choose an account type first'}
        value={query}
        onFocus={() => {
          if (!disabled && accountType) setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(0);
          if (value && e.target.value === '') onChange('');
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActiveIndex((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            const pick = matches[activeIndex];
            if (pick) choose(pick.id);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {value && (
        <button
          type="button"
          className="mt-1 text-xs text-primary-700 underline-offset-2 hover:underline"
          onClick={() => {
            onChange('');
            setQuery('');
          }}
        >
          Clear parent
        </button>
      )}
      {open && accountType && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-white shadow-lg dark:border-border-dark dark:bg-surface"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose('')}
            >
              No parent — top-level account
            </button>
          </li>
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-text-secondary">No matching accounts of this type.</li>
          )}
          {matches.map((account, index) => {
            const itemPath = parentSelectionPath({ accountId: account.id, accounts, groups });
            return (
              <li key={account.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={account.id === value}
                  className={`w-full px-3 py-2 text-left hover:bg-gray-50 ${index === activeIndex ? 'bg-gray-50' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(account.id)}
                >
                  <span className="block text-sm font-medium">
                    {account.account_code} — {account.account_name}
                  </span>
                  <span className="block text-xs text-text-secondary">{itemPath}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-text-secondary mt-1">
        Optional. Select a parent account to organise this account under an existing account.
      </p>
      {path && (
        <p className="text-sm text-text-primary mt-1 break-words" data-testid="parent-account-path">
          {path}
        </p>
      )}
    </div>
  );
}
