'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { SimpleRichTextEditor } from '@/components/email/SimpleRichTextEditor';
import {
  PLATFORM_TEMPLATE_DEFINITIONS,
  isSystemTemplateId,
  type StoredEmailTemplate,
} from '@/lib/platform-email-template-definitions';

type Stored = Record<string, StoredEmailTemplate>;

function newCustomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `custom_${crypto.randomUUID()}`;
  }
  return `custom_${Date.now()}`;
}

export function AdminEmailTemplatesEditor() {
  const [templates, setTemplates] = useState<Stored>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const customIds = useMemo(
    () => Object.keys(templates).filter((id) => !isSystemTemplateId(id)).sort(),
    [templates],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/settings/email-templates', platformAdminFetchInit);
      const data = await res.json();
      if (res.ok) setTemplates(data.templates || {});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (id: string, next: StoredEmailTemplate) => {
    setTemplates((t) => ({ ...t, [id]: { ...t[id], ...next } }));
  };

  const addCustom = () => {
    const id = newCustomId();
    setTemplates((t) => ({
      ...t,
      [id]: {
        label: 'New template',
        subject: '',
        body_html: '<p></p>',
      },
    }));
  };

  const removeCustom = (id: string) => {
    if (isSystemTemplateId(id)) return;
    setTemplates((t) => {
      const next = { ...t };
      delete next[id];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/settings/email-templates', {
        ...platformAdminFetchInit,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates }),
      });
      const data = await res.json();
      if (res.ok) {
        setTemplates(data.templates);
        setMessage('Templates saved.');
      } else {
        setMessage(data.error || 'Save failed');
      }
    } catch {
      setMessage('Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-600">Loading templates…</p>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Email templates</h2>
        <p className="text-sm text-gray-600 mt-1">
          Product emails (welcome, payments) always appear first. Add extra templates for notes you
          reuse. Placeholders:{' '}
          <code className="text-xs">{'{{businessName}} {{userName}} {{trialLine}} {{planName}} {{amount}} {{billingCycle}} {{paymentReference}} {{reason}} {{planLabel}} {{userPhone}} {{businessEmail}} {{appUrl}} {{supportEmail}}'}</code>
        </p>
      </div>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Used by the product</h3>
        {PLATFORM_TEMPLATE_DEFINITIONS.map((def) => (
          <TemplateCard
            key={def.id}
            title={def.label}
            system
            subject={templates[def.id]?.subject ?? ''}
            subjectPlaceholder={def.defaultSubject}
            body={templates[def.id]?.body_html || def.defaultBodyHtml.trim()}
            onSubject={(subject) => patch(def.id, { subject })}
            onBody={(body_html) => patch(def.id, { body_html })}
          />
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Your templates</h3>
          <button
            type="button"
            onClick={addCustom}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Add template
          </button>
        </div>
        {customIds.length === 0 && (
          <p className="text-sm text-gray-500">No extra templates yet. Add one to keep copy you send by hand.</p>
        )}
        {customIds.map((id) => (
          <TemplateCard
            key={id}
            title={templates[id]?.label || 'Untitled'}
            titleEditable
            onTitle={(label) => patch(id, { label })}
            subject={templates[id]?.subject ?? ''}
            subjectPlaceholder="Subject"
            body={templates[id]?.body_html || '<p></p>'}
            onSubject={(subject) => patch(id, { subject })}
            onBody={(body_html) => patch(id, { body_html })}
            onRemove={() => removeCustom(id)}
          />
        ))}
      </section>

      {message && (
        <p className={`text-sm ${message.includes('saved') ? 'text-green-700' : 'text-red-600'}`}>{message}</p>
      )}

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save templates'}
      </button>
    </div>
  );
}

function TemplateCard({
  title,
  titleEditable,
  system,
  subject,
  subjectPlaceholder,
  body,
  onTitle,
  onSubject,
  onBody,
  onRemove,
}: {
  title: string;
  titleEditable?: boolean;
  system?: boolean;
  subject: string;
  subjectPlaceholder: string;
  body: string;
  onTitle?: (label: string) => void;
  onSubject: (subject: string) => void;
  onBody: (html: string) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-gray-50">
      <div className="flex items-start justify-between gap-3">
        {titleEditable ? (
          <input
            type="text"
            value={title}
            onChange={(e) => onTitle?.(e.target.value)}
            className="flex-1 font-medium text-gray-900 border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
          />
        ) : (
          <p className="font-medium text-gray-900">{title}</p>
        )}
        {system ? (
          <span className="text-xs text-gray-500 shrink-0">System</span>
        ) : (
          <button type="button" onClick={onRemove} className="text-sm text-red-600 hover:underline shrink-0">
            Delete
          </button>
        )}
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
        <input
          type="text"
          value={subject}
          placeholder={subjectPlaceholder}
          onChange={(e) => onSubject(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Body</label>
        <SimpleRichTextEditor value={body} onChange={onBody} minHeightClass="min-h-[180px]" />
      </div>
    </div>
  );
}
