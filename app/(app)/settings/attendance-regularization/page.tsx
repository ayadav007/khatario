'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import type { RegularizationSettings } from '@/lib/hr/attendance-regularization-shared';

function CheckboxRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border border-border bg-white p-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-text-primary">{label}</span>
        {description ? (
          <span className="block text-xs text-text-secondary">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

export default function AttendanceRegularizationSettingsPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<RegularizationSettings | null>(null);

  const load = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/attendance-regularization?business_id=${business.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!business?.id || !settings) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/attendance-regularization', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        toast.error('Failed to save');
        return;
      }
      const data = await res.json();
      setSettings(data.settings);
      toast.success('Regularization settings saved');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <SettingsPageShell title="Attendance regularization" description="Loading…" icon={ClipboardCheck}>
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </SettingsPageShell>
    );
  }

  const disabled = !settings.enabled;

  return (
    <SettingsPageShell
      title="Attendance regularization"
      description="Let employees request changes to captured attendance — requires manager approval before logs are updated"
      icon={ClipboardCheck}
      actions={
        <Button type="button" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
      }
    >
      <div className="space-y-6">
        <Card className="p-4">
          <CheckboxRow
            label="Enable attendance regularization"
            description="When off, employees cannot submit regularization requests"
            checked={settings.enabled}
            onChange={(v) => setSettings({ ...settings, enabled: v })}
          />
        </Card>

        <Card className="space-y-3 p-4">
          <h3 className="text-sm font-semibold text-text-primary">What employees can request</h3>
          <CheckboxRow
            label="Missing punch"
            description="Add check-in or check-out when they forgot to clock"
            checked={settings.allow_missing_punch}
            disabled={disabled}
            onChange={(v) => setSettings({ ...settings, allow_missing_punch: v })}
          />
          <CheckboxRow
            label="Override existing logs"
            description="Change timings already captured (biometric, web, mobile)"
            checked={settings.allow_override_existing}
            disabled={disabled}
            onChange={(v) => setSettings({ ...settings, allow_override_existing: v })}
          />
          <CheckboxRow
            label="Delete logs"
            description="Request removal of an incorrect check-in or check-out"
            checked={settings.allow_delete_logs}
            disabled={disabled}
            onChange={(v) => setSettings({ ...settings, allow_delete_logs: v })}
          />
        </Card>

        <Card className="space-y-4 p-4">
          <h3 className="text-sm font-semibold text-text-primary">Limits & safeguards</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Max requests per week"
              type="number"
              min={0}
              placeholder="Unlimited"
              disabled={disabled}
              value={settings.max_requests_per_week ?? ''}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  max_requests_per_week: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
            <Input
              label="Max requests per month"
              type="number"
              min={0}
              placeholder="Unlimited"
              disabled={disabled}
              value={settings.max_requests_per_month ?? ''}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  max_requests_per_month: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
            <Input
              label="Max backdate (days)"
              type="number"
              min={0}
              disabled={disabled}
              value={settings.max_backdate_days}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  max_backdate_days: Math.max(0, Number(e.target.value) || 0),
                })
              }
            />
            <Input
              label="Partial day minimum (minutes)"
              type="number"
              min={0}
              disabled={disabled}
              value={settings.min_minutes_for_partial}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  min_minutes_for_partial: Math.max(0, Number(e.target.value) || 0),
                })
              }
            />
          </div>
          <CheckboxRow
            label="Require reason on every request"
            checked={settings.require_reason}
            disabled={disabled}
            onChange={(v) => setSettings({ ...settings, require_reason: v })}
          />
          <p className="text-xs text-text-secondary">
            Partial day covers late arrival and early departure — requests are allowed only when the
            discrepancy vs shift time is at least the minimum above. All requests go to the employee&apos;s
            reporting manager for approval.
          </p>
        </Card>
      </div>
    </SettingsPageShell>
  );
}
