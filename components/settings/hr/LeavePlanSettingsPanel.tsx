'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmployeeSearchSelect } from '@/components/hr/EmployeeSearchSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import type {
  LeaveApprovalChainLevel,
  LeaveApprovalRoleType,
  LeavePlanRestriction,
  LeavePlanTypeRule,
} from '@/lib/hr/leave/types';

const ROLE_LABELS: Record<LeaveApprovalRoleType, string> = {
  reporting_manager: 'Reporting manager',
  department_head: 'Department head',
  specific_employee: 'Specific employee',
  hr: 'HR',
};

const ROLE_OPTIONS: LeaveApprovalRoleType[] = [
  'reporting_manager',
  'department_head',
  'specific_employee',
  'hr',
];

type PlanBundle = {
  plan: {
    id: string;
    name: string;
    calendar_year_start_month: number;
    policy_document_url: string | null;
    application_settings: { manager_can_apply_on_behalf: boolean; hr_can_apply_on_behalf: boolean };
    leave_approval_chain: LeaveApprovalChainLevel[];
    encashment_daily_rate_basis: 'basic_per_30' | 'gross_per_30';
  };
  typeRules: LeavePlanTypeRule[];
  restrictions: LeavePlanRestriction[];
};

export function LeavePlanSettingsPanel() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bundle, setBundle] = useState<PlanBundle | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState<string>('');

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/leave-plan?business_id=${business.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setBundle(data);
        if (data.typeRules?.length && !selectedTypeId) {
          setSelectedTypeId(data.typeRules[0].leave_type_id);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id, selectedTypeId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateTypeRule(patch: Partial<LeavePlanTypeRule>) {
    if (!bundle || !selectedTypeId) return;
    setBundle({
      ...bundle,
      typeRules: bundle.typeRules.map((r) =>
        r.leave_type_id === selectedTypeId ? { ...r, ...patch } : r,
      ),
    });
  }

  const selectedRule = bundle?.typeRules.find((r) => r.leave_type_id === selectedTypeId);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id || !bundle) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/leave-plan', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          name: bundle.plan.name,
          calendar_year_start_month: bundle.plan.calendar_year_start_month,
          policy_document_url: bundle.plan.policy_document_url,
          application_settings: bundle.plan.application_settings,
          leave_approval_chain: bundle.plan.leave_approval_chain,
          encashment_daily_rate_basis: bundle.plan.encashment_daily_rate_basis,
          type_rules: bundle.typeRules,
          restrictions: bundle.restrictions,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not save');
        return;
      }
      setBundle(data);
      toast.success('Leave plan saved');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !bundle) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-8">
      <section className="space-y-4">
        <h3 className="settings-section-title">Plan settings</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Plan name</label>
            <Input
              value={bundle.plan.name}
              onChange={(e) =>
                setBundle({ ...bundle, plan: { ...bundle.plan, name: e.target.value } })
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Leave year starts in</label>
            <select
              className="input w-full"
              value={bundle.plan.calendar_year_start_month}
              onChange={(e) =>
                setBundle({
                  ...bundle,
                  plan: { ...bundle.plan, calendar_year_start_month: Number(e.target.value) },
                })
              }
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {new Date(2000, m - 1, 1).toLocaleString('en-IN', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Encashment daily rate</label>
            <select
              className="input w-full"
              value={bundle.plan.encashment_daily_rate_basis}
              onChange={(e) =>
                setBundle({
                  ...bundle,
                  plan: {
                    ...bundle.plan,
                    encashment_daily_rate_basis: e.target.value as 'basic_per_30' | 'gross_per_30',
                  },
                })
              }
            >
              <option value="basic_per_30">Basic ÷ 30</option>
              <option value="gross_per_30">Gross ÷ 30</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Policy document URL</label>
            <Input
              value={bundle.plan.policy_document_url ?? ''}
              onChange={(e) =>
                setBundle({
                  ...bundle,
                  plan: { ...bundle.plan, policy_document_url: e.target.value || null },
                })
              }
              placeholder="https://…"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={bundle.plan.application_settings.manager_can_apply_on_behalf}
              onChange={(e) =>
                setBundle({
                  ...bundle,
                  plan: {
                    ...bundle.plan,
                    application_settings: {
                      ...bundle.plan.application_settings,
                      manager_can_apply_on_behalf: e.target.checked,
                    },
                  },
                })
              }
            />
            Manager can apply on behalf
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={bundle.plan.application_settings.hr_can_apply_on_behalf}
              onChange={(e) =>
                setBundle({
                  ...bundle,
                  plan: {
                    ...bundle.plan,
                    application_settings: {
                      ...bundle.plan.application_settings,
                      hr_can_apply_on_behalf: e.target.checked,
                    },
                  },
                })
              }
            />
            HR can apply on behalf
          </label>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="settings-section-title">Per leave type rules</h3>
        <select
          className="input max-w-md"
          value={selectedTypeId}
          onChange={(e) => setSelectedTypeId(e.target.value)}
        >
          {bundle.typeRules.map((r) => (
            <option key={r.leave_type_id} value={r.leave_type_id}>
              {r.leave_code} — {r.leave_name}
            </option>
          ))}
        </select>

        {selectedRule && (
          <div className="grid gap-4 rounded-lg border border-border bg-white p-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Annual quota</label>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={selectedRule.annual_quota}
                onChange={(e) => updateTypeRule({ annual_quota: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Accrual mode</label>
              <select
                className="input w-full"
                value={selectedRule.accrual_mode}
                onChange={(e) =>
                  updateTypeRule({
                    accrual_mode: e.target.value as LeavePlanTypeRule['accrual_mode'],
                  })
                }
              >
                <option value="lump_sum">Lump sum (year start)</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Min notice (days)</label>
              <Input
                type="number"
                min={0}
                value={selectedRule.min_notice_days}
                onChange={(e) => updateTypeRule({ min_notice_days: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Year-end treatment</label>
              <select
                className="input w-full"
                value={selectedRule.year_end_treatment}
                onChange={(e) =>
                  updateTypeRule({
                    year_end_treatment: e.target.value as LeavePlanTypeRule['year_end_treatment'],
                  })
                }
              >
                <option value="expire">Expire unused</option>
                <option value="carry_forward">Carry forward</option>
                <option value="encash">Encash</option>
                <option value="carry_or_encash">Carry or encash</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Max carry forward days</label>
              <Input
                type="number"
                min={0}
                value={selectedRule.max_carry_forward_days ?? ''}
                onChange={(e) =>
                  updateTypeRule({
                    max_carry_forward_days: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Rounding</label>
              <select
                className="input w-full"
                value={selectedRule.rounding_mode}
                onChange={(e) =>
                  updateTypeRule({
                    rounding_mode: e.target.value as LeavePlanTypeRule['rounding_mode'],
                  })
                }
              >
                <option value="none">Exact</option>
                <option value="half_day">Half day</option>
                <option value="full_day">Full day</option>
              </select>
            </div>
            <div className="sm:col-span-2 flex flex-wrap gap-4 text-sm">
              {[
                ['employee_can_apply', 'Employee can apply'],
                ['allow_backdated', 'Allow backdated'],
                ['blocked_in_probation', 'Block in probation'],
                ['blocked_in_notice_period', 'Block in notice period'],
                ['requires_comment', 'Requires comment'],
                ['requires_attachment', 'Requires attachment'],
                ['requires_approval', 'Requires approval'],
                ['sandwich_enabled', 'Sandwich policy'],
                ['sandwich_count_weekends', 'Sandwich counts weekends'],
                ['sandwich_count_holidays', 'Sandwich counts holidays'],
                ['prorate_on_join', 'Prorate on join'],
                ['allow_negative_balance', 'Allow negative balance'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedRule[key as keyof LeavePlanTypeRule])}
                    onChange={(e) => updateTypeRule({ [key]: e.target.checked } as Partial<LeavePlanTypeRule>)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="settings-section-title mb-0">Approval chain (optional)</h3>
          <Button type="button" variant="secondary" size="sm" onClick={() => {
            const chain = bundle.plan.leave_approval_chain;
            setBundle({
              ...bundle,
              plan: {
                ...bundle.plan,
                leave_approval_chain: [
                  ...chain,
                  { level: chain.length + 1, label: '', role_type: 'reporting_manager' },
                ],
              },
            });
          }}>
            <Plus className="mr-1 h-4 w-4" />
            Add level
          </Button>
        </div>
        {bundle.plan.leave_approval_chain.length === 0 && (
          <p className="text-sm text-text-secondary">
            Empty chain uses HR approval settings (manager / HR override).
          </p>
        )}
        {bundle.plan.leave_approval_chain.map((step, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
            <div className="w-16 text-sm font-medium">L{step.level}</div>
            <Input
              placeholder="Label"
              value={step.label ?? ''}
              onChange={(e) => {
                const chain = [...bundle.plan.leave_approval_chain];
                chain[index] = { ...step, label: e.target.value };
                setBundle({ ...bundle, plan: { ...bundle.plan, leave_approval_chain: chain } });
              }}
            />
            <select
              className="input"
              value={step.role_type}
              onChange={(e) => {
                const chain = [...bundle.plan.leave_approval_chain];
                chain[index] = {
                  ...step,
                  role_type: e.target.value as LeaveApprovalRoleType,
                };
                setBundle({ ...bundle, plan: { ...bundle.plan, leave_approval_chain: chain } });
              }}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            {step.role_type === 'specific_employee' && (
              <EmployeeSearchSelect
                value={step.employee_id ?? ''}
                onChange={(id) => {
                  const chain = [...bundle.plan.leave_approval_chain];
                  chain[index] = { ...step, employee_id: id };
                  setBundle({ ...bundle, plan: { ...bundle.plan, leave_approval_chain: chain } });
                }}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const chain = bundle.plan.leave_approval_chain
                  .filter((_, i) => i !== index)
                  .map((row, i) => ({ ...row, level: i + 1 }));
                setBundle({ ...bundle, plan: { ...bundle.plan, leave_approval_chain: chain } });
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </section>

      <Button type="submit" disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save leave plan
      </Button>
    </form>
  );
}
