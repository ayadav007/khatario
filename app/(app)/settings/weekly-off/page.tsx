'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import type { WeeklyOffPolicy } from '@/lib/hr/shift-overtime/types';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function WeeklyOffSettingsPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policy, setPolicy] = useState<WeeklyOffPolicy>({ fixed_days: [0], nth_rules: [] });

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/weekly-off?business_id=${business.id}`, { credentials: 'include' });
      if (res.ok) setPolicy((await res.json()).policy);
    } finally {
      setLoading(false);
    }
  }, [business?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/weekly-off', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, policy }),
      });
      if (!res.ok) {
        toast.error((await res.json()).error || 'Save failed');
        return;
      }
      toast.success('Weekly off policy saved');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SettingsPageShell title="Weekly off" description="Business default weekly off pattern" icon={Loader2}>
        <Loader2 className="h-5 w-5 animate-spin" />
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell
      title="Weekly off"
      description="Default weekly off for all employees. Individual overrides can be set on the employee profile."
      icon={Save}
    >
      <form onSubmit={handleSave} className="max-w-xl space-y-6">
        <div>
          <p className="mb-2 text-sm font-medium">Fixed weekly off days</p>
          <div className="flex flex-wrap gap-3">
            {DAY_LABELS.map((label, idx) => (
              <label key={idx} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={policy.fixed_days.includes(idx)}
                  onChange={(e) => {
                    const fixed = e.target.checked
                      ? [...policy.fixed_days, idx]
                      : policy.fixed_days.filter((d) => d !== idx);
                    setPolicy({ ...policy, fixed_days: fixed });
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Nth weekday rules (e.g. 2nd & 4th Saturday)</p>
          {policy.nth_rules.map((rule, i) => (
            <div key={i} className="mb-2 flex flex-wrap gap-2">
              <Input
                type="number"
                className="w-24"
                value={rule.week}
                onChange={(e) => {
                  const nth = [...policy.nth_rules];
                  nth[i] = { ...rule, week: Number(e.target.value) };
                  setPolicy({ ...policy, nth_rules: nth });
                }}
                placeholder="Week (2,4,-1)"
              />
              <select
                className="input"
                value={rule.weekday}
                onChange={(e) => {
                  const nth = [...policy.nth_rules];
                  nth[i] = { ...rule, weekday: Number(e.target.value) };
                  setPolicy({ ...policy, nth_rules: nth });
                }}
              >
                {DAY_LABELS.map((label, idx) => (
                  <option key={idx} value={idx}>
                    {label}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setPolicy({ ...policy, nth_rules: policy.nth_rules.filter((_, j) => j !== i) })
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setPolicy({ ...policy, nth_rules: [...policy.nth_rules, { week: 2, weekday: 6 }] })
            }
          >
            Add rule
          </Button>
        </div>

        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>
      </form>
    </SettingsPageShell>
  );
}
