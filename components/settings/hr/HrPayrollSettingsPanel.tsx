'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { STACK_SECTION_CLASS } from '@/lib/page-layout';
import type { HrPayrollSettings } from '@/lib/hr/hr-payroll-settings-shared';
import { DEFAULT_HR_PAYROLL_SETTINGS } from '@/lib/hr/hr-payroll-settings-shared';

export function HrPayrollSettingsPanel() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<HrPayrollSettings>({
    ...DEFAULT_HR_PAYROLL_SETTINGS,
  });

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/hr-payroll?business_id=${business.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setSettings({ ...DEFAULT_HR_PAYROLL_SETTINGS, ...(data.settings ?? {}) });
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  function patch<K extends keyof HrPayrollSettings>(key: K, value: HrPayrollSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/hr-payroll', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, ...settings }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not save');
        return;
      }
      setSettings({ ...DEFAULT_HR_PAYROLL_SETTINGS, ...(data.settings ?? {}) });
      toast.success('Payroll preferences saved');
    } catch {
      toast.error('Could not save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-8">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <p className="font-medium">Statutory payroll (PF, ESI, PT)</p>
        <p className="mt-1 text-blue-700">
          Rates below feed salary prefill and payslips. Employer PF/ESI are shown on payslips as
          employer cost (not deducted from net). Form 16 / full ECR filing still planned separately.
          Export a PF contribution CSV from{' '}
          <Link href="/hr/reports" className="link-primary">
            HR Reports
          </Link>
          . Configure Basic/HRA and custom allowances under{' '}
          <Link href="/settings/salary-components" className="link-primary">
            Salary components
          </Link>
          .
        </p>
      </div>

      <section className={STACK_SECTION_CLASS}>
        <h3 className="settings-section-title mb-0">Pay schedule</h3>
        <p className="type-body-secondary">
          Reminder for your payroll team. Runs are created under{' '}
          <Link href="/employees/salary/payments" className="link-primary">
            Salary payments
          </Link>
          .
        </p>
        <div className="max-w-xs">
          <label htmlFor="monthly-pay-day" className="type-label mb-1.5 block">
            Monthly pay day
          </label>
          <select
            id="monthly-pay-day"
            value={settings.monthly_pay_day ?? ''}
            onChange={(e) =>
              patch('monthly_pay_day', e.target.value === '' ? null : Number(e.target.value))
            }
            className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
          >
            <option value="">Not set</option>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className={STACK_SECTION_CLASS}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="settings-section-title mb-0">Provident Fund (EPF)</h3>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={settings.pf_enabled}
              onChange={(e) => patch('pf_enabled', e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Enabled
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Establishment ID"
            value={settings.pf_establishment_id}
            onChange={(e) => patch('pf_establishment_id', e.target.value)}
            disabled={!settings.pf_enabled}
          />
          <Input
            label="Wage ceiling (₹)"
            type="number"
            value={String(settings.pf_wage_ceiling)}
            onChange={(e) => patch('pf_wage_ceiling', Number(e.target.value) || 0)}
            disabled={!settings.pf_enabled}
          />
          <Input
            label="Employee rate %"
            type="number"
            step="0.01"
            value={String(settings.pf_employee_rate)}
            onChange={(e) => patch('pf_employee_rate', Number(e.target.value) || 0)}
            disabled={!settings.pf_enabled}
          />
          <Input
            label="Employer rate %"
            type="number"
            step="0.01"
            value={String(settings.pf_employer_rate)}
            onChange={(e) => patch('pf_employer_rate', Number(e.target.value) || 0)}
            disabled={!settings.pf_enabled}
          />
        </div>
        <p className="text-xs text-text-muted">
          PF wages = min(Basic, ceiling). Structure &quot;fixed PF&quot; overrides employee amount when set.
        </p>
      </section>

      <section className={STACK_SECTION_CLASS}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="settings-section-title mb-0">ESI (ESIC)</h3>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={settings.esi_enabled}
              onChange={(e) => patch('esi_enabled', e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Enabled
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="ESI code"
            value={settings.esi_code}
            onChange={(e) => patch('esi_code', e.target.value)}
            disabled={!settings.esi_enabled}
          />
          <Input
            label="Gross ceiling (₹)"
            type="number"
            value={String(settings.esi_wage_ceiling)}
            onChange={(e) => patch('esi_wage_ceiling', Number(e.target.value) || 0)}
            disabled={!settings.esi_enabled}
          />
          <Input
            label="Employee rate %"
            type="number"
            step="0.01"
            value={String(settings.esi_employee_rate)}
            onChange={(e) => patch('esi_employee_rate', Number(e.target.value) || 0)}
            disabled={!settings.esi_enabled}
          />
          <Input
            label="Employer rate %"
            type="number"
            step="0.01"
            value={String(settings.esi_employer_rate)}
            onChange={(e) => patch('esi_employer_rate', Number(e.target.value) || 0)}
            disabled={!settings.esi_enabled}
          />
        </div>
        <p className="text-xs text-text-muted">
          ESI applies only when gross ≤ ceiling. Above ceiling → ₹0.
        </p>
      </section>

      <section className={STACK_SECTION_CLASS}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="settings-section-title mb-0">Professional Tax</h3>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={settings.pt_enabled}
              onChange={(e) => patch('pt_enabled', e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Enabled
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pt-state" className="type-label mb-1.5 block">
              State
            </label>
            <select
              id="pt-state"
              value={settings.pt_state ?? ''}
              onChange={(e) =>
                patch(
                  'pt_state',
                  e.target.value === ''
                    ? null
                    : (e.target.value as HrPayrollSettings['pt_state']),
                )
              }
              disabled={!settings.pt_enabled}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">Select state</option>
              <option value="MH">Maharashtra</option>
              <option value="KA">Karnataka</option>
              <option value="WB">West Bengal</option>
              <option value="TN">Tamil Nadu</option>
              <option value="GJ">Gujarat</option>
              <option value="DL">Delhi</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <Input
            label="Registration no."
            value={settings.pt_registration_no}
            onChange={(e) => patch('pt_registration_no', e.target.value)}
            disabled={!settings.pt_enabled}
          />
        </div>
        <p className="text-xs text-text-muted">
          Simplified monthly slabs. A fixed PT on the employee salary structure overrides the slab.
        </p>
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save payroll settings
        </Button>
      </div>
    </form>
  );
}
