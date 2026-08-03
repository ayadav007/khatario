'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export type EmployeeOption = {
  id: string;
  name: string;
  employee_code: string;
  department?: string | null;
};

type Props = {
  value: string;
  onChange: (employeeId: string) => void;
  label?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
};

export function EmployeeSearchSelect({
  value,
  onChange,
  label = 'Employee',
  required,
  placeholder = 'Search by name or ID…',
  className,
}: Props) {
  const { business, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/employees?business_id=${business.id}&status=active&user_id=${user.id}`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const data = await res.json();
        setEmployees(
          (data.employees ?? []).map((e: Record<string, unknown>) => ({
            id: String(e.id),
            name: String(e.user_name ?? e.employee_code),
            employee_code: String(e.employee_code),
            department: e.department ? String(e.department) : null,
          })),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.employee_code.toLowerCase().includes(q) ||
        (e.department ?? '').toLowerCase().includes(q),
    );
  }, [employees, query]);

  const selected = employees.find((e) => e.id === value);

  return (
    <div className={className}>
      {label ? (
        <label className="mb-1 block text-sm font-medium text-text-primary">
          {label}
          {required ? ' *' : ''}
        </label>
      ) : null}
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading employees…
        </div>
      ) : (
        <>
          <input
            type="search"
            className="input mb-2 w-full"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
          />
          <select
            className="input w-full"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={required}
          >
            <option value="">Select employee</option>
            {filtered.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.employee_code})
                {e.department ? ` — ${e.department}` : ''}
              </option>
            ))}
          </select>
          {selected ? (
            <p className="mt-1 text-xs text-text-muted">
              Selected: {selected.name} · {selected.employee_code}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
