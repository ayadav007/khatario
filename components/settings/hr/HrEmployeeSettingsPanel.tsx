'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SettingsToggleRow } from '@/components/settings/SettingsToggleRow';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import type { HrEmployeeSettings } from '@/lib/hr/employee-settings';

export function HrEmployeeSettingsPanel() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<HrEmployeeSettings | null>(null);

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/hr-employee?business_id=${business.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id || !settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/hr-employee', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, ...settings }),
      });
      if (!res.ok) {
        toast.error('Could not save');
        return;
      }
      toast.success('Employee settings saved');
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
        <h3 className="settings-section-title">Probation</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-text-primary">Period length</label>
            <Input
              type="number"
              min={0}
              value={settings.probation_period_value}
              onChange={(e) =>
                setSettings({ ...settings, probation_period_value: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-text-primary">Unit</label>
            <select
              className="input w-full"
              value={settings.probation_period_unit}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  probation_period_unit: e.target.value as 'months' | 'weeks',
                })
              }
            >
              <option value="months">Months</option>
              <option value="weeks">Weeks</option>
            </select>
          </div>
        </div>
        <SettingsToggleRow
          title="Auto-confirm when probation ends"
          description="Otherwise HR must confirm manually"
          checked={settings.probation_auto_confirm}
          onToggle={() =>
            setSettings({
              ...settings,
              probation_auto_confirm: !settings.probation_auto_confirm,
            })
          }
        />
      </section>

      <section className="space-y-4">
        <h3 className="settings-section-title">Employee ID series</h3>
        <p className="text-sm text-text-secondary">
          Job titles use Designations from{' '}
          <span className="font-medium">Departments & designations</span>.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Prefix</label>
            <Input
              value={settings.employee_id_prefix}
              onChange={(e) => setSettings({ ...settings, employee_id_prefix: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Number padding</label>
            <Input
              type="number"
              min={1}
              max={8}
              value={settings.employee_id_padding}
              onChange={(e) =>
                setSettings({ ...settings, employee_id_padding: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Next number (optional)</label>
            <Input
              type="number"
              min={1}
              value={settings.employee_id_next_number ?? ''}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  employee_id_next_number: e.target.value ? Number(e.target.value) : null,
                })
              }
              placeholder="Auto"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="settings-section-title">Portal visibility</h3>
        <SettingsToggleRow
          title="Show new joiners"
          description="Highlight recent joiners on the HR dashboard"
          checked={settings.show_new_joiners}
          onToggle={() =>
            setSettings({ ...settings, show_new_joiners: !settings.show_new_joiners })
          }
        />
        <SettingsToggleRow
          title="Show work anniversaries"
          description="Highlight work anniversaries on the HR dashboard"
          checked={settings.show_work_anniversaries}
          onToggle={() =>
            setSettings({
              ...settings,
              show_work_anniversaries: !settings.show_work_anniversaries,
            })
          }
        />
        <SettingsToggleRow
          title="Show department heads"
          description="Show department head cards on the HR dashboard"
          checked={settings.show_department_heads}
          onToggle={() =>
            setSettings({
              ...settings,
              show_department_heads: !settings.show_department_heads,
            })
          }
        />
      </section>

      <Button type="submit" disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save
      </Button>
    </form>
  );
}
