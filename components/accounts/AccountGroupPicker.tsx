'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { groupAncestorNames, isAccountType } from '@/lib/accounting/account-hierarchy';
import type { AccountGroup } from '@/types/database';

function pathLabel(groups: AccountGroup[], group: AccountGroup): string {
  return groupAncestorNames(groups, group.id).join(' → ');
}

export function AccountGroupPicker({
  groups,
  value,
  onChange,
  accountType,
  disabled,
}: {
  groups: AccountGroup[];
  value: string;
  onChange: (group: AccountGroup | null) => void;
  /** When set, only groups of this account type can be chosen. */
  accountType?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const eligible = useMemo(
    () =>
      groups.filter(
        (group) =>
          isAccountType(group.group_type) && (accountType ? group.group_type === accountType : true),
      ),
    [groups, accountType],
  );

  const selected = eligible.find((group) => group.id === value);
  const selectedLabel = selected ? pathLabel(groups, selected) : '';

  useEffect(() => {
    if (!open) setQuery(selectedLabel);
  }, [open, selectedLabel]);

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, AccountGroup[]>();
    for (const group of eligible) {
      const parent = group.parent_group_id && eligible.some((row) => row.id === group.parent_group_id)
        ? group.parent_group_id
        : null;
      const list = map.get(parent) ?? [];
      list.push(group);
      map.set(parent, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.group_code.localeCompare(b.group_code, undefined, { numeric: true }));
    }
    return map;
  }, [eligible]);

  const q = query.trim().toLowerCase();
  const searching = open && q.length > 0 && q !== selectedLabel.toLowerCase();

  const rows = useMemo(() => {
    if (searching) {
      return eligible
        .filter((group) => {
          const label = `${group.group_code} ${pathLabel(groups, group)}`.toLowerCase();
          return label.includes(q);
        })
        .sort((a, b) => pathLabel(groups, a).localeCompare(pathLabel(groups, b)))
        .map((group) => ({ group, depth: groupAncestorNames(groups, group.id).length - 1, hasChildren: false }));
    }
    const out: Array<{ group: AccountGroup; depth: number; hasChildren: boolean }> = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const group of childrenOf.get(parentId) ?? []) {
        const kids = childrenOf.get(group.id) ?? [];
        out.push({ group, depth, hasChildren: kids.length > 0 });
        if (expanded.has(group.id)) walk(group.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [searching, eligible, groups, q, childrenOf, expanded]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuBox({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, query, rows.length]);

  const choose = (group: AccountGroup) => {
    onChange(group);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative w-full min-w-0">
      <label htmlFor={`${listId}-input`} className="mb-1 block text-sm font-medium text-text-secondary">
        Account type *
      </label>
      <input
        id={`${listId}-input`}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className="input w-full"
        disabled={disabled}
        placeholder="Search account type"
        value={query}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
          if (value && event.target.value === '') onChange(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter' && open) {
            event.preventDefault();
            const row = rows[activeIndex];
            if (row) choose(row.group);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      <p className="mt-1 text-xs text-text-secondary">
        The group classifies the account. Choosing one sets the account type used by the books.
      </p>
      {open && menuBox && typeof document !== 'undefined' && createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="max-h-64 overflow-auto rounded-md border border-border bg-white shadow-lg dark:border-border-dark dark:bg-surface"
          style={{ position: 'fixed', top: menuBox.top, left: menuBox.left, width: menuBox.width, zIndex: 90 }}
        >
          {rows.length === 0 && (
            <li className="px-3 py-2 text-sm text-text-secondary">No matching account types.</li>
          )}
          {rows.map((row, index) => {
            const { group, depth, hasChildren } = row;
            const label = pathLabel(groups, group);
            return (
              <li key={group.id} className="flex items-stretch" style={{ paddingLeft: depth * 16 }}>
                {hasChildren && !searching ? (
                  <button
                    type="button"
                    className="px-2 text-text-secondary"
                    aria-label={expanded.has(group.id) ? `Collapse ${group.group_name}` : `Expand ${group.group_name}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      });
                    }}
                  >
                    {expanded.has(group.id) ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="w-6" />
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={group.id === value}
                  data-testid="account-group-option"
                  className={`min-w-0 flex-1 px-2 py-2 text-left text-sm hover:bg-gray-50 ${index === activeIndex ? 'bg-gray-50' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(group)}
                >
                  <span className="text-text-secondary">{group.group_code}</span> {label}
                </button>
              </li>
            );
          })}
        </ul>,
        document.body,
      )}
    </div>
  );
}
