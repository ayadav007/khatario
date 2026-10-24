'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, Clock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { AttendanceSitesSettings } from '@/components/hr/AttendanceSitesSettings';
import type {
  AttendancePolicy,
  DailyRateBasis,
  LateDeductionMode,
  LateDetectionMode,
} from '@/lib/hr/attendance-policy';

function CheckboxRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white p-3">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
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

export default function AttendancePolicySettingsPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policy, setPolicy] = useState<AttendancePolicy | null>(null);

  const load = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ business_id: business.id, user_id: user.id });
      const res = await fetch(`/api/settings/attendance-policy?${q}`);
      if (res.ok) {
        const data = await res.json();
        setPolicy(data.policy);
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (next: AttendancePolicy | null = policy) => {
    if (!business?.id || !user?.id || !next) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/attendance-policy`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, user_id: user.id, ...next }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to save');
        return;
      }
      const data = await res.json();
      setPolicy(data.policy);
      toast.success('Attendance policy saved');
    } finally {
      setSaving(false);
    }
  };

  const turnOffGeofence = async () => {
    if (!policy) return;
    await save({ ...policy, geofence_enabled: false });
  };

  if (loading || !policy) {
    return (
      <SettingsPageShell title="Attendance policy" description="Late arrival and LWP rules">
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell
      title="Attendance policy"
      description="Configure how late arrivals, half-days, and absences affect payroll"
    >
      <div className="mx-auto max-w-2xl space-y-6">
        <Card padding="md" className="space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-text-secondary" />
            <h2 className="font-semibold text-text-primary">Late detection</h2>
          </div>
          <label className="block text-sm">
            <span className="text-text-secondary">How to detect late</span>
            <select
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              value={policy.late_detection_mode}
              onChange={(e) =>
                setPolicy({ ...policy, late_detection_mode: e.target.value as LateDetectionMode })
              }
            >
              <option value="none">Do not track late</option>
              <option value="shift_checkin">Auto from shift + check-in time</option>
              <option value="manual_only">Manager marks late manually</option>
              <option value="both">Auto + manual (recommended)</option>
            </select>
          </label>
          <Input
            label="Grace period (minutes)"
            type="number"
            min={0}
            value={String(policy.grace_minutes)}
            onChange={(e) => setPolicy({ ...policy, grace_minutes: Number(e.target.value) || 0 })}
          />
          <Input
            label="Free lates per month (no deduction)"
            type="number"
            min={0}
            value={String(policy.free_lates_per_month)}
            onChange={(e) =>
              setPolicy({ ...policy, free_lates_per_month: Number(e.target.value) || 0 })
            }
          />
        </Card>

        <Card padding="md" className="space-y-4">
          <h2 className="font-semibold text-text-primary">Late salary deduction</h2>
          <CheckboxRow
            label="Enable late deductions"
            description="When off, lates are tracked but not suggested at payroll"
            checked={policy.late_deduction_enabled}
            onChange={(v) => setPolicy({ ...policy, late_deduction_enabled: v })}
          />
          {policy.late_deduction_enabled && (
            <>
              <label className="block text-sm">
                <span className="text-text-secondary">Deduction style</span>
                <select
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={policy.late_deduction_mode}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      late_deduction_mode: e.target.value as LateDeductionMode,
                    })
                  }
                >
                  <option value="none">None</option>
                  <option value="fixed_amount">Fixed amount per late</option>
                  <option value="day_fraction">Fraction of daily salary</option>
                </select>
              </label>
              {policy.late_deduction_mode === 'fixed_amount' && (
                <Input
                  label="Amount per late (₹)"
                  type="number"
                  min={0}
                  step="0.01"
                  value={String(policy.late_fixed_amount)}
                  onChange={(e) =>
                    setPolicy({ ...policy, late_fixed_amount: Number(e.target.value) || 0 })
                  }
                />
              )}
              {policy.late_deduction_mode === 'day_fraction' && (
                <Input
                  label="Day fraction per late (e.g. 0.25 = quarter day)"
                  type="number"
                  min={0}
                  max={1}
                  step="0.01"
                  value={String(policy.late_day_fraction)}
                  onChange={(e) =>
                    setPolicy({ ...policy, late_day_fraction: Number(e.target.value) || 0 })
                  }
                />
              )}
            </>
          )}
        </Card>

        <Card padding="md" className="space-y-4">
          <h2 className="font-semibold text-text-primary">Half-day & absent (LWP)</h2>
          <CheckboxRow
            label="Deduct for half-day attendance"
            checked={policy.half_day_lwp_enabled}
            onChange={(v) => setPolicy({ ...policy, half_day_lwp_enabled: v })}
          />
          {policy.half_day_lwp_enabled && (
            <Input
              label="Half-day deduction (fraction of daily rate)"
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={String(policy.half_day_lwp_fraction)}
              onChange={(e) =>
                setPolicy({ ...policy, half_day_lwp_fraction: Number(e.target.value) || 0 })
              }
            />
          )}
          <CheckboxRow
            label="Deduct for absent days"
            checked={policy.absent_lwp_enabled}
            onChange={(v) => setPolicy({ ...policy, absent_lwp_enabled: v })}
          />
          {policy.absent_lwp_enabled && (
            <Input
              label="Absent deduction (fraction of daily rate, 1 = full day)"
              type="number"
              min={0}
              max={1}
              step="0.01"
              value={String(policy.absent_lwp_fraction)}
              onChange={(e) =>
                setPolicy({ ...policy, absent_lwp_fraction: Number(e.target.value) || 0 })
              }
            />
          )}
        </Card>

        <Card padding="md" className="space-y-4">
          <h2 className="font-semibold text-text-primary">Daily rate for deductions</h2>
          <label className="block text-sm">
            <span className="text-text-secondary">Daily rate basis</span>
            <select
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              value={policy.daily_rate_basis}
              onChange={(e) =>
                setPolicy({ ...policy, daily_rate_basis: e.target.value as DailyRateBasis })
              }
            >
              <option value="gross_calendar_days">Gross ÷ calendar days in pay period</option>
              <option value="gross_26">Gross ÷ 26</option>
              <option value="basic_calendar_days">Basic ÷ calendar days in pay period</option>
              <option value="basic_26">Basic ÷ 26</option>
            </select>
          </label>
          <Input
            label="Max attendance deduction per month (₹, blank = no cap)"
            type="number"
            min={0}
            step="0.01"
            value={
              policy.max_attendance_deduction_per_month != null
                ? String(policy.max_attendance_deduction_per_month)
                : ''
            }
            onChange={(e) =>
              setPolicy({
                ...policy,
                max_attendance_deduction_per_month: e.target.value.trim()
                  ? Number(e.target.value)
                  : null,
              })
            }
          />
          <p className="text-xs text-text-muted">
            Payroll will suggest deductions from these rules. The payroll clerk can edit amounts before
            processing. Requires salary structure (or employee gross) for daily rate calculation.
          </p>
        </Card>

        {/* The single-office geofence is replaced by office sites; an existing one is shown there until moved or turned off. */}
        <AttendanceSitesSettings
          legacyGeofence={
            policy.geofence_enabled &&
            policy.geofence_lat != null &&
            policy.geofence_lng != null &&
            (policy.geofence_radius_m ?? 0) > 0
              ? { lat: policy.geofence_lat, lng: policy.geofence_lng, radius_m: policy.geofence_radius_m ?? 0 }
              : null
          }
          onTurnOffGeofence={turnOffGeofence}
        />

        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save policy'}
          </Button>
        </div>
      </div>
    </SettingsPageShell>
  );
}
