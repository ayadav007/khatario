'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { STACK_SECTION_CLASS } from '@/lib/page-layout';

export function HrHiringSettingsPanel() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoInvite, setAutoInvite] = useState(false);

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/hr-hiring?business_id=${business.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setAutoInvite(data.settings?.auto_send_onboarding_invite === true);
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
    if (!business?.id) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/hr-hiring', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          auto_send_onboarding_invite: autoInvite,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not save');
        return;
      }
      toast.success('Hiring preferences saved');
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
    <div className="space-y-6">
      <div className={STACK_SECTION_CLASS}>
        <h3 className="settings-section-title mb-0">Templates</h3>
        <p className="type-body-secondary">
          Configure documents and tasks for new hires.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary">
          <li>
            <Link href="/settings/onboarding-templates" className="link-primary">
              Onboarding templates
            </Link>{' '}
            — checklist tasks for new employees
          </li>
          <li>
            <Link href="/settings/offer-letter" className="link-primary">
              Offer letter template
            </Link>{' '}
            — PDF layout for recruitment offers
          </li>
          <li>
            <Link href="/employees/recruitment" className="link-primary">
              Recruitment pipeline
            </Link>{' '}
            — jobs and candidates
          </li>
        </ul>
      </div>

      <form onSubmit={handleSave} className={STACK_SECTION_CLASS}>
        <h3 className="settings-section-title mb-0">Automation</h3>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-gray-50 p-4 dark:bg-slate-800/50">
          <input
            type="checkbox"
            className="mt-1"
            checked={autoInvite}
            onChange={(e) => setAutoInvite(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium text-text-primary">
              Send onboarding portal invite when a candidate is marked hired
            </span>
            <span className="mt-0.5 block text-sm text-text-secondary">
              When enabled, new hires receive the candidate portal link to complete onboarding tasks.
            </span>
          </span>
        </label>
        <Button type="submit" disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? 'Saving…' : 'Save preferences'}
        </Button>
      </form>
    </div>
  );
}
