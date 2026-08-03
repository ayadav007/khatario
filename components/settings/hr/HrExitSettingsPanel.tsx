'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmployeeSearchSelect } from '@/components/hr/EmployeeSearchSelect';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import {
  EXIT_APPROVER_ROLE_LABELS,
  type ExitApprovalChainLevel,
  type ExitApproverRoleType,
  type HrExitSettings,
} from '@/lib/hr/exit-settings-shared';

const ROLE_OPTIONS: ExitApproverRoleType[] = [
  'reporting_manager',
  'department_head',
  'specific_employee',
  'hr',
];

export function HrExitSettingsPanel() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<HrExitSettings | null>(null);

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/hr-exit?business_id=${business.id}`, {
        credentials: 'include',
      });
      if (res.ok) setSettings((await res.json()).settings);
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateChain(index: number, patch: Partial<ExitApprovalChainLevel>) {
    if (!settings) return;
    const chain = settings.exit_approval_chain.map((row, i) =>
      i === index ? { ...row, ...patch } : row,
    );
    setSettings({ ...settings, exit_approval_chain: chain });
  }

  function addChainLevel() {
    if (!settings) return;
    const next = settings.exit_approval_chain.length + 1;
    if (
      settings.exit_max_approval_levels != null &&
      next > settings.exit_max_approval_levels
    ) {
      toast.error(`Maximum ${settings.exit_max_approval_levels} levels allowed`);
      return;
    }
    setSettings({
      ...settings,
      exit_approval_chain: [
        ...settings.exit_approval_chain,
        { level: next, label: '', role_type: 'reporting_manager' },
      ],
    });
  }

  function removeChainLevel(index: number) {
    if (!settings) return;
    if (settings.exit_approval_chain.length <= settings.exit_min_approval_levels) {
      toast.error(`At least ${settings.exit_min_approval_levels} level(s) required`);
      return;
    }
    const chain = settings.exit_approval_chain
      .filter((_, i) => i !== index)
      .map((row, i) => ({ ...row, level: i + 1 }));
    setSettings({ ...settings, exit_approval_chain: chain });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id || !settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/hr-exit', {
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
      setSettings(data.settings);
      toast.success('Exit settings saved');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !settings) {
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
        <h3 className="settings-section-title">Notice period</h3>
        <div>
          <label className="mb-1 block text-sm font-medium">Default notice (days)</label>
          <Input
            type="number"
            min={0}
            value={settings.default_notice_period_days}
            onChange={(e) =>
              setSettings({
                ...settings,
                default_notice_period_days: Number(e.target.value),
              })
            }
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-text-primary">Seniority-based rules</p>
          {settings.seniority_notice_rules.map((rule, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div>
                <label className="text-xs text-text-muted">Min years</label>
                <Input
                  type="number"
                  min={0}
                  value={rule.min_years}
                  onChange={(e) => {
                    const rules = [...settings.seniority_notice_rules];
                    rules[i] = { ...rule, min_years: Number(e.target.value) };
                    setSettings({ ...settings, seniority_notice_rules: rules });
                  }}
                />
              </div>
              <div>
                <label className="text-xs text-text-muted">Notice days</label>
                <Input
                  type="number"
                  min={0}
                  value={rule.notice_period_days}
                  onChange={(e) => {
                    const rules = [...settings.seniority_notice_rules];
                    rules[i] = { ...rule, notice_period_days: Number(e.target.value) };
                    setSettings({ ...settings, seniority_notice_rules: rules });
                  }}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setSettings({
                    ...settings,
                    seniority_notice_rules: settings.seniority_notice_rules.filter((_, j) => j !== i),
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setSettings({
                ...settings,
                seniority_notice_rules: [
                  ...settings.seniority_notice_rules,
                  { min_years: 5, notice_period_days: 60 },
                ],
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            Add rule
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="settings-section-title">Resignation approval chain</h3>
          <p className="mt-1 text-sm text-text-secondary">
            Resignations follow this sequence. Reporting manager and department head are resolved
            automatically from the org chart. Terminations skip this chain (HR only).
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Minimum levels"
            type="number"
            min={1}
            value={settings.exit_min_approval_levels}
            onChange={(e) =>
              setSettings({
                ...settings,
                exit_min_approval_levels: Math.max(1, Number(e.target.value) || 1),
              })
            }
          />
          <label className="block text-sm">
            <span className="text-text-secondary">Maximum levels (blank = unlimited)</span>
            <input
              type="number"
              min={1}
              className="input mt-1 w-full"
              value={settings.exit_max_approval_levels ?? ''}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  exit_max_approval_levels: e.target.value
                    ? Math.max(1, Number(e.target.value))
                    : null,
                })
              }
            />
          </label>
        </div>
        <div className="space-y-3">
          {settings.exit_approval_chain.map((row, index) => (
            <div
              key={row.level}
              className="space-y-2 rounded-lg border border-border bg-gray-50 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-text-primary">Level {row.level}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => removeChainLevel(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Input
                placeholder="Label (e.g. Reporting manager)"
                value={row.label ?? ''}
                onChange={(e) => updateChain(index, { label: e.target.value })}
              />
              <select
                className="input w-full text-sm"
                value={row.role_type}
                onChange={(e) =>
                  updateChain(index, {
                    role_type: e.target.value as ExitApproverRoleType,
                    employee_id: undefined,
                  })
                }
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {EXIT_APPROVER_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              {row.role_type === 'specific_employee' ? (
                <EmployeeSearchSelect
                  value={row.employee_id ?? ''}
                  onChange={(employee_id) => updateChain(index, { employee_id })}
                  required
                />
              ) : null}
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={addChainLevel}>
          <Plus className="mr-1 h-4 w-4" />
          Add approval level
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="settings-section-title">Reasons for leaving</h3>
        {settings.exit_reasons.map((reason, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={reason}
              onChange={(e) => {
                const exit_reasons = [...settings.exit_reasons];
                exit_reasons[i] = e.target.value;
                setSettings({ ...settings, exit_reasons });
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setSettings({
                  ...settings,
                  exit_reasons: settings.exit_reasons.filter((_, j) => j !== i),
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            setSettings({ ...settings, exit_reasons: [...settings.exit_reasons, ''] })
          }
        >
          <Plus className="mr-1 h-4 w-4" />
          Add reason
        </Button>
      </section>

      <Button type="submit" disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save
      </Button>
    </form>
  );
}
