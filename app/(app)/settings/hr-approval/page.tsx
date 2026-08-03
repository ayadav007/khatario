'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import type { HrApprovalMode, HrApprovalSettings } from '@/lib/hr/hr-approval-settings';

const MODE_OPTIONS: { value: HrApprovalMode; label: string; description: string }[] = [
  {
    value: 'permission_any',
    label: 'Anyone with permission',
    description: 'Users with leave/expense update permission can approve any request (current default).',
  },
  {
    value: 'manager_direct_reports',
    label: 'Manager first, HR can override',
    description: 'Direct reporting manager can approve; HR admins with update permission can approve any request.',
  },
  {
    value: 'manager_only',
    label: 'Manager only',
    description: 'Only the direct reporting manager can approve (unless HR override is enabled and they have permission).',
  },
];

function ModeSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: HrApprovalMode;
  onChange: (v: HrApprovalMode) => void;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-text-primary">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as HrApprovalMode)}
        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        {MODE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-text-secondary">
        {MODE_OPTIONS.find((o) => o.value === value)?.description}
      </p>
    </div>
  );
}

export default function HrApprovalSettingsPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<HrApprovalSettings | null>(null);

  const fetchSettings = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user.id,
      });
      const res = await fetch(`/api/settings/hr-approval?${params}`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
      }
    } catch (error) {
      console.error('Error fetching HR approval settings:', error);
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    if (!business?.id || !user?.id || !settings) return;
    setSaving(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user.id,
      });
      const res = await fetch(`/api/settings/hr-approval?${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        toast.success('HR approval settings saved');
      } else {
        const err = await res.json();
        toast.error(err.error || 'Failed to save settings');
      }
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPageShell
      title="HR approvals"
      description="Configure who can approve leave and expense requests"
      icon={Users}
    >
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      ) : settings ? (
        <Card className="max-w-xl space-y-6 p-6">
          <ModeSelect
            id="leave_mode"
            label="Leave approval"
            value={settings.leave_mode}
            onChange={(leave_mode) => setSettings({ ...settings, leave_mode })}
          />
          <ModeSelect
            id="expense_mode"
            label="Expense approval"
            value={settings.expense_mode}
            onChange={(expense_mode) => setSettings({ ...settings, expense_mode })}
          />
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.allow_hr_override}
              onChange={(e) =>
                setSettings({ ...settings, allow_hr_override: e.target.checked })
              }
              className="mt-1 h-4 w-4 rounded border-border text-primary-600 focus:ring-primary-500"
            />
            <span>
              <span className="block text-sm font-medium text-text-primary">
                Allow HR admins to approve any request
              </span>
              <span className="block text-xs text-text-secondary mt-0.5">
                When manager-scoped modes are enabled, users with update permission on leaves or
                expenses can still approve requests outside their team.
              </span>
            </span>
          </label>

          <div className="border-t border-border pt-6 space-y-4">
            <h3 className="text-sm font-semibold text-text-primary">Offer letter approvals</h3>
            <p className="text-xs text-text-secondary">
              When HR submits an offer, they pick approvers for that specific offer. These limits apply per submission.
            </p>
            <Input
              label="Minimum approval levels"
              type="number"
              min={1}
              value={String(settings.offer_min_levels)}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  offer_min_levels: Math.max(1, Number(e.target.value) || 1),
                })
              }
            />
            <label className="block text-sm">
              <span className="text-text-secondary">Maximum approval levels (blank = unlimited)</span>
              <input
                type="number"
                min={1}
                className="mt-1 block w-full rounded-lg border border-border px-3 py-2 text-sm"
                value={settings.offer_max_levels ?? ''}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    offer_max_levels: e.target.value ? Math.max(1, Number(e.target.value)) : null,
                  })
                }
              />
            </label>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save settings'}
          </Button>
        </Card>
      ) : null}
    </SettingsPageShell>
  );
}
