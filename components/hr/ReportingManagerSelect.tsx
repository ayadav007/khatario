'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { clsx } from 'clsx';

export type ReportingManagerOption = {
  id: string;
  employee_code: string;
  user_name: string;
  designation?: string | null;
  department?: string | null;
};

function formatManagerLabel(emp: ReportingManagerOption): string {
  const code = emp.employee_code?.trim();
  const name = emp.user_name?.trim() || 'Unknown';
  return code ? `${code} — ${name}` : name;
}

function formatManagerMeta(emp: ReportingManagerOption): string | null {
  const parts = [emp.designation, emp.department].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

interface ReportingManagerSelectProps {
  businessId: string;
  userId: string;
  value: string;
  onChange: (employeeId: string) => void;
  /** Prevent selecting self (edit flows). */
  excludeEmployeeId?: string;
  disabled?: boolean;
}

export function ReportingManagerSelect({
  businessId,
  userId,
  value,
  onChange,
  excludeEmployeeId,
  disabled = false,
}: ReportingManagerSelectProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ReportingManagerOption[]>([]);
  const [selected, setSelected] = useState<ReportingManagerOption | null>(null);

  const loadSelected = useCallback(async () => {
    if (!value || !businessId || !userId) {
      setSelected(null);
      setQuery('');
      return;
    }
    try {
      const res = await fetch(
        `/api/employees/${value}?business_id=${businessId}&user_id=${userId}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const emp = data.employee as ReportingManagerOption;
      if (emp?.id) {
        setSelected(emp);
        setQuery(formatManagerLabel(emp));
      }
    } catch {
      /* non-blocking */
    }
  }, [value, businessId, userId]);

  useEffect(() => {
    void loadSelected();
  }, [loadSelected]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        if (selected) {
          setQuery(formatManagerLabel(selected));
        } else {
          setQuery('');
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selected]);

  useEffect(() => {
    if (!businessId || !userId) return;

    const trimmed = query.trim();
    if (selected && trimmed === formatManagerLabel(selected)) {
      return;
    }

    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          business_id: businessId,
          user_id: userId,
          status: 'active',
          search: trimmed,
          limit: '20',
          page: '1',
        });
        const res = await fetch(`/api/employees?${params}`);
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = await res.json();
        const rows = (data.employees || []) as ReportingManagerOption[];
        setResults(
          rows.filter((row) => row.id !== excludeEmployeeId),
        );
        setIsOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, businessId, userId, excludeEmployeeId, selected]);

  function clearSelection() {
    setSelected(null);
    setQuery('');
    setResults([]);
    onChange('');
    setIsOpen(false);
  }

  function pick(option: ReportingManagerOption) {
    setSelected(option);
    setQuery(formatManagerLabel(option));
    onChange(option.id);
    setIsOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <label className="mb-1 block text-sm font-medium text-text-secondary">
        Reporting Manager (Optional)
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          className="input w-full pl-9 pr-9"
          placeholder="Search by name, employee code, phone…"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            if (selected && next !== formatManagerLabel(selected)) {
              setSelected(null);
              onChange('');
            }
            setIsOpen(next.trim().length >= 2);
          }}
          onFocus={() => {
            if (query.trim().length >= 2) setIsOpen(true);
          }}
        />
        {(loading || selected || query) && (
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-text-muted" /> : null}
            {(selected || query) && !disabled ? (
              <button
                type="button"
                className="rounded p-1 text-text-muted hover:bg-gray-100 hover:text-text-primary"
                aria-label="Clear manager"
                onClick={clearSelection}
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-text-muted">
        Type at least 2 characters to search active employees.
      </p>

      {isOpen && !disabled ? (
        <ul
          className="absolute z-40 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-white shadow-lg"
          role="listbox"
        >
          <li>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm text-text-secondary hover:bg-gray-50"
              onClick={clearSelection}
            >
              No manager
            </button>
          </li>
          {results.length === 0 && !loading ? (
            <li className="px-3 py-2 text-sm text-text-muted">No employees found</li>
          ) : null}
          {results.map((emp) => {
            const meta = formatManagerMeta(emp);
            return (
              <li key={emp.id}>
                <button
                  type="button"
                  className={clsx(
                    'w-full px-3 py-2 text-left hover:bg-gray-50',
                    value === emp.id && 'bg-gray-50',
                  )}
                  onClick={() => pick(emp)}
                >
                  <span className="block text-sm font-medium text-text-primary">
                    {formatManagerLabel(emp)}
                  </span>
                  {meta ? (
                    <span className="block text-xs text-text-secondary">{meta}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
