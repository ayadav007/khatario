'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import type { CandidatePortalInviteEmailSettings } from '@/lib/hr/recruitment/onboarding/invite-email-settings';

export function OnboardingInviteEmailTab() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<CandidatePortalInviteEmailSettings | null>(null);
  const [placeholders, setPlaceholders] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewSubject, setPreviewSubject] = useState('');

  const qs = () =>
    new URLSearchParams({ business_id: business!.id, user_id: user!.id }).toString();

  const load = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/onboarding-invite-email?${qs()}`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        setPlaceholders(data.placeholders ?? '');
        setPreviewHtml(data.preview?.html ?? '');
        setPreviewSubject(data.preview?.subject ?? '');
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!settings || !business?.id || !user?.id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/onboarding-invite-email?${qs()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to save');
        return;
      }
      const data = await res.json();
      setSettings(data.settings);
      setPreviewHtml(data.preview?.html ?? '');
      setPreviewSubject(data.preview?.subject ?? '');
      toast.success('Invite email template saved');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!window.confirm('Reset invite email to defaults?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/onboarding-invite-email?${qs()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_defaults' }),
      });
      if (!res.ok) {
        toast.error('Failed to reset');
        return;
      }
      const data = await res.json();
      setSettings(data.settings);
      setPreviewHtml(data.preview?.html ?? '');
      setPreviewSubject(data.preview?.subject ?? '');
      toast.success('Reset to defaults');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Card className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-text-primary">Invite email template</h2>
            <Button variant="secondary" size="sm" onClick={() => void reset()} disabled={saving}>
              Reset defaults
            </Button>
          </div>
          <p className="text-xs text-text-secondary">{placeholders}</p>

          <Input
            label="Email subject"
            value={settings.subject}
            onChange={(e) => setSettings({ ...settings, subject: e.target.value })}
          />
          <Input
            label="Button label"
            value={settings.cta_label}
            onChange={(e) => setSettings({ ...settings, cta_label: e.target.value })}
          />

          <div>
            <label className="text-sm text-text-secondary">Intro (HTML)</label>
            <textarea
              className="mt-1 w-full rounded-md border border-border px-3 py-2 font-mono text-sm"
              rows={6}
              value={settings.intro_html}
              onChange={(e) => setSettings({ ...settings, intro_html: e.target.value })}
            />
            <p className="mt-1 text-xs text-text-muted">
              Use {'{{task_table}}'} and {'{{login_steps}}'} in intro to control placement, or leave them out to append automatically.
            </p>
          </div>

          <div>
            <label className="text-sm text-text-secondary">Footer (HTML)</label>
            <textarea
              className="mt-1 w-full rounded-md border border-border px-3 py-2 font-mono text-sm"
              rows={3}
              value={settings.footer_html}
              onChange={(e) => setSettings({ ...settings, footer_html: e.target.value })}
            />
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.include_task_table}
                onChange={(e) => setSettings({ ...settings, include_task_table: e.target.checked })}
              />
              Include task table with due dates
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.include_login_steps}
                onChange={(e) => setSettings({ ...settings, include_login_steps: e.target.checked })}
              />
              Include OTP login steps
            </label>
          </div>

          {settings.include_login_steps ? (
            <div>
              <label className="text-sm text-text-secondary">Custom login steps (HTML, optional)</label>
              <textarea
                className="mt-1 w-full rounded-md border border-border px-3 py-2 font-mono text-sm"
                rows={5}
                placeholder="Leave blank for default OTP steps"
                value={settings.login_steps_html ?? ''}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    login_steps_html: e.target.value.trim() ? e.target.value : null,
                  })
                }
              />
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save email template'}
            </Button>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-1 font-semibold text-text-primary">Preview</h2>
        <p className="mb-4 text-sm text-text-secondary">Subject: {previewSubject}</p>
        <div
          className="rounded-lg border border-border bg-white p-4 text-sm"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </Card>
    </div>
  );
}
