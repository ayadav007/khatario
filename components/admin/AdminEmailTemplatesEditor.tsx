'use client';

import { useCallback, useEffect, useState } from 'react';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { PLATFORM_TEMPLATE_DEFINITIONS } from '@/lib/platform-email-template-definitions';

type Stored = Record<string, { subject?: string; body_html?: string }>;

export function AdminEmailTemplatesEditor() {
  const [templates, setTemplates] = useState<Stored>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Email templates</h2>
        <p className="text-sm text-gray-600 mt-1">
          Placeholders:{' '}
          <code className="text-xs">{'{{businessName}} {{planName}} {{amount}} {{billingCycle}} {{paymentReference}} {{reason}} {{appUrl}}'}</code>
        </p>
      </div>

      {PLATFORM_TEMPLATE_DEFINITIONS.map((def) => (
        <div key={def.id} className="border border-border rounded-lg p-4 space-y-3 bg-gray-50">
          <p className="font-medium text-gray-900">{def.label}</p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
            <input
              type="text"
              value={templates[def.id]?.subject ?? ''}
              placeholder={def.defaultSubject}
              onChange={(e) =>
                setTemplates((t) => ({
                  ...t,
                  [def.id]: { ...t[def.id], subject: e.target.value },
                }))
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Body (HTML fragment)</label>
            <textarea
              rows={5}
              value={templates[def.id]?.body_html ?? ''}
              placeholder={def.defaultBodyHtml.trim()}
              onChange={(e) =>
                setTemplates((t) => ({
                  ...t,
                  [def.id]: { ...t[def.id], body_html: e.target.value },
                }))
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
        </div>
      ))}

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
