'use client';

import { useCallback, useEffect, useState } from 'react';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { MetaCloudCredentialsForm, type MetaCloudPublic } from '@/components/whatsapp/MetaCloudCredentialsForm';

type Template = {
  id: string;
  name: string;
  language: string;
  category: string;
  body_text: string;
  header_text: string | null;
  footer_text: string | null;
  example_vars: string[];
  status: string;
  rejected_reason: string | null;
  event_key: string | null;
  meta_template_id: string | null;
};

type Setup = { configured: boolean; missing: string[] };

type FormState = {
  name: string;
  language: string;
  category: string;
  body_text: string;
  header_text: string;
  footer_text: string;
  example_vars: string[];
  event_key: string;
};

const EMPTY: FormState = {
  name: '',
  language: 'en_US',
  category: 'UTILITY',
  body_text: '',
  header_text: '',
  footer_text: '',
  example_vars: ['123456'],
  event_key: '',
};

function previewBody(body: string, vars: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => vars[Number(n) - 1] || `{{${n}}}`);
}

function statusClass(status: string): string {
  if (status === 'approved') return 'bg-green-100 text-green-800';
  if (status === 'rejected') return 'bg-red-100 text-red-800';
  if (status === 'pending') return 'bg-yellow-100 text-yellow-800';
  if (status === 'draft') return 'bg-gray-100 text-gray-800';
  return 'bg-orange-100 text-orange-800';
}

export function AdminWhatsAppTemplatesEditor() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [setup, setSetup] = useState<Setup>({ configured: false, missing: [] });
  const [eventKeys, setEventKeys] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>(['en_US', 'en', 'hi']);
  const [categories, setCategories] = useState<string[]>(['AUTHENTICATION', 'UTILITY', 'MARKETING']);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [testPhone, setTestPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState<MetaCloudPublic | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('https://staging.khatario.com/api/webhooks/meta-whatsapp');
  const [savingCreds, setSavingCreds] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/whatsapp-templates', platformAdminFetchInit);
      const data = await res.json();
      if (res.ok) {
        setTemplates(data.templates || []);
        setSetup(data.setup || { configured: false, missing: [] });
        if (data.credentials) setCredentials(data.credentials);
        if (data.webhookUrl) setWebhookUrl(data.webhookUrl);
        setEventKeys(data.eventKeys || []);
        setLanguages(data.languages || languages);
        setCategories(data.categories || categories);
      } else {
        setMessage(data.error || 'Failed to load');
        if (data.setup) setSetup(data.setup);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = templates.find((t) => t.id === selectedId) || null;
  const locked = selected && selected.status !== 'draft' && selected.status !== 'rejected';

  const openNew = () => {
    setSelectedId('new');
    setForm(EMPTY);
  };

  const openExisting = (t: Template) => {
    setSelectedId(t.id);
    setForm({
      name: t.name,
      language: t.language,
      category: t.category,
      body_text: t.body_text,
      header_text: t.header_text || '',
      footer_text: t.footer_text || '',
      example_vars: t.example_vars?.some((v) => String(v).trim())
        ? t.example_vars
        : ['123456'],
      event_key: t.event_key || '',
    });
  };

  const saveDraft = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const payload = {
        ...form,
        header_text: form.header_text || null,
        footer_text: form.footer_text || null,
        event_key: form.event_key || null,
      };
      const isNew = selectedId === 'new';
      const res = await fetch(isNew ? '/api/admin/whatsapp-templates' : `/api/admin/whatsapp-templates/${selectedId}`, {
        ...platformAdminFetchInit,
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setMessage('Draft saved in Khatario only. Click Submit to Meta below to create it on WhatsApp.');
      await load();
      if (data.template?.id) openExisting(data.template);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submitMeta = async () => {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/whatsapp-templates/${selected.id}/submit`, {
        ...platformAdminFetchInit,
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submit failed');
      setMessage('Submitted to Meta');
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const syncAll = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/whatsapp-templates', {
        ...platformAdminFetchInit,
        method: 'PUT',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setMessage('Status synced from Meta');
      if (data.templates) setTemplates(data.templates);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/whatsapp-templates/${selected.id}/test-send`, {
        ...platformAdminFetchInit,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_phone: testPhone, vars: form.example_vars }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');
      setMessage(`Sent (${data.messageId})`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete template ${selected.name}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/whatsapp-templates/${selected.id}`, {
        ...platformAdminFetchInit,
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setSelectedId(null);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCredentials = async (payload: {
    waba_id: string;
    phone_number_id: string;
    access_token: string;
    app_secret: string;
    verify_token: string;
  }) => {
    setSavingCreds(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/whatsapp-credentials', {
        ...platformAdminFetchInit,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setCredentials(data.credentials);
      setSetup({
        configured: Boolean(data.credentials?.ready),
        missing: data.credentials?.missing || [],
      });
      setMessage('Cloud API credentials saved');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingCreds(false);
    }
  };

  if (loading) return <p className="text-gray-600">Loading WhatsApp templates…</p>;

  return (
    <div className="admin-light-surface space-y-6 text-gray-900">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">WhatsApp templates</h2>
        <p className="text-sm text-gray-600 mt-1">
          Platform Cloud API templates on the Khatario WABA. Messages send only when Meta status is APPROVED.
          Use <code className="text-xs">{'{{1}}'}</code> placeholders — not HTML.
        </p>
      </div>

      <MetaCloudCredentialsForm
        credentials={credentials}
        webhookUrl={webhookUrl}
        saving={savingCreds}
        onSave={saveCredentials}
        title="Khatario Cloud API (this WABA)"
        description="Paste the system user token and IDs from Meta Business Manager. Values are stored encrypted in the database — not in .env. Leave secret fields blank to keep what is already saved."
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={openNew}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm"
        >
          New draft
        </button>
        <button
          type="button"
          onClick={() => void syncAll()}
          disabled={busy || !setup.configured}
          className="px-4 py-2 border rounded-lg text-sm disabled:opacity-50"
        >
          Sync status from Meta
        </button>
      </div>

      {message && <p className="text-sm text-gray-800">{message}</p>}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-gray-900">
          <thead>
            <tr className="text-left text-gray-600 border-b">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Category</th>
              <th className="py-2 pr-4">Language</th>
              <th className="py-2 pr-4">Event</th>
              <th className="py-2 pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr
                key={t.id}
                className={`border-b cursor-pointer text-gray-900 ${selectedId === t.id ? 'bg-primary-50' : 'hover:bg-gray-50'}`}
                onClick={() => openExisting(t)}
              >
                <td className="py-2 pr-4 font-mono text-gray-900">{t.name}</td>
                <td className="py-2 pr-4 text-gray-900">{t.category}</td>
                <td className="py-2 pr-4 text-gray-900">{t.language}</td>
                <td className="py-2 pr-4 text-gray-900">{t.event_key || '—'}</td>
                <td className="py-2 pr-4">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusClass(t.status)}`}>
                    {t.status}
                  </span>
                </td>
              </tr>
            ))}
            {templates.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-gray-500">No templates yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedId && (
        <div className="space-y-4 border-t pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name (a-z, 0-9, _)</label>
              <input
                value={form.name}
                disabled={!!locked}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50 text-gray-900 bg-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
              <select
                value={form.language}
                disabled={!!locked}
                onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50 text-gray-900 bg-white"
              >
                {languages.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={form.category}
                disabled={!!locked}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50 text-gray-900 bg-white"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Event mapping</label>
              <select
                value={form.event_key}
                onChange={(e) => setForm((f) => ({ ...f, event_key: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white"
              >
                <option value="">None</option>
                {eventKeys.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
          </div>

          {form.category !== 'AUTHENTICATION' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Header (optional)</label>
                <input
                  value={form.header_text}
                  onChange={(e) => setForm((f) => ({ ...f, header_text: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Body (plain text)</label>
                <textarea
                  value={form.body_text}
                  onChange={(e) => setForm((f) => ({ ...f, body_text: e.target.value }))}
                  rows={5}
                  className="w-full px-3 py-2 border rounded-lg font-mono text-sm text-gray-900 bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Footer (optional)</label>
                <input
                  value={form.footer_text}
                  onChange={(e) => setForm((f) => ({ ...f, footer_text: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white"
                />
              </div>
            </>
          )}

          {form.category === 'AUTHENTICATION' && (
            <p className="text-sm text-gray-600">
              AUTHENTICATION templates use Meta&apos;s OTP layout (copy-code button). If Meta rejects custom AUTH bodies,
              create a UTILITY template with <code>{'{{1}}'}</code> for the code instead.
            </p>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Example / send vars (<code>{'{{1}}'}</code>, <code>{'{{2}}'}</code>, …)
            </label>
            <input
              value={form.example_vars.join(', ')}
              onChange={(e) =>
                setForm((f) => ({ ...f, example_vars: e.target.value.split(',').map((s) => s.trim()) }))
              }
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 bg-white"
            />
          </div>

          {form.body_text && (
            <div className="rounded-lg bg-gray-50 p-3 text-sm whitespace-pre-wrap">
              <p className="text-xs text-gray-500 mb-1">Preview</p>
              {previewBody(form.body_text, form.example_vars)}
            </div>
          )}

          {selected?.rejected_reason && (
            <p className="text-sm text-red-700">Rejected: {selected.rejected_reason}. Create a new name if Meta blocks reuse.</p>
          )}

          <div className="flex flex-wrap gap-2">
            {(selectedId === 'new' || selected) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveDraft()}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {locked ? 'Save event mapping' : 'Save draft'}
              </button>
            )}
            {selected && (selected.status === 'draft' || selected.status === 'rejected') && (
              <button
                type="button"
                disabled={busy || !setup.configured}
                onClick={() => void submitMeta()}
                className="px-4 py-2 border border-primary-600 text-primary-700 rounded-lg text-sm disabled:opacity-50"
                title={!setup.configured ? 'Save WABA ID, phone number ID, and access token first' : undefined}
              >
                Submit to Meta
              </button>
            )}
            {selected && (selected.status === 'draft' || selected.status === 'rejected') && !setup.configured && (
              <p className="text-sm text-amber-800 w-full">
                Submit stays disabled until Cloud API credentials (the three Digitable fields) are saved at the top of this page.
              </p>
            )}
            {selected && (
              <button type="button" disabled={busy} onClick={() => void remove()} className="px-4 py-2 text-red-700 text-sm">
                Delete
              </button>
            )}
          </div>

          {selected?.status === 'approved' && (
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Test send phone</label>
                <input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="9876543210"
                  className="px-3 py-2 border rounded-lg text-gray-900 bg-white"
                />
              </div>
              <button
                type="button"
                disabled={busy || !testPhone}
                onClick={() => void sendTest()}
                className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm disabled:opacity-50"
              >
                Send test
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
