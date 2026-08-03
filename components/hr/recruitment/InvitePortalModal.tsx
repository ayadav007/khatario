'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { clsx } from 'clsx';

type TemplateOption = {
  id: string;
  task_key: string;
  name: string;
  is_required: boolean;
  due_days_after_invite: number | null;
  is_active: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  candidateName: string;
  businessId: string;
  userId: string;
  candidateId: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};

export function InvitePortalModal({
  open,
  onClose,
  candidateName,
  businessId,
  userId,
  candidateId,
  onSuccess,
  onError,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [emailPreview, setEmailPreview] = useState<{ subject: string } | null>(null);

  const qs = () =>
    new URLSearchParams({ business_id: businessId, user_id: userId }).toString();

  const load = useCallback(async () => {
    if (!open || !businessId || !userId) return;
    setLoading(true);
    try {
      const [tplRes, emailRes] = await Promise.all([
        fetch(`/api/hr/onboarding-templates?${qs()}`),
        fetch(`/api/hr/onboarding-invite-email?${qs()}`),
      ]);
      if (tplRes.ok) {
        const data = await tplRes.json();
        const active = (data.templates ?? []).filter((t: TemplateOption) => t.is_active);
        setTemplates(active);
        setSelected(new Set(active.map((t: TemplateOption) => t.id)));
      }
      if (emailRes.ok) {
        const data = await emailRes.json();
        setEmailPreview({ subject: data.preview?.subject ?? data.settings?.subject ?? '' });
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, businessId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(templates.map((t) => t.id)));
  const selectNone = () => setSelected(new Set());

  const sendInvite = async () => {
    if (selected.size === 0) {
      onError('Select at least one task');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/hr/recruitment/candidates/${candidateId}/invite-portal?${qs()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ template_ids: Array.from(selected) }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        onError(data.error || 'Invite failed');
        return;
      }
      onSuccess(
        `Portal invite sent to ${candidateName}. ${data.tasks_assigned ?? 0} task(s) assigned.`,
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-border bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-portal-title"
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="invite-portal-title" className="text-lg font-semibold text-text-primary">
              Invite to candidate portal
            </h2>
            <p className="mt-0.5 text-sm text-text-secondary">{candidateName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-text-muted hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            </div>
          ) : (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-text-primary">Tasks to assign</p>
                  <div className="flex gap-2 text-xs">
                    <button type="button" className="link-primary" onClick={selectAll}>
                      All
                    </button>
                    <span className="text-text-muted">·</span>
                    <button type="button" className="link-primary" onClick={selectNone}>
                      None
                    </button>
                  </div>
                </div>
                <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
                  {templates.length === 0 ? (
                    <li className="text-sm text-text-muted">
                      No active templates. Configure under Settings → Onboarding templates.
                    </li>
                  ) : (
                    templates.map((t) => (
                      <li key={t.id}>
                        <label className="flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5 rounded"
                            checked={selected.has(t.id)}
                            onChange={() => toggle(t.id)}
                          />
                          <span>
                            <span className="font-medium text-text-primary">{t.name}</span>
                            {t.is_required ? (
                              <span className="ml-1 text-xs text-text-muted">(required)</span>
                            ) : null}
                            {t.due_days_after_invite != null ? (
                              <span className="block text-xs text-text-secondary">
                                Due {t.due_days_after_invite} days after invite
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <div className="rounded-lg border border-border bg-gray-50 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <Mail className="h-4 w-4" />
                  Email preview
                </div>
                <p className="mt-1 text-xs text-text-secondary">
                  Subject: {emailPreview?.subject || '—'}
                </p>
                <p className="mt-2 text-xs text-text-muted">
                  Includes task table with due dates, OTP login steps, and a Complete tasks button.
                  Customize in{' '}
                  <a href="/settings/onboarding-templates?tab=email" className="link-primary">
                    Settings → Onboarding templates → Invite email
                  </a>
                  .
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void sendInvite()} disabled={busy || loading || selected.size === 0}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send invite email'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function InvitePortalModalBackdrop({ className }: { className?: string }) {
  return <div className={clsx('fixed inset-0', className)} aria-hidden />;
}
