'use client';

import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { PluginField } from '@/lib/integrations/catalog';
import type { ConnectionView } from '@/lib/integrations/service';
import { generateWebhookToken } from '@/lib/integrations/webhook-token';
import { buildSaveValues, initialFormValues } from '@/lib/integrations/plugin-form';

type Props = {
  id: string;
  provider: string;
  title: string;
  fields: PluginField[];
  connection: ConnectionView | null;
  businessId: string;
  canEdit: boolean;
  onSaved: (connection: ConnectionView) => void;
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      setDone(false);
    }
  };
  return (
    <Button type="button" variant="secondary" size="sm" onClick={copy} disabled={!text} aria-label={label}>
      {done ? <Check className="w-4 h-4" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
    </Button>
  );
}

export function PluginSettingsForm({ id, provider, title, fields, connection, businessId, canEdit, onSaved }: Props) {
  const [form, setForm] = useState<Record<string, string>>(() => initialFormValues(fields, connection));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const webhookAddress = `${typeof window === 'undefined' ? '' : window.location.origin}/api/webhooks/store/${provider}`;

  const setValue = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/integrations/${encodeURIComponent(id)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, values: buildSaveValues(fields, form) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.connection) {
        setError(typeof data.error === 'string' ? data.error : 'Could not save. Try again.');
        return;
      }
      setForm(initialFormValues(fields, data.connection as ConnectionView));
      setSuccess(true);
      onSaved(data.connection as ConnectionView);
    } catch {
      setError('Could not save. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6 max-w-2xl" autoComplete="off">
      {fields.map((f) => {
        const help = f.help ? <p className="text-sm text-text-secondary mt-1.5">{f.help}</p> : null;
        if (f.kind === 'webhook_token') {
          const hasToken = Boolean(connection?.webhookConfigured);
          return (
            <div key={f.key} className="space-y-3">
              <label className="type-label block" htmlFor={`pf-${f.key}`}>{f.label}</label>
              <div>
                <p className="text-sm text-text-secondary mb-1.5">Webhook address</p>
                <div className="flex items-center gap-2">
                  <input readOnly value={webhookAddress} aria-label="Webhook address" className="input flex-1 min-w-0 text-sm" />
                  <CopyButton text={webhookAddress} label="Copy webhook address" />
                </div>
              </div>
              <p className="text-sm text-text-primary">
                {hasToken
                  ? 'A token is saved.'
                  : `No token yet. Tracking updates are refused until one is saved here and in ${title}.`}
              </p>
              <div className="flex items-center gap-2">
                <input
                  id={`pf-${f.key}`}
                  data-testid="shiprocket-webhook-token"
                  className="input flex-1 min-w-0 font-mono text-sm"
                  value={form[f.key] ?? ''}
                  onChange={(e) => setValue(f.key, e.target.value)}
                  placeholder={hasToken ? 'Saved. Generate or type a new one to replace it.' : 'Generate a token'}
                  disabled={!canEdit}
                  autoComplete="off"
                />
                <CopyButton text={form[f.key] ?? ''} label="Copy token" />
              </div>
              {canEdit && (
                <Button type="button" variant="secondary" onClick={() => setValue(f.key, generateWebhookToken())}>
                  Generate token
                </Button>
              )}
              {form[f.key] && (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Copy this token into {title}, then save. It is not shown again.
                </p>
              )}
              {help}
            </div>
          );
        }
        const isPassword = f.kind === 'password';
        const stored = isPassword && Boolean(connection?.secretsSet.includes(f.key));
        return (
          <div key={f.key}>
            <Input
              label={f.label}
              type={isPassword ? 'password' : f.kind === 'email' ? 'email' : 'text'}
              value={form[f.key] ?? ''}
              onChange={(e) => setValue(f.key, e.target.value)}
              placeholder={stored ? 'Saved. Type a new one to replace it.' : undefined}
              required={f.required && !stored}
              disabled={!canEdit}
              autoComplete={isPassword ? 'new-password' : 'off'}
            />
            {help}
          </div>
        );
      })}

      {error && (
        <p role="alert" className="text-sm text-error">{error}</p>
      )}
      {success && (
        <p role="status" className="text-sm text-green-700 dark:text-green-300">
          Connected. {title} accepted these details.
        </p>
      )}
      {canEdit && (
        <Button type="submit" size="lg" isLoading={saving} disabled={saving}>
          Save and verify
        </Button>
      )}
    </form>
  );
}
