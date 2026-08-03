'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmployeeSearchSelect } from '@/components/hr/EmployeeSearchSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import type {
  OtApprovalChainLevel,
  OtApprovalRoleType,
  OtPolicy,
  OtPolicyRule,
  OtScenario,
} from '@/lib/hr/shift-overtime/types';

const ROLE_LABELS: Record<OtApprovalRoleType, string> = {
  reporting_manager: 'Reporting manager',
  department_head: 'Department head',
  specific_employee: 'Specific employee',
  hr: 'HR',
};

const ROLE_OPTIONS: OtApprovalRoleType[] = [
  'reporting_manager',
  'department_head',
  'specific_employee',
  'hr',
];

const SCENARIO_LABELS: Record<OtScenario, string> = {
  working_day: 'Working day',
  weekly_off: 'Weekly off',
  holiday: 'Holiday',
};

type Bundle = { policy: OtPolicy; rules: OtPolicyRule[] };

export function OtPolicySettingsPanel() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [leaveTypes, setLeaveTypes] = useState<Array<{ id: string; leave_name: string }>>([]);

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const [policyRes, typesRes] = await Promise.all([
        fetch(`/api/settings/ot-policy?business_id=${business.id}`, { credentials: 'include' }),
        fetch(`/api/leave-types?business_id=${business.id}&active_only=true`, { credentials: 'include' }),
      ]);
      if (policyRes.ok) setBundle(await policyRes.json());
      if (typesRes.ok) {
        const data = await typesRes.json();
        setLeaveTypes(data.leave_types ?? data.types ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateRule(scenario: OtScenario, patch: Partial<OtPolicyRule>) {
    if (!bundle) return;
    setBundle({
      ...bundle,
      rules: bundle.rules.map((r) => (r.scenario === scenario ? { ...r, ...patch } : r)),
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id || !bundle) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/ot-policy', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          name: bundle.policy.name,
          prior_notice_days: bundle.policy.prior_notice_days,
          allow_backdated: bundle.policy.allow_backdated,
          max_backdate_days: bundle.policy.max_backdate_days,
          require_justification: bundle.policy.require_justification,
          comp_off_leave_type_id: bundle.policy.comp_off_leave_type_id,
          approval_chain: bundle.policy.approval_chain,
          rules: bundle.rules,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not save');
        return;
      }
      setBundle(data);
      toast.success('Overtime policy saved');
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
        <h3 className="settings-section-title">Application rules</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Policy name</label>
            <Input
              value={bundle.policy.name}
              onChange={(e) =>
                setBundle({ ...bundle, policy: { ...bundle.policy, name: e.target.value } })
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Prior notice (days)</label>
            <Input
              type="number"
              min={0}
              value={bundle.policy.prior_notice_days}
              onChange={(e) =>
                setBundle({
                  ...bundle,
                  policy: { ...bundle.policy, prior_notice_days: Number(e.target.value) },
                })
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Comp-off leave type</label>
            <select
              className="input w-full"
              value={bundle.policy.comp_off_leave_type_id ?? ''}
              onChange={(e) =>
                setBundle({
                  ...bundle,
                  policy: {
                    ...bundle.policy,
                    comp_off_leave_type_id: e.target.value || null,
                  },
                })
              }
            >
              <option value="">Select leave type</option>
              {leaveTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.leave_name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={bundle.policy.allow_backdated}
              onChange={(e) =>
                setBundle({
                  ...bundle,
                  policy: { ...bundle.policy, allow_backdated: e.target.checked },
                })
              }
            />
            Allow backdated requests
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={bundle.policy.require_justification}
              onChange={(e) =>
                setBundle({
                  ...bundle,
                  policy: { ...bundle.policy, require_justification: e.target.checked },
                })
              }
            />
            Require justification
          </label>
        </div>
        {bundle.policy.allow_backdated && (
          <div className="max-w-xs">
            <label className="mb-1 block text-sm font-medium">Max backdate days</label>
            <Input
              type="number"
              min={0}
              value={bundle.policy.max_backdate_days ?? ''}
              onChange={(e) =>
                setBundle({
                  ...bundle,
                  policy: {
                    ...bundle.policy,
                    max_backdate_days: e.target.value ? Number(e.target.value) : null,
                  },
                })
              }
            />
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h3 className="settings-section-title">Pay rules by scenario</h3>
        {bundle.rules.map((rule) => (
          <div
            key={rule.scenario}
            className="grid gap-4 rounded-lg border border-border bg-white p-4 sm:grid-cols-2"
          >
            <p className="sm:col-span-2 text-sm font-semibold text-text-primary">
              {SCENARIO_LABELS[rule.scenario]}
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium">Compensation</label>
              <select
                className="input w-full"
                value={rule.compensation_type}
                onChange={(e) =>
                  updateRule(rule.scenario, {
                    compensation_type: e.target.value as OtPolicyRule['compensation_type'],
                  })
                }
              >
                <option value="monetary">Monetary only</option>
                <option value="comp_off">Comp-off only</option>
                <option value="employee_choice">Employee choice</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Pay mode</label>
              <select
                className="input w-full"
                value={rule.pay_mode}
                onChange={(e) =>
                  updateRule(rule.scenario, {
                    pay_mode: e.target.value as OtPolicyRule['pay_mode'],
                  })
                }
              >
                <option value="multiplier">Salary multiplier</option>
                <option value="fixed_lump">Fixed lump sum</option>
              </select>
            </div>
            {rule.pay_mode === 'multiplier' ? (
              <div>
                <label className="mb-1 block text-sm font-medium">Multiplier</label>
                <Input
                  type="number"
                  step={0.1}
                  min={0}
                  value={rule.multiplier}
                  onChange={(e) =>
                    updateRule(rule.scenario, { multiplier: Number(e.target.value) })
                  }
                />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium">Fixed amount (₹)</label>
                <Input
                  type="number"
                  min={0}
                  value={rule.fixed_amount ?? ''}
                  onChange={(e) =>
                    updateRule(rule.scenario, {
                      fixed_amount: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">Comp-off days</label>
              <Input
                type="number"
                step={0.5}
                min={0}
                value={rule.comp_off_days}
                onChange={(e) =>
                  updateRule(rule.scenario, { comp_off_days: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Minimum minutes</label>
              <Input
                type="number"
                min={0}
                value={rule.min_minutes}
                onChange={(e) =>
                  updateRule(rule.scenario, { min_minutes: Number(e.target.value) })
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={rule.exclude_break}
                onChange={(e) => updateRule(rule.scenario, { exclude_break: e.target.checked })}
              />
              Exclude break duration from OT hours
            </label>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="settings-section-title mb-0">Approval chain (optional)</h3>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              const chain = bundle.policy.approval_chain;
              setBundle({
                ...bundle,
                policy: {
                  ...bundle.policy,
                  approval_chain: [
                    ...chain,
                    { level: chain.length + 1, label: '', role_type: 'reporting_manager' },
                  ],
                },
              });
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add level
          </Button>
        </div>
        {bundle.policy.approval_chain.length === 0 && (
          <p className="text-sm text-text-secondary">
            Empty chain: managers approve via HR approval settings (reporting manager / HR).
          </p>
        )}
        {bundle.policy.approval_chain.map((step, index) => (
          <div
            key={index}
            className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3"
          >
            <div className="w-16 text-sm font-medium">L{step.level}</div>
            <Input
              placeholder="Label"
              value={step.label ?? ''}
              onChange={(e) => {
                const chain = [...bundle.policy.approval_chain];
                chain[index] = { ...step, label: e.target.value };
                setBundle({ ...bundle, policy: { ...bundle.policy, approval_chain: chain } });
              }}
            />
            <select
              className="input"
              value={step.role_type}
              onChange={(e) => {
                const chain = [...bundle.policy.approval_chain];
                chain[index] = {
                  ...step,
                  role_type: e.target.value as OtApprovalRoleType,
                };
                setBundle({ ...bundle, policy: { ...bundle.policy, approval_chain: chain } });
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
                  const chain = [...bundle.policy.approval_chain];
                  chain[index] = { ...step, employee_id: id };
                  setBundle({ ...bundle, policy: { ...bundle.policy, approval_chain: chain } });
                }}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const chain = bundle.policy.approval_chain
                  .filter((_, i) => i !== index)
                  .map((row, i) => ({ ...row, level: i + 1 }));
                setBundle({ ...bundle, policy: { ...bundle.policy, approval_chain: chain } });
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </section>

      <Button type="submit" disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save overtime policy
      </Button>
    </form>
  );
}
