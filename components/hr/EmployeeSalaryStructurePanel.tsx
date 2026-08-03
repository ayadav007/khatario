'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Loader2, Plus, IndianRupee } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';

type StructureRow = Record<string, unknown>;

type ComponentDef = {
  id: string;
  code: string;
  name: string;
  component_type: 'earning' | 'deduction';
  calculation_type: 'fixed' | 'percent_basic' | 'percent_gross';
  system_key: string | null;
  is_active: boolean;
  sort_order: number;
};

type LineRow = {
  component_id: string;
  code: string;
  name: string;
  component_type: 'earning' | 'deduction';
  calculation_type: 'fixed' | 'percent_basic' | 'percent_gross';
  system_key: string | null;
  value: number;
  amount: number;
};

function money(v: unknown) {
  return `₹${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

function valueLabel(line: Pick<LineRow, 'calculation_type' | 'value' | 'amount'>) {
  if (line.calculation_type === 'percent_basic' || line.calculation_type === 'percent_gross') {
    return `${line.value}% (${money(line.amount)})`;
  }
  return money(line.value);
}

export function EmployeeSalaryStructurePanel({
  employeeId,
  businessId,
  userId,
  joiningDate,
}: {
  employeeId: string;
  businessId: string;
  userId: string;
  joiningDate?: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState<StructureRow | null>(null);
  const [history, setHistory] = useState<StructureRow[]>([]);
  const [grossMonthly, setGrossMonthly] = useState<number | null>(null);
  const [components, setComponents] = useState<ComponentDef[]>([]);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  /** component_id → value string */
  const [lineValues, setLineValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { allowed: canEdit } = useAuthorizationGuard({
    resource: 'payroll',
    action: 'create',
    skipCheck: !userId || !businessId,
  });

  const qs = useCallback(
    () => new URLSearchParams({ business_id: businessId, user_id: userId }).toString(),
    [businessId, userId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/employees/${employeeId}/salary-structure?${qs()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to load salary structure');
        return;
      }
      const data = await res.json();
      setActive(data.active ?? null);
      setHistory(data.history ?? []);
      setGrossMonthly(data.gross_monthly ?? null);
      setComponents(data.components ?? []);
      setLines(data.lines ?? []);
    } finally {
      setLoading(false);
    }
  }, [employeeId, qs]);

  useEffect(() => {
    if (employeeId && businessId && userId) load();
  }, [employeeId, businessId, userId, load]);

  const openRevise = () => {
    const vals: Record<string, string> = {};
    for (const c of components) {
      const existing = lines.find((l) => l.component_id === c.id);
      if (existing) {
        vals[c.id] = String(existing.value);
      } else if (c.system_key === 'pf_percentage') {
        vals[c.id] = '12';
      } else {
        vals[c.id] = '0';
      }
    }
    setLineValues(vals);
    setEffectiveFrom(
      joiningDate?.slice(0, 10) ||
        (active ? String(active.effective_from).slice(0, 10) : new Date().toISOString().slice(0, 10)),
    );
    setNotes(active ? String(active.notes ?? '') : '');
    setShowForm(true);
    setSuccess(null);
    setError(null);
  };

  const previewLines = useMemo(() => {
    const basicId = components.find((c) => c.system_key === 'basic_salary')?.id;
    const basic = basicId ? Number(lineValues[basicId] || 0) : 0;
    let gross = basic;
    for (const c of components) {
      if (c.component_type !== 'earning' || c.calculation_type !== 'fixed') continue;
      if (c.system_key === 'basic_salary') continue;
      gross += Number(lineValues[c.id] || 0);
    }
    return components.map((c) => {
      const value = Number(lineValues[c.id] || 0);
      let amount = value;
      if (c.calculation_type === 'percent_basic') amount = Math.round(((basic * value) / 100) * 100) / 100;
      if (c.calculation_type === 'percent_gross') amount = Math.round(((gross * value) / 100) * 100) / 100;
      return { ...c, value, amount };
    });
  }, [components, lineValues]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payloadLines = components.map((c) => ({
        component_id: c.id,
        value: Number(lineValues[c.id] || 0),
      }));
      const res = await fetch(`/api/employees/${employeeId}/salary-structure?${qs()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          user_id: userId,
          effective_from: effectiveFrom,
          notes: notes.trim() || null,
          lines: payloadLines,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save');
        return;
      }
      setShowForm(false);
      setSuccess('Salary structure saved.');
      await load();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </Card>
    );
  }

  const earnLines = lines.filter((l) => l.component_type === 'earning' && (l.value > 0 || l.system_key === 'basic_salary'));
  const dedLines = lines.filter((l) => l.component_type === 'deduction' && l.value > 0);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{success}</div>
      )}

      <Card padding="md">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <IndianRupee className="h-5 w-5 text-text-secondary" />
            <h2 className="text-lg font-semibold text-text-primary">Salary structure</h2>
          </div>
          {canEdit && (
            <Button type="button" size="sm" variant="secondary" onClick={openRevise}>
              <Plus className="mr-1 h-4 w-4" />
              {active ? 'Revise structure' : 'Add structure'}
            </Button>
          )}
        </div>

        <p className="mb-4 text-sm text-text-secondary">
          Components are managed in{' '}
          <Link href="/settings/salary-components" className="link-primary">
            Settings → Salary components
          </Link>
          .
        </p>

        {!active ? (
          <p className="text-sm text-text-secondary">
            No salary structure on file. Add one before running payroll — components will prefill on the salary payment
            form. Employees converted from recruitment get a structure automatically from their offer.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <p className="text-text-secondary">Effective from</p>
                <p className="font-medium text-text-primary">
                  {format(new Date(String(active.effective_from)), 'dd MMM yyyy')}
                  {!active.effective_to ? ' (current)' : ` — ${String(active.effective_to).slice(0, 10)}`}
                </p>
              </div>
              <div>
                <p className="text-text-secondary">Monthly gross</p>
                <p className="text-lg font-bold text-gray-900">{money(grossMonthly)}</p>
              </div>
            </div>

            {earnLines.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Earnings</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {earnLines.map((l) => (
                    <ComponentLine key={l.component_id} label={l.name} value={valueLabel(l)} />
                  ))}
                </div>
              </div>
            )}
            {dedLines.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Deductions</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {dedLines.map((l) => (
                    <ComponentLine key={l.component_id} label={l.name} value={valueLabel(l)} />
                  ))}
                </div>
              </div>
            )}

            {active.notes ? (
              <p className="text-sm text-text-secondary">{String(active.notes)}</p>
            ) : null}
          </div>
        )}
      </Card>

      {history.length > 1 && (
        <Card padding="md">
          <h3 className="mb-3 font-semibold text-text-primary">Revision history</h3>
          <ul className="divide-y divide-border text-sm">
            {history.map((row) => (
              <li key={String(row.id)} className="flex justify-between py-2">
                <span>
                  {format(new Date(String(row.effective_from)), 'dd MMM yyyy')}
                  {row.effective_to
                    ? ` — ${format(new Date(String(row.effective_to)), 'dd MMM yyyy')}`
                    : ' — current'}
                </span>
                <span className="font-medium text-gray-900">{money(row.basic_salary)} basic</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {showForm && canEdit && (
        <Card padding="md">
          <h3 className="mb-4 font-semibold text-text-primary">
            {active ? 'New revision' : 'Add salary structure'}
          </h3>
          <form onSubmit={save} className="space-y-4">
            <Input
              label="Effective from *"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              required
            />

            <div>
              <p className="mb-2 text-sm font-medium text-text-primary">Earnings</p>
              <div className="grid gap-3 md:grid-cols-3">
                {previewLines
                  .filter((c) => c.component_type === 'earning')
                  .map((c) => (
                    <Input
                      key={c.id}
                      label={`${c.name}${c.calculation_type === 'fixed' ? ' (₹)' : ' (%)'}${
                        c.system_key === 'basic_salary' ? ' *' : ''
                      }`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={lineValues[c.id] ?? '0'}
                      onChange={(e) => setLineValues({ ...lineValues, [c.id]: e.target.value })}
                      required={c.system_key === 'basic_salary'}
                    />
                  ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-text-primary">Deductions</p>
              <div className="grid gap-3 md:grid-cols-3">
                {previewLines
                  .filter((c) => c.component_type === 'deduction')
                  .map((c) => (
                    <Input
                      key={c.id}
                      label={`${c.name}${c.calculation_type === 'fixed' ? ' (₹)' : ' (%)'}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={lineValues[c.id] ?? '0'}
                      onChange={(e) => setLineValues({ ...lineValues, [c.id]: e.target.value })}
                    />
                  ))}
              </div>
            </div>

            <label className="block text-sm">
              <span className="text-text-secondary">Notes</span>
              <textarea
                className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save structure'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function ComponentLine({ label, value }: { label: string; value: unknown }) {
  const display =
    typeof value === 'number'
      ? money(value)
      : String(value ?? '—');

  return (
    <div className="rounded-lg border border-border bg-gray-50 px-3 py-2">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="font-medium text-gray-900">{display}</p>
    </div>
  );
}
