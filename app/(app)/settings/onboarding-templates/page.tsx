'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, ClipboardList } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { AccessDenied } from '@/components/common/AccessDenied';
import { OnboardingInviteEmailTab } from '@/components/settings/OnboardingInviteEmailTab';
import { clsx } from 'clsx';

type TemplateRow = {
  id: string;
  task_key: string;
  name: string;
  task_type: string;
  phase: string;
  is_required: boolean;
  due_days_after_invite: number | null;
  instruction_text: string;
  sort_order: number;
  is_active: boolean;
};

export default function OnboardingTemplatesPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') === 'email' ? 'email' : 'tasks';

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TemplateRow | null>(null);

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'settings',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  const qs = () =>
    new URLSearchParams({
      business_id: business!.id,
      user_id: user!.id,
    }).toString();

  const fetchTemplates = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/onboarding-templates?${qs()}`);
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id]);

  useEffect(() => {
    if (tab === 'tasks') void fetchTemplates();
  }, [fetchTemplates, tab]);

  const saveTemplate = async () => {
    if (!editing || !business?.id || !user?.id) return;
    setSavingId(editing.id);
    try {
      const res = await fetch(`/api/hr/onboarding-templates/${editing.id}?${qs()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editing.name,
          instruction_text: editing.instruction_text,
          due_days_after_invite: editing.due_days_after_invite,
          is_required: editing.is_required,
          is_active: editing.is_active,
          sort_order: editing.sort_order,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to save');
        return;
      }
      toast.success('Template updated');
      setEditing(null);
      await fetchTemplates();
    } finally {
      setSavingId(null);
    }
  };

  const resetDefaults = async () => {
    if (!business?.id || !user?.id) return;
    if (!window.confirm('Reset all onboarding templates to defaults? Existing template edits will be lost.')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/onboarding-templates?${qs()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_defaults' }),
      });
      if (!res.ok) {
        toast.error('Failed to reset templates');
        return;
      }
      toast.success('Templates reset to defaults');
      await fetchTemplates();
    } finally {
      setLoading(false);
    }
  };

  const setTab = (next: 'tasks' | 'email') => {
    router.replace(`/settings/onboarding-templates?tab=${next}`);
  };

  if (authStatus === 'loading') {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }
  if (authStatus === 'denied') return <AccessDenied module="settings" action="read" />;

  return (
    <SettingsPageShell
      title="Candidate onboarding"
      description="Configure default tasks and the invite email sent when HR invites a candidate to the portal."
      icon={ClipboardList}
      actions={
        tab === 'tasks' ? (
          <Button variant="secondary" size="sm" onClick={() => void resetDefaults()}>
            Reset tasks to defaults
          </Button>
        ) : null
      }
    >
      <div className="mb-4 flex gap-1 border-b border-border">
        {(['tasks', 'email'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={clsx(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
              tab === key ? 'border-blue-600 text-text-primary' : 'border-transparent text-text-secondary',
            )}
          >
            {key === 'tasks' ? 'Task templates' : 'Invite email'}
          </button>
        ))}
      </div>

      {tab === 'email' ? (
        <OnboardingInviteEmailTab />
      ) : loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-border bg-gray-50 text-left text-text-secondary">
                  <tr>
                    <th className="px-4 py-3 font-medium">Task</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Due (days)</th>
                    <th className="px-4 py-3 font-medium">Required</th>
                    <th className="px-4 py-3 font-medium">Active</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {templates.map((t) => (
                    <tr key={t.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-text-primary">{t.name}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{t.instruction_text}</p>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{t.task_type.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3">{t.due_days_after_invite ?? '—'}</td>
                      <td className="px-4 py-3">{t.is_required ? 'Yes' : 'No'}</td>
                      <td className="px-4 py-3">{t.is_active ? 'Yes' : 'No'}</td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="secondary" size="sm" onClick={() => setEditing({ ...t })}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {editing ? (
            <Card className="mt-4 space-y-4 p-4">
              <h2 className="font-semibold text-text-primary">Edit — {editing.task_key}</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <Input label="Display name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                <Input
                  label="Due days after invite"
                  type="number"
                  value={editing.due_days_after_invite ?? ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      due_days_after_invite: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
                <Input
                  label="Sort order"
                  type="number"
                  value={String(editing.sort_order)}
                  onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="text-sm text-text-secondary">Instructions shown to candidate</label>
                <textarea
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  rows={3}
                  value={editing.instruction_text}
                  onChange={(e) => setEditing({ ...editing, instruction_text: e.target.value })}
                />
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editing.is_required}
                    onChange={(e) => setEditing({ ...editing, is_required: e.target.checked })}
                  />
                  Required for offer
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editing.is_active}
                    onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                  />
                  Active (available when inviting)
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button onClick={() => void saveTemplate()} disabled={savingId === editing.id}>
                  {savingId === editing.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </SettingsPageShell>
  );
}
