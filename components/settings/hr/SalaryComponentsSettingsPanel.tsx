'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { STACK_SECTION_CLASS } from '@/lib/page-layout';

type ComponentRow = {
  id: string;
  code: string;
  name: string;
  component_type: 'earning' | 'deduction';
  calculation_type: 'fixed' | 'percent_basic' | 'percent_gross';
  system_key: string | null;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
};

const EMPTY_FORM: {
  code: string;
  name: string;
  component_type: 'earning' | 'deduction';
  calculation_type: 'fixed' | 'percent_basic' | 'percent_gross';
} = {
  code: '',
  name: '',
  component_type: 'earning',
  calculation_type: 'fixed',
};

export function SalaryComponentsSettingsPanel() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [components, setComponents] = useState<ComponentRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCalc, setEditCalc] = useState<ComponentRow['calculation_type']>('fixed');

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/settings/salary-components?business_id=${business.id}&active_only=false`,
        { credentials: 'include' },
      );
      if (res.ok) {
        const data = await res.json();
        setComponents(data.components ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/salary-components', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, ...form }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not create component');
        return;
      }
      toast.success('Component added');
      setShowForm(false);
      setForm(EMPTY_FORM);
      await load();
    } catch {
      toast.error('Could not create component');
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id: string) {
    if (!business?.id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/salary-components/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          name: editName,
          calculation_type: editCalc,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not update');
        return;
      }
      toast.success('Component updated');
      setEditId(null);
      await load();
    } catch {
      toast.error('Could not update');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: ComponentRow) {
    if (!business?.id) return;
    const res = await fetch(`/api/settings/salary-components/${row.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_id: business.id, is_active: !row.is_active }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || 'Could not update');
      return;
    }
    await load();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  const earnings = components.filter((c) => c.component_type === 'earning');
  const deductions = components.filter((c) => c.component_type === 'deduction');

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="font-medium">Salary components</p>
        <p className="mt-1 text-blue-700">
          Define earnings and deductions used on employee salary structures and payslips. System
          components (Basic, HRA, PF…) are always available. Add custom ones like Fuel allowance or
          Canteen deduction.{' '}
          <Link href="/settings/payroll" className="link-primary">
            Payroll / statutory settings
          </Link>
        </p>
      </div>

      <section className={STACK_SECTION_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="settings-section-title mb-0">Catalog</h3>
            <p className="type-body-secondary">Active components appear when editing an employee structure.</p>
          </div>
          <Button type="button" size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="mr-1 h-4 w-4" />
            Add component
          </Button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="mt-4 grid gap-3 rounded-lg border border-border bg-gray-50 p-4 md:grid-cols-2">
            <Input
              label="Code *"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="FUEL"
              required
            />
            <Input
              label="Name *"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Fuel allowance"
              required
            />
            <label className="block text-sm">
              <span className="text-text-secondary">Type</span>
              <select
                className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                value={form.component_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    component_type: e.target.value as 'earning' | 'deduction',
                  })
                }
              >
                <option value="earning">Earning</option>
                <option value="deduction">Deduction</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-text-secondary">Calculation</span>
              <select
                className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                value={form.calculation_type}
                onChange={(e) =>
                  setForm({
                    ...form,
                    calculation_type: e.target.value as ComponentRow['calculation_type'],
                  })
                }
              >
                <option value="fixed">Fixed amount (₹)</option>
                <option value="percent_basic">% of basic</option>
                <option value="percent_gross">% of gross</option>
              </select>
            </label>
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        <ComponentTable
          title="Earnings"
          rows={earnings}
          editId={editId}
          editName={editName}
          editCalc={editCalc}
          saving={saving}
          onEditStart={(row) => {
            setEditId(row.id);
            setEditName(row.name);
            setEditCalc(row.calculation_type);
          }}
          onEditName={setEditName}
          onEditCalc={setEditCalc}
          onSaveEdit={saveEdit}
          onCancelEdit={() => setEditId(null)}
          onToggleActive={toggleActive}
        />
        <ComponentTable
          title="Deductions"
          rows={deductions}
          editId={editId}
          editName={editName}
          editCalc={editCalc}
          saving={saving}
          onEditStart={(row) => {
            setEditId(row.id);
            setEditName(row.name);
            setEditCalc(row.calculation_type);
          }}
          onEditName={setEditName}
          onEditCalc={setEditCalc}
          onSaveEdit={saveEdit}
          onCancelEdit={() => setEditId(null)}
          onToggleActive={toggleActive}
        />
      </section>
    </div>
  );
}

function calcLabel(t: ComponentRow['calculation_type']) {
  if (t === 'percent_basic') return '% of basic';
  if (t === 'percent_gross') return '% of gross';
  return 'Fixed ₹';
}

function ComponentTable({
  title,
  rows,
  editId,
  editName,
  editCalc,
  saving,
  onEditStart,
  onEditName,
  onEditCalc,
  onSaveEdit,
  onCancelEdit,
  onToggleActive,
}: {
  title: string;
  rows: ComponentRow[];
  editId: string | null;
  editName: string;
  editCalc: ComponentRow['calculation_type'];
  saving: boolean;
  onEditStart: (row: ComponentRow) => void;
  onEditName: (v: string) => void;
  onEditCalc: (v: ComponentRow['calculation_type']) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onToggleActive: (row: ComponentRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-6">
      <h4 className="mb-2 text-sm font-semibold text-text-primary">{title}</h4>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-gray-50 text-left text-text-secondary">
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Calc</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-mono text-xs text-text-primary">
                  {row.code}
                  {row.is_system ? (
                    <span className="ml-1 text-text-muted">(system)</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {editId === row.id ? (
                    <input
                      className="w-full rounded border border-border px-2 py-1"
                      value={editName}
                      onChange={(e) => onEditName(e.target.value)}
                    />
                  ) : (
                    <span className="text-text-primary">{row.name}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-text-secondary">
                  {editId === row.id ? (
                    <select
                      className="rounded border border-border px-2 py-1"
                      value={editCalc}
                      onChange={(e) =>
                        onEditCalc(e.target.value as ComponentRow['calculation_type'])
                      }
                    >
                      <option value="fixed">Fixed ₹</option>
                      <option value="percent_basic">% of basic</option>
                      <option value="percent_gross">% of gross</option>
                    </select>
                  ) : (
                    calcLabel(row.calculation_type)
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      row.is_active ? 'text-green-700' : 'text-text-muted'
                    }
                  >
                    {row.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {editId === row.id ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          disabled={saving}
                          onClick={() => onSaveEdit(row.id)}
                        >
                          <Save className="mr-1 h-3 w-3" />
                          Save
                        </Button>
                        <Button type="button" size="sm" variant="secondary" onClick={onCancelEdit}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button type="button" size="sm" variant="secondary" onClick={() => onEditStart(row)}>
                          Edit
                        </Button>
                        {!(row.is_system && row.system_key === 'basic_salary') && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => onToggleActive(row)}
                          >
                            {row.is_active ? 'Deactivate' : 'Activate'}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
